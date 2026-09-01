/**
 * Route handlers for the Payload Earth Spatial API.
 *
 * All handlers are pure functions over the loaded corpus: this service
 * projects state, it never stores or mutates it (INV-6). Handlers
 * return { status: 'ok', data, meta } or { status: 'refused', refusal }
 * — a typed refusal with a remedy, never a silent zero.
 */

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const load = (p) => import(pathToFileURL(resolve(ROOT, p)).href);

export async function registerRoutes() {
  // the SAME semantic layer the client ships — one corpus, no drift
  const world = await load('src/data/synthetic/world.ts');
  const providerMod = await load('src/data/synthetic/provider.ts');
  const scenarioMod = await load('src/data/scenario.ts');

  const snapshot = world.buildWorldSnapshot();
  const provider = new providerMod.SyntheticProvider();
  await provider.load();
  const stateAt = (id, t) => provider.stateAt(id, t);
  const scenarios = scenarioMod.buildScenarioCatalog(snapshot);

  const RANGE = snapshot.timeRange;
  const startMs = Date.parse(RANGE.start);
  const endMs = Date.parse(RANGE.end);

  const entityIndex = new Map();
  for (const n of snapshot.nodes) entityIndex.set(n.id, n);
  for (const r of snapshot.routes) entityIndex.set(r.id, r);
  for (const f of snapshot.flows) entityIndex.set(f.id, f);

  // ------------------------------------------------------------ envelope

  /**
   * Every ok-response carries the same meta block: what class of data
   * this is, when it became knowable, what instant it was evaluated
   * at, under which knowledge mode, and whether it is admissible as
   * evidence about the real world. The synthetic corpus is
   * categorically inadmissible — that is a field, not a banner.
   */
  const meta = (asOf, knowledge, frame) => ({
    sourceClass: 'synthetic:demo',
    // the Terminal's admissibility switch: representative fixture data is
    // categorically inadmissible, and the BASIS is stated, not implied
    valueKind: 'representative',
    admissible: false,
    admissibleBasis: 'rests_on_representative',
    corpus: snapshot.meta.label,
    generatedAt: snapshot.meta.generatedAt,
    knownAt: RANGE.now,
    asOf,
    knowledge,
    vintages: 1, // single-vintage corpus: as_known_then === best_known, honestly
    // EvaluationFrame (payload-terminal-v0 engine.ts vocabulary)
    frame: frame ?? { kind: 'reconstruction', asOf, knowledge },
    // attribution fingerprint — otherwise "this number looks wrong" is an anecdote
    attribution: {
      service: 'payload-earth-spatial-api',
      version: '0.1.0',
      corpus: snapshot.meta.label,
      corpusGeneratedAt: snapshot.meta.generatedAt,
    },
    disclaimer: snapshot.meta.disclaimer,
  });

  const ok = (data, asOf = RANGE.now, knowledge = 'best_known', frame) => ({
    status: 'ok',
    data,
    meta: meta(asOf, knowledge, frame),
  });

  // Unanswerable is not a protocol error: refusals travel as HTTP 200
  // with a typed SCREAMING_SNAKE code naming the observable, plus a
  // remedy. 404 is reserved for capabilities that do not exist at all.
  const refuse = (kind, message, remedy, httpStatus = 200) => ({
    status: 'refused',
    refusal: { kind, message, remedy },
    httpStatus,
  });

  // ------------------------------------------------------------- helpers

  /** Validate ?t=/?asOf= against the corpus's knowledge range. */
  const resolveAsOf = (query) => {
    const raw = query.get('t') ?? query.get('asOf');
    if (!raw) return { asOf: RANGE.now };
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms)) {
      return {
        refusal: refuse(
          'UNPARSEABLE_TIME',
          `'${raw}' is not an ISO-8601 instant`,
          'pass t as e.g. 2026-08-31T14:00:00Z'
        ),
      };
    }
    if (ms < startMs || ms > endMs) {
      return {
        refusal: refuse(
          'OUTSIDE_KNOWLEDGE_RANGE',
          `${raw} is outside this corpus's range [${RANGE.start} .. ${RANGE.end}]`,
          'query within the range, or ingest a corpus vintage that covers the instant'
        ),
      };
    }
    return { asOf: new Date(ms).toISOString() };
  };

  const resolveKnowledge = (query) => {
    const k = query.get('knowledge') ?? 'best_known';
    if (k !== 'best_known' && k !== 'as_known_then') {
      return {
        refusal: refuse(
          'UNKNOWN_KNOWLEDGE_MODE',
          `knowledge='${k}' is not a mode this service speaks`,
          "use knowledge=best_known or knowledge=as_known_then"
        ),
      };
    }
    return { knowledge: k };
  };

  // -------------------------------------------------------------- routes

  const routes = [];
  const get = (path, handler) => {
    const pattern = new RegExp(
      '^' + path.replace(/:([a-zA-Z]+)/g, (_, name) => `(?<${name}>[^/]+)`) + '$'
    );
    routes.push({ method: 'GET', pattern, handler });
  };

  get('/api/health', () =>
    ok({
      service: 'payload-earth-spatial-api',
      version: '0.1.0',
      corpus: snapshot.meta.label,
      counts: {
        nodes: snapshot.nodes.length,
        routes: snapshot.routes.length,
        flows: snapshot.flows.length,
        events: snapshot.events.length,
        assertions: snapshot.assertions.length,
        observations: snapshot.observations.length,
        scenarios: scenarios.length,
      },
      timeRange: RANGE,
    })
  );

  get('/api/capabilities', () =>
    ok(
      routes.map((r) => ({
        method: r.method,
        pattern: r.pattern.source.replace(/^\^|\$$/g, '').replace(/\(\?<([a-zA-Z]+)>\[\^\/\]\+\)/g, ':$1'),
      }))
    )
  );

  get('/api/snapshot', ({ query }) => {
    const t = resolveAsOf(query);
    if (t.refusal) return t.refusal;
    const k = resolveKnowledge(query);
    if (k.refusal) return k.refusal;
    return ok(snapshot, t.asOf, k.knowledge);
  });

  get('/api/state/:entityId', ({ params, query }) => {
    const id = decodeURIComponent(params.entityId);
    if (!entityIndex.has(id)) {
      return refuse(
        'UNKNOWN_ENTITY',
        `no entity '${id}' in this corpus`,
        'GET /api/search?q=<name> to resolve ids; ids look like node:port-rotterdam / route:sea-shanghai-la / flow:...'
      );
    }
    const t = resolveAsOf(query);
    if (t.refusal) return t.refusal;
    const k = resolveKnowledge(query);
    if (k.refusal) return k.refusal;
    // three-valued reading shape (known | unobserved | no_history) — the
    // deterministic corpus always answers 'known'; the SHAPE ships now so
    // real telemetry can answer honestly without an API break
    return ok({ reading: 'known', state: stateAt(id, t.asOf) }, t.asOf, k.knowledge);
  });

  get('/api/states', ({ query }) => {
    const idsRaw = query.get('ids');
    if (!idsRaw) {
      return refuse('MISSING_IDS', 'ids parameter is required', 'pass ids=<id>,<id>,...');
    }
    const t = resolveAsOf(query);
    if (t.refusal) return t.refusal;
    const ids = idsRaw.split(',').map((s) => s.trim()).filter(Boolean);
    const states = [];
    const unknown = [];
    for (const id of ids) {
      if (entityIndex.has(id)) states.push(stateAt(id, t.asOf));
      else unknown.push(id);
    }
    // partial-failure batching with conservation accounting:
    // examined = resolved + refused, asserted on the wire
    return ok(
      { states, unknown, examined: ids.length, resolved: states.length, refused: unknown.length },
      t.asOf
    );
  });

  get('/api/entities', ({ query }) => {
    const bboxRaw = query.get('bbox');
    let nodes = snapshot.nodes;
    if (bboxRaw) {
      const parts = bboxRaw.split(',').map(Number);
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
        return refuse(
          'UNPARSEABLE_BBOX',
          `bbox '${bboxRaw}' is not west,south,east,north`,
          'pass bbox=-10,40,10,60 (degrees)'
        );
      }
      const [w, s, e, n] = parts;
      nodes = nodes.filter((node) => {
        const [lon, lat] = node.geometry.coordinates;
        return lon >= w && lon <= e && lat >= s && lat <= n;
      });
    }
    const kinds = query.get('kinds');
    if (kinds) {
      const set = new Set(kinds.split(',').map((s) => s.trim()));
      nodes = nodes.filter((n) => set.has(n.kind));
    }
    const minImportance = Number(query.get('minImportance') ?? 0);
    if (minImportance > 0) nodes = nodes.filter((n) => n.importance >= minImportance);
    return ok({ nodes, total: nodes.length });
  });

  get('/api/search', ({ query }) => {
    const q = (query.get('q') ?? '').trim().toLowerCase();
    if (q.length < 2) {
      return refuse('QUERY_TOO_SHORT', 'q must be at least 2 characters', 'pass q=<name fragment>');
    }
    const hits = [];
    for (const [id, ent] of entityIndex) {
      const name = ent.name.toLowerCase();
      let score = 0;
      if (name === q) score = 100;
      else if (name.startsWith(q)) score = 80;
      else if (name.includes(q)) score = 60;
      if (score) hits.push({ id, name: ent.name, kind: ent.kind ?? 'flow', score });
    }
    return ok(hits.sort((a, b) => b.score - a.score).slice(0, 12));
  });

  get('/api/deviations/:entityId', ({ params }) => {
    const id = decodeURIComponent(params.entityId);
    const assertions = snapshot.assertions.filter((a) => a.entityId === id);
    if (!assertions.length) {
      return refuse(
        'NO_ASSERTIONS',
        `no promises recorded for '${id}' — a deviation needs an assertion to test`,
        'entities with transit promises: query /api/snapshot and filter assertions by entityId'
      );
    }
    const out = assertions.map((a) => {
      const obs = snapshot.observations.filter(
        (o) => o.entityId === id && o.metric === a.metric
      );
      const mean = obs.length ? obs.reduce((s, o) => s + o.value, 0) / obs.length : null;
      return {
        assertion: a,
        observations: obs,
        meanObserved: mean,
        deviation:
          mean === null
            ? null
            : { delta: mean - a.value, ratio: a.value !== 0 ? mean / a.value : null, n: obs.length },
      };
    });
    return ok(out);
  });

  get('/api/scenarios', () => ok(scenarios));

  get('/api/scenarios/rank', ({ query }) => {
    const t = resolveAsOf(query);
    if (t.refusal) return t.refusal;
    const rows = scenarioMod.rankScenarioImpacts(snapshot, stateAt, scenarios, t.asOf);
    // computed intelligence in a counterfactual frame, never observation
    const frame = { kind: 'counterfactual', asOf: t.asOf, knowledge: 'best_known', scenarioId: null };
    return {
      ...ok(rows, t.asOf, 'best_known', frame),
      meta: { ...meta(t.asOf, 'best_known', frame), sourceClass: 'synthetic:scenario', computed: true },
    };
  });

  get('/api/scenarios/:scenarioId/impact', ({ params, query }) => {
    const id = decodeURIComponent(params.scenarioId);
    const spec = scenarios.find((s) => s.id === id);
    if (!spec) {
      return refuse(
        'UNKNOWN_SCENARIO',
        `no frame '${id}' in the catalog`,
        'GET /api/scenarios lists the catalog'
      );
    }
    const t = resolveAsOf(query);
    if (t.refusal) return t.refusal;
    const impact = scenarioMod.computeScenarioImpact(snapshot, stateAt, spec, t.asOf);
    const frame = { kind: 'counterfactual', asOf: t.asOf, knowledge: 'best_known', scenarioId: spec.id };
    return {
      ...ok(impact, t.asOf, 'best_known', frame),
      meta: { ...meta(t.asOf, 'best_known', frame), sourceClass: 'synthetic:scenario', computed: true },
    };
  });

  return routes;
}
