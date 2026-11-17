import { couleurDe, materiauDe, pieceDims, sidesOf, type Doc } from './model';

// Fiche de débit : une ligne par groupe de pièces identiques.
export interface DebitRow {
  id: number;
  src: 'modèle' | 'manuel';
  ref: string;
  nom: string;
  qte: number;
  L: number; // mm
  l: number; // mm
  e: number; // mm
  matiere: string;
  fil: 'L' | 'l' | 'aucun';
  chants: string;
  note: string;
  ml?: number;       // mètres de chant par pièce
  key?: string;      // identité de la pièce dans le modèle
  couleur?: string;  // couleur du matériau (#rrggbb) : deux matériaux peuvent partager un panneau (MDF peint)
  edited?: boolean;  // ligne « modèle » retouchée à la main : conservée aux synchronisations
}

const mm = (m: number) => Math.round(m * 10000) / 10; // 0,1 mm

// Regroupe les pièces du modèle (mêmes nom, matière, dimensions) en lignes.
export function rowsFromModel(doc: Doc, firstId: number, cles?: Map<number, string>): DebitRow[] {
  const groups = new Map<string, DebitRow>();
  let id = firstId;
  for (const s of doc.solids) {
    if (!s.meta.piece) continue;
    const d = pieceDims(s.mesh);
    const m = materiauDe(doc, s);
    const sides = sidesOf(doc, s);
    const nL = sides.filter((k) => k[0] === 'L').length, nl = sides.length - nL;
    // Cotes finies, ou cotes de coupe si la méthode déduit l'épaisseur du chant.
    const cut = m?.deduire ? m.chantEp : 0;
    const L = mm(d.L) - cut * nl, l = mm(d.l) - cut * nL;
    const matiere = m?.matiere || s.meta.matiere;
    const chants = sides.length ? `${sides.join(' ')}${m?.chant ? ` (${m.chant})` : ''}` : '';
    const ml = Math.round(nL * mm(d.L) + nl * mm(d.l)) / 1000;
    const couleur = couleurDe(doc, s);
    const key = [s.name, matiere, couleur, L, l, mm(d.e), s.meta.fil, chants].join('|');
    cles?.set(s.id, key);
    const g = groups.get(key);
    if (g) { g.qte++; continue; }
    groups.set(key, { key, id: id++, src: 'modèle', ref: '', nom: s.name, qte: 1, L, l, e: mm(d.e), matiere, fil: s.meta.fil, chants, note: s.meta.note, ml, couleur });
  }
  return [...groups.values()].map((r, i) => ({ ...r, ref: `P${i + 1}` }));
}

// Met la fiche à jour depuis le modèle : les lignes manuelles et les lignes « modèle »
// retouchées sont conservées, les autres sont recalculées.
export function syncFromModel(doc: Doc, rows: DebitRow[], firstId: number): DebitRow[] {
  const fresh = rowsFromModel(doc, firstId);
  // Clés d'avant la couleur (7 champs au lieu de 8) : une ligne retouchée dans un ancien fichier reste reconnue.
  const actuelle = new Map<string, string>();
  for (const r of fresh) { actuelle.set(r.key!, r.key!); actuelle.set(r.key!.split('|').filter((_, i) => i !== 2).join('|'), r.key!); }
  rows = rows.map((r) => (r.src === 'modèle' && r.key && actuelle.has(r.key) ? { ...r, key: actuelle.get(r.key) } : r));
  const keys = new Set(fresh.map((r) => r.key));
  const kept = new Map(rows.filter((r) => r.src === 'modèle' && r.edited && keys.has(r.key)).map((r) => [r.key, r]));
  const orphans = rows.filter((r) => r.src === 'modèle' && r.edited && !keys.has(r.key)).map((r) => ({ ...r, src: 'manuel' as const }));
  const out = [...fresh.map((r) => kept.get(r.key) ?? r), ...orphans, ...rows.filter((r) => r.src === 'manuel')];
  // Une ligne gardée (retouchée ou manuelle) peut porter une référence reprise par une nouvelle ligne du modèle : elle en prend une libre.
  const prises = new Set(fresh.map((r) => r.ref));
  let n = fresh.length;
  return out.map((r, i) => {
    if (i < fresh.length || !prises.has(r.ref)) { prises.add(r.ref); return r; }
    while (prises.has(`P${++n}`));
    prises.add(`P${n}`);
    return { ...r, ref: `P${n}` };
  });
}

// Coût du chant : mètres plaqués de chaque pièce × prix au mètre du chant de sa méthode.
export function coutChant(doc: Doc): number {
  let total = 0;
  for (const s of doc.solids) {
    if (!s.meta.piece) continue;
    const prix = materiauDe(doc, s)?.chantPrix ?? 0;
    if (!prix) continue;
    const d = pieceDims(s.mesh), sides = sidesOf(doc, s);
    const nL = sides.filter((k) => k[0] === 'L').length;
    total += ((nL * mm(d.L) + (sides.length - nL) * mm(d.l)) / 1000) * prix;
  }
  return total;
}

export function totals(rows: DebitRow[]) {
  let pieces = 0, surface = 0, volume = 0, chant = 0;
  for (const r of rows) {
    pieces += r.qte;
    surface += (r.qte * r.L * r.l) / 1e6; // m²
    volume += (r.qte * r.L * r.l * r.e) / 1e9; // m³
    chant += r.qte * (r.ml ?? 0); // m
  }
  return { pieces, surface, volume, chant };
}

export function toCsv(rows: DebitRow[]): string {
  const esc = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;
  const head = ['Réf', 'Désignation', 'Qté', 'Longueur (mm)', 'Largeur (mm)', 'Épaisseur (mm)', 'Matière', 'Fil', 'Chants', 'Note'];
  const lines = rows.map((r) => [r.ref, r.nom, r.qte, r.L, r.l, r.e, r.matiere, r.fil === 'aucun' ? '' : r.fil, r.chants, r.note].map(esc).join(';'));
  return '﻿' + [head.map(esc).join(';'), ...lines].join('\n');
}

// Référence de fiche (P1, P2…) de chaque pièce du modèle, d'après la fiche `rows` à jour.
export function refsDesPieces(doc: Doc, rows: DebitRow[]): Map<number, string> {
  const cles = new Map<number, string>();
  rowsFromModel(doc, 1, cles);
  const parCle = new Map(rows.filter((r) => r.key).map((r) => [r.key!, r.ref]));
  const out = new Map<number, string>();
  for (const [id, k] of cles) { const r = parCle.get(k); if (r) out.set(id, r); }
  return out;
}
