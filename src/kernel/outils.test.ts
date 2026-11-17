import { beforeAll, describe, expect, it } from 'vitest';
import { boxMesh, emptyDoc, initKernel, prismMesh, type Doc, type Solid, type V3 } from './model';
import { plafondDepuisPiece, hauteurPlafond, piecesSousPlafond, balayagePlafond, type Plafond } from './plafond';
import { controler, porteeLibre } from './controle';
import { fichePercage } from './percage';
import { liaisons, listeCourses } from './courses';
import { refsDesPieces, syncFromModel } from './debit';
import type { Porte } from './elements';

beforeAll(async () => { await initKernel(); });
const m = (v: number[]) => v.map((x) => x / 1000) as V3;
function piece(d: Doc, nom: string, min: number[], max: number[]): Solid {
  const s: Solid = { id: d.next++, name: nom, mesh: boxMesh(m(min), m(max)), meta: { piece: true, matiere: 'Méla 18', fil: 'aucun', note: '' } };
  d.solids.push(s); return s;
}
// Pente de 30° qui monte vers +Y : 1000 mm de haut en Y = 0.
const P30: Plafond = { angle: 30, hauteur: 1000, axe: 1, sens: 1, position: 0 };

describe('plafond en pente', () => {
  it('hauteur le long de la pente, et pente relevée sur un rampant', () => {
    expect(hauteurPlafond(P30, [0, 1, 0]) * 1000).toBeCloseTo(1000 + 577.35, 1);
    const t = Math.tan(Math.PI / 6);
    const rampant: Solid = { id: 1, name: 'Rampant', meta: { piece: true, matiere: '', fil: 'aucun', note: '' },
      mesh: prismMesh(0, [[0, 1], [1, 1 + t], [1, 1.02 + t], [0, 1.02]], 0, 0.6) };
    const p = plafondDepuisPiece(rampant)!;
    expect(p).toMatchObject({ angle: 30, axe: 1, sens: 1 });
    expect(hauteurPlafond(p, [0, 0.5, 0])).toBeCloseTo(1.02 + 0.5 * t, 3);
  });

  it('pièce trop haute, et porte qui tape en s\'ouvrant du côté bas', () => {
    const d = emptyDoc();
    piece(d, 'Côté', [0, 0, 0], [600, 18, 1000]);
    const haute = piece(d, 'Montant', [0, 500, 0], [600, 518, 1400]);
    const porte = piece(d, 'Porte', [-18, 0, 100], [0, 500, 1000]);
    expect(piecesSousPlafond(d, P30).map((x) => x.id)).toEqual([haute.id]);
    const el = (ch: 'gauche' | 'droite'): Porte => ({ id: 9, type: 'porte', piece: porte.id, charnieres: ch, recouvrement: 'applique', ouverture: 110, entraxe: 0 });
    // vue de face (depuis -X), la droite est -Y : charnières à droite = côté bas de la pente
    expect(balayagePlafond(d, P30, el('droite'))).not.toBeNull();
    expect(balayagePlafond(d, P30, el('gauche'))).toBeNull();
  });
});

describe('contrôle', () => {
  it('collision, portée trop longue, pièce sans matériau', () => {
    const d = emptyDoc();
    piece(d, 'Montant A', [0, 0, 0], [600, 18, 800]);
    piece(d, 'Montant B', [0, 1018, 0], [600, 1036, 800]);
    const t = piece(d, 'Tablette', [0, 0, 800], [600, 1036, 818]);
    piece(d, 'Intrus', [100, 500, 790], [200, 600, 810]).meta.matiere = '';
    expect(porteeLibre(d, t)!.portee * 1000).toBeCloseTo(1000, 1);
    const p = controler(d);
    expect(p.some((x) => x.niveau === 'erreur' && x.message.includes('se traversent'))).toBe(true);
    expect(p.some((x) => x.message.includes('entre deux appuis'))).toBe(true);
    expect(p.some((x) => x.message.includes('sans matériau'))).toBe(true);
  });

  it('pas d\'alerte de portée pour le dessus ou le dessous d\'un caisson', () => {
    const d = emptyDoc();
    piece(d, 'Côté', [0, 0, 0], [600, 18, 1000]);
    piece(d, 'Côté', [0, 1018, 0], [600, 1036, 1000]);
    const dessus = piece(d, 'Dessus', [0, 18, 982], [600, 1018, 1000]);
    const dessous = piece(d, 'Dessous', [0, 18, 80], [600, 1018, 98]);
    const tab = piece(d, 'Tablette', [0, 18, 500], [600, 1018, 518]);
    expect([dessus, dessous, tab].map((s) => porteeLibre(d, s)!.fixe)).toEqual([true, true, false]);
    expect(controler(d).map((x) => x.ids[0])).toEqual([tab.id]);
    // tablette étroite tenue par ses petits côtés : portée = sa largeur, pas de porte-à-faux
    const etroite = piece(d, 'Tablette étroite', [0, 18, 700], [600, 368, 718]);
    piece(d, 'Montant', [0, 368, 98], [600, 386, 982]);
    const p = porteeLibre(d, etroite)!;
    expect(Math.round(p.portee * 1000)).toBe(350);
    expect(p.porteAFaux).toBeLessThan(0.001);
    // étagère haute suspendue au dessus par un montant au milieu : deux demi-portées
    const haute = piece(d, 'Étagère haute', [0, 18, 900], [600, 1018, 918]);
    piece(d, 'Montant haut', [0, 509, 918], [600, 527, 982]);
    expect(Math.round(porteeLibre(d, haute)!.portee * 1000)).toBe(491);
  });
});

describe('perçage, courses, repères', () => {
  function meuble() {
    const d = emptyDoc();
    piece(d, 'Côté', [0, 0, 0], [600, 18, 1000]);
    piece(d, 'Côté', [0, 482, 0], [600, 500, 1000]);
    piece(d, 'Dessus', [0, 18, 982], [600, 482, 1000]);
    const porte = piece(d, 'Porte', [-19, 1.5, 100], [0, 498.5, 900]);
    d.elements = [{ id: 50, type: 'porte', piece: porte.id, charnieres: 'gauche', recouvrement: 'applique', ouverture: 110, entraxe: 128 }];
    d.extras = [{ id: 60, nom: 'Charnières en applique 110°', qte: 2, prix: 3, auto: true }, { id: 61, nom: 'Poignées entraxe 128 mm', qte: 1, prix: 0, auto: true }];
    return { d, porte };
  }
  it('fiche de perçage : cuvettes à 22,5 du chant et à 100 mm des bords, vis de poignée', () => {
    const { d } = meuble();
    const f = fichePercage(d, d.elements![0]!)!;
    expect(f).toMatchObject({ largeur: 497, hauteur: 800, epaisseur: 19 });
    const cuv = f.trous.filter((t) => t.diam === 35);
    expect(cuv.map((t) => [t.u, t.v])).toEqual([[22.5, 100], [22.5, 700]]);    // charnières à gauche, vu de face
    expect(f.trous.filter((t) => t.diam === 5)).toHaveLength(2);
  });
  it('liste de courses : liaisons et visserie estimées, quincaillerie reprise', () => {
    const { d } = meuble();
    expect(liaisons(d)).toBe(2);                                   // dessus sur chaque côté (la porte est devant, sans contact)
    const l = listeCourses(d, syncFromModel(d, [], 1)).lignes;
    expect(l.find((x) => x.nom.startsWith('Vis d\'assemblage'))!.qte).toBe(8);
    expect(l.find((x) => x.nom.includes('charnières'))!.qte).toBe(8);
    expect(l.find((x) => x.rayon === 'Quincaillerie' && x.nom.startsWith('Charnières'))!.prix).toBe(3);
  });
  it('repères : chaque pièce reçoit la référence de sa ligne de fiche', () => {
    const { d } = meuble();
    const refs = refsDesPieces(d, syncFromModel(d, [], 1));
    expect(refs.get(d.solids[0]!.id)).toBe(refs.get(d.solids[1]!.id));        // deux côtés identiques, même ligne
    expect(new Set(refs.values()).size).toBe(3);
  });
});
