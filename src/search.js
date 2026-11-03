// Recherche du meilleur coup : cible = minimums par ligne, coût = nombre de poses.
//
// 1. Tables par ligne cible : espérance E[v] du nombre de poses pour amener la ligne de la valeur v
//    à la cible, calculée par programmation dynamique (valeur par valeur, meilleure rune à chaque
//    valeur) à partir des probabilités du moteur, avec un coût de casse collatérale par tentative.
// 2. Pour chaque rune candidate : on simule N trajectoires de H poses (la rune, puis une politique
//    gloutonne fondée sur les tables), et on mesure poses jouées + estimation du reste (Σ E).
// Le coup retenu minimise cette espérance.

import * as FM from './engine.js';
import { STAT_BY_KEY, RUNES } from './stats.js';

const BIG = 1000; // ligne bloquée : cible inatteignable en l'état
const HEAVY = 25; // poids à partir duquel une rune casse l'objet à chaque échec (PA, PM, PO, invo)

// Générateur pseudo-aléatoire déterministe (mulberry32) pour des résultats reproductibles.
export function rngFrom(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const lineOf = (item, stat) => item.lines.find(l => l.stat === stat);
const valueOf = (item, stat) => lineOf(item, stat)?.value ?? 0;

export function missing(item, target) {
  return Object.entries(target).map(([stat, min]) => ({ stat, missing: Math.max(0, min - valueOf(item, stat)) })).filter(m => m.missing > 0);
}
export function targetReached(item, target) { return missing(item, target).length === 0; }

// Poids présent sur l'objet et part de ce poids qui sert la cible.
function presentWeights(item, target) {
  let total = 0, onTarget = 0;
  for (const l of item.lines) {
    if (!(l.value > 0)) continue;
    const w = l.value * STAT_BY_KEY[l.stat].weight;
    total += w;
    if (l.stat in target && target[l.stat] > 0) onTarget += Math.min(w, target[l.stat] * STAT_BY_KEY[l.stat].weight);
  }
  return { total, onTarget };
}

// Copie de l'objet avec la ligne `stat` à la valeur v (créée en exo si absente, retirée si v ≤ 0 et exo).
function withValue(item, stat, v) {
  const i = item.lines.findIndex(l => l.stat === stat);
  if (i >= 0) return { ...item, lines: item.lines.map((l, k) => k === i ? { ...l, value: v } : l) };
  if (v <= 0) return item;
  return { ...item, lines: [...item.lines, { stat, value: v, min: null, max: null }] };
}

// Tables E[v] et choix de rune par valeur, pour chaque ligne cible, l'objet étant figé par ailleurs.
export function buildTables(state, target) {
  const { item, reliquat } = state;
  const pw = presentWeights(item, target);
  const share = pw.total > 0 ? pw.onTarget / pw.total : 0;
  // poids utile gagné par pose, au mieux, toutes lignes cibles confondues
  let wpp = 1;
  for (const { stat, missing: m } of missing(item, target)) for (const r of RUNES.filter(r => r.stat === stat)) {
    const o = FM.odds(item, r); if (o.blocked) continue;
    wpp = Math.max(wpp, Math.min(r.bonus, m) * STAT_BY_KEY[stat].weight * (o.sc + o.sn) / 100);
  }
  const tables = {};
  for (const [stat, t] of Object.entries(target)) {
    const line = lineOf(item, stat);
    const lo = Math.min(0, line?.min ?? 0);
    const E = new Map(), choice = new Map();
    const Eof = v => v >= t ? 0 : (E.get(v) ?? BIG);
    for (let v = t - 1; v >= lo; v--) {
      let best = BIG, bestRune = null;
      const it = withValue(item, stat, v);
      for (const r of RUNES.filter(r => r.stat === stat)) {
        const o = FM.odds(it, r);
        if (o.blocked) continue;
        const pass = (o.sc + o.sn) / 100;
        if (pass < 0.005) continue;
        // casse collatérale par tentative, en poses ; pour les runes lourdes (≥ 25) elle dépend de l'état
        // courant et se calcule dans estimateRemaining
        // casse collatérale par tentative, en poses ; pour une grosse ligne du template tombée (PM, PO…)
        // elle dépend de ce qui est posé au moment de l'évaluation : voir estimateRemaining
        const c = (line && line.min != null && r.weight >= HEAVY) ? 0
                : (1 - o.sc / 100) * Math.max(0, r.weight - reliquat) * share / wpp;
        const val = (1 + c + pass * Eof(Math.min(v + r.bonus, t))) / pass;
        if (val < best) { best = val; bestRune = r; }
      }
      E.set(v, best); choice.set(v, bestRune);
    }
    // "lourd" = exo hors template dont la rune pèse ≥ 25 (PA, PM, PO, invo à 1 %) ; une ligne du template
    // qui est tombée se repasse normalement et ne relève pas de cette règle.
    const isExo = !line || line.min == null;
    const big = (choice.get(t - 1)?.weight ?? 0) >= HEAVY ? choice.get(t - 1) : null;
    const heavy = isExo ? big : null;      // exo lourd : règle « d'abord »
    const heavyRepass = !isExo ? big : null; // grosse ligne du template à repasser : casse dynamique
    tables[stat] = { t, lo, E, choice, heavy, heavyRepass, Eof: v => v >= t ? 0 : E.get(Math.max(v, lo)) ?? BIG };
  }
  return { tables, share, wpp };
}

// Estimation du reste à faire : somme des espérances par ligne cible. Pour une grosse ligne du template
// encore à repasser (PM, PO tombées), chaque tentative ratée détruit jusqu'au poids de la rune sur ce qui
// est posé : plus l'objet est rempli au moment de l'évaluation, plus repasser coûte. C'est ce qui fait
// préférer de repasser tôt, une fois le reliquat consommé.
export function estimateRemaining(state, target, T = buildTables(state, target)) {
  let h = 0, pw = null;
  for (const stat of Object.keys(target)) {
    const tb = T.tables[stat]; const v = valueOf(state.item, stat);
    const e = tb.Eof(v);
    h += e;
    if (tb.heavyRepass && e > 0 && e < BIG) {
      pw = pw || presentWeights(state.item, target);
      const share = pw.total > 0 ? pw.onTarget / pw.total : 0;
      const o = FM.odds(state.item, tb.heavyRepass);
      const pFail = o.blocked ? 1 : 1 - o.sc / 100;
      h += e * pFail * Math.min(Math.max(0, tb.heavyRepass.weight - state.reliquat), pw.onTarget) * share / T.wpp;
    }
  }
  return h;
}

// Exo lourd (PA, PM, PO, invocation) encore à poser : il passe avant tout le reste, car chaque échec
// (99 %) détruit jusqu'au poids de la rune sur l'objet. On ne le laisse pas à la simulation.
export function pendingHeavy(state, target, T) {
  for (const stat of Object.keys(target)) {
    const tb = T.tables[stat];
    if (!tb.heavy || valueOf(state.item, stat) >= tb.t) continue;
    const o = FM.odds(state.item, tb.heavy);
    if (!o.blocked) return { rune: tb.heavy, odds: o };
  }
  return null;
}

// Politique par défaut : la rune qui minimise 1 + casse + pass·E[v+b] + (1−pass)·E[v] sur sa ligne.
function policyMoves(state, target, T) {
  const list = [];
  for (const { stat } of missing(state.item, target)) {
    const tb = T.tables[stat]; const v = valueOf(state.item, stat);
    for (const r of RUNES.filter(r => r.stat === stat)) {
      const o = FM.odds(state.item, r);
      if (o.blocked) continue;
      const pass = (o.sc + o.sn) / 100;
      const c = (1 - o.sc / 100) * Math.max(0, r.weight - state.reliquat) * T.share / T.wpp;
      list.push({ rune: r, val: 1 + c + pass * tb.Eof(v + r.bonus) + (1 - pass) * tb.Eof(v) });
    }
  }
  return list.sort((a, b) => a.val - b.val);
}

// Une trajectoire : `first` puis la politique, au plus H poses. Retourne poses jouées + reste estimé.
function rollout(state, target, T, first, H, rng, stats) {
  let s = state, poses = 0;
  let r = FM.applyMove(s, first, rng);
  if (!r.outcome) return null;
  poses++;
  if (stats) {
    let hurt = false;
    for (const c of r.changes) {
      if (!(c.stat in target)) continue;
      if (c.delta < 0 && valueOf(r.item, c.stat) < target[c.stat]) { hurt = true; stats.lost += -c.delta * STAT_BY_KEY[c.stat].weight; }
    }
    if (hurt) stats.hurt++;
    stats.outcomes[r.outcome]++;
  }
  s = { item: r.item, reliquat: r.reliquat };
  while (poses < H && !targetReached(s.item, target)) {
    const moves = policyMoves(s, target, T);
    let done = false;
    for (const m of moves.slice(0, 3)) {
      const q = FM.applyMove(s, m.rune, rng);
      if (!q.outcome) continue;
      s = { item: q.item, reliquat: q.reliquat }; poses++; done = true; break;
    }
    if (!done) break;
  }
  return poses + estimateRemaining(s, target, T);
}

// Runes candidates : tout ce qui se pose sur une ligne cible incomplète, plus des coups de « nettoyage »
// d'une ligne en over (poids d'over = excès × poids du point). Trois façons de la vider sans dépasser
// son poids d'over : la petite rune de la ligne elle-même ; une rune exo légère (cha, ini, pui, sa…), dont
// l'échec ou le SN retire son poids sur les lignes over/exo d'abord ; une rune d'une ligne existante
// hors cible qui ne risque pas de créer un over. Les rollouts départagent.
const EXO_CLEAN_ORDER = ['cha', 'ini', 'age', 'fo', 'ine', 'pui', 'pod', 'sa', 'prospe'];
export function candidates(state, target) {
  const { item } = state;
  const need = new Set(missing(item, target).map(m => m.stat));
  const list = RUNES.filter(r => need.has(r.stat)).map(rune => ({ rune, odds: FM.odds(item, rune), onTarget: true }));
  const present = new Set(item.lines.map(l => l.stat));
  const seen = new Set(list.map(c => c.rune.id));
  const push = (rune, cleans) => { if (!rune || seen.has(rune.id)) return; seen.add(rune.id); list.push({ rune, odds: FM.odds(item, rune), onTarget: false, purpose: 'nettoyage', cleans }); };
  for (const l of item.lines) {
    if (l.min == null || !(l.value > Math.max(l.min, l.max)) || need.has(l.stat)) continue;
    const ow = (l.value - Math.max(l.min, l.max)) * STAT_BY_KEY[l.stat].weight;
    push(RUNES.find(r => r.stat === l.stat && r.tier === 0), l.stat);
    // exo légers : une rune par poids distinct, du plus proche de l'over au plus léger (3 au plus)
    const exos = EXO_CLEAN_ORDER.filter(k => !present.has(k) && STAT_BY_KEY[k]).map(k => RUNES.find(r => r.stat === k && r.tier === 0))
      .filter(r => r && r.weight <= ow + 1e-9).sort((a, b) => b.weight - a.weight);
    const weights = new Set();
    for (const r of exos) { if (weights.has(r.weight)) continue; weights.add(r.weight); push(r, l.stat); if (weights.size >= 3) break; }
    // runes des lignes existantes hors cible, sans risque d'over, de poids ≤ over
    for (const o of item.lines) {
      if (o === l || o.min == null || need.has(o.stat) || o.min < 0 || o.max <= 0) continue;
      for (const r of RUNES.filter(r => r.stat === o.stat && r.weight <= ow + 1e-9 && o.value + r.bonus <= o.max)) push(r, l.stat);
    }
  }
  return list.filter(c => !c.odds.blocked);
}

// Score d'une rune = nombre moyen de poses (celle-ci comprise) pour atteindre toutes les cibles en la jouant
// maintenant puis en suivant la politique, sur des sessions simulées jusqu'au bout (même estimateur que
// simulateSessions, donc même chiffre que l'estimation de la vue Objet).
export function nextBestMoves(state, target, { samples = 300, horizon = 400, seed = 1, top = 3 } = {}) {
  if (targetReached(state.item, target)) return { reached: true, moves: [] };
  const T = buildTables(state, target);
  const h0 = estimateRemaining(state, target, T);
  const heavy = pendingHeavy(state, target, T);
  const pool = heavy ? [heavy] : candidates(state, target);
  const results = pool.map(({ rune, odds, purpose, cleans }) => {
    const stats = { hurt: 0, lost: 0, outcomes: { SC: 0, SN: 0, EC: 0 } };
    let sum = 0, n = 0;
    for (let k = 0; k < samples; k++) {
      const rng = rngFrom(seed * 7919 + k); // mêmes aléas pour chaque candidat : comparaison moins bruitée
      const c = rollout(state, target, T, rune, horizon, rng, stats);
      if (c == null) continue;
      sum += c; n++;
    }
    const score = n ? sum / n : Infinity;
    return { rune, odds, purpose, cleans, score, netGain: h0 - score, pHurtTarget: n ? stats.hurt / n : 0, expLossOnTarget: n ? stats.lost / n : 0 };
  });
  results.sort((a, b) => a.score - b.score);
  return { reached: false, h0, heavyFirst: !!heavy, moves: results.slice(0, top), all: results };
}

// Sessions complètes simulées avec la politique gloutonne (exo lourd d'abord, puis la meilleure rune par
// ligne) jusqu'à la cible : distribution du nombre de poses et runes consommées, pour estimer le coût.
export function simulateSessions(state, target, { runs = 200, maxPoses = 400, seed = 1 } = {}) {
  const T = buildTables(state, target);
  const poses = [], runeCounts = new Map();
  let unfinished = 0;
  for (let k = 0; k < runs; k++) {
    const rng = rngFrom(seed * 104729 + k);
    let s = state, n = 0;
    while (n < maxPoses && !targetReached(s.item, target)) {
      const heavy = pendingHeavy(s, target, T);
      const moves = heavy ? [{ rune: heavy.rune }] : policyMoves(s, target, T).slice(0, 3);
      let done = false;
      for (const m of moves) {
        const q = FM.applyMove(s, m.rune, rng);
        if (!q.outcome) continue;
        s = { item: q.item, reliquat: q.reliquat }; n++; done = true;
        runeCounts.set(m.rune.id, (runeCounts.get(m.rune.id) || 0) + 1);
        break;
      }
      if (!done) break;
    }
    if (!targetReached(s.item, target)) unfinished++;
    poses.push(n);
  }
  poses.sort((a, b) => a - b);
  const q = p => poses[Math.min(poses.length - 1, Math.floor(p * poses.length))];
  const mean = poses.reduce((a, b) => a + b, 0) / poses.length;
  const perRun = [...runeCounts.entries()].map(([id, n]) => ({ id, rune: RUNES.find(r => r.id === id), n: n / runs })).sort((a, b) => b.n - a.n);
  return { runs, mean, median: q(0.5), p10: q(0.1), p90: q(0.9), unfinished: unfinished / runs, runes: perRun };
}
