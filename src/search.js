// Recherche du meilleur coup : cible = minimums par ligne, coût = nombre de poses.
//
// 1. Tables par ligne cible : espérance E[v] du nombre de poses pour amener la ligne de la valeur v
//    à la cible, calculée par programmation dynamique (valeur par valeur, meilleure rune à chaque
//    valeur) à partir des probabilités du moteur, avec un coût de casse collatérale par tentative.
// 2. Pour chaque rune candidate : on simule N sessions (la rune, puis une politique gloutonne fondée
//    sur les tables) jusqu'à la cible, et on mesure les poses jouées.
// Le coup retenu minimise cette espérance.
//
// Exo lourd (PA, PM, PO, invocation hors template) : il se tente en dernier, sur l'objet au jet voulu.
// SC 1 % ; chaque EC détruit jusqu'au poids de la rune (100 pour PA), il faut remonter puis retenter.
// Le coût de cette phase (≈ 1/p cycles de « tentative + remontée ») est estimé à part et ajouté.

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

// Exo lourd : stat à 1 % / 0 % / 99 % dont la ligne n'est pas dans le template de l'objet.
export function isHeavyExo(item, stat) { const st = STAT_BY_KEY[stat]; if (!st?.heavyExo) return false; const l = lineOf(item, stat); return !l || l.min == null; }
export function heavyPending(item, target) { return Object.keys(target).filter(s => isHeavyExo(item, s) && valueOf(item, s) < target[s]); }
export function normalTarget(item, target) { const t = {}; for (const [s, v] of Object.entries(target)) if (!isHeavyExo(item, s)) t[s] = v; return t; }

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
    if (isHeavyExo(item, stat)) continue;
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
    const tb = T.tables[stat]; if (!tb) continue;
    const v = valueOf(state.item, stat);
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
export function pendingHeavy() { return null; } // ancienne règle « exo lourd d'abord », abandonnée

// Politique par défaut : la rune qui minimise 1 + casse + pass·E[v+b] + (1−pass)·E[v] sur sa ligne.
// Ligne du template en over (au-dessus de son max) : la prochaine perte tombera dessus, à coup sûr. Marge
// d'over = ce qu'on peut perdre sur ces lignes sans passer sous leur cible (ou sous leur max si pas de cible).
export function overLines(item) { return item.lines.filter(l => l.min != null && l.value > Math.max(l.min, l.max)); }
export function overSlack(item, target) {
  return overLines(item).reduce((a, l) => a + Math.max(0, l.value - (target[l.stat] ?? Math.max(l.min, l.max))) * STAT_BY_KEY[l.stat].weight, 0);
}
// Nettoyage d'un over, avec bon sens : la perte d'une rune ratée (ou en SN) retire l'over, autant que cette
// rune serve à quelque chose. Par ordre de préférence, parmi les runes dont le poids tient dans la marge :
//  1. une rune d'une ligne cible encore à monter (d'une pierre deux coups : Pa Fo à 45/50 pour une vita à 415) ;
//  2. une rune d'une ligne du template hors cible qui ne créerait pas d'over en SC (Cha à 69/70) ;
//  3. sinon l'exo le plus léger et le moins cher (cha, ini…).
// Si même une rune de poids 1 (soit jusqu'à 1,2 de perte) dépasse la marge, on ne nettoie pas : l'over sert de tampon.
const CLEAN_ORDER = ['cha', 'ini', 'age', 'fo', 'ine', 'pod', 'pui', 'sa', 'prospe'];
export function cleaningMove(state, target, T) {
  const { item } = state;
  const slack = overSlack(item, target);
  if (!(slack > 0)) return null;
  // marge : la perte sur un over dépasse le poids de la rune jusqu'à 20 % (5 ou 6 vita pour un poids 1)
  const ok = r => r.weight * (1 + FM.P.OVER_EXTRA) <= slack + 1e-9 && !FM.odds(item, r).blocked;
  // 1. ligne cible à monter
  T = T || buildTables(state, target);
  let best = null;
  for (const { stat } of missing(item, target)) {
    const tb = T.tables[stat]; if (!tb) continue;
    const v = valueOf(item, stat);
    for (const r of RUNES.filter(r => r.stat === stat && ok(r))) {
      const o = FM.odds(item, r); const pass = (o.sc + o.sn) / 100;
      const val = 1 + pass * tb.Eof(v + r.bonus) + (1 - pass) * tb.Eof(v);
      if (!best || val < best.val) best = { rune: r, val };
    }
  }
  if (best) return best.rune;
  // 2. ligne du template hors cible, sans risque d'over
  const need = new Set(missing(item, target).map(m => m.stat));
  let bonus = null;
  for (const l of item.lines) {
    if (l.min == null || need.has(l.stat) || l.max <= 0 || l.value > Math.max(l.min, l.max)) continue;
    for (const r of RUNES.filter(r => r.stat === l.stat && r.tier === 0 && ok(r) && l.value + r.bonus <= Math.max(l.min, l.max))) if (!bonus || r.weight < bonus.weight) bonus = r;
  }
  if (bonus) return bonus;
  // 3. exo léger
  for (const k of CLEAN_ORDER) {
    const l = item.lines.find(x => x.stat === k);
    if (l && l.min != null) continue;
    const r = RUNES.find(r => r.stat === k && r.tier === 0);
    if (r && ok(r)) return r;
  }
  return null;
}

// Descente : poser une rune sur une ligne qui n'est pas une cible incomplète (ligne finie, hors cible, ou exo
// léger) pour que sa perte fasse baisser une ligne cible coincée (ratio trop haut), là où la table dit que
// repartir de plus bas coûte moins : E(v − n) < E(v). Valeur = 1 + (1 − SC) × Σ_ℓ P(perte sur ℓ) × gain attendu,
// avec P d'après les poids de tirage du moteur (première ligne touchée) et n uniforme sur 1..⌈f/w⌉.
// Valeur mise sous la même forme que les coups normaux (1 + reste attendu de la ligne bénéficiaire).
const DESCENT_EXO = ['cha', 'ini', 'age', 'fo', 'ine'];
export function descentMoves(state, target, T) {
  const { item } = state;
  const miss = missing(item, target);
  if (!miss.length || overLines(item).length) return [];
  // lignes cibles qui gagneraient à baisser
  const benef = [];
  for (const { stat } of miss) {
    const tb = T.tables[stat]; if (!tb) continue;
    const v = valueOf(item, stat); const l = lineOf(item, stat); if (!l || l.min == null || !(v > 0)) continue;
    const lo = Math.max(tb.lo, Math.min(l.min, 0));
    let best = 0; for (let n = 1; n <= 10 && v - n >= lo; n++) best = Math.max(best, tb.Eof(v) - tb.Eof(v - n));
    if (best > 0.5) benef.push({ stat, v, lo, tb, line: l });
  }
  if (!benef.length) return [];
  const need = new Set(miss.map(m => m.stat));
  // runes de descente : petites runes des lignes qui ne sont pas des cibles incomplètes, et exos légers
  const runes = [];
  for (const l of item.lines) {
    if (l.min == null || need.has(l.stat) || l.max <= 0) continue;
    for (const r of RUNES.filter(r => r.stat === l.stat && r.tier <= 1)) runes.push(r);
  }
  for (const k of DESCENT_EXO) { const l = item.lines.find(x => x.stat === k); if (l && l.min != null) continue; const r = RUNES.find(r => r.stat === k && r.tier === 0); if (r) runes.push(r); }
  const normals = item.lines.filter(l => l.min != null && l.value > 0 && l.value <= Math.max(l.min, l.max));
  const out = [];
  for (const r of runes) {
    const o = FM.odds(item, r); if (o.blocked) continue;
    const f = r.weight - state.reliquat; if (f <= 0) continue;
    const kexp = FM.P.PICK_EXP ?? 1;
    const pi = normals.map(l => ({ l, w: Math.min(1, f / STAT_BY_KEY[l.stat].weight) ** kexp * (l.stat === r.stat ? FM.P.TARGET_PICK_FACTOR : 1) }));
    const tot = pi.reduce((a, x) => a + x.w, 0); if (!(tot > 0)) continue;
    let gain = 0, benefStat = null, benefP = 0;
    for (const b of benef) {
      const x = pi.find(p => p.l.stat === b.stat); if (!x) continue;
      const pHit = x.w / tot, w = STAT_BY_KEY[b.stat].weight, nmax = Math.max(1, Math.min(b.v - b.lo, Math.ceil(f / w - 1e-9)));
      let g = 0; for (let n = 1; n <= nmax; n++) g += (b.tb.Eof(b.v) - b.tb.Eof(Math.max(b.lo, b.v - n))) / nmax;
      gain += pHit * g; if (pHit * g > benefP) { benefP = pHit * g; benefStat = b.stat; }
    }
    if (!(gain > 0.5)) continue;
    // même forme que les coups normaux : 1 + reste attendu de la ligne bénéficiaire après le coup
    const b0 = benef.find(b => b.stat === benefStat);
    const val = 1 + b0.tb.Eof(b0.v) - (1 - o.sc / 100) * gain;
    out.push({ rune: r, val, purpose: 'descente', cleans: benefStat, gain });
  }
  return out;
}

export function policyMoves(state, target, T) {
  const list = [];
  const miss = missing(state.item, target);
  if (miss.length && overLines(state.item).length) { const c = cleaningMove(state, target, T); if (c) return [{ rune: c, val: 0, purpose: 'nettoyage' }]; }
  for (const { stat } of miss) {
    const tb = T.tables[stat]; if (!tb) continue;
    const v = valueOf(state.item, stat);
    for (const r of RUNES.filter(r => r.stat === stat)) {
      const o = FM.odds(state.item, r);
      if (o.blocked) continue;
      const pass = (o.sc + o.sn) / 100;
      const c = (1 - o.sc / 100) * Math.max(0, r.weight - state.reliquat) * T.share / T.wpp;
      list.push({ rune: r, val: 1 + c + pass * tb.Eof(v + r.bonus) + (1 - pass) * tb.Eof(v) });
    }
  }
  for (const d of descentMoves(state, target, T)) list.push(d);
  return list.sort((a, b) => a.val - b.val);
}

// Une trajectoire : `first` puis la politique, au plus H poses. Retourne poses jouées + reste estimé.
function rollout(state, target, T, first, H, rng, stats, forced = null) {
  let s = state, poses = 0;
  let r = FM.applyMove(s, first, rng, forced);
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
  const normal = normalTarget(s.item, target);
  while (poses < H && !targetReached(s.item, normal)) {
    const moves = policyMoves(s, target, T);
    let done = false;
    for (const m of moves.slice(0, 3)) {
      const q = FM.applyMove(s, m.rune, rng);
      if (!q.outcome) continue;
      s = { item: q.item, reliquat: q.reliquat }; poses++; done = true; break;
    }
    if (!done) break;
  }
  return poses + estimateRemaining(s, normal, T);
}

// Coût de la phase exo lourd depuis l'objet au jet : p = chance de SC, R = poses de remontée après un EC
// (simulées depuis l'objet au jet, politique gloutonne). Cycles ~ géométrique(p) : 1/p en moyenne.
export function heavyCost(state, target, { trials = 60, seed = 11, maxRecover = 400 } = {}) {
  const pend = heavyPending(state.item, target);
  if (!pend.length) return null;
  const normal = normalTarget(state.item, target);
  // objet « au jet » : lignes cibles normales mises à la cible
  let full = state.item;
  for (const [stat, t] of Object.entries(normal)) if (valueOf(full, stat) < t) full = withValue(full, stat, t);
  const fullState = { item: full, reliquat: state.reliquat };
  const T = buildTables(fullState, normal);
  const out = { phases: [], total: 0, totalMedian: 0, totalP10: 0, totalP90: 0, runes: new Map() };
  for (const stat of pend) {
    const rune = RUNES.find(r => r.stat === stat && r.tier === 0);
    const o = FM.odds(full, rune);
    const p = o.blocked ? 0 : o.sc / 100;
    if (!(p > 0)) { out.phases.push({ stat, rune, blocked: o.blocked || 'sc-0' }); out.total += BIG; continue; }
    let sumR = 0, n = 0; const rec = new Map();
    for (let k = 0; k < trials; k++) {
      const rng = rngFrom(seed * 7877 + k);
      const r = FM.applyMove(fullState, rune, rng, 'EC');
      let s = { item: r.item, reliquat: r.reliquat }, poses = 0;
      while (poses < maxRecover && !targetReached(s.item, normal)) {
        const moves = policyMoves(s, normal, T).slice(0, 3);
        let done = false;
        for (const m of moves) { const q = FM.applyMove(s, m.rune, rng); if (!q.outcome) continue; s = { item: q.item, reliquat: q.reliquat }; poses++; done = true; rec.set(m.rune.id, (rec.get(m.rune.id) || 0) + 1); break; }
        if (!done) break;
      }
      sumR += poses; n++;
    }
    const R = n ? sumR / n : 0;
    const q = x => Math.ceil(Math.log(1 - x) / Math.log(1 - p));
    const cycles = { mean: 1 / p, median: q(0.5), p10: q(0.1), p90: q(0.9) };
    const tot = c => c + (c - 1) * R;
    out.phases.push({ stat, rune, p, recover: R, cycles, total: tot(cycles.mean) });
    out.total += tot(cycles.mean); out.totalMedian += tot(cycles.median); out.totalP10 += tot(cycles.p10); out.totalP90 += tot(cycles.p90);
    out.phases.at(-1).recoverRunes = new Map([...rec].map(([id, c]) => [id, c / Math.max(1, n)]));
    out.runes.set(rune.id, (out.runes.get(rune.id) || 0) + cycles.mean);
    for (const [id, c] of rec) out.runes.set(id, (out.runes.get(id) || 0) + c / Math.max(1, n) * (cycles.mean - 1));
  }
  return out;
}

// Runes candidates : tout ce qui se pose sur une ligne cible incomplète, plus des coups de « nettoyage »
// d'une ligne en over (poids d'over = excès × poids du point). Trois façons de la vider sans dépasser
// son poids d'over : la petite rune de la ligne elle-même ; une rune exo légère (cha, ini, pui, sa…), dont
// l'échec ou le SN retire son poids sur les lignes over/exo d'abord ; une rune d'une ligne existante
// hors cible qui ne risque pas de créer un over. Les rollouts départagent.
const EXO_CLEAN_ORDER = ['cha', 'ini', 'age', 'fo', 'ine', 'pui', 'pod', 'sa', 'prospe'];
export function candidates(state, target) {
  const { item } = state;
  const normal = normalTarget(item, target);
  if (targetReached(item, normal)) {
    return heavyPending(item, target).map(stat => { const rune = RUNES.find(r => r.stat === stat && r.tier === 0); return { rune, odds: FM.odds(item, rune), onTarget: true, purpose: 'exo' }; }).filter(c => !c.odds.blocked);
  }
  target = normal;
  const need = new Set(missing(item, target).map(m => m.stat));
  const list = RUNES.filter(r => need.has(r.stat)).map(rune => ({ rune, odds: FM.odds(item, rune), onTarget: true }));
  // descente : les 3 meilleures d'après leur valeur de politique (les simulations départagent)
  for (const d of descentMoves(state, target, buildTables(state, target)).sort((a, b) => a.val - b.val).slice(0, 3)) if (!list.some(c => c.rune.id === d.rune.id)) list.push({ rune: d.rune, odds: FM.odds(item, d.rune), onTarget: false, purpose: 'descente', cleans: d.cleans });
  const clean = overLines(item).length ? cleaningMove(state, target) : null;
  if (clean) {
    const over = overLines(item)[0];
    const dup = list.find(c => c.rune.id === clean.id);
    if (dup) dup.cleans = over.stat;   // rune d'une ligne cible qui retire aussi l'over
    else list.push({ rune: clean, odds: FM.odds(item, clean), onTarget: false, purpose: 'nettoyage', cleans: over.stat });
  }
  return list.filter(c => !c.odds.blocked);
}

// Score d'une rune = nombre moyen de poses (celle-ci comprise) pour atteindre toutes les cibles en la jouant
// maintenant puis en suivant la politique, sur des sessions simulées jusqu'au bout (même estimateur que
// simulateSessions, donc même chiffre que l'estimation de la vue Objet).
// Écart moyen entre deux candidates sur les mêmes tirages, et son erreur-type.
export function pairedDiff(a, b) {
  let n = 0, s = 0, s2 = 0;
  for (let k = 0; k < Math.min(a.costs?.length ?? 0, b.costs?.length ?? 0); k++) { if (a.costs[k] == null || b.costs[k] == null) continue; const d = b.costs[k] - a.costs[k]; n++; s += d; s2 += d * d; }
  if (!n) return { n: 0, diff: b.score - a.score, se: Infinity };
  const mean = s / n, v = Math.max(0, s2 / n - mean * mean);
  return { n, diff: mean, se: Math.sqrt(v / n) };
}

export function nextBestMoves(state, target, { samples = 300, horizon = 400, seed = 1, top = 3 } = {}) {
  if (targetReached(state.item, target)) return { reached: true, moves: [] };
  const normal = normalTarget(state.item, target);
  const heavy = heavyCost(state, target, { seed });
  if (targetReached(state.item, normal)) {
    // objet au jet : la seule chose à faire est de tenter l'exo lourd
    const moves = candidates(state, target).map(({ rune, odds, purpose }) => {
      const ph = heavy?.phases.find(x => x.stat === rune.stat);
      return { rune, odds, purpose, score: ph?.total ?? BIG, netGain: 0, pHurtTarget: 0, expLossOnTarget: 0, phase: ph };
    });
    return { reached: false, exo: true, h0: heavy?.total ?? 0, heavy, moves: moves.slice(0, top), all: moves };
  }
  const T = buildTables(state, normal);
  const extra = heavy ? heavy.total : 0;   // phase exo lourd, identique pour toutes les candidates
  const h0 = estimateRemaining(state, normal, T) + extra;
  const pool = candidates(state, target);
  const results = pool.map(({ rune, odds, purpose, cleans }) => {
    const stats = { hurt: 0, lost: 0, outcomes: { SC: 0, SN: 0, EC: 0 } };
    let sum = 0, n = 0; const costs = new Array(samples).fill(null);
    for (let k = 0; k < samples; k++) {
      const rng = rngFrom(seed * 7919 + k); // mêmes aléas pour chaque candidat : comparaison moins bruitée
      // résultat de la première pose stratifié (SC/SN/EC en proportion exacte des chances) : le bruit entre
      // candidates ne vient plus du tirage de ce premier résultat, seulement de la suite
      const u = (k + 0.5) / samples * 100;
      const forced = u < odds.sc ? 'SC' : u < odds.sc + odds.sn ? 'SN' : 'EC';
      const c = rollout(state, target, T, rune, horizon, rng, stats, forced);
      if (c == null) continue;
      sum += c; n++; costs[k] = c;
    }
    const score = n ? sum / n + extra : Infinity;
    return { rune, odds, purpose, cleans, score, costs, netGain: h0 - score, pHurtTarget: n ? stats.hurt / n : 0, expLossOnTarget: n ? stats.lost / n : 0 };
  });
  // valeur déterministe de la politique, à titre indicatif (dp)
  const dp = new Map(policyMoves(state, normal, T).map(m => [m.rune.id, m.val]));
  for (const m of results) m.dp = dp.get(m.rune.id) ?? Infinity;
  results.sort((a, b) => a.score - b.score);   // ordre strict par poses restantes (ce qui est affiché)
  return { reached: false, h0, heavy, moves: results.slice(0, top), all: results };
}

// Sessions complètes simulées avec la politique gloutonne (exo lourd d'abord, puis la meilleure rune par
// ligne) jusqu'à la cible : distribution du nombre de poses et runes consommées, pour estimer le coût.
export function simulateSessions(state, target, { runs = 200, maxPoses = 400, seed = 1 } = {}) {
  const heavy = heavyCost(state, target, { seed });
  target = normalTarget(state.item, target);
  const T = buildTables(state, target);
  const detail = [], runeCounts = new Map();
  let unfinished = 0;
  const add = (map, id, n) => map.set(id, (map.get(id) || 0) + n);
  for (let k = 0; k < runs; k++) {
    const rng = rngFrom(seed * 104729 + k);
    let s = state, n = 0; const mine = new Map();
    while (n < maxPoses && !targetReached(s.item, target)) {
      const moves = policyMoves(s, target, T).slice(0, 3);
      let done = false;
      for (const m of moves) {
        const q = FM.applyMove(s, m.rune, rng);
        if (!q.outcome) continue;
        s = { item: q.item, reliquat: q.reliquat }; n++; done = true; add(mine, m.rune.id, 1);
        break;
      }
      if (!done) break;
    }
    if (!targetReached(s.item, target)) unfinished++;
    // phase exo lourd : cycles tirés (géométrique), remontée moyenne par cycle raté
    if (heavy) for (const ph of heavy.phases) {
      if (!ph.cycles) { n += BIG; continue; }
      const cycles = Math.max(1, Math.ceil(Math.log(1 - rng()) / Math.log(1 - ph.p)));
      n += cycles + (cycles - 1) * ph.recover;
      add(mine, ph.rune.id, cycles);
      for (const [id, c] of ph.recoverRunes || []) add(mine, id, c * (cycles - 1));
    }
    detail.push({ poses: n, runes: Object.fromEntries(mine) });
    for (const [id, c] of mine) add(runeCounts, id, c);
  }
  const poses = detail.map(d => d.poses).sort((a, b) => a - b);
  const q = p => poses[Math.min(poses.length - 1, Math.floor(p * poses.length))];
  const mean = poses.reduce((a, b) => a + b, 0) / poses.length;
  const perRun = [...runeCounts.entries()].map(([id, n]) => ({ id, rune: RUNES.find(r => r.id === id), n: n / runs })).sort((a, b) => b.n - a.n);
  return { runs, mean, median: q(0.5), p10: q(0.1), p90: q(0.9), unfinished: unfinished / runs, runes: perRun, detail, heavy };
}

// Recherche avancée : les deux premières poses sont comparées par simulation (paires rune 1 → rune 2),
// la suite par la politique. Capture les coups qui n'ont de sens qu'avec leur suite (Ra Vi puis nettoyage…).
export function nextBestMoves2(state, target, { samples = 200, seed = 1, top = 3, firsts = 6, seconds = 8 } = {}) {
  const base = nextBestMoves(state, target, { samples: Math.max(60, Math.round(samples / 2)), seed, top: 50 });
  if (base.reached || base.exo || !base.all.length) return base;
  const normal = normalTarget(state.item, target);
  const T = buildTables(state, normal);
  const extra = base.heavy ? base.heavy.total : 0;
  const rank = new Map(base.all.map((m, i) => [m.rune.id, i]));
  const out = [];
  for (const m1 of base.all.slice(0, firsts)) {
    // secondes poses : candidates maintenant et après un passage de la première
    const after = FM.applyMove(state, m1.rune, rngFrom(1), 'SN');
    const pool = new Map();
    for (const c of candidates(state, target)) pool.set(c.rune.id, c.rune);
    if (after.outcome) for (const c of candidates({ item: after.item, reliquat: after.reliquat }, target)) pool.set(c.rune.id, c.rune);
    const r2s = [...pool.values()].sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99)).slice(0, seconds);
    let best = null;
    for (const r2 of r2s) {
      let sum = 0, n = 0; const costs = new Array(samples).fill(null);
      for (let k = 0; k < samples; k++) {
        const rng = rngFrom(seed * 7919 + k);
        const u = (k + 0.5) / samples * 100;
        const forced = u < m1.odds.sc ? 'SC' : u < m1.odds.sc + m1.odds.sn ? 'SN' : 'EC';
        let r = FM.applyMove(state, m1.rune, rng, forced); if (!r.outcome) break;
        let s = { item: r.item, reliquat: r.reliquat }, poses = 1;
        const nm = normalTarget(s.item, target);
        if (!targetReached(s.item, nm)) { const q = FM.applyMove(s, r2, rng); if (q.outcome) { s = { item: q.item, reliquat: q.reliquat }; poses++; } }
        while (poses < 400 && !targetReached(s.item, nm)) {
          const mv = policyMoves(s, nm, T); let done = false;
          for (const m of mv.slice(0, 3)) { const q = FM.applyMove(s, m.rune, rng); if (!q.outcome) continue; s = { item: q.item, reliquat: q.reliquat }; poses++; done = true; break; }
          if (!done) break;
        }
        const c = poses + estimateRemaining(s, nm, T); sum += c; n++; costs[k] = c;
      }
      const score = n ? sum / n + extra : Infinity;
      if (!best || score < best.score) best = { ...m1, next: r2, score, costs };
    }
    if (best) out.push(best);
  }
  out.sort((a, b) => a.score - b.score);
  return { ...base, advanced: true, moves: out.slice(0, top), all: out };
}
