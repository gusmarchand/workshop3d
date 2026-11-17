import { CAISSON_DEFAUT, type CaissonParams, type TypeColonne } from './cabinet';
import { parseSides, type CaissonRec, type Doc, type Guide, type Extra, type Materiau, type Panneau, type Reglages, type Sketch, type Solid } from './model';
import type { DebitRow } from './debit';
import { COULISSES, ENTRAXES, OUVERTURES, type Element } from './elements';
import { estDecor } from './decor';

// Fichier .workshop : JSON { format, version, doc, debit }. Les anciens fichiers (format « atelier3d », extension .atelier) s'ouvrent encore.
export interface Saved { doc: Doc; debit: DebitRow[] }

export const serialize = (s: Saved): string => JSON.stringify({ format: 'workshop3d', version: 1, doc: s.doc, debit: s.debit });

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNums = (x: unknown, n?: number): x is number[] =>
  Array.isArray(x) && (n === undefined || x.length === n) && x.every((v) => typeof v === 'number' && Number.isFinite(v));
const fail = (what: string): never => { throw new Error(`Fichier invalide : ${what}`); };
const str = (x: unknown) => (typeof x === 'string' ? x : '');
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const fil = (x: unknown): 'L' | 'l' | 'aucun' => (x === 'L' || x === 'l' ? x : 'aucun');

// Lit et valide un fichier : tout ce qui vient du disque est vérifié avant d'entrer dans le modèle.
export function parse(text: string): Saved {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return fail("ce n'est pas du JSON"); }
  if (!isObj(raw) || (raw.format !== 'workshop3d' && raw.format !== 'atelier3d')) return fail("ce n'est pas un fichier Workshop 3D");
  if (raw.version !== 1) return fail(`version ${String(raw.version)} non prise en charge`);
  const d = raw.doc;
  if (!isObj(d) || !Array.isArray(d.solids) || !Array.isArray(d.sketches)) return fail('modèle absent');

  let maxId = 0;
  const solids: Solid[] = d.solids.map((s: unknown, i: number) => {
    if (!isObj(s) || !isObj(s.mesh)) return fail(`solide ${i + 1}`);
    const { v, t } = s.mesh;
    if (!isNums(v) || !isNums(t) || v.length % 3 || t.length % 3) return fail(`maillage du solide ${i + 1}`);
    const nv = v.length / 3;
    if (!t.every((k) => Number.isInteger(k) && k >= 0 && k < nv)) return fail(`indices du solide ${i + 1}`);
    const meta = isObj(s.meta) ? s.meta : {};
    const id = num(s.id); maxId = Math.max(maxId, id);
    let comp = {};
    if (s.comp !== undefined) {
      const c = s.comp;
      if (!isObj(c) || !isNums(c.r, 9) || !isNums(c.t, 3)) return fail(`composant du solide ${i + 1}`);
      maxId = Math.max(maxId, num(c.id));
      comp = { comp: { id: num(c.id), r: c.r, t: c.t as [number, number, number] } };
    }
    return { id, name: str(s.name) || `Pièce ${id}`, mesh: { v, t }, ...comp, meta: {
      piece: meta.piece !== false, matiere: str(meta.matiere), fil: fil(meta.fil), note: str(meta.note),
      ...(typeof meta.methode === 'number' ? { methode: meta.methode } : {}),
      ...(typeof meta.chants === 'string' ? { chants: parseSides(meta.chants).join(' ') } : {}),
      ...(typeof meta.caisson === 'number' ? { caisson: meta.caisson } : {}),
      ...(meta.masque === true ? { masque: true } : {}),
    } };
  });
  const sketches: Sketch[] = d.sketches.map((s: unknown, i: number) => {
    if (!isObj(s) || !isObj(s.plane) || !Array.isArray(s.segs)) return fail(`croquis ${i + 1}`);
    const { o, u, v, n } = s.plane;
    if (!isNums(o, 3) || !isNums(u, 3) || !isNums(v, 3) || !isNums(n, 3)) return fail(`plan du croquis ${i + 1}`);
    const segs = s.segs.map((g: unknown) => {
      if (!Array.isArray(g) || g.length !== 2 || !isNums(g[0], 2) || !isNums(g[1], 2)) return fail(`trait du croquis ${i + 1}`);
      return [[g[0][0]!, g[0][1]!], [g[1][0]!, g[1][1]!]] as [[number, number], [number, number]];
    });
    const id = num(s.id); maxId = Math.max(maxId, id);
    return { id, plane: { o: o as [number, number, number], u: u as [number, number, number], v: v as [number, number, number], n: n as [number, number, number] }, segs };
  });
  const debit: DebitRow[] = (Array.isArray(raw.debit) ? raw.debit : []).filter(isObj).map((r, i) => ({
    id: num(r.id) || i + 1, src: r.src === 'modèle' ? 'modèle' : 'manuel', ref: str(r.ref), nom: str(r.nom), qte: num(r.qte),
    L: num(r.L), l: num(r.l), e: num(r.e), matiere: str(r.matiere), fil: fil(r.fil), chants: str(r.chants), note: str(r.note),
    ...(typeof r.ml === 'number' ? { ml: num(r.ml) } : {}), ...(typeof r.key === 'string' ? { key: r.key } : {}), ...(r.edited === true ? { edited: true } : {}),
  }));
  const methods: Materiau[] = (Array.isArray(d.methods) ? d.methods : []).filter(isObj).map((m) => {
    const id = num(m.id); maxId = Math.max(maxId, id);
    return { id, nom: str(m.nom) || `Méthode ${id}`, matiere: str(m.matiere), chant: str(m.chant), chantEp: Math.max(0, num(m.chantEp)), cotes: parseSides(str(m.cotes)).join(' '), deduire: m.deduire === true, ...(num(m.chantPrix) > 0 ? { chantPrix: num(m.chantPrix) } : {}), ...(typeof m.couleur === 'string' && /^#[0-9a-f]{6}$/i.test(m.couleur) ? { couleur: m.couleur.toLowerCase() } : {}), ...(estDecor(m.decor) ? { decor: m.decor } : {}) };
  });
  const pos = (x: unknown) => Math.max(0, num(x));
  const stock: Panneau[] = (Array.isArray(d.stock) ? d.stock : []).filter(isObj).map((p) => {
    const id = num(p.id); maxId = Math.max(maxId, id);
    return { id, matiere: str(p.matiere), e: pos(p.e), L: pos(p.L), l: pos(p.l), qte: Math.floor(pos(p.qte)), prix: pos(p.prix), ...(p.chute === true ? { chute: true } : {}) };
  });
  const extras: Extra[] = (Array.isArray(d.extras) ? d.extras : []).filter(isObj).map((x) => {
    const id = num(x.id); maxId = Math.max(maxId, id);
    return { id, nom: str(x.nom), qte: pos(x.qte), prix: pos(x.prix), ...(typeof x.caisson === 'number' ? { caisson: x.caisson } : {}), ...(x.auto === true ? { auto: true } : {}) };
  });
  const reglages: Reglages | undefined = isObj(d.reglages) ? { trait: pos(d.reglages.trait), marge: pos(d.reglages.marge), ...(typeof d.reglages.decouper === 'boolean' ? { decouper: d.reglages.decouper } : {}) } : undefined;
  const TYPES: TypeColonne[] = ['etageres', 'penderie', 'tiroirs', 'penderie_tiroirs'];
  const caissons: CaissonRec[] = (Array.isArray(d.caissons) ? d.caissons : []).filter(isObj).map((c, i) => {
    const pr = isObj(c.params) ? c.params : fail(`caisson ${i + 1}`);
    const params: CaissonParams = { ...CAISSON_DEFAUT, types: [...CAISSON_DEFAUT.types] };
    for (const k of ['L', 'H', 'P', 'e', 'colonnes', 'etageres', 'tiroirs', 'hTiroir', 'jeu', 'fond', 'plinthe', 'retrait'] as const) if (pr[k] !== undefined) params[k] = pos(pr[k]);
    params.portes = pr.portes === true;
    if (Array.isArray(pr.largeurs) && pr.largeurs.every((x) => typeof x === 'number' && x > 0)) params.largeurs = pr.largeurs as number[];
    if (pr.montantsPleins === true) params.montantsPleins = true;
    params.types = Array.isArray(pr.types) ? pr.types.map((t) => (TYPES.includes(t as TypeColonne) ? (t as TypeColonne) : 'etageres')) : params.types;
    const id = num(c.id); maxId = Math.max(maxId, id);
    return { id, params, methode: num(c.methode), ...(typeof c.fond === 'string' ? { fond: c.fond } : {}), ...(typeof c.fondTiroir === 'string' && c.fondTiroir ? { fondTiroir: c.fondTiroir } : {}) };
  });
  const guides: Guide[] = (Array.isArray(d.guides) ? d.guides : []).filter(isObj).flatMap((g) => {
    if (!isNums(g.p, 3) || !isNums(g.d, 3) || Math.hypot(...(g.d as number[])) < 1e-9) return [];
    const id = num(g.id); maxId = Math.max(maxId, id);
    const L = Math.hypot(...(g.d as number[]));
    return [{ id, p: g.p as [number, number, number], d: (g.d as number[]).map((x) => x / L) as [number, number, number] }];
  });
  // Portes et tiroirs identifiés : on ne garde que ceux dont les réglages sont connus et les pièces existent.
  const ids = new Set(solids.map((s) => s.id));
  const choix = <T>(x: unknown, liste: readonly T[], defaut: T): T => (liste.includes(x as T) ? (x as T) : defaut);
  const sens = (x: unknown) => (x === 1 || x === -1 ? { sens: x as 1 | -1 } : {});
  const elements: Element[] = (Array.isArray(d.elements) ? d.elements : []).filter(isObj).flatMap((e): Element[] => {
    const id = num(e.id); maxId = Math.max(maxId, id);
    const entraxe = choix(e.entraxe, ENTRAXES, 0);
    const lien = typeof e.caisson === 'number' && typeof e.cle === 'string' ? { caisson: e.caisson, cle: e.cle } : {};
    if (e.type === 'porte' && ids.has(num(e.piece))) return [{
      id, type: 'porte', ...lien, piece: num(e.piece), charnieres: choix(e.charnieres, ['gauche', 'droite', 'haut', 'bas'] as const, 'gauche'),
      recouvrement: choix(e.recouvrement, ['applique', 'demi', 'encastree'] as const, 'applique'), ouverture: choix(e.ouverture, OUVERTURES, 110), entraxe,
      ...(typeof e.nbCharnieres === 'number' && e.nbCharnieres >= 1 && e.nbCharnieres <= 8 ? { nbCharnieres: Math.round(e.nbCharnieres) } : {}), ...sens(e.sens),
    }];
    if (e.type === 'tiroir' && ids.has(num(e.facade))) return [{
      id, type: 'tiroir', ...lien, facade: num(e.facade), pieces: (Array.isArray(e.pieces) ? e.pieces : []).filter((i): i is number => typeof i === 'number' && ids.has(i)),
      coulisse: choix(e.coulisse, COULISSES, 400), entraxe, ...(e.sortie === 'partielle' ? { sortie: 'partielle' as const } : {}), ...sens(e.sens),
    }];
    return [];
  });
  const notice = (Array.isArray(d.notice) ? d.notice : []).filter(isObj).map((e) => ({
    titre: str(e.titre), texte: str(e.texte),
    ...(Array.isArray(e.ids) ? { ids: e.ids.filter((i): i is number => typeof i === 'number' && solids.some((s) => s.id === i)) } : {}),
  }));
  const pl = d.plafond;
  const plafond = isObj(pl) && [pl.angle, pl.hauteur, pl.position].every((x) => typeof x === 'number' && Number.isFinite(x)) && (pl.axe === 0 || pl.axe === 1) && (pl.sens === 1 || pl.sens === -1)
    ? { plafond: { angle: pl.angle as number, hauteur: pl.hauteur as number, position: pl.position as number, axe: pl.axe as 0 | 1, sens: pl.sens as 1 | -1 } } : {};
  return { doc: { next: Math.max(num(d.next), maxId + 1), solids, sketches, methods, stock, extras, caissons, guides, ...(elements.length ? { elements } : {}), ...plafond, ...(notice.length ? { notice } : {}), ...(reglages ? { reglages } : {}) }, debit };
}
