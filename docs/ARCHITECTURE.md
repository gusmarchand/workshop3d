# Architecture de Workshop 3D

Notes techniques pour qui veut modifier le code. Pour l'usage, voir [TUTORIEL.md](../TUTORIEL.md) ; pour les règles de travail (commandes, pièges), [CLAUDE.md](../CLAUDE.md).

## Vue d'ensemble

```
┌────────────────────────── app Mac (Tauri 2) ──────────────────────────┐
│  Rust (src-tauri/src)                 Webview (TypeScript, Three.js)   │
│  ├─ main.rs   fenêtre, menu, fichiers ├─ src/main.ts   scène, outils,  │
│  └─ mcp.rs    serveur MCP local  ───► │                panneau, état   │
│        127.0.0.1:41733/mcp            ├─ src/mcp.ts    outils MCP      │
│                                       ├─ src/ui/       fenêtres annexes│
│                                       └─ src/kernel/   noyau, sans DOM │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Le noyau** (`src/kernel/`) ne touche ni au DOM ni à Three.js : géométrie, modèle de document, débit, découpe, contrôles. C'est ce qui est testé (`*.test.ts`, vitest).
- **L'interface** (`src/main.ts`, `src/ui/`) fait le rendu et les outils à la souris. `main.ts` (environ 2700 lignes) concentre la scène, les outils et l'état global ; `src/ui/` en a été extrait petit à petit.
- **La coque Rust** ne connaît pas le métier : fenêtre, menu natif, lecture et écriture des fichiers, transport du serveur MCP, garde de la clé API.
- **Unités** : le noyau travaille en **mètres**, les outils MCP et l'interface en **millimètres**. La conversion se fait aux frontières (`mm()` dans `src/mcp.ts`, `unit()` dans `main.ts`). C'est une source classique d'erreurs : une cote en mm passée à une fonction du noyau est 1000 fois trop grande.
- **Repère** : X largeur, Y profondeur (façade vers -Y), Z hauteur.

## Modèle de document (`src/kernel/model.ts`)

`Doc` est un objet JSON simple, cloné (`cloneDoc`) à chaque modification pour que l'historique d'annulation soit une liste de copies.

| Champ | Contenu |
|---|---|
| `solids` | pièces : `mesh` (sommets `v`, triangles `t`, en m), `name`, `meta` (matière, fil, chants, matériau `methode`, `caisson`, `masque`…) |
| `sketches` | dessins 2D par plan (outils de dessin du mode expert) |
| `methods` | **matériaux** (`Materiau`) : panneau acheté `matiere`, couleur, chants, côtés plaqués, `decor`. Le nom de champ `methods` et `meta.methode` sont gardés pour la compatibilité des fichiers |
| `stock` | panneaux : matière, épaisseur, format, quantité en atelier, prix d'achat |
| `extras` | quincaillerie et lignes manuelles ; celles avec `auto` sont recalculées |
| `caissons` | paramètres des meubles générés, pour pouvoir les modifier |
| `elements` | portes et tiroirs identifiés (voir plus bas) |
| `reglages` | trait de scie, marge de bord des panneaux |
| `plafond`, `guides` | plafond en pente de référence, lignes de construction |

Un fichier `.workshop` est ce document plus la fiche de débit manuelle, en JSON. **`src/kernel/file.ts` valide chaque champ à la lecture** : tout nouveau champ du document doit y être ajouté, sinon il est perdu à l'ouverture (c'est déjà arrivé).

Les pièces d'un meuble généré portent `meta.caisson`. « Modifier le meuble » **recrée** ses pièces à partir des paramètres : les retouches faites à la main sur ces pièces sont perdues.

## Fiche de débit, découpe, coût

- `debit.ts` : dimensions de coupe de chaque pièce (L × l × e), regroupement des pièces identiques, chants par côté, totaux, CSV. Deux couleurs d'un même panneau (MDF peint en deux teintes) sont séparées dans la fiche mais se découpent dans le même stock.
- `nesting.ts` : l'optimiseur place les pièces d'une même matière et épaisseur sur les panneaux, en coupes de bord à bord (scie à format ou scie plongeante). Il essaie plusieurs stratégies et garde la meilleure (tout placer, puis coût, puis nombre de panneaux, puis chute) :
  1. **Pose en bandes** (`enBandes`) : refendre le panneau en bandes de la largeur la plus fréquente (la profondeur d'un meuble, en général), les ranger exactement (recherche bornée) et les tronçonner. Plusieurs largeurs candidates sont essayées. Uniquement sur des panneaux achetés.
  2. **Stock d'abord, puis bandes** (`stockPuisBandes`) : les chutes en atelier sont remplies en premier, le reste est découpé en bandes sur des panneaux achetés.
  3. **Pose libre** (`essai`) : plusieurs ordres de pose, le stock avant tout achat, le fil respecté.
  Une pièce plus grande que tous les panneaux est coupée en morceaux égaux (`fractionner`). « Découpe faite » retire du stock les panneaux utilisés et y ajoute les chutes d'au moins 100 × 200 mm.
- Réglages : `trait` (3 mm par défaut) et `marge` (10 mm rognés sur chaque bord d'un panneau). Mettre la marge à 0 quand les bords d'usine sont propres change parfois le nombre de panneaux.
- Le **coût** = panneaux à acheter + chant + quincaillerie ayant un prix.

## Meubles paramétriques (`cabinet.ts`)

`genererCaisson(params)` produit les panneaux d'un caisson ou dressing : colonnes (étagères, penderie, tiroirs, penderie + tiroirs), portes en applique, fond, plinthe, montants pleins pour un meuble plus long qu'un panneau. `caissonModifie` (dans `main.ts`, car il écrit dans le document et la scène) le régénère à sa place. `verifier` refuse les combinaisons impossibles (par exemple des tiroirs qui laissent moins de 100 mm au-dessus).

Options qui évitent les retouches à la main (toutes facultatives, valeurs par défaut = comportement d'origine) :

| Option | Effet |
|---|---|
| `dessus: 'traverses'`, `largeurTraverse` | deux traverses (avant, arrière) à la place du dessus plein, sous un plan de travail |
| `entailles`, `retraitPlinthe` | côtés et montants échancrés au pied (`PanneauCaisson.entaille`, maillage par `maillePanneau`), une seule plinthe en retrait sur toute la largeur |
| `hTiroirs: [310, 310, 160]` | hauteurs de façade de bas en haut ; soit 100 mm libres au-dessus, soit la somme = hauteur − plinthe (colonne remplie, sans tablette ni porte) |
| `epFondTiroir` | épaisseur du fond de tiroir (8 mm par défaut) |
| `facadesEgales` | colonnes calculées pour que portes et façades de tiroir aient toutes la même largeur (sans `largeurs`) |
| `fondParColonne` | un fond par colonne, coupé au milieu des montants : il se range mieux dans un panneau |

Côté `CaissonRec` : `fondTiroir`, `facade` (portes et façades de tiroir) et `caisseTiroir` (côtés, devants, arrières) donnent une matière propre à ces pièces. Un buffet de 1800 mm (tiroirs, deux placards) tient en **un seul** caisson de trois colonnes : montants partagés, plinthe unique, un seul appel `creer_meuble`. Le test `BUFFET` de `cabinet.test.ts` en est l'exemple. Ce qui sort de ces options (angles, tiroirs de hauteurs différentes selon la colonne) se fait avec l'outil MCP `ajouter`, et « Modifier le meuble » l'efface.

## Portes et tiroirs (`elements.ts`)

Un `Element` est une porte (une pièce) ou un tiroir (façade et pièces du caisson). Tout le reste est calculé depuis la géométrie : le repère vu de face (`repere`), la pose ouverte (`poseOuverte` : rotation sur l'axe des charnières, ou translation de la longueur de coulisse), et la quincaillerie placée (`ferrures`) avec ses formes 3D et ses cotes de perçage (cuvettes Ø35, coulisses de chaque côté, poignées). `reconnaitre` identifie les pièces nommées « Porte… » et « Façade tiroir… ». `synchroniserElements` est appelée à chaque modification : elle retire les éléments dont la pièce a disparu et régénère les lignes de quincaillerie `auto`. L'état ouvert ou fermé est un état d'affichage, pas enregistré.

## Contrôles et documents d'atelier

- `controle.ts` : pièces qui se traversent (intersection exacte avec manifold), portée libre des tablettes, portes et tiroirs qui se touchent en s'ouvrant (`collisionsOuverture` : chaque élément balaie son ouverture en quatre pas contre les pièces fixes et les autres éléments ouverts).
- `plafond.ts` : plan en pente, vérification que pièces et portes ouvertes restent dessous.
- `percage.ts` : trous dans le repère de la porte vue de face. `courses.ts` : liste d'achat.

## Matériaux, panneaux et coût

Le matériau (`Materiau`) et le panneau acheté (`Panneau`, le stock) se règlent dans **une seule fenêtre**, `src/ui/materiaux.ts` : une carte par matériau (couleur, décor, bords plaqués par schéma cliquable `src/ui/chants.ts`, panneau acheté) avec, dessous, les formats du stock de ce panneau (épaisseur, longueur, largeur, quantité en stock, prix). Le lien matériau → stock est le nom du panneau acheté (`Materiau.matiere`, comparé sans casse). Renommer un panneau renomme ses formats. Les pièces dont la matière n'a pas de matériau apparaissent à part.

Le plan de découpe (`renderDecoupe` dans `main.ts`) ne contient plus ni stock ni prix : il renvoie vers « Matériaux et panneaux » et « Courses et coût ». **L'argent est dans `ouvrirCourses`** (`src/ui/feuilles.ts`, sur `listeCourses`) : chaque ligne de `Ligne` porte une `ref` (format du stock, ligne de quincaillerie, chant d'un matériau) pour que son prix se modifie là où on le lit.

## Matériaux et décors

Un matériau porte le panneau acheté (clé du stock), une couleur unique pour les faces et les chants, et un `decor` optionnel : `uni`, `bois`, `lamelle`, `contreplaque`, `mdf`, `tissu`. Sans décor, `decorParNom` le devine d'après le nom. **Affichage seulement** : la fiche, la découpe et l'export Collada ne changent pas.

Pour une pièce avec décor, `uvDecor` (`src/kernel/decor.ts`) sépare faces et chants (deux matériaux three) et calcule des coordonnées de texture **en mètres réels**, le fil suivant la longueur de la pièce. Les textures sont dessinées au canevas par `src/ui/decors.ts` à partir de la couleur, sans fichier image. Le décor `tissu`, pour les meubles importés, lisse les normales aux arêtes douces et projette la texture sans coordonnées propres (`uvTriplanaire`).

## Échange avec d'autres logiciels

`collada.ts` exporte du Collada 1.4.1 (Z vers le haut, mètres, une pièce par nœud, un matériau coloré par matière). L'import passe par `ColladaLoader` de three : un objet fermé (vérifié par manifold) devient une pièce de débit, sinon un objet de référence ; nom et couleur du matériau du fichier sont repris. Pas de `.skp` (format propriétaire).

## Serveur MCP et assistant intégré

Deux façons de piloter l'app avec Claude, qui partagent **les mêmes outils** (`OUTILS` et `appeler` dans `src/mcp.ts`, une trentaine) :

1. **Serveur MCP** (`src-tauri/src/mcp.rs`) : HTTP en POST sur `127.0.0.1:41733/mcp`, réponses JSON, sans SSE. Sécurité : écoute locale seulement, jeton obligatoire (fichier `mcp-token`, droits 600, comparé en temps constant), en-têtes `Host` et `Origin` vérifiés contre le DNS rebinding. Rust ne connaît que le protocole : `tools/list` et `tools/call` sont transmis à l'interface par l'événement Tauri `mcp`, qui répond par la commande `mcp_reply` (30 s au plus).
2. **Assistant dans l'app** (`src/ui/assistant.ts`) : conversation avec Claude depuis la webview, via `@anthropic-ai/sdk` (`dangerouslyAllowBrowser`, la clé est celle de l'utilisateur). Boucle d'outils manuelle en flux, cache de prompt, repli serveur en cas de refus. La clé est gardée par la coque (`cle_api`, `definir_cle_api`) dans un fichier de droits 600, jamais dans un projet ; dans la version navigateur elle reste en mémoire. Garde-fous : au plus 25 allers-retours d'outils par demande, et confirmation dans la conversation avant `supprimer`, `supprimer_lignes_fiche`, `effacer_traits` et `modifier_meuble` (liste `A_CONFIRMER`). La webview tourne sous une CSP stricte (`security.csp` dans `tauri.conf.json` : scripts du paquet et WASM, connexions limitées à l'API Anthropic et à l'IPC Tauri) ; en dev (`devCsp: null`) elle est désactivée.

Règles pour un outil : arguments **vérifiés avant d'agir** (types, bornes, clés connues), une seule étape d'annulation par appel, un message dans la barre d'aide. Dans le navigateur (sans Rust), `window.workshop.mcp(method, params)` appelle les mêmes outils pour les essais.

Les commandes Tauri : `open_doc`, `save_doc`, `confirm_discard`, `cle_api`, `definir_cle_api`, `mcp_reply`. Événements : `menu` (menu natif), `mcp`.

## Interface (`main.ts`)

Disposition : barre du haut (`#topbar` : projet, quatre étapes, ouvrir, enregistrer, menu), colonne d'outils (`#toolbar`), vue 3D (`#app`, entre les barres), panneau de droite (`#panel`), barre de vue flottante (`#viewbar`), barre d'aide (`#status`). Les tailles viennent de variables CSS (`--top`, `--rail`, `--side`, `--status`) ; le canevas se redimensionne sur `#app`. `refreshPanel()` reconstruit le panneau (carte de la sélection, puis `actionsEtape()` selon `etape`), la barre du haut (`renderTopbar`) et la barre de vue (`renderViewbar`) ; les boutons gardent leurs identifiants (`p-debit`, `f-save`…) et sont branchés par `on(id, …)`, où qu'ils soient dans la page. Icônes : `src/ui/icones.ts` (Tabler, MIT), à ajouter à la liste avant de les utiliser.

Sections, dans l'ordre du fichier : état et historique, fichiers, Collada, scène (`rebuild` reconstruit toute la scène depuis le document), pointage et accroches, outils (sélection, déplacer, rotation, mètre, pousser/tirer, dessin), outils Ajuster et Échelle, presse-papiers, masquage, clavier, panneau de propriétés, fenêtres annexes, portes et tiroirs (outil Ouvrir), fiche de débit, découpe, assistant de caisson, guide des premiers pas.

Le formulaire « Nouveau meuble » (`renderCaisson`) n'est plus une fenêtre : il occupe le panneau de droite (`caissonOuvert` : `refreshPanel` le laisse en place) et dessine un **aperçu translucide** du meuble dans la scène (`majApercu`, groupe `apercuGroup`), en réutilisant `genererCaisson` et `maillePanneau`. Les pièces du meuble modifié sont masquées pendant l'édition. Le Guide (`openGuide`) reprend les quatre étapes et les raccourcis ; l'avancement d'une étape (`etapeFaite`) vient de gestes mémorisés (`marquer`).

L'état est global au module (une trentaine de variables) : un outil est un ensemble de fonctions `clic…`, `bouger…`, `fin…` branchées sur `onDown` / `onMove`, avec Échap pour annuler (`cancelOp`). Le document change toujours par `doc = nouvelDoc` puis `commit()`, qui alimente l'historique, la sauvegarde locale et le titre de la fenêtre.

Pour les essais dans la console du navigateur : `window.workshop` expose `doc`, `mcp`, `ecran`, `dae`, `debit`, `setTool`, `fitAll`, `addBox`.

## Dette connue

Voir la section « Pistes » du [README](../README.md) pour la liste maintenue.
