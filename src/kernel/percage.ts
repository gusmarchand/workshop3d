// Fiche de perçage : chaque porte ou façade vue de face, avec ses trous cotés depuis le coin bas gauche.
import { ferrures, piecesDe, repere, type Element } from './elements';
import { add, dot, mul, type Doc, type V3 } from './model';

export interface Trou { u: number; v: number; diam: number; profondeur: number; face: 'intérieure' | 'traversant'; quoi: string }
export interface FichePercage { titre: string; largeur: number; hauteur: number; epaisseur: number; trous: Trou[]; notes: string[] }
const mm = (m: number) => Math.round(m * 10000) / 10;

export function fichePercage(d: Doc, el: Element): FichePercage | null {
  const s = d.solids.find((x) => x.id === piecesDe(el)[0]);
  if (!s) return null;
  const R = repere(d, s, piecesDe(el), el.sens);
  const coin: V3 = add(add(R.c, mul(R.r, -R.w / 2)), mul(R.h, -R.l / 2));      // bas gauche, vu de face
  const trous: Trou[] = [];
  const fs = ferrures(d, el);
  for (const f of fs) for (const forme of f.formes) {
    if (forme.kind !== 'cylindre') continue;
    const q = [dot(add(forme.centre, mul(coin, -1)), R.r), dot(add(forme.centre, mul(coin, -1)), R.h)];
    if (forme.rayon > 0.01) trous.push({ u: mm(q[0]!), v: mm(q[1]!), diam: 35, profondeur: 12.5, face: 'intérieure', quoi: 'Cuvette de charnière' });
    else trous.push({ u: mm(q[0]!), v: mm(q[1]!), diam: 5, profondeur: mm(R.e), face: 'traversant', quoi: 'Vis de poignée' });
  }
  trous.sort((a, b) => a.v - b.v || a.u - b.u);
  return { titre: s.name, largeur: mm(R.w), hauteur: mm(R.l), epaisseur: mm(R.e), trous, notes: fs.map((f) => f.cote) };
}
