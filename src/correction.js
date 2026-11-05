// Correction des données : une pose enregistrée en SC alors que le reliquat a bougé est un SN
// (un SC ne prend rien : ni ligne, ni reliquat). Cause : la lecture d'écran ne voyait pas toujours la ligne
// « − reliquat » de l'historique du jeu ; la pose passait en SC avec le reliquat lu en haut de la fenêtre.
// Idempotent : ne touche que des SC dont le reliquat a changé.

const EPS = 0.01;
const relBouge = (avant, apres) => avant != null && apres != null && Math.abs(apres - avant) > EPS;

export const scDouteux = e => e && e.outcome === 'SC' && !e.simulated && relBouge(e.before?.reliquat, e.after?.reliquat);
export const scDouteuxHistorique = e => e && e.outcome === 'SC' && !e.simulated && Math.abs(e.reliquatDelta || 0) > EPS;

// journal = [entrées v2], history = [poses de la session en cours], sessions = [sessions archivées]
// Retourne le nombre de corrections ; modifie les tableaux sur place.
export function corrigerSCReliquat({ journal = [], history = [], sessions = [] }) {
  const res = { journal: 0, history: 0, sessions: 0 };
  const parSession = new Map();
  for (const e of journal) {
    if (!scDouteux(e)) continue;
    e.outcome = 'SN'; e.corrige = 'SC→SN (reliquat)'; res.journal++;
    if (e.session != null) { const l = parSession.get(e.session) || []; l.push(e); parSession.set(e.session, l); }
  }
  for (const e of history) if (scDouteuxHistorique(e)) { e.outcome = 'SN'; e.corrige = 'SC→SN (reliquat)'; res.history++; }
  // sessions archivées : compteurs, détail par rune et indice de chance (SC compte +1, SN 0)
  for (const s of sessions) {
    const fix = parSession.get(s.id); if (!fix?.length) continue;
    if (s.n) { s.n.SC -= fix.length; s.n.SN += fix.length; }
    for (const e of fix) { const b = s.byRune?.find(x => x.id === e.rune.id); if (b) { b.SC--; b.SN++; } }
    const var_ = journal.filter(e => e.session === s.id && e.odds && !e.odds.blocked)
      .reduce((a, e) => { const sc = e.odds.sc / 100, ec = e.odds.ec / 100, m = sc - ec; return a + (sc + ec) - m * m; }, 0);
    if (var_ > 0 && s.z != null) s.z = Math.round((s.z - fix.length / Math.sqrt(var_)) * 100) / 100;
    s.corrige = (s.corrige || 0) + fix.length; res.sessions++;
  }
  return res;
}
