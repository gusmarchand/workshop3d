// Arrangement planaire 2D : à partir d'un nuage de segments, calcule les régions
// fermées (avec trous), comme SketchUp qui crée une face quand une boucle se ferme.
export type P2 = [number, number];
export type Seg2 = [P2, P2];
export interface Region { outer: P2[]; holes: P2[][]; area: number }

export const EPS = 1e-5;

const dist = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function polyArea(p: P2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!, b = p[(i + 1) % p.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function pointInPoly(pt: P2, poly: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function pointInRegion(pt: P2, r: Region): boolean {
  return pointInPoly(pt, r.outer) && !r.holes.some((h) => pointInPoly(pt, h));
}

// Paramètres t (sur a→b) où le segment c→d coupe a→b, ou touche (T, bout à bout, recouvrement).
function splitParams(a: P2, b: P2, c: P2, d: P2): number[] {
  const out: number[] = [];
  const len = dist(a, b);
  if (len < EPS) return out;
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
  const onSeg = (p: P2) => {
    const t = (p[0] - a[0]) * ux + (p[1] - a[1]) * uy;
    const off = Math.abs((p[0] - a[0]) * uy - (p[1] - a[1]) * ux);
    if (off < EPS && t > EPS && t < len - EPS) out.push(t / len);
  };
  onSeg(c); onSeg(d);
  // intersection propre de deux segments non parallèles
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) > 1e-12) {
    const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den;
    const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
    const tl = EPS / len, ul = EPS / dist(c, d);
    if (t > tl && t < 1 - tl && u > -ul && u < 1 + ul) out.push(t);
  }
  return out;
}

export function arrange(input: readonly Seg2[]): Region[] {
  const segs = input.filter(([a, b]) => dist(a, b) > EPS);
  // 1. découpage mutuel
  const pieces: Seg2[] = [];
  for (let i = 0; i < segs.length; i++) {
    const [a, b] = segs[i]!;
    const ts = [0, 1];
    for (let j = 0; j < segs.length; j++) if (i !== j) ts.push(...splitParams(a, b, segs[j]![0], segs[j]![1]));
    ts.sort((x, y) => x - y);
    for (let k = 0; k + 1 < ts.length; k++) {
      const t0 = ts[k]!, t1 = ts[k + 1]!;
      if ((t1 - t0) * dist(a, b) < EPS) continue;
      pieces.push([[a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1]]);
    }
  }
  // 2. graphe : sommets fusionnés, arêtes uniques
  const verts: P2[] = [];
  const vid = (p: P2): number => {
    for (let i = 0; i < verts.length; i++) if (dist(verts[i]!, p) < EPS) return i;
    verts.push(p); return verts.length - 1;
  };
  const edgeSet = new Set<string>();
  const adj: Set<number>[] = [];
  const link = (u: number, v: number) => { (adj[u] ??= new Set()).add(v); (adj[v] ??= new Set()).add(u); };
  for (const [a, b] of pieces) {
    const u = vid(a), v = vid(b);
    if (u === v) continue;
    const key = u < v ? `${u}-${v}` : `${v}-${u}`;
    if (edgeSet.has(key)) continue;
    edgeSet.add(key); link(u, v);
  }
  // 3. élagage des bouts pendants
  let changed = true;
  while (changed) {
    changed = false;
    adj.forEach((nb, u) => {
      if (nb.size === 1) {
        const [v] = [...nb] as [number];
        nb.clear(); adj[v]?.delete(u); changed = true;
      }
    });
  }
  const angle = (u: number, v: number) => Math.atan2(verts[v]![1] - verts[u]![1], verts[v]![0] - verts[u]![0]);
  const sorted: number[][] = adj.map((nb, u) => [...(nb ?? [])].sort((x, y) => angle(u, x) - angle(u, y)));

  // 4. composantes connexes
  const comp: number[] = new Array(verts.length).fill(-1);
  let nComp = 0;
  for (let s = 0; s < verts.length; s++) {
    if (comp[s] !== -1 || !(adj[s]?.size)) continue;
    const stack = [s]; comp[s] = nComp;
    while (stack.length) {
      const u = stack.pop()!;
      for (const v of adj[u] ?? []) if (comp[v] === -1) { comp[v] = nComp; stack.push(v); }
    }
    nComp++;
  }

  // 5. cycles de demi-arêtes
  const seen = new Set<string>();
  interface Cycle { pts: P2[]; area: number; comp: number }
  const cycles: Cycle[] = [];
  for (let u = 0; u < verts.length; u++) {
    for (const v0 of sorted[u] ?? []) {
      if (seen.has(`${u}>${v0}`)) continue;
      const ids: number[] = [];
      let a = u, b = v0, guard = 0;
      let ok = true;
      while (!seen.has(`${a}>${b}`)) {
        seen.add(`${a}>${b}`);
        ids.push(a);
        const nb = sorted[b]!;
        const i = nb.indexOf(a);
        const w = nb[(i - 1 + nb.length) % nb.length]!;
        a = b; b = w;
        if (++guard > 100000) { ok = false; break; }
      }
      if (!ok || ids.length < 3) continue;
      const pts = ids.map((i) => verts[i]!);
      cycles.push({ pts, area: polyArea(pts), comp: comp[ids[0]!]! });
    }
  }

  // 6. faces (cycles anti-horaires) et trous (frontières extérieures des îlots)
  const faces = cycles.filter((c) => c.area > EPS * EPS).map((c) => ({ ...c, holes: [] as P2[][] }));
  for (const h of cycles.filter((c) => c.area < -EPS * EPS)) {
    let best: (typeof faces)[number] | null = null;
    for (const f of faces) {
      if (f.comp === h.comp || f.area <= -h.area) continue;
      if (pointInPoly(h.pts[0]!, f.pts) && !f.holes.some(() => false) && (!best || f.area < best.area)) best = f;
    }
    best?.holes.push(h.pts);
  }
  return faces.map((f) => ({ outer: f.pts, holes: f.holes, area: f.area - f.holes.reduce((s, h) => s + Math.abs(polyArea(h)), 0) }));
}

// Région contenant le point (la plus petite si plusieurs, ex. îlot dans une face).
export function regionAt(regions: Region[], p: P2): Region | null {
  let best: Region | null = null;
  for (const r of regions) if (pointInRegion(p, r) && (!best || r.area < best.area)) best = r;
  return best;
}
