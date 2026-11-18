// Contrôle du projet avant de couper : ce que l'œil rate sur la 3D.
import { appliquerPose, elementDe, ferrures, piecesDe, poseOuverte, repere, type Element } from './elements';
import { meshBounds, materiauDe, volumeCommun, type Doc, type MeshData, type Solid } from './model';
import { balayagePlafond, piecesSousPlafond, type Plafond } from './plafond';

export interface Probleme { niveau: 'erreur' | 'attention'; message: string; ids: number[] }
const mm = (m: number) => Math.round(m * 1000);
type Boite = { min: number[]; max: number[] };
const recouvre = (a: Boite, b: Boite, k: number) => Math.min(a.max[k]!, b.max[k]!) - Math.max(a.min[k]!, b.min[k]!);
const axeMince = (b: Boite) => { const t = [0, 1, 2].map((i) => b.max[i]! - b.min[i]!); return t.indexOf(Math.min(...t)); };

// Portée libre maximale d'une tablette (pièce horizontale) : appuis = pièces verticales qui touchent son dessous ou ses bouts,
// ou montants posés dessus et fixés à un panneau plus haut (la tablette y est suspendue).
// `fixe` : panneau tout en haut ou tout en bas de ses appuis (dessus, dessous de caisson), assemblé et non posé : pas une tablette.
export function porteeLibre(d: Doc, t: Solid): { portee: number; porteAFaux: number; fixe: boolean } | null {
  const b = meshBounds(t.mesh);
  if (axeMince(b) !== 2 || b.max[2]! - b.min[2]! > 0.06) return null;       // panneau à plat seulement
  // la portée se mesure dans le sens où la tablette est tenue à ses bouts (souvent le plus long, pas toujours)
  const calcul = (long: number) => {
    const autre = 1 - long, appuis: [number, number][] = [];
    let haut = -Infinity, bas = Infinity, bouts = 0;
    for (const s of d.solids) {
      if (s.id === t.id || s.meta.masque) continue;
      const o = meshBounds(s.mesh);
      if (axeMince(o) === 2) continue;                                   // une autre tablette ne porte pas
      const dessous = Math.abs(o.max[2]! - b.min[2]!) < 0.001 && recouvre(o, b, long) > -0.001;
      // suspente : montant posé sur la tablette et vissé dans un panneau horizontal au-dessus (dessus de caisson…)
      const suspente = Math.abs(o.min[2]! - b.max[2]!) < 0.001 && recouvre(o, b, long) > -0.001 && d.solids.some((h) => {
        if (h.id === t.id || h.id === s.id || h.meta.masque) return false;
        const hb = meshBounds(h.mesh);
        return axeMince(hb) === 2 && Math.abs(hb.min[2]! - o.max[2]!) < 0.001 && recouvre(hb, o, 0) > 0.001 && recouvre(hb, o, 1) > 0.001;
      });
      const cote = recouvre(o, b, 2) > 0.001 && (Math.abs(o.max[long]! - b.min[long]!) < 0.001 || Math.abs(o.min[long]! - b.max[long]!) < 0.001);
      if ((dessous || suspente || cote) && recouvre(o, b, autre) > 0.05) {
        appuis.push([Math.max(o.min[long]!, b.min[long]!), Math.min(o.max[long]!, b.max[long]!)]);
        if (cote) { haut = Math.max(haut, o.max[2]!); bas = Math.min(bas, o.min[2]!); bouts++; }
      }
    }
    return { long, appuis, haut, bas, bouts };
  };
  const lx = calcul(0), ly = calcul(1);
  const plusLong = b.max[0]! - b.min[0]! >= b.max[1]! - b.min[1]! ? lx : ly;
  const c = lx.bouts !== ly.bouts ? (lx.bouts > ly.bouts ? lx : ly) : plusLong;
  const { long, appuis, haut, bas } = c;
  const fixe = haut > -Infinity && (b.max[2]! >= haut - 0.001 || b.min[2]! <= bas + 0.15);
  if (!appuis.length) return { portee: b.max[long]! - b.min[long]!, porteAFaux: 0, fixe: false };
  appuis.sort((x, y) => x[0] - y[0]);
  let portee = 0, fin = appuis[0]![1];
  for (const [a2, z] of appuis.slice(1)) { portee = Math.max(portee, a2 - fin); fin = Math.max(fin, z); }
  return { portee, porteAFaux: Math.max(appuis[0]![0] - b.min[long]!, b.max[long]! - fin), fixe };
}

// Portes ouvertes : chaque porte balaie son ouverture (quatre pas) ; elle ne doit toucher ni une pièce fixe,
// ni une autre porte ouverte au même moment (deux portes charnières côte à côte, aux joints entre meubles).
// Retourne pour chaque couple le premier pas en collision, en degrés.
export function collisionsOuverture(d: Doc): { porte: Element; autre: Solid | Element; angle: number; volume: number }[] {
  const PAS = 4, SEUIL = 5e-7;
  const portes = (d.elements ?? []).filter((e) => e.type === 'porte');
  const piecesPortes = new Set(portes.flatMap((e) => piecesDe(e)));
  const fixes = d.solids.filter((s) => !s.meta.masque && !piecesPortes.has(s.id)).map((s) => ({ s, b: meshBounds(s.mesh) }));
  const sortie: { porte: Element; autre: Solid | Element; angle: number; volume: number }[] = [];
  const vus = new Set<string>();
  for (let k = 1; k <= PAS; k++) {
    const ouvertes = portes.flatMap((el) => {
      const s = d.solids.find((x) => x.id === piecesDe(el)[0]), pose = poseOuverte(d, el, k / PAS);
      if (!s || s.meta.masque || !pose) return [];
      const v: number[] = [];
      for (let i = 0; i < s.mesh.v.length; i += 3) v.push(...appliquerPose(pose, [s.mesh.v[i]!, s.mesh.v[i + 1]!, s.mesh.v[i + 2]!]));
      const mesh: MeshData = { v, t: s.mesh.t };
      return [{ el, mesh, b: meshBounds(mesh), angle: Math.round((k / PAS) * el.ouverture) }];
    });
    const touche = (a: MeshData, ab: ReturnType<typeof meshBounds>, b: MeshData, bb: ReturnType<typeof meshBounds>) =>
      [0, 1, 2].every((i) => recouvre(ab, bb, i) > 0.0002) ? volumeCommun(a, b) : 0;
    ouvertes.forEach((o, i) => {
      for (const f of fixes) {
        const cle = `${o.el.id}:s${f.s.id}`, vol = vus.has(cle) ? 0 : touche(o.mesh, o.b, f.s.mesh, f.b);
        if (vol > SEUIL) { vus.add(cle); sortie.push({ porte: o.el, autre: f.s, angle: o.angle, volume: vol }); }
      }
      for (const p of ouvertes.slice(i + 1)) {
        const cle = `${o.el.id}:e${p.el.id}`, vol = vus.has(cle) ? 0 : touche(o.mesh, o.b, p.mesh, p.b);
        if (vol > SEUIL) { vus.add(cle); sortie.push({ porte: o.el, autre: p.el, angle: Math.max(o.angle, p.angle), volume: vol }); }
      }
    });
  }
  return sortie;
}

export function controler(d: Doc, plafond?: Plafond): Probleme[] {
  const out: Probleme[] = [];
  const vis = d.solids.filter((s) => !s.meta.masque);
  // pièces qui se traversent (le contact est permis)
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
    const a = vis[i]!, b = vis[j]!, ba = meshBounds(a.mesh), bb = meshBounds(b.mesh);
    if (![0, 1, 2].every((k) => recouvre(ba, bb, k) > 0.0002)) continue;
    const v = volumeCommun(a.mesh, b.mesh);
    // moins d'un demi-centimètre cube : arrondis de calcul (pièces tournées, coupes en biais), pas une vraie collision
    if (v > 5e-7) out.push({ niveau: 'erreur', message: `« ${a.name} » et « ${b.name} » se traversent (${(v * 1e6).toFixed(1).replace('.', ',')} cm³).`, ids: [a.id, b.id] });
  }
  // tablettes : 80 cm au plus entre deux appuis, 30 cm de porte-à-faux (panneau de 18 chargé)
  for (const s of vis) {
    if (!s.meta.piece || elementDe(d, s.id)) continue;
    const p = porteeLibre(d, s);
    if (!p) continue;
    if (p.portee > 0.8 && !p.fixe) out.push({ niveau: 'attention', message: `« ${s.name} » : ${mm(p.portee)} mm entre deux appuis (80 cm au plus conseillés) : ajoute un montant ou un tasseau.`, ids: [s.id] });
    if (p.porteAFaux > 0.3) out.push({ niveau: 'attention', message: `« ${s.name} » : ${mm(p.porteAFaux)} mm en porte-à-faux.`, ids: [s.id] });
  }
  // portes et tiroirs
  for (const el of d.elements ?? []) {
    const ids = piecesDe(el), main = d.solids.find((s) => s.id === ids[0]);
    if (!main) continue;
    const alerte = ferrures(d, el).find((f) => f.cote.includes('⚠'));
    if (alerte) out.push({ niveau: 'erreur', message: `« ${main.name} » : ${alerte.cote.split('⚠')[1]!.trim()}`, ids });
    if (el.type === 'tiroir' && !el.pieces.length) out.push({ niveau: 'attention', message: `Tiroir « ${main.name} » sans caisson : seule la façade est identifiée.`, ids });
    if (el.type === 'porte' && repere(d, main, ids, el.sens).e < 0.008) out.push({ niveau: 'attention', message: `« ${main.name} » : moins de 8 mm d'épaisseur.`, ids });
  }
  // portes qui se gênent en s'ouvrant
  const nomDe = (e: Element) => d.solids.find((x) => x.id === piecesDe(e)[0])?.name ?? e.type;
  for (const c of collisionsOuverture(d)) {
    const autre = 'type' in c.autre ? `la porte « ${nomDe(c.autre)} »` : `« ${c.autre.name} »`;
    const ids = [...piecesDe(c.porte), ...('type' in c.autre ? piecesDe(c.autre) : [c.autre.id])];
    out.push({ niveau: 'attention', message: `« ${nomDe(c.porte)} » touche ${autre} en s'ouvrant (vers ${c.angle}°) : limite l'ouverture (charnière bridée à 90°) ou écarte les portes.`, ids });
  }
  // plafond
  if (plafond) {
    for (const { id, depasse } of piecesSousPlafond(d, plafond)) out.push({ niveau: 'erreur', message: `« ${d.solids.find((s) => s.id === id)!.name} » dépasse le plafond de ${Math.round(depasse)} mm.`, ids: [id] });
    for (const el of d.elements ?? []) {
      const b = balayagePlafond(d, plafond, el);
      if (!b) continue;
      const nom = d.solids.find((s) => s.id === piecesDe(el)[0])?.name ?? el.type;
      const ou = el.type === 'porte' ? `vers ${Math.round(b.fraction * el.ouverture)}°` : `à ${Math.round(b.fraction * 100)} % de sa sortie`;
      out.push({ niveau: 'erreur', message: `« ${nom} » touche le plafond en s'ouvrant (${ou}, ${Math.round(b.depasse)} mm).`, ids: piecesDe(el) });
    }
  }
  // pièces sans matériau
  const sans = vis.filter((s) => s.meta.piece && !materiauDe(d, s) && !s.meta.matiere.trim());
  if (sans.length) out.push({ niveau: 'attention', message: `${sans.length} pièce(s) sans matériau : elles n'entrent pas dans la découpe.`, ids: sans.map((s) => s.id) });
  return out;
}
