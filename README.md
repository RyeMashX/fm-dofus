# FM Dofus

Outil d'aide à la forgemagie : probabilités de chaque rune, mécanisme de pertes et **prochain meilleur coup** pour atteindre un jet cible.

Page : `index.html` (modules ES, aucun build nécessaire). Hébergée sur GitHub Pages.

## Utilisation

1. Chercher l'objet par son nom dans la barre du haut (données DofusDB) ou le créer à la main. L'objet (icône, nom, type, niveau) et les onglets restent affichés quel que soit l'onglet ; changer d'objet en cours de session demande confirmation si la cible n'est pas atteinte ou la session pas archivée.
2. Saisir le jet actuel de chaque ligne, le reliquat affiché par le jeu, et la **cible** (valeur minimale) sur les lignes qui comptent. Ajouter les exos voulus.
3. « Calculer » : l'outil simule, pour chaque rune candidate, des sessions complètes (cette rune puis sa politique jusqu'à la cible) et propose celle qui minimise le nombre moyen de poses restantes, celle-ci comprise. C'est le même estimateur que l'estimation de la vue Objet.
4. Poser la rune dans le jeu, puis cliquer SC / SN / EC. En SN et EC, saisir le nouveau reliquat et décrémenter les lignes tombées ; l'outil vérifie que le poids perdu est cohérent.
5. Vue Objet : sous l'en-tête, une **estimation** du chemin restant (300 sessions simulées avec la politique gloutonne) : poses attendues (moyenne, médiane, 9 fois sur 10 sous X) et coût en kamas d'après les prix des runes.
6. Onglet **Bilan** (surligné quand la cible est atteinte) : runes posées et attendues au départ, coût total (prix des runes à renseigner dans ⚙, en kamas, exportables en JSON), répartition SC/SN/EC, poids détruit, durée, et un **indice de chance** : écart en écarts-types entre les résultats obtenus (SC +1, SN 0, EC −1) et leur espérance selon le modèle à chaque pose. « Archiver la session » (automatique en changeant d'objet ou en recommençant) conserve un historique des sessions, exportable en JSON.

## Modèle

Reconstruit à partir du simulateur [DoFocus](https://dofocus.fr/forgemagie) (lectures et lecture du code, 2 nov. 2026). Ni Ankama ni DoFocus n'ont publié de formule officielle : c'est une estimation.

- `src/stats.js` : catalogue des stats, poids par point, runes.
- `src/engine.js` : probabilités (`odds`) et pertes (`applyLoss`, `applyMove`).
- `src/search.js` : recherche du meilleur coup (Monte-Carlo + heuristique de poses restantes).
- `src/dofusdb.js` : recherche d'objets et correspondance des effets DofusDB.
- `src/ui.js` : interface.
- `test/readings.test.js` : lectures du simulateur servant de non-régression.
- `dofocus-engine-extrait.js` : extrait du moteur DoFocus ayant servi de référence.

### Probabilités (ligne du template)

```
Q      = poids présent / poids max de l'objet, hors ligne cible (over ignoré, exo = 0) ; Q = 1 si exo PA/PM
ratio  = jet / bonus de la rune
pos    = (jet + bonus − min) / (max − min)
D      = 5 + 60·Q^12 + 12·max(0, ratio − 14)
       + 45 si pas over, min ≠ max et pos ≥ 0,8
       + 65 + 4·poids_over si over
       − 20·max(0, 1,1 − Q) si niveau < 170
x      = (100 − D)/2 ; SC = max(2, x)
SN     = min(50, max(5, 40 + 0,75x)) si over ; sinon 50 si x ≥ 0, sinon max(15, 50 − 0,75|x|)
```

Plafonds : (jet + bonus) × poids ≤ max(101, max de la ligne × poids) par ligne ; charge over + exo de l'objet ≤ 101.

### Exo (ligne absente du template)

Ne dépend que du poids final de la ligne `w` : S = 57 (w ≤ 2), 57 − (w − 2)·38/13 (w ≤ 15), 19 − (w − 15)·1,9 (w < 25), 0 ensuite ; SC = max(1, 0,077·S), SN = 0,923·S. PA, PM, PO : 1 / 0 / 99.

### Pertes (SN et EC)

Poids à perdre = poids de la rune (÷2 si la ligne reste négative). Dans l'ordre : lignes en over et exos (hors cible), chacune touchée avec probabilité min(1, 0,75·(P/poids)^0,85) ; puis le reliquat ; puis la ligne cible si elle est en over (EC seulement, ×1/3) ; puis tirage pondéré de lignes normales (poids min(1, poids_rune/poids_ligne), cible ×1/60 en EC) jusqu'à épuisement ; l'excédent devient reliquat.

### Points contestés par l'expérience en jeu (à mesurer)

- **Ordre de l'exo lourd (PA, PM, PO, invocation)** : réglé. Pratique en jeu, confirmée : objet monté au jet voulu, tentative de Ga Pa (SC 1 %, pas de SN), en EC jusqu'à 100 de poids tombent, on remonte, on retente ; en moyenne une centaine de cycles. L'ordre inverse ne marche pas (un exo déjà posé retombe vite). La chute d'un exo déjà posé garde la règle DoFocus, 0,75 × (poids de la rune / poids de l'exo)^0,85 par pose ratée : les petits exos sautent vite face à des runes de poids voisin, PA/PM beaucoup moins ; sans mesure en jeu, on ne pose de toute façon rien après un exo PA. Le solveur vise d'abord la cible sans l'exo, puis propose l'exo ; le coût de la phase exo (cycles géométriques × remontée simulée après un EC) est estimé à part et ajouté aux scores et à l'estimation de la vue Objet.
- **Lignes en over** : réglé d'après l'expérience en jeu. Une ligne du template au-dessus de son max encaisse toujours la prochaine perte (DoFocus lui donnait une probabilité dépendant des poids), et, pour les caracs à moins de 1 de poids par point (vitalité, initiative, pods), elle perd parfois quelques points de plus que le poids de la rune, jusqu'à 20 % (poids 1 → 5 ou 6 vita, poids 2 → 10 à 12), le dépassement allant au reliquat ; elle passe sous son max si besoin. Valable pour toutes les lignes en over, pas seulement la vitalité. La politique du solveur fait donc ce que font les joueurs : dès qu'une ligne est en over et qu'il reste des cibles, poser une rune dont la perte retirera l'over, en la choisissant utile : d'abord une rune d'une ligne cible à monter dont le poids tient dans la marge d'over (Pa Fo à 45/50 pour une vita à 415 : d'une pierre deux coups), sinon une rune d'une ligne hors cible sans risque d'over en SC (Cha à 69/70), sinon l'exo le plus léger et le moins cher (cha, ini…). La marge d'over est ce qu'on peut perdre sans passer sous la cible de la ligne ; si même une rune de poids 1 la dépasse (cible au max), on ne nettoie pas. C'est ce qui rend Ra Vi (351 → 401 puis nettoyage) meilleure que Pa Vi.
- **Pa Pui à ratio 20** : voir la calibration ci-dessous.

### Calibration sur les poses réelles

Le journal (vue FM → « Exporter le journal ») enregistre chaque pose réelle (format v2) : horodatage, version de l'outil, session, objet, modèle actif et ses paramètres, cible, état avant (lignes, reliquat), rune, chances annoncées avec les facteurs du modèle (régime, difficulté, qualité, position, ratio, over, demi-poids), résultat, variations, état après, écart de cohérence, provenance (saisie manuelle, lecture d'écran automatique ou vérifiée, avec l'entrée OCR brute). L'export contient aussi les sessions archivées et les prix. Le compteur « n non exportées » dans la vue FM rappelle d'exporter : le journal ne vit que dans le navigateur. `node scripts/fit-journal.mjs journal.json` compare les résultats aux chances sous différents paramètres. Calibration du 2026-11-02 (156 poses, Ceinture de la Reine des Voleurs et Bottes du Strigide) : le palier des 80 % pèse +25 (DoFocus : +45) et la pénalité de ratio jet/bonus au-delà de 14 vaut 24 par point (DoFocus : 12). Avec ces valeurs, SC/SN/EC observés et attendus coïncident par tranche de difficulté ; avec les valeurs DoFocus, Pa Pui à 60/75 était annoncée à 58 % de passage pour 24 % observés (21 poses). Réserve : l'écart est porté presque entièrement par Pa Pui (5 passages sur 21 pour 12 attendus, p ≈ 0,2 %) ; les autres runes à ratio > 14 (17 poses) collent à DoFocus et la pente doublée les dégrade. DoFocus reste donc le modèle par défaut ; « Calibré » est proposé dans ⚙ comme hypothèse, à confirmer avec d'autres poses à ratio élevé hors palier (Pa Cha à 60/70, par exemple). Les tests unitaires vérifient les valeurs DoFocus.

## Formules

Notations : $j$ jet actuel de la ligne posée, $b$ bonus de la rune, $w$ poids d'un point de la ligne, $W = b\,w$ poids de la rune, $[m, M]$ fourchette, $t$ cible, $R$ reliquat, $[\cdot]$ indicatrice.

**Qualité** (ligne posée exclue, over ignoré, template seulement ; $Q = 1$ avec un exo PA/PM) :
$$Q = \frac{\sum_{\ell \ne \text{posée}} w_\ell \min(j_\ell, M_\ell)}{\sum_{\ell \ne \text{posée}} w_\ell M_\ell}$$

**Position, over, ratio** : $p = \frac{j + b - m}{M - m}$, $\text{over} = [j + b > M]$, $r = j / b$.

**Difficulté** :
$$D = 5 + 60\,Q^{12} + 12\max(0, r - 14) + 45\,[p \ge 0{,}8 \wedge \neg\text{over} \wedge m \ne M] + \big(65 + 4\,(j + b - M)\,w\big)[\text{over}] - 20\max(0, 1{,}1 - Q)[\text{niveau} < 170]$$

**Résultats** : $SC = \max(2, (100 - D)/2)$ ; $SN = \min(50, 100 - SC)$ si $D \le 100$ hors over, $\max(15, 50 - 0{,}375(D - 100))$ si $D > 100$ hors over, $\max(5, 40 - 0{,}375(D - 100))$ en over, borné par $100 - SC$ ; $EC = 100 - SC - SN$.

**Exo** (poids final $f = (j + b) w$) : $S = 57$ si $f \le 2$ ; $57 - (f - 2)\,38/13$ si $f \le 15$ ; $19 - 1{,}9\,(f - 15)$ si $f < 25$ ; 0 au-delà. $SC = \max(1, 0{,}077 S)$, $SN = 0{,}923 S$. PA, PM, Po : 1 / 0 / 99.

**Plafonds** : $j + b \le \max(M, \lfloor 101/w \rfloor)$ ; charge over + exo $\le 101$ ; $W/2$ si la ligne reste négative.

**Pertes** (SN et EC), $f_0 = W$ : (1) lignes over et exo hors ligne posée, ordre aléatoire, probabilité 1 pour un over du template et $\min(1, 0{,}75 (f/w)^{0{,}85})$ pour un exo, points retirés $n = \min(\text{dispo}, \max(1, \lceil f/w \rceil)) + \epsilon$ avec $\epsilon \sim \mathcal{U}\{0..\lfloor 0{,}2 n \rfloor\}$ si $w < 1$ ; (2) reliquat ; (3) ligne posée en over, en EC, probabilité ÷ 3 ; (4) lignes normales, tirage pondéré $\pi_\ell = \min(1, f/w_\ell)^k$ ($k = 1$), ligne posée × 1/60, $n \sim \mathcal{U}\{1..\lceil f/w_\ell \rceil\}$, jusqu'à $f \le 0$ ; (5) dépassement rendu au reliquat.

**Tables par ligne** : $p_\rho = (SC + SN)/100$, $c_\rho = (1 - SC/100) \max(0, W_\rho - R)\,\text{part}/\text{ppp}$, et
$$E(v) = \min_\rho \frac{1 + c_\rho + p_\rho\,E(\min(v + b_\rho, t))}{p_\rho}, \qquad E(v \ge t) = 0$$

**Politique** : nettoyage si over, exo lourd si tout le reste est au jet, sinon $\arg\min_\rho \big[1 + c_\rho + p_\rho E(v + b_\rho) + (1 - p_\rho) E(v)\big]$.

**Recherche avancée** (réglage « Recherche : avancée » de la vue FM) : les deux premières poses sont comparées par simulation (6 premières runes × jusqu'à 8 secondes), la suite par la politique ; le conseil indique « puis … ». Plus long, utile quand un coup n'a de sens qu'avec sa suite.

**Score d'une candidate** : $N$ sessions à graines communes, première pose = la candidate avec résultat stratifié (SC / SN / EC en proportion exacte), puis la politique jusqu'à la cible ; score = moyenne des poses, première comprise.

**Exo lourd** : $C \sim$ géométrique$(p)$, $\mathbb{E}[C] = 1/p$, quantile $C_x = \lceil \ln(1 - x)/\ln(1 - p) \rceil$, $\bar R$ remontée simulée après EC, total $= C + (C - 1)\bar R$.

## Développement

```
npm test        # suite de non-régression
npm run serve   # http://localhost:8080
npm run build   # dist/fm-dofus.html, page mono-fichier
```

## Lecture d'écran (OCR)

En vue FM, « Capturer le jeu » demande au navigateur de partager la fenêtre de Dofus (Chrome ou Edge ; sur Mac, autoriser l'enregistrement d'écran pour le navigateur dans les réglages système). Ensuite :

- « Lire le tableau » lit Min / Max / valeur de chaque ligne du Cordomager et le reliquat, et propose de les appliquer (pour initialiser les jets ; relire après avoir fait défiler si l'objet a plus de lignes que l'écran).
- « Lire la dernière pose » lit la dernière entrée de l'historique (colonne de gauche) et le reliquat, en déduit la rune, le résultat (SC, SN, EC) et les lignes tombées, et ouvre le panneau de vérification pré-rempli.

L'OCR (tesseract.js) tourne dans le navigateur, rien n'est envoyé ailleurs ; le modèle français (~10 Mo) est téléchargé une fois puis mis en cache. Le lecteur est testé sur les captures de `ocr-samples/` : `node scripts/ocr-test.mjs`.
