import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { exportCollada, fusionnerSommets } from './kernel/collada';
import { creerAssistant } from './ui/assistant';
import { decorDe, uvDecor } from './kernel/decor';
import { MOTIFS, materiauxDecor, uvTriplanaire } from './ui/decors';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { repondre as repondreMcp, type Ctx as CtxMcp, type Vue as VueMcp } from './mcp';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import {
  REGLAGES_DEFAUT, SIDES, materiauDe, sidesOf, type Materiau,
  estManifold, sansMeublesVides, visibles, couleurDe, couleurParNom, materiauNomme, duplicateSolid, instancesOf, makeComponent, makeUnique, moveSolid, propagate, rotateSolid,
  addSegments, boxMesh, cloneDoc, emptyDoc, faceContains, initKernel, meshBounds, pieceDims, planarFaces, planeFromNormal,
  planeRegions, pushPullRegion, regionOnSolid, rotateMesh, splitSegments, to2, to3, translateMesh, add, sub, mul, dot, cross, len, norm,
  type CaissonRec, type Doc, type Extra, type Guide, type Plane, type Solid, type V3, type PlanarFace,
} from './kernel/model';
import { boiteDe, transformer, type ModeEchelle } from './kernel/echelle';
import { caissonTiroir, copierElements, coulisseAuto, elementDe, elementsDuCaisson, facadeParmi, ferrures, piecesDe, poseOuverte, pointPrise, appliquerPose, course, reconnaitre, repere, synchroniserElements, COULISSES, ENTRAXES, OUVERTURES, RECOUVREMENTS, type Element, type Forme, type Pose, type Translation } from './kernel/elements';
import { PRESETS_MAT, renderMethods as renderMaterieux, type FenetreMateriaux } from './ui/materiaux';
import { openPlans } from './ui/plans';
import { ouvrirCourses, ouvrirNotice, ouvrirPercage, ouvrirPlafond, ouvrirVerification, type Feuille } from './ui/feuilles';
import { hauteurPlafond } from './kernel/plafond';
import { regionAt, type P2, type Region, type Seg2 } from './kernel/arrangement';
import { coutChant, refsDesPieces, syncFromModel, toCsv, totals, type DebitRow } from './kernel/debit';
import { parse, serialize, type Saved } from './kernel/file';
import { appliquerDecoupe, chutesDe, planDecoupe, type Bin } from './kernel/nesting';
import { CAISSON_DEFAUT, MODELES, deplacerMontant, fixerLargeur, genererCaisson, verifier, videsColonnes, type CaissonParams, type TypeColonne } from './kernel/cabinet';

// ───────── État ─────────
let doc: Doc = emptyDoc();
let debit: DebitRow[] = [];
let shown: Doc = doc; // document affiché (aperçu pendant une opération)
const selected = new Set<number>();
const KEY = 'workshop3d.v2';
let history: string[] = [];
let hIdx = -1;

const snapshot = () => JSON.stringify({ doc, debit } satisfies Saved);
function commit() {
  doc = synchroniserElements(sansMeublesVides(doc));
  history = history.slice(0, hIdx + 1);
  history.push(snapshot());
  hIdx = history.length - 1;
  persist(); setDirty(true);
  refresh();
}
function persist() {
  try { localStorage.setItem(KEY, history[hIdx]!); localStorage.setItem(KEY + '.path', filePath ?? ''); } catch { /* stockage indisponible */ }
}
function restore(i: number) {
  hIdx = i;
  const s = JSON.parse(history[i]!) as Saved;
  doc = s.doc; debit = s.debit; selected.clear();
  persist(); setDirty(true);
  cancelOp(); refresh();
}
const undo = () => { if (hIdx > 0) restore(hIdx - 1); };
const redo = () => { if (hIdx < history.length - 1) restore(hIdx + 1); };

// ───────── Fichiers (.workshop) ─────────
interface TauriApi {
  core: { invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> };
  event: { listen(name: string, cb: (e: { payload: string }) => void): Promise<unknown> };
  window: { getCurrentWindow(): { setTitle(t: string): Promise<void> } };
}
const tauri = (window as unknown as { __TAURI__?: TauriApi }).__TAURI__;
let filePath: string | null = null;
let dirty = false;

function setDirty(d: boolean) {
  dirty = d;
  const name = filePath ? filePath.split('/').pop()! : 'Sans titre';
  const title = `${dirty ? '• ' : ''}${name} — Workshop 3D`;
  document.title = title;
  void tauri?.window.getCurrentWindow().setTitle(title).catch(() => {});
}
function fileError(e: unknown) { alertBox(e instanceof Error ? e.message : String(e)); }
function alertBox(msg: string) {
  const el = document.getElementById('help')!;
  el.textContent = `⚠ ${msg}`; el.style.color = '#d33a2c';
  setTimeout(() => { el.style.color = ''; el.textContent = HELP[tool]; }, 6000);
}
async function okToDiscard(): Promise<boolean> {
  if (!dirty) return true;
  const msg = 'Le modèle a des modifications non enregistrées.';
  return tauri ? tauri.core.invoke<boolean>('confirm_discard', { message: msg }) : window.confirm(`${msg} Continuer sans enregistrer ?`);
}
function loadSaved(s: Saved, path: string | null) {
  doc = sansMeublesVides(s.doc); debit = s.debit; rowId = Math.max(0, ...debit.map((r) => r.id)) + 1;
  selected.clear(); filePath = path;
  history = [snapshot()]; hIdx = 0;
  persist(); setDirty(false); cancelOp(); refresh(); fitAll();
}
async function fileNew() {
  if (await okToDiscard()) loadSaved({ doc: emptyDoc(), debit: [] }, null);
}
async function fileOpen() {
  try {
    if (!(await okToDiscard())) return;
    if (tauri) {
      const r = await tauri.core.invoke<[string, string] | null>('open_doc');
      if (r) loadSaved(parse(r[1]), r[0]);
    } else {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.workshop,.atelier';
      inp.onchange = async () => { try { const f = inp.files?.[0]; if (f) loadSaved(parse(await f.text()), null); } catch (e) { fileError(e); } };
      inp.click();
    }
  } catch (e) { fileError(e); }
}
async function fileSave(saveAs = false) {
  try {
    const contents = serialize({ doc, debit });
    if (tauri) {
      const p = await tauri.core.invoke<string | null>('save_doc', { path: saveAs ? null : filePath, contents });
      if (!p) return;
      filePath = p;
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
      a.download = 'modele.workshop'; a.click(); URL.revokeObjectURL(a.href);
    }
    persist(); setDirty(false);
  } catch (e) { fileError(e); }
}
// ───────── Collada (.dae) : échange avec SketchUp et Sweet Home 3D ─────────
// Export : la sélection (ou tout le modèle), une pièce par objet, une couleur par matière, en mètres, Z vers le haut.
async function exporterDae() {
  const sel = doc.solids.filter((x) => selected.has(x.id));
  const list = sel.length ? sel : doc.solids;
  if (!list.length) { alertBox('Rien à exporter.'); return; }
  const dae = exportCollada(list, (x) => materiauDe(doc, x)?.nom || x.meta.matiere, (x) => couleurDe(doc, x));
  const nom = `${(list.find((x) => x.meta.caisson)?.name ? 'meuble' : 'modele')}.dae`;
  try {
    if (tauri) {
      const p = await tauri.core.invoke<string | null>('save_doc', { path: null, contents: dae, ext: 'dae', nom });
      if (!p) return;
      setHud(`${list.length} pièce(s) exportée(s) dans ${esc(p.split('/').pop()!)}`);
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([dae], { type: 'model/vnd.collada+xml' }));
      a.download = nom; a.click(); URL.revokeObjectURL(a.href);
      setHud(`${list.length} pièce(s) exportée(s)`);
    }
  } catch (e) { fileError(e); }
}
// Import : chaque objet devient une pièce. Une pièce fermée entre dans la fiche de débit et accepte Pousser/Tirer ;
// une géométrie ouverte (décor, pièce de maison) reste un objet de référence.
type ObjetDae = { name: string; mesh: { v: number[]; t: number[] }; matiere?: { nom: string; couleur: string } };
function lireDae(texte: string): ObjetDae[] {
  const c = new ColladaLoader().parse(texte, '');
  if (!c) throw new Error('Fichier Collada illisible.');
  // le chargeur passe en Y vers le haut ; on revient en Z vers le haut comme le reste de l'app
  if (/<up_axis>\s*Z_UP/i.test(texte)) c.scene.rotation.set(0, 0, 0); else c.scene.rotation.set(Math.PI / 2, 0, 0);
  c.scene.updateMatrixWorld(true);
  const out: ObjetDae[] = [];
  c.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry?.attributes.position) return;
    const pos = (m.geometry.attributes.position as THREE.BufferAttribute).clone().applyMatrix4(m.matrixWorld);
    const mesh = fusionnerSommets(pos.array, m.geometry.index ? m.geometry.index.array : null);
    if (!mesh.t.length) return;
    // matériau du fichier (nom et couleur) ; plusieurs matériaux : celui qui couvre le plus de triangles
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const part = mats.map((_, i) => m.geometry.groups.filter((g) => (g.materialIndex ?? 0) === i).reduce((t, g) => t + g.count, 0));
    const mat = mats[part.indexOf(Math.max(...part))] as THREE.MeshLambertMaterial | undefined;
    const nom = mat?.name?.trim();
    out.push({ name: m.name || m.parent?.name || 'Objet importé', mesh, ...(nom ? { matiere: { nom, couleur: `#${(mat!.color ?? new THREE.Color(0xe9d6ab)).getHexString()}` } } : {}) });
  });
  return out;
}
async function importerDae() {
  try {
    let texte: string | null = null;
    if (tauri) {
      const r = await tauri.core.invoke<[string, string] | null>('open_doc', { ext: 'dae', label: 'Collada' });
      texte = r?.[1] ?? null;
    } else {
      texte = await new Promise<string | null>((ok) => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.dae';
        inp.onchange = async () => ok(inp.files?.[0] ? await inp.files[0].text() : null);
        inp.click();
      });
    }
    if (texte) importerTexteDae(texte);
  } catch (e) { fileError(e); }
}
function importerTexteDae(texte: string) {
  try {
    const objets = lireDae(texte);
    if (!objets.length) { alertBox('Aucune géométrie trouvée dans ce fichier.'); return; }
    doc = cloneDoc(doc);
    // posé à droite de ce qui existe déjà, au sol
    const lo: V3 = [Infinity, Infinity, Infinity];
    for (const o of objets) for (let i = 0; i < o.mesh.v.length; i++) lo[i % 3] = Math.min(lo[i % 3]!, o.mesh.v[i]!);
    const bb = bboxOf(doc.solids);
    const dx: V3 = [(bb ? bb.max[0] + 0.3 : 0) - lo[0], -lo[1], -lo[2]];
    selected.clear();
    let fermees = 0;
    for (const o of objets) {
      const mesh = translateMesh(o.mesh, dx);
      const ok = estManifold(mesh);
      if (ok) fermees++;
      // matériau du fichier : repris s'il existe déjà dans le projet, sinon créé avec la couleur du fichier
      let methode = 0;
      if (o.matiere) {
        const n = o.matiere.nom.toLowerCase(), existe = (doc.methods ?? []).some((x) => x.nom.toLowerCase() === n || x.matiere.toLowerCase() === n);
        methode = materiauNomme(doc, o.matiere.nom);
        const mt = doc.methods!.find((x) => x.id === methode);
        if (mt && !existe) mt.couleur = o.matiere.couleur;
      }
      const id = doc.next++;
      doc.solids.push({ id, name: o.name, mesh, meta: { piece: ok, matiere: '', fil: 'aucun', note: ok ? '' : 'importé, non fermé', ...(methode ? { methode } : {}) } });
      selected.add(id);
    }
    commit(); setTool('select'); vue('iso'); fitAll();
    setHud(`${objets.length} objet(s) importé(s), dont ${fermees} pièce(s) fermée(s) comptée(s) dans la fiche de débit`);
  } catch (e) { fileError(e); }
}

// Annuler/Rétablir venant du menu natif : dans un champ de saisie, c'est le texte qu'on annule.
function menuUndo(isRedo: boolean) {
  if ((document.activeElement as HTMLElement | null)?.closest('input, select, textarea')) document.execCommand(isRedo ? 'redo' : 'undo');
  else if (isRedo) redo(); else undo();
}
void tauri?.event.listen('menu', (e) => {
  const id = e.payload;
  if (id === 'new') void fileNew();
  else if (id === 'open') void fileOpen();
  else if (id === 'save') void fileSave();
  else if (id === 'save_as') void fileSave(true);
  else if (id === 'undo') menuUndo(false);
  else if (id === 'redo') menuUndo(true);
  else if (id === 'import_dae') void importerDae();
  else if (id === 'export_dae') void exporterDae();
  else void commandeEdition(id);
});

const tv = (p: V3) => new THREE.Vector3(p[0], p[1], p[2]);
const fv = (v: THREE.Vector3): V3 => [v.x, v.y, v.z];

// ───────── Scène ─────────
const root = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
root.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.02, 3000);
camera.up.set(0, 0, 1);
camera.position.set(3, -4, 2.5);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0.4);
controls.enableDamping = false;
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

scene.add(new THREE.HemisphereLight(0xffffff, 0x9a9184, 1.3));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(4, -3, 8);
scene.add(sun);
for (const [i, color] of [[0, 0xd33a2c], [1, 0x2ea043], [2, 0x2f6fed]] as const) {
  const v: V3 = [0, 0, 0]; v[i] = 200;
  const w: V3 = [0, 0, 0]; w[i] = -200;
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([tv([0, 0, 0]), tv(v)]), new THREE.LineBasicMaterial({ color })));
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([tv([0, 0, 0]), tv(w)]), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.3 })));
}
const world = new THREE.Group();
const overlay = new THREE.Group();
scene.add(world, overlay);

const solidMat = new THREE.MeshLambertMaterial({ color: 0xe9d6ab, flatShading: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
const solidSelMat = new THREE.MeshLambertMaterial({ color: 0xc7dcff, flatShading: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
const fillMat = new THREE.MeshLambertMaterial({ color: 0xefe2c0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 0.5, polygonOffsetUnits: 0.5 });
const lineMat = new THREE.LineBasicMaterial({ color: 0x1b1b1b });
const lineSelMat = new THREE.LineBasicMaterial({ color: 0x1a73e8 });
// Un matériau three par couleur de pièce (et sa version éclaircie au survol), créé à la demande.
const matsCouleur = new Map<string, THREE.MeshLambertMaterial>();
function matCouleur(hex: string, survol: boolean): THREE.MeshLambertMaterial {
  const k = `${hex}${survol ? '+' : ''}`;
  let m = matsCouleur.get(k);
  if (!m) {
    const c = new THREE.Color(hex);
    if (survol) c.lerp(new THREE.Color(0xffffff), 0.35);
    m = solidMat.clone(); m.color = c; matsCouleur.set(k, m);
  }
  return m;
}
const lineHoverMat = new THREE.LineBasicMaterial({ color: 0x6aa6f0 });
const hoverMat = new THREE.MeshBasicMaterial({ color: 0x4a90e2, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthTest: false });
const guideMat = new THREE.LineBasicMaterial({ color: 0x1a73e8, depthTest: false });

function clearGroup(g: THREE.Group) {
  for (const c of [...g.children]) {
    g.remove(c);
    c.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
  }
}

function regionGeometry(P: Plane, r: Region): THREE.BufferGeometry {
  const contour = r.outer.map((p) => new THREE.Vector2(p[0], p[1]));
  const holes = r.holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
  const tris = THREE.ShapeUtils.triangulateShape(contour, holes);
  const pts = [...r.outer, ...r.holes.flat()];
  const pos: number[] = [];
  for (const t of tris) for (const i of t) pos.push(...to3(P, pts[i]!));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Cotes hors tout de la sélection (ou de tout le modèle), dessinées le long de la boîte englobante.
const cotesGroup = new THREE.Group();
scene.add(cotesGroup);
let cotesOn = false;
// Ouverture des portes et tiroirs à l'écran, de 0 (fermé) à 1 (ouvert en grand) : affichage seulement, pas enregistré.
const ouverts = new Map<number, number>();
let ferruresOn = true;
// Affichage : plafond de référence, repères de fiche sur les pièces, vue éclatée.
let plafondOn = true, reperesOn = false, eclate = false;
const plafondMat = new THREE.MeshBasicMaterial({ color: 0xd33a2c, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false });
const reperesGroup = new THREE.Group();
scene.add(reperesGroup);
function viderReperes() { for (const c of [...reperesGroup.children]) { reperesGroup.remove(c); if (c instanceof CSS2DObject) c.element.remove(); } }
const ferrureMat = new THREE.MeshLambertMaterial({ color: 0x8d939a });
function matricePose(p: Pose | Translation): THREE.Matrix4 {
  if (p.kind === 'translation') return new THREE.Matrix4().makeTranslation(p.v[0], p.v[1], p.v[2]);
  const vers = new THREE.Matrix4().makeTranslation(p.point[0], p.point[1], p.point[2]);
  const depuis = new THREE.Matrix4().makeTranslation(-p.point[0], -p.point[1], -p.point[2]);
  return vers.multiply(new THREE.Matrix4().makeRotationAxis(tv(p.axe).normalize(), p.angle)).multiply(depuis);
}
function meshForme(f: Forme): THREE.Mesh {
  if (f.kind === 'boite') {
    const t = sub(f.max, f.min), c = mul(add(f.min, f.max), 0.5);
    const m = new THREE.Mesh(new THREE.BoxGeometry(t[0], t[1], t[2]), ferrureMat);
    m.position.copy(tv(c)); return m;
  }
  const m = new THREE.Mesh(new THREE.CylinderGeometry(f.rayon, f.rayon, f.long, 24), ferrureMat);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tv(f.axe).normalize());
  m.position.copy(tv(f.centre)); return m;
}
const coteMat = new THREE.LineBasicMaterial({ color: 0x1a73e8, depthTest: false });
function bboxOf(list: Doc['solids']): { min: V3; max: V3 } | null {
  if (!list.length) return null;
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const s of list) { const b = meshBounds(s.mesh); for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, b.min[k]!); max[k] = Math.max(max[k]!, b.max[k]!); } }
  return { min, max };
}
function drawCotes() {
  for (const c of [...cotesGroup.children]) { cotesGroup.remove(c); if (c instanceof CSS2DObject) c.element.remove(); }
  if (!cotesOn) return;
  const sel = shown.solids.filter((s) => selected.has(s.id));
  const bb = bboxOf(sel.length ? sel : shown.solids);
  if (!bb) return;
  const { min, max } = bb;
  const off = Math.max(0.05, len(sub(max, min)) * 0.04);
  const cote = (a: V3, b: V3, valeur: number) => {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([tv(a), tv(b)]), coteMat);
    l.renderOrder = 7; cotesGroup.add(l);
    const el = document.createElement('div');
    el.className = 'cote'; el.textContent = `${fmt(valeur)} ${unit().name}`;
    const o = new CSS2DObject(el); o.position.copy(tv(mul(add(a, b), 0.5))); cotesGroup.add(o);
  };
  cote([min[0], min[1] - off, min[2]], [max[0], min[1] - off, min[2]], max[0] - min[0]);
  cote([max[0] + off, min[1], min[2]], [max[0] + off, max[1], min[2]], max[1] - min[1]);
  cote([min[0] - off, min[1] - off, min[2]], [min[0] - off, min[1] - off, max[2]], max[2] - min[2]);
}

// Guides : tirets gris, longs de 100 m de chaque côté.
const GUIDE_L = 100;
const guideTraitMat = new THREE.LineDashedMaterial({ color: 0x7a7a7a, dashSize: 0.03, gapSize: 0.02 });
const guideDerriereMat = new THREE.LineBasicMaterial({ color: 0xd946ef, transparent: true, opacity: 0.35, depthTest: false });
// Point d'une droite (p, d) le plus proche du rayon de la souris.
function procheSurDroite(p: V3, d: V3): V3 {
  const o = fv(raycaster.ray.origin), r = rayDir();
  const w0 = sub(p, o), b = dot(d, r), den = 1 - b * b;
  const t = den < 1e-9 ? 0 : (b * dot(r, w0) - dot(d, w0)) / den;
  return add(p, mul(d, t));
}
// Intersections deux à deux des guides (droites qui se coupent vraiment).
function croisementsGuides(gs: Guide[]): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) {
    const a = gs[i]!, b = gs[j]!, n = cross(a.d, b.d), nn = dot(n, n);
    if (nn < 1e-12) continue;
    const w = sub(b.p, a.p);
    if (Math.abs(dot(w, n)) / Math.sqrt(nn) > 1e-6) continue;   // droites non coplanaires
    const t = dot(cross(w, b.d), n) / nn;
    out.push(add(a.p, mul(a.d, t)));
  }
  return out;
}

function rebuild() {
  clearGroup(world);
  drawCotes();
  const d = shown;
  // pose des éléments ouverts : la même matrice pour leurs pièces et leur quincaillerie
  const poses = new Map<number, THREE.Matrix4>();
  for (const el of d.elements ?? []) { const f = ouverts.get(el.id) ?? 0; if (f > 0) { const p = poseOuverte(d, el, f); if (p) poses.set(el.id, matricePose(p)); } }
  const poseDe = new Map<number, THREE.Matrix4>();
  for (const el of d.elements ?? []) { const m = poses.get(el.id); if (m) for (const i of piecesDe(el)) poseDe.set(i, m); }
  // vue éclatée : chaque pièce s'écarte du centre du modèle (affichage seulement)
  if (eclate) {
    const vis = visibles(d), bb = bboxOf(vis);
    if (bb) {
      const c = mul(add(bb.min, bb.max), 0.5);
      for (const s of vis) {
        const b = meshBounds(s.mesh), o = mul(sub(mul(add(b.min, b.max), 0.5), c), 0.6);
        const t = new THREE.Matrix4().makeTranslation(o[0], o[1], o[2]);
        poseDe.set(s.id, poseDe.has(s.id) ? t.multiply(poseDe.get(s.id)!) : t);
      }
      for (const el of d.elements ?? []) { const m = poseDe.get(piecesDe(el)[0]!); if (m) poses.set(el.id, m); }
    }
  }
  const masques = new Set(d.solids.filter((x) => x.meta.masque).map((x) => x.id));
  // plafond de référence : un plan rouge pâle au-dessus du modèle
  if (d.plafond && plafondOn) {
    const bb = bboxOf(d.solids);
    if (bb) {
      const [x0, y0, x1, y1] = [bb.min[0] - 0.3, bb.min[1] - 0.3, bb.max[0] + 0.3, bb.max[1] + 0.3];
      const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => [x!, y!, hauteurPlafond(d.plafond!, [x!, y!, 0])] as V3);
      const g = new THREE.BufferGeometry().setFromPoints([0, 1, 2, 0, 2, 3].map((i) => tv(pts[i]!)));
      world.add(new THREE.Mesh(g, plafondMat));
    }
  }
  // repères : la référence de fiche (P1, P2…) au centre de chaque pièce
  viderReperes();
  if (reperesOn) {
    const refs = refsDesPieces(d, syncFromModel(d, debit, rowId));
    for (const s of visibles(d)) {
      const r = refs.get(s.id);
      if (!r) continue;
      const b = meshBounds(s.mesh), c = tv(mul(add(b.min, b.max), 0.5));
      const pm = poseDe.get(s.id);
      if (pm) c.applyMatrix4(pm);
      const div = document.createElement('div');
      div.className = 'repere'; div.textContent = r;
      const o = new CSS2DObject(div); o.position.copy(c); reperesGroup.add(o);
    }
  }
  if (ferruresOn) for (const el of d.elements ?? []) {
    if (masques.has(el.type === 'porte' ? el.piece : el.facade)) continue;
    for (const f of ferrures(d, el)) for (const forme of f.formes) {
      const m = meshForme(forme);
      const pm = poses.get(el.id) ?? poseDe.get(piecesDe(el)[0]!);
      if (pm) m.applyMatrix4(pm);
      world.add(m);
    }
  }
  for (const s of visibles(d)) {
    const g = new THREE.BufferGeometry();
    const isSel = selected.has(s.id);
    const isHover = !isSel && (s.id === hoverId || hoverIds.has(s.id));
    const decor = isSel ? 'uni' : decorDe(d, s);
    const faces = planarFaces(s.mesh);
    let faceOfTri: number[] = new Array(s.mesh.t.length / 3).fill(-1);
    faces.forEach((f, fi) => f.tris.forEach((t) => { faceOfTri[t] = fi; }));
    let mesh: THREE.Mesh, aretes: THREE.BufferGeometry | null = null;
    if (decor === 'tissu') {
      // forme libre importée : normales lissées sauf aux arêtes vives, texture projetée
      const b = new THREE.BufferGeometry();
      b.setAttribute('position', new THREE.Float32BufferAttribute(s.mesh.v, 3));
      b.setIndex(s.mesh.t);
      const lisse = toCreasedNormals(b, (40 * Math.PI) / 180);
      uvTriplanaire(lisse, MOTIFS.tissu.face, s.id);
      for (const k of Object.keys(lisse.attributes)) g.setAttribute(k, lisse.getAttribute(k));
      // pas de traits : les maillages importés ont souvent des sommets en T, qui dessineraient chaque triangle
      aretes = new THREE.BufferGeometry();
      mesh = new THREE.Mesh(g, materiauxDecor('tissu', couleurDe(d, s), isHover, solidMat)[0]!);
    } else if (decor === 'uni') {
      g.setAttribute('position', new THREE.Float32BufferAttribute(s.mesh.v, 3));
      g.setIndex(s.mesh.t);
      g.computeVertexNormals();
      mesh = new THREE.Mesh(g, isSel ? solidSelMat : matCouleur(couleurDe(d, s), isHover));
    } else {
      // décor : texture à l'échelle réelle, faces et chants séparés ; les triangles changent d'ordre, la sélection de face suit
      const r = uvDecor(s.mesh, s.meta.fil, MOTIFS[decor].face, MOTIFS[decor].chant, s.id);
      g.setAttribute('position', new THREE.Float32BufferAttribute(r.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(r.uv, 2));
      g.computeVertexNormals();
      g.addGroup(0, r.nFaces, 0); g.addGroup(r.nFaces, r.pos.length / 3 - r.nFaces, 1);
      faceOfTri = r.ordre.map((t) => faceOfTri[t]!);
      mesh = new THREE.Mesh(g, materiauxDecor(decor, couleurDe(d, s), isHover, solidMat));
    }
    mesh.userData = { solidId: s.id, faces, faceOfTri, pick: true };
    const pts: THREE.Vector3[] = [];
    if (!aretes) for (const f of faces) for (const l of f.loops) for (let i = 0; i < l.length; i++) pts.push(tv(l[i]!), tv(l[(i + 1) % l.length]!));
    mesh.add(new THREE.LineSegments(aretes ?? new THREE.BufferGeometry().setFromPoints(pts), isSel ? lineSelMat : isHover ? lineHoverMat : lineMat));
    const pm = poseDe.get(s.id);
    if (pm) mesh.applyMatrix4(pm);
    world.add(mesh);
  }
  for (const g of d.guides ?? []) {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([tv(add(g.p, mul(g.d, -GUIDE_L))), tv(add(g.p, mul(g.d, GUIDE_L)))]), guideTraitMat);
    l.computeLineDistances(); l.userData = { guideId: g.id };
    world.add(l);
    // un guide caché par une pièce reste visible en pâle, sinon on croit qu'il n'a pas été posé
    const fond = new THREE.Line(l.geometry.clone(), guideDerriereMat);
    fond.renderOrder = 4; world.add(fond);
  }
  for (const sk of d.sketches) {
    const pts: THREE.Vector3[] = [];
    for (const [a, b] of sk.segs) pts.push(tv(to3(sk.plane, a)), tv(to3(sk.plane, b)));
    world.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
    for (const r of planeRegions(d, sk.plane)) {
      if (regionOnSolid(d, sk.plane, r)) continue;
      const m = new THREE.Mesh(regionGeometry(sk.plane, r), fillMat);
      m.userData = { sketchId: sk.id, pick: true };
      world.add(m);
    }
  }
}

const marker = new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3()]), new THREE.PointsMaterial({ color: 0, size: 9, sizeAttenuation: false, depthTest: false }));
marker.renderOrder = 10; marker.visible = false;
scene.add(marker);

// ───────── Pointage ─────────
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function setRay(ev: { clientX: number; clientY: number }) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
}
const rayDir = () => fv(raycaster.ray.direction);
const orient = (o: V3, n: V3): Plane => planeFromNormal(o, dot(n, rayDir()) > 0 ? mul(n, -1) : n);

function planeHit(P: Plane): V3 | null {
  const { origin: o, direction: d } = raycaster.ray;
  const dn = dot(P.n, fv(d));
  if (Math.abs(dn) < 1e-9) return null;
  const t = dot(P.n, sub(P.o, fv(o))) / dn;
  return t < 0 ? null : fv(o.clone().addScaledVector(d, t));
}

interface Pick { plane: Plane; point: V3; solidId: number | null }
function pick(ev: PointerEvent): Pick | null {
  setRay(ev);
  const objs: THREE.Object3D[] = [];
  world.traverse((o) => { if (o.userData.pick) objs.push(o); });
  const h = raycaster.intersectObjects(objs, false)[0];
  if (h) {
    const u = h.object.userData as { solidId?: number; sketchId?: number; faces?: PlanarFace[]; faceOfTri?: number[] };
    if (u.solidId !== undefined && u.faces && u.faceOfTri) {
      const F = u.faces[u.faceOfTri[h.faceIndex!]!];
      if (F) return { plane: orient(F.loops[0]![0]!, F.n), point: fv(h.point), solidId: u.solidId };
    } else if (u.sketchId !== undefined) {
      const sk = shown.sketches.find((s) => s.id === u.sketchId);
      if (sk) return { plane: orient(sk.plane.o, sk.plane.n), point: fv(h.point), solidId: null };
    }
  }
  const g = orient([0, 0, 0], [0, 0, 1]);
  const p = planeHit(g);
  return p ? { plane: g, point: p, solidId: null } : null;
}

const gridStep = () => { const d = camera.position.distanceTo(controls.target); return d < 3 ? 0.001 : d < 8 ? 0.01 : 0.05; };

function snapCandidates(P: Plane): V3[] {
  const out: V3[] = [];
  const onPlane = (p: V3) => Math.abs(dot(P.n, sub(p, P.o))) < 1e-4;
  for (const sk of shown.sketches) for (const [a, b] of sk.segs) {
    const A = to3(sk.plane, a), B = to3(sk.plane, b);
    for (const p of [A, B, mul(add(A, B), 0.5)]) if (onPlane(p)) out.push(p);
  }
  for (const s of visibles(shown)) for (const F of planarFaces(s.mesh)) for (const l of F.loops) for (let i = 0; i < l.length; i++) {
    const A = l[i]!, B = l[(i + 1) % l.length]!;
    for (const p of [A, mul(add(A, B), 0.5)]) if (onPlane(p)) out.push(p);
  }
  return out;
}
function snap(P: Plane, p: V3): V3 {
  const tol = camera.position.distanceTo(controls.target) * 0.02;
  let best: V3 | null = null, bd = tol;
  for (const c of snapCandidates(P)) { const d = len(sub(c, p)); if (d < bd) { bd = d; best = c; } }
  // guides couchés dans ce plan : d'abord leurs croisements, puis la droite elle-même
  const gs = (shown.guides ?? []).filter((g) => Math.abs(dot(g.d, P.n)) < 1e-6 && Math.abs(dot(P.n, sub(g.p, P.o))) < 1e-5);
  for (const c of croisementsGuides(gs)) { const d = len(sub(c, p)); if (d < bd) { bd = d; best = c; } }
  if (best) { marker.material.color.set(0x16a34a); marker.position.copy(tv(best)); marker.visible = true; return best; }
  let surGuide: V3 | null = null, bg = tol * 0.6;
  for (const g of gs) { const q = add(g.p, mul(g.d, dot(sub(p, g.p), g.d))); const d = len(sub(q, p)); if (d < bg) { bg = d; surGuide = q; } }
  if (surGuide) {
    // glissé le long du guide, au pas de la grille
    const g = gs.find((x) => len(sub(add(x.p, mul(x.d, dot(sub(surGuide!, x.p), x.d))), surGuide!)) < 1e-9)!;
    const st = gridStep(), t = Math.round(dot(sub(surGuide, g.p), g.d) / st) * st;
    const q = add(g.p, mul(g.d, t));
    marker.material.color.set(0xd946ef); marker.position.copy(tv(q)); marker.visible = true;
    return q;
  }
  const st = gridStep();
  const [x, y] = to2(P, p);
  const q = to3(P, [Math.round(x / st) * st, Math.round(y / st) * st]);
  marker.material.color.set(0); marker.position.copy(tv(q)); marker.visible = true;
  return q;
}

// ───────── Unités et saisie ─────────
const UNITS = [{ name: 'mm', f: 1000, d: 0 }, { name: 'cm', f: 100, d: 1 }, { name: 'm', f: 1, d: 3 }];
let unitIdx = 0;
const unit = () => UNITS[unitIdx]!;
const fmt = (m: number) => (m * unit().f).toFixed(unit().d);
let typed = '';
const parseTyped = (): number[] => typed.split(/[;x/]/).map((s) => parseFloat(s.replace(',', '.'))).filter((n) => !Number.isNaN(n));

// ───────── Outils ─────────
type Tool = 'select' | 'adjust' | 'scale' | 'open' | 'line' | 'rect' | 'circle' | 'pushpull' | 'move' | 'rotate' | 'tape' | 'erase' | 'orbit' | 'pan';
let tool: Tool = 'select';

interface Draw { P: Plane; p1: P2; cur: P2 }
let draw: Draw | null = null;          // rect / cercle / ligne en cours
interface PP { P: Plane; p2: P2; start: V3; d: number }
let pp: PP | null = null;
// Déplacer façon SketchUp : clic 1 = point de référence (accroché aux coins et milieux), clic 2 = destination.
// Le mouvement s'accroche aux sommets des autres pièces et aux axes rouge, vert, bleu ; flèches ou Maj pour verrouiller.
interface Mv { ids: number[]; start: V3; delta: V3; lock: 0 | 1 | 2 | null; infer: 0 | 1 | 2 | null; copy: boolean }
// Dernière copie posée : permet « x5 » (5 copies au même pas) ou « /5 » (5 copies réparties) juste après.
// Dernier déplacement posé : une distance tapée ensuite le corrige ; « x5 » ou « /5 » répète une copie.
let lastCopy: { base: string; ids: number[]; delta: V3; copy: boolean } | null = null;
let mv: Mv | null = null;
// Rotation façon rapporteur : 1er clic = centre, 2e clic = ligne de départ, 3e clic = angle.
// L'axe suit la face survolée (ou l'axe verrouillé aux flèches) ; Option = tourner une copie.
interface Rot { phase: 'ref' | 'angle'; ids: number[]; center: V3; axis: V3; ref: V3 | null; angle: number; copy: boolean }
let rot: Rot | null = null;
let rotLock: 0 | 1 | 2 | null = null;
let rotHover: { center: V3; axis: V3 } | null = null;
// Dernière rotation posée : un angle tapé ensuite la corrige ; « x6 » ou « /6 » fait des copies en cercle.
let lastRot: { base: string; ids: number[]; center: V3; axis: V3; angle: number; copy: boolean } | null = null;
// Mètre façon SketchUp : depuis un point, il mesure ; depuis une arête, il tire un guide parallèle à la distance voulue.
// Option inverse : depuis une arête, mesurer seulement.
interface Mesure { a: V3; dir: V3 | null; b: V3; lock: 0 | 1 | 2 | null; infer: 0 | 1 | 2 | null }
let mesure: Mesure | null = null;
const etiquette = document.createElement('div');
etiquette.className = 'cote';
const etiquetteObj = new CSS2DObject(etiquette);
let hud = '';

const hudEl = document.getElementById('hud')!;
const helpEl = document.getElementById('help')!;
function setHud(text = '') {
  hud = text;
  hudEl.innerHTML = `${text}<button id="unit" class="btn" style="margin-left:8px;padding:0 6px" title="Changer d'unité">${unit().name}</button>`;
  document.getElementById('unit')!.onclick = () => { unitIdx = (unitIdx + 1) % UNITS.length; setHud(hud); refreshPanel(); };
}
const bxs = (s: string) => `<b>${typed || s}</b>`;

const HELP: Record<Tool, string> = {
  select: 'Sélection : clic = une pièce, Maj = ajouter ou retirer, Option = ajouter, Maj + Option = retirer. Glisser → : pièces entièrement dans le cadre ; glisser ← : pièces touchées. Double-clic : tout le meuble. Cmd+A : tout. Échap : rien.',
  scale: 'Échelle : des poignées entourent la sélection (ou la pièce, le meuble survolé). Clic sur une poignée, bouge, clic : la poignée opposée reste fixe (Option : depuis le centre). Faces = un axe, coins = proportionnel. Tape un facteur (1,2) ou une cote (1200 mm) + Entrée. Tab : garder les épaisseurs des panneaux (étirer) ou tout agrandir (échelle).',
  open: 'Ouvrir : attrape une porte ou un tiroir et tire pour l\'ouvrir, pousse pour le fermer. Un simple clic l\'ouvre ou le ferme en entier. Les pièces doivent être reconnues comme porte ou tiroir (panneau de droite).',
  adjust: 'Ajuster : survole un meuble et tire une poignée. Vertes : largeur, hauteur, profondeur. Orange : un montant entre deux colonnes. Clic pour prendre, clic pour poser, ou tape la cote + Entrée. Étagères, tiroirs et portes suivent.',
  line: 'Ligne : cliquer le départ puis chaque point. Saisir une longueur + Entrée. Échap termine.',
  rect: 'Rectangle : cliquer deux coins, ou saisir « largeur ; hauteur » + Entrée.',
  circle: 'Cercle : cliquer le centre puis un point, ou saisir le rayon + Entrée.',
  pushpull: 'Pousser/Tirer : cliquer une zone, bouger, cliquer. Saisir une distance + Entrée (négatif = creuser).',
  move: 'Déplacer : clic 1 = point de référence (coin ou milieu), clic 2 = destination. Accroche aux sommets des autres pièces et aux axes (ligne rouge, verte, bleue). Flèches ou Maj : verrouiller l\'axe. Option = copie. Tape une distance + Entrée.',
  rotate: 'Rotation : clic 1 = centre (le rapporteur suit la face survolée), clic 2 = ligne de départ, clic 3 = angle (calé tous les 15°). Flèches : → axe X, ← axe Y, ↑ axe Z, ↓ libre. Option = copie. Tape un angle + Entrée.',
  tape: 'Mètre : clic sur un point puis un autre pour mesurer. Clic sur une arête puis on s\'en éloigne : un guide parallèle (tirets) se pose à la distance voulue, tapée ou cliquée. Option : mesurer seulement. Flèches : verrouiller l\'axe.',
  erase: 'Gomme : cliquer un trait ou une pièce pour l\'effacer.',
  orbit: 'Orbite : glisser au clic gauche. (Molette enfoncée = orbite, Maj + molette = panoramique.)',
  pan: 'Panoramique : glisser au clic gauche.',
};

function setTool(t: Tool) {
  cancelOp();
  tool = t;
  controls.mouseButtons.LEFT = t === 'orbit' ? THREE.MOUSE.ROTATE : t === 'pan' ? THREE.MOUSE.PAN : null;
  helpEl.textContent = HELP[t];
  document.querySelectorAll<HTMLButtonElement>('#toolbar button[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  renderer.domElement.style.cursor = t === 'orbit' || t === 'pan' ? 'grab' : t === 'select' || t === 'adjust' || t === 'open' || t === 'scale' ? 'default' : 'crosshair';
  if (t === 'adjust') {
    const s0 = doc.solids.find((x) => selected.has(x.id) && x.meta.caisson);
    if (s0?.meta.caisson) { ajCaisson = s0.meta.caisson; ajPoignees = poigneesDe(ajCaisson); dessinePoignees(); }
  }
}

function cancelOp() {
  if (docAvantCollage) { doc = JSON.parse(docAvantCollage) as Doc; docAvantCollage = null; selected.clear(); refreshPanel(); }
  if (aj) { aj = null; }
  ajPoignees = []; ajCaisson = null; ajSurvol = -1;
  draw = null; pp = null; mv = null; rot = null; mesure = null; ech = null; poigneesEch = []; etiquetteObj.removeFromParent(); lastCopy = null; lastRot = null; rotHover = null; typed = '';
  shown = doc;
  clearGroup(overlay); marker.visible = false;
  rebuild(); setHud();
}

function showRegion(P: Plane, r: Region) {
  clearGroup(overlay);
  const m = new THREE.Mesh(regionGeometry(P, r), hoverMat);
  m.renderOrder = 5; overlay.add(m);
}
function showLines(pts: V3[], loop: boolean) {
  clearGroup(overlay);
  const g = new THREE.BufferGeometry().setFromPoints(pts.map(tv));
  const l = loop ? new THREE.LineLoop(g, guideMat) : new THREE.Line(g, guideMat);
  l.renderOrder = 6; overlay.add(l);
}

const CIRCLE_N = 48;
function circleSegs(c: P2, r: number): Seg2[] {
  const pts: P2[] = Array.from({ length: CIRCLE_N }, (_, i) => [c[0] + r * Math.cos((2 * Math.PI * i) / CIRCLE_N), c[1] + r * Math.sin((2 * Math.PI * i) / CIRCLE_N)]);
  return pts.map((p, i) => [p, pts[(i + 1) % CIRCLE_N]!]);
}
const rectSegs = (a: P2, b: P2): Seg2[] => [[[a[0], a[1]], [b[0], a[1]]], [[b[0], a[1]], [b[0], b[1]]], [[b[0], b[1]], [a[0], b[1]]], [[a[0], b[1]], [a[0], a[1]]]];

// Verrouillage sur les axes du plan pour la ligne (± 3°)
function axisLock(p1: P2, p: P2): P2 {
  const dx = p[0] - p1[0], dy = p[1] - p1[1], L = Math.hypot(dx, dy);
  if (L < 1e-9) return p;
  if (Math.abs(dy) < 0.05 * L) return [p[0], p1[1]];
  if (Math.abs(dx) < 0.05 * L) return [p1[0], p[1]];
  return p;
}

function drawPreview() {
  if (!draw) return;
  const { P, p1, cur } = draw;
  if (tool === 'rect') showLines(rectSegs(p1, cur).map((s) => to3(P, s[0])), true);
  else if (tool === 'circle') showLines(circleSegs(p1, Math.hypot(cur[0] - p1[0], cur[1] - p1[1])).map((s) => to3(P, s[0])), true);
  else if (tool === 'line') showLines([to3(P, p1), to3(P, cur)], false);
}
function drawHud() {
  if (!draw) return setHud();
  const { p1, cur } = draw;
  if (tool === 'rect') setHud(`Cotes ${bxs(`${fmt(Math.abs(cur[0] - p1[0]))} ; ${fmt(Math.abs(cur[1] - p1[1]))}`)}`);
  else if (tool === 'circle') setHud(`Rayon ${bxs(fmt(Math.hypot(cur[0] - p1[0], cur[1] - p1[1])))}`);
  else setHud(`Longueur ${bxs(fmt(Math.hypot(cur[0] - p1[0], cur[1] - p1[1])))}`);
}

function pushPullPreview(d: number) {
  if (!pp) return;
  pp.d = d;
  const r = pushPullRegion(doc, pp.P, pp.p2, d);
  shown = r ? r.doc : doc;
  rebuild();
  setHud(`Distance ${bxs(fmt(d))}`);
}

// Distance signée le long de l'axe (point `a`, direction `dir`) la plus proche du rayon souris.
function axisParam(a: V3, dir: V3): number | null {
  const o = fv(raycaster.ray.origin), r = rayDir();
  const w0 = sub(a, o);
  const b = dot(dir, r), d = dot(dir, w0), e = dot(r, w0), den = 1 - b * b;
  return den < 1e-4 ? null : (b * e - d) / den;
}

const AX: V3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

// Déplace les solides, ou en pose des copies aux décalages donnés (copie = original inchangé).
function movedDoc(base: Doc, ids: number[], offsets: V3[], copy: boolean): Doc {
  const d = cloneDoc(base), sel = d.solids.filter((x) => ids.includes(x.id));
  if (!copy) { for (const s of sel) moveSolid(s, offsets[0]!); return d; }
  // une copie est un vrai double : meuble complet (modifiable à part), portes et tiroirs compris
  const pp = contenuDe(base, ids);
  for (const o of offsets) { const n = new Set(inserer(d, pp!)); for (const s of d.solids) if (n.has(s.id)) moveSolid(s, o); }
  return d;
}
function applyMove(delta: V3, ids: number[], copy = false) {
  shown = movedDoc(doc, ids, [delta], copy); rebuild();
}
function finishMove() {
  if (!mv) return;
  docAvantCollage = null;
  const m = mv;
  if (len(m.delta) > 1e-6) lastCopy = { base: JSON.stringify(doc), ids: m.ids, delta: m.delta, copy: m.copy };
  lastRot = null;
  doc = shown; mv = null; typed = ''; clearGroup(overlay); marker.visible = false; commit();
  setHud(`${m.copy ? 'Copie posée' : 'Déplacé'} de ${fmt(len(m.delta))} ${unit().name} : tape une distance + Entrée pour corriger${m.copy ? ', ou x5 / /5 pour répéter' : ''}`);
}
const AXE_COULEUR = [0xd33a2c, 0x2ea043, 0x2f6fed];
const AXE_NOM = ['rouge (X)', 'vert (Y)', 'bleu (Z)'];
// Coins et milieux d'arêtes des pièces, hors celles qui bougent.
function sommets3D(exclus: Set<number>): { p: V3; milieu: boolean }[] {
  const out: { p: V3; milieu: boolean }[] = [];
  for (const s of visibles(doc)) {
    if (exclus.has(s.id)) continue;
    for (const F of planarFaces(s.mesh)) for (const l of F.loops) for (let i = 0; i < l.length; i++) {
      const a = l[i]!, b = l[(i + 1) % l.length]!;
      out.push({ p: a, milieu: false }, { p: mul(add(a, b), 0.5), milieu: true });
    }
  }
  return out;
}
const versEcran = (p: V3): [number, number, boolean] => {
  const r = renderer.domElement.getBoundingClientRect(), v = tv(p).project(camera);
  return [((v.x + 1) / 2) * r.width + r.left, ((1 - v.y) / 2) * r.height + r.top, v.z < 1];
};
// Sommet le plus proche de la souris à l'écran (12 px), les coins passant avant les milieux.
function accroche3D(ev: { clientX: number; clientY: number }, exclus: Set<number>): { p: V3; milieu: boolean; guide?: boolean } | null {
  let best: { p: V3; milieu: boolean; guide?: boolean } | null = null, bd = 12;
  const cands = [...sommets3D(exclus), ...croisementsGuides(doc.guides ?? []).map((p) => ({ p, milieu: false, guide: true }))];
  for (const c of cands) {
    const [x, y, devant] = versEcran(c.p);
    if (!devant) continue;
    const d = Math.hypot(x - ev.clientX, y - ev.clientY) + (c.milieu ? 3 : 0);
    if (d < bd) { bd = d; best = c; }
  }
  if (best) return best;
  // sur un guide : le point du guide le plus proche de la souris
  setRay(ev);
  let bg = 8;
  for (const g of doc.guides ?? []) {
    const q = procheSurDroite(g.p, g.d);
    const [x, y, devant] = versEcran(q);
    const d = Math.hypot(x - ev.clientX, y - ev.clientY);
    if (devant && d < bg) { bg = d; best = { p: q, milieu: false, guide: true }; }
  }
  return best;
}
// Arête de pièce la plus proche de la souris à l'écran (8 px) : sert au mètre pour tirer un guide parallèle.
function areteSous(ev: { clientX: number; clientY: number }): [V3, V3] | null {
  let best: [V3, V3] | null = null, bd = 10;
  for (const s of visibles(doc)) for (const F of planarFaces(s.mesh)) for (const l of F.loops) for (let i = 0; i < l.length; i++) {
    const a = l[i]!, b = l[(i + 1) % l.length]!;
    const [ax, ay, da] = versEcran(a), [bx, by, db] = versEcran(b);
    if (!da || !db) continue;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((ev.clientX - ax) * dx + (ev.clientY - ay) * dy) / L2));
    const d = Math.hypot(ev.clientX - (ax + t * dx), ev.clientY - (ay + t * dy));
    if (d < bd) { bd = d; best = [a, b]; }
  }
  return best;
}
// Axe le long duquel la souris glisse depuis `start` (moins de 10 px de la ligne de l'axe à l'écran).
function axeInfere(ev: { clientX: number; clientY: number }, start: V3): 0 | 1 | 2 | null {
  const [x0, y0] = versEcran(start);
  let best: 0 | 1 | 2 | null = null, bd = 10;
  for (const k of [0, 1, 2] as const) {
    const [x1, y1] = versEcran(add(start, AX[k]!));
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
    if (L < 1e-6) continue;
    const loin = Math.hypot(ev.clientX - x0, ev.clientY - y0);
    if (loin < 15) continue;
    const d = Math.abs((ev.clientX - x0) * dy - (ev.clientY - y0) * dx) / L;
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}
// Point sous la souris sur les pièces qui ne bougent pas, sinon sur le plan horizontal du point de départ.
function pointSous(ev: PointerEvent, exclus: Set<number>, start: V3): V3 | null {
  setRay(ev);
  const objs: THREE.Object3D[] = [];
  world.traverse((o) => { if (o.userData.pick && !(o.userData.solidId !== undefined && exclus.has(o.userData.solidId as number))) objs.push(o); });
  const h = raycaster.intersectObjects(objs, false)[0];
  if (h) return fv(h.point);
  return planeHit(planeFromNormal(start, [0, 0, 1]));
}
function dessineDeplacement(a: V3, b: V3, axe: 0 | 1 | 2 | null, sommet: boolean) {
  clearGroup(overlay);
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([tv(a), tv(b)]), new THREE.LineBasicMaterial({ color: axe === null ? 0x1b1b1b : AXE_COULEUR[axe], depthTest: false }));
  l.renderOrder = 8; overlay.add(l);
  marker.material.color.set(sommet ? 0x16a34a : axe === null ? 0 : AXE_COULEUR[axe]!);
  marker.position.copy(tv(b)); marker.visible = true;
}
// Pièces que le clic déplace : la sélection, sinon tout le meuble cliqué, sinon la pièce cliquée.
function ciblesDeplacement(id: number | null): number[] {
  if (selected.size) return [...selected];
  const s = doc.solids.find((x) => x.id === id);
  if (!s) return [];
  return s.meta.caisson ? doc.solids.filter((x) => x.meta.caisson === s.meta.caisson).map((x) => x.id) : [s.id];
}
function applyMultiCopy(): boolean {
  if (!lastCopy) return false;
  const t = typed.trim();
  const m = /^(?:[x*](\d+)|(\d+)[x*]|\/(\d+))$/.exec(t);
  if (!m) {
    // une distance tapée juste après corrige le dernier déplacement, dans la même direction
    const v = parseFloat(t.replace(',', '.'));
    if (Number.isNaN(v)) return false;
    lastCopy.delta = mul(norm(lastCopy.delta), v / unit().f);
    doc = movedDoc(JSON.parse(lastCopy.base) as Doc, lastCopy.ids, [lastCopy.delta], lastCopy.copy);
    typed = ''; commit(); setHud(`Déplacement corrigé : ${fmt(len(lastCopy.delta))} ${unit().name}`);
    return true;
  }
  if (!lastCopy.copy) return false;
  const n = Number(m[1] ?? m[2] ?? m[3]);
  if (n < 1 || n > 200) return false;
  const step = m[3] ? mul(lastCopy.delta, 1 / n) : lastCopy.delta;
  doc = movedDoc(JSON.parse(lastCopy.base) as Doc, lastCopy.ids, Array.from({ length: n }, (_, i) => mul(step, i + 1)), true);
  typed = ''; commit(); setHud(`${n} copie(s)`);
  return true;
}
// Tourne les solides, ou en pose des copies tournées (original inchangé).
function rotatedDoc(base: Doc, ids: number[], center: V3, axis: V3, angles: number[], copy: boolean): Doc {
  const d = cloneDoc(base), sel = d.solids.filter((x) => ids.includes(x.id));
  if (!copy) { for (const s of sel) rotateSolid(s, center, axis, angles[0]!); return d; }
  const pp = contenuDe(base, ids);
  for (const a of angles) { const n = new Set(inserer(d, pp!)); for (const s of d.solids) if (n.has(s.id)) rotateSolid(s, center, axis, a); }
  return d;
}
function applyRot(angle: number, r: Rot) {
  shown = rotatedDoc(doc, r.ids, r.center, r.axis, [angle], r.copy); rebuild();
}
// Axe de rotation : verrouillé aux flèches, sinon la normale de la face survolée, calée sur X, Y ou Z si elle en est proche.
function axeRotation(n: V3): V3 {
  if (rotLock !== null) return AX[rotLock]!;
  for (const a of AX) if (Math.abs(dot(n, a)) > 0.999) return a;
  return norm(n);
}
const couleurAxe = (axis: V3) => (Math.abs(axis[0]) > 0.999 ? 0xd33a2c : Math.abs(axis[1]) > 0.999 ? 0x2ea043 : Math.abs(axis[2]) > 0.999 ? 0x2f6fed : 0x555555);
// Point de la souris dans le plan du rapporteur (passant par le centre, perpendiculaire à l'axe).
function pointRapporteur(center: V3, axis: V3): V3 | null {
  const P = planeFromNormal(center, axis);
  const p = planeHit(P);
  return p ? snap(P, p) : null;
}
function angleDe(ref: V3, v: V3, axis: V3): number {
  return Math.atan2(dot(cross(ref, v), axis), dot(ref, v));
}
// Accroche à 15° près ; sinon au degré.
function caleAngle(a: number): number {
  const deg = (a * 180) / Math.PI, q = Math.round(deg / 15) * 15;
  return ((Math.abs(deg - q) < 2.5 ? q : Math.round(deg)) * Math.PI) / 180;
}
// Dessine le rapporteur : cercle gradué tous les 15°, ligne de départ, ligne de l'angle courant.
function dessineRapporteur(center: V3, axis: V3, ref: V3 | null, cur: V3 | null) {
  clearGroup(overlay);
  const r = camera.position.distanceTo(controls.target) * 0.07;
  const P = planeFromNormal(center, axis);
  const u = ref ?? P.u, w = cross(axis, u);
  const at = (a: number, k: number): THREE.Vector3 => tv(add(center, add(mul(u, Math.cos(a) * r * k), mul(w, Math.sin(a) * r * k))));
  const mat = new THREE.LineBasicMaterial({ color: couleurAxe(axis), depthTest: false });
  const cercle: THREE.Vector3[] = [];
  for (let i = 0; i <= 96; i++) cercle.push(at((i / 96) * Math.PI * 2, 1));
  const ticks: THREE.Vector3[] = [];
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; ticks.push(at(a, i % 6 === 0 ? 0.8 : 0.9), at(a, 1)); }
  const objs: THREE.Object3D[] = [new THREE.Line(new THREE.BufferGeometry().setFromPoints(cercle), mat), new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ticks), mat)];
  if (ref) objs.push(new THREE.Line(new THREE.BufferGeometry().setFromPoints([tv(center), at(0, 1.4)]), guideMat));
  if (cur) objs.push(new THREE.Line(new THREE.BufferGeometry().setFromPoints([tv(center), tv(add(center, mul(norm(cur), r * 1.4)))]), guideMat));
  for (const o of objs) { o.renderOrder = 8; overlay.add(o); }
}
function finishRot() {
  if (!rot || rot.phase !== 'angle') return;
  const r = rot;
  lastRot = { base: JSON.stringify(doc), ids: r.ids, center: r.center, axis: r.axis, angle: r.angle, copy: r.copy };
  lastCopy = null;
  doc = shown; rot = null; typed = ''; clearGroup(overlay); commit();
  setHud(`Rotation de ${((r.angle * 180) / Math.PI).toFixed(1)}° : tape un angle + Entrée pour corriger${r.copy ? ', ou x6 / /6 pour des copies en cercle' : ''}`);
}
// Après une rotation : « 30 » corrige l'angle, « x6 » pose 6 copies au même pas, « /6 » en répartit 6.
function applyRotRetype(): boolean {
  if (!lastRot) return false;
  const t = typed.trim();
  const m = /^(?:[x*](\d+)|(\d+)[x*]|\/(\d+))$/.exec(t);
  const base = JSON.parse(lastRot.base) as Doc;
  if (m && lastRot.copy) {
    const n = Number(m[1] ?? m[2] ?? m[3]);
    if (n < 1 || n > 360) return false;
    const pas = m[3] ? lastRot.angle / n : lastRot.angle;
    doc = rotatedDoc(base, lastRot.ids, lastRot.center, lastRot.axis, Array.from({ length: n }, (_, i) => pas * (i + 1)), true);
    typed = ''; commit(); setHud(`${n} copie(s) en cercle`);
    return true;
  }
  const deg = parseFloat(t.replace(',', '.'));
  if (Number.isNaN(deg)) return false;
  lastRot.angle = (deg * Math.PI) / 180;
  doc = rotatedDoc(base, lastRot.ids, lastRot.center, lastRot.axis, [lastRot.angle], lastRot.copy);
  typed = ''; commit(); setHud(`Rotation corrigée : ${deg}°`);
  return true;
}

// ───────── Événements souris ─────────
// ───────── Sélection façon SketchUp ─────────
// Clic : remplace. Maj : ajoute ou retire. Option (ou Cmd) : ajoute. Maj + Option : retire.
// Glisser de gauche à droite : seulement ce qui est entièrement dans le cadre (trait plein).
// Glisser de droite à gauche : tout ce que le cadre touche (pointillés). Double-clic : tout le meuble.
let hoverId: number | null = null;
let hoverIds = new Set<number>();
type ModeSel = 'remplace' | 'inverse' | 'ajoute' | 'retire';
const modeSel = (ev: { shiftKey: boolean; altKey: boolean; metaKey: boolean }): ModeSel =>
  ev.shiftKey && ev.altKey ? 'retire' : ev.shiftKey ? 'inverse' : ev.altKey || ev.metaKey ? 'ajoute' : 'remplace';
let selDown: { x: number; y: number; mode: ModeSel; drag: boolean } | null = null;
const selBox = document.createElement('div');
selBox.className = 'selbox';
root.appendChild(selBox);

function appliquerSel(ids: number[], mode: ModeSel) {
  const caches = new Set(doc.solids.filter((x) => x.meta.masque).map((x) => x.id));
  ids = ids.filter((id) => !caches.has(id));
  if (mode === 'remplace') selected.clear();
  for (const id of ids) {
    if (mode === 'retire') selected.delete(id);
    else if (mode === 'inverse' && selected.has(id)) selected.delete(id);
    else selected.add(id);
  }
  if (ids.length) marquer('selection');
  rebuild(); refreshPanel();
  setHud(selected.size ? `${selected.size} pièce(s) sélectionnée(s)` : '');
}
// Projection écran (pixels du canevas) des sommets d'un solide ; null si un sommet est derrière la caméra.
function projete(mesh: { v: number[] }): [number, number][] | null {
  const r = renderer.domElement.getBoundingClientRect();
  const out: [number, number][] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < mesh.v.length; i += 3) {
    v.set(mesh.v[i]!, mesh.v[i + 1]!, mesh.v[i + 2]!).project(camera);
    if (v.z > 1) return null;
    out.push([((v.x + 1) / 2) * r.width, ((1 - v.y) / 2) * r.height]);
  }
  return out;
}
type R2 = { x0: number; y0: number; x1: number; y1: number };
const dansRect = (p: [number, number], r: R2) => p[0] >= r.x0 && p[0] <= r.x1 && p[1] >= r.y0 && p[1] <= r.y1;
function segCoupe(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  const o = (p: [number, number], q: [number, number], s: [number, number]) => Math.sign((q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
function triDansTri(p: [number, number], a: [number, number], b: [number, number], c: [number, number]): boolean {
  const s = (u: [number, number], v: [number, number], w: [number, number]) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
  const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
// Un triangle projeté touche-t-il le cadre ?
function triTouche(a: [number, number], b: [number, number], c: [number, number], r: R2): boolean {
  if (dansRect(a, r) || dansRect(b, r) || dansRect(c, r)) return true;
  const coins: [number, number][] = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
  if (coins.some((k) => triDansTri(k, a, b, c))) return true;
  const tri = [a, b, c];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) if (segCoupe(tri[i]!, tri[(i + 1) % 3]!, coins[j]!, coins[(j + 1) % 4]!)) return true;
  return false;
}
function selectionCadre(r: R2, fenetre: boolean): number[] {
  const ids: number[] = [];
  for (const s of visibles(doc)) {
    const pts = projete(s.mesh);
    if (fenetre) { if (pts && pts.every((p) => dansRect(p, r))) ids.push(s.id); continue; }
    if (!pts) continue;
    const t = s.mesh.t;
    for (let i = 0; i < t.length; i += 3) if (triTouche(pts[t[i]!]!, pts[t[i + 1]!]!, pts[t[i + 2]!]!, r)) { ids.push(s.id); break; }
  }
  return ids;
}
function survolSelection(ev: PointerEvent) {
  if (selDown) {
    const dx = ev.clientX - selDown.x, dy = ev.clientY - selDown.y;
    if (!selDown.drag && Math.hypot(dx, dy) < 4) return;
    selDown.drag = true;
    const cr = root.getBoundingClientRect();
    Object.assign(selBox.style, {
      display: 'block', left: `${Math.min(ev.clientX, selDown.x) - cr.left}px`, top: `${Math.min(ev.clientY, selDown.y) - cr.top}px`,
      width: `${Math.abs(dx)}px`, height: `${Math.abs(dy)}px`, borderStyle: dx >= 0 ? 'solid' : 'dashed',
    });
    setHud(dx >= 0 ? 'Fenêtre : pièces entièrement dans le cadre' : 'Capture : pièces touchées par le cadre');
    return;
  }
  const h = pick(ev);
  const id = h?.solidId ?? null;
  if (id !== hoverId) { hoverId = id; rebuild(); }
}
function finSelection(ev: PointerEvent) {
  if (!selDown || tool !== 'select') { selDown = null; return; }
  const d = selDown;
  selDown = null;
  selBox.style.display = 'none';
  if (!d.drag) {
    const h = pick(ev);
    appliquerSel(h?.solidId != null ? [h.solidId] : [], d.mode);
    return;
  }
  const cr = renderer.domElement.getBoundingClientRect();
  const r: R2 = { x0: Math.min(ev.clientX, d.x) - cr.left, y0: Math.min(ev.clientY, d.y) - cr.top, x1: Math.max(ev.clientX, d.x) - cr.left, y1: Math.max(ev.clientY, d.y) - cr.top };
  appliquerSel(selectionCadre(r, ev.clientX >= d.x), d.mode);
}
// Double-clic : tout le meuble de la pièce (ou ses copies liées si c'est un composant).
function doubleClicSelection(ev: MouseEvent) {
  if (tool !== 'select') return;
  const h = pick(ev as PointerEvent);
  const s = doc.solids.find((x) => x.id === h?.solidId);
  if (!s) return;
  const el = elementDe(doc, s.id);
  const ids = el ? piecesDe(el) : s.meta.caisson ? doc.solids.filter((x) => x.meta.caisson === s.meta.caisson).map((x) => x.id)
    : s.comp ? instancesOf(doc, s).map((x) => x.id) : [s.id];
  appliquerSel(ids, modeSel(ev) === 'remplace' ? 'remplace' : 'ajoute');
}

// ───────── Outil Ajuster : poignées du meuble ─────────
// Largeur (côté droit), hauteur (dessus), profondeur (façade) et chaque montant se tirent à la souris ;
// le meuble est recalculé à chaque mouvement : étagères, tiroirs, portes et quincaillerie suivent.
type Poignee = { kind: 'L' | 'H' | 'P' | 'montant'; col: number; pos: V3; axis: V3 };
let ajCaisson: number | null = null;
let ajPoignees: Poignee[] = [];
let ajSurvol = -1;
let aj: { id: number; poignee: Poignee; base: CaissonParams; baseDoc: Doc; params: CaissonParams; err: string | null; depart: number } | null = null;

function poigneesDe(id: number): Poignee[] {
  const rec = (doc.caissons ?? []).find((x) => x.id === id);
  if (!rec) return [];
  const o = origineCaisson(doc, rec);
  if (!o) return [];
  const p = rec.params, mm = (v: V3): V3 => add(o, mul(v, 0.001));
  const yF = p.portes || p.types.includes('tiroirs') ? -p.e : 0;
  const out: Poignee[] = [
    { kind: 'L', col: -1, pos: mm([p.L, p.P / 2, p.H / 2]), axis: [1, 0, 0] },
    { kind: 'H', col: -1, pos: mm([p.L / 2, p.P / 2, p.H]), axis: [0, 0, 1] },
    { kind: 'P', col: -1, pos: mm([p.L / 2, yF, p.H * 0.25]), axis: [0, -1, 0] },
  ];
  const v = videsColonnes(p);
  let x = p.e;
  for (let c = 0; c < v.length - 1; c++) { x += v[c]!; out.push({ kind: 'montant', col: c, pos: mm([x + p.e / 2, yF, p.H * 0.6]), axis: [1, 0, 0] }); x += p.e; }
  return out;
}
function dessinePoignees() {
  clearGroup(overlay);
  const r = camera.position.distanceTo(controls.target) * 0.012;
  ajPoignees.forEach((h, i) => {
    const actif = aj ? aj.poignee === h : i === ajSurvol;
    const m = new THREE.Mesh(new THREE.SphereGeometry(r * (actif ? 1.5 : 1), 16, 12), new THREE.MeshBasicMaterial({ color: h.kind === 'montant' ? 0xf08c00 : 0x2ea043, depthTest: false }));
    m.position.copy(tv(h.pos)); m.renderOrder = 9; overlay.add(m);
    const fl = new THREE.Line(new THREE.BufferGeometry().setFromPoints([tv(sub(h.pos, mul(h.axis, r * 4))), tv(add(h.pos, mul(h.axis, r * 4)))]), new THREE.LineBasicMaterial({ color: 0x1b1b1b, depthTest: false }));
    fl.renderOrder = 9; overlay.add(fl);
  });
}
function poigneeSous(ev: { clientX: number; clientY: number }): number {
  const r = renderer.domElement.getBoundingClientRect();
  let best = -1, bd = 16;
  ajPoignees.forEach((h, i) => {
    const v = tv(h.pos).project(camera);
    const d = Math.hypot(((v.x + 1) / 2) * r.width - (ev.clientX - r.left), ((1 - v.y) / 2) * r.height - (ev.clientY - r.top));
    if (v.z < 1 && d < bd) { bd = d; best = i; }
  });
  return best;
}
const NOMS_POIGNEE = { L: 'Largeur', H: 'Hauteur', P: 'Profondeur', montant: 'Colonne' };
function valeurAjust(p: CaissonParams, h: Poignee): number {
  return h.kind === 'montant' ? videsColonnes(p)[h.col]! : p[h.kind];
}
function hudAjust() {
  if (!aj) return;
  const h = aj.poignee, v = valeurAjust(aj.params, h);
  const label = h.kind === 'montant' ? `Colonne ${h.col + 1} (intérieur)` : NOMS_POIGNEE[h.kind];
  setHud(`${label} ${bxs(`${fmt(v / 1000)}`)}${aj.err ? ` <span style="color:#d33a2c">${esc(aj.err)}</span>` : ''}`);
}
function paramsAjust(base: CaissonParams, h: Poignee, valeur: number): CaissonParams {
  if (h.kind === 'montant') return fixerLargeur(base, h.col, valeur);
  return { ...base, [h.kind]: valeur };
}
function previsualiseAjust(valeur: number) {
  if (!aj) return;
  const params = paramsAjust(aj.base, aj.poignee, Math.round(valeur));
  const err = verifier(params);
  if (err) { aj.err = err; hudAjust(); return; }
  const r = caissonModifie(aj.baseDoc, aj.id, params);
  if (!r) return;
  aj.params = params; aj.err = null;
  shown = r.doc; rebuild();
  dessinePoignees(); hudAjust();
}
function finAjust() {
  if (!aj) return;
  const r = aj.err ? null : caissonModifie(aj.baseDoc, aj.id, aj.params);
  const id = aj.id;
  aj = null;
  if (r) {
    doc = r.doc; selected.clear(); for (const i of r.ids) selected.add(i);
    commit();
  } else { shown = doc; rebuild(); }
  ajPoignees = poigneesDe(id); ajCaisson = id; dessinePoignees(); setHud('');
}
function survolAjust(ev: PointerEvent) {
  if (aj) {
    setRay(ev);
    const t = axisParam(aj.poignee.pos, aj.poignee.axis);
    if (t === null) return;
    const pas = gridStep() >= 0.01 ? 10 : 1;
    const v0 = valeurAjust(aj.base, aj.poignee);
    previsualiseAjust(Math.round((v0 + (t - aj.depart) * 1000) / pas) * pas);
    return;
  }
  const h = pick(ev);
  const s = doc.solids.find((x) => x.id === h?.solidId);
  const id = s?.meta.caisson ?? (ajCaisson !== null && poigneeSous(ev) >= 0 ? ajCaisson : null);
  if (id !== ajCaisson) { ajCaisson = id; ajPoignees = id !== null ? poigneesDe(id) : []; }
  const i = poigneeSous(ev);
  if (i !== ajSurvol || id !== null) { ajSurvol = i; dessinePoignees(); }
  renderer.domElement.style.cursor = i >= 0 ? 'grab' : 'default';
  setHud(i >= 0 ? `Tirer : ${ajPoignees[i]!.kind === 'montant' ? `montant entre les colonnes ${ajPoignees[i]!.col + 1} et ${ajPoignees[i]!.col + 2}` : NOMS_POIGNEE[ajPoignees[i]!.kind].toLowerCase()}` : '');
}
function clicAjust(ev: PointerEvent) {
  if (aj) { finAjust(); return; }
  const i = poigneeSous(ev);
  if (i < 0 || ajCaisson === null) return;
  const rec = (doc.caissons ?? []).find((x) => x.id === ajCaisson);
  if (!rec) return;
  const poignee = ajPoignees[i]!;
  setRay(ev);
  aj = { id: rec.id, poignee: { ...poignee }, base: JSON.parse(JSON.stringify(rec.params)) as CaissonParams, baseDoc: doc, params: rec.params, err: null, depart: axisParam(poignee.pos, poignee.axis) ?? 0 };
  hudAjust();
}

function onMove(ev: PointerEvent) {
  if (tool === 'open') { bougerOuvrir(ev); return; }
  if (tool === 'scale') { bougerEchelle(ev); return; }
  if (tool === 'adjust') { survolAjust(ev); return; }
  if (tool === 'select') { survolSelection(ev); return; }
  if (hoverId !== null) { hoverId = null; rebuild(); }
  if (tool !== 'move' && hoverIds.size) { hoverIds = new Set(); rebuild(); }
  if (tool === 'rect' || tool === 'circle' || tool === 'line') {
    if (!draw) {
      const h = pick(ev);
      if (h) snap(h.plane, h.point); else marker.visible = false;
      return;
    }
    setRay(ev);
    const p = planeHit(draw.P);
    if (!p) return;
    const sp = snap(draw.P, p);
    let c = to2(draw.P, sp);
    if (tool === 'line') c = axisLock(draw.p1, c);
    draw.cur = c; typed = '';
    drawPreview(); drawHud();
  } else if (tool === 'pushpull') {
    if (!pp) {
      const h = pick(ev);
      if (!h) return clearGroup(overlay);
      const r = regionAt(planeRegions(doc, h.plane), to2(h.plane, h.point));
      if (r) showRegion(h.plane, r); else clearGroup(overlay);
      return;
    }
    setRay(ev);
    const t = axisParam(pp.start, pp.P.n);
    if (t === null) return;
    const st = gridStep();
    typed = '';
    pushPullPreview(Math.round(t / st) * st);
  } else if (tool === 'move' && !mv) {
    // survol : le meuble (ou la sélection) s'éclaire, le point de référence s'accroche
    const h = pick(ev);
    const ids = new Set(selected.size ? [] : ciblesDeplacement(h?.solidId ?? null));
    if ([...ids].join() !== [...hoverIds].join()) { hoverIds = ids; rebuild(); }
    const a = accroche3D(ev, new Set());
    if (a) { marker.material.color.set(a.milieu ? 0x0ea5e9 : 0x16a34a); marker.position.copy(tv(a.p)); marker.visible = true; }
    else marker.visible = false;
  } else if (tool === 'move' && mv) {
    const exclus = new Set(mv.ids);
    let dest: V3 | null = null, axe: 0 | 1 | 2 | null = mv.lock, sommet = false;
    const a = accroche3D(ev, exclus);
    if (mv.lock !== null) {
      setRay(ev);
      // axe verrouillé : un sommet survolé est ramené sur l'axe
      const t = a ? dot(sub(a.p, mv.start), AX[mv.lock]!) : axisParam(mv.start, AX[mv.lock]!);
      if (t !== null) dest = add(mv.start, mul(AX[mv.lock]!, a ? t : Math.round(t / gridStep()) * gridStep()));
      sommet = !!a;
    } else if (a) {
      dest = a.p; sommet = true;
      for (const k of [0, 1, 2] as const) if (len(sub(sub(a.p, mv.start), mul(AX[k]!, dot(sub(a.p, mv.start), AX[k]!)))) < 1e-6) axe = k;
    } else {
      axe = axeInfere(ev, mv.start);
      setRay(ev);
      if (axe !== null) {
        const t = axisParam(mv.start, AX[axe]!);
        if (t !== null) dest = add(mv.start, mul(AX[axe]!, Math.round(t / gridStep()) * gridStep()));
      } else {
        const p = pointSous(ev, exclus, mv.start);
        if (p) { const st = gridStep(); dest = add(mv.start, sub(p, mv.start).map((x) => Math.round(x / st) * st) as V3); }
      }
    }
    if (!dest) return;
    mv.infer = axe;
    mv.delta = sub(dest, mv.start);
    typed = '';
    applyMove(mv.delta, mv.ids, mv.copy);
    dessineDeplacement(mv.start, dest, axe, sommet);
    setHud(`${mv.copy ? 'Copie' : 'Déplacement'} ${bxs(fmt(len(mv.delta)))}${axe !== null ? ` sur l'axe ${AXE_NOM[axe]}${mv.lock !== null ? ' (verrouillé)' : ''}` : ''}${sommet ? ', accroché à un sommet' : ''}`);
  } else if (tool === 'rotate') {
    if (!rot) {
      const h = pick(ev);
      if (!h) { clearGroup(overlay); rotHover = null; return; }
      const axis = axeRotation(h.plane.n);
      const center = snap(planeFromNormal(h.point, axis), h.point);
      rotHover = { center, axis };
      dessineRapporteur(center, axis, null, null);
      return;
    }
    setRay(ev);
    const p = pointRapporteur(rot.center, rot.axis);
    if (!p) return;
    const v = sub(p, rot.center);
    if (len(v) < 1e-6) return;
    if (rot.phase === 'ref') {
      dessineRapporteur(rot.center, rot.axis, null, v);
      setHud('Clique la ligne de départ de l\'angle');
      return;
    }
    rot.angle = caleAngle(angleDe(rot.ref!, norm(v), rot.axis));
    typed = '';
    applyRot(rot.angle, rot);
    dessineRapporteur(rot.center, rot.axis, rot.ref, v);
    setHud(`${rot.copy ? 'Copie, angle' : 'Angle'} ${bxs(((rot.angle * 180) / Math.PI).toFixed(1) + '°')}`);
  } else if ((tool === 'move' || tool === 'erase') && !mv) {
    // survol : rien de spécial
  } else if (tool === 'tape') {
    survolMetre(ev);
  }
}

// Point visé par le mètre : sommet ou guide accroché, sinon axe inféré, sinon surface sous la souris.
function pointMetre(ev: PointerEvent, depuis: V3 | null, lock: 0 | 1 | 2 | null): { p: V3; axe: 0 | 1 | 2 | null; accroche: 'sommet' | 'milieu' | 'guide' | null } | null {
  const a = accroche3D(ev, new Set());
  if (depuis && lock !== null) {
    setRay(ev);
    const t = a ? dot(sub(a.p, depuis), AX[lock]!) : axisParam(depuis, AX[lock]!);
    return t === null ? null : { p: add(depuis, mul(AX[lock]!, a ? t : Math.round(t / gridStep()) * gridStep())), axe: lock, accroche: a ? 'sommet' : null };
  }
  if (a) return { p: a.p, axe: null, accroche: a.guide ? 'guide' : a.milieu ? 'milieu' : 'sommet' };
  if (depuis) {
    const ax = axeInfere(ev, depuis);
    if (ax !== null) { setRay(ev); const t = axisParam(depuis, AX[ax]!); if (t !== null) return { p: add(depuis, mul(AX[ax]!, Math.round(t / gridStep()) * gridStep())), axe: ax, accroche: null }; }
  }
  const p = pointSous(ev, new Set(), depuis ?? [0, 0, 0]);
  return p ? { p, axe: null, accroche: null } : null;
}
const COULEUR_ACCROCHE = { sommet: 0x16a34a, milieu: 0x0ea5e9, guide: 0xd946ef };
function montreMesure(a: V3, b: V3, axe: 0 | 1 | 2 | null, guide: { p: V3; d: V3 } | null) {
  clearGroup(overlay);
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([tv(a), tv(b)]), new THREE.LineBasicMaterial({ color: axe === null ? 0x1b1b1b : AXE_COULEUR[axe], depthTest: false }));
  l.renderOrder = 8; overlay.add(l);
  if (guide) {
    const g = new THREE.Line(new THREE.BufferGeometry().setFromPoints([tv(add(guide.p, mul(guide.d, -GUIDE_L))), tv(add(guide.p, mul(guide.d, GUIDE_L)))]), new THREE.LineDashedMaterial({ color: 0xd946ef, dashSize: 0.03, gapSize: 0.02, depthTest: false }));
    g.computeLineDistances(); g.renderOrder = 8; overlay.add(g);
  }
  const dist = len(sub(b, a));
  etiquette.textContent = `${fmt(dist)} ${unit().name}`;
  etiquetteObj.position.copy(tv(mul(add(a, b), 0.5)));
  if (!etiquetteObj.parent) scene.add(etiquetteObj);
}
function survolMetre(ev: PointerEvent) {
  if (!mesure) {
    const coin = coinSous(ev);
    const e = coin ? null : areteSous(ev);
    clearGroup(overlay);
    if (!e) {
      const a = accroche3D(ev, new Set());
      if (a) { marker.material.color.set(COULEUR_ACCROCHE[a.guide ? 'guide' : a.milieu ? 'milieu' : 'sommet']); marker.position.copy(tv(a.p)); marker.visible = true; setHud('Clic : mesurer depuis ce point'); return; }
    }
    marker.visible = false;
    if (e) {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([tv(e[0]), tv(e[1])]), new THREE.LineBasicMaterial({ color: 0xd946ef, depthTest: false }));
      l.renderOrder = 8; overlay.add(l);
      setHud(ev.altKey ? 'Option : clic pour mesurer depuis cette arête' : 'Arête en rose : clic, puis éloigne-toi pour tirer un guide parallèle');
    } else setHud('');
    return;
  }
  const m = mesure;
  const r = pointMetre(ev, m.a, m.dir ? null : m.lock);
  if (!r) return;
  typed = '';
  if (m.dir) {
    // guide : décalage perpendiculaire à l'arête, au pas de la grille sauf accroche
    const v = sub(r.p, m.a), perp = sub(v, mul(m.dir, dot(v, m.dir)));
    const d = len(perp);
    if (d < 1e-9) return;
    const dist = r.accroche ? d : Math.round(d / gridStep()) * gridStep();
    m.b = add(m.a, mul(perp, dist / d));
    montreMesure(m.a, m.b, null, { p: m.b, d: m.dir });
    setHud(`Guide à ${bxs(fmt(dist))} de l'arête`);
  } else {
    m.b = r.p; m.infer = r.axe;
    montreMesure(m.a, m.b, r.axe, null);
    const dv = sub(m.b, m.a);
    setHud(`Distance ${bxs(fmt(len(dv)))} (X ${fmt(Math.abs(dv[0]))} ; Y ${fmt(Math.abs(dv[1]))} ; Z ${fmt(Math.abs(dv[2]))})${r.axe !== null ? ` sur l'axe ${AXE_NOM[r.axe]}` : ''}`);
  }
  if (r.accroche) { marker.material.color.set(COULEUR_ACCROCHE[r.accroche]); marker.position.copy(tv(r.p)); marker.visible = true; } else marker.visible = false;
}
// Coin de pièce très près de la souris (6 px) : seul cas où un clic sur une arête mesure au lieu de tirer un guide.
function coinSous(ev: { clientX: number; clientY: number }): V3 | null {
  let best: V3 | null = null, bd = 6;
  for (const c of sommets3D(new Set())) {
    if (c.milieu) continue;
    const [x, y, devant] = versEcran(c.p);
    const d = Math.hypot(x - ev.clientX, y - ev.clientY);
    if (devant && d < bd) { bd = d; best = c.p; }
  }
  return best;
}
function clicMetre(ev: PointerEvent) {
  if (mesure) { finMetre(); return; }
  // une arête prime sur les accroches, sauf si la souris est pile sur un coin
  const e = coinSous(ev) ? null : areteSous(ev);
  if (e && !ev.altKey) {
    // départ sur l'arête, au point le plus proche de la souris (ou à son milieu s'il est tout près)
    setRay(ev);
    const dir = norm(sub(e[1], e[0]));
    const m = mul(add(e[0], e[1]), 0.5);
    const [mx, my] = versEcran(m);
    const q = Math.hypot(mx - ev.clientX, my - ev.clientY) < 8 ? m : procheSurDroite(e[0], dir);
    mesure = { a: q, dir, b: q, lock: null, infer: null };
    setHud('Éloigne-toi de l\'arête : le guide suit. Clique ou tape la distance + Entrée.');
    return;
  }
  const r = pointMetre(ev, null, null);
  if (!r) return;
  mesure = { a: r.p, dir: null, b: r.p, lock: null, infer: null };
}
function finMetre() {
  if (!mesure) return;
  const m = mesure;
  mesure = null;
  if (m.dir && len(sub(m.b, m.a)) > 1e-6) {
    doc = cloneDoc(doc);
    doc.guides ??= [];
    doc.guides.push({ id: doc.next++, p: m.b, d: m.dir });
    clearGroup(overlay); etiquetteObj.removeFromParent();
    commit();
    setHud(`Guide posé à ${fmt(len(sub(m.b, m.a)))} ${unit().name} de l'arête. Gomme pour l'effacer.`);
    return;
  }
  // la mesure reste affichée jusqu'à la suivante
  setHud(`Mesure : ${fmt(len(sub(m.b, m.a)))} ${unit().name}`);
}

function eraseAt(ev: PointerEvent) {
  // trait le plus proche à l'écran
  const r = renderer.domElement.getBoundingClientRect();
  const sx = ev.clientX - r.left, sy = ev.clientY - r.top;
  const scr = (p: V3) => { const v = tv(p).project(camera); return [((v.x + 1) / 2) * r.width, ((1 - v.y) / 2) * r.height] as const; };
  for (const g of doc.guides ?? []) {
    const A = scr(add(g.p, mul(g.d, -5))), B = scr(add(g.p, mul(g.d, 5)));
    const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy);
    if (L > 1e-6 && Math.abs((sx - A[0]) * dy - (sy - A[1]) * dx) / L < 6) {
      doc = { ...doc, guides: (doc.guides ?? []).filter((x) => x.id !== g.id) }; commit(); return;
    }
  }
  let best: { sk: number; seg: number; d: number } | null = null;
  const nd = cloneDoc(doc);
  for (const sk of nd.sketches) {
    sk.segs = splitSegments(sk.segs);
    sk.segs.forEach((s, i) => {
      const [ax, ay] = scr(to3(sk.plane, s[0])), [bx, by] = scr(to3(sk.plane, s[1]));
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((sx - ax) * dx + (sy - ay) * dy) / L2));
      const d = Math.hypot(sx - (ax + t * dx), sy - (ay + t * dy));
      if (d < 8 && (!best || d < best.d)) best = { sk: sk.id, seg: i, d };
    });
  }
  if (best) {
    const b = best as { sk: number; seg: number };
    const sk = nd.sketches.find((s) => s.id === b.sk)!;
    sk.segs.splice(b.seg, 1);
    nd.sketches = nd.sketches.filter((s) => s.segs.length);
    doc = nd; commit(); return;
  }
  const h = pick(ev);
  if (h?.solidId != null) { doc = { ...doc, solids: doc.solids.filter((s) => s.id !== h.solidId) }; selected.delete(h.solidId); commit(); }
}

function onDown(ev: PointerEvent) {
  if (ev.button !== 0) return;
  if (tool === 'open') { prendreOuvrir(ev); return; }
  if (tool === 'scale') { clicEchelle(ev); return; }
  if (tool === 'adjust') { clicAjust(ev); return; }
  if (!mv) lastCopy = null;
  if (!rot && tool !== 'rotate') lastRot = null;
  if (tool === 'select') {
    selDown = { x: ev.clientX, y: ev.clientY, mode: modeSel(ev), drag: false };
  } else if (tool === 'rect' || tool === 'circle') {
    const h = pick(ev);
    if (!h) return;
    if (!draw) {
      const p = to2(h.plane, snap(h.plane, h.point));
      draw = { P: h.plane, p1: p, cur: p };
    } else finishDraw();
  } else if (tool === 'line') {
    const h = pick(ev);
    if (!h) return;
    if (!draw) {
      const p = to2(h.plane, snap(h.plane, h.point));
      draw = { P: h.plane, p1: p, cur: p };
    } else {
      const { P, p1, cur } = draw;
      if (Math.hypot(cur[0] - p1[0], cur[1] - p1[1]) < 1e-4) return;
      addSegments(doc, P, [[p1, cur]]);
      commit();
      draw = { P, p1: cur, cur }; typed = '';
      shown = doc; rebuild(); drawHud();
    }
  } else if (tool === 'pushpull') {
    if (pp) { if (shown !== doc) doc = shown; pp = null; typed = ''; commit(); clearGroup(overlay); setHud(); return; }
    const h = pick(ev);
    if (!h) return;
    const p2 = to2(h.plane, h.point);
    if (regionAt(planeRegions(doc, h.plane), p2)) { pp = { P: h.plane, p2, start: h.point, d: 0 }; clearGroup(overlay); }
  } else if (tool === 'move') {
    if (mv) { finishMove(); return; }
    const h = pick(ev);
    const ids = ciblesDeplacement(h?.solidId ?? null);
    if (!ids.length) { setHud('Clique une pièce ou un meuble, ou sélectionne d\'abord ce qu\'il faut déplacer'); return; }
    if (!selected.size) { for (const i of ids) selected.add(i); refreshPanel(); }
    hoverIds = new Set();
    // point de référence : un coin ou un milieu d'arête s'il y en a un sous la souris
    const a = accroche3D(ev, new Set());
    const start = a?.p ?? h?.point;
    if (!start) return;
    lastCopy = null;
    mv = { ids, start, delta: [0, 0, 0], lock: null, infer: null, copy: ev.altKey };
    rebuild();
  } else if (tool === 'rotate') {
    if (rot?.phase === 'angle') { finishRot(); return; }
    if (rot?.phase === 'ref') {
      setRay(ev);
      const p = pointRapporteur(rot.center, rot.axis);
      if (!p || len(sub(p, rot.center)) < 1e-6) return;
      rot.ref = norm(sub(p, rot.center)); rot.phase = 'angle'; rot.angle = 0;
      return;
    }
    // 1er clic : le centre. Sans sélection, on tourne la pièce cliquée.
    const h = pick(ev);
    if (!h || !rotHover) return;
    let ids = [...selected];
    if (!ids.length && h.solidId != null) { ids = [h.solidId]; selected.add(h.solidId); rebuild(); refreshPanel(); }
    if (!ids.length) { setHud('Sélectionne d\'abord la pièce à tourner (outil Sélection), ou clique directement sur elle'); return; }
    lastRot = null;
    rot = { phase: 'ref', ids, center: rotHover.center, axis: rotHover.axis, ref: null, angle: 0, copy: ev.altKey };
  } else if (tool === 'tape') {
    clicMetre(ev);
  } else if (tool === 'erase') {
    eraseAt(ev);
  }
}

function finishDraw() {
  if (!draw) return;
  const { P, p1, cur } = draw;
  let segs: Seg2[] = [];
  if (tool === 'rect' && Math.abs(cur[0] - p1[0]) > 1e-4 && Math.abs(cur[1] - p1[1]) > 1e-4) segs = rectSegs(p1, cur);
  if (tool === 'circle') { const r = Math.hypot(cur[0] - p1[0], cur[1] - p1[1]); if (r > 1e-4) segs = circleSegs(p1, r); }
  if (segs.length) { addSegments(doc, P, segs); commit(); }
  draw = null; typed = ''; shown = doc; clearGroup(overlay); marker.visible = false; rebuild(); setHud();
}

// ───────── Copier, couper, coller, dupliquer ─────────
// Le presse-papiers vit dans le stockage de l'app : on peut copier dans un projet et coller dans un autre.
// Un meuble copié en entier reste un meuble (modifiable, ajustable) ; quelques pièces d'un meuble deviennent des pièces libres.
interface PressePapier { solids: Solid[]; caissons: CaissonRec[]; extras: Extra[]; elements?: Element[] }
const PP_CLE = 'workshop3d.pressepapier';
let docAvantCollage: string | null = null;   // collage en cours, annulable avec Échap
function contenuSelection(): PressePapier | null { return contenuDe(doc, [...selected]); }
// Pièces `ids` de `doc`, avec les meubles entièrement compris dedans, leur quincaillerie et leurs portes et tiroirs.
function contenuDe(doc: Doc, liste: number[]): PressePapier | null {
  const selected = new Set(liste);
  const solids = doc.solids.filter((x) => selected.has(x.id));
  if (!solids.length) return null;
  const caissons = (doc.caissons ?? []).filter((c) => {
    const pieces = doc.solids.filter((x) => x.meta.caisson === c.id);
    return pieces.length > 0 && pieces.every((x) => selected.has(x.id));
  });
  const ids = new Set(caissons.map((c) => c.id));
  const pris = new Set(solids.map((x) => x.id));
  const elements = (doc.elements ?? []).filter((e) => piecesDe(e).every((i) => pris.has(i)));
  return JSON.parse(JSON.stringify({ solids, caissons, elements, extras: (doc.extras ?? []).filter((x) => x.caisson !== undefined && ids.has(x.caisson)) })) as PressePapier;
}
function copier(couper: boolean) {
  const pp = contenuSelection();
  if (!pp) { setHud('Sélectionne d\'abord les pièces à copier'); return; }
  try { localStorage.setItem(PP_CLE, JSON.stringify(pp)); } catch { /* stockage indisponible */ }
  pressePapierMemoire = pp;
  if (couper) {
    doc = { ...doc, solids: doc.solids.filter((x) => !selected.has(x.id)) };
    selected.clear(); commit();
  }
  setHud(`${pp.solids.length} pièce(s) ${couper ? 'coupée(s)' : 'copiée(s)'} : Cmd+V pour coller`);
}
let pressePapierMemoire: PressePapier | null = null;
function lirePressePapier(): PressePapier | null {
  try { const t = localStorage.getItem(PP_CLE); if (t) return JSON.parse(t) as PressePapier; } catch { /* ignoré */ }
  return pressePapierMemoire;
}
// Ajoute le contenu au document avec de nouveaux identifiants ; renvoie les pièces ajoutées.
function inserer(d: Doc, pp: PressePapier): number[] {
  const mapCaisson = new Map<number, number>();
  d.caissons ??= []; d.extras ??= [];
  for (const c of pp.caissons) { const id = d.next++; mapCaisson.set(c.id, id); d.caissons.push({ ...c, id }); }
  for (const x of pp.extras) d.extras.push({ ...x, id: d.next++, caisson: mapCaisson.get(x.caisson!) });
  const ids: number[] = [], mapPieces = new Map<number, number>();
  for (const s of pp.solids) {
    const id = d.next++;
    const meta = { ...s.meta };
    if (meta.caisson !== undefined) { const c = mapCaisson.get(meta.caisson); if (c !== undefined) meta.caisson = c; else delete meta.caisson; }
    d.solids.push({ ...s, id, meta });
    ids.push(id); mapPieces.set(s.id, id);
  }
  copierElements(d, pp.elements ?? [], mapPieces, mapCaisson);
  return ids;
}
// Coller : les pièces suivent la souris (comme Déplacer) jusqu'au clic ; « sur place » les remet à leur position d'origine.
function coller(surPlace: boolean, source?: PressePapier) {
  const pp = source ?? lirePressePapier();
  if (!pp?.solids.length) { setHud('Presse-papiers vide : copie d\'abord des pièces (Cmd+C)'); return; }
  // l'outil change avant l'insertion : changer d'outil annule toute opération en cours, collage compris
  if (!surPlace) setTool('move'); else cancelOp();
  const avant = JSON.stringify(doc);
  doc = cloneDoc(doc);
  const ids = inserer(doc, pp);
  selected.clear(); for (const i of ids) selected.add(i);
  if (surPlace) { commit(); setHud(`${ids.length} pièce(s) collée(s) sur place`); return; }
  docAvantCollage = avant;
  const bb = bboxOf(doc.solids.filter((x) => ids.includes(x.id)))!;
  mv = { ids, start: bb.min, delta: [0, 0, 0], lock: null, infer: null, copy: false };
  shown = doc; rebuild(); refreshPanel();
  setHud('Clique pour poser (le coin avant gauche du bas suit la souris), Échap pour annuler');
}
function dupliquer() {
  const pp = contenuSelection();
  if (!pp) { setHud('Sélectionne d\'abord les pièces à dupliquer'); return; }
  coller(false, pp);
}
// Commandes du menu Édition : dans un champ de saisie, elles agissent sur le texte.
async function commandeEdition(id: string): Promise<boolean> {
  const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  const texte = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  if (texte) {
    if (id === 'copy' || id === 'cut') { document.execCommand(id); return true; }
    if (id === 'select_all') { el.select(); return true; }
    if (id === 'paste' || id === 'paste_in_place') {
      try { const t = await navigator.clipboard.readText(); el.setRangeText(t, el.selectionStart ?? 0, el.selectionEnd ?? 0, 'end'); el.dispatchEvent(new Event('change')); } catch { /* presse-papiers refusé */ }
      return true;
    }
    return false;
  }
  if (id === 'copy') copier(false);
  else if (id === 'cut') copier(true);
  else if (id === 'paste') coller(false);
  else if (id === 'paste_in_place') coller(true);
  else if (id === 'duplicate') dupliquer();
  else if (id === 'select_all') appliquerSel(visibles(doc).map((x) => x.id), 'remplace');
  else if (id === 'hide') masquerSelection();
  else if (id === 'unhide_all') toutAfficher();
  else return false;
  return true;
}

// ───────── Masquer / afficher ─────────
// Comme SketchUp : une pièce masquée disparaît de l'écran, des outils et de la sélection, mais reste dans le projet.
function masquerSelection() {
  if (!selected.size) { setHud('Sélectionne d\'abord les pièces à masquer'); return; }
  const n = selected.size;
  doc = cloneDoc(doc);
  for (const s of doc.solids) if (selected.has(s.id)) s.meta.masque = true;
  selected.clear(); cancelOp(); commit();
  setHud(`${n} pièce(s) masquée(s). Maj+Option+H ou « Tout afficher » pour les revoir`);
}
function toutAfficher() {
  const n = doc.solids.filter((s) => s.meta.masque).length;
  if (!n) { setHud('Aucune pièce masquée'); return; }
  doc = cloneDoc(doc);
  for (const s of doc.solids) delete s.meta.masque;
  commit(); setHud(`${n} pièce(s) de nouveau visible(s)`);
}

// ───────── Clavier ─────────
function applyTyped() {
  if (mesure) {
    const v = parseFloat(typed.replace(',', '.'));
    typed = '';
    if (Number.isNaN(v)) return;
    const d = v / unit().f, dv = sub(mesure.b, mesure.a);
    if (len(dv) < 1e-9) return;
    mesure.b = add(mesure.a, mul(norm(dv), d));
    finMetre();
    return;
  }
  if (ech) { saisieEchelle(typed); typed = ''; return; }
  if (aj) {
    const v = parseFloat(typed.replace(',', '.'));
    if (!Number.isNaN(v)) { previsualiseAjust((v / unit().f) * 1000); finAjust(); }
    typed = ''; return;
  }
  if (!draw && !pp && !mv && !rot) { if (!applyRotRetype()) applyMultiCopy(); typed = ''; return; }
  const v = parseTyped().map((x) => x / unit().f);
  if (!v.length) return;
  if (draw && tool === 'rect') {
    const sx = draw.cur[0] >= draw.p1[0] ? 1 : -1, sy = draw.cur[1] >= draw.p1[1] ? 1 : -1;
    draw.cur = [draw.p1[0] + sx * v[0]!, draw.p1[1] + sy * (v[1] ?? v[0]!)];
    finishDraw();
  } else if (draw && tool === 'circle') {
    draw.cur = [draw.p1[0] + v[0]!, draw.p1[1]]; finishDraw();
  } else if (draw && tool === 'line') {
    const dx = draw.cur[0] - draw.p1[0], dy = draw.cur[1] - draw.p1[1], L = Math.hypot(dx, dy) || 1;
    const cur: P2 = [draw.p1[0] + (dx / L) * v[0]!, draw.p1[1] + (dy / L) * v[0]!];
    addSegments(doc, draw.P, [[draw.p1, cur]]);
    draw = { P: draw.P, p1: cur, cur }; typed = ''; commit(); shown = doc; rebuild(); drawHud();
  } else if (pp) {
    const sign = pp.d < 0 ? -1 : 1;
    pushPullPreview(sign * Math.abs(v[0]!) * (parseTyped()[0]! < 0 ? -1 * sign : 1));
    doc = shown; pp = null; typed = ''; commit(); clearGroup(overlay); setHud();
  } else if (mv) {
    // une distance le long de la direction courante, ou « x;y;z » pour un décalage complet
    if (v.length >= 3) mv.delta = [v[0]!, v[1]!, v[2]!];
    else {
      const ax = mv.lock ?? mv.infer;
      const dir = ax !== null ? mul(AX[ax]!, Math.sign(dot(mv.delta, AX[ax]!)) || 1) : norm(len(mv.delta) > 0 ? mv.delta : [1, 0, 0]);
      mv.delta = mul(dir, v[0]!);
    }
    applyMove(mv.delta, mv.ids, mv.copy);
    finishMove();
  } else if (rot?.phase === 'angle') {
    rot.angle = (parseFloat(typed.replace(',', '.')) * Math.PI) / 180;
    if (Number.isNaN(rot.angle)) return;
    applyRot(rot.angle, rot);
    finishRot();
  }
}

function onKey(ev: KeyboardEvent) {
  if (ev.target instanceof Element && ev.target.closest('input, select, textarea')) return;
  const k = ev.key;
  const mod = ev.metaKey || ev.ctrlKey;
  if (mod && k.toLowerCase() === 'z') { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); return; }
  if (mod && k.toLowerCase() === 'y') { ev.preventDefault(); redo(); return; }
  if (mod && k.toLowerCase() === 's') { ev.preventDefault(); void fileSave(ev.shiftKey); return; }
  if (mod && k.toLowerCase() === 'o') { ev.preventDefault(); void fileOpen(); return; }
  if (mod && k.toLowerCase() === 'i') { ev.preventDefault(); void importerDae(); return; }
  if (mod && k.toLowerCase() === 'e') { ev.preventDefault(); void exporterDae(); return; }
  if (tool === 'scale' && k === 'Tab') { ev.preventDefault(); modeEch = modeEch === 'etirer' ? 'echelle' : 'etirer'; if (ech) previsuEchelle(); else setHud(modeEchTexte()); return; }
  if (mod && k.toLowerCase() === 'a') { ev.preventDefault(); appliquerSel(visibles(doc).map((x) => x.id), 'remplace'); return; }
  // Maj+H masque la sélection, Maj+Option+H affiche tout (H seul reste le panoramique)
  if (!mod && ev.shiftKey && ev.code === 'KeyH') { ev.preventDefault(); if (ev.altKey) toutAfficher(); else masquerSelection(); return; }
  const edition: Record<string, string> = { c: 'copy', x: 'cut', v: ev.shiftKey ? 'paste_in_place' : 'paste', d: 'duplicate' };
  if (mod && edition[k.toLowerCase()]) { ev.preventDefault(); void commandeEdition(edition[k.toLowerCase()]!); return; }
  if (mod) return;
  if (k === 'Escape' && tool === 'select' && !debitEl.classList.contains('open') && selected.size) { appliquerSel([], 'remplace'); return; }
  if (k === 'Escape') { if (debitEl.classList.contains('open')) closeDebit(); else cancelOp(); return; }
  if (k === 'Enter') { applyTyped(); return; }
  if (mv && k === 'Alt') { mv.copy = !mv.copy; applyMove(mv.delta, mv.ids, mv.copy); setHud(mv.copy ? 'Copie activée' : 'Déplacement'); ev.preventDefault(); return; }
  if (rot && k === 'Alt') { rot.copy = !rot.copy; if (rot.phase === 'angle') applyRot(rot.angle, rot); setHud(rot.copy ? 'Copie activée' : 'Rotation'); ev.preventDefault(); return; }
  if (ech && /^[0-9.,cm]$/.test(k)) { typed += k; setHud(`<b>${typed}</b> (facteur, ou cote en mm, cm, m) + Entrée`); ev.preventDefault(); return; }
  if (draw || pp || mv || rot || aj || mesure || ech || ((lastCopy || lastRot) && /^[0-9x*/.,;-]$/.test(k))) {
    if (/^[0-9.,;x*/-]$/.test(k)) { typed += k; if (draw) drawHud(); else setHud(`<b>${typed}</b>`); ev.preventDefault(); return; }
    if (k === 'Backspace') { typed = typed.slice(0, -1); ev.preventDefault(); return; }
  }
  if (mv && k.startsWith('Arrow')) {
    // → rouge (X), ← vert (Y), ↑ bleu (Z), ↓ libre ; même flèche une 2e fois : déverrouille
    const l = k === 'ArrowRight' ? 0 : k === 'ArrowLeft' ? 1 : k === 'ArrowUp' ? 2 : null;
    mv.lock = mv.lock === l ? null : l;
    setHud(mv.lock === null ? 'Déplacement libre' : `Verrouillé sur l'axe ${AXE_NOM[mv.lock]}`);
    ev.preventDefault(); return;
  }
  if (mesure && !mesure.dir && k.startsWith('Arrow')) {
    const l = k === 'ArrowRight' ? 0 : k === 'ArrowLeft' ? 1 : k === 'ArrowUp' ? 2 : null;
    mesure.lock = mesure.lock === l ? null : l;
    setHud(mesure.lock === null ? 'Mesure libre' : `Mesure sur l'axe ${AXE_NOM[mesure.lock]}`);
    ev.preventDefault(); return;
  }
  if (mv && k === 'Shift') { mv.lock = mv.lock !== null ? null : mv.infer; setHud(mv.lock === null ? 'Déplacement libre' : `Verrouillé sur l'axe ${AXE_NOM[mv.lock]}`); return; }
  if (tool === 'rotate' && rot?.phase !== 'angle' && k.startsWith('Arrow')) {
    // → axe rouge (X), ← axe vert (Y), ↑ axe bleu (Z), ↓ libre : comme le rapporteur de SketchUp
    rotLock = k === 'ArrowRight' ? 0 : k === 'ArrowLeft' ? 1 : k === 'ArrowUp' ? 2 : null;
    if (rot) { rot.axis = rotLock !== null ? AX[rotLock]! : rot.axis; dessineRapporteur(rot.center, rot.axis, null, null); }
    setHud(rotLock === null ? 'Axe libre : celui de la face survolée' : `Axe verrouillé : ${['rouge (X)', 'vert (Y)', 'bleu (Z)'][rotLock]}`);
    ev.preventDefault(); return;
  }
  if ((k === 'Delete' || k === 'Backspace') && selected.size) {
    doc = { ...doc, solids: doc.solids.filter((s) => !selected.has(s.id)) };
    selected.clear(); commit(); return;
  }
  const map: Record<string, Tool> = { ' ': 'select', a: 'adjust', s: 'scale', i: 'open', l: 'line', r: 'rect', c: 'circle', p: 'pushpull', m: 'move', q: 'rotate', t: 'tape', e: 'erase', o: 'orbit', h: 'pan' };
  const t = map[k.toLowerCase()];
  if (t) { ev.preventDefault(); setTool(t); return; }
  if (k.toLowerCase() === 'd') { openDebit(); return; }
  if (k === '?' || k === 'F1') { openGuide(); return; }
  if (k.toLowerCase() === 'g' && selected.size) { toggleComponent(doc.solids.filter((x) => selected.has(x.id))); return; }
  if (k === 'Z' && ev.shiftKey) fitAll();
  if (k.toLowerCase() === 'k') { cotesOn = !cotesOn; marquer('cotes'); drawCotes(); refreshPanel(); return; }
  const vues: Record<string, Vue> = { '1': 'face', '2': 'dessus', '3': 'cote', '0': 'iso' };
  if (vues[k] && !lastCopy) vue(vues[k]!);
}

// Vues normalisées : la caméra se place face au modèle, à la même distance.
type Vue = 'face' | 'dessus' | 'cote' | 'iso';
function vue(v: Vue) {
  const bb = bboxOf(visibles(doc).length ? visibles(doc) : doc.solids);
  const c: V3 = bb ? mul(add(bb.min, bb.max), 0.5) : [0, 0, 0];
  const d = camera.position.distanceTo(controls.target);
  const dir: V3 = v === 'face' ? [0, -1, 0] : v === 'dessus' ? [0, -0.001, 1] : v === 'cote' ? [1, 0, 0] : [1, -1.2, 0.8];
  controls.target.copy(tv(c));
  camera.position.copy(tv(add(c, mul(norm(dir), d))));
  camera.lookAt(tv(c));
}

function fitAll() {
  if (!doc.solids.length) return;
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  const vis = visibles(doc).length ? visibles(doc) : doc.solids;
  for (const s of vis) { const b = meshBounds(s.mesh); for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, b.min[k]!); hi[k] = Math.max(hi[k]!, b.max[k]!); } }
  const c = mul(add(lo, hi), 0.5);
  const r = Math.max(len(sub(hi, lo)) / 2, 0.2);
  const dir = camera.position.clone().sub(controls.target).normalize();
  controls.target.copy(tv(c));
  camera.position.copy(tv(c)).addScaledVector(dir, r / Math.sin((camera.fov * Math.PI) / 360));
}

// ───────── Panneau de propriétés ─────────
const panel = document.getElementById('panel')!;
function refreshPanel() {
  const sel = doc.solids.filter((s) => selected.has(s.id));
  let html = '';
  if (sel.length === 1) {
    const s = sel[0]!;
    const d = pieceDims(s.mesh);
    const cais = s.meta.caisson && (doc.caissons ?? []).some((c) => c.id === s.meta.caisson);
    html += `<h3>Pièce sélectionnée</h3>
      <label>Nom <input id="p-nom" value="${esc(s.name)}"></label>
      <div class="dims">${fmt(d.L)} × ${fmt(d.l)} × ${fmt(d.e)} ${unit().name}</div>
      ${puces(s.meta.methode ? [s.meta.methode] : [], !s.meta.methode && s.meta.matiere ? s.meta.matiere : '')}
      <label title="L1 et L2 : les deux grands côtés ; l1 et l2 : les deux petits">Chants <span id="p-chants" style="display:flex;gap:8px">${SIDES.map((k) => `<label style="display:flex;gap:3px;grid-template-columns:none"><input type="checkbox" data-side="${k}" ${sidesOf(doc, s).includes(k) ? 'checked' : ''}>${k}</label>`).join('')}</span></label>
      <label title="Sens du fil du bois : le long de la longueur (L) ou de la largeur (l)">Fil du bois <select id="p-fil">${([['aucun', 'Peu importe'], ['L', 'Dans la longueur'], ['l', 'Dans la largeur']] as const).map(([v, t]) => `<option value="${v}" ${v === s.meta.fil ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Note <input id="p-note" value="${esc(s.meta.note)}"></label>
      <label>Dans la fiche <input id="p-piece" type="checkbox" ${s.meta.piece ? 'checked' : ''}></label>
      ${cais ? `<div class="row"><button class="btn" id="p-cais-mod">Modifier le meuble…</button><button class="btn" id="p-cais-sel">Tout le meuble</button></div>` : ''}
      <div class="row"><button class="btn" id="p-dup" title="Cmd+D">Dupliquer</button><button class="btn" id="p-copy" title="Cmd+C">Copier</button><button class="btn" id="p-hide" title="Maj+H">Masquer</button></div>
      ${expert ? `<button class="btn" id="p-comp" title="G">${s.comp ? `Rendre unique (${instancesOf(doc, s).length} copies liées)` : 'Créer un composant (G)'}</button>` : ''}`;
  } else if (sel.length > 1) {
    html += `<h3>${sel.length} pièces sélectionnées</h3>
      ${puces([...new Set(sel.map((x) => x.meta.methode ?? 0))].filter(Boolean), '')}
      <div class="row"><button class="btn" id="p-dup" title="Cmd+D">Dupliquer</button><button class="btn" id="p-copy" title="Cmd+C">Copier</button><button class="btn" id="p-hide" title="Maj+H">Masquer</button></div>`;
  }
  if (sel.length) html += sectionElement(sel);
  const nbMasques = doc.solids.filter((x) => x.meta.masque).length;
  const nbElements = (doc.elements ?? []).length, aReconnaitre = reconnaitre({ ...doc }).length;
  html += `<h3>Concevoir</h3>
    <button class="btn primary" id="p-caisson">Nouveau meuble…</button>
    <h3>Fabriquer</h3>
    <button class="btn" id="p-debit" title="Touche D">Fiche de débit</button>
    <button class="btn" id="p-decoupe">Découpe et coût</button>
    <button class="btn" id="p-plans">Plans à imprimer</button>
    <div class="row"><button class="btn" id="p-verif" title="Pièces qui se traversent, portées, portes, plafond…">Vérifier</button><button class="btn" id="p-percage" title="Charnières et poignées des portes et tiroirs (de la sélection, ou tous)">Fiche de perçage</button></div>
    <div class="row"><button class="btn" id="p-courses">Liste de courses</button><button class="btn" id="p-notice" title="Étapes de montage, enregistrées avec le projet">Notice de montage${doc.notice?.length ? ` (${doc.notice.length})` : ''}</button></div>
    <button class="btn" id="p-methods">Matériaux et couleurs…</button>
    <h3>Affichage</h3>
    <div class="row">${(['face', 'dessus', 'cote', 'iso'] as const).map((v, i) => `<button class="btn" data-vue="${v}" title="Touche ${['1', '2', '3', '0'][i]}">${['Face', 'Dessus', 'Côté', '3D'][i]}</button>`).join('')}<button class="btn ${cotesOn ? 'primary' : ''}" id="p-cotes" title="Touche K">Cotes</button></div>
    <div class="row"><button class="btn ${reperesOn ? 'primary' : ''}" id="p-reperes" title="Référence de fiche (P1, P2…) sur chaque pièce">Repères</button><button class="btn ${eclate ? 'primary' : ''}" id="p-eclate" title="Écarte les pièces pour voir l'assemblage">Vue éclatée</button>${doc.plafond ? `<button class="btn ${plafondOn ? 'primary' : ''}" id="p-plafond-vis" title="Afficher le plafond de référence">Plafond</button>` : ''}<button class="btn" id="p-plafond" title="Plafond en pente pris comme référence">${doc.plafond ? 'Pente…' : 'Plafond en pente…'}</button></div>
    ${nbElements ? `<div class="row"><button class="btn" id="e-tout-ouvrir">Tout ouvrir</button><button class="btn" id="e-tout-fermer">Tout fermer</button><button class="btn ${ferruresOn ? 'primary' : ''}" id="e-ferrures" title="Charnières, coulisses et poignées">Quincaillerie</button></div>` : ''}
    ${aReconnaitre ? `<button class="btn" id="e-reconnaitre" title="D'après leurs noms : « Porte… », « Façade tiroir… »">Reconnaître ${aReconnaitre} porte(s) et tiroir(s)</button>` : ''}
    ${nbMasques ? `<button class="btn" id="p-unhide" title="Maj+Option+H">Tout afficher (${nbMasques} pièce${nbMasques > 1 ? 's' : ''} masquée${nbMasques > 1 ? 's' : ''})</button>` : ''}
    ${doc.guides?.length ? `<button class="btn" id="p-guides">Effacer les guides (${doc.guides.length})</button>` : ''}
    <h3>Projet</h3>
    <div class="row"><button class="btn" id="f-new" title="Cmd+N">Nouveau</button><button class="btn" id="f-open" title="Cmd+O">Ouvrir</button><button class="btn" id="f-save" title="Cmd+S">Enregistrer</button></div>
    <div class="row"><button class="btn" id="f-import" title="Cmd+I : fichier .dae (SketchUp, Sweet Home 3D…)">Importer .dae</button><button class="btn" id="f-export" title="Cmd+E : la sélection, ou tout le modèle">Exporter .dae</button></div>
    <div class="dims">${doc.solids.filter((x) => x.meta.piece).length} pièce(s) dans le modèle</div>`;
  panel.innerHTML = html;

  const on = (id: string, fn: () => void) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  if (sel.length === 1) {
    const s = sel[0]!;
    const upd = () => {
      s.name = (document.getElementById('p-nom') as HTMLInputElement).value;
      s.meta.piece = (document.getElementById('p-piece') as HTMLInputElement).checked;
      s.meta.fil = (document.getElementById('p-fil') as HTMLSelectElement).value as 'L' | 'l' | 'aucun';
      const picked = [...document.querySelectorAll<HTMLInputElement>('#p-chants input:checked')].map((c) => c.dataset.side!).join(' ');
      if (picked === (materiauDe(doc, s)?.cotes ?? '')) delete s.meta.chants; else s.meta.chants = picked;
      s.meta.note = (document.getElementById('p-note') as HTMLInputElement).value;
      propagate(doc, s.id);
      commitQuiet();
    };
    for (const id of ['p-nom', 'p-piece', 'p-fil', 'p-note']) { const el = document.getElementById(id); if (el) el.onchange = upd; }
    document.querySelectorAll<HTMLInputElement>('#p-chants input').forEach((c) => { c.onchange = upd; });
    on('p-comp', () => toggleComponent([s]));
    const cid = s.meta.caisson;
    if (cid) {
      on('p-cais-sel', () => { selected.clear(); for (const x of doc.solids) if (x.meta.caisson === cid) selected.add(x.id); rebuild(); refreshPanel(); });
      on('p-cais-mod', () => openCaisson(cid));
    }
  }
  // Un clic sur un matériau l'applique à toute la sélection ; les chants reprennent ceux du matériau.
  panel.querySelectorAll<HTMLButtonElement>('[data-mat]').forEach((b) => {
    b.onclick = () => {
      const mid = Number(b.dataset.mat);
      doc = cloneDoc(doc);
      for (const x of doc.solids) if (selected.has(x.id)) { x.meta.methode = mid; delete x.meta.chants; propagate(doc, x.id); }
      commit();
    };
  });
  on('p-mat-new', () => openMethods());
  on('p-hide', masquerSelection);
  lierElement(sel);
  on('p-verif', () => ouvrirVerification(feuille));
  on('p-percage', () => ouvrirPercage(feuille));
  on('p-courses', () => ouvrirCourses(feuille));
  on('p-notice', () => ouvrirNotice(feuille));
  on('p-plafond', () => ouvrirPlafond(feuille));
  on('p-plafond-vis', () => { plafondOn = !plafondOn; rebuild(); refreshPanel(); });
  on('p-reperes', () => { reperesOn = !reperesOn; rebuild(); refreshPanel(); });
  on('p-eclate', () => { eclate = !eclate; rebuild(); refreshPanel(); });
  on('e-tout-ouvrir', () => { for (const e of doc.elements ?? []) ouverts.set(e.id, 1); rebuild(); });
  on('e-tout-fermer', () => { ouverts.clear(); rebuild(); });
  on('e-ferrures', () => { ferruresOn = !ferruresOn; rebuild(); refreshPanel(); });
  on('e-reconnaitre', () => {
    doc = cloneDoc(doc);
    const n = reconnaitre(doc);
    doc.elements = [...(doc.elements ?? []), ...n];
    commit(); setHud(`${n.length} élément(s) reconnu(s) : sélectionne-en un pour régler ses charnières, coulisses et poignées`);
  });
  on('p-unhide', toutAfficher);
  on('p-dup', dupliquer);
  on('p-copy', () => copier(false));
  on('p-caisson', () => openCaisson(null));
  on('p-debit', openDebit);
  on('p-decoupe', openDecoupe);
  on('p-plans', () => openPlans(feuille));
  on('p-methods', openMethods);
  panel.querySelectorAll<HTMLButtonElement>('[data-vue]').forEach((b) => { b.onclick = () => vue(b.dataset.vue as Vue); });
  on('p-cotes', () => { cotesOn = !cotesOn; marquer('cotes'); drawCotes(); refreshPanel(); });
  on('p-guides', () => { doc = { ...doc, guides: [] }; commit(); });
  on('f-import', () => void importerDae());
  on('f-export', () => void exporterDae());
  on('f-new', () => void fileNew());
  on('f-open', () => void fileOpen());
  on('f-save', () => void fileSave());
}
// ───────── Fenêtres annexes (src/ui/feuilles.ts) ─────────
// Enregistre un fichier texte : dialogue natif dans l'app Mac, téléchargement dans le navigateur.
function telecharger(texte: string, nom: string, ext: string) {
  if (tauri) { void tauri.core.invoke('save_doc', { path: null, contents: texte, ext, nom }).catch(fileError); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texte], { type: 'text/csv;charset=utf-8' }));
  a.download = nom; a.click(); URL.revokeObjectURL(a.href);
}
const feuille: Feuille = {
  get el() { return debitEl; },
  doc: () => doc,
  fiche: () => syncFromModel(doc, debit, rowId),
  selection: () => [...selected],
  appliquer(d) { cancelOp(); doc = d; commit(); },
  montrer(ids) { selected.clear(); for (const i of ids) if (!doc.solids.find((s) => s.id === i)?.meta.masque) selected.add(i); rebuild(); refreshPanel(); },
  fermer: closeDebit,
  telecharger,
};

// ───────── Outil Échelle (façon SketchUp) ─────────
// Poignées sur la boîte de la sélection : faces (un axe) et coins (proportionnel). La poignée opposée reste fixe,
// ou le centre avec Option. Mode « etirer » par défaut : les panneaux gardent leur épaisseur (src/kernel/echelle.ts).
interface PoigneeEch { p: V3; axes: number[]; ancre: V3 }
interface Ech { ids: number[]; g: PoigneeEch; ancre: V3; s: V3; base: { lo: V3; hi: V3 } }
let ech: Ech | null = null, poigneesEch: PoigneeEch[] = [], survolEch = -1, idsEch: number[] = [];
let modeEch: ModeEchelle = 'etirer';
const modeEchTexte = () => (modeEch === 'etirer' ? 'Échelle : épaisseurs des panneaux gardées (Tab : tout agrandir)' : 'Échelle : tout s\'agrandit, épaisseurs comprises (Tab : garder les épaisseurs)');
function poigneesEchelle(ids: number[]): PoigneeEch[] {
  const b = boiteDe(doc.solids.filter((x) => ids.includes(x.id)));
  if (!b) return [];
  const { lo, hi } = b, c = mul(add(lo, hi), 0.5), out: PoigneeEch[] = [];
  for (let k = 0; k < 3; k++) for (const side of [lo, hi]) {
    const p = [...c] as V3, a = [...c] as V3; p[k] = side[k]!; a[k] = side === lo ? hi[k]! : lo[k]!;
    out.push({ p, axes: [k], ancre: a });
  }
  for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]])
    out.push({ p: [x!, y!, z!], axes: [0, 1, 2], ancre: [x === lo[0] ? hi[0]! : lo[0]!, y === lo[1] ? hi[1]! : lo[1]!, z === lo[2] ? hi[2]! : lo[2]!] });
  return out;
}
function dessinerEchelle(ids: number[]) {
  clearGroup(overlay);
  const b = boiteDe((ech ? shown : doc).solids.filter((x) => ids.includes(x.id)));
  if (!b) return;
  const t = sub(b.hi, b.lo), cadre = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(t[0], t[1], t[2])), new THREE.LineBasicMaterial({ color: 0x2ea043, depthTest: false }));
  cadre.position.copy(tv(mul(add(b.lo, b.hi), 0.5))); cadre.renderOrder = 9; overlay.add(cadre);
  if (ech) return;
  poigneesEch.forEach((g, i) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(i === survolEch ? 0.022 : 0.015, 12, 8), new THREE.MeshBasicMaterial({ color: i === survolEch ? 0xef9f27 : g.axes.length === 1 ? 0x2ea043 : 0xd33a2c, depthTest: false }));
    m.position.copy(tv(g.p)); m.renderOrder = 10; overlay.add(m);
  });
}
function bougerEchelle(ev: PointerEvent) {
  if (!ech) {
    const h = pick(ev);
    const ids = ciblesDeplacement(h?.solidId ?? null);
    if (!ids.length && !poigneesEch.length) return;
    if (ids.length) { poigneesEch = poigneesEchelle(ids); idsEch = ids; }
    let best = -1, bd = 14;
    poigneesEch.forEach((g, i) => { const [x, y, ok] = versEcran(g.p); const d = Math.hypot(x - ev.clientX, y - ev.clientY); if (ok && d < bd) { bd = d; best = i; } });
    survolEch = best;
    if (ids.length) dessinerEchelle(ids);
    setHud(best >= 0 ? `${poigneesEch[best]!.axes.length === 1 ? `Poignée ${['rouge (X)', 'verte (Y)', 'bleue (Z)'][poigneesEch[best]!.axes[0]!]}` : 'Coin : proportionnel'} — clic pour prendre. ${modeEchTexte()}` : modeEchTexte());
    renderer.domElement.style.cursor = best >= 0 ? 'pointer' : 'default';
    return;
  }
  setRay(ev);
  const { g, ancre, base } = ech, dir = norm(sub(g.p, ancre)), L = len(sub(g.p, ancre));
  const t = axisParam(g.p, g.axes.length === 1 ? AX[g.axes[0]!]! : dir);
  if (t === null || L < 1e-9) return;
  const s: V3 = [1, 1, 1];
  if (g.axes.length === 1) {
    const k = g.axes[0]!, sg = g.p[k]! >= ancre[k]! ? 1 : -1, f = (Math.abs(g.p[k]! - ancre[k]!) + sg * t) / Math.abs(g.p[k]! - ancre[k]!);
    s[k] = Math.max(0.05, f);
  } else { const f = Math.max(0.05, (L + t) / L); s[0] = s[1] = s[2] = f; }
  ech.s = s; void base;
  previsuEchelle();
}
function previsuEchelle() {
  if (!ech) return;
  const d = cloneDoc(doc);
  transformer(d.solids.filter((x) => ech!.ids.includes(x.id)), ech.s, ech.ancre, modeEch);
  shown = d; rebuild(); dessinerEchelle(ech.ids);
  const b = ech.base, k = ech.g.axes.length === 1 ? ech.g.axes[0]! : -1;
  const taille = (kk: number) => Math.round(((b.hi[kk]! - b.lo[kk]!) * ech!.s[kk]!) * 1000);
  setHud(`× ${(k >= 0 ? ech.s[k]! : ech.s[0]).toFixed(3).replace('.', ',')} — ${k >= 0 ? `${taille(k)} mm` : `${taille(0)} × ${taille(1)} × ${taille(2)} mm`}. Clic pour poser, ou tape un facteur ou une cote (mm) + Entrée. ${modeEchTexte()}`);
}
function clicEchelle(ev: PointerEvent) {
  if (ech) { finEchelle(); return; }
  if (survolEch < 0) { setHud('Clique une poignée (points verts : un axe ; rouges : proportionnel)'); return; }
  // les pièces dont on voit les poignées (la sélection, ou la pièce / le meuble survolé en dernier)
  const g = poigneesEch[survolEch]!, idsOk = idsEch.filter((i) => doc.solids.some((x) => x.id === i));
  if (!idsOk.length) return;
  const base = boiteDe(doc.solids.filter((x) => idsOk.includes(x.id)))!;
  ech = { ids: idsOk, g, ancre: ev.altKey ? mul(add(base.lo, base.hi), 0.5) : g.ancre, s: [1, 1, 1], base };
  if (!selected.size) { for (const i of idsOk) selected.add(i); refreshPanel(); }
  previsuEchelle();
}
function saisieEchelle(t: string) {
  if (!ech) return;
  const txt = t.trim().replace(',', '.'), v = parseFloat(txt);
  if (!Number.isFinite(v) || v <= 0) return;
  const k = ech.g.axes.length === 1 ? ech.g.axes[0]! : 0, taille = (ech.base.hi[k]! - ech.base.lo[k]!) * 1000;
  // « 1200 mm », « 120 cm », « 1,2 m » : une cote ; un nombre seul : un facteur (au-delà de 10 : une cote en mm)
  const cote = /mm$/.test(txt) ? v : /cm$/.test(txt) ? v * 10 : /m$/.test(txt) ? v * 1000 : v > 10 ? v : null;
  const f = cote !== null ? cote / taille : v;
  ech.s = ech.g.axes.length === 1 ? (k === 0 ? [f, 1, 1] : k === 1 ? [1, f, 1] : [1, 1, f]) : [f, f, f];
  previsuEchelle(); finEchelle();
}
function finEchelle() {
  if (!ech) return;
  const ids = ech.ids;
  doc = shown; ech = null; commit();
  poigneesEch = poigneesEchelle(ids); idsEch = ids; survolEch = -1; dessinerEchelle(ids);
  setHud('Mis à l\'échelle. Cmd+Z pour annuler.');
}

// ───────── Outil Ouvrir : tirer une porte ou un tiroir à la souris ─────────
// Le point tenu (chant libre de la porte, centre de la façade) suit la souris : à chaque mouvement, la fraction
// d'ouverture avance de la composante du déplacement le long de sa trajectoire à l'écran.
let prise: { el: number; x: number; y: number; x0: number; y0: number; bouge: boolean } | null = null;
function elementSous(ev: PointerEvent): Element | undefined {
  const h = pick(ev);
  return h?.solidId != null ? elementDe(doc, h.solidId) : undefined;
}
function prendreOuvrir(ev: PointerEvent) {
  const el = elementSous(ev);
  if (!el) { setHud('Clique une porte ou un tiroir reconnu (sinon : panneau de droite, « Reconnaître » ou « C\'est une porte »)'); return; }
  prise = { el: el.id, x: ev.clientX, y: ev.clientY, x0: ev.clientX, y0: ev.clientY, bouge: false };
  renderer.domElement.style.cursor = 'grabbing';
}
function bougerOuvrir(ev: PointerEvent) {
  if (!prise) {
    const el = elementSous(ev);
    const ids = new Set(el ? piecesDe(el) : []);
    renderer.domElement.style.cursor = el ? 'grab' : 'default';
    if ([...ids].join() !== [...hoverIds].join()) { hoverIds = ids; rebuild(); }
    return;
  }
  const el = (doc.elements ?? []).find((e) => e.id === prise!.el);
  const q = el && pointPrise(doc, el);
  if (!el || !q) return;
  if (Math.hypot(ev.clientX - prise.x0, ev.clientY - prise.y0) > 4) prise.bouge = true;
  const f = ouverts.get(el.id) ?? 0, df = 0.02;
  const en = (g: number) => { const p = poseOuverte(doc, el, g); return versEcran(p ? appliquerPose(p, q) : q); };
  const [ax, ay] = en(f), [bx, by] = en(Math.min(1, f + df) === f ? f - df : Math.min(1, f + df));
  const sens = Math.min(1, f + df) === f ? -1 : 1;
  const vx = (bx - ax) * sens, vy = (by - ay) * sens, v2 = vx * vx + vy * vy;
  if (v2 > 1e-6) {
    const nf = Math.max(0, Math.min(1, f + (df * ((ev.clientX - prise.x) * vx + (ev.clientY - prise.y) * vy)) / v2));
    if (nf > 0) ouverts.set(el.id, nf); else ouverts.delete(el.id);
    rebuild();
    setHud(el.type === 'porte' ? `Porte ouverte à ${Math.round(nf * el.ouverture)}°` : `Tiroir sorti de ${Math.round(nf * course(el))} mm`);
  }
  prise.x = ev.clientX; prise.y = ev.clientY;
}
function lacherOuvrir() {
  if (!prise) return;
  if (!prise.bouge) {
    // simple clic : ouvert en grand, ou fermé
    const f = ouverts.get(prise.el) ?? 0;
    if (f > 0.5) ouverts.delete(prise.el); else ouverts.set(prise.el, 1);
    rebuild();
  }
  prise = null;
  renderer.domElement.style.cursor = 'grab';
  refreshPanel();
}
addEventListener('pointerup', lacherOuvrir);

// ───────── Portes et tiroirs ─────────
// Élément commun à toute la sélection (une porte, ou les pièces d'un même tiroir).
function elementSel(sel: Solid[]): Element | undefined {
  const els = [...new Set(sel.map((x) => elementDe(doc, x.id)))];
  return els.length === 1 ? els[0] : undefined;
}
const options = <T extends string | number>(vals: readonly T[], cur: T, label: (v: T) => string) => vals.map((v) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(label(v))}</option>`).join('');
const libEntraxe = (e: number) => (e ? `Entraxe ${e} mm` : 'Sans poignée');
function sectionElement(sel: Solid[]): string {
  const el = elementSel(sel);
  if (!el) {
    if (sel.some((x) => elementDe(doc, x.id))) return '';
    return `<h3>Fonction</h3><div class="row"><button class="btn" id="e-porte" ${sel.length === 1 ? '' : 'disabled title="Sélectionne une seule pièce"'}>C'est une porte</button><button class="btn" id="e-tiroir" title="Sélectionne la façade (et si besoin le caisson du tiroir)">C'est un tiroir</button></div>`;
  }
  const ouvert = (ouverts.get(el.id) ?? 0) > 0;
  const cotes = ferrures(doc, el).map((f) => `<p>${esc(f.cote)}</p>`).join('');
  const commun = `<div class="row"><button class="btn" id="e-ouvrir">${ouvert ? 'Fermer' : 'Ouvrir'}</button><button class="btn" id="e-sens" title="Si la quincaillerie est dessinée du mauvais côté">Inverser intérieur / extérieur</button><button class="btn" id="e-retirer">Ce n'est plus un${el.type === 'porte' ? 'e porte' : ' tiroir'}</button></div>
    <div class="cotes">${cotes}</div>`;
  if (el.type === 'porte') return `<h3>Porte</h3>
    <label>Charnières <select id="e-ch">${options(['gauche', 'droite', 'haut', 'bas'] as const, el.charnieres, (v) => ({ gauche: 'À gauche', droite: 'À droite', haut: 'En haut (relevable)', bas: 'En bas (abattant)' })[v])}</select></label>
    <label>Pose <select id="e-rec">${options(['applique', 'demi', 'encastree'] as const, el.recouvrement, (v) => RECOUVREMENTS[v])}</select></label>
    <label>Ouverture <select id="e-ouv">${options(OUVERTURES, el.ouverture, (v) => `${v}°`)}</select></label>
    <label title="Vide = selon la hauteur de la porte">Nb charnières <input id="e-nb" type="number" min="1" max="8" value="${el.nbCharnieres ?? ''}" placeholder="auto"></label>
    <label>Poignée <select id="e-ent">${options(ENTRAXES, el.entraxe, libEntraxe)}</select></label>${commun}`;
  return `<h3>Tiroir</h3>
    <label>Coulisses <select id="e-cou">${options(COULISSES, el.coulisse, (v) => `${v} mm`)}</select></label>
    <label title="Totale : le tiroir sort de toute la longueur des coulisses. Partielle : environ les 3/4.">Sortie <select id="e-sortie">${options(['totale', 'partielle'] as const, el.sortie ?? 'totale', (v) => (v === 'totale' ? 'Totale' : 'Partielle (3/4)'))}</select></label>
    <label>Poignée <select id="e-ent">${options(ENTRAXES, el.entraxe, libEntraxe)}</select></label>
    <div class="dims">Façade et ${el.pieces.length} pièce(s) de caisson</div>${commun}`;
}
function majElement(id: number, fn: (e: Element) => void) {
  doc = cloneDoc(doc);
  const e = (doc.elements ?? []).find((x) => x.id === id);
  if (e) { fn(e); commit(); }
}
function lierElement(sel: Solid[]) {
  const val = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value;
  const chg = (id: string, fn: (e: Element, v: string) => void) => { const x = document.getElementById(id); const el = elementSel(sel); if (x && el) x.onchange = () => majElement(el.id, (e) => fn(e, val(id) ?? '')); };
  const clic = (id: string, fn: () => void) => { const x = document.getElementById(id); if (x) x.onclick = fn; };
  const el = elementSel(sel);
  clic('e-porte', () => {
    const p = sel[0]!;
    doc = cloneDoc(doc);
    const id = doc.next++;
    doc.elements = [...(doc.elements ?? []), { id, type: 'porte', piece: p.id, charnieres: /droite/i.test(p.name) ? 'droite' : 'gauche', recouvrement: 'applique', ouverture: 110, entraxe: 128 }];
    commit();
  });
  clic('e-tiroir', () => {
    const f = facadeParmi(doc, sel.map((x) => x.id));
    if (!f) { setHud('Il faut une façade verticale dans la sélection'); return; }
    doc = cloneDoc(doc);
    const pieces = [...new Set([...sel.map((x) => x.id).filter((i) => i !== f.id), ...caissonTiroir(doc, f)])];
    doc.elements = [...(doc.elements ?? []), { id: doc.next++, type: 'tiroir', facade: f.id, pieces, coulisse: coulisseAuto(doc, pieces, f), entraxe: 160 }];
    for (const i of pieces) selected.add(i);
    commit();
  });
  if (!el) return;
  chg('e-ch', (e, v) => { if (e.type === 'porte') e.charnieres = v as typeof e.charnieres; });
  chg('e-rec', (e, v) => { if (e.type === 'porte') e.recouvrement = v as typeof e.recouvrement; });
  chg('e-ouv', (e, v) => { if (e.type === 'porte') e.ouverture = Number(v); });
  chg('e-nb', (e, v) => { if (e.type === 'porte') { const n = Math.round(Number(v)); if (n >= 1 && n <= 8) e.nbCharnieres = n; else delete e.nbCharnieres; } });
  chg('e-ent', (e, v) => { e.entraxe = Number(v); });
  chg('e-cou', (e, v) => { if (e.type === 'tiroir') e.coulisse = Number(v); });
  chg('e-sortie', (e, v) => { if (e.type === 'tiroir') { if (v === 'partielle') e.sortie = 'partielle'; else delete e.sortie; } });
  clic('e-ouvrir', () => { if ((ouverts.get(el.id) ?? 0) > 0) ouverts.delete(el.id); else ouverts.set(el.id, 1); rebuild(); refreshPanel(); });
  clic('e-sens', () => {
    // côté extérieur actuel (détecté ou forcé), puis l'inverse
    const p = doc.solids.find((x) => x.id === (el.type === 'porte' ? el.piece : el.facade));
    if (!p) return;
    const n = repere(doc, p, piecesDe(el), el.sens).n.find((x) => Math.abs(x) > 0.5)!;
    majElement(el.id, (e) => { e.sens = n > 0 ? -1 : 1; });
  });
  clic('e-retirer', () => { doc = cloneDoc(doc); doc.elements = (doc.elements ?? []).filter((x) => x.id !== el.id); ouverts.delete(el.id); commit(); });
}

// Choix du matériau : une pastille de couleur par matériau du projet, un clic l'applique.
function puces(actifs: number[], libre: string): string {
  const ms = doc.methods ?? [];
  return `<div class="mat-titre">Matériau${libre ? ` <span class="note">(matière libre : ${esc(libre)})</span>` : ''}</div><div class="puces">${ms.map((m) => `<button class="puce ${actifs.includes(m.id) ? 'on' : ''}" data-mat="${m.id}" title="${esc(m.nom)}${m.chant ? ` · chant assorti` : ''}"><span class="pastille" style="background:${m.couleur || couleurParNom(m.nom)}"></span>${esc(m.nom)}</button>`).join('')}<button class="puce" id="p-mat-new" title="Ajouter un matériau ou changer une couleur">+ Matériau</button></div>`;
}

// Composant : les copies d'un composant restent liées (forme, nom, matière). « Rendre unique » coupe le lien.
function toggleComponent(list: { id: number }[]) {
  doc = cloneDoc(doc);
  for (const { id } of list) {
    const s = doc.solids.find((x) => x.id === id);
    if (!s) continue;
    if (s.comp) makeUnique(s); else makeComponent(doc, s);
  }
  commit();
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
function commitQuiet() { commit(); }

function refresh() { shown = doc; rebuild(); refreshPanel(); }

// ───────── Fiche de débit ─────────
const debitEl = document.getElementById('debit')!;
let rowId = 1;
const num = (v: string) => { const n = parseFloat(v.replace(',', '.')); return Number.isNaN(n) ? 0 : n; };

function renderDebit() {
  const t = totals(debit);
  debitEl.innerHTML = `<div class="sheet">
    <header>
      <h2>Fiche de débit</h2>
      <button class="btn" id="d-import" title="Recalcule les lignes depuis le modèle ; les lignes modifiées ou manuelles sont conservées">Resynchroniser</button>
      <button class="btn" id="d-add">+ Ligne</button>
      <button class="btn" id="d-csv">Export CSV</button>
      <button class="btn" id="d-print">Imprimer</button>
      <button class="btn primary" id="d-close">Fermer</button>
    </header>
    <div class="scroll"><table>
      <thead><tr><th>Réf</th><th>Désignation</th><th>Qté</th><th>Long. mm</th><th>Larg. mm</th><th>Ép. mm</th><th>Matière</th><th>Fil</th><th>Chants</th><th>Note</th><th></th><th class="col-act"></th></tr></thead>
      <tbody>${debit.map((r) => `<tr data-id="${r.id}">
        <td><input data-k="ref" value="${esc(r.ref)}" size="4"></td>
        <td><input data-k="nom" value="${esc(r.nom)}"></td>
        <td><input class="num" data-k="qte" value="${r.qte}"></td>
        <td><input class="num" data-k="L" value="${r.L}"></td>
        <td><input class="num" data-k="l" value="${r.l}"></td>
        <td><input class="num" data-k="e" value="${r.e}"></td>
        <td><span class="matiere-cell">${r.couleur ? `<span class="pastille" style="background:${r.couleur}" title="Couleur du matériau"></span>` : ''}<input data-k="matiere" value="${esc(r.matiere)}"></span></td>
        <td><select data-k="fil">${(['aucun', 'L', 'l'] as const).map((f) => `<option ${f === r.fil ? 'selected' : ''}>${f}</option>`).join('')}</select></td>
        <td><input data-k="chants" value="${esc(r.chants)}" size="8" placeholder="L1 L2 l1"></td>
        <td><input data-k="note" value="${esc(r.note)}"></td>
        <td class="src">${r.src}${r.edited ? " (modifiée)" : ""}</td>
        <td class="col-act"><button class="btn" data-del="${r.id}" title="Supprimer la ligne">×</button></td></tr>`).join('')}</tbody>
    </table></div>
    <footer><span>${t.pieces} pièce(s)</span><span>${t.surface.toFixed(3)} m²</span><span>${t.volume.toFixed(4)} m³</span><span>${t.chant.toFixed(2)} m de chant</span><span class="note">La fiche se met à jour depuis le modèle à chaque ouverture. Une ligne que tu modifies est conservée telle quelle ; « × » la supprime (elle revient à la prochaine ouverture si la pièce existe toujours).</span></footer>
  </div>`;
  const d = (id: string) => document.getElementById(id)!;
  d('d-close').onclick = closeDebit;
  d('d-add').onclick = () => { debit.push({ id: rowId++, src: 'manuel', ref: '', nom: '', qte: 1, L: 0, l: 0, e: 18, matiere: '', fil: 'aucun', chants: '', note: '' }); commit(); renderDebit(); };
  d('d-import').onclick = () => { syncDebit(); commit(); renderDebit(); };
  d('d-csv').onclick = () => telecharger(toCsv(debit), 'fiche-de-debit.csv', 'csv');
  d('d-print').onclick = () => window.print();
  debitEl.querySelectorAll<HTMLElement>('[data-k]').forEach((el) => {
    el.onchange = () => {
      const tr = el.closest('tr')!;
      const row = debit.find((r) => r.id === Number(tr.dataset.id))!;
      const k = el.dataset.k as keyof DebitRow;
      const v = (el as HTMLInputElement).value;
      if (k === 'qte' || k === 'L' || k === 'l' || k === 'e') (row[k] as number) = num(v);
      else (row[k] as string) = v;
      if (row.src === 'modèle') row.edited = true;
      commit(); renderDebit();
    };
  });
  debitEl.querySelectorAll<HTMLElement>('[data-del]').forEach((el) => {
    el.onclick = () => { debit = debit.filter((r) => r.id !== Number(el.dataset.del)); commit(); renderDebit(); };
  });
}
function syncDebit() {
  debit = syncFromModel(doc, debit, rowId);
  rowId = Math.max(rowId, ...debit.map((r) => r.id)) + 1;
}
function openDebit() {
  const before = JSON.stringify(debit);
  syncDebit();
  if (JSON.stringify(debit) !== before) commit();
  renderDebit(); debitEl.classList.add('open'); }
function closeDebit() { debitEl.classList.remove('open'); }

// ───────── Méthodes de fabrication ─────────
const fenetreMateriaux: FenetreMateriaux = { get el() { return debitEl; }, doc: () => doc, appliquer(d) { doc = d; commit(); }, fermer: closeDebit };
const renderMethods = () => renderMaterieux(fenetreMateriaux);
function openMethods() { renderMethods(); debitEl.classList.add('open'); }
debitEl.addEventListener('pointerdown', (e) => { if (e.target === debitEl) closeDebit(); });

// ───────── Découpe et coût ─────────
const euro = (n: number) => `${n.toFixed(2)} €`;
// Plan d'un panneau : chaque pièce porte son nom de la fiche de débit et ses cotes ; une légende reprend tout.
function planSvg(b: Bin): string {
  const { L, l } = b.panneau, fs = Math.max(L, l) / 55;
  const dims = (q: Bin['places'][number]) => `${Math.round(q.rot ? q.h : q.w)} × ${Math.round(q.rot ? q.w : q.h)}`;
  const svg = `<svg viewBox="0 0 ${L} ${l}" class="plan" role="img" aria-label="Plan de coupe"><rect width="${L}" height="${l}" class="pan"/>${b.places.map((q, i) => {
    const f = Math.min(fs, q.h / 3.2, q.w / 9);
    const cx = q.x + q.w / 2, cy = q.y + q.h / 2;
    return `<rect x="${q.x}" y="${q.y}" width="${q.w}" height="${q.h}" class="pc"><title>${esc(q.nom)} ${dims(q)}</title></rect>`
      + `<text x="${cx}" y="${cy - f * 0.6}" font-size="${f}" text-anchor="middle" dominant-baseline="middle" font-weight="600">${i + 1}. ${esc(q.nom)}</text>`
      + `<text x="${cx}" y="${cy + f * 0.7}" font-size="${f * 0.9}" text-anchor="middle" dominant-baseline="middle">${dims(q)}${q.rot ? ' ↻' : ''}</text>`;
  }).join('')}</svg>`;
  const legende = `<table class="legende"><tbody>${b.places.map((q, i) => `<tr><td>${i + 1}</td><td>${esc(q.nom)}</td><td>${dims(q)} mm</td><td>${q.rot ? 'tournée' : ''}</td></tr>`).join('')}</tbody></table>`;
  return svg + legende;
}
function renderDecoupe() {
  const stock = doc.stock ?? [], extras = doc.extras ?? [], regl = doc.reglages ?? REGLAGES_DEFAUT;
  const res = planDecoupe(debit, stock, regl);
  const cChant = coutChant(doc), cExtras = extras.reduce((t, x) => t + x.qte * x.prix, 0);
  const mats = [...new Set(debit.map((r) => r.matiere).filter(Boolean))];
  const cell = (t: string, id: number, k: string, v: string | number, cls = '') => `<td><input ${cls ? `class="${cls}"` : ''} data-t="${t}" data-id="${id}" data-k="${k}" value="${esc(String(v))}" ${k === 'matiere' ? 'list="mats"' : ''}></td>`;
  debitEl.innerHTML = `<div class="sheet">
    <header><h2>Découpe et coût</h2><button class="btn" id="c-print">Imprimer</button><button class="btn primary" id="c-close">Fermer</button></header>
    <div class="scroll multi">
      <datalist id="mats">${mats.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
      <div class="cout"><span>Panneaux à acheter <b>${euro(res.cout)}</b></span><span>Chant <b>${euro(cChant)}</b></span><span>Quincaillerie et divers <b>${euro(cExtras)}</b></span><span>Total <b>${euro(res.cout + cChant + cExtras)}</b></span></div>
      <h3>Panneaux en stock et à l'achat</h3>
      <table><thead><tr><th>Matière</th><th>Ép. mm</th><th>Long. mm</th><th>Larg. mm</th><th>En stock</th><th>Prix d'achat €</th><th></th></tr></thead>
      <tbody>${stock.map((p) => `<tr>${cell('stock', p.id, 'matiere', p.matiere)}${cell('stock', p.id, 'e', p.e, 'num')}${cell('stock', p.id, 'L', p.L, 'num')}${cell('stock', p.id, 'l', p.l, 'num')}${cell('stock', p.id, 'qte', p.qte, 'num')}${cell('stock', p.id, 'prix', p.prix, 'num')}<td>${p.chute ? '<span class="src">chute</span> ' : ''}<button class="btn" data-del="stock" data-id="${p.id}" title="Supprimer">×</button></td></tr>`).join('')}</tbody></table>
      <p><button class="btn" id="c-addpan">+ Panneau</button> <span class="note" style="opacity:.6">La matière doit être la même que celle des pièces. « En stock » compte tes panneaux et tes chutes, utilisés en premier. Prix à 0 : on n'en rachète pas.</span></p>
      <p><label>Trait de scie mm <input class="num" style="width:70px" data-t="regl" data-id="0" data-k="trait" value="${regl.trait}"></label> &nbsp; <label>Marge de délignage mm <input class="num" style="width:70px" data-t="regl" data-id="0" data-k="marge" value="${regl.marge}"></label> &nbsp; <label title="Une pièce plus grande que tous les panneaux est proposée en plusieurs morceaux à assembler"><input type="checkbox" style="width:auto" id="c-decouper" ${regl.decouper !== false ? 'checked' : ''}> Couper les pièces trop grandes</label></p>
      <h3>Quincaillerie et divers</h3>
      <table><thead><tr><th>Désignation</th><th>Qté</th><th>Prix unitaire €</th><th></th></tr></thead>
      <tbody>${extras.map((x) => `<tr>${cell('extras', x.id, 'nom', x.nom)}${cell('extras', x.id, 'qte', x.qte, 'num')}${cell('extras', x.id, 'prix', x.prix, 'num')}<td><button class="btn" data-del="extras" data-id="${x.id}" title="Supprimer">×</button></td></tr>`).join('')}</tbody></table>
      <p><button class="btn" id="c-addextra">+ Ligne</button></p>
      <h3>Plans de coupe</h3>
      ${res.groupes.length ? '' : '<p>Aucune pièce dans la fiche de débit.</p>'}
      ${res.groupes.map((g, gi) => {
        const nom = `${esc(g.matiere || '(sans matière)')} ${g.e} mm`;
        if (g.sansPanneau) return `<h3>${nom}, ${g.nbPieces} pièce(s)</h3><p class="warn">Aucun panneau de cette matière et de cette épaisseur. <button class="btn" data-addfor="${gi}">Ajouter ce panneau</button></p>`;
        const achats = g.plan.bins.filter((b) => b.achat).length;
        return `<h3>${nom}, ${g.nbPieces} pièce(s) : ${g.plan.bins.length} panneau(x), dont ${g.plan.bins.length - achats} du stock et ${achats} à acheter (${g.manques.length ? `${euro(g.plan.cout)} + prix à indiquer` : euro(g.plan.cout)}), chute ${(g.plan.chute * 100).toFixed(0)} %</h3>
          ${g.decoupes.map((d) => `<p class="propose">Proposition : <b>${esc(d.nom)}</b> (${d.L} × ${d.l} mm${d.qte > 1 ? `, ×${d.qte}` : ''}) ne rentre dans aucun panneau. Elle est coupée en <b>${d.n} morceaux de ${Math.round(d.partL)} × ${Math.round(d.partl)} mm</b>, à assembler ensuite (tourillons, lamelles ou fausse languette). Pour l'éviter, ajoute un panneau plus grand ou décoche « Couper les pièces trop grandes ».</p>`).join('')}
          ${g.manques.map((m) => `<p class="propose">Proposition : ton stock ne suffit pas. Il faut acheter <b>${m.n} panneau(x) de ${m.L} × ${m.l} mm</b> en plus. Indique son prix d'achat pour qu'il entre dans le coût.</p>`).join('')}
          ${g.plan.restants.length ? `<p class="warn">${g.plan.restants.length} pièce(s) non placée(s) : ${esc([...new Set(g.plan.restants.map((r) => `${r.nom} ${r.L}×${r.l}`))].join(', '))}. Ajoute un panneau assez grand pour elles.</p>` : ''}
          ${g.plan.bins.map((b, i) => `<div class="pantitre">Panneau ${i + 1} : ${b.panneau.L} × ${b.panneau.l}${b.panneau.chute ? ' (chute)' : ''}, ${b.achat ? (b.panneau.prix > 0 ? 'à acheter' : 'à acheter, prix à indiquer') : 'du stock'}</div>${planSvg(b)}`).join('')}
          <p><button class="btn" data-fait="${gi}">Découpe faite : mettre à jour le stock</button> <span class="note" style="opacity:.6">Retire du stock les panneaux utilisés et y ajoute ${chutesDe(g.plan).length} chute(s) réutilisable(s). Annulable avec Cmd+Z.</span></p>`;
      }).join('')}
    </div>
    <footer><span class="note">Découpe en coupes droites de bord à bord, fil respecté (le fil d'un panneau suit sa longueur). C'est un calcul approché : bon, pas garanti optimal. Les cotes viennent de la fiche de débit.</span></footer>
  </div>`;
  const edit = (fn: () => void) => { doc = cloneDoc(doc); doc.stock ??= []; doc.extras ??= []; doc.reglages ??= { ...REGLAGES_DEFAUT }; fn(); commit(); renderDecoupe(); };
  const addPan = (matiere: string, e: number) => edit(() => { doc.stock!.push({ id: doc.next++, matiere, e, L: 2800, l: 2070, qte: 0, prix: 0 }); });
  document.getElementById('c-close')!.onclick = closeDebit;
  document.getElementById('c-print')!.onclick = () => window.print();
  document.getElementById('c-addpan')!.onclick = () => { const g = res.groupes.find((x) => x.sansPanneau); addPan(g?.matiere ?? '', g?.e ?? 18); };
  document.getElementById('c-addextra')!.onclick = () => edit(() => { doc.extras!.push({ id: doc.next++, nom: '', qte: 1, prix: 0 }); });
  (document.getElementById('c-decouper') as HTMLInputElement).onchange = (e) => edit(() => { doc.reglages!.decouper = (e.target as HTMLInputElement).checked; });
  debitEl.querySelectorAll<HTMLElement>('[data-fait]').forEach((el) => {
    el.onclick = () => {
      const g = res.groupes[Number(el.dataset.fait)]!;
      edit(() => { doc.stock = appliquerDecoupe(doc.stock!, g.plan, g.matiere, g.e, () => doc.next++); });
    };
  });
  debitEl.querySelectorAll<HTMLElement>('[data-addfor]').forEach((el) => { el.onclick = () => { const g = res.groupes[Number(el.dataset.addfor)]!; addPan(g.matiere, g.e); }; });
  debitEl.querySelectorAll<HTMLInputElement>('input[data-t]').forEach((el) => {
    el.onchange = () => edit(() => {
      const { t, k } = el.dataset, id = Number(el.dataset.id);
      const v = Math.max(0, num(el.value));
      if (t === 'regl') { if (k === 'trait') doc.reglages!.trait = v; else doc.reglages!.marge = v; return; }
      if (t === 'stock') {
        const r = doc.stock!.find((x) => x.id === id); if (!r) return;
        if (k === 'matiere') r.matiere = el.value; else if (k === 'e') r.e = v; else if (k === 'L') r.L = v; else if (k === 'l') r.l = v; else if (k === 'qte') r.qte = Math.floor(v); else r.prix = v;
      } else {
        const r = doc.extras!.find((x) => x.id === id); if (!r) return;
        if (k === 'nom') r.nom = el.value; else if (k === 'qte') r.qte = v; else r.prix = v;
      }
    });
  });
  debitEl.querySelectorAll<HTMLElement>('button[data-del]').forEach((el) => {
    el.onclick = () => edit(() => {
      const id = Number(el.dataset.id);
      if (el.dataset.del === 'stock') doc.stock = doc.stock!.filter((x) => x.id !== id); else doc.extras = doc.extras!.filter((x) => x.id !== id);
    });
  });
}
function openDecoupe() {
  const before = JSON.stringify(debit);
  syncDebit();
  if (JSON.stringify(debit) !== before) commit();
  renderDecoupe(); debitEl.classList.add('open');
}

// ───────── Caisson ou dressing ─────────
let caissonP: CaissonParams = { ...CAISSON_DEFAUT, types: [...CAISSON_DEFAUT.types] };
let caissonMat = 'Mélaminé blanc 18';
let caissonFondMat = 'HDF 3';
let caissonFondTiroirMat = '';   // vide : comme le fond
let caissonEdit: number | null = null;
// Matériau d'un nom : celui du projet, sinon un matériau courant (panneau et couleur du préréglage), sinon créé d'après le nom.
function methodeNommee(nom: string, d: Doc = doc): number {
  const p = PRESETS_MAT.find((x) => x.nom.toLowerCase() === nom.trim().toLowerCase());
  if (p && !(d.methods ?? []).some((m) => m.nom.toLowerCase() === p.nom.toLowerCase())) {
    (d.methods ??= []).push({ id: d.next++, nom: p.nom, matiere: p.matiere, chant: p.chant ? 'ABS 1 mm' : '', chantEp: p.chant ? 1 : 0, cotes: p.chant ? 'L1' : '', deduire: false, couleur: p.couleur });
  }
  return materiauNomme(d, nom);
}
const CAISSON_CHAMPS: [keyof CaissonParams, string, string][] = [
  ['L', 'Largeur', 'mm'], ['H', 'Hauteur', 'mm'], ['P', 'Profondeur', 'mm'], ['e', 'Épaisseur des panneaux', 'mm'],
  ['colonnes', 'Colonnes', ''], ['etageres', 'Étagères par colonne', ''], ['tiroirs', 'Tiroirs par colonne « tiroirs »', ''],
  ['hTiroir', 'Hauteur d\'une façade de tiroir', 'mm'], ['jeu', 'Jeu autour des façades', 'mm'],
  ['fond', 'Fond en applique, épaisseur (0 = sans)', 'mm'], ['plinthe', 'Plinthe, hauteur (0 = sans)', 'mm'], ['retrait', 'Retrait des étagères', 'mm'],
];
const TYPES_COL: [TypeColonne, string][] = [['etageres', 'Étagères'], ['penderie', 'Penderie'], ['tiroirs', 'Tiroirs'], ['penderie_tiroirs', 'Penderie sur tiroirs']];
function renderCaisson() {
  const n = Math.max(1, Math.min(12, Math.round(caissonP.colonnes)));
  caissonP.types = Array.from({ length: n }, (_, i) => caissonP.types[i] ?? 'etageres');
  const err = verifier(caissonP);
  const c = err ? null : genererCaisson(caissonP);
  debitEl.innerHTML = `<div class="sheet" style="width:min(560px,100%)">
    <header><h2>${caissonEdit ? 'Modifier le meuble' : 'Nouveau meuble'}</h2></header>
    <div class="scroll">
      ${caissonEdit ? '' : `<p>Pars d'un modèle, puis ajuste les cotes :</p><div class="row">${MODELES.map(({ nom: n }, i) => `<button class="btn" data-modele="${i}">${n}</button>`).join('')}</div>`}
      <div class="form">
      ${CAISSON_CHAMPS.map(([k, label, u]) => `<label for="k-${k}">${label}${u ? ` (${u})` : ''}</label><input class="num" id="k-${k}" data-c="${k}" value="${caissonP[k]}">`).join('')}
      ${(() => { const v = videsColonnes(caissonP); return caissonP.types.map((t, i) => `<label for="k-t${i}">Colonne ${i + 1}</label><span class="row" style="flex-wrap:nowrap"><select id="k-t${i}" data-col="${i}" style="flex:1">${TYPES_COL.map(([val, l]) => `<option value="${val}" ${val === t ? 'selected' : ''}>${l}</option>`).join('')}</select>${v.length > 1 ? `<input class="num" style="width:70px" data-larg="${i}" value="${Math.round(v[i]!)}" title="Largeur intérieure en mm ; la colonne voisine compense">` : ''}</span>`).join(''); })()}
      <label for="k-portes">Portes en applique</label><input type="checkbox" id="k-portes" style="width:auto;justify-self:start" ${caissonP.portes ? 'checked' : ''}>
      ${caissonP.colonnes > 1 ? `<label for="k-pleins" title="Les montants vont du sol au dessus ; dessus, dessous et plinthe sont coupés par colonne. Utile quand le meuble est plus long qu'un panneau.">Montants pleine hauteur</label><input type="checkbox" id="k-pleins" style="width:auto;justify-self:start" ${caissonP.montantsPleins ? 'checked' : ''}>` : ''}
      <label for="k-mat">Matière des panneaux</label><input id="k-mat" list="k-mats" value="${esc(caissonMat)}">
      ${pucesForm('k-mat', caissonMat)}
      <label for="k-fondmat">Matière du fond</label><input id="k-fondmat" list="k-mats" value="${esc(caissonFondMat)}">
      ${pucesForm('k-fondmat', caissonFondMat)}
      ${caissonP.types.some((t) => t === 'tiroirs' || t === 'penderie_tiroirs') ? `<label for="k-fondtir" title="Vide : la même que le fond">Fonds de tiroir</label><input id="k-fondtir" list="k-mats" value="${esc(caissonFondTiroirMat)}" placeholder="comme le fond">${pucesForm('k-fondtir', caissonFondTiroirMat)}` : ''}
      <datalist id="k-mats">${(doc.methods ?? []).map((m) => `<option value="${esc(m.nom)}">`).join('')}<option value="Mélaminé blanc 18"><option value="Contreplaqué 18"><option value="HDF 3"></datalist>
    </div>
    <p class="${err ? 'warn' : ''}">${err ?? `${c!.panneaux.filter((p) => p.piece).length} panneaux${(() => { const np = c!.panneaux.filter((p) => p.role?.type === 'porte').length, nt = new Set(c!.panneaux.flatMap((p) => (p.role?.type === 'tiroir' ? [p.role.cle] : []))).size; return np + nt ? `, ${np} porte(s) et ${nt} tiroir(s) (charnières, coulisses et poignées calculées)` : ''; })()}${c!.quincaillerie.length ? `, et ${esc(c!.quincaillerie.map((x) => `${x.qte} ${x.nom}`).join(', '))}` : ''}. Toute la quincaillerie va dans « Découpe et coût », sans prix : indique-les là-bas.`}</p>
    ${caissonEdit ? '<p class="warn">Le caisson est recréé : les retouches faites à la main sur ses pièces sont perdues.</p>' : ''}</div>
    <footer style="justify-content:flex-end"><button class="btn" id="k-cancel">Annuler</button><button class="btn primary" id="k-ok" ${err ? 'disabled' : ''}>${caissonEdit ? 'Appliquer' : 'Créer'}</button></footer>
  </div>`;
  debitEl.querySelectorAll<HTMLInputElement>('input[data-c]').forEach((el) => {
    el.onchange = () => {
      const k = el.dataset.c as keyof CaissonParams;
      caissonP = { ...caissonP, [k]: Math.max(0, num(el.value)) };
      if (k === 'colonnes') delete caissonP.largeurs;   // nouvelles colonnes : à parts égales
      renderCaisson();
    };
  });
  debitEl.querySelectorAll<HTMLInputElement>('input[data-larg]').forEach((el) => {
    el.onchange = () => { caissonP = fixerLargeur(caissonP, Number(el.dataset.larg), Math.max(0, num(el.value))); renderCaisson(); };
  });
  debitEl.querySelectorAll<HTMLSelectElement>('select[data-col]').forEach((el) => {
    el.onchange = () => { caissonP.types[Number(el.dataset.col)] = el.value as TypeColonne; renderCaisson(); };
  });
  (document.getElementById('k-portes') as HTMLInputElement).onchange = (e) => { caissonP.portes = (e.target as HTMLInputElement).checked; renderCaisson(); };
  const pleins = document.getElementById('k-pleins') as HTMLInputElement | null;
  if (pleins) pleins.onchange = () => { if (pleins.checked) caissonP.montantsPleins = true; else delete caissonP.montantsPleins; renderCaisson(); };
  (document.getElementById('k-mat') as HTMLInputElement).onchange = (e) => { caissonMat = (e.target as HTMLInputElement).value; };
  (document.getElementById('k-fondmat') as HTMLInputElement).onchange = (e) => { caissonFondMat = (e.target as HTMLInputElement).value; };
  const ft = document.getElementById('k-fondtir') as HTMLInputElement | null;
  if (ft) ft.onchange = () => { caissonFondTiroirMat = ft.value; };
  debitEl.querySelectorAll<HTMLButtonElement>('[data-modele]').forEach((b) => {
    b.onclick = () => { const m = MODELES[Number(b.dataset.modele)]!.params; caissonP = { ...CAISSON_DEFAUT, ...m, types: [...(m.types ?? CAISSON_DEFAUT.types)] }; renderCaisson(); };
  });
  debitEl.querySelectorAll<HTMLButtonElement>('[data-kmat]').forEach((b) => {
    b.onclick = () => { if (b.dataset.kmat === 'k-mat') caissonMat = b.dataset.nom!; else if (b.dataset.kmat === 'k-fondtir') caissonFondTiroirMat = b.dataset.nom!; else caissonFondMat = b.dataset.nom!; renderCaisson(); };
  });
  document.getElementById('k-cancel')!.onclick = closeDebit;
  document.getElementById('k-ok')!.onclick = creerCaisson;
}
const minLocal = (c: ReturnType<typeof genererCaisson>): V3 =>
  [0, 1, 2].map((k) => Math.min(...c.panneaux.map((p) => p.min[k]!))) as V3;
const maxLocal = (c: ReturnType<typeof genererCaisson>): V3 =>
  [0, 1, 2].map((k) => Math.max(...c.panneaux.map((p) => p.max[k]!))) as V3;
// Position actuelle du repère du meuble (il a pu être déplacé depuis sa création).
function origineCaisson(d: Doc, rec: CaissonRec): V3 | null {
  const anciens = d.solids.filter((x) => x.meta.caisson === rec.id);
  return anciens.length ? sub(bboxOf(anciens)!.min, minLocal(genererCaisson(rec.params))) : null;
}
// Remplace les pièces et la quincaillerie d'un meuble par celles de ses paramètres actuels.
function ecrireCaisson(d: Doc, rec: CaissonRec, origine: V3): number[] {
  const c = genererCaisson(rec.params);
  d.solids = d.solids.filter((x) => x.meta.caisson !== rec.id);
  const ids: number[] = [], roles: { id: number; role: NonNullable<typeof c.panneaux[number]['role']> }[] = [];
  for (const p of c.panneaux) {
    const sid = d.next++;
    // panneaux minces : fond du meuble, ou fonds de tiroir s'ils ont leur propre matière ; un matériau du projet comme les autres
    const mince = (p.nom === 'Fond tiroir' && rec.fondTiroir ? rec.fondTiroir : rec.fond ?? '').trim();
    const mid = p.corps ? rec.methode : p.piece && mince ? methodeNommee(mince, d) : 0;
    const meta = { piece: p.piece, matiere: p.corps ? '' : mince, fil: 'aucun' as const, note: '', caisson: rec.id, ...(mid ? { methode: mid } : {}) };
    d.solids.push({ id: sid, name: p.nom, mesh: boxMesh(add(p.min, origine), add(p.max, origine)), meta });
    ids.push(sid);
    if (p.role) roles.push({ id: sid, role: p.role });
  }
  // portes et tiroirs du meuble : recréés avec les nouvelles pièces, en gardant les réglages de même clé
  const anciens = d.elements ?? [];
  d.elements = [...anciens.filter((e) => e.caisson !== rec.id), ...elementsDuCaisson(d, rec.id, roles, anciens)];
  // quincaillerie remplacée, en gardant les prix déjà saisis pour un même article
  d.extras ??= [];
  const prix = new Map(d.extras.filter((x) => x.prix > 0).map((x) => [x.nom, x.prix]));
  d.extras = d.extras.filter((x) => x.caisson !== rec.id);
  for (const x of c.quincaillerie) d.extras.push({ id: d.next++, nom: x.nom, qte: x.qte, prix: prix.get(x.nom) ?? 0, caisson: rec.id });
  return ids;
}
// Nouvelle version d'un meuble avec d'autres paramètres : le côté gauche, le dessous et l'arrière restent en place.
function caissonModifie(base: Doc, id: number, params: CaissonParams): { doc: Doc; ids: number[] } | null {
  if (verifier(params)) return null;
  const d = cloneDoc(base);
  const rec = (d.caissons ?? []).find((x) => x.id === id);
  if (!rec) return null;
  const o = origineCaisson(d, rec);
  if (!o) return null;
  const arriere = o[1] + maxLocal(genererCaisson(rec.params))[1];
  rec.params = JSON.parse(JSON.stringify(params)) as CaissonParams;
  const origine: V3 = [o[0], arriere - maxLocal(genererCaisson(params))[1], o[2]];
  return { doc: d, ids: ecrireCaisson(d, rec, origine) };
}
function creerCaisson() {
  try { genererCaisson(caissonP); } catch (e) { fileError(e); return; }
  doc = cloneDoc(doc);
  doc.caissons ??= [];
  const methode = methodeNommee(caissonMat);
  const old = caissonEdit ? doc.caissons.find((x) => x.id === caissonEdit) : undefined;
  let rec: CaissonRec, origine: V3 | null = null;
  if (old) {
    origine = origineCaisson(doc, old);   // reste à sa place, même déplacé depuis
    rec = old;
  } else {
    rec = { id: doc.next++, params: caissonP, methode, fond: caissonFondMat };
    doc.caissons.push(rec);
  }
  if (!origine) { const bb = bboxOf(doc.solids.filter((x) => x.meta.caisson !== rec.id)); origine = [bb ? bb.max[0] + 0.3 : 0, 0, 0]; }
  rec.params = JSON.parse(JSON.stringify(caissonP)) as CaissonParams; rec.methode = methode; rec.fond = caissonFondMat;
  if (caissonFondTiroirMat.trim()) rec.fondTiroir = caissonFondTiroirMat.trim(); else delete rec.fondTiroir;
  const ids = ecrireCaisson(doc, rec, origine);
  selected.clear(); for (const i of ids) selected.add(i);
  caissonEdit = null;
  closeDebit(); commit(); setTool('select'); vue('iso'); fitAll();
}
// Pastilles de couleur sous un champ de matière du formulaire : matériaux du projet, puis matériaux courants.
function pucesForm(champ: string, actuel: string): string {
  const vus = new Set<string>(), l: { nom: string; couleur: string }[] = [];
  for (const m of [...(doc.methods ?? []).map((x) => ({ nom: x.nom, couleur: x.couleur || couleurParNom(x.nom) })), ...PRESETS_MAT])
    if (!vus.has(m.nom.toLowerCase())) { vus.add(m.nom.toLowerCase()); l.push(m); }
  return `<div class="puces" style="grid-column:1/-1">${l.map((m) => `<button class="puce ${m.nom.toLowerCase() === actuel.trim().toLowerCase() ? 'on' : ''}" data-kmat="${champ}" data-nom="${esc(m.nom)}"><span class="pastille" style="background:${m.couleur}"></span>${esc(m.nom)}</button>`).join('')}</div>`;
}
function openCaisson(id: number | null) {
  const rec = id ? (doc.caissons ?? []).find((x) => x.id === id) : undefined;
  caissonEdit = rec ? rec.id : null;
  if (rec) {
    caissonP = JSON.parse(JSON.stringify(rec.params)) as CaissonParams;
    caissonMat = (doc.methods ?? []).find((m) => m.id === rec.methode)?.nom ?? '';
    caissonFondMat = rec.fond ?? caissonFondMat;
    caissonFondTiroirMat = rec.fondTiroir ?? '';
  }
  renderCaisson(); debitEl.classList.add('open');
}

// ───────── Guide des premiers pas ─────────
// Chaque étape se coche toute seule quand elle est faite.
let faits: Record<string, boolean> = {};
try { faits = JSON.parse(localStorage.getItem('workshop3d.guide') ?? '{}') as Record<string, boolean>; } catch { /* ignoré */ }
function marquer(k: string) {
  if (faits[k]) return;
  faits[k] = true;
  try { localStorage.setItem('workshop3d.guide', JSON.stringify(faits)); } catch { /* ignoré */ }
}
function openGuide() {
  const etapes: { titre: string; texte: string; fait: boolean; action?: [string, () => void] }[] = [
    { titre: 'Crée ton meuble', texte: 'Choisis un modèle (bibliothèque, dressing, commode…), puis règle largeur, hauteur, profondeur, colonnes, tiroirs et portes.', fait: !!doc.caissons?.length, action: ['Nouveau meuble', () => openCaisson(null)] },
    { titre: 'Regarde-le sous tous les angles', texte: 'Molette enfoncée et glisser : tourner. Maj + molette : décaler. Molette : zoomer. Touches 1, 2, 3 et 0 : face, dessus, côté, 3D. Touche K : les cotes.', fait: !!faits.cotes, action: ['Afficher les cotes', () => { cotesOn = true; marquer('cotes'); vue('iso'); fitAll(); drawCotes(); refreshPanel(); closeDebit(); }] },
    { titre: 'Ajuste une pièce', texte: 'Clique une pièce : à droite, change sa matière, ses chants (bords plaqués) ou le sens du fil. « Modifier le meuble » change ses cotes.', fait: !!faits.selection },
    { titre: 'Lis la fiche de débit', texte: 'La liste des pièces à couper, avec leurs cotes, quantités et chants. Elle se met à jour toute seule.', fait: debit.length > 0, action: ['Fiche de débit', () => openDebit()] },
    { titre: 'Optimise la découpe et chiffre', texte: 'Indique tes panneaux : format, prix d\'achat, ou combien tu en as déjà. L\'app place les pièces au mieux et calcule le coût, quincaillerie comprise.', fait: (doc.stock ?? []).some((p) => p.prix > 0 || p.qte > 0), action: ['Découpe et coût', () => openDecoupe()] },
    { titre: 'Enregistre ton projet', texte: 'Cmd+S crée un fichier .workshop que tu pourras rouvrir. Les plans et la fiche s\'impriment depuis leurs fenêtres.', fait: !!filePath, action: ['Enregistrer', () => { closeDebit(); void fileSave(); }] },
  ];
  const n = etapes.filter((e) => e.fait).length;
  debitEl.innerHTML = `<div class="sheet" style="width:min(640px,100%)">
    <header><h2>Premiers pas (${n}/${etapes.length})</h2><button class="btn primary" id="g-close">Fermer</button></header>
    <div class="scroll"><ol class="guide">${etapes.map((e, i) => `<li class="${e.fait ? 'fait' : ''}"><div><b>${e.fait ? '✓ ' : ''}${e.titre}</b><p>${e.texte}</p></div>${e.action ? `<button class="btn ${e.fait ? '' : 'primary'}" data-g="${i}">${e.action[0]}</button>` : ''}</li>`).join('')}</ol>
    <p class="note">Pour dessiner librement (lignes, rectangles, pousser/tirer comme dans SketchUp), active le « Mode expert » en bas de la barre d'outils. Ce guide revient avec la touche ? ou le bouton Guide.</p></div>
  </div>`;
  document.getElementById('g-close')!.onclick = closeDebit;
  debitEl.querySelectorAll<HTMLButtonElement>('[data-g]').forEach((b) => { b.onclick = () => etapes[Number(b.dataset.g)]!.action![1](); });
  debitEl.classList.add('open');
}

// ───────── Interface ─────────
const TOOLS: { id: Tool; icon: string; label: string; key: string }[] = [
  { id: 'select', icon: '↖', label: 'Sélection', key: 'Espace' },
  { id: 'adjust', icon: '⇔', label: 'Ajuster', key: 'A' },
  { id: 'scale', icon: '⤢', label: 'Échelle', key: 'S' },
  { id: 'open', icon: '☝', label: 'Ouvrir', key: 'I' },
  { id: 'line', icon: '╱', label: 'Ligne', key: 'L' },
  { id: 'rect', icon: '▭', label: 'Rectangle', key: 'R' },
  { id: 'circle', icon: '◯', label: 'Cercle', key: 'C' },
  { id: 'pushpull', icon: '⬍', label: 'Pousser/Tirer', key: 'P' },
  { id: 'move', icon: '✥', label: 'Déplacer', key: 'M' },
  { id: 'rotate', icon: '↻', label: 'Rotation', key: 'Q' },
  { id: 'tape', icon: '⟷', label: 'Mètre', key: 'T' },
  { id: 'erase', icon: '⌫', label: 'Gomme', key: 'E' },
  { id: 'orbit', icon: '⟳', label: 'Orbite', key: 'O' },
  { id: 'pan', icon: '✋', label: 'Panoramique', key: 'H' },
];
const SIMPLES: Tool[] = ['select', 'adjust', 'scale', 'open', 'move', 'rotate', 'tape', 'orbit', 'pan'];
let expert = false;
try { expert = localStorage.getItem('workshop3d.expert') === '1'; } catch { /* ignoré */ }
const tb = document.getElementById('toolbar')!;
function buildToolbar() {
  tb.innerHTML = '';
  for (const t of TOOLS) {
    if (!expert && !SIMPLES.includes(t.id)) continue;
    const b = document.createElement('button');
    b.dataset.tool = t.id;
    b.title = `${t.label} (touche ${t.key})`;
    b.innerHTML = `<span class="ico" aria-hidden="true">${t.icon}</span><span class="lbl">${t.label}</span>`;
    b.onclick = () => setTool(t.id);
    tb.appendChild(b);
  }
  const m = document.createElement('button');
  m.className = 'mode';
  m.title = expert ? 'Revenir aux outils essentiels' : 'Afficher les outils de dessin libre (ligne, rectangle, pousser/tirer…)';
  m.innerHTML = `<span class="lbl">${expert ? 'Mode simple' : 'Mode expert'}</span>`;
  m.onclick = () => {
    expert = !expert;
    try { localStorage.setItem('workshop3d.expert', expert ? '1' : '0'); } catch { /* ignoré */ }
    buildToolbar(); refreshPanel();
    if (!expert && !SIMPLES.includes(tool)) setTool('select'); else setTool(tool);
  };
  tb.appendChild(m);
  const h = document.createElement('button');
  h.className = 'mode';
  h.title = 'Guide des premiers pas (touche ?)';
  h.innerHTML = '<span class="ico" aria-hidden="true">?</span><span class="lbl">Guide</span>';
  h.onclick = openGuide;
  tb.appendChild(h);
}
buildToolbar();

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.inset = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
root.appendChild(labelRenderer.domElement);

function resize() {
  const w = root.clientWidth, h = root.clientHeight;
  renderer.setSize(w, h, false);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
renderer.domElement.addEventListener('pointermove', onMove);
renderer.domElement.addEventListener('pointerdown', onDown);
addEventListener('pointerup', finSelection);
renderer.domElement.addEventListener('dblclick', doubleClicSelection);
renderer.domElement.addEventListener('pointerleave', () => { if (hoverId !== null && !selDown) { hoverId = null; rebuild(); } });
addEventListener('keydown', onKey);

// ───────── Démarrage ─────────
async function start() {
  await initKernel(() => wasmUrl);
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) { const s = JSON.parse(saved) as Saved; doc = sansMeublesVides(s.doc); debit = s.debit ?? []; filePath = localStorage.getItem(KEY + '.path') || null; rowId = Math.max(1, ...debit.map((r) => r.id)) + 1; }
  } catch { /* ignoré */ }
  history = [snapshot()]; hIdx = 0;
  shown = doc;
  resize(); refresh(); setTool('select'); setHud(); setDirty(false);
  let vu = false;
  try { vu = localStorage.getItem('workshop3d.vu') === '1'; localStorage.setItem('workshop3d.vu', '1'); } catch { /* ignoré */ }
  if (!vu && !doc.solids.length) openGuide();
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); labelRenderer.render(scene, camera); });
}
void start();

// ───────── Assistant (MCP) ─────────
// Le serveur MCP de la coque Tauri transmet ici les appels d'outils ; voir src/mcp.ts.
function noter(msg: string) {
  const el = document.getElementById('help')!;
  el.textContent = `✦ Assistant : ${msg}. Cmd+Z pour annuler.`; el.style.color = '#2f6fd6';
  setTimeout(() => { el.style.color = ''; el.textContent = HELP[tool]; }, 8000);
}
// Image de la vue. Avec `v`, une vue normalisée cadrée sur tout le modèle, puis la caméra de l'utilisateur revient.
function capture(v: VueMcp | undefined, largeur: number): string {
  const pos = camera.position.clone(), cible = controls.target.clone();
  if (v) { vue(v); fitAll(); }
  renderer.render(scene, camera);
  const src = renderer.domElement, k = Math.min(1, largeur / src.width);
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
  const g = c.getContext('2d')!;
  g.fillStyle = getComputedStyle(document.body).backgroundColor || '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 0, 0, c.width, c.height);
  if (v) { camera.position.copy(pos); controls.target.copy(cible); camera.lookAt(cible); renderer.render(scene, camera); }
  return c.toDataURL('image/jpeg', 0.85).split(',')[1]!;
}
const ctxMcp: CtxMcp = {
  doc: () => doc,
  debitSynchro: () => syncFromModel(doc, debit, rowId),
  selection: () => [...selected],
  fichier: () => filePath,
  modifie: () => dirty,
  appliquer(d, message, ids = []) {
    cancelOp();
    doc = d; selected.clear(); for (const i of ids) selected.add(i);
    commit(); noter(message);
  },
  selectionner(ids) { selected.clear(); for (const i of ids) selected.add(i); refresh(); },
  ouvrir(ids, ouvert) {
    const l = ids ?? (doc.elements ?? []).map((e) => e.id);
    for (const i of l) if (ouvert) ouverts.set(i, 1); else ouverts.delete(i);
    rebuild(); refreshPanel(); return l.length;
  },
  fiche: () => debit,
  ecrireFiche(rows, message) { cancelOp(); debit = rows; commit(); noter(message); },
  annuler() { const avant = hIdx; undo(); if (hIdx !== avant) noter('dernière modification annulée'); return hIdx !== avant; },
  capture,
  creerMeuble(d, params, matiere, fond, origine, fondTiroir) {
    d.caissons ??= [];
    const rec: CaissonRec = { id: d.next++, params: JSON.parse(JSON.stringify(params)) as CaissonParams, methode: methodeNommee(matiere, d), fond, ...(fondTiroir ? { fondTiroir } : {}) };
    d.caissons.push(rec);
    if (!origine) { const bb = bboxOf(d.solids); origine = [bb ? bb.max[0] + 0.3 : 0, 0, 0]; }
    return { id: rec.id, ids: ecrireCaisson(d, rec, origine) };
  },
  modifierMeuble(base, id, params, matiere, fond, fondTiroir) {
    const r = caissonModifie(base, id, params);
    if (!r || (matiere === undefined && fond === undefined && fondTiroir === undefined)) return r;
    const rec = r.doc.caissons!.find((x) => x.id === id)!;
    if (matiere !== undefined) rec.methode = methodeNommee(matiere, r.doc);
    if (fond !== undefined) rec.fond = fond;
    if (fondTiroir !== undefined) { if (fondTiroir) rec.fondTiroir = fondTiroir; else delete rec.fondTiroir; }
    return { doc: r.doc, ids: ecrireCaisson(r.doc, rec, origineCaisson(r.doc, rec)!) };
  },
};
if (tauri) {
  void tauri.event.listen('mcp', (e) => {
    let id = -1, rep: ReturnType<typeof repondreMcp>;
    try {
      const m = JSON.parse(e.payload) as { id: number; method: string; params: unknown };
      id = m.id;
      rep = repondreMcp(ctxMcp, m.method, m.params);
    } catch (err) { rep = { error: { code: -32603, message: err instanceof Error ? err.message : String(err) } }; }
    if (id >= 0) void tauri.core.invoke('mcp_reply', { id, reponse: rep });
  });
}

// Assistant intégré : mêmes outils que le serveur MCP, conversation dans l'app.
let cleMemoire: string | null = null;   // hors Tauri (aperçu navigateur) : en mémoire seulement
const assistant = creerAssistant({
  el: document.getElementById('assistant')!,
  ctx: ctxMcp,
  lireCle: async () => tauri ? tauri.core.invoke<string | null>('cle_api') : cleMemoire,
  async ecrireCle(cle) { if (tauri) await tauri.core.invoke('definir_cle_api', { cle }); else cleMemoire = cle || null; },
  surBascule: (ouvert) => document.getElementById('btn-assistant')!.classList.toggle('on', ouvert),
});
document.getElementById('btn-assistant')!.onclick = () => assistant.basculer();

// Pour les tests dans la console
(window as unknown as { workshop: unknown }).workshop = {
  get doc() { return doc; },
  mcp: (method: string, params: unknown) => repondreMcp(ctxMcp, method, params),
  ecran: (p: V3) => versEcran(p),
  dae: { exporter: () => exportCollada(doc.solids, (x) => materiauDe(doc, x)?.nom || x.meta.matiere, (x) => couleurDe(doc, x)), importer: (t: string) => importerTexteDae(t) }, get debit() { return debit; }, setTool, fitAll, boxMesh,
  addBox(min: V3, max: V3, name = 'Pièce') {
    doc = cloneDoc(doc);
    doc.solids.push({ id: doc.next++, name, mesh: boxMesh(min, max), meta: { piece: true, matiere: '', fil: 'aucun', note: '' } });
    commit();
  },
  faceContains,
};
