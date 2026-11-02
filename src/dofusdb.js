// Client DofusDB : recherche d'objets par nom et conversion des effets en lignes FM.
// API publique : https://api.dofusdb.fr (CORS ouvert). Mise en cache locale des objets chargés.

import { STAT_BY_KEY } from './stats.js';

const API = 'https://api.dofusdb.fr';

// effectId DofusDB → [stat, signe]. Les malus (signe −1) donnent des lignes négatives.
export const EFFECTS = {
  125: ['vita', 1], 153: ['vita', -1], 118: ['fo', 1], 157: ['fo', -1], 126: ['ine', 1], 155: ['ine', -1],
  123: ['cha', 1], 152: ['cha', -1], 119: ['age', 1], 154: ['age', -1], 124: ['sa', 1], 156: ['sa', -1],
  174: ['ini', 1], 175: ['ini', -1], 158: ['pod', 1], 176: ['prospe', 1], 177: ['prospe', -1],
  138: ['pui', 1], 186: ['pui', -1], 753: ['tacle', 1], 752: ['fuite', 1],
  115: ['cri', 1], 171: ['cri', -1], 178: ['so', 1], 179: ['so', -1],
  112: ['do', 1], 145: ['do', -1],
  430: ['do_neutre', 1], 431: ['do_neutre', -1], 422: ['do_terre', 1], 423: ['do_terre', -1],
  424: ['do_feu', 1], 425: ['do_feu', -1], 426: ['do_eau', 1], 427: ['do_eau', -1], 428: ['do_air', 1], 429: ['do_air', -1],
  414: ['do_pou', 1], 415: ['do_pou', -1], 418: ['do_cri', 1], 419: ['do_cri', -1],
  220: ['do_ren', 1], 225: ['do_pi', 1], 226: ['pui_pi', 1],
  240: ['re_terre', 1], 245: ['re_terre', -1], 241: ['re_eau', 1], 246: ['re_eau', -1], 242: ['re_air', 1], 247: ['re_air', -1],
  243: ['re_feu', 1], 248: ['re_feu', -1], 244: ['re_neutre', 1], 249: ['re_neutre', -1],
  420: ['re_cri', 1], 421: ['re_cri', -1], 416: ['re_pou', 1], 417: ['re_pou', -1],
  210: ['re_per_terre', 1], 215: ['re_per_terre', -1], 211: ['re_per_eau', 1], 216: ['re_per_eau', -1],
  212: ['re_per_air', 1], 217: ['re_per_air', -1], 213: ['re_per_feu', 1], 218: ['re_per_feu', -1],
  214: ['re_per_neutre', 1], 219: ['re_per_neutre', -1],
  2803: ['re_per_me', 1], 2802: ['re_per_me', -1], 2807: ['re_per_di', 1], 2806: ['re_per_di', -1],
  2800: ['do_per_me', 1], 2801: ['do_per_me', -1], 2804: ['do_per_di', 1], 2805: ['do_per_di', -1],
  2808: ['do_per_ar', 1], 2809: ['do_per_ar', -1], 2812: ['do_per_so', 1], 2813: ['do_per_so', -1],
  410: ['ret_pa', 1], 411: ['ret_pa', -1], 412: ['ret_pme', 1], 413: ['ret_pme', -1],
  160: ['re_pa', 1], 162: ['re_pa', -1], 161: ['re_pme', 1], 163: ['re_pme', -1],
  182: ['invo', 1], 117: ['po', 1], 116: ['po', -1], 128: ['pm', 1], 127: ['pm', -1], 169: ['pm', -1], 1080: ['pm', -1],
  111: ['pa', 1], 168: ['pa', -1], 1079: ['pa', -1],
};

// Types d'objets équipables (typeId DofusDB) : amulette, arc, baguette, bâton, dague, épée, marteau, pelle,
// anneau, ceinture, bottes, chapeau, cape, hache, outil, pioche, faux, bouclier, dofus, trophée, prysmaradite…
const EQUIP_TYPES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 19, 20, 21, 22, 82, 114, 151, 271];

function effectToLine(e) {
  const map = EFFECTS[e.effectId];
  if (!map) return null;
  const [stat, sign] = map;
  const a = e.diceNum, b = e.diceSide;
  let min = a, max = b || a;
  if (sign < 0) { min = -(b || a); max = -a; }
  return { stat, value: 0, min: Math.min(min, max), max: Math.max(min, max) };
}

export function itemToTemplate(it) {
  const lines = [], unknown = [];
  for (const e of it.possibleEffects || []) {
    const l = effectToLine(e);
    if (l) lines.push(l); else unknown.push(e.effectId);
  }
  return { id: it.id, name: it.name?.fr || it.name?.en || `#${it.id}`, level: it.level ?? 200,
           type: it.type?.name?.fr || '', iconId: it.iconId, img: it.img, lines, unknown };
}

const cache = new Map();

export async function searchItems(query, { limit = 12 } = {}) {
  const q = query.trim();
  if (q.length < 2) return [];
  const params = new URLSearchParams({ lang: 'fr', $limit: String(limit), 'name.fr[$regex]': q, 'name.fr[$options]': 'i' });
  EQUIP_TYPES.forEach(t => params.append('typeId[$in][]', String(t)));
  const r = await fetch(`${API}/items?${params}`);
  if (!r.ok) throw new Error(`DofusDB ${r.status}`);
  const j = await r.json();
  return (j.data || []).map(itemToTemplate).filter(t => t.lines.length);
}

export async function loadItem(id) {
  if (cache.has(id)) return cache.get(id);
  const r = await fetch(`${API}/items/${id}?lang=fr`);
  if (!r.ok) throw new Error(`DofusDB ${r.status}`);
  const t = itemToTemplate(await r.json());
  cache.set(id, t);
  return t;
}

export const iconUrl = t => t.img || (t.iconId ? `${API}/img/items/${t.iconId}.png` : '');
export const labelOf = stat => STAT_BY_KEY[stat]?.label ?? stat;
