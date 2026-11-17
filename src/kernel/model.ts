import type { Element } from './elements';
import type { Plafond } from './plafond';
import Module from 'manifold-3d';
import type { CaissonParams } from './cabinet';
import { arrange, polyArea, pointInPoly, regionAt, EPS, type P2, type Region, type Seg2 } from './arrangement';
import type { Decor } from './decor';

// ───────── Maths 3D minimales ─────────
export type V3 = [number, number, number];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ───────── Plan de dessin ─────────
export interface Plane { o: V3; u: V3; v: V3; n: V3 }

export function planeFromNormal(o: V3, nIn: V3): Plane {
  const n = norm(nIn);
  const helper: V3 = Math.abs(n[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1];
  const u = norm(cross(helper, n));
  const v = cross(n, u);
  return { o, u, v, n };
}
export const to2 = (P: Plane, p: V3): P2 => { const d = sub(p, P.o); return [dot(d, P.u), dot(d, P.v)]; };
export const to3 = (P: Plane, p: P2): V3 => add(add(P.o, mul(P.u, p[0])), mul(P.v, p[1]));
export function samePlane(a: Plane, b: Plane): boolean {
  return Math.abs(Math.abs(dot(a.n, b.n)) - 1) < 1e-7 && Math.abs(dot(b.n, sub(a.o, b.o))) < 1e-5;
}

// ───────── Document ─────────
export interface MeshData { v: number[]; t: number[] }
// Méthode de fabrication : un préréglage (matière, chant, côtés plaqués) appliqué à des pièces.
// `cotes` liste les côtés plaqués par défaut parmi L1 L2 (grands côtés) et l1 l2 (petits côtés).
// Matériau : panneau acheté (`matiere`, nom du stock) et sa couleur, la même sur les faces et les chants (`couleur`, #rrggbb).
// `decor` : aspect à l'écran (veinage, lames…) ; absent = deviné d'après le nom (src/kernel/decor.ts).
export interface Materiau { id: number; nom: string; matiere: string; chant: string; chantEp: number; cotes: string; deduire: boolean; chantPrix?: number; couleur?: string; decor?: Decor }
// Panneau du stock (mm, €). `qte` = panneaux ou chutes déjà en atelier ; `prix` = prix d'achat d'un panneau neuf (0 = on n'en rachète pas).
export interface Panneau { id: number; matiere: string; e: number; L: number; l: number; qte: number; prix: number; chute?: boolean }
// Ligne de construction (guide) : droite infinie passant par `p`, de direction `d` (unitaire).
export interface Guide { id: number; p: V3; d: V3 }
// `auto` : ligne calculée depuis les portes et tiroirs identifiés (src/kernel/elements.ts), recalculée à chaque modification.
export interface Extra { id: number; nom: string; qte: number; prix: number; caisson?: number; auto?: boolean }
// Caisson généré : ses paramètres sont gardés pour pouvoir le modifier et le regénérer.
// `fond` : matière du fond du meuble (et des fonds de tiroir, sauf `fondTiroir`).
// `facade` : matière des façades de portes et de tiroirs ; `caisseTiroir` : celle des côtés, devants et arrières de tiroir (sinon, celle du meuble).
export interface CaissonRec { id: number; params: CaissonParams; methode: number; fond?: string; fondTiroir?: string; facade?: string; caisseTiroir?: string }
export interface MatieresCaisson { fondTiroir?: string; facade?: string; caisseTiroir?: string }
// `decouper` : une pièce plus grande que tous les panneaux est coupée en morceaux à assembler.
export interface Reglages { trait: number; marge: number; decouper?: boolean }
export const REGLAGES_DEFAUT: Reglages = { trait: 3, marge: 10, decouper: true };
// `methode` : id de la méthode appliquée. `chants` : côtés plaqués propres à la pièce (sinon ceux de la méthode).
// `masque` : pièce cachée à l'écran (outils, accroches et sélection l'ignorent) ; elle reste dans la fiche et les exports.
export interface PieceMeta { piece: boolean; matiere: string; fil: 'L' | 'l' | 'aucun'; note: string; methode?: number; chants?: string; caisson?: number; masque?: boolean }
// Composant : les solides de même `comp.id` partagent une forme. `r` (3x3, par lignes) et `t`
// placent la forme commune dans le monde : monde = r · local + t.
export interface CompLink { id: number; r: number[]; t: V3 }
export interface Solid { id: number; name: string; mesh: MeshData; meta: PieceMeta; comp?: CompLink }
export interface Sketch { id: number; plane: Plane; segs: Seg2[] }
// Notice de montage : étapes dans l'ordre, chacune avec les pièces qu'elle concerne (montrées dans la 3D).
export interface Etape { titre: string; texte: string; ids?: number[] }
export interface Doc { next: number; solids: Solid[]; sketches: Sketch[]; methods?: Materiau[]; stock?: Panneau[]; extras?: Extra[]; reglages?: Reglages; caissons?: CaissonRec[]; guides?: Guide[]; elements?: Element[]; plafond?: Plafond; notice?: Etape[] }

export const emptyDoc = (): Doc => ({ next: 1, solids: [], sketches: [], methods: [] });
export const SIDES = ['L1', 'L2', 'l1', 'l2'] as const;
export const parseSides = (s: string): string[] => SIDES.filter((k) => s.split(/[\s,;]+/).includes(k));
export const materiauDe = (doc: Doc, s: Solid): Materiau | undefined => (doc.methods ?? []).find((m) => m.id === s.meta.methode);
// Côtés plaqués d'une pièce : son propre réglage, sinon celui de sa méthode.
export const sidesOf = (doc: Doc, s: Solid): string[] => parseSides(s.meta.chants ?? materiauDe(doc, s)?.cotes ?? '');
export const visibles = (d: Doc): Solid[] => d.solids.filter((s) => !s.meta.masque);
// Couleur d'une pièce (#rrggbb) : celle de son matériau, sinon déduite du nom de la matière.
export const couleurDe = (d: Doc, s: Solid): string => materiauDe(d, s)?.couleur || couleurParNom(materiauDe(d, s)?.nom || s.meta.matiere);
export function couleurParNom(nom: string): string {
  const n = nom.toLowerCase();
  const table: [RegExp, string][] = [
    [/blanc|white/, '#f2f2ee'], [/noir|black/, '#2b2b2d'], [/anthracite/, '#46494d'], [/gris|grey|gray/, '#9a9c9e'],
    [/ch[eê]ne|oak/, '#c69f6b'], [/noyer|walnut/, '#6e4c33'], [/h[eê]tre|beech/, '#dcb489'], [/pin|sapin|pine/, '#e5c690'],
    [/hdf/, '#8c6c4c'], [/mdf|medium/, '#b8a07c'], [/contreplaqu|plywood|ctp|bouleau/, '#e0c9a0'], [/agglo/, '#c9b38a'],
  ];
  return table.find(([r]) => r.test(n))?.[1] ?? '#e9d6ab';
}
// Retrouve un matériau par son nom ou par sa matière, ou le crée avec la couleur que suggère son nom.
// Mélaminé : chant assorti de 1 mm sur le grand côté avant. Autres panneaux (MDF, contreplaqué…) : sans chant.
export function materiauNomme(d: Doc, nom: string): number {
  const n = nom.trim();
  if (!n) return 0;
  d.methods ??= [];
  const m = d.methods.find((x) => x.nom.toLowerCase() === n.toLowerCase() || x.matiere.toLowerCase() === n.toLowerCase());
  if (m) return m.id;
  const id = d.next++, mela = /m[ée]lamin/i.test(n);
  d.methods.push({ id, nom: n, matiere: n, chant: mela ? 'ABS 1 mm' : '', chantEp: mela ? 1 : 0, cotes: mela ? 'L1' : '', deduire: false, couleur: couleurParNom(n) });
  return id;
}
export const cloneDoc = (d: Doc): Doc => JSON.parse(JSON.stringify(d)) as Doc;
// Un meuble dont toutes les pièces ont été supprimées disparaît, avec sa quincaillerie (sinon elle reste chiffrée).
export function sansMeublesVides(d: Doc): Doc {
  const vides = new Set((d.caissons ?? []).filter((r) => !d.solids.some((s) => s.meta.caisson === r.id)).map((r) => r.id));
  if (!vides.size) return d;
  return { ...d, caissons: d.caissons!.filter((r) => !vides.has(r.id)), extras: (d.extras ?? []).filter((x) => x.caisson === undefined || !vides.has(x.caisson)) };
}

// ───────── manifold ─────────
type Wasm = Awaited<ReturnType<typeof Module>>;
let W: Wasm;
export async function initKernel(locateFile?: () => string): Promise<void> {
  if (W) return;
  W = locateFile ? await Module({ locateFile }) : await Module();
  W.setup();
}

type Manifold = InstanceType<Wasm['Manifold']>;

function toManifold(m: MeshData): Manifold {
  const mesh = new W.Mesh({ numProp: 3, vertProperties: new Float32Array(m.v), triVerts: new Uint32Array(m.t) });
  return W.Manifold.ofMesh(mesh);
}
function toMeshData(m: Manifold): MeshData {
  const mesh = m.getMesh();
  return { v: Array.from(mesh.vertProperties), t: Array.from(mesh.triVerts) };
}
export function boxMesh(min: V3, max: V3): MeshData {
  const s: V3 = sub(max, min);
  return toMeshData(W.Manifold.cube(s, false).translate(min));
}
// Prisme droit : `profil` est un polygone dans le plan des deux autres axes, pris dans l'ordre x, y, z
// (axe x : points (y, z) ; axe y : (x, z) ; axe z : (x, y)), extrudé de `de` à `a` le long de `axe`.
// Sert aux pièces coupées en biais : côtés de sous-pente, rampants, portes.
export function prismMesh(axe: 0 | 1 | 2, profil: P2[], de: number, a: number): MeshData {
  const E = (k: number): V3 => [0, 1, 2].map((m) => (m === k ? 1 : 0)) as V3;
  const [i, j] = axe === 0 ? [1, 2] : axe === 1 ? [0, 2] : [0, 1];
  const u = E(i!), n = E(axe), v = cross(n, u), sv = dot(v, E(j!));   // repère direct (u, v, n)
  let pts = profil.map((p): [number, number] => [p[0], sv * p[1]]);
  if (polyArea(pts) < 0) pts = pts.reverse();
  const o = mul(n, Math.min(de, a));
  const mat = [u[0], u[1], u[2], 0, v[0], v[1], v[2], 0, n[0], n[1], n[2], 0, o[0], o[1], o[2], 1];
  return toMeshData(W.Manifold.extrude(W.CrossSection.ofPolygons([pts], 'Positive'), Math.abs(a - de)).transform(mat as never));
}
// Volume commun de deux pièces (m³) : 0 si elles se touchent seulement.
export function volumeCommun(a: MeshData, b: MeshData): number { return toManifold(a).intersect(toManifold(b)).volume(); }
export function volumeOf(m: MeshData): number { return toManifold(m).volume(); }
// Pièce fermée et sans défaut (utilisable par Pousser/Tirer) ? Une géométrie importée ne l'est pas toujours.
export function estManifold(m: MeshData): boolean {
  if (!m.t.length) return false;
  try { const x = toManifold(m); return !x.isEmpty() && x.status() === 'NoError'; } catch { return false; }
}

// ───────── Faces planes d'un solide ─────────
export interface PlanarFace { n: V3; d: number; loops: V3[][]; tris: number[] }
const faceCache = new WeakMap<MeshData, PlanarFace[]>();

export function planarFaces(mesh: MeshData): PlanarFace[] {
  const hit = faceCache.get(mesh);
  if (hit) return hit;
  const { v, t } = mesh;
  const P = (i: number): V3 => [v[3 * i]!, v[3 * i + 1]!, v[3 * i + 2]!];
  const nT = t.length / 3;
  const normals: (V3 | null)[] = [];
  const offs: number[] = [];
  for (let i = 0; i < nT; i++) {
    const a = P(t[3 * i]!), b = P(t[3 * i + 1]!), c = P(t[3 * i + 2]!);
    const n = cross(sub(b, a), sub(c, a));
    if (len(n) < 1e-12) { normals.push(null); offs.push(0); continue; }
    const nn = norm(n);
    normals.push(nn); offs.push(dot(nn, a));
  }
  const parent = Array.from({ length: nT }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  const edge = new Map<string, number>();
  for (let i = 0; i < nT; i++) for (let k = 0; k < 3; k++) edge.set(`${t[3 * i + k]}>${t[3 * i + ((k + 1) % 3)]}`, i);
  const coplanar = (i: number, j: number) => {
    const a = normals[i], b = normals[j];
    return !!a && !!b && dot(a, b) > 1 - 1e-7 && Math.abs(offs[i]! - offs[j]!) < 1e-5;
  };
  for (let i = 0; i < nT; i++) for (let k = 0; k < 3; k++) {
    const j = edge.get(`${t[3 * i + ((k + 1) % 3)]}>${t[3 * i + k]}`);
    if (j !== undefined && coplanar(i, j)) parent[find(i)] = find(j);
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < nT; i++) if (normals[i]) { const r = find(i); (groups.get(r) ?? groups.set(r, []).get(r)!).push(i); }

  const faces: PlanarFace[] = [];
  for (const tris of groups.values()) {
    const inGroup = new Set(tris);
    const next = new Map<number, number[]>();
    for (const i of tris) for (let k = 0; k < 3; k++) {
      const a = t[3 * i + k]!, b = t[3 * i + ((k + 1) % 3)]!;
      const rev = edge.get(`${b}>${a}`);
      if (rev !== undefined && inGroup.has(rev)) continue;
      (next.get(a) ?? next.set(a, []).get(a)!).push(b);
    }
    const loops: V3[][] = [];
    for (const [start] of next) {
      while (next.get(start)?.length) {
        const ids = [start];
        let cur = start;
        for (let g = 0; g < 100000; g++) {
          const outs = next.get(cur);
          const nx = outs?.shift();
          if (nx === undefined) break;
          if (nx === start) break;
          ids.push(nx); cur = nx;
        }
        if (ids.length >= 3) loops.push(simplifyLoop(ids.map(P)));
      }
    }
    const n = normals[tris[0]!]!;
    faces.push({ n, d: offs[tris[0]!]!, loops: loops.filter((l) => l.length >= 3), tris });
  }
  faceCache.set(mesh, faces);
  return faces;
}

function simplifyLoop(pts: V3[]): V3[] {
  let out = pts;
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length]!, b = out[i]!, c = out[(i + 1) % out.length]!;
      const ab = sub(b, a), bc = sub(c, b);
      if (len(cross(ab, bc)) < 1e-9 * Math.max(1e-9, len(ab) * len(bc)) * 1e3 && dot(ab, bc) > 0) {
        out = out.filter((_, k) => k !== i); changed = true; break;
      }
    }
  }
  return out;
}

export function faceContains(F: PlanarFace, P: Plane, p: P2): boolean {
  let c = 0;
  for (const l of F.loops) if (pointInPoly(p, l.map((q) => to2(P, q)))) c++;
  return c % 2 === 1;
}

// ───────── Croquis et régions ─────────
function toSegs2(F: PlanarFace, P: Plane): Seg2[] {
  const out: Seg2[] = [];
  for (const l of F.loops) for (let i = 0; i < l.length; i++) out.push([to2(P, l[i]!), to2(P, l[(i + 1) % l.length]!)]);
  return out;
}

export function planeSegments(doc: Doc, P: Plane): Seg2[] {
  const segs: Seg2[] = [];
  for (const s of doc.sketches) {
    if (!samePlane(s.plane, P)) continue;
    for (const [a, b] of s.segs) segs.push([to2(P, to3(s.plane, a)), to2(P, to3(s.plane, b))]);
  }
  for (const so of doc.solids) for (const F of planarFaces(so.mesh)) {
    if (Math.abs(Math.abs(dot(F.n, P.n)) - 1) > 1e-7 || Math.abs(dot(P.n, F.loops[0]![0]!) - dot(P.n, P.o)) > 1e-5) continue;
    segs.push(...toSegs2(F, P));
  }
  return segs;
}

export const planeRegions = (doc: Doc, P: Plane): Region[] => arrange(planeSegments(doc, P));

export function addSegments(doc: Doc, P: Plane, segs: Seg2[]): void {
  let sk = doc.sketches.find((s) => samePlane(s.plane, P));
  if (!sk) { sk = { id: doc.next++, plane: P, segs: [] }; doc.sketches.push(sk); }
  for (const [a, b] of segs) sk.segs.push([to2(sk.plane, to3(P, a)), to2(sk.plane, to3(P, b))]);
}

function interiorPoint(r: Region): P2 {
  const loops = [r.outer, ...r.holes];
  const ys = r.outer.map((p) => p[1]);
  const y = (Math.min(...ys) + Math.max(...ys)) / 2 + 1.234e-4;
  const xs: number[] = [];
  for (const l of loops) for (let i = 0; i < l.length; i++) {
    const a = l[i]!, b = l[(i + 1) % l.length]!;
    if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
  }
  xs.sort((p, q) => p - q);
  return [((xs[0] ?? 0) + (xs[1] ?? 0)) / 2, y];
}

const onBoundary = (p: P2, loops: P2[][]) => loops.some((l) => l.some((a, i) => {
  const b = l[(i + 1) % l.length]!;
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
  if (L < EPS) return false;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L;
  return t >= -EPS && t <= L + EPS && Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L < EPS;
}));

// ───────── Pousser/Tirer ─────────
export interface PushPullResult { doc: Doc; solidId: number }

// d > 0 : vers la normale du plan de dessin P ; d < 0 : à l'opposé.
export function pushPullRegion(docIn: Doc, P: Plane, p2: P2, d: number): PushPullResult | null {
  if (Math.abs(d) < 1e-4) return null;
  const region = regionAt(planeRegions(docIn, P), p2);
  if (!region) return null;
  const doc = cloneDoc(docIn);

  const dir = d > 0 ? 1 : -1;
  const h = Math.abs(d);
  // Prisme : polygone (x, ±y) extrudé le long de ±n.
  const sgn = dir;
  const contours = [region.outer, ...region.holes].map((l) => l.map((p): [number, number] => [p[0], sgn * p[1]]));
  const cs = W.CrossSection.ofPolygons(contours, 'EvenOdd');
  const u = P.u, v = mul(P.v, sgn), n = mul(P.n, sgn);
  // matrice 4x4 colonne-major : colonnes u, v, n, o
  const mat = [u[0], u[1], u[2], 0, v[0], v[1], v[2], 0, n[0], n[1], n[2], 0, P.o[0], P.o[1], P.o[2], 1];
  const prism = W.Manifold.extrude(cs, h).transform(mat as never);

  // Solide sous la région ?
  const ip = interiorPoint(region);
  let target: { solid: Solid; n: V3 } | null = null;
  for (const so of doc.solids) {
    for (const F of planarFaces(so.mesh)) {
      if (Math.abs(Math.abs(dot(F.n, P.n)) - 1) > 1e-7 || Math.abs(dot(P.n, F.loops[0]![0]!) - dot(P.n, P.o)) > 1e-5) continue;
      if (faceContains(F, P, ip)) { target = { solid: so, n: F.n }; break; }
    }
    if (target) break;
  }

  let result: Manifold;
  let solidId: number;
  if (target) {
    let base: Manifold;
    try { base = toManifold(target.solid.mesh); } catch { return null; }   // géométrie importée non fermée
    const outward = dot(target.n, P.n) > 0 ? dir : -dir;
    result = outward > 0 ? base.add(prism) : base.subtract(prism);
    solidId = target.solid.id;
  } else {
    result = prism;
    solidId = doc.next++;
  }
  if (result.isEmpty()) return null;

  // Un résultat en plusieurs morceaux devient plusieurs solides.
  const parts = result.decompose();
  const meshes = parts.map(toMeshData);
  if (target) {
    target.solid.mesh = meshes[0]!;
    for (const m of meshes.slice(1)) {
      doc.solids.push({ id: doc.next++, name: `${target.solid.name} (suite)`, mesh: m, meta: { ...target.solid.meta } });
    }
  } else {
    doc.solids.push({ id: solidId, name: `Pièce ${solidId}`, mesh: meshes[0]!, meta: { piece: true, matiere: '', fil: 'aucun', note: '' } });
    for (const m of meshes.slice(1)) doc.solids.push({ id: doc.next++, name: `Pièce ${doc.next}`, mesh: m, meta: { piece: true, matiere: '', fil: 'aucun', note: '' } });
  }

  // Les traits consommés (frontière de la région) quittent le croquis.
  const loops = [region.outer, ...region.holes];
  for (const sk of doc.sketches) {
    if (!samePlane(sk.plane, P)) continue;
    const segs2: Seg2[] = sk.segs.map(([a, b]) => [to2(P, to3(sk.plane, a)), to2(P, to3(sk.plane, b))]);
    const kept: Seg2[] = [];
    for (const [a, b] of splitSegments(segs2)) {
      const mid: P2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (!(onBoundary(a, loops) && onBoundary(b, loops) && onBoundary(mid, loops))) kept.push([to2(sk.plane, to3(P, a)), to2(sk.plane, to3(P, b))]);
    }
    sk.segs = kept;
  }
  doc.sketches = doc.sketches.filter((s) => s.segs.length > 0);
  propagate(doc, solidId);
  return { doc, solidId };
}

// Découpe les segments à leurs intersections (réutilise arrange pour rester cohérent).
export function splitSegments(segs: Seg2[]): Seg2[] {
  const out: Seg2[] = [];
  for (let i = 0; i < segs.length; i++) {
    const [a, b] = segs[i]!;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < EPS) continue;
    const ts = [0, 1];
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    for (let j = 0; j < segs.length; j++) {
      if (i === j) continue;
      for (const q of segs[j]!) {
        const t = (q[0] - a[0]) * ux + (q[1] - a[1]) * uy;
        const off = Math.abs((q[0] - a[0]) * uy - (q[1] - a[1]) * ux);
        if (off < EPS && t > EPS && t < L - EPS) ts.push(t / L);
      }
      const [c, d] = segs[j]!;
      const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
      const den = rx * sy - ry * sx;
      if (Math.abs(den) > 1e-12) {
        const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den;
        const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
        if (t > EPS / L && t < 1 - EPS / L && u > -1e-9 && u < 1 + 1e-9) ts.push(t);
      }
    }
    ts.sort((x, y) => x - y);
    for (let k = 0; k + 1 < ts.length; k++) {
      if ((ts[k + 1]! - ts[k]!) * L < EPS) continue;
      out.push([[a[0] + (b[0] - a[0]) * ts[k]!, a[1] + (b[1] - a[1]) * ts[k]!], [a[0] + (b[0] - a[0]) * ts[k + 1]!, a[1] + (b[1] - a[1]) * ts[k + 1]!]]);
    }
  }
  return out;
}

export { polyArea };

// La région repose-t-elle sur une face de solide ? (sert à ne pas dessiner une fausse face par-dessus)
export function regionOnSolid(doc: Doc, P: Plane, r: Region): boolean {
  const ip = interiorPoint(r);
  for (const so of doc.solids) for (const F of planarFaces(so.mesh)) {
    if (Math.abs(Math.abs(dot(F.n, P.n)) - 1) > 1e-7 || Math.abs(dot(P.n, F.loops[0]![0]!) - dot(P.n, P.o)) > 1e-5) continue;
    if (faceContains(F, P, ip)) return true;
  }
  return false;
}

// ───────── Transformations directes (sans passer par manifold) ─────────
export function translateMesh(m: MeshData, d: V3): MeshData {
  return { t: m.t, v: m.v.map((x, i) => x + d[i % 3]!) };
}
export function rotateMesh(m: MeshData, center: V3, axis: V3, angle: number): MeshData {
  const k = norm(axis), c = Math.cos(angle), s = Math.sin(angle);
  const v: number[] = [];
  for (let i = 0; i < m.v.length; i += 3) {
    const p = sub([m.v[i]!, m.v[i + 1]!, m.v[i + 2]!], center);
    const r = add(add(mul(p, c), mul(cross(k, p), s)), mul(k, dot(k, p) * (1 - c)));
    const q = add(r, center);
    v.push(q[0], q[1], q[2]);
  }
  return { t: m.t, v };
}
export function meshBounds(m: MeshData): { min: V3; max: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.v.length; i++) { const k = i % 3; min[k] = Math.min(min[k]!, m.v[i]!); max[k] = Math.max(max[k]!, m.v[i]!); }
  return { min, max };
}

// Dimensions d'une pièce : épaisseur = normale de la plus grande face ; L ≥ l dans le plan de cette face.
export function pieceDims(m: MeshData): { L: number; l: number; e: number } {
  const faces = planarFaces(m);
  const P = (i: number): V3 => [m.v[3 * i]!, m.v[3 * i + 1]!, m.v[3 * i + 2]!];
  let best: PlanarFace | null = null, bestA = -1;
  for (const F of faces) {
    let a = 0;
    for (const t of F.tris) a += len(cross(sub(P(m.t[3 * t + 1]!), P(m.t[3 * t]!)), sub(P(m.t[3 * t + 2]!), P(m.t[3 * t]!)))) / 2;
    if (a > bestA) { bestA = a; best = F; }
  }
  if (!best) return { L: 0, l: 0, e: 0 };
  let e1: V3 = [1, 0, 0], bl = -1;
  for (const lp of best.loops) for (let i = 0; i < lp.length; i++) {
    const d = sub(lp[(i + 1) % lp.length]!, lp[i]!);
    if (len(d) > bl) { bl = len(d); e1 = norm(d); }
  }
  const e2 = cross(best.n, e1);
  const ext = (ax: V3) => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < m.v.length; i += 3) { const x = dot(P(i / 3), ax); lo = Math.min(lo, x); hi = Math.max(hi, x); }
    return hi - lo;
  };
  const a = ext(e1), b = ext(e2);
  return { L: Math.max(a, b), l: Math.min(a, b), e: ext(best.n) };
}


// ───────── Composants et copies ─────────
function rotVec(p: V3, k: V3, c: number, s: number): V3 {
  return add(add(mul(p, c), mul(cross(k, p), s)), mul(k, dot(k, p) * (1 - c)));
}
const applyR = (r: number[], p: V3): V3 => [r[0]! * p[0] + r[1]! * p[1] + r[2]! * p[2], r[3]! * p[0] + r[4]! * p[1] + r[5]! * p[2], r[6]! * p[0] + r[7]! * p[1] + r[8]! * p[2]];
const applyRT = (r: number[], p: V3): V3 => [r[0]! * p[0] + r[3]! * p[1] + r[6]! * p[2], r[1]! * p[0] + r[4]! * p[1] + r[7]! * p[2], r[2]! * p[0] + r[5]! * p[1] + r[8]! * p[2]];

export function moveSolid(s: Solid, d: V3): void {
  s.mesh = translateMesh(s.mesh, d);
  if (s.comp) s.comp.t = add(s.comp.t, d);
}
export function rotateSolid(s: Solid, center: V3, axis: V3, angle: number): void {
  s.mesh = rotateMesh(s.mesh, center, axis, angle);
  if (!s.comp) return;
  const k = norm(axis), c = Math.cos(angle), sn = Math.sin(angle), r = s.comp.r;
  const cols = [0, 1, 2].map((j) => rotVec([r[j]!, r[3 + j]!, r[6 + j]!], k, c, sn));
  s.comp.r = [cols[0]![0], cols[1]![0], cols[2]![0], cols[0]![1], cols[1]![1], cols[2]![1], cols[0]![2], cols[1]![2], cols[2]![2]];
  s.comp.t = add(rotVec(sub(s.comp.t, center), k, c, sn), center);
}
export function makeComponent(doc: Doc, s: Solid): void {
  if (!s.comp) s.comp = { id: doc.next++, r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
}
export function makeUnique(s: Solid): void { delete s.comp; }
export const instancesOf = (doc: Doc, s: Solid): Solid[] => (s.comp ? doc.solids.filter((x) => x.comp?.id === s.comp!.id) : [s]);

// Copie d'un solide. La copie d'un composant reste liée à son modèle.
export function duplicateSolid(doc: Doc, s: Solid): Solid {
  const c = JSON.parse(JSON.stringify(s)) as Solid;
  c.id = doc.next++;
  doc.solids.push(c);
  return c;
}

// Reporte la forme, le nom et les propriétés d'une instance sur toutes les autres du même composant.
export function propagate(doc: Doc, solidId: number): void {
  const s = doc.solids.find((x) => x.id === solidId);
  if (!s?.comp) return;
  const { r, t } = s.comp;
  const local: V3[] = [];
  for (let i = 0; i < s.mesh.v.length; i += 3) local.push(applyRT(r, sub([s.mesh.v[i]!, s.mesh.v[i + 1]!, s.mesh.v[i + 2]!], t)));
  for (const x of doc.solids) {
    if (x === s || x.comp?.id !== s.comp.id) continue;
    const v: number[] = [];
    for (const p of local) v.push(...add(applyR(x.comp.r, p), x.comp.t));
    x.mesh = { v, t: s.mesh.t };
    x.name = s.name; x.meta = { ...s.meta };
  }
}
