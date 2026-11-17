import { beforeAll, describe, expect, it } from 'vitest';
import { sansMeublesVides, duplicateSolid, makeComponent, makeUnique, moveSolid, rotateSolid, meshBounds, addSegments, emptyDoc, initKernel, planarFaces, planeFromNormal, planeRegions, pushPullRegion, volumeOf, type Doc, type V3 } from './model';
import type { P2, Seg2 } from './arrangement';

const rect = (x0: number, y0: number, x1: number, y1: number): Seg2[] => [
  [[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]],
];
const ground = planeFromNormal([0, 0, 0], [0, 0, 1]);

beforeAll(async () => { await initKernel(); });

function column(): Doc {
  const doc = emptyDoc();
  addSegments(doc, ground, rect(0, 0, 0.4, 0.3));
  const r = pushPullRegion(doc, ground, [0.2, 0.15], 0.5)!;
  return r.doc;
}

describe('noyau 3D', () => {
  it('extrude un rectangle au sol en solide', () => {
    const doc = column();
    expect(doc.solids).toHaveLength(1);
    expect(volumeOf(doc.solids[0]!.mesh)).toBeCloseTo(0.4 * 0.3 * 0.5, 5);
    expect(doc.sketches).toHaveLength(0);
  });

  it('retrouve 6 faces planes sur un caisson', () => {
    expect(planarFaces(column().solids[0]!.mesh)).toHaveLength(6);
  });

  it('étend le solide en tirant la face du dessus', () => {
    const doc = column();
    const top = planeFromNormal([0, 0, 0.5], [0, 0, 1]);
    const r = pushPullRegion(doc, top, [0.2, 0.15], 0.25)!;
    expect(r.doc.solids).toHaveLength(1);
    expect(volumeOf(r.doc.solids[0]!.mesh)).toBeCloseTo(0.4 * 0.3 * 0.75, 5);
  });

  it('rentre la face du dessus (réduit le solide)', () => {
    const doc = column();
    const top = planeFromNormal([0, 0, 0.5], [0, 0, 1]);
    const r = pushPullRegion(doc, top, [0.2, 0.15], -0.2)!;
    expect(volumeOf(r.doc.solids[0]!.mesh)).toBeCloseTo(0.4 * 0.3 * 0.3, 5);
  });

  it('creuse une poche avec un rectangle tracé sur une face', () => {
    const doc = column();
    const top = planeFromNormal([0, 0, 0.5], [0, 0, 1]);
    addSegments(doc, top, rect(0.1, 0.1, 0.2, 0.2));
    const r = pushPullRegion(doc, top, [0.15, 0.15], -0.1)!;
    expect(volumeOf(r.doc.solids[0]!.mesh)).toBeCloseTo(0.4 * 0.3 * 0.5 - 0.1 * 0.1 * 0.1, 5);
    expect(r.doc.sketches).toHaveLength(0);
  });

  it('perce de part en part (volume réduit, un seul solide)', () => {
    const doc = column();
    const top = planeFromNormal([0, 0, 0.5], [0, 0, 1]);
    addSegments(doc, top, rect(0.1, 0.1, 0.2, 0.2));
    const r = pushPullRegion(doc, top, [0.15, 0.15], -0.5)!;
    expect(r.doc.solids).toHaveLength(1);
    expect(volumeOf(r.doc.solids[0]!.mesh)).toBeCloseTo(0.4 * 0.3 * 0.5 - 0.1 * 0.1 * 0.5, 5);
  });

  it('crée un tenon en tirant un rectangle tracé sur une face', () => {
    const doc = column();
    const top = planeFromNormal([0, 0, 0.5], [0, 0, 1]);
    addSegments(doc, top, rect(0.1, 0.1, 0.2, 0.2));
    const r = pushPullRegion(doc, top, [0.15, 0.15], 0.3)!;
    expect(volumeOf(r.doc.solids[0]!.mesh)).toBeCloseTo(0.4 * 0.3 * 0.5 + 0.1 * 0.1 * 0.3, 5);
  });

  it('sépare en deux solides si le résultat est coupé', () => {
    const doc = column();
    const top = planeFromNormal([0, 0, 0.5], [0, 0, 1]);
    addSegments(doc, top, [[[0.2, -1], [0.2, 1]]]);
    // la face est coupée en deux régions ; pousser une moitié à fond la retire complètement
    const regions = planeRegions(doc, top);
    expect(regions.length).toBeGreaterThanOrEqual(2);
    const r = pushPullRegion(doc, top, [0.3, 0.15] as P2, -0.5)!;
    expect(volumeOf(r.doc.solids[0]!.mesh)).toBeCloseTo(0.2 * 0.3 * 0.5, 5);
  });

  it('extrude vers le bas quand d est négatif sur un rectangle libre', () => {
    const doc = emptyDoc();
    addSegments(doc, ground, rect(0, 0, 1, 1));
    const r = pushPullRegion(doc, ground, [0.5, 0.5], -0.2)!;
    const vs = r.doc.solids[0]!.mesh.v;
    const zs = vs.filter((_, i) => i % 3 === 2);
    expect(Math.min(...zs)).toBeCloseTo(-0.2, 5);
    expect(volumeOf(r.doc.solids[0]!.mesh)).toBeCloseTo(0.2, 5);
  });

  it('plans sur une face latérale', () => {
    const doc = column();
    const side = planeFromNormal([0.4, 0, 0] as V3, [1, 0, 0]);
    addSegments(doc, side, rect(0.05, 0.1, 0.15, 0.2)); // coordonnées (u,v) du plan latéral
    const r = pushPullRegion(doc, side, [0.1, 0.15], -0.1);
    expect(r).not.toBeNull();
  });

  it('composant : modifier une instance modifie les copies, même déplacées et tournées', () => {
    const doc = column(); // 0,4 × 0,3 × 0,5
    const a = doc.solids[0]!;
    makeComponent(doc, a);
    const b = duplicateSolid(doc, a);
    moveSolid(b, [2, 0, 0]);
    rotateSolid(b, [2, 0, 0], [0, 1, 0], Math.PI / 2); // couchée : sa hauteur part vers +X
    const top = planeFromNormal([0, 0, 0.5], [0, 0, 1]);
    const r = pushPullRegion(doc, top, [0.2, 0.15], 0.25)!; // +0,25 de haut sur l'original
    const [a2, b2] = r.doc.solids;
    expect(volumeOf(a2!.mesh)).toBeCloseTo(0.4 * 0.3 * 0.75, 5);
    expect(volumeOf(b2!.mesh)).toBeCloseTo(0.4 * 0.3 * 0.75, 4);
    const bb = meshBounds(b2!.mesh);
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(0.75, 4); // la copie a grandi le long de X
    expect(bb.min[0]).toBeCloseTo(2, 4);
  });

  it('rendre unique coupe le lien', () => {
    const doc = column();
    makeComponent(doc, doc.solids[0]!);
    const b = duplicateSolid(doc, doc.solids[0]!);
    moveSolid(b, [2, 0, 0]);
    makeUnique(b);
    const r = pushPullRegion(doc, planeFromNormal([0, 0, 0.5], [0, 0, 1]), [0.2, 0.15], 0.25)!;
    expect(volumeOf(r.doc.solids[1]!.mesh)).toBeCloseTo(0.4 * 0.3 * 0.5, 5);
  });

  it('une copie simple est indépendante', () => {
    const doc = column();
    const b = duplicateSolid(doc, doc.solids[0]!);
    expect(b.id).not.toBe(doc.solids[0]!.id);
    expect(b.comp).toBeUndefined();
  });
});

describe('meubles vides', () => {
  it('retire un meuble sans pièce et sa quincaillerie, garde le reste', () => {
    const piece = (id: number, caisson?: number) => ({ id, name: 'P', mesh: { v: [], f: [] }, meta: { piece: true, matiere: '', fil: 'aucun' as const, note: '', caisson } });
    const d = { ...emptyDoc(), solids: [piece(10, 1), piece(11)], caissons: [1, 2].map((id) => ({ id, params: {} as never, methode: 0 })),
      extras: [{ id: 20, nom: 'Charnières', qte: 4, prix: 2, caisson: 1 }, { id: 21, nom: 'Poignées', qte: 2, prix: 5, caisson: 2 }, { id: 22, nom: 'Vis', qte: 100, prix: 0 }] } as unknown as Doc;
    const r = sansMeublesVides(d);
    expect(r.caissons!.map((c) => c.id)).toEqual([1]);
    expect(r.extras!.map((x) => x.id)).toEqual([20, 22]);
    expect(sansMeublesVides(r)).toBe(r);
  });
});
