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

  constructor(private baseUrl: string) {}

  private async getJson<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
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
    this.resolver = createStateResolver(snap);
    return snap;
  }

  stateAt(entityId: EntityId, t: Timestamp): EntityState {
    if (!this.resolver) {
      // load() has not resolved yet — neutral state, never a fabricated one
      return {
        entityId,
        t,
        utilization: 0,
        congestion: 0,
        status: 'unknown',
        activeEventIds: [],
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
