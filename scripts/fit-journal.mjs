// Ajuste palier et pente du ratio sur un journal exporté : node scripts/fit-journal.mjs [journal.json]
import * as FM from '../src/engine.js';
import { RUNES } from '../src/stats.js';
import { readFileSync } from 'node:fs';
const j = JSON.parse(readFileSync('process.argv[2] || 'journals/2026-11-02-reine-et-strigide.json'')).entries.filter(e => e.odds && !e.odds.blocked && e.odds.regime !== 'exo');
const runeOf = e => RUNES.find(r => r.stat === e.rune.stat && r.tier === e.rune.tier);
function ll(label) {
  let s = 0; const bins = {};
  for (const e of j) {
    const o = FM.odds({ level: e.item.level, lines: e.before.lines }, runeOf(e));
    if (o.blocked) continue;
    const p = Math.max(0.5, o[e.outcome.toLowerCase()]) / 100; s += Math.log(p);
    const l = e.before.lines.find(l => l.stat === e.rune.stat); const ratio = l ? l.value / e.rune.bonus : 0;
    const k = ratio > 14 ? 'ratio>14' : 'ratio≤14';
    const b = bins[k] = bins[k] || { n: 0, pass: 0, att: 0, sc: 0, esc: 0 };
    b.n++; b.pass += e.outcome !== 'EC'; b.att += (o.sc + o.sn) / 100; b.sc += e.outcome === 'SC'; b.esc += o.sc / 100;
  }
  console.log(label.padEnd(44), 'logL', s.toFixed(1), Object.entries(bins).map(([k, b]) => `${k}: pass ${b.pass}/${b.n} att ${b.att.toFixed(1)} · SC ${b.sc} att ${b.esc.toFixed(1)}`).join(' | '));
}
const base = { ...FM.P };
const set = o => Object.assign(FM.P, base, o);
set({}); ll('actuel');
for (const step of [45, 35, 25, 15]) for (const slope of [12, 18, 24, 30, 36]) { set({ STEP: step, RATIO_SLOPE: slope }); ll(`palier ${step}, pente ratio ${slope}`); }
for (const start of [10, 12]) for (const slope of [12, 18, 24]) { set({ RATIO_START: start, RATIO_SLOPE: slope, STEP: 25 }); ll(`ratio dès ${start}, pente ${slope}, palier 25`); }
