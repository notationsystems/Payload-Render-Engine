/**
 * Hover tooltip — the kepler.gl map-tooltip pattern, in instrument form.
 * A compact chip at the cursor identifying what is under it before the
 * operator commits to a click: name, kind, and the live state — or
 * UNOBSERVED, stated plainly, when the corpus has no reading. Nothing
 * animates; it appears, it informs, it leaves.
 */

import type { AppApi } from '../app/api';
import { MODE_COLORS_CSS } from '../app/palette';
import type { EntityId, TransportMode } from '../data/contracts';

const OFFSET_X = 14;
const OFFSET_Y = 12;

export function createTooltip(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'pe-tooltip';
  el.hidden = true;

  let mouseX = 0;
  let mouseY = 0;
  let currentId: EntityId | null = null;

  const place = (): void => {
    // keep the chip on-screen: flip to the left/top of the cursor at edges
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const x = mouseX + OFFSET_X + w > window.innerWidth ? mouseX - OFFSET_X - w : mouseX + OFFSET_X;
    const y = mouseY + OFFSET_Y + h > window.innerHeight ? mouseY - OFFSET_Y - h : mouseY + OFFSET_Y;
    el.style.transform = `translate(${x}px, ${y}px)`;
  };

  window.addEventListener('pointermove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (!el.hidden) place();
  });

  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const render = (id: EntityId): void => {
    const node = api.store.node(id);
    const route = api.store.route(id);
    const ent = node ?? route;
    if (!ent) {
      el.hidden = true;
      return;
    }
    const s = api.store.stateAt(id, api.clock.simTime);
    const kind = ent.kind === 'route' ? (route?.mode ?? 'route') : ent.kind;
    const swatch =
      ent.kind === 'route' && route
        ? MODE_COLORS_CSS[route.mode as TransportMode]
        : 'var(--text-dim)';
    const stateLine =
      s.observed === false
        ? `<span class="pe-tt-dim">STATE UNOBSERVED</span>`
        : `UTIL <b>${Math.round(s.utilization * 100)}%</b> · ${esc(s.status.toUpperCase())}`;
    el.innerHTML = `
      <span class="pe-tt-kind" style="border-color:${swatch};color:${swatch}">${esc(String(kind).replace(/_/g, ' ').toUpperCase())}</span>
      <span class="pe-tt-name">${esc(ent.name)}</span>
      <span class="pe-tt-state">${stateLine}</span>`;
    el.hidden = false;
    place();
  };

  api.events.on('hover', ({ id }) => {
    currentId = id;
    if (!id) {
      el.hidden = true;
      return;
    }
    render(id);
  });

  // live refresh while hovering (state advances with the clock)
  api.events.on('time', () => {
    if (currentId && !el.hidden) render(currentId);
  });

  return { el };
}
