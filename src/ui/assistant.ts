// Assistant intégré : une conversation avec Claude dans l'app, qui agit sur le projet avec les mêmes outils que le serveur MCP.
// La clé API est fournie par l'utilisateur et gardée par la coque (fichier lisible par lui seul), jamais dans le projet.
import Anthropic from '@anthropic-ai/sdk';
import type { BetaContentBlockParam, BetaMessage, BetaMessageParam, BetaTool, BetaToolResultBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { OUTILS, appeler, type Ctx, type Resultat } from '../mcp';
import { esc } from './feuilles';

export interface Hote {
  el: HTMLElement;
  ctx: Ctx;
  lireCle(): Promise<string | null>;
  ecrireCle(cle: string): Promise<void>;
  surBascule?(ouvert: boolean): void;
}

const MODELE = 'claude-opus-5-5';
const SYSTEME = `Tu es l'assistant de conception intégré à Workshop 3D, une app de menuiserie (meubles en panneaux : caissons, dressings, bibliothèques).
Tu agis sur le projet ouvert avec tes outils. Cotes en mm. Repère : X largeur, Y profondeur (façade vers -Y), Z hauteur.
- Si tu ne connais pas encore le projet, commence par \`etat\`.
- Chaque modification que tu fais est une étape que l'utilisateur peut annuler (Cmd+Z). Avant une modification lourde (créer, supprimer, recréer un meuble), dis en une phrase ce que tu vas changer.
- Après une modification, contrôle avec \`verifier\` et, si utile, \`capture\`.
- Raisonne comme un menuisier : épaisseurs et formats réels des panneaux, jeux, quincaillerie, ordre de montage, économie de matière.
- Réponds en français, court et concret, sans Markdown lourd.`;

const OUTILS_API: BetaTool[] = OUTILS.map((o) => ({
  name: o.name,
  description: o.description,
  input_schema: o.inputSchema as BetaTool['input_schema'],
  eager_input_streaming: true,   // les gros arguments arrivent au fil de l'eau ; `appeler` vérifie tout avant d'agir
}));
const TITRES = new Map(OUTILS.map((o) => [o.name, o.title]));

// Résultat d'un outil MCP vers un bloc tool_result de l'API.
function versApi(id: string, r: Resultat): BetaToolResultBlockParam {
  const content = r.content.map((c) => c.type === 'text'
    ? { type: 'text' as const, text: c.text }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: c.mimeType as 'image/jpeg', data: c.data } });
  return { type: 'tool_result', tool_use_id: id, content, ...(r.isError ? { is_error: true } : {}) };
}

export function creerAssistant(h: Hote) {
  let client: Anthropic | null = null;
  let historique: BetaMessageParam[] = [];
  let enCours: { abort(): void } | null = null;
  let arrete = false, actif = false;

  h.el.innerHTML = `<header><b>✦ Assistant</b><span class="vide"></span>
      <button class="btn" data-nouveau title="Nouvelle conversation">Nouveau</button>
      <button class="btn" data-cle title="Clé API">Clé</button>
      <button class="btn" data-fermer title="Fermer">✕</button></header>
    <div class="fil" aria-live="polite"></div>
    <form class="saisie"><textarea rows="3" placeholder="Décris ce que tu veux concevoir ou modifier… (Entrée pour envoyer, Maj+Entrée pour une ligne)"></textarea>
      <button class="btn primary" type="submit">Envoyer</button></form>`;
  const fil = h.el.querySelector<HTMLElement>('.fil')!;
  const form = h.el.querySelector<HTMLFormElement>('.saisie')!;
  const zone = form.querySelector('textarea')!;
  const envoyer = form.querySelector<HTMLButtonElement>('button')!;

  const bas = () => { fil.scrollTop = fil.scrollHeight; };
  const ligne = (cls: string, texte = '') => { const d = document.createElement('div'); d.className = cls; d.textContent = texte; fil.append(d); bas(); return d; };
  const occupe = (oui: boolean) => { actif = oui; envoyer.textContent = oui ? 'Arrêter' : 'Envoyer'; envoyer.classList.toggle('primary', !oui); };

  function formulaireCle(message = '') {
    const f = document.createElement('div');
    f.className = 'msg systeme';
    f.innerHTML = `${message ? `<p>${esc(message)}</p>` : ''}<p>L'assistant utilise l'API Claude avec ta clé (console.anthropic.com, facturée à l'usage). Elle est gardée dans un fichier local lisible par toi seul, jamais dans le projet.</p>
      <div class="row"><input type="password" autocomplete="off" placeholder="sk-ant-…"><button class="btn primary">Enregistrer</button></div>
      <button class="btn" data-oublier>Oublier la clé</button>`;
    const champ = f.querySelector('input')!;
    f.querySelector<HTMLButtonElement>('.primary')!.onclick = async () => {
      const cle = champ.value.trim();
      if (!cle) return;
      await h.ecrireCle(cle);
      client = nouveauClient(cle); f.remove(); ligne('msg systeme', 'Clé enregistrée.'); zone.focus();
    };
    f.querySelector<HTMLButtonElement>('[data-oublier]')!.onclick = async () => { await h.ecrireCle(''); client = null; f.remove(); ligne('msg systeme', 'Clé oubliée.'); };
    fil.append(f); bas(); champ.focus();
  }
  // Le navigateur de l'app parle directement à l'API : pas de serveur intermédiaire, la clé est celle de l'utilisateur.
  const nouveauClient = (apiKey: string) => new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  async function demande(): Promise<BetaMessage> {
    const flux = client!.beta.messages.stream({
      model: MODELE,
      max_tokens: 32000,
      system: SYSTEME,
      tools: OUTILS_API,
      messages: historique,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',          // si un filtre refuse, l'API relance sur le modèle de repli recommandé
    });
    enCours = flux;
    let bulle: HTMLElement | null = null;
    flux.on('text', (t) => { bulle ??= ligne('msg claude'); bulle.textContent += t; bas(); });
    try { return await flux.finalMessage(); } finally { enCours = null; }
  }

  async function tour(texte: string) {
    const avant = historique.length;
    historique.push({ role: 'user', content: texte });
    // Échec avant toute réponse : on retire la demande, pour ne pas laisser deux messages utilisateur d'affilée.
    try { await boucle(avant); } catch (e) { if (historique.length === avant + 1) historique.length = avant; throw e; }
  }

  async function boucle(avant: number) {
    let essais = 0;
    for (;;) {
      let m: BetaMessage;
      try { m = await demande(); essais = 0; } catch (e) {
        // Seul un argument d'outil illisible (flux interrompu au milieu d'un JSON) se relance ; les erreurs de l'API remontent.
        if (arrete || e instanceof Anthropic.APIError || essais++ >= 2) throw e;
        continue;
      }
      if (m.content.some((b) => b.type === 'fallback')) ligne('msg systeme', `Réponse reprise par ${m.model} après un refus du modèle principal.`);
      if (m.stop_reason === 'refusal') {
        historique.length = avant;   // ne pas garder une demande refusée dans la conversation
        ligne('msg erreur', 'Claude a refusé cette demande. Reformule-la.');
        return;
      }
      if (m.stop_reason === 'pause_turn') { historique.push({ role: 'assistant', content: m.content as BetaContentBlockParam[] }); continue; }
      const appels = m.content.filter((b) => b.type === 'tool_use');
      if (m.stop_reason === 'max_tokens') {
        if (appels.length) { historique.length = avant; ligne('msg erreur', 'Réponse trop longue, coupée avant la fin : rien n\'a été appliqué. Découpe la demande.'); return; }
        historique.push({ role: 'assistant', content: m.content as BetaContentBlockParam[] });
        ligne('msg systeme', '(réponse coupée : trop longue)');
        return;
      }
      historique.push({ role: 'assistant', content: m.content as BetaContentBlockParam[] });
      if (!appels.length) return;
      const resultats: BetaToolResultBlockParam[] = [];
      for (const b of appels) {
        if (b.type !== 'tool_use') continue;
        const r = appeler(h.ctx, b.name, b.input);
        ligne(`msg outil${r.isError ? ' rate' : ''}`, `⚙ ${TITRES.get(b.name) ?? b.name}${r.isError ? ' — échec' : ''}`);
        resultats.push(versApi(b.id, r));
      }
      historique.push({ role: 'user', content: resultats });
      if (arrete) return;
    }
  }

  async function soumettre() {
    if (actif) { arrete = true; enCours?.abort(); return; }
    const texte = zone.value.trim();
    if (!texte) return;
    if (!client) { const cle = await h.lireCle(); if (cle) client = nouveauClient(cle); }
    if (!client) { formulaireCle('Il faut d\'abord une clé API.'); return; }
    zone.value = '';
    ligne('msg moi', texte);
    arrete = false; occupe(true);
    try { await tour(texte); } catch (e) {
      if (arrete) ligne('msg systeme', 'Arrêté.');
      else if (e instanceof Anthropic.AuthenticationError) { client = null; formulaireCle('Clé refusée par l\'API.'); }
      else if (e instanceof Anthropic.RateLimitError) ligne('msg erreur', 'Trop de demandes pour l\'instant, réessaie dans un moment.');
      else if (e instanceof Anthropic.APIError) ligne('msg erreur', `Erreur de l'API (${e.status ?? 'réseau'}) : ${e.message}`);
      else ligne('msg erreur', e instanceof Error ? e.message : String(e));
    } finally { occupe(false); zone.focus(); }
  }

  form.onsubmit = (e) => { e.preventDefault(); void soumettre(); };
  zone.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); void soumettre(); } };
  h.el.querySelector<HTMLElement>('[data-nouveau]')!.onclick = () => { if (actif) return; historique = []; fil.innerHTML = ''; zone.focus(); };
  h.el.querySelector<HTMLElement>('[data-cle]')!.onclick = () => formulaireCle();
  h.el.querySelector<HTMLElement>('[data-fermer]')!.onclick = () => basculer(false);

  function basculer(ouvert = !h.el.classList.contains('open')) {
    h.el.classList.toggle('open', ouvert);
    h.surBascule?.(ouvert);
    if (ouvert) zone.focus();
  }
  return { basculer };
}
