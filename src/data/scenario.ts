/**
 * Counterfactual engine — simulation over the twin's state.
 *
 * "If this chokepoint closes, what happens to the network" is the one
 * place a simulator belongs in a state mirror. This module is a pure,
 * deterministic function from (snapshot, resolved state, spec, t) to a
 * ScenarioImpact: perturbed entities, downstream starvation through
 * flow chains, and spillover onto corridor siblings. It never mutates
 * the snapshot, never persists anything, and everything it produces is
 * provenance-labeled 'synthetic:scenario' — a HYPOTHETICAL frame,
 * rendered as such. A simulated outcome is not an outcome.
 *
 * Propagation is intentionally explainable rather than clever: three
 * named mechanisms (closure, starvation, diversion), each carrying a
 * human-readable note about why the entity changed. The production
 * version of this seam is Payload's propagation engine + VROOM
 * re-optimization; this deterministic stand-in exercises the identical
 * frame contract.
 */

import type {
  EntityId,
  EntityState,
  Facility,
  LifecycleStatus,
  LonLat,
  Provenance,
  Route,
  Timestamp,
  WorldSnapshot,
} from './contracts';

// ------------------------------------------------------------------
// Frame contracts
// ------------------------------------------------------------------

export interface ScenarioPerturbation {
  /** A route id, or a node id (chokepoint / border / port). */
  entityId: EntityId;
  kind: 'closure' | 'congestion';
  /** 0..1 — closure at 1 stops traffic; congestion adds pressure. */
  magnitude: number;
}

export interface ScenarioSpec {
  id: EntityId;
  name: string;
  description: string;
  durationHours: number;
  perturbations: ScenarioPerturbation[];
  provenance: Provenance;
}

export type ScenarioRole = 'perturbed' | 'downstream' | 'spillover';

export interface ScenarioEntityDelta {
  entityId: EntityId;
  role: ScenarioRole;
  baseline: Pick<EntityState, 'utilization' | 'congestion' | 'status'>;
  scenario: Pick<EntityState, 'utilization' | 'congestion' | 'status'>;
  note: string;
}

export interface DelayedFlow {
  flowId: EntityId;
  delayHours: number;
  note: string;
}

export interface ScenarioImpact {
  spec: ScenarioSpec;
  /** Sim time the frame was computed against. */
  computedAt: Timestamp;
  deltas: ScenarioEntityDelta[];
  delayedFlows: DelayedFlow[];
  summary: {
    perturbedRoutes: number;
    downstreamFacilities: number;
    spilloverRoutes: number;
    flowsDelayed: number;
    totalDelayHours: number;
  };
}

// ------------------------------------------------------------------
// Geometry helper: which routes pass a node (chokepoint → lanes)
// ------------------------------------------------------------------

const DEG = Math.PI / 180;
const R_KM = 6371;

function greatCircleKm(a: LonLat, b: LonLat): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const s =
    Math.sin(((lat2 - lat1) * DEG) / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(((lon2 - lon1) * DEG) / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Routes whose polyline passes within radiusKm of a point. */
export function routesThroughPoint(
  routes: Route[],
  point: LonLat,
  radiusKm = 150
): Route[] {
  const out: Route[] = [];
  for (const r of routes) {
    for (const c of r.geometry.coordinates) {
      if (greatCircleKm(c, point) <= radiusKm) {
        out.push(r);
        break;
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------
// Catalog — one closure scenario per major chokepoint + the border
// ------------------------------------------------------------------

const SCENARIO_PROV: Provenance = {
  source: 'synthetic:scenario',
  knownAt: '2026-08-31T14:00:00Z',
  evidence: ['hypothetical frame — computed, not observed'],
  confidence: 1,
};

export function buildScenarioCatalog(snapshot: WorldSnapshot): ScenarioSpec[] {
  const specs: ScenarioSpec[] = [];
  for (const node of snapshot.nodes) {
    if (node.kind !== 'chokepoint' && node.kind !== 'border_crossing') continue;
    const touched = routesThroughPoint(snapshot.routes, node.geometry.coordinates);
    if (!touched.length) continue;
    specs.push({
      id: `scenario:close:${node.id.replace(/^node:/, '')}`,
      name: `${node.name} closure — 72 h`,
      description: `Full transit stop at ${node.name} for 72 hours. ${touched.length} lane(s) blocked; dependent flows queue, corridor siblings absorb diverted pressure.`,
      durationHours: 72,
      perturbations: [{ entityId: node.id, kind: 'closure', magnitude: 1 }],
      provenance: SCENARIO_PROV,
    });
  }
  return specs.sort((a, b) => a.name.localeCompare(b.name));
}

// ------------------------------------------------------------------
// The propagation itself
// ------------------------------------------------------------------

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export function computeScenarioImpact(
  snapshot: WorldSnapshot,
  stateAt: (id: EntityId, t: Timestamp) => EntityState,
  spec: ScenarioSpec,
  t: Timestamp
): ScenarioImpact {
  const deltas = new Map<EntityId, ScenarioEntityDelta>();
  const nodesById = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const routesById = new Map(snapshot.routes.map((r) => [r.id, r]));

  const baseOf = (id: EntityId): ScenarioEntityDelta['baseline'] => {
    const s = stateAt(id, t);
    return { utilization: s.utilization, congestion: s.congestion, status: s.status };
  };

  const put = (
    id: EntityId,
    role: ScenarioRole,
    note: string,
    fn: (base: ScenarioEntityDelta['baseline']) => ScenarioEntityDelta['scenario']
  ): void => {
    // stronger roles win: perturbed > downstream > spillover
    const rank: Record<ScenarioRole, number> = { perturbed: 0, downstream: 1, spillover: 2 };
    const existing = deltas.get(id);
    if (existing && rank[existing.role] <= rank[role]) return;
    const baseline = baseOf(id);
    deltas.set(id, { entityId: id, role, baseline, scenario: fn(baseline), note });
  };

  // ---- 1. resolve perturbations to concrete routes/nodes ------------------
  const perturbedRoutes = new Map<EntityId, ScenarioPerturbation>();
  for (const p of spec.perturbations) {
    const route = routesById.get(p.entityId);
    if (route) {
      perturbedRoutes.set(route.id, p);
      continue;
    }
    const node = nodesById.get(p.entityId);
    if (!node) continue;
    // node perturbation → every lane passing it + the node itself
    const status: LifecycleStatus = p.kind === 'closure' ? 'disrupted' : 'degraded';
    put(node.id, 'perturbed', spec.name, (b) => ({
      utilization: p.kind === 'closure' ? 0.02 : b.utilization,
      congestion: clamp01(b.congestion + p.magnitude),
      status,
    }));
    for (const r of routesThroughPoint(snapshot.routes, node.geometry.coordinates)) {
      perturbedRoutes.set(r.id, p);
    }
  }

  for (const [routeId, p] of perturbedRoutes) {
    const route = routesById.get(routeId)!;
    if (p.kind === 'closure') {
      put(routeId, 'perturbed', `blocked: ${spec.name}`, () => ({
        utilization: 0.03, // traffic stops; the queue builds off-lane
        congestion: 1,
        status: 'disrupted',
      }));
    } else {
      put(routeId, 'perturbed', `constrained: ${spec.name}`, (b) => ({
        utilization: clamp01(b.utilization + 0.15 * p.magnitude),
        congestion: clamp01(b.congestion + 0.6 * p.magnitude),
        status: b.congestion + 0.6 * p.magnitude > 0.75 ? 'disrupted' : 'degraded',
      }));
    }
    void route;
  }

  // ---- 2. downstream: flows over perturbed routes queue; the chain
  //         beyond the block starves ---------------------------------------
  const delayedFlows: DelayedFlow[] = [];
  let totalDelay = 0;
  for (const flow of snapshot.flows) {
    const hitIx = flow.segments.findIndex((s) => perturbedRoutes.has(s.routeId));
    if (hitIx < 0) continue;
    const hit = flow.segments[hitIx];
    const p = perturbedRoutes.get(hit.routeId)!;
    // queue for the closure window, plus a magnitude-scaled backlog drain
    const delayHours = Math.round(
      p.kind === 'closure'
        ? spec.durationHours + 24 * p.magnitude
        : spec.durationHours * 0.35 * p.magnitude
    );
    totalDelay += delayHours;
    const blockedRoute = routesById.get(hit.routeId);
    delayedFlows.push({
      flowId: flow.id,
      delayHours,
      note: `queued at ${blockedRoute?.name ?? hit.routeId}`,
    });
    // facilities beyond the block starve while the queue holds
    for (let i = hitIx; i < flow.segments.length; i++) {
      const downstreamId = flow.segments[i].toNodeId;
      if (!nodesById.has(downstreamId)) continue;
      put(downstreamId, 'downstream', `starved by queue on ${flow.name}`, (b) => ({
        utilization: clamp01(b.utilization - 0.3),
        congestion: b.congestion,
        status: b.status === 'disrupted' ? 'disrupted' : 'degraded',
      }));
    }
  }

  // ---- 3. spillover: diverted traffic loads the alternatives --------------
  // Two explainable mechanisms: (a) corridor siblings that are not
  // themselves blocked; (b) same-mode lanes sharing an endpoint with a
  // blocked lane — when a whole corridor closes (Suez), the diversion
  // shows up on the other lanes serving the same ports.
  const perturbedCorridors = new Set<string>();
  const perturbedEndpoints = new Set<EntityId>();
  const perturbedModes = new Set<string>();
  for (const id of perturbedRoutes.keys()) {
    const r = routesById.get(id);
    if (!r) continue;
    if (r.corridorId) perturbedCorridors.add(r.corridorId);
    perturbedEndpoints.add(r.originId);
    perturbedEndpoints.add(r.destinationId);
    perturbedModes.add(r.mode);
  }
  for (const route of snapshot.routes) {
    if (perturbedRoutes.has(route.id)) continue;
    const corridorSibling =
      !!route.corridorId && perturbedCorridors.has(route.corridorId);
    const endpointAlternative =
      perturbedModes.has(route.mode) &&
      (perturbedEndpoints.has(route.originId) || perturbedEndpoints.has(route.destinationId));
    if (!corridorSibling && !endpointAlternative) continue;
    const note = corridorSibling
      ? `corridor sibling absorbing traffic diverted by ${spec.name}`
      : `alternative lane at a blocked port absorbing diversion from ${spec.name}`;
    put(route.id, 'spillover', note, (b) => ({
      utilization: clamp01(b.utilization + 0.2),
      congestion: clamp01(b.congestion + 0.3),
      status: b.congestion + 0.3 > 0.8 ? 'degraded' : b.status,
    }));
  }

  const all = [...deltas.values()];
  return {
    spec,
    computedAt: t,
    deltas: all,
    delayedFlows: delayedFlows.sort((a, b) => b.delayHours - a.delayHours),
    summary: {
      perturbedRoutes: all.filter((d) => d.role === 'perturbed' && routesById.has(d.entityId)).length,
      downstreamFacilities: all.filter((d) => d.role === 'downstream').length,
      spilloverRoutes: all.filter((d) => d.role === 'spillover').length,
      flowsDelayed: delayedFlows.length,
      totalDelayHours: totalDelay,
    },
  };
}

export type { Facility };
