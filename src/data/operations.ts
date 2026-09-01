/**
 * Operations control-tower vocabulary — the twin-side mirror of the
 * Terminal's brokerage desk wire shapes (payload-terminal-v0
 * src/lib/economy/controlTower.ts). The twin RENDERS this projection;
 * it never issues an operations command — propose → authorize → execute
 * lives in the Terminal's own desk, behind its own authority.
 *
 * The projection is a join over append-only, hash-chained journals.
 * Exception-first: every queue item carries a NAMED issue with a
 * severity, an observed detail, an operator remedy, a deadline, and its
 * evidence references — never an opaque composite score.
 */

import type { LonLat, Timestamp } from './contracts';

export type OpsSeverity = 'critical' | 'high' | 'medium' | 'low' | 'none';

export interface OpsIssue {
  code: string;
  severity: Exclude<OpsSeverity, 'none'>;
  detail: string;
  remedy: string;
  deadlineAt: Timestamp | null;
  evidenceIds: string[];
}

export interface OpsAttestation {
  evidenceClass: 'reported' | 'estimated' | 'representative' | 'derived';
  confidence: 'high' | 'medium' | 'low';
  restsOnRepresentative: boolean;
  interest: 'disinterested' | 'self_reported' | 'negotiating_position' | 'unknown';
  restsOnInterested: boolean;
}

/** A money figure that cannot travel without its attestation. */
export interface OpsMetric {
  name: string;
  value: number;
  unit: string; // 'money_minor'
  currency: string;
  attestation: OpsAttestation;
  evidenceIds: string[];
}

export interface OpsLoad {
  operationId: string;
  loadId: string | null;
  episodeId: string | null;
  carrierId: string | null;
  laneId: string | null;
  route: { origin: string | null; destination: string | null; equipment: string | null };
  timing: {
    pickupWindow: { start: Timestamp; end: Timestamp } | null;
    deliveryWindow: { start: Timestamp; end: Timestamp } | null;
    dispatchedAt: Timestamp | null;
    lastTrackingOccurredAt: Timestamp | null;
    lastTrackingKnownAt: Timestamp | null;
  };
  state: {
    operationPhase: string;
    authorization: string;
    tenderDelivery: string;
    acknowledgement: string;
    tracking: string | null;
    outcomeCaptured: boolean;
  };
  economics: {
    quotedCost: OpsMetric | null;
    carrierInvoice: OpsMetric | null;
    grossMargin: OpsMetric | null;
  };
  attentionLevel: OpsSeverity;
  nextAction: OpsIssue | null;
  issues: OpsIssue[];
}

export interface OpsPortfolio {
  totalLoads: number;
  activeLoads: number;
  completedLoads: number;
  needingAttention: number;
  critical: number;
  high: number;
  inMotion: number;
  awaitingSettlement: number;
}

export interface OpsPolicy {
  acknowledgementGraceMinutes: number;
  trackingStaleMinutes: number;
  settlementGraceMinutes: number;
}

export interface OpsSnapshot {
  kind: 'control_tower_snapshot';
  asOf: Timestamp;
  policy: OpsPolicy;
  portfolio: OpsPortfolio;
  loads: OpsLoad[];
}

export interface OpsRefusal {
  kind: string;
  message: string;
  remedy: string;
}

export type OpsReadResult =
  | { kind: 'ok'; snapshot: OpsSnapshot; fetchedAt: Timestamp }
  | { kind: 'refused'; refusal: OpsRefusal }
  | { kind: 'unreachable'; note: string };

/**
 * Declared place names → coordinates for the operational corridor.
 * An EXPLICIT curated table over the freight world's own city list
 * (payload-terminal-v0 src/lib/economy/freightWorld.ts CITIES — real
 * coordinates, committed upstream). Keyed on the DECLARED origin /
 * destination strings the tower serves — never parsed out of an id.
 * An unlisted place resolves to null: an unmappable lane draws
 * nothing, it does not guess.
 */
export const OPS_PLACES: Record<string, LonLat> = {
  'Toronto, ON': [-79.383, 43.653],
  'Mississauga, ON': [-79.658, 43.589],
  'Hamilton, ON': [-79.866, 43.256],
  'Windsor, ON': [-83.017, 42.317],
  'Montreal, QC': [-73.568, 45.502],
  'Detroit, MI': [-83.046, 42.331],
  'Chicago, IL': [-87.63, 41.878],
  'Cleveland, OH': [-81.694, 41.499],
  'Buffalo, NY': [-78.878, 42.886],
};

export function resolveOpsPlace(name: string | null): LonLat | null {
  if (!name) return null;
  return OPS_PLACES[name] ?? null;
}

/**
 * Is the load's position channel observed? The tower serves tracking
 * TIMESTAMPS, never coordinates — so the twin NEVER draws a vehicle
 * marker for these loads. The lane arc alone renders, and its styling
 * states whether tracking evidence exists at all.
 */
export function opsTrackingObserved(load: OpsLoad): boolean {
  return load.timing.lastTrackingOccurredAt !== null;
}

const SEVERITY_RANK: Record<OpsSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};

/** Exception-first ordering: attention level, then nearest deadline. */
export function sortOpsLoads(loads: OpsLoad[]): OpsLoad[] {
  return [...loads].sort((a, b) => {
    const sev = SEVERITY_RANK[b.attentionLevel] - SEVERITY_RANK[a.attentionLevel];
    if (sev !== 0) return sev;
    const da = a.nextAction?.deadlineAt ? Date.parse(a.nextAction.deadlineAt) : Infinity;
    const db = b.nextAction?.deadlineAt ? Date.parse(b.nextAction.deadlineAt) : Infinity;
    return da - db;
  });
}

export function humanizeOpsCode(code: string): string {
  return code.replace(/_/g, ' ').toUpperCase();
}

/** money_minor → display. Any other unit renders with its unit stated. */
export function fmtOpsMetric(m: OpsMetric | null): string {
  if (!m) return '—';
  if (m.unit === 'money_minor') return `${m.currency} ${(m.value / 100).toFixed(2)}`;
  return `${m.value} ${m.unit}`;
}

/** Fetch the operations projection through the twin's spatial API. */
export async function fetchOperations(apiBase: string): Promise<OpsReadResult> {
  let body: {
    status?: string;
    data?: OpsSnapshot;
    refusal?: OpsRefusal;
    meta?: { knownAt?: string };
  };
  try {
    const res = await fetch(`${apiBase}/api/operations`, {
      headers: { Accept: 'application/json' },
    });
    body = await res.json();
  } catch (err) {
    return {
      kind: 'unreachable',
      note: `spatial API unreachable at ${apiBase} — ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (body.status === 'refused' && body.refusal) return { kind: 'refused', refusal: body.refusal };
  if (body.status === 'ok' && body.data) {
    return { kind: 'ok', snapshot: body.data, fetchedAt: new Date().toISOString() };
  }
  return { kind: 'unreachable', note: 'spatial API answered with an unrecognized shape' };
}
