// Interface : deux vues (Objet, FM), reliquat en tête, cycle automatique en mode FM. Vanilla JS.
import * as FM from './engine.js';
import * as Search from './search.js';
import { STATS, STAT_BY_KEY, RUNES } from './stats.js';
import { searchItems, iconUrl, labelOf } from './dofusdb.js';

let root = document;   // document courant : la page, ou la fenêtre flottante (PiP)
const $ = sel => root.querySelector(sel);
const $$ = sel => [...root.querySelectorAll(sel)];
const KEY = 'fm-dofus:state';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = x => FM.fmt(x).toString().replace('.', ',');
const w1 = x => Math.round(x * 100) / 100;
const bar = o => `<i class="sc" style="width:${o.sc}%"></i><i class="sn" style="width:${o.sn}%"></i><i class="ec" style="width:${o.ec}%"></i>`;
const oddsText = o => `<span class="odds"><b>SC ${pct(o.sc)}</b> · <i>SN ${pct(o.sn)}</i> · <s>EC ${pct(o.ec)}</s></span>`;

// ---- État --------------------------------------------------------------------
let S = load() || blank();
let pending = null;      // rune sélectionnée pour la pose
let lossDraft = null;    // saisie des pertes en cours
let lastAdvice = null;

function blank() {
  return { template: null, item: null, reliquat: 0, reliquatBefore: 0, target: {}, history: [], settings: { top: 3, samples: 1500, view: 'item' } };
}
function load() { try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && !s.settings.view) s.settings.view = 'item'; if (s && s.reliquatBefore == null) s.reliquatBefore = s.reliquat; return s; } catch { return null; } }
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

function useTemplate(t) {
  S = blank();
  S.template = t;
  S.item = { level: t.level, lines: t.lines.map(l => ({ stat: l.stat, value: 0, min: l.min, max: l.max })) };
  S.settings.view = 'item';
  pending = null; lastAdvice = null;
  $('#search-results').innerHTML = ''; $('#search-input').value = '';
  save(); renderAll();
}

// ---- Vues ---------------------------------------------------------------------
function setView(v) { S.settings.view = v; save(); renderAll(); }
$$('#view-switch button').forEach(b => b.onclick = () => setView(b.dataset.view));

function renderAll() {
  const has = !!S.item;
  $('#search').classList.toggle('hidden', has);
  $('#view-switch').classList.toggle('hidden', !has);
  $('#reliquat-bar').classList.toggle('hidden', !has);
  if (!has) { $$('.view-item, .view-fm').forEach(s => s.classList.add('hidden')); return; }
  const fm = S.settings.view === 'fm';
  root.body.className = (fm ? 'view-fm' : 'view-item') + (root !== document ? ' pip' : '');
  $$('.view-item').forEach(s => s.classList.toggle('hidden', fm));
  $$('.view-fm').forEach(s => s.classList.toggle('hidden', !fm));
  $$('#view-switch button').forEach(b => b.classList.toggle('on', b.dataset.view === S.settings.view));
  $('#reliquat').value = S.reliquat;
  $('#item-chip').textContent = `${S.template.name} · niv. ${S.item.level}`;
  if (fm) { renderPose(); renderHistory(); renderAdvice(); }
  else renderItem();
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
  $('#item-level').value = S.item.level;
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
      const o = FM.odds(S.item, runeOf(l.stat, k));
      const rn = k === 0 ? 'R' : k === 1 ? 'Pa' : 'Ra';
      const rec = best && best.tier === k;
      return o.blocked ? `<div class="rune max" title="${o.blocked === 'line-cap' ? 'plafond de la ligne' : 'plafond over+exo de l\'objet'}"><span class="rn">${rn}</span><div class="bar"></div><span class="pc">MAX</span></div>`
        : `<div class="rune ${rec ? 'rec' : ''}" title="${esc(name)} : SC ${pct(o.sc)} % · SN ${pct(o.sn)} % · EC ${pct(o.ec)} %${rec ? ' · rune conseillée' : ''}"><span class="rn">${rn}</span><div class="bar">${bar(o)}</div><span class="pc">${pct(o.sc)}</span></div>`;
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
  const present = new Set(S.item.lines.map(l => l.stat));
  $('#exo-select').innerHTML = '<option value="">+ Ajouter un exo…</option>' +
    STATS.filter(s => !present.has(s.key)).map(s => `<option value="${s.key}">${esc(s.label)}</option>`).join('');
}
function onLineEdit(e) {
  const i = +e.target.closest('.line').dataset.i; const l = S.item.lines[i];
  const v = e.target.value === '' ? null : Number(e.target.value);
  if (e.target.dataset.field === 'value') l.value = v ?? 0;
  else { if (v == null) delete S.target[l.stat]; else S.target[l.stat] = v; }
  save(); renderItem();
}
$('#item-level-edit').onclick = () => { $('#item-level').classList.toggle('hidden'); };
$('#item-level').onchange = e => { S.item.level = Number(e.target.value) || 200; save(); renderItem(); };
$('#exo-select').onchange = e => {
  if (!e.target.value) return;
  S.item.lines.push({ stat: e.target.value, value: 0, min: null, max: null });
  S.target[e.target.value] = S.target[e.target.value] ?? 1;
  save(); renderAll();
};
$('#change-item').onclick = () => { if (confirm('Changer d\'objet ? L\'objet en cours sera perdu.')) { S = blank(); save(); renderAll(); } };

// ---- Vue FM : conseil ---------------------------------------------------------
$('#top-select').onchange = e => { S.settings.top = Number(e.target.value); save(); };
$('#samples-select').onchange = e => { S.settings.samples = Number(e.target.value); save(); };
$('#advise').onclick = () => computeAdvice();

function computeAdvice() {
  const out = $('#advice-out');
  if (!Object.keys(S.target).length) { out.innerHTML = '<p class="muted small">Renseigne au moins une cible dans la vue Objet.</p>'; return; }
  out.innerHTML = '<p class="muted small">Calcul…</p>';
  setTimeout(() => {
    lastAdvice = Search.nextBestMoves(state(), S.target, { samples: Math.round(S.settings.samples / 3), top: S.settings.top, seed: Date.now() & 0xffff });
    if (!lastAdvice.reached && lastAdvice.moves.length) pending = lastAdvice.moves[0].rune;
    renderAdvice(); renderPose();
  }, 20);
}

function renderAdvice() {
  const out = $('#advice-out'); const res = lastAdvice;
  if (!res) { out.innerHTML = '<p class="muted small">Clique « Calculer » pour obtenir le prochain coup.</p>'; return; }
  if (res.reached) { out.innerHTML = '<p class="ok">Cible atteinte sur toutes les lignes.</p>'; return; }
  if (!res.moves.length) { out.innerHTML = '<p class="muted small">Aucune rune posable sur les lignes cibles (plafonds atteints ?).</p>'; return; }
  const note = res.heavyFirst ? `<p class="warn small">Exo lourd en attente : à poser avant tout le reste, chaque échec détruit jusqu'à ${res.moves[0].rune.weight} de poids sur l'objet.</p>` : '';
  out.innerHTML = note + `<div class="advice">${res.moves.map(m => {
    const on = pending && pending.stat === m.rune.stat && pending.tier === m.rune.tier;
    return `<div class="move ${on ? 'on' : ''}" data-rune="${m.rune.stat}:${m.rune.tier}">
      <div class="h"><strong>${esc(m.rune.name)}</strong>${oddsText(m.odds)}</div>
      <div class="sub">+${m.rune.bonus} ${esc(labelOf(m.rune.stat))}</div>
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
    ? `<strong>${esc(pending.name)}</strong> <span class="muted small">pose impossible (${o.blocked === 'line-cap' ? 'plafond de la ligne' : 'plafond over+exo'})</span>`
    : `<strong>${esc(pending.name)}</strong> <span class="muted small">+${pending.bonus} ${esc(labelOf(pending.stat))} · poids ${pending.weight}${o.half ? ' (÷2)' : ''}</span><br>${oddsText(o)}`;
  $$('#pose button[data-outcome]').forEach(b => b.disabled = !!o.blocked);
  $('#simulate').disabled = !!o.blocked;
  // sélecteur manuel
  const present = S.item.lines.map(l => l.stat);
  const others = STATS.map(s => s.key).filter(k => !present.includes(k));
  const opt = k => `<option value="${k}" ${k === pending.stat ? 'selected' : ''}>${esc(labelOf(k))}</option>`;
  $('#rune-stat').innerHTML = `<optgroup label="Sur l'objet">${present.map(opt).join('')}</optgroup><optgroup label="Exo">${others.map(opt).join('')}</optgroup>`;
  const st = STAT_BY_KEY[pending.stat];
  $('#rune-tiers').innerHTML = st.tiers.map(([name, bonus], k) => `<button class="small ${k === pending.tier ? 'on' : ''}" data-tier="${k}">${esc(name)} +${bonus}</button>`).join('');
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
    const locked = i === d.t && d.outcome === 'SN'; // en SN la ligne posée ne perd jamais
    if (l.value - n <= floor && !n && !locked) return '';   // rien à retirer
    const canDrop = !locked && l.value - n > floor;
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

function commit({ rune, outcome, lines, reliquat, changes, simulated = false, gap = 0, reliquatBefore = S.reliquat }) {
  S.history.push({ id: Date.now(), rune: { stat: rune.stat, tier: rune.tier, name: rune.name }, outcome, changes,
                   reliquatDelta: w1(reliquat - reliquatBefore), simulated, gap,
                   before: { lines: S.item.lines.map(l => ({ ...l })), reliquat: reliquatBefore, reliquatBefore: S.reliquatBefore } });
  S.item.lines = lines.filter(l => l.min != null || l.value > 0);
  S.reliquat = reliquat;
  S.reliquatBefore = reliquat;
  save(); renderLossPanel(); renderAll();
  if (S.settings.view === 'fm' && Object.keys(S.target).length) computeAdvice();
}

// ---- Historique ---------------------------------------------------------------
function renderHistory() {
  const h = S.history;
  const n = { SC: 0, SN: 0, EC: 0 }; h.forEach(e => n[e.outcome]++);
  $('#history-stats').textContent = h.length ? `${h.length} · ${n.SC} SC · ${n.SN} SN · ${n.EC} EC` : '';
  $('#undo').disabled = !h.length;
  $('#history-list').innerHTML = [...h].reverse().slice(0, 12).map(e => {
    const ch = e.changes.map(c => `${c.delta > 0 ? '+' : ''}${c.delta} ${esc(labelOf(c.stat))}`).join(', ');
    const rel = e.reliquatDelta ? ` · reliquat ${e.reliquatDelta > 0 ? '+' : ''}${e.reliquatDelta}` : '';
    return `<li><span class="tag ${e.outcome}">${e.outcome}</span>${esc(e.rune.name)}${e.simulated ? ' <span class="muted small">(simulé)</span>' : ''} <span class="muted small">${ch || 'rien ne bouge'}${rel}${e.gap ? ` · écart ${e.gap}` : ''}</span></li>`;
  }).join('');
}
$('#undo').onclick = () => {
  const e = S.history.pop(); if (!e) return;
  S.item.lines = e.before.lines; S.reliquat = e.before.reliquat; S.reliquatBefore = e.before.reliquatBefore ?? e.before.reliquat; lastAdvice = null; save(); renderAll();
};
$('#reset').onclick = () => {
  if (!confirm('Remettre toutes les lignes à zéro et vider l\'historique ?')) return;
  S.item.lines = S.item.lines.filter(l => l.min != null).map(l => ({ ...l, value: 0 }));
  S.reliquat = 0; S.reliquatBefore = 0; S.history = []; lastAdvice = null; save(); renderAll();
};

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
