// Analyse d'un journal exporté par l'outil : calibration des probabilités et ciblage des pertes.
// Usage : node scripts/analyse-journal.js fm-dofus-journal-YYYY-MM-DD.json
import { readFileSync } from 'node:fs';
import * as FM from '../src/engine.js';
import { STAT_BY_KEY, RUNE_BY_ID } from '../src/stats.js';

const file = process.argv[2];
if (!file) { console.error('usage : node scripts/analyse-journal.js <journal.json>'); process.exit(1); }
const data = JSON.parse(readFileSync(file, 'utf8'));
const entries = (data.entries || data).filter(e => e.outcome && e.before && e.rune);
console.log(`${entries.length} poses réelles\n`);

// 1. Calibration : fréquences observées vs prédites, par tranche de SC prédit
const buckets = {};
let llModel = 0, llUniform = 0;
for (const e of entries) {
  const rune = RUNE_BY_ID[`${e.rune.stat}:${e.rune.tier}`];
  const o = FM.odds({ level: e.item?.level ?? 200, lines: e.before.lines }, rune);
  if (o.blocked) continue;
  const p = { SC: o.sc / 100, SN: o.sn / 100, EC: o.ec / 100 };
  llModel += Math.log(Math.max(1e-4, p[e.outcome])); llUniform += Math.log(1 / 3);
  const key = o.sc >= 30 ? 'SC ≥ 30 %' : o.sc >= 10 ? 'SC 10–30 %' : o.sc >= 3 ? 'SC 3–10 %' : 'SC < 3 %';
  const b = buckets[key] ||= { n: 0, pred: { SC: 0, SN: 0, EC: 0 }, obs: { SC: 0, SN: 0, EC: 0 } };
  b.n++; for (const k of ['SC', 'SN', 'EC']) b.pred[k] += p[k]; b.obs[e.outcome]++;
}
console.log('Calibration (prédit → observé, en %)');
for (const [k, b] of Object.entries(buckets)) {
  const f = x => (100 * x / b.n).toFixed(0).padStart(3);
  console.log(`  ${k.padEnd(12)} n=${String(b.n).padStart(3)}  SC ${f(b.pred.SC)} → ${f(b.obs.SC)}   SN ${f(b.pred.SN)} → ${f(b.obs.SN)}   EC ${f(b.pred.EC)} → ${f(b.obs.EC)}`);
}
console.log(`  log-vraisemblance : modèle ${llModel.toFixed(1)} vs hasard uniforme ${llUniform.toFixed(1)} (plus haut = mieux)\n`);

// 2. Ciblage des pertes : pour chaque SN/EC, probabilité (simulée) que chaque ligne perde, vs observé
const lossStats = {}; // stat → { n: poses où la ligne pouvait perdre, pred: Σ P(perd), obs: nb de fois perdue, predW, obsW }
let gaps = 0;
for (const e of entries.filter(e => e.outcome !== 'SC')) {
  if (Math.abs(e.gap || 0) > 0.01) gaps++;
  const rune = RUNE_BY_ID[`${e.rune.stat}:${e.rune.tier}`];
  const state = { item: { level: e.item?.level ?? 200, lines: e.before.lines }, reliquat: e.before.reliquat };
  const N = 1000; const hit = {}, wsum = {};
  for (let k = 0; k < N; k++) {
    const r = FM.applyMove(state, rune, Math.random, e.outcome);
    for (const c of r.changes) if (c.delta < 0) { hit[c.stat] = (hit[c.stat] || 0) + 1; wsum[c.stat] = (wsum[c.stat] || 0) - c.delta * STAT_BY_KEY[c.stat].weight; }
  }
  const observed = Object.fromEntries(e.changes.filter(c => c.delta < 0).map(c => [c.stat, -c.delta * STAT_BY_KEY[c.stat].weight]));
  for (const l of e.before.lines) {
    const s = lossStats[l.stat] ||= { n: 0, pred: 0, obs: 0, predW: 0, obsW: 0 };
    s.n++; s.pred += (hit[l.stat] || 0) / N; s.obs += observed[l.stat] ? 1 : 0; s.predW += (wsum[l.stat] || 0) / N; s.obsW += observed[l.stat] || 0;
  }
}
console.log('Pertes (SN et EC) : fréquence de chute par ligne, prédite → observée, et poids perdu');
const rows = Object.entries(lossStats).sort((a, b) => STAT_BY_KEY[b[0]].weight - STAT_BY_KEY[a[0]].weight);
for (const [stat, s] of rows) {
  console.log(`  ${STAT_BY_KEY[stat].label.padEnd(28)} poids ${String(STAT_BY_KEY[stat].weight).padStart(4)}  n=${String(s.n).padStart(3)}  tombe ${(100 * s.pred / s.n).toFixed(0).padStart(3)} % → ${(100 * s.obs / s.n).toFixed(0).padStart(3)} %   poids perdu ${s.predW.toFixed(1).padStart(6)} → ${s.obsW.toFixed(1).padStart(6)}`);
}
console.log(`\n${gaps} pose(s) avec un écart de reliquat non nul (saisie à vérifier)`);
