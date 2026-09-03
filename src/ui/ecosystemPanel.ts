/**
 * ECOSYSTEM — Notation Systems, and where this OS sits inside it.
 *
 * Notation Systems builds and operates provenance-bearing computational
 * corpora. It does that through several apparatuses, each owning one
 * stage of the corpus lifecycle and refusing the others. This surface is
 * the navigation environment over that set — the same relationship this
 * OS has to the corpus, one level up.
 *
 * Four things, and the order is the argument:
 *
 *   THE SPINE     the corpus lifecycle with its owners placed on it, and
 *                 the unowned stage rendered as the empty slot it is. A
 *                 map that dropped the hole would show a complete
 *                 ecosystem that does not exist.
 *   APPARATUSES   what each holds and — the informative half — what it
 *                 REFUSES. A boundary is what makes an apparatus one
 *                 thing rather than a pile of code.
 *   CONVERGENCE   what the trees independently agree on. None of it was
 *                 coordinated, which is why it is worth reading: a
 *                 convention adopted once is a preference, one arrived
 *                 at four times under different pressures is a
 *                 constraint.
 *   DIVERGENCE    where they do not agree, with the proposal and the
 *                 owner named. Surfaced, never silently resolved —
 *                 unifying four vocabularies is a substrate decision
 *                 with migration cost in four trees, and this surface
 *                 does not get to take it by rendering it away.
 *
 * The presence vocabulary reuses this OS's own semantics rather than
 * inventing a fourth: SOLID for observed, HOLLOW for declared, GREY for
 * unobserved. An apparatus we reached is solid; one whose tree we read
 * but did not probe is hollow; one that is a name and a repository is
 * grey and dashed.
 */

import { esc, pick } from '../core/escape';
import type { AppApi } from '../app/api';
import { readRegister, type Apparatus, type EcosystemRegister, type RegisterRead } from '../intel/ecosystem';

const PRESENCE_TONE: Record<string, string> = {
  OBSERVED: 'observed',
  PRESENT: 'declared',
  DECLARED: 'unbuilt',
  SCAFFOLD: 'unbuilt',
};

const PRESENCE_GLOSS: Record<string, string> = {
  OBSERVED: 'this OS reached it and it answered',
  PRESENT: 'its tree carries source; not probed from here',
  DECLARED: 'a repository exists and carries no implementation',
  SCAFFOLD: 'a starter tree, not yet made into anything',
};

export function createEcosystemPanel(_api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'pe-corpus pe-eco';
  el.hidden = true;

  // ------------------------------------------------------------ spine

  // Seven stages share one row, so the spine carries the SHAPE — label,
  // owners, and which slot is empty — and nothing else. The questions
  // are prose and read as prose underneath; cramming them into the
  // graphic made the graphic scroll, which put the empty GRAPH PLANE
  // slot (the whole point of the picture) off-screen.
  const spineHtml = (r: EcosystemRegister): string => {
    const cells = r.lifecycle
      .map((stage) => {
        const owners = r.apparatuses.filter((a) => a.stages.includes(stage.id));
        const built = owners.filter((a) => a.presence !== 'DECLARED' && a.presence !== 'SCAFFOLD');
        const unowned = built.length === 0;
        return `
        <div class="pe-eco-stage${unowned ? ' unowned' : ''}" title="${esc(stage.question)}">
          <div class="pe-eco-stagelabel">${esc(stage.label)}</div>
          <div class="pe-eco-owners">
            ${
              owners.length
                ? owners
                    .map(
                      (a) =>
                        `<span class="pe-eco-chip ${pick(PRESENCE_TONE[a.presence] ?? 'unbuilt', ['observed', 'declared', 'unbuilt'], 'unbuilt')}" title="${esc(a.label)} — ${esc(a.presenceBasis)}">${esc(a.short)}</span>`
                    )
                    .join('')
                : '<span class="pe-eco-chip empty">NO OWNER</span>'
            }
          </div>
        </div>`;
      })
      .join('<div class="pe-eco-arrow">›</div>');
    const questions = r.lifecycle
      .map(
        (s) =>
          `<div class="pe-eco-q"><span class="pe-eco-qlabel">${esc(s.label)}</span><span class="pe-eco-qtext">${esc(s.question)}</span></div>`
      )
      .join('');
    return `<div class="pe-eco-spine">${cells}</div><div class="pe-eco-questions">${questions}</div>`;
  };

  // ------------------------------------------------------- apparatuses

  const apparatusHtml = (a: Apparatus): string => {
    const tone = pick(PRESENCE_TONE[a.presence] ?? 'unbuilt', ['observed', 'declared', 'unbuilt'], 'unbuilt');
    const state = pick(a.presence, ['OBSERVED', 'PRESENT', 'DECLARED', 'SCAFFOLD'], 'DECLARED');
    return `
      <div class="pe-eco-app ${tone}">
        <div class="pe-eco-apphead">
          <span class="pe-eco-appname">${esc(a.label)}</span>
          <span class="pe-eco-pill ${tone}">${esc(state)}</span>
          <span class="pe-eco-uri">${esc(a.notation)}</span>
        </div>
        <div class="pe-eco-basis">${esc(a.presenceBasis)}</div>
        ${a.declares ? `<div class="pe-eco-declares">${esc(a.declares)}</div>` : ''}
        ${
          a.absence
            ? `<div class="pe-eco-reason">WHY NOT BUILT — ${esc(a.absence.reason)}</div>
               <div class="pe-corpus-remedy">UNBLOCKED BY: ${esc(a.absence.unblockedBy)}</div>`
            : ''
        }
        ${
          a.holds.length
            ? `<div class="pe-eco-row"><span class="pe-eco-k">HOLDS</span><span class="pe-eco-v">${a.holds.map((h) => `<i>${esc(h)}</i>`).join('')}</span></div>`
            : ''
        }
        ${
          a.refuses.length
            ? `<div class="pe-eco-row refuses"><span class="pe-eco-k">REFUSES</span><span class="pe-eco-v">${a.refuses.map((h) => `<i>${esc(h)}</i>`).join('')}</span></div>`
            : ''
        }
        ${
          a.vocabulary
            ? `<div class="pe-eco-row"><span class="pe-eco-k">SPEAKS</span><span class="pe-eco-v"><b>${esc(a.vocabulary.name)}</b> — ${esc(a.vocabulary.terms.join(' · '))}<div class="pe-eco-note">${esc(a.vocabulary.note)}</div></span></div>`
            : ''
        }
        <div class="pe-eco-read">read from ${a.readFrom.map((p) => `<code>${esc(p)}</code>`).join(' · ')}</div>
      </div>`;
  };

  // ------------------------------------------- convergence / divergence

  const convergenceHtml = (r: EcosystemRegister): string =>
    r.convergences
      .map(
        (c) => `
      <div class="pe-eco-conv">
        <div class="pe-eco-convhead">
          <span class="pe-eco-convstate">${esc(c.statement)}</span>
          <span class="pe-eco-seen">${c.seenIn.length}× ${esc(c.seenIn.join(' · '))}</span>
        </div>
        <div class="pe-eco-note">${esc(c.evidence)}</div>
      </div>`
      )
      .join('');

  const divergenceHtml = (r: EcosystemRegister): string =>
    r.divergences
      .map((d) => {
        const sev = pick(d.severity, ['structural', 'gap'], 'gap');
        return `
      <div class="pe-eco-div ${sev}">
        <div class="pe-eco-divhead">
          <span class="pe-eco-pill open">${esc(sev.toUpperCase())}</span>
          <span class="pe-eco-divstate">${esc(d.statement)}</span>
        </div>
        <div class="pe-eco-detail">${d.detail.map((x) => `<div>${esc(x)}</div>`).join('')}</div>
        <div class="pe-eco-note">WHY IT MATTERS — ${esc(d.whyItMatters)}</div>
        <div class="pe-corpus-remedy">PROPOSED: ${esc(d.proposal)}</div>
        <div class="pe-eco-owner">DECISION OWNED BY ${esc(d.ownedBy.toUpperCase())} — this surface reports it, it does not take it</div>
      </div>`;
      })
      .join('');

  // ----------------------------------------------------------- render

  const body = (read: RegisterRead): string => {
    const r = read.register;
    const holes = r.counts.stagesUnowned;
    return `
      <div class="pe-eco-banner">
        <b>${esc(r.organization.declares)}</b>
        <div class="pe-eco-note">${esc(r.basis)}</div>
        <div class="pe-eco-note">Register ${esc(read.source)} — ${esc(read.note)}.</div>
      </div>

      <div class="pe-corpus-sec">
        <div class="pe-corpus-sectitle">THE CORPUS LIFECYCLE — who owns which stage</div>
        ${spineHtml(r)}
        ${
          holes.length
            ? `<div class="pe-eco-hole">${holes.length} stage${holes.length === 1 ? '' : 's'} with no built owner: <b>${esc(holes.join(', ').toUpperCase())}</b>. Structure for that stage is currently computed per-read inside apparatuses that are forbidden to hold it. That is correct for now, and stops being correct the moment such a record needs to be evidenced and versioned in its own right.</div>`
            : '<div class="pe-corpus-census">every lifecycle stage has a built owner — an observed completeness, as of this reading</div>'
        }
      </div>

      <div class="pe-corpus-sec">
        <div class="pe-corpus-sectitle">APPARATUSES — ${r.counts.observed} observed · ${r.counts.present} present · ${r.counts.declared} declared · ${r.counts.scaffold} scaffold</div>
        <div class="pe-eco-note">Presence is stated, never inferred from a name. ${Object.entries(PRESENCE_GLOSS)
          .map(([k, v]) => `<b>${esc(k)}</b> ${esc(v)}`)
          .join(' · ')}.</div>
        ${r.apparatuses.map(apparatusHtml).join('')}
      </div>

      <div class="pe-corpus-sec">
        <div class="pe-corpus-sectitle">CONVERGENCE — what the trees agree on without having been told to</div>
        <div class="pe-eco-note">None of this was coordinated. A convention adopted once is a preference; one arrived at independently in four trees, under different pressures, is a constraint the work keeps rediscovering.</div>
        ${convergenceHtml(r)}
      </div>

      <div class="pe-corpus-sec">
        <div class="pe-corpus-sectitle">DIVERGENCE — where they do not, and who decides</div>
        <div class="pe-eco-note">Surfaced, not resolved. Choosing one vocabulary over another carries migration cost in four trees; it belongs to whoever owns the substrate, not to the surface that noticed. What this register owes is an accurate statement of the disagreement and a proposal that can be rejected on its merits.</div>
        ${divergenceHtml(r)}
      </div>`;
  };

  const render = async (): Promise<void> => {
    const shell = (inner: string, counts?: string): string => `
      <div class="pe-patterns-head">
        <span class="pe-eco-kicker">NOTATION SYSTEMS</span>
        <span class="pe-patterns-title">APPARATUS REGISTER</span>
        ${counts ? `<span class="pe-eco-split">${counts}</span>` : ''}
        <button type="button" class="pe-patterns-x" title="close (Esc)">×</button>
      </div>
      <div class="pe-corpus-body">${inner}</div>`;

    el.innerHTML = shell('<div class="pe-patterns-lineage">READING THE REGISTER…</div>');
    el.querySelector('.pe-patterns-x')?.addEventListener('click', () => setOpen(false));

    const read = await readRegister();
    if (el.hidden) return;
    const c = read.register.counts;
    el.innerHTML = shell(
      body(read),
      `${c.apparatuses} APPARATUSES · ${c.stagesUnowned.length} STAGE${c.stagesUnowned.length === 1 ? '' : 'S'} UNOWNED`
    );
    el.querySelector('.pe-patterns-x')?.addEventListener('click', () => setOpen(false));
  };

  const setOpen = (open: boolean): void => {
    el.hidden = !open;
    if (open) void render();
  };

  window.addEventListener('pe:ecosystem-toggle' as keyof WindowEventMap, () => setOpen(el.hidden));
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || el.hidden) return;
    setOpen(false);
    // consumed — the Esc ladder in main.ts must not also fire
    e.stopImmediatePropagation();
  });

  return { el };
}
