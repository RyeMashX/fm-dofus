// Lecture de la fenêtre de forgemagie du jeu (Cordomager, Forgemager…) par OCR.
//
// Entrées :
//   frame : { width, height, data } image RGBA (ImageData du navigateur, ou pngjs en node)
//   ocr   : async (rect, psm, scale, threshold) → [{ text, bbox:{x0,y0,x1,y1} }] lignes de texte en coordonnées
//           du frame (scale : agrandissement du prétraitement ; threshold : binarisation, null = niveaux de gris)
// Sortie : { reliquat, table: [{min,max,value,stat,label}], history: [entries…], tableRect, historyRect }
//   history : liste d'entrées (ancienne → récente), chacune [{stat, delta} | {reliquat: +1|-1}]

import { STAT_BY_KEY } from './stats.js';

const strip = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Libellé du jeu → stat de l'outil. pct = un « % » suit la valeur.
export function labelToStat(label, pct) {
  const l = strip(label).replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const has = (...ws) => ws.every(w => l.includes(w));
  if (has('chasse')) return 'chasse';
  if (has('retrait', 'pa')) return 'ret_pa';
  if (has('retrait', 'pm')) return 'ret_pme';
  if (has('esquive', 'pa')) return 're_pa';
  if (has('esquive', 'pm')) return 're_pme';
  if (/r[eé]sist/.test(l)) {
    if (has('critique')) return 're_cri';
    if (has('pouss')) return 're_pou';
    if (has('melee')) return 're_per_me';
    if (has('distance')) return 're_per_di';
    for (const el of ['neutre', 'terre', 'feu', 'eau', 'air']) if (has(el)) return pct ? `re_per_${el}` : `re_${el}`;
    return null;
  }
  if (/dom+ag|donmag|dommad/.test(l)) {
    if (has('critique')) return 'do_cri';
    if (has('pouss')) return 'do_pou';
    if (has('piege')) return 'do_pi';
    if (has('renvoy') || has('renvoi')) return 'do_ren';
    if (has('melee')) return 'do_per_me';
    if (has('distance')) return 'do_per_di';
    if (has('arme')) return 'do_per_ar';
    if (has('sort')) return 'do_per_so';
    for (const el of ['neutre', 'terre', 'feu', 'eau', 'air']) if (has(el)) return `do_${el}`;
    return 'do';
  }
  if (has('renvoi')) return 'do_ren';
  if (has('puissance')) return has('piege') ? 'pui_pi' : 'pui';
  if (/critiq|crltiq/.test(l)) return 'cri';
  if (/vital|vita1/.test(l)) return 'vita';
  if (/forc/.test(l)) return 'fo';
  if (/intel|lntel/.test(l)) return 'ine';
  if (/chanc/.test(l)) return 'cha';
  if (/ag.?ilit|agilt/.test(l)) return 'age';
  if (/sages|saqes/.test(l)) return 'sa';
  if (/prosp/.test(l)) return 'prospe';
  if (/initiat|lnitiat/.test(l)) return 'ini';
  if (has('pod')) return 'pod';
  if (has('tacle')) return 'tacle';
  if (has('fuite')) return 'fuite';
  if (has('soin')) return 'so';
  if (has('invocation')) return 'invo';
  if (has('portee')) return 'po';
  if (/\bpm\b/.test(l)) return 'pm';
  if (/\bpa\b/.test(l)) return 'pa';
  return null;
}

// Nettoie une ligne OCR : enlève les glyphes parasites des icônes devant les nombres.
const clean = s => s.replace(/[^\w\s%:.,+\-àâäéèêëîïôöùûüç'’]/gi, ' ').replace(/\s+/g, ' ').trim();

// « 301 350 ♥ 307 Vitalité » → { min, max, value, pct, label, stat }. null si ce n'est pas une ligne de stat.
// Extraction par position : 1er et 2e entiers = min et max ; dernier entier avant le libellé = valeur
// (les icônes de stat sont parfois lues comme un chiffre parasite entre les deux).
export function parseTableLine(text) {
  const t = clean(text);
  if (/arme de chasse/i.test(strip(t))) return { min: 0, max: 0, value: 0, pct: false, label: 'Arme de chasse', stat: 'chasse' };
  const toks = t.split(/\s+/);
  const labelAt = toks.findIndex(k => /^[A-Za-zÀ-ÿ'’]{3,}$/.test(k) && !/^\d/.test(k));
  if (labelAt < 2) return null;
  // « 18 à 25 dommages Feu », « 3 à 5 vol Eau » : lignes d'arme, non forgemageables (libellé en minuscule,
  // ou « à » entre deux nombres avec quatre nombres au total)
  const aIdx = toks.findIndex((k, i) => i < labelAt && /^a$/.test(strip(k)) && /\d$/.test(toks[i - 1] || '') && /^\d/.test(toks[i + 1] || ''));
  const numCount = toks.slice(0, labelAt).filter(k => /^-?\d+%?$/.test(k)).length;
  const lower = /^[a-zà-ÿ]/.test(toks[labelAt]);
  if (lower && (aIdx >= 0 || numCount >= 4 || /\d[àa]\d/.test(t))) return null;
  if (aIdx >= 0 && numCount >= 4) return null;
  if (/\d[àa]\d/.test(t)) return null;
  const nums = [];
  for (let i = 0; i < labelAt; i++) { const m = toks[i].match(/^(-?\d+)(%?)$/); if (m) nums.push({ i, v: +m[1], pct: m[2] === '%' }); }
  if (!nums.length) return null;
  const last = nums[nums.length - 1];
  if (last.i !== labelAt - 1) return null;                          // la valeur précède immédiatement le libellé
  const labelRaw = toks.slice(labelAt).join(' ');
  const stat = labelToStat(labelRaw, last.pct);
  if (!stat) return null;
  // min et max si on les a lus (ils servent à départager des lignes de même stat) ; sinon null
  const mm = nums.length >= 3 ? [nums[0].v, nums[1].v] : [null, null];
  return { min: mm[0], max: mm[1], value: last.v, pct: last.pct, label: tidyLabel(labelRaw), stat };
}

// Enlève les tokens parasites en fin de libellé (colonnes de runes lues comme du texte).
const KNOWN_SHORT = new Set(['feu', 'air', 'eau', 'pa', 'pm', 'po']);
function tidyLabel(label) {
  const toks = label.trim().split(/\s+/);
  while (toks.length > 1) { const t = toks[toks.length - 1]; if (t.length <= 3 && !KNOWN_SHORT.has(strip(t))) toks.pop(); else break; }
  return toks.join(' ');
}

// « -3 Vitalité », « 1% Critique », « + reliquat » → { stat, delta } | { reliquat: ±1 } | null
export function parseHistoryLine(text) {
  const t = clean(text);
  const r = t.match(/([+\-])\s*reliquat/i);
  if (r) return { reliquat: r[1] === '+' ? 1 : -1 };
  const m = t.match(/(?:^|[\s(])(-?\d+)\s*(%?)\s+([A-Za-zÀ-ÿ'’ ]+?)\s*$/);
  if (!m) return null;
  const stat = labelToStat(m[3], m[2] === '%');
  return stat ? { stat, delta: +m[1], label: tidyLabel(m[3]) } : null;
}

// Prétraitement d'une zone pour l'OCR : agrandissement ×scale (bilinéaire), niveaux de gris inversés (texte
// sombre sur fond clair) ; binarisation seulement si threshold est fourni. Retourne { width, height, data (RGBA) }.
export function preprocess(frame, rect, scale = 3, threshold = null) {
  const x0 = Math.max(0, rect.x | 0), y0 = Math.max(0, rect.y | 0);
  const w = Math.min(frame.width - x0, rect.w | 0), h = Math.min(frame.height - y0, rect.h | 0);
  const W = w * scale, H = h * scale, out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    // bilinéaire
    const sx = x / scale, sy = y / scale, ix = Math.min(w - 2, sx | 0), iy = Math.min(h - 2, sy | 0), fx = sx - ix, fy = sy - iy;
    const lum = (xx, yy) => { const i = ((y0 + yy) * frame.width + (x0 + xx)) * 4; return (frame.data[i] * 0.3 + frame.data[i + 1] * 0.5 + frame.data[i + 2] * 0.2); };
    const v = lum(ix, iy) * (1 - fx) * (1 - fy) + lum(ix + 1, iy) * fx * (1 - fy) + lum(ix, iy + 1) * (1 - fx) * fy + lum(ix + 1, iy + 1) * fx * fy;
    const b = threshold == null ? Math.max(0, Math.min(255, 255 - v)) : (v > threshold ? 0 : 255);
    const o = (y * W + x) * 4; out[o] = out[o + 1] = out[o + 2] = b; out[o + 3] = 255;
  }
  return { width: W, height: H, data: out, scale, x0, y0 };
}

// Bord gauche du panneau d'historique : depuis la gauche du tableau, on recule tant que la couleur reste celle du
// fond du panneau (la fenêtre de forgemagie peut être capturée avec tout le jeu autour).
function findPanelLeft(frame, tableX, y0, y1) {
  // plusieurs points de départ (il peut y avoir une marge entre le panneau et le tableau) et plusieurs
  // hauteurs ; on garde, par hauteur, le bord le plus à gauche atteint, puis la médiane.
  const lefts = [];
  for (let k = 0; k < 7; k++) {
    const y = Math.round(y0 + (y1 - y0) * (k + 1) / 8);
    let best = tableX;
    for (const off of [8, 30, 60, 100, 150]) {
      const xs = Math.round(tableX - off); if (xs <= 0) break;
      const i0 = (y * frame.width + xs) * 4, bg = [frame.data[i0], frame.data[i0 + 1], frame.data[i0 + 2]];
      let x = xs, miss = 0, last = xs;
      while (x > 0) {
        const i = (y * frame.width + x) * 4;
        const d = Math.abs(frame.data[i] - bg[0]) + Math.abs(frame.data[i + 1] - bg[1]) + Math.abs(frame.data[i + 2] - bg[2]);
        if (d < 45) { miss = 0; last = x; } else if (++miss > 12) break;
        x--;
      }
      if (xs - last > 60 && last < best) best = last;
    }
    lefts.push(best);
  }
  lefts.sort((a, b) => a - b);
  return lefts[lefts.length >> 1];
}

// Couleur de fond d'une zone : médiane par canal.
function background(frame, x0, y0, x1, y1) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const ch = [[], [], []];
  for (let y = y0; y < y1; y += 3) for (let x = x0; x < x1; x += 3) { const i = (y * frame.width + x) * 4; ch[0].push(frame.data[i]); ch[1].push(frame.data[i + 1]); ch[2].push(frame.data[i + 2]); }
  return ch.map(a => a.sort((u, v) => u - v)[a.length >> 1] ?? 0);
}
// Fraction de pixels qui s'écartent nettement du fond : une icône donne > 25 %, le fond nu ≈ 0 %.
function foreignFraction(frame, bg, x0, y0, x1, y1) {
  x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(frame.width, x1 | 0); y1 = Math.min(frame.height, y1 | 0);
  let n = 0, k = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * frame.width + x) * 4;
    const d = Math.abs(frame.data[i] - bg[0]) + Math.abs(frame.data[i + 1] - bg[1]) + Math.abs(frame.data[i + 2] - bg[2]);
    n++; if (d > 60) k++;
  }
  return n ? k / n : 0;
}

const parseReliquat = text => { const m = strip(text).match(/reliquat\s*[:;]?\s*(-?\d+(?:[.,]\d+)?)/); return m ? parseFloat(m[1].replace(',', '.')) : null; };

// hints : zones mémorisées d'une lecture précédente ({ tableRect, historyRect, reliquatRect }) pour sauter
// la passe de repérage ; le résultat renvoie les hints à réutiliser.
export async function readScreen(frame, ocr, hints = null) {
  const W = frame.width, H = frame.height;
  let tableRect, historyRect, reliquatRect = null, reliquat = null;
  if (hints && hints.frameW === W && hints.frameH === H) {
    ({ tableRect, historyRect, reliquatRect } = hints);
    if (reliquatRect) for (const l of await ocr(reliquatRect, 7, 3, null)) { const v = parseReliquat(l.text); if (v != null) { reliquat = v; break; } }
  }
  if (!tableRect || (hints?.reliquatRect && reliquat == null)) {
    // 1. repères : « Min » « Max » (en-tête du tableau) et « reliquat : x »
    const sparse = await ocr({ x: 0, y: 0, w: W, h: H }, 11);
    const words = sparse.map(l => ({ ...l, t: strip(l.text) }));
    const min = words.find(w => /^min$/.test(w.t.trim()));
    const max = words.find(w => /^max$/.test(w.t.trim()) && min && Math.abs(w.bbox.y0 - min.bbox.y0) < (min.bbox.y1 - min.bbox.y0) * 2);
    for (const w of sparse) { const v = parseReliquat(w.text); if (v != null) { reliquat = v; const h = w.bbox.y1 - w.bbox.y0; reliquatRect = { x: Math.max(0, w.bbox.x0 - h), y: Math.max(0, w.bbox.y0 - h * 0.6), w: (w.bbox.x1 - w.bbox.x0) + h * 6, h: h * 2.2 }; break; } }
    if (!min || !max) return { reliquat, table: [], history: [], error: 'En-tête « Min / Max » introuvable : la fenêtre de forgemagie est-elle visible ?' };
    const rowH = (min.bbox.y1 - min.bbox.y0) * 1.6;
    const tableX = Math.max(0, min.bbox.x0 - rowH * 1.5);
    const headerY = min.bbox.y1 + rowH * 0.3;
    const modif = words.find(w => /^modif/.test(w.t.trim()) && Math.abs(w.bbox.y0 - min.bbox.y0) < rowH);
    const tableRight = modif ? modif.bbox.x1 + rowH : W;
    tableRect = { x: tableX, y: headerY, w: tableRight - tableX, h: H - headerY };
    const panelLeft = findPanelLeft(frame, tableX, headerY, Math.min(H, headerY + rowH * 20));
    historyRect = { x: panelLeft, y: headerY, w: Math.max(0, tableX - 4 - panelLeft), h: H - headerY };
  }

  // 2. tableau
  const table = [], tableUnparsed = [];
  for (const l of await ocr(tableRect, 6, 3, 105)) {
    const row = parseTableLine(l.text);
    if (row) table.push({ ...row, bbox: l.bbox }); else if (/\d/.test(l.text)) tableUnparsed.push(l.text.trim());
  }

  // 3. historique : lignes, puis regroupement par icône de rune (zone à gauche du texte)
  const history = [];
  if (historyRect.w > 60) {
    const panelW = historyRect.w;
    const iconX0 = historyRect.x + panelW * 0.02, iconX1 = historyRect.x + panelW * 0.12;
    const bg = background(frame, iconX0, historyRect.y, iconX1, historyRect.y + historyRect.h);
    // l'OCR ignore la colonne des icônes de rune (elles produisent des caractères parasites)
    const textRect = { x: historyRect.x + panelW * 0.15, y: historyRect.y, w: panelW * 0.85, h: historyRect.h };
    const lines = (await ocr(textRect, 6, 3, null)).filter(l => l.text.trim()).sort((a, b) => a.bbox.y0 - b.bbox.y0);
    if (globalThis.FM_OCR_DEBUG) console.log('historyRect', historyRect, 'textRect', textRect, '\n' + lines.map(l => `  [y ${l.bbox.y0 | 0} x ${l.bbox.x0 | 0}] ${l.text}`).join('\n'));
    let current = null;
    for (const l of lines) {
      const h = l.bbox.y1 - l.bbox.y0;
      const iconZone = 100 * foreignFraction(frame, bg, iconX0, l.bbox.y0 + h * 0.15, iconX1, l.bbox.y1 - h * 0.15);
      const hasIcon = iconZone > 15;
      const parsed = parseHistoryLine(l.text);
      const isHeader = !parsed && /[A-Z]{4,}/.test(l.text) && l.text === l.text.toUpperCase();
      if (isHeader || /vider l'?historique/i.test(strip(l.text))) { current = null; continue; }
      if (!parsed) continue;
      if (hasIcon || !current) { current = { items: [], bbox: { ...l.bbox }, iconScore: iconZone }; history.push(current); }
      current.items.push(parsed); current.bbox.y1 = l.bbox.y1;
    }
  }
  return { reliquat, table, tableUnparsed, history: history.map(e => e.items), historyRaw: history, tableRect, historyRect,
           hints: { frameW: W, frameH: H, tableRect, historyRect, reliquatRect } };
}

// Déduit, à partir de la dernière entrée de l'historique et de la rune posée, le résultat et les deltas.
export function interpretEntry(entry, rune) {
  if (!entry || !entry.length) return null;
  const deltas = {}; let relDir = 0;
  for (const it of entry) {
    if (it.reliquat) relDir = it.reliquat;
    else deltas[it.stat] = (deltas[it.stat] || 0) + it.delta;
  }
  // la rune est passée si sa ligne a gagné ; un gain inférieur au bonus (ra vi → +48) est un SN qui a aussi
  // pris sur la ligne posée
  const gained = !!rune && (deltas[rune.stat] || 0) > 0;
  const ownLoss = gained ? Math.max(0, rune.bonus - deltas[rune.stat]) : 0;
  const losses = Object.entries(deltas).filter(([s, d]) => d < 0 || (s !== rune?.stat && d !== 0));
  const outcome = gained ? (losses.length || relDir || ownLoss ? 'SN' : 'SC') : 'EC';
  return { outcome, deltas, relDir, gained, ownLoss };
}
