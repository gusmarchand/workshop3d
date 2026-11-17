// Fenêtre « Matériaux et couleurs » : un matériau = un panneau acheté et une couleur unique (faces et chants).
import { SIDES, cloneDoc, couleurParNom, type Doc, type Materiau } from '../kernel/model';
import { DECORS, decorParNom, estDecor } from '../kernel/decor';
import { esc } from './feuilles';

export interface FenetreMateriaux { el: HTMLElement; doc(): Doc; appliquer(d: Doc): void; fermer(): void }
const num = (v: string) => { const n = parseFloat(v.replace(',', '.')); return Number.isNaN(n) ? 0 : n; };
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
let matsAvance = false;
export function renderMethods(f: FenetreMateriaux) {
  const doc = f.doc(), debitEl = f.el;
  const list = doc.methods ?? [];
  const nb = (id: number) => doc.solids.filter((x) => x.meta.methode === id).length;
  debitEl.innerHTML = `<div class="sheet">
    <header><h2>Matériaux et couleurs</h2><button class="btn" id="m-avance">${matsAvance ? 'Moins de réglages' : 'Réglages du chant'}</button><button class="btn primary" id="m-close">Fermer</button></header>
    <div class="ajout-mat"><span class="note">Ajouter :</span>${PRESETS_MAT.map((m, i) => `<button class="puce" data-preset="${i}"><span class="pastille" style="background:${m.couleur}"></span>${esc(m.nom)}</button>`).join('')}<button class="puce" id="m-add">+ Autre</button></div>
    <div class="scroll"><table>
      <thead><tr><th>Couleur</th><th>Nom</th><th title="Le panneau à acheter : c'est ce nom qui relie les pièces au stock">Panneau acheté</th><th title="Aspect à l'écran : veinage, lames, plis. « Auto » le devine d'après le nom">Décor</th><th title="L1 et L2 : les deux grands côtés ; l1 et l2 : les deux petits">Bords plaqués</th>${matsAvance ? '<th>Chant</th><th>Ép. chant mm</th><th>Prix chant €/m</th><th>Déduire le chant</th>' : ''}<th>Pièces</th><th></th></tr></thead>
      <tbody>${list.map((m) => `<tr data-id="${m.id}">
        <td><input type="color" class="couleur" data-k="couleur" value="${m.couleur || couleurParNom(m.nom)}" aria-label="Couleur de ${esc(m.nom)}"></td>
        <td><input data-k="nom" value="${esc(m.nom)}"></td>
        <td><input data-k="matiere" value="${esc(m.matiere)}" placeholder="Mélaminé blanc 18"></td>
        <td><select data-k="decor" aria-label="Décor de ${esc(m.nom)}"><option value="">Auto (${esc(DECORS.find((x) => x.cle === decorParNom(m.nom))!.nom)})</option>${DECORS.map((x) => `<option value="${x.cle}" ${m.decor === x.cle ? 'selected' : ''}>${esc(x.nom)}</option>`).join('')}</select></td>
        <td>${SIDES.map((k) => `<label style="margin-right:8px"><input type="checkbox" style="width:auto" data-side="${k}" ${m.cotes.split(' ').includes(k) ? 'checked' : ''}> ${k}</label>`).join('')}</td>
        ${matsAvance ? `<td><input data-k="chant" value="${esc(m.chant)}" placeholder="ABS 1 mm"></td>
        <td><input class="num" data-k="chantEp" value="${m.chantEp}"></td>
        <td><input class="num" data-k="chantPrix" value="${m.chantPrix ?? 0}"></td>
        <td><input type="checkbox" style="width:auto" data-k="deduire" ${m.deduire ? 'checked' : ''}></td>` : ''}
        <td class="src">${nb(m.id)}</td>
        <td><button class="btn" data-del="${m.id}" title="Supprimer le matériau">×</button></td></tr>`).join('')}</tbody>
    </table></div>
    <footer><span class="note">Une couleur par matériau : faces et chants de la même couleur. Pour peindre des pièces de deux couleurs dans le même panneau (MDF), crée deux matériaux avec le même « panneau acheté ». Pour changer la couleur d'une pièce, sélectionne-la et clique sur un matériau dans le panneau de droite.</span></footer>
  </div>`;
  const edit = (fn: (ms: Materiau[], d: Doc) => void) => { const d = cloneDoc(doc); d.methods ??= []; fn(d.methods, d); f.appliquer(d); renderMethods(f); };
  document.getElementById('m-close')!.onclick = () => f.fermer();
  document.getElementById('m-avance')!.onclick = () => { matsAvance = !matsAvance; renderMethods(f); };
  // Nom unique : « MDF 10 peint », puis « MDF 10 peint 2 »…
  const libre = (ms: Materiau[], base: string) => { let n = base, i = 2; while (ms.some((x) => x.nom.toLowerCase() === n.toLowerCase())) n = `${base} ${i++}`; return n; };
  document.getElementById('m-add')!.onclick = () => edit((ms, d) => { ms.push({ id: d.next++, nom: libre(ms, 'Matériau'), matiere: '', chant: '', chantEp: 0, cotes: '', deduire: false, couleur: '#e9d6ab' }); });
  debitEl.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => {
    b.onclick = () => edit((ms, d) => {
      const p = PRESETS_MAT[Number(b.dataset.preset)]!;
      ms.push({ id: d.next++, nom: libre(ms, p.nom), matiere: p.matiere, chant: p.chant ? 'ABS 1 mm' : '', chantEp: p.chant ? 1 : 0, cotes: p.chant ? 'L1' : '', deduire: false, couleur: p.couleur });
    });
  });
  debitEl.querySelectorAll<HTMLInputElement | HTMLSelectElement>('tr[data-id] input, tr[data-id] select').forEach((el) => {
    el.onchange = () => {
      const id = Number(el.closest('tr')!.dataset.id);
      const tr = el.closest('tr')!;
      edit((ms) => {
        const m = ms.find((x) => x.id === id);
        if (!m) return;
        if (el.dataset.side) m.cotes = [...tr.querySelectorAll<HTMLInputElement>('input[data-side]:checked')].map((c) => c.dataset.side!).join(' ');
        else if (el.dataset.k === 'couleur') m.couleur = el.value;
        else if (el.dataset.k === 'decor') { if (estDecor(el.value)) m.decor = el.value; else delete m.decor; }
        else if (el.dataset.k === 'deduire') m.deduire = (el as HTMLInputElement).checked;
        else if (el.dataset.k === 'chantEp') m.chantEp = Math.max(0, num(el.value));
        else if (el.dataset.k === 'chantPrix') m.chantPrix = Math.max(0, num(el.value));
        else if (el.dataset.k === 'nom') m.nom = el.value.trim() || m.nom;
        else if (el.dataset.k === 'matiere') m.matiere = el.value;
        else if (el.dataset.k === 'chant') m.chant = el.value;
      });
    };
  });
  debitEl.querySelectorAll<HTMLElement>('[data-del]').forEach((el) => {
    el.onclick = () => edit((ms, d) => {
      const id = Number(el.dataset.del);
      ms.splice(ms.findIndex((x) => x.id === id), 1);
      for (const x of d.solids) if (x.meta.methode === id) { delete x.meta.methode; delete x.meta.chants; }
    });
  });
}
