/**
 * Corpus Definition overlay — the corpus worn as a MANUFACTURED
 * artifact. PayloadOS's deep abstraction is the corpus machinery
 * (𝒞 = F(ontology, sources, extraction, resolution, validation,
 * mining, policy, publication)); this card shows the definition of
 * the corpus currently loaded: what the loader DECLARES it enforces,
 * what the service DERIVES from the served snapshot (labeled), and
 * what is honestly ABSENT with its reason.
 *
 * Served by GET /api/corpus/definition. The in-browser corpus ships
 * without the definition capability, so this surface refuses with a
 * remedy there instead of reconstructing one client-side.
 */

import type { AppApi } from '../app/api';
import { resolveApiBase } from '../data/sources';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface DefinitionDoc {
  corpus?: string;
  ontology?: { name: string; version: string };
  source_registry?: { id: string; class: string; description: string; endpoints?: string[] }[];
  extraction_rules?: { basis: string; description: string };
  resolution_rules?: { basis: string; description: string };
  validation_rules?: { admissibility: string; stateReadings: string };
  access_policy?: { status: string; reason: string };
  entity_types?: { basis: string; nodeKinds: Record<string, number> };
  relation_types?: {
    basis: string;
    routeModes: Record<string, number>;
    flows: number;
    flowSegments: number;
    commodities: number;
  };
  observation_types?: { basis: string; metrics: Record<string, number> };
  mining_programs?: {
    basis: string;
    programs: { name: string; version: string; parameters: Record<string, number> }[];
  };
  publication_contract?: {
    envelope: string;
    refusals: string;
    knowledgeModes?: string[];
    schemaVersion: string;
  };
}

export function createCorpusPanel(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'pe-corpus';
  el.hidden = true;

  const section = (title: string, bodyHtml: string, derived = false): string => `
    <div class="pe-corpus-sec">
      <div class="pe-corpus-sectitle">${esc(title)}${derived ? '<span class="pe-corpus-derived">DERIVED FROM SNAPSHOT</span>' : ''}</div>
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
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k, n]) => `${k.replace(/_/g, ' ')} ${n}`)
      .join(' · ');

  const renderDoc = (d: DefinitionDoc): void => {
    const build = api.store.snapshot.meta.corpusBuild;
    el.innerHTML = `
      <div class="pe-patterns-head">
        <span class="pe-corpus-kicker">CORPUS</span>
        <span class="pe-patterns-title">${esc((d.corpus ?? 'undeclared').toUpperCase())} · DEFINITION</span>
        <span class="pe-patterns-count">${esc(d.ontology ? `${d.ontology.name}@${d.ontology.version}` : 'NO ONTOLOGY DECLARED')}</span>
        <button type="button" class="pe-patterns-x" title="close (Esc)">×</button>
      </div>
      <div class="pe-corpus-banner">A corpus is a manufactured artifact: 𝒞 = F(ontology · sources · extraction · resolution · validation · mining · policy · publication). Below is the definition this loader declares and this snapshot exhibits${build ? ` — build ${esc(build.id)}` : ''}.</div>
      <div class="pe-corpus-body">
        ${section(
          'SOURCE REGISTRY',
          (d.source_registry ?? [])
            .map(
              (s) =>
                `<div class="pe-corpus-row"><span class="pe-corpus-k">${esc(s.id)}</span><span class="pe-corpus-v">${esc(s.class)} — ${esc(s.description)}${s.endpoints ? ` · ${s.endpoints.map(esc).join(' · ')}` : ''}</span></div>`
            )
            .join('') || '<div class="pe-corpus-row"><span class="pe-corpus-v">NONE DECLARED</span></div>'
        )}
        ${section('EXTRACTION', kv([[d.extraction_rules?.basis ?? '—', d.extraction_rules?.description ?? 'not declared']]))}
        ${section('RESOLUTION', kv([[d.resolution_rules?.basis ?? '—', d.resolution_rules?.description ?? 'not declared']]))}
        ${section(
          'VALIDATION',
          kv([
            ['admissibility', d.validation_rules?.admissibility ?? 'not declared'],
            ['state readings', d.validation_rules?.stateReadings ?? 'not declared'],
          ])
        )}
        ${section('ENTITY TYPES', `<div class="pe-corpus-census">${esc(censusLine(d.entity_types?.nodeKinds ?? {}))}</div>`, true)}
        ${section(
          'RELATIONS',
          `<div class="pe-corpus-census">${esc(censusLine(d.relation_types?.routeModes ?? {}))}</div>` +
            kv([
              ['declared flows', String(d.relation_types?.flows ?? 0)],
              ['flow segments', String(d.relation_types?.flowSegments ?? 0)],
              ['commodities', String(d.relation_types?.commodities ?? 0)],
            ]),
          true
        )}
        ${section('OBSERVATIONS', `<div class="pe-corpus-census">${esc(censusLine(d.observation_types?.metrics ?? {})) || 'none in this snapshot'}</div>`, true)}
        ${section(
          'MINING PROGRAMS',
          (d.mining_programs?.programs ?? [])
            .map(
              (p) =>
                `<div class="pe-corpus-row"><span class="pe-corpus-k">${esc(p.name)}@${esc(p.version)}</span><span class="pe-corpus-v">${
                  Object.keys(p.parameters).length
                    ? esc(
                        Object.entries(p.parameters)
                          .map(([k, v]) => `${k}=${v}`)
                          .join(' · ')
                      )
                    : 'no parameters'
                }</span></div>`
            )
            .join('')
        )}
        ${section(
          'ACCESS POLICY',
          `<div class="pe-corpus-absent">${esc(d.access_policy?.status ?? 'UNDECLARED')} — ${esc(d.access_policy?.reason ?? 'no reason stated')}</div>`
        )}
        ${section(
          'PUBLICATION CONTRACT',
          kv([
            ['envelope', d.publication_contract?.envelope ?? 'not declared'],
            ['refusals', d.publication_contract?.refusals ?? 'not declared'],
            ['knowledge modes', (d.publication_contract?.knowledgeModes ?? []).join(' · ') || 'not declared'],
            ['schema version', d.publication_contract?.schemaVersion ?? '—'],
          ])
        )}
      </div>`;
    el.querySelector('.pe-patterns-x')!.addEventListener('click', () => setOpen(false));
  };

  const renderRefusal = (message: string, remedy: string): void => {
    el.innerHTML = `
      <div class="pe-patterns-head">
        <span class="pe-corpus-kicker">CORPUS</span>
        <span class="pe-patterns-title">DEFINITION UNAVAILABLE</span>
        <button type="button" class="pe-patterns-x" title="close (Esc)">×</button>
      </div>
      <div class="pe-corpus-body">
        <div class="pe-corpus-absent">${esc(message)}</div>
        <div class="pe-corpus-remedy">${esc(remedy)}</div>
      </div>`;
    el.querySelector('.pe-patterns-x')!.addEventListener('click', () => setOpen(false));
  };

  const render = async (): Promise<void> => {
    el.innerHTML = '<div class="pe-patterns-lineage">FETCHING DEFINITION…</div>';
    if (api.getDataSourceId() !== 'payload-spatial-api') {
      renderRefusal(
        'the in-browser corpus ships without the definition capability — this surface refuses rather than reconstructing one client-side',
        'REMEDY: run against the spatial API (?api=<base>) — GET /api/corpus/definition serves the loaded corpus’s definition'
      );
      return;
    }
    try {
      const res = await fetch(`${resolveApiBase()}/api/corpus/definition`);
      const body = (await res.json()) as { status?: string; data?: DefinitionDoc };
      if (!res.ok || body.status !== 'ok' || !body.data) throw new Error('bad envelope');
      if (el.hidden) return;
      renderDoc(body.data);
    } catch {
      renderRefusal(
        'the spatial API did not answer /api/corpus/definition',
        'REMEDY: confirm the service is reachable — GET /api/capabilities lists what it serves'
      );
    }
  };

  const setOpen = (open: boolean): void => {
    el.hidden = !open;
    if (open) void render();
  };

  window.addEventListener('pe:corpus-toggle' as keyof WindowEventMap, () => setOpen(el.hidden));
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || el.hidden) return;
    setOpen(false);
    // consumed — the Esc ladder in main.ts must not also fire
    e.stopImmediatePropagation();
  });

  return { el };
}
