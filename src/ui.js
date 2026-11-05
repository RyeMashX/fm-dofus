// Interface : deux vues (Objet, FM), reliquat en tête, cycle automatique en mode FM. Vanilla JS.
import * as FM from './engine.js';
import * as Search from './search.js';
import { STATS, STAT_BY_KEY, RUNES, RUNE_BY_ID } from './stats.js';
import { searchItems, iconUrl, labelOf } from './dofusdb.js';
import * as Cap from './capture.js';
import { interpretEntry } from './ocr.js';
import { corrigerSCReliquat } from './correction.js';

let root = document;   // document courant : la page, ou la fenêtre flottante (PiP)
const $ = sel => root.querySelector(sel);
const $$ = sel => [...root.querySelectorAll(sel)];
const KEY = 'fm-dofus:state';
const JKEY = 'fm-dofus:journal'; // journal permanent des poses réelles, indépendant de l'objet en cours
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = x => FM.fmt(x).toString().replace('.', ',');
const w1 = x => Math.round(x * 100) / 100;
const bar = o => `<i class="sc" style="width:${o.sc}%"></i><i class="sn" style="width:${o.sn}%"></i><i class="ec" style="width:${o.ec}%"></i>`;
const oddsText = o => `<span class="odds"><b>SC ${pct(o.sc)} %</b> · <i>SN ${pct(o.sn)} %</i> · <s>EC ${pct(o.ec)} %</s></span>`;
// Difficulté D et sa décomposition (mêmes constantes que le moteur), pour l'infobulle.
function diffText(o) {
  if (!o || o.blocked || o.regime === 'exo' || o.difficulty == null) return '';
  const P = FM.P, q = o.quality ?? 0, parts = [`base ${P.BASE}`];
  const ratio = P.RATIO_SLOPE * Math.max(0, (o.ratio ?? 0) - P.RATIO_START); if (ratio > 0) parts.push(`ratio ${(o.ratio).toFixed(1).replace('.', ',')} → +${Math.round(ratio)}`);
  if (o.regime === 'over') parts.push(`over +${Math.round(P.OVER_BASE + P.OVER_PER_WEIGHT * (o.overWeight ?? 0))}`);
  else if (o.regime === 'step') parts.push(`palier 80 % +${P.STEP}`);
  parts.push(`qualité ${q.toFixed(2).replace('.', ',')} → +${Math.round(P.QUALITY_COEF * q ** P.QUALITY_EXP)}`);
  if ((S.item?.level ?? 200) < P.LEVEL_BONUS_BELOW) parts.push(`niveau < 170 → −${Math.round(20 * Math.max(0, 1.1 - q))}`);
  return `<span class="diff" title="Difficulté D : ${parts.join(' · ')}. SC = max(2, (100 − D) / 2)">D ${Math.round(o.difficulty)}</span>`;
}
const statImg = (stat, cls = 'sicon') => { const u = STAT_BY_KEY[stat]?.icon; return u ? `<img class="${cls}" src="${esc(u)}" alt="" loading="lazy">` : ''; };
const runeImg = (r, cls = 'ricon') => r?.icon ? `<img class="${cls}" src="${esc(r.icon)}" alt="" loading="lazy">` : '';

// ---- Solveur en arrière-plan ---------------------------------------------------
// Les simulations tournent dans un Web Worker (module) ; sans worker (fichier unique, vieux navigateur),
// elles tournent dans la page. Les paramètres du modèle sont envoyés à chaque appel.
let worker = null; const jobs = new Map(); let jobSeq = 0;
try {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = e => { const j = jobs.get(e.data.id); jobs.delete(e.data.id); if (!j) return; e.data.error ? j.rej(new Error(e.data.error)) : j.res(e.data.result); };
  worker.onerror = () => { worker = null; for (const [id, j] of jobs) { jobs.delete(id); try { j.res(Search[j.fn](...j.args)); } catch (err) { j.rej(err); } } };
} catch { worker = null; }
function solve(fn, ...args) {
  if (!worker) return new Promise((res, rej) => setTimeout(() => { try { res(Search[fn](...args)); } catch (err) { rej(err); } }, 10));
  return new Promise((res, rej) => { const id = ++jobSeq; jobs.set(id, { res, rej, fn, args }); worker.postMessage({ id, fn, args, P: { ...FM.P } }); });
}

// ---- Modèle : DoFocus brut ou calibré sur le journal --------------------------
// Calibration du 2026-11-02 sur 156 poses réelles (2 objets) : le palier des 80 % pèse moins que dans
// DoFocus (+25 au lieu de +45) et la pénalité de ratio jet/bonus au-delà de 14 est doublée (24 par point
// au lieu de 12). Les tests unitaires gardent les valeurs DoFocus.
const MODELS = {
  dofocus: { label: 'DoFocus (référence)', P: { STEP: FM.P.STEP, RATIO_SLOPE: FM.P.RATIO_SLOPE } },
  calibre: { label: 'Calibré sur le journal (expérimental)', P: { STEP: 25, RATIO_SLOPE: 24 } },
};
function applyModel(key) { Object.assign(FM.P, (MODELS[key] || MODELS.dofocus).P); }

// ---- État --------------------------------------------------------------------
let S = load() || blank();
// Correction des données enregistrées : SC dont le reliquat a bougé → SN (journal, historique, sessions archivées)
try {
  const j = JSON.parse(localStorage.getItem('fm-dofus:journal')) || [], ss = JSON.parse(localStorage.getItem('fm-dofus:sessions')) || [];
  const r = corrigerSCReliquat({ journal: j, history: S.history || [], sessions: ss });
  if (r.journal || r.history || r.sessions) {
    localStorage.setItem('fm-dofus:journal', JSON.stringify(j)); localStorage.setItem('fm-dofus:sessions', JSON.stringify(ss));
    localStorage.setItem('fm-dofus:state', JSON.stringify(S));
    localStorage.removeItem('fm-dofus:journal-exported'); // à réexporter : le journal a changé
    window.__correction = r;
  }
} catch {}
if (S.settings.model === 'calibre' && !S.settings.modelChosen) S.settings.model = 'dofocus';
applyModel(S.settings.model);
let pending = null;      // rune sélectionnée pour la pose
let lossDraft = null;    // saisie des pertes en cours
let lastAdvice = null;
let poseSource = 'manuel', ocrEntry = null;   // provenance de la prochaine pose enregistrée au journal
const VERSION = document.querySelector('meta[name="fm-version"]')?.content || 'dev';

function blank() {
  return { template: null, item: null, reliquat: 0, reliquatBefore: 0, target: {}, history: [], settings: { top: 3, samples: 1500, view: 'item', show: { sc: true, sn: false, ec: false }, model: 'dofocus' } };
}
function load() { try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && !s.settings.view) s.settings.view = 'item'; if (s && s.reliquatBefore == null) s.reliquatBefore = s.reliquat; if (s && !s.settings.show) s.settings.show = { sc: true, sn: false, ec: false }; if (s && !s.settings.model) s.settings.model = 'dofocus'; return s; } catch { return null; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} }
const state = () => ({ item: S.item, reliquat: S.reliquat });
const runeOf = (stat, tier) => RUNES.find(r => r.stat === stat && r.tier === tier);

// ---- Recherche d'objet --------------------------------------------------------
let searchTimer = null;
$('#search-input').addEventListener('input', e => {
  clearTimeout(searchTimer);
  const q = e.target.value;
  searchTimer = setTimeout(async () => {
    const ul = $('#search-results');
    if (q.trim().length < 2) { ul.innerHTML = ''; ul.classList.add('hidden'); return; }
    try {
      const items = await searchItems(q);
      ul.innerHTML = items.map((t, i) => `<li data-i="${i}"><img src="${esc(iconUrl(t))}" alt=""><span class="grow">${esc(t.name)}</span><span class="muted small">niv. ${t.level} · ${esc(t.type)}</span></li>`).join('')
        || '<li class="muted">Aucun résultat</li>';
      ul.classList.remove('hidden');
      ul.querySelectorAll('li[data-i]').forEach(li => li.onclick = () => changeItem(items[+li.dataset.i]));
      setStatus('');
    } catch (err) { setStatus('DofusDB injoignable : saisis l\'objet à la main.'); }
  }, 250);
});
document.addEventListener('click', e => { if (!e.target.closest('.search')) { const ul = $('#search-results'); if (ul) ul.classList.add('hidden'); } });
$('#search-input').addEventListener('focus', () => { const ul = $('#search-results'); if (ul && ul.innerHTML) ul.classList.remove('hidden'); });
// Changement d'objet : avertit si la session en cours n'est pas finie ou pas archivée.
function changeItem(t) {
  if (S.item && S.history.length) {
    const reached = Object.keys(S.target).length > 0 && Search.targetReached(S.item, S.target);
    const archived = S.archivedLen === S.history.length;
    if (!reached || !archived) {
      const why = [!reached ? 'la cible n\'est pas atteinte' : '', !archived ? 'la session n\'est pas archivée' : ''].filter(Boolean).join(' et ');
      if (!confirm(`Changer d'objet ? Sur ${S.template?.name || 'l\'objet en cours'}, ${why}. La session sera archivée dans le bilan telle quelle.`)) { $('#search-results').classList.add('hidden'); return; }
    }
    archiveSession();
  }
  useTemplate(t);
}
$('#manual-item').onclick = () => changeItem({ id: null, name: 'Objet manuel', level: 200, type: '', lines: [], unknown: [], manual: true });

// Cible par défaut : vita/fo/ine/cha/age/pui → max − bonus de la Pa + 1 ; dommages, résistances %, cri → max ;
// le reste → 1 (pas de ligne à 0). Ligne négative → son max, le moins négatif (−20 à −16 → −16 ; −5 fixe → −5) ;
// ligne à max nul : pas de cible.
function autoTarget(lines) {
  const target = {};
  for (const l of lines) {
    if (l.min == null) continue;
    if (!(l.max > 0)) { if (l.max < 0) target[l.stat] = l.max; continue; }   // ligne négative : le moins négatif (son max)
    const st = STAT_BY_KEY[l.stat];
    if (['vita', 'fo', 'ine', 'cha', 'age', 'pui'].includes(l.stat)) target[l.stat] = Math.max(1, l.max - (st.tiers[1]?.[1] ?? 1) + 1);
    else if (/^do|^re_per_|^cri$/.test(l.stat)) target[l.stat] = l.max;
    else target[l.stat] = 1;
  }
  return target;
}

function useTemplate(t) {
  S = blank();
  S.sessionId = Date.now();
  S.template = t;
  S.item = { level: t.level, lines: t.lines.map(l => ({ stat: l.stat, value: 0, min: l.min, max: l.max })) };
  S.target = autoTarget(S.item.lines);
  S.settings.view = 'item';
  pending = null; lastAdvice = null;
  $('#search-results').innerHTML = ''; $('#search-results').classList.add('hidden'); $('#search-input').value = '';
  save(); renderAll();
}

// ---- Vues ---------------------------------------------------------------------
let settingsOpen = false;   // l'écran de réglages se superpose à la vue courante
function setView(v) { S.settings.view = v; settingsOpen = false; save(); renderAll(); }
$$('#view-switch button').forEach(b => b.onclick = () => setView(b.dataset.view));
document.querySelector('#settings-btn').onclick = () => { settingsOpen = !settingsOpen; renderAll(); };
document.querySelector('#settings-back').onclick = () => { settingsOpen = false; renderAll(); };
document.querySelector('#bilan-prices').onclick = () => { settingsOpen = true; renderAll(); };

function renderAll() {
  const has = !!S.item;
  const view = settingsOpen ? 'settings' : has ? S.settings.view : 'search';
  root.body.className = 'view-' + view + (root !== document ? ' pip' : '');
  $('#search').classList.toggle('hidden', view !== 'search');
  $('#item-bar').classList.toggle('hidden', !has);
  $('#settings-btn').classList.toggle('on', settingsOpen);
  for (const v of ['item', 'fm', 'bilan', 'settings']) $$('.view-' + v).forEach(s => s.classList.toggle('hidden', view !== v));
  $$('#view-switch button').forEach(b => b.classList.toggle('on', !settingsOpen && b.dataset.view === S.settings.view));
  if (view === 'settings') { renderSettings(); return; }
  if (!has) return;
  const reached = Object.keys(S.target).length > 0 && Search.targetReached(S.item, S.target);
  $('#tab-bilan').classList.toggle('glow', reached);
  for (const id of ['#reliquat', '#reliquat-fm']) { const el = $(id); if (el) el.value = S.reliquat; }
  const t = S.template;
  $('#item-name').textContent = t.name;
  $('#item-meta').textContent = [t.type || 'objet', t.unknown?.length ? `${t.unknown.length} effet(s) non gérés` : ''].filter(Boolean).join(' · ');
  $('#item-icon').src = iconUrl(t) || ''; $('#item-icon').classList.toggle('hidden', !iconUrl(t));
  $('#item-level-text').textContent = S.item.level;
  if (view === 'fm') { renderPose(); renderHistory(); renderAdvice(); }
  else if (view === 'bilan') renderBilan(reached);
  else renderItem();
  renderCaptureButtons();
  $('#top-select').value = String(S.settings.top);
  $('#search-select').value = S.settings.search === 'advanced' ? 'advanced' : 'standard';
  const ss = $('#samples-select'); ss.value = String(S.settings.samples); if (!ss.value) { ss.value = '1500'; S.settings.samples = 1500; }
}

// ---- Reliquat -----------------------------------------------------------------
function setReliquat(v) { S.reliquat = Math.max(0, w1(Number(v) || 0)); for (const id of ['#reliquat', '#reliquat-fm']) { const el = $(id); if (el) el.value = S.reliquat; } save(); }
for (const sfx of ['', '-fm']) {
  $('#reliquat' + sfx).onchange = e => setReliquat(e.target.value);
  $('#rel-minus' + sfx).onclick = () => setReliquat(S.reliquat - 1);
  $('#rel-plus' + sfx).onclick = () => setReliquat(S.reliquat + 1);
}

// ---- Vue Objet ----------------------------------------------------------------
function renderItem() {
  const show = S.settings.show;
  for (const k of ['sc', 'sn', 'ec']) { const b = $('#show-' + k); if (b) b.setAttribute('aria-pressed', String(!!show[k])); }
  const light = show.runes === false;
  $('#show-runes').setAttribute('aria-pressed', String(!light));
  $('#lines').classList.toggle('light', light);
  $('.lhead').classList.toggle('light', light);
  root.body.classList.toggle('light', light);
  const shown = o => pct((show.sc ? o.sc : 0) + (show.sn ? o.sn : 0) + (show.ec ? o.ec : 0));
  const pcClass = show.sc && !show.sn && !show.ec ? 'sc' : !show.sc && show.sn && !show.ec ? 'sn' : !show.sc && !show.sn && show.ec ? 'ec' : 'mix';
  // rune conseillée par ligne cible : celle qui minimise les poses restantes à la valeur actuelle
  // rune conseillée : même solveur que la vue FM (simulations), calculé en arrière-plan ; voir lineAdvice()
  // ordre d'affichage : lignes du template positives, puis exos, puis lignes négatives (comme en jeu)
  const order = S.item.lines.map((l, i) => i).sort((a, b) => { const g = l => l.min == null ? 1 : l.max < 0 ? 2 : 0; return g(S.item.lines[a]) - g(S.item.lines[b]) || a - b; });
  $('#lines').innerHTML = order.map(i => { const l = S.item.lines[i];
    const st = STAT_BY_KEY[l.stat];
    const exo = l.min == null;
    const tgt = S.target[l.stat];
    const done = tgt != null && l.value >= tgt;
    const best = null;
    const runes = st.tiers.map(([name], k) => {
      const r = runeOf(l.stat, k);
      const o = FM.odds(S.item, r);
      const rec = best && best.tier === k;
      if (o.blocked) return `<div class="chip max" title="${o.blocked === 'line-cap' ? 'plafond de la ligne' : 'plafond over+exo de l\'objet'}">${runeImg(r)}<span class="cn">${esc(name)}</span><span class="pc">MAX</span></div>`;
      return `<div class="chip" data-rune="${r.id}">${runeImg(r)}<span class="cn">${esc(name)}</span><span class="pc ${pcClass}">${shown(o)}</span>
        <div class="pop"><div class="bar">${bar(o)}</div>${oddsText(o)} ${diffText(o)}<div class="advice-note"></div></div></div>`;
    }).join('');
    return `<div class="line ${done ? 'done' : ''} ${exo ? 'exo' : ''} ${l.max < 0 ? 'neg' : ''}" data-i="${i}">
      <div class="l1"><span class="name"><span class="slot">${exo ? '<button class="del" data-del="1" title="Retirer cet exo"><svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>' : ''}</span>${statImg(l.stat)}<span class="lbl" title="${esc(st.label)}">${esc(st.short)}</span><span class="recbadge hidden" data-stat="${l.stat}"></span></span><span class="range">${exo ? '' : l.min === l.max ? `${l.min}` : `${l.min} à ${l.max}`}</span>
        <input class="num small cur ${unreadStats.has(l.stat) ? 'unread' : ''}" type="number" data-field="value" value="${l.value}" title="jet actuel${exo ? '' : l.min === l.max ? ` (${l.min})` : ` (${l.min} à ${l.max})`}">
        <span class="arrow">→</span>
        <input class="num small tgt" type="number" data-field="target" value="${tgt ?? ''}" placeholder="cible" title="cible (minimum visé)">
        </div>
      <div class="l2">${runes}</div>
    </div>`;
  }).join('');
  $$('#lines input').forEach(inp => inp.onchange = onLineEdit);
  $$('#lines button[data-del]').forEach(b => b.onclick = () => {
    const i = +b.closest('.line').dataset.i; const stat = S.item.lines[i].stat;
    S.item.lines.splice(i, 1); delete S.target[stat]; save(); renderAll();
  });
  renderEstimate();
  lineAdvice();
  const present = new Set(S.item.lines.map(l => l.stat));
  $('#exo-select').innerHTML = '<option value="">+ Ajouter un exo…</option>' +
    STATS.filter(s => !present.has(s.key)).map(s => `<option value="${s.key}">${esc(s.label)}</option>`).join('');
}
// Runes conseillées de la vue Objet : un passage du solveur (simulations courtes), la meilleure rune de chaque
// ligne cible d'après son score, et le meilleur coup global.
let adviceKey = null, adviceCache = null;
function lineAdvice() {
  const key = JSON.stringify([S.item.lines, S.target, S.reliquat, S.settings.model]);
  if (key === adviceKey) { paintLineAdvice(); return; }
  adviceKey = key; adviceCache = null;
  if (!Object.keys(S.target).length || Search.targetReached(S.item, S.target)) return;
  solve('nextBestMoves', state(), S.target, { samples: 300, top: 50, seed: 5 }).then(r => { if (adviceKey !== key) return; adviceCache = r; paintLineAdvice(); }).catch(() => { adviceCache = null; });
}
function paintLineAdvice() {
  const r = adviceCache; if (!r || !$('#lines')) return;
  $$('#lines .chip').forEach(c => { c.classList.remove('rec', 'tie'); const n = c.querySelector('.advice-note'); if (n) n.innerHTML = ''; });
  $$('#lines .recbadge').forEach(b => { b.classList.add('hidden'); b.innerHTML = ''; });
  const bestByStat = new Map();
  for (const m of r.all || []) { if (m.purpose === 'nettoyage' || m.purpose === 'descente') continue; const b = bestByStat.get(m.rune.stat); if (!b || m.score < b.score) bestByStat.set(m.rune.stat, m); }
  for (const m of bestByStat.values()) {
    const c = $(`#lines .chip[data-rune="${m.rune.id}"]`); if (c) c.classList.add('rec');
    // vue allégée : badge après le nom de la caractéristique, bulle avec la rune
    const bd = $(`#lines .recbadge[data-stat="${m.rune.stat}"]`);
    if (bd) { bd.classList.remove('hidden'); bd.innerHTML = `${runeImg(m.rune, 'ricon sm')}<div class="pop"><div class="rec-title">${runeImg(m.rune, 'ricon sm')}<b>${esc(m.rune.name)}</b> <span class="muted small">+${m.rune.bonus}</span><span class="spacer"></span>${diffText(m.odds)}</div><div class="bar">${bar(m.odds)}</div>${oddsText(m.odds)}</div>`; }
  }
}

// Estimation du chemin restant : sessions simulées (politique gloutonne) → poses et coût attendus.
let estimateKey = null, estimateCache = null;
function renderEstimate() {
  const box = $('#estimate'); if (!box) return;
  const hasTarget = Object.keys(S.target).length > 0;
  const card = $('#estimate-card');
  if (!hasTarget || Search.targetReached(S.item, S.target)) { box.classList.add('hidden'); card.classList.toggle('hidden', !hasTarget); $('#estimate-sub').textContent = hasTarget ? 'cible atteinte' : ''; return; }
  card.classList.remove('hidden'); box.classList.remove('hidden');
  const key = JSON.stringify([S.item.lines, S.target, S.reliquat]);
  if (key !== estimateKey) {
    box.innerHTML = '<span class="muted small">Estimation…</span>';
    estimateKey = key;
    solve('simulateSessions', state(), S.target, { runs: 300, seed: 7 }).then(r => { if (estimateKey !== key) return; estimateCache = r; paintEstimate(); }).catch(() => { if (estimateKey === key) { estimateCache = null; paintEstimate(); } });
    return;
  }
  paintEstimate();
}
// Coût d'une estimation d'après les prix du moment.
function estimateCost(r) {
  const p = prices(); let cost = 0, missing = 0;
  const rows = r.runes.filter(x => x.n >= 0.05).map(x => { const u = p[x.id]; const c = u > 0 ? u * x.n : 0; if (u > 0) cost += c; else missing++; return { x, u, c }; });
  // coût par session simulée (runes sans prix ignorées) → déciles
  const costs = (r.detail || []).map(d => Object.entries(d.runes).reduce((a, [id, n]) => a + (p[id] > 0 ? p[id] * n : 0), 0)).sort((a, b) => a - b);
  const q = (arr, x) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(x * arr.length))] : 0;
  return { rows, cost, missing, costs, costP10: q(costs, 0.1), costMedian: q(costs, 0.5), costP90: q(costs, 0.9) };
}
// Estimation figée au départ (poses et coût attendus), pour la comparer au réel dans le bilan et les archives.
function freezeBaseline(r = estimateCache) {
  if (!r) { try { r = Search.simulateSessions(state(), S.target, { runs: 300, seed: 7 }); } catch { return null; } }
  const c = estimateCost(r);
  S.baseline = { t: new Date().toISOString(), poses: w1(r.mean), median: r.median, p90: r.p90, cost: Math.round(c.cost), costP90: Math.round(c.costP90), missing: c.missing,
                 runes: c.rows.map(({ x, u }) => ({ id: x.id, name: x.rune.name, n: w1(x.n), unit: u ?? null })), target: { ...S.target },
                 lines: S.item.lines.map(l => ({ stat: l.stat, value: l.value })), reliquat: S.reliquat, after: S.history.length };
  save(); return S.baseline;
}
const f1 = x => x >= 1000 ? Math.round(x).toLocaleString('fr-FR') : Number.isInteger(x) ? String(x) : x.toFixed(x >= 10 ? 0 : 1).replace('.', ',');
const pctDiff = (real, est) => { if (!(est > 0)) return ''; const d = Math.round((real / est - 1) * 100); return `<span class="${d > 25 ? 'bad' : d < -25 ? 'ok' : 'muted'}">${d >= 0 ? '+' : '−'}${Math.abs(d)} %</span>`; };
// Courbe de répartition (part des sessions terminées en ≤ x), SVG inline, une série.
function cdfSvg(values, { fmt = v => String(v), marks = [0.1, 0.5, 0.9] } = {}) {
  const v = values.slice().sort((a, b) => a - b); const n = v.length; if (!n) return '';
  const W = 300, H = 160, L = 36, R = 8, T = 10, B = 30;
  const xmax = v[Math.min(n - 1, Math.floor(0.98 * n))] || 1;
  const X = x => L + Math.min(1, x / xmax) * (W - L - R), Y = y => T + (1 - y) * (H - T - B);
  const pts = v.map((x, i) => `${X(x).toFixed(1)},${Y((i + 1) / n).toFixed(1)}`).join(' ');
  const grid = [0.25, 0.5, 0.75, 1].map(g => `<line x1="${L}" x2="${W - R}" y1="${Y(g)}" y2="${Y(g)}" class="g"/><text x="${L - 4}" y="${Y(g) + 3}" class="t" text-anchor="end">${Math.round(g * 100)} %</text>`).join('');
  const mk = marks.map((m, i) => { const x = v[Math.min(n - 1, Math.floor(m * n))]; const ty = i % 2 ? H - 16 : H - 5; return `<line x1="${X(x)}" x2="${X(x)}" y1="${Y(0)}" y2="${Y(m)}" class="m"/><circle cx="${X(x)}" cy="${Y(m)}" r="3" class="d"/><text x="${X(x)}" y="${ty}" class="t" text-anchor="middle">${esc(fmt(x))}</text>`; }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">${grid}<polyline points="${pts}" class="s"/>${mk}</svg>`;
}
// Coût par rune : barres pleine hauteur, nombre et coût écrits sur chaque barre.
function runeBarsSvg(rows) {
  const top = rows.filter(r => r.c > 0).sort((a, b) => b.c - a.c).slice(0, 6);
  if (!top.length) return '';
  const W = 300, H = 160, L = 6, R = 6, T = 26, B = 22, bw = (W - L - R) / top.length, max = top[0].c;
  const Y = y => T + (1 - y / max) * (H - T - B);
  const short = name => name.replace(/^Pa /, 'P·').replace(/^Ra /, 'R·').replace(/Neutre/, 'Neu').replace(/Terre/, 'Ter');
  const bars = top.map((r, i) => { const x = L + i * bw + 3, w = bw - 6, cx = x + w / 2;
    return `<rect x="${x.toFixed(1)}" y="${Y(r.c).toFixed(1)}" width="${w.toFixed(1)}" height="${(Y(0) - Y(r.c)).toFixed(1)}" rx="3" class="b"><title>${esc(r.x.rune.name)} × ${f1(r.x.n)} = ${kamas(r.c)}</title></rect>
      <text x="${cx.toFixed(1)}" y="${(Y(r.c) - 13).toFixed(1)}" class="t2" text-anchor="middle">${kShort(r.c)}</text><text x="${cx.toFixed(1)}" y="${(Y(r.c) - 3).toFixed(1)}" class="t" text-anchor="middle">× ${f1(r.x.n)}</text>
      <text x="${cx.toFixed(1)}" y="${H - 8}" class="t" text-anchor="middle">${esc(short(r.x.rune.name))}</text>`; }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">${bars}</svg>`;
}
function paintEstimate() {
  const box = $('#estimate'); const r = estimateCache;
  if (!r) { box.innerHTML = '<span class="muted small">Estimation indisponible.</span>'; return; }
  const { rows, cost, missing, costs, costP10, costMedian, costP90 } = estimateCost(r);
  const b = S.baseline;
  const dec = (a, m, z, fmt) => `<div class="dec"><span><i>1er décile</i><b>${fmt(a)}</b></span><span><i>médiane</i><b>${fmt(m)}</b></span><span><i>dernier décile</i><b>${fmt(z)}</b></span></div>`;
  const tot = rows.reduce((a, r) => a + r.c, 0);
  const detail = `<table class="rt"><thead><tr><th>Rune</th><th class="r">Nombre</th><th class="r">Prix unitaire</th><th class="r">Coût</th><th class="r">Part</th></tr></thead><tbody>${rows.map(({ x, u, c }) => `<tr><td>${runeImg(x.rune, 'ricon sm')}${esc(x.rune.name)}</td><td class="r">× ${f1(x.n)}</td><td class="r">${u > 0 ? kamas(u) : '<span class="warn">prix ?</span>'}</td><td class="r">${u > 0 ? kamas(c) : '—'}</td><td class="r muted">${u > 0 && tot ? Math.round(c / tot * 100) + ' %' : ''}</td></tr>`).join('')}</tbody></table>`;
  const top3 = rows.filter(r => r.c > 0).sort((a, b) => b.c - a.c).slice(0, 3);
  $('#estimate-sub').innerHTML = `pour atteindre la cible · ${r.runs} sessions simulées, moyenne en grand${r.unfinished > 0.02 ? ` · <span class="warn">${Math.round(r.unfinished * 100)} % n'aboutissent pas</span>` : ''}`;
  box.innerHTML = `${r.heavy ? `<p class="warn small">Dont exo : ${r.heavy.phases.map(x => x.cycles ? `${esc(x.rune.name)} ≈ ${Math.round(x.cycles.mean)} tentatives, ≈ ${f1(x.recover)} poses de remontée chacune` : `${esc(x.rune.name)} impossible (${x.blocked})`).join(' ; ')}.</p>` : ''}
    <div class="kpis est-kpis">
      <div class="kpi"><div class="v">${f1(r.mean)} <small>poses</small></div>${dec(r.p10, r.median, r.p90, x => f1(Math.round(x)))}</div>
      <div class="kpi"><div class="v">${cost ? `${kShort(cost)} <small>kamas</small>` : '<span class="muted">—</span>'}</div>${cost ? dec(costP10, costMedian, costP90, kShort) : '<div class="l muted small">renseigne les prix (⚙)</div>'}${missing ? `<div class="warn small">${missing} rune${missing > 1 ? 's' : ''} sans prix</div>` : ''}</div>
      <div class="kpi top3"><div class="l muted small">Runes à prévoir</div>${top3.length ? `<div class="t3">${top3.map(({ x, c }) => `<div>${runeImg(x.rune, 'ricon sm')}<span class="cn">${esc(x.rune.name)}</span><b>× ${f1(x.n)}</b><span class="muted">${kShort(c)}</span></div>`).join('')}</div>` : `<div class="t3">${rows.slice(0, 3).map(({ x }) => `<div>${runeImg(x.rune, 'ricon sm')}<span class="cn">${esc(x.rune.name)}</span><b>× ${f1(x.n)}</b></div>`).join('')}</div>`}</div>
    </div>
    <details class="est-more"><summary>Détail</summary>
      <div class="charts">
        <div><div class="ct">Sessions terminées en moins de … poses</div>${cdfSvg(r.detail.map(d => d.poses), { fmt: f1 })}</div>
        <div><div class="ct">Sessions coûtant moins de … kamas</div>${costs.some(c => c > 0) ? cdfSvg(costs, { fmt: kShort }) : '<p class="muted small">prix manquants</p>'}</div>
        <div><div class="ct">Coût par rune</div>${cost ? runeBarsSvg(rows) : '<p class="muted small">prix manquants</p>'}</div>
      </div>${detail}</details>
    <div class="row small baseline">${b ? `<span>Figée ${b.after ? `après ${b.after} pose${b.after > 1 ? 's' : ''}` : 'au départ'} : ${f1(b.poses)} poses · ${b.cost ? kShort(b.cost) : 'coût ?'}</span><button id="freeze" class="link small">refiger</button>` : `<span class="muted">Fige l'estimation pour la comparer au résultat dans le bilan (sinon, figée automatiquement à la première pose).</span><button id="freeze" class="secondary small">Figer l'estimation</button>`}</div>`;
  $('#freeze').onclick = () => { if (S.baseline && !confirm('Remplacer l\'estimation figée ?')) return; freezeBaseline(); paintEstimate(); };
}

function onLineEdit(e) {
  const i = +e.target.closest('.line').dataset.i; const l = S.item.lines[i];
  const v = e.target.value === '' ? null : Number(e.target.value);
  if (e.target.dataset.field === 'value') { l.value = v ?? 0; unreadStats.delete(l.stat); }
  else { if (v == null) delete S.target[l.stat]; else S.target[l.stat] = v; }
  save(); renderItem();
}
$('#exo-select').onchange = e => {
  if (!e.target.value) return;
  S.item.lines.push({ stat: e.target.value, value: 0, min: null, max: null });
  S.target[e.target.value] = S.target[e.target.value] ?? 1;
  save(); renderAll();
};
for (const k of ['sc', 'sn', 'ec']) document.querySelector('#show-' + k).onclick = () => { S.settings.show[k] = !S.settings.show[k]; save(); renderItem(); };
document.querySelector('#show-runes').onclick = () => { S.settings.show.runes = S.settings.show.runes === false; save(); renderItem(); };
$('#auto-target').onclick = () => { S.target = { ...S.target, ...autoTarget(S.item.lines) }; save(); renderItem(); };

// ---- Vue FM : conseil ---------------------------------------------------------
$('#top-select').onchange = e => { S.settings.top = Number(e.target.value); save(); };
$('#search-select').onchange = e => { S.settings.search = e.target.value; save(); };
$('#samples-select').onchange = e => { S.settings.samples = Number(e.target.value); save(); };
$('#advise').onclick = () => computeAdvice();

function computeAdvice(scroll = false) {
  const out = $('#advice-out');
  if (!Object.keys(S.target).length) { out.innerHTML = '<p class="muted small">Renseigne au moins une cible dans la vue Objet.</p>'; return; }
  const adv = S.settings.search === 'advanced';
  const t0 = Date.now();
  out.innerHTML = `<p class="muted small"><span class="spin"></span> Calcul${adv ? ' (recherche avancée)' : ''}… <span id="calc-time"></span></p>`;
  const timer = setInterval(() => { const el = $('#calc-time'); if (el) el.textContent = Math.round((Date.now() - t0) / 1000) + ' s'; else clearInterval(timer); }, 1000);
  const key = JSON.stringify([S.item.lines, S.target, S.reliquat]); computeAdvice.key = key;
  const fn = adv ? 'nextBestMoves2' : 'nextBestMoves';
  solve(fn, state(), S.target, { samples: Math.round(S.settings.samples / (adv ? 8 : 3)), top: S.settings.top, seed: Date.now() & 0xffff }).then(r => {
    clearInterval(timer);
    if (computeAdvice.key !== key || S.settings.view !== 'fm') return;
    lastAdvice = r;
    if (!lastAdvice.reached && lastAdvice.moves.length) pending = lastAdvice.moves[0].rune;
    renderAdvice(); renderPose();
    if (scroll) $('#advice').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }).catch(err => { clearInterval(timer); out.innerHTML = `<p class="warn small">Calcul impossible : ${esc(err.message)}</p>`; });
}

const adviceOpen = new Set();
function renderAdvice() {
  const out = $('#advice-out'); const res = lastAdvice;
  if (!res) { out.innerHTML = '<p class="muted small">Clique « Calculer » pour obtenir le prochain coup.</p>'; return; }
  if (res.reached) { out.innerHTML = '<p class="ok">Cible atteinte sur toutes les lignes.</p>'; return; }
  if (!res.moves.length) { out.innerHTML = '<p class="muted small">Aucune rune posable sur les lignes cibles (plafonds atteints ?).</p>'; return; }
  const hv = res.heavy; const ph0 = hv?.phases?.[0];
  const note = res.exo && ph0 ? `<p class="small"><b class="ok">Objet au jet.</b> Il reste l'exo : chaque tentative passe à ${pct(ph0.p * 100)} % ; en EC, jusqu'à ${res.moves[0].rune.weight} de poids tombent, on remonte (≈ ${f1(ph0.recover)} poses) puis on retente. En moyenne ${Math.round(ph0.cycles.mean)} cycles, une fois sur deux moins de ${ph0.cycles.median}, une fois sur dix plus de ${ph0.cycles.p90}.</p>`
    : hv && hv.total < 900 ? `<p class="muted small">Les scores comprennent la phase exo lourd à la fin (≈ ${Math.round(hv.total)} poses : ${hv.phases.map(x => `${esc(x.rune.name)} ≈ ${Math.round(x.cycles?.mean ?? 0)} tentatives`).join(', ')}).</p>` : '';
  
  out.innerHTML = note + `<div class="advice">${res.moves.map((m, k) => {
    const on = pending && pending.stat === m.rune.stat && pending.tier === m.rune.tier;
    const tie = k > 0 && Math.abs(m.score - res.moves[0].score) < 0.3;
    const open = adviceOpen.has(m.rune.id);
    const sub = `${statImg(m.rune.stat, 'sicon sm')}+${m.rune.bonus} ${esc(labelOf(m.rune.stat))}${m.next ? ` · <span class="muted">puis ${runeImg(m.next, 'ricon sm')}${esc(m.next.name)}</span>` : ''}${m.purpose === 'nettoyage' ? ` · <span class="warn">nettoyage de l'over ${esc(labelOf(m.cleans))}</span>` : m.purpose === 'descente' ? ` · <span class="warn">pour faire baisser ${esc(labelOf(m.cleans))}</span>` : m.cleans ? ` · <span class="warn">retire aussi l'over ${esc(labelOf(m.cleans))}</span>` : m.purpose === 'exo' ? ' · <span class="warn">exo, en dernier</span>' : ''}${tie ? ' · <span class="muted">≈ équivalent au meilleur</span>' : ''}${m.departage ? ` · <span class="muted" title="L'écart de poses avec ${esc(RUNE_BY_ID[m.departage.devant]?.name ?? '')} est dans le bruit des simulations : à égalité, la rune qui a le plus de chances de passer passe devant.">à égalité aux aléas près, plus de chances de passer</span>` : ''}`;
    return `<div class="move ${on ? 'on' : ''} ${open ? 'open' : ''}" data-rune="${m.rune.id}">
      <div class="c"><strong title="${esc(m.rune.name)}">${runeImg(m.rune)}<span class="nm">${esc(m.rune.name)}</span>${m.purpose || m.next ? '<span class="dot warn" title="voir le détail">●</span>' : ''}</strong><div class="bar">${bar(m.odds)}</div><span class="poses" title="Poses restantes, celle-ci comprise (moyenne des sessions simulées)"><b>${f1(m.score)}</b></span><span class="dcol">${diffText(m.odds)}</span><button class="more" data-more="${m.rune.id}" title="${open ? 'Réduire' : 'Détail'}">${open ? '−' : '+'}</button></div>
      ${open ? `<div class="sub">${sub}</div><div class="meta">${oddsText(m.odds)}<span class="risk" title="Probabilité que cette pose fasse tomber une ligne cible sous sa cible">abîme une cible <b>${Math.round(m.pHurtTarget * 100)} %</b></span><span class="muted">≈ ${f1(m.score)} poses restantes, celle-ci comprise</span></div>` : ''}
    </div>`;
  }).join('')}</div>`;
  $$('.move .more').forEach(b => b.onclick = e => { e.stopPropagation(); const id = b.dataset.more; adviceOpen.has(id) ? adviceOpen.delete(id) : adviceOpen.add(id); renderAdvice(); });
  $$('.move').forEach(d => d.onclick = () => { const [stat, tier] = d.dataset.rune.split(':'); pending = runeOf(stat, +tier); renderAdvice(); renderPose(); });
}

// ---- Vue FM : pose ------------------------------------------------------------
function renderPose() {
  if (!pending) pending = runeOf(S.item.lines[0]?.stat ?? 'vita', 0);
  const o = FM.odds(S.item, pending);
  const drop = `<button id="rune-drop" class="rune-drop${pickerOpen ? ' on' : ''}" title="Choisir une autre rune">▾</button>`;
  $('#pose-rune').innerHTML = o.blocked
    ? `<strong>${runeImg(pending)}${esc(pending.name)}</strong>${drop} <span class="muted small">pose impossible (${o.blocked === 'line-cap' ? 'plafond de la ligne' : 'plafond over+exo'})</span>`
    : `<strong>${runeImg(pending)}${esc(pending.name)}</strong>${drop} <span class="muted small">${statImg(pending.stat, 'sicon sm')}+${pending.bonus} ${esc(labelOf(pending.stat))} · poids ${pending.weight}${o.half ? ' (÷2)' : ''}</span><br>${oddsText(o)} ${diffText(o)}`;
  $$('#pose button[data-outcome]').forEach(b => b.disabled = !!o.blocked);
  $('#simulate').disabled = !!o.blocked;
  $('#rune-drop').onclick = e => { e.stopPropagation(); pickerOpen = !pickerOpen; renderPose(); if (pickerOpen) { const q = $('#rune-q'); q.value = ''; pickerActive = 0; renderRuneList(); q.focus(); } };
  $('#rune-picker').classList.toggle('hidden', !pickerOpen);
}

// Sélecteur de rune : d'abord les runes des lignes de l'objet, puis les exos ; filtre au clavier.
let pickerOpen = false, pickerActive = 0, pickerItems = [];
const normTxt = x => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function renderRuneList() {
  const q = normTxt($('#rune-q').value.trim()).split(/\s+/).filter(Boolean);
  const present = S.item.lines.map(l => l.stat);
  const ordre = [...present, ...STATS.map(s => s.key).filter(k => !present.includes(k))];
  pickerItems = ordre.flatMap(k => RUNES.filter(r => r.stat === k).map(r => ({ r, exo: !present.includes(k) })))
    .filter(({ r }) => { const t = normTxt(`${r.name} ${labelOf(r.stat)}`); return q.every(w => t.includes(w)); });
  pickerActive = Math.min(pickerActive, Math.max(0, pickerItems.length - 1));
  let exoVu = false;
  $('#rune-list').innerHTML = pickerItems.slice(0, 80).map(({ r, exo }, i) => {
    const sep = exo && !exoVu ? (exoVu = true, '<li class="sep muted small">Exo</li>') : '';
    const o = FM.odds(S.item, r);
    return `${sep}<li data-i="${i}" class="${i === pickerActive ? 'on' : ''}${r.id === pending.id ? ' cur' : ''}">${runeImg(r, 'ricon sm')}<span class="grow">${esc(r.name)} <span class="muted small">+${r.bonus} ${esc(labelOf(r.stat))}</span></span><span class="small ${o.blocked ? 'muted' : ''}">${o.blocked ? 'bloquée' : `SC ${pct(o.sc)} %`}</span></li>`;
  }).join('') || '<li class="muted small">Aucune rune</li>';
  $$('#rune-list li[data-i]').forEach(li => li.onmousedown = e => { e.preventDefault(); choisirRune(pickerItems[+li.dataset.i].r); });
  $('#rune-list li.on')?.scrollIntoView({ block: 'nearest' });
}
function choisirRune(r) { pending = r; pickerOpen = false; renderAdvice(); renderPose(); }
$('#rune-q').oninput = () => { pickerActive = 0; renderRuneList(); };
$('#rune-q').onkeydown = e => {
  if (e.key === 'ArrowDown') { pickerActive = Math.min(pickerItems.length - 1, pickerActive + 1); renderRuneList(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { pickerActive = Math.max(0, pickerActive - 1); renderRuneList(); e.preventDefault(); }
  else if (e.key === 'Enter') { const x = pickerItems[pickerActive]; if (x) choisirRune(x.r); e.preventDefault(); }
  else if (e.key === 'Escape') { pickerOpen = false; renderPose(); }
};
document.addEventListener('mousedown', e => { if (pickerOpen && !e.target.closest('#rune-picker, #rune-drop')) { pickerOpen = false; renderPose(); } });

$$('#pose button[data-outcome]').forEach(b => b.onclick = () => startOutcome(b.dataset.outcome));
$('#simulate').onclick = () => {
  const r = FM.applyMove(state(), pending, Math.random);
  if (!r.outcome) return;
  commit({ rune: pending, outcome: r.outcome, lines: r.item.lines, reliquat: r.reliquat, changes: r.changes, simulated: true });
};

function startOutcome(outcome) {
  const rune = pending;
  if (outcome === 'SC') {
    const r = FM.applyMove(state(), rune, Math.random, 'SC');
    commit({ rune, outcome, lines: r.item.lines, reliquat: r.reliquat, changes: r.changes });
    return;
  }
  const lines = S.item.lines.map(l => ({ ...l }));
  let t = lines.findIndex(l => l.stat === rune.stat);
  const before = t >= 0 ? S.item.lines[t] : null;
  const half = before && before.value + rune.bonus < 0;
  if (outcome === 'SN') {
    if (t < 0) { lines.push({ stat: rune.stat, value: 0, min: null, max: null }); t = lines.length - 1; }
    lines[t].value += rune.bonus;
  }
  // « avant » = reliquat à la fin de la pose précédente ; « après » = ce que le jeu affiche maintenant
  // (si la barre du haut a déjà été mise à jour, elle sert de valeur « après »)
  lossDraft = { rune, outcome, lines, t, lossWeight: rune.weight * (half ? 0.5 : 1), before: S.reliquatBefore, newReliquat: S.reliquat, deltas: {} };
  renderLossPanel();
  $('#loss-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderLossPanel() {
  const d = lossDraft; const p = $('#loss-panel');
  if (!d) { p.classList.add('hidden'); p.innerHTML = ''; return; }
  p.classList.remove('hidden');
  const lost = Object.entries(d.deltas).reduce((a, [stat, n]) => a + n * STAT_BY_KEY[stat].weight, 0);
  const expected = d.lossWeight + (d.newReliquat - d.before);
  const gap = w1(lost - expected);
  const rows = d.lines.map((l, i) => {
    const n = d.deltas[l.stat] || 0;
    const floor = l.min != null && l.min < 0 ? l.min : 0;
    // la ligne posée peut aussi perdre (observé en jeu : ra vi en SN donnant +48 au lieu de +50)
    const locked = false;
    if (l.value - n <= floor && !n) return '';   // rien à retirer
    const canDrop = l.value - n > floor;
    const big = STAT_BY_KEY[l.stat].weight <= 0.25;
    return `<div class="lrow ${locked ? 'locked' : ''}"><span class="name">${statImg(l.stat, 'sicon sm')}${esc(labelOf(l.stat))}${i === d.t ? ' <span class="muted small">(posée)</span>' : ''}</span>
      <span class="val">${l.value - n}</span>
      <button data-minus="${l.stat}" data-n="1" ${canDrop ? '' : 'disabled'}>−1</button>${big ? `<button data-minus="${l.stat}" data-n="5" ${canDrop ? '' : 'disabled'}>−5</button>` : ''}<button data-minus="${l.stat}" data-n="-1" ${n > 0 ? '' : 'disabled'}>+</button>
      <span class="delta">${n ? `−${n} <span class="muted">(${w1(n * STAT_BY_KEY[l.stat].weight)})</span>` : ''}</span></div>`;
  }).join('');
  const relDelta = w1(d.newReliquat - d.before);
  p.innerHTML = `<div class="loss">
    <div class="row"><strong>${esc(d.rune.name)} en ${d.outcome}</strong><span class="muted small">poids à perdre ${d.lossWeight}</span><div class="spacer"></div>
      <span class="relgrp"><span class="small">reliquat</span><input id="loss-before" class="num small" type="number" step="1" min="0" value="${d.before}" title="reliquat avant la pose"><span class="muted">→</span><button class="step small" id="lr-minus">−1</button><input id="loss-reliquat" class="num" type="number" step="1" min="0" value="${d.newReliquat}" title="reliquat après la pose (affiché par le jeu)"><button class="step small" id="lr-plus">+1</button></span></div>
    <div>${rows}</div>
    <div class="check ${Math.abs(gap) < 0.01 ? 'ok' : 'warn'}">Retiré ${w1(lost)} · attendu ${w1(expected)} (rune ${d.lossWeight} ${relDelta >= 0 ? '+' : '−'} ${Math.abs(relDelta)} reliquat)${Math.abs(gap) < 0.01 ? ' · cohérent' : ` · écart ${gap > 0 ? '+' : ''}${gap}`}</div>
    <div class="row"><div class="spacer"></div><button id="loss-cancel" class="secondary small">Annuler</button><button id="loss-ok" class="primary">Valider</button></div>
  </div>`;
  const setRel = v => { d.newReliquat = Math.max(0, w1(Number(v) || 0)); renderLossPanel(); };
  $('#loss-reliquat').onchange = e => setRel(e.target.value);
  $('#loss-before').onchange = e => { d.before = Math.max(0, w1(Number(e.target.value) || 0)); renderLossPanel(); };
  $('#lr-minus').onclick = () => setRel(d.newReliquat - 1);
  $('#lr-plus').onclick = () => setRel(d.newReliquat + 1);
  $$('#loss-panel button[data-minus]').forEach(b => b.onclick = () => bump(b.dataset.minus, +b.dataset.n));
  $('#loss-cancel').onclick = () => { lossDraft = null; poseSource = 'manuel'; ocrEntry = null; renderLossPanel(); };
  $('#loss-ok').onclick = () => {
    const changes = [];
    if (d.outcome === 'SN') changes.push({ stat: d.rune.stat, delta: d.rune.bonus });
    const lines = d.lines.map(l => ({ ...l, value: l.value - (d.deltas[l.stat] || 0) }));
    for (const [stat, n] of Object.entries(d.deltas)) if (n) changes.push({ stat, delta: -n });
    lossDraft = null;
    commit({ rune: d.rune, outcome: d.outcome, lines, reliquat: d.newReliquat, changes, gap, reliquatBefore: d.before });
  };
}
function bump(stat, n) {
  const d = lossDraft; const l = d.lines.find(x => x.stat === stat);
  const floor = l.min != null && l.min < 0 ? l.min : 0;
  d.deltas[stat] = Math.max(0, Math.min(l.value - floor, (d.deltas[stat] || 0) + n));
  renderLossPanel();
}

function journal() { try { return JSON.parse(localStorage.getItem(JKEY)) || []; } catch { return []; } }
function journalAdd(entry) { try { const j = journal(); j.push(entry); localStorage.setItem(JKEY, JSON.stringify(j)); } catch {} }
const XKEY = 'fm-dofus:journal-exported';
function journalPop(e) { if (e.simulated) return; try { const j = journal(); const last = j.at(-1); if (last && last.rune.stat === e.rune.stat && last.rune.tier === e.rune.tier && last.outcome === e.outcome) { j.pop(); localStorage.setItem(JKEY, JSON.stringify(j)); } } catch {} }
function journalExport() {
  const j = journal();
  const blob = new Blob([JSON.stringify({ version: 2, exported: new Date().toISOString(), tool: VERSION, model: S.settings.model || 'dofocus', entries: j, sessions: sessions(), prices: prices() }, null, 1)], { type: 'application/json' });
  try { localStorage.setItem(XKEY, String(j.length)); } catch {}
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `fm-dofus-journal-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  renderHistory();
}

function commit({ rune, outcome, lines, reliquat, changes, simulated = false, gap = 0, reliquatBefore = S.reliquat }) {
  const hid = Date.now();
  if (outcome === 'SC' && !simulated && Math.abs(reliquat - reliquatBefore) > 0.01) outcome = 'SN'; // un SC ne prend pas de reliquat
  const keepStatus = $('#screen-status')?.textContent;
  if (!S.baseline && Object.keys(S.target).length && !Search.targetReached(S.item, S.target)) freezeBaseline(null);
  if (!simulated) {
    // Tout ce qu'il faut pour réanalyser la pose plus tard : état avant/après, rune, chances et facteurs
    // du modèle (régime, difficulté, qualité, position, ratio, over…), modèle et paramètres actifs, cible,
    // provenance (saisie, lecture d'écran), version de l'outil.
    let odds = null; try { const o = FM.odds(S.item, rune); odds = o.blocked ? { blocked: o.blocked, limit: o.limit } : { ...o }; } catch {}
    journalAdd({ v: 2, t: new Date().toISOString(), hid, version: VERSION, session: S.sessionId ?? null,
                 item: { id: S.template?.id ?? null, name: S.template?.name, level: S.item.level, type: S.template?.type },
                 model: { key: S.settings.model || 'dofocus', P: { ...FM.P } }, target: { ...S.target },
                 before: { lines: S.item.lines.map(l => ({ ...l })), reliquat: reliquatBefore },
                 rune: { id: rune.id, stat: rune.stat, tier: rune.tier, name: rune.name, bonus: rune.bonus, weight: rune.weight },
                 odds, outcome, changes, after: { lines: lines.map(l => ({ stat: l.stat, value: l.value })), reliquat }, gap,
                 source: poseSource, ocr: ocrEntry });
    poseSource = 'manuel'; ocrEntry = null;
  }
  S.history.push({ id: hid, rune: { stat: rune.stat, tier: rune.tier, name: rune.name }, outcome, changes,
                   reliquatDelta: w1(reliquat - reliquatBefore), simulated, gap,
                   before: { lines: S.item.lines.map(l => ({ ...l })), reliquat: reliquatBefore, reliquatBefore: S.reliquatBefore } });
  S.item.lines = lines.filter(l => l.min != null || l.value > 0);
  S.reliquat = reliquat;
  S.reliquatBefore = reliquat;
  save(); renderLossPanel(); renderAll();
  if (keepStatus) screenStatus(keepStatus);
  if (S.settings.view === 'fm' && Object.keys(S.target).length) computeAdvice(true);
  else if (S.settings.view === 'fm') $('#advice').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---- Lecture d'écran (capture de fenêtre + OCR) --------------------------------
let lastEntryKey = null;
const screenStatus = msg => { const el = $('#screen-status'); if (el) el.textContent = msg; setStatus(msg ? msg.replace(/\..*$/, '') : ''); };
const screenOut = () => $(S.settings.view === 'fm' ? '#screen-out' : '#screen-out-item');
function renderCaptureButtons() {
  const on = Cap.isCapturing();
  const b = $('#cap-start'); if (b) { b.textContent = on ? 'Capture en cours · arrêter' : 'Capturer le jeu'; b.classList.toggle('on', on); b.classList.toggle('hidden', !Cap.isSupported()); }
  for (const id of ['#cap-pose', '#cap-table-item']) { const b = $(id); if (b) b.classList.toggle('hidden', !on); }
  if (!Cap.isSupported()) screenStatus('Lecture de l\'écran non disponible dans ce navigateur (Chrome ou Edge conseillés).');
}
async function toggleCapture() {
  if (Cap.isCapturing()) { Cap.stopCapture(); renderCaptureButtons(); screenStatus(''); return; }
  try {
    const { width, height } = await Cap.startCapture(() => { renderCaptureButtons(); screenStatus('Capture terminée.'); });
    screenStatus(`Fenêtre capturée (${width}×${height}). Ouvre la fenêtre de forgemagie avec l'historique visible.`);
  } catch (e) { screenStatus('Capture refusée : ' + e.message); }
  renderCaptureButtons();
}
document.querySelector('#cap-start').onclick = toggleCapture;
document.querySelector('#cap-table-item').onclick = () => readAndRender('table');
const progress = m => { if (m?.status === 'loading tesseract core' || m?.status?.includes('loading language')) screenStatus(`Chargement de l'OCR… ${Math.round((m.progress || 0) * 100)} %`); };

let reading = false;
async function readAndRender(kind) {
  if (reading) return;                       // un clic de plus pendant la lecture ne relance rien
  reading = true;
  const btns = ['#cap-pose', '#cap-table-item'].map(id => $(id)).filter(Boolean);
  for (const b of btns) { b.disabled = true; b.classList.add('busy'); }
  const out = screenOut();
  out.innerHTML = '<p class="muted small"><span class="spin"></span> Lecture de l\'écran…</p>';
  let r;
  try { r = await Cap.readGame(progress); }
  catch (e) { out.innerHTML = `<p class="warn small">Lecture impossible : ${esc(e.message)}</p>`; return; }
  finally { reading = false; for (const b of btns) { b.disabled = false; b.classList.remove('busy'); } }
  screenStatus('');
  if (r.error) { out.innerHTML = `<p class="warn small">${esc(r.error)}</p>`; return; }
  if (kind === 'table') renderTableRead(r); else renderPoseRead(r);
}
document.querySelector('#cap-pose').onclick = () => readAndRender('pose');

// Lecture du tableau : propose les valeurs lues, ligne par ligne, puis les applique.
function renderTableRead(r) {
  const out = screenOut();
  const rows = [], used = new Set();
  for (const l of S.item.lines) {
    const cands = r.table.map((t, i) => ({ t, i })).filter(({ t, i }) => !used.has(i) && t.stat === l.stat && (t.min == null || l.min == null || (t.min === l.min && t.max === l.max)));
    const pick = cands[0];
    if (pick) used.add(pick.i);
    rows.push({ stat: l.stat, old: l.value, nu: pick ? pick.t.value : null });
  }
  const unknown = r.table.filter((t, i) => !used.has(i));
  const changes = rows.filter(x => x.nu != null && x.nu !== x.old);
  const unread = rows.filter(x => x.nu == null);
  // application directe ; « annuler » remet les valeurs précédentes
  for (const x of rows) if (x.nu != null) S.item.lines.find(l => l.stat === x.stat).value = x.nu;
  if (r.reliquat != null) { S.reliquat = r.reliquat; S.reliquatBefore = r.reliquat; }
  // lignes non lues : champ « actuel » mis en évidence jusqu'à une saisie manuelle
  unreadStats = new Set(unread.map(x => x.stat));
  save(); renderAll();
  screenOut().innerHTML = r.tableUnparsed?.length && unread.length ? `<p class="muted small">Texte non reconnu : ${r.tableUnparsed.map(t => `« ${esc(t)} »`).join(' · ')}</p>` : '';
}
let unreadStats = new Set();

// Lecture de la dernière pose : déduit la rune, le résultat et les pertes, puis ouvre le panneau de vérification.
function renderPoseRead(r) {
  const out = screenOut();
  const entry = r.history.at(-1);
  if (!entry) { out.innerHTML = '<p class="warn small">Aucune entrée d\'historique lue. L\'historique (colonne de gauche) est-il visible ?</p>'; return; }
  const key = JSON.stringify(entry) + '|' + r.reliquat;
  const dup = key === lastEntryKey;
  // rune posée : la ligne positive dont le bonus correspond à une rune ; sinon la rune en attente
  let rune = pending;
  for (const it of entry) if (it.delta > 0) { const cand = RUNES.find(x => x.stat === it.stat && x.bonus === it.delta); if (cand) { rune = cand; break; } }
  const info = interpretEntry(entry, rune);
  // un SC ne touche pas au reliquat : si le reliquat lu a bougé, la ligne « ± reliquat » a échappé à la lecture
  if (info.outcome === 'SC' && r.reliquat != null && Math.abs(r.reliquat - S.reliquat) > 0.01) info.outcome = 'SN';
  const txt = entry.map(it => it.reliquat ? (it.reliquat > 0 ? '+ reliquat' : '− reliquat') : `${it.delta > 0 ? '+' : ''}${it.delta} ${esc(labelOf(it.stat))}`).join(', ');
  const apply = () => {
    lastEntryKey = key; out.innerHTML = '';
    poseSource = 'ocr-vérifié'; ocrEntry = { entry, reliquat: r.reliquat ?? null, raw: r.historyRaw?.at(-1)?.text ?? null };
    pending = rune; renderPose();
    if (info.outcome === 'SC') {
      poseSource = 'ocr';
      const res = FM.applyMove(state(), rune, Math.random, 'SC');
      commit({ rune, outcome: 'SC', lines: res.item.lines, reliquat: r.reliquat ?? S.reliquat, changes: res.changes });
      return true;
    }
    startOutcome(info.outcome);
    const d = lossDraft;
    for (const [stat, delta] of Object.entries(info.deltas)) {
      const l = d.lines.find(x => x.stat === stat);
      if (!l) continue;
      if (stat === rune.stat && info.outcome === 'SN') { if (delta < rune.bonus) d.deltas[stat] = rune.bonus - delta; continue; } // +48 au lieu de +50
      if (delta < 0) d.deltas[stat] = -delta;
    }
    if (r.reliquat != null) d.newReliquat = r.reliquat;
    renderLossPanel();
    // cohérent (poids perdu = rune + variation de reliquat) : on valide sans attendre
    const lost = Object.entries(d.deltas).reduce((a, [stat, n]) => a + n * STAT_BY_KEY[stat].weight, 0);
    const expected = d.lossWeight + (d.newReliquat - d.before);
    if (r.reliquat != null && Math.abs(lost - expected) < 0.01) { poseSource = 'ocr'; $('#loss-ok').click(); return true; }
    return false;
  };
  if (!dup && r.reliquat != null) {
    const ok = apply();
    screenStatus(''); // la pose lue apparaît dans l'historique (ou dans le panneau de pertes à vérifier)
    return;
  }
  out.innerHTML = `<div class="loss"><div class="row"><strong>Dernière pose lue : ${runeImg(rune)}${esc(rune.name)} en ${info.outcome}</strong></div>
    <div class="small">${txt}${r.reliquat != null ? ` · reliquat affiché ${r.reliquat}` : ' · <span class="warn">reliquat non lu</span>'}</div>
    ${dup ? '<p class="warn small">Identique à la dernière pose appliquée : as-tu bien posé une nouvelle rune ?</p>' : ''}
    <div class="row"><button id="read-save" class="link small" title="Télécharge l'image lue pour corriger l'OCR">lecture fausse ? enregistrer la capture</button><div class="spacer"></div><button id="read-cancel" class="secondary small">Ignorer</button><button id="read-apply" class="primary">Vérifier et appliquer</button></div></div>`;
  $('#read-cancel').onclick = () => { out.innerHTML = ''; };
  $('#read-save').onclick = () => { if (!Cap.downloadLastFrame(`fm-dofus-capture-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`)) setStatus('Pas de capture en mémoire.'); };
  $('#read-apply').onclick = apply;
}

// ---- Prix des runes (réglages) ------------------------------------------------
const PKEY = 'fm-dofus:prices';
function prices() { try { return JSON.parse(localStorage.getItem(PKEY)) || {}; } catch { return {}; } }
function setPrice(id, v) { const p = prices(); if (v > 0) p[id] = v; else delete p[id]; try { localStorage.setItem(PKEY, JSON.stringify(p)); } catch {} }
const kamas = n => Math.round(n).toLocaleString('fr-FR') + ' kamas';
const kShort = n => n >= 1e6 ? (n / 1e6).toFixed(2).replace('.', ',').replace(/,?0+$/, '') + ' M' : n >= 1e5 ? Math.round(n / 1e3) + ' k' : n >= 1e4 ? (n / 1e3).toFixed(1).replace('.', ',').replace(/,0$/, '') + ' k' : Math.round(n).toLocaleString('fr-FR');
function renderSettings() {
  const sel = $('#model-select');
  sel.innerHTML = Object.entries(MODELS).map(([k, m]) => `<option value="${k}" ${k === (S.settings.model || 'dofocus') ? 'selected' : ''}>${esc(m.label)}</option>`).join('');
  sel.onchange = e => { S.settings.model = e.target.value; S.settings.modelChosen = true; applyModel(S.settings.model); estimateKey = null; lastAdvice = null; save(); };
  const p = prices(); const q = ($('#prices-filter').value || '').trim().toLowerCase();
  const norm = x => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const list = STATS.filter(st => !q || norm(st.label).includes(norm(q)) || st.tiers.some(([n]) => norm(n).includes(norm(q))));
  $('#prices-list').innerHTML = list.map(st => `<div class="prow"><span class="name">${statImg(st.key, 'sicon sm')}${esc(st.label)}</span>${st.tiers.map(([name], k) => {
    const r = runeOf(st.key, k);
    const lower = k > 0 ? runeOf(st.key, k - 1) : null;
    return `<label class="pcell">${runeImg(r, 'ricon sm')}<span class="cn">${esc(name)}</span><input type="number" class="num small" min="0" step="1" inputmode="numeric" data-id="${r.id}" value="${p[r.id] ?? ''}" placeholder="—">${lower ? `<button type="button" class="x3" data-x3="${r.id}" data-from="${lower.id}" title="Craft : 3 × ${esc(lower.name)}">×3</button>` : ''}</label>`;
  }).join('')}</div>`).join('') || '<p class="muted small">Aucune rune ne correspond.</p>';
  $$('#prices-list input').forEach(i => i.onchange = e => setPrice(e.target.dataset.id, Number(e.target.value) || 0));
  $$('#prices-list button[data-x3]').forEach(b => b.onclick = () => {
    const from = prices()[b.dataset.from]; if (!(from > 0)) { setStatus('Renseigne d\'abord le prix de la rune inférieure.'); setTimeout(() => setStatus(''), 2500); return; }
    setPrice(b.dataset.x3, from * 3); renderSettings();
  });
}
document.querySelector('#prices-filter').oninput = () => renderSettings();
document.querySelector('#prices-export').onclick = () => {
  const blob = new Blob([JSON.stringify({ version: 1, prices: prices() }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'fm-dofus-prix.json'; document.body.appendChild(a); a.click(); a.remove();
};
document.querySelector('#prices-import').onclick = () => document.querySelector('#prices-file').click();
document.querySelector('#prices-file').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try { const j = JSON.parse(await f.text()); const p = j.prices || j; const cur = prices(); for (const [id, v] of Object.entries(p)) if (Number(v) > 0) cur[id] = Number(v); localStorage.setItem(PKEY, JSON.stringify(cur)); renderSettings(); }
  catch { alert('Fichier de prix illisible.'); }
  e.target.value = '';
};

// ---- Bilan --------------------------------------------------------------------
function bilanData() {
  const h = S.history, p = prices();
  const byRune = new Map(); const n = { SC: 0, SN: 0, EC: 0 };
  let cost = 0, missing = new Set(), lostWeight = 0, simulated = 0;
  let sumObs = 0, sumMean = 0, sumVar = 0, expSC = 0, expEC = 0, rated = 0;
  for (const e of h) {
    const r = runeOf(e.rune.stat, e.rune.tier); const id = r?.id ?? `${e.rune.stat}:${e.rune.tier}`;
    const b = byRune.get(id) || { rune: r, name: e.rune.name, n: 0, SC: 0, SN: 0, EC: 0, cost: 0, unit: p[id] };
    b.n++; b[e.outcome]++; n[e.outcome]++;
    if (p[id] > 0) { b.cost += p[id]; cost += p[id]; } else missing.add(e.rune.name);
    byRune.set(id, b);
    if (e.simulated) simulated++;
    for (const c of e.changes) if (c.delta < 0) lostWeight += -c.delta * STAT_BY_KEY[c.stat].weight;
    // chance : résultat observé (SC +1, SN 0, EC −1) contre l'espérance au moment de la pose
    try {
      const o = FM.odds({ level: S.item.level, lines: e.before.lines }, r);
      if (!o.blocked) {
        const sc = o.sc / 100, ec = o.ec / 100, mean = sc - ec, v = e.outcome === 'SC' ? 1 : e.outcome === 'EC' ? -1 : 0;
        sumObs += v; sumMean += mean; sumVar += (sc + ec) - mean * mean; expSC += sc; expEC += ec; rated++;
      }
    } catch {}
  }
  const z = sumVar > 0 ? (sumObs - sumMean) / Math.sqrt(sumVar) : 0;
  let expectedAtStart = null;
  try { if (h.length && Object.keys(S.target).length) expectedAtStart = Search.estimateRemaining({ item: { level: S.item.level, lines: h[0].before.lines }, reliquat: h[0].before.reliquat }, S.target); } catch {}
  const ms = h.length > 1 ? h.at(-1).id - h[0].id : 0;
  return { h, n, byRune: [...byRune.values()].sort((a, b) => b.cost - a.cost || b.n - a.n), cost, missing: [...missing], lostWeight: w1(lostWeight), simulated,
           luck: { z, expSC, expEC, rated }, expectedAtStart, ms, baseline: S.baseline || null };
}
// ---- Historique des sessions --------------------------------------------------
const SKEY = 'fm-dofus:sessions';
function sessions() { try { return JSON.parse(localStorage.getItem(SKEY)) || []; } catch { return []; } }
function saveSessions(list) { try { localStorage.setItem(SKEY, JSON.stringify(list)); } catch {} }
function archiveSession() {
  if (!S.item || !S.history.length) return null;
  const d = bilanData(); const list = sessions();
  if (!S.sessionId) S.sessionId = Date.now();
  const snap = { id: S.sessionId, t: new Date().toISOString(), start: new Date(S.history[0].id).toISOString(),
    item: { id: S.template?.id ?? null, name: S.template?.name, level: S.item.level }, target: { ...S.target },
    reached: Object.keys(S.target).length > 0 && Search.targetReached(S.item, S.target),
    lines: S.item.lines.map(l => ({ stat: l.stat, value: l.value })), reliquat: S.reliquat,
    poses: d.h.length, n: d.n, cost: d.cost, missingPrices: d.missing.length, z: w1(d.luck.z), expSC: w1(d.luck.expSC), expEC: w1(d.luck.expEC),
    lostWeight: d.lostWeight, ms: d.ms, simulated: d.simulated, expectedAtStart: d.expectedAtStart == null ? null : w1(d.expectedAtStart),
    baseline: d.baseline ? { t: d.baseline.t, after: d.baseline.after, poses: d.baseline.poses, median: d.baseline.median, p90: d.baseline.p90, cost: d.baseline.cost, costP90: d.baseline.costP90 } : null,
    byRune: d.byRune.map(b => ({ id: b.rune?.id, name: b.name, n: b.n, SC: b.SC, SN: b.SN, EC: b.EC, cost: b.cost, unit: b.unit ?? null })) };
  const i = list.findIndex(x => x.id === snap.id);
  if (i >= 0) list[i] = snap; else list.push(snap);
  S.archivedLen = S.history.length;
  saveSessions(list); save();
  return snap;
}
function renderSessions() {
  const list = sessions().slice().reverse();
  const out = $('#sessions-out');
  if (!list.length) { out.innerHTML = '<p class="muted small">Aucune session archivée. Les sessions sont aussi archivées automatiquement quand tu changes d\'objet ou recommences.</p>'; $('#sessions-stats').textContent = ''; $('#sessions-export').disabled = true; return; }
  $('#sessions-export').disabled = false;
  const tot = list.reduce((a, s) => ({ poses: a.poses + s.poses, cost: a.cost + (s.cost || 0), z: a.z + (s.z || 0) }), { poses: 0, cost: 0, z: 0 });
  // écart systématique réel / estimé (sessions terminées avec estimation figée) : un biais persistant = modèle à revoir
  const cmp = list.filter(s => s.reached && s.baseline?.poses > 0);
  const ratio = cmp.length ? cmp.reduce((a, s) => a + s.poses / s.baseline.poses, 0) / cmp.length : null;
  $('#sessions-stats').innerHTML = `${list.length} session${list.length > 1 ? 's' : ''} · ${tot.poses} poses · ${tot.cost ? kamas(tot.cost) : 'coût inconnu'} · chance moyenne ${tot.z / list.length >= 0 ? '+' : '−'}${Math.abs(tot.z / list.length).toFixed(1).replace('.', ',')} σ${ratio != null ? ` · réel / estimé ×${ratio.toFixed(2).replace('.', ',')} sur ${cmp.length} session${cmp.length > 1 ? 's' : ''} terminée${cmp.length > 1 ? 's' : ''}` : ''}`;
  const date = iso => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  const z = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1).replace('.', ',')} σ`;
  const body = s => {
    const N = s.poses || 1, pc = k => Math.round(s.n[k] / N * 100);
    const est = s.baseline?.poses > 0 ? s.baseline.poses : s.expectedAtStart;
    const bar = (v, max, cls) => `<i class="${cls}" style="width:${Math.min(100, v / max * 100).toFixed(1)}%"></i>`;
    const mx = Math.max(s.poses, est || 0) * 1.05;
    return `<div class="sessbody">
      <div class="sb-grid">
        <div class="sb"><div class="sb-t">Poses</div><div class="sb-v">${s.poses}${est ? ` <span class="muted small">vs ${f1(est)} estimées</span> ${pctDiff(s.poses, est)}` : ''}</div>
          ${est ? `<div class="cmp"><div><span>réel</span><div class="hbar">${bar(s.poses, mx, 'real')}</div></div><div><span>estimé</span><div class="hbar">${bar(est, mx, 'est')}</div></div></div>` : ''}</div>
        <div class="sb"><div class="sb-t">Coût</div><div class="sb-v">${s.cost ? kShort(s.cost) : '—'}${s.cost && s.baseline?.cost ? ` <span class="muted small">vs ${kShort(s.baseline.cost)}</span> ${pctDiff(s.cost, s.baseline.cost)}` : ''}</div>
          ${s.cost && s.baseline?.cost ? `<div class="cmp"><div><span>réel</span><div class="hbar">${bar(s.cost, Math.max(s.cost, s.baseline.cost) * 1.05, 'real')}</div></div><div><span>estimé</span><div class="hbar">${bar(s.baseline.cost, Math.max(s.cost, s.baseline.cost) * 1.05, 'est')}</div></div></div>` : ''}</div>
        <div class="sb"><div class="sb-t">Résultats</div><div class="sb-v"><span class="odds"><b>${pc('SC')} %</b> <i>${pc('SN')} %</i> <s>${pc('EC')} %</s></span></div><div class="bar"><i class="sc" style="width:${pc('SC')}%"></i><i class="sn" style="width:${pc('SN')}%"></i><i class="ec" style="width:${pc('EC')}%"></i></div>
          <div class="muted small">chance ${z(s.z)} · poids détruit ${String(s.lostWeight).replace('.', ',')}${s.ms ? ` · ${Math.round(s.ms / 60e3)} min` : ''}${s.simulated ? ` · <span class="warn">${s.simulated} simulée${s.simulated > 1 ? 's' : ''}</span>` : ''}</div></div>
      </div>
      <div class="sb-lines">${s.lines.filter(l => l.value || s.target[l.stat] != null).map(l => { const t = s.target[l.stat]; const ok = t == null ? null : l.value >= t; return `<span class="sl ${ok === false ? 'bad' : ok ? 'ok' : ''}">${statImg(l.stat, 'sicon sm')}${esc(labelOf(l.stat))} <b>${l.value}</b>${t != null ? `<span class="muted">/${t}</span>` : ''}</span>`; }).join('')}</div>
      <div class="sb-runes">${s.byRune.map(b => { const r = b.id ? RUNES.find(x => x.id === b.id) : null; return `<span class="chip sm">${r ? runeImg(r, 'ricon sm') : ''}<span class="cn">${esc(b.name)}</span><span class="pc mix">× ${b.n}</span><span class="tags"><span class="tag SC">${b.SC}</span><span class="tag SN">${b.SN}</span><span class="tag EC">${b.EC}</span></span></span>`; }).join('')}</div>
      <div class="row"><div class="spacer"></div><button class="link small" data-del-session="${s.id}">supprimer</button></div>
    </div>`;
  };
  out.innerHTML = `<div class="sess-head small muted"><span class="chev"></span><span class="d">Date</span><span class="cn">Objet</span><span class="st">Cible</span><span class="cnt">Poses</span><span class="z">Chance</span><span class="cost">Coût</span></div>` +
    list.map(s => `<details class="sess ${s.id === S.sessionId ? 'cur' : ''}"><summary>
      <span class="chev">▸</span><span class="d">${date(s.t)}</span><span class="cn">${esc(s.item.name || 'objet')}${s.id === S.sessionId ? ' <span class="muted small">(en cours)</span>' : ''}</span>
      <span class="st ${s.reached ? 'ok' : 'muted'}" title="${s.reached ? 'cible atteinte' : 'cible non atteinte'}">${s.reached ? '✓ atteinte' : 'en cours'}</span><span class="cnt">${s.poses}</span>
      <span class="z ${s.z >= 1 ? 'ok' : s.z <= -1 ? 'bad' : 'muted'}">${z(s.z)}</span>
      <span class="cost">${s.cost ? kShort(s.cost) : '<span class="muted">—</span>'}</span></summary>${body(s)}</details>`).join('');
  $$('#sessions-out [data-del-session]').forEach(b => b.onclick = () => { if (confirm('Supprimer cette session de l\'historique ?')) { saveSessions(sessions().filter(x => x.id !== +b.dataset.delSession)); renderSessions(); } });
}
document.querySelector('#session-archive').onclick = () => { if (archiveSession()) { renderSessions(); setStatus('Session archivée.'); setTimeout(() => setStatus(''), 2000); } };
document.querySelector('#sessions-export').onclick = () => {
  const blob = new Blob([JSON.stringify({ version: 1, exported: new Date().toISOString(), sessions: sessions() }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `fm-dofus-sessions-${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(a); a.click(); a.remove();
};

const luckLabel = z => z >= 2 ? 'très chanceux' : z >= 1 ? 'chanceux' : z > -1 ? 'dans la norme' : z > -2 ? 'malchanceux' : 'très malchanceux';
function renderBilan(reached) {
  const d = bilanData(); const out = $('#bilan-out');
  const miss = Object.keys(S.target).length ? Search.missing(S.item, S.target) : [];
  renderSessions();
  $('#session-archive').disabled = !d.h.length;
  $('#bilan-state').innerHTML = reached ? '<span class="ok">✓ cible atteinte</span>' : Object.keys(S.target).length ? `<span class="muted">en cours · ${miss.length} ligne${miss.length > 1 ? 's' : ''} à finir</span>` : '<span class="muted">pas de cible</span>';
  if (!d.h.length) { out.innerHTML = '<p class="muted small">Aucune pose pour l\'instant.</p>'; return; }
  const N = d.h.length, L = d.luck;
  const pc = k => Math.round(d.n[k] / N * 100);
  const dur = d.ms ? (d.ms >= 3600e3 ? `${Math.floor(d.ms / 3600e3)} h ${String(Math.round(d.ms % 3600e3 / 60e3)).padStart(2, '0')}` : `${Math.round(d.ms / 60e3)} min`) : '—';
  const zc = Math.max(-3, Math.min(3, L.z));
  out.innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="v">${N}</div><div class="l">runes posées${d.baseline ? `<br><span class="muted">≈ ${f1(d.baseline.poses)} estimées au départ</span> ${pctDiff(N, d.baseline.poses)}` : d.expectedAtStart != null ? `<br><span class="muted">≈ ${d.expectedAtStart.toFixed(0)} attendues au départ</span>` : ''}</div></div>
      <div class="kpi"><div class="v" title="${d.cost ? kamas(d.cost) : ''}">${d.cost ? kShort(d.cost) : '—'}</div><div class="l">kamas dépensés${d.missing.length ? `<br><span class="warn">${d.missing.length} rune${d.missing.length > 1 ? 's' : ''} sans prix</span>` : d.baseline?.cost && d.cost ? `<br><span class="muted">≈ ${kShort(d.baseline.cost)} estimés au départ</span> ${pctDiff(d.cost, d.baseline.cost)}` : d.cost ? `<br><span class="muted">${kamas(d.cost / N)} par pose</span>` : '<br><span class="muted">renseigne les prix</span>'}</div></div>
      <div class="kpi"><div class="v"><span class="odds"><b>${pc('SC')} %</b> <i>${pc('SN')} %</i> <s>${pc('EC')} %</s></span></div><div class="l">SC · SN · EC<div class="bar"><i class="sc" style="width:${pc('SC')}%"></i><i class="sn" style="width:${pc('SN')}%"></i><i class="ec" style="width:${pc('EC')}%"></i></div></div></div>
      <div class="kpi luck"><div class="v ${L.z >= 1 ? 'ok' : L.z <= -1 ? 'bad' : ''}">${L.z >= 0 ? '+' : '−'}${Math.abs(L.z).toFixed(1).replace('.', ',')} σ</div><div class="l">${luckLabel(L.z)}
        <div class="gauge"><i style="left:${((zc + 3) / 6 * 100).toFixed(1)}%"></i></div>
        <span class="muted">SC ${d.n.SC} obtenu${d.n.SC > 1 ? 's' : ''} pour ${L.expSC.toFixed(1).replace('.', ',')} attendu${L.expSC >= 2 ? 's' : ''} · EC ${d.n.EC} pour ${L.expEC.toFixed(1).replace('.', ',')}</span></div></div>
      <div class="kpi"><div class="v">${String(d.lostWeight).replace('.', ',')}</div><div class="l">poids détruit par les échecs</div></div>
      <div class="kpi"><div class="v">${String(S.reliquat).replace('.', ',')}</div><div class="l">reliquat final</div></div>
      <div class="kpi"><div class="v">${dur}</div><div class="l">durée de la session${d.simulated ? `<br><span class="warn">${d.simulated} pose${d.simulated > 1 ? 's' : ''} simulée${d.simulated > 1 ? 's' : ''}</span>` : ''}</div></div>
    </div>
    <h3>Par rune</h3>
    <div class="rtable">${d.byRune.map(b => `<div class="rrow">${runeImg(b.rune, 'ricon sm')}<span class="cn">${esc(b.name)}</span><span class="cnt">× ${b.n}</span>
      <span class="tags"><span class="tag SC">${b.SC}</span><span class="tag SN">${b.SN}</span><span class="tag EC">${b.EC}</span></span>
      <span class="cost">${b.unit > 0 ? `<span class="muted small">${kShort(b.unit)} ×</span> ${kamas(b.cost)}` : '<span class="warn small">prix ?</span>'}</span></div>`).join('')}</div>
    <p class="muted small">Indice de chance : écart entre les résultats obtenus (SC = +1, SN = 0, EC = −1) et leur espérance d'après le modèle au moment de chaque pose, en écarts-types. Au-delà de ±1 σ, la session sort de la zone habituelle ; ±2 σ est rare (environ 1 session sur 20).</p>`;
}

// ---- Historique ---------------------------------------------------------------
function renderHistory() {
  const h = S.history;
  const n = { SC: 0, SN: 0, EC: 0 }; h.forEach(e => n[e.outcome]++);
  $('#history-stats').textContent = h.length ? `${h.length} · ${n.SC} SC · ${n.SN} SN · ${n.EC} EC` : '';
  const j = journal();
  let exported = 0; try { exported = Number(localStorage.getItem(XKEY)) || 0; } catch {}
  const fresh = Math.max(0, j.length - Math.min(exported, j.length));
  $('#journal-stats').innerHTML = `${j.length} pose${j.length > 1 ? 's' : ''} réelle${j.length > 1 ? 's' : ''} (tous objets)${fresh ? ` · <span class="${fresh >= 30 ? 'warn' : 'muted'}">${fresh} non exportée${fresh > 1 ? 's' : ''}</span>` : ' · <span class="ok">tout exporté</span>'}`;
  $('#journal-export').disabled = !j.length;
  $('#undo').disabled = !h.length;
  const row = (e, i) => {
    const ch = e.changes.map(c => `${c.delta > 0 ? '+' : ''}${c.delta} ${esc(STAT_BY_KEY[c.stat]?.short || c.stat)}`).join(', ');
    const rel = e.reliquatDelta ? ` · reliquat ${e.reliquatDelta > 0 ? '+' : ''}${e.reliquatDelta}` : '';
    return `<li data-i="${i}"><span class="muted small hn">${i + 1}</span><span class="tag ${e.outcome}">${e.outcome}</span>${runeImg(runeOf(e.rune.stat, e.rune.tier), 'ricon sm')}${esc(e.rune.name)}${e.simulated ? ' <span class="muted small">(simulé)</span>' : ''} <span class="muted small">${ch || 'rien ne bouge'}${rel}${e.gap ? ` · écart ${e.gap}` : ''}</span> <button class="hedit-btn" data-edit="${i}" title="Modifier cette pose" aria-label="Modifier cette pose"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.2 2.3a1.4 1.4 0 0 1 2 0l.5.5a1.4 1.4 0 0 1 0 2L6 12.5l-3 .8.8-3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M10 3.5l2.5 2.5" stroke="currentColor" stroke-width="1.4"/></svg></button></li>`;
  };
  const last = h.length - 1;
  $('#history-list').innerHTML = (h.length ? row(h[last], last) : '<li class="muted small">Aucune pose.</li>')
    + (h.length > 1 ? `<li class="hmore"><details ${histOpen ? 'open' : ''}><summary class="link small">${h.length - 1} pose${h.length > 2 ? 's' : ''} précédente${h.length > 2 ? 's' : ''}</summary><ol class="hall">${[...h].slice(0, -1).map((e, i) => row(e, i)).reverse().join('')}</ol></details></li>` : '');
  const det = $('#history-list details'); if (det) det.ontoggle = () => { histOpen = det.open; };
  $$('#history-list [data-edit]').forEach(b => b.onclick = () => openHistEditor(+b.dataset.edit));
}
let histOpen = false;

// Édition d'une pose de l'historique (ou ajout) : rune, résultat, lignes modifiées, reliquat ; puis rejeu
// des poses suivantes à partir de l'état d'avant, pour que l'objet reflète la correction.
function openHistEditor(i) {
  const h = S.history; const e = i >= 0 ? h[i] : null;
  const rune = e ? e.rune : { stat: pending?.stat ?? S.item.lines[0]?.stat, tier: pending?.tier ?? 0 };
  const draft = { rune: { ...rune }, outcome: e?.outcome ?? 'EC', changes: e ? e.changes.map(c => ({ ...c })) : [], reliquatDelta: e?.reliquatDelta ?? 0 };
  const stats = STATS.filter(st => st.tiers.length);
  // En SC ou SN, la ligne de la rune monte de son bonus : ajoutée d'office, et suivie quand on change de rune
  // ou de résultat (la ligne ajoutée d'office est remplacée ; une ligne saisie à la main n'est pas touchée).
  const syncRune = () => {
    if (draft.auto) { const k = draft.changes.findIndex(c => c === draft.auto); if (k >= 0) draft.changes.splice(k, 1); draft.auto = null; }
    const r = runeOf(draft.rune.stat, draft.rune.tier);
    if (!r || draft.outcome === 'EC' || draft.changes.some(c => c.stat === r.stat)) return;
    draft.auto = { stat: r.stat, delta: r.bonus };
    draft.changes.unshift(draft.auto);
  };
  if (!e) syncRune();
  const render = () => {
    const tiers = STAT_BY_KEY[draft.rune.stat]?.tiers || [];
    const host = $('#hist-editor');
    host.innerHTML = `<div class="loss hedit"><div class="row"><strong>${e ? `Pose ${i + 1}` : 'Nouvelle pose'}</strong><div class="spacer"></div><button class="link small" id="he-cancel">annuler</button></div>
      <div class="row small"><label class="sel">Rune <select id="he-stat">${stats.map(st => `<option value="${st.key}" ${st.key === draft.rune.stat ? 'selected' : ''}>${esc(st.label)}</option>`).join('')}</select></label>
        <select id="he-tier" class="small">${tiers.map(([name], k) => `<option value="${k}" ${k === draft.rune.tier ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>
        <span class="seg small">${['SC', 'SN', 'EC'].map(o => `<button data-o="${o}" class="${o === draft.outcome ? 'on' : ''}">${o}</button>`).join('')}</span></div>
      <div class="he-changes">${draft.changes.map((c, k) => `<div class="row small"><span class="grow">${statImg(c.stat, 'sicon sm')}${esc(labelOf(c.stat))}</span><input type="number" class="num small" data-k="${k}" value="${c.delta}"><button class="link small" data-del="${k}">×</button></div>`).join('')}
        <div class="row small"><select id="he-add-stat" class="small"><option value="">+ ligne modifiée…</option>${STATS.map(st => `<option value="${st.key}">${esc(st.label)}</option>`).join('')}</select></div></div>
      <div class="row small"><label class="sel">Reliquat <input id="he-rel" type="number" step="0.1" class="num small" value="${draft.reliquatDelta}" title="variation du reliquat (+ gagné, − consommé)"></label><div class="spacer"></div>${e ? '<button class="link small" id="he-delete">supprimer la pose</button>' : ''}<button id="he-ok" class="primary small">Enregistrer</button></div></div>`;
    $('#he-stat').onchange = ev => { draft.rune.stat = ev.target.value; draft.rune.tier = 0; syncRune(); render(); };
    $('#he-tier').onchange = ev => { draft.rune.tier = +ev.target.value; syncRune(); render(); };
    $$('#hist-editor [data-o]').forEach(b => b.onclick = () => { draft.outcome = b.dataset.o; syncRune(); render(); });
    $$('#hist-editor input[data-k]').forEach(inp => inp.onchange = ev => { const c = draft.changes[+ev.target.dataset.k]; c.delta = Number(ev.target.value) || 0; if (c === draft.auto) draft.auto = null; });
    $$('#hist-editor [data-del]').forEach(b => b.onclick = () => { const [c] = draft.changes.splice(+b.dataset.del, 1); if (c === draft.auto) draft.auto = null; render(); });
    $('#he-add-stat').onchange = ev => { if (ev.target.value) { draft.changes.push({ stat: ev.target.value, delta: 0 }); render(); } };
    $('#he-rel').onchange = ev => { draft.reliquatDelta = w1(Number(ev.target.value) || 0); };
    $('#he-cancel').onclick = () => { host.innerHTML = ''; };
    const del = $('#he-delete'); if (del) del.onclick = () => { if (!confirm('Supprimer cette pose ?')) return; h.splice(i, 1); journalRemove(e.id); host.innerHTML = ''; replayHistory(i); };
    $('#he-ok').onclick = () => {
      const r = runeOf(draft.rune.stat, draft.rune.tier); if (!r) return;
      draft.changes = draft.changes.filter(c => c.delta).map(c => ({ stat: c.stat, delta: c.delta }));
      const entry = { id: e?.id ?? Date.now(), rune: { stat: r.stat, tier: r.tier, name: r.name }, outcome: draft.outcome, changes: draft.changes, reliquatDelta: draft.reliquatDelta, simulated: e?.simulated ?? false, gap: 0, edited: true,
                      before: e ? e.before : { lines: S.item.lines.map(l => ({ ...l })), reliquat: S.reliquat, reliquatBefore: S.reliquatBefore } };
      if (e) h[i] = entry; else h.push(entry);
      journalPatch(entry);
      host.innerHTML = ''; replayHistory(e ? i : h.length - 1);
    };
  };
  render();
  $('#hist-editor').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
// Rejeu des poses depuis l'indice i : l'état d'avant de chaque pose est l'état d'après de la précédente.
function replayHistory(i) {
  const h = S.history;
  let lines, rel, relBefore;
  if (i <= 0 || !h.length) { const b = h[0]?.before ?? { lines: S.item.lines, reliquat: S.reliquat, reliquatBefore: S.reliquatBefore }; lines = b.lines.map(l => ({ ...l })); rel = b.reliquat; relBefore = b.reliquatBefore ?? b.reliquat; }
  else { const b = h[i].before; lines = b.lines.map(l => ({ ...l })); rel = b.reliquat; relBefore = b.reliquatBefore ?? b.reliquat; }
  for (let k = Math.max(0, i); k < h.length; k++) {
    const e = h[k];
    e.before = { lines: lines.map(l => ({ ...l })), reliquat: rel, reliquatBefore: relBefore };
    for (const c of e.changes) { let l = lines.find(x => x.stat === c.stat); if (!l) { l = { stat: c.stat, value: 0, min: null, max: null }; lines.push(l); } l.value += c.delta; }
    relBefore = rel; rel = w1(rel + (e.reliquatDelta || 0));
  }
  // l'objet en cours suit l'historique corrigé (comme après une pose), et le prochain coup est recalculé
  const avant = new Map(S.item.lines.map(l => [l.stat, l.value]));
  S.item.lines = lines.filter(l => l.min != null || l.value > 0); S.reliquat = rel; S.reliquatBefore = rel; lastAdvice = null;
  save(); renderAll();
  const diff = S.item.lines.filter(l => (avant.get(l.stat) ?? 0) !== l.value).map(l => `${STAT_BY_KEY[l.stat]?.short || labelOf(l.stat)} ${avant.get(l.stat) ?? 0} → ${l.value}`);
  for (const [stat, v] of avant) if (v && !S.item.lines.some(l => l.stat === stat)) diff.push(`${STAT_BY_KEY[stat]?.short || labelOf(stat)} ${v} → 0`);
  const host = $('#hist-editor'); if (host) host.innerHTML = `<p class="small ${diff.length ? 'ok' : 'muted'}">${esc(diff.length ? `Objet mis à jour : ${diff.join(', ')}` : 'Historique mis à jour, objet inchangé.')}</p>`;
  if (S.settings.view === 'fm' && Object.keys(S.target).length) computeAdvice();
}
function journalRemove(hid) { try { const j = journal(); const k = j.findIndex(x => x.hid === hid); if (k >= 0) { j.splice(k, 1); localStorage.setItem(JKEY, JSON.stringify(j)); } } catch {} }
function journalPatch(e) { try { const j = journal(); const x = j.find(x => x.hid === e.id); if (x) { x.outcome = e.outcome; x.changes = e.changes; x.rune = { ...x.rune, stat: e.rune.stat, tier: e.rune.tier, name: e.rune.name }; x.edited = true; localStorage.setItem(JKEY, JSON.stringify(j)); } } catch {} }

$('#undo').onclick = () => {
  const e = S.history.pop(); if (!e) return;
  S.item.lines = e.before.lines; S.reliquat = e.before.reliquat; S.reliquatBefore = e.before.reliquatBefore ?? e.before.reliquat; lastAdvice = null; save(); renderAll();
};
$('#reset').onclick = () => {
  if (!confirm('Remettre toutes les lignes à zéro et vider l\'historique ?' + (S.history.length ? ' (la session est archivée dans le bilan)' : ''))) return;
  archiveSession(); S.sessionId = Date.now(); S.baseline = null;
  S.item.lines = S.item.lines.filter(l => l.min != null).map(l => ({ ...l, value: 0 }));
  S.reliquat = 0; S.reliquatBefore = 0; S.history = []; lastAdvice = null; save(); renderAll();
};

$('#hist-add').onclick = () => openHistEditor(-1);
$('#journal-export').onclick = () => journalExport();
$('#journal-clear').onclick = () => { if (confirm('Vider le journal des poses réelles ? (export conseillé avant)')) { try { localStorage.removeItem(JKEY); localStorage.removeItem(XKEY); } catch {} renderHistory(); } };

function setStatus(msg) { const el = $('#status'); if (el) el.textContent = msg; }

// ---- Fenêtre flottante (Document Picture-in-Picture, Chrome/Edge) ----------------
const pipBtn = document.querySelector('#pip');
if ('documentPictureInPicture' in window) pipBtn.classList.remove('hidden');
pipBtn.onclick = async () => {
  if (root !== document) { window.documentPictureInPicture.window?.close(); return; }
  let pip;
  try { pip = await window.documentPictureInPicture.requestWindow({ width: 380, height: 760 }); }
  catch (e) { alert('Fenêtre flottante indisponible : ' + e.message); return; }
  for (const ss of document.styleSheets) {
    try { const st = pip.document.createElement('style'); st.textContent = [...ss.cssRules].map(r => r.cssText).join('\n'); pip.document.head.appendChild(st); }
    catch { const link = pip.document.createElement('link'); link.rel = 'stylesheet'; link.href = ss.href; pip.document.head.appendChild(link); }
  }
  pip.document.title = 'FM Dofus';
  const parts = ['header.top', '#item-bar', 'main'].map(sel => document.querySelector(sel));
  const placeholder = document.createElement('div');
  placeholder.className = 'card pip-placeholder';
  placeholder.innerHTML = '<p>L\'outil est ouvert dans la fenêtre flottante.</p><p class="muted small">Ferme-la pour le ramener ici.</p>';
  document.body.insertBefore(placeholder, document.querySelector('footer'));
  parts.forEach(el => pip.document.body.appendChild(el));
  root = pip.document;
  if (S.item) S.settings.view = 'fm';
  renderAll();
  pip.addEventListener('pagehide', () => {
    parts.forEach(el => document.body.insertBefore(el, placeholder));
    placeholder.remove();
    root = document;
    renderAll();
  });
};

renderAll();
if (window.__correction) {
  const c = window.__correction, pl = (n, m) => `${n} ${m}${n > 1 ? 's' : ''}`;
  const parts = [c.journal ? `${pl(c.journal, 'pose')} du journal` : '', c.history ? `${pl(c.history, 'pose')} de la session en cours` : '', c.sessions ? `${pl(c.sessions, 'session archivée')}` : ''].filter(Boolean);
  setStatus(`Données corrigées (SC qui avaient pris du reliquat → SN) : ${parts.join(', ')}. Pense à réexporter le journal.`);
}
