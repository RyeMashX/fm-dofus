// Moteur de forgemagie : probabilités d'une pose et mécanisme de pertes.
// Traduction lisible du moteur DoFocus (voir dofocus-engine-extrait.js), validée
// contre les lectures du simulateur du 2026-11-02.
//
// Modèle de données
//   line  = { stat, value, min, max }   min/max = null pour une ligne hors template (exo)
//   item  = { level, lines: [line] }
//   state = { item, reliquat }
//   rune  = { stat, bonus, weight }     weight = poids total de la rune (bonus × poids/point)

import { STAT_BY_KEY } from './stats.js';

const P = {
  LEVEL_BONUS_BELOW: 170,   // objets < 170 : bonus de difficulté
  LINE_CAP: 101,            // poids max d'une ligne et de la charge over+exo de l'objet
  STEP_POSITION: 0.8,       // palier des 80 % (position après pose dans [min, max])
  STEP: 45,
  OVER_BASE: 65, OVER_PER_WEIGHT: 4,
  RATIO_START: 14, RATIO_SLOPE: 12,
  QUALITY_COEF: 60, QUALITY_EXP: 12,
  BASE: 5,
  SC_FLOOR: 2, SN_FLOOR: 15, SN_FLOOR_OVER: 5, SN_SLOPE: 0.375,
  NEGATIVE_HALF: 0.5,       // rune posée sur une ligne qui reste négative : demi-poids
  // pertes
  HIT_COEF: 0.75, HIT_EXP: 0.85,
  TARGET_HIT_FACTOR: 1 / 3, // ligne cible en over, touchable seulement en EC
  TARGET_PICK_FACTOR: 1 / 60,
};
const EPS = 1e-9;
const round2 = x => Math.round(x * 100) / 100;
const hasTemplate = l => Number.isFinite(l?.min) && Number.isFinite(l?.max);
const range = l => [Math.min(l.min, l.max), Math.max(l.min, l.max)];
const weightOf = l => STAT_BY_KEY[l.stat].weight;

// Qualité de l'objet hors ligne d'index t : poids présent / poids max, lignes du template à max ≥ 0.
function quality(lines, t) {
  let w = 0, m = 0;
  lines.forEach((l, i) => {
    if (i === t || !hasTemplate(l)) return;
    const [, hi] = range(l);
    if (hi < 0) return;
    const pw = weightOf(l);
    w += pw * Math.min(Math.max(0, l.value), hi);
    m += pw * hi;
  });
  return m > 0 ? w / m : 0;
}

function difficulty({ position = 0, over = false, overWeight = 0, ratio = 0, quality = 0, level = 200, step = true }) {
  let d = P.BASE + P.RATIO_SLOPE * Math.max(0, ratio - P.RATIO_START) + P.QUALITY_COEF * quality ** P.QUALITY_EXP;
  if (over) d += P.OVER_BASE + P.OVER_PER_WEIGHT * Math.max(0, overWeight);
  else if (step && position >= P.STEP_POSITION - EPS) d += P.STEP;
  if (level < P.LEVEL_BONUS_BELOW) d -= 20 * Math.max(0, 1.1 - quality);
  return d;
}

function outcomesFromDifficulty(d, over) {
  const sc = Math.max(P.SC_FLOOR, (100 - d) / 2);
  let sn = over ? Math.max(P.SN_FLOOR_OVER, 40 - P.SN_SLOPE * (d - 100))
         : d <= 100 ? Math.min(50, 100 - sc) : Math.max(P.SN_FLOOR, 50 - P.SN_SLOPE * (d - 100));
  sn = Math.min(Math.max(sn, 0), 100 - sc);
  return { sc, sn, ec: 100 - sc - sn };
}

// Régime exo : ne dépend que du poids final de la ligne.
function exoOutcomes(stat, finalWeight) {
  if (STAT_BY_KEY[stat].heavyExo) return { sc: 1, sn: 0, ec: 99 };
  let s = 0;
  if (finalWeight <= 2) s = 57;
  else if (finalWeight <= 15) s = 57 - (finalWeight - 2) * 38 / 13;
  else if (finalWeight < 25) s = 19 - (finalWeight - 15) * 1.9;
  const sc = Math.max(1, 0.077 * s), sn = 0.923 * s;
  return { sc, sn, ec: 100 - sc - sn };
}

// Plafond d'une ligne : max(max du template, floor(101 / poids par point)).
function lineCap(line, pw) {
  const n = Math.floor(P.LINE_CAP / pw + EPS);
  return hasTemplate(line) ? Math.max(range(line)[1], n) : n;
}

// Charge over + exo de l'objet.
function overLoad(lines) {
  return lines.reduce((acc, l) => {
    if (!(l.value > 0)) return acc;
    const pw = weightOf(l);
    return acc + (hasTemplate(l) ? Math.max(0, l.value - range(l)[1]) * pw : l.value * pw);
  }, 0);
}

// Probabilités d'une pose. Retourne { blocked } ou { sc, sn, ec, regime, difficulty, ... }.
function odds(item, rune) {
  const lines = item.lines;
  const t = lines.findIndex(l => l.stat === rune.stat);
  const line = t >= 0 ? lines[t] : null;
  const pw = STAT_BY_KEY[rune.stat].weight;
  const cur = line ? line.value : 0;
  const cap = lineCap(line || {}, pw);
  if (cur + rune.bonus > cap) return { blocked: 'line-cap', limit: cap };
  const after = t >= 0 ? lines.map((l, i) => i === t ? { ...l, value: cur + rune.bonus } : l)
                       : [...lines, { stat: rune.stat, value: rune.bonus, min: null, max: null }];
  if (overLoad(after) > P.LINE_CAP + EPS) return { blocked: 'item-cap', limit: cap, load: round2(overLoad(lines)) };

  const q = quality(lines, t);
  if (!line || !hasTemplate(line)) {
    return { ...exoOutcomes(rune.stat, (cur + rune.bonus) * pw), regime: 'exo', quality: q, limit: cap };
  }
  const [lo, hi] = range(line);
  const over = cur + rune.bonus > hi;
  const fixed = hi === lo;
  const position = fixed ? 1 : (cur + rune.bonus - lo) / (hi - lo);
  const exoPa = lines.some(l => STAT_BY_KEY[l.stat].forcesQuality && !hasTemplate(l) && l.value > 0);
  const params = {
    position, over, quality: exoPa ? 1 : q, level: item.level ?? 200,
    overWeight: over ? (cur + rune.bonus - hi) * pw : 0,
    ratio: cur / rune.bonus, step: !fixed,
  };
  const d = difficulty(params);
  const regime = over ? 'over' : fixed ? 'repass' : position >= P.STEP_POSITION - EPS ? 'step' : 'normal';
  return { ...outcomesFromDifficulty(d, over), regime, difficulty: d, quality: params.quality,
           position, overWeight: params.overWeight, ratio: params.ratio, limit: cap,
           half: cur + rune.bonus < 0, exoPa };
}

// ---- Pertes ------------------------------------------------------------

const hitProb = x => Math.min(1, P.HIT_COEF * Math.max(0, x) ** P.HIT_EXP);

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Tirage pondéré d'une ligne normale : poids min(1, runeWeight / poids_ligne), ×1/60 pour la cible.
function pickLine(candidates, runeWeight, lines, rng, t) {
  const w = candidates.map(i => Math.min(1, runeWeight / weightOf(lines[i])) * (i === t ? P.TARGET_PICK_FACTOR : 1));
  let r = rng() * w.reduce((a, b) => a + b, 0);
  for (let k = 0; k < candidates.length; k++) { r -= w[k]; if (r < 0) return candidates[k]; }
  return candidates[candidates.length - 1];
}

// Applique une perte de poids `loss` sur `lines` (mutées), ligne cible t, reliquat r.
function applyLoss(lines, t, loss, reliquat, rng, { failure = false } = {}) {
  const changes = new Map();
  const dec = (i, n) => { lines[i] = { ...lines[i], value: lines[i].value - n }; changes.set(i, (changes.get(i) || 0) - n); };
  const allowed = i => i !== t || (failure && lines[i].value > 0);
  const isOver = i => hasTemplate(lines[i]) ? lines[i].value > range(lines[i])[1] : lines[i].value > 0;
  let f = loss;
  const hitOver = (i, factor) => {
    const l = lines[i], g = weightOf(l) * (l.value < 0 ? P.NEGATIVE_HALF : 1);
    // ligne du template en over : elle encaisse toujours (observé en jeu, sans exception) ; exo : formule DoFocus
    const sure = hasTemplate(l) && l.value > range(l)[1];
    if (!sure && rng() >= hitProb(loss / g) * factor) return;
    const avail = l.value > 0 ? l.value : l.value - range(l)[0];
    const n = Math.min(avail, Math.max(1, Math.ceil(f / g - EPS)));
    dec(i, n); f -= n * g;
  };
  // 1. over et exos (hors cible), ordre aléatoire
  for (const i of shuffle(lines.map((_, i) => i).filter(i => i !== t && isOver(i)), rng)) {
    if (f <= EPS) break;
    hitOver(i, 1);
  }
  // 2. reliquat
  if (f > EPS && reliquat > 0) { const v = Math.min(reliquat, f); reliquat -= v; f -= v; }
  // 3. cible en over, seulement en EC
  if (f > EPS && lines[t] && allowed(t) && isOver(t)) hitOver(t, P.TARGET_HIT_FACTOR);
  // 4. lignes normales, tirage pondéré, jusqu'à épuisement
  while (f > EPS) {
    const cands = lines.map((_, i) => i).filter(i => allowed(i) && hasTemplate(lines[i]) && lines[i].value > 0);
    if (!cands.length) break;
    const i = pickLine(cands, loss, lines, rng, t);
    const pw = weightOf(lines[i]);
    const maxN = Math.min(lines[i].value, Math.max(1, Math.ceil(f / pw - EPS)));
    const n = maxN === 1 ? 1 : 1 + Math.floor(rng() * maxN);
    dec(i, n); f -= n * pw;
  }
  // 5. dernier recours : la cible
  if (f > EPS && lines[t] && lines[t].value > 0) {
    const pw = weightOf(lines[t]);
    const n = Math.min(lines[t].value, Math.max(1, Math.ceil(f / pw - EPS)));
    dec(t, n); f -= n * pw;
  }
  if (f < -EPS) reliquat += -f;
  return { lines, reliquat: round2(Math.max(0, reliquat)), changes };
}

// Une pose complète. Retourne le nouvel état + outcome + changes [{stat, delta}].
function applyMove(state, rune, rng = Math.random, forcedOutcome = null) {
  const o = odds(state.item, rune);
  if (o.blocked) return { ...state, outcome: null, odds: o, changes: [] };
  let outcome = forcedOutcome;
  if (!outcome) { const r = rng() * 100; outcome = r < o.sc ? 'SC' : r < o.sc + o.sn ? 'SN' : 'EC'; }
  const lines = state.item.lines.map(l => ({ ...l }));
  let t = lines.findIndex(l => l.stat === rune.stat);
  const changes = new Map();
  if (outcome !== 'EC') {
    if (t < 0) { lines.push({ stat: rune.stat, value: 0, min: null, max: null }); t = lines.length - 1; }
    lines[t] = { ...lines[t], value: lines[t].value + rune.bonus };
    changes.set(t, rune.bonus);
  }
  let reliquat = state.reliquat;
  if (outcome !== 'SC') {
    const before = t >= 0 ? state.item.lines[t] : null;
    const loss = rune.weight * (before && before.value + rune.bonus < 0 ? P.NEGATIVE_HALF : 1);
    const res = applyLoss(lines, t, loss, reliquat, rng, { failure: outcome === 'EC' });
    reliquat = res.reliquat;
    for (const [i, d] of res.changes) changes.set(i, (changes.get(i) || 0) + d);
  }
  return {
    item: { ...state.item, lines }, reliquat, outcome, odds: o,
    reliquatDelta: round2(reliquat - state.reliquat),
    changes: [...changes].filter(([, d]) => d).map(([i, d]) => ({ stat: lines[i].stat, delta: d })),
  };
}

// Affichage à la DoFocus : 1 décimale sous 10, entier au-delà.
const fmt = x => (x >= 10 || x === 0) ? Math.round(x) : Math.round(x * 10) / 10;

export { P, quality, difficulty, outcomesFromDifficulty, exoOutcomes, odds, applyLoss, applyMove, overLoad, lineCap, fmt };
