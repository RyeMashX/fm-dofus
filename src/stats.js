// Catalogue des caractéristiques forgemageables et de leurs runes.
// weight = poids par point de caractéristique (règle des 101).
// tiers = runes disponibles : [nom, bonus en points, iconId DofusDB, id d'objet DofusDB].
// heavyExo = exo à 1 % / 0 % / 99 % quel que soit le poids (PA, PM, PO).
// Source : tableau Huzounet + lectures du simulateur DoFocus (2026-11-02).
// Les tiers marqués "?" n'ont pas été vérifiés dans le simulateur.

const STATS = [
  { key: 'vita',     label: 'Vitalité',                 weight: 0.2,  tiers: [['Vi', 5, 78052, 1523], ['Pa Vi', 15, 78053, 1548], ['Ra Vi', 50, 78054, 1554]] },
  { key: 'fo',       label: 'Force',                    weight: 1,    tiers: [['Fo', 1, 78043, 1519], ['Pa Fo', 3, 78044, 1545], ['Ra Fo', 10, 78045, 1551]] },
  { key: 'ine',      label: 'Intelligence',             weight: 1,    tiers: [['Ine', 1, 78037, 1522], ['Pa Ine', 3, 78038, 1547], ['Ra Ine', 10, 78039, 1553]] },
  { key: 'cha',      label: 'Chance',                   weight: 1,    tiers: [['Cha', 1, 78040, 1525], ['Pa Cha', 3, 78041, 1550], ['Ra Cha', 10, 78042, 1556]] },
  { key: 'age',      label: 'Agilité',                  weight: 1,    tiers: [['Age', 1, 78046, 1524], ['Pa Age', 3, 78047, 1549], ['Ra Age', 10, 78048, 1555]] },
  { key: 'ini',      label: 'Initiative',               weight: 0.1,  tiers: [['Ini', 10, 78025, 7448], ['Pa Ini', 30, 78026, 7449], ['Ra Ini', 100, 78027, 7450]] },
  { key: 'pod',      label: 'Pods',                     weight: 0.25, tiers: [['Pod', 10, 78020, 7443], ['Pa Pod', 30, 78021, 7444], ['Ra Pod', 100, 78022, 7445]] },
  { key: 'sa',       label: 'Sagesse',                  weight: 3,    tiers: [['Sa', 1, 78049, 1521], ['Pa Sa', 3, 78050, 1546], ['Ra Sa', 10, 78051, 1552]] },
  { key: 'prospe',   label: 'Prospection',              weight: 3,    tiers: [['Prospe', 1, 78036, 7451], ['Pa Prospe', 3, 78271, 10662]] },
  { key: 'pui',      label: 'Puissance',                weight: 2,    tiers: [['Pui', 1, 78016, 7436], ['Pa Pui', 3, 78269, 10618], ['Ra Pui', 10, 78270, 10619]] },
  { key: 'tacle',    label: 'Tacle',                    weight: 4,    tiers: [['Tac', 1, 78077, 11639], ['Pa Tac', 3, 78078, 11640]] },
  { key: 'fuite',    label: 'Fuite',                    weight: 4,    tiers: [['Fui', 1, 78076, 11637], ['Pa Fui', 3, 78075, 11638]] },
  { key: 'cri',      label: 'Coups critiques (%)',      weight: 10,   tiers: [['Cri', 1, 78014, 7433]] },
  { key: 'so',       label: 'Soins',                    weight: 10,   tiers: [['So', 1, 78013, 7434], ['Pa So', 3, 78099, 19337]] },
  { key: 'do_neutre',label: 'Dommages neutre (fixe)',   weight: 5,    tiers: [['Do Neutre', 1, 78069, 11665], ['Pa Do Neutre', 3, 78070, 11666]] },
  { key: 'do_terre', label: 'Dommages terre (fixe)',    weight: 5,    tiers: [['Do Terre', 1, 78065, 11657], ['Pa Do Terre', 3, 78066, 11658]] },
  { key: 'do_feu',   label: 'Dommages feu (fixe)',      weight: 5,    tiers: [['Do Feu', 1, 78063, 11659], ['Pa Do Feu', 3, 78064, 11660]] },
  { key: 'do_eau',   label: 'Dommages eau (fixe)',      weight: 5,    tiers: [['Do Eau', 1, 78061, 11661], ['Pa Do Eau', 3, 78062, 11662]] },
  { key: 'do_air',   label: 'Dommages air (fixe)',      weight: 5,    tiers: [['Do Air', 1, 78067, 11663], ['Pa Do Air', 3, 78068, 11664]] },
  { key: 'do_pou',   label: 'Dommages poussée',         weight: 5,    tiers: [['Do Pou', 1, 78081, 11649], ['Pa Do Pou', 3, 78082, 11650], ['Ra Do Pou', 10, 78273, 29684]] },
  { key: 'do_cri',   label: 'Dommages critiques',       weight: 5,    tiers: [['Do Cri', 1, 78073, 11653], ['Pa Do Cri', 3, 78074, 11654]] },
  { key: 'do_ren',   label: 'Renvoi de dommages',       weight: 5,    tiers: [['Do Ren', 1, 78017, 7437], ['Pa Do Ren', 3, 78017, 30942]] },
  { key: 'do_pi',    label: 'Dommages pièges',          weight: 5,    tiers: [['Do Pi', 1, 78268, 7446], ['Pa Do Pi', 3, 78023, 10613]] },
  { key: 'pui_pi',   label: 'Puissance pièges',         weight: 2,    tiers: [['Per Pi', 1, 78024, 7447], ['Pa Per Pi', 3, 78266, 10615], ['Ra Per Pi', 10, 78267, 10616]] },
  { key: 'chasse',   label: 'Arme de chasse',           weight: 5,    tiers: [['Chasse', 1, 78059, 10057]], weaponOnly: true },
  { key: 'do',       label: 'Dommages (fixe, tous éléments)', weight: 20, tiers: [['Do', 1, 78015, 7435]] },
  { key: 'do_per_ar',label: 'Dommages armes (%)',       weight: 15,   tiers: [['Do Per Ar', 1, 78093, 18721]] },
  { key: 'do_per_di',label: 'Dommages distance (%)',    weight: 15,   tiers: [['Do Per Di', 1, 78091, 18720]] },
  { key: 'do_per_me',label: 'Dommages mêlée (%)',       weight: 15,   tiers: [['Do Per Mé', 1, 78092, 18719]] },
  { key: 'do_per_so',label: 'Dommages sorts (%)',       weight: 15,   tiers: [['Do Per So', 1, 78094, 18722]] },
  { key: 're_neutre',label: 'Résistance neutre (fixe)', weight: 2,    tiers: [['Ré Neutre', 1, 78057, 7456], ['Pa Ré Neutre', 3, 78103, 19341], ['Ra Ré Neutre', 10, 78293, 30696]] },
  { key: 're_terre', label: 'Résistance terre (fixe)',  weight: 2,    tiers: [['Ré Terre', 1, 78034, 7455], ['Pa Ré Terre', 3, 78104, 19342], ['Ra Ré Terre', 10, 78294, 30695]] },
  { key: 're_feu',   label: 'Résistance feu (fixe)',    weight: 2,    tiers: [['Ré Feu', 1, 78028, 7452], ['Pa Ré Feu', 3, 78102, 19340], ['Ra Ré Feu', 10, 78295, 30697]] },
  { key: 're_eau',   label: 'Résistance eau (fixe)',    weight: 2,    tiers: [['Ré Eau', 1, 78030, 7454], ['Pa Ré Eau', 3, 78101, 19339], ['Ra Ré Eau', 10, 78296, 30698]] },
  { key: 're_air',   label: 'Résistance air (fixe)',    weight: 2,    tiers: [['Ré Air', 1, 78032, 7453], ['Pa Ré Air', 3, 78100, 19338], ['Ra Ré Air', 10, 78297, 30700]] },
  { key: 're_cri',   label: 'Résistance critiques (fixe)', weight: 2, tiers: [['Ré Cri', 1, 78071, 11655], ['Pa Ré Cri', 3, 78072, 11656], ['Ra Ré Cri', 10, 78292, 30699]] },
  { key: 're_pou',   label: 'Résistance poussée (fixe)',   weight: 2, tiers: [['Ré Pou', 1, 78079, 11651], ['Pa Ré Pou', 3, 78080, 11652], ['Ra Ré Pou', 10, 78272, 29683]] },
  { key: 're_per_neutre', label: 'Résistance neutre (%)', weight: 6, tiers: [['Ré Per Neutre', 1, 78058, 7460]] },
  { key: 're_per_terre',  label: 'Résistance terre (%)',  weight: 6, tiers: [['Ré Per Terre', 1, 78035, 7459]] },
  { key: 're_per_feu',    label: 'Résistance feu (%)',    weight: 6, tiers: [['Ré Per Feu', 1, 78029, 7457]] },
  { key: 're_per_eau',    label: 'Résistance eau (%)',    weight: 6, tiers: [['Ré Per Eau', 1, 78031, 7560]] },
  { key: 're_per_air',    label: 'Résistance air (%)',    weight: 6, tiers: [['Ré Per Air', 1, 78033, 7458]] },
  { key: 're_per_di',     label: 'Résistance distance (%)', weight: 10, tiers: [['Ré Per Di', 1, 78096, 18724]] },
  { key: 're_per_me',     label: 'Résistance mêlée (%)',  weight: 10, tiers: [['Ré Per Mé', 1, 78095, 18723]] },
  { key: 'ret_pa',   label: 'Retrait PA',                weight: 7,    tiers: [['Ret Pa', 1, 78087, 11645], ['Pa Ret Pa', 3, 78088, 11646]] },
  { key: 'ret_pme',  label: 'Retrait PM',                weight: 7,    tiers: [['Ret Pme', 1, 78089, 11647], ['Pa Ret Pme', 3, 78090, 11648]] },
  { key: 're_pa',    label: 'Résistance retrait PA',     weight: 7,    tiers: [['Ré Pa', 1, 78083, 11641], ['Pa Ré Pa', 3, 78084, 11642]] },
  { key: 're_pme',   label: 'Résistance retrait PM',     weight: 7,    tiers: [['Ré Pme', 1, 78085, 11643], ['Pa Ré Pme', 3, 78086, 11644]] },
  { key: 'invo',     label: 'Invocations',               weight: 30,   tiers: [['Invo', 1, 78019, 7442]] },
  { key: 'po',       label: 'Portée',                    weight: 51,   tiers: [['Po', 1, 78018, 7438]], heavyExo: true },
  { key: 'pm',       label: 'PM',                        weight: 90,   tiers: [['Ga Pme', 1, 78056, 1558]], heavyExo: true, forcesQuality: true },
  { key: 'pa',       label: 'PA',                        weight: 100,  tiers: [['Ga Pa', 1, 78055, 1557]], heavyExo: true, forcesQuality: true },
];

const STAT_BY_KEY = Object.fromEntries(STATS.map(s => [s.key, s]));

// Liste plate des runes : { id, stat, name, bonus, weight (poids total de la rune), tier }
const RUNES = STATS.flatMap(s => s.tiers.map(([name, bonus, iconId, itemId], tier) => ({
  id: `${s.key}:${tier}`, stat: s.key, name, bonus, weight: bonus * s.weight, tier, iconId, itemId,
  icon: iconId ? `https://api.dofusdb.fr/img/items/${iconId}.png` : null,
})));
const RUNE_BY_ID = Object.fromEntries(RUNES.map(r => [r.id, r]));

export { STATS, STAT_BY_KEY, RUNES, RUNE_BY_ID };
