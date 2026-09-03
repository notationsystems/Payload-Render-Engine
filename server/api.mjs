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
  // ---- commitment manifest: tamper-evidence, not attestation --------
  // Per-record commitments folded into one Merkle root, so a third
  // party holding ONE record + its inclusion path can verify it
  // belongs to THIS build without seeing the rest of the corpus.
  // What this does NOT do — and says so: binding the root to a time
  // or an identity requires a signature the corpus platform will hold;
  // no signing capability exists in this projection service.
  const COMMIT_ALGORITHM = 'sha256-merkle/0.1';
  const sha256 = (s) => createHash('sha256').update(s).digest('hex');
  const leafHash = (collection, rec) => sha256(`${collection}:${rec.id}\n${JSON.stringify(rec)}`);
  const COMMIT_COLLECTIONS = ['nodes', 'routes', 'flows', 'commodities', 'events', 'assertions', 'observations'];
  const commitLeaves = [];
  const commitIndex = new Map(); // record id → { index, collection, record }
  for (const collection of COMMIT_COLLECTIONS) {
    for (const rec of snapshot[collection] ?? []) {
      if (!commitIndex.has(rec.id)) {
        commitIndex.set(rec.id, { index: commitLeaves.length, collection, record: rec });
      }
      commitLeaves.push(leafHash(collection, rec));
    }
  }
  // levels bottom-up; an odd node is promoted unchanged (documented in
  // the manifest so external verifiers fold the same way)
  const commitLevels = [commitLeaves];
  while (commitLevels.at(-1).length > 1) {
    const prev = commitLevels.at(-1);
    const next = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push(i + 1 < prev.length ? sha256(prev[i] + prev[i + 1]) : prev[i]);
    }
    commitLevels.push(next);
  }
  const merkleRoot = commitLevels.at(-1)[0] ?? sha256('empty-corpus');
  const inclusionPath = (index) => {
    const path = [];
    let i = index;
    for (let lvl = 0; lvl < commitLevels.length - 1; lvl++) {
      const layer = commitLevels[lvl];
      const sib = i ^ 1;
      if (sib < layer.length) path.push({ side: sib < i ? 'left' : 'right', hash: layer[sib] });
      i = Math.floor(i / 2);
    }
    return path;
  };

  const corpusBuild = {
    id: `build-${corpus.kind}-${canonicalStateFingerprint.slice(0, 8)}`,
    canonicalStateFingerprint,
    schemaVersion: SCHEMA_VERSION,
    compilerVersion: `${corpus.kind}-loader/0.1`,
    generatedAt: snapshot.meta.generatedAt,
    merkleRoot,
    commitment: { algorithm: COMMIT_ALGORITHM, leaves: commitLeaves.length },
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
  // ---- verification envelope: the trust ladder, worn per answer -----
  // PROVENANCE ⊂ REPRODUCIBLE ⊂ ATTESTED ⊂ ZK_VERIFIED. Every answer
  // states the level it has EARNED and exactly what the unreached
  // levels require — absent capability is stated, never simulated.
  const UNREACHED = Object.freeze([
    {
      level: 'ATTESTED',
      requires:
        'a signature over the build root by a key the corpus platform holds — no signing capability exists in this projection service',
    },
    {
      level: 'ZK_VERIFIED',
      requires:
        'an SP1/zkVM execution layer proving the computation against committed inputs — corpus-platform work, not begun',
    },
  ]);
  const verification = (level, basis, extra = {}) => ({
    level,
    basis,
    ...extra,
    unreachedLevels: UNREACHED,
  });
  /** REPRODUCIBLE: inputs + program + versions fully name the result. */
  const reproducible = (basis, extra = {}) =>
    verification('REPRODUCIBLE', basis, {
      merkleRoot,
      canonicalStateFingerprint,
      ...extra,
    });

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
    // default trust level: per-record provenance travels on the data;
    // routes whose result is fully named by inputs+program override
    // this with REPRODUCIBLE
    verification: verification(
      'PROVENANCE',
      'per-record provenance (source, knownAt, valueKind, admissibility) travels on the records themselves'
    ),
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

  // ---- control plane: this service declaring its OWN ecosystem -------
  // Payload is the first deeply modeled node. The shape served here is
  // the adapter contract: a future ecosystem seeds the same nodes /
  // edges / capabilities / dataDomains and plugs into the same control
  // plane. Facts only — authority is reported as PRESENT/ABSENT, never
  // a value; hosts are the ones fixed in code; every capability names
  // the probe the client uses to measure its health and latency; and
  // the action ladder stops where this backend stops: nothing here
  // dispatches, and the model says so per capability.
  get('/api/system/topology', () => {
    const upstreamBase = process.env.TERMINAL_URL ?? 'http://127.0.0.1:3000';
    const present = (name) => !!process.env[name]?.trim();
    const observeOnly = { observed: true, proposed: false, approved: false, dispatched: false, note: 'read-only projection — this capability never proposes, approves, or dispatches' };
    const nodes = [
      { id: 'spatial-api', kind: 'service', label: 'Payload Spatial API', role: 'projection service — read-only over canonical state', url: null },
      { id: 'corpus', kind: 'store', label: `corpus · ${corpus.kind}`, role: 'canonical snapshot + build (fingerprint, merkle root)', url: null },
      { id: 'terminal', kind: 'upstream', label: 'Payload Terminal', role: 'economy projections · scenario engine · refusals digest · freight desk', url: upstreamBase },
      { id: 'src-comtrade', kind: 'source', label: 'UN Comtrade (preview)', role: 'trade flows, via the Terminal', url: null },
      { id: 'src-fmcsa', kind: 'source', label: 'FMCSA QCMobile', role: 'carrier authority, via the Terminal', url: null },
      { id: 'src-eia', kind: 'source', label: 'EIA weekly diesel', role: 'fuel benchmark, via the Terminal', url: null },
      { id: 'src-adsb', kind: 'source', label: 'adsb.lol', role: 'live aircraft', url: 'https://api.adsb.lol' },
      { id: 'src-celestrak', kind: 'source', label: 'CelesTrak', role: 'satellite TLEs', url: 'https://celestrak.org' },
      { id: 'src-usgs', kind: 'source', label: 'USGS', role: 'live seismic', url: 'https://earthquake.usgs.gov' },
      { id: 'src-firms', kind: 'source', label: 'NASA FIRMS', role: 'active fires', url: 'https://firms.modaps.eosdis.nasa.gov' },
      { id: 'src-frankfurter', kind: 'source', label: 'frankfurter', role: 'FX reference rates', url: 'https://api.frankfurter.dev' },
      { id: 'src-coinbase', kind: 'source', label: 'Coinbase Exchange', role: 'crypto spot', url: 'https://api.exchange.coinbase.com' },
      { id: 'src-deribit', kind: 'source', label: 'Deribit', role: 'crypto derivatives', url: 'https://www.deribit.com' },
      { id: 'ibkr', kind: 'upstream', label: 'IBKR Client Portal gateway', role: 'broker session (fail-closed)', url: process.env.IBKR_GATEWAY_URL ? 'configured' : null },
    ];
    const edges = [
      { from: 'spatial-api', to: 'corpus', relation: 'projects' },
      { from: 'corpus', to: 'terminal', relation: 'loaded-from', when: corpus.kind === 'terminal' ? 'active' : 'inactive (synthetic corpus loaded)' },
      { from: 'terminal', to: 'src-comtrade', relation: 'ingests' },
      { from: 'terminal', to: 'src-fmcsa', relation: 'pulls' },
      { from: 'terminal', to: 'src-eia', relation: 'pulls' },
      { from: 'spatial-api', to: 'terminal', relation: 'mirrors + forwards (operations, injection, refusals)' },
      { from: 'spatial-api', to: 'src-adsb', relation: 'proxies' },
      { from: 'spatial-api', to: 'src-celestrak', relation: 'proxies' },
      { from: 'spatial-api', to: 'src-usgs', relation: 'proxies' },
      { from: 'spatial-api', to: 'src-firms', relation: 'proxies' },
      { from: 'spatial-api', to: 'src-frankfurter', relation: 'proxies' },
      { from: 'spatial-api', to: 'src-coinbase', relation: 'proxies' },
      { from: 'spatial-api', to: 'src-deribit', relation: 'proxies' },
      { from: 'spatial-api', to: 'ibkr', relation: 'brokers (fail-closed)' },
    ];
    const capabilities = [
      { id: 'corpus.read', family: 'ENTITIES', label: 'corpus snapshot + state reads', node: 'spatial-api', routes: ['/api/snapshot', '/api/entities', '/api/state/:entityId', '/api/states', '/api/search'], probe: '/api/health', provenance: corpus.metaDefaults?.sourceClass ?? 'unknown', ladder: observeOnly, dataDomains: ['facilities', 'routes', 'flows', 'commodities', 'events', 'observations'], instrument: 'compiler' },
      { id: 'corpus.commitments', family: 'EVIDENCE', label: 'commitment manifest + inclusion proofs', node: 'spatial-api', routes: ['/api/corpus/commitments'], probe: '/api/corpus/commitments', provenance: 'content-addressed', ladder: observeOnly, dataDomains: ['build'], instrument: 'compiler' },
      { id: 'corpus.definition', family: 'EVIDENCE', label: 'corpus definition', node: 'spatial-api', routes: ['/api/corpus/definition'], probe: '/api/corpus/definition', provenance: 'declared + derived', ladder: observeOnly, dataDomains: ['ontology'], instrument: 'corpus' },
      { id: 'mining', family: 'INTELLIGENCE', label: 'payload miner (served run)', node: 'spatial-api', routes: ['/api/mining/patterns'], probe: '/api/mining/patterns', provenance: 'MINED candidates', ladder: observeOnly, dataDomains: ['patterns'], instrument: 'patterns' },
      { id: 'scenarios.local', family: 'INTELLIGENCE', label: 'in-process counterfactuals', node: 'spatial-api', routes: ['/api/scenarios', '/api/scenarios/rank', '/api/scenarios/:scenarioId/impact'], probe: '/api/scenarios', provenance: 'COMPUTED, hypothetical', ladder: { observed: true, proposed: true, approved: false, dispatched: false, note: 'a frame is a proposal to think, never to act — nothing is approved or dispatched' }, dataDomains: ['scenarios'], instrument: 'scenarios' },
      { id: 'scenarios.inject', family: 'INTELLIGENCE', label: 'what-if injection (upstream engine)', node: 'terminal', routes: ['/api/scenarios/inject'], probe: '/api/scenarios/inject', provenance: 'terminal:counterfactual', ladder: { observed: true, proposed: true, approved: false, dispatched: false, note: 'computed upstream and returned — nothing is approved or dispatched' }, dataDomains: ['scenarios'], instrument: 'scenarios' },
      { id: 'refusals', family: 'EVIDENCE', label: 'refused:* work queue', node: 'terminal', routes: ['/api/refusals'], probe: '/api/refusals?commodity=copper', provenance: 'terminal:refusals', ladder: observeOnly, dataDomains: ['refusals'], instrument: 'refusals' },
      { id: 'operations', family: 'OPERATIONS', label: 'brokerage control tower (mirror)', node: 'terminal', routes: ['/api/operations', '/api/operations/communications', '/api/operations/fuel'], probe: '/api/operations', provenance: 'terminal:operations', authority: { required: 'PAYLOAD_OPERATIONS_TOKEN', present: present('PAYLOAD_OPERATIONS_TOKEN') }, ladder: { observed: true, proposed: 'from journal', approved: 'from journal', dispatched: 'from journal', note: 'the desk proposes and authorizes IN THE TERMINAL; this mirror reads the journal — a cell lights only from a recorded fact' }, dataDomains: ['loads', 'carriers', 'communications'], instrument: 'operations' },
      { id: 'live', family: 'LIVE', label: 'live feeds (aircraft · satellites · seismic · fires)', node: 'spatial-api', routes: ['/api/live/aircraft', '/api/live/satellites', '/api/live/quakes', '/api/live/fires'], probe: '/api/live/quakes', provenance: 'external:observed', ladder: observeOnly, dataDomains: ['contacts', 'hazards'], instrument: 'layers' },
      { id: 'markets', family: 'MARKETS', label: 'FX · crypto · derivatives desks', node: 'spatial-api', routes: ['/api/markets/fx', '/api/markets/crypto', '/api/markets/derivatives'], probe: '/api/markets/fx', provenance: 'external:reported', ladder: observeOnly, dataDomains: ['prices'], instrument: 'markets' },
      { id: 'markets.broker', family: 'MARKETS', label: 'broker session (IBKR)', node: 'ibkr', routes: ['/api/markets/broker'], probe: '/api/markets/broker', provenance: 'broker:session', authority: { required: 'IBKR_GATEWAY_URL', present: present('IBKR_GATEWAY_URL') }, ladder: { observed: true, proposed: false, approved: false, dispatched: false, note: 'no order path exists in this service — observe only, fail-closed' }, dataDomains: ['positions'], instrument: 'markets' },
    ];
    return ok({
      ecosystem: { id: 'payload', label: 'Payload — physical economy', firstNode: 'spatial-api' },
      ladderRule: 'observed → proposed → approved → dispatched: a cell lights only from a recorded fact; this backend stops at approved — nothing here dispatches, and the UI must never imply it did',
      nodes,
      edges,
      capabilities,
      cost: { status: 'ABSENT', reason: 'no cost meter exists in this projection service — corpus-platform work' },
    });
  });

  get('/api/snapshot', ({ query }) => {
    const t = resolveAsOf(query);
    if (t.refusal) return t.refusal;
    const k = resolveKnowledge(query);
    if (k.refusal) return k.refusal;
    const env = ok(snapshotWithBuild, t.asOf, k.knowledge);
    env.meta.verification = reproducible(
      'content-addressed: the canonical-state fingerprint and Merkle root fully name this snapshot'
    );
    return env;
  });

  // ---- commitment manifest + per-record inclusion proofs ------------
  // GET /api/corpus/commitments            → the manifest
  // GET /api/corpus/commitments?record=<id> → an inclusion proof a
  // third party can verify OFFLINE (scripts/verify-inclusion.mjs)
  // without trusting this service.
  get('/api/corpus/commitments', ({ query }) => {
    const recordId = query.get('record');
    if (recordId === null) {
      const byCollection = {};
      for (const col of COMMIT_COLLECTIONS) byCollection[col] = (snapshot[col] ?? []).length;
      const env = ok({
        algorithm: COMMIT_ALGORITHM,
        merkleRoot,
        leaves: commitLeaves.length,
        collections: byCollection,
        leafRule: 'sha256(`${collection}:${id}` + "\\n" + JSON.stringify(record)); odd nodes promote unchanged',
        note: 'COMMITMENT, NOT ATTESTATION — the root binds records to this build; binding the build to a time or an identity requires a signature the corpus platform will hold, and none exists here',
      });
      env.meta.verification = reproducible('the manifest is a pure function of canonical state');
      return env;
    }
    const entry = commitIndex.get(recordId);
    if (!entry) {
      return refuse(
        'UNKNOWN_RECORD',
        `no canonical record '${recordId}' in this build's commitment manifest`,
        'GET /api/search?q=<name> resolves ids; the manifest covers nodes, routes, flows, commodities, events, assertions, observations'
      );
    }
    const env = ok({
      record: entry.record,
      collection: entry.collection,
      index: entry.index,
      leaf: commitLeaves[entry.index],
      path: inclusionPath(entry.index),
      root: merkleRoot,
      algorithm: COMMIT_ALGORITHM,
      verify:
        'recompute the leaf from the record content, fold the path, compare the root — scripts/verify-inclusion.mjs does this offline, without trusting this service',
    });
    env.meta.verification = reproducible('an inclusion proof is verifiable by construction');
    return env;
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
    const env = ok(miningResult);
    env.meta.verification = reproducible(
      'algorithm@version + parameters + the corpus build fully name this run — a re-run reproduces identical candidates'
    );
    return env;
  });

  // ---- the refused:* work queue, mirrored. Everything the UPSTREAM
  // declined to answer while building its state, grouped by refusal
  // mechanism with the mechanism's ONE shared remedy, ranked by how
  // often it blocked an answer — a work order, and the most honest
  // artifact a corpus can publish about itself.
  get('/api/refusals', async ({ query }) => {
    if (corpus.kind !== 'terminal') {
      return refuse(
        'REFUSALS_QUEUE_UNSUPPORTED_FOR_CORPUS',
        `corpus '${corpus.kind}' keeps no upstream refusal queue — an authored corpus declines nothing during a compile`,
        'load the terminal corpus (CORPUS=terminal); its upstream keeps the refused:* digest'
      );
    }
    const commodity = query.get('commodity') ?? 'copper';
    if (!/^[a-z][a-z-]{0,31}$/.test(commodity)) {
      return refuse('REFUSALS_REQUEST_INVALID', 'commodity must be a lowercase slug (e.g. copper, aluminium)', 'pass the commodity slug the corpus lists');
    }
    const upstreamBase = process.env.TERMINAL_URL ?? 'http://127.0.0.1:3000';
    let res;
    try {
      res = await fetch(`${upstreamBase}/api/economy/refusals?commodity=${encodeURIComponent(commodity)}`, {
        headers: { Accept: 'application/json' },
      });
    } catch (err) {
      return refuse(
        'REFUSALS_UPSTREAM_UNREACHABLE',
        `the Terminal at ${upstreamBase} did not answer: ${err?.message ?? err}`,
        'start payload-terminal-v0 (TERMINAL_URL); the refusal digest lives there'
      );
    }
    let body;
    try {
      body = await res.json();
    } catch {
      return refuse('REFUSALS_UPSTREAM_UNREADABLE', `the Terminal answered HTTP ${res.status} without readable JSON`, 'check the Terminal deployment');
    }
    if (!res.ok || body?.error) {
      return refuse('REFUSALS_REFUSED_UPSTREAM', body?.error ?? `the digest answered HTTP ${res.status}`, 'check commodity against the upstream vocabulary');
    }
    if (!Array.isArray(body?.byType)) {
      return refuse('REFUSALS_UPSTREAM_UNREADABLE', 'the Terminal answered without a byType digest', 'check the Terminal version; this route speaks the refusals contract');
    }
    return {
      ...ok(body),
      meta: {
        ...meta(RANGE.now, 'best_known'),
        // computed upstream over upstream state — not this build
        corpusBuild: undefined,
        sourceClass: 'terminal:refusals',
        valueKind: 'per_record',
        admissible: null,
        admissibleBasis: 'refusal_digest',
        upstream: `${upstreamBase}/api/economy/refusals`,
        disclaimer:
          "the refused:* work queue — everything the upstream DECLINED to answer, each group one mechanism with one shared remedy; absence of an answer, stated, never silently dropped",
      },
    };
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
    const env = ok({
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
          '{status, data, meta} — meta carries basis, knownAt, admissibility, attribution, corpusBuild, verification',
        refusals:
          'typed SCREAMING_SNAKE refusals with remedies at HTTP 200; 404 reserved for capabilities that do not exist',
        knowledgeModes: corpus.knowledgeModes,
        schemaVersion: SCHEMA_VERSION,
      },
    });
    env.meta.verification = reproducible('declared rules + a derived census — a pure function of the loader and canonical state');
    return env;
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
  /** Authorized upstream GET, shared by every mirror route: the
   *  fail-closed credential posture and the typed refusal mapping are
   *  the SAME for all of them by construction. */
  const opsUpstream = async (path) => {
    const upstreamBase = process.env.TERMINAL_URL ?? 'http://127.0.0.1:3000';
    const token = process.env.PAYLOAD_OPERATIONS_TOKEN;
    if (!token?.trim()) {
      return {
        refusal: refuse(
          'OPERATIONS_NOT_CONFIGURED',
          'this spatial API holds no operations authority — the mirror is fail-closed',
          'set PAYLOAD_OPERATIONS_TOKEN (and TERMINAL_URL) in the spatial API server environment; the credential never reaches the browser'
        ),
      };
    }
    let res;
    try {
      res = await fetch(`${upstreamBase}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
    } catch (err) {
      return {
        refusal: refuse(
          'OPERATIONS_UPSTREAM_UNREACHABLE',
          `the Terminal at ${upstreamBase} did not answer: ${err?.message ?? err}`,
          'start payload-terminal-v0 (TERMINAL_URL) with its operations journals mounted'
        ),
      };
    }
    let body;
    try {
      body = await res.json();
    } catch {
      return {
        refusal: refuse(
          'OPERATIONS_UPSTREAM_UNREADABLE',
          `the Terminal answered HTTP ${res.status} without readable JSON`,
          'check the Terminal deployment; the mirror never renders a desk it cannot read'
        ),
      };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        refusal: refuse(
          'OPERATIONS_UNAUTHORIZED',
          body?.detail ?? "the Terminal refused this mirror's operations authority",
          body?.remedy ?? 'align PAYLOAD_OPERATIONS_TOKEN between the spatial API and the Terminal'
        ),
      };
    }
    if (body?.error === 'operations_not_configured') {
      return {
        refusal: refuse(
          'OPERATIONS_NOT_CONFIGURED',
          body.detail ?? 'upstream operations are fail-closed',
          body.remedy ?? 'configure the Terminal operations token'
        ),
      };
    }
    return { res, body, upstream: `${upstreamBase}${path}` };
  };

  /** Mirror meta: a live journal projection, not the loaded corpus — say so. */
  const opsMeta = (asOf, upstream, disclaimer) => ({
    ...meta(asOf, 'best_known'),
    sourceClass: 'terminal:operations',
    valueKind: 'per_record',
    admissible: null,
    admissibleBasis: 'journal_projection',
    readOnlyMirror: true,
    upstream,
    disclaimer,
  });

  get('/api/operations', async () => {
    const u = await opsUpstream('/api/freight/control-tower');
    if (u.refusal) return u.refusal;
    const body = u.body;
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
      meta: opsMeta(
        body.asOf,
        u.upstream,
        'READ-ONLY MIRROR of the Terminal brokerage control tower — a projection over append-only operation journals; commands execute only in the Terminal desk'
      ),
    };
  });

  // carrier communications journal, mirrored read-only: dispatch
  // attempts (provider, receipt, typed failure), acknowledgement, and
  // carrier events carrying the full temporal trio (occurredAt /
  // knownAt / recordedAt) — the message-level truth under the tower's
  // per-load state chips
  get('/api/operations/communications', async ({ query }) => {
    const operationId = query.get('operationId');
    if (operationId !== null && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(operationId)) {
      return refuse(
        'OPERATIONS_REQUEST_INVALID',
        'operationId must be a bounded internal identifier',
        'pass the operationId exactly as the control tower lists it'
      );
    }
    const u = await opsUpstream(
      `/api/freight/communications${operationId ? `?operationId=${encodeURIComponent(operationId)}` : ''}`
    );
    if (u.refusal) return u.refusal;
    const body = u.body;
    if (body?.kind === 'refusal') {
      return refuse(body.code ?? 'COMMUNICATIONS_REFUSED', body.detail ?? 'the communications journal refused', body.remedy ?? 'see the Terminal operations runbook');
    }
    if (!Array.isArray(body?.communications) && !body?.envelope) {
      return refuse(
        'OPERATIONS_UPSTREAM_UNREADABLE',
        'the Terminal answered with neither a communications list nor a communication snapshot',
        'check the Terminal version; this mirror speaks the communications contract'
      );
    }
    return {
      ...ok(body),
      meta: opsMeta(
        RANGE.now,
        u.upstream,
        'READ-ONLY MIRROR of the carrier communications journal — dispatches and event capture execute only in the Terminal desk'
      ),
    };
  });

  // authoritative diesel benchmark (EIA weekly U.S. on-highway), the
  // desk reference the twin can honestly request without operator
  // input; carrier-authority pulls need usdot+carrierId from an
  // operator and stay in the Terminal desk
  get('/api/operations/fuel', async () => {
    const u = await opsUpstream('/api/freight/sources?includeDiesel=1');
    if (u.refusal) return u.refusal;
    const fuel = u.body?.fuel;
    if (!fuel) {
      return refuse(
        'OPERATIONS_UPSTREAM_UNREADABLE',
        'the sources surface answered without a fuel section',
        'check the Terminal version; this mirror speaks the freight-sources contract'
      );
    }
    if (fuel.kind === 'refusal') {
      // an unconfigured or failed source pull passes through typed —
      // the benchmark is absent WITH ITS REASON, never a stale number
      return refuse(fuel.code ?? 'SOURCE_REFUSED', fuel.detail ?? 'the diesel benchmark pull refused', fuel.remedy ?? 'configure the EIA credentials in the Terminal environment');
    }
    if (fuel.kind !== 'diesel_benchmark_observation') {
      return refuse(
        'OPERATIONS_UPSTREAM_UNREADABLE',
        `the sources surface answered kind '${fuel.kind}' — not a diesel benchmark observation`,
        'check the Terminal version; this mirror speaks the freight-sources contract'
      );
    }
    return {
      ...ok({ retrievedAt: u.body.retrievedAt, fuel }),
      meta: opsMeta(
        RANGE.now,
        u.upstream,
        'READ-ONLY MIRROR of an authoritative source pull — EIA weekly U.S. retail on-highway diesel benchmark, attribution attached'
      ),
    };
  });

  // live-feed proxy (gods-eye-view substrate) — corpus-independent
  registerLiveRoutes(get, { ok, refuse, meta });

  // markets proxy (trading-desk substrate) — corpus-independent
  registerMarketRoutes(get, { ok, refuse, meta });

  get('/api/scenarios', () => scenarioGuard() ?? ok(scenarios));

  // ---- terminal counterfactuals: what-if injection through the
  // UPSTREAM scenario engine (POST /api/economy/scenario). The answer
  // is computed upstream over upstream state — it is NOT a projection
  // of this service's corpus build, so it carries no corpusBuild
  // (same doctrine as live/market answers). The upstream frame kind
  // 'counterfactual' + knowledge mode ride through untouched: a
  // hypothetical can never be read as a reconstruction.
  const INJECT_TYPES = new Set(['outage', 'strike', 'closure', 'expansion', 'disruption', 'weather', 'policy', 'demand_surge', 'sanction', 'insolvency']);
  const INJECT_SEVERITIES = new Set(['low', 'medium', 'high']);
  get('/api/scenarios/inject', async ({ query }) => {
    if (corpus.kind !== 'terminal') {
      return refuse(
        'INJECTION_UNSUPPORTED_FOR_CORPUS',
        `corpus '${corpus.kind}' has no upstream counterfactual engine — its scenarios run in-process`,
        "use the in-process catalog (/api/scenarios) on this corpus; injection is the Terminal corpus's capability"
      );
    }
    const entityId = query.get('entityId');
    if (!entityId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(entityId)) {
      return refuse('INJECTION_REQUEST_INVALID', 'entityId is required (a bounded upstream id, e.g. ent:mine:escondida)', 'pass the entity id exactly as the corpus carries it');
    }
    const type = query.get('type') ?? 'closure';
    if (!INJECT_TYPES.has(type)) {
      return refuse('INJECTION_REQUEST_INVALID', `event type '${type}' is not in the upstream vocabulary`, `use one of: ${[...INJECT_TYPES].join(', ')}`);
    }
    const severity = query.get('severity') ?? 'high';
    if (!INJECT_SEVERITIES.has(severity)) {
      return refuse('INJECTION_REQUEST_INVALID', `severity '${severity}' is not in the upstream vocabulary`, 'use low, medium, or high');
    }
    const commodity = query.get('commodity') ?? 'copper';
    if (!/^[a-z][a-z-]{0,31}$/.test(commodity)) {
      return refuse('INJECTION_REQUEST_INVALID', 'commodity must be a lowercase slug (e.g. copper, aluminium)', 'pass the commodity slug the corpus lists');
    }
    // the backtest lens: evaluate AS OF a date, optionally with only
    // what was knowable then (as_known_then) — the upstream engine's
    // own epistemic controls, passed through validated, never invented
    const asOf = query.get('asOf');
    if (asOf !== null && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      return refuse('INJECTION_REQUEST_INVALID', 'asOf must be YYYY-MM-DD', 'pass a calendar date, or omit for the latest upstream state');
    }
    const knowledge = query.get('knowledge') ?? 'best_known';
    if (knowledge !== 'best_known' && knowledge !== 'as_known_then') {
      return refuse('INJECTION_REQUEST_INVALID', `knowledge '${knowledge}' is not a mode`, 'use best_known, or as_known_then for the backtest (only what was knowable on asOf)');
    }
    const upstreamBase = process.env.TERMINAL_URL ?? 'http://127.0.0.1:3000';
    const title = `${severity} ${type} at ${entityId} (what-if)`;
    let res;
    try {
      res = await fetch(`${upstreamBase}/api/economy/scenario`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          commodity,
          label: title,
          ...(asOf ? { asOf } : {}),
          knowledge,
          events: [
            // the event starts on the evaluation date so the window
            // covers it — a backtest injects into ITS present
            { entityId, type, title, start: asOf ?? RANGE.now.slice(0, 10), severity },
          ],
        }),
      });
    } catch (err) {
      return refuse(
        'INJECTION_UPSTREAM_UNREACHABLE',
        `the Terminal at ${upstreamBase} did not answer: ${err?.message ?? err}`,
        'start payload-terminal-v0 (TERMINAL_URL); the scenario engine runs there'
      );
    }
    let body;
    try {
      body = await res.json();
    } catch {
      return refuse('INJECTION_UPSTREAM_UNREADABLE', `the Terminal answered HTTP ${res.status} without readable JSON`, 'check the Terminal deployment');
    }
    if (!res.ok || body?.error) {
      return refuse(
        'INJECTION_REFUSED_UPSTREAM',
        body?.error ?? `the scenario engine answered HTTP ${res.status}`,
        'the upstream vocabulary decides — check entity id and commodity against the loaded corpus'
      );
    }
    if (body?.counterfactualFrame?.kind !== 'counterfactual') {
      return refuse(
        'INJECTION_UPSTREAM_UNREADABLE',
        'the Terminal answered without a counterfactual frame — refusing to serve an unframed hypothetical',
        'check the Terminal version; this route speaks the scenario contract'
      );
    }
    return {
      ...ok(body),
      meta: {
        ...meta(RANGE.now, body.counterfactualFrame.knowledge ?? 'best_known', body.counterfactualFrame),
        // computed upstream over upstream state — NOT this build
        corpusBuild: undefined,
        sourceClass: 'terminal:counterfactual',
        valueKind: 'computed',
        admissible: false,
        admissibleBasis: 'hypothetical_frame',
        upstream: `${upstreamBase}/api/economy/scenario`,
        disclaimer:
          'HYPOTHETICAL — computed by the Terminal scenario engine (frame kind counterfactual). A simulated outcome is not an outcome.',
      },
    };
  });

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
