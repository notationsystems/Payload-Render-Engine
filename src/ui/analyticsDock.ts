/**
 * Analytics dock — GLOBAL KPIs + TOP BOTTLENECKS instrument cards.
 * Every number is derived from the corpus at the current sim time via
 * the deterministic state resolver; nothing here is decorative.
 */

import type { AppApi } from '../app/api';
import type { EntityId } from '../data/contracts';
import { drawSparkline } from './sparkline';

const REFRESH_MS = 1000;
const SPARK_SAMPLES = 40;

export function createAnalyticsDock(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'os-dock';

  // ------------------------------------------------------------ KPI card
  const kpiCard = document.createElement('div');
  kpiCard.className = 'os-card';
  kpiCard.innerHTML = `
    <div class="os-card-title">GLOBAL KPIS</div>
    <div class="os-kpis"></div>
    <div class="os-spark-label">MEAN NETWORK UTILIZATION — RANGE</div>
    <canvas class="os-spark" width="252" height="36"></canvas>`;
  const kpiGrid = kpiCard.querySelector('.os-kpis') as HTMLElement;
  const sparkCanvas = kpiCard.querySelector('.os-spark') as HTMLCanvasElement;

  // ------------------------------------------------------ bottlenecks card
  const bnCard = document.createElement('div');
  bnCard.className = 'os-card';
  bnCard.innerHTML = `<div class="os-card-title">TOP BOTTLENECKS</div><div class="os-bn-list"></div>`;
  const bnList = bnCard.querySelector('.os-bn-list') as HTMLElement;

  // collapse toggle
  const toggle = document.createElement('button');
  toggle.className = 'os-dock-toggle';
  toggle.type = 'button';
  toggle.textContent = 'ANALYTICS';
  let collapsed = false;
  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    kpiCard.hidden = collapsed;
    bnCard.hidden = collapsed;
    toggle.classList.toggle('collapsed', collapsed);
  });

  el.append(toggle, kpiCard, bnCard);

  const kpi = (label: string, value: string, delta?: string, tone?: string): string => `
    <div class="os-kpi">
      <div class="os-kpi-label">${label}</div>
      <div class="os-kpi-value">${value}${
        delta ? ` <span class="os-kpi-delta ${tone ?? ''}">${delta}</span>` : ''
      }</div>
    </div>`;

  let sparkPts: { t: number; v: number }[] | null = null;

  const meanUtilAt = (t: string): number => {
    const routes = api.store.snapshot.routes;
    let sum = 0;
    for (const r of routes) sum += api.store.stateAt(r.id, t).utilization;
    return routes.length ? sum / routes.length : 0;
  };

  const render = (): void => {
    if (collapsed) return;
    const t = api.clock.simTime;
    const snap = api.store.snapshot;

    let disrupted = 0;
    let degraded = 0;
    let utilSum = 0;
    for (const r of snap.routes) {
      const s = api.store.stateAt(r.id, t);
      utilSum += s.utilization;
      if (s.status === 'disrupted') disrupted++;
      else if (s.status === 'degraded') degraded++;
    }
    const meanUtil = snap.routes.length ? utilSum / snap.routes.length : 0;
    const dayAgo = new Date(api.clock.simMillis - 86400000).toISOString();
    const meanUtilPrev = meanUtilAt(dayAgo);
    const deltaPct = (meanUtil - meanUtilPrev) * 100;
    const activeEvents = api.store.activeEvents(t).length;
    const movingFlows = snap.flows.filter((f) => f.status === 'moving').length;

    kpiGrid.innerHTML =
      kpi('ACTIVE FLOWS', String(movingFlows)) +
      kpi(
        'NETWORK UTIL',
        `${Math.round(meanUtil * 100)}%`,
        `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)} / 24H`,
        deltaPct > 1.5 ? 'warn' : deltaPct < -1.5 ? 'ok' : ''
      ) +
      kpi('DISRUPTED', String(disrupted), degraded ? `+${degraded} DEGRADED` : undefined, disrupted ? 'alert' : '') +
      kpi('ACTIVE EVENTS', String(activeEvents), undefined, activeEvents > 2 ? 'warn' : '');

    // sparkline across the whole range (cached — deterministic data)
    if (!sparkPts) {
      const { startMs, endMs } = api.clock.range;
      sparkPts = [];
      for (let i = 0; i < SPARK_SAMPLES; i++) {
        const ms = startMs + ((endMs - startMs) * i) / (SPARK_SAMPLES - 1);
        sparkPts.push({ t: ms, v: meanUtilAt(new Date(ms).toISOString()) });
      }
    }
    drawSparkline(sparkCanvas, sparkPts, {
      min: 0,
      max: 1,
      markerT: api.clock.simMillis,
      nowT: api.clock.range.nowMs,
    });

    // bottlenecks: chokepoints + routes ranked by live congestion
    const rows: { id: EntityId; name: string; congestion: number; kind: string }[] = [];
    for (const n of snap.nodes) {
      if (n.kind !== 'chokepoint') continue;
      rows.push({ id: n.id, name: n.name, congestion: api.store.stateAt(n.id, t).congestion, kind: 'CHOKEPOINT' });
    }
    for (const r of snap.routes) {
      const s = api.store.stateAt(r.id, t);
      if (s.congestion > 0.55) rows.push({ id: r.id, name: r.name, congestion: s.congestion, kind: r.mode.toUpperCase() });
    }
    rows.sort((a, b) => b.congestion - a.congestion);
    bnList.replaceChildren(
      ...rows.slice(0, 5).map((row, i) => {
        const div = document.createElement('div');
        div.className = 'os-bn-row';
        const sev = row.congestion > 0.66 ? 'HIGH' : row.congestion > 0.45 ? 'MED' : 'LOW';
        div.innerHTML = `
          <span class="os-bn-rank">${i + 1}</span>
          <span class="os-bn-name">${row.name}</span>
          <span class="os-bn-chip ${sev.toLowerCase()}">${sev}</span>
          <span class="os-bn-val">${Math.round(row.congestion * 100)}%</span>`;
        div.title = row.kind;
        div.addEventListener('click', () => api.focus(row.id));
        return div;
      })
    );
  };

  let last = 0;
  api.events.on('time', () => {
    const now = performance.now();
    if (now - last < REFRESH_MS) return;
    last = now;
    render();
  });
  // first paint once the store has data
  queueMicrotask(render);

  return { el };
}
