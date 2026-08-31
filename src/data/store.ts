/**
 * WorldStore — read-only projection of provider state for the twin.
 *
 * The store never mutates canonical data; it indexes a WorldSnapshot
 * for query and resolves temporal state through the provider. It is
 * deliberately renderer-blind (enforced by scripts/check-seam.mjs).
 */

import type {
  Assertion,
  Commodity,
  Deviation,
  EntityId,
  EntityState,
  Facility,
  Flow,
  Observation,
  Route,
  Timestamp,
  TransportMode,
  WorldEvent,
  WorldSnapshot,
} from './contracts';
import type { SpatialDataProvider } from './provider';

export interface SearchResult {
  id: EntityId;
  name: string;
  kind: string;
  score: number;
  detail?: string;
}

export interface DeviationView {
  assertion: Assertion;
  observations: Observation[];
  meanObserved: number;
  deviation: Deviation;
}

export class WorldStore {
  private provider!: SpatialDataProvider;
  private snap!: WorldSnapshot;

  private nodeIx = new Map<EntityId, Facility>();
  private routeIx = new Map<EntityId, Route>();
  private flowIx = new Map<EntityId, Flow>();
  private commodityIx = new Map<EntityId, Commodity>();
  private routesByNode = new Map<EntityId, Route[]>();
  private flowsByRoute = new Map<EntityId, Flow[]>();
  private assertionsByEntity = new Map<EntityId, Assertion[]>();
  private observationsByEntity = new Map<EntityId, Observation[]>();

  async init(provider: SpatialDataProvider): Promise<WorldSnapshot> {
    this.provider = provider;
    this.snap = await provider.load();
    this.buildIndexes();
    return this.snap;
  }

  get snapshot(): WorldSnapshot {
    return this.snap;
  }

  private buildIndexes(): void {
    const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
      const arr = m.get(k);
      if (arr) arr.push(v);
      else m.set(k, [v]);
    };
    for (const n of this.snap.nodes) this.nodeIx.set(n.id, n);
    for (const r of this.snap.routes) {
      this.routeIx.set(r.id, r);
      push(this.routesByNode, r.originId, r);
      push(this.routesByNode, r.destinationId, r);
    }
    for (const f of this.snap.flows) {
      this.flowIx.set(f.id, f);
      for (const seg of f.segments) push(this.flowsByRoute, seg.routeId, f);
    }
    for (const c of this.snap.commodities) this.commodityIx.set(c.id, c);
    for (const a of this.snap.assertions ?? [])
      push(this.assertionsByEntity, a.entityId, a);
    for (const o of this.snap.observations ?? [])
      push(this.observationsByEntity, o.entityId, o);
  }

  // ---------------------------------------------------------------- lookups

  node(id: EntityId): Facility | undefined {
    return this.nodeIx.get(id);
  }
  route(id: EntityId): Route | undefined {
    return this.routeIx.get(id);
  }
  flow(id: EntityId): Flow | undefined {
    return this.flowIx.get(id);
  }
  commodity(id: EntityId): Commodity | undefined {
    return this.commodityIx.get(id);
  }
  entity(id: EntityId): Facility | Route | Flow | undefined {
    return this.nodeIx.get(id) ?? this.routeIx.get(id) ?? this.flowIx.get(id);
  }

  routesOfNode(nodeId: EntityId): Route[] {
    return this.routesByNode.get(nodeId) ?? [];
  }
  flowsThroughRoute(routeId: EntityId): Flow[] {
    return this.flowsByRoute.get(routeId) ?? [];
  }
  flowsTouchingNode(nodeId: EntityId): Flow[] {
    return this.snap.flows.filter(
      (f) =>
        f.originId === nodeId ||
        f.destinationId === nodeId ||
        f.segments.some((s) => s.fromNodeId === nodeId || s.toNodeId === nodeId)
    );
  }
  routesByMode(mode: TransportMode): Route[] {
    return this.snap.routes.filter((r) => r.mode === mode);
  }
  nodesInCountry(cc: string): Facility[] {
    return this.snap.nodes.filter((n) => n.country === cc);
  }
  routesTouchingCountry(cc: string): Route[] {
    return this.snap.routes.filter((r) => {
      const o = this.nodeIx.get(r.originId);
      const d = this.nodeIx.get(r.destinationId);
      return o?.country === cc || d?.country === cc;
    });
  }

  // ---------------------------------------------------------------- temporal

  stateAt(entityId: EntityId, t: Timestamp): EntityState {
    return this.provider.stateAt(entityId, t);
  }

  activeEvents(t: Timestamp): WorldEvent[] {
    const ms = Date.parse(t);
    return this.snap.events.filter((e) => {
      const s = Date.parse(e.start);
      const en = e.end ? Date.parse(e.end) : Infinity;
      return ms >= s && ms <= en;
    });
  }

  // ----------------------------------------------------- promises vs evidence

  /**
   * Join assertions (promises) against observations (evidence) for an
   * entity — the deviation history that shows where estimates run
   * optimistic. Derived on demand; nothing is overwritten.
   */
  deviationsFor(entityId: EntityId): DeviationView[] {
    const out: DeviationView[] = [];
    for (const a of this.assertionsByEntity.get(entityId) ?? []) {
      const obs = (this.observationsByEntity.get(entityId) ?? []).filter(
        (o) => o.metric === a.metric
      );
      if (!obs.length) continue;
      const mean = obs.reduce((s, o) => s + o.value, 0) / obs.length;
      out.push({
        assertion: a,
        observations: obs,
        meanObserved: mean,
        deviation: {
          id: `dev:${a.id}`,
          entityId,
          assertionId: a.id,
          observationId: obs[obs.length - 1].id,
          metric: a.metric,
          delta: mean - a.value,
          ratio: a.value !== 0 ? mean / a.value : 0,
        },
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- search

  search(query: string, limit = 8): SearchResult[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const results: SearchResult[] = [];
    const scan = (
      items: { id: EntityId; name: string; kind?: string; tags?: string[] }[],
      kindOf: (x: any) => string,
      detailOf?: (x: any) => string
    ) => {
      for (const it of items) {
        const name = it.name.toLowerCase();
        let score = 0;
        if (name === q) score = 100;
        else if (name.startsWith(q)) score = 80;
        else if (name.includes(q)) score = 60;
        else if (it.tags?.some((tg) => tg.toLowerCase().includes(q))) score = 40;
        else {
          // token-prefix match ("la port" → Port of Los Angeles)
          const tokens = q.split(/\s+/);
          if (tokens.every((tk) => name.includes(tk))) score = 30;
        }
        if (score > 0)
          results.push({
            id: it.id,
            name: it.name,
            kind: kindOf(it),
            score,
            detail: detailOf?.(it),
          });
      }
    };
    scan(this.snap.nodes, (n) => n.kind, (n) => n.country ?? '');
    scan(this.snap.routes, (r) => `route:${r.mode}`, (r) => `${Math.round(r.distanceKm)} km`);
    scan(this.snap.flows, () => 'flow', (f) => this.commodityIx.get(f.commodityId)?.name ?? '');
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
