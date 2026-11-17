// Éléments fonctionnels : des pièces reconnues comme porte ou tiroir, avec leurs réglages, leur position ouverte
// et leur quincaillerie placée (charnières, coulisses, poignées) avec les cotes de perçage.
// Tout est calculé depuis la géométrie des pièces : déplacer un meuble déplace sa quincaillerie.
// Unités : mètres dans le modèle, millimètres dans les textes.
import { add, cross, dot, meshBounds, mul, type Doc, type Extra, type Solid, type V3 } from './model';
import type { RolePanneau } from './cabinet';

export type CoteCharniere = 'gauche' | 'droite' | 'haut' | 'bas';
export type Recouvrement = 'applique' | 'demi' | 'encastree';
// `sens` force le côté extérieur le long de l'épaisseur (+1 ou -1) quand la détection se trompe.
// `caisson` et `cle` : élément créé par le générateur de meuble, retrouvé par sa clé quand le meuble est regénéré.
export interface Porte { id: number; type: 'porte'; caisson?: number; cle?: string; piece: number; charnieres: CoteCharniere; recouvrement: Recouvrement; ouverture: number; nbCharnieres?: number; entraxe: number; sens?: 1 | -1 }
// `sortie` : coulisses à sortie totale (le tiroir sort de toute leur longueur, par défaut) ou partielle (environ les 3/4).
export interface Tiroir { id: number; type: 'tiroir'; caisson?: number; cle?: string; facade: number; pieces: number[]; coulisse: number; entraxe: number; sortie?: 'partielle'; sens?: 1 | -1 }
export type Element = Porte | Tiroir;

export const RECOUVREMENTS: Record<Recouvrement, string> = { applique: 'en applique', demi: 'demi-applique', encastree: 'encastrée' };
export const ENTRAXES = [0, 96, 128, 160, 192, 256, 320];
export const COULISSES = [250, 300, 350, 400, 450, 500, 550, 600, 650];
export const OUVERTURES = [95, 110, 155, 170];
// Course d'un tiroir, en mm.
export const course = (t: Tiroir) => (t.sortie === 'partielle' ? Math.round(t.coulisse * 0.75) : t.coulisse);

export type Forme = { kind: 'cylindre'; centre: V3; axe: V3; rayon: number; long: number } | { kind: 'boite'; min: V3; max: V3 };
// `achat` et `qte` alimentent la liste de quincaillerie ; `cote` dit où percer.
export interface Ferrure { nom: string; achat: string; qte: number; formes: Forme[]; cote: string }

const E = (k: number): V3 => [0, 1, 2].map((i) => (i === k ? 1 : 0)) as V3;
const mm = (m: number) => Math.round(m * 10000) / 10;
const fmt = (m: number) => String(mm(m)).replace('.', ',');
const piecesDe = (el: Element): number[] => (el.type === 'porte' ? [el.piece] : [el.facade, ...el.pieces]);
export const elementDe = (d: Doc, id: number): Element | undefined => (d.elements ?? []).find((e) => piecesDe(e).includes(id));
export { piecesDe };

// ───────── Repère d'un panneau vu de face ─────────
// n : vers l'extérieur ; h : vers le haut ; r : vers la droite de quelqu'un qui le regarde ; w, l, e : largeur, hauteur, épaisseur.
export interface Repere { n: V3; r: V3; h: V3; c: V3; w: number; l: number; e: number; min: V3; max: V3 }
const recouvre = (a: { min: V3; max: V3 }, b: { min: V3; max: V3 }, k: number) => Math.min(a.max[k]!, b.max[k]!) - Math.max(a.min[k]!, b.min[k]!);
function sensExterieur(d: Doc, b: { min: V3; max: V3 }, k: number, exclus: number[]): 1 | -1 {
  const c = (b.min[k]! + b.max[k]!) / 2, autres = [0, 1, 2].filter((i) => i !== k);
  let somme = 0, n = 0;
  for (const s of d.solids) {
    if (exclus.includes(s.id)) continue;
    const o = meshBounds(s.mesh);
    if (!autres.every((i) => recouvre(o, b, i) > 0.001)) continue;
    const co = (o.min[k]! + o.max[k]!) / 2;
    if (Math.abs(co - c) > 1) continue;
    somme += co - c; n++;
  }
  if (!n) {
    const lo = Math.min(...d.solids.map((s) => meshBounds(s.mesh).min[k]!)), hi = Math.max(...d.solids.map((s) => meshBounds(s.mesh).max[k]!));
    return c < (lo + hi) / 2 ? -1 : 1;
  }
  return somme > 0 ? -1 : 1;   // le reste du meuble est derrière
}
export function repere(d: Doc, s: Solid, exclus: number[], sens?: 1 | -1): Repere {
  const { min, max } = meshBounds(s.mesh);
  const t = [0, 1, 2].map((i) => max[i]! - min[i]!);
  const k = t.indexOf(Math.min(...t));
  const n = mul(E(k), sens ?? sensExterieur(d, { min, max }, k, exclus));
  const h: V3 = k === 2 ? E(t[0]! >= t[1]! ? 1 : 0) : [0, 0, 1];
  const r = cross(mul(n, -1), h);
  const c = mul(add(min, max), 0.5);
  const ext = (a: V3) => Math.abs(dot(a, [t[0]!, t[1]!, t[2]!]));
  return { n, r, h, c, w: ext(r), l: ext(h), e: t[k]!, min, max };
}

// ───────── Portes ─────────
export const nbCharnieresAuto = (hauteur: number) => (hauteur <= 0.9 ? 2 : hauteur <= 1.6 ? 3 : hauteur <= 2 ? 4 : 5);
// Bord des charnières : `t` le long du chant, `w` du chant vers l'intérieur de la porte, `long` et `large` les cotes associées.
function bordCharnieres(R: Repere, cote: CoteCharniere) {
  const vert = cote === 'gauche' || cote === 'droite';
  const w = cote === 'gauche' ? R.r : cote === 'droite' ? mul(R.r, -1) : cote === 'bas' ? R.h : mul(R.h, -1);
  const t = vert ? R.h : R.r, long = vert ? R.l : R.w, large = vert ? R.w : R.l;
  const bord = add(R.c, mul(w, -large / 2));                      // milieu du chant côté charnières
  return { w, t, long, large, bord, debut: add(bord, mul(t, -long / 2)) };
}
export interface Pose { kind: 'rotation'; point: V3; axe: V3; angle: number }
export interface Translation { kind: 'translation'; v: V3 }
// Pose d'un élément ouvert à la fraction `f` (0 = fermé, 1 = ouvert en grand : angle d'ouverture de la porte, course du tiroir).
export function poseOuverte(d: Doc, el: Element, f = 1): Pose | Translation | null {
  if (el.type === 'tiroir') {
    const fa = d.solids.find((s) => s.id === el.facade);
    if (!fa) return null;
    const R = repere(d, fa, [el.facade, ...el.pieces], el.sens);
    return { kind: 'translation', v: mul(R.n, (f * course(el)) / 1000) };
  }
  const s = d.solids.find((x) => x.id === el.piece);
  if (!s) return null;
  const R = repere(d, s, [el.piece], el.sens), B = bordCharnieres(R, el.charnieres);
  // axe sur la face extérieure, au chant des charnières ; sens choisi pour que la porte sorte vers l'extérieur
  const point = add(B.bord, mul(R.n, R.e / 2));
  const libre = add(B.bord, mul(B.w, B.large));
  const max = (el.ouverture * Math.PI) / 180, angle = f * max;
  const tourne = (a: number) => {
    const v = add(libre, mul(point, -1)), k = B.t, c = Math.cos(a), sn = Math.sin(a);
    return add(point, add(add(mul(v, c), mul(cross(k, v), sn)), mul(k, dot(k, v) * (1 - c))));
  };
  const axe = dot(tourne(max / 2), R.n) >= dot(tourne(-max / 2), R.n) ? B.t : mul(B.t, -1);
  return { kind: 'rotation', point, axe, angle };
}

// Point qu'on « tient » pour ouvrir à la souris : milieu du chant libre d'une porte, centre de la façade d'un tiroir.
export function pointPrise(d: Doc, el: Element): V3 | null {
  const s = d.solids.find((x) => x.id === (el.type === 'porte' ? el.piece : el.facade));
  if (!s) return null;
  const R = repere(d, s, piecesDe(el), el.sens);
  if (el.type === 'tiroir') return add(R.c, mul(R.n, R.e / 2));
  const B = bordCharnieres(R, el.charnieres);
  return add(add(B.bord, mul(B.w, B.large)), mul(R.n, R.e / 2));
}
export function appliquerPose(p: Pose | Translation, q: V3): V3 {
  if (p.kind === 'translation') return add(q, p.v);
  const v = add(q, mul(p.point, -1)), k = p.axe, c = Math.cos(p.angle), sn = Math.sin(p.angle);
  return add(p.point, add(add(mul(v, c), mul(cross(k, v), sn)), mul(k, dot(k, v) * (1 - c))));
}

function poignee(R: Repere, centre: V3, le_long: V3, entraxe: number): Forme[] {
  if (!entraxe) return [];
  const demi = (entraxe / 1000 + 0.016) / 2, recul = 0.025;
  const c = add(centre, mul(R.n, R.e / 2 + recul));
  const a = add(c, mul(le_long, -demi)), b = add(c, mul(le_long, demi));
  const ep = 0.006;
  const lo = [0, 1, 2].map((i) => Math.min(a[i]!, b[i]!) - (Math.abs(le_long[i]!) > 0.5 ? 0 : ep)) as V3;
  const hi = [0, 1, 2].map((i) => Math.max(a[i]!, b[i]!) + (Math.abs(le_long[i]!) > 0.5 ? 0 : ep)) as V3;
  const pieds = [-1, 1].map((sg): Forme => ({ kind: 'cylindre', centre: add(add(centre, mul(le_long, sg * entraxe / 2000)), mul(R.n, R.e / 2 + recul / 2)), axe: R.n, rayon: 0.005, long: recul }));
  return [{ kind: 'boite', min: lo, max: hi }, ...pieds];
}

export function ferrures(d: Doc, el: Element): Ferrure[] {
  if (el.type === 'porte') {
    const s = d.solids.find((x) => x.id === el.piece);
    if (!s) return [];
    const R = repere(d, s, [el.piece], el.sens), B = bordCharnieres(R, el.charnieres);
    const nb = el.nbCharnieres ?? nbCharnieresAuto(B.long);
    const pos = nb === 1 ? [B.long / 2] : Array.from({ length: nb }, (_, i) => 0.1 + (i * (B.long - 0.2)) / (nb - 1));
    const interieur = add(B.debut, mul(R.n, -R.e / 2));
    const cuvettes = pos.map((p): Forme => ({ kind: 'cylindre', centre: add(add(add(interieur, mul(B.t, p)), mul(B.w, 0.0225)), mul(R.n, 0.005)), axe: R.n, rayon: 0.0175, long: 0.0135 }));
    const repereBord = el.charnieres === 'gauche' || el.charnieres === 'droite' ? 'du bas de la porte' : 'du chant gauche';
    const out: Ferrure[] = [{
      nom: `${nb} charnières ${RECOUVREMENTS[el.recouvrement]} ${el.ouverture}°`, achat: `Charnières ${RECOUVREMENTS[el.recouvrement]} ${el.ouverture}°`, qte: nb, formes: cuvettes,
      cote: `Charnières ${RECOUVREMENTS[el.recouvrement]} côté ${el.charnieres} : cuvettes Ø35, profondeur 12,5, axe à 22,5 du chant, à ${pos.map((p) => fmt(p)).join(', ')} mm ${repereBord}. Embases sur le meuble, aux mêmes hauteurs, à 37 du chant avant.${R.e < 0.0155 ? ` ⚠ Porte de ${fmt(R.e)} mm : trop mince pour une cuvette de 12,5 mm (16 mm minimum). Prends des portes de 16 ou 19 mm, ou des charnières pour portes fines.` : ''}`,
    }];
    if (el.entraxe) {
      const vert = el.charnieres === 'gauche' || el.charnieres === 'droite';
      // poignée près du chant libre : verticale à mi-hauteur de main (1050 du sol si la porte la couvre), horizontale sinon
      const libre = add(B.bord, mul(B.w, B.large - 0.04));
      let centre: V3;
      if (vert) {
        // hauteur réelle le long du chant libre (une porte coupée en biais y est plus courte qu'ailleurs)
        let bas = Infinity, haut = -Infinity;
        for (let i = 0; i < s.mesh.v.length; i += 3) {
          const q: V3 = [s.mesh.v[i]!, s.mesh.v[i + 1]!, s.mesh.v[i + 2]!];
          if (Math.abs(dot(add(q, mul(B.bord, -1)), B.w) - B.large) > 0.002) continue;
          bas = Math.min(bas, q[2]); haut = Math.max(haut, q[2]);
        }
        if (!(haut > bas)) { bas = R.c[2]! - R.l / 2; haut = R.c[2]! + R.l / 2; }
        const m = el.entraxe / 2000 + 0.05;
        // vers 1050 du sol si possible ; au milieu du chant libre s'il est trop court pour les marges
        const z = bas + m <= haut - m ? Math.min(Math.max(1.05, bas + m), haut - m) : (bas + haut) / 2;
        centre = [libre[0], libre[1], z];
      } else centre = libre;
      const le_long = vert ? R.h : R.r;
      const zBas = R.c[2]! - R.l / 2;
      out.push({
        nom: `Poignée entraxe ${el.entraxe}`, achat: `Poignées entraxe ${el.entraxe} mm`, qte: 1, formes: poignee(R, centre, le_long, el.entraxe),
        cote: vert
          ? `Poignée entraxe ${el.entraxe} : perçages à ${fmt(centre[2]! - zBas - el.entraxe / 2000)} et ${fmt(centre[2]! - zBas + el.entraxe / 2000)} mm du bas de la porte, à 40 mm du chant libre.`
          : `Poignée entraxe ${el.entraxe} : centrée, à 40 mm du chant libre.`,
      });
    }
    return out;
  }
  const f = d.solids.find((x) => x.id === el.facade);
  if (!f) return [];
  const R = repere(d, f, [el.facade, ...el.pieces], el.sens);
  const box = el.pieces.map((i) => d.solids.find((x) => x.id === i)).filter((x): x is Solid => !!x).map((x) => meshBounds(x.mesh));
  const out: Ferrure[] = [];
  if (box.length) {
    const lo = [0, 1, 2].map((k) => Math.min(...box.map((b) => b.min[k]!))) as V3, hi = [0, 1, 2].map((k) => Math.max(...box.map((b) => b.max[k]!))) as V3;
    const etendue = (a: V3) => [dot(lo, a), dot(hi, a)].sort((x, y) => x - y) as [number, number];
    const [r0, r1] = etendue(R.r.map(Math.abs) as V3), [n0, n1] = etendue(R.n.map(Math.abs) as V3);
    const sn = dot(R.n, [1, 1, 1]) > 0 ? 1 : -1;        // n est un axe : signe de sa composante
    const avant = sn > 0 ? n1 : n0, L = el.coulisse / 1000;
    const zc = (lo[2]! + hi[2]!) / 2, kr = R.r.findIndex((x) => Math.abs(x) > 0.5), kn = R.n.findIndex((x) => Math.abs(x) > 0.5);
    const barre = (rPos: number): Forme => {
      const min: V3 = [0, 0, 0], max: V3 = [0, 0, 0];
      min[kr] = rPos - 0.00635; max[kr] = rPos + 0.00635;
      min[kn] = Math.min(avant, avant - sn * L); max[kn] = Math.max(avant, avant - sn * L);
      min[2] = zc - 0.0225; max[2] = zc + 0.0225;
      return { kind: 'boite', min, max };
    };
    const zf = R.c[2]! - R.l / 2;
    out.push({
      nom: `Coulisses ${el.coulisse} mm (paire)`, achat: `Coulisses à billes ${el.coulisse} mm sortie ${el.sortie ?? 'totale'} (paire)`, qte: 1, formes: [barre(r0 - 0.00635), barre(r1 + 0.00635)],
      cote: `Coulisses ${el.coulisse} mm, une de chaque côté du tiroir : axe à ${fmt(zc - zf)} mm du bas de la façade, soit ${fmt(zc)} mm du sol, sur ${el.coulisse} mm de profondeur depuis l'avant du caisson de tiroir. Sortie ${el.sortie ?? 'totale'} : le tiroir sort de ${course(el)} mm.`,
    });
  }
  if (el.entraxe) out.push({
    nom: `Poignée entraxe ${el.entraxe}`, achat: `Poignées entraxe ${el.entraxe} mm`, qte: 1, formes: poignee(R, R.c, R.r, el.entraxe),
    cote: `Poignée entraxe ${el.entraxe} : perçages à ${fmt(R.w / 2 - el.entraxe / 2000)} et ${fmt(R.w / 2 + el.entraxe / 2000)} mm du chant gauche, à ${fmt(R.l / 2)} mm du bas de la façade.`,
  });
  return out;
}

// ───────── Identification ─────────
// Pièces d'un caisson de tiroir derrière une façade : entièrement dans son emprise, du côté intérieur, à moins de 80 cm.
export function caissonTiroir(d: Doc, facade: Solid, exclus: number[] = []): number[] {
  const R = repere(d, facade, [facade.id]);
  const k = R.n.findIndex((x) => Math.abs(x) > 0.5), sn = R.n[k]!, autres = [0, 1, 2].filter((i) => i !== k);
  const fb = meshBounds(facade.mesh), dedans = sn > 0 ? fb.min[k]! : fb.max[k]!;
  return d.solids.filter((s) => {
    if (s.id === facade.id || exclus.includes(s.id) || elementDe(d, s.id)) return false;
    const b = meshBounds(s.mesh);
    if (!autres.every((i) => b.min[i]! >= fb.min[i]! - 1e-4 && b.max[i]! <= fb.max[i]! + 1e-4)) return false;
    const prof = sn > 0 ? dedans - b.min[k]! : b.max[k]! - dedans;
    const devant = sn > 0 ? b.max[k]! - dedans : dedans - b.min[k]!;
    return devant <= 1e-4 && prof <= 0.8;
  }).map((s) => s.id);
}
export function coulisseAuto(d: Doc, pieces: number[], facade: Solid): number {
  const R = repere(d, facade, [facade.id, ...pieces]);
  const k = R.n.findIndex((x) => Math.abs(x) > 0.5);
  const bs = pieces.map((i) => d.solids.find((s) => s.id === i)).filter((x): x is Solid => !!x).map((s) => meshBounds(s.mesh));
  if (!bs.length) return 400;
  const prof = (Math.max(...bs.map((b) => b.max[k]!)) - Math.min(...bs.map((b) => b.min[k]!))) * 1000;
  return [...COULISSES].reverse().find((c) => c <= prof + 2) ?? COULISSES[0]!;
}
// Façade d'un tiroir parmi des pièces : la plus grande des pièces verticales (épaisseur horizontale).
export function facadeParmi(d: Doc, ids: number[]): Solid | null {
  let best: Solid | null = null, aire = 0;
  for (const s of d.solids.filter((x) => ids.includes(x.id))) {
    const b = meshBounds(s.mesh), t = [0, 1, 2].map((i) => b.max[i]! - b.min[i]!);
    const k = t.indexOf(Math.min(...t));
    if (k === 2) continue;
    const a = t.reduce((p, x, i) => (i === k ? p : p * x), 1);
    if (a > aire) { aire = a; best = s; }
  }
  return best;
}
// Reconnaît les portes et les tiroirs d'après le nom des pièces (« Porte… », « Façade tiroir… »).
export function reconnaitre(d: Doc): Element[] {
  const nouveaux: Element[] = [], pris = new Set<number>();
  for (const s of d.solids) {
    if (elementDe(d, s.id) || pris.has(s.id)) continue;
    if (/^porte/i.test(s.name)) {
      const ch: CoteCharniere = /droite/i.test(s.name) ? 'droite' : 'gauche';
      nouveaux.push({ id: d.next++, type: 'porte', piece: s.id, charnieres: ch, recouvrement: 'applique', ouverture: 110, entraxe: 128 });
      pris.add(s.id);
    } else if (/fa[cç]ade.*tiroir/i.test(s.name)) {
      const pieces = caissonTiroir(d, s, [...pris]);
      pieces.forEach((i) => pris.add(i)); pris.add(s.id);
      nouveaux.push({ id: d.next++, type: 'tiroir', facade: s.id, pieces, coulisse: coulisseAuto(d, pieces, s), entraxe: 160 });
    }
  }
  return nouveaux;
}

// ───────── Meubles générés et copies ─────────
// Éléments d'un meuble tout juste (re)généré : `roles` associe chaque nouvelle pièce à son rôle. Les réglages d'un élément
// de même clé dans `anciens` sont repris (charnières, poignée, sens…) ; une coulisse plus longue que le nouveau tiroir est ramenée.
export function elementsDuCaisson(d: Doc, caisson: number, roles: { id: number; role: RolePanneau }[], anciens: Element[]): Element[] {
  const parCle = new Map(anciens.filter((e) => e.caisson === caisson && e.cle).map((e) => [e.cle!, e]));
  const out: Element[] = [];
  for (const { id, role } of roles) {
    if (role.type !== 'porte') continue;
    const a = parCle.get(role.cle);
    out.push({ ...(a?.type === 'porte' ? a : { recouvrement: 'applique' as const, ouverture: 110, entraxe: 128, charnieres: role.charnieres }), id: d.next++, type: 'porte', caisson, cle: role.cle, piece: id });
  }
  const tiroirs = new Map<string, { facade?: number; pieces: number[]; coulisse: number }>();
  for (const { id, role } of roles) {
    if (role.type !== 'tiroir') continue;
    const t = tiroirs.get(role.cle) ?? { pieces: [], coulisse: role.coulisse };
    if (role.facade) t.facade = id; else t.pieces.push(id);
    tiroirs.set(role.cle, t);
  }
  for (const [cle, t] of tiroirs) {
    if (t.facade === undefined) continue;
    const a = parCle.get(cle);
    const reg = a?.type === 'tiroir' ? { entraxe: a.entraxe, coulisse: Math.min(a.coulisse, t.coulisse), ...(a.sortie ? { sortie: a.sortie } : {}), ...(a.sens ? { sens: a.sens } : {}) } : { entraxe: 160, coulisse: t.coulisse };
    out.push({ ...reg, id: d.next++, type: 'tiroir', caisson, cle, facade: t.facade, pieces: t.pieces });
  }
  return out;
}
// Copie les éléments dont toutes les pièces ont été copiées (`ids` : ancienne pièce → nouvelle). Un élément de meuble
// garde son lien si le meuble a été copié avec lui (`caissons`), sinon il devient un élément libre.
export function copierElements(d: Doc, source: Element[], ids: Map<number, number>, caissons = new Map<number, number>()): void {
  const nouveaux: Element[] = [];
  for (const e of source) {
    if (!piecesDe(e).every((i) => ids.has(i))) continue;
    const { caisson, cle, ...reste } = e;
    const lien = caisson !== undefined && caissons.has(caisson) ? { caisson: caissons.get(caisson)!, cle } : {};
    nouveaux.push(e.type === 'porte'
      ? { ...(reste as Omit<Porte, 'caisson' | 'cle'>), ...lien, id: d.next++, piece: ids.get(e.piece)! }
      : { ...(reste as Omit<Tiroir, 'caisson' | 'cle'>), ...lien, id: d.next++, facade: ids.get(e.facade)!, pieces: e.pieces.map((i) => ids.get(i)!) });
  }
  d.elements = [...(d.elements ?? []), ...nouveaux];
}

// ───────── Cohérence et liste d'achat ─────────
// Retire les éléments dont la pièce principale a disparu ; recalcule la quincaillerie automatique (prix gardés par nom).
export function synchroniserElements(d: Doc): Doc {
  const ids = new Set(d.solids.map((s) => s.id));
  const els = (d.elements ?? []).filter((e) => ids.has(e.type === 'porte' ? e.piece : e.facade))
    .map((e) => (e.type === 'tiroir' ? { ...e, pieces: e.pieces.filter((i) => ids.has(i)) } : e));
  const besoin = new Map<string, number>();
  for (const e of els) for (const f of ferrures({ ...d, elements: els }, e)) besoin.set(f.achat, (besoin.get(f.achat) ?? 0) + f.qte);
  const avant = d.extras ?? [];
  const prix = new Map(avant.filter((x) => x.prix > 0).map((x) => [x.nom, x.prix]));
  const garde = avant.filter((x) => !x.auto);
  let next = d.next;
  const auto: Extra[] = [...besoin].map(([nom, qte]) => ({ id: avant.find((x) => x.auto && x.nom === nom)?.id ?? next++, nom, qte, prix: prix.get(nom) ?? 0, auto: true }));
  const pareil = JSON.stringify(avant.filter((x) => x.auto)) === JSON.stringify(auto) && els.length === (d.elements ?? []).length && JSON.stringify(els) === JSON.stringify(d.elements ?? []);
  if (pareil) return d;
  return { ...d, next, elements: els, extras: [...garde, ...auto] };
}
