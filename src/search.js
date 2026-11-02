// Recherche du meilleur coup : cible = minimums par ligne, coût = nombre de poses.
// Pour chaque rune candidate on simule N poses avec le moteur et on mesure l'espérance
// de la distance résiduelle h(state) ≈ nombre de poses encore nécessaires.

import * as FM from './engine.js';
import { STAT_BY_KEY, RUNES } from './stats.js';

// Générateur pseudo-aléatoire déterministe (mulberry32) pour des résultats reproductibles.
function rngFrom(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const lineOf = (item, stat) => item.lines.find(l => l.stat === stat);
const valueOf = (item, stat) => lineOf(item, stat)?.value ?? 0;

// Ce qui manque sur chaque ligne cible.
function missing(item, target) {
  return Object.entries(target).map(([stat, min]) => ({ stat, missing: Math.max(0, min - valueOf(item, stat)) })).filter(m => m.missing > 0);
}

// Poids présent sur l'objet (lignes à valeur positive) et part de ce poids sur les lignes cibles.
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

// Heuristique : poses estimées pour combler chaque ligne cible, en prenant pour chaque ligne la
// rune la plus efficace au vu des probabilités actuelles. Chaque tentative qui n'est pas un SC
// retire du poids à l'objet ; la part qui tombe sur les lignes cibles est convertie en poses
// supplémentaires. C'est ce terme qui fait préférer un exo PA sur un objet encore vide.
function estimateRemaining(state, target) {
  const { item, reliquat } = state;
  const pw = presentWeights(item, target);
  const shareOnTarget = pw.total > 0 ? pw.onTarget / pw.total : 0;
  // poids utile gagné par pose, au mieux, sur les lignes cibles
  let wpp = 1;
  const plans = [];
  for (const { stat, missing: m } of missing(item, target)) {
    let best = null;
    for (const rune of RUNES.filter(r => r.stat === stat)) {
      const o = FM.odds(item, rune);
      if (o.blocked) continue;
      const pass = Math.max(0.01, (o.sc + o.sn) / 100);
      const attempts = Math.ceil(m / rune.bonus) / pass;
      if (!best || attempts < best.attempts) best = { rune, attempts, pass, sc: o.sc / 100 };
      wpp = Math.max(wpp, Math.min(rune.bonus, m) * STAT_BY_KEY[stat].weight * pass);
    }
    plans.push({ stat, best });
  }
  let h = 0;
  for (const { best } of plans) {
    if (!best) { h += 1000; continue; } // ligne bloquée : cible inatteignable en l'état
    const protectedByWell = Math.max(0, best.rune.weight - reliquat);
    const lossPerAttempt = Math.min(protectedByWell, pw.onTarget) * shareOnTarget;
    h += best.attempts * (1 + (1 - best.sc) * lossPerAttempt / wpp);
  }
  return h;
}

function targetReached(item, target) { return missing(item, target).length === 0; }

// Runes candidates : tout ce qui peut se poser sur une ligne cible incomplète ;
// avec explore, aussi les petites runes sur les autres lignes (fabrication de reliquat).
function candidates(state, target, { explore = false } = {}) {
  const need = new Set(missing(state.item, target).map(m => m.stat));
  const list = [];
  for (const rune of RUNES) {
    const onTarget = need.has(rune.stat);
    if (!onTarget && !(explore && rune.tier === 0 && lineOf(state.item, rune.stat))) continue;
    const o = FM.odds(state.item, rune);
    if (o.blocked) continue;
    list.push({ rune, odds: o, onTarget });
  }
  return list;
}

// Évalue chaque candidat par simulation. Retourne la liste triée (meilleur d'abord).
function nextBestMoves(state, target, { samples = 1500, seed = 1, explore = false, top = 3, costOf = () => 1 } = {}) {
  if (targetReached(state.item, target)) return { reached: true, moves: [] };
  const h0 = estimateRemaining(state, target);
  const rng = rngFrom(seed);
  const results = candidates(state, target, { explore }).map(({ rune, odds, onTarget }) => {
    let sumH = 0, hurtTarget = 0, lostOnTarget = 0, gainedOnTarget = 0;
    const targetStats = Object.keys(target);
    for (let k = 0; k < samples; k++) {
      const r = FM.applyMove(state, rune, rng);
      sumH += estimateRemaining({ item: r.item, reliquat: r.reliquat }, target);
      let hurt = false;
      for (const c of r.changes) {
        if (!targetStats.includes(c.stat)) continue;
        if (c.delta < 0 && valueOf(r.item, c.stat) < target[c.stat]) { hurt = true; lostOnTarget -= c.delta * STAT_BY_KEY[c.stat].weight; }
        if (c.delta > 0) gainedOnTarget += c.delta * STAT_BY_KEY[c.stat].weight;
      }
      if (hurt) hurtTarget++;
    }
    const expectedH = sumH / samples;
    return {
      rune, odds, onTarget,
      score: costOf(rune) + expectedH,         // poses attendues au total (plus petit = mieux)
      netGain: h0 - expectedH - costOf(rune),  // progression nette en poses (positif = utile)
      pHurtTarget: hurtTarget / samples,       // proba d'abîmer une ligne cible encore incomplète
      expLossOnTarget: lostOnTarget / samples, // poids perdu en moyenne sur les lignes cibles
      expGainOnTarget: gainedOnTarget / samples,
    };
  });
  results.sort((a, b) => a.score - b.score);
  return { reached: false, h0, moves: results.slice(0, top), all: results };
}

export { nextBestMoves, estimateRemaining, missing, targetReached, candidates, rngFrom };
