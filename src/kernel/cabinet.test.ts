import { describe, expect, it } from 'vitest';
import { CAISSON_DEFAUT, deplacerMontant, fixerLargeur, genererCaisson, verifier, videsColonnes, type CaissonParams, type PanneauCaisson } from './cabinet';

const dims = (b: { min: number[]; max: number[] }) => [0, 1, 2].map((i) => Math.round((b.max[i]! - b.min[i]!) * 1e4) / 10);
const noms = (ps: PanneauCaisson[], n: string) => ps.filter((p) => p.nom === n);
const q = (c: ReturnType<typeof genererCaisson>, n: string) => c.quincaillerie.find((x) => x.nom.startsWith(n))?.qte ?? 0;

// Aucun panneau ne doit en traverser un autre (contact autorisé).
function sansCollision(ps: PanneauCaisson[]) {
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const a = ps[i]!, b = ps[j]!;
    const chevauche = [0, 1, 2].every((k) => Math.min(a.max[k]!, b.max[k]!) - Math.max(a.min[k]!, b.min[k]!) > 1e-6);
    expect(chevauche, `${a.nom} / ${b.nom}`).toBe(false);
  }
}

describe('générateur de caisson', () => {
  it('donne les bons panneaux pour une bibliothèque 2 colonnes', () => {
    const c = genererCaisson(CAISSON_DEFAUT);
    const ps = c.panneaux;
    expect(['Côté', 'Dessus', 'Dessous', 'Montant', 'Étagère', 'Fond', 'Plinthe'].map((n) => noms(ps, n).length)).toEqual([2, 1, 1, 1, 8, 1, 1]);
    expect(dims(noms(ps, 'Côté')[0]!)).toEqual([18, 500, 2000]);
    expect(dims(noms(ps, 'Dessus')[0]!)).toEqual([964, 500, 18]);
    expect(dims(noms(ps, 'Montant')[0]!)).toEqual([18, 500, 1884]);
    expect(dims(noms(ps, 'Étagère')[0]!)).toEqual([473, 480, 18]);
    expect(dims(noms(ps, 'Fond')[0]!)).toEqual([1000, 3, 1920]);
    expect(q(c, 'Taquets')).toBe(32);
    sansCollision(ps);
  });

  it('répartit les étagères avec des vides égaux', () => {
    const ps = genererCaisson({ ...CAISSON_DEFAUT, colonnes: 1, types: ['etageres'], etageres: 3 }).panneaux;
    const zs = noms(ps, 'Étagère').map((p) => p.min[2]).sort((a, b) => a - b);
    const vides = [zs[0]! - 0.098, zs[1]! - zs[0]! - 0.018, zs[2]! - zs[1]! - 0.018, 1.982 - zs[2]! - 0.018];
    for (const v of vides) expect(v).toBeCloseTo(vides[0]!, 6);
  });

  it('dressing : penderie, tiroirs et portes, sans collision', () => {
    const p: CaissonParams = { ...CAISSON_DEFAUT, L: 1600, colonnes: 3, types: ['penderie', 'tiroirs', 'etageres'], portes: true, P: 580 };
    const c = genererCaisson(p);
    const ps = c.panneaux;
    sansCollision(ps);
    expect(noms(ps, 'Tringle')).toHaveLength(1);
    expect(noms(ps, 'Tringle')[0]!.piece).toBe(false);
    expect(noms(ps, 'Façade tiroir')).toHaveLength(3);
    expect(noms(ps, 'Côté tiroir')).toHaveLength(6);
    expect(noms(ps, 'Tablette')).toHaveLength(1);
    // une porte par colonne étagères/penderie, et une au-dessus des tiroirs
    expect(noms(ps, 'Porte')).toHaveLength(3);
    expect(q(c, 'Supports de tringle')).toBe(2);
    expect(q(c, 'Charnières') + q(c, 'Coulisses') + q(c, 'Poignées')).toBe(0);    // calculées par les portes et tiroirs
    // chaque façade et chaque pièce de tiroir porte son rôle ; un tiroir = une clé, avec sa façade
    const tiroirs = new Map<string, PanneauCaisson[]>();
    for (const x of ps) if (x.role?.type === 'tiroir') tiroirs.set(x.role.cle, [...(tiroirs.get(x.role.cle) ?? []), x]);
    expect(tiroirs.size).toBe(3);
    for (const l of tiroirs.values()) { expect(l.filter((x) => x.role?.type === 'tiroir' && x.role.facade)).toHaveLength(1); expect(l).toHaveLength(6); }
    expect([...tiroirs.values()][0]![0]!.role).toMatchObject({ coulisse: 550 });
    expect(noms(ps, 'Porte').every((x) => x.role?.type === 'porte')).toBe(true);
    // façades en applique : elles couvrent toute la largeur, avec le jeu
    const facades = [...noms(ps, 'Porte'), ...noms(ps, 'Façade tiroir')];
    expect(Math.min(...facades.map((f) => f.min[0]))).toBeCloseTo(0.0015, 6);
    expect(Math.max(...facades.map((f) => f.max[0]))).toBeCloseTo(1.5985, 6);
  });

  it('deux portes au-delà de 600 mm de façade', () => {
    const ps = genererCaisson({ ...CAISSON_DEFAUT, L: 900, colonnes: 1, types: ['etageres'], portes: true }).panneaux;
    expect(noms(ps, 'Porte')).toHaveLength(2);
    // charnières vers l'extérieur : la porte de gauche à gauche, celle de droite à droite
    expect(noms(ps, 'Porte').map((x) => x.role?.type === 'porte' && x.role.charnieres)).toEqual(['gauche', 'droite']);
    sansCollision(ps);
  });

  it('refuse les cotes impossibles', () => {
    expect(verifier({ ...CAISSON_DEFAUT, colonnes: 12, L: 600 })).toMatch(/étroite/);
    expect(verifier({ ...CAISSON_DEFAUT, H: 100 })).toMatch(/Hauteur/);
    expect(verifier({ ...CAISSON_DEFAUT, types: ['tiroirs', 'etageres'], tiroirs: 10 })).toMatch(/tiroirs dépassent/);
    expect(verifier({ ...CAISSON_DEFAUT, H: 900, types: ['penderie', 'etageres'] })).toMatch(/penderie/);
    expect(() => genererCaisson({ ...CAISSON_DEFAUT, e: 0 })).toThrow();
    expect(verifier(CAISSON_DEFAUT)).toBeNull();
  });

  it('sans fond ni plinthe', () => {
    const ps = genererCaisson({ ...CAISSON_DEFAUT, fond: 0, plinthe: 0 }).panneaux;
    expect(ps.some((p) => p.nom === 'Fond' || p.nom === 'Plinthe')).toBe(false);
    expect(noms(ps, 'Dessous')[0]!.min[2]).toBe(0);
  });

  it('déplace un montant : les colonnes voisines s\'adaptent, tiroirs et étagères suivent', () => {
    const base: CaissonParams = { ...CAISSON_DEFAUT, L: 1200, colonnes: 2, types: ['tiroirs', 'etageres'] };
    expect(videsColonnes(base)).toEqual([573, 573]);
    const p = deplacerMontant(base, 0, 100);
    expect(videsColonnes(p)).toEqual([673, 473]);
    const ps = genererCaisson(p).panneaux;
    sansCollision(ps);
    expect(dims(noms(ps, 'Montant')[0]!)[0]).toBe(18);
    expect(noms(ps, 'Montant')[0]!.min[0]).toBeCloseTo((18 + 673) / 1000, 6);
    // tiroirs à la largeur de leur colonne : 673 - 2 × 13 de coulisses
    expect(dims(noms(ps, 'Fond tiroir')[0]!)[0]).toBe(647);
    expect(dims(noms(ps, 'Étagère').find((e) => e.min[0] > 0.7)!)[0]).toBe(473);
  });

  it('agrandir le meuble garde la répartition des colonnes', () => {
    const p = deplacerMontant({ ...CAISSON_DEFAUT, L: 1018, colonnes: 2 }, 0, 245); // 482 + 245 = 727 et 482 - 245 = 237
    const v = videsColonnes({ ...p, L: 1982 });
    expect(v[0]! / v[1]!).toBeCloseTo(727 / 237, 6);
    expect(v[0]! + v[1]!).toBeCloseTo(1982 - 54, 6);
  });

  it('fixe la largeur d\'une colonne, la voisine compense, et refuse une colonne trop étroite', () => {
    const p = fixerLargeur({ ...CAISSON_DEFAUT, L: 1500, colonnes: 3, types: ['etageres', 'etageres', 'etageres'] }, 2, 600);
    const v = videsColonnes(p);
    expect(v[2]).toBeCloseTo(600, 6);
    expect(v[0]! + v[1]! + v[2]!).toBeCloseTo(1500 - 72, 6);
    expect(verifier(deplacerMontant(p, 0, 500))).toMatch(/étroite/);
  });
});

describe('modèles de départ', () => {
  it('sont tous valides', async () => {
    const { MODELES } = await import('./cabinet');
    for (const m of MODELES) expect(verifier({ ...CAISSON_DEFAUT, ...m.params }), m.nom).toBeNull();
  });
});

describe('penderie sur tiroirs', () => {
  it('tiroirs en bas, tablette, étagère haute et tringle, sans collision', () => {
    const c = genererCaisson({ ...CAISSON_DEFAUT, L: 1100, H: 2230, P: 500, colonnes: 1, types: ['penderie_tiroirs'], tiroirs: 2, hTiroir: 200, fond: 0 });
    const ps = c.panneaux;
    sansCollision(ps);
    expect(noms(ps, 'Façade tiroir')).toHaveLength(2);
    expect(noms(ps, 'Tablette')).toHaveLength(1);
    expect(noms(ps, 'Tringle')).toHaveLength(1);
    expect(noms(ps, 'Étagère')).toHaveLength(1);
    // vide sous la tringle : du dessus de la tablette au bas de la tringle
    const t = noms(ps, 'Tablette')[0]!, tr = noms(ps, 'Tringle')[0]!;
    expect((tr.min[2] - t.max[2]) * 1000).toBeGreaterThan(1300);
    expect(verifier({ ...CAISSON_DEFAUT, L: 1100, H: 2230, colonnes: 1, types: ['penderie_tiroirs'], tiroirs: 5, hTiroir: 200 })).toMatch(/pendre/);
  });
});

describe('montants pleine hauteur', () => {
  it('dessus, dessous et plinthe par colonne, montants du sol au dessus, sans collision', () => {
    const p: CaissonParams = { ...CAISSON_DEFAUT, L: 2960, H: 2230, P: 500, colonnes: 3, types: ['tiroirs', 'penderie_tiroirs', 'tiroirs'], largeurs: [912, 1064, 912], tiroirs: 2, etageres: 3, fond: 0, montantsPleins: true };
    const ps = genererCaisson(p).panneaux;
    sansCollision(ps);
    expect(noms(ps, 'Dessus').map((x) => dims(x)[0])).toEqual([912, 1064, 912]);
    expect(noms(ps, 'Plinthe')).toHaveLength(3);
    expect(noms(ps, 'Montant').every((x) => x.min[2] === 0 && x.max[2] === 2.23)).toBe(true);
    // aucune pièce plus longue qu'un panneau de 2500
    expect(Math.max(...ps.map((x) => Math.max(...dims(x))))).toBeLessThanOrEqual(2500);
  });
});
