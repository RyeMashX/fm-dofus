// Interface : objet, cible, conseil, saisie des poses, historique. Vanilla JS, pas de framework.
import * as FM from './engine.js';
import * as Search from './search.js';
import { STATS, STAT_BY_KEY, RUNES } from './stats.js';
import { searchItems, iconUrl, labelOf } from './dofusdb.js';

const $ = sel => document.querySelector(sel);
const KEY = 'fm-dofus:state';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = x => FM.fmt(x).toString().replace('.', ',');
const w1 = x => Math.round(x * 100) / 100;

// ---- État --------------------------------------------------------------------
let S = load() || blank();
let pending = { stat: null, tier: 0 };   // rune sélectionnée pour la pose
let lossDraft = null;                     // saisie des pertes en cours

function blank() {
  return { template: null, item: null, reliquat: 0, target: {}, history: [], settings: { top: 1, samples: 1500 } };
}
function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} }
const state = () => ({ item: S.item, reliquat: S.reliquat });

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
      ul.innerHTML = items.map((t, i) => `<li data-i="${i}"><img src="${esc(iconUrl(t))}" alt=""><span>${esc(t.name)}</span><span class="muted small">niv. ${t.level} · ${esc(t.type)}</span></li>`).join('')
        || '<li class="muted">Aucun résultat</li>';
      ul.querySelectorAll('li[data-i]').forEach(li => li.onclick = () => useTemplate(items[+li.dataset.i]));
      setStatus('');
    } catch (err) { setStatus('DofusDB injoignable : saisis l\'objet à la main.'); }
  }, 250);
});

$('#manual-item').onclick = () => useTemplate({ id: null, name: 'Objet manuel', level: 200, type: '', lines: [], unknown: [] });

function useTemplate(t) {
  S = blank();
  S.template = t;
  S.item = { level: t.level, lines: t.lines.map(l => ({ stat: l.stat, value: 0, min: l.min, max: l.max })) };
  S.target = {};
  pending = { stat: S.item.lines[0]?.stat ?? null, tier: 0 };
  $('#search-results').innerHTML = ''; $('#search-input').value = '';
  save(); renderAll();
}

// ---- Rendu de l'objet ---------------------------------------------------------
function renderAll() {
  const has = !!S.item;
  ['#item', '#advice', '#pose', '#history'].forEach(s => $(s).classList.toggle('hidden', !has));
  $('#search').classList.toggle('hidden', has);
  if (!has) return;
  renderItem(); renderPoseSelector(); renderHistory();
  $('#top-select').value = String(S.settings.top);
  const ss = $('#samples-select'); ss.value = String(S.settings.samples);
  if (!ss.value) { ss.value = '1500'; S.settings.samples = 1500; }
}

function renderItem() {
  const t = S.template;
  $('#item-name').textContent = t.name;
  $('#item-meta').textContent = [t.type, t.unknown?.length ? `${t.unknown.length} effet(s) non gérés ignorés` : ''].filter(Boolean).join(' · ');
  $('#item-icon').src = iconUrl(t) || ''; $('#item-icon').classList.toggle('hidden', !iconUrl(t));
  $('#item-level').value = S.item.level;
  $('#reliquat').value = S.reliquat;
  const rows = S.item.lines.map((l, i) => {
    const st = STAT_BY_KEY[l.stat];
    const exo = l.min == null;
    const tgt = S.target[l.stat];
    const done = tgt != null && l.value >= tgt;
    const odds = st.tiers.map((tier, k) => {
      const o = FM.odds(S.item, RUNES.find(r => r.stat === l.stat && r.tier === k));
      return o.blocked ? `<span class="muted" title="${o.blocked === 'line-cap' ? 'plafond de la ligne' : 'plafond over+exo de l\'objet'}">MAX</span>`
                       : `<b title="SC">${pct(o.sc)}</b>/<i title="SN">${pct(o.sn)}</i>/<s title="EC">${pct(o.ec)}</s>`;
    }).join(' &nbsp; ');
    return `<tr class="${done ? 'done' : ''} ${exo ? 'exo' : ''} ${l.max < 0 ? 'neg' : ''}" data-i="${i}">
      <td class="stat">${esc(st.label)}</td>
      <td class="num muted">${exo ? '' : `${l.min} – ${l.max}`}</td>
      <td class="num"><input class="num small" type="number" data-field="value" value="${l.value}"></td>
      <td class="num"><input class="num small" type="number" data-field="target" value="${tgt ?? ''}" placeholder="–"></td>
      <td class="num muted small">${w1(Math.max(0, l.value) * st.weight)}</td>
      <td class="odds">${odds}</td>
      <td>${exo ? '<button class="link small" data-del="1">retirer</button>' : ''}</td>
    </tr>`;
  }).join('');
  $('#lines').innerHTML = `<thead><tr><th>Ligne</th><th class="num">Jet</th><th class="num">Actuel</th><th class="num">Cible</th><th class="num">Poids</th><th>SC / SN / EC par rune (Rune · Pa · Ra)</th><th></th></tr></thead><tbody>${rows}</tbody>`;
  $('#lines').querySelectorAll('input').forEach(inp => inp.onchange = onLineEdit);
  $('#lines').querySelectorAll('button[data-del]').forEach(b => b.onclick = () => {
    const i = +b.closest('tr').dataset.i; const stat = S.item.lines[i].stat;
    S.item.lines.splice(i, 1); delete S.target[stat]; save(); renderAll();
  });
  const present = new Set(S.item.lines.map(l => l.stat));
  $('#exo-select').innerHTML = '<option value="">+ Ajouter un exo…</option>' +
    STATS.filter(s => !present.has(s.key)).map(s => `<option value="${s.key}">${esc(s.label)}</option>`).join('');
}

function onLineEdit(e) {
  const tr = e.target.closest('tr'); const i = +tr.dataset.i; const l = S.item.lines[i];
  const v = e.target.value === '' ? null : Number(e.target.value);
  if (e.target.dataset.field === 'value') l.value = v ?? 0;
  else { if (v == null) delete S.target[l.stat]; else S.target[l.stat] = v; }
  save(); renderItem(); renderPoseSelector();
}
$('#item-level').onchange = e => { S.item.level = Number(e.target.value) || 200; save(); renderItem(); renderPoseSelector(); };
$('#reliquat').onchange = e => { S.reliquat = Math.max(0, Number(e.target.value) || 0); save(); };
$('#exo-select').onchange = e => {
  if (!e.target.value) return;
  S.item.lines.push({ stat: e.target.value, value: 0, min: null, max: null });
  S.target[e.target.value] = S.target[e.target.value] ?? 1;
  save(); renderAll();
};
$('#change-item').onclick = () => { if (confirm('Changer d\'objet ? L\'objet en cours sera perdu.')) { S = blank(); save(); renderAll(); } };

// ---- Conseil ------------------------------------------------------------------
$('#top-select').onchange = e => { S.settings.top = Number(e.target.value); save(); };
$('#samples-select').onchange = e => { S.settings.samples = Number(e.target.value); save(); };
$('#advise').onclick = () => {
  const out = $('#advice-out');
  if (!Object.keys(S.target).length) { out.innerHTML = '<p class="muted">Renseigne au moins une cible (colonne « Cible »).</p>'; return; }
  out.innerHTML = '<p class="muted">Calcul…</p>';
  setTimeout(() => {
    const res = Search.nextBestMoves(state(), S.target, { samples: Math.round(S.settings.samples / 3), top: S.settings.top, seed: Date.now() & 0xffff });
    if (res.reached) { out.innerHTML = '<p class="ok">Cible atteinte sur toutes les lignes.</p>'; return; }
    if (!res.moves.length) { out.innerHTML = '<p class="muted">Aucune rune posable sur les lignes cibles (plafonds atteints ?).</p>'; return; }
    const note = res.heavyFirst ? `<p class="warn small">Exo lourd en attente : il se pose avant tout le reste, chaque échec détruit jusqu'à ${res.moves[0].rune.weight} de poids sur l'objet. Les autres lignes attendront qu'il soit passé.</p>` : '';
    out.innerHTML = `${note}<div class="advice">${res.moves.map((m, k) => moveCard(m, k === 0)).join('')}</div>
      <p class="muted small">Poses restantes estimées avant ce coup : ${res.h0.toFixed(1)}. Les chances sont celles du modèle, l'estimation du nombre de poses est indicative.</p>`;
    out.querySelectorAll('button[data-rune]').forEach(b => b.onclick = () => {
      const [stat, tier] = b.dataset.rune.split(':'); pending = { stat, tier: +tier }; renderPoseSelector();
      $('#pose').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, 20);
};

function moveCard(m, best) {
  const o = m.odds;
  return `<div class="move ${best ? 'best' : ''}">
    <h3>${esc(m.rune.name)} <span class="muted small">+${m.rune.bonus} ${esc(labelOf(m.rune.stat))}</span></h3>
    <div class="bar"><span style="width:${o.sc}%;background:var(--sc)"></span><span style="width:${o.sn}%;background:var(--sn)"></span><span style="width:${o.ec}%;background:var(--ec)"></span></div>
    <div class="odds"><b>SC ${pct(o.sc)} %</b> · <i>SN ${pct(o.sn)} %</i> · <s>EC ${pct(o.ec)} %</s></div>
    <dl>
      <dt>Poses restantes après ce coup</dt><dd>${m.score.toFixed(1)}</dd>
      <dt>Risque d'abîmer une ligne cible</dt><dd class="${m.pHurtTarget > 0.3 ? 'target-hit' : ''}">${Math.round(m.pHurtTarget * 100)} %</dd>
      <dt>Poids perdu en moyenne sur les cibles</dt><dd>${m.expLossOnTarget.toFixed(1)}</dd>
    </dl>
    <button class="${best ? 'primary' : 'secondary'}" data-rune="${m.rune.stat}:${m.rune.tier}">Choisir cette rune</button>
  </div>`;
}

// ---- Pose ---------------------------------------------------------------------
function renderPoseSelector() {
  const sel = $('#rune-stat');
  const present = S.item.lines.map(l => l.stat);
  const others = STATS.map(s => s.key).filter(k => !present.includes(k));
  const opt = k => `<option value="${k}" ${k === pending.stat ? 'selected' : ''}>${esc(labelOf(k))}</option>`;
  sel.innerHTML = `<optgroup label="Sur l'objet">${present.map(opt).join('')}</optgroup><optgroup label="Exo">${others.map(opt).join('')}</optgroup>`;
  if (!pending.stat) pending.stat = present[0] || others[0];
  sel.value = pending.stat;
  const st = STAT_BY_KEY[pending.stat];
  if (pending.tier >= st.tiers.length) pending.tier = 0;
  $('#rune-tiers').innerHTML = st.tiers.map(([name, bonus], k) => `<button class="${k === pending.tier ? 'on' : ''}" data-tier="${k}">${esc(name)} <span class="small">+${bonus}</span></button>`).join('');
  $('#rune-tiers').querySelectorAll('button').forEach(b => b.onclick = () => { pending.tier = +b.dataset.tier; renderPoseSelector(); });
  const rune = currentRune();
  const o = FM.odds(S.item, rune);
  $('#rune-odds').innerHTML = o.blocked ? `<span class="muted">Pose impossible (${o.blocked === 'line-cap' ? 'plafond de la ligne' : 'plafond over+exo de l\'objet'})</span>`
    : `<b>SC ${pct(o.sc)} %</b> · <i>SN ${pct(o.sn)} %</i> · <s>EC ${pct(o.ec)} %</s> <span class="muted small">· poids ${rune.weight}${o.half ? ' (÷2 : ligne négative)' : ''} · difficulté ${o.difficulty != null ? Math.round(o.difficulty) : 'exo'}</span>`;
  $('#pose').querySelectorAll('button[data-outcome]').forEach(b => b.disabled = !!o.blocked);
  $('#simulate').disabled = !!o.blocked;
}
$('#rune-stat').onchange = e => { pending = { stat: e.target.value, tier: 0 }; renderPoseSelector(); };
const currentRune = () => RUNES.find(r => r.stat === pending.stat && r.tier === pending.tier);

$('#pose').querySelectorAll('button[data-outcome]').forEach(b => b.onclick = () => startOutcome(b.dataset.outcome));
$('#simulate').onclick = () => {
  const r = FM.applyMove(state(), currentRune(), Math.random);
  if (!r.outcome) return;
  commit({ rune: currentRune(), outcome: r.outcome, lines: r.item.lines, reliquat: r.reliquat, changes: r.changes, simulated: true });
};

function startOutcome(outcome) {
  const rune = currentRune();
  if (outcome === 'SC') {
    const r = FM.applyMove(state(), rune, Math.random, 'SC');
    commit({ rune, outcome, lines: r.item.lines, reliquat: r.reliquat, changes: r.changes });
    return;
  }
  // SN ou EC : bonus appliqué (SN), puis saisie des pertes guidée par le reliquat.
  const lines = S.item.lines.map(l => ({ ...l }));
  let t = lines.findIndex(l => l.stat === rune.stat);
  const before = t >= 0 ? S.item.lines[t] : null;
  const half = before && before.value + rune.bonus < 0;
  if (outcome === 'SN') {
    if (t < 0) { lines.push({ stat: rune.stat, value: 0, min: null, max: null }); t = lines.length - 1; }
    lines[t].value += rune.bonus;
  }
  lossDraft = { rune, outcome, lines, t, lossWeight: rune.weight * (half ? 0.5 : 1), newReliquat: S.reliquat, deltas: {} };
  renderLossPanel();
}

function renderLossPanel() {
  const d = lossDraft; const p = $('#loss-panel');
  if (!d) { p.classList.add('hidden'); p.innerHTML = ''; return; }
  p.classList.remove('hidden');
  const lost = Object.entries(d.deltas).reduce((a, [stat, n]) => a + n * STAT_BY_KEY[stat].weight, 0);
  const expected = d.lossWeight + (d.newReliquat - S.reliquat);
  const gap = w1(lost - expected);
  const rows = d.lines.map((l, i) => {
    const n = d.deltas[l.stat] || 0;
    const lockedTarget = i === d.t && d.outcome === 'SN'; // en SN la ligne posée ne perd jamais
    const canDrop = !lockedTarget && (l.value - n > (l.min != null && l.min < 0 ? l.min : 0));
    return `<tr><td>${esc(labelOf(l.stat))}${i === d.t ? ' <span class="muted small">(ligne posée)</span>' : ''}</td>
      <td class="num">${l.value - n}</td>
      <td><button data-minus="${l.stat}" ${canDrop ? '' : 'disabled'}>−1</button> <button data-minus5="${l.stat}" ${canDrop ? '' : 'disabled'}>−5</button> <button data-plus="${l.stat}" ${n > 0 ? '' : 'disabled'}>+</button></td>
      <td class="num"><span class="delta">${n ? '−' + n : ''}</span> <span class="muted small">${n ? '(' + w1(n * STAT_BY_KEY[l.stat].weight) + ')' : ''}</span></td></tr>`;
  }).join('');
  p.innerHTML = `<div class="loss">
    <div class="row"><strong>${esc(d.rune.name)} en ${d.outcome === 'SN' ? 'succès neutre' : 'échec critique'}</strong>
      <span class="muted small">poids à perdre ${d.lossWeight}</span><div class="spacer"></div>
      <label class="inline">Nouveau reliquat <input id="loss-reliquat" class="num" type="number" min="0" step="0.1" value="${d.newReliquat}"></label></div>
    <table><thead><tr><th>Ligne</th><th class="num">Valeur</th><th>Retirer</th><th class="num">Perte (poids)</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="row">
      <span class="${Math.abs(gap) < 0.01 ? 'ok' : 'warn'}">Poids retiré ${w1(lost)} · attendu ${w1(expected)} (poids de la rune ${d.lossWeight} ${d.newReliquat - S.reliquat >= 0 ? '+' : '−'} ${w1(Math.abs(d.newReliquat - S.reliquat))} de reliquat)${Math.abs(gap) < 0.01 ? ' : cohérent' : ` : écart ${gap > 0 ? '+' : ''}${gap}`}</span>
      <div class="spacer"></div>
      <button id="loss-cancel" class="secondary">Annuler</button>
      <button id="loss-ok" class="primary">Valider la pose</button>
    </div></div>`;
  $('#loss-reliquat').onchange = e => { d.newReliquat = Math.max(0, Number(e.target.value) || 0); renderLossPanel(); };
  p.querySelectorAll('button[data-minus]').forEach(b => b.onclick = () => bump(b.dataset.minus, 1));
  p.querySelectorAll('button[data-minus5]').forEach(b => b.onclick = () => bump(b.dataset.minus5, 5));
  p.querySelectorAll('button[data-plus]').forEach(b => b.onclick = () => bump(b.dataset.plus, -1));
  $('#loss-cancel').onclick = () => { lossDraft = null; renderLossPanel(); };
  $('#loss-ok').onclick = () => {
    const changes = [];
    if (d.outcome === 'SN') changes.push({ stat: d.rune.stat, delta: d.rune.bonus });
    const lines = d.lines.map(l => ({ ...l, value: l.value - (d.deltas[l.stat] || 0) }));
    for (const [stat, n] of Object.entries(d.deltas)) if (n) changes.push({ stat, delta: -n });
    commit({ rune: d.rune, outcome: d.outcome, lines, reliquat: d.newReliquat, changes, gap });
    lossDraft = null; renderLossPanel();
  };
}
function bump(stat, n) {
  const d = lossDraft; const l = d.lines.find(x => x.stat === stat);
  const floor = l.min != null && l.min < 0 ? l.min : 0;
  d.deltas[stat] = Math.max(0, Math.min(l.value - floor, (d.deltas[stat] || 0) + n));
  renderLossPanel();
}

function commit({ rune, outcome, lines, reliquat, changes, simulated = false, gap = 0 }) {
  S.history.push({ id: Date.now(), rune: { stat: rune.stat, tier: rune.tier, name: rune.name }, outcome, changes,
                   reliquatDelta: w1(reliquat - S.reliquat), simulated, gap,
                   before: { lines: S.item.lines.map(l => ({ ...l })), reliquat: S.reliquat } });
  S.item.lines = lines.filter(l => l.min != null || l.value > 0);
  S.reliquat = reliquat;
  save(); renderAll();
  $('#advice-out').innerHTML = '';
}

// ---- Historique ---------------------------------------------------------------
function renderHistory() {
  const h = S.history;
  const n = { SC: 0, SN: 0, EC: 0 }; h.forEach(e => n[e.outcome]++);
  $('#history-stats').textContent = h.length ? `${h.length} poses · ${n.SC} SC · ${n.SN} SN · ${n.EC} EC` : '';
  $('#undo').disabled = !h.length;
  $('#history-list').innerHTML = [...h].reverse().map(e => {
    const ch = e.changes.map(c => `${c.delta > 0 ? '+' : ''}${c.delta} ${esc(labelOf(c.stat))}`).join(', ');
    const rel = e.reliquatDelta ? ` · reliquat ${e.reliquatDelta > 0 ? '+' : ''}${e.reliquatDelta}` : '';
    return `<li><span class="tag ${e.outcome}">${e.outcome}</span>${esc(e.rune.name)}${e.simulated ? ' <span class="muted small">(simulé)</span>' : ''} <span class="muted">${ch || 'rien ne bouge'}${rel}${e.gap ? ` · écart ${e.gap}` : ''}</span></li>`;
  }).join('');
}
$('#undo').onclick = () => {
  const e = S.history.pop(); if (!e) return;
  S.item.lines = e.before.lines; S.reliquat = e.before.reliquat; save(); renderAll();
};
$('#reset').onclick = () => {
  if (!confirm('Remettre toutes les lignes à zéro et vider l\'historique ?')) return;
  S.item.lines = S.item.lines.filter(l => l.min != null).map(l => ({ ...l, value: 0 }));
  S.reliquat = 0; S.history = []; save(); renderAll();
};

function setStatus(msg) { $('#status').textContent = msg; }

renderAll();
