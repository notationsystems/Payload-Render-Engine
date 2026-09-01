/**
 * SCENARIOS view — temporal frames of the twin.
 *
 * Honest by construction: the frames listed are the ones the clock and
 * the counterfactual engine can actually produce (historical
 * reconstruction, current, deterministic forecast, and now computed
 * HYPOTHETICAL frames). World events are listed as scenario seeds you
 * can jump to and watch propagate through the network state.
 * Counterfactual frames run through the propagation engine and are
 * framed in the hypothetical violet — dashed, striped, labeled
 * COMPUTED, NOT OBSERVED. A simulated outcome is not an outcome.
 */

import type { AppApi } from '../app/api';
import type { ScenarioImpact, ScenarioRankingRow, ScenarioRole } from '../data/scenario';
import type { EntityId } from '../data/contracts';
import './scenario.css';

/** Corpus strings are synthetic and trusted, but markup-escape anyway. */
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const pct = (x: number): string => `${Math.round(x * 100)}%`;

const ROLE_ORDER: Record<ScenarioRole, number> = { perturbed: 0, downstream: 1, spillover: 2 };

export function createScenariosPanel(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'os-panel sc-panel';
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
    <div class="os-frame"><span class="os-frame-dot" data-r="scenario"></span><span class="sc-frame-live">HYPOTHETICAL</span><span class="os-frame-note">enter a frame below — rendered as a violet dashed overlay, never as state</span></div>`;

  // ---- chokepoint criticality: every frame computed (not entered) and
  //      ranked — standing intelligence, refreshed when the panel opens ------

  const critTitle = document.createElement('div');
  critTitle.className = 'os-card-title sc-title';
  critTitle.textContent = 'CHOKEPOINT CRITICALITY — COMPUTED, NOT OBSERVED';

  const crit = document.createElement('div');
  crit.className = 'sc-crit';

  /** Rows cached from the last recompute; re-styled (not recomputed) on
   *  scenario enter/exit so the active frame stays visually pinned. */
  let critRows: ScenarioRankingRow[] = [];

  const renderCriticality = (activeId: EntityId | null): void => {
    crit.innerHTML = '';

    const scroll = document.createElement('div');
    scroll.className = 'sc-crit-scroll';
    const table = document.createElement('div');
    table.className = 'sc-crit-table';

    const head = document.createElement('div');
    head.className = 'sc-crit-head';
    head.innerHTML = `
      <span class="sc-crit-rank">#</span>
      <span class="sc-crit-name">FRAME</span>
      <span class="sc-crit-num">BLOCKED</span>
      <span class="sc-crit-num">QUEUED</span>
      <span class="sc-crit-num">SPILL</span>
      <span class="sc-crit-num">+DELAY</span>`;
    table.appendChild(head);

    critRows.forEach((row, i) => {
      const r = document.createElement('div');
      r.className = 'sc-crit-row';
      if (i === 0) r.classList.add('sc-crit-row-top');
      r.innerHTML = `
        <span class="sc-crit-rank">${i + 1}</span>
        <span class="sc-crit-name">${esc(row.name)}</span>
        <span class="sc-crit-num">${row.summary.perturbedRoutes}</span>
        <span class="sc-crit-num">${row.summary.flowsDelayed}</span>
        <span class="sc-crit-num">${row.summary.spilloverRoutes}</span>
        <span class="sc-crit-num sc-crit-delay">+${row.summary.totalDelayHours} H</span>`;
      if (activeId !== null && row.specId === activeId) {
        r.classList.add('sc-crit-row-active');
        // chip rides INSIDE the name cell — numeric columns keep their grid
        const chip = document.createElement('span');
        chip.className = 'sc-active-chip';
        chip.textContent = 'ACTIVE';
        r.querySelector('.sc-crit-name')?.appendChild(chip);
      } else if (activeId !== null) {
        r.classList.add('sc-crit-row-inert');
      } else {
        r.addEventListener('click', () => api.runScenario(row.specId));
      }
      table.appendChild(r);
    });

    scroll.appendChild(table);
    crit.appendChild(scroll);

    const note = document.createElement('div');
    note.className = 'sc-crit-note';
    note.textContent =
      'every frame computed at current sim time — ranked by simulated queued delay';
    crit.appendChild(note);
  };

  /** Recompute the ranking at the current sim time. Called when the panel
   *  becomes visible — never on time ticks. */
  const recomputeCriticality = (): void => {
    critRows = api.rankScenarios();
    renderCriticality(api.getActiveScenario()?.spec.id ?? null);
  };

  // ---- counterfactual frames: catalog + impact readout --------------------

  const cfTitle = document.createElement('div');
  cfTitle.className = 'os-card-title sc-title';
  cfTitle.textContent = 'COUNTERFACTUAL FRAMES — COMPUTED, NOT OBSERVED';

  const catalog = document.createElement('div');
  catalog.className = 'sc-catalog';

  const impactBox = document.createElement('div');
  impactBox.className = 'sc-impact sc-hidden-guard';
  impactBox.hidden = true;

  const renderCatalog = (activeId: EntityId | null): void => {
    catalog.innerHTML = '';
    if (api.scenariosUnavailableReason && api.listScenarios().length === 0) {
      const note = document.createElement('div');
      note.className = 'sc-spec-desc';
      note.style.padding = '10px 12px';
      note.textContent = api.scenariosUnavailableReason;
      catalog.appendChild(note);
      return;
    }
    for (const spec of api.listScenarios()) {
      if (activeId !== null && spec.id !== activeId) continue;
      const row = document.createElement('div');
      row.className = 'sc-spec';
      row.innerHTML = `
        <div class="sc-spec-main">
          <div class="sc-spec-name">${esc(spec.name)}</div>
          <div class="sc-spec-desc">${esc(spec.description)}</div>
        </div>`;
      if (activeId === null) {
        const run = document.createElement('button');
        run.className = 'sc-run';
        run.type = 'button';
        run.textContent = 'RUN FRAME';
        run.addEventListener('click', () => api.runScenario(spec.id));
        row.appendChild(run);
      } else {
        const active = document.createElement('span');
        active.className = 'sc-active-chip';
        active.textContent = 'FRAME ACTIVE';
        row.appendChild(active);
      }
      catalog.appendChild(row);
    }
  };

  const renderImpact = (impact: ScenarioImpact | null): void => {
    if (!impact) {
      impactBox.hidden = true;
      impactBox.innerHTML = '';
      renderCatalog(null);
      return;
    }
    renderCatalog(impact.spec.id);
    impactBox.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'sc-impact-title';
    title.textContent = 'IMPACT — HYPOTHETICAL FRAME';

    const s = impact.summary;
    const kpis = document.createElement('div');
    kpis.className = 'sc-kpis';
    const pairs: [string, string][] = [
      ['BLOCKED LANES', String(s.perturbedRoutes)],
      ['DOWNSTREAM FACILITIES', String(s.downstreamFacilities)],
      ['SPILLOVER LANES', String(s.spilloverRoutes)],
      ['FLOWS QUEUED', String(s.flowsDelayed)],
      ['TOTAL DELAY', `+${s.totalDelayHours}h`],
    ];
    kpis.innerHTML = pairs
      .map(
        ([label, value]) => `
        <div>
          <div class="sc-kpi-label">${esc(label)}</div>
          <div class="sc-kpi-value">${esc(value)}</div>
        </div>`
      )
      .join('');

    impactBox.append(title, kpis);

    if (impact.delayedFlows.length) {
      const sub = document.createElement('div');
      sub.className = 'sc-sub';
      sub.textContent = 'QUEUED FLOWS';
      impactBox.appendChild(sub);
      for (const df of impact.delayedFlows) {
        const flow = api.store.flow(df.flowId);
        const row = document.createElement('div');
        row.className = 'sc-flow';
        row.innerHTML = `
          <span class="sc-flow-name">${esc(flow?.name ?? df.flowId)}</span>
          <span class="sc-flow-note">${esc(df.note)}</span>
          <span class="sc-flow-delay">+${df.delayHours} H</span>`;
        row.addEventListener('click', () => api.focus(df.flowId));
        impactBox.appendChild(row);
      }
    }

    const deltas = [...impact.deltas].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
    if (deltas.length) {
      const sub = document.createElement('div');
      sub.className = 'sc-sub';
      sub.textContent = `STATE DELTAS — ${Math.min(10, deltas.length)} OF ${deltas.length}`;
      impactBox.appendChild(sub);
      for (const d of deltas.slice(0, 10)) {
        const entity = api.store.entity(d.entityId);
        const row = document.createElement('div');
        row.className = 'sc-delta';
        row.title = d.note;
        row.innerHTML = `
          <span class="sc-role" data-role="${d.role}">${d.role.toUpperCase()}</span>
          <span class="sc-delta-name">${esc(entity?.name ?? d.entityId)}</span>
          <span class="sc-delta-note">${esc(d.note)}</span>
          <span class="sc-delta-util">UTIL ${pct(d.baseline.utilization)} → ${pct(d.scenario.utilization)}</span>`;
        row.addEventListener('click', () => api.focus(d.entityId));
        impactBox.appendChild(row);
      }
    }

    const foot = document.createElement('div');
    foot.className = 'sc-impact-foot';
    const standing = document.createElement('span');
    standing.className = 'sc-impact-standing';
    standing.textContent = 'simulated outcome — not an outcome';
    const exit = document.createElement('button');
    exit.className = 'sc-exit';
    exit.type = 'button';
    exit.textContent = 'EXIT FRAME';
    exit.addEventListener('click', () => api.clearScenario());
    foot.append(standing, exit);
    impactBox.appendChild(foot);

    impactBox.hidden = false;
  };

  // ---- event seeds --------------------------------------------------------

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

  el.append(header, frames, critTitle, crit, cfTitle, catalog, impactBox, listTitle, list);

  api.events.on('preset', ({ preset }) => {
    el.hidden = preset !== 'scenarios';
    // refresh the ranking when the panel opens so it tracks sim time —
    // deliberately NOT on every time tick
    if (preset === 'scenarios') recomputeCriticality();
  });
  api.events.on('scenario', ({ active, impact }) => {
    renderImpact(active && impact ? impact : null);
    // re-style the cached rows around the active frame; no recompute
    renderCriticality(active && impact ? impact.spec.id : null);
  });
  recomputeCriticality();
  renderImpact(api.getActiveScenario());

  return { el };
}
