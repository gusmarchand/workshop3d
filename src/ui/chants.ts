// Schéma d'une pièce vue de dessus, avec ses quatre côtés cliquables (bords plaqués).
// L1 et L2 sont les deux grands côtés, l1 et l2 les deux petits : le schéma évite d'avoir à le savoir.
// L'appelant branche le clic avec `brancherChants`.
export function chantsSvg(actifs: string[], titre = 'Bords plaqués'): string {
  const on = (k: string) => (actifs.includes(k) ? ' on' : '');
  return `<svg class="chants" viewBox="0 0 72 44" role="group" aria-label="${titre}">
    <rect class="face" x="10" y="9" width="52" height="26" rx="1"/>
    <rect class="cote${on('L1')}" data-side="L1" x="10" y="3" width="52" height="7" rx="2"><title>Grand côté 1 (L1)</title></rect>
    <rect class="cote${on('L2')}" data-side="L2" x="10" y="34" width="52" height="7" rx="2"><title>Grand côté 2 (L2)</title></rect>
    <rect class="cote${on('l1')}" data-side="l1" x="3" y="9" width="7" height="26" rx="2"><title>Petit côté 1 (l1)</title></rect>
    <rect class="cote${on('l2')}" data-side="l2" x="62" y="9" width="7" height="26" rx="2"><title>Petit côté 2 (l2)</title></rect>
  </svg>`;
}
// Un clic sur un côté l'active ou le désactive ; `change` reçoit la liste des côtés actifs (« L1 l2 »…).
export function brancherChants(racine: ParentNode, change: (cotes: string[]) => void) {
  racine.querySelectorAll<SVGElement>('svg.chants').forEach((svg) => {
    svg.querySelectorAll<SVGElement>('.cote').forEach((c) => {
      c.onclick = () => {
        c.classList.toggle('on');
        change([...svg.querySelectorAll<SVGElement>('.cote.on')].map((x) => x.dataset.side!));
      };
    });
  });
}
