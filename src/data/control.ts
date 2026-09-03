/**
 * Control-plane vocabulary — the EcosystemModel this OS reads from
 * GET /api/system/topology, and the live probe that turns each
 * declared capability into a measured health + latency.
 *
 * Health classes come from TYPED answers, never inference:
 *   healthy            — an ok envelope
 *   awaiting-authority — a fail-closed refusal naming a credential
 *   blocked            — an upstream unreachable / unreadable refusal
 *   unsupported        — honest n/a for the loaded corpus
 *   refused            — any other typed refusal (stated)
 *   unreachable        — the spatial API itself did not answer
 * Staleness is the client's own ledger age, stated in seconds.
 */

import type { Timestamp } from './contracts';

export interface EcosystemNode {
  id: string;
  kind: 'renderer' | 'service' | 'store' | 'upstream' | 'source' | 'tool';
  label: string;
  role: string;
  url: string | null;
}

export interface EcosystemEdge {
  from: string;
  to: string;
  relation: string;
  when?: string;
}

export type LadderCell = boolean | 'from journal';

export interface Capability {
  id: string;
  family: string;
  label: string;
  node: string;
  routes: string[];
  probe: string;
  provenance: string;
  authority?: { required: string; present: boolean };
  ladder: { observed: LadderCell; proposed: LadderCell; approved: LadderCell; dispatched: LadderCell; note: string };
  dataDomains: string[];
  instrument: string;
}

export interface EcosystemModel {
  ecosystem: { id: string; label: string; firstNode: string };
  ladderRule: string;
  nodes: EcosystemNode[];
  edges: EcosystemEdge[];
  capabilities: Capability[];
  cost: { status: string; reason: string };
}

export type HealthClass =
  | 'healthy'
  | 'awaiting-authority'
  | 'blocked'
  | 'unsupported'
  | 'refused'
  | 'unreachable';

export interface Probe {
  capabilityId: string;
  health: HealthClass;
  latencyMs: number | null;
  detail: string;
  at: Timestamp;
}

export async function fetchTopology(apiBase: string): Promise<EcosystemModel | null> {
  try {
    const res = await fetch(`${apiBase}/api/system/topology`);
    const body = (await res.json()) as { status?: string; data?: EcosystemModel };
    return body.status === 'ok' && body.data ? body.data : null;
  } catch {
    return null;
  }
}

const AUTHORITY_KINDS = /NOT_CONFIGURED$/;
const BLOCKED_KINDS = /UPSTREAM_(UNREACHABLE|UNREADABLE)$/;
const UNSUPPORTED_KINDS = /UNSUPPORTED_FOR_CORPUS$/;

/** One live probe: a cheap GET, timed, classified by its typed answer. */
export async function probeCapability(apiBase: string, cap: Capability): Promise<Probe> {
  const t0 = performance.now();
  const at = new Date().toISOString();
  try {
    const res = await fetch(`${apiBase}${cap.probe}`, { headers: { Accept: 'application/json' } });
    const body = (await res.json()) as { status?: string; refusal?: { kind: string; message: string } };
    const latencyMs = Math.round(performance.now() - t0);
    if (body.status === 'ok') return { capabilityId: cap.id, health: 'healthy', latencyMs, detail: 'ok envelope', at };
    const kind = body.refusal?.kind ?? 'UNKNOWN';
    // a validation refusal proves the surface is up — the probe asked
    // for nothing on purpose (injection) so no upstream call is spent
    if (/REQUEST_INVALID$/.test(kind)) return { capabilityId: cap.id, health: 'healthy', latencyMs, detail: `surface answers (${kind} on an empty probe — by design)`, at };
    if (AUTHORITY_KINDS.test(kind)) return { capabilityId: cap.id, health: 'awaiting-authority', latencyMs, detail: body.refusal?.message ?? kind, at };
    if (BLOCKED_KINDS.test(kind)) return { capabilityId: cap.id, health: 'blocked', latencyMs, detail: body.refusal?.message ?? kind, at };
    if (UNSUPPORTED_KINDS.test(kind)) return { capabilityId: cap.id, health: 'unsupported', latencyMs, detail: body.refusal?.message ?? kind, at };
    return { capabilityId: cap.id, health: 'refused', latencyMs, detail: `${kind}: ${body.refusal?.message ?? ''}`, at };
  } catch (err) {
    return {
      capabilityId: cap.id,
      health: 'unreachable',
      latencyMs: null,
      detail: `spatial API did not answer — ${err instanceof Error ? err.message : String(err)}`,
      at,
    };
  }
}

/** The operations ladder from REAL journal facts (the tower snapshot). */
export interface OpsLadderCounts {
  observed: number;
  proposed: number;
  approved: number;
  dispatched: number;
  basis: string;
}

export function opsLadderFromTower(
  loads: { state: { authorization: string; tenderDelivery: string }; timing: { dispatchedAt: string | null } }[]
): OpsLadderCounts {
  return {
    observed: loads.length,
    proposed: loads.filter((l) => l.state.authorization === 'pending' || l.state.authorization === 'undetermined').length,
    approved: loads.filter((l) => l.state.authorization === 'authorized').length,
    // dispatched lights ONLY when the journal records the tender as
    // delivered to the carrier — an authorization, or even a dispatch
    // request without delivery, must never read as an action taken
    dispatched: loads.filter((l) => l.state.tenderDelivery === 'delivered').length,
    basis: 'counts from the control-tower journal projection: proposed = authorization pending/undetermined · approved = authorized · dispatched = tender DELIVERED to the carrier (recorded), never merely requested',
  };
}
