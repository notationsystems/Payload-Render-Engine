/**
 * What-if injection — the twin-side vocabulary of the Terminal's
 * counterfactual scenario engine (POST /api/economy/scenario, mirrored
 * at GET /api/scenarios/inject).
 *
 * Honesty contract: the answer is COMPUTED UPSTREAM over upstream
 * state, framed kind 'counterfactual'. It carries structural
 * propagation (affected entities with hop depth, disrupted volume,
 * spare-capacity alternatives, a reasoning trace) — NOT state deltas:
 * this corpus's states are unobserved, and no baseline utilization is
 * ever fabricated to dress the result up as one. Rendered in the
 * hypothetical violet, never as state.
 */

import type { Timestamp } from './contracts';

export interface InjectionAffected {
  entityId: string;
  name: string;
  kind: string;
  depth: number;
}

export interface InjectionImpact {
  eventId: string;
  eventTitle: string;
  eventType: string;
  severity: string;
  active: boolean;
  entityId: string;
  entityName: string;
  disruptedKtPerYear: number | null;
  affected: InjectionAffected[];
  alternatives: { entityId: string; name: string; spareKtPerYear: number | null }[];
  /** the engine's own reasoning trace, line by line */
  explanation: string[];
}

export interface InjectionResult {
  commodity: string;
  baselineFrame: { kind: string; knowledge: string };
  counterfactualFrame: {
    kind: 'counterfactual';
    knowledge: string;
    scenarioId: string;
    scenarioLabel: string;
    injectedEventIds: string[];
  };
  scenarioImpacts: InjectionImpact[];
  delta: {
    newlyDisrupted: { id: string; name: string }[];
    newlyAffectedDownstream: { id: string; name: string }[];
  };
}

export interface InjectionParams {
  entityId: string;
  type: string;
  severity: string;
  commodity: string;
}

export type InjectionOutcome =
  | { kind: 'ok'; result: InjectionResult; disclaimer: string }
  | { kind: 'refused'; refusal: { kind: string; message: string; remedy: string } }
  | { kind: 'unreachable'; note: string };

export const INJECTION_TYPES = ['strike', 'closure', 'outage', 'disruption', 'sanction', 'weather'] as const;
export const INJECTION_SEVERITIES = ['low', 'medium', 'high'] as const;

export async function fetchInjection(
  apiBase: string,
  p: InjectionParams
): Promise<InjectionOutcome> {
  let body: {
    status?: string;
    data?: InjectionResult;
    refusal?: { kind: string; message: string; remedy: string };
    meta?: { disclaimer?: string };
  };
  try {
    const q = new URLSearchParams({
      entityId: p.entityId,
      type: p.type,
      severity: p.severity,
      commodity: p.commodity,
    });
    const res = await fetch(`${apiBase}/api/scenarios/inject?${q}`, {
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
  if (body.status === 'ok' && body.data?.counterfactualFrame?.kind === 'counterfactual') {
    return {
      kind: 'ok',
      result: body.data,
      disclaimer: body.meta?.disclaimer ?? 'HYPOTHETICAL — a simulated outcome is not an outcome.',
    };
  }
  return { kind: 'unreachable', note: 'spatial API answered with an unrecognized shape' };
}

/** Sim-time stamp helper for the card. */
export const injectionStamp = (t: Timestamp): string => `${t.slice(0, 10)} ${t.slice(11, 16)}Z`;
