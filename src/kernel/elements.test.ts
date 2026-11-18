import { beforeAll, describe, expect, it } from 'vitest';
import { boxMesh, emptyDoc, initKernel, prismMesh, type Doc, type Solid, type V3 } from './model';
import { appliquerPose, copierElements, elementsDuCaisson, ferrures, pointPrise, poseOuverte, reconnaitre, repere, synchroniserElements, type Porte } from './elements';
import { parse, serialize } from './file';
import { CAISSON_DEFAUT, genererCaisson } from './cabinet';

beforeAll(async () => { await initKernel(); });

// Meuble vu de face depuis -X (comme le projet réel) : côté droit en Y bas, côté gauche en Y haut.
const m = (v: number[]) => v.map((x) => x / 1000) as V3;
function piece(d: Doc, nom: string, min: number[], max: number[]): Solid {
  const s: Solid = { id: d.next++, name: nom, mesh: boxMesh(m(min), m(max)), meta: { piece: true, matiere: '', fil: 'aucun', note: '' } };
  d.solids.push(s); return s;
}
function meuble() {
  const d = emptyDoc();
  piece(d, 'Côté droit', [0, 0, 0], [600, 18, 1600]);
  piece(d, 'Côté gauche', [0, 982, 0], [600, 1000, 1600]);
  piece(d, 'Dessous', [0, 18, 50], [600, 982, 68]);
  const porte = piece(d, 'Porte gauche', [-10, 501.5, 800], [0, 998.5, 1600]);
  const fa = piece(d, 'Façade tiroir', [-10, 1.5, 51.5], [0, 998.5, 286.3]);
  piece(d, 'Fond tiroir', [0, 31, 73], [550, 969, 81]);
  piece(d, 'Côté tiroir', [0, 31, 81], [550, 49, 261]);
  piece(d, 'Côté tiroir', [0, 951, 81], [550, 969, 261]);
  piece(d, 'Arrière tiroir', [532, 49, 81], [550, 951, 261]);
  return { d, porte, fa };
}

describe('portes et tiroirs', () => {
  it('repère d\'une porte : extérieur vers -X, droite vers -Y', () => {
    const { d, porte } = meuble();
    const R = repere(d, porte, [porte.id]);
    expect(R.n.map((x) => x + 0)).toEqual([-1, 0, 0]);
    expect(R.r.map((x) => Math.round(x) + 0)).toEqual([0, -1, 0]);
    expect(Math.round(R.w * 1000)).toBe(497);
  });

  it('reconnaît la porte (charnières du côté de son nom) et le tiroir avec tout son caisson', () => {
    const { d, fa } = meuble();
    const els = reconnaitre(d);
    const p = els.find((e) => e.type === 'porte') as Porte;
    expect(p.charnieres).toBe('gauche');
    const t = els.find((e) => e.type === 'tiroir')!;
    expect(t.type === 'tiroir' && t.facade).toBe(fa.id);
    expect(t.type === 'tiroir' && t.pieces.length).toBe(4);      // le dessous du meuble n'en fait pas partie
    expect(t.type === 'tiroir' && t.coulisse).toBe(550);
  });

  it('porte : charnières à 100 mm des bords, cuvettes sur la face intérieure, ouverture vers l\'extérieur', () => {
    const { d, porte } = meuble();
    const el: Porte = { id: 1, type: 'porte', piece: porte.id, charnieres: 'gauche', recouvrement: 'applique', ouverture: 110, entraxe: 128 };
    const [ch, po] = ferrures(d, el);
    expect(ch!.qte).toBe(2);
    expect(ch!.cote).toContain('à 100, 700 mm du bas');
    const c = ch!.formes[0]!;
    expect(c.kind === 'cylindre' && Math.round(c.centre[1] * 10000) / 10).toBe(998.5 - 22.5);   // gauche = Y haut
    expect(c.kind === 'cylindre' && c.centre[0]).toBeGreaterThan(-0.01);                        // percée depuis la face intérieure (X = 0)
    expect(ch!.cote).toContain('trop mince');                                                   // porte de 10 mm
    expect(po!.achat).toBe('Poignées entraxe 128 mm');
    const pose = poseOuverte(d, el)!;
    expect(pose.kind).toBe('rotation');
    if (pose.kind !== 'rotation') return;
    // le chant libre (Y 501,5) part vers -X
    const v: V3 = [0, 0.5015 - pose.point[1], 0], k = pose.axe, a = pose.angle;
    const x = v[0] * Math.cos(a) + (k[1] * v[2] - k[2] * v[1]) * Math.sin(a);
    expect(pose.point[0] + x).toBeLessThan(-0.3);
  });

  it('tiroir : coulisses de part et d\'autre du caisson, sortie de la longueur de coulisse', () => {
    const { d } = meuble();
    const t = reconnaitre(d).find((e) => e.type === 'tiroir')!;
    const [co] = ferrures(d, t);
    expect(co!.formes).toHaveLength(2);
    expect(co!.cote).toContain('du bas de la façade');
    const p = poseOuverte(d, t)!;
    expect(p.kind === 'translation' && p.v.map((x) => Math.round(x * 1000) + 0)).toEqual([-550, 0, 0]);
  });

  it('liste d\'achat calculée, prix gardés, élément retiré avec sa pièce', () => {
    const { d, porte } = meuble();
    d.elements = reconnaitre(d);
    let r = synchroniserElements(d);
    expect(r.extras!.filter((x) => x.auto).map((x) => `${x.qte} ${x.nom}`).sort()).toEqual(['1 Coulisses à billes 550 mm sortie totale (paire)', '1 Poignées entraxe 128 mm', '1 Poignées entraxe 160 mm', '2 Charnières en applique 110°']);
    r.extras!.find((x) => x.nom.startsWith('Charnières'))!.prix = 3.5;
    r = synchroniserElements({ ...r, solids: r.solids.filter((s) => s.id !== porte.id) });
    expect(r.elements!.map((e) => e.type)).toEqual(['tiroir']);
    expect(r.extras!.some((x) => x.nom.startsWith('Charnières'))).toBe(false);
    r = synchroniserElements({ ...r, elements: [...r.elements!, { id: 99, type: 'porte', piece: r.solids[0]!.id, charnieres: 'droite', recouvrement: 'applique', ouverture: 110, entraxe: 0 }] });
    expect(r.extras!.find((x) => x.nom.startsWith('Charnières'))!.prix).toBe(0);   // la ligne avait disparu : prix oublié
  });

  it('le fichier garde éléments, masquage et couleurs', () => {
    const { d } = meuble();
    d.elements = reconnaitre(d);
    d.solids[0]!.meta.masque = true;
    d.methods = [{ id: 500, nom: 'MDF vert', matiere: 'MDF 10', chant: '', chantEp: 0, cotes: '', deduire: false, couleur: '#5b7f5a' }];
    const r = parse(serialize({ doc: d, debit: [] })).doc;
    expect(r.elements).toEqual(d.elements);
    expect(r.solids[0]!.meta.masque).toBe(true);
    expect(r.methods![0]!.couleur).toBe('#5b7f5a');
    d.notice = [{ titre: 'Étape', texte: 'Texte', ids: [d.solids[0]!.id, 12345] }];
    expect(parse(serialize({ doc: d, debit: [] })).doc.notice).toEqual([{ titre: 'Étape', texte: 'Texte', ids: [d.solids[0]!.id] }]);
  });

  it('ouverture progressive : demi-course, sortie partielle, point tenu qui suit', () => {
    const { d, porte } = meuble();
    const t = reconnaitre(d).find((e) => e.type === 'tiroir')!;
    if (t.type !== 'tiroir') return;
    const demi = poseOuverte(d, t, 0.5)!;
    expect(demi.kind === 'translation' && Math.round(demi.v[0] * 1000)).toBe(-275);
    const p = poseOuverte(d, { ...t, sortie: 'partielle' })!;
    expect(p.kind === 'translation' && Math.round(p.v[0] * 1000)).toBe(-413);
    const el: Porte = { id: 1, type: 'porte', piece: porte.id, charnieres: 'gauche', recouvrement: 'applique', ouverture: 110, entraxe: 0 };
    const q = pointPrise(d, el)!, ferme = appliquerPose(poseOuverte(d, el, 0)!, q);
    expect(ferme.map((x) => Math.round(x * 1000) + 0)).toEqual(q.map((x) => Math.round(x * 1000) + 0));
    const a90 = appliquerPose(poseOuverte(d, el, 90 / 110)!, q);
    expect(Math.round(a90[1] * 1000)).toBe(998);                 // à 90°, le chant libre est au droit des charnières
    expect(a90[0]).toBeLessThan(-0.4);                           // et devant le meuble
  });

  it('meuble généré : portes et tiroirs créés, réglages gardés quand le meuble est regénéré', () => {
    const d = emptyDoc();
    const ecrire = () => genererCaisson({ ...CAISSON_DEFAUT, L: 1200, colonnes: 2, types: ['tiroirs', 'etageres'], portes: true }).panneaux.flatMap((p) => {
      const id = d.next++;
      d.solids.push({ id, name: p.nom, mesh: boxMesh(p.min, p.max), meta: { piece: true, matiere: '', fil: 'aucun', note: '', caisson: 1 } });
      return p.role ? [{ id, role: p.role }] : [];
    });
    let els = elementsDuCaisson(d, 1, ecrire(), []);
    expect(els.filter((e) => e.type === 'tiroir')).toHaveLength(3);
    expect(els.filter((e) => e.type === 'porte').map((e) => e.type === 'porte' && e.charnieres)).toEqual(['gauche', 'droite']);
    const t0 = els.find((e) => e.type === 'tiroir')!;
    expect(t0.type === 'tiroir' && t0.pieces).toHaveLength(5);
    // l'utilisateur règle une poignée, puis le meuble est regénéré : nouvelles pièces, même réglage
    els = els.map((e) => (e.cle === t0.cle ? { ...e, entraxe: 320 } : e));
    d.solids = [];
    const apres = elementsDuCaisson(d, 1, ecrire(), els);
    expect(apres.find((e) => e.cle === t0.cle)!.entraxe).toBe(320);
    expect(apres.find((e) => e.cle === t0.cle)!.id).not.toBe(t0.id);
  });

  it('charnière bridée à 90° : acceptée au rechargement, la porte s\'ouvre de 90°', () => {
    const { d, porte } = meuble();
    d.elements = [{ id: 7, type: 'porte', piece: porte.id, charnieres: 'droite', recouvrement: 'applique', ouverture: 90, entraxe: 128 }];
    const rel = parse(serialize({ doc: d, debit: [] })).doc;
    expect((rel.elements![0] as Porte).ouverture).toBe(90);
    const pose = poseOuverte(rel, rel.elements![0]!)!;
    expect(pose.kind === 'rotation' && Math.round((pose.angle * 180) / Math.PI)).toBe(90);
  });

  it('copie : l\'élément suit ses pièces copiées, perd le lien au meuble si le meuble n\'est pas copié', () => {
    const { d, porte } = meuble();
    d.elements = [{ id: 7, type: 'porte', caisson: 3, cle: 'porte:0:0', piece: porte.id, charnieres: 'droite', recouvrement: 'demi', ouverture: 155, entraxe: 192 }];
    copierElements(d, d.elements, new Map([[porte.id, 999]]));
    expect(d.elements[1]).toMatchObject({ type: 'porte', piece: 999, charnieres: 'droite', entraxe: 192 });
    expect(d.elements[1]!.caisson).toBeUndefined();
    copierElements(d, [d.elements[0]!], new Map([[porte.id, 1000]]), new Map([[3, 30]]));
    expect(d.elements[2]).toMatchObject({ caisson: 30, cle: 'porte:0:0', piece: 1000 });
    copierElements(d, d.elements, new Map());           // aucune pièce copiée : rien
    expect(d.elements).toHaveLength(3);
  });

  it('le fichier garde le réglage « couper les pièces trop grandes » et le lien porte-meuble', () => {
    const { d, porte } = meuble();
    d.reglages = { trait: 3, marge: 10, decouper: false };
    d.elements = [{ id: 7, type: 'porte', caisson: 3, cle: 'porte:0:0', piece: porte.id, charnieres: 'droite', recouvrement: 'applique', ouverture: 110, entraxe: 0 }];
    const r = parse(serialize({ doc: d, debit: [] })).doc;
    expect(r.reglages!.decouper).toBe(false);
    expect(r.elements![0]).toMatchObject({ caisson: 3, cle: 'porte:0:0' });
  });

  it('poignée d\'une porte coupée en biais : sur la hauteur réelle du chant libre', () => {
    const d = emptyDoc();
    piece(d, 'Côté', [0, 0, 0], [600, 18, 1000]);
    // porte vue de -X, charnières à gauche (Y haut) ; chant libre (Y bas) de 120 mm seulement
    const porte: Solid = { id: d.next++, name: 'Porte', meta: { piece: true, matiere: '', fil: 'aucun', note: '' },
      mesh: prismMesh(0, [[0.0015, 0.5], [0.4985, 0.5], [0.4985, 0.88], [0.0015, 0.62]], -0.018, 0) };
    d.solids.push(porte);
    const [, po] = ferrures(d, { id: 1, type: 'porte', piece: porte.id, charnieres: 'gauche', recouvrement: 'demi', ouverture: 110, entraxe: 96 });
    const zs = po!.formes.filter((f) => f.kind === 'cylindre').map((f) => (f.kind === 'cylindre' ? f.centre[2] : 0));
    expect(Math.min(...zs)).toBeGreaterThan(0.5);
    expect(Math.max(...zs)).toBeLessThan(0.62);
  });
});
