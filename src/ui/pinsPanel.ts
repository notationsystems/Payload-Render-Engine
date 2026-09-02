/**
 * Pin-to-compare — the kepler tooltip-pinning pattern as an
 * instrument. Shift-click pins an entity (selection untouched); two
 * pins make an A/B pair with a delta strip.
 *
 * Delta honesty: every delta is COMPUTED FROM CORPUS STATE AT SIM
 * TIME and says so; a utilization delta exists only when BOTH sides
 * are observed — one unobserved side yields "Δ UNAVAILABLE — <side>
 * UNOBSERVED", never a delta against a guess. Unlike kinds compare
 * side-by-side only; the strip refuses to subtract a port from a
 * shipping lane.
 */

import type { AppApi } from '../app/api';
import type { EntityId } from '../data/contracts';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function createPinsPanel(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'pe-pins';
  el.hidden = true;

  let pins: EntityId[] = [];

  const stateLine = (id: EntityId): string => {
    const s = api.store.stateAt(id, api.clock.simTime);
    if (s.observed === false) return '<span class="pe-pin-unobs">STATE UNOBSERVED</span>';
    return `UTIL <b>${Math.round(s.utilization * 100)}%</b> · ${esc(s.status.toUpperCase())}`;
  };

  const card = (id: EntityId, slot: 'A' | 'B'): HTMLElement => {
    const node = api.store.node(id);
    const route = api.store.route(id);
    const ent = node ?? route;
    const c = document.createElement('div');
    c.className = 'pe-pin-card';
    if (!ent) {
      c.innerHTML = `<span class="pe-pin-slot">PIN ${slot}</span> entity no longer in corpus`;
      return c;
    }
    const kind = route ? route.mode.toUpperCase() : node!.kind.replace(/_/g, ' ').toUpperCase();
    const detail = route
      ? `${Math.round(route.distanceKm).toLocaleString('en-US')} KM · PROMISED ${route.estimatedDurationHours ? `${Math.round(route.estimatedDurationHours)}H` : '—'}`
      : `${node!.geometry.coordinates[1].toFixed(2)}°, ${node!.geometry.coordinates[0].toFixed(2)}°`;
    c.innerHTML = `
      <div class="pe-pin-head">
        <span class="pe-pin-slot">PIN ${slot}</span>
        <button type="button" class="pe-pin-name">${esc(ent.name)}</button>
        <button type="button" class="pe-pin-x" title="unpin">×</button>
      </div>
      <div class="pe-pin-meta">${esc(kind)} · ${esc(detail)}</div>
      <div class="pe-pin-state">${stateLine(id)}</div>`;
    c.querySelector('.pe-pin-name')!.addEventListener('click', () => api.focus(id));
    c.querySelector('.pe-pin-x')!.addEventListener('click', () => {
      pins = pins.filter((p) => p !== id);
      render();
    });
    return c;
  };

  const deltaStrip = (a: EntityId, b: EntityId): HTMLElement => {
    const strip = document.createElement('div');
    strip.className = 'pe-pin-delta';
    const ra = api.store.route(a);
    const rb = api.store.route(b);
    const na = api.store.node(a);
    const nb = api.store.node(b);
    const rows: string[] = [];
    if ((ra && nb) || (na && rb)) {
      rows.push('DIFFERENT KINDS — side-by-side only, no delta computed');
    } else {
      if (ra && rb) {
        rows.push(`Δ DISTANCE <b>${(rb.distanceKm - ra.distanceKm >= 0 ? '+' : '')}${Math.round(rb.distanceKm - ra.distanceKm).toLocaleString('en-US')} KM</b> (B − A)`);
        if (ra.estimatedDurationHours && rb.estimatedDurationHours) {
          const d = rb.estimatedDurationHours - ra.estimatedDurationHours;
          rows.push(`Δ PROMISED <b>${d >= 0 ? '+' : ''}${Math.round(d)}H</b> (declared promises, B − A)`);
        }
      }
      const sa = api.store.stateAt(a, api.clock.simTime);
      const sb = api.store.stateAt(b, api.clock.simTime);
      if (sa.observed === false || sb.observed === false) {
        const who = sa.observed === false && sb.observed === false ? 'BOTH' : sa.observed === false ? 'A' : 'B';
        rows.push(`Δ UTIL UNAVAILABLE — ${who} UNOBSERVED (no delta against a guess)`);
      } else {
        const d = Math.round((sb.utilization - sa.utilization) * 100);
        rows.push(`Δ UTIL <b>${d >= 0 ? '+' : ''}${d}PP</b> (B − A)`);
      }
    }
    strip.innerHTML =
      rows.map((r) => `<div class="pe-pin-drow">${r}</div>`).join('') +
      `<div class="pe-pin-basis">DELTAS COMPUTED FROM CORPUS STATE AT SIM TIME ${esc(api.clock.simTime.slice(0, 16))}Z</div>`;
    return strip;
  };

  const render = (): void => {
    el.replaceChildren();
    el.hidden = pins.length === 0;
    if (!pins.length) return;
    const head = document.createElement('div');
    head.className = 'pe-pins-head';
    head.innerHTML = `COMPARE · SHIFT-CLICK PINS${pins.length === 1 ? ' — PIN A SECOND ENTITY FOR DELTAS' : ''}`;
    el.appendChild(head);
    el.appendChild(card(pins[0], 'A'));
    if (pins[1]) {
      el.appendChild(card(pins[1], 'B'));
      el.appendChild(deltaStrip(pins[0], pins[1]));
    }
  };

  api.events.on('pin', ({ id }) => {
    if (pins.includes(id)) {
      pins = pins.filter((p) => p !== id); // shift-click again unpins
    } else {
      pins = [...pins, id].slice(-2); // a third pin retires the oldest
    }
    render();
  });

  // state advances with the clock — refresh at a quiet cadence
  let lastRender = 0;
  api.events.on('time', () => {
    if (el.hidden) return;
    const now = performance.now();
    if (now - lastRender < 1000) return;
    lastRender = now;
    render();
  });

  return { el };
}
