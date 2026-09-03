/**
 * Compiler console — the Corpus Compiler as an operator surface.
 *
 * "Which build am I looking at, and did the compile conserve the
 * upstream?" is a maintenance question, so it gets an instrument, not
 * a log file: the build identity (id · canonical-state fingerprint ·
 * schema/compiler versions · generated instant), the record census,
 * and the loader's CONSERVATION REPORT — what mapped, what was
 * EXCLUDED WITH ITS REASON (an upstream record never disappears
 * silently), which cross-references did not resolve, how declared
 * upstream counts reconcile with what this projection delivers, and
 * which relations the RELATE step derived.
 *
 * An authored corpus states that nothing was compiled — an honest
 * absence, not an empty report.
 */

import { esc } from '../core/escape';
import type { AppApi } from '../app/api';
import { resolveApiBase } from '../data/sources';


interface HealthDoc {
  service: string;
  corpus: string;
  corpusKind: string;
  counts: Record<string, number>;
  mappingReport?: {
    mapped: Record<string, number>;
    excluded: { id: string; reason: string }[];
    unresolvedRefs: { eventId: string; refs: string[] }[];
    upstreamReconciliation: {
      commodity: string;
      fingerprint: string;
      declared: Record<string, number>;
      delivered: Record<string, number>;
      note: string;
    }[];
    derivedFields: Record<string, number>;
  };
}

interface CorpusBuildMeta {
  id: string;
  canonicalStateFingerprint: string;
  schemaVersion: string;
  compilerVersion: string;
  generatedAt: string;
  merkleRoot?: string;
  commitment?: { algorithm: string; leaves: number };
}

export function createCompilerPanel(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  // pe-corpus carries the overlay geometry + section idiom (and the
  // Esc-ladder guard in main.ts); pe-compiler restyles the identity
  el.className = 'pe-corpus pe-compiler';
  el.hidden = true;

  const section = (title: string, bodyHtml: string): string => `
    <div class="pe-corpus-sec">
      <div class="pe-corpus-sectitle">${esc(title)}</div>
      ${bodyHtml}
    </div>`;

  const kv = (rows: [string, string][]): string =>
    rows
      .map(
        ([k, v]) =>
          `<div class="pe-corpus-row"><span class="pe-corpus-k">${esc(k)}</span><span class="pe-corpus-v">${esc(v)}</span></div>`
      )
      .join('');

  const censusLine = (m: Record<string, number>): string =>
    Object.entries(m)
      .map(([k, n]) => `${k} ${n}`)
      .join(' · ');

  const renderDoc = (h: HealthDoc, build: CorpusBuildMeta | undefined): void => {
    const mr = h.mappingReport;

    // exclusions grouped by reason — the count is the story; a few
    // example ids keep it auditable without a thousand-row dump
    let exclusionsHtml = '';
    if (mr) {
      const byReason = new Map<string, string[]>();
      for (const x of mr.excluded) {
        byReason.set(x.reason, [...(byReason.get(x.reason) ?? []), x.id]);
      }
      exclusionsHtml = [...byReason.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(
          ([reason, ids]) =>
            `<div class="pe-corpus-row"><span class="pe-corpus-k">${ids.length} × ${esc(reason)}</span><span class="pe-corpus-v">${ids
              .slice(0, 3)
              .map(esc)
              .join(' · ')}${ids.length > 3 ? ` · +${ids.length - 3} more` : ''}</span></div>`
        )
        .join('');
      if (!mr.excluded.length) {
        exclusionsHtml = '<div class="pe-corpus-census">0 records excluded — every upstream record mapped</div>';
      }
    }

    el.innerHTML = `
      <div class="pe-patterns-head">
        <span class="pe-corpus-kicker">COMPILER</span>
        <span class="pe-patterns-title">CORPUS BUILD · ${esc(h.corpusKind.toUpperCase())}</span>
        <span class="pe-patterns-count">${esc(build?.id ?? 'UNSTAMPED')}</span>
        <button type="button" class="pe-patterns-x" title="close (Esc)">×</button>
      </div>
      <div class="pe-corpus-banner">The compile is answerable: this build's identity, its record census, and the loader's conservation report — an upstream record never disappears silently. Representations are disposable; canonical state is not.</div>
      <div class="pe-corpus-body">
        ${section(
          'BUILD IDENTITY',
          build
            ? kv([
                ['build id', build.id],
                ['canonical fingerprint', build.canonicalStateFingerprint],
                ['schema version', build.schemaVersion],
                ['compiler version', build.compilerVersion],
                ['generated at', build.generatedAt],
              ])
            : '<div class="pe-corpus-absent">UNSTAMPED — this corpus was not compiled by the projection service</div>'
        )}
        ${
          build?.merkleRoot
            ? section(
                'COMMITMENT MANIFEST',
                kv([
                  ['merkle root', build.merkleRoot],
                  ['algorithm', build.commitment?.algorithm ?? '—'],
                  ['leaves', String(build.commitment?.leaves ?? '—')],
                ]) +
                  '<div class="pe-corpus-absent">COMMITMENT, NOT ATTESTATION — the root binds records to this build; any record + its inclusion proof (GET /api/corpus/commitments?record=&lt;id&gt;) verifies OFFLINE via scripts/verify-inclusion.mjs. Binding the root to a time or identity needs a signature the corpus platform will hold — none exists yet.</div>'
              )
            : ''
        }
        ${section('RECORD CENSUS', `<div class="pe-corpus-census">${esc(censusLine(h.counts))}</div>`)}
        ${
          mr
            ? section('CONSERVATION — MAPPED', `<div class="pe-corpus-census">${esc(censusLine(mr.mapped))}</div>`) +
              section('CONSERVATION — EXCLUDED, WITH REASONS', exclusionsHtml) +
              section(
                'UNRESOLVED CROSS-REFERENCES',
                mr.unresolvedRefs.length
                  ? mr.unresolvedRefs
                      .map(
                        (u) =>
                          `<div class="pe-corpus-row"><span class="pe-corpus-k">${esc(u.eventId)}</span><span class="pe-corpus-v">references ${u.refs.map(esc).join(' · ')} — recorded, never invented</span></div>`
                      )
                      .join('')
                  : '<div class="pe-corpus-census">none — every cross-reference resolved</div>'
              ) +
              section(
                'UPSTREAM RECONCILIATION',
                mr.upstreamReconciliation
                  .map(
                    (r) =>
                      `<div class="pe-corpus-row"><span class="pe-corpus-k">${esc(r.commodity)} · ${esc(r.fingerprint)}</span><span class="pe-corpus-v">declared ${esc(censusLine(r.declared))} → delivered ${esc(censusLine(r.delivered))}</span></div><div class="pe-corpus-row"><span class="pe-corpus-k"></span><span class="pe-corpus-v pe-compiler-note">${esc(r.note)}</span></div>`
                  )
                  .join('')
              ) +
              section(
                'RELATE — DERIVED FIELDS',
                kv(
                  Object.entries(mr.derivedFields).map(([k, v]) => [
                    k.replace(/([A-Z])/g, ' $1').toLowerCase(),
                    `${v} relations, derived only from upstream declarations`,
                  ])
                )
              )
            : section(
                'CONSERVATION REPORT',
                '<div class="pe-corpus-absent">NONE — this corpus is authored, not compiled from an upstream: nothing was extracted, so nothing could be excluded. The report exists only where a compile happened.</div>'
              )
        }
      </div>`;
    el.querySelector('.pe-patterns-x')!.addEventListener('click', () => setOpen(false));
  };

  const renderRefusal = (message: string, remedy: string): void => {
    el.innerHTML = `
      <div class="pe-patterns-head">
        <span class="pe-corpus-kicker">COMPILER</span>
        <span class="pe-patterns-title">BUILD REPORT UNAVAILABLE</span>
        <button type="button" class="pe-patterns-x" title="close (Esc)">×</button>
      </div>
      <div class="pe-corpus-body">
        <div class="pe-corpus-absent">${esc(message)}</div>
        <div class="pe-corpus-remedy">${esc(remedy)}</div>
      </div>`;
    el.querySelector('.pe-patterns-x')!.addEventListener('click', () => setOpen(false));
  };

  const render = async (): Promise<void> => {
    el.innerHTML = '<div class="pe-patterns-lineage">READING BUILD REPORT…</div>';
    if (api.getDataSourceId() !== 'payload-spatial-api') {
      renderRefusal(
        'the in-browser corpus is not compiled by the projection service — there is no build to report on',
        'REMEDY: run against the spatial API (?api=<base>) — GET /api/health carries the build and its conservation report'
      );
      return;
    }
    try {
      const res = await fetch(`${resolveApiBase()}/api/health`);
      const body = (await res.json()) as {
        status?: string;
        data?: HealthDoc;
        meta?: { corpusBuild?: CorpusBuildMeta };
      };
      if (!res.ok || body.status !== 'ok' || !body.data) throw new Error('bad envelope');
      if (el.hidden) return;
      renderDoc(body.data, body.meta?.corpusBuild);
    } catch {
      renderRefusal(
        'the spatial API did not answer /api/health',
        'REMEDY: confirm the service is reachable — GET /api/capabilities lists what it serves'
      );
    }
  };

  const setOpen = (open: boolean): void => {
    el.hidden = !open;
    if (open) void render();
  };

  window.addEventListener('pe:compiler-toggle' as keyof WindowEventMap, () => setOpen(el.hidden));
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || el.hidden) return;
    setOpen(false);
    // consumed — the Esc ladder in main.ts must not also fire
    e.stopImmediatePropagation();
  });

  return { el };
}
