import { beforeAll, describe, expect, it } from 'vitest';
import { exportCollada, fusionnerSommets, couleurMatiere } from './collada';
import { boxMesh, estManifold, initKernel, type Solid } from './model';

beforeAll(async () => { await initKernel(); });
const piece = (id: number, name: string, min: [number, number, number], max: [number, number, number], matiere = ''): Solid =>
  ({ id, name, mesh: boxMesh(min, max), meta: { piece: true, matiere, fil: 'aucun', note: '' } });

describe('Collada', () => {
  it('exporte une pièce par nœud, une matière par matériau, recalé à l\'origine', () => {
    const s = [piece(1, 'Côté', [1, 2, 0.1], [1.018, 2.5, 2.1], 'Chêne 18'), piece(2, 'Dessus & dessous', [1.018, 2, 2.082], [1.982, 2.5, 2.1], 'Chêne 18')];
    const dae = exportCollada(s, (x) => x.meta.matiere, undefined, new Date('2026-11-12T10:00:00Z'));
    expect(dae).toContain('<up_axis>Z_UP</up_axis>');
    expect(dae).toContain('<unit name="meter" meter="1"/>');
    expect(dae.match(/<node /g)).toHaveLength(2);
    expect(dae.match(/<material /g)).toHaveLength(1);
    expect(dae).toContain('name="Dessus &amp; dessous"');
    // coin bas avant gauche à l'origine
    const nums = [...dae.matchAll(/<float_array[^>]*>([^<]*)</g)].flatMap((m) => m[1]!.split(' ').map(Number));
    const xs = nums.filter((_, i) => i % 3 === 0), zs = nums.filter((_, i) => i % 3 === 2);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.min(...zs)).toBe(0);
    expect(Math.max(...xs)).toBeCloseTo(0.982, 5);
    // le XML est bien formé : autant de balises ouvrantes que fermantes pour les éléments à contenu
    for (const tag of ['COLLADA', 'geometry', 'mesh', 'source', 'node', 'library_geometries', 'visual_scene']) {
      expect((dae.match(new RegExp(`<${tag}[ >]`, 'g')) ?? []).length).toBe((dae.match(new RegExp(`</${tag}>`, 'g')) ?? []).length);
    }
  });

  it('fusionne les sommets répétés et garde une pièce fermée', () => {
    const m = boxMesh([0, 0, 0], [0.5, 0.3, 0.018]);
    // à la façon d'un fichier importé : trois sommets par triangle, sans index
    const brut: number[] = [];
    for (const i of m.t) brut.push(m.v[3 * i]!, m.v[3 * i + 1]!, m.v[3 * i + 2]!);
    const f = fusionnerSommets(brut, null);
    expect(f.v.length / 3).toBe(8);
    expect(f.t.length).toBe(m.t.length);
    expect(estManifold(f)).toBe(true);
    expect(estManifold({ v: [0, 0, 0, 1, 0, 0, 0, 1, 0], t: [0, 1, 2] })).toBe(false);
  });

  it('donne une couleur stable par matière', () => {
    expect(couleurMatiere('Mélaminé blanc 18')).toEqual([0.95, 0.95, 0.93]);
    expect(couleurMatiere('Bidule')).toEqual(couleurMatiere('bidule'));
  });
});
