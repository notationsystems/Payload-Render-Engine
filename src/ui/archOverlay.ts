/**
 * PAYLOAD OS ARCHITECTURE overlay — the layer stack this renderer sits
 * inside, drawn as the instrument it is. Toggled by the OS chip in the
 * command bar (window event 'pe:arch-toggle') and Escape.
 */

import type { AppApi } from '../app/api';

// The Information-OS stack: PayLoad OS builds the physical-economy
// corpus; interfaces sit above it. Acquire → Extract → Normalize →
// Resolve → Structure → Relate → Index → Compress → Retrieve →
// Compute → Prove.
const STACK: { title: string; items: string[]; here?: boolean }[] = [
  { title: 'EXTERNAL WORLD', items: ['Documents', 'Filings', 'Feeds', 'Datasets'] },
  { title: 'ACQUIRE / EXTRACT', items: ['DAF', 'Document perception', 'Provenance at entry'] },
  { title: 'CORPUS', items: ['Evidence', 'Identity (resolution)', 'Ontology'] },
  { title: 'CANONICAL STATE', items: ['Relational', 'Graph', 'Spatial'] },
  { title: 'INDEX', items: ['Temporal', 'Vector / semantic'] },
  { title: 'RETRIEVAL', items: ['Hybrid retrieval', 'GraphRAG'] },
  { title: 'CONTEXT COMPILER', items: ['Compressed evidence', 'Packages for reasoning'] },
  {
    title: 'INTERFACES',
    items: ['APIs · Agents · Tradewind', 'PAYLOAD EARTH — this renderer', 'the visual query surface'],
    here: true,
  },
];

export function createArchOverlay(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'os-arch';
  el.hidden = true;

  const sheet = document.createElement('div');
  sheet.className = 'os-arch-sheet';

  const head = document.createElement('div');
  head.className = 'os-arch-head';
  head.innerHTML = `<span class="os-panel-kicker">PAYLOAD OS ARCHITECTURE</span>`;
  const close = document.createElement('button');
  close.className = 'os-panel-close';
  close.type = 'button';
  close.textContent = '×';
  head.appendChild(close);

  const flow = document.createElement('div');
  flow.className = 'os-arch-flow';
  STACK.forEach((stage, i) => {
    if (i > 0) {
      const arrow = document.createElement('div');
      arrow.className = 'os-arch-arrow';
      arrow.textContent = '→';
      flow.appendChild(arrow);
    }
    const box = document.createElement('div');
    box.className = 'os-arch-box' + (stage.here ? ' here' : '');
    box.innerHTML =
      `<div class="os-arch-box-title">${stage.title}</div>` +
      stage.items.map((it) => `<div class="os-arch-item">${it}</div>`).join('');
    flow.appendChild(box);
  });

  const tagline = document.createElement('div');
  tagline.className = 'os-arch-tagline';
  tagline.textContent = 'Canonically verifiable. Cryptographically provable. Operationally actionable.';

  const stance = document.createElement('div');
  stance.className = 'os-arch-stance';
  stance.textContent =
    'Earth is the VISUAL QUERY SURFACE of the physical-economy corpus: a query lights a result set with its basis and evidence; the renderer never stores or mutates state, and the seam is mechanical — the build fails if the data layer touches it.';

  sheet.append(head, flow, tagline, stance);
  el.appendChild(sheet);

  const setOpen = (open: boolean): void => {
    el.hidden = !open;
  };
  close.addEventListener('click', () => setOpen(false));
  el.addEventListener('click', (e) => {
    if (e.target === el) setOpen(false);
  });
  window.addEventListener('pe:arch-toggle' as keyof WindowEventMap, () => setOpen(el.hidden));
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || el.hidden) return;
    setOpen(false);
    // the overlay consumes this Escape — later window listeners (selection
    // clearing in main.ts) must not also act on it
    e.stopImmediatePropagation();
  });

  return { el };
}
