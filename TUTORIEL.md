# Workshop 3D : tutoriel

De l'idée de meuble à la liste de courses et au plan de coupe, en quatre étapes. Le même guide, avec les raccourcis clavier, est dans l'app : bouton **Guide** en bas de la colonne d'outils, ou touche **?**. Les étapes se cochent toutes seules dans la barre du haut.

## L'écran

- **Barre du haut** : le nom du projet (un point orange signale des modifications non enregistrées), les **quatre étapes** d'un projet (**1 Concevoir, 2 Contrôler, 3 Fabriquer, 4 Acheter**), puis l'**Assistant** (Claude, dans l'app), Ouvrir, Enregistrer et le menu **…** (nouveau projet, importer, exporter un `.dae`).
- **Colonne d'outils à gauche** : sélection, ajuster, échelle, portes (ouvrir et fermer portes et tiroirs), déplacer, rotation, mètre, orbite, panoramique. Le **Mode expert**, en bas, ajoute le dessin libre.
- **Panneau de droite** : en haut, la pièce ou le meuble sélectionné ; dessous, les actions de l'étape choisie dans la barre du haut.
- **Barre de vue**, en bas de la 3D : Face, Dessus, Côté, 3D, et les options d'affichage (cotes, repères, vue éclatée).
- **Barre d'aide**, tout en bas : ce que fait l'outil actif. Les confirmations (enregistré, ce que l'assistant vient de faire) s'affichent un instant en haut de la vue.

## 1. Créer un meuble

Étape **1 Concevoir**, bouton **Nouveau meuble**

1. Choisis un modèle de départ : Bibliothèque, Dressing, Meuble bas, Commode ou Étagère murale.
2. Ajuste les cotes en millimètres : largeur, hauteur, profondeur, épaisseur des panneaux.
3. Règle chaque colonne : **Étagères**, **Penderie** (étagère haute et tringle) ou **Tiroirs** (avec leurs façades, une tablette au-dessus).
4. Coche **Portes en applique** si tu en veux. Au-delà de 600 mm de large, la colonne reçoit deux portes.
5. Indique la **matière des panneaux** (par exemple « Mélaminé blanc 18 ») et celle du **fond** (par exemple « HDF 3 »).
6. Pour un meuble sous un plan de travail (buffet, meuble bas), choisis **Dessus : Deux traverses** (une plaque de moins), coche **Côtés entaillés, plinthe unique** pour une plinthe en retrait sur toute la largeur, et indique des **hauteurs de tiroirs** (par exemple `310, 310, 160`, de bas en haut). **Façades de même largeur** égalise portes et tiroirs, **Un fond par colonne** range mieux le fond dans un panneau.
7. Clique **Créer**. Le message en bas du formulaire annonce le nombre de panneaux et la quincaillerie (charnières, coulisses, poignées, taquets, tringle). Si une cote est impossible, il le dit et le bouton reste grisé.

## 2. Le regarder

| Geste | Effet |
|---|---|
| Molette enfoncée + glisser | Tourner autour |
| Maj + molette enfoncée + glisser | Décaler la vue |
| Molette | Zoomer |
| Touches 1, 2, 3, 0 | Vue de face, de dessus, de côté, 3D |
| Touche K | Afficher les cotes hors tout |
| Maj + Z | Tout cadrer |

Sur un trackpad, les outils **Orbite** et **Panoramique** de la barre de gauche font la même chose au clic.

## 3. Ajuster une pièce

Outil **Sélection** (touche Espace), comme dans SketchUp :

- **Clic** : une pièce. **Maj + clic** : ajoute ou retire. **Option + clic** : ajoute. **Maj + Option + clic** : retire.
- **Glisser de gauche à droite** (cadre en trait plein) : les pièces entièrement dans le cadre.
- **Glisser de droite à gauche** (cadre en pointillés) : toutes les pièces que le cadre touche.
- **Double-clic** : tout le meuble. **Cmd+A** : tout. **Échap** : plus rien.
- La pièce sous la souris s'éclaire avant le clic.

Avec une seule pièce sélectionnée, à droite :

- **Matériau** : une pastille de couleur par matériau du projet ; un clic l'applique à la pièce (ou à toute la sélection). **+ Matériau** en ajoute un.
- **Chants** : les bords plaqués. L1 et L2 sont les deux grands côtés, l1 et l2 les deux petits.
- **Fil du bois** : si la pièce a un sens (placage, bois massif), la découpe ne la tournera pas.
- **Dans la fiche** : décoche pour exclure la pièce de la fiche de débit.
- **Modifier le meuble…** : rouvre le formulaire et recrée le meuble avec les nouvelles cotes, à sa place. Les retouches faites à la main sur ses pièces sont perdues.
- **Tout le meuble** : sélectionne toutes ses pièces, par exemple pour le déplacer avec l'outil **Déplacer** (touche M).

Le formulaire **Nouveau meuble** s'ouvre dans le panneau de droite, et **le meuble se dessine en direct** dans la vue (aperçu translucide) : tu peux tourner autour pendant que tu règles. Les pastilles de matériaux remplissent le champ que tu viens de toucher (panneaux, façades, fond…). Les réglages rares sont dans « Options ».

**Matériaux et panneaux…** : un matériau, c'est une couleur (la même sur les faces et sur les chants), un décor, des bords plaqués, et le **panneau acheté** avec ses formats, son stock et ses prix. C'est ici, et seulement ici, qu'on indique les prix des panneaux.

- **Ajouter** : un clic sur un matériau courant (mélaminé blanc, chêne, gris, noir ; MDF à peindre ; contreplaqué ; HDF), ou **+ Autre**.
- **Couleur** : clique sur la pastille de la ligne pour la changer. Toutes les pièces de ce matériau changent de couleur.
- **Décor** : l'aspect à l'écran, veinage du bois massif, lames du lamellé-collé, plis du contreplaqué sur les chants, MDF brut, ou uni pour le peint et le mélaminé. « Auto » le devine d'après le nom du matériau. Le fil suit le sens choisi pour chaque pièce. C'est seulement de l'affichage : la fiche et la découpe ne changent pas.
- **Panneau acheté** : le nom qui relie les pièces au stock. Dessous, ses **formats** (épaisseur, longueur, largeur), ce que tu as déjà (**En stock**) et le **prix d'achat** d'un panneau neuf. Si un format manque pour des pièces, l'app te le dit et propose les formats courants. Deux matériaux peuvent partager le même panneau, par exemple un MDF 10 peint en vert et un MDF 10 peint en blanc : ils se découpent dans les mêmes panneaux, et la fiche les sépare par couleur.
- **Bords plaqués** : clique les côtés du schéma qui reçoivent un chant par défaut (en bleu = plaqué). Même schéma pour une pièce seule, dans le panneau de droite.
- **Réglages du chant** : nom, épaisseur et prix du chant, et « Déduire le chant » pour que la fiche donne des cotes de coupe.

### Mettre à l'échelle, étirer (toutes les pièces)

Outil **Échelle** (touche S), comme dans SketchUp. Il marche sur n'importe quelles pièces, même dessinées à la main.

- Sélectionne des pièces, ou survole une pièce ou un meuble : un cadre vert et des poignées apparaissent. Les **points verts** au milieu des faces agissent sur un seul axe, les **points rouges** aux coins sur tout à la fois.
- Clic sur une poignée, bouge la souris, clic pour poser. La poignée opposée reste fixe ; avec **Option**, c'est le centre.
- Tape un **facteur** (`1,2`) ou une **cote** (`1100mm`, `110cm`, `1,1m`) puis Entrée. Un nombre seul au-delà de 10 est une cote en mm.
- **Tab** change de mode :
  - **garder les épaisseurs** (par défaut) : les panneaux gardent leur épaisseur, les pièces qui traversent le milieu s'allongent et celles au-delà se déplacent. Élargir une bibliothèque de 10 cm rallonge les tablettes et pousse un côté, sans rien épaissir ;
  - **tout agrandir** : homothétie classique, épaisseurs comprises.
- Un meuble créé avec « Nouveau meuble… » se modifie plutôt avec **Ajuster** ou « Modifier le meuble… », qui recalculent tiroirs et quincaillerie.

### Ajuster un meuble à la souris

Outil **Ajuster** (touche A). Survole un meuble créé avec « Nouveau meuble… » : des poignées apparaissent.

- **Vertes** : largeur (côté droit), hauteur (dessus), profondeur (façade). Le côté gauche, le dessous et l'arrière restent en place.
- **Orange** : un montant entre deux colonnes. Le tirer élargit une colonne et rétrécit sa voisine.
- Clic sur une poignée pour la prendre, bouge, clic pour poser. Ou tape la cote voulue puis Entrée (pour un montant : la largeur intérieure de la colonne de gauche).
- Tout suit : étagères, tiroirs, coulisses, portes et quincaillerie sont recalculés. Agrandir le meuble garde la répartition des colonnes.

Dans **Modifier le meuble…**, chaque colonne a aussi une case de largeur (la voisine compense).

## 4. Lire la fiche de débit

Étape **3 Fabriquer**, **Fiche de débit** (ou touche **D**). Une ligne par groupe de pièces identiques : cotes, quantité, matière, chants. Elle se met à jour à chaque ouverture. Une ligne que tu modifies à la main est conservée. **Export CSV** pour un tableur, **Imprimer** pour l'atelier.

## 5. Optimiser la découpe et chiffrer

Étape **3 Fabriquer**, **Plan de découpe**.

1. **Panneaux et prix…** ouvre « Matériaux et panneaux » : formats, stock et prix d'achat. Sans format pour une matière, le plan te le signale.
2. **Réglages de découpe** : **trait de scie** (3 mm) et **marge de délignage** (10 mm), à ajuster selon ta scie.
3. Le coût complet (panneaux, chant, quincaillerie) est dans **Courses et coût** (étape 4), bouton du même nom.
4. Les **plans de coupe** s'affichent, un par panneau : coupes droites de bord à bord, faisables à la scie sur rail. Le stock est utilisé avant tout achat.
   Chaque pièce porte le nom qu'elle a dans la fiche de débit, avec ses cotes ; une légende numérotée suit chaque plan. ↻ signale une pièce tournée.
   - **Pièce trop grande** pour tous tes panneaux (un dessus de 3 m, par exemple) : l'app propose de la couper en morceaux égaux, à assembler ensuite, et les place. Décoche « Couper les pièces trop grandes » pour l'éviter.
   - **Stock insuffisant** sans prix d'achat : l'app indique combien de panneaux acheter en plus ; donne leur prix pour qu'ils entrent dans le coût.
5. Après avoir coupé : **Découpe faite : mettre à jour le stock**. Les panneaux utilisés sortent du stock et les chutes utiles y entrent pour le prochain projet. Annulable avec Cmd+Z.

Le total en haut additionne panneaux à acheter, chant et quincaillerie.

## 6. Enregistrer et imprimer

- **Cmd+S** enregistre un fichier `.workshop`, **Cmd+O** l'ouvre, **Cmd+N** repart de zéro.
- **Plans à imprimer** : vues de face, de dessus et de côté, cotées, de la sélection ou de tout le modèle.

## Portes et tiroirs : ouvrir, fermer, quincaillerie

Une pièce peut être reconnue pour ce qu'elle est : une **porte**, ou la façade d'un **tiroir** avec son caisson.

- **Meubles créés avec « Nouveau meuble… »** : leurs portes et tiroirs sont reconnus d'office. Les charnières sont vers l'extérieur du meuble. Leurs réglages (poignée, sortie, charnières…) sont gardés quand tu modifies le meuble ou que tu l'ajustes à la souris.
- **Copier** (Cmd+C / Cmd+V, Cmd+D, Option avec Déplacer ou Rotation) : portes et tiroirs gardent leurs réglages. Un meuble copié en entier devient un second meuble, modifiable à part.
- **Reconnaître** : dans le panneau, « Reconnaître N porte(s) et tiroir(s) » identifie d'un coup les pièces nommées « Porte… » et « Façade tiroir… ». Le caisson d'un tiroir, c'est-à-dire les pièces derrière la façade, est trouvé tout seul.
- **À la main** : sélectionne la pièce, puis « C'est une porte », ou la façade puis « C'est un tiroir ».
- **Réglages d'une porte** :
  - côté des charnières (gauche, droite, ou en haut pour un relevable, en bas pour un abattant) ;
  - pose (en applique, demi-applique, encastrée) ;
  - angle d'ouverture (95° à 170°) ;
  - nombre de charnières : automatique selon la hauteur, ou imposé ;
  - poignée (entraxe, ou sans poignée).
- **Réglages d'un tiroir** : longueur des coulisses, sortie totale ou partielle, poignée.
- **Ouvrir à la souris** : outil **Ouvrir** (touche **I**). Attrape une porte ou un tiroir et tire pour l'ouvrir, pousse pour le refermer. L'angle ou la sortie s'affiche en bas. Un simple clic l'ouvre ou le ferme en entier.
- **Ouvrir depuis le panneau** : « Ouvrir » / « Fermer » sur l'élément sélectionné, « Tout ouvrir » et « Tout fermer » à l'étape 2 Contrôler. C'est seulement de l'affichage : rien n'est modifié.
- **Sortie des tiroirs** : totale (le tiroir sort de toute la longueur des coulisses, cas des coulisses à billes courantes) ou partielle (environ les 3/4, coulisses plus simples).
- **Quincaillerie** : charnières, coulisses et poignées sont dessinées à leur place, en gris (bouton « Quincaillerie » pour les cacher). Le panneau donne les **cotes de perçage** :
  - charnières : hauteur de chaque cuvette, distance au chant ;
  - coulisses : hauteur de leur axe ;
  - poignées : position des deux trous.
- **Liste d'achat** : charnières, coulisses et poignées s'ajoutent toutes seules à « Courses et coût » et se mettent à jour à chaque réglage. Les prix saisis sont gardés.
- **Charnières à cuvette** : il faut une porte d'au moins 16 mm d'épaisseur ; le panneau prévient si elle est plus mince.
- **Double-clic** sur une porte ou un tiroir : toutes ses pièces sont sélectionnées.

## Avant de couper : vérifier, percer, acheter

- **Plafond en pente…** (étape 2 Contrôler) : angle et hauteur mesurés sur place, ou « D'après la pièce sélectionnée » pour reprendre la pente d'un rampant. Le plafond s'affiche en rouge pâle (bouton « Plafond » pour le cacher).
- **Vérifier** (étape 2 Contrôler) :
  - pièces qui se traversent ;
  - tablettes de plus de 80 cm entre deux appuis, ou plus de 30 cm en porte-à-faux ; le dessus et le dessous d'un caisson ne comptent pas, ils sont assemblés ;
  - portes trop minces pour des charnières ;
  - pièces, portes et tiroirs qui touchent le plafond, même en s'ouvrant ;
  - pièces sans matériau.
  « Montrer » sélectionne les pièces en cause.
- **Fiche de perçage** : chaque porte et façade vue de face. Les cuvettes de charnières et les trous de poignée sont cotés depuis le coin bas gauche, avec le tableau des trous. C'est pour la sélection, ou pour toutes les portes et façades. À imprimer pour l'atelier.
- **Courses et coût** (étape 4 Acheter) : tout l'argent du projet, avec les prix modifiables sur place :
  - panneaux à acheter, d'après la découpe (le prix d'un format se règle ici ou dans « Matériaux et panneaux ») ;
  - chant, avec 10 % de marge (prix au mètre) ;
  - quincaillerie, avec des lignes à ajouter ;
  - visserie estimée, sans prix.
  Le total est en bas de la fenêtre ; **Export CSV** pour un tableur.
  À imprimer ou à exporter en CSV.
- **Repères** (barre de vue) : la référence de la fiche (P1, P2…) s'affiche sur chaque pièce, pour s'y retrouver au montage.
- **Vue éclatée** (barre de vue) : les pièces s'écartent pour montrer l'assemblage. C'est seulement de l'affichage.

## Masquer des pièces

Pour voir l'intérieur d'un meuble ou travailler derrière une porte :

- **Maj+H** (ou « Masquer » dans le panneau, ou Édition > Masquer la sélection) cache les pièces sélectionnées.
- **Maj+Option+H** (ou « Tout afficher » dans le panneau) les fait réapparaître.
- Une pièce masquée n'est plus cliquable, ni sélectionnable, ni accrochable, mais elle reste dans le projet, la fiche de débit et les exports. Le masquage est enregistré avec le fichier et s'annule avec Cmd+Z.

## Déplacer une pièce ou un meuble

Outil **Déplacer** (touche M), comme dans SketchUp :

1. Sans sélection, survoler un meuble l'éclaire en entier : c'est lui qui bougera. Avec une sélection, c'est elle qui bouge.
2. **Clic 1** : le point de référence. Il s'accroche aux coins (vert) et aux milieux d'arêtes (bleu clair).
3. Bouge : le meuble suit. Il s'accroche aux coins et milieux des autres pièces (pose coin contre coin), et aux axes quand tu glisses dans leur direction (ligne rouge, verte ou bleue).
4. **Flèches** pour verrouiller un axe (→ rouge, ← vert, ↑ bleu ; même flèche pour libérer), ou **Maj** pour garder l'axe en cours.
5. **Clic 2** pour poser, ou tape une distance + Entrée. `x;y;z` + Entrée donne un décalage complet.
6. Juste après, une distance + Entrée corrige le déplacement. Avec **Option**, c'est une copie qui bouge ; `x5` ou `/5` + Entrée la répète.

## Copier, coller, dupliquer

- **Cmd+C** copie la sélection, **Cmd+X** la coupe. Le presse-papiers est gardé : tu peux copier dans un projet et coller dans un autre.
- **Cmd+V** colle : les pièces suivent la souris comme avec Déplacer (accroches et axes compris), clic pour poser, Échap pour annuler.
- **Cmd+Maj+V** colle sur place, à la position d'origine.
- **Cmd+D** duplique la sélection directement (sans passer par le presse-papiers), à poser à la souris.
- Un meuble copié en entier reste un meuble : il garde ses réglages et sa quincaillerie, et reste modifiable. Quelques pièces copiées d'un meuble deviennent des pièces libres.
- Les mêmes commandes sont dans le menu Édition et dans le panneau (Dupliquer, Copier). Dans un champ de saisie, elles agissent sur le texte.

## Mesurer et poser des guides

Outil **Mètre** (touche T), comme dans SketchUp :

- **Mesurer** : clic sur un point, puis sur un autre. Les coins (vert), milieux (bleu clair) et guides (rose) s'accrochent, et les axes aussi. La distance s'affiche sur le modèle et en bas, avec ses composantes X, Y, Z. Flèches pour verrouiller un axe.
- **Poser un guide** : survole une arête jusqu'à ce qu'elle s'éclaire en rose (n'importe où sauf pile sur un coin), clic, éloigne-toi, puis clic, ou tape la distance + Entrée. Un guide caché par une pièce reste visible en rose pâle. Une ligne en tirets se pose parallèle à l'arête. Avec **Option**, l'arête sert seulement de point de départ pour mesurer.
- Les guides aident à dessiner et à placer : les outils s'accrochent dessus et sur leurs croisements.
- **Gomme** sur un guide pour l'effacer, ou « Effacer les guides » dans le panneau.

## Tourner une pièce

Outil **Rotation** (touche Q), qui fonctionne comme le rapporteur de SketchUp :

1. Survole une face : le rapporteur se couche dessus. Sa couleur donne l'axe de rotation : bleu = vertical, rouge = X, vert = Y. Les flèches verrouillent l'axe (→ rouge, ← vert, ↑ bleu, ↓ libre).
2. **Clic 1** : le centre de rotation (il s'accroche aux coins et aux milieux d'arêtes).
3. **Clic 2** : la ligne de départ de l'angle.
4. Bouge la souris : l'angle se cale tous les 15°. **Clic 3** pour valider, ou tape l'angle puis Entrée.
5. Juste après, tape un autre angle + Entrée pour le corriger.

Sans sélection, c'est la pièce cliquée qui tourne. Avec **Option**, c'est une copie qui tourne ; juste après, `x6` + Entrée en pose six au même pas, `/6` en répartit six.

## Échanger avec SketchUp et Sweet Home 3D

Format d'échange : **Collada (.dae)**, lu et écrit par les deux logiciels.

- **Exporter .dae** (menu **…**, ou Cmd+E) : la sélection, ou tout le modèle. Chaque pièce devient un objet nommé, chaque matière une couleur. Le coin bas avant gauche est à l'origine, en mètres.
  - **Sweet Home 3D** : Meubles > Importer un meuble…, choisis le fichier. Vérifie l'orientation et les dimensions dans l'assistant.
  - **SketchUp** : Fichier > Importer…, type « COLLADA (*.dae) ».
- **Importer .dae** (Cmd+I) : chaque objet du fichier devient une pièce, posée à droite du modèle. Une pièce fermée entre dans la fiche de débit et accepte Pousser/Tirer ; une géométrie ouverte (décor, mur) reste un objet de référence.
  - Depuis SketchUp : Fichier > Exporter > Modèle 3D…, type « COLLADA (*.dae) ».

Le format natif de SketchUp (.skp) n'est pas pris en charge : c'est un format fermé. Passe par le .dae, que SketchUp ouvre et enregistre.

## Se faire aider par Claude

Deux façons :

- **Dans l'app** : bouton **✦ Assistant** en bas à droite. Tu écris ta demande, Claude répond et agit directement sur le projet. Il faut une clé API Anthropic (console.anthropic.com, facturée à l'usage), saisie une fois via le bouton **Clé** ; elle est gardée sur ton Mac, jamais dans le projet. **Nouveau** repart d'une conversation vide, **Arrêter** interrompt une réponse.
- **Depuis Claude Code** : l'app ouverte, il voit ton projet et y travaille (serveur MCP « workshop3d », branchement décrit dans le README).

Dans les deux cas :

- Il **lit** : meubles, pièces, fiche de débit, découpe et coût, et une image de la vue.
- Il **agit** : créer ou modifier un meuble, déplacer, renommer, changer une matière ou des chants, supprimer, et sélectionner des pièces pour te les montrer.
- Chaque action s'annonce en bleu dans la barre d'aide et s'annule avec **Cmd+Z**, comme les tiennes.
- Exemples : « regarde mon dressing, les étagères ne sont-elles pas trop larges ? », « fais-moi une commode de 1200 à côté », « combien coûte le projet si j'achète tout en chêne ? ».

## Pour aller plus loin : le mode expert

En bas de la colonne d'outils, **Mode expert** ajoute les outils de dessin libre, comme dans SketchUp :

- **Ligne** (L), **Rectangle** (R), **Cercle** (C) sur le sol ou sur une face.
- **Pousser/Tirer** (P) : donne de l'épaisseur à une surface, creuse une poche, perce.
- **Gomme** (E), **Mètre** (T).
- Pendant un tracé, tape une cote au clavier puis Entrée : `800;300` pour un rectangle, `18` pour une épaisseur.

## Raccourcis

Outils : Espace sélection · A ajuster · S échelle · I ouvrir (portes et tiroirs) · M déplacer · Q rotation · T mètre · O orbite · H panoramique · et, en mode expert, L ligne · R rectangle · C cercle · P pousser/tirer · E gomme.

Vues : 1 face · 2 dessus · 3 côté · 0 en 3D · K cotes hors tout · Maj+Z tout cadrer. D ouvre la fiche de débit, ? le guide.

Édition : Cmd+Z annuler · Cmd+Maj+Z refaire · Cmd+C, X, V copier, couper, coller · Cmd+Maj+V coller sur place · Cmd+D dupliquer · Cmd+A tout sélectionner · Échap annuler l'opération en cours · Maj+H masquer · Maj+Option+H tout afficher. Pendant un geste, tape une cote puis Entrée.

## Limites à connaître

- La découpe est un calcul approché : bon, pas garanti optimal.
- Les comptes de quincaillerie suivent des règles simples. Vérifie-les avec les notices de ton fournisseur.
- Les plans sont filaires : les arêtes cachées sont dessinées aussi.
