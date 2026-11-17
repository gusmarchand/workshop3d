import { planarFaces, visibles, type Doc, type V3 } from '../kernel/model';
import type { Feuille } from './feuilles';

// ───────── Plans à imprimer ─────────
// Projections orthogonales filaires (toutes les arêtes, cachées comprises), avec les cotes hors tout.
function vueSvg(titre: string, list: Doc['solids'], proj: (p: V3) => [number, number]): string {
  const segs: [number, number, number, number][] = [];
  const vus = new Set<string>();
  for (const s of list) for (const F of planarFaces(s.mesh)) for (const l of F.loops) for (let i = 0; i < l.length; i++) {
    const a = proj(l[i]!), b = proj(l[(i + 1) % l.length]!);
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-4) continue;
    const r = (v: number) => Math.round(v * 1e4);
    const k1 = `${r(a[0])},${r(a[1])},${r(b[0])},${r(b[1])}`, k2 = `${r(b[0])},${r(b[1])},${r(a[0])},${r(a[1])}`;
    if (vus.has(k1) || vus.has(k2)) continue;
    vus.add(k1); segs.push([a[0] * 1000, -a[1] * 1000, b[0] * 1000, -b[1] * 1000]);
  }
  if (!segs.length) return '';
  const xs = segs.flatMap((g) => [g[0], g[2]]), ys = segs.flatMap((g) => [g[1], g[3]]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const W = x1 - x0, H = y1 - y0, m = Math.max(W, H) * 0.12, sw = Math.max(W, H) / 500, fs = Math.max(W, H) / 28;
  const cote = (ax: number, ay: number, bx: number, by: number, t: string, tx: number, ty: number, rot = 0) =>
    `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#1a73e8" stroke-width="${sw}"/><text x="${tx}" y="${ty}" font-size="${fs}" fill="#1a73e8" text-anchor="middle" ${rot ? `transform="rotate(${rot} ${tx} ${ty})"` : ''}>${t}</text>`;
  return `<div><h3>${titre}</h3><svg class="plan" viewBox="${x0 - m} ${y0 - m * 0.5} ${W + m * 1.5} ${H + m * 1.5}" role="img" aria-label="${titre}">
    ${segs.map((g) => `<line x1="${g[0]}" y1="${g[1]}" x2="${g[2]}" y2="${g[3]}" stroke="#1b1b1b" stroke-width="${sw}"/>`).join('')}
    ${cote(x0, y1 + m * 0.4, x1, y1 + m * 0.4, `${Math.round(W)} mm`, (x0 + x1) / 2, y1 + m * 0.4 + fs * 1.1)}
    ${cote(x0 - m * 0.4, y0, x0 - m * 0.4, y1, `${Math.round(H)} mm`, x0 - m * 0.4 - fs * 0.5, (y0 + y1) / 2, -90)}
  </svg></div>`;
}
export function openPlans(f: Feuille) {
  const doc = f.doc(), selected = new Set(f.selection()), debitEl = f.el;
  // les pièces masquées n'apparaissent pas, comme à l'écran
  const sel = visibles(doc).filter((s) => selected.has(s.id));
  const list = sel.length ? sel : visibles(doc);
  debitEl.innerHTML = `<div class="sheet">
    <header><h2>Plans ${sel.length ? 'de la sélection' : 'du modèle'}</h2><button class="btn" id="v-print">Imprimer</button><button class="btn primary" id="v-close">Fermer</button></header>
    <div class="scroll">
      ${list.length ? '' : '<p>Rien à dessiner.</p>'}
      ${vueSvg('Vue de face', list, (p) => [p[0], p[2]])}
      ${vueSvg('Vue de dessus (façade en bas)', list, (p) => [p[0], p[1]])}
      ${vueSvg('Vue de côté droit', list, (p) => [p[1], p[2]])}
    </div>
    <footer><span class="note">Vues filaires : toutes les arêtes sont dessinées, y compris celles cachées. Cotes hors tout en mm.</span></footer>
  </div>`;
  document.getElementById('v-close')!.onclick = () => f.fermer();
  document.getElementById('v-print')!.onclick = () => window.print();
  debitEl.classList.add('open');
}

