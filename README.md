# FM Dofus

Outil d'aide à la forgemagie : probabilités de chaque rune, mécanisme de pertes et **prochain meilleur coup** pour atteindre un jet cible.

Page : `index.html` (modules ES, aucun build nécessaire). Hébergée sur GitHub Pages.

## Utilisation

1. Chercher l'objet par son nom (données DofusDB) ou le créer à la main.
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

- **Ordre de l'exo lourd (PA, PM, PO, invocation).** Le moteur impose l'exo lourd en premier, sur l'objet le plus vide possible, parce que DoFocus fait détruire jusqu'à 100 de poids par échec de Ga Pa. En jeu, la pratique est l'inverse : objet fini, puis tentatives de Ga Pa, puis remontée de ce qui est tombé ; l'ordre « exo d'abord » ne marche pas (qualité à 1, l'exo saute pendant la remontée). Cela implique que la perte réelle sur un EC de Ga Pa est bien plus faible que le poids de la rune. À mesurer dans le journal (lignes tombées par EC de Ga Pa, SN éventuels, chute de l'exo pendant la remontée) avant de changer : perte plafonnée sur les échecs d'exo lourd, règle « exo en dernier », pénalité des runes lourdes pendant la remontée.
- **Pa Pui à ratio 20** : voir la calibration ci-dessous.

### Calibration sur les poses réelles

Le journal (vue FM → « Exporter le journal ») enregistre chaque pose réelle (format v2) : horodatage, version de l'outil, session, objet, modèle actif et ses paramètres, cible, état avant (lignes, reliquat), rune, chances annoncées avec les facteurs du modèle (régime, difficulté, qualité, position, ratio, over, demi-poids), résultat, variations, état après, écart de cohérence, provenance (saisie manuelle, lecture d'écran automatique ou vérifiée, avec l'entrée OCR brute). L'export contient aussi les sessions archivées et les prix. Le compteur « n non exportées » dans la vue FM rappelle d'exporter : le journal ne vit que dans le navigateur. `node scripts/fit-journal.mjs journal.json` compare les résultats aux chances sous différents paramètres. Calibration du 2026-11-02 (156 poses, Ceinture de la Reine des Voleurs et Bottes du Strigide) : le palier des 80 % pèse +25 (DoFocus : +45) et la pénalité de ratio jet/bonus au-delà de 14 vaut 24 par point (DoFocus : 12). Avec ces valeurs, SC/SN/EC observés et attendus coïncident par tranche de difficulté ; avec les valeurs DoFocus, Pa Pui à 60/75 était annoncée à 58 % de passage pour 24 % observés (21 poses). Réserve : l'écart est porté presque entièrement par Pa Pui (5 passages sur 21 pour 12 attendus, p ≈ 0,2 %) ; les autres runes à ratio > 14 (17 poses) collent à DoFocus et la pente doublée les dégrade. DoFocus reste donc le modèle par défaut ; « Calibré » est proposé dans ⚙ comme hypothèse, à confirmer avec d'autres poses à ratio élevé hors palier (Pa Cha à 60/70, par exemple). Les tests unitaires vérifient les valeurs DoFocus.

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
