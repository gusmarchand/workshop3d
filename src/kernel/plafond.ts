// Plafond en pente (sous-pente) pris comme référence : un plan qui monte le long d'un axe horizontal.
// Sert à vérifier que les pièces, et les portes et tiroirs en s'ouvrant, restent dessous.
import { appliquerPose, piecesDe, poseOuverte, type Element } from './elements';
import { planarFaces, type Doc, type MeshData, type Solid, type V3 } from './model';

// angle en degrés ; hauteur (mm) mesurée à `position` (mm) le long de `axe` (0 = X, 1 = Y) ; `sens` : la pente monte vers +axe (1) ou -axe (-1).
export interface Plafond { angle: number; hauteur: number; axe: 0 | 1; sens: 1 | -1; position: number }

export const hauteurPlafond = (p: Plafond, q: V3): number =>
  (p.hauteur + Math.tan((p.angle * Math.PI) / 180) * p.sens * (q[p.axe] * 1000 - p.position)) / 1000;

// Plafond d'après la face inclinée la plus haute d'une pièce (le dessus d'un rampant, par exemple).
export function plafondDepuisPiece(s: Solid): Plafond | null {
  let best: { n: V3; p: V3; z: number } | null = null;
  for (const F of planarFaces(s.mesh)) {
    const n = F.n, horiz = Math.hypot(n[0], n[1]);
    if (n[2] < 0.05 || horiz < 0.05) continue;              // ni verticale, ni horizontale, tournée vers le haut
    const pts = F.loops.flat(), z = pts.reduce((t, q) => t + q[2], 0) / pts.length;
    if (!best || z > best.z) best = { n, p: pts[0]!, z };
  }
  if (!best) return null;
  const axe: 0 | 1 = Math.abs(best.n[0]) >= Math.abs(best.n[1]) ? 0 : 1;
  const angle = (Math.atan2(Math.abs(best.n[axe]), best.n[2]) * 180) / Math.PI;
  return { angle: Math.round(angle * 10) / 10, hauteur: Math.round(best.p[2] * 10000) / 10, axe, sens: best.n[axe] > 0 ? -1 : 1, position: Math.round(best.p[axe] * 10000) / 10 };
}

// Dépassement (mm, > 0 si la pièce passe au-dessus du plafond) de sommets transformés.
function depassement(p: Plafond, m: MeshData, f: (q: V3) => V3 = (q) => q): number {
  let pire = -Infinity;
  for (let i = 0; i < m.v.length; i += 3) {
    const q = f([m.v[i]!, m.v[i + 1]!, m.v[i + 2]!]);
    pire = Math.max(pire, (q[2] - hauteurPlafond(p, q)) * 1000);
  }
  return pire;
}
export function piecesSousPlafond(d: Doc, p: Plafond, tol = 0.5): { id: number; depasse: number }[] {
  return d.solids.filter((s) => !s.meta.masque).map((s) => ({ id: s.id, depasse: depassement(p, s.mesh) })).filter((x) => x.depasse > tol);
}
// Première ouverture (fraction) où une porte ou un tiroir touche le plafond, et de combien ; null s'il passe.
export function balayagePlafond(d: Doc, p: Plafond, el: Element, tol = 0.5): { fraction: number; depasse: number } | null {
  const ps = piecesDe(el).map((i) => d.solids.find((s) => s.id === i)).filter((x): x is Solid => !!x);
  for (let k = 1; k <= 20; k++) {
    const pose = poseOuverte(d, el, k / 20);
    if (!pose) return null;
    const dep = Math.max(...ps.map((s) => depassement(p, s.mesh, (q) => appliquerPose(pose, q))));
    if (dep > tol) return { fraction: k / 20, depasse: dep };
  }
  return null;
}
