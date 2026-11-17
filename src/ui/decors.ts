// Textures des décors, dessinées au canevas (pas d'images à charger) à partir de la couleur du matériau.
// Un motif se répète ; sa taille réelle (m) est donnée à uvDecor pour que le veinage soit à l'échelle.
import * as THREE from 'three';
import type { Decor, Motif } from '../kernel/decor';

// Taille réelle des motifs : face (u le long du fil) et chant (v dans l'épaisseur).
export const MOTIFS: Record<Exclude<Decor, 'uni'>, { face: Motif; chant: Motif }> = {
  tissu: { face: { u: 0.04, v: 0.04 }, chant: { u: 0.04, v: 0.04 } },     // armure toile, fils chinés
  bois: { face: { u: 0.9, v: 0.3 }, chant: { u: 0.9, v: 0.3 } },
  lamelle: { face: { u: 1.2, v: 0.24 }, chant: { u: 1.2, v: 0.24 } },       // 6 lames de 40 mm
  contreplaque: { face: { u: 0.8, v: 0.4 }, chant: { u: 0.4, v: 0.006 } },  // 4 plis de 1,5 mm
  mdf: { face: { u: 0.3, v: 0.3 }, chant: { u: 0.3, v: 0.3 } },
};

// Générateur pseudo-aléatoire à graine : le même dessin à chaque affichage.
function alea(graine: number) {
  let a = graine >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const teinte = (base: THREE.Color, k: number) => base.clone().lerp(new THREE.Color(k > 0 ? 0xffffff : 0x000000), Math.abs(k)).getStyle();

// Fils du bois : lignes ondulées le long de u, raccordées aux bords pour que le motif se répète sans couture.
function veines(g: CanvasRenderingContext2D, w: number, h: number, y0: number, y1: number, base: THREE.Color, rnd: () => number, n: number, ampli: number) {
  for (let i = 0; i < n; i++) {
    const y = y0 + rnd() * (y1 - y0), a = ampli * (0.3 + rnd()), periode = w / (1 + Math.floor(rnd() * 3)), phase = rnd() * Math.PI * 2;
    g.strokeStyle = teinte(base, rnd() < 0.7 ? -(0.08 + rnd() * 0.18) : 0.1 + rnd() * 0.15);
    g.globalAlpha = 0.12 + rnd() * 0.3;
    g.lineWidth = 0.6 + rnd() * 2.2;
    for (const dy of y1 - y0 >= h - 1 ? [-h, 0, h] : [0]) {
      g.beginPath();
      for (let x = 0; x <= w; x += 8) g.lineTo(x, y + dy + a * Math.sin((2 * Math.PI * x) / periode + phase) + a * 0.3 * Math.sin((6 * Math.PI * x) / periode));
      g.stroke();
    }
  }
  g.globalAlpha = 1;
}
function grain(g: CanvasRenderingContext2D, w: number, h: number, base: THREE.Color, rnd: () => number, n: number, force: number) {
  for (let i = 0; i < n; i++) { g.fillStyle = teinte(base, (rnd() - 0.5) * force); g.globalAlpha = 0.25; g.fillRect(rnd() * w, rnd() * h, 1.5, 1.5); }
  g.globalAlpha = 1;
}

function dessiner(decor: Exclude<Decor, 'uni'>, chant: boolean, base: THREE.Color): HTMLCanvasElement {
  const c = document.createElement('canvas'), rnd = alea(decor.length * 97 + (chant ? 7 : 0));
  const motif = MOTIFS[decor][chant ? 'chant' : 'face'];
  c.width = 1024; c.height = Math.max(32, Math.round((1024 * motif.v) / motif.u));
  if (decor === 'contreplaque' && chant) c.height = 64;
  const g = c.getContext('2d')!, w = c.width, h = c.height;
  g.fillStyle = base.getStyle(); g.fillRect(0, 0, w, h);
  if (decor === 'tissu') {
    // armure toile : fils alternés dessus/dessous, chinés (teinte variable d'un fil à l'autre)
    c.width = c.height = 256;
    const n = 32, p = 256 / n;
    g.fillStyle = teinte(base, -0.25); g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const dessus = (i + j) % 2 === 0, k = (rnd() - 0.5) * 0.22 + (dessus ? 0.06 : -0.06);
      const grd = dessus ? g.createLinearGradient(i * p, 0, (i + 1) * p, 0) : g.createLinearGradient(0, j * p, 0, (j + 1) * p);
      grd.addColorStop(0, teinte(base, k - 0.12)); grd.addColorStop(0.5, teinte(base, k + 0.06)); grd.addColorStop(1, teinte(base, k - 0.12));
      g.fillStyle = grd; g.fillRect(i * p + 0.4, j * p + 0.4, p - 0.8, p - 0.8);
    }
    grain(g, 256, 256, base, rnd, 1500, 0.35);
    return c;
  }
  if (decor === 'bois') { veines(g, w, h, 0, h, base, rnd, 160, h * 0.04); grain(g, w, h, base, rnd, 4000, 0.2); }
  else if (decor === 'contreplaque' && !chant) { veines(g, w, h, 0, h, base, rnd, 70, h * 0.12); grain(g, w, h, base, rnd, 3000, 0.15); }
  else if (decor === 'contreplaque') {
    // plis : couches alternées (fil en long, fil en bout plus sombre), séparées par un fin joint de colle
    for (let i = 0; i < 4; i++) {
      g.fillStyle = teinte(base, i % 2 ? -0.18 : 0.05); g.fillRect(0, (i * h) / 4, w, h / 4);
      g.fillStyle = teinte(base, -0.45); g.fillRect(0, (i * h) / 4, w, 1.2);
    }
    grain(g, w, h, base, rnd, 2500, 0.3);
  } else if (decor === 'lamelle') {
    // 6 lames de 40 mm ; chaque lame est faite de morceaux aboutés de 300 à 700 mm, de teintes un peu différentes
    const nL = 6, hl = h / nL, pxM = w / motif.u;
    for (let j = 0; j < nL; j++) {
      let x = -rnd() * 0.5 * pxM;
      while (x < w) {
        const long = (0.3 + rnd() * 0.4) * pxM, x1 = Math.min(x + long, w), t = base.clone().lerp(new THREE.Color(rnd() < 0.5 ? 0x7a4f2a : 0xffffff), rnd() * 0.16);
        g.save(); g.beginPath(); g.rect(Math.max(0, x), j * hl, x1 - Math.max(0, x), hl); g.clip();
        g.fillStyle = t.getStyle(); g.fillRect(0, j * hl, w, hl);
        veines(g, w, h, j * hl, (j + 1) * hl, t, rnd, 14, hl * 0.06);
        g.restore();
        // aboutage : petite ligne sombre en travers
        if (x1 < w) { g.strokeStyle = teinte(base, -0.4); g.globalAlpha = 0.5; g.lineWidth = 1; g.beginPath(); g.moveTo(x1, j * hl); g.lineTo(x1, (j + 1) * hl); g.stroke(); g.globalAlpha = 1; }
        x = x1;
      }
      g.fillStyle = teinte(base, -0.3); g.globalAlpha = 0.35; g.fillRect(0, j * hl, w, 1); g.globalAlpha = 1;   // joint de colle
    }
    grain(g, w, h, base, rnd, 3000, 0.15);
  } else { grain(g, w, h, base, rnd, 12000, 0.25); }
  return c;
}

// Matériaux three [face, chant] d'un décor, par couleur ; la version survolée est un peu éclaircie.
const cache = new Map<string, THREE.MeshLambertMaterial[]>();
export function materiauxDecor(decor: Exclude<Decor, 'uni'>, hex: string, survol: boolean, modele: THREE.MeshLambertMaterial): THREE.MeshLambertMaterial[] {
  const k = `${decor}${hex}${survol ? '+' : ''}`;
  let m = cache.get(k);
  if (!m) {
    const base = new THREE.Color(hex);
    m = [false, true].map((chant) => {
      const t = new THREE.CanvasTexture(dessiner(decor, chant, base));
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      const x = modele.clone(); x.color = new THREE.Color(0xffffff); x.map = t;
      // tissu : relief du tissage et ombrage lissé (meubles importés aux formes arrondies)
      if (decor === 'tissu') { x.bumpMap = t; x.bumpScale = 1.5; x.flatShading = false; }
      if (survol) x.emissive = new THREE.Color(0x3a3a3a);
      return x;
    });
    cache.set(k, m);
  }
  return m;
}

// Coordonnées de texture d'une géométrie quelconque (meuble importé) : projection sur le plan le plus en face de chaque sommet.
export function uvTriplanaire(g: THREE.BufferGeometry, motif: Motif, graine: number) {
  const p = g.getAttribute('position'), n = g.getAttribute('normal'), uv = new Float32Array(p.count * 2);
  const du = (graine * 0.618) % 1, dv = (graine * 0.382) % 1;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const [a, b] = az >= ax && az >= ay ? [p.getX(i), p.getY(i)] : ax >= ay ? [p.getY(i), p.getZ(i)] : [p.getX(i), p.getZ(i)];
    uv[2 * i] = a / motif.u + du; uv[2 * i + 1] = b / motif.v + dv;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
