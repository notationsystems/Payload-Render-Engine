/**
 * RemoteSpatialProvider — the twin backed by the Payload Earth Spatial
 * API (server/) instead of an in-browser corpus.
 *
 * The snapshot is fetched over HTTP with its full envelope (source
 * class, knownAt, admissibility, disclaimer — provenance travels the
 * wire, it is not re-stamped client-side). Dynamic state resolves
 * through the SAME pure resolver the server uses, over the fetched
 * snapshot — one function on both sides, no projection drift. When
 * real telemetry replaces deterministic dynamics, stateAt moves behind
 * /api/state and this class grows an async refresh path; the seam
 * (query/subscribe) already reserves the room.
 *
 * A refusal from the server is surfaced as a thrown error carrying the
 * refusal's kind, message and remedy — never swallowed into a zero.
 */

import type { EntityId, EntityState, Timestamp, WorldSnapshot } from '../contracts';
import { fetchBounded } from '../sources';
import type { SpatialDataProvider, ViewportQuery } from '../provider';
import { createStateResolver } from '../synthetic/provider.ts';

interface ApiRefusal {
  kind: string;
  message: string;
  remedy: string;
}

interface ApiEnvelope<T> {
  status: 'ok' | 'refused' | 'error';
  data?: T;
  meta?: Record<string, unknown>;
  refusal?: ApiRefusal;
  error?: { message: string };
}

export class RemoteSpatialProvider implements SpatialDataProvider {
  readonly id = 'payload:spatial-api';
  readonly label = 'Payload Spatial API';

  /** The envelope meta from the last successful load — admissibility et al. */
  lastMeta: Record<string, unknown> | null = null;

  private snap: WorldSnapshot | null = null;
  private resolver: ((entityId: EntityId, t: Timestamp) => EntityState) | null = null;
  /** Declared lifecycle per entity — surfaced even when nothing resolves dynamics. */
  private declaredStatus = new Map<EntityId, EntityState['status']>();

  constructor(private baseUrl: string) {}

  private async getJson<T>(path: string): Promise<T> {
    const res = await fetchBounded(`${this.baseUrl}${path}`, {
      headers: { Accept: 'application/json' },
    });
    const env = (await res.json()) as ApiEnvelope<T>;
    if (env.status === 'refused' && env.refusal) {
      throw new Error(
        `spatial api refused (${env.refusal.kind}): ${env.refusal.message} — remedy: ${env.refusal.remedy}`
      );
    }
    if (env.status !== 'ok' || env.data === undefined) {
      throw new Error(`spatial api ${path} failed: ${env.error?.message ?? res.status}`);
    }
    if (env.meta) this.lastMeta = env.meta;
    return env.data;
  }

  async load(): Promise<WorldSnapshot> {
    const snap = await this.getJson<WorldSnapshot>('/api/snapshot');
    this.snap = snap;
    // The deterministic resolver is the SYNTHETIC corpus's dynamics.
    // Running it over records from any other corpus would fabricate
    // motion onto real entities — so it is gated on the corpus kind the
    // envelope declares, FAIL CLOSED: only an explicit 'synthetic'
    // declaration builds it. An undeclared corpus gets honest
    // observed:false unknown states, never synthesized ones.
    const kind = this.lastMeta?.corpusKind;
    this.resolver = kind === 'synthetic' ? createStateResolver(snap) : null;
    this.declaredStatus.clear();
    for (const n of snap.nodes) this.declaredStatus.set(n.id, n.status);
    for (const r of snap.routes) this.declaredStatus.set(r.id, r.status);
    return snap;
  }

  stateAt(entityId: EntityId, t: Timestamp): EntityState {
    if (!this.resolver) {
      // load() has not resolved yet, or the corpus has no deterministic
      // dynamics. The numeric channels are UNOBSERVED (observed: false —
      // surfaces render them as unknown, never 0%); the DECLARED
      // lifecycle still carries, because "this facility is disrupted"
      // is a different fact from "its utilization was measured".
      return {
        entityId,
        t,
        utilization: 0,
        congestion: 0,
        status: this.declaredStatus.get(entityId) ?? 'unknown',
        activeEventIds: [],
        observed: false,
      };
    }
    return this.resolver(entityId, t);
  }

  async query(viewport: ViewportQuery): Promise<Partial<WorldSnapshot>> {
    const params = new URLSearchParams();
    if (viewport.bbox) params.set('bbox', viewport.bbox.join(','));
    if (viewport.minImportance) params.set('minImportance', String(viewport.minImportance));
    const data = await this.getJson<{ nodes: WorldSnapshot['nodes'] }>(
      `/api/entities?${params.toString()}`
    );
    return { nodes: data.nodes };
  }
}
