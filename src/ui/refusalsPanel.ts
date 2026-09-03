/**
 * Refusals work queue — the refused:* digest as an OS surface.
 *
 * Everything the upstream DECLINED to answer while building its
 * state, grouped by refusal mechanism: each group is ONE mechanism
 * with ONE shared remedy, ranked by how often it blocked an answer.
 * This is a work order, not an error log — fixing the top group
 * unblocks the most answers — and it is the most honest artifact a
 * corpus can publish about itself: the absences, stated.
 *
 * Fetched per corpus commodity from GET /api/refusals; a corpus with
 * no upstream queue refuses with a remedy, and that refusal renders
 * here (a refusals surface that hid its own refusal would be absurd).
 */

import { esc } from '../core/escape';
import type { AppApi } from '../app/api';
import { resolveApiBase } from '../data/sources';


interface RefusalsDigest {
  commodity: string;
  asOf: string | null;
  knowledge: string;
  generatedAt: string;
  totalRefusals: number;
  byType: {
    type: string;
    count: number;
    remedy: string;
    items: { title: string; evidenceIds: string[] }[];
  }[];
  note?: string;
}

export function createRefusalsPanel(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  // pe-corpus carries the overlay geometry + Esc guard; pe-refusals
  // restyles to the warn identity — this is a work queue
  el.className = 'pe-corpus pe-refusals';
  el.hidden = true;

  const digestHtml = (d: RefusalsDigest): string => {
    const groups = d.byType
      .map(
        (g) => `
      <div class="pe-corpus-sec">
        <div class="pe-corpus-sectitle">${esc(g.type.replace(/_/g, ' ').toUpperCase())} · ${g.count} REFUSED</div>
        <div class="pe-refusals-remedy"><span class="pe-corpus-k">ONE SHARED REMEDY</span><span class="pe-corpus-v">${esc(g.remedy)}</span></div>
        ${g.items
          .slice(0, 5)
          .map(
            (it) =>
              `<div class="pe-corpus-row"><span class="pe-corpus-k">${it.evidenceIds.length} EVIDENCE</span><span class="pe-corpus-v">${esc(it.title)}</span></div>`
          )
          .join('')}
        ${g.items.length > 5 ? `<div class="pe-corpus-census">+${g.items.length - 5} more under the same mechanism — the remedy above fixes all of them</div>` : ''}
      </div>`
      )
      .join('');
    return `
      <div class="pe-refusals-head">${esc(d.commodity.toUpperCase())} — ${d.totalRefusals} REFUSALS · KNOWLEDGE ${esc(d.knowledge)} · GENERATED ${esc(d.generatedAt.slice(0, 16))}Z</div>
      ${d.totalRefusals === 0 ? '<div class="pe-corpus-census">0 refusals — every upstream record answered (an observed zero)</div>' : groups}`;
  };

  const render = async (): Promise<void> => {
    el.innerHTML = '<div class="pe-patterns-lineage">READING THE REFUSED:* QUEUE…</div>';
    const commodities = api.store.snapshot.commodities.map((c) => c.id.split(':').pop() ?? c.id);
    const head = `
      <div class="pe-patterns-head">
        <span class="pe-refusals-kicker">REFUSED</span>
        <span class="pe-patterns-title">REFUSALS WORK QUEUE</span>
        <button type="button" class="pe-patterns-x" title="close (Esc)">×</button>
      </div>
      <div class="pe-refusals-banner">Everything the upstream DECLINED to answer, grouped by mechanism — each group carries one shared remedy, ranked by how often it blocked an answer. A work order: fix the top group, unblock the most answers.</div>`;
    if (api.getDataSourceId() !== 'payload-spatial-api') {
      el.innerHTML = `${head}<div class="pe-corpus-body">
        <div class="pe-corpus-absent">the in-browser corpus keeps no upstream refusal queue — an authored corpus declines nothing during a compile</div>
        <div class="pe-corpus-remedy">REMEDY: run against the spatial API (?api=&lt;base&gt;) on the terminal corpus — GET /api/refusals serves the digest</div>
      </div>`;
      el.querySelector('.pe-patterns-x')!.addEventListener('click', () => setOpen(false));
      return;
    }
    const sections: string[] = [];
    for (const slug of commodities.length ? commodities : ['copper']) {
      try {
        const res = await fetch(`${resolveApiBase()}/api/refusals?commodity=${encodeURIComponent(slug)}`);
        const body = (await res.json()) as {
          status?: string;
          data?: RefusalsDigest;
          refusal?: { kind: string; message: string; remedy: string };
        };
        if (body.status === 'ok' && body.data) {
          sections.push(digestHtml(body.data));
        } else if (body.refusal) {
          sections.push(
            `<div class="pe-corpus-absent">${esc(slug.toUpperCase())}: ${esc(body.refusal.kind.replace(/_/g, ' '))} — ${esc(body.refusal.message)}</div><div class="pe-corpus-remedy">${esc(body.refusal.remedy)}</div>`
          );
        }
      } catch {
        sections.push(`<div class="pe-corpus-absent">${esc(slug.toUpperCase())}: the spatial API did not answer /api/refusals</div>`);
      }
    }
    if (el.hidden) return;
    el.innerHTML = `${head}<div class="pe-corpus-body">${sections.join('')}</div>`;
    el.querySelector('.pe-patterns-x')!.addEventListener('click', () => setOpen(false));
  };

  const setOpen = (open: boolean): void => {
    el.hidden = !open;
    if (open) void render();
  };

  window.addEventListener('pe:refusals-toggle' as keyof WindowEventMap, () => setOpen(el.hidden));
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || el.hidden) return;
    setOpen(false);
    // consumed — the Esc ladder in main.ts must not also fire
    e.stopImmediatePropagation();
  });

  return { el };
}
