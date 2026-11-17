import { beforeAll, describe, expect, it } from 'vitest';
import { addSegments, emptyDoc, initKernel, planeFromNormal, pushPullRegion, pieceDims, translateMesh, rotateMesh } from './model';
import { coutChant, rowsFromModel, syncFromModel, totals, toCsv } from './debit';

beforeAll(async () => { await initKernel(); });
const ground = planeFromNormal([0, 0, 0], [0, 0, 1]);
const board = (w: number, h: number, t: number, name = 'Étagère') => {
  const doc = emptyDoc();
  addSegments(doc, ground, [[[0, 0], [w, 0]], [[w, 0], [w, h]], [[w, h], [0, h]], [[0, h], [0, 0]]]);
  const r = pushPullRegion(doc, ground, [w / 2, h / 2], t)!;
  r.doc.solids[0]!.name = name;
  return r.doc;
};

describe('pièces et fiche de débit', () => {
  it('lit les dimensions L ≥ l ≥ e quelle que soit l\'orientation', () => {
    const doc = board(0.2, 0.8, 0.018);
    const d = pieceDims(doc.solids[0]!.mesh);
    expect(d.L).toBeCloseTo(0.8, 4); expect(d.l).toBeCloseTo(0.2, 4); expect(d.e).toBeCloseTo(0.018, 4);
    const m = rotateMesh(translateMesh(doc.solids[0]!.mesh, [1, 2, 3]), [1, 2, 3], [1, 1, 0], 0.7);
    const d2 = pieceDims(m);
    expect(d2.L).toBeCloseTo(0.8, 3); expect(d2.l).toBeCloseTo(0.2, 3); expect(d2.e).toBeCloseTo(0.018, 3);
  });

  it('regroupe les pièces identiques et calcule les totaux', () => {
    const a = board(0.2, 0.8, 0.018);
    const b = board(0.8, 0.2, 0.018); // même pièce tournée
    a.solids.push({ ...b.solids[0]!, id: 99 });
    const rows = rowsFromModel(a, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ qte: 2, L: 800, l: 200, e: 18 });
    const t = totals(rows);
    expect(t.pieces).toBe(2);
    expect(t.surface).toBeCloseTo(0.32, 5);
    expect(toCsv(rows)).toContain('"Étagère";"2"'.slice(0, 0) + '"Étagère"');
  });

  it('synchronise sans écraser les lignes modifiées ni les lignes manuelles', () => {
    const doc = board(0.2, 0.8, 0.018);
    let rows = syncFromModel(doc, [], 1);
    expect(rows).toHaveLength(1);
    rows[0]!.matiere = 'Chêne'; rows[0]!.edited = true;
    rows.push({ id: 50, src: 'manuel', ref: 'X', nom: 'Tasseau', qte: 4, L: 500, l: 30, e: 30, matiere: '', fil: 'aucun', chants: '', note: '' });
    rows = syncFromModel(doc, rows, 60);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.matiere).toBe('Chêne');
    // la pièce disparaît du modèle : la ligne modifiée devient manuelle, rien n'est perdu
    doc.solids = [];
    rows = syncFromModel(doc, rows, 70);
    expect(rows.map((r) => r.src)).toEqual(['manuel', 'manuel']);
    // une nouvelle pièce reprend la référence P1 : l'ancienne ligne gardée en change
    doc.solids = board(0.3, 0.9, 0.018).solids;
    rows = syncFromModel(doc, rows, 80);
    expect(rows.map((r) => r.ref)).toEqual(['P1', 'P2', 'X']);
  });

  it('deux couleurs sur le même panneau : deux lignes, même matière pour le stock', () => {
    const doc = board(0.2, 0.8, 0.018);
    doc.solids.push({ ...doc.solids[0]!, id: 99, meta: { ...doc.solids[0]!.meta } });
    doc.methods = [
      { id: 1, nom: 'MDF vert', matiere: 'MDF 18', chant: '', chantEp: 0, cotes: '', deduire: false, couleur: '#5b7f5a' },
      { id: 2, nom: 'MDF blanc', matiere: 'MDF 18', chant: '', chantEp: 0, cotes: '', deduire: false, couleur: '#ffffff' },
    ];
    doc.solids[0]!.meta.methode = 1; doc.solids[1]!.meta.methode = 2;
    const rows = rowsFromModel(doc, 1);
    expect(rows.map((r) => [r.matiere, r.couleur, r.qte])).toEqual([['MDF 18', '#5b7f5a', 1], ['MDF 18', '#ffffff', 1]]);
  });

  it('ligne retouchée d\'un fichier d\'avant les couleurs : toujours reconnue', () => {
    const doc = board(0.2, 0.8, 0.018);
    const r = rowsFromModel(doc, 1)[0]!;
    const ancienne = { ...r, key: r.key!.split('|').filter((_, i) => i !== 2).join('|'), nom: 'Étagère retouchée', edited: true };
    const rows = syncFromModel(doc, [ancienne], 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.nom).toBe('Étagère retouchée');
  });

  it('méthode : matière, chants par côté, cotes de coupe et mètres de chant', () => {
    const doc = board(0.2, 0.8, 0.018); // 800 × 200 × 18
    doc.methods = [{ id: 90, nom: 'Méla', matiere: 'Mélaminé blanc 18', chant: 'ABS 1', chantEp: 1, cotes: 'L1 L2 l1', deduire: true }];
    doc.solids[0]!.meta.methode = 90;
    let r = rowsFromModel(doc, 1)[0]!;
    expect(r.matiere).toBe('Mélaminé blanc 18');
    expect(r.chants).toBe('L1 L2 l1 (ABS 1)');
    expect(r.L).toBe(799);  // un petit côté plaqué : -1 sur la longueur
    expect(r.l).toBe(198);  // deux grands côtés plaqués : -2 sur la largeur
    expect(r.ml).toBeCloseTo(1.8, 5); // 800 + 800 + 200 mm
    expect(totals([r]).chant).toBeCloseTo(1.8, 5);
    expect(coutChant(doc)).toBe(0);
    doc.methods[0]!.chantPrix = 0.5;
    expect(coutChant(doc)).toBeCloseTo(0.9, 5);
    // réglage propre à la pièce, et méthode sans déduction
    doc.solids[0]!.meta.chants = 'L1';
    doc.methods[0]!.deduire = false;
    r = rowsFromModel(doc, 1)[0]!;
    expect([r.L, r.l, r.chants]).toEqual([800, 200, 'L1 (ABS 1)']);
  });
});
