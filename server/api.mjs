/**
 * Route handlers for the Payload Earth Spatial API.
 *
 * All handlers are pure functions over the loaded corpus: this service
 * projects state, it never stores or mutates it (INV-6). Handlers
 * return { status: 'ok', data, meta } or { status: 'refused', refusal }
 * — a typed refusal with a remedy, never a silent zero.
 *
 * The corpus itself comes through a loader (server/loaders/*) — the
 * server's source seam. The synthetic demo world is one loader; the
 * Terminal-projections loader is another. The routes do not know or
 * care which one is live: admissibility posture, state readings and
 * scenario support all travel with the corpus object.
 */

import { createHash } from 'node:crypto';
import { loadSyntheticCorpus } from './loaders/synthetic.mjs';
import { registerLiveRoutes } from './live.mjs';
import { registerMarketRoutes } from './markets.mjs';
import { MINING_PROGRAMS, runMiner } from '../shared/miner.mjs';

/** Version of the entity/observation/relationship/event schema this
 *  projection serves — part of every corpus build's identity. */
const SCHEMA_VERSION = '0.1';

export async function registerRoutes(corpus) {
  corpus = corpus ?? (await selectCorpus(process.env));

  const snapshot = corpus.snapshot;
  const scenarios = corpus.scenarios;

  // ------------------------------------------------------- corpus build
  // Locked platform doctrine: every corpus-derived answer names the
  // build that produced it — "which version of the corpus produced
  // this answer?" is always answerable. The fingerprint is a content
  // hash of the canonical snapshot this projection serves; identical
  // canonical state ⇒ identical fingerprint; any change ⇒ a new one.
  // Fields appear as the capabilities exist — no ontology/embedding
  // version is stamped until an ontology/embedding actually exists.
  const canonicalStateFingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        nodes: snapshot.nodes,
        routes: snapshot.routes,
        flows: snapshot.flows,
        events: snapshot.events,
        assertions: snapshot.assertions,
        observations: snapshot.observations,
        commodities: snapshot.commodities,
        timeRange: snapshot.timeRange,
      })
    )
    .digest('hex')
    .slice(0, 16);
  const corpusBuild = {
    id: `build-${corpus.kind}-${canonicalStateFingerprint.slice(0, 8)}`,
    canonicalStateFingerprint,
    schemaVersion: SCHEMA_VERSION,
    compilerVersion: `${corpus.kind}-loader/0.1`,
    generatedAt: snapshot.meta.generatedAt,
  };
  // the build identity rides on RESPONSES, never on the canonical
  // object itself — the loader stays a pure projection (byte-identical
  // snapshots for identical captures), and the /api/snapshot route
  // augments its served copy so renderers can display the build
  const snapshotWithBuild = { ...snapshot, meta: { ...snapshot.meta, corpusBuild } };

  const RANGE = snapshot.timeRange;
  const startMs = Date.parse(RANGE.start);
  const endMs = Date.parse(RANGE.end);

  const entityIndex = new Map();
  for (const n of snapshot.nodes) entityIndex.set(n.id, n);
  for (const r of snapshot.routes) entityIndex.set(r.id, r);
  for (const f of snapshot.flows) entityIndex.set(f.id, f);

  // scenario engines evaluate over known states only; a corpus whose
  // readings can be 'unobserved' does not get a fabricated baseline
  const knownStateAt = (id, t) => {
    const r = corpus.readStateAt(id, t);
    return r.state;
  };

  // ------------------------------------------------------------ envelope

  /**
   * Every ok-response carries the same meta block: what class of data
   * this is, when it became knowable, what instant it was evaluated
   * at, under which knowledge mode, and whether it is admissible as
   * evidence about the real world. The admissibility posture comes
   * from the corpus loader — the synthetic corpus is categorically
   * inadmissible; a projected corpus earns it per record.
   */
  const meta = (asOf, knowledge, frame) => ({
    // vintages travels IN metaDefaults — a per-corpus claim, never a
    // route-level constant
    ...corpus.metaDefaults,
    corpus: snapshot.meta.label,
    corpusKind: corpus.kind,
    generatedAt: snapshot.meta.generatedAt,
    knownAt: RANGE.now,
    asOf,
    knowledge,
    // EvaluationFrame (payload-terminal-v0 engine.ts vocabulary)
    frame: frame ?? { kind: 'reconstruction', asOf, knowledge },
    // attribution fingerprint — otherwise "this number looks wrong" is an anecdote
    attribution: {
      service: 'payload-earth-spatial-api',
      version: '0.1.0',
      corpus: snapshot.meta.label,
      corpusKind: corpus.kind,
      corpusGeneratedAt: snapshot.meta.generatedAt,
      ...(corpus.attributionExtra ?? {}),
    },
    // which build of the corpus produced this answer — always answerable
    corpusBuild,
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
    // a corpus that cannot honestly answer a mode REFUSES it — accepting
    // as_known_then over a single unreplayable capture would silently
    // alias it to best_known, which is a lie about what was known when
    const supported = corpus.knowledgeModes ?? ['best_known', 'as_known_then'];
    if (!supported.includes(k)) {
      return {
        refusal: refuse(
          'KNOWLEDGE_MODE_UNSUPPORTED_FOR_CORPUS',
          `corpus '${corpus.kind}' cannot answer knowledge=${k} — it is a single capture whose revision chains (supersedes) are not replayable`,
          `use knowledge=${supported.join(' or knowledge=')}, or ingest a multi-vintage corpus`
        ),
      };
    }
    return { knowledge: k };
  };

  // a path segment that is not valid percent-encoding is a malformed
  // question, not a server fault — refuse it with a remedy, never a 500
  const decodeId = (raw) => {
    try {
      return { id: decodeURIComponent(raw) };
    } catch {
      return {
        refusal: refuse(
          'UNPARSEABLE_ID',
          `'${raw}' is not valid percent-encoding`,
          'URL-encode the entity id (e.g. node%3Aport-rotterdam)'
        ),
      };
    }
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
      corpusKind: corpus.kind,
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
      // the loader's conservation report: what mapped, what was excluded
      // and WHY — an upstream record never disappears silently
      ...(corpus.mappingReport ? { mappingReport: corpus.mappingReport } : {}),
    })
  );

  get('/api/capabilities', () =>
    ok(
      routes.map((r) => ({
        method: r.method,
        // human/agent-readable route shape: unescape the regex slashes
        // and render named params as :param
        pattern: r.pattern.source
          .replace(/^\^|\$$/g, '')
          .replace(/\(\?<([a-zA-Z]+)>\[\^\/\]\+\)/g, ':$1')
          .replace(/\\\//g, '/'),
      }))
    )
  );

  get('/api/snapshot', ({ query }) => {
    const t = resolveAsOf(query);
    if (t.refusal) return t.refusal;
    const k = resolveKnowledge(query);
    if (k.refusal) return k.refusal;
    return ok(snapshotWithBuild, t.asOf, k.knowledge);
  });

  // ---- mining: the Data Miner served as a capability. Deterministic
  // per corpus build (mined over snapshotWithBuild so every candidate
  // is stamped with the build id the envelope also carries) and
  // memoized: same build ⇒ same run — asking twice must not fabricate
  // a second discovery event. Everything served here is a CANDIDATE:
  // validationStatus never leaves 'candidate' in this service, because
  // validation is a corpus-platform concern, not a projection's.
  let miningResult = null;
  get('/api/mining/patterns', () => {
    if (!miningResult) miningResult = runMiner(snapshotWithBuild);
    return ok(miningResult);
  });

  // ---- corpus definition: the corpus as a MANUFACTURED artifact of
  // the corpus machinery — 𝒞 = F(ontology, sources, extraction,
  // resolution, validation, mining, policy, publication). The DECLARED
  // half comes from the loader (the rules it actually enforces, kept
  // adjacent to the enforcing code); the type censuses are DERIVED
  // from the served snapshot and say so. Absent capabilities (access
  // policy) are stated with reasons, never invented.
  get('/api/corpus/definition', () => {
    const census = (arr, key) => {
      const m = {};
      for (const x of arr) {
        const k = key(x) ?? 'unspecified';
        m[k] = (m[k] ?? 0) + 1;
      }
      return m;
    };
    const declared = corpus.definition ?? {
      status: 'ABSENT',
      reason: `loader '${corpus.kind}' declares no CorpusDefinition`,
    };
    return ok({
      ...declared,
      entity_types: {
        basis: 'derived_from_snapshot',
        nodeKinds: census(snapshot.nodes, (n) => n.kind),
      },
      relation_types: {
        basis: 'derived_from_snapshot',
        routeModes: census(snapshot.routes, (r) => r.mode),
        flows: snapshot.flows.length,
        flowSegments: snapshot.flows.reduce((s, f) => s + f.segments.length, 0),
        commodities: snapshot.commodities.length,
      },
      observation_types: {
        basis: 'derived_from_snapshot',
        metrics: census(snapshot.observations ?? [], (o) => o.metric),
      },
      mining_programs: { basis: 'registered_algorithms', programs: MINING_PROGRAMS },
      publication_contract: {
        envelope:
          '{status, data, meta} — meta carries basis, knownAt, admissibility, attribution, corpusBuild',
        refusals:
          'typed SCREAMING_SNAKE refusals with remedies at HTTP 200; 404 reserved for capabilities that do not exist',
        knowledgeModes: corpus.knowledgeModes,
        schemaVersion: SCHEMA_VERSION,
      },
    });
  });

  get('/api/state/:entityId', ({ params, query }) => {
    const dec = decodeId(params.entityId);
    if (dec.refusal) return dec.refusal;
    const id = dec.id;
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
    // three-valued reading (known | unobserved | no_history) — the
    // corpus loader answers; the deterministic synthetic corpus is
    // always 'known', a projected corpus answers honestly per record
    return ok(corpus.readStateAt(id, t.asOf), t.asOf, k.knowledge);
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
    const unreadable = [];
    const unknown = [];
    for (const id of ids) {
      if (!entityIndex.has(id)) {
        unknown.push(id);
        continue;
      }
      const r = corpus.readStateAt(id, t.asOf);
      if (r.reading === 'known') states.push(r.state);
      else unreadable.push({ id, reading: r.reading });
    }
    // partial-failure batching with conservation accounting, asserted
    // on the wire: examined = resolved + unreadable + refused — every
    // id is accounted for, and "which kind of nothing" is preserved
    // (unknown id ≠ known entity with no reading)
    return ok(
      {
        states,
        unreadable,
        unknown,
        examined: ids.length,
        resolved: states.length,
        refused: unknown.length,
      },
      t.asOf
    );
  });

  get('/api/entities', ({ query }) => {
    const bboxRaw = query.get('bbox');
    let nodes = snapshot.nodes;
    if (bboxRaw) {
      // Number('') is 0 — an empty component must fail the finite guard,
      // not silently read as a coordinate
      const parts = bboxRaw.split(',').map((s) => (s.trim() === '' ? NaN : Number(s)));
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
    const dec = decodeId(params.entityId);
    if (dec.refusal) return dec.refusal;
    const id = dec.id;
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

  // a corpus without a scenario engine cannot answer counterfactuals —
  // that is a typed refusal, never an empty catalog posing as an answer
  const scenarioGuard = () =>
    corpus.scenarioEngine
      ? null
      : refuse(
          'COUNTERFACTUALS_UNSUPPORTED_FOR_CORPUS',
          `corpus '${corpus.kind}' has no scenario engine — its state readings do not support a counterfactual baseline`,
          'query a corpus with deterministic or observed dynamics (e.g. the synthetic demo corpus)'
        );

  // ------------------------------------------------- operations mirror
  // The Terminal's brokerage control tower, mirrored READ-ONLY. The
  // operations credential lives in THIS server's environment and never
  // reaches a browser (matching the Terminal's own posture: not in
  // URLs, not in storage, not in a rendered page). Every upstream
  // outcome maps to a typed answer — an unconfigured or unauthorized
  // desk is a refusal with a remedy, never an empty desk.
  get('/api/operations', async () => {
    const upstreamBase = process.env.TERMINAL_URL ?? 'http://127.0.0.1:3000';
    const token = process.env.PAYLOAD_OPERATIONS_TOKEN;
    if (!token?.trim()) {
      return refuse(
        'OPERATIONS_NOT_CONFIGURED',
        'this spatial API holds no operations authority — the mirror is fail-closed',
        'set PAYLOAD_OPERATIONS_TOKEN (and TERMINAL_URL) in the spatial API server environment; the credential never reaches the browser'
      );
    }
    let res;
    try {
      res = await fetch(`${upstreamBase}/api/freight/control-tower`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
    } catch (err) {
      return refuse(
        'OPERATIONS_UPSTREAM_UNREACHABLE',
        `the Terminal at ${upstreamBase} did not answer: ${err?.message ?? err}`,
        'start payload-terminal-v0 (TERMINAL_URL) with its operations journals mounted'
      );
    }
    let body;
    try {
      body = await res.json();
    } catch {
      return refuse(
        'OPERATIONS_UPSTREAM_UNREADABLE',
        `the Terminal answered HTTP ${res.status} without readable JSON`,
        'check the Terminal deployment; the mirror never renders a desk it cannot read'
      );
    }
    if (res.status === 401 || res.status === 403) {
      return refuse(
        'OPERATIONS_UNAUTHORIZED',
        body?.detail ?? 'the Terminal refused this mirror\'s operations authority',
        body?.remedy ?? 'align PAYLOAD_OPERATIONS_TOKEN between the spatial API and the Terminal'
      );
    }
    if (body?.error === 'operations_not_configured') {
      return refuse('OPERATIONS_NOT_CONFIGURED', body.detail ?? 'upstream operations are fail-closed', body.remedy ?? 'configure the Terminal operations token');
    }
    if (body?.kind === 'refusal') {
      // the tower refusing (journal corrupt/unavailable) IS the answer —
      // it passes through typed, never softened into an empty desk
      return refuse(body.code ?? 'OPERATIONS_REFUSED', body.detail ?? 'the control tower refused', body.remedy ?? 'see the Terminal operations runbook');
    }
    if (body?.kind !== 'control_tower_snapshot') {
      return refuse(
        'OPERATIONS_UPSTREAM_UNREADABLE',
        `the Terminal answered with kind '${body?.kind}' — not a control-tower snapshot`,
        'check the Terminal version; this mirror speaks the control-tower contract'
      );
    }
    return {
      ...ok(body, body.asOf),
      meta: {
        ...meta(body.asOf, 'best_known'),
        // live journal projection, not the loaded corpus — say so
        sourceClass: 'terminal:operations',
        valueKind: 'per_record',
        admissible: null,
        admissibleBasis: 'journal_projection',
        readOnlyMirror: true,
        upstream: `${upstreamBase}/api/freight/control-tower`,
        disclaimer:
          'READ-ONLY MIRROR of the Terminal brokerage control tower — a projection over append-only operation journals; commands execute only in the Terminal desk',
      },
    };
  });

  // live-feed proxy (gods-eye-view substrate) — corpus-independent
  registerLiveRoutes(get, { ok, refuse, meta });

  // markets proxy (trading-desk substrate) — corpus-independent
  registerMarketRoutes(get, { ok, refuse, meta });

  get('/api/scenarios', () => scenarioGuard() ?? ok(scenarios));

  get('/api/scenarios/rank', ({ query }) => {
    const guard = scenarioGuard();
    if (guard) return guard;
    const t = resolveAsOf(query);
    if (t.refusal) return t.refusal;
    const rows = corpus.scenarioEngine.rank(knownStateAt, scenarios, t.asOf);
    // computed intelligence in a counterfactual frame, never observation
    const frame = { kind: 'counterfactual', asOf: t.asOf, knowledge: 'best_known', scenarioId: null };
    return {
      ...ok(rows, t.asOf, 'best_known', frame),
      meta: { ...meta(t.asOf, 'best_known', frame), sourceClass: 'synthetic:scenario', computed: true },
    };
  });

  get('/api/scenarios/:scenarioId/impact', ({ params, query }) => {
    const guard = scenarioGuard();
    if (guard) return guard;
    const dec = decodeId(params.scenarioId);
    if (dec.refusal) return dec.refusal;
    const id = dec.id;
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
    const impact = corpus.scenarioEngine.impact(knownStateAt, spec, t.asOf);
    const frame = { kind: 'counterfactual', asOf: t.asOf, knowledge: 'best_known', scenarioId: spec.id };
    return {
      ...ok(impact, t.asOf, 'best_known', frame),
      meta: { ...meta(t.asOf, 'best_known', frame), sourceClass: 'synthetic:scenario', computed: true },
    };
  });

  return routes;
}

/** Corpus selection: the server's source seam, driven by environment. */
export async function selectCorpus(env = process.env) {
  const kind = env.CORPUS ?? 'synthetic';
  if (kind === 'synthetic') return loadSyntheticCorpus();
  if (kind === 'terminal') {
    const { loadTerminalCorpus } = await import('./loaders/terminal.mjs');
    return loadTerminalCorpus({ baseUrl: env.TERMINAL_URL });
  }
  throw new Error(`unknown CORPUS '${kind}' — use CORPUS=synthetic or CORPUS=terminal`);
}
