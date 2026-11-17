// Décors : aspect d'un matériau à l'écran (veinage, lames, plis du contreplaqué). Affichage seulement :
// rien ne change dans la fiche de débit ni dans la découpe.
// Ici, la partie sans rendu : choix du décor et coordonnées de texture en mètres réels, le fil suivant la pièce.
import { materiauDe, type Doc, type MeshData, type PieceMeta, type Solid } from './model';

export type Decor = 'uni' | 'bois' | 'lamelle' | 'contreplaque' | 'mdf' | 'tissu';
export const DECORS: { cle: Decor; nom: string }[] = [
  { cle: 'uni', nom: 'Uni (peint, mélaminé)' },
  { cle: 'bois', nom: 'Bois massif' },
  { cle: 'lamelle', nom: 'Lamellé-collé' },
  { cle: 'contreplaque', nom: 'Contreplaqué' },
  { cle: 'mdf', nom: 'MDF brut' },
  { cle: 'tissu', nom: 'Tissu (meuble importé)' },
];
export const estDecor = (x: unknown): x is Decor => DECORS.some((d) => d.cle === x);

// Décor deviné d'après le nom, quand le matériau n'en choisit pas : « Hêtre lamellé-collé » → lames, « MDF peint » → uni.
export function decorParNom(nom: string): Decor {
  const n = nom.toLowerCase();
  if (/tissu|velours|bouclette|canap|fauteuil/.test(n)) return 'tissu';
  if (/peint|(^|[\s-])laqu|m[ée]lamin|blanc|noir|gris|anthracite/.test(n)) return 'uni';
  if (/lamell/.test(n)) return 'lamelle';
  if (/contreplaqu|ctp|multipli|plywood/.test(n)) return 'contreplaque';
  if (/mdf|medium|hdf/.test(n)) return 'mdf';
  if (/massif|ch[eê]ne|h[eê]tre|pin\b|sapin|noyer|fr[eê]ne|bois|tablette|plan de travail/.test(n)) return 'bois';
  return 'uni';
}
export function decorDe(d: Doc, s: Solid): Decor {
  const m = materiauDe(d, s);
  return m?.decor ?? decorParNom(m?.nom || s.meta.matiere);
}

// Taille d'un motif (m) : u le long du fil, v en travers. Les chants ont leur propre motif (plis du contreplaqué).
export interface Motif { u: number; v: number }

// Géométrie « à plat » (sommets non partagés) avec coordonnées de texture. Les faces (parements) d'abord, puis les chants,
// pour deux matériaux. `ordre[i]` : triangle d'origine du triangle i (la sélection de face en dépend).
export function uvDecor(m: MeshData, fil: PieceMeta['fil'], face: Motif, chant: Motif, graine: number): { pos: number[]; uv: number[]; nFaces: number; ordre: number[] } {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.v.length; i++) { const k = i % 3; lo[k] = Math.min(lo[k]!, m.v[i]!); hi[k] = Math.max(hi[k]!, m.v[i]!); }
  const dim = [0, 1, 2].map((k) => hi[k]! - lo[k]!);
  const ep = dim.indexOf(Math.min(...dim));               // épaisseur : la plus petite cote
  // décalage propre à chaque pièce, pour que deux pièces voisines n'aient pas le même dessin
  const r = (x: number) => { const s = Math.sin(graine * 12.9898 + x * 78.233) * 43758.5453; return s - Math.floor(s); };
  const du = r(1), dv = r(2);
  const faces: { pos: number[]; uv: number[]; ordre: number[] } = { pos: [], uv: [], ordre: [] }, chants: typeof faces = { pos: [], uv: [], ordre: [] };
  const p = (i: number) => [m.v[3 * i]!, m.v[3 * i + 1]!, m.v[3 * i + 2]!];
  for (let t = 0; t < m.t.length / 3; t++) {
    const a = p(m.t[3 * t]!), b = p(m.t[3 * t + 1]!), c = p(m.t[3 * t + 2]!);
    const e1 = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], e2 = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
    const n = [Math.abs(e1[1]! * e2[2]! - e1[2]! * e2[1]!), Math.abs(e1[2]! * e2[0]! - e1[0]! * e2[2]!), Math.abs(e1[0]! * e2[1]! - e1[1]! * e2[0]!)];
    const k = n.indexOf(Math.max(...n));                    // axe de la normale
    const autres = [0, 1, 2].filter((x) => x !== k);
    let fu: number, fv: number, motif: Motif, cible: typeof faces;
    if (k === ep) {
      // parement : le fil suit la longueur de la pièce (ou sa largeur si fil = « l »)
      const long = dim[autres[0]!]! >= dim[autres[1]!]! ? autres[0]! : autres[1]!, court = long === autres[0] ? autres[1]! : autres[0]!;
      [fu, fv] = fil === 'l' ? [court, long] : [long, court];
      motif = face; cible = faces;
    } else {
      // chant : le motif court le long du chant, les plis se lisent dans l'épaisseur
      fu = autres.find((x) => x !== ep) ?? autres[0]!; fv = ep;
      motif = chant; cible = chants;
    }
    for (const q of [a, b, c]) {
      cible.pos.push(q[0]!, q[1]!, q[2]!);
      cible.uv.push(q[fu]! / motif.u + du, q[fv]! / motif.v + dv);
    }
    cible.ordre.push(t);
  }
  return { pos: [...faces.pos, ...chants.pos], uv: [...faces.uv, ...chants.uv], nFaces: faces.pos.length / 3, ordre: [...faces.ordre, ...chants.ordre] };
}
