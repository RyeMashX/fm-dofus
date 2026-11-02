// Interface : deux vues (Objet, FM), reliquat en tête, cycle automatique en mode FM. Vanilla JS.
import * as FM from './engine.js';
import * as Search from './search.js';
import { STATS, STAT_BY_KEY, RUNES } from './stats.js';
import { searchItems, iconUrl, labelOf } from './dofusdb.js';
import * as Cap from './capture.js';
import { interpretEntry } from './ocr.js';

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
const runeImg = (r, cls = 'ricon') => r?.icon ? `<img class="${cls}" src="${esc(r.icon)}" alt="" loading="lazy">` : '';

// ---- Modèle : DoFocus brut ou calibré sur le journal --------------------------
// Calibration du 2026-11-02 sur 156 poses réelles (2 objets) : le palier des 80 % pèse moins que dans
// DoFocus (+25 au lieu de +45) et la pénalité de ratio jet/bonus au-delà de 14 est doublée (24 par point
// au lieu de 12). Les tests unitaires gardent les valeurs DoFocus.
const MODELS = {
  dofocus: { label: 'DoFocus brut', P: { STEP: FM.P.STEP, RATIO_SLOPE: FM.P.RATIO_SLOPE } },
  calibre: { label: 'Calibré sur le journal (2026-11)', P: { STEP: 25, RATIO_SLOPE: 24 } },
};
function applyModel(key) { Object.assign(FM.P, (MODELS[key] || MODELS.calibre).P); }

// ---- État --------------------------------------------------------------------
let S = load() || blank();
applyModel(S.settings.model);
let pending = null;      // rune sélectionnée pour la pose
let lossDraft = null;    // saisie des pertes en cours
let lastAdvice = null;

function blank() {
  return { template: null, item: null, reliquat: 0, reliquatBefore: 0, target: {}, history: [], settings: { top: 3, samples: 1500, view: 'item', show: { sc: true, sn: false, ec: false }, model: 'calibre' } };
}
function load() { try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && !s.settings.view) s.settings.view = 'item'; if (s && s.reliquatBefore == null) s.reliquatBefore = s.reliquat; if (s && !s.settings.show) s.settings.show = { sc: true, sn: false, ec: false }; if (s && !s.settings.model) s.settings.model = 'calibre'; return s; } catch { return null; } }
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
    if (q.trim().length < 2) { ul.innerHTML = ''; return; }
    try {
      const items = await searchItems(q);
      ul.innerHTML = items.map((t, i) => `<li data-i="${i}"><img src="${esc(iconUrl(t))}" alt=""><span class="grow">${esc(t.name)}</span><span class="muted small">niv. ${t.level} · ${esc(t.type)}</span></li>`).join('')
        || '<li class="muted">Aucun résultat</li>';
      ul.querySelectorAll('li[data-i]').forEach(li => li.onclick = () => useTemplate(items[+li.dataset.i]));
      setStatus('');
    } catch (err) { setStatus('DofusDB injoignable : saisis l\'objet à la main.'); }
  }, 250);
});
$('#manual-item').onclick = () => useTemplate({ id: null, name: 'Objet manuel', level: 200, type: '', lines: [], unknown: [], manual: true });

// Cible par défaut : vita/fo/ine/cha/age/pui → max − bonus de la Pa + 1 ; dommages, résistances %, cri → max ;
// le reste → 1 (pas de ligne à 0). Ligne négative à fourchette (−20 à −16) → le moins négatif sans over (−16) ;
// ligne négative fixe ou à max nul : pas de cible.
function autoTarget(lines) {
  const target = {};
  for (const l of lines) {
    if (l.min == null) continue;
    if (!(l.max > 0)) { if (l.max < 0 && l.min !== l.max) target[l.stat] = l.max; continue; }
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
  $('#search-results').innerHTML = ''; $('#search-input').value = '';
  save(); renderAll();
}

// ---- Vues ---------------------------------------------------------------------
let settingsOpen = false;   // l'écran de réglages se superpose à la vue courante
function setView(v) { S.settings.view = v; settingsOpen = false; save(); renderAll(); }
$$('#view-switch button').forEach(b => b.onclick = () => setView(b.dataset.view));
document.querySelector('#settings-btn').onclick = () => { settingsOpen = true; renderAll(); };
document.querySelector('#settings-back').onclick = () => { settingsOpen = false; renderAll(); };
document.querySelector('#bilan-prices').onclick = () => { settingsOpen = true; renderAll(); };

function renderAll() {
  const has = !!S.item;
  const view = settingsOpen ? 'settings' : has ? S.settings.view : 'search';
  root.body.className = 'view-' + view + (root !== document ? ' pip' : '');
  $('#search').classList.toggle('hidden', view !== 'search');
  $('#view-switch').classList.toggle('hidden', !has);
  $('#reliquat-bar').classList.toggle('hidden', !(view === 'item' || view === 'fm'));
  for (const v of ['item', 'fm', 'bilan', 'settings']) $$('.view-' + v).forEach(s => s.classList.toggle('hidden', view !== v));
  $$('#view-switch button').forEach(b => b.classList.toggle('on', !settingsOpen && b.dataset.view === S.settings.view));
  if (view === 'settings') { renderSettings(); return; }
  if (!has) return;
  const reached = Object.keys(S.target).length > 0 && Search.targetReached(S.item, S.target);
  $('#tab-bilan').classList.toggle('glow', reached);
  $('#reliquat').value = S.reliquat;
  $('#item-chip').textContent = `${S.template.name} · niv. ${S.item.level}`;
  if (view === 'fm') { renderPose(); renderHistory(); renderAdvice(); }
  else if (view === 'bilan') renderBilan(reached);
  else renderItem();
  renderCaptureButtons();
  $('#top-select').value = String(S.settings.top);
  const ss = $('#samples-select'); ss.value = String(S.settings.samples); if (!ss.value) { ss.value = '1500'; S.settings.samples = 1500; }
}

// ---- Reliquat -----------------------------------------------------------------
function setReliquat(v) { S.reliquat = Math.max(0, w1(Number(v) || 0)); $('#reliquat').value = S.reliquat; save(); }
$('#reliquat').onchange = e => setReliquat(e.target.value);
$('#rel-minus').onclick = () => setReliquat(S.reliquat - 1);
$('#rel-plus').onclick = () => setReliquat(S.reliquat + 1);

// ---- Vue Objet ----------------------------------------------------------------
function renderItem() {
  const t = S.template;
  $('#item-name').textContent = t.name;
  $('#item-meta').textContent = [t.type || 'objet', t.unknown?.length ? `${t.unknown.length} effet(s) non gérés` : ''].filter(Boolean).join(' · ');
  $('#item-icon').src = iconUrl(t) || ''; $('#item-icon').classList.toggle('hidden', !iconUrl(t));
  $('#item-level-text').textContent = S.item.level;
  const show = S.settings.show;
  for (const k of ['sc', 'sn', 'ec']) { const b = $('#show-' + k); if (b) b.setAttribute('aria-pressed', String(!!show[k])); }
  const shown = o => pct((show.sc ? o.sc : 0) + (show.sn ? o.sn : 0) + (show.ec ? o.ec : 0));
  const pcClass = show.sc && !show.sn && !show.ec ? 'sc' : !show.sc && show.sn && !show.ec ? 'sn' : !show.sc && !show.sn && show.ec ? 'ec' : 'mix';
  // rune conseillée par ligne cible : celle qui minimise les poses restantes à la valeur actuelle
  let tables = null;
  try { if (Object.keys(S.target).length) tables = Search.buildTables(state(), S.target).tables; } catch {}
  $('#lines').innerHTML = S.item.lines.map((l, i) => {
    const st = STAT_BY_KEY[l.stat];
    const exo = l.min == null;
    const tgt = S.target[l.stat];
    const done = tgt != null && l.value >= tgt;
    const best = !done && tables?.[l.stat]?.choice.get(l.value) || null;
    const runes = st.tiers.map(([name], k) => {
      const r = runeOf(l.stat, k);
      const o = FM.odds(S.item, r);
      const rec = best && best.tier === k;
      if (o.blocked) return `<div class="chip max" title="${o.blocked === 'line-cap' ? 'plafond de la ligne' : 'plafond over+exo de l\'objet'}">${runeImg(r)}<span class="cn">${esc(name)}</span><span class="pc">MAX</span></div>`;
      return `<div class="chip ${rec ? 'rec' : ''}">${runeImg(r)}<span class="cn">${esc(name)}</span><span class="pc ${pcClass}">${shown(o)}</span>
        <div class="pop"><div class="bar">${bar(o)}</div>${oddsText(o)}${rec ? '<div class="warn small">rune conseillée</div>' : ''}</div></div>`;
    }).join('');
    return `<div class="line ${done ? 'done' : ''} ${exo ? 'exo' : ''} ${l.max < 0 ? 'neg' : ''}" data-i="${i}">
      <div class="l1"><span class="name" title="${esc(st.label)}">${esc(st.label)}</span><span class="range">${exo ? '' : l.min === l.max ? `${l.min}` : `${l.min} à ${l.max}`}</span>
        <input class="num small cur" type="number" data-field="value" value="${l.value}" title="jet actuel">
        <span class="arrow">→</span>
        <input class="num small tgt" type="number" data-field="target" value="${tgt ?? ''}" placeholder="cible" title="cible (minimum visé)">
        ${exo ? '<button class="link small del" data-del="1">×</button>' : ''}</div>
      <div class="l2">${runes}</div>
    </div>`;
  }).join('');
  $$('#lines input').forEach(inp => inp.onchange = onLineEdit);
  $$('#lines button[data-del]').forEach(b => b.onclick = () => {
    const i = +b.closest('.line').dataset.i; const stat = S.item.lines[i].stat;
    S.item.lines.splice(i, 1); delete S.target[stat]; save(); renderAll();
  });
  renderEstimate();
  const present = new Set(S.item.lines.map(l => l.stat));
  $('#exo-select').innerHTML = '<option value="">+ Ajouter un exo…</option>' +
    STATS.filter(s => !present.has(s.key)).map(s => `<option value="${s.key}">${esc(s.label)}</option>`).join('');
}
// Estimation du chemin restant : sessions simulées (politique gloutonne) → poses et coût attendus.
let estimateKey = null, estimateCache = null;
function renderEstimate() {
  const box = $('#estimate'); if (!box) return;
  const hasTarget = Object.keys(S.target).length > 0;
  if (!hasTarget || Search.targetReached(S.item, S.target)) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const key = JSON.stringify([S.item.lines, S.target, S.reliquat]);
  if (key !== estimateKey) {
    box.innerHTML = '<span class="muted small">Estimation…</span>';
    estimateKey = key;
    setTimeout(() => { if (estimateKey !== key) return; try { estimateCache = Search.simulateSessions(state(), S.target, { runs: 300, seed: 7 }); } catch (e) { estimateCache = null; } paintEstimate(); }, 20);
    return;
  }
  paintEstimate();
}
// Coût d'une estimation d'après les prix du moment.
function estimateCost(r) {
  const p = prices(); let cost = 0, missing = 0;
  const rows = r.runes.filter(x => x.n >= 0.05).map(x => { const u = p[x.id]; const c = u > 0 ? u * x.n : 0; if (u > 0) cost += c; else missing++; return { x, u, c }; });
  return { rows, cost, missing, costP90: r.mean > 0 ? cost * r.p90 / r.mean : 0 };
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
const f1 = x => x.toFixed(x >= 10 ? 0 : 1).replace('.', ',');
const pctDiff = (real, est) => { if (!(est > 0)) return ''; const d = Math.round((real / est - 1) * 100); return `<span class="${d > 25 ? 'bad' : d < -25 ? 'ok' : 'muted'}">${d >= 0 ? '+' : '−'}${Math.abs(d)} %</span>`; };
function paintEstimate() {
  const box = $('#estimate'); const r = estimateCache;
  if (!r) { box.innerHTML = '<span class="muted small">Estimation indisponible.</span>'; return; }
  const { rows, cost, missing, costP90 } = estimateCost(r);
  const b = S.baseline;
  const detail = `<div class="rtable">${rows.map(({ x, u, c }) => `<div class="rrow">${runeImg(x.rune, 'ricon sm')}<span class="cn">${esc(x.rune.name)}</span><span class="cnt">× ${x.n.toFixed(1).replace('.', ',')}</span><span class="cost">${u > 0 ? kShort(c) : '<span class="warn small">prix ?</span>'}</span></div>`).join('')}</div>`;
  box.innerHTML = `<div class="est-head small muted">Pour atteindre la cible <span class="muted">(${r.runs} sessions simulées)</span>${r.unfinished > 0.02 ? ` · <span class="warn">${Math.round(r.unfinished * 100)} % n'aboutissent pas</span>` : ''}</div>
    <div class="kpis est-kpis">
      <div class="kpi"><div class="v">≈ ${f1(r.mean)}</div><div class="l">poses<br><span class="muted">médiane ${r.median} · 9 fois sur 10 sous ${r.p90}</span></div></div>
      <div class="kpi haspop"><div class="v">${cost ? `≈ ${kShort(cost)}` : '<span class="muted">—</span>'}</div><div class="l">kamas${cost ? `<br><span class="muted">jusqu'à ${kShort(costP90)} dans les mauvais cas${missing ? ` · ${missing} rune${missing > 1 ? 's' : ''} sans prix` : ''}</span>` : '<br><span class="muted">renseigne les prix (⚙)</span>'}</div>
        <div class="pop">${detail}</div></div>
    </div>
    <details class="est-more"><summary class="small muted">détail des runes</summary>${detail}</details>
    <div class="row small baseline">${b ? `<span>Figée ${b.after ? `après ${b.after} pose${b.after > 1 ? 's' : ''}` : 'au départ'} : ≈ ${f1(b.poses)} poses · ${b.cost ? `≈ ${kShort(b.cost)}` : 'coût ?'}</span><button id="freeze" class="link small">refiger</button>` : `<span class="muted">Fige l'estimation pour la comparer au résultat dans le bilan (sinon, figée automatiquement à la première pose).</span><button id="freeze" class="secondary small">Figer l'estimation</button>`}</div>`;
  $('#freeze').onclick = () => { if (S.baseline && !confirm('Remplacer l\'estimation figée ?')) return; freezeBaseline(); paintEstimate(); };
}

function onLineEdit(e) {
  const i = +e.target.closest('.line').dataset.i; const l = S.item.lines[i];
  const v = e.target.value === '' ? null : Number(e.target.value);
  if (e.target.dataset.field === 'value') l.value = v ?? 0;
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
$('#auto-target').onclick = () => { S.target = { ...S.target, ...autoTarget(S.item.lines) }; save(); renderItem(); };
$('#change-item').onclick = () => { if (confirm('Changer d\'objet ? L\'objet en cours sera perdu' + (S.history.length ? ' (la session est archivée dans le bilan).' : '.'))) { archiveSession(); S = blank(); save(); renderAll(); } };

// ---- Vue FM : conseil ---------------------------------------------------------
$('#top-select').onchange = e => { S.settings.top = Number(e.target.value); save(); };
$('#samples-select').onchange = e => { S.settings.samples = Number(e.target.value); save(); };
$('#advise').onclick = () => computeAdvice();

function computeAdvice(scroll = false) {
  const out = $('#advice-out');
  if (!Object.keys(S.target).length) { out.innerHTML = '<p class="muted small">Renseigne au moins une cible dans la vue Objet.</p>'; return; }
  out.innerHTML = '<p class="muted small">Calcul…</p>';
  setTimeout(() => {
    lastAdvice = Search.nextBestMoves(state(), S.target, { samples: Math.round(S.settings.samples / 3), top: S.settings.top, seed: Date.now() & 0xffff });
    if (!lastAdvice.reached && lastAdvice.moves.length) pending = lastAdvice.moves[0].rune;
    renderAdvice(); renderPose();
    if (scroll) $('#advice').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 20);
}

function renderAdvice() {
  const out = $('#advice-out'); const res = lastAdvice;
  if (!res) { out.innerHTML = '<p class="muted small">Clique « Calculer » pour obtenir le prochain coup.</p>'; return; }
  if (res.reached) { out.innerHTML = '<p class="ok">Cible atteinte sur toutes les lignes.</p>'; return; }
  if (!res.moves.length) { out.innerHTML = '<p class="muted small">Aucune rune posable sur les lignes cibles (plafonds atteints ?).</p>'; return; }
  const note = res.heavyFirst ? `<p class="warn small">Exo lourd en attente : à poser avant tout le reste, chaque échec détruit jusqu'à ${res.moves[0].rune.weight} de poids sur l'objet.</p>` : '';
  const best = res.moves[0].score;
  out.innerHTML = note + `<div class="advice">${res.moves.map((m, k) => {
    const on = pending && pending.stat === m.rune.stat && pending.tier === m.rune.tier;
    const tie = k > 0 && m.score - best < 0.3;
    return `<div class="move ${on ? 'on' : ''}" data-rune="${m.rune.stat}:${m.rune.tier}">
      <div class="h"><strong>${runeImg(m.rune)}${esc(m.rune.name)}</strong>${oddsText(m.odds)}</div>
      <div class="sub">+${m.rune.bonus} ${esc(labelOf(m.rune.stat))}${m.purpose === 'nettoyage' ? ` · <span class="warn">nettoyage de l'over ${esc(labelOf(m.cleans))}</span>` : ''}${tie ? ' · <span class="muted">≈ équivalent au meilleur</span>' : ''}</div>
      <div class="bar">${bar(m.odds)}</div>
      <div class="meta"><span>≈ <b>${m.score.toFixed(1)}</b> poses restantes</span><span class="risk">abîme une cible <b>${Math.round(m.pHurtTarget * 100)} %</b></span></div>
    </div>`;
  }).join('')}</div>`;
  $$('.move').forEach(d => d.onclick = () => { const [stat, tier] = d.dataset.rune.split(':'); pending = runeOf(stat, +tier); renderAdvice(); renderPose(); });
}

// ---- Vue FM : pose ------------------------------------------------------------
function renderPose() {
  if (!pending) pending = runeOf(S.item.lines[0]?.stat ?? 'vita', 0);
  const o = FM.odds(S.item, pending);
  $('#pose-rune').innerHTML = o.blocked
    ? `<strong>${runeImg(pending)}${esc(pending.name)}</strong> <span class="muted small">pose impossible (${o.blocked === 'line-cap' ? 'plafond de la ligne' : 'plafond over+exo'})</span>`
    : `<strong>${runeImg(pending)}${esc(pending.name)}</strong> <span class="muted small">+${pending.bonus} ${esc(labelOf(pending.stat))} · poids ${pending.weight}${o.half ? ' (÷2)' : ''}</span><br>${oddsText(o)}`;
  $$('#pose button[data-outcome]').forEach(b => b.disabled = !!o.blocked);
  $('#simulate').disabled = !!o.blocked;
  // sélecteur manuel
  const present = S.item.lines.map(l => l.stat);
  const others = STATS.map(s => s.key).filter(k => !present.includes(k));
  const opt = k => `<option value="${k}" ${k === pending.stat ? 'selected' : ''}>${esc(labelOf(k))}</option>`;
  $('#rune-stat').innerHTML = `<optgroup label="Sur l'objet">${present.map(opt).join('')}</optgroup><optgroup label="Exo">${others.map(opt).join('')}</optgroup>`;
  const st = STAT_BY_KEY[pending.stat];
  $('#rune-tiers').innerHTML = st.tiers.map(([name, bonus], k) => `<button class="small ${k === pending.tier ? 'on' : ''}" data-tier="${k}">${runeImg(runeOf(pending.stat, k), 'ricon sm')}${esc(name)} +${bonus}</button>`).join('');
  $$('#rune-tiers button').forEach(b => b.onclick = () => { pending = runeOf(pending.stat, +b.dataset.tier); renderAdvice(); renderPose(); });
}
$('#other-rune').onclick = () => $('#rune-picker').classList.toggle('hidden');
$('#rune-stat').onchange = e => { pending = runeOf(e.target.value, 0); renderAdvice(); renderPose(); };

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
    return `<div class="lrow ${locked ? 'locked' : ''}"><span class="name">${esc(labelOf(l.stat))}${i === d.t ? ' <span class="muted small">(posée)</span>' : ''}</span>
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
  $('#loss-cancel').onclick = () => { lossDraft = null; renderLossPanel(); };
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
function journalExport() {
  const j = journal();
  const blob = new Blob([JSON.stringify({ version: 1, exported: new Date().toISOString(), entries: j }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `fm-dofus-journal-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
}

function commit({ rune, outcome, lines, reliquat, changes, simulated = false, gap = 0, reliquatBefore = S.reliquat }) {
  const keepStatus = $('#screen-status')?.textContent;
  if (!S.baseline && Object.keys(S.target).length && !Search.targetReached(S.item, S.target)) freezeBaseline(null);
  if (!simulated) {
    let odds = null; try { const o = FM.odds(S.item, rune); odds = o.blocked ? { blocked: o.blocked } : { sc: o.sc, sn: o.sn, ec: o.ec, regime: o.regime, difficulty: o.difficulty, quality: o.quality }; } catch {}
    journalAdd({ t: new Date().toISOString(), item: { id: S.template?.id ?? null, name: S.template?.name, level: S.item.level },
                 before: { lines: S.item.lines.map(l => ({ ...l })), reliquat: reliquatBefore },
                 rune: { stat: rune.stat, tier: rune.tier, name: rune.name, bonus: rune.bonus, weight: rune.weight },
                 odds, outcome, changes, after: { reliquat }, gap });
  }
  S.history.push({ id: Date.now(), rune: { stat: rune.stat, tier: rune.tier, name: rune.name }, outcome, changes,
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
const screenStatus = msg => { for (const id of ['#screen-status', '#screen-status-item']) { const el = $(id); if (el) el.textContent = msg; } };
const screenOut = () => $(S.settings.view === 'fm' ? '#screen-out' : '#screen-out-item');
function renderCaptureButtons() {
  const on = Cap.isCapturing();
  for (const id of ['#cap-start', '#cap-start-item']) { const b = $(id); if (b) { b.textContent = on ? (id === '#cap-start' ? 'arrêter la capture' : 'Arrêter la capture') : (id === '#cap-start' ? 'capturer le jeu' : 'Capturer le jeu'); b.classList.toggle('hidden', !Cap.isSupported()); } }
  for (const id of ['#cap-pose', '#cap-table-item']) { const b = $(id); if (b) b.classList.toggle('hidden', !on); }
  if (!Cap.isSupported()) screenStatus('Capture de fenêtre non disponible dans ce navigateur (Chrome ou Edge conseillés).');
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
document.querySelector('#cap-start-item').onclick = toggleCapture;
document.querySelector('#cap-table-item').onclick = () => readAndRender('table');
const progress = m => { if (m?.status === 'loading tesseract core' || m?.status?.includes('loading language')) screenStatus(`Chargement de l'OCR… ${Math.round((m.progress || 0) * 100)} %`); };

async function readAndRender(kind) {
  const out = screenOut();
  out.innerHTML = '<p class="muted small">Lecture…</p>';
  let r;
  try { r = await Cap.readGame(progress); }
  catch (e) { out.innerHTML = `<p class="warn small">Lecture impossible : ${esc(e.message)}</p>`; return; }
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
  out.innerHTML = `<div class="loss"><div class="row"><strong>Tableau lu</strong><span class="muted small">${rows.filter(x => x.nu != null).length}/${rows.length} lignes${r.reliquat != null ? ` · reliquat ${r.reliquat}` : ''}</span></div>
    ${rows.map(x => `<div class="lrow"><span class="name">${esc(labelOf(x.stat))}</span><span class="val">${x.nu == null ? '<span class="muted">non lue</span>' : x.nu !== x.old ? `<span class="muted">${x.old} →</span> <b class="warn">${x.nu}</b>` : x.nu}</span></div>`).join('')}
    ${unknown.length ? `<p class="muted small">Lignes lues sans correspondance : ${unknown.map(t => esc(t.label)).join(', ')}</p>` : ''}
    <div class="row"><div class="spacer"></div><button id="read-cancel" class="secondary small">Ignorer</button><button id="read-apply" class="primary" ${changes.length || r.reliquat != null ? '' : 'disabled'}>Appliquer</button></div></div>`;
  $('#read-cancel').onclick = () => { out.innerHTML = ''; };
  $('#read-apply').onclick = () => {
    for (const x of rows) if (x.nu != null) S.item.lines.find(l => l.stat === x.stat).value = x.nu;
    if (r.reliquat != null) { S.reliquat = r.reliquat; S.reliquatBefore = r.reliquat; }
    save(); out.innerHTML = ''; renderAll();
  };
}

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
  const txt = entry.map(it => it.reliquat ? (it.reliquat > 0 ? '+ reliquat' : '− reliquat') : `${it.delta > 0 ? '+' : ''}${it.delta} ${esc(labelOf(it.stat))}`).join(', ');
  const apply = () => {
    lastEntryKey = key; out.innerHTML = '';
    pending = rune; renderPose();
    if (info.outcome === 'SC') {
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
    if (r.reliquat != null && Math.abs(lost - expected) < 0.01) { $('#loss-ok').click(); return true; }
    return false;
  };
  if (!dup && r.reliquat != null) {
    const ok = apply();
    screenStatus(`Lu : ${rune.name} en ${info.outcome} (${txt.replace(/<[^>]+>/g, '')})${ok ? ' · appliqué' : ' · à vérifier ci-dessous'}`);
    return;
  }
  out.innerHTML = `<div class="loss"><div class="row"><strong>Dernière pose lue : ${runeImg(rune)}${esc(rune.name)} en ${info.outcome}</strong></div>
    <div class="small">${txt}${r.reliquat != null ? ` · reliquat affiché ${r.reliquat}` : ' · <span class="warn">reliquat non lu</span>'}</div>
    ${dup ? '<p class="warn small">Identique à la dernière pose appliquée : as-tu bien posé une nouvelle rune ?</p>' : ''}
    <div class="row"><div class="spacer"></div><button id="read-cancel" class="secondary small">Ignorer</button><button id="read-apply" class="primary">Vérifier et appliquer</button></div></div>`;
  $('#read-cancel').onclick = () => { out.innerHTML = ''; };
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
  sel.innerHTML = Object.entries(MODELS).map(([k, m]) => `<option value="${k}" ${k === (S.settings.model || 'calibre') ? 'selected' : ''}>${esc(m.label)}</option>`).join('');
  sel.onchange = e => { S.settings.model = e.target.value; applyModel(S.settings.model); estimateKey = null; lastAdvice = null; save(); };
  const p = prices(); const q = ($('#prices-filter').value || '').trim().toLowerCase();
  const norm = x => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const list = STATS.filter(st => !q || norm(st.label).includes(norm(q)) || st.tiers.some(([n]) => norm(n).includes(norm(q))));
  $('#prices-list').innerHTML = list.map(st => `<div class="prow"><span class="name">${esc(st.label)}</span>${st.tiers.map(([name], k) => {
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
  out.innerHTML = list.map(s => `<details class="sess ${s.id === S.sessionId ? 'cur' : ''}"><summary>
      <span class="d">${date(s.t)}</span><span class="cn">${esc(s.item.name || 'objet')}${s.id === S.sessionId ? ' <span class="muted small">(en cours)</span>' : ''}</span>
      <span class="st ${s.reached ? 'ok' : 'muted'}">${s.reached ? '✓' : '…'}</span><span class="cnt">${s.poses} poses</span>
      <span class="z ${s.z >= 1 ? 'ok' : s.z <= -1 ? 'bad' : 'muted'}">${s.z >= 0 ? '+' : '−'}${Math.abs(s.z).toFixed(1).replace('.', ',')} σ</span>
      <span class="cost">${s.cost ? kShort(s.cost) : '<span class="muted">—</span>'}</span></summary>
    <div class="small sessbody">
      ${s.baseline ? `<div>Estimé ${s.baseline.after ? `après ${s.baseline.after} pose${s.baseline.after > 1 ? 's' : ''}` : 'au départ'} : ≈ ${f1(s.baseline.poses)} poses${s.baseline.cost ? ` · ≈ ${kShort(s.baseline.cost)}` : ''} → réel ${s.poses} poses ${pctDiff(s.poses, s.baseline.poses)}${s.cost && s.baseline.cost ? ` · ${kShort(s.cost)} ${pctDiff(s.cost, s.baseline.cost)}` : ''}</div>` : ''}
      <div>SC ${s.n.SC} · SN ${s.n.SN} · EC ${s.n.EC}${!s.baseline && s.expectedAtStart != null ? ` · ≈ ${Math.round(s.expectedAtStart)} poses attendues au départ` : ''} · poids détruit ${String(s.lostWeight).replace('.', ',')}${s.ms ? ` · ${Math.round(s.ms / 60e3)} min` : ''}${s.simulated ? ` · <span class="warn">${s.simulated} simulée${s.simulated > 1 ? 's' : ''}</span>` : ''}</div>
      <div class="muted">Cible : ${Object.entries(s.target).map(([k, v]) => `${esc(labelOf(k))} ${v}`).join(', ') || '—'}</div>
      <div class="muted">Final : ${s.lines.filter(l => l.value).map(l => `${esc(labelOf(l.stat))} ${l.value}`).join(', ')}</div>
      <div class="muted">${s.byRune.map(b => `${esc(b.name)} × ${b.n}`).join(' · ')}</div>
      <div class="row"><div class="spacer"></div><button class="link small" data-del-session="${s.id}">supprimer</button></div>
    </div></details>`).join('');
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
  $('#journal-stats').textContent = `${j.length} pose${j.length > 1 ? 's' : ''} réelle${j.length > 1 ? 's' : ''} enregistrée${j.length > 1 ? 's' : ''} (tous objets)`;
  $('#journal-export').disabled = !j.length;
  $('#undo').disabled = !h.length;
  $('#history-list').innerHTML = [...h].reverse().slice(0, 12).map(e => {
    const ch = e.changes.map(c => `${c.delta > 0 ? '+' : ''}${c.delta} ${esc(labelOf(c.stat))}`).join(', ');
    const rel = e.reliquatDelta ? ` · reliquat ${e.reliquatDelta > 0 ? '+' : ''}${e.reliquatDelta}` : '';
    return `<li><span class="tag ${e.outcome}">${e.outcome}</span>${runeImg(runeOf(e.rune.stat, e.rune.tier), 'ricon sm')}${esc(e.rune.name)}${e.simulated ? ' <span class="muted small">(simulé)</span>' : ''} <span class="muted small">${ch || 'rien ne bouge'}${rel}${e.gap ? ` · écart ${e.gap}` : ''}</span></li>`;
  }).join('');
}
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

$('#journal-export').onclick = () => journalExport();
$('#journal-clear').onclick = () => { if (confirm('Vider le journal des poses réelles ? (export conseillé avant)')) { try { localStorage.removeItem(JKEY); } catch {} renderHistory(); } };

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
  const parts = ['header.top', '#reliquat-bar', 'main'].map(sel => document.querySelector(sel));
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
