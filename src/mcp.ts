// Outils MCP de Workshop 3D : ce qu'un assistant peut lire et faire dans le projet ouvert.
// Le serveur (src-tauri/src/mcp.rs) ne fait que transmettre `tools/list` et `tools/call` ici.
// Les arguments viennent de l'extérieur : tout est vérifié avant d'agir. Cotes en mm côté outils, en m dans le modèle.
import { CAISSON_DEFAUT, MODELES, verifier, type CaissonParams, type TypeColonne } from './kernel/cabinet';
import { coutChant, totals, type DebitRow } from './kernel/debit';
import { boxMesh, cloneDoc, couleurDe, estManifold, materiauNomme, meshBounds, prismMesh, materiauDe, moveSolid, pieceDims, REGLAGES_DEFAUT, sansMeublesVides, type Doc, type MatieresCaisson, type Solid, type V3 } from './kernel/model';
import { planDecoupe } from './kernel/nesting';
import { controler } from './kernel/controle';
import { listeCourses } from './kernel/courses';
import { fichePercage } from './kernel/percage';
import { plafondDepuisPiece, type Plafond } from './kernel/plafond';
import { caissonTiroir, coulisseAuto, elementDe, facadeParmi, ferrures, reconnaitre, COULISSES, ENTRAXES, OUVERTURES, type Element } from './kernel/elements';
import { DECORS, decorParNom, estDecor } from './kernel/decor';

export type Vue = 'face' | 'dessus' | 'cote' | 'iso';
export interface Ctx {
  doc(): Doc;
  debitSynchro(): DebitRow[];                 // fiche à jour du modèle, sans rien enregistrer
  selection(): number[];
  fichier(): string | null;
  modifie(): boolean;
  // Remplace le document (une étape d'annulation), sélectionne `ids` et prévient l'utilisateur.
  appliquer(d: Doc, message: string, ids?: number[]): void;
  selectionner(ids: number[]): void;
  annuler(): boolean;
  ouvrir(ids: number[] | null, ouvert: boolean): number;   // éléments ouverts à l'écran (null = tous)
  fiche(): DebitRow[];                        // fiche telle qu'enregistrée (lignes manuelles comprises)
  ecrireFiche(rows: DebitRow[], message: string): void;
  capture(vue: Vue | undefined, largeur: number): string;        // JPEG en base64
  creerMeuble(d: Doc, params: CaissonParams, matiere: string, fond: string, origine: V3 | null, autres?: MatieresCaisson): { id: number; ids: number[] };
  modifierMeuble(d: Doc, id: number, params: CaissonParams, matiere?: string, fond?: string, autres?: MatieresCaisson): { doc: Doc; ids: number[] } | null;
}
type Contenu = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
export interface Resultat { content: Contenu[]; isError?: boolean }

const mm = (m: number) => Math.round(m * 10000) / 10;
const mm3 = (v: V3) => v.map(mm);
class ErreurArg extends Error {}

// ───────── Vérification des arguments ─────────
type Args = Record<string, unknown>;
function nombre(a: Args, k: string, opt: { min?: number; max?: number } = {}): number | undefined {
  const v = a[k];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ErreurArg(`« ${k} » doit être un nombre.`);
  if (opt.min !== undefined && v < opt.min) throw new ErreurArg(`« ${k} » doit être ≥ ${opt.min}.`);
  if (opt.max !== undefined && v > opt.max) throw new ErreurArg(`« ${k} » doit être ≤ ${opt.max}.`);
  return v;
}
function texte(a: Args, k: string, max = 200): string | undefined {
  const v = a[k];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || v.length > max) throw new ErreurArg(`« ${k} » doit être un texte de ${max} caractères au plus.`);
  return v;
}
function booleen(a: Args, k: string): boolean | undefined {
  const v = a[k];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') throw new ErreurArg(`« ${k} » doit être vrai ou faux.`);
  return v;
}
function vecteur(a: Args, k: string): V3 | undefined {
  const v = a[k];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 1e5))
    throw new ErreurArg(`« ${k} » doit être [x, y, z] en mm.`);
  return v as V3;
}
function entiers(a: Args, k: string): number[] | undefined {
  const v = a[k];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length > 2000 || !v.every((x) => Number.isInteger(x))) throw new ErreurArg(`« ${k} » doit être une liste d'identifiants.`);
  return v as number[];
}
function objet(a: Args, k: string): Args | undefined {
  const v = a[k];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) throw new ErreurArg(`« ${k} » doit être un objet.`);
  return v as Args;
}

const TYPES: TypeColonne[] = ['etageres', 'penderie', 'tiroirs', 'penderie_tiroirs'];
const BORNES: Partial<Record<keyof CaissonParams, [number, number]>> = {
  L: [50, 10000], H: [50, 5000], P: [50, 2000], e: [3, 60], colonnes: [1, 12], etageres: [0, 30], tiroirs: [1, 10],
  hTiroir: [50, 1000], jeu: [0, 10], fond: [0, 30], plinthe: [0, 500], retrait: [0, 500], largeurTraverse: [30, 500], retraitPlinthe: [0, 500], epFondTiroir: [3, 20],
};
// Paramètres partiels venus de l'extérieur, fusionnés sur `base`.
function lireParams(src: Args, base: CaissonParams): CaissonParams {
  const p: CaissonParams = JSON.parse(JSON.stringify(base)) as CaissonParams;
  for (const k of Object.keys(src)) {
    if (k in BORNES) {
      const [min, max] = BORNES[k as keyof CaissonParams]!;
      (p as unknown as Record<string, number>)[k] = nombre(src, k, { min, max })!;
    } else if (k === 'portes') p.portes = booleen(src, k)!;
    else if (k === 'montantsPleins') { if (booleen(src, k)) p.montantsPleins = true; else delete p.montantsPleins; }
    else if (k === 'entailles') { if (booleen(src, k)) p.entailles = true; else delete p.entailles; }
    else if (k === 'facadesEgales') { if (booleen(src, k)) p.facadesEgales = true; else delete p.facadesEgales; }
    else if (k === 'fondParColonne') { if (booleen(src, k)) p.fondParColonne = true; else delete p.fondParColonne; }
    else if (k === 'dessus') {
      const v = texte(src, k, 20);
      if (v !== 'plein' && v !== 'traverses') throw new ErreurArg('« dessus » : plein ou traverses.');
      if (v === 'traverses') p.dessus = 'traverses'; else delete p.dessus;
    } else if (k === 'hTiroirs') {
      const l = src[k];
      if (l === null || (Array.isArray(l) && !l.length)) delete p.hTiroirs;
      else if (!Array.isArray(l) || l.length > 10 || !l.every((x) => typeof x === 'number' && x >= 50 && x <= 1000)) throw new ErreurArg('« hTiroirs » : jusqu\'à 10 hauteurs de façade en mm (50 à 1000), de bas en haut.');
      else p.hTiroirs = l as number[];
    }
    else if (k === 'types') {
      const t = src[k];
      if (!Array.isArray(t) || t.length > 12 || !t.every((x) => TYPES.includes(x as TypeColonne))) throw new ErreurArg(`« types » : liste parmi ${TYPES.join(', ')}.`);
      p.types = t as TypeColonne[];
    } else if (k === 'largeurs') {
      const l = src[k];
      if (!Array.isArray(l) || !l.every((x) => typeof x === 'number' && x > 0 && x < 10000)) throw new ErreurArg('« largeurs » : largeurs intérieures des colonnes en mm.');
      p.largeurs = l as number[];
    } else throw new ErreurArg(`Paramètre inconnu : « ${k} ».`);
  }
  p.colonnes = Math.round(p.colonnes);
  if ('colonnes' in src && !('largeurs' in src)) delete p.largeurs;
  while (p.types.length < p.colonnes) p.types.push('etageres');
  p.types = p.types.slice(0, p.colonnes);
  return p;
}


// ───────── Description des outils ─────────
const PARAMS_SCHEMA = {
  type: 'object',
  description: 'Paramètres du meuble, en mm. Seuls ceux donnés changent.',
  properties: {
    L: { type: 'number', description: 'largeur hors tout' }, H: { type: 'number', description: 'hauteur hors tout' },
    P: { type: 'number', description: 'profondeur du caisson (portes et fond non compris)' }, e: { type: 'number', description: 'épaisseur des panneaux' },
    colonnes: { type: 'integer' }, types: { type: 'array', items: { enum: TYPES }, description: 'contenu de chaque colonne, de gauche à droite' },
    largeurs: { type: 'array', items: { type: 'number' }, description: 'largeur intérieure de chaque colonne (proportions gardées si L change)' },
    etageres: { type: 'integer', description: 'étagères par colonne « etageres »' }, tiroirs: { type: 'integer', description: 'tiroirs par colonne « tiroirs »' },
    hTiroir: { type: 'number', description: 'hauteur de façade de tiroir' }, portes: { type: 'boolean', description: 'portes en applique (2 au-delà de 600 mm)' }, montantsPleins: { type: 'boolean', description: 'montants du sol au dessus, dessus/dessous/plinthe coupés par colonne (meuble plus long qu\'un panneau)' },
    jeu: { type: 'number' }, fond: { type: 'number', description: 'épaisseur du fond (0 = sans fond)' },
    plinthe: { type: 'number', description: 'hauteur de plinthe (0 = posé au sol)' }, retrait: { type: 'number', description: 'retrait des étagères en façade' },
    dessus: { enum: ['plein', 'traverses'], description: 'dessus : panneau plein (défaut) ou deux traverses (avant et arrière), pour un meuble sous plan de travail' }, largeurTraverse: { type: 'number', description: 'largeur des traverses du dessus (100 par défaut)' },
    fondParColonne: { type: 'boolean', description: 'un fond par colonne au lieu d\'un seul sur toute la largeur (se range mieux dans un panneau)' },
    facadesEgales: { type: 'boolean', description: 'colonnes calculées pour que toutes les façades (portes, tiroirs) aient la même largeur ; ignoré si `largeurs` est donné' }, epFondTiroir: { type: 'number', description: 'épaisseur du fond de tiroir (8 par défaut ; 5 pour du contreplaqué de 5)' },
    entailles: { type: 'boolean', description: 'côtés et montants entaillés au pied : une seule plinthe sur toute la largeur, en retrait (retraitPlinthe)' }, retraitPlinthe: { type: 'number', description: 'retrait de la plinthe en façade (retrait par défaut)' },
    hTiroirs: { type: 'array', items: { type: 'number' }, description: 'hauteurs de façade de chaque tiroir, de bas en haut, jeu compris, à la place de tiroirs × hTiroir. Soit 100 mm libres au-dessus, soit la somme = hauteur − plinthe : les tiroirs remplissent la colonne, sans tablette' },
  },
  additionalProperties: false,
};
const IDS = { type: 'array', items: { type: 'integer' }, description: 'identifiants de pièces (voir `pieces`)' };
export const OUTILS = [
  { name: 'etat', title: 'État du projet', description: 'Résumé du projet ouvert : fichier, meubles (paramètres, cotes, position), pièces libres, sélection, matières, stock. À appeler en premier.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'pieces', title: 'Pièces', description: 'Liste des pièces : nom, meuble, matière, cotes de débit (L × l × e) et boîte englobante en mm.', inputSchema: { type: 'object', properties: { meuble: { type: 'integer', description: 'seulement les pièces de ce meuble' }, selection: { type: 'boolean', description: 'seulement la sélection de l\'utilisateur' } } }, annotations: { readOnlyHint: true } },
  { name: 'fiche_debit', title: 'Fiche de débit', description: 'Fiche de débit à jour : pièces identiques regroupées, cotes, matière, chants, et totaux (surface m², mètres de chant).', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'decoupe', title: 'Plan de découpe', description: 'Optimisation de la découpe sur le stock de panneaux : panneaux utilisés et à acheter par matière, chute, pièces sans place, coût total (panneaux, chant, quincaillerie).', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'capture', title: 'Capture de la vue', description: 'Image de la vue 3D, telle que l\'utilisateur la voit, ou d\'une vue normalisée cadrée sur tout le modèle (la vue de l\'utilisateur n\'est pas changée). Les cotes affichées (étiquettes) ne figurent pas sur l\'image.', inputSchema: { type: 'object', properties: { vue: { enum: ['face', 'dessus', 'cote', 'iso'] }, largeur: { type: 'integer', description: 'largeur de l\'image en pixels (400 à 1600, 1000 par défaut)' } } }, annotations: { readOnlyHint: true } },
  { name: 'selectionner', title: 'Sélectionner', description: 'Sélectionne des pièces ou un meuble dans l\'app, pour les montrer à l\'utilisateur. Ne modifie pas le modèle.', inputSchema: { type: 'object', properties: { ids: IDS, meuble: { type: 'integer' } } }, annotations: { readOnlyHint: true } },
  { name: 'creer_meuble', title: 'Créer un meuble', description: `Crée un meuble paramétrique (caisson, dressing…) à partir d'un modèle et/ou de paramètres. Modèles : ${MODELES.map((m) => `${m.cle} (${m.nom})`).join(', ')}. Défauts : ${JSON.stringify(CAISSON_DEFAUT)}. Placé à droite du modèle si \`position\` est absente. Le résultat donne la boîte englobante, portes comprises (elles sont devant le caisson, en Y < 0).`, inputSchema: { type: 'object', properties: { modele: { enum: MODELES.map((m) => m.cle) }, params: PARAMS_SCHEMA, matiere: { type: 'string', description: 'matière des panneaux, ex. « Mélaminé blanc 18 »' }, matiere_fond: { type: 'string', description: 'ex. « HDF 3 »' }, matiere_fond_tiroir: { type: 'string', description: 'fonds de tiroir, si différents du fond (ex. « Contreplaqué 8 »)' }, matiere_facade: { type: 'string', description: 'façades des portes et des tiroirs, si différentes du meuble (ex. « MDF 18 peint »)' }, matiere_caisse_tiroir: { type: 'string', description: 'côtés, devants et arrières de tiroir, si différents du meuble (ex. « MDF 18 »)' }, position: { type: 'array', items: { type: 'number' }, description: 'coin bas avant gauche du caisson [x, y, z] en mm' } } }, annotations: { destructiveHint: false } },
  { name: 'modifier_meuble', title: 'Modifier un meuble', description: 'Change les paramètres d\'un meuble existant ; il est recréé à sa place (côté gauche, dessous et arrière fixes). Les retouches faites à la main sur ses pièces sont perdues.', inputSchema: { type: 'object', properties: { meuble: { type: 'integer' }, params: PARAMS_SCHEMA, matiere: { type: 'string' }, matiere_fond: { type: 'string' }, matiere_fond_tiroir: { type: 'string' }, matiere_facade: { type: 'string' }, matiere_caisse_tiroir: { type: 'string' } }, required: ['meuble'] }, annotations: { destructiveHint: true } },
  { name: 'deplacer', title: 'Déplacer', description: 'Déplace des pièces ou un meuble entier d\'un vecteur [dx, dy, dz] en mm.', inputSchema: { type: 'object', properties: { ids: IDS, meuble: { type: 'integer' }, delta: { type: 'array', items: { type: 'number' } } }, required: ['delta'] }, annotations: { destructiveHint: false } },
  { name: 'modifier_piece', title: 'Modifier une pièce', description: 'Change le nom, la matière, les chants (ex. « L1 L2 », L = grands côtés, l = petits), le fil du bois ou la présence dans la fiche de débit d\'une pièce.', inputSchema: { type: 'object', properties: { id: { type: 'integer' }, nom: { type: 'string' }, matiere: { type: 'string' }, chants: { type: 'string' }, fil: { enum: ['L', 'l', 'aucun'] }, dans_fiche: { type: 'boolean' } }, required: ['id'] }, annotations: { destructiveHint: false } },
  { name: 'ajouter', title: 'Ajouter des pièces', description: 'Ajoute des pièces libres, en mm : un pavé (coins min et max) ou un profil polygonal extrudé (coupes en biais), et éventuellement de la quincaillerie. Une seule étape d\'annulation. Pour une pièce sur mesure : plinthe, façade, tiroir sans avant, traverse…', inputSchema: { type: 'object', properties: { pieces: { type: 'array', maxItems: 200, items: { type: 'object', properties: { nom: { type: 'string' }, min: { type: 'array', items: { type: 'number' }, description: 'pavé : coin minimal [x, y, z]' }, max: { type: 'array', items: { type: 'number' }, description: 'pavé : coin maximal' }, profil: { type: 'object', description: 'pièce coupée en biais, à la place de min/max : polygone extrudé. axe x : points [y, z] ; axe y : [x, z] ; axe z : [x, y]', properties: { axe: { enum: ['x', 'y', 'z'] }, points: { type: 'array', items: { type: 'array', items: { type: 'number' } } }, de: { type: 'number' }, a: { type: 'number' } }, required: ['axe', 'points', 'de', 'a'] }, matiere: { type: 'string', description: 'nom d\'une matière du projet (ses chants s\'appliquent) ou matière libre' }, chants: { type: 'string' }, fil: { enum: ['L', 'l', 'aucun'] }, dans_fiche: { type: 'boolean', description: 'vrai par défaut' } }, required: ['nom', 'min', 'max'] } }, quincaillerie: { type: 'array', items: { type: 'object', properties: { nom: { type: 'string' }, qte: { type: 'integer' } }, required: ['nom', 'qte'] } } }, required: ['pieces'] }, annotations: { destructiveHint: false } },
  { name: 'masquer', title: 'Masquer', description: 'Masque des pièces ou un meuble à l\'écran (pour voir derrière, ou alléger la vue). Elles restent dans le projet, la fiche et les exports.', inputSchema: { type: 'object', properties: { ids: IDS, meuble: { type: 'integer' } } }, annotations: { destructiveHint: false } },
  { name: 'afficher', title: 'Afficher', description: 'Réaffiche des pièces masquées ; sans argument, toutes.', inputSchema: { type: 'object', properties: { ids: IDS, meuble: { type: 'integer' } } }, annotations: { destructiveHint: false } },
  { name: 'materiau', title: 'Matériau', description: 'Crée un matériau ou modifie celui qui porte ce nom : panneau acheté (nom du stock), couleur unique faces et chants (#rrggbb), bords plaqués par défaut (L1 L2 l1 l2), décor à l\'écran. Pour l\'appliquer : `modifier_piece` ou `ajouter` avec `matiere` = son nom.', inputSchema: { type: 'object', properties: { nom: { type: 'string' }, panneau: { type: 'string' }, couleur: { type: 'string', description: '#rrggbb' }, cotes: { type: 'string' }, decor: { enum: ['auto', ...DECORS.map((x) => x.cle)], description: 'aspect à l\'écran (veinage, lames, plis) ; auto = deviné d\'après le nom' } }, required: ['nom'] }, annotations: { destructiveHint: false } },
  { name: 'effacer_traits', title: 'Effacer des traits', description: 'Efface des dessins (traits de construction du mode expert, et les surfaces qu\'ils ferment) par identifiant (voir `etat`, champ `traits`) ; sans argument, tous. Ne touche pas aux pièces.', inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'integer' } } } }, annotations: { destructiveHint: true } },
  { name: 'identifier', title: 'Identifier une porte ou un tiroir', description: 'Déclare des pièces comme porte (une pièce) ou tiroir (façade + caisson, complété automatiquement par les pièces derrière la façade), ou modifie les réglages d\'un élément existant. La quincaillerie (charnières, coulisses, poignées) est alors placée sur le modèle avec ses cotes de perçage et ajoutée à la liste d\'achat. type « aucun » retire l\'identification.', inputSchema: { type: 'object', properties: { type: { enum: ['porte', 'tiroir', 'aucun'] }, ids: IDS, charnieres: { enum: ['gauche', 'droite', 'haut', 'bas'], description: 'côté vu de face' }, recouvrement: { enum: ['applique', 'demi', 'encastree'] }, ouverture: { enum: OUVERTURES }, nb_charnieres: { type: 'integer' }, entraxe: { enum: ENTRAXES, description: 'poignée, 0 = sans' }, coulisse: { enum: COULISSES }, sortie: { enum: ['totale', 'partielle'], description: 'coulisses à sortie totale ou partielle (3/4)' }, inverser_sens: { type: 'boolean', description: 'quand la quincaillerie est du mauvais côté' } }, required: ['type', 'ids'] }, annotations: { destructiveHint: false } },
  { name: 'reconnaitre', title: 'Reconnaître portes et tiroirs', description: 'Identifie automatiquement les pièces nommées « Porte… » et « Façade tiroir… » (avec le caisson derrière).', inputSchema: { type: 'object', properties: {} }, annotations: { destructiveHint: false } },
  { name: 'ouvrir', title: 'Ouvrir ou fermer', description: 'Ouvre ou ferme à l\'écran des portes et tiroirs identifiés (affichage seulement). Sans `ids`, tous.', inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'integer' }, description: 'identifiants d\'éléments ou de leurs pièces' }, ouvert: { type: 'boolean' } }, required: ['ouvert'] }, annotations: { readOnlyHint: true } },
  { name: 'verifier', title: 'Vérifier le projet', description: 'Contrôle : pièces qui se traversent, tablettes sans appui (> 80 cm) ou en porte-à-faux (> 30 cm), portes trop minces pour des charnières, portes qui se touchent en s\'ouvrant (pièce fixe ou porte voisine ; ouverture 90° = charnière bridée), pièces et ouvertures qui dépassent le plafond (s\'il est saisi), pièces sans matériau.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'plafond', title: 'Plafond en pente', description: 'Saisit le plafond de référence (sous-pente) : angle (°), hauteur (mm) mesurée à `position` (mm) le long de `axe` (x ou y), `sens` 1 si la pente monte vers les + de l\'axe, -1 sinon. Ou `depuis_piece` : d\'après la face inclinée la plus haute d\'une pièce. `retirer` : plus de plafond.', inputSchema: { type: 'object', properties: { angle: { type: 'number' }, hauteur: { type: 'number' }, position: { type: 'number' }, axe: { enum: ['x', 'y'] }, sens: { enum: [1, -1] }, depuis_piece: { type: 'integer' }, retirer: { type: 'boolean' } } }, annotations: { destructiveHint: false } },
  { name: 'percage', title: 'Fiche de perçage', description: 'Trous de chaque porte et façade de tiroir identifiée (cuvettes de charnières, vis de poignée), cotés en mm depuis le coin bas gauche vu de face.', inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'integer' }, description: 'pièces ou éléments ; tous si absent' } } }, annotations: { readOnlyHint: true } },
  { name: 'liste_courses', title: 'Courses et coût', description: 'Panneaux à acheter, chant (+10 %), quincaillerie et visserie estimée, avec prix quand ils sont saisis.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'notice', title: 'Notice de montage', description: 'Lit la notice de montage enregistrée dans le projet, ou la remplace par `etapes` (titre, texte, ids des pièces concernées, montrées dans la 3D par le bouton « Montrer »).', inputSchema: { type: 'object', properties: { etapes: { type: 'array', maxItems: 60, items: { type: 'object', properties: { titre: { type: 'string' }, texte: { type: 'string' }, ids: { type: 'array', items: { type: 'integer' } } }, required: ['titre', 'texte'] } } } }, annotations: { destructiveHint: true } },
  { name: 'stock', title: 'Stock de panneaux', description: 'Retire et/ou ajoute des formats de panneaux au stock (matière, épaisseur e, L × l en mm, qte en atelier, prix d\'achat d\'un panneau neuf, 0 = pas d\'achat). La matière doit être écrite comme celle des pièces. Règle aussi la découpe : `marge` rognée sur chaque bord des panneaux (0 si les bords d\'usine sont propres), `trait` de scie, en mm.', inputSchema: { type: 'object', properties: { retirer: { type: 'array', items: { type: 'object', properties: { matiere: { type: 'string' }, e: { type: 'number' }, L: { type: 'number' }, l: { type: 'number' } }, required: ['matiere', 'e', 'L', 'l'] } }, ajouter: { type: 'array', items: { type: 'object', properties: { matiere: { type: 'string' }, e: { type: 'number' }, L: { type: 'number' }, l: { type: 'number' }, qte: { type: 'integer' }, prix: { type: 'number' } }, required: ['matiere', 'e', 'L', 'l'] } }, marge: { type: 'number', description: 'mm rognés sur chaque bord des panneaux (défaut 10)' }, trait: { type: 'number', description: 'épaisseur du trait de scie en mm (défaut 3)' } } }, annotations: { destructiveHint: true } },
  { name: 'quincaillerie', title: 'Quincaillerie', description: 'Remplace la quincaillerie saisie à la main par cette liste (celle des meubles paramétriques et celle calculée depuis les portes et tiroirs identifiés restent). Les prix déjà saisis pour un même nom sont gardés.', inputSchema: { type: 'object', properties: { lignes: { type: 'array', items: { type: 'object', properties: { nom: { type: 'string' }, qte: { type: 'integer' }, prix: { type: 'number' } }, required: ['nom', 'qte'] } } }, required: ['lignes'] }, annotations: { destructiveHint: true } },
  { name: 'supprimer_lignes_fiche', title: 'Supprimer des lignes de la fiche', description: 'Supprime des lignes manuelles (ou retouchées à la main) de la fiche de débit, par leur référence (P1, P2… voir `fiche_debit`). Les autres lignes suivent le modèle et ne se suppriment pas ici.', inputSchema: { type: 'object', properties: { refs: { type: 'array', items: { type: 'string' } } }, required: ['refs'] }, annotations: { destructiveHint: true } },
  { name: 'supprimer', title: 'Supprimer', description: 'Supprime des pièces ou un meuble entier (avec sa quincaillerie). Annulable par l\'utilisateur.', inputSchema: { type: 'object', properties: { ids: IDS, meuble: { type: 'integer' } } }, annotations: { destructiveHint: true } },
  { name: 'annuler', title: 'Annuler', description: 'Annule la dernière modification (comme Cmd+Z), qu\'elle vienne de l\'assistant ou de l\'utilisateur.', inputSchema: { type: 'object', properties: {} }, annotations: { destructiveHint: true } },
];

// ───────── Lecture ─────────
function bbox(list: Solid[]) {
  if (!list.length) return null;
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const s of list) { const b = meshBounds(s.mesh); for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, b.min[k]!); max[k] = Math.max(max[k]!, b.max[k]!); } }
  return { min, max };
}
const matiereDe = (d: Doc, s: Solid) => materiauDe(d, s)?.nom || s.meta.matiere || '';
function etat(c: Ctx) {
  const d = c.doc(), sel = new Set(c.selection());
  const meubles = (d.caissons ?? []).map((r) => {
    const ps = d.solids.filter((s) => s.meta.caisson === r.id), b = bbox(ps);
    return {
      id: r.id, matiere: (d.methods ?? []).find((m) => m.id === r.methode)?.nom ?? '', matiere_fond: r.fond ?? '', matiere_fond_tiroir: r.fondTiroir ?? null, matiere_facade: r.facade ?? null, matiere_caisse_tiroir: r.caisseTiroir ?? null,
      pieces: ps.length, hors_tout: b ? mm3([b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]] as V3) : null,
      position: b ? mm3(b.min) : null, params: r.params,
      quincaillerie: (d.extras ?? []).filter((x) => x.caisson === r.id).map((x) => `${x.qte} ${x.nom}`),
    };
  });
  const libres = d.solids.filter((s) => !s.meta.caisson || !(d.caissons ?? []).some((r) => r.id === s.meta.caisson));
  return {
    fichier: c.fichier(), modifications_non_enregistrees: c.modifie(),
    meubles, pieces_libres: libres.map((s) => ({ id: s.id, nom: s.name })).slice(0, 200), total_pieces: d.solids.length,
    selection: d.solids.filter((s) => sel.has(s.id)).map((s) => ({ id: s.id, nom: s.name, meuble: s.meta.caisson ?? null })),
    materiaux: (d.methods ?? []).map((m) => ({ nom: m.nom, panneau: m.matiere, couleur: m.couleur ?? null, chant: m.chant, cotes_plaquees: m.cotes, pieces: d.solids.filter((s) => s.meta.methode === m.id).length })),
    pieces_masquees: d.solids.filter((s) => s.meta.masque).map((s) => s.id),
    elements: (d.elements ?? []).map((e) => ({ ...e, quincaillerie: ferrures(d, e).map((f) => f.cote) })),
    stock: (d.stock ?? []).map((p) => ({ matiere: p.matiere, e: p.e, L: p.L, l: p.l, qte: p.qte, prix: p.prix, chute: !!p.chute })),
    guides: (d.guides ?? []).length,
    traits: d.sketches.map((k) => ({ id: k.id, segments: k.segs.length, normale: k.plane.n.map((x) => Math.round(x * 1000) / 1000), point: mm3(k.plane.o) })),
  };
}
function pieces(c: Ctx, a: Args) {
  const d = c.doc(), meuble = nombre(a, 'meuble'), sel = booleen(a, 'selection') ? new Set(c.selection()) : null;
  return d.solids.filter((s) => (meuble === undefined || s.meta.caisson === meuble) && (!sel || sel.has(s.id))).map((s) => {
    const b = meshBounds(s.mesh);
    let dims: { L: number; l: number; e: number } | null = null;
    if (s.meta.piece) { try { const p = pieceDims(s.mesh); dims = { L: mm(p.L), l: mm(p.l), e: mm(p.e) }; } catch { /* forme quelconque */ } }
    return { id: s.id, nom: s.name, meuble: s.meta.caisson ?? null, matiere: matiereDe(d, s), couleur: couleurDe(d, s), masquee: s.meta.masque || undefined, dans_fiche: s.meta.piece, debit: dims, min: mm3(b.min), max: mm3(b.max), chants: s.meta.chants ?? null, fil: s.meta.fil };
  });
}
function fiche(c: Ctx) {
  const rows = c.debitSynchro();
  const t = totals(rows);
  return {
    lignes: rows.map((r) => ({ ref: r.ref, nom: r.nom, qte: r.qte, L: r.L, l: r.l, e: r.e, matiere: r.matiere, fil: r.fil, chants: r.chants, note: r.note || undefined, manuelle: r.src === 'manuel' || r.edited || undefined })),
    totaux: { pieces: t.pieces, surface_m2: Math.round(t.surface * 100) / 100, chant_m: Math.round(t.chant * 10) / 10 },
  };
}
// « 2 × Côté 900 × 450 » plutôt que deux lignes identiques.
const compter = (l: string[]) => [...l.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].map(([x, n]) => (n > 1 ? `${n} × ${x}` : x));
function decoupe(c: Ctx) {
  const d = c.doc(), rows = c.debitSynchro();
  const res = planDecoupe(rows, d.stock ?? [], d.reglages ?? REGLAGES_DEFAUT);
  const chant = coutChant(d), quinc = (d.extras ?? []).reduce((t, x) => t + x.qte * x.prix, 0);
  return {
    groupes: res.groupes.map((g) => ({
      matiere: g.matiere, e: g.e, pieces: g.nbPieces, aucun_panneau_en_stock: g.sansPanneau || undefined,
      panneaux_du_stock: g.plan.bins.filter((b) => !b.achat).length, panneaux_a_acheter: g.plan.bins.filter((b) => b.achat).length,
      formats: [...new Set(g.plan.bins.map((b) => `${b.panneau.L} × ${b.panneau.l}${b.panneau.chute ? ' (chute)' : ''}`))],
      cout_panneaux: Math.round(g.plan.cout * 100) / 100, chute_pct: Math.round(g.plan.chute * 100),
      sans_place: compter(g.plan.restants.map((p) => `${p.nom} ${p.L} × ${p.l}`)),
      coupees_en_morceaux: g.decoupes.map((x) => `${x.nom} ${x.L} × ${x.l} : ${x.n} morceaux de ${x.partL} × ${x.partl}`),
      a_acheter_sans_prix: g.manques.map((m) => `${m.n} × ${m.L} × ${m.l}`),
    })),
    cout: { panneaux: Math.round(res.cout * 100) / 100, chant: Math.round(chant * 100) / 100, quincaillerie: Math.round(quinc * 100) / 100, total: Math.round((res.cout + chant + quinc) * 100) / 100 },
    quincaillerie_sans_prix: (d.extras ?? []).filter((x) => !(x.prix > 0)).map((x) => `${x.qte} ${x.nom}`),
  };
}

// ───────── Écriture ─────────
function cibles(d: Doc, a: Args): Solid[] {
  const ids = entiers(a, 'ids'), meuble = nombre(a, 'meuble');
  if (!ids && meuble === undefined) throw new ErreurArg('Donner « ids » ou « meuble ».');
  if (meuble !== undefined && !(d.caissons ?? []).some((r) => r.id === meuble)) throw new ErreurArg(`Meuble ${meuble} introuvable.`);
  const set = new Set(ids ?? []);
  const l = d.solids.filter((s) => set.has(s.id) || (meuble !== undefined && s.meta.caisson === meuble));
  const manquants = [...set].filter((i) => !d.solids.some((s) => s.id === i));
  if (manquants.length) throw new ErreurArg(`Pièces introuvables : ${manquants.join(', ')}.`);
  if (!l.length) throw new ErreurArg('Aucune pièce visée.');
  return l;
}
function resumeMeuble(d: Doc, id: number) {
  const ps = d.solids.filter((s) => s.meta.caisson === id), b = bbox(ps)!;
  return { meuble: id, pieces: ps.length, hors_tout: mm3([b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]] as V3), position: mm3(b.min), quincaillerie: (d.extras ?? []).filter((x) => x.caisson === id).map((x) => `${x.qte} ${x.nom}`) };
}
function creer(c: Ctx, a: Args) {
  const nomModele = texte(a, 'modele');
  const modele = nomModele === undefined ? undefined : MODELES.find((m) => m.cle === nomModele);
  if (nomModele !== undefined && !modele) throw new ErreurArg(`Modèle inconnu : ${nomModele}.`);
  const base: CaissonParams = { ...CAISSON_DEFAUT, types: [...CAISSON_DEFAUT.types], ...(modele ? JSON.parse(JSON.stringify(modele.params)) as Partial<CaissonParams> : {}) };
  const params = lireParams(objet(a, 'params') ?? {}, base);
  const err = verifier(params);
  if (err) throw new ErreurArg(err);
  const pos = vecteur(a, 'position');
  const d = cloneDoc(c.doc());
  const r = c.creerMeuble(d, params, texte(a, 'matiere') ?? 'Mélaminé blanc 18', texte(a, 'matiere_fond') ?? 'HDF 3', pos ? pos.map((v) => v / 1000) as V3 : null, matieresCaisson(a));
  c.appliquer(d, `meuble créé (${params.L} × ${params.H} × ${params.P})`, r.ids);
  return resumeMeuble(d, r.id);
}
// Matières optionnelles d'un meuble : fonds de tiroir, façades (portes et tiroirs), caisses de tiroir. Vide : comme le meuble.
function matieresCaisson(a: Args): MatieresCaisson | undefined {
  const m: MatieresCaisson = {};
  const fondTiroir = texte(a, 'matiere_fond_tiroir'), facade = texte(a, 'matiere_facade'), caisseTiroir = texte(a, 'matiere_caisse_tiroir');
  if (fondTiroir !== undefined) m.fondTiroir = fondTiroir.trim();
  if (facade !== undefined) m.facade = facade.trim();
  if (caisseTiroir !== undefined) m.caisseTiroir = caisseTiroir.trim();
  return Object.keys(m).length ? m : undefined;
}
function modifier(c: Ctx, a: Args) {
  const id = nombre(a, 'meuble')!;
  const base = c.doc(), rec = (base.caissons ?? []).find((r) => r.id === id);
  if (!rec) throw new ErreurArg(`Meuble ${id} introuvable.`);
  const params = lireParams(objet(a, 'params') ?? {}, rec.params);
  const err = verifier(params);
  if (err) throw new ErreurArg(err);
  const r = c.modifierMeuble(base, id, params, texte(a, 'matiere'), texte(a, 'matiere_fond'), matieresCaisson(a));
  if (!r) throw new ErreurArg('Modification impossible.');
  c.appliquer(r.doc, `meuble ${id} modifié`, r.ids);
  return resumeMeuble(r.doc, id);
}
function deplacer(c: Ctx, a: Args) {
  const delta = vecteur(a, 'delta');
  if (!delta) throw new ErreurArg('« delta » manquant.');
  const d = cloneDoc(c.doc()), l = cibles(d, a);
  for (const s of l) moveSolid(s, delta.map((v) => v / 1000) as V3);
  c.appliquer(d, `${l.length} pièce(s) déplacée(s)`, l.map((s) => s.id));
  return { deplacees: l.length, nouvelle_boite: (() => { const b = bbox(l)!; return { min: mm3(b.min), max: mm3(b.max) }; })() };
}
function modifierPiece(c: Ctx, a: Args) {
  const id = nombre(a, 'id')!;
  const d = cloneDoc(c.doc()), s = d.solids.find((x) => x.id === id);
  if (!s) throw new ErreurArg(`Pièce ${id} introuvable.`);
  const nom = texte(a, 'nom', 80), mat = texte(a, 'matiere'), chants = texte(a, 'chants', 40), fil = texte(a, 'fil'), fiche = booleen(a, 'dans_fiche');
  if (fil !== undefined && !['L', 'l', 'aucun'].includes(fil)) throw new ErreurArg('« fil » : L, l ou aucun.');
  if (chants !== undefined && !/^\s*((L1|L2|l1|l2)[\s,;]*)*$/.test(chants)) throw new ErreurArg('« chants » : parmi L1, L2, l1, l2.');
  if (nom !== undefined) s.name = nom;
  if (mat !== undefined) poserMatiere(d, s, mat);
  if (chants !== undefined) s.meta.chants = chants;
  if (fil !== undefined) s.meta.fil = fil as 'L' | 'l' | 'aucun';
  if (fiche !== undefined) s.meta.piece = fiche;
  c.appliquer(d, `pièce « ${s.name} » modifiée`, [id]);
  return { id, nom: s.name, matiere: matiereDe(d, s), chants: s.meta.chants ?? null, fil: s.meta.fil, dans_fiche: s.meta.piece };
}
// Matière d'une pièce : une méthode du projet si le nom correspond, sinon une matière libre.
function poserMatiere(d: Doc, s: Solid, mat: string) {
  const id = materiauNomme(d, mat);
  if (id) { s.meta.methode = id; delete s.meta.chants; } else { delete s.meta.methode; s.meta.matiere = ''; }
}
// Forme d'une pièce venue de l'extérieur : un pavé (min, max) ou un profil extrudé. En mm, rendue en m.
function formeDe(p: Args, ou: string) {
  const pr = objet(p, 'profil');
  if (!pr) {
    const min = vecteur(p, 'min'), max = vecteur(p, 'max');
    if (!min || !max) throw new ErreurArg(`${ou} : donner « min » et « max », ou « profil ».`);
    if (![0, 1, 2].every((k) => max[k]! - min[k]! >= 0.5)) throw new ErreurArg(`${ou} : chaque cote doit faire au moins 0,5 mm (max > min).`);
    return boxMesh(min.map((v) => v / 1000) as V3, max.map((v) => v / 1000) as V3);
  }
  const axe = ['x', 'y', 'z'].indexOf(texte(pr, 'axe') ?? '');
  const de = nombre(pr, 'de', { min: -1e5, max: 1e5 }), a = nombre(pr, 'a', { min: -1e5, max: 1e5 }), pts = pr.points;
  if (axe < 0 || de === undefined || a === undefined) throw new ErreurArg(`${ou} : profil : « axe » (x, y ou z), « de » et « a » obligatoires.`);
  if (Math.abs(a - de) < 0.5) throw new ErreurArg(`${ou} : profil : épaisseur nulle (« de » = « a »).`);
  if (!Array.isArray(pts) || pts.length < 3 || pts.length > 64 || !pts.every((q) => Array.isArray(q) && q.length === 2 && q.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 1e5)))
    throw new ErreurArg(`${ou} : profil : de 3 à 64 points [a, b] en mm.`);
  const mesh = prismMesh(axe as 0 | 1 | 2, (pts as [number, number][]).map(([x, y]) => [x / 1000, y / 1000]), de / 1000, a / 1000);
  if (!mesh.t.length || !estManifold(mesh)) throw new ErreurArg(`${ou} : profil invalide (points alignés ou contour qui se croise).`);
  return mesh;
}
function ajouter(c: Ctx, a: Args) {
  const ps = a.pieces, qs = a.quincaillerie ?? [];
  if (!Array.isArray(ps) || !ps.length || ps.length > 200) throw new ErreurArg('« pieces » : de 1 à 200 pièces.');
  if (!Array.isArray(qs) || qs.length > 50) throw new ErreurArg('« quincaillerie » : 50 lignes au plus.');
  const d = cloneDoc(c.doc()), ids: number[] = [];
  ps.forEach((x, i) => {
    const p = objet({ p: x }, 'p') ?? {}, ou = `pièce ${i + 1}`;
    const nom = texte(p, 'nom', 80);
    if (!nom) throw new ErreurArg(`${ou} : « nom » obligatoire.`);
    const mesh = formeDe(p, `${ou} (${nom})`);
    const fil = texte(p, 'fil'), chants = texte(p, 'chants', 40), mat = texte(p, 'matiere');
    if (fil !== undefined && !['L', 'l', 'aucun'].includes(fil)) throw new ErreurArg(`${ou} : « fil » : L, l ou aucun.`);
    if (chants !== undefined && !/^\s*((L1|L2|l1|l2)[\s,;]*)*$/.test(chants)) throw new ErreurArg(`${ou} : « chants » parmi L1, L2, l1, l2.`);
    const s: Solid = { id: d.next++, name: nom, mesh, meta: { piece: booleen(p, 'dans_fiche') ?? true, matiere: '', fil: (fil ?? 'aucun') as 'L' | 'l' | 'aucun', note: '' } };
    if (mat !== undefined) poserMatiere(d, s, mat);
    if (chants !== undefined) s.meta.chants = chants;
    d.solids.push(s); ids.push(s.id);
  });
  d.extras ??= [];
  for (const x of qs) {
    const q = objet({ q: x }, 'q') ?? {}, nom = texte(q, 'nom', 80), qte = nombre(q, 'qte', { min: 1, max: 10000 });
    if (!nom || !qte) throw new ErreurArg('Quincaillerie : « nom » et « qte » obligatoires.');
    d.extras.push({ id: d.next++, nom, qte: Math.round(qte), prix: 0 });
  }
  c.appliquer(d, `${ids.length} pièce(s) ajoutée(s)`, ids);
  return { ajoutees: ids.map((id, i) => ({ id, nom: d.solids.find((s) => s.id === id)!.name, n: i + 1 })), quincaillerie: qs.length };
}
function masquer(c: Ctx, a: Args, cacher: boolean) {
  const d = cloneDoc(c.doc());
  const l = !cacher && a.ids === undefined && a.meuble === undefined ? d.solids.filter((s) => s.meta.masque) : cibles(d, a);
  for (const s of l) if (cacher) s.meta.masque = true; else delete s.meta.masque;
  c.appliquer(d, `${l.length} pièce(s) ${cacher ? 'masquée(s)' : 'affichée(s)'}`, cacher ? c.selection().filter((i) => !l.some((s) => s.id === i)) : l.map((s) => s.id));
  return { [cacher ? 'masquees' : 'affichees']: l.length, encore_masquees: d.solids.filter((s) => s.meta.masque).length };
}
function materiau(c: Ctx, a: Args) {
  const nom = texte(a, 'nom', 80)?.trim(), panneau = texte(a, 'panneau', 80), couleur = texte(a, 'couleur', 7), cotes = texte(a, 'cotes', 40);
  const decor = texte(a, 'decor', 20);
  if (decor !== undefined && decor !== 'auto' && !estDecor(decor)) throw new ErreurArg(`« decor » : auto, ${DECORS.map((x) => x.cle).join(', ')}.`);
  if (!nom) throw new ErreurArg('« nom » obligatoire.');
  if (couleur !== undefined && !/^#[0-9a-fA-F]{6}$/.test(couleur)) throw new ErreurArg('« couleur » : #rrggbb.');
  if (cotes !== undefined && !/^\s*((L1|L2|l1|l2)[\s,;]*)*$/.test(cotes)) throw new ErreurArg('« cotes » : parmi L1, L2, l1, l2.');
  const d = cloneDoc(c.doc());
  const existe = (d.methods ?? []).find((m) => m.nom.toLowerCase() === nom.toLowerCase());
  const id = existe?.id ?? materiauNomme(d, nom);
  const m = d.methods!.find((x) => x.id === id)!;
  if (panneau !== undefined) m.matiere = panneau.trim();
  if (couleur !== undefined) m.couleur = couleur.toLowerCase();
  if (cotes !== undefined) m.cotes = cotes.trim();
  if (decor !== undefined) { if (estDecor(decor)) m.decor = decor; else delete m.decor; }
  c.appliquer(d, `matériau « ${m.nom} » ${existe ? 'modifié' : 'créé'}`, c.selection());
  return { nom: m.nom, panneau: m.matiere, couleur: m.couleur, cotes_plaquees: m.cotes, chant: m.chant, decor: m.decor ?? `auto (${decorParNom(m.nom)})` };
}
function effacerTraits(c: Ctx, a: Args) {
  const ids = entiers(a, 'ids'), d = cloneDoc(c.doc());
  const inconnus = (ids ?? []).filter((i) => !d.sketches.some((k) => k.id === i));
  if (inconnus.length) throw new ErreurArg(`Traits introuvables : ${inconnus.join(', ')}.`);
  const avant = d.sketches.length;
  d.sketches = ids ? d.sketches.filter((k) => !ids.includes(k.id)) : [];
  c.appliquer(d, `${avant - d.sketches.length} dessin(s) effacé(s)`, c.selection());
  return { effaces: avant - d.sketches.length, restants: d.sketches.length };
}
function identifier(c: Ctx, a: Args) {
  const type = texte(a, 'type'), ids = entiers(a, 'ids') ?? [];
  if (!['porte', 'tiroir', 'aucun'].includes(type ?? '')) throw new ErreurArg('« type » : porte, tiroir ou aucun.');
  const d = cloneDoc(c.doc());
  const manquants = ids.filter((i) => !d.solids.some((s) => s.id === i));
  if (!ids.length || manquants.length) throw new ErreurArg(manquants.length ? `Pièces introuvables : ${manquants.join(', ')}.` : '« ids » obligatoire.');
  const existant = [...new Set(ids.map((i) => elementDe(d, i)))];
  if (existant.length === 1 && existant[0] && type !== 'aucun' && existant[0].type !== type) throw new ErreurArg(`Ces pièces forment déjà un ${existant[0].type} : le retirer d'abord (type « aucun »).`);
  if (type === 'aucun') {
    const retires = existant.filter((e): e is Element => !!e).map((e) => e.id);
    d.elements = (d.elements ?? []).filter((e) => !retires.includes(e.id));
    c.appliquer(d, `${retires.length} élément(s) retiré(s)`, ids);
    return { retires };
  }
  let el = existant.length === 1 ? existant[0] : undefined;
  if (!el) {
    if (existant.some(Boolean)) throw new ErreurArg('Certaines pièces appartiennent déjà à un autre élément.');
    if (type === 'porte') {
      if (ids.length !== 1) throw new ErreurArg('Une porte = une seule pièce.');
      el = { id: d.next++, type: 'porte', piece: ids[0]!, charnieres: 'gauche', recouvrement: 'applique', ouverture: 110, entraxe: 128 };
    } else {
      const f = facadeParmi(d, ids);
      if (!f) throw new ErreurArg('Aucune façade verticale parmi ces pièces.');
      const pieces = [...new Set([...ids.filter((i) => i !== f.id), ...caissonTiroir(d, f)])];
      el = { id: d.next++, type: 'tiroir', facade: f.id, pieces, coulisse: coulisseAuto(d, pieces, f), entraxe: 160 };
    }
    d.elements = [...(d.elements ?? []), el];
  } else el = d.elements!.find((e) => e.id === el!.id)!;
  const choix = <T>(k: string, liste: readonly T[]): T | undefined => {
    const v = a[k];
    if (v === undefined) return undefined;
    if (!liste.includes(v as T)) throw new ErreurArg(`« ${k} » : ${liste.join(', ')}.`);
    return v as T;
  };
  const ent = choix('entraxe', ENTRAXES);
  if (ent !== undefined) el.entraxe = ent;
  if (el.type === 'porte') {
    el.charnieres = choix('charnieres', ['gauche', 'droite', 'haut', 'bas'] as const) ?? el.charnieres;
    el.recouvrement = choix('recouvrement', ['applique', 'demi', 'encastree'] as const) ?? el.recouvrement;
    el.ouverture = choix('ouverture', OUVERTURES) ?? el.ouverture;
    const nb = nombre(a, 'nb_charnieres', { min: 1, max: 8 });
    if (nb !== undefined) el.nbCharnieres = Math.round(nb);
  } else {
    el.coulisse = choix('coulisse', COULISSES) ?? el.coulisse;
    const so = choix('sortie', ['totale', 'partielle'] as const);
    if (so === 'partielle') el.sortie = 'partielle'; else if (so === 'totale') delete el.sortie;
  }
  if (booleen(a, 'inverser_sens')) el.sens = el.sens ? (-el.sens as 1 | -1) : -1;
  c.appliquer(d, `${el.type} identifié(e)`, ids);
  return { element: el, quincaillerie: ferrures(d, el).map((f) => f.cote) };
}
function stock(c: Ctx, a: Args) {
  const d = cloneDoc(c.doc());
  d.stock ??= [];
  const ret = a.retirer ?? [], aj = a.ajouter ?? [];
  if (!Array.isArray(ret) || !Array.isArray(aj) || ret.length + aj.length > 50) throw new ErreurArg('« retirer » et « ajouter » : listes de 50 formats au plus.');
  const fmt = (x: unknown, ou: string) => {
    const f = objet({ f: x }, 'f') ?? {}, matiere = texte(f, 'matiere', 80)?.trim();
    const e = nombre(f, 'e', { min: 1, max: 200 }), L = nombre(f, 'L', { min: 10, max: 10000 }), l = nombre(f, 'l', { min: 10, max: 10000 });
    if (!matiere || !e || !L || !l) throw new ErreurArg(`${ou} : « matiere », « e », « L » et « l » obligatoires.`);
    return { f, matiere, e, L, l };
  };
  let retires = 0;
  ret.forEach((x, i) => {
    const { matiere, e, L, l } = fmt(x, `retirer ${i + 1}`);
    const avant = d.stock!.length;
    d.stock = d.stock!.filter((p) => !(p.matiere.trim().toLowerCase() === matiere.toLowerCase() && p.e === e && p.L === L && p.l === l));
    if (d.stock.length === avant) throw new ErreurArg(`Format introuvable dans le stock : ${matiere} ${L} × ${l} × ${e}.`);
    retires += avant - d.stock.length;
  });
  aj.forEach((x, i) => {
    const { f, matiere, e, L, l } = fmt(x, `ajouter ${i + 1}`);
    d.stock!.push({ id: d.next++, matiere, e, L, l, qte: Math.round(nombre(f, 'qte', { min: 0, max: 1000 }) ?? 0), prix: nombre(f, 'prix', { min: 0, max: 100000 }) ?? 0 });
  });
  // Réglages de découpe : marge rognée sur chaque bord du panneau, épaisseur du trait de scie.
  const marge = nombre(a, 'marge', { min: 0, max: 100 }), trait = nombre(a, 'trait', { min: 0, max: 20 });
  if (marge !== undefined || trait !== undefined) d.reglages = { ...(d.reglages ?? REGLAGES_DEFAUT), ...(marge !== undefined ? { marge } : {}), ...(trait !== undefined ? { trait } : {}) };
  c.appliquer(d, `stock modifié (${retires} retiré(s), ${aj.length} ajouté(s))`, c.selection());
  const r = d.reglages ?? REGLAGES_DEFAUT;
  return { stock: d.stock.map((p) => ({ matiere: p.matiere, e: p.e, L: p.L, l: p.l, qte: p.qte, prix: p.prix })), marge: r.marge, trait: r.trait };
}
function quincaillerie(c: Ctx, a: Args) {
  const ls = a.lignes;
  if (!Array.isArray(ls) || ls.length > 100) throw new ErreurArg('« lignes » : 100 au plus.');
  const d = cloneDoc(c.doc());
  const prix = new Map((d.extras ?? []).filter((x) => x.prix > 0).map((x) => [x.nom.toLowerCase(), x.prix]));
  const nouvelles = ls.map((x, i) => {
    const q = objet({ q: x }, 'q') ?? {}, nom = texte(q, 'nom', 80)?.trim(), qte = nombre(q, 'qte', { min: 1, max: 10000 });
    if (!nom || !qte) throw new ErreurArg(`Ligne ${i + 1} : « nom » et « qte » obligatoires.`);
    return { id: d.next++, nom, qte: Math.round(qte), prix: nombre(q, 'prix', { min: 0, max: 100000 }) ?? prix.get(nom.toLowerCase()) ?? 0 };
  });
  d.extras = [...(d.extras ?? []).filter((x) => x.caisson !== undefined || x.auto), ...nouvelles];
  c.appliquer(d, 'quincaillerie mise à jour', c.selection());
  return { quincaillerie: d.extras.map((x) => `${x.qte} ${x.nom}${x.prix ? ` à ${x.prix} €` : ''}`) };
}
function supprimerLignes(c: Ctx, a: Args) {
  const refs = a.refs;
  if (!Array.isArray(refs) || !refs.every((r) => typeof r === 'string')) throw new ErreurArg('« refs » : liste de références (P1…).');
  // références lues sur la fiche synchronisée, celle que montre `fiche_debit`
  const vue = c.debitSynchro(), cibles = vue.filter((r) => refs.includes(r.ref));
  const inconnues = refs.filter((r) => !vue.some((x) => x.ref === r));
  if (inconnues.length) throw new ErreurArg(`Références inconnues : ${inconnues.join(', ')}.`);
  const auto = cibles.filter((r) => r.src === 'modèle' && !r.edited);
  if (auto.length) throw new ErreurArg(`Lignes calculées depuis le modèle, à supprimer en retirant les pièces : ${auto.map((r) => r.ref).join(', ')}.`);
  const ids = new Set(cibles.map((r) => r.id));
  c.ecrireFiche(vue.filter((r) => !ids.has(r.id)), `${cibles.length} ligne(s) retirée(s) de la fiche`);
  return { supprimees: cibles.map((r) => `${r.ref} ${r.nom}`) };
}
function supprimer(c: Ctx, a: Args) {
  const d = cloneDoc(c.doc()), l = new Set(cibles(d, a).map((s) => s.id));
  d.solids = d.solids.filter((s) => !l.has(s.id));
  const avant = (d.caissons ?? []).map((r) => r.id), apres = sansMeublesVides(d);
  const vides = avant.filter((i) => !(apres.caissons ?? []).some((r) => r.id === i));
  c.appliquer(apres, `${l.size} pièce(s) supprimée(s)`, []);
  return { supprimees: l.size, meubles_supprimes: vides };
}

const json = (v: unknown): Resultat => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
export function appeler(c: Ctx, nom: string, args: unknown): Resultat {
  const a = (args && typeof args === 'object' && !Array.isArray(args) ? args : {}) as Args;
  try {
    switch (nom) {
      case 'etat': return json(etat(c));
      case 'pieces': return json(pieces(c, a));
      case 'fiche_debit': return json(fiche(c));
      case 'decoupe': return json(decoupe(c));
      case 'capture': {
        const v = texte(a, 'vue') as Vue | undefined;
        if (v !== undefined && !['face', 'dessus', 'cote', 'iso'].includes(v)) throw new ErreurArg('« vue » : face, dessus, cote ou iso.');
        return { content: [{ type: 'image', mimeType: 'image/jpeg', data: c.capture(v, nombre(a, 'largeur', { min: 400, max: 1600 }) ?? 1000) }] };
      }
      case 'selectionner': { const d = c.doc(), l = cibles(d, a); c.selectionner(l.map((s) => s.id)); return json({ selectionnees: l.length }); }
      case 'creer_meuble': return json(creer(c, a));
      case 'modifier_meuble': return json(modifier(c, a));
      case 'deplacer': return json(deplacer(c, a));
      case 'modifier_piece': return json(modifierPiece(c, a));
      case 'ajouter': return json(ajouter(c, a));
      case 'masquer': return json(masquer(c, a, true));
      case 'afficher': return json(masquer(c, a, false));
      case 'materiau': return json(materiau(c, a));
      case 'effacer_traits': return json(effacerTraits(c, a));
      case 'identifier': return json(identifier(c, a));
      case 'reconnaitre': {
        const d = cloneDoc(c.doc()), n = reconnaitre(d);
        d.elements = [...(d.elements ?? []), ...n];
        c.appliquer(d, `${n.length} porte(s) et tiroir(s) reconnu(s)`, c.selection());
        return json({ reconnus: n.map((e) => ({ id: e.id, type: e.type, pieces: e.type === 'porte' ? [e.piece] : [e.facade, ...e.pieces] })) });
      }
      case 'ouvrir': {
        const ids = entiers(a, 'ids'), ouvert = booleen(a, 'ouvert');
        if (ouvert === undefined) throw new ErreurArg('« ouvert » obligatoire.');
        const d = c.doc(), els = ids ? [...new Set(ids.map((i) => (d.elements ?? []).find((e) => e.id === i) ?? elementDe(d, i)).filter((e): e is Element => !!e).map((e) => e.id))] : null;
        if (ids && !els!.length) throw new ErreurArg('Aucun élément identifié parmi ces identifiants.');
        return json({ [ouvert ? 'ouverts' : 'fermes']: c.ouvrir(els, ouvert) });
      }
      case 'verifier': { const d = c.doc(); return json({ problemes: controler(d, d.plafond), plafond: d.plafond ?? null }); }
      case 'plafond': {
        const d = cloneDoc(c.doc());
        if (booleen(a, 'retirer')) { delete d.plafond; c.appliquer(d, 'plafond retiré', c.selection()); return json({ plafond: null }); }
        const src = nombre(a, 'depuis_piece');
        let p: Plafond | null;
        if (src !== undefined) {
          const s = d.solids.find((x) => x.id === src);
          if (!s) throw new ErreurArg(`Pièce ${src} introuvable.`);
          p = plafondDepuisPiece(s);
          if (!p) throw new ErreurArg('Cette pièce n\'a pas de face inclinée tournée vers le haut.');
        } else {
          const angle = nombre(a, 'angle', { min: 0, max: 80 }), hauteur = nombre(a, 'hauteur', { min: 1, max: 10000 }), position = nombre(a, 'position', { min: -1e5, max: 1e5 }) ?? 0;
          const axe = texte(a, 'axe'), sens = a.sens;
          if (angle === undefined || hauteur === undefined || (axe !== 'x' && axe !== 'y') || (sens !== 1 && sens !== -1)) throw new ErreurArg('« angle », « hauteur », « axe » (x ou y) et « sens » (1 ou -1) obligatoires, ou « depuis_piece ».');
          p = { angle, hauteur, position, axe: axe === 'x' ? 0 : 1, sens };
        }
        d.plafond = p; c.appliquer(d, 'plafond enregistré', c.selection());
        return json({ plafond: p, problemes: controler(d, p).filter((x) => x.message.includes('plafond')) });
      }
      case 'percage': {
        const d = c.doc(), ids = entiers(a, 'ids');
        const els = (d.elements ?? []).filter((e) => !ids || ids.includes(e.id) || ids.some((i) => elementDe(d, i)?.id === e.id));
        return json(els.map((e) => fichePercage(d, e)));
      }
      case 'liste_courses': return json(listeCourses(c.doc(), c.debitSynchro()));
      case 'notice': {
        if (a.etapes === undefined) return json({ etapes: c.doc().notice ?? [] });
        if (!Array.isArray(a.etapes) || a.etapes.length > 60) throw new ErreurArg('« etapes » : 60 au plus.');
        const d = cloneDoc(c.doc()), connus = new Set(d.solids.map((s) => s.id));
        d.notice = a.etapes.map((x, i) => {
          const e = objet({ e: x }, 'e') ?? {}, titre = texte(e, 'titre', 200), corps = texte(e, 'texte', 4000), ids = entiers(e, 'ids');
          if (!titre || corps === undefined) throw new ErreurArg(`Étape ${i + 1} : « titre » et « texte » obligatoires.`);
          const inconnus = (ids ?? []).filter((k) => !connus.has(k));
          if (inconnus.length) throw new ErreurArg(`Étape ${i + 1} : pièces introuvables ${inconnus.join(', ')}.`);
          return { titre, texte: corps, ...(ids?.length ? { ids } : {}) };
        });
        c.appliquer(d, `notice de montage (${d.notice.length} étapes)`, c.selection());
        return json({ etapes: d.notice.length });
      }
      case 'stock': return json(stock(c, a));
      case 'quincaillerie': return json(quincaillerie(c, a));
      case 'supprimer_lignes_fiche': return json(supprimerLignes(c, a));
      case 'supprimer': return json(supprimer(c, a));
      case 'annuler': return json({ annule: c.annuler() });
      default: return { content: [{ type: 'text', text: `Outil inconnu : ${nom}` }], isError: true };
    }
  } catch (e) {
    return { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true };
  }
}

// Réponse à une requête transmise par Rust : `{ result }` ou `{ error }`.
export function repondre(c: Ctx, method: string, params: unknown): { result?: unknown; error?: { code: number; message: string } } {
  if (method === 'tools/list') return { result: { tools: OUTILS } };
  if (method === 'tools/call') {
    const p = (params ?? {}) as { name?: unknown; arguments?: unknown };
    if (typeof p.name !== 'string') return { error: { code: -32602, message: 'Nom d\'outil manquant.' } };
    return { result: appeler(c, p.name, p.arguments) };
  }
  return { error: { code: -32601, message: 'Méthode inconnue' } };
}
