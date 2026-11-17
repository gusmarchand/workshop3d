import type { MeshData, Solid } from './model';

// Export Collada 1.4.1 (.dae) : format d'échange lu par SketchUp (Importer) et Sweet Home 3D (Importer un meuble).
// Une pièce = un nœud nommé avec sa géométrie ; une matière = un matériau coloré. Z vers le haut, en mètres.
// Le modèle est recalé pour que son coin bas avant gauche soit à l'origine, comme un meuble de bibliothèque.

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nombre = (x: number) => (Math.abs(x) < 1e-9 ? '0' : x.toFixed(6).replace(/\.?0+$/, ''));

// Couleur stable par matière : teinte bois par défaut, nuances déduites du nom.
export function couleurMatiere(nom: string): [number, number, number] {
  const n = nom.toLowerCase();
  if (!n) return [0.91, 0.84, 0.67];
  if (/blanc|white/.test(n)) return [0.95, 0.95, 0.93];
  if (/noir|black|anthracite/.test(n)) return [0.18, 0.18, 0.2];
  if (/gris|grey|gray/.test(n)) return [0.6, 0.6, 0.6];
  if (/ch[eê]ne|oak/.test(n)) return [0.78, 0.62, 0.42];
  if (/noyer|walnut/.test(n)) return [0.45, 0.32, 0.22];
  if (/h[eê]tre|beech/.test(n)) return [0.86, 0.71, 0.53];
  if (/pin|sapin|pine/.test(n)) return [0.9, 0.78, 0.55];
  if (/hdf|mdf|medium/.test(n)) return [0.72, 0.6, 0.45];
  if (/contreplaqu|plywood|ctp/.test(n)) return [0.88, 0.77, 0.58];
  let h = 0;
  for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const t = (h % 1000) / 1000;
  return [0.7 + 0.25 * t, 0.6 + 0.2 * (1 - t), 0.45 + 0.15 * t];
}

// `couleurDe` (#rrggbb) : couleur choisie pour la pièce ; sinon déduite du nom de la matière.
export function exportCollada(solids: Solid[], matiereDe: (s: Solid) => string, couleurDe?: (s: Solid) => string, date = new Date()): string {
  const min = [Infinity, Infinity, Infinity];
  for (const s of solids) for (let i = 0; i < s.mesh.v.length; i++) min[i % 3] = Math.min(min[i % 3]!, s.mesh.v[i]!);
  if (!solids.length) min.fill(0);
  const mats = [...new Set(solids.map((s) => matiereDe(s) || 'Bois'))];
  const matId = (s: Solid) => `mat${mats.indexOf(matiereDe(s) || 'Bois')}`;
  const stamp = date.toISOString().replace(/\.\d+Z$/, 'Z');
  const effects = mats.map((m, i) => {
    const s = solids.find((x) => (matiereDe(x) || 'Bois') === m);
    const hex = s && couleurDe?.(s);
    const [r, g, b] = hex && /^#[0-9a-f]{6}$/i.test(hex) ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number] : couleurMatiere(m === 'Bois' ? '' : m);
    return `<effect id="mat${i}-effect"><profile_COMMON><technique sid="common"><lambert><diffuse><color>${nombre(r)} ${nombre(g)} ${nombre(b)} 1</color></diffuse></lambert></technique></profile_COMMON></effect>`;
  }).join('\n    ');
  const materials = mats.map((m, i) => `<material id="mat${i}" name="${xml(m)}"><instance_effect url="#mat${i}-effect"/></material>`).join('\n    ');
  const geometries = solids.map((s, i) => {
    const v = s.mesh.v.map((x, k) => nombre(x - min[k % 3]!)).join(' ');
    const nv = s.mesh.v.length / 3, nt = s.mesh.t.length / 3;
    return `<geometry id="geo${i}" name="${xml(s.name)}"><mesh>
        <source id="geo${i}-pos"><float_array id="geo${i}-pos-array" count="${nv * 3}">${v}</float_array><technique_common><accessor source="#geo${i}-pos-array" count="${nv}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
        <vertices id="geo${i}-vtx"><input semantic="POSITION" source="#geo${i}-pos"/></vertices>
        <triangles count="${nt}" material="m"><input semantic="VERTEX" source="#geo${i}-vtx" offset="0"/><p>${s.mesh.t.join(' ')}</p></triangles>
      </mesh></geometry>`;
  }).join('\n    ');
  const nodes = solids.map((s, i) => `<node id="node${i}" name="${xml(s.name)}"><instance_geometry url="#geo${i}"><bind_material><technique_common><instance_material symbol="m" target="#${matId(s)}"/></technique_common></bind_material></instance_geometry></node>`).join('\n      ');
  return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset><contributor><authoring_tool>Workshop 3D</authoring_tool></contributor><created>${stamp}</created><modified>${stamp}</modified><unit name="meter" meter="1"/><up_axis>Z_UP</up_axis></asset>
  <library_effects>
    ${effects}
  </library_effects>
  <library_materials>
    ${materials}
  </library_materials>
  <library_geometries>
    ${geometries}
  </library_geometries>
  <library_visual_scenes>
    <visual_scene id="scene" name="Workshop 3D">
      ${nodes}
    </visual_scene>
  </library_visual_scenes>
  <scene><instance_visual_scene url="#scene"/></scene>
</COLLADA>
`;
}

// Fusionne les sommets identiques (au micron près) : un fichier importé répète souvent les sommets par triangle.
export function fusionnerSommets(positions: ArrayLike<number>, index: ArrayLike<number> | null): MeshData {
  const v: number[] = [], t: number[] = [], vus = new Map<string, number>();
  const id = (i: number) => {
    const x = positions[3 * i]!, y = positions[3 * i + 1]!, z = positions[3 * i + 2]!;
    const k = `${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`;
    let n = vus.get(k);
    if (n === undefined) { n = v.length / 3; v.push(x, y, z); vus.set(k, n); }
    return n;
  };
  const nTri = (index ? index.length : positions.length / 3) / 3;
  for (let f = 0; f < nTri; f++) {
    const a = id(index ? index[3 * f]! : 3 * f), b = id(index ? index[3 * f + 1]! : 3 * f + 1), c = id(index ? index[3 * f + 2]! : 3 * f + 2);
    if (a !== b && b !== c && a !== c) t.push(a, b, c);   // triangles dégénérés écartés
  }
  return { v, t };
}
