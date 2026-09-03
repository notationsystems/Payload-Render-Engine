/**
 * OPERATIONS view — the twin's read-only mirror of the Terminal's
 * brokerage control tower.
 *
 * Design contract, inherited from the desk itself:
 *   - EXCEPTION-FIRST: the queue orders by attention, and every row
 *     leads with a NAMED issue — observed detail, operator remedy,
 *     deadline, evidence count. No composite scores, ever.
 *   - REFUSAL-FIRST: an unconfigured, unauthorized, or corrupt desk
 *     renders the typed refusal with its remedy. There is no state in
 *     which this panel silently shows an empty desk it cannot vouch for.
 *   - READ-ONLY: the twin renders the projection; commands execute in
 *     the Terminal desk under its own authority. Nothing here mutates.
 *   - POSITION HONESTY: the tower serves tracking timestamps, not
 *     coordinates — the globe draws the DECLARED lane (dashed when
 *     tracking is unobserved) and never a vehicle marker.
 */

import { esc } from '../core/escape';
import type { AppApi } from '../app/api';
import {
  fetchOperations,
  fetchOpsCommunication,
  fetchOpsFuel,
  fmtOpsMetric,
  humanizeOpsCode,
  opsTrackingObserved,
  resolveOpsPlace,
  sortOpsLoads,
  type OpsCommsResult,
  type OpsFuelResult,
  type OpsLoad,
  type OpsReadResult,
  type OpsSnapshot,
} from '../data/operations';
import { resolveApiBase } from '../data/sources';
import { recordFeed } from '../core/health';
import './ops.css';


const POLL_MS = 30_000; // the desk's own cadence

const fmtInstant = (t: string | null): string =>
  t ? `${t.slice(0, 10)} ${t.slice(11, 16)}Z` : '—';

export function createOpsPanel(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'os-panel ops-panel';
  el.hidden = true;

  const header = document.createElement('div');
  header.className = 'os-panel-head';
  header.innerHTML = `
    <div>
      <div class="os-panel-kicker">BROKERAGE CONTROL TOWER</div>
      <div class="os-panel-title">Operations</div>
    </div>`;
  const close = document.createElement('button');
  close.className = 'os-panel-close';
  close.type = 'button';
  close.textContent = '×';
  close.addEventListener('click', () => api.setPreset(api.getLastLayerPreset()));
  header.appendChild(close);

  const mirror = document.createElement('div');
  mirror.className = 'ops-mirror';
  mirror.innerHTML =
    'READ-ONLY MIRROR — a projection over the Terminal’s append-only operation journals. ' +
    'Propose → authorize → execute lives in the Terminal desk; the twin renders, it never commands.';

  const statusLine = document.createElement('div');
  statusLine.className = 'ops-status';

  const body = document.createElement('div');
  body.className = 'ops-body';

  el.append(header, mirror, statusLine, body);

  let expanded: string | null = null;
  let selectedLane: string | null = null;
  let last: OpsReadResult | null = null;
  let lastFetchedAt: number | null = null;
  let timer: number | undefined;
  /** Comms journal per operation, cached until the next tower refresh. */
  const commsCache = new Map<string, OpsCommsResult>();
  let fuel: OpsFuelResult | null = null;

  // ---------------------------------------------------------------- render

  const renderStatus = (): void => {
    if (!last) {
      statusLine.textContent = 'CONTACTING SPATIAL API …';
      return;
    }
    if (last.kind === 'ok') {
      const age = lastFetchedAt ? Math.round((Date.now() - lastFetchedAt) / 1000) : 0;
      statusLine.innerHTML =
        `<span class="ops-live-dot"></span>AS OF <b>${esc(fmtInstant(last.snapshot.asOf))}</b>` +
        ` · refreshed ${age}s ago · every ${POLL_MS / 1000}s` +
        ` · <span class="ops-src">TERMINAL:OPERATIONS · JOURNAL PROJECTION</span>`;
    } else {
      statusLine.innerHTML = `<span class="ops-live-dot ops-dot-down"></span><span class="ops-src">DESK UNAVAILABLE — see refusal below</span>`;
    }
  };

  const refusalBox = (kind: string, message: string, remedy: string): HTMLElement => {
    const box = document.createElement('div');
    box.className = 'ops-refusal';
    box.innerHTML = `
      <div class="ops-refusal-kind">${esc(humanizeOpsCode(kind))}</div>
      <div class="ops-refusal-detail">${esc(message)}</div>
      <div class="ops-refusal-remedy-label">REMEDY</div>
      <div class="ops-refusal-remedy">${esc(remedy)}</div>
      <div class="ops-refusal-note">The mirror refuses rather than showing an empty desk it cannot vouch for.</div>`;
    return box;
  };

  const kpi = (label: string, value: number, tone?: string): string => `
    <div class="ops-kpi ${tone ?? ''}">
      <div class="ops-kpi-v">${value}</div>
      <div class="ops-kpi-l">${label}</div>
    </div>`;

  const stateChip = (label: string, value: string | null): string => {
    const v = value ?? 'none';
    const tone =
      v === 'authorized' || v === 'delivered' || v === 'acknowledged'
        ? 'ok'
        : v === 'refused' || v === 'failed' || v === 'rejected'
          ? 'alert'
          : v === 'pending' || v === 'undetermined' || v === 'not_created' || v === 'not_selected'
            ? 'warn'
            : '';
    return `<span class="ops-state ${tone}" title="${esc(label)}">${esc(label)} ${esc(v.replace(/_/g, ' ').toUpperCase())}</span>`;
  };

  // severity strings ride into class names: whitelist, never interpolate
  // raw wire values into markup (esc() alone doesn't protect attributes)
  const SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'none']);
  const sev = (s: string): string => (SEVERITIES.has(s) ? s : 'none');

  const issueBlock = (issue: OpsLoad['issues'][number]): string => `
    <div class="ops-issue">
      <div class="ops-issue-head">
        <span class="ops-sev ops-sev-${sev(issue.severity)}">${sev(issue.severity).toUpperCase()}</span>
        <span class="ops-issue-code">${esc(humanizeOpsCode(issue.code))}</span>
        ${issue.deadlineAt ? `<span class="ops-deadline">DEADLINE ${esc(fmtInstant(issue.deadlineAt))}</span>` : ''}
        <span class="ops-evidence">${issue.evidenceIds.length} EVIDENCE REF${issue.evidenceIds.length === 1 ? '' : 'S'}</span>
      </div>
      <div class="ops-issue-cols">
        <div><div class="ops-col-label">OBSERVED</div><div class="ops-col-text">${esc(issue.detail)}</div></div>
        <div><div class="ops-col-label">OPERATOR REMEDY</div><div class="ops-col-text">${esc(issue.remedy)}</div></div>
      </div>
    </div>`;

  const econLine = (load: OpsLoad): string => {
    const q = load.economics.quotedCost;
    const parts: string[] = [];
    if (q) {
      const interested = q.attestation.restsOnInterested
        ? ' <span class="ops-interest" title="Stated to move a negotiation — the flag routes to measurement, it does not discount the number">NEGOTIATING POSITION</span>'
        : '';
      parts.push(`QUOTED ${esc(fmtOpsMetric(q))}${interested}`);
    } else parts.push('QUOTED —');
    parts.push(`INVOICE ${esc(fmtOpsMetric(load.economics.carrierInvoice))}`);
    parts.push(`MARGIN ${esc(fmtOpsMetric(load.economics.grossMargin))}`);
    return parts.join(' · ');
  };

  /** Minutes between two instants, floored at 0. */
  const lagMin = (a: string, b: string): number =>
    Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60_000));

  /** The comms journal for one load, rendered into its placeholder. */
  const renderComms = (host: HTMLElement, r: OpsCommsResult): void => {
    if (r.kind === 'unreachable') {
      host.innerHTML = `<div class="ops-comms-absent">COMMS JOURNAL UNREACHABLE — ${esc(r.note)}</div>`;
      return;
    }
    if (r.kind === 'refused') {
      host.innerHTML = `<div class="ops-comms-absent">${esc(humanizeOpsCode(r.refusal.kind))} — ${esc(r.refusal.message)}</div>`;
      return;
    }
    if (r.kind === 'none') {
      host.innerHTML =
        '<div class="ops-comms-absent">NO DISPATCH CREATED — the outbox holds nothing for this operation (the journal answered; an honest nothing, not an error)</div>';
      return;
    }
    const c = r.communication;
    const rate = c.envelope.tender.agreedRate;
    const interested = rate.attestation.restsOnInterested
      ? ' <span class="ops-interest" title="Stated to move a negotiation — the flag routes to measurement, it does not discount the number">NEGOTIATING POSITION</span>'
      : '';
    const rows: string[] = [];
    rows.push(
      `<div class="ops-comms-rate">AGREED RATE ${esc(rate.currency)} ${(rate.amountMinor / 100).toFixed(2)}${interested} · ${rate.evidenceIds.length} EVIDENCE REF${rate.evidenceIds.length === 1 ? '' : 'S'}</div>`
    );
    if (!c.attempts.length && !c.carrierEvents.length) {
      // a created-but-unsent dispatch is a state, not an empty list
      rows.push(
        `<div class="ops-comms-row"><span class="ops-state warn">DISPATCH ${esc(c.deliveryState.toUpperCase())}</span>` +
          `<span class="ops-comms-via">no delivery attempts recorded yet · ACK ${esc(c.acknowledgement.toUpperCase())}</span></div>`
      );
    }
    for (const a of c.attempts) {
      const tone = a.state === 'delivered' ? 'ok' : a.state === 'failed' ? 'alert' : 'warn';
      rows.push(
        `<div class="ops-comms-row"><span class="ops-state ${tone}">DISPATCH ${esc(a.state.toUpperCase())}</span>` +
          `<span class="ops-comms-t">${esc(fmtInstant(a.requestedAt))}${a.completedAt ? ` → ${esc(fmtInstant(a.completedAt))}` : ''}</span>` +
          `<span class="ops-comms-via">${a.provider ? `via ${esc(a.provider)}` : 'provider —'}${a.providerReceiptId ? ` · receipt ${esc(a.providerReceiptId)}` : ''}</span>` +
          (a.failure
            ? `<span class="ops-comms-fail">${esc(humanizeOpsCode(a.failure.code))} — ${esc(a.failure.detail)}${a.failure.retryable ? ' (RETRYABLE)' : ' (NOT RETRYABLE)'}</span>`
            : '') +
          `</div>`
      );
    }
    for (const ev of c.carrierEvents) {
      const lag = lagMin(ev.occurredAt, ev.knownAt);
      rows.push(
        `<div class="ops-comms-row"><span class="ops-state ${ev.eventKind === 'acknowledgement' ? 'ok' : ''}">${esc(ev.eventKind.toUpperCase())} ${esc(String(ev.status).replace(/_/g, ' ').toUpperCase())}</span>` +
          `<span class="ops-comms-t">OCCURRED ${esc(fmtInstant(ev.occurredAt))}${lag > 1 ? ` · KNOWN +${lag}M LATER` : ''}</span>` +
          `<span class="ops-comms-via">${ev.evidenceIds.length} EVIDENCE REF${ev.evidenceIds.length === 1 ? '' : 'S'}</span></div>`
      );
    }
    host.innerHTML =
      `<div class="ops-col-label">CARRIER COMMS — OUTBOX + EVENT JOURNAL (READ-ONLY MIRROR)</div>` + rows.join('');
  };

  const focusLane = (load: OpsLoad): void => {
    const o = resolveOpsPlace(load.route.origin);
    const d = resolveOpsPlace(load.route.destination);
    if (!o || !d) {
      api.clearOperationsLane();
      selectedLane = null;
      return;
    }
    api.showOperationsLane(o, d, opsTrackingObserved(load));
    selectedLane = load.operationId;
  };

  const loadRow = (load: OpsLoad): HTMLElement => {
    const row = document.createElement('div');
    row.className = `ops-row ${expanded === load.operationId ? 'open' : ''} ${selectedLane === load.operationId ? 'laned' : ''}`;

    const tracked = opsTrackingObserved(load);
    const next = load.nextAction;
    row.innerHTML = `
      <div class="ops-row-head">
        <span class="ops-sev ops-sev-${sev(load.attentionLevel)}">${sev(load.attentionLevel).toUpperCase()}</span>
        <span class="ops-lane">${esc(load.route.origin ?? '?')} <span class="ops-arrow">→</span> ${esc(load.route.destination ?? '?')}</span>
        <span class="ops-ids">${esc(load.loadId ?? load.operationId)}${load.carrierId ? ` · ${esc(load.carrierId)}` : ''}</span>
        <span class="ops-phase">${esc(humanizeOpsCode(load.state.operationPhase))}</span>
      </div>
      <div class="ops-row-next">
        ${next ? `<span class="ops-next-code">${esc(humanizeOpsCode(next.code))}</span><span class="ops-next-remedy">${esc(next.remedy)}</span>` : '<span class="ops-next-clear">NO ACTION REQUIRED</span>'}
      </div>
      <div class="ops-row-states">
        ${stateChip('AUTH', load.state.authorization)}
        ${stateChip('TENDER', load.state.tenderDelivery)}
        ${stateChip('ACK', load.state.acknowledgement)}
        <span class="ops-state ${tracked ? 'ok' : 'warn'}">TRACKING ${tracked ? esc((load.state.tracking ?? 'observed').toUpperCase()) : 'UNOBSERVED'}</span>
      </div>`;

    if (expanded === load.operationId) {
      const detail = document.createElement('div');
      detail.className = 'ops-detail';
      detail.innerHTML = `
        <div class="ops-econ">${econLine(load)}</div>
        <div class="ops-times">
          PICKUP ${esc(fmtInstant(load.timing.pickupWindow?.start ?? null))} · DELIVERY ${esc(fmtInstant(load.timing.deliveryWindow?.start ?? null))}
          · DISPATCHED ${esc(fmtInstant(load.timing.dispatchedAt))} · LAST TRACKING ${esc(fmtInstant(load.timing.lastTrackingOccurredAt))}
        </div>
        ${load.issues.map(issueBlock).join('')}
        <div class="ops-comms"><div class="ops-comms-absent">READING COMMS JOURNAL…</div></div>
        <div class="ops-lane-note">${resolveOpsPlace(load.route.origin) && resolveOpsPlace(load.route.destination) ? `LANE DRAWN ON GLOBE — ${tracked ? 'solid: tracking evidence exists' : 'DASHED: lane declared, movement unobserved'}. No vehicle marker: the tower serves no position.` : 'LANE NOT DRAWN — endpoints not in the curated place table (never guessed).'}</div>`;
      // the comms journal loads lazily per expansion, cached per refresh
      const commsHost = detail.querySelector('.ops-comms') as HTMLElement;
      const cached = commsCache.get(load.operationId);
      if (cached) {
        renderComms(commsHost, cached);
      } else {
        void fetchOpsCommunication(resolveApiBase(), load.operationId).then((r) => {
          commsCache.set(load.operationId, r);
          if (commsHost.isConnected) renderComms(commsHost, r);
        });
      }
      if (resolveOpsPlace(load.route.origin) && resolveOpsPlace(load.route.destination)) {
        const peek = document.createElement('button');
        peek.type = 'button';
        peek.className = 'ops-peek-btn';
        peek.textContent = 'HOLD TO VIEW LANE';
        const release = (): void => el.classList.remove('ops-peek');
        peek.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          el.classList.add('ops-peek');
          window.addEventListener('pointerup', release, { once: true });
        });
        peek.addEventListener('click', (e) => e.stopPropagation());
        detail.appendChild(peek);
      }
      row.appendChild(detail);
    }

    row.addEventListener('click', () => {
      expanded = expanded === load.operationId ? null : load.operationId;
      if (expanded) focusLane(load);
      else {
        api.clearOperationsLane();
        selectedLane = null;
      }
      renderBody();
    });
    return row;
  };

  /**
   * Schedule strip — the dispatcher's Gantt over the tower's own
   * instants. DECLARED windows (pickup, delivery — promises) draw
   * HOLLOW; OBSERVED events (dispatch, last tracking) draw SOLID; the
   * tower's asOf is the NOW line. A load with no tracking says so on
   * the row — an empty stretch of track is stated, never smoothed.
   */
  const buildGantt = (snap: OpsSnapshot): HTMLElement | null => {
    const loads = sortOpsLoads(snap.loads);
    const ts: number[] = [];
    for (const l of loads) {
      for (const w of [l.timing.pickupWindow, l.timing.deliveryWindow]) {
        if (w) ts.push(Date.parse(w.start), Date.parse(w.end));
      }
      if (l.timing.dispatchedAt) ts.push(Date.parse(l.timing.dispatchedAt));
      if (l.timing.lastTrackingOccurredAt) ts.push(Date.parse(l.timing.lastTrackingOccurredAt));
    }
    if (!ts.length) return null; // no declared or observed instants — no strip to draw
    const asOf = Date.parse(snap.asOf);
    ts.push(asOf);
    let t0 = Math.min(...ts);
    let t1 = Math.max(...ts);
    const span = Math.max(t1 - t0, 3600_000);
    t0 -= span * 0.04;
    t1 += span * 0.04;
    const X = (t: number): number => ((t - t0) / (t1 - t0)) * 100;

    const wrap = document.createElement('div');
    wrap.className = 'ops-gantt';
    wrap.innerHTML = `
      <div class="os-card-title">SCHEDULE — DECLARED WINDOWS (HOLLOW) VS OBSERVED EVENTS (SOLID) · DASH = TOWER AS OF</div>
      <div class="ops-g-axis"><span></span><span class="ops-g-axis-track"><span>${esc(fmtInstant(new Date(t0).toISOString()))}</span><span>${esc(fmtInstant(new Date(t1).toISOString()))}</span></span></div>`;

    const rows = document.createElement('div');
    rows.className = 'ops-g-rows';

    for (const l of loads) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'ops-g-row';
      const label = document.createElement('span');
      label.className = 'ops-g-label';
      label.innerHTML = `<i class="ops-g-sev ops-sev-${sev(l.attentionLevel)}"></i>${esc(l.loadId ?? l.operationId)}`;
      const track = document.createElement('span');
      track.className = 'ops-g-track';

      const win = (w: { start: string; end: string } | null, cls: string, name: string): void => {
        if (!w) return;
        const a = Date.parse(w.start);
        const b = Date.parse(w.end);
        const bar = document.createElement('i');
        bar.className = `ops-g-win ${cls}`;
        bar.style.left = `${X(a).toFixed(2)}%`;
        bar.style.width = `${Math.max(0.6, X(b) - X(a)).toFixed(2)}%`;
        bar.title = `${name} WINDOW (DECLARED) ${fmtInstant(w.start)} → ${fmtInstant(w.end)}`;
        track.appendChild(bar);
      };
      win(l.timing.pickupWindow, 'pickup', 'PICKUP');
      win(l.timing.deliveryWindow, 'delivery', 'DELIVERY');

      const evt = (t: string | null, cls: string, name: string): void => {
        if (!t) return;
        const dot = document.createElement('i');
        dot.className = `ops-g-evt ${cls}`;
        dot.style.left = `${X(Date.parse(t)).toFixed(2)}%`;
        dot.title = `${name} (OBSERVED) ${fmtInstant(t)}`;
        track.appendChild(dot);
      };
      evt(l.timing.dispatchedAt, 'dispatch', 'DISPATCHED');
      evt(l.timing.lastTrackingOccurredAt, 'tracking', 'LAST TRACKING');
      // the tower's asOf, tick on every track (column-aligned NOW line)
      const tick = document.createElement('i');
      tick.className = 'ops-g-tick';
      tick.style.left = `${X(asOf).toFixed(2)}%`;
      tick.title = `TOWER AS OF ${fmtInstant(snap.asOf)}`;
      track.appendChild(tick);
      if (!opsTrackingObserved(l)) {
        const note = document.createElement('i');
        note.className = 'ops-g-none';
        note.textContent = 'TRACKING UNOBSERVED';
        track.appendChild(note);
      }

      row.append(label, track);
      row.addEventListener('click', () => {
        expanded = expanded === l.operationId ? null : l.operationId;
        if (expanded) focusLane(l);
        else {
          api.clearOperationsLane();
          selectedLane = null;
        }
        renderBody();
      });
      rows.appendChild(row);
    }
    wrap.appendChild(rows);
    return wrap;
  };

  const renderBody = (): void => {
    body.innerHTML = '';
    renderStatus();
    if (!last) return;

    if (last.kind === 'unreachable') {
      body.appendChild(
        refusalBox(
          'SPATIAL_API_UNREACHABLE',
          last.note,
          'run `npm run server` with TERMINAL_URL and PAYLOAD_OPERATIONS_TOKEN set, and open the twin with ?api'
        )
      );
      return;
    }
    if (last.kind === 'refused') {
      body.appendChild(refusalBox(last.refusal.kind, last.refusal.message, last.refusal.remedy));
      return;
    }

    const snap = last.snapshot;
    const p = snap.portfolio;

    const kpis = document.createElement('div');
    kpis.className = 'ops-kpis';
    kpis.innerHTML =
      kpi('ACTIVE', p.activeLoads) +
      kpi('IN MOTION', p.inMotion) +
      kpi('ATTENTION', p.needingAttention, p.needingAttention ? 'warn' : '') +
      kpi('CRITICAL', p.critical, p.critical ? 'alert' : '') +
      kpi('HIGH', p.high, p.high ? 'warn' : '') +
      kpi('SETTLEMENT', p.awaitingSettlement) +
      kpi('COMPLETED', p.completedLoads);
    body.appendChild(kpis);

    const policy = document.createElement('div');
    policy.className = 'ops-policy';
    policy.innerHTML = `OPERATIONAL POLICY (STATED, NOT IMPLIED) — ACK GRACE ${snap.policy.acknowledgementGraceMinutes}M · TRACKING STALE AFTER ${snap.policy.trackingStaleMinutes}M · SETTLEMENT DUE ${Math.round(snap.policy.settlementGraceMinutes / 60)}H AFTER DELIVERY`;
    body.appendChild(policy);

    // authoritative desk reference — attributed benchmark, or its
    // absence WITH the upstream's stated reason (never a stale number)
    const ref = document.createElement('div');
    ref.className = 'ops-policy ops-fuel';
    if (fuel?.kind === 'ok') {
      const f = fuel.benchmark.fuel;
      ref.innerHTML =
        `DESK REFERENCE — DIESEL ${esc(f.currency)} ${f.price.value.toFixed(3)}/${esc(f.unit.replace(/^\$ per /i, ''))}` +
        ` · PERIOD ${esc(f.period)} · ${esc(f.geography)} · SOURCE ${esc(f.sourceId)} (${esc(f.seriesId)})` +
        ` · retrieved ${esc(fmtInstant(fuel.benchmark.retrievedAt))}`;
    } else if (fuel?.kind === 'refused') {
      ref.innerHTML = `DESK REFERENCE — DIESEL BENCHMARK ABSENT: ${esc(humanizeOpsCode(fuel.refusal.kind))} — ${esc(fuel.refusal.message)}`;
    } else {
      ref.textContent = 'DESK REFERENCE — DIESEL BENCHMARK: reading…';
    }
    body.appendChild(ref);

    const gantt = buildGantt(snap);
    if (gantt) body.appendChild(gantt);

    const queueTitle = document.createElement('div');
    queueTitle.className = 'os-card-title ops-queue-title';
    queueTitle.textContent = 'EXCEPTION-FIRST QUEUE — NAMED ISSUES, NEVER A COMPOSITE SCORE';
    body.appendChild(queueTitle);

    if (!snap.loads.length) {
      const zero = document.createElement('div');
      zero.className = 'ops-empty';
      zero.textContent =
        'THE DESK IS EMPTY — zero operations in the journal. An observed zero, not missing data: the journals answered.';
      body.appendChild(zero);
      return;
    }
    for (const load of sortOpsLoads(snap.loads)) body.appendChild(loadRow(load));
  };

  // ----------------------------------------------------------------- poll

  const refresh = async (): Promise<void> => {
    last = await fetchOperations(resolveApiBase());
    recordFeed('operations', last.kind === 'ok' ? 'ok' : last.kind);
    lastFetchedAt = Date.now();
    commsCache.clear(); // journals may have advanced with the tower
    renderBody();
    // the weekly benchmark: one read per panel session is honest
    if (!fuel) {
      fuel = await fetchOpsFuel(resolveApiBase());
      renderBody();
    }
  };

  const setPolling = (on: boolean): void => {
    if (on && timer === undefined) {
      void refresh();
      timer = window.setInterval(() => void refresh(), POLL_MS);
    } else if (!on && timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };

  api.events.on('preset', ({ preset }) => {
    const open = preset === 'operations';
    el.hidden = !open;
    setPolling(open);
    if (!open) {
      api.clearOperationsLane();
      selectedLane = null;
      expanded = null;
    }
  });

  return { el };
}
