# Workshop 3D : consignes pour Claude

Modeleur 3D de menuiserie (Mac, Tauri 2 + TypeScript + Three.js) : on dessine ou on génère un meuble, l'app sort la fiche de débit, le plan de découpe et le coût. Lis [README.md](README.md) pour le produit et [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) pour le code **avant** de modifier quoi que ce soit.

## Commandes

```bash
nvm use                  # Node 22 (.nvmrc)
npm install
npm test                 # vitest : le noyau (src/kernel) et les outils MCP
npx tsc --noEmit         # types (strict, noUncheckedIndexedAccess)
npm run dev              # navigateur : http://127.0.0.1:5173
npm run app              # app native en dev
npm run pack             # app Mac : src-tauri/target/release/bundle/macos/Workshop 3D.app
```

Rust vient de `brew install rustup` ; `app` et `pack` ajoutent son dossier au `PATH`.

## Comment on travaille

1. **Comprendre avant d'écrire** : repérer (grep) puis lire la section concernée, pas le fichier entier. `src/main.ts` fait environ 2700 lignes, organisé en sections `// ───────── Titre ─────────`.
2. **Le plus petit changement complet** : réutiliser un helper ou un motif voisin, pas d'option ni de dépendance « pour plus tard ». Traiter tous les appelants, tests et fixtures que le changement casse.
3. **Noyau d'abord** : la logique va dans `src/kernel/` (sans DOM, testable) ; `main.ts` et `src/ui/` ne font que brancher. Tout comportement du noyau a un test dans le `*.test.ts` voisin.
4. **Vérifier pour de vrai** : les tests ne couvrent pas l'interface. Après un changement visible, lance `npm run dev`, essaie dans le navigateur (`window.workshop` expose le document et les outils), puis reconstruis l'app avec `npm run pack`.
5. **Dire ce qui n'a pas été vérifié** à la fin d'un changement, et le risque à connaître.

## Conventions

- Code, commentaires et messages d'interface **en français** ; identifiants en français pour le métier (`caisson`, `debit`, `materiau`), en anglais pour la plomberie (`rebuild`, `commit`).
- **Unités** : le noyau en **mètres**, les outils MCP et l'interface en **millimètres**. Convertir aux frontières, vérifier l'unité d'une cote avant de l'utiliser.
- **Repère** : X largeur, Y profondeur (façade vers -Y), Z hauteur.
- Le document est cloné à chaque modification (`cloneDoc`) puis validé à l'ouverture (`src/kernel/file.ts`) : **un nouveau champ du document doit être ajouté à `file.ts` et à son test d'aller-retour**, sinon il est perdu à l'enregistrement.
- **Ancien nom** : le projet s'appelait « Atelier 3D ». Les fichiers `.atelier` (format `atelier3d`) s'ouvrent encore (`parse` dans `file.ts`) ; les écrire se fait toujours en `.workshop`. Ne pas retirer cette tolérance sans migrer les fichiers.
- Les noms de champs JSON `methods` et `meta.methode` désignent les matériaux (ancien nom) : ne pas les renommer, des fichiers existent.
- Les arguments qui viennent de l'extérieur (MCP, assistant, fichier, `.dae`) sont **vérifiés avant d'agir** : types, bornes, clés connues.
- Commits : un sujet par commit, message `type: sujet` (`feat`, `fix`, `docs`, `refactor`, `test`), en français.
- Les fichiers de notes locales sont préfixés `_local_` (ignorés par git) ; ne pas les publier.

## Ajouter un outil MCP

Les outils sont décrits dans `OUTILS` (schéma JSON) et exécutés dans `appeler` de `src/mcp.ts` ; l'assistant intégré (`src/ui/assistant.ts`) reprend les deux tels quels.

1. Décrire l'outil dans `OUTILS` (description claire : c'est ce que lit le modèle), valider chaque argument dans la fonction.
2. Une seule étape d'annulation : passer par `c.appliquer(doc, message)`.
3. Un test dans `src/mcp.test.ts` (contexte factice `ctx()`).
4. Mettre à jour la section MCP de `docs/ARCHITECTURE.md` si le comportement change.

Piège : Claude Code garde le schéma des outils en cache pour la session. Après un changement de schéma, relance la session, ou appelle le serveur en JSON-RPC direct (`curl` sur `127.0.0.1:41733/mcp` avec l'en-tête `Authorization: Bearer <jeton>`).

## Concevoir un meuble réel avec l'app ouverte

Branche le MCP (voir le README), puis : `etat` pour voir le projet, `stock` pour les panneaux et leurs prix, `creer_meuble` ou `ajouter` pour les pièces, `verifier` pour les contrôles, `decoupe` pour le coût, `capture` pour voir le résultat. Quand un outil manque, ajoute-le au code plutôt que de contourner : c'est ainsi que le projet a grandi.

Un meuble sous plan de travail (buffet, meuble bas) se crée d'un appel : `dessus: 'traverses'`, `entailles`, `hTiroirs`, `facadesEgales`, `fondParColonne`, `epFondTiroir` et les matières `matiere_facade`, `matiere_caisse_tiroir` (voir `docs/ARCHITECTURE.md`). Ce qui sort de ces options se fait avec `ajouter`, et « modifier le meuble » l'efface : les pièces ajoutées à la main n'ont pas d'identifiant de meuble.

## Pièges connus

- Les tests qui créent une géométrie appellent `initKernel()` (manifold, WASM) dans un `beforeAll`.
- `manifold-3d` est asynchrone et lourd : ne pas l'appeler à chaque image.
- `rebuild()` reconstruit **toute** la scène depuis le document : coûteux sur un gros modèle, à ne déclencher que par `commit()`.
- Un maillage importé a souvent des sommets en T : ne pas tracer ses arêtes triangle par triangle (voir `decor === 'tissu'` dans `main.ts`).
- Mettre la marge de découpe à 0 change parfois le nombre de panneaux ; ne pas supposer qu'une optimisation est faite tant que `decoupe` ne le confirme pas.
- Ne jamais écrire de secret dans le dépôt : la clé API de l'assistant et le jeton MCP vivent dans le dossier de configuration de l'app, hors projet.

## À ne pas toucher sans demande

`src-tauri/capabilities/`, l'identifiant de l'app (`tauri.conf.json`, il fixe le dossier de configuration : jeton MCP et clé API), le format `.workshop` (compatibilité des fichiers existants).
