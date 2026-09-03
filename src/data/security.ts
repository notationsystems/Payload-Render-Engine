/**
 * The security model as data the OS can render.
 *
 * Two halves, deliberately separate, because they are observed from
 * different places and an operator must never confuse them:
 *
 *   SERVICE half — GET /api/security/posture. The policy actually in
 *   force at the gate, authority PRESENT/ABSENT, the invariant ledger,
 *   and the bounded refusal journal. If the API is unreachable this is
 *   ABSENT with a remedy; it is never inferred.
 *
 *   CLIENT half — observed in THIS browser, right now. The CSP that
 *   actually arrived, the API base in force and whether one was
 *   refused, and every key currently in localStorage checked against
 *   the SEC-005 allowlist. The static check proves the code writes
 *   nothing else; this proves nothing else is *there*, which is the
 *   claim an operator actually cares about.
 *
 * Neither half is allowed to speak for the other. A green client half
 * says nothing about the service, and vice versa.
 */

import { apiBaseRefusal, fetchBounded, resolveApiBase } from './sources';

export type InvariantState = 'ENFORCED' | 'DEPLOYMENT' | 'ABSENT';

export interface SecurityInvariant {
  id: string;
  domain: string;
  state: InvariantState;
  check: string | null;
  statement: string;
  reason?: string;
  unblockedBy?: string;
}

export interface SecurityEvent {
  seq: number;
  at: string;
  kind: string;
  path: string | null;
  client: string | null;
  detail: string | null;
}

export interface SecurityJournalWindow {
  since: string;
  recorded: number;
  retained: number;
  dropped: number;
  capacity: number;
  byKind: Record<string, number>;
  entries: SecurityEvent[];
}

export interface SecurityPosture {
  model: string;
  threatModel: string;
  policy: {
    methodsServed: string[];
    originPolicy: string;
    allowedOrigins: string[];
    hostPolicy: string;
    allowedHosts: string[];
    wildcardCors: boolean;
    tlsVerification: string;
    privilegedPrefixes: string[];
    proxiedPrefixes: string[];
  };
  authority: { id: string; variable: string; purpose: string; state: 'PRESENT' | 'ABSENT'; scope: string }[];
  limits: Record<string, { capacity: number; refillPerSec: number }> | null;
  upstreamCaps: Record<string, number>;
  invariants: SecurityInvariant[];
  counts: { enforced: number; deployment: number; absent: number };
  events: SecurityJournalWindow | { status: 'ABSENT'; reason: string };
}

export type PostureResult =
  | { ok: true; posture: SecurityPosture }
  | { ok: false; kind: string; message: string; remedy: string };

export async function fetchPosture(events = 40): Promise<PostureResult> {
  try {
    const res = await fetchBounded(`${resolveApiBase()}/api/security/posture?events=${events}`, {
      headers: { Accept: 'application/json' },
    });
    const body = (await res.json()) as {
      status?: string;
      data?: SecurityPosture;
      refusal?: { kind: string; message: string; remedy: string };
    };
    if (body.status === 'ok' && body.data) return { ok: true, posture: body.data };
    return {
      ok: false,
      kind: body.refusal?.kind ?? 'UNEXPECTED_ANSWER',
      message: body.refusal?.message ?? 'the spatial API answered, but not with a posture',
      remedy: body.refusal?.remedy ?? 'check that this build of the service serves GET /api/security/posture',
    };
  } catch (err) {
    return {
      ok: false,
      kind: 'SERVICE_UNREACHABLE',
      message: `the spatial API did not answer /api/security/posture — ${err instanceof Error ? err.message : String(err)}`,
      remedy: 'start the service (CORPUS=terminal PORT=8788 node server/index.mjs) and load the OS with ?api=http://127.0.0.1:8788',
    };
  }
}

// --------------------------------------------------------------------
// The client half — observed here, in this browser

/** SEC-005: the only keys this OS is permitted to persist. */
export const STORAGE_ALLOWLIST = Object.freeze(['pe.alertCue', 'pe.workspace/v1', 'pe.watches/v1']);

export interface ClientObservation {
  csp: { present: boolean; directives: { name: string; value: string }[]; scriptSrc: string | null };
  apiBase: { inForce: string; refusal: string | null };
  storage: { key: string; allowed: boolean; bytes: number }[];
  storageReadable: boolean;
}

/** What the browser can prove about its own half, without asking anyone. */
export function observeClient(): ClientObservation {
  const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  const raw = meta?.getAttribute('content') ?? '';
  const directives = raw
    .split(';')
    .map((d) => d.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .map((d) => {
      const sp = d.indexOf(' ');
      return sp === -1 ? { name: d, value: '' } : { name: d.slice(0, sp), value: d.slice(sp + 1) };
    });

  const storage: ClientObservation['storage'] = [];
  let storageReadable = true;
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key === null) continue;
      storage.push({
        key,
        allowed: STORAGE_ALLOWLIST.includes(key),
        bytes: (localStorage.getItem(key) ?? '').length,
      });
    }
  } catch {
    // a private window or a browser set to block site data — an honest
    // "cannot see" is a different answer from "nothing is there"
    storageReadable = false;
  }

  return {
    csp: {
      present: Boolean(meta),
      directives,
      scriptSrc: directives.find((d) => d.name === 'script-src')?.value ?? null,
    },
    apiBase: { inForce: resolveApiBase(), refusal: apiBaseRefusal },
    storage: storage.sort((a, b) => Number(a.allowed) - Number(b.allowed) || a.key.localeCompare(b.key)),
    storageReadable,
  };
}
