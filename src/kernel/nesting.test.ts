import { describe, expect, it } from 'vitest';
import { appliquerDecoupe, chutesDe, fractionner, optimiser, planDecoupe, type Piece, type Plan } from './nesting';
import type { Panneau } from './model';

const pan = (o: Partial<Panneau>): Panneau => ({ id: 1, matiere: 'Méla', e: 18, L: 2800, l: 2070, qte: 0, prix: 60, ...o });
const piece = (L: number, l: number, fil: Piece['fil'] = 'aucun', ref = 'P'): Piece => ({ ref, nom: ref, L, l, fil });
const opt = { trait: 3, marge: 10 };

function sansChevauchement(plan: Plan, trait: number, marge = opt.marge) {
  for (const b of plan.bins) {
    for (const p of b.places) {
      expect(p.x).toBeGreaterThanOrEqual(marge - 1e-6);
      expect(p.x + p.w).toBeLessThanOrEqual(b.panneau.L - marge + 1e-6);
      expect(p.y + p.h).toBeLessThanOrEqual(b.panneau.l - marge + 1e-6);
    }
    for (let i = 0; i < b.places.length; i++) for (let j = i + 1; j < b.places.length; j++) {
      const a = b.places[i]!, c = b.places[j]!;
      const separes = a.x + a.w + trait <= c.x + 1e-6 || c.x + c.w + trait <= a.x + 1e-6 || a.y + a.h + trait <= c.y + 1e-6 || c.y + c.h + trait <= a.y + 1e-6;
      expect(separes).toBe(true);
    }
  }
}

describe('optimisation de découpe', () => {
  it('place tout sans chevauchement, trait de scie compris', () => {
    const pieces = [...Array(6)].map(() => piece(800, 500)).concat([...Array(8)].map(() => piece(600, 300)), [piece(2000, 580), piece(2000, 580)]);
    const plan = optimiser(pieces, [pan({})], opt);
    expect(plan.restants).toHaveLength(0);
    expect(plan.bins.reduce((s, b) => s + b.places.length, 0)).toBe(pieces.length);
    sansChevauchement(plan, opt.trait);
    expect(plan.bins.length).toBeLessThanOrEqual(2);
  });

  it('respecte le fil : pas de rotation', () => {
    const plan = optimiser([piece(2000, 400, 'L'), piece(400, 2000, 'l')], [pan({})], opt);
    expect(plan.bins[0]!.places.map((p) => [p.w, p.h, p.rot])).toEqual(expect.arrayContaining([[2000, 400, false], [2000, 400, true]]));
    // une pièce de 2500 à fil en travers ne rentre pas dans 2070 de large
    expect(optimiser([piece(2500, 300, 'l')], [pan({})], opt).restants).toHaveLength(1);
    expect(optimiser([piece(2500, 300)], [pan({})], opt).restants).toHaveLength(0);
  });

  it('utilise le stock et les chutes avant d\'acheter', () => {
    const stock = [pan({ id: 1, qte: 0, prix: 60 }), pan({ id: 2, L: 1200, l: 600, qte: 1, prix: 0 })];
    const plan = optimiser([piece(800, 500), piece(800, 500)], stock, opt);
    expect(plan.bins.map((b) => [b.panneau.id, b.achat])).toEqual(expect.arrayContaining([[2, false], [1, true]]));
    expect(plan.cout).toBe(60);
    // une seule pièce : la chute suffit, rien à acheter
    expect(optimiser([piece(800, 500)], stock, opt).cout).toBe(0);
  });

  it('signale les pièces trop grandes ou sans panneau', () => {
    expect(optimiser([piece(3000, 500)], [pan({})], opt).restants).toHaveLength(1);
    const r = planDecoupe([{ id: 1, src: 'manuel', ref: 'A', nom: 'Côté', qte: 2, L: 2000, l: 500, e: 18, matiere: 'Chêne', fil: 'L', chants: '', note: '' }], [pan({})], opt);
    expect(r.groupes[0]).toMatchObject({ sansPanneau: true, nbPieces: 2, decoupes: [], manques: [] });
    expect(r.groupes[0]!.plan.restants).toHaveLength(2);
  });

  it('regroupe par matière et épaisseur, sans tenir compte de la casse', () => {
    const rows = [
      { id: 1, src: 'manuel' as const, ref: 'A', nom: 'Côté', qte: 2, L: 2000, l: 500, e: 18, matiere: 'méla ', fil: 'aucun' as const, chants: '', note: '' },
      { id: 2, src: 'manuel' as const, ref: 'B', nom: 'Fond', qte: 1, L: 2000, l: 1000, e: 3, matiere: 'HDF', fil: 'aucun' as const, chants: '', note: '' },
    ];
    const r = planDecoupe(rows, [pan({ prix: 60 }), pan({ id: 2, matiere: 'HDF', e: 3, prix: 15 })], opt);
    expect(r.groupes).toHaveLength(2);
    expect(r.cout).toBe(75);
  });

  it('après découpe : le stock baisse et les chutes y entrent', () => {
    const stock = [pan({ id: 1, qte: 2, prix: 60 })];
    const plan = optimiser([piece(2000, 600), piece(2000, 600)], stock, opt);
    expect(plan.bins).toHaveLength(1);
    const chutes = chutesDe(plan);
    expect(chutes.length).toBeGreaterThan(0);
    let id = 100;
    const s2 = appliquerDecoupe(stock, plan, 'Méla', 18, () => id++);
    expect(s2.find((p) => p.id === 1)!.qte).toBe(1);
    expect(s2.filter((p) => p.chute).reduce((t, p) => t + p.qte, 0)).toBe(chutes.length);
    // la chute est réutilisée au plan suivant, avant un panneau neuf
    const plan2 = optimiser([piece(500, 300)], s2, opt);
    expect(plan2.bins[0]!.panneau.chute).toBe(true);
    // une chute consommée disparaît du stock
    const s3 = appliquerDecoupe(s2, plan2, 'Méla', 18, () => id++);
    expect(s3.some((p) => p.id === plan2.bins[0]!.panneau.id && p.qte === 0)).toBe(false);
  });

  it('coupe en morceaux une pièce plus grande que les panneaux', () => {
    const parts = fractionner(piece(3000, 500, 'L', 'A'), [pan({})], opt)!;
    expect(parts.map((p) => [p.L, p.l, p.nom])).toEqual([[1500, 500, 'A (morceau 1/2)'], [1500, 500, 'A (morceau 2/2)']]);
    // trop grande dans les deux sens : grille de morceaux
    expect(fractionner(piece(3000, 3000), [pan({})], opt)!).toHaveLength(4);
    // tournée, une pièce de 3000 × 2500 ne demande que 2 morceaux
    expect(fractionner(piece(3000, 2500), [pan({})], opt)!).toHaveLength(2);
    // une pièce qui rentre n'est pas coupée
    expect(fractionner(piece(2000, 500), [pan({})], opt)).toBeNull();
    const row = { id: 1, src: 'manuel' as const, ref: 'A', nom: 'Plan de travail', qte: 1, L: 3000, l: 600, e: 18, matiere: 'Méla', fil: 'L' as const, chants: '', note: '' };
    const r = planDecoupe([row], [pan({ prix: 60 })], opt);
    expect(r.groupes[0]!.decoupes).toEqual([{ ref: 'A', nom: 'Plan de travail', L: 3000, l: 600, qte: 1, n: 2, partL: 1500, partl: 600 }]);
    expect(r.groupes[0]!.plan.restants).toHaveLength(0);
    expect(r.groupes[0]!.plan.bins[0]!.places.map((q) => q.nom)).toEqual(['Plan de travail (morceau 1/2)', 'Plan de travail (morceau 2/2)']);
    // réglage désactivé : la pièce reste non placée
    expect(planDecoupe([row], [pan({ prix: 60 })], { ...opt, decouper: false }).groupes[0]!.plan.restants).toHaveLength(1);
  });

  it('stock insuffisant sans prix : propose les panneaux à acheter en plus', () => {
    const row = { id: 1, src: 'manuel' as const, ref: 'B', nom: 'Côté', qte: 6, L: 2000, l: 600, e: 18, matiere: 'Méla', fil: 'aucun' as const, chants: '', note: '' };
    const r = planDecoupe([row], [pan({ qte: 1, prix: 0 })], opt);
    const g = r.groupes[0]!;
    expect(g.plan.restants).toHaveLength(0);
    expect(g.manques).toEqual([{ L: 2800, l: 2070, n: 1 }]);
    expect(g.plan.cout).toBe(0);
    expect(g.plan.bins.filter((b) => !b.achat)).toHaveLength(1);
  });
});

describe('découpe en bandes', () => {
  it('une chute en stock sert d\'abord, le reste reste découpé en bandes', () => {
    const ps = [...Array.from({ length: 22 }, (_, i) => piece(i % 2 ? 1000 : 800, 395, 'aucun', `E${i}`)), ...[1, 2, 3, 4].map((i) => piece(500, 212, 'aucun', `T${i}`))];
    const sans = optimiser(ps, [pan({ L: 2440, l: 1220, prix: 50 })], opt);
    const avec = optimiser(ps, [pan({ L: 2440, l: 1220, prix: 50 }), pan({ id: 2, L: 1100, l: 450, qte: 1, prix: 0 })], opt);
    expect(avec.restants).toEqual([]);
    expect(avec.bins.some((b) => !b.achat && b.places.length > 0)).toBe(true);
    expect(avec.cout).toBeLessThanOrEqual(sans.cout);
    sansChevauchement(avec, 3);
  });

  it('essaie plusieurs largeurs de bande : fonds de caisson et de tiroir dans un seul panneau', () => {
    const ps = [...[1, 2, 3, 4].map((i) => piece(780, 600, 'aucun', `F${i}`)), ...[1, 2, 3].map((i) => piece(538, 500, 'aucun', `T${i}`))];
    const plan = optimiser(ps, [pan({ L: 2500, l: 1220, prix: 30 })], { trait: 3, marge: 0 });
    expect(plan.restants).toEqual([]);
    expect(plan.bins.length).toBe(1);
    sansChevauchement(plan, 3, 0);
  });

  it('étagères et montants de même profondeur : 3 panneaux de 2440 × 1220 au lieu de 4', () => {
    const lg = [2300, 2300, 2274, 2274, 1300, 1300, 924, 924, 924, 762, 762, 762, 580, 580, 580, 504, 358, 358, 358, 340, 312, 324];
    const pieces = lg.map((L, i) => ({ ref: `P${i}`, nom: 'Pièce', L: Math.max(L, 395), l: Math.min(L, 395), fil: 'aucun' as const }));
    const plan = optimiser(pieces, [{ id: 1, matiere: 'MDF 38', e: 38, L: 2440, l: 1220, qte: 0, prix: 119 }], { trait: 3, marge: 10 });
    expect(plan.restants).toHaveLength(0);
    expect(plan.bins).toHaveLength(3);
    // aucune pièce ne déborde ni n'en chevauche une autre
    for (const b of plan.bins) {
      for (const q of b.places) { expect(q.x + q.w).toBeLessThanOrEqual(2430 + 1e-6); expect(q.y + q.h).toBeLessThanOrEqual(1210 + 1e-6); }
      for (let i = 0; i < b.places.length; i++) for (let j = i + 1; j < b.places.length; j++) {
        const a = b.places[i]!, c = b.places[j]!;
        expect(Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x) > 0 && Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y) > 0).toBe(false);
      }
    }
  });
});
