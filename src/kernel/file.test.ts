import { describe, expect, it } from 'vitest';
import { parse, serialize } from './file';
import type { Saved } from './file';

const sample: Saved = {
  doc: {
    next: 7,
    solids: [{ id: 2, name: 'Côté', mesh: { v: [0, 0, 0, 1, 0, 0, 0, 1, 0], t: [0, 1, 2] }, comp: { id: 4, r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] }, meta: { piece: true, matiere: 'Chêne', fil: 'L', note: '', methode: 6, chants: 'L1 l1' } }],
    methods: [{ id: 6, nom: 'Méla blanc', matiere: 'Mélaminé blanc 18', chant: 'ABS 1', chantEp: 1, cotes: 'L1 L2', deduire: true, chantPrix: 0.8, decor: 'lamelle' }],
    stock: [{ id: 5, matiere: 'Mélaminé blanc 18', e: 18, L: 2800, l: 2070, qte: 1, prix: 62 }],
    extras: [{ id: 4, nom: 'Charnière', qte: 6, prix: 2.5 }],
    reglages: { trait: 3, marge: 10 },
    guides: [{ id: 3, p: [0, 0.3, 0], d: [1, 0, 0] }],
    caissons: [{ id: 6, params: { L: 1000, H: 2000, P: 500, e: 18, colonnes: 2, types: ['penderie', 'tiroirs'], etageres: 4, tiroirs: 3, hTiroir: 200, portes: true, jeu: 3, fond: 3, plinthe: 80, retrait: 20 }, methode: 6 }],
    sketches: [{ id: 3, plane: { o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] }, segs: [[[0, 0], [1, 0]]] }],
  },
  debit: [{ id: 1, src: 'manuel', ref: 'A', nom: 'Tasseau', qte: 2, L: 500, l: 30, e: 30, matiere: '', fil: 'aucun', chants: '', note: '' }],
};

describe('fichier .workshop', () => {
  it('fait un aller-retour sans perte', () => {
    expect(parse(serialize(sample))).toEqual(sample);
  });
  it('refuse ce qui n\'est pas un fichier Workshop 3D', () => {
    expect(() => parse('pas du json')).toThrow(/JSON/);
    expect(() => parse('{"format":"autre"}')).toThrow(/Workshop 3D/);
    expect(() => parse('{"format":"workshop3d","version":99,"doc":{}}')).toThrow(/version/);
  });
  it('ouvre encore un ancien fichier (format atelier3d)', () => {
    const ancien = serialize(sample).replace('"workshop3d"', '"atelier3d"');
    expect(parse(ancien)).toEqual(sample);
  });
  it('refuse un maillage corrompu', () => {
    const bad = JSON.parse(serialize(sample));
    bad.doc.solids[0].mesh.t = [0, 1, 7];
    expect(() => parse(JSON.stringify(bad))).toThrow(/indices/);
    bad.doc.solids[0].mesh.t = [0, 1, 2];
    bad.doc.solids[0].mesh.v = [0, 0, 'x'];
    expect(() => parse(JSON.stringify(bad))).toThrow(/maillage/);
  });
  it('répare next pour éviter les collisions d\'identifiants', () => {
    const f = JSON.parse(serialize(sample));
    f.doc.next = 1;
    expect(parse(JSON.stringify(f)).doc.next).toBe(7);
  });
});
