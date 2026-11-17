// Outil Échelle : agrandir ou réduire des pièces à partir d'un point fixe (ancre), axe par axe.
// « echelle » : homothétie classique (comme SketchUp), épaisseurs comprises.
// « etirer » : pour les meubles, les panneaux gardent leur épaisseur ; les pièces qui traversent le milieu
// de la sélection s'allongent, celles qui sont au-delà se déplacent. Les contacts entre pièces sont conservés.
import { meshBounds, type Solid, type V3 } from './model';

export type ModeEchelle = 'echelle' | 'etirer';
const MINCE = 0.06;   // pièce plus fine que ça le long d'un axe : un panneau qu'on ne coupe pas en deux

export function boiteDe(solids: Solid[]): { lo: V3; hi: V3 } | null {
  if (!solids.length) return null;
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const s of solids) { const b = meshBounds(s.mesh); for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, b.min[k]!); hi[k] = Math.max(hi[k]!, b.max[k]!); } }
  return { lo, hi };
}

// Plan d'étirement le long de `k` : le milieu de la sélection, décalé au bord d'un panneau mince qu'il couperait.
export function planEtirement(solids: Solid[], k: number, lo: number, hi: number): number {
  let c = (lo + hi) / 2;
  for (let tour = 0; tour < 10; tour++) {
    const coupe = solids.map((s) => meshBounds(s.mesh)).find((b) => b.max[k]! - b.min[k]! < MINCE && b.min[k]! < c - 1e-9 && b.max[k]! > c + 1e-9);
    if (!coupe) break;
    c = c - coupe.min[k]! < coupe.max[k]! - c ? coupe.min[k]! : coupe.max[k]!;
  }
  return c;
}

// Transforme les pièces `cibles` (modifiées en place) : facteur `s` par axe, point fixe `ancre`.
export function transformer(cibles: Solid[], s: V3, ancre: V3, mode: ModeEchelle): void {
  const b = boiteDe(cibles);
  if (!b) return;
  const plans = [0, 1, 2].map((k) => planEtirement(cibles, k, b.lo[k]!, b.hi[k]!));
  // décalage d'une coordonnée le long de k en mode « etirer »
  const decalage = (k: number, x: number): number => {
    const taille = b.hi[k]! - b.lo[k]!, delta = (s[k]! - 1) * taille, c = plans[k]!;
    const coteBas = ancre[k]! <= b.lo[k]! + 1e-9, coteHaut = ancre[k]! >= b.hi[k]! - 1e-9;
    if (coteBas) return x > c + 1e-9 ? delta : 0;
    if (coteHaut) return x < c - 1e-9 ? -delta : 0;
    return x > c + 1e-9 ? delta / 2 : x < c - 1e-9 ? -delta / 2 : 0;
  };
  for (const sol of cibles) {
    const v = sol.mesh.v.slice(), bb = meshBounds(sol.mesh);
    for (let i = 0; i < v.length; i++) {
      const k = i % 3, f = s[k]!;
      if (Math.abs(f - 1) < 1e-12) continue;
      if (mode === 'echelle') { v[i] = ancre[k]! + (v[i]! - ancre[k]!) * f; continue; }
      // un panneau mince dans cet axe bouge d'un bloc (selon son milieu) : son épaisseur ne change jamais
      const mince = bb.max[k]! - bb.min[k]! < MINCE;
      v[i] = v[i]! + decalage(k, mince ? (bb.min[k]! + bb.max[k]!) / 2 : v[i]!);
    }
    sol.mesh = { v, t: sol.mesh.t };
    delete sol.comp;            // la forme n'est plus celle du composant
  }
}
