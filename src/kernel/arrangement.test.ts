import { describe, expect, it } from 'vitest';
import { arrange, regionAt, type Seg2, type P2 } from './arrangement';

const rect = (x0: number, y0: number, x1: number, y1: number): Seg2[] => [
  [[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]],
];

describe('arrangement 2D', () => {
  it("ferme un rectangle en une région", () => {
    const r = arrange(rect(0, 0, 2, 1));
    expect(r).toHaveLength(1);
    expect(r[0]!.area).toBeCloseTo(2);
  });

  it('ignore une ligne ouverte', () => {
    expect(arrange([[[0, 0], [1, 0]], [[1, 0], [1, 1]]])).toHaveLength(0);
  });

  it('coupe un rectangle en deux avec une ligne traversante', () => {
    const r = arrange([...rect(0, 0, 2, 1), [[1, -1], [1, 2]]]);
    expect(r).toHaveLength(2);
    expect(r.map((x) => x.area).sort()).toEqual([1, 1]);
  });

  it('crée un trou pour un îlot, et une région pour l\'îlot', () => {
    const r = arrange([...rect(0, 0, 4, 4), ...rect(1, 1, 2, 2)]);
    expect(r).toHaveLength(2);
    const big = r.find((x) => x.holes.length === 1)!;
    expect(big.area).toBeCloseTo(15);
    expect(regionAt(r, [1.5, 1.5] as P2)!.area).toBeCloseTo(1);
    expect(regionAt(r, [3, 3] as P2)!.area).toBeCloseTo(15);
  });

  it('gère un rectangle collé au bord (région en L)', () => {
    const r = arrange([...rect(0, 0, 4, 4), ...rect(0, 0, 1, 1)]);
    expect(r.map((x) => x.area).sort((a, b) => a - b)).toEqual([1, 15]);
  });

  it('élague les bouts pendants', () => {
    const r = arrange([...rect(0, 0, 1, 1), [[1, 1], [3, 3]]]);
    expect(r).toHaveLength(1);
    expect(r[0]!.area).toBeCloseTo(1);
  });

  it('découpe une région avec un trait partiel qui touche le bord (reste une seule région)', () => {
    const r = arrange([...rect(0, 0, 2, 2), [[1, 0], [1, 1]]]);
    expect(r).toHaveLength(1);
    expect(r[0]!.area).toBeCloseTo(4);
  });
});
