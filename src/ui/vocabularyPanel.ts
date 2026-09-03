/**
 * PROVENANCE VOCABULARY — four words for one idea, and what fixing it costs.
 *
 * The apparatus register recorded the divergence; this surface makes it
 * decidable. It leads with the MEASURED migration impact rather than the
 * argument, because the question in front of whoever owns the substrate
 * is not "are these words different" — they can see that — but "what does
 * adopting one of them actually cost, and what does it leave undecided".
 *
 * PROPOSED, and it must never stop looking proposed. Nothing here
 * relabels a record. No other surface in this OS may render a proposed
 * canonical term as if it were a record's own label; that would be the
 * silent relabelling this whole exercise exists to stop.
 *
 * The relation chips carry the real information, and their colours are
 * the argument in miniature:
 *
 *   SAME        green   one idea, two words — adoption is a rename
 *   NARROWS     accent  a special case worth keeping distinct in the UI
 *   ORTHOGONAL  amber   a HAZARD: merging these destroys a fact
 *   UNMAPPED    alert   not a synonym for anything; needs a human
 *
 * ORTHOGONAL is amber rather than green precisely because it looks like
 * agreement and is not: `estimated` and `observed` sitting in one enum
 * reads as a tidy list and quietly discards the origin of every
 * estimate.
 */

import { esc, pick } from '../core/escape';
import type { AppApi } from '../app/api';
import { vocabularyAlignment } from '../../shared/vocabulary.mjs';
import type { VocabularyAlignment } from '../../shared/vocabulary.mjs';
import { fetchBounded, resolveApiBase } from '../data/sources';

const RELATION_TONE: Record<string, string> = {
  SAME: 'same',
  NARROWS: 'narrows',
  ORTHOGONAL: 'orthogonal',
  UNMAPPED: 'unmapped',
  UNKNOWN: 'unmapped',
};

export function createVocabularyPanel(_api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'pe-corpus pe-voc';
  el.hidden = true;

  /** Prefer the service: only it carries the measurement. */
  const read = async (): Promise<{ a: VocabularyAlignment; source: 'service' | 'bundle' }> => {
    try {
      const res = await fetchBounded(`${resolveApiBase()}/api/vocabulary/alignment`, { headers: { Accept: 'application/json' } });
      const body = (await res.json()) as { status?: string; data?: VocabularyAlignment };
      if (body.status === 'ok' && body.data) return { a: body.data, source: 'service' };
    } catch {
      /* the bundled alignment is the argument, without the count */
    }
    return { a: vocabularyAlignment(), source: 'bundle' };
  };

  const impactHtml = (a: VocabularyAlignment): string => {
    if (!a.impact) {
      return `<div class="pe-corpus-absent">the migration impact is ABSENT — it is counted from the records by the projection service, and this reading came from the bundle</div>
              <div class="pe-corpus-remedy">REMEDY: load the OS against the spatial API (?api=&lt;base&gt;) — GET /api/vocabulary/alignment carries the count</div>`;
    }
    const i = a.impact;
    // an unlabelled corpus is an ABSENCE, not zero of each label. A table
    // of zeroes here would read as "nothing to migrate" when the truth is
    // "nothing to migrate FROM" — the larger finding of the two.
    if (i.status === 'ABSENT') {
      return `<div class="pe-corpus-absent">${esc(i.reason ?? 'nothing to align')}</div>
              <div class="pe-corpus-remedy">UNBLOCKED BY: ${esc(i.unblockedBy ?? 'a corpus that labels value provenance')}</div>
              ${a.measuredOver ? `<div class="pe-voc-note">Counted over build <b>${esc(a.measuredOver.corpusBuildId)}</b> — ${esc(a.measuredOver.of)}.</div>` : ''}`;
    }
    const total = i.total || 1;
    return `
      <div class="pe-voc-tot">
        <span class="pe-voc-fig ok">${i.renamed}</span><span class="pe-voc-lbl">RENAME CLEANLY</span>
        <span class="pe-voc-fig">${i.unchanged}</span><span class="pe-voc-lbl">UNCHANGED</span>
        <span class="pe-voc-fig alert">${i.needsDecision}</span><span class="pe-voc-lbl">NEED A DECISION</span>
      </div>
      ${a.measuredOver ? `<div class="pe-voc-note">Counted over ${a.measuredOver.records} records in build <b>${esc(a.measuredOver.corpusBuildId)}</b> — ${esc(a.measuredOver.of)}.</div>` : ''}
      ${i.rows
        .map((r) => {
          const tone = pick(RELATION_TONE[r.relation] ?? 'unmapped', ['same', 'narrows', 'orthogonal', 'unmapped'], 'unmapped');
          return `
        <div class="pe-voc-row ${tone}">
          <span class="pe-voc-term">${esc(r.term)}</span>
          <span class="pe-voc-bar"><i style="width:${Math.round((r.count / total) * 100)}%"></i></span>
          <span class="pe-voc-count">${r.count}</span>
          <span class="pe-voc-rel ${tone}">${esc(r.relation)}</span>
          <span class="pe-voc-target">${r.canonical && r.canonical !== r.term ? `→ ${esc(r.canonical)}` : r.canonical ? 'unchanged' : 'no target'}</span>
          <div class="pe-voc-why">${esc(r.note)}</div>
        </div>`;
        })
        .join('')}
      <div class="pe-voc-verdict">${esc(i.verdict)}</div>`;
  };

  const axesHtml = (a: VocabularyAlignment): string =>
    a.axes
      .map(
        (x) => `
      <div class="pe-voc-axis">
        <div class="pe-voc-axhead"><span class="pe-voc-axname">${esc(x.label)}</span><span class="pe-voc-axq">${esc(x.question)}</span></div>
        <div class="pe-voc-axterms">${x.canonical.map((t) => `<i>${esc(t)}</i>`).join('')}</div>
        <div class="pe-voc-note">${esc(x.basis)}</div>
      </div>`
      )
      .join('');

  const declaredHtml = (a: VocabularyAlignment): string =>
    Object.entries(a.declared)
      .map(
        ([id, d]) => `
      <div class="pe-voc-decl">
        <span class="pe-voc-declid">${esc(id)}</span>
        <span class="pe-voc-declof">${esc(d.of)}</span>
        <span class="pe-voc-declterms">${d.terms.map((t) => `<i>${esc(t)}</i>`).join('')}</span>
      </div>`
      )
      .join('');

  const render = async (): Promise<void> => {
    const shell = (inner: string, counts?: string): string => `
      <div class="pe-patterns-head">
        <span class="pe-voc-kicker">PROPOSED</span>
        <span class="pe-patterns-title">PROVENANCE VOCABULARY</span>
        ${counts ? `<span class="pe-voc-split">${counts}</span>` : ''}
        <button type="button" class="pe-patterns-x" title="close (Esc)">×</button>
      </div>
      <div class="pe-corpus-body">${inner}</div>`;

    el.innerHTML = shell('<div class="pe-patterns-lineage">COUNTING THE CORPUS…</div>');
    el.querySelector('.pe-patterns-x')?.addEventListener('click', () => setOpen(false));

    const { a, source } = await read();
    if (el.hidden) return;
    el.innerHTML = shell(
      `
      <div class="pe-voc-banner">
        <b>Four apparatuses, four vocabularies for how a value came to be known.</b>
        <div class="pe-voc-warn">${esc(a.warning)}</div>
        <div class="pe-voc-note">DECISION OWNED BY ${esc(a.ownedBy.toUpperCase())} · alignment read from the ${esc(source)}</div>
      </div>

      <div class="pe-corpus-sec">
        <div class="pe-corpus-sectitle">WHAT ADOPTION WOULD COST — counted, not argued</div>
        ${impactHtml(a)}
      </div>

      <div class="pe-corpus-sec">
        <div class="pe-corpus-sectitle">THREE AXES, NOT ONE LIST</div>
        <div class="pe-voc-note">The four vocabularies are not four attempts at the same list — they answer three different questions, and the flattening is most of the confusion. A value is measured OR asserted on one axis and, separately, direct OR estimated on another. Collapsing them forces a choice that discards one of the two facts.</div>
        ${axesHtml(a)}
      </div>

      <div class="pe-corpus-sec">
        <div class="pe-corpus-sectitle">THE MAPPING — ${a.counts.same} same · ${a.counts.narrows} narrows · ${a.counts.orthogonal} orthogonal · ${a.counts.unmapped} unmapped</div>
        ${a.alignment
          .map((r) => {
            const tone = pick(RELATION_TONE[r.relation] ?? 'unmapped', ['same', 'narrows', 'orthogonal', 'unmapped'], 'unmapped');
            return `
          <div class="pe-voc-map ${tone}">
            <span class="pe-voc-mapterm">${esc(r.term)}</span>
            <span class="pe-voc-mapfrom">${esc(r.apparatus)}</span>
            <span class="pe-voc-rel ${tone}">${esc(r.relation)}</span>
            <span class="pe-voc-mapto">${r.canonical ? `${esc(r.axis)} · ${esc(r.canonical)}` : 'no axis'}</span>
            <div class="pe-voc-why">${esc(r.note)}</div>
          </div>`;
          })
          .join('')}
      </div>

      <div class="pe-corpus-sec">
        <div class="pe-corpus-sectitle">AS EACH APPARATUS STATES IT</div>
        ${declaredHtml(a)}
      </div>`,
      a.impact ? `${a.impact.total} RECORDS · ${a.impact.needsDecision} UNDECIDED` : `${a.counts.terms} TERMS`
    );
    el.querySelector('.pe-patterns-x')?.addEventListener('click', () => setOpen(false));
  };

  const setOpen = (open: boolean): void => {
    el.hidden = !open;
    if (open) void render();
  };

  window.addEventListener('pe:vocabulary-toggle' as keyof WindowEventMap, () => setOpen(el.hidden));
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || el.hidden) return;
    setOpen(false);
    // consumed — the Esc ladder in main.ts must not also fire
    e.stopImmediatePropagation();
  });

  return { el };
}
