/**
 * ALERTS rail — the fusion surface of the OS: live hazards correlated
 * with corpus assets, and the corpus's own active disruptions, in one
 * ranked column.
 *
 * Honesty rules of this rail:
 *   - a hazard×asset row is a COMPUTED PROXIMITY — a great-circle
 *     distance between a REPORTED epicenter and a corpus facility. It
 *     claims nearness, never impact.
 *   - the correlation thresholds are printed on the rail itself, so an
 *     empty rail reads "nothing within the stated criteria", never
 *     "nothing happened".
 *   - with the seismic feed off, the rail says so and offers the
 *     toggle — it never silently correlates against nothing.
 *   - corpus disruptions are the loaded corpus's own events, shown
 *     with severity and affected count; live and corpus rows are never
 *     mixed without their section labels.
 */

import type { AppApi } from '../app/api';
import { correlateQuakes, PROXIMITY_THRESHOLDS, type HazardAlert } from '../intel/proximity';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const REFRESH_MS = 30_000;

export function createAlertsRail(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'pe-alerts';

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'pe-alerts-head';

  const body = document.createElement('div');
  body.className = 'pe-alerts-body';
  el.append(head, body);

  let open = true;
  head.addEventListener('click', () => {
    open = !open;
    body.hidden = !open;
  });

  const thresholdLine = PROXIMITY_THRESHOLDS.map(
    (t) => `M${t.minMag}+ ≤ ${t.radiusKm} km`
  ).join(' · ');

  const hazardRow = (a: HazardAlert): HTMLElement => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `pe-alert-row ${a.severity}`;
    row.innerHTML = `
      <div class="pe-alert-title">M${a.mag.toFixed(1)} · ${Math.round(a.distanceKm)} KM FROM ${esc(a.nodeName.toUpperCase())}</div>
      <div class="pe-alert-sub">${esc(a.place)} · REPORTED ${a.reportAgeHours < 1 ? `${Math.round(a.reportAgeHours * 60)}M` : `${a.reportAgeHours.toFixed(1)}H`} AGO · USGS</div>
      <div class="pe-alert-basis">PROXIMITY COMPUTED — great-circle; nearness, not impact</div>`;
    row.addEventListener('click', () => api.focus(a.nodeId));
    return row;
  };

  const render = (): void => {
    body.replaceChildren();
    const nowMs = Date.now();

    // ---- live hazards × corpus assets
    const sect1 = document.createElement('div');
    sect1.className = 'pe-alerts-sect';
    sect1.textContent = `LIVE HAZARDS × ASSETS · ${thresholdLine}`;
    body.appendChild(sect1);

    const quakes = api.getLiveQuakes();
    let hazardCount = 0;
    if (quakes === null) {
      const off = document.createElement('div');
      off.className = 'pe-alerts-off';
      off.innerHTML = `<span>LIVE SEISMIC FEED OFF — no correlation is run against nothing.</span>`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pe-alerts-enable';
      btn.textContent = 'ENABLE LIVE SEISMIC';
      btn.addEventListener('click', () => api.setLayerVisible('live.seismic', true));
      off.appendChild(btn);
      body.appendChild(off);
    } else {
      const alerts = correlateQuakes(quakes, api.store.snapshot.nodes, nowMs);
      hazardCount = alerts.length;
      if (!alerts.length) {
        const none = document.createElement('div');
        none.className = 'pe-alerts-none';
        none.textContent = `NO REPORTED EPICENTER (${quakes.length} in the 24h feed) FALLS WITHIN THE STATED RADII OF A CORPUS ASSET`;
        body.appendChild(none);
      } else {
        for (const a of alerts.slice(0, 8)) body.appendChild(hazardRow(a));
        if (alerts.length > 8) {
          const more = document.createElement('div');
          more.className = 'pe-alerts-none';
          more.textContent = `+${alerts.length - 8} MORE CORRELATIONS`;
          body.appendChild(more);
        }
      }
    }

    // ---- corpus disruptions (the loaded corpus's own events, at sim time)
    const t = Date.parse(api.clock.simTime);
    const active = api.store.snapshot.events
      .filter((e) => Date.parse(e.start) <= t && (!e.end || Date.parse(e.end) >= t))
      .sort((a, b) => b.severity - a.severity);
    const sect2 = document.createElement('div');
    sect2.className = 'pe-alerts-sect';
    sect2.textContent = `CORPUS DISRUPTIONS · ACTIVE AT SIM TIME`;
    body.appendChild(sect2);
    if (!active.length) {
      const none = document.createElement('div');
      none.className = 'pe-alerts-none';
      none.textContent = 'NO EVENTS ACTIVE AT THE CURRENT SIM INSTANT';
      body.appendChild(none);
    } else {
      for (const e of active.slice(0, 5)) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `pe-alert-row ${e.severity >= 0.7 ? 'alert' : 'warn'}`;
        row.innerHTML = `
          <div class="pe-alert-title">${esc(e.name.toUpperCase())}</div>
          <div class="pe-alert-sub">${esc(e.category.toUpperCase())} · SEV ${Math.round(e.severity * 100)}% · AFFECTS ${e.affects.length}</div>`;
        if (e.affects[0]) row.addEventListener('click', () => api.focus(e.affects[0]));
        body.appendChild(row);
      }
    }

    const total = hazardCount + active.length;
    head.innerHTML = `ALERTS ${total ? `<b>${total}</b>` : '<span class="pe-alerts-zero">0</span>'}`;
    el.classList.toggle('pe-alerts-hot', hazardCount > 0 || active.some((e) => e.severity >= 0.7));
  };

  // recompute when the feed lands, when sim time jumps regimes, and on
  // a quiet interval (report ages drift)
  api.events.on('liveQuakes', render);
  let lastSim = 0;
  api.events.on('time', ({ t }) => {
    const ms = Date.parse(t);
    if (Math.abs(ms - lastSim) > 3600_000 * 6) {
      lastSim = ms;
      render();
    }
  });
  window.setInterval(render, REFRESH_MS);

  // reference yields to work: tuck when the inspector or a panel is up
  let panelOpen = false;
  let inspecting = false;
  const sync = (): void => {
    el.classList.toggle('pe-alerts-tucked', panelOpen || inspecting);
  };
  api.events.on('preset', ({ preset }) => {
    panelOpen =
      preset === 'operations' ||
      preset === 'agents' ||
      preset === 'scenarios' ||
      preset === 'commodities' ||
      preset === 'markets';
    sync();
  });
  api.events.on('select', ({ id }) => {
    inspecting = id !== null;
    sync();
  });
  api.events.on('countrySelect', ({ code }) => {
    inspecting = inspecting || code !== null;
    if (code === null && !api.getSelection()) inspecting = false;
    sync();
  });

  render();
  return { el };
}
