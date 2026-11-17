import { boxMesh, prismMesh, type MeshData, type V3 } from './model';

// Générateur de caisson ou de dressing : des cotes simples donnent la liste des panneaux et la quincaillerie propre au caisson
// (taquets, tringle). Charnières, coulisses et poignées viennent des portes et tiroirs (rôle des panneaux, voir elements.ts).
// Cotes en mm. Repère : X largeur, Y profondeur (façade du caisson en Y = 0, portes devant, en Y < 0), Z hauteur.
// `penderie_tiroirs` : tiroirs en bas, tablette, penderie au-dessus (tringle sous une étagère haute).
export type TypeColonne = 'etageres' | 'penderie' | 'tiroirs' | 'penderie_tiroirs';
export interface CaissonParams {
  L: number; H: number; P: number;   // largeur, hauteur, profondeur du caisson (portes et fond non compris)
  e: number;                         // épaisseur des panneaux
  colonnes: number;                  // compartiments côte à côte
  types: TypeColonne[];              // contenu de chaque colonne
  etageres: number;                  // étagères par colonne « étagères » (et au-dessus des tiroirs)
  tiroirs: number;                   // tiroirs par colonne « tiroirs »
  hTiroir: number;                   // hauteur de chaque façade de tiroir
  portes: boolean;                   // portes en applique sur les colonnes étagères et penderie
  jeu: number;                       // jeu autour des façades
  fond: number;                      // épaisseur du fond en applique (0 = sans fond)
  plinthe: number;                   // hauteur de plinthe (0 = posé au sol)
  retrait: number;                   // retrait des étagères en façade
  largeurs?: number[];               // largeurs intérieures relatives des colonnes (absent = colonnes égales)
  montantsPleins?: boolean;          // montants du sol au dessus ; dessus, dessous et plinthe coupés par colonne (grands meubles)
  dessus?: 'plein' | 'traverses';    // dessus : un panneau plein (défaut), ou deux traverses sous un plan de travail
  largeurTraverse?: number;          // largeur des traverses du dessus (100 par défaut)
  retraitPlinthe?: number;           // retrait de la plinthe en façade (`retrait` par défaut)
  entailles?: boolean;               // côtés et montants entaillés au pied : plinthe unique, en retrait, comme un meuble de cuisine
  hTiroirs?: number[];               // hauteurs de façade de bas en haut (jeu compris), à la place de tiroirs × hTiroir
  epFondTiroir?: number;             // épaisseur du fond de tiroir (8 mm par défaut)
  facadesEgales?: boolean;           // colonnes calculées pour que toutes les façades aient la même largeur (sans `largeurs`)
  fondParColonne?: boolean;          // un fond par colonne (coupé au milieu des montants) au lieu d'un seul : il se range mieux dans un panneau
}
// `role` : la pièce est une porte ou fait partie d'un tiroir. `cle` identifie l'élément d'une génération à l'autre
// (colonne, rang), pour garder ses réglages (charnières, poignée…) quand le meuble est modifié.
export type RolePanneau = { type: 'porte'; cle: string; charnieres: 'gauche' | 'droite' } | { type: 'tiroir'; cle: string; facade: boolean; coulisse: number };
// `entaille` : angle avant-bas échancré (profondeur et hauteur, en m) pour loger la plinthe.
export interface PanneauCaisson { nom: string; min: V3; max: V3; corps: boolean; piece: boolean; role?: RolePanneau; entaille?: { prof: number; haut: number } }
export interface Quincaillerie { nom: string; qte: number }
export interface Caisson { panneaux: PanneauCaisson[]; quincaillerie: Quincaillerie[] }

export const CAISSON_DEFAUT: CaissonParams = {
  L: 1000, H: 2000, P: 500, e: 18, colonnes: 2, types: ['etageres', 'etageres'], etageres: 4,
  tiroirs: 3, hTiroir: 200, portes: false, jeu: 3, fond: 3, plinthe: 80, retrait: 20,
};

// Modèles de départ proposés dans le formulaire et aux assistants (outil MCP `creer_meuble`).
export const MODELES: { cle: string; nom: string; params: Partial<CaissonParams> }[] = [
  { cle: 'bibliotheque', nom: 'Bibliothèque', params: { L: 1000, H: 2000, P: 300, colonnes: 2, types: ['etageres', 'etageres'], etageres: 5, portes: false, plinthe: 60, fond: 3 } },
  { cle: 'dressing', nom: 'Dressing', params: { L: 2000, H: 2400, P: 600, colonnes: 3, types: ['penderie', 'tiroirs', 'etageres'], etageres: 5, tiroirs: 4, hTiroir: 200, portes: true, plinthe: 80, fond: 3 } },
  { cle: 'meuble_bas', nom: 'Meuble bas', params: { L: 800, H: 850, P: 560, colonnes: 1, types: ['etageres'], etageres: 1, portes: true, plinthe: 120, fond: 3 } },
  { cle: 'commode', nom: 'Commode', params: { L: 900, H: 900, P: 450, colonnes: 1, types: ['tiroirs'], tiroirs: 4, hTiroir: 170, etageres: 0, portes: false, plinthe: 60, fond: 3 } },
  { cle: 'etagere_murale', nom: 'Étagère murale', params: { L: 800, H: 300, P: 250, colonnes: 1, types: ['etageres'], etageres: 1, portes: false, plinthe: 0, fond: 0 } },
];

const JEU_COULISSE = 13;        // place d'une coulisse latérale, de chaque côté
const FOND_TIROIR = 8;          // épaisseur du fond de tiroir par défaut
const typeDe = (p: CaissonParams, c: number): TypeColonne => p.types[c] ?? 'etageres';
// Hauteurs de façade des tiroirs, de bas en haut.
export const hauteursTiroirs = (p: CaissonParams): number[] =>
  p.hTiroirs && p.hTiroirs.length ? p.hTiroirs : Array<number>(Math.max(0, Math.round(p.tiroirs))).fill(p.hTiroir);
// Les tiroirs remplissent toute la colonne (de la plinthe au dessus) : pas de tablette ni de porte au-dessus.
const colonnePleine = (p: CaissonParams) => hauteursTiroirs(p).reduce((a, b) => a + b, 0) >= p.H - p.plinthe - 1;

// Largeur intérieure de chaque colonne. `largeurs` sert de proportions : agrandir le meuble garde la répartition.
export function videsColonnes(p: CaissonParams): number[] {
  const n = Math.max(1, Math.round(p.colonnes));
  const total = p.L - (n + 1) * p.e;
  // façades égales : une colonne de rive porte aussi l'épaisseur de son côté, un montant se partage entre deux façades
  if (p.facadesEgales && n > 1 && !(p.largeurs && p.largeurs.length === n)) { const z = p.L / n; return Array.from({ length: n }, (_, c) => z - (c === 0 || c === n - 1 ? 1.5 : 1) * p.e); }
  const w = p.largeurs && p.largeurs.length === n && p.largeurs.every((x) => x > 0) ? p.largeurs : Array<number>(n).fill(1);
  const somme = w.reduce((a, b) => a + b, 0);
  return w.map((x) => (total * x) / somme);
}
// Décale le montant entre la colonne `c` et la suivante de `delta` mm (vers la droite si positif).
export function deplacerMontant(p: CaissonParams, c: number, delta: number): CaissonParams {
  const v = videsColonnes(p);
  if (c < 0 || c >= v.length - 1) return p;
  v[c] = v[c]! + delta; v[c + 1] = v[c + 1]! - delta;
  return { ...p, largeurs: v };
}
// Fixe la largeur intérieure d'une colonne ; la voisine de droite (ou de gauche pour la dernière) compense.
export function fixerLargeur(p: CaissonParams, c: number, largeur: number): CaissonParams {
  const v = videsColonnes(p);
  if (v.length < 2) return p;
  return c < v.length - 1 ? deplacerMontant(p, c, largeur - v[c]!) : deplacerMontant(p, c - 1, v[c]! - largeur);
}

export function verifier(p: CaissonParams): string | null {
  const n = Math.round(p.colonnes);
  if (!(p.e > 0) || !(p.L > 0) || !(p.H > 0) || !(p.P > 0)) return 'Les cotes doivent être positives.';
  if (n < 1 || n > 12) return 'Entre 1 et 12 colonnes.';
  if (p.etageres < 0 || p.etageres > 30) return 'Entre 0 et 30 étagères par colonne.';
  if (p.fond < 0 || p.plinthe < 0 || p.retrait < 0 || p.jeu < 0) return 'Fond, plinthe, jeu et retrait ne peuvent pas être négatifs.';
  if (p.largeurs && p.largeurs.length === n && p.largeurs.some((x) => !(x > 0))) return 'Colonne trop étroite : moins de 50 mm de vide.';
  const vides = videsColonnes(p);
  if (vides.some((v) => v < 50)) return 'Colonne trop étroite : moins de 50 mm de vide.';
  const hInt = p.H - p.plinthe - 2 * p.e;
  if (hInt < 50) return 'Hauteur intérieure trop faible.';
  if (p.P - p.retrait < 50) return 'Profondeur trop faible.';
  for (let c = 0; c < n; c++) {
    const t = typeDe(p, c), vide = vides[c]!;
    if (t === 'tiroirs' || t === 'penderie_tiroirs') {
      const hts = hauteursTiroirs(p), total = hts.reduce((a, b) => a + b, 0);
      if (hts.length < 1 || hts.length > 10) return 'Entre 1 et 10 tiroirs par colonne.';
      if (hts.some((h) => !(h >= 100))) return 'Façade de tiroir : 100 mm minimum.';
      if (total > p.H - p.plinthe + 1) return 'Les tiroirs dépassent la hauteur du caisson.';
      // colonne de tiroirs seuls remplie jusqu'en haut : permis avec `hTiroirs`
      const rempli = !!p.hTiroirs?.length && t === 'tiroirs' && colonnePleine(p);
      if (total > hInt - 100 && !rempli) return p.hTiroirs?.length ? 'Tiroirs : laisse au moins 100 mm au-dessus, ou remplis toute la hauteur (somme = hauteur − plinthe).' : 'Les tiroirs dépassent la hauteur du caisson.';
      if (vide - 2 * JEU_COULISSE < 2 * p.e + 50) return 'Colonne trop étroite pour un tiroir.';
      if (p.P < 270) return 'Profondeur trop faible pour des coulisses (270 mm minimum).';
    }
    if (t === 'penderie' && hInt < 1000) return 'Hauteur intérieure trop faible pour une penderie.';
    // penderie au-dessus des tiroirs : au moins 90 cm sous la tringle (vestes, chemises)
    if (t === 'penderie_tiroirs' && hInt - hauteursTiroirs(p).reduce((a, b) => a + b, 0) - 300 - 60 - p.e < 900) return 'Trop peu de hauteur pour pendre au-dessus des tiroirs (90 cm minimum) : moins de tiroirs ou des tiroirs moins hauts.';
  }
  if (p.dessus === 'traverses') {
    const w = p.largeurTraverse ?? 100;
    if (!(w >= 30) || w > p.P / 2 - 10) return 'Traverses : de 30 mm à la moitié de la profondeur.';
  }
  if (p.epFondTiroir !== undefined && !(p.epFondTiroir >= 3 && p.epFondTiroir <= 20)) return 'Fond de tiroir : de 3 à 20 mm.';
  if (p.retraitPlinthe !== undefined && (!(p.retraitPlinthe >= 0) || p.retraitPlinthe + p.e > p.P / 2)) return 'Retrait de plinthe trop grand.';
  return null;
}

export function genererCaisson(p: CaissonParams): Caisson {
  const err = verifier(p);
  if (err) throw new Error(err);
  const n = Math.round(p.colonnes), k = Math.round(p.etageres), hts = hauteursTiroirs(p), total = hts.reduce((a, b) => a + b, 0), FT = p.epFondTiroir ?? FOND_TIROIR;
  const panneaux: PanneauCaisson[] = [];
  const q = new Map<string, number>();
  const ajoute = (nom: string, qte: number) => q.set(nom, (q.get(nom) ?? 0) + qte);
  const box = (nom: string, min: V3, max: V3, corps = true, piece = true, role?: RolePanneau, entaille?: PanneauCaisson['entaille']) =>
    panneaux.push({ nom, min: min.map((v) => v / 1000) as V3, max: max.map((v) => v / 1000) as V3, corps, piece, ...(role ? { role } : {}), ...(entaille ? { entaille } : {}) });
  // Étagères mobiles à vides égaux entre zBas (dessus d'un panneau) et zHaut (dessous d'un panneau).
  const etageres = (x0: number, w: number, zBas: number, zHaut: number, nb: number) => {
    for (let i = 1; i <= nb; i++) {
      const z = zBas + (i * (zHaut - zBas + p.e)) / (nb + 1) - p.e;
      box('Étagère', [x0, p.retrait, z], [x0 + w, p.P, z + p.e]);
    }
    ajoute('Taquets', 4 * nb);
  };

  const zBas = p.plinthe, zHaut = p.H - p.e, z0 = zBas + p.e;
  // entailles : côtés et montants échancrés au pied (l'avant de la plinthe est à `rp`, elle s'y loge)
  const rp = p.retraitPlinthe ?? p.retrait;
  const entail = p.entailles && p.plinthe > 0 ? { prof: (rp + p.e) / 1000, haut: p.plinthe / 1000 } : undefined;
  box('Côté', [0, 0, 0], [p.e, p.P, p.H], true, true, undefined, entail);
  box('Côté', [p.L - p.e, 0, 0], [p.L, p.P, p.H], true, true, undefined, entail);
  // horizontales : d'un côté à l'autre, ou d'un montant à l'autre quand les montants sont pleine hauteur
  const vides0 = videsColonnes(p);
  const travees: [number, number][] = p.montantsPleins
    ? vides0.map((v, c) => { const a = p.e + vides0.slice(0, c).reduce((t, x) => t + x + p.e, 0); return [a, a + v]; })
    : [[p.e, p.L - p.e]];
  const wt = p.largeurTraverse ?? 100;
  for (const [a, b] of travees) {
    if (p.dessus === 'traverses') {
      box('Traverse haute', [a, 0, zHaut], [b, wt, p.H]);
      box('Traverse haute', [a, p.P - wt, zHaut], [b, p.P, p.H]);
    } else box('Dessus', [a, 0, zHaut], [b, p.P, p.H]);
    box('Dessous', [a, 0, zBas], [b, p.P, z0]);
    if (p.plinthe > 0 && !entail) box('Plinthe', [a, rp, 0], [b, rp + p.e, p.plinthe]);
  }
  if (entail) box('Plinthe', [p.e, rp, 0], [p.L - p.e, rp + p.e, p.plinthe]);   // une seule plinthe sur toute la largeur
  if (p.fond > 0 && !(p.fondParColonne && n > 1)) box('Fond', [0, p.P, zBas], [p.L, p.P + p.fond, p.H], false);

  const vides = videsColonnes(p);
  const prof = Math.min(600, Math.floor((p.P - 20) / 50) * 50);   // longueur de coulisse standard
  let x0 = p.e;
  for (let c = 0; c < n; c++) {
    if (c > 0) x0 += vides[c - 1]! + p.e;
    const vide = vides[c]!;
    if (p.fond > 0 && p.fondParColonne && n > 1) box('Fond', [c === 0 ? 0 : x0 - p.e / 2, p.P, zBas], [c === n - 1 ? p.L : x0 + vide + p.e / 2, p.P + p.fond, p.H], false);
    if (c > 0) box('Montant', [x0 - p.e, 0, p.montantsPleins ? 0 : z0], [x0, p.P, p.montantsPleins ? p.H : zHaut], true, true, undefined, p.montantsPleins ? entail : undefined);
    // zone de façade en applique : jusqu'au milieu des montants, jusqu'au bord extérieur des côtés
    const fg = c === 0 ? 0 : x0 - p.e / 2, fd = c === n - 1 ? p.L : x0 + vide + p.e / 2;
    const portes = (zA: number, zB: number) => {
      if (!p.portes) return;
      // demi-jeu en bord de zone, jeu complet entre deux portes : même écart partout entre façades voisines
      // deux portes au-delà de 600 mm de façade ; 10 mm de tolérance : la dernière colonne compte l'épaisseur du côté en plus (603 mm pour trois colonnes de 600)
      const nb = fd - fg > 610 ? 2 : 1, w = (fd - fg - nb * p.jeu) / nb;
      // charnières vers l'extérieur du meuble : porte de gauche à gauche, porte de droite (ou seule porte de la dernière colonne) à droite
      for (let i = 0; i < nb; i++) {
        const x = fg + p.jeu / 2 + i * (w + p.jeu);
        box('Porte', [x, -p.e, zA + p.jeu / 2], [x + w, 0, zB - p.jeu / 2], true, true, { type: 'porte', cle: `porte:${c}:${i}`, charnieres: i === 1 || (nb === 1 && n > 1 && c === n - 1) ? 'droite' : 'gauche' });
      }
    };
    const t = typeDe(p, c);
    if (t === 'etageres') {
      etageres(x0, vide, z0, zHaut, k);
      portes(zBas, p.H);
    } else if (t === 'penderie') {
      const zChapeau = zHaut - 300 - p.e;                     // étagère haute, 300 mm de rangement au-dessus
      box('Étagère', [x0, p.retrait, zChapeau], [x0 + vide, p.P, zChapeau + p.e]);
      ajoute('Taquets', 4);
      const zt = zChapeau - 60;
      box('Tringle', [x0 + 5, p.P / 2 - 10, zt - 10], [x0 + vide - 5, p.P / 2 + 10, zt + 10], false, false);
      ajoute(`Tringle ${Math.round(vide - 10)} mm`, 1);
      ajoute('Supports de tringle', 2);
      portes(zBas, p.H);
    } else {
      const W = vide - 2 * JEU_COULISSE;
      let zf = zBas;
      for (let i = 0; i < hts.length; i++) {
        const h = hts[i]!;
        const cle = `tiroir:${c}:${i}`, role = (facade: boolean): RolePanneau => ({ type: 'tiroir', cle, facade, coulisse: prof });
        box('Façade tiroir', [fg + p.jeu / 2, -p.e, zf + p.jeu / 2], [fd - p.jeu / 2, 0, zf + h - p.jeu / 2], true, true, role(true));
        const xb = x0 + JEU_COULISSE, zb = zf + p.e + 5;
        box('Fond tiroir', [xb, 2, zb], [xb + W, 2 + prof, zb + FT], false, true, role(false));
        const zc = zb + FT;
        const hb = Math.min(h - 40 - FT, zHaut - 2 - zc);   // sous le dessus quand les tiroirs montent jusqu'en haut
        zf += h;
        box('Côté tiroir', [xb, 2, zc], [xb + p.e, 2 + prof, zc + hb], true, true, role(false));
        box('Côté tiroir', [xb + W - p.e, 2, zc], [xb + W, 2 + prof, zc + hb], true, true, role(false));
        box('Avant tiroir', [xb + p.e, 2, zc], [xb + W - p.e, 2 + p.e, zc + hb], true, true, role(false));
        box('Arrière tiroir', [xb + p.e, 2 + prof - p.e, zc], [xb + W - p.e, 2 + prof, zc + hb], true, true, role(false));
      }
      // tablette fixe au-dessus des tiroirs, puis étagères et éventuellement une porte au-dessus
      const pleine = colonnePleine(p);
      const zTab = z0 + total - p.e;
      if (!pleine) box('Tablette', [x0, 0, zTab], [x0 + vide, p.P, zTab + p.e]);
      if (t === 'penderie_tiroirs') {
        // étagère haute à 300 mm sous le dessus, tringle 60 mm dessous
        const zChapeau = zHaut - 300 - p.e;
        box('Étagère', [x0, p.retrait, zChapeau], [x0 + vide, p.P, zChapeau + p.e]);
        ajoute('Taquets', 4);
        const zt = zChapeau - 60;
        box('Tringle', [x0 + 5, p.P / 2 - 10, zt - 10], [x0 + vide - 5, p.P / 2 + 10, zt + 10], false, false);
        ajoute(`Tringle ${Math.round(vide - 10)} mm`, 1);
        ajoute('Supports de tringle', 2);
      } else if (!pleine && zHaut - (zTab + p.e) > 200) etageres(x0, vide, zTab + p.e, zHaut, Math.min(k, Math.floor((zHaut - zTab) / 250)));
      if (!pleine && p.H - (zBas + total) > 150) portes(zBas + total, p.H);
    }
  }
  return { panneaux, quincaillerie: [...q].filter(([, v]) => v > 0).map(([nom, qte]) => ({ nom, qte })) };
}

// Maillage d'un panneau de caisson, `origine` en m : un pavé, ou un prisme quand l'angle avant-bas est entaillé.
export function maillePanneau(p: PanneauCaisson, origine: V3): MeshData {
  const lo = p.min.map((v, k) => v + origine[k]!) as V3, hi = p.max.map((v, k) => v + origine[k]!) as V3;
  if (!p.entaille) return boxMesh(lo, hi);
  const { prof, haut } = p.entaille;
  // profil dans le plan (y, z), extrudé sur l'épaisseur en x
  return prismMesh(0, [[lo[1] + prof, lo[2]], [hi[1], lo[2]], [hi[1], hi[2]], [lo[1], hi[2]], [lo[1], lo[2] + haut], [lo[1] + prof, lo[2] + haut]], lo[0], hi[0]);
}
