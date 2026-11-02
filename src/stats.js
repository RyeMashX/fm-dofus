// Catalogue des caractéristiques forgemageables et de leurs runes.
// weight = poids par point de caractéristique (règle des 101).
// tiers = runes disponibles : [nom, bonus en points].
// heavyExo = exo à 1 % / 0 % / 99 % quel que soit le poids (PA, PM, PO).
// Source : tableau Huzounet + lectures du simulateur DoFocus (2026-11-02).
// Les tiers marqués "?" n'ont pas été vérifiés dans le simulateur.

const STATS = [
  { key: 'vita',     label: 'Vitalité',                 weight: 0.2,  tiers: [['Vi', 5], ['Pa Vi', 15], ['Ra Vi', 50]] },
  { key: 'fo',       label: 'Force',                    weight: 1,    tiers: [['Fo', 1], ['Pa Fo', 3], ['Ra Fo', 10]] },
  { key: 'ine',      label: 'Intelligence',             weight: 1,    tiers: [['Ine', 1], ['Pa Ine', 3], ['Ra Ine', 10]] },
  { key: 'cha',      label: 'Chance',                   weight: 1,    tiers: [['Cha', 1], ['Pa Cha', 3], ['Ra Cha', 10]] },
  { key: 'age',      label: 'Agilité',                  weight: 1,    tiers: [['Age', 1], ['Pa Age', 3], ['Ra Age', 10]] },
  { key: 'ini',      label: 'Initiative',               weight: 0.1,  tiers: [['Ini', 10], ['Pa Ini', 30], ['Ra Ini', 100]] },
  { key: 'pod',      label: 'Pods',                     weight: 0.25, tiers: [['Pod', 10], ['Pa Pod', 30], ['Ra Pod', 100]] },
  { key: 'sa',       label: 'Sagesse',                  weight: 3,    tiers: [['Sa', 1], ['Pa Sa', 3], ['Ra Sa', 10]] },
  { key: 'prospe',   label: 'Prospection',              weight: 3,    tiers: [['Prospe', 1], ['Pa Prospe', 3]] },
  { key: 'pui',      label: 'Puissance',                weight: 2,    tiers: [['Pui', 1], ['Pa Pui', 3], ['Ra Pui', 10]] },
  { key: 'tacle',    label: 'Tacle',                    weight: 4,    tiers: [['Tacle', 1], ['Pa Tacle', 3]] },
  { key: 'fuite',    label: 'Fuite',                    weight: 4,    tiers: [['Fuite', 1], ['Pa Fuite', 3]] },
  { key: 'cri',      label: 'Coups critiques (%)',      weight: 10,   tiers: [['Cri', 1]] },
  { key: 'so',       label: 'Soins',                    weight: 10,   tiers: [['So', 1]] },
  { key: 'do_neutre',label: 'Dommages neutre (fixe)',   weight: 5,    tiers: [['Do Neutre', 1], ['Pa Do Neutre', 3]] },
  { key: 'do_terre', label: 'Dommages terre (fixe)',    weight: 5,    tiers: [['Do Terre', 1], ['Pa Do Terre', 3]] },
  { key: 'do_feu',   label: 'Dommages feu (fixe)',      weight: 5,    tiers: [['Do Feu', 1], ['Pa Do Feu', 3]] },
  { key: 'do_eau',   label: 'Dommages eau (fixe)',      weight: 5,    tiers: [['Do Eau', 1], ['Pa Do Eau', 3]] },
  { key: 'do_air',   label: 'Dommages air (fixe)',      weight: 5,    tiers: [['Do Air', 1], ['Pa Do Air', 3]] },
  { key: 'do_pou',   label: 'Dommages poussée',         weight: 5,    tiers: [['Do Pou', 1], ['Pa Do Pou', 3]] },
  { key: 'do_cri',   label: 'Dommages critiques',       weight: 5,    tiers: [['Do Cri', 1], ['Pa Do Cri', 3]] },
  { key: 'do_ren',   label: 'Renvoi de dommages',       weight: 5,    tiers: [['Do Ren', 1], ['Pa Do Ren', 3]] },
  { key: 'do_pi',    label: 'Dommages pièges',          weight: 5,    tiers: [['Do Pi', 1], ['Pa Do Pi', 3]] },
  { key: 'pui_pi',   label: 'Puissance pièges',         weight: 2,    tiers: [['Per Pi', 1], ['Pa Per Pi', 3]] },
  { key: 'chasse',   label: 'Dommages de chasse',       weight: 5,    tiers: [['Chasse', 1], ['Pa Chasse', 3]], weaponOnly: true },
  { key: 'do',       label: 'Dommages (fixe, tous éléments)', weight: 20, tiers: [['Do', 1]] },
  { key: 'do_per_ar',label: 'Dommages armes (%)',       weight: 15,   tiers: [['Do Per Ar', 1]] },
  { key: 'do_per_di',label: 'Dommages distance (%)',    weight: 15,   tiers: [['Do Per Di', 1]] },
  { key: 'do_per_me',label: 'Dommages mêlée (%)',       weight: 15,   tiers: [['Do Per Mé', 1]] },
  { key: 'do_per_so',label: 'Dommages sorts (%)',       weight: 15,   tiers: [['Do Per So', 1]] },
  { key: 're_neutre',label: 'Résistance neutre (fixe)', weight: 2,    tiers: [['Ré Neutre', 1], ['Pa Ré Neutre', 3]] },
  { key: 're_terre', label: 'Résistance terre (fixe)',  weight: 2,    tiers: [['Ré Terre', 1], ['Pa Ré Terre', 3]] },
  { key: 're_feu',   label: 'Résistance feu (fixe)',    weight: 2,    tiers: [['Ré Feu', 1], ['Pa Ré Feu', 3]] },
  { key: 're_eau',   label: 'Résistance eau (fixe)',    weight: 2,    tiers: [['Ré Eau', 1], ['Pa Ré Eau', 3]] },
  { key: 're_air',   label: 'Résistance air (fixe)',    weight: 2,    tiers: [['Ré Air', 1], ['Pa Ré Air', 3]] },
  { key: 're_cri',   label: 'Résistance critiques (fixe)', weight: 2, tiers: [['Ré Cri', 1], ['Pa Ré Cri', 3], ['Ra Ré Cri', 10]] },
  { key: 're_pou',   label: 'Résistance poussée (fixe)',   weight: 2, tiers: [['Ré Pou', 1], ['Pa Ré Pou', 3], ['Ra Ré Pou', 10]] },
  { key: 're_per_neutre', label: 'Résistance neutre (%)', weight: 6, tiers: [['Ré Per Neutre', 1], ['Pa Ré Per Neutre', 3]] },
  { key: 're_per_terre',  label: 'Résistance terre (%)',  weight: 6, tiers: [['Ré Per Terre', 1], ['Pa Ré Per Terre', 3]] },
  { key: 're_per_feu',    label: 'Résistance feu (%)',    weight: 6, tiers: [['Ré Per Feu', 1], ['Pa Ré Per Feu', 3]] },
  { key: 're_per_eau',    label: 'Résistance eau (%)',    weight: 6, tiers: [['Ré Per Eau', 1], ['Pa Ré Per Eau', 3]] },
  { key: 're_per_air',    label: 'Résistance air (%)',    weight: 6, tiers: [['Ré Per Air', 1], ['Pa Ré Per Air', 3]] },
  { key: 're_per_di',     label: 'Résistance distance (%)', weight: 10, tiers: [['Ré Per Di', 1]] },
  { key: 're_per_me',     label: 'Résistance mêlée (%)',  weight: 10, tiers: [['Ré Per Mé', 1]] },
  { key: 'ret_pa',   label: 'Retrait PA',                weight: 7,    tiers: [['Ret PA', 1], ['Pa Ret PA', 3]] },
  { key: 'ret_pme',  label: 'Retrait PM',                weight: 7,    tiers: [['Ret PM', 1], ['Pa Ret PM', 3]] },
  { key: 're_pa',    label: 'Résistance retrait PA',     weight: 7,    tiers: [['Ré PA', 1], ['Pa Ré PA', 3]] },
  { key: 're_pme',   label: 'Résistance retrait PM',     weight: 7,    tiers: [['Ré PM', 1], ['Pa Ré PM', 3]] },
  { key: 'invo',     label: 'Invocations',               weight: 30,   tiers: [['Invo', 1]] },
  { key: 'po',       label: 'Portée',                    weight: 51,   tiers: [['PO', 1]], heavyExo: true },
  { key: 'pm',       label: 'PM',                        weight: 90,   tiers: [['PM', 1]], heavyExo: true, forcesQuality: true },
  { key: 'pa',       label: 'PA',                        weight: 100,  tiers: [['PA', 1]], heavyExo: true, forcesQuality: true },
];

const STAT_BY_KEY = Object.fromEntries(STATS.map(s => [s.key, s]));

// Liste plate des runes : { id, stat, name, bonus, weight (poids total de la rune), tier }
const RUNES = STATS.flatMap(s => s.tiers.map(([name, bonus], tier) => ({
  id: `${s.key}:${tier}`, stat: s.key, name, bonus, weight: bonus * s.weight, tier,
})));
const RUNE_BY_ID = Object.fromEntries(RUNES.map(r => [r.id, r]));

export { STATS, STAT_BY_KEY, RUNES, RUNE_BY_ID };
