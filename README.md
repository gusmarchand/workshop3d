# Workshop 3D

Modeleur 3D pour la menuiserie et l'aménagement, façon SketchUp, avec ce qu'il faut pour passer du dessin à l'atelier : fiche de débit, plan de découpe optimisé, coût, quincaillerie, notice de montage. Application Mac (Tauri 2 : Rust, TypeScript, Three.js), environ 5 Mo.

Projet personnel, publié tel quel. Il est pensé pour être **modifié avec Claude** : l'app expose un serveur MCP et embarque un assistant, et le dépôt contient un [CLAUDE.md](CLAUDE.md) qui explique comment travailler dessus.

## Ce que ça fait

- **Dessiner** : pièces en panneaux, dessin libre (mode expert : lignes, rectangles, pousser/tirer), déplacer, tourner, mettre à l'échelle ou étirer, mètre et guides, composants.
- **Meubles paramétriques** : caissons, dressings, bibliothèques (colonnes, étagères, penderie, tiroirs, portes, plinthe), modifiables après coup.
- **Portes et tiroirs** : charnières, coulisses et poignées placées avec leurs cotes de perçage ; on les ouvre à la souris, y compris pour vérifier qu'une porte passe sous un plafond en pente.
- **Fabriquer** : fiche de débit (chants par côté, fil du bois), plan de découpe optimisé sur ton stock et tes panneaux à acheter, coût, fiche de perçage, liste de courses, notice de montage, contrôles (pièces qui se traversent, portée des tablettes).
- **Matériaux** : panneau acheté, couleur et décor (bois, lamellé-collé, contreplaqué, MDF, tissu) ; l'aspect est visuel, la fiche et la découpe n'en dépendent pas.
- **Échanger** : fichiers `.workshop` (JSON ; les anciens `.atelier` s'ouvrent encore), Collada `.dae` vers et depuis SketchUp ou Sweet Home 3D.
- **Se faire aider par Claude** : voir plus bas.

Prise en main : [TUTORIEL.md](TUTORIEL.md), aussi dans l'app (bouton Guide ou touche `?`). L'app démarre en mode simple.

## Installer et lancer

Pas encore de version téléchargeable : on compile soi-même (quelques minutes la première fois).

Prérequis : macOS, [Node 22](https://nodejs.org) (`.nvmrc`), et Rust (`brew install rustup`, puis `rustup default stable`).

```bash
git clone https://github.com/gusmarchand/workshop3d.git && cd workshop3d
nvm use                # Node 22
npm install
npm run pack           # construit « Workshop 3D.app »
open "src-tauri/target/release/bundle/macos/Workshop 3D.app"
```

L'app n'est pas signée : au premier lancement, clic droit sur l'app puis Ouvrir si macOS refuse.

Pour développer :

```bash
npm run dev            # dans le navigateur : http://127.0.0.1:5173 (pas de Rust, pas de MCP)
npm run app            # app native avec rechargement à chaud
npm test               # tests du noyau (vitest)
npm run build          # vérification des types + build web
```

Les scripts `app` et `pack` ajoutent `/opt/homebrew/opt/rustup/bin` au `PATH` (Homebrew sur Apple Silicon) ; si Rust est ailleurs chez toi, ajuste `package.json`.

## Se faire aider par Claude

Deux façons, avec **les mêmes outils** (lire le projet, créer et modifier des meubles, des pièces, des matériaux, le stock, lancer les contrôles, prendre une capture de la vue…). Chaque modification est annulable avec Cmd+Z.

**1. Assistant dans l'app** : bouton « ✦ Assistant » en bas à droite. Il faut une clé API Anthropic (console.anthropic.com, facturée à l'usage), saisie une fois via le bouton « Clé ». Elle est gardée sur ta machine dans un fichier de droits 600, jamais dans un projet.

**2. Claude Code, via MCP** : l'app ouverte écoute sur `127.0.0.1:41733/mcp`, avec un jeton créé au premier lancement.

```bash
claude mcp add --transport http --scope user workshop3d http://127.0.0.1:41733/mcp \
  --header "Authorization: Bearer $(cat "$HOME/Library/Application Support/io.github.gusmarchand.workshop3d/mcp-token")"
```

Le serveur n'écoute qu'en local, exige le jeton et vérifie les en-têtes `Host` et `Origin`. Dans le navigateur (`npm run dev`) il n'existe pas ; `window.workshop.mcp(method, params)` appelle les mêmes outils depuis la console.

## Faire évoluer le projet

Le dépôt est fait pour être modifié avec Claude Code, comme il a été écrit :

1. Lance l'app (`npm run app`) et branche Claude Code en MCP (ci-dessus) : il voit ton projet et peut concevoir un meuble réel pendant que tu regardes.
2. Quand un manque apparaît (une option de meuble, un outil, un réglage), demande-le dans la même conversation ; Claude lit [CLAUDE.md](CLAUDE.md) et [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
3. Le noyau est testé (`npm test`) ; l'interface se vérifie dans le navigateur (`npm run dev`) puis dans l'app reconstruite.

## Organisation du code

```
src/kernel/    noyau sans DOM : modèle, géométrie, débit, découpe, contrôles (testé)
src/main.ts    scène Three.js, outils à la souris, barre du haut, panneau de droite
src/mcp.ts     outils MCP (partagés avec l'assistant intégré)
src/ui/        fenêtres annexes, décors, assistant
src-tauri/     coque Rust : fenêtre, menu, fichiers, serveur MCP
docs/          architecture détaillée
```

Détail, modèle de document, pièges : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Pistes

Ce qui reste à améliorer, dans l'ordre où je le ferais :

- **Découper `main.ts`** (environ 2700 lignes, état global) en modules d'outils.
- **Clé API dans le Trousseau macOS** plutôt que dans un fichier de droits 600.
- **Meubles paramétriques** : le générateur sait maintenant les traverses hautes, la plinthe unique avec côtés entaillés, les hauteurs de tiroir libres et des matières propres aux façades et aux caissons de tiroir. Restent à faire : des tiroirs de hauteurs différentes selon la colonne, des angles, des meubles hauts.
- **Découpe** : essayer chaque format de panneau disponible et garder le moins cher ; autoriser des matières équivalentes.
- **Tests** : l'interface et `main.ts` ne sont vérifiés qu'à la main.
- **Version téléchargeable** : publier un `.app` signé depuis la CI.

## Limites connues

Pas d'arcs, d'assemblages de plusieurs composants ni de décalage ; les lignes restent dans leur plan ; pas d'import ou d'export `.skp` (format propriétaire) ; Mac uniquement pour l'instant (la coque Tauri est portable, mais les chemins et les menus ne sont testés que sur macOS).

## Licence

[MIT](LICENSE) : tu peux l'utiliser, le copier, le modifier et le redistribuer librement.
