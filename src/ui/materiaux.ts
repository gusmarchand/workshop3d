// Fenêtre « Matériaux et panneaux » : tout ce qu'il faut savoir d'un matériau au même endroit.
// Un matériau = une couleur, un décor, des bords plaqués, et le panneau acheté avec ses formats, son stock et ses prix.
// Les prix des panneaux sont ici (et seulement ici) : la découpe les utilise, la liste de courses les additionne.
import { cloneDoc, couleurParNom, type Doc, type Materiau } from '../kernel/model';
import type { DebitRow } from '../kernel/debit';
import { DECORS, decorParNom, estDecor } from '../kernel/decor';
import { brancherChants, chantsSvg } from './chants';
import { esc } from './feuilles';

export interface FenetreMateriaux { el: HTMLElement; doc(): Doc; fiche(): DebitRow[]; appliquer(d: Doc): void; fermer(): void }
const num = (v: string) => { const n = parseFloat(v.replace(',', '.')); return Number.isNaN(n) ? 0 : n; };
const norm = (s: string) => s.trim().toLowerCase();
// Matériaux courants, en un clic. Mélaminé : la couleur est celle du panneau ; MDF, contreplaqué : celle de la peinture ou du vernis.
export const PRESETS_MAT: { nom: string; matiere: string; couleur: string; chant: boolean }[] = [
  { nom: 'Mélaminé blanc 18', matiere: 'Mélaminé blanc 18', couleur: '#f2f2ee', chant: true },
  { nom: 'Mélaminé chêne 18', matiere: 'Mélaminé chêne 18', couleur: '#c69f6b', chant: true },
  { nom: 'Mélaminé gris 18', matiere: 'Mélaminé gris 18', couleur: '#9a9c9e', chant: true },
  { nom: 'Mélaminé noir 18', matiere: 'Mélaminé noir 18', couleur: '#2b2b2d', chant: true },
  { nom: 'MDF 10 peint', matiere: 'MDF 10', couleur: '#e8e4da', chant: false },
  { nom: 'MDF 19 peint', matiere: 'MDF 19', couleur: '#e8e4da', chant: false },
  { nom: 'Contreplaqué 8', matiere: 'Contreplaqué 8', couleur: '#e0c9a0', chant: false },
  { nom: 'Contreplaqué 18', matiere: 'Contreplaqué 18', couleur: '#e0c9a0', chant: false },
  { nom: 'HDF 3', matiere: 'HDF 3', couleur: '#8c6c4c', chant: false },
];
// Formats de panneaux courants en magasin (longueur × largeur, mm).
const FORMATS: [number, number][] = [[2500, 1220], [2440, 1220], [2800, 2070], [2500, 600], [2500, 500], [1200, 600], [2500, 300]];
let matsAvance = false;

// Pièces de la fiche par panneau acheté : épaisseurs utilisées et nombre de pièces.
function usage(fiche: DebitRow[], matiere: string): { e: number; n: number }[] {
  const m = new Map<number, number>();
  for (const r of fiche) if (norm(r.matiere) === norm(matiere)) m.set(r.e, (m.get(r.e) ?? 0) + r.qte);
  return [...m].map(([e, n]) => ({ e, n })).sort((a, b) => a.e - b.e);
}

export function renderMethods(f: FenetreMateriaux) {
  const doc = f.doc(), debitEl = f.el, fiche = f.fiche();
  const list = doc.methods ?? [], stock = doc.stock ?? [];
  const nb = (id: number) => doc.solids.filter((x) => x.meta.methode === id).length;
  const formatsDe = (matiere: string) => stock.filter((p) => norm(p.matiere) === norm(matiere));
  // Un panneau acheté peut servir plusieurs matériaux (le même MDF peint en deux couleurs) : ses formats ne sont montrés qu'une fois.
  const vus = new Set<string>();
  const cellule = (id: number, k: string, v: string | number, titre: string) => `<input class="num" data-st="${id}" data-k="${k}" value="${esc(String(v))}" aria-label="${titre}">`;
  const bloc = (matiere: string, partage: string) => {
    if (!matiere.trim()) return '<p class="note">Donne un nom de panneau acheté pour pouvoir chiffrer la découpe.</p>';
    if (vus.has(norm(matiere))) return `<p class="note">Formats et prix : voir plus haut (même panneau « ${esc(matiere)} »).</p>`;
    vus.add(norm(matiere));
    const fm = formatsDe(matiere), use = usage(fiche, matiere);
    const manquants = use.filter((u) => !fm.some((p) => p.e === u.e));
    return `<div class="formats">
      ${fm.length ? `<table><thead><tr><th>Ép. mm</th><th>Long. mm</th><th>Larg. mm</th><th title="Panneaux ou chutes que tu as déjà : ils sont utilisés en premier">En stock</th><th title="Prix d'un panneau neuf. À 0 : on n'en rachète pas">Prix d'achat €</th><th></th></tr></thead><tbody>${fm.map((p) => `<tr>
        <td>${cellule(p.id, 'e', p.e, 'Épaisseur')}</td><td>${cellule(p.id, 'L', p.L, 'Longueur')}</td><td>${cellule(p.id, 'l', p.l, 'Largeur')}</td><td>${cellule(p.id, 'qte', p.qte, 'En stock')}</td>
        <td>${cellule(p.id, 'prix', p.prix, 'Prix d\'achat')}${p.prix === 0 && p.qte === 0 ? '<span class="badge attention" title="Sans prix, ce panneau n\'est pas compté dans le coût">prix ?</span>' : ''}</td>
        <td><button class="btn" data-delf="${p.id}" title="Supprimer ce format">×</button></td></tr>`).join('')}</tbody></table>` : ''}
      ${manquants.map((u) => `<p class="warn">Il manque un format pour ${u.n} pièce${u.n > 1 ? 's' : ''} de ${u.e} mm : ${FORMATS.slice(0, 3).map(([L, l]) => `<button class="btn" data-addf="${esc(matiere)}" data-e="${u.e}" data-long="${L}" data-larg="${l}">${L} × ${l}</button>`).join(' ')}</p>`).join('')}
      <p><select data-addsel="${esc(matiere)}" data-e="${use[0]?.e ?? 18}" aria-label="Ajouter un format"><option value="">+ Format…</option>${FORMATS.map(([L, l]) => `<option value="${L}x${l}">${L} × ${l}</option>`).join('')}</select> ${partage}</p>
    </div>`;
  };
  const cartes = list.map((m) => {
    const partage = list.filter((x) => x.id !== m.id && norm(x.matiere) === norm(m.matiere) && m.matiere.trim()).map((x) => x.nom);
    return `<div class="mat" data-id="${m.id}">
      <div class="mat-tete">
        <input type="color" class="couleur" data-k="couleur" value="${m.couleur || couleurParNom(m.nom)}" aria-label="Couleur de ${esc(m.nom)}">
        <input data-k="nom" value="${esc(m.nom)}" aria-label="Nom du matériau" class="nom">
        <select data-k="decor" aria-label="Décor de ${esc(m.nom)}" title="Aspect à l'écran seulement (veinage, lames, plis)"><option value="">Décor auto : ${esc(DECORS.find((x) => x.cle === decorParNom(m.nom))!.nom)}</option>${DECORS.map((x) => `<option value="${x.cle}" ${m.decor === x.cle ? 'selected' : ''}>${esc(x.nom)}</option>`).join('')}</select>
        <span class="src">${nb(m.id)} pièce${nb(m.id) > 1 ? 's' : ''}</span>
        <button class="btn" data-del="${m.id}" title="Supprimer le matériau">×</button>
      </div>
      <div class="mat-corps">
        <div class="mat-chants"><span class="note">Bords plaqués</span>${chantsSvg(m.cotes.split(' ').filter(Boolean))}</div>
        <div class="mat-panneau">
          <label title="Le panneau à acheter : c'est ce nom qui relie les pièces au stock. Deux matériaux peuvent partager un panneau (un MDF peint en deux couleurs).">Panneau acheté <input data-k="matiere" value="${esc(m.matiere)}" placeholder="Mélaminé blanc 18" list="pans"></label>
          ${bloc(m.matiere, partage.length ? `<span class="note">Aussi utilisé par ${esc(partage.join(', '))}.</span>` : '')}
        </div>
      </div>
      ${matsAvance ? `<div class="mat-chant-avance"><label>Chant <input data-k="chant" value="${esc(m.chant)}" placeholder="ABS 1 mm"></label><label>Épaisseur mm <input class="num" data-k="chantEp" value="${m.chantEp}"></label><label>Prix €/m <input class="num" data-k="chantPrix" value="${m.chantPrix ?? 0}"></label><label title="Retire l'épaisseur du chant des cotes de coupe"><input type="checkbox" data-k="deduire" ${m.deduire ? 'checked' : ''}> Déduire le chant</label></div>` : ''}
    </div>`;
  }).join('');
  // Panneaux de la fiche ou du stock qui ne correspondent à aucun matériau
  const connus = new Set(list.map((m) => norm(m.matiere)).filter(Boolean));
  const orphelins = [...new Set([...fiche.map((r) => r.matiere), ...stock.map((p) => p.matiere)].filter((x) => x && !connus.has(norm(x))))];
  const sections = orphelins.map((o) => `<div class="mat"><div class="mat-tete"><b class="nom">${esc(o)}</b><span class="note">Panneau sans matériau : ses pièces ont une matière écrite à la main.</span></div><div class="mat-corps"><div class="mat-panneau">${bloc(o, '')}</div></div></div>`).join('');
  debitEl.innerHTML = `<div class="sheet">
    <header><h2>Matériaux et panneaux</h2><button class="btn" id="m-avance" title="Épaisseur et prix du chant, déduction du chant">${matsAvance ? 'Moins de réglages' : 'Réglages du chant'}</button><button class="btn primary" id="m-close">Fermer</button></header>
    <div class="ajout-mat"><span class="note">Ajouter :</span>${PRESETS_MAT.map((m, i) => `<button class="puce" data-preset="${i}"><span class="pastille" style="background:${m.couleur}"></span>${esc(m.nom)}</button>`).join('')}<button class="puce" id="m-add">+ Autre</button></div>
    <div class="scroll">${list.length || orphelins.length ? cartes + sections : '<p class="note" style="padding:16px">Aucun matériau pour l\'instant. Choisis-en un ci-dessus, ou crée un meuble : ses matériaux apparaissent ici.</p>'}
      <datalist id="pans">${[...new Set([...list.map((m) => m.matiere), ...stock.map((p) => p.matiere)].filter(Boolean))].map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div>
    <footer><span class="note">Un matériau, c'est l'aspect (couleur, décor, bords plaqués) et le panneau acheté. Les prix sont ici : la découpe les utilise et la liste de courses les additionne. Pour changer le matériau d'une pièce, sélectionne-la et clique sur sa pastille dans le panneau de droite.</span></footer>
  </div>`;
  const edit = (fn: (d: Doc) => void) => { const d = cloneDoc(doc); d.methods ??= []; d.stock ??= []; fn(d); f.appliquer(d); renderMethods(f); };
  document.getElementById('m-close')!.onclick = () => f.fermer();
  document.getElementById('m-avance')!.onclick = () => { matsAvance = !matsAvance; renderMethods(f); };
  // Nom unique : « MDF 10 peint », puis « MDF 10 peint 2 »…
  const libre = (ms: Materiau[], base: string) => { let n = base, i = 2; while (ms.some((x) => x.nom.toLowerCase() === n.toLowerCase())) n = `${base} ${i++}`; return n; };
  document.getElementById('m-add')!.onclick = () => edit((d) => { d.methods!.push({ id: d.next++, nom: libre(d.methods!, 'Matériau'), matiere: '', chant: '', chantEp: 0, cotes: '', deduire: false, couleur: '#e9d6ab' }); });
  debitEl.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => {
    b.onclick = () => edit((d) => {
      const p = PRESETS_MAT[Number(b.dataset.preset)]!;
      d.methods!.push({ id: d.next++, nom: libre(d.methods!, p.nom), matiere: p.matiere, chant: p.chant ? 'ABS 1 mm' : '', chantEp: p.chant ? 1 : 0, cotes: p.chant ? 'L1' : '', deduire: false, couleur: p.couleur });
    });
  });
  // matériaux : nom, couleur, décor, panneau, chant
  debitEl.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.mat[data-id] input[data-k], .mat[data-id] select[data-k]').forEach((el) => {
    el.onchange = () => {
      const id = Number(el.closest<HTMLElement>('.mat')!.dataset.id);
      edit((d) => {
        const m = d.methods!.find((x) => x.id === id);
        if (!m) return;
        if (el.dataset.k === 'couleur') m.couleur = el.value;
        else if (el.dataset.k === 'decor') { if (estDecor(el.value)) m.decor = el.value; else delete m.decor; }
        else if (el.dataset.k === 'deduire') m.deduire = (el as HTMLInputElement).checked;
        else if (el.dataset.k === 'chantEp') m.chantEp = Math.max(0, num(el.value));
        else if (el.dataset.k === 'chantPrix') m.chantPrix = Math.max(0, num(el.value));
        else if (el.dataset.k === 'nom') m.nom = el.value.trim() || m.nom;
        else if (el.dataset.k === 'matiere') {
          // renommer le panneau acheté renomme aussi ses formats, sauf si un autre matériau s'en sert encore
          const ancien = m.matiere, nouveau = el.value.trim();
          m.matiere = nouveau;
          if (norm(ancien) !== norm(nouveau) && ancien && !d.methods!.some((x) => x.id !== id && norm(x.matiere) === norm(ancien))) for (const p of d.stock!) if (norm(p.matiere) === norm(ancien)) p.matiere = nouveau;
        }
        else if (el.dataset.k === 'chant') m.chant = el.value;
      });
    };
  });
  debitEl.querySelectorAll<HTMLElement>('.mat[data-id]').forEach((carte) => {
    const id = Number(carte.dataset.id);
    brancherChants(carte, (cotes) => edit((d) => { const m = d.methods!.find((x) => x.id === id); if (m) m.cotes = cotes.join(' '); }));
  });
  debitEl.querySelectorAll<HTMLElement>('[data-del]').forEach((el) => {
    el.onclick = () => edit((d) => {
      const id = Number(el.dataset.del);
      d.methods!.splice(d.methods!.findIndex((x) => x.id === id), 1);
      for (const x of d.solids) if (x.meta.methode === id) { delete x.meta.methode; delete x.meta.chants; }
    });
  });
  // formats : modifier, supprimer, ajouter
  debitEl.querySelectorAll<HTMLInputElement>('input[data-st]').forEach((el) => {
    el.onchange = () => edit((d) => {
      const r = d.stock!.find((x) => x.id === Number(el.dataset.st));
      if (!r) return;
      const v = Math.max(0, num(el.value));
      if (el.dataset.k === 'e') r.e = v; else if (el.dataset.k === 'L') r.L = v; else if (el.dataset.k === 'l') r.l = v; else if (el.dataset.k === 'qte') r.qte = Math.floor(v); else r.prix = v;
    });
  });
  debitEl.querySelectorAll<HTMLElement>('[data-delf]').forEach((el) => { el.onclick = () => edit((d) => { d.stock = d.stock!.filter((x) => x.id !== Number(el.dataset.delf)); }); });
  const ajouter = (matiere: string, e: number, L: number, l: number) => edit((d) => { d.stock!.push({ id: d.next++, matiere, e, L, l, qte: 0, prix: 0 }); });
  debitEl.querySelectorAll<HTMLElement>('[data-addf]').forEach((el) => { el.onclick = () => ajouter(el.dataset.addf!, Number(el.dataset.e), Number(el.dataset.long), Number(el.dataset.larg)); });
  debitEl.querySelectorAll<HTMLSelectElement>('select[data-addsel]').forEach((el) => {
    el.onchange = () => { const [L, l] = el.value.split('x').map(Number); if (L && l) ajouter(el.dataset.addsel!, Number(el.dataset.e), L, l); };
  });
}
