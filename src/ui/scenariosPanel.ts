/**
 * SCENARIOS view — temporal frames of the twin.
 *
 * Honest by construction: the frames that exist today are the ones the
 * clock can actually produce (historical reconstruction, current,
 * deterministic forecast). World events are listed as scenario seeds
 * you can jump to and watch propagate through the network state.
 * Hypothetical frames ('what if this load slips') belong to the
 * propagation engine and are explicitly marked as not yet wired —
 * a simulated outcome is not an outcome.
 */

import type { AppApi } from '../app/api';

/** Corpus strings are synthetic and trusted, but markup-escape anyway. */
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function createScenariosPanel(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'os-panel';
  el.hidden = true;

  const header = document.createElement('div');
  header.className = 'os-panel-head';
  header.innerHTML = `
    <div>
      <div class="os-panel-kicker">TEMPORAL FRAMES</div>
      <div class="os-panel-title">Scenarios</div>
    </div>`;
  const close = document.createElement('button');
  close.className = 'os-panel-close';
  close.type = 'button';
  close.textContent = '×';
  close.addEventListener('click', () => api.setPreset(api.getLastLayerPreset()));
  header.appendChild(close);

  const frames = document.createElement('div');
  frames.className = 'os-frames';
  frames.innerHTML = `
    <div class="os-frame"><span class="os-frame-dot" data-r="historical"></span>RECONSTRUCTION<span class="os-frame-note">what happened — scrub left of NOW</span></div>
    <div class="os-frame"><span class="os-frame-dot" data-r="current"></span>CURRENT<span class="os-frame-note">the mirror at the knowledge boundary</span></div>
    <div class="os-frame"><span class="os-frame-dot" data-r="forecast"></span>FORECAST<span class="os-frame-note">deterministic projection — scrub right of NOW</span></div>
    <div class="os-frame off"><span class="os-frame-dot" data-r="scenario"></span>HYPOTHETICAL<span class="os-frame-note">propagation engine + re-optimization — not yet wired; reserved as regime 'scenario'</span></div>`;

  const listTitle = document.createElement('div');
  listTitle.className = 'os-card-title';
  listTitle.textContent = 'EVENT SEEDS — SYNTHETIC / DEMO DATA';

  const list = document.createElement('div');
  list.className = 'os-seed-list';
  const events = [...api.store.snapshot.events].sort(
    (a, b) => Date.parse(a.start) - Date.parse(b.start)
  );
  const { startMs, endMs } = api.clock.range;
  for (const ev of events) {
    const row = document.createElement('div');
    row.className = 'os-seed';
    const window_ = `${ev.start.slice(5, 10)} → ${ev.end ? ev.end.slice(5, 10) : 'OPEN'}`;
    row.innerHTML = `
      <div class="os-seed-head">
        <span class="os-seed-name">${esc(ev.name)}</span>
        <span class="os-seed-cat">${ev.category.toUpperCase()}</span>
      </div>
      <div class="os-seed-meta">
        <span>${window_}</span>
        <span>AFFECTS ${ev.affects.length}</span>
        <span class="os-seed-sev"><i style="width:${Math.round(ev.severity * 100)}%"></i></span>
      </div>
      <div class="os-seed-desc">${esc(ev.description)}</div>`;
    const actions = document.createElement('div');
    actions.className = 'os-seed-actions';
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.textContent = 'JUMP TO ONSET';
    jump.addEventListener('click', () => {
      const f = (Date.parse(ev.start) + 3 * 3600000 - startMs) / (endMs - startMs);
      api.clock.setFraction(Math.min(1, Math.max(0, f)));
      api.setLayerVisible('intel.anomalies', true);
    });
    const focusBtn = document.createElement('button');
    focusBtn.type = 'button';
    focusBtn.textContent = 'FOCUS';
    focusBtn.addEventListener('click', () => {
      const first = ev.affects.find((id) => api.store.entity(id));
      if (first) api.focus(first);
    });
    actions.append(jump, focusBtn);
    row.appendChild(actions);
    list.appendChild(row);
  }

  el.append(header, frames, listTitle, list);

  api.events.on('preset', ({ preset }) => {
    el.hidden = preset !== 'scenarios';
  });

  return { el };
}
