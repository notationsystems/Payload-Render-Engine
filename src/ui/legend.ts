/**
 * Legend — the kepler.gl always-visible key, in instrument form. Every
 * color on the globe decoded in one quiet card: transport modes, node
 * classes, state tints, and the two reserved overlay treatments
 * (hypothetical violet, operational lane). Collapsible; plain.
 */

import type { AppApi } from '../app/api';
import { MODE_COLORS_CSS, NODE_CATEGORY_COLORS } from '../app/palette';

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

export function createLegend(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'pe-legend';

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'pe-legend-head';
  head.textContent = 'LEGEND';

  const body = document.createElement('div');
  body.className = 'pe-legend-body';

  const row = (swatchHtml: string, label: string): string =>
    `<div class="pe-lg-row">${swatchHtml}<span>${label}</span></div>`;
  const dot = (c: string): string => `<i class="pe-lg-dot" style="background:${c}"></i>`;
  const line = (c: string, dashed = false): string =>
    `<i class="pe-lg-line${dashed ? ' dashed' : ''}" style="--lg:${c}"></i>`;

  const modes: [string, string][] = [
    ['Road', MODE_COLORS_CSS.road],
    ['Rail', MODE_COLORS_CSS.rail],
    ['Maritime', MODE_COLORS_CSS.maritime],
    ['Air', MODE_COLORS_CSS.air],
    ['Pipeline', MODE_COLORS_CSS.pipeline],
    ['Multimodal', MODE_COLORS_CSS.multimodal],
    ['Unspecified', MODE_COLORS_CSS.unspecified],
  ];
  const cats: [string, string][] = [
    ['Logistics', hex(NODE_CATEGORY_COLORS.logistics)],
    ['Extraction', hex(NODE_CATEGORY_COLORS.extraction)],
    ['Processing', hex(NODE_CATEGORY_COLORS.processing)],
    ['Industry', hex(NODE_CATEGORY_COLORS.industry)],
    ['Chokepoint', hex(NODE_CATEGORY_COLORS.chokepoint)],
  ];

  body.innerHTML = `
    <div class="pe-lg-group">TRANSPORT</div>
    ${modes.map(([l, c]) => row(line(c), l)).join('')}
    <div class="pe-lg-group">NODES</div>
    ${cats.map(([l, c]) => row(dot(c), l)).join('')}
    <div class="pe-lg-group">STATE</div>
    ${row(dot('var(--ok)'), 'Active')}
    ${row(dot('var(--warn)'), 'Degraded')}
    ${row(dot('var(--alert)'), 'Disrupted')}
    ${row(dot('#6b7688'), 'Unknown / unobserved')}
    <div class="pe-lg-group">LIVE FEEDS</div>
    ${row(dot('#ffd9a0'), 'Stations (ISS…) — computed, SGP4')}
    ${row(dot('#7fb8ff'), 'GPS')} ${row(dot('#b48cff'), 'GLONASS')} ${row(dot('#38d6c8'), 'Galileo')}
    ${row(dot('#bfe0ff'), 'Aircraft — observed, ADS-B (dart = course)')}
    ${row(dot('#9aa7c7'), 'Aircraft below 10k ft')}
    ${row(dot('var(--warn)'), 'Quake M4+ (ring = magnitude, fade = age)')}
    <div class="pe-lg-row" style="color:var(--text-dim)">Click a live contact to track · D boxes contacts · 1–5 sensor styles</div>
    <div class="pe-lg-group">OVERLAYS</div>
    ${row(line('#d98cff', true), 'Hypothetical frame — computed, not observed')}
    ${row(line('#e8f1fb', true), 'Operational lane — dashed when untracked')}
    ${row(dot('#ff5d6e'), 'Attention beam — alert-flagged asset (see ALERTS rail)')}`;

  el.append(head, body);

  let open = window.innerWidth > 1280; // collapsed on small screens
  const sync = (): void => {
    body.hidden = !open;
    el.classList.toggle('collapsed', !open);
  };
  head.addEventListener('click', () => {
    open = !open;
    sync();
  });
  sync();

  // the legend is reference, not work: it yields to the inspector and
  // to the center panels rather than fighting them for the corner
  let panelOpen = false;
  let inspecting = false;
  const sync2 = (): void => {
    el.classList.toggle('pe-legend-tucked', panelOpen || inspecting);
  };
  api.events.on('preset', ({ preset }) => {
    panelOpen =
      preset === 'operations' ||
      preset === 'agents' ||
      preset === 'scenarios' ||
      preset === 'commodities' ||
      preset === 'markets';
    sync2();
  });
  api.events.on('select', ({ id }) => {
    inspecting = id !== null;
    sync2();
  });
  api.events.on('countrySelect', ({ code }) => {
    inspecting = code !== null;
    sync2();
  });

  return { el };
}
