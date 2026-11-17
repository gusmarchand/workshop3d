import { beforeAll, describe, expect, it } from 'vitest';
import { genererCaisson, type CaissonParams } from './kernel/cabinet';
import { boxMesh, emptyDoc, initKernel, type Doc, type V3 } from './kernel/model';
import { appeler, OUTILS, repondre, type Ctx } from './mcp';

beforeAll(async () => { await initKernel(); });

// Contexte minimal : un document en mémoire, sans interface.
function ctx() {
  let doc: Doc = emptyDoc();
  const journal: string[] = [];
  const c: Ctx = {
    doc: () => doc, debitSynchro: () => [], selection: () => [], fichier: () => null, modifie: () => false,
    appliquer(d, m) { doc = d; journal.push(m); }, selectionner() {}, annuler: () => false, capture: () => '', fiche: () => [], ecrireFiche() {}, ouvrir: () => 0,
    creerMeuble(d, params, _m, _f, origine) {
      const id = d.next++;
      (d.caissons ??= []).push({ id, params, methode: 0 });
      const o = origine ?? [0, 0, 0];
      const ids = genererCaisson(params).panneaux.map((p) => {
        const sid = d.next++;
        d.solids.push({ id: sid, name: p.nom, mesh: boxMesh(p.min.map((v, k) => v + o[k]!) as V3, p.max.map((v, k) => v + o[k]!) as V3), meta: { piece: p.piece, matiere: '', fil: 'aucun', note: '', caisson: id } });
        return sid;
      });
      return { id, ids };
    },
    modifierMeuble: () => null,
  };
  return { c, journal, get doc() { return doc; } };
}
const texte = (r: ReturnType<typeof appeler>) => (r.content[0] as { text: string }).text;

describe('outils MCP', () => {
  it('liste des outils : noms uniques, schémas objets', () => {
    const r = repondre(ctx().c, 'tools/list', {}) as { result: { tools: typeof OUTILS } };
    const noms = r.result.tools.map((t) => t.name);
    expect(new Set(noms).size).toBe(noms.length);
    for (const t of r.result.tools) expect(t.inputSchema.type).toBe('object');
  });

  it('crée un meuble depuis un modèle, en mm, à la position donnée', () => {
    const t = ctx();
    const r = appeler(t.c, 'creer_meuble', { modele: 'commode', params: { L: 1200 }, position: [100, 0, 0] });
    expect(r.isError).toBeUndefined();
    const out = JSON.parse(texte(r)) as { hors_tout: number[]; position: number[] };
    expect(out.hors_tout[0]).toBe(1200);
    expect(out.position[0]).toBe(100);
    expect(t.journal).toHaveLength(1);
    const p = t.doc.caissons![0]!.params as CaissonParams;
    expect(p.types).toEqual(['tiroirs']);
  });

  it('refuse les arguments invalides sans toucher au document', () => {
    const t = ctx();
    for (const args of [
      { params: { L: 'grand' } }, { params: { inconnu: 1 } }, { params: { types: ['placard'] } },
      { modele: 'canapé' }, { position: [0, 0] }, { params: { L: 100, colonnes: 12 } },
    ]) expect(appeler(t.c, 'creer_meuble', args).isError).toBe(true);
    expect(appeler(t.c, 'deplacer', { delta: [1, 2, 3] }).isError).toBe(true);
    expect(appeler(t.c, 'supprimer', { ids: [999] }).isError).toBe(true);
    expect(appeler(t.c, 'outil_absent', {}).isError).toBe(true);
    expect(t.journal).toHaveLength(0);
  });

  it('colonnes ajoutées : types complétés, largeurs remises à parts égales', () => {
    const t = ctx();
    appeler(t.c, 'creer_meuble', { params: { L: 1600, colonnes: 3, types: ['penderie'] } });
    expect(t.doc.caissons![0]!.params.types).toEqual(['penderie', 'etageres', 'etageres']);
  });

  it('déplace et supprime un meuble entier', () => {
    const t = ctx();
    appeler(t.c, 'creer_meuble', { modele: 'etagere_murale' });
    const id = t.doc.caissons![0]!.id;
    const d = JSON.parse(texte(appeler(t.c, 'deplacer', { meuble: id, delta: [0, 0, 1500] }))) as { nouvelle_boite: { min: number[] } };
    expect(d.nouvelle_boite.min[2]).toBe(1500);
    const s = JSON.parse(texte(appeler(t.c, 'supprimer', { meuble: id }))) as { meubles_supprimes: number[] };
    expect(s.meubles_supprimes).toEqual([id]);
    expect(t.doc.solids).toHaveLength(0);
  });

  it('ajoute des pièces sur mesure et leur quincaillerie, refuse une pièce plate', () => {
    const t = ctx();
    const r = appeler(t.c, 'ajouter', { pieces: [{ nom: 'Plinthe', min: [0, 0, 0], max: [961, 18, 50], matiere: 'Mdf 10mm' }], quincaillerie: [{ nom: 'Charnières', qte: 4 }] });
    expect(r.isError).toBeUndefined();
    expect(t.doc.methods!.find((m) => m.id === t.doc.solids[0]!.meta.methode)?.matiere).toBe('Mdf 10mm');
    expect(t.doc.extras).toEqual([expect.objectContaining({ nom: 'Charnières', qte: 4 })]);
    expect(appeler(t.c, 'ajouter', { pieces: [{ nom: 'Plat', min: [0, 0, 0], max: [100, 100, 0] }] }).isError).toBe(true);
    expect(appeler(t.c, 'ajouter', { pieces: [] }).isError).toBe(true);
    expect(t.journal).toHaveLength(1);
  });

  it('profil extrudé : côté de sous-pente coupé en biais, cotes de débit au rectangle englobant', () => {
    const t = ctx();
    const r = appeler(t.c, 'ajouter', { pieces: [{ nom: 'Côté', profil: { axe: 'y', points: [[0, 0], [600, 0], [600, 1700], [0, 2010]], de: 0, a: 18 } }] });
    expect(r.isError).toBeUndefined();
    const p = JSON.parse(texte(appeler(t.c, 'pieces', {}))) as { debit: { L: number; l: number; e: number }; min: number[]; max: number[] }[];
    expect(p[0]!.debit).toEqual({ L: 2010, l: 600, e: 18 });
    expect(p[0]!.max).toEqual([600, 18, 2010]);
    expect(appeler(t.c, 'ajouter', { pieces: [{ nom: 'X', profil: { axe: 'y', points: [[0, 0], [1, 1], [2, 2]], de: 0, a: 18 } }] }).isError).toBe(true);
  });

  it('stock : règle la marge et le trait de découpe', () => {
    const t = ctx();
    const r = appeler(t.c, 'stock', { marge: 0, trait: 4 });
    expect(r.isError).toBeUndefined();
    expect(t.doc.reglages).toMatchObject({ marge: 0, trait: 4 });
    expect(appeler(t.c, 'stock', { marge: -1 }).isError).toBe(true);
  });
  it('stock : retire un format existant, refuse un format inconnu', () => {
    const t = ctx();
    appeler(t.c, 'stock', { ajouter: [{ matiere: 'Mélaminé blanc 18', e: 18, L: 2500, l: 500, prix: 14 }, { matiere: 'Mélaminé blanc 18', e: 18, L: 2500, l: 600, prix: 17 }] });
    expect(appeler(t.c, 'stock', { retirer: [{ matiere: 'mélaminé blanc 18', e: 18, L: 2500, l: 500 }] }).isError).toBeUndefined();
    expect(t.doc.stock!.map((p) => p.l)).toEqual([600]);
    expect(appeler(t.c, 'stock', { retirer: [{ matiere: 'Mélaminé blanc 18', e: 18, L: 2500, l: 500 }] }).isError).toBe(true);
  });

  it('masque et réaffiche, sans sortir les pièces de la fiche', () => {
    const t = ctx();
    appeler(t.c, 'ajouter', { pieces: [{ nom: 'A', min: [0, 0, 0], max: [100, 100, 18] }, { nom: 'B', min: [200, 0, 0], max: [300, 100, 18] }] });
    const [a, b] = t.doc.solids.map((x) => x.id);
    appeler(t.c, 'masquer', { ids: [a] });
    expect(t.doc.solids.map((x) => !!x.meta.masque)).toEqual([true, false]);
    expect(t.doc.solids.every((x) => x.meta.piece)).toBe(true);
    appeler(t.c, 'masquer', { ids: [b] });
    const r = JSON.parse(texte(appeler(t.c, 'afficher', {}))) as { affichees: number };
    expect(r.affichees).toBe(2);
    expect(t.doc.solids.some((x) => x.meta.masque)).toBe(false);
  });

  it('matériau : couleur unique, créé à la volée par son nom, modifiable', () => {
    const t = ctx();
    appeler(t.c, 'ajouter', { pieces: [{ nom: 'Porte', min: [0, 0, 0], max: [10, 400, 700], matiere: 'MDF 10 vert' }] });
    const m = t.doc.methods!.find((x) => x.nom === 'MDF 10 vert')!;
    expect(t.doc.solids[0]!.meta.methode).toBe(m.id);
    expect(m.cotes).toBe('');                         // pas de chant sur du MDF
    appeler(t.c, 'materiau', { nom: 'MDF 10 vert', panneau: 'MDF 10', couleur: '#5B7F5A' });
    expect(t.doc.methods!.find((x) => x.id === m.id)).toMatchObject({ matiere: 'MDF 10', couleur: '#5b7f5a' });
    expect(appeler(t.c, 'materiau', { nom: 'X', couleur: 'vert' }).isError).toBe(true);
    const n = appeler(t.c, 'materiau', { nom: 'Chêne massif 22', panneau: 'Chêne 22', couleur: '#b08850' });
    expect(n.isError).toBeUndefined();
    expect(t.doc.methods!.find((x) => x.nom === 'Chêne massif 22')).toMatchObject({ matiere: 'Chêne 22', couleur: '#b08850' });
    const p = JSON.parse(texte(appeler(t.c, 'pieces', {}))) as { couleur: string; matiere: string }[];
    expect(p[0]).toMatchObject({ couleur: '#5b7f5a', matiere: 'MDF 10 vert' });
  });

  it('efface les dessins sans toucher aux pièces', () => {
    const t = ctx();
    appeler(t.c, 'ajouter', { pieces: [{ nom: 'A', min: [0, 0, 0], max: [100, 100, 18] }] });
    const d = t.doc;
    d.sketches.push({ id: 900, plane: { o: [0, 0, 0], n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, segs: [[[0, 0], [1, 0]]] }, { id: 901, plane: { o: [0, 0, 0], n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] }, segs: [] });
    expect(appeler(t.c, 'effacer_traits', { ids: [999] }).isError).toBe(true);
    appeler(t.c, 'effacer_traits', { ids: [900] });
    expect(t.doc.sketches.map((k) => k.id)).toEqual([901]);
    appeler(t.c, 'effacer_traits', {});
    expect(t.doc.sketches).toHaveLength(0);
    expect(t.doc.solids).toHaveLength(1);
  });

  it('identifie une porte, règle ses charnières, puis la retire', () => {
    const t = ctx();
    appeler(t.c, 'ajouter', { pieces: [{ nom: 'Côté', min: [0, 0, 0], max: [600, 18, 1000] }, { nom: 'Porte', min: [-19, 0, 100], max: [0, 500, 900] }] });
    const porte = t.doc.solids[1]!.id;
    const r = JSON.parse(texte(appeler(t.c, 'identifier', { type: 'porte', ids: [porte], charnieres: 'droite', entraxe: 160 }))) as { element: { charnieres: string; entraxe: number }; quincaillerie: string[] };
    expect(r.element).toMatchObject({ charnieres: 'droite', entraxe: 160 });
    expect(r.quincaillerie[0]).toContain('côté droite');
    expect(appeler(t.c, 'identifier', { type: 'tiroir', ids: [porte] }).isError).toBe(true);
    expect(appeler(t.c, 'identifier', { type: 'porte', ids: [porte], entraxe: 100 }).isError).toBe(true);
    appeler(t.c, 'identifier', { type: 'aucun', ids: [porte] });
    expect(t.doc.elements).toEqual([]);
  });

  it('notice : enregistrée avec ses pièces, pièces inconnues refusées', () => {
    const t = ctx();
    appeler(t.c, 'ajouter', { pieces: [{ nom: 'Côté', min: [0, 0, 0], max: [600, 18, 1000] }] });
    const id = t.doc.solids[0]!.id;
    expect(appeler(t.c, 'notice', { etapes: [{ titre: 'Côtés', texte: 'Percer les taquets.', ids: [id] }] }).isError).toBeUndefined();
    expect(t.doc.notice).toEqual([{ titre: 'Côtés', texte: 'Percer les taquets.', ids: [id] }]);
    expect(appeler(t.c, 'notice', { etapes: [{ titre: 'X', texte: '', ids: [999] }] }).isError).toBe(true);
    expect(JSON.parse(texte(appeler(t.c, 'notice', {}))).etapes).toHaveLength(1);
  });
});
