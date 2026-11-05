// Tests de non-régression : lectures du simulateur DoFocus faites par Charles le 2026-11-02.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as FM from '../src/engine.js';
import { RUNE_BY_ID, STAT_BY_KEY } from '../src/stats.js';

const R = id => RUNE_BY_ID[id];
const L = (stat, value, min, max) => ({ stat, value, min: min ?? null, max: max ?? null });
const item = (lines, level = 200) => ({ level, lines });
const show = o => o.blocked ? 'MAX' : [FM.fmt(o.sc), FM.fmt(o.sn), FM.fmt(o.ec)];

// Objet de test "série 1" : une seule ligne + une ligne vide à côté pour que la qualité reste nulle.
// (Charles a testé sur un objet à plusieurs lignes dont la qualité donnait un terme ~0.)
function solo(stat, value, min, max) { return item([L(stat, value, min, max), L('cha', 0, 51, 70)]); }

test('série vita 301-350 (poids 0,2) : SN selon l\'over, ×14 écrase vi et pa vi', () => {
  const cases = { 350: [[2, 5, 93], [2, 5, 93], [2, 36, 62]], 400: [[2, 5, 93], [2, 5, 93], [2, 21, 77]],
                  450: [[2, 5, 93], [2, 5, 93], [2, 6.3, 92]] /* 6,25 exact ; Charles a lu 6,2 (reste de qualité sur son objet) */, 500: [[2, 5, 93], 'MAX', 'MAX'], 501: ['MAX', 'MAX', 'MAX'] };
  for (const [v, exp] of Object.entries(cases)) {
    const it = solo('vita', +v, 301, 350);
    ['vita:0', 'vita:1', 'vita:2'].forEach((id, k) => assert.deepEqual(show(FM.odds(it, R(id))), exp[k], `vita ${v} ${id}`));
  }
});

test('série do eau 11-15 (poids 5)', () => {
  const cases = { 15: [[2, 39, 59], [2, 29, 69]], 16: [[2, 27, 71], [2, 21, 77]], 17: [[2, 15, 83], [2, 14, 84]],
                  18: [[2, 5, 93], 'MAX'], 19: [[2, 5, 93], 'MAX'], 20: ['MAX', 'MAX'] };
  for (const [v, exp] of Object.entries(cases)) {
    const it = solo('do_eau', +v, 11, 15);
    ['do_eau:0', 'do_eau:1'].forEach((id, k) => assert.deepEqual(show(FM.odds(it, R(id))), exp[k], `do eau ${v} ${id}`));
  }
});

// Ceinture de la capture : SN affiché par rune.
const belt = () => item([
  L('vita', 350, 301, 350), L('fo', 70, 51, 70), L('cha', 0, 51, 70), L('sa', 39, 31, 40), L('cri', 4, 3, 4),
  L('po', 1, 1, 1), L('do_neutre', 0, 11, 15), L('do_terre', 0, 11, 15), L('do_eau', 0, 11, 15),
  L('prospe', 15, 11, 15), L('re_per_terre', 7, 5, 7), L('re_cri', 30, 21, 30),
]);

test('ceinture : SN par rune', () => {
  const exp = { vita: [5, 5, 36], fo: [5, 5, 36], cha: [50, 50, 50], sa: [15, 'MAX', 'MAX'], cri: [36], po: ['MAX'],
                do_neutre: [50, 50], do_terre: [50, 50], do_eau: [50, 50], prospe: [42, 38], re_per_terre: [42], re_cri: [5, 42, 21] };
  for (const [stat, sns] of Object.entries(exp)) sns.forEach((sn, k) => {
    const o = FM.odds(belt(), R(`${stat}:${k}`));
    assert.equal(o.blocked ? 'MAX' : FM.fmt(o.sn), sn, `${stat}:${k}`);
  });
});

test('qualité : terme +0/+1/+3 selon l\'état de la ceinture', () => {
  const q = (it, stat) => Math.round(60 * FM.odds(it, R(`${stat}:0`)).quality ** 12);
  let it = belt();
  assert.equal(q(it, 'vita'), 0); assert.equal(q(it, 'cha'), 1); assert.equal(q(it, 'do_eau'), 1);
  it.lines[2].value = 70;
  assert.equal(q(it, 'vita'), 1); assert.equal(q(it, 'do_eau'), 3); // sagesse : 0,45 → 0, non lue par Charles
});

test('qualité : objet plein sauf sagesse → +57 partout, +60 sur la sagesse', () => {
  const it = belt(); it.lines[2].value = 70; [6, 7, 8].forEach(i => it.lines[i].value = 15);
  const q = stat => Math.round(60 * FM.odds(it, R(`${stat}:0`)).quality ** 12);
  assert.equal(q('vita'), 57); assert.equal(q('cri'), 57); assert.equal(q('sa'), 60);
});

test('qualité : do neutre vidé → +15 / +16 / +57', () => {
  const it = belt(); it.lines[2].value = 70; [7, 8].forEach(i => it.lines[i].value = 15);
  const q = stat => Math.round(60 * FM.odds(it, R(`${stat}:0`)).quality ** 12);
  for (const s of ['vita', 'fo', 'cha', 'sa', 'do_terre', 'do_eau']) assert.equal(q(s), 15, s);
  for (const s of ['cri', 'prospe', 're_per_terre', 're_cri']) assert.equal(q(s), 16, s);
  assert.equal(q('do_neutre'), 57);
  // la rune choisie n'influence pas la qualité
  assert.equal(Math.round(60 * FM.odds(it, R('vita:2')).quality ** 12), 15);
});

test('qualité : over et exo légers ignorés, exo PA/PM forcent 1', () => {
  const it = belt();
  it.lines[8].value = 15;
  const base = FM.odds(it, R('vita:0')).quality;
  it.lines[8].value = 17; // do eau en over : l'excédent ne compte pas
  assert.equal(FM.odds(it, R('vita:0')).quality, base);
  it.lines.push(L('ine', 30));
  assert.equal(FM.odds(it, R('vita:0')).quality, base);
  it.lines.push(L('invo', 1));
  assert.equal(FM.odds(it, R('vita:0')).quality, base);
  // plafond objet : la charge over + exo ne peut pas dépasser 101
  it.lines.push(L('age', 50));
  assert.equal(FM.odds(it, R('vita:0')).blocked, 'item-cap');
  const withPa = belt(); withPa.lines.forEach(l => l.value = 0); withPa.lines.push(L('pa', 1));
  assert.equal(FM.odds(withPa, R('vita:0')).quality, 1);
});

test('palier des 80 % : force 56/70 (pas de palier) et 57/70 (palier), objet plein', () => {
  const it = belt(); it.lines[2].value = 70; [6, 7, 8].forEach(i => it.lines[i].value = 15); it.lines[3].value = 40;
  it.lines[1].value = 56;
  let o = FM.odds(it, R('fo:2'));
  assert.equal(Math.round(o.difficulty), 65); assert.deepEqual(show(o), [18, 50, 33]);
  it.lines[1].value = 57;
  o = FM.odds(it, R('fo:2'));
  assert.equal(Math.round(o.difficulty), 110); assert.deepEqual(show(o), [2, 46, 52]);
});

test('niveau 162 vide : difficulté −17, 59/42/0 ; niveau 170 : pas de bonus', () => {
  const it = item([L('ine', 0, 51, 70), L('vita', 0, 301, 350)], 162);
  const o = FM.odds(it, R('ine:0'));
  assert.equal(Math.round(o.difficulty), -17); assert.deepEqual(show(o), [59, 42, 0]);
  assert.equal(Math.round(FM.odds(item(it.lines, 170), R('ine:0')).difficulty), 5);
});

test('exo fo : table sur le poids final, 30 lectures', () => {
  const exp = {
    0: [[4.4, 53, 43], [4.2, 50, 46], [2.6, 31, 66]], 1: [[4.4, 53, 43], [3.9, 47, 49], [2.4, 28, 69]],
    2: [[4.2, 50, 46], [3.7, 45, 52], [2.1, 26, 72]], 3: [[3.9, 47, 49], [3.5, 42, 55], [1.9, 23, 75]],
    4: [[3.7, 45, 52], [3.3, 39, 58], [1.7, 20, 78]], 5: [[3.5, 42, 55], [3, 36, 61], [1.5, 18, 81]],
    6: [[3.3, 39, 58], [2.8, 34, 63], [1.3, 16, 83]], 7: [[3, 36, 61], [2.6, 31, 66], [1.2, 14, 85]],
    8: [[2.8, 34, 63], [2.4, 28, 69], [1, 12, 87]], 9: [[2.6, 31, 66], [2.1, 26, 72], [1, 11, 88]],
  };
  for (const [v, rows] of Object.entries(exp)) {
    const it = item([L('vita', 350, 301, 350), ...(+v > 0 ? [L('fo', +v)] : [])]);
    ['fo:0', 'fo:1', 'fo:2'].forEach((id, k) => assert.deepEqual(show(FM.odds(it, R(id))), rows[k], `exo fo ${v} ${id}`));
  }
});

test('exo do cri / ré per air / do per so / pa ini', () => {
  const it = v => item([L('vita', 350, 301, 350), ...(v ? [L('do_cri', v)] : [])]);
  assert.deepEqual(show(FM.odds(it(0), R('do_cri:0'))), [3.7, 45, 52]);
  assert.deepEqual(show(FM.odds(it(0), R('do_cri:1'))), [1.5, 18, 81]);
  assert.deepEqual(show(FM.odds(it(1), R('do_cri:0'))), [2.6, 31, 66]);
  assert.deepEqual(show(FM.odds(it(1), R('do_cri:1'))), [1, 8.8, 90]);
  assert.deepEqual(show(FM.odds(it(2), R('do_cri:1'))), [1, 0, 99]);
  assert.deepEqual(show(FM.odds(it(4), R('do_cri:0'))), [1, 0, 99]);
  assert.deepEqual(show(FM.odds(item([L('vita', 350, 301, 350)]), R('do_per_so:0'))), [1.5, 18, 81]);
  assert.deepEqual(show(FM.odds(item([L('vita', 350, 301, 350), L('re_per_air', 3)]), R('re_per_air:0'))), [1, 1.8, 97]);
  assert.deepEqual(show(FM.odds(item([L('vita', 350, 301, 350), L('ini', 2)]), R('ini:1'))), [4.1, 49, 47]);
  for (const s of ['pa', 'pm', 'po']) assert.deepEqual(show(FM.odds(item([L('vita', 350, 301, 350)]), R(`${s}:0`))), [1, 0, 99], s);
  assert.deepEqual(show(FM.odds(item([L('vita', 350, 301, 350)]), R('invo:0'))), [1, 0, 99]);
});

test('ligne négative : ni qualité ni difficulté, et demi-poids à la perte', () => {
  const it = belt(); it.lines.push(L('re_per_eau', -5, -7, -3));
  const o = FM.odds(it, R('re_per_eau:0'));
  assert.equal(o.half, true);
  assert.equal(Math.round(o.difficulty), 5 + Math.round(60 * o.quality ** 12));
  // perte forcée en SN : la perte vaut 3 (6 / 2)
  let totalLoss = 0;
  for (let k = 0; k < 200; k++) {
    const r = FM.applyMove({ item: it, reliquat: 0 }, R('re_per_eau:0'), Math.random, 'SN');
    const lost = r.changes.filter(c => c.stat !== 're_per_eau').reduce((a, c) => a - c.delta * STAT_BY_KEY[c.stat].weight, 0);
    totalLoss += lost - r.reliquatDelta; // perte réelle moins l'excédent devenu reliquat = poids à perdre
  }
  assert.ok(Math.abs(totalLoss / 200 - 3) < 0.05, `perte moyenne ${totalLoss / 200}`);
});

test('pertes : conservation du poids, reliquat et PA sous une vi vs une do', () => {
  const it = item([L('vita', 350, 301, 350), L('fo', 70, 51, 70), L('cha', 70, 51, 70), L('sa', 40, 31, 40),
                   L('cri', 4, 3, 4), L('pa', 1, 1, 1)]);
  let paHitsVi = 0, paHitsDo = 0, N = 20000;
  for (let k = 0; k < N; k++) {
    const r = FM.applyMove({ item: it, reliquat: 0 }, R('vita:0'), Math.random, 'SN');
    const lost = r.changes.filter(c => c.stat !== 'vita').reduce((a, c) => a - c.delta * STAT_BY_KEY[c.stat].weight, 0);
    assert.ok(Math.abs(lost - r.reliquatDelta - 1) < 1e-6, 'conservation vi');
    if (r.changes.some(c => c.stat === 'pa')) paHitsVi++;
    const d = FM.applyMove({ item: it, reliquat: 0 }, R('do:0'), Math.random, 'SN');
    if (d.changes.some(c => c.stat === 'pa')) paHitsDo++;
  }
  // contrôle de cohérence (pas une lecture) : une grosse rune touche le PA bien plus souvent qu'une petite
  assert.ok(paHitsVi / N < 0.015, `PA sous vi : ${paHitsVi / N}`);
  assert.ok(paHitsDo / N > 0.04 && paHitsDo / N < 0.2, `PA sous do : ${paHitsDo / N}`);
  assert.ok(paHitsDo > 5 * paHitsVi);
});

// Départage des égalités : écart de poses dans le bruit → la valeur déterministe (dp) tranche
import { departager } from '../src/search.js';
test('départage : égalité aux aléas près, la plus petite dp passe devant ; écart net, le score décide', () => {
  const r = (name, score, dp, costs) => ({ rune: { id: name, name }, score, dp, costs });
  // Vi : 88 de moyenne mais tirages très dispersés, Pa Do Eau : 89 ; écart non significatif
  const bruit = [0, 30, -25, 10, -15, 20, -20, 5];
  const vi = r('Vi', 88, 437, bruit.map(x => 88 + x));
  const pde = r('Pa Do Eau', 89, 59, bruit.map(x => 89 - x));
  const out = departager([vi, pde]);
  assert.deepEqual(out.map(m => m.rune.id), ['Pa Do Eau', 'Vi']);
  assert.equal(out[0].departage.devant, 'Vi');
  // écart net (mêmes tirages, toujours 5 de plus) : le score l'emporte malgré la dp
  const a = r('A', 10, 50, bruit.map(x => 10 + x)), b = r('B', 15, 1, bruit.map(x => 15 + x));
  assert.deepEqual(departager([b, a]).map(m => m.rune.id), ['A', 'B']);
  // seul le premier coup est départagé : la suite reste classée par poses restantes
  const c = r('C', 90, 300, bruit.map(x => 90 + x));
  assert.deepEqual(departager([vi, c, pde]).map(m => m.rune.id), ['Pa Do Eau', 'Vi', 'C']);
});
