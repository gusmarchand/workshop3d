import { beforeAll, describe, expect, it } from 'vitest';
import { boxMesh, initKernel, meshBounds, type Solid, type V3 } from './model';
import { transformer } from './echelle';

beforeAll(async () => { await initKernel(); });
const m = (v: number[]) => v.map((x) => x / 1000) as V3;
const p = (id: number, mn: number[], mx: number[]): Solid => ({ id, name: 'P', mesh: boxMesh(m(mn), m(mx)), meta: { piece: true, matiere: '', fil: 'aucun', note: '' } });
const dims = (s: Solid) => { const b = meshBounds(s.mesh); return [0, 1, 2].map((k) => Math.round((b.max[k]! - b.min[k]!) * 1000)); };
const min = (s: Solid) => meshBounds(s.mesh).min.map((x) => Math.round(x * 1000));
// petit meuble : deux côtés, une tablette entre eux, un montant au milieu (sur la tablette)
const meuble = () => [p(1, [0, 0, 0], [38, 400, 1000]), p(2, [962, 0, 0], [1000, 400, 1000]), p(3, [38, 0, 500], [962, 400, 538]), p(4, [481, 0, 538], [519, 400, 1000])];

describe('échelle', () => {
  it('homothétie : tout grandit, épaisseurs comprises', () => {
    const ps = meuble();
    transformer(ps, [1.1, 1, 1], [0, 0, 0], 'echelle');
    expect(dims(ps[0]!)[0]).toBe(42);
    expect(dims(ps[2]!)[0]).toBe(1016);
  });
  it('étirer : +100 mm, panneaux de 38 gardés, tablette rallongée, côté droit poussé, montant central intact', () => {
    const ps = meuble();
    transformer(ps, [1.1, 1, 1], [0, 0, 0], 'etirer');
    expect(ps.map((s) => dims(s)[0])).toEqual([38, 38, 1024, 38]);
    expect(min(ps[1]!)[0]).toBe(1062);
    expect(min(ps[3]!)[0]).toBe(481);           // le plan passe au bord du montant, pas à travers
    expect(min(ps[2]!)[0]).toBe(38);
  });
  it('étirer depuis le centre : chaque côté bouge de la moitié', () => {
    const ps = meuble();
    transformer(ps, [1, 1, 1.2], [0.5, 0.2, 0.5], 'etirer');
    expect(min(ps[0]!)[2]).toBe(-100);           // côtés traversés par le plan : ils s'allongent des deux côtés
    expect(dims(ps[0]!)[2]).toBe(1200);
    expect(dims(ps[2]!)[2]).toBe(38);            // tablette mince en hauteur : déplacée, pas épaissie
  });
});
