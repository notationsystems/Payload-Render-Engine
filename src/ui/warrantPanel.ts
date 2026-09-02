/**
 * Warrant Graph panel — the walkable "why do we believe this?".
 *
 * Renders the assembler's layered DAG (CLAIM → COMPUTATION → RECORDS
 * → SOURCES → BUILD) as SVG in the semantic vocabulary colors. No
 * composite trust score exists here: weakness is visible structurally
 * — a thin chain looks thin, an unobserved state says so, and a
 * hypothetical chain terminates at an engine node instead of
 * evidence. Click a record to fly to it on the globe.
 *
 * Subject priority: active injection > active mined pattern > active
 * corpus query > current selection > an explainer.
 */

import type { AppApi } from '../app/api';
import type { EntityId } from '../data/contracts';
import type { InjectionResult } from '../data/injection';
import type { MinedPattern } from '../intel/miner';
import {
  buildInjectionWarrant,
  buildPatternWarrant,
  buildQueryWarrant,
  buildSelectionWarrant,
  WARRANT_LAYER_TITLES,
  type WarrantBasis,
  type WarrantGraphDoc,
  type WarrantNode,
} from '../intel/warrant';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const COLOR: Record<WarrantBasis, string> = {
  observed: '#dbe7f4',
  declared: '#8fa3b8',
  computed: '#4da6ff',
  mined: '#d9c26a',
  hypothetical: '#d98cff',
  representative: '#6b7688',
  unobserved: '#6b7688',
  source: '#7fb8ff',
  build: '#38d6c8',
  absent: '#6b7688',
};

/** dashed = not an observation: declared, hypothetical, absent, grey */
const DASHED = new Set<WarrantBasis>(['declared', 'hypothetical', 'representative', 'unobserved', 'absent']);

const LEGEND: [WarrantBasis, string][] = [
  ['observed', 'OBSERVED'],
  ['declared', 'DECLARED'],
  ['computed', 'COMPUTED'],
  ['mined', 'MINED CANDIDATE'],
  ['hypothetical', 'HYPOTHETICAL'],
  ['representative', 'REPRESENTATIVE / UNOBSERVED'],
  ['source', 'SOURCE'],
  ['build', 'BUILD'],
];

const W = 980;
const COL_X = [10, 210, 410, 660, 830]; // node left x per layer
const COL_W = [180, 180, 230, 150, 140];
const ROW_H = 46;
const NODE_H = 36;
const TOP = 26;

const trunc = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function createWarrantPanel(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'pe-corpus pe-warrant';
  el.hidden = true;

  // subject cache — fed by events so the panel can answer instantly
  let activePattern: MinedPattern | null = null;
  let activeQuery: { role: 'producers' | 'consumers'; commodityId: EntityId; label: string } | null = null;
  let activeInjection: InjectionResult | null = null;

  api.events.on('pattern', (ev) => {
    activePattern = ev.active && ev.pattern ? ev.pattern : null;
    if (!el.hidden) void render();
  });
  api.events.on('query', (ev) => {
    activeQuery =
      ev.active && ev.role && ev.commodityId
        ? { role: ev.role, commodityId: ev.commodityId, label: ev.label ?? 'QUERY' }
        : null;
    if (!el.hidden) void render();
  });
  api.events.on('injection', (ev) => {
    activeInjection = ev.active && ev.result ? ev.result : null;
    if (!el.hidden) void render();
  });

  const currentDoc = async (): Promise<WarrantGraphDoc | null> => {
    if (activeInjection) return buildInjectionWarrant(api.store, activeInjection);
    if (activePattern) {
      const { run } = await api.getMinedPatterns();
      return buildPatternWarrant(api.store, activePattern, run);
    }
    if (activeQuery) {
      return buildQueryWarrant(api.store, activeQuery.role, activeQuery.commodityId, activeQuery.label);
    }
    const sel = api.getSelection();
    if (sel) return buildSelectionWarrant(api.store, sel, api.clock.simTime);
    return null;
  };

  const svgFor = (doc: WarrantGraphDoc): string => {
    const rows = [0, 0, 0, 0, 0];
    const pos = new Map<string, { x: number; y: number; w: number; node: WarrantNode }>();
    for (const n of doc.nodes) {
      const y = TOP + rows[n.layer] * ROW_H;
      rows[n.layer]++;
      pos.set(n.id, { x: COL_X[n.layer], y, w: COL_W[n.layer], node: n });
    }
    const height = TOP + Math.max(...rows) * ROW_H + 12;

    const headers = WARRANT_LAYER_TITLES.map(
      (t, i) =>
        `<text x="${COL_X[i]}" y="14" class="pe-w-coltitle">${t}</text>`
    ).join('');

    const edges = doc.edges
      .map((e) => {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b) return '';
        const x1 = a.x + a.w;
        const y1 = a.y + NODE_H / 2;
        const x2 = b.x;
        const y2 = b.y + NODE_H / 2;
        const mx = (x1 + x2) / 2;
        return `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" fill="none" stroke="${COLOR[e.basis]}" stroke-opacity="0.45" stroke-width="1"${DASHED.has(e.basis) ? ' stroke-dasharray="4 3"' : ''}/>`;
      })
      .join('');

    const nodes = doc.nodes
      .map((n) => {
        const p = pos.get(n.id)!;
        const clickable = n.entityRef && api.store.entity(n.entityRef);
        const maxChars = Math.floor(p.w / 6.1);
        return `
      <g class="pe-w-node${clickable ? ' pe-w-click' : ''}" data-entity="${clickable ? esc(n.entityRef!) : ''}">
        <title>${esc(n.label)}${n.sub ? ` — ${esc(n.sub)}` : ''}</title>
        <rect x="${p.x}" y="${p.y}" width="${p.w}" height="${NODE_H}" rx="3"
          fill="rgba(10,16,26,0.85)" stroke="${COLOR[n.basis]}" stroke-opacity="0.8"${DASHED.has(n.basis) ? ' stroke-dasharray="4 3"' : ''}/>
        <text x="${p.x + 8}" y="${p.y + 15}" class="pe-w-label" fill="${COLOR[n.basis]}">${esc(trunc(n.label, maxChars))}</text>
        ${n.sub ? `<text x="${p.x + 8}" y="${p.y + 28}" class="pe-w-sub">${esc(trunc(n.sub, maxChars + 4))}</text>` : ''}
      </g>`;
      })
      .join('');

    return `<svg viewBox="0 0 ${W} ${height}" width="100%" style="min-width:760px" xmlns="http://www.w3.org/2000/svg">${headers}${edges}${nodes}</svg>`;
  };

  const render = async (): Promise<void> => {
    const doc = await currentDoc();
    const head = `
      <div class="pe-patterns-head">
        <span class="pe-warrant-kicker">WARRANT</span>
        <span class="pe-patterns-title">${esc(doc?.title ?? 'WHY DO WE BELIEVE THIS?')}</span>
        <button type="button" class="pe-patterns-x" title="close (Esc)">×</button>
      </div>`;
    if (!doc) {
      el.innerHTML = `${head}
        <div class="pe-corpus-body">
          <div class="pe-corpus-absent">no subject — select an entity, run a query (producers of …), light a mined pattern, or inject a what-if, then reopen</div>
          <div class="pe-corpus-remedy">the warrant graph walks the chain claim → computation → records → sources → build. There is no trust score: weakness is visible structurally.</div>
        </div>`;
      el.querySelector('.pe-patterns-x')!.addEventListener('click', () => setOpen(false));
      return;
    }
    if (el.hidden) return;
    el.innerHTML = `${head}
      <div class="pe-warrant-banner">Trust is a chain you can walk, not a number we assign. Dashed = not an observation. A thin chain looks thin; a hypothetical terminates at an engine, not at evidence.</div>
      <div class="pe-corpus-body pe-warrant-body">${svgFor(doc)}
        ${doc.notes.map((n) => `<div class="pe-corpus-census">· ${esc(n)}</div>`).join('')}
        <div class="pe-warrant-legend">${LEGEND.map(([b, l]) => `<span class="pe-w-leg"><i style="background:${COLOR[b]}"></i>${l}</span>`).join('')}</div>
      </div>`;
    el.querySelector('.pe-patterns-x')!.addEventListener('click', () => setOpen(false));
    for (const g of el.querySelectorAll('.pe-w-click')) {
      g.addEventListener('click', () => {
        const id = (g as HTMLElement).dataset.entity;
        if (!id) return;
        setOpen(false); // the globe is the point
        api.focus(id);
      });
    }
  };

  const setOpen = (open: boolean): void => {
    el.hidden = !open;
    if (open) void render();
  };

  window.addEventListener('pe:warrant-toggle' as keyof WindowEventMap, () => setOpen(el.hidden));
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || el.hidden) return;
    setOpen(false);
    // consumed — the Esc ladder in main.ts must not also fire
    e.stopImmediatePropagation();
  });

  return { el };
}
