import type { Panneau, Reglages } from './model';
import type { DebitRow } from './debit';

// Optimisation de découpe : place des pièces rectangulaires sur des panneaux, en coupes droites
// de bord à bord (scie à format, scie plongeante sur rail). Le stock est utilisé avant tout achat.
// C'est une heuristique : le résultat est bon, pas garanti optimal.
export interface Piece { ref: string; nom: string; L: number; l: number; fil: 'L' | 'l' | 'aucun' }
export interface Place { ref: string; nom: string; x: number; y: number; w: number; h: number; rot: boolean }
interface Rect { x: number; y: number; w: number; h: number }
export interface Bin { panneau: Panneau; achat: boolean; places: Place[]; libres: Rect[] }
export interface Plan { bins: Bin[]; restants: Piece[]; cout: number; chute: number }

// Orientations permises : le fil d'un panneau suit sa longueur.
function orientations(p: Piece): { w: number; h: number; rot: boolean }[] {
  const droit = { w: p.L, h: p.l, rot: false }, tourne = { w: p.l, h: p.L, rot: true };
  if (p.fil === 'L') return [droit];
  if (p.fil === 'l') return [tourne];
  return p.L === p.l ? [droit] : [droit, tourne];
}

function placer(bin: Bin, i: number, p: Piece, o: { w: number; h: number; rot: boolean }, trait: number) {
  const f = bin.libres[i]!;
  bin.places.push({ ref: p.ref, nom: p.nom, x: f.x, y: f.y, w: o.w, h: o.h, rot: o.rot });
  const cw = Math.min(f.w, o.w + trait), ch = Math.min(f.h, o.h + trait);
  const rw = f.w - cw, rh = f.h - ch;
  // coupe de bord à bord : on garde le plus grand reste d'un seul tenant
  const droite: Rect = rw < rh ? { x: f.x + cw, y: f.y, w: rw, h: ch } : { x: f.x + cw, y: f.y, w: rw, h: f.h };
  const bas: Rect = rw < rh ? { x: f.x, y: f.y + ch, w: f.w, h: rh } : { x: f.x, y: f.y + ch, w: cw, h: rh };
  bin.libres.splice(i, 1, ...[droite, bas].filter((r) => r.w >= 1 && r.h >= 1));
}

function essai(pieces: Piece[], panneaux: Panneau[], opt: Reglages): Plan {
  const reste = new Map(panneaux.map((p) => [p.id, p.qte]));
  const bins: Bin[] = [], restants: Piece[] = [];
  const ouvrir = (panneau: Panneau, achat: boolean): Bin => {
    const b: Bin = { panneau, achat, places: [], libres: [{ x: opt.marge, y: opt.marge, w: panneau.L - 2 * opt.marge, h: panneau.l - 2 * opt.marge }] };
    bins.push(b); return b;
  };
  const meilleur = (cands: Bin[], p: Piece) => {
    let best: { bin: Bin; i: number; o: { w: number; h: number; rot: boolean }; score: number } | null = null;
    for (const bin of cands) bin.libres.forEach((f, i) => {
      for (const o of orientations(p)) {
        if (o.w > f.w + 1e-6 || o.h > f.h + 1e-6) continue;
        const score = Math.min(f.w - o.w, f.h - o.h);
        if (!best || score < best.score) best = { bin, i, o, score };
      }
    });
    return best as { bin: Bin; i: number; o: { w: number; h: number; rot: boolean }; score: number } | null;
  };
  const rentre = (pan: Panneau, p: Piece) => orientations(p).some((o) => o.w <= pan.L - 2 * opt.marge && o.h <= pan.l - 2 * opt.marge);
  for (const p of pieces) {
    let b = meilleur(bins, p);
    if (!b) {
      // d'abord le stock, plus petit panneau qui convient (les chutes partent en premier), sinon l'achat le moins cher au m²
      const enStock = panneaux.filter((x) => (reste.get(x.id) ?? 0) > 0 && rentre(x, p)).sort((a, c) => a.L * a.l - c.L * c.l)[0];
      const aAcheter = panneaux.filter((x) => x.prix > 0 && rentre(x, p)).sort((a, c) => a.prix / (a.L * a.l) - c.prix / (c.L * c.l))[0];
      const pan = enStock ?? aAcheter;
      if (!pan) { restants.push(p); continue; }
      if (enStock) reste.set(pan.id, (reste.get(pan.id) ?? 0) - 1);
      b = meilleur([ouvrir(pan, !enStock)], p);
      if (!b) { restants.push(p); continue; }
    }
    placer(b.bin, b.i, p, b.o, opt.trait);
  }
  const surface = bins.reduce((s, b) => s + b.panneau.L * b.panneau.l, 0);
  const utile = bins.reduce((s, b) => s + b.places.reduce((t, q) => t + q.w * q.h, 0), 0);
  return { bins, restants, cout: bins.reduce((s, b) => s + (b.achat ? b.panneau.prix : 0), 0), chute: surface ? 1 - utile / surface : 0 };
}

// Découpe en bandes : on refend le panneau en bandes de toute sa longueur, puis on tronçonne chaque bande.
// C'est la découpe la plus simple à la scie, et la meilleure quand beaucoup de pièces ont la même largeur
// (étagères et montants d'une même profondeur). Seulement pour des panneaux achetés (pas de stock en atelier).
function enBandes(pieces: Piece[], panneaux: Panneau[], opt: Reglages): Plan | null {
  if (!pieces.length || panneaux.some((p) => p.qte > 0)) return null;
  const choisi = panneaux.filter((p) => p.prix > 0).sort((a, c) => a.prix / (a.L * a.l) - c.prix / (c.L * c.l))[0];
  if (!choisi) return null;
  const pan: Panneau = choisi;
  const longueur = pan.L - 2 * opt.marge, largeur = pan.l - 2 * opt.marge, k = opt.trait;
  // pour chaque pièce : orientations (travers = largeur de bande occupée, long = longueur prise sur la bande)
  const choix = (p: Piece) => orientations(p).map((o) => ({ travers: o.h, long: o.w, rot: o.rot })).filter((o) => o.long <= longueur && o.travers <= largeur);
  const triees = [...pieces].sort((a, b) => Math.min(b.L, b.l) - Math.min(a.L, a.l) || Math.max(b.L, b.l) - Math.max(a.L, a.l));
  interface Bande { largeur: number; utilise: number; pieces: { p: Piece; long: number; travers: number; rot: boolean }[] }
  // largeur de bande principale : la cote la plus fréquente parmi les pièces (la profondeur du meuble, en général)
  const freq = new Map<number, number>();
  for (const p of pieces) for (const d of new Set([p.L, p.l])) freq.set(d, (freq.get(d) ?? 0) + 1);
  // plusieurs largeurs candidates (les cotes les plus fréquentes) : on garde le plan le plus économe
  let best: Plan | null = null;
  for (const [m] of [...freq].sort((x, y) => y[1] - x[1] || y[0] - x[0]).slice(0, 4)) {
    const plan = avecLargeur(m);
    if (!best || plan.restants.length < best.restants.length || (plan.restants.length === best.restants.length && plan.bins.length < best.bins.length)) best = plan;
  }
  return best;

  function avecLargeur(m: number): Plan {
  const bandes: Bande[] = [], restants: Piece[] = [];
  const principales: { p: Piece; long: number; travers: number; rot: boolean }[] = [], autres: Piece[] = [];
  for (const p of triees) {
    const o = choix(p).find((x) => Math.abs(x.travers - m) < 0.5);
    if (o) principales.push({ p, ...o }); else autres.push(p);
  }
  // rangement exact des pièces principales dans le moins de bandes de largeur m (recherche bornée)
  const lg = principales.sort((x, y) => y.long - x.long);
  const ranger = (nb: number): number[][] | null => {
    const sommes = Array<number>(nb).fill(-k), affect: number[][] = Array.from({ length: nb }, () => []);
    let essais = 0;
    const rec = (i: number): boolean => {
      if (i === lg.length) return true;
      if (++essais > 200000) return false;
      const vus = new Set<number>();
      for (let j = 0; j < nb; j++) {
        if (vus.has(sommes[j]!)) continue;                       // bandes équivalentes : un seul essai
        vus.add(sommes[j]!);
        if (sommes[j]! + k + lg[i]!.long > longueur) continue;
        sommes[j] = sommes[j]! + k + lg[i]!.long; affect[j]!.push(i);
        if (rec(i + 1)) return true;
        sommes[j] = sommes[j]! - k - lg[i]!.long; affect[j]!.pop();
      }
      return false;
    };
    return rec(0) ? affect : null;
  };
  if (lg.length) {
    const borne = Math.ceil(lg.reduce((t, x) => t + x.long + k, 0) / (longueur + k));
    let affect: number[][] | null = null;
    for (let nb = borne; nb <= lg.length && !affect; nb++) affect = ranger(nb);
    for (const l of affect ?? []) if (l.length) {
      const ps = l.map((i) => lg[i]!);
      bandes.push({ largeur: m, utilise: ps.reduce((t, x) => t + x.long, 0) + k * (ps.length - 1), pieces: ps });
    }
  }
  for (const p of autres) {
    const os = choix(p);
    if (!os.length) { restants.push(p); continue; }
    // la bande où la pièce perd le moins de place (largeur inutilisée × longueur), puis la plus remplie
    let best: { b: Bande; o: (typeof os)[number]; perte: number; reste: number } | null = null;
    for (const b of bandes) for (const o of os) {
      const besoin = (b.pieces.length ? k : 0) + o.long;
      if (o.travers > b.largeur || b.utilise + besoin > longueur) continue;
      const perte = (b.largeur - o.travers) * o.long, reste = longueur - b.utilise - besoin;
      if (!best || perte < best.perte - 1e-6 || (Math.abs(perte - best.perte) < 1e-6 && reste < best.reste)) best = { b, o, perte, reste };
    }
    if (best) { best.b.pieces.push({ p, ...best.o }); best.b.utilise += (best.b.pieces.length > 1 ? k : 0) + best.o.long; continue; }
    const o = [...os].sort((x, y) => x.travers - y.travers)[0]!;
    bandes.push({ largeur: o.travers, utilise: o.long, pieces: [{ p, ...o }] });
  }
  // bandes rangées dans les panneaux (la plus large d'abord, dans le premier panneau où elle tient)
  const panneauxBandes: Bande[][] = [];
  for (const b of [...bandes].sort((x, y) => y.largeur - x.largeur)) {
    const cible = panneauxBandes.find((l) => l.reduce((t, x) => t + x.largeur, 0) + k * l.length + b.largeur <= largeur);
    if (cible) cible.push(b); else panneauxBandes.push([b]);
  }
  const bins: Bin[] = panneauxBandes.map((l) => {
    const places: Place[] = [], libres: Rect[] = [];
    let y = opt.marge;
    for (const b of l) {
      let x = opt.marge;
      for (const q of b.pieces) { places.push({ ref: q.p.ref, nom: q.p.nom, x, y, w: q.long, h: q.travers, rot: q.rot }); x += q.long + k; }
      if (opt.marge + longueur - x >= 1) libres.push({ x, y, w: opt.marge + longueur - x, h: b.largeur });
      y += b.largeur + k;
    }
    if (opt.marge + largeur - y >= 1) libres.push({ x: opt.marge, y, w: longueur, h: opt.marge + largeur - y });
    return { panneau: pan, achat: true, places, libres };
  });
  const surface = bins.length * pan.L * pan.l, utile = pieces.reduce((t, p) => t + p.L * p.l, 0) - restants.reduce((t, p) => t + p.L * p.l, 0);
  return { bins, restants, cout: bins.length * pan.prix, chute: surface ? 1 - utile / surface : 0 };
  }
}

// Stock d'abord (chutes de l'atelier, plus grandes pièces en premier), puis découpe en bandes du reste sur panneaux achetés.
function stockPuisBandes(pieces: Piece[], panneaux: Panneau[], opt: Reglages): Plan | null {
  const stock = panneaux.filter((p) => p.qte > 0).map((p) => ({ ...p, prix: 0 }));
  const achat = panneaux.filter((p) => p.prix > 0).map((p) => ({ ...p, qte: 0 }));
  if (!stock.length || !achat.length) return null;
  const p1 = essai([...pieces].sort((a, b) => b.L * b.l - a.L * a.l), stock, opt);
  const p2 = p1.restants.length ? enBandes(p1.restants, achat, opt) : { bins: [], restants: [], cout: 0, chute: 0 };
  if (!p2) return null;
  const bins = [...p1.bins.filter((b) => b.places.length), ...p2.bins];
  const surface = bins.reduce((t, b) => t + b.panneau.L * b.panneau.l, 0);
  const utile = bins.reduce((t, b) => t + b.places.reduce((u, q) => u + q.w * q.h, 0), 0);
  return { bins, restants: p2.restants, cout: p2.cout, chute: surface ? 1 - utile / surface : 0 };
}

// Essaie plusieurs ordres de pose et garde le meilleur : tout placer, puis coût, puis nombre de panneaux, puis chute.
export function optimiser(pieces: Piece[], panneaux: Panneau[], opt: Reglages): Plan {
  const ordres: ((a: Piece, b: Piece) => number)[] = [
    (a, b) => b.L * b.l - a.L * a.l,
    (a, b) => Math.max(b.L, b.l) - Math.max(a.L, a.l) || b.L * b.l - a.L * a.l,
    (a, b) => b.l - a.l || b.L - a.L,
    (a, b) => b.L + b.l - (a.L + a.l),
  ];
  const note = (p: Plan) => [p.restants.length, p.cout, p.bins.length, p.chute];
  let best: Plan | null = enBandes(pieces, panneaux, opt);
  const candidats: (() => Plan | null)[] = [() => stockPuisBandes(pieces, panneaux, opt), ...ordres.map((o) => () => essai([...pieces].sort(o), panneaux, opt))];
  for (const f of candidats) {
    const plan = f();
    if (!plan) continue;
    if (!best) { best = plan; continue; }
    const a = note(plan), b = note(best);
    for (let i = 0; i < a.length; i++) { if (a[i]! < b[i]! - 1e-9) { best = plan; break; } if (a[i]! > b[i]! + 1e-9) break; }
  }
  return best!;
}

// Pièce trop grande pour tous les panneaux : coupée en `n` morceaux de `partL` × `partl`, à assembler.
export interface Decoupe { ref: string; nom: string; L: number; l: number; qte: number; n: number; partL: number; partl: number }
// Stock épuisé sans prix d'achat : panneaux qu'il faudrait acheter en plus (prix inconnu, hors coût).
export interface Manque { L: number; l: number; n: number }
export interface GroupePlan { matiere: string; e: number; nbPieces: number; plan: Plan; sansPanneau: boolean; decoupes: Decoupe[]; manques: Manque[] }

// Coupe une pièce trop grande en morceaux égaux qui tiennent dans un des panneaux (le moins de morceaux possible).
export function fractionner(p: Piece, panneaux: Panneau[], opt: Reglages): Piece[] | null {
  let best: { nx: number; ny: number; rot: boolean } | null = null;
  for (const pan of panneaux) {
    const W = pan.L - 2 * opt.marge, H = pan.l - 2 * opt.marge;
    if (W <= 0 || H <= 0) continue;
    for (const o of orientations(p)) {
      const nx = Math.ceil(o.w / W - 1e-9), ny = Math.ceil(o.h / H - 1e-9);
      if (!best || nx * ny < best.nx * best.ny) best = { nx, ny, rot: o.rot };
    }
  }
  if (!best || best.nx * best.ny <= 1 || best.nx * best.ny > 50) return null;
  // morceaux dans le repère de la pièce : en long (L) et en large (l)
  const nL = best.rot ? best.ny : best.nx, nl = best.rot ? best.nx : best.ny;
  const n = nL * nl, out: Piece[] = [];
  for (let k = 1; k <= n; k++) out.push({ ref: `${p.ref}.${k}`, nom: `${p.nom} (morceau ${k}/${n})`, L: p.L / nL, l: p.l / nl, fil: p.fil });
  return out;
}
const rentreDans = (p: Piece, panneaux: Panneau[], opt: Reglages) =>
  panneaux.some((pan) => orientations(p).some((o) => o.w <= pan.L - 2 * opt.marge && o.h <= pan.l - 2 * opt.marge));
const cle = (matiere: string, e: number) => `${matiere.trim().toLowerCase()}|${Math.round(e * 10) / 10}`;

// Regroupe la fiche de débit par matière et épaisseur, puis optimise chaque groupe sur les panneaux correspondants.
export function planDecoupe(rows: DebitRow[], stock: Panneau[], opt: Reglages): { groupes: GroupePlan[]; cout: number } {
  const groupes = new Map<string, { matiere: string; e: number; pieces: Piece[] }>();
  for (const r of rows) {
    if (r.qte < 1 || r.L <= 0 || r.l <= 0) continue;
    const k = cle(r.matiere, r.e);
    const g = groupes.get(k) ?? groupes.set(k, { matiere: r.matiere.trim(), e: r.e, pieces: [] }).get(k)!;
    for (let i = 0; i < Math.min(r.qte, 500); i++) g.pieces.push({ ref: r.ref, nom: r.nom, L: r.L, l: r.l, fil: r.fil });
  }
  const out: GroupePlan[] = [];
  for (const [k, g] of groupes) {
    const pans = stock.filter((p) => cle(p.matiere, p.e) === k && p.L > 0 && p.l > 0);
    // 1. pièces trop grandes : proposées en morceaux
    const decoupes: Decoupe[] = [];
    let pieces = g.pieces;
    if (pans.length && opt.decouper !== false) {
      pieces = [];
      for (const p of g.pieces) {
        const parts = rentreDans(p, pans, opt) ? null : fractionner(p, pans, opt);
        if (!parts) { pieces.push(p); continue; }
        pieces.push(...parts);
        const d = decoupes.find((x) => x.ref === p.ref && x.L === p.L && x.l === p.l);
        if (d) d.qte++;
        else decoupes.push({ ref: p.ref, nom: p.nom, L: p.L, l: p.l, qte: 1, n: parts.length, partL: parts[0]!.L, partl: parts[0]!.l });
      }
    }
    let plan = optimiser(pieces, pans, opt);
    // 2. stock épuisé sans prix : on compte les panneaux à acheter en plus, sans les chiffrer
    const manques: Manque[] = [];
    if (plan.restants.some((p) => rentreDans(p, pans, opt))) {
      const virtuels = pans.map((p) => ({ ...p, prix: p.prix > 0 ? p.prix : 1e-6 }));
      const plan2 = optimiser(pieces, virtuels, opt);
      if (plan2.restants.length < plan.restants.length) {
        for (const b of plan2.bins) {
          const orig = pans.find((x) => x.id === b.panneau.id)!;
          b.panneau = orig;
          if (b.achat && !(orig.prix > 0)) {
            const m = manques.find((x) => x.L === orig.L && x.l === orig.l);
            if (m) m.n++; else manques.push({ L: orig.L, l: orig.l, n: 1 });
          }
        }
        plan2.cout = plan2.bins.reduce((t, b) => t + (b.achat ? b.panneau.prix : 0), 0);
        plan = plan2;
      }
    }
    out.push({ matiere: g.matiere, e: g.e, nbPieces: g.pieces.length, plan, sansPanneau: pans.length === 0, decoupes, manques });
  }
  return { groupes: out, cout: out.reduce((s, g) => s + g.plan.cout, 0) };
}

// Après la découpe : les panneaux du stock utilisés sont retirés, les chutes assez grandes y entrent.
// Une chute garde le sens du panneau (L le long du fil), même si L < l.
export const CHUTE_MIN = { petit: 100, grand: 200 };
export function chutesDe(plan: Plan): { L: number; l: number }[] {
  const out: { L: number; l: number }[] = [];
  for (const b of plan.bins) for (const r of b.libres) {
    if (Math.min(r.w, r.h) >= CHUTE_MIN.petit && Math.max(r.w, r.h) >= CHUTE_MIN.grand) out.push({ L: Math.floor(r.w), l: Math.floor(r.h) });
  }
  return out;
}
export function appliquerDecoupe(stock: Panneau[], plan: Plan, matiere: string, e: number, nextId: () => number): Panneau[] {
  const s = stock.map((p) => ({ ...p }));
  for (const b of plan.bins) {
    if (b.achat) continue;
    const p = s.find((x) => x.id === b.panneau.id);
    if (p) p.qte = Math.max(0, p.qte - 1);
  }
  for (const c of chutesDe(plan)) {
    const same = s.find((x) => x.chute && x.matiere === matiere && x.e === e && x.L === c.L && x.l === c.l);
    if (same) same.qte++;
    else s.push({ id: nextId(), matiere, e, L: c.L, l: c.l, qte: 1, prix: 0, chute: true });
  }
  return s.filter((p) => !(p.chute && p.qte === 0));
}
