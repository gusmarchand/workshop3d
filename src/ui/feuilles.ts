// Fenêtres « feuille » hors du cœur de l'interface : plafond, vérification, fiche de perçage, liste de courses.
// Elles ne connaissent du reste de l'app que ce contexte ; main.ts le fournit.
import type { DebitRow } from '../kernel/debit';
import { controler } from '../kernel/controle';
import { listeCourses, type Ligne } from '../kernel/courses';
import { piecesDe } from '../kernel/elements';
import { cloneDoc, type Doc } from '../kernel/model';
import { fichePercage } from '../kernel/percage';
import { plafondDepuisPiece, type Plafond } from '../kernel/plafond';

export interface Feuille {
  el: HTMLElement;
  doc(): Doc;
  fiche(): DebitRow[];                          // fiche de débit à jour
  selection(): number[];
  appliquer(d: Doc, message: string): void;     // nouveau document, une étape d'annulation
  montrer(ids: number[]): void;                 // sélectionne et cadre ces pièces
  fermer(): void;
  telecharger(texte: string, nom: string, ext: string): void;
  ouvrirMateriaux?(): void;                     // ouvre « Matériaux et panneaux »
}
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const nombre = (v: string) => { const n = parseFloat(v.replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
const euro = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;
const ouvrir = (f: Feuille, titre: string, boutons: string, corps: string, pied = '') => {
  f.el.innerHTML = `<div class="sheet"><header><h2>${titre}</h2>${boutons}<button class="btn primary" data-fermer>Fermer</button></header><div class="scroll">${corps}</div>${pied ? `<footer>${pied}</footer>` : ''}</div>`;
  f.el.querySelector<HTMLElement>('[data-fermer]')!.onclick = () => f.fermer();
  f.el.classList.add('open');
};
const imprimer = '<button class="btn" data-imprimer>Imprimer</button>';
const lierImpression = (f: Feuille) => { const b = f.el.querySelector<HTMLElement>('[data-imprimer]'); if (b) b.onclick = () => window.print(); };

// ───────── Plafond en pente ─────────
export function ouvrirPlafond(f: Feuille) {
  const d = f.doc(), p: Plafond = d.plafond ?? { angle: 30, hauteur: 1000, axe: 1, sens: 1, position: 0 };
  ouvrir(f, 'Plafond en pente', '', `<div class="formulaire">
    <p class="note">Mesure sur place la pente et une hauteur : l'app vérifie que les pièces et les portes, même ouvertes, restent dessous (bouton « Vérifier »). Le plafond s'affiche en rouge pâle.</p>
    <label>Angle de la pente (°) <input id="pl-angle" value="${p.angle}"></label>
    <label>Hauteur mesurée (mm) <input id="pl-h" value="${p.hauteur}"></label>
    <label>… à la position (mm) <input id="pl-pos" value="${p.position}"></label>
    <label>le long de l'axe <select id="pl-axe"><option value="0" ${p.axe === 0 ? 'selected' : ''}>X (rouge)</option><option value="1" ${p.axe === 1 ? 'selected' : ''}>Y (vert)</option></select></label>
    <label>La pente monte vers <select id="pl-sens"><option value="1" ${p.sens === 1 ? 'selected' : ''}>les + de l'axe</option><option value="-1" ${p.sens === -1 ? 'selected' : ''}>les − de l'axe</option></select></label>
    <div class="row"><button class="btn" id="pl-piece" title="Sélectionne d'abord une pièce inclinée posée sous le plafond">D'après la pièce sélectionnée</button><button class="btn primary" id="pl-ok">Enregistrer</button>${d.plafond ? '<button class="btn" id="pl-sans">Retirer le plafond</button>' : ''}</div>
    <p class="warn" id="pl-err"></p></div>`);
  const v = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
  const err = (m: string) => { document.getElementById('pl-err')!.textContent = m; };
  document.getElementById('pl-ok')!.onclick = () => {
    const q: Plafond = { angle: nombre(v('pl-angle')), hauteur: nombre(v('pl-h')), position: nombre(v('pl-pos')), axe: v('pl-axe') === '0' ? 0 : 1, sens: v('pl-sens') === '-1' ? -1 : 1 };
    if (!(q.angle >= 0 && q.angle < 80)) return err('Angle entre 0 et 80°.');
    if (!(q.hauteur > 0 && q.hauteur < 10000) || !Number.isFinite(q.position)) return err('Hauteur et position en mm.');
    const nd = cloneDoc(d); nd.plafond = q; f.appliquer(nd, 'plafond enregistré'); f.fermer();
  };
  document.getElementById('pl-piece')!.onclick = () => {
    const s = d.solids.find((x) => x.id === f.selection()[0]);
    const q = s && plafondDepuisPiece(s);
    if (!q) return err('Sélectionne une seule pièce inclinée (le dessus d\'un rampant, par exemple).');
    for (const [id, val] of [['pl-angle', q.angle], ['pl-h', q.hauteur], ['pl-pos', q.position], ['pl-axe', q.axe], ['pl-sens', q.sens]] as const) (document.getElementById(id) as HTMLInputElement).value = String(val);
    err('');
  };
  const sans = document.getElementById('pl-sans');
  if (sans) sans.onclick = () => { const nd = cloneDoc(d); delete nd.plafond; f.appliquer(nd, 'plafond retiré'); f.fermer(); };
}

// ───────── Vérification ─────────
export function ouvrirVerification(f: Feuille) {
  const d = f.doc(), ps = controler(d, d.plafond);
  const ligne = (p: (typeof ps)[number], i: number) => `<tr><td><span class="badge ${p.niveau}">${p.niveau === 'erreur' ? 'À corriger' : 'À vérifier'}</span></td><td>${esc(p.message)}</td><td class="col-act"><button class="btn" data-montrer="${i}">Montrer</button></td></tr>`;
  ouvrir(f, 'Vérification', imprimer, ps.length
    ? `<table><tbody>${ps.map(ligne).join('')}</tbody></table>`
    : '<p>Rien à signaler : pas de pièces qui se traversent, portées raisonnables, portes et tiroirs cohérents.</p>',
  `<span class="note">Contrôles : pièces qui se traversent, tablettes de plus de 80 cm sans appui ou en porte-à-faux de plus de 30 cm, épaisseur des portes pour les charnières, ${d.plafond ? 'plafond (pièces et ouvertures)' : 'plafond (non saisi : bouton « Plafond… »)'}, pièces sans matériau.</span>`);
  lierImpression(f);
  f.el.querySelectorAll<HTMLElement>('[data-montrer]').forEach((b) => { b.onclick = () => { f.fermer(); f.montrer(ps[Number(b.dataset.montrer)]!.ids); }; });
}

// ───────── Fiche de perçage ─────────
function croquis(fp: NonNullable<ReturnType<typeof fichePercage>>): string {
  const W = fp.largeur, H = fp.hauteur, m = Math.max(W, H) * 0.12, fs = Math.max(W, H) / 32;
  const trous = fp.trous.map((t) => `<circle cx="${t.u}" cy="${H - t.v}" r="${t.diam / 2}" class="${t.face === 'intérieure' ? 'cuv' : 'tr'}"/>
    <text x="${t.u + t.diam / 2 + fs * 0.3}" y="${H - t.v - fs * 0.3}" font-size="${fs}">${String(t.u).replace('.', ',')} ; ${String(t.v).replace('.', ',')}</text>`).join('');
  return `<svg viewBox="${-m} ${-m} ${W + 2 * m} ${H + 2 * m}" class="percage" role="img" aria-label="Croquis de perçage de ${esc(fp.titre)}">
    <rect width="${W}" height="${H}" class="pan"/>${trous}
    <text x="${W / 2}" y="${H + m * 0.6}" font-size="${fs}" text-anchor="middle">${String(W).replace('.', ',')} mm</text>
    <text x="${-m * 0.5}" y="${H / 2}" font-size="${fs}" text-anchor="middle" transform="rotate(-90 ${-m * 0.5} ${H / 2})">${String(H).replace('.', ',')} mm</text></svg>`;
}
export function ouvrirPercage(f: Feuille) {
  const d = f.doc(), sel = new Set(f.selection());
  const els = (d.elements ?? []).filter((e) => !sel.size || piecesDe(e).some((i) => sel.has(i)));
  const fiches = els.map((e) => fichePercage(d, e)).filter((x): x is NonNullable<typeof x> => !!x);
  const bloc = (fp: (typeof fiches)[number]) => `<section class="fiche-percage"><h3>${esc(fp.titre)} — ${String(fp.largeur).replace('.', ',')} × ${String(fp.hauteur).replace('.', ',')} × ${String(fp.epaisseur).replace('.', ',')}</h3>
    <div class="percage-grille">${croquis(fp)}<div>
      <table><thead><tr><th>Trou</th><th>Ø</th><th>Prof.</th><th>Depuis la gauche</th><th>Depuis le bas</th></tr></thead><tbody>${fp.trous.map((t) => `<tr><td>${t.quoi} (${t.face})</td><td>${t.diam}</td><td>${String(t.profondeur).replace('.', ',')}</td><td>${String(t.u).replace('.', ',')}</td><td>${String(t.v).replace('.', ',')}</td></tr>`).join('')}</tbody></table>
      ${fp.notes.map((n) => `<p class="note">${esc(n)}</p>`).join('')}</div></div></section>`;
  ouvrir(f, `Fiche de perçage${sel.size ? ' (sélection)' : ''}`, imprimer, fiches.length ? fiches.map(bloc).join('')
    : '<p>Aucune porte ni aucun tiroir identifié. Dans le panneau : « Reconnaître » ou « C\'est une porte ».</p>',
  '<span class="note">Vu de face (de l\'extérieur), cotes depuis le coin bas gauche, en mm. Cuvettes (traits pleins) percées côté intérieur à la mèche Forstner Ø35 ; trous de poignée (petits cercles) traversants. Repère la face intérieure avant de percer.</span>');
  lierImpression(f);
}

// ───────── Courses et coût ─────────
// Tout l'argent du projet au même endroit : panneaux (prix des formats), chant (prix au mètre), quincaillerie et divers.
// Les prix sont modifiables ici ; les quantités de panneaux viennent de la découpe, celles de la quincaillerie des portes et tiroirs.
export function ouvrirCourses(f: Feuille) {
  const { lignes, total } = listeCourses(f.doc(), f.fiche());
  const somme = (r: Ligne['rayon']) => lignes.filter((l) => l.rayon === r).reduce((t, l) => t + l.qte * l.prix, 0);
  const rayons = (['Panneaux', 'Chant', 'Quincaillerie', 'Visserie'] as const).filter((r) => lignes.some((l) => l.rayon === r) || r === 'Quincaillerie');
  const champ = (l: Ligne, k: string, v: string | number, cls: string, titre: string) => `<input class="${cls}" data-ref="${l.ref!.t}" data-id="${l.ref!.id}" data-k="${k}" value="${esc(String(v))}" aria-label="${titre}">`;
  const ligne = (l: Ligne) => {
    const modifiable = !!l.ref, libre = l.ref?.t === 'extras' && !l.auto;
    const prix = modifiable ? `${champ(l, 'prix', l.prix, 'num', 'Prix unitaire')}${l.prix === 0 ? ' <span class="badge attention" title="Sans prix, cette ligne n\'est pas comptée dans le total">prix ?</span>' : ''}` : (l.prix ? euro(l.prix) : l.rayon === 'Visserie' ? '—' : '<span class="badge attention" title="Indique ce prix dans Matériaux et panneaux">prix ?</span>');
    return `<tr><td>${libre ? champ(l, 'nom', l.nom, '', 'Désignation') : esc(l.nom)}</td><td>${libre ? champ(l, 'qte', l.qte, 'num', 'Quantité') : `${l.estimation ? '≈ ' : ''}${l.qte} ${l.unite}`}</td><td>${prix}</td><td>${l.prix ? euro(l.prix * l.qte) : '—'}</td><td>${libre ? `<button class="btn" data-delx="${l.ref!.id}" title="Supprimer cette ligne">×</button>` : ''}</td></tr>`;
  };
  const corps = rayons.map((r) => `<h3>${r}</h3>${r === 'Quincaillerie' && !lignes.some((l) => l.rayon === r) ? '<p class="note">Rien pour l\'instant. Les charnières, coulisses et poignées arrivent avec les portes et les tiroirs.</p>' : `<table><thead><tr><th>Article</th><th>Qté</th><th>Prix unitaire €</th><th>Total</th><th></th></tr></thead><tbody>${lignes.filter((l) => l.rayon === r).map(ligne).join('')}</tbody></table>`}${r === 'Quincaillerie' ? '<p><button class="btn" data-addx>+ Ligne</button></p>' : ''}`).join('');
  ouvrir(f, 'Courses et coût', `${f.ouvrirMateriaux ? '<button class="btn" data-pans title="Formats, stock et prix d\'achat des panneaux, prix du chant">Panneaux et prix…</button>' : ''}<button class="btn" data-csv>Export CSV</button>${imprimer}`, corps,
    `<span>Panneaux <b>${euro(somme('Panneaux'))}</b></span><span>Chant <b>${euro(somme('Chant'))}</b></span><span>Quincaillerie <b>${euro(somme('Quincaillerie'))}</b></span><span>Total <b>${euro(total)}</b> (articles chiffrés)</span><span class="note">Panneaux d'après la découpe (stock déduit), chant + 10 %. La visserie (≈) est une estimation : 4 vis par assemblage, 4 par charnière, 12 par paire de coulisses, 2 par poignée, sans prix.</span>`);
  lierImpression(f);
  const edit = (fn: (d: Doc) => void) => { const d = cloneDoc(f.doc()); d.extras ??= []; d.stock ??= []; fn(d); f.appliquer(d, 'prix modifié'); ouvrirCourses(f); };
  f.el.querySelector<HTMLElement>('[data-pans]')?.addEventListener('click', () => f.ouvrirMateriaux?.());
  f.el.querySelectorAll<HTMLInputElement>('input[data-ref]').forEach((el) => {
    el.onchange = () => edit((d) => {
      const id = Number(el.dataset.id), v = Math.max(0, nombre(el.value) || 0);
      if (el.dataset.ref === 'stock') { const p = d.stock!.find((x) => x.id === id); if (p) p.prix = v; }
      else if (el.dataset.ref === 'chant') { const m = (d.methods ?? []).find((x) => x.id === id); if (m) m.chantPrix = v; }
      else { const x = d.extras!.find((y) => y.id === id); if (x) { if (el.dataset.k === 'nom') x.nom = el.value; else if (el.dataset.k === 'qte') x.qte = v; else x.prix = v; } }
    });
  });
  f.el.querySelector<HTMLElement>('[data-addx]')!.onclick = () => edit((d) => { d.extras!.push({ id: d.next++, nom: 'Nouvel article', qte: 1, prix: 0 }); });
  f.el.querySelectorAll<HTMLElement>('[data-delx]').forEach((el) => { el.onclick = () => edit((d) => { d.extras = d.extras!.filter((x) => x.id !== Number(el.dataset.delx)); }); });
  f.el.querySelector<HTMLElement>('[data-csv]')!.onclick = () => {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const csv = ['Rayon;Article;Quantité;Unité;Prix unitaire;Total', ...lignes.map((l) => [q(l.rayon), q(l.nom), l.qte, q(l.unite), l.prix.toFixed(2), (l.prix * l.qte).toFixed(2)].join(';'))].join('\n');
    f.telecharger(csv, 'liste-de-courses.csv', 'csv');
  };
}

// ───────── Notice de montage ─────────
// Enregistrée dans le projet : une étape = un titre, un texte, les pièces concernées (bouton « Montrer »).
export function ouvrirNotice(f: Feuille) {
  const d = f.doc(), etapes = d.notice ?? [];
  const nom = (i: number) => d.solids.find((s) => s.id === i)?.name;
  const resume = (ids: number[] = []) => {
    const n = new Map<string, number>();
    for (const i of ids) { const k = nom(i); if (k) n.set(k, (n.get(k) ?? 0) + 1); }
    return [...n].map(([k, q]) => (q > 1 ? `${q} × ${k}` : k)).join(', ');
  };
  ouvrir(f, 'Notice de montage', `<button class="btn" data-ajout>+ Étape</button>${imprimer}`, etapes.length
    ? `<ol class="notice">${etapes.map((e, i) => `<li data-i="${i}">
        <div class="row"><input class="titre" data-k="titre" value="${esc(e.titre)}" aria-label="Titre de l'étape ${i + 1}">
        ${e.ids?.length ? `<button class="btn" data-montrer="${i}" title="${esc(resume(e.ids))}">Montrer</button>` : ''}
        <button class="btn" data-pieces="${i}" title="Remplace les pièces de l'étape par la sélection actuelle">Pièces = sélection</button>
        <button class="btn" data-suppr="${i}" aria-label="Supprimer l'étape">×</button></div>
        <textarea data-k="texte" rows="${Math.max(3, e.texte.split('\n').length + 1)}" aria-label="Texte de l'étape ${i + 1}">${esc(e.texte)}</textarea>
        ${e.ids?.length ? `<p class="note">Pièces : ${esc(resume(e.ids))}</p>` : ''}</li>`).join('')}</ol>`
    : '<p>Pas encore de notice. « + Étape » pour commencer, ou demande-la à l\'assistant.</p>',
  '<span class="note">La notice est enregistrée avec le projet. Pour lier des pièces à une étape : sélectionne-les dans la 3D, puis « Pièces = sélection ».</span>');
  lierImpression(f);
  const changer = (fn: (l: NonNullable<Doc['notice']>) => void) => { const nd = cloneDoc(d); nd.notice ??= []; fn(nd.notice); f.appliquer(nd, 'notice modifiée'); ouvrirNotice(f); };
  f.el.querySelector<HTMLElement>('[data-ajout]')!.onclick = () => changer((l) => l.push({ titre: `Étape ${l.length + 1}`, texte: '' }));
  f.el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('li[data-i] [data-k]').forEach((el) => {
    el.onchange = () => { const i = Number(el.closest('li')!.dataset.i); changer((l) => { l[i]![el.dataset.k as 'titre' | 'texte'] = el.value; }); };
  });
  f.el.querySelectorAll<HTMLElement>('[data-montrer]').forEach((b) => { b.onclick = () => { f.fermer(); f.montrer(etapes[Number(b.dataset.montrer)]!.ids ?? []); }; });
  f.el.querySelectorAll<HTMLElement>('[data-pieces]').forEach((b) => { b.onclick = () => changer((l) => { l[Number(b.dataset.pieces)]!.ids = f.selection(); }); });
  f.el.querySelectorAll<HTMLElement>('[data-suppr]').forEach((b) => { b.onclick = () => changer((l) => { l.splice(Number(b.dataset.suppr), 1); }); });
}
