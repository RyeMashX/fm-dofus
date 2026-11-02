# FM Dofus

Outil d'aide à la forgemagie : probabilités de chaque rune, mécanisme de pertes et **prochain meilleur coup** pour atteindre un jet cible.

Page : `index.html` (modules ES, aucun build nécessaire). Hébergée sur GitHub Pages.

## Utilisation

1. Chercher l'objet par son nom (données DofusDB) ou le créer à la main.
2. Saisir le jet actuel de chaque ligne, le reliquat affiché par le jeu, et la **cible** (valeur minimale) sur les lignes qui comptent. Ajouter les exos voulus.
3. « Calculer » : l'outil simule chaque rune candidate et propose celle qui minimise le nombre de poses restantes attendu.
4. Poser la rune dans le jeu, puis cliquer SC / SN / EC. En SN et EC, saisir le nouveau reliquat et décrémenter les lignes tombées ; l'outil vérifie que le poids perdu est cohérent.

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

## Développement

```
npm test        # suite de non-régression
npm run serve   # http://localhost:8080
npm run build   # dist/fm-dofus.html, page mono-fichier
```
