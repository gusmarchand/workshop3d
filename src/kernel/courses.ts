// Liste de courses complète : panneaux à acheter, chant, quincaillerie et visserie estimée.
import type { DebitRow } from './debit';
import { meshBounds, materiauDe, pieceDims, REGLAGES_DEFAUT, sidesOf, type Doc } from './model';
import { planDecoupe } from './nesting';

export interface Ligne { rayon: 'Panneaux' | 'Chant' | 'Quincaillerie' | 'Visserie'; nom: string; qte: number; unite: string; prix: number; estimation?: boolean }

// Liaisons entre pièces : deux pièces qui se touchent sur une surface d'au moins 5 mm dans chaque sens (un chant de panneau suffit).
export function liaisons(d: Doc): number {
  // portes et façades tiennent par leur quincaillerie (charnières, vis de façade), pas par des vis d'assemblage
  const fronts = new Set((d.elements ?? []).map((e) => (e.type === 'porte' ? e.piece : e.facade)));
  const bs = d.solids.filter((s) => s.meta.piece && !fronts.has(s.id)).map((s) => meshBounds(s.mesh));
  let n = 0;
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
    const a = bs[i]!, b = bs[j]!;
    const r = [0, 1, 2].map((k) => Math.min(a.max[k]!, b.max[k]!) - Math.max(a.min[k]!, b.min[k]!));
    const contact = r.filter((x) => Math.abs(x) < 0.0005).length === 1, recouvre = r.filter((x) => x > 0.005).length === 2;
    if (contact && recouvre) n++;
  }
  return n;
}

export function listeCourses(d: Doc, rows: DebitRow[]): { lignes: Ligne[]; total: number } {
  const lignes: Ligne[] = [];
  const plan = planDecoupe(rows, d.stock ?? [], d.reglages ?? REGLAGES_DEFAUT);
  for (const g of plan.groupes) {
    const formats = new Map<string, { n: number; prix: number }>();
    for (const b of g.plan.bins.filter((x) => x.achat)) {
      const k = `${g.matiere} ${b.panneau.L} × ${b.panneau.l} × ${g.e}`;
      const f = formats.get(k) ?? { n: 0, prix: b.panneau.prix };
      f.n++; formats.set(k, f);
    }
    for (const [nom, f] of formats) lignes.push({ rayon: 'Panneaux', nom, qte: f.n, unite: 'panneau', prix: f.prix });
    for (const m of g.manques) lignes.push({ rayon: 'Panneaux', nom: `${g.matiere} ${m.L} × ${m.l} × ${g.e} (prix à saisir)`, qte: m.n, unite: 'panneau', prix: 0 });
  }
  const chants = new Map<string, { m: number; prix: number }>();
  for (const s of d.solids) {
    if (!s.meta.piece) continue;
    const meth = materiauDe(d, s), sides = sidesOf(d, s);
    if (!sides.length) continue;
    const dim = pieceDims(s.mesh), nL = sides.filter((k) => k[0] === 'L').length;
    const nom = `Chant ${meth?.chant || 'assorti'} (${meth?.nom ?? s.meta.matiere})`;
    const c = chants.get(nom) ?? { m: 0, prix: meth?.chantPrix ?? 0 };
    c.m += nL * dim.L + (sides.length - nL) * dim.l;
    chants.set(nom, c);
  }
  // 10 % de plus pour les chutes et les coupes d'onglet, arrondi au mètre
  for (const [nom, c] of chants) lignes.push({ rayon: 'Chant', nom, qte: Math.ceil(c.m * 1.1), unite: 'm', prix: c.prix });
  for (const x of d.extras ?? []) lignes.push({ rayon: 'Quincaillerie', nom: x.nom, qte: x.qte, unite: 'u', prix: x.prix });
  const q = (re: RegExp) => (d.extras ?? []).filter((x) => re.test(x.nom)).reduce((t, x) => t + x.qte, 0);
  const vis: [string, number][] = [
    ['Vis d\'assemblage 4 × 40 (ou tourillons et excentriques)', 4 * liaisons(d)],
    ['Vis 3,5 × 16 pour charnières (4 par charnière)', 4 * q(/charni/i)],
    ['Vis 3,5 × 16 pour coulisses (12 par paire)', 12 * q(/coulisse/i)],
    ['Vis M4 de poignée (2 par poignée)', 2 * q(/poign/i)],
  ];
  for (const [nom, n] of vis) if (n) lignes.push({ rayon: 'Visserie', nom, qte: n, unite: 'u', prix: 0, estimation: true });
  return { lignes, total: lignes.reduce((t, l) => t + l.qte * l.prix, 0) };
}
