import { beforeAll, describe, expect, it } from 'vitest';
import { decorParNom, uvDecor } from './decor';
import { boxMesh, initKernel, type V3 } from './model';

beforeAll(async () => { await initKernel(); });

const motif = { u: 1, v: 0.1 };

describe('décors', () => {
  it('devine le décor d\'après le nom', () => {
    expect(decorParNom('Hêtre lamellé-collé 18')).toBe('lamelle');
    expect(decorParNom('Contreplaqué naturel 18')).toBe('contreplaque');
    expect(decorParNom('MDF 18 peint')).toBe('uni');
    expect(decorParNom('MDF laqué blanc')).toBe('uni');
    expect(decorParNom('MDF 18')).toBe('mdf');
    expect(decorParNom('Chêne massif 38')).toBe('bois');
    expect(decorParNom('Mélaminé chêne 18')).toBe('uni');
    expect(decorParNom('Tissu anthracite')).toBe('tissu');
  });

  it('coordonnées de texture : faces puis chants, fil le long de la pièce, ordre des triangles gardé', () => {
    // étagère 800 × 300 × 18 mm, à plat : le fil suit X
    const m = boxMesh([0, 0, 0] as V3, [0.8, 0.3, 0.018] as V3);
    const r = uvDecor(m, 'aucun', motif, motif, 1);
    expect(r.pos.length / 3).toBe(m.t.length);                  // un sommet par coin de triangle
    expect(r.nFaces).toBe(12);                                   // dessus et dessous : 4 triangles
    expect([...r.ordre].sort((a, b) => a - b)).toEqual([...Array(m.t.length / 3).keys()]);
    // sur les faces, u varie avec X (longueur), v avec Y
    const us: number[] = [], vs: number[] = [];
    for (let i = 0; i < r.nFaces; i++) { us.push(r.uv[2 * i]!); vs.push(r.uv[2 * i + 1]!); }
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(0.8 / motif.u, 6);
    expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(0.3 / motif.v, 6);
    // fil en largeur : u suit Y
    const t = uvDecor(m, 'l', motif, motif, 1), ut: number[] = [];
    for (let i = 0; i < t.nFaces; i++) ut.push(t.uv[2 * i]!);
    expect(Math.max(...ut) - Math.min(...ut)).toBeCloseTo(0.3 / motif.u, 6);
  });

  it('chants : v suit l\'épaisseur', () => {
    const m = boxMesh([0, 0, 0] as V3, [0.018, 0.5, 0.8] as V3);   // côté debout, épaisseur en X
    const r = uvDecor(m, 'aucun', motif, { u: 1, v: 0.006 }, 3);
    const vs: number[] = [];
    for (let i = r.nFaces; i < r.pos.length / 3; i++) vs.push(r.uv[2 * i + 1]!);
    expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(0.018 / 0.006, 6);
  });
});
