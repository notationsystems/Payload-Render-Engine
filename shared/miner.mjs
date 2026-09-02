/**
 * Payload Miner v0 — the single canonical implementation, shared by
 * the projection service (GET /api/mining/patterns) and the renderer
 * (in-browser fallback for the unstamped corpus). One algorithm, two
 * consumers: the renderer must display exactly the run the service
 * would serve, so the code cannot fork.
 *
 * The epistemic ladder is schema-enforced here:
 *
 *   Observation ≠ DerivedMetric ≠ MinedPattern ≠ Hypothesis
 *
 * Everything this module emits is a MINED PATTERN CANDIDATE: a
 * structure computed by a named, versioned algorithm over declared
 * corpus fields — never an observed fact, never silently promoted.
 * Provenance chain: Pattern → MiningRun → CorpusBuild → records.
 *
 * Determinism is a contract: ties break lexicographically, so the
 * same corpus build always yields the same patterns. (The run's
 * generatedAt is wall-clock — compare pattern arrays, not runs.)
 *
 * v0 miners (all pure, deterministic, field-based):
 *   - supply concentration: declared flows of a commodity dominated
 *     by one origin
 *   - structural articulation: route-graph cut vertices (removal
 *     disconnects the declared network)
 *   - shared corridors: single routes many declared flows traverse
 *
 * Types live in ./miner.d.mts; src/intel/miner.ts re-exports both.
 */

const PARAMS = {
  concentrationMinFlows: 4,
  concentrationMinShare: 0.5,
  corridorMinFlows: 5,
};

/** The registered mining programs — the single registry both the run
 *  manifest and the corpus definition serve. */
export const MINING_PROGRAMS = [
  {
    name: 'origin-share',
    version: '0.1',
    parameters: { minFlows: PARAMS.concentrationMinFlows, minShare: PARAMS.concentrationMinShare },
  },
  { name: 'articulation-points (Tarjan)', version: '0.1', parameters: {} },
  { name: 'corridor-share', version: '0.1', parameters: { minFlows: PARAMS.corridorMinFlows } },
];

/**
 * Mine one snapshot. Pure: no I/O, no mutation of the snapshot.
 * @param {import('./miner.d.mts').MinableSnapshot} snapshot
 * @returns {{ run: import('./miner.d.mts').MiningRun, patterns: import('./miner.d.mts').MinedPattern[] }}
 */
export function runMiner(snapshot) {
  const corpusBuildId = snapshot.meta.corpusBuild?.id ?? 'unstamped-corpus';
  const miningRunId = `mine-${corpusBuildId}-miner0.1`;
  const patterns = [];

  const nameOf = (id) =>
    snapshot.nodes.find((n) => n.id === id)?.name ??
    snapshot.routes.find((r) => r.id === id)?.name ??
    snapshot.commodities.find((c) => c.id === id)?.name ??
    id;

  // ---- 1. supply concentration: declared flows per commodity by origin
  for (const c of [...snapshot.commodities].sort((a, b) => a.id.localeCompare(b.id))) {
    const flows = snapshot.flows.filter((f) => f.commodityId === c.id);
    if (flows.length < PARAMS.concentrationMinFlows) continue;
    const byOrigin = new Map();
    for (const f of flows) {
      byOrigin.set(f.originId, [...(byOrigin.get(f.originId) ?? []), f.id]);
    }
    const ranked = [...byOrigin.entries()].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])
    );
    const [topOrigin, topFlows] = ranked[0];
    const share = topFlows.length / flows.length;
    if (share < PARAMS.concentrationMinShare) continue;
    patterns.push({
      id: `pat-conc-${c.id.split(':').pop()}`,
      patternType: 'SUPPLY_CONCENTRATION',
      statement: `${Math.round(share * 100)}% of declared ${nameOf(c.id)} flows originate at ${nameOf(topOrigin)} (${topFlows.length} of ${flows.length})`,
      entities: [topOrigin],
      routes: flows.flatMap((f) => f.segments.map((s) => s.routeId)),
      supportingRecords: flows.map((f) => f.id),
      algorithm: 'origin-share',
      algorithmVersion: '0.1',
      score: share,
      scoreBasis: 'share of declared flows from the top origin',
      miningRunId,
      corpusBuildId,
      validationStatus: 'candidate',
    });
  }

  // ---- 2. structural articulation: cut vertices of the route graph
  const adj = new Map();
  const edge = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a).add(b);
  };
  for (const r of snapshot.routes) {
    if (!r.originId || !r.destinationId) continue;
    edge(r.originId, r.destinationId);
    edge(r.destinationId, r.originId);
  }
  const verts = [...adj.keys()].sort();
  const disc = new Map();
  const low = new Map();
  const cuts = new Set();
  let timer = 0;
  const dfs = (u, parent) => {
    disc.set(u, ++timer);
    low.set(u, timer);
    let children = 0;
    for (const v of [...(adj.get(u) ?? [])].sort()) {
      if (!disc.has(v)) {
        children++;
        dfs(v, u);
        low.set(u, Math.min(low.get(u), low.get(v)));
        if (parent !== null && low.get(v) >= disc.get(u)) cuts.add(u);
        if (parent === null && children > 1) cuts.add(u);
      } else if (v !== parent) {
        low.set(u, Math.min(low.get(u), disc.get(v)));
      }
    }
  };
  for (const v of verts) if (!disc.has(v)) dfs(v, null);
  for (const cut of [...cuts].sort()) {
    const node = snapshot.nodes.find((n) => n.id === cut);
    if (!node) continue;
    const incident = snapshot.routes
      .filter((r) => r.originId === cut || r.destinationId === cut)
      .map((r) => r.id);
    const declared = node.kind === 'chokepoint';
    patterns.push({
      id: `pat-artic-${cut.split(':').pop()}`,
      patternType: 'STRUCTURAL_ARTICULATION',
      statement: `removing ${node.name} disconnects part of the declared route network${declared ? ' — confirms a DECLARED chokepoint structurally' : ' — NOT declared as a chokepoint by any source'}`,
      entities: [cut],
      routes: incident,
      supportingRecords: incident,
      algorithm: 'articulation-points (Tarjan)',
      algorithmVersion: '0.1',
      score: declared ? 0.5 : 1,
      scoreBasis: 'undeclared cut vertices score higher — they are the discovery',
      miningRunId,
      corpusBuildId,
      validationStatus: 'candidate',
    });
  }

  // ---- 3. shared corridors: one route, many declared flows
  const flowsPerRoute = new Map();
  for (const f of snapshot.flows) {
    for (const s of f.segments) {
      const arr = flowsPerRoute.get(s.routeId) ?? [];
      if (!arr.includes(f.id)) arr.push(f.id);
      flowsPerRoute.set(s.routeId, arr);
    }
  }
  const corridors = [...flowsPerRoute.entries()]
    .filter(([, fl]) => fl.length >= PARAMS.corridorMinFlows)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  for (const [routeId, fl] of corridors) {
    const route = snapshot.routes.find((r) => r.id === routeId);
    if (!route) continue;
    patterns.push({
      id: `pat-corr-${routeId.split(':').pop()}`,
      patternType: 'SHARED_CORRIDOR',
      statement: `${fl.length} of ${snapshot.flows.length} declared flows traverse ${route.name}`,
      entities: [route.originId, route.destinationId].filter(Boolean),
      routes: [routeId],
      supportingRecords: fl,
      algorithm: 'corridor-share',
      algorithmVersion: '0.1',
      score: fl.length / Math.max(1, snapshot.flows.length),
      scoreBasis: 'share of all declared flows traversing this one route',
      miningRunId,
      corpusBuildId,
      validationStatus: 'candidate',
    });
  }

  const run = {
    miningRunId,
    corpusBuildId,
    algorithms: MINING_PROGRAMS,
    inputCounts: {
      nodes: snapshot.nodes.length,
      routes: snapshot.routes.length,
      flows: snapshot.flows.length,
    },
    generatedAt: new Date().toISOString(),
    patternCount: patterns.length,
  };
  return { run, patterns };
}
