/**
 * NOTATION — the identity space, and how far the corpus is from it.
 *
 * The standing invariant is *one canonical identity space, many physical
 * representations*. This surface reports the distance between that
 * sentence and the state of the system, which is the only reading of it
 * worth having.
 *
 * Three parts:
 *
 *   ADDRESS   a working resolver. Type a notation:// URI and it either
 *             navigates or refuses with the apparatus that holds it. The
 *             command bar accepts the same input; this is where you go
 *             to learn what the space admits.
 *   KINDS     every kind, its holder, and whether this projection can
 *             answer for it. Most cannot be answered here, and each of
 *             those states which apparatus would and what has to exist
 *             first — a map of where things live rather than a blank.
 *   MEASURED  the id shapes actually present in the served corpus,
 *             counted. "One identity space" is a claim; this is the
 *             number that says how true it currently is.
 *
 * The forbidden kinds are shown, not omitted. credential, session and
 * agent are permanently absent from this space because a URI that can
 * name a credential is a credential that will eventually be
 * dereferenced. An omission nobody can see is indistinguishable from an
 * oversight, so the surface states it as a decision.
 */

import { esc, pick } from '../core/escape';
import type { AppApi } from '../app/api';
import { notationSpace } from '../intel/notation';
import type { NotationSpace } from '../../shared/notation.mjs';
import { fetchBounded, resolveApiBase } from '../data/sources';

const EXAMPLES = [
  'notation://node/apparatus/payload-ocr-agent',
  'notation://entity/mine/escondida',
  'notation://dataset/corpus/current',
  'notation://transform/origin-share/0.1',
  'notation://artifact/abc123',
  'notation://credential/ops/token',
];

export function createNotationPanel(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'pe-corpus pe-nota';
  el.hidden = true;

  /** The space, preferring the service's reading (it carries the measurement). */
  const read = async (): Promise<{ space: NotationSpace; source: 'service' | 'bundle' }> => {
    try {
      const res = await fetchBounded(`${resolveApiBase()}/api/notation/space`, { headers: { Accept: 'application/json' } });
      const body = (await res.json()) as { status?: string; data?: NotationSpace };
      if (body.status === 'ok' && body.data) return { space: body.data, source: 'service' };
    } catch {
      /* fall through — the bundled space is the declaration, minus the measurement */
    }
    return { space: notationSpace(), source: 'bundle' };
  };

  const kindsHtml = (s: NotationSpace): string =>
    s.kinds
      .map((k) => {
        const tone = pick(k.resolvableHere ? 'here' : k.holder ? 'elsewhere' : 'unheld', ['here', 'elsewhere', 'unheld'], 'unheld');
        return `
      <div class="pe-nota-kind ${tone}">
        <div class="pe-nota-khead">
          <span class="pe-nota-kid">${esc(k.id)}</span>
          <span class="pe-nota-pill ${tone}">${esc(k.resolvableHere ? 'RESOLVABLE HERE' : k.holder ? `HELD BY ${k.holder.toUpperCase()}` : 'NO HOLDER')}</span>
          <span class="pe-nota-klabel">${esc(k.label)}</span>
        </div>
        ${k.shape ? `<div class="pe-nota-shape">${esc(k.shape)}</div>` : ''}
        ${k.note ? `<div class="pe-nota-note">${esc(k.note)}</div>` : ''}
        ${k.unavailable ? `<div class="pe-nota-note">NOT HERE — ${esc(k.unavailable)}</div>` : ''}
        ${k.unblockedBy ? `<div class="pe-corpus-remedy">UNBLOCKED BY: ${esc(k.unblockedBy)}</div>` : ''}
      </div>`;
      })
      .join('');

  const measuredHtml = (s: NotationSpace): string => {
    if (!s.observed) {
      return `<div class="pe-corpus-absent">the id-shape census is ABSENT — it is measured by the projection service against the corpus it serves, and this reading came from the bundle</div>
              <div class="pe-corpus-remedy">REMEDY: load the OS against the spatial API (?api=&lt;base&gt;) — GET /api/notation/space carries the count</div>`;
    }
    const o = s.observed;
    const total = o.shapes.reduce((n, x) => n + x.count, 0) || 1;
    return `
      <div class="pe-nota-note">${esc(o.of)} in build <b>${esc(o.corpusBuildId)}</b></div>
      ${o.shapes
        .map(
          (x, i) => `
        <div class="pe-nota-shaperow${i === 0 ? ' primary' : ''}">
          <span class="pe-nota-sname">${esc(x.shape)}</span>
          <span class="pe-nota-sbar"><i style="width:${Math.round((x.count / total) * 100)}%"></i></span>
          <span class="pe-nota-scount">${x.count}</span>
        </div>`
        )
        .join('')}
      <div class="pe-nota-note">${esc(o.note)}</div>`;
  };

  const render = async (): Promise<void> => {
    const shell = (inner: string, counts?: string): string => `
      <div class="pe-patterns-head">
        <span class="pe-nota-kicker">notation://</span>
        <span class="pe-patterns-title">IDENTITY SPACE</span>
        ${counts ? `<span class="pe-nota-split">${counts}</span>` : ''}
        <button type="button" class="pe-patterns-x" title="close (Esc)">×</button>
      </div>
      <div class="pe-corpus-body">${inner}</div>`;

    el.innerHTML = shell('<div class="pe-patterns-lineage">READING THE SPACE…</div>');
    el.querySelector('.pe-patterns-x')?.addEventListener('click', () => setOpen(false));

    const { space: s, source } = await read();
    if (el.hidden) return;

    el.innerHTML = shell(
      `
      <div class="pe-nota-banner">
        <b>${esc(s.invariant)}</b>
        <div class="pe-nota-note">${esc(s.posture)}</div>
        <div class="pe-nota-note">Space read from the ${esc(source)}.</div>
      </div>

      <div class="pe-corpus-sec">
        <div class="pe-corpus-sectitle">ADDRESS — resolve an identity, or learn who holds it</div>
        <div class="pe-nota-addr">
          <input type="text" class="pe-nota-input" spellcheck="false" autocomplete="off"
                 placeholder="notation://entity/mine/escondida" aria-label="notation URI" />
          <button type="button" class="pe-query-chip pe-nota-go">RESOLVE</button>
        </div>
        <div class="pe-nota-out" role="status"></div>
        <div class="pe-nota-egs">${EXAMPLES.map((e) => `<button type="button" class="pe-nota-eg" data-uri="${esc(e)}">${esc(e)}</button>`).join('')}</div>
      </div>

      <div class="pe-corpus-sec">
        <div class="pe-corpus-sectitle">MEASURED — how far this corpus is from one identity space</div>
        ${measuredHtml(s)}
      </div>

      <div class="pe-corpus-sec">
        <div class="pe-corpus-sectitle">KINDS — ${s.counts.resolvableHere} resolvable here · ${s.counts.heldElsewhere} held elsewhere · ${s.counts.unheld} unheld</div>
        ${kindsHtml(s)}
      </div>

      <div class="pe-corpus-sec">
        <div class="pe-corpus-sectitle">PERMANENTLY ABSENT — kinds this space will not admit</div>
        <div class="pe-nota-note">Shown rather than omitted: an omission nobody can see is indistinguishable from an oversight, and each of these is a decision.</div>
        ${s.forbidden
          .map(
            (f) =>
              `<div class="pe-nota-kind forbidden"><div class="pe-nota-khead"><span class="pe-nota-kid">${esc(f.id)}</span><span class="pe-nota-pill forbidden">REFUSED BY DESIGN</span></div><div class="pe-nota-note">${esc(f.why)}</div></div>`
          )
          .join('')}
      </div>`,
      `${s.counts.kinds} KINDS${s.observed ? ` · ${s.observed.distinctShapes} ID SHAPES MINTED` : ''}`
    );

    el.querySelector('.pe-patterns-x')?.addEventListener('click', () => setOpen(false));

    const input = el.querySelector<HTMLInputElement>('.pe-nota-input');
    const out = el.querySelector<HTMLElement>('.pe-nota-out');
    const go = (): void => {
      const uri = input?.value.trim() ?? '';
      if (!uri || !out) return;
      // the same path the command bar takes — one grammar, not two
      const result = api.runCommand(uri);
      out.className = `pe-nota-out ${result.ok ? 'ok' : 'refused'}`;
      out.textContent = result.message;
      if (result.ok) setOpen(false);
    };
    el.querySelector('.pe-nota-go')?.addEventListener('click', go);
    input?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') go();
      // Esc inside the field clears it rather than closing the panel
      if ((e as KeyboardEvent).key === 'Escape' && input.value) {
        input.value = '';
        e.stopPropagation();
      }
    });
    for (const b of el.querySelectorAll<HTMLElement>('.pe-nota-eg')) {
      b.addEventListener('click', () => {
        if (!input) return;
        input.value = b.dataset.uri ?? '';
        go();
      });
    }
  };

  const setOpen = (open: boolean): void => {
    el.hidden = !open;
    if (open) void render();
  };

  window.addEventListener('pe:notation-toggle' as keyof WindowEventMap, () => setOpen(el.hidden));
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || el.hidden) return;
    setOpen(false);
    // consumed — the Esc ladder in main.ts must not also fire
    e.stopImmediatePropagation();
  });

  return { el };
}
