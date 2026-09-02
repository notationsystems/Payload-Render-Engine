#!/usr/bin/env node
/**
 * Spatial API contract tests: envelope shape, refusal discipline,
 * knowledge modes, projection correctness. Boots the real handlers
 * in-process (no port needed) and fails loudly on any violation.
 */

import { registerRoutes } from './api.mjs';
import { loadTerminalCorpus, fixtureFetch } from './loaders/terminal.mjs';

const routes = await registerRoutes();
const makeCall = (rs) => (method, path) => {
  const url = new URL(path, 'http://test');
  for (const r of rs) {
    const m = r.pattern.exec(url.pathname);
    if (m && r.method === method) return r.handler({ params: m.groups ?? {}, query: url.searchParams });
  }
  return null;
};
const call = makeCall(routes);

let failures = 0;
const check = (cond, what) => {
  if (cond) console.log('  ok', what);
  else {
    failures++;
    console.error('  FAIL', what);
  }
};

// health + envelope
const health = call('GET', '/api/health');
check(health?.status === 'ok', 'health ok');
check(health?.meta?.admissible === false, 'meta.admissible is false for synthetic corpus');
check(health?.meta?.sourceClass === 'synthetic:demo', 'meta.sourceClass carried');
check(typeof health?.meta?.disclaimer === 'string', 'meta.disclaimer carried');
check(health?.meta?.valueKind === 'representative', 'meta.valueKind representative (Terminal admissibility switch)');
check(health?.meta?.admissibleBasis === 'rests_on_representative', 'admissibility basis stated');
check(health?.meta?.frame?.kind === 'reconstruction', 'EvaluationFrame reconstruction on plain reads');
check(health?.meta?.attribution?.service === 'payload-earth-spatial-api', 'attribution fingerprint carried');
check(health?.data?.counts?.nodes > 100, `corpus counts sane (${health?.data?.counts?.nodes} nodes)`);

// snapshot + knowledge modes
const snap = call('GET', '/api/snapshot?knowledge=as_known_then');
check(snap?.status === 'ok' && snap?.meta?.knowledge === 'as_known_then', 'as_known_then accepted and echoed');
check(snap?.meta?.vintages === 1, 'single-vintage honesty in meta');
const badKnow = call('GET', '/api/snapshot?knowledge=psychic');
check(badKnow?.status === 'refused' && badKnow?.refusal?.remedy, 'unknown knowledge mode → typed refusal with remedy');

// refusal discipline: out-of-range time
const oor = call('GET', '/api/state/node:port-rotterdam?t=2031-01-01T00:00:00Z');
check(oor?.status === 'refused' && oor?.refusal?.kind === 'OUTSIDE_KNOWLEDGE_RANGE', 'out-of-range asOf refused (SCREAMING_SNAKE code)');
check(/remedy|ingest|within/.test(oor?.refusal?.remedy ?? ''), 'refusal carries a remedy');

// unknown entity
const unk = call('GET', '/api/state/node:atlantis');
check(unk?.status === 'refused' && unk?.refusal?.kind === 'UNKNOWN_ENTITY' && (unk?.httpStatus ?? 200) === 200, 'unknown entity → HTTP-200 typed refusal (unanswerable is not a protocol error)');

// state projection matches the shared resolver's determinism
const s1 = call('GET', '/api/state/node:port-rotterdam?t=2026-08-25T00:00:00Z');
const s2 = call('GET', '/api/state/node:port-rotterdam?t=2026-08-25T00:00:00Z');
check(s1?.data?.reading === 'known', 'state responses are three-valued readings (known)');
check(
  s1?.status === 'ok' && JSON.stringify(s1.data) === JSON.stringify(s2.data),
  'stateAt deterministic across calls'
);
check(s1?.data?.state?.utilization >= 0 && s1?.data?.state?.utilization <= 1, 'state utilization in [0,1]');

// batch partial failure
const batch = call('GET', '/api/states?ids=node:port-rotterdam,node:nowhere&t=2026-08-25T00:00:00Z');
check(batch?.status === 'ok' && batch.data.states.length === 1 && batch.data.unknown[0] === 'node:nowhere', 'batch states: per-item outcomes, no all-or-nothing');
check(batch.data.examined === batch.data.resolved + batch.data.unreadable.length + batch.data.refused, 'conservation: examined = resolved + unreadable + refused');
check(Array.isArray(batch.data.unreadable), 'unknown id ≠ known entity without a reading (separate buckets)');

// viewport query
const box = call('GET', '/api/entities?bbox=-10,40,10,60&kinds=port');
check(box?.status === 'ok' && box.data.nodes.length >= 3 && box.data.nodes.every((n) => n.kind === 'port'), `viewport query filters (NW-Europe ports: ${box?.data?.nodes?.length})`);

// search
const sr = call('GET', '/api/search?q=rotterdam');
check(sr?.status === 'ok' && sr.data.some((h) => h.id === 'node:port-rotterdam'), 'search resolves Rotterdam');
const shortQ = call('GET', '/api/search?q=a');
check(shortQ?.status === 'refused', 'too-short query refused, not empty-array-as-answer');

// deviations: promise vs evidence
const dev = call('GET', '/api/deviations/route:sea-shanghai-la');
check(dev?.status === 'ok' && dev.data[0]?.deviation?.n >= 3, `deviations join promises to evidence (n=${dev?.data?.[0]?.deviation?.n})`);
const nodev = call('GET', '/api/deviations/node:city-toronto');
check(nodev?.status === 'refused' && nodev?.refusal?.kind === 'NO_ASSERTIONS', 'no promises → typed refusal, not empty data');

// scenarios: computed intelligence labeling
const rank = call('GET', '/api/scenarios/rank');
check(rank?.status === 'ok' && rank.meta.sourceClass === 'synthetic:scenario' && rank.meta.computed === true, 'ranking labeled computed synthetic:scenario');
check(rank.meta.frame?.kind === 'counterfactual', 'ranking evaluated in a counterfactual frame');
check(rank.data.length >= 10 && rank.data[0].score >= rank.data[1].score, `ranking sorted (${rank?.data?.length} frames)`);
const impact = call('GET', `/api/scenarios/${encodeURIComponent(rank.data[0].specId)}/impact`);
check(impact?.status === 'ok' && impact.data.deltas.length > 0, `top frame impact computes (${impact?.data?.deltas?.length} deltas)`);

// ────────────────────────────────────────────────────────────────────
// Terminal-projections corpus: the same routes over a projected corpus
// with per-record admissibility (fixture-backed: real captured bytes
// from a live payload-terminal-v0 — see fixtures/terminal/capture.json)
// ────────────────────────────────────────────────────────────────────
console.log('\n— terminal-projections corpus —');

const CAPTURED_AT = '2026-09-01T00:26:00Z';
const tCorpus = await loadTerminalCorpus({ fetchImpl: fixtureFetch, fetchedAt: CAPTURED_AT });
const tRoutes = await registerRoutes(tCorpus);
const tcall = makeCall(tRoutes);

// corpus identity + envelope posture
const th = tcall('GET', '/api/health');
check(th?.data?.corpusKind === 'terminal', 'health names the terminal corpus');
check(th?.meta?.admissible === null, 'corpus-level admissible is null for a mixed corpus (not a fact, not defaulted)');
check(th?.meta?.admissibleBasis === 'earned_per_record', 'admissibility basis: earned per record');
check(th?.meta?.valueKind === 'per_record', 'no blanket valueKind — the switch lives on records');
check(th?.meta?.attribution?.upstream?.service === 'payload-terminal-v0', 'attribution names the upstream service');
check(th?.data?.mappingReport?.excluded?.length > 0, `exclusions are accounted, never silent (${th?.data?.mappingReport?.excluded?.length} excluded)`);
check(th?.data?.mappingReport?.excluded?.every((e) => e.id && e.reason), 'every exclusion carries id + reason');

// the point of the loader: admissibility EARNED per record
const tsnap = tcall('GET', '/api/snapshot');
const obs = tsnap?.data?.observations ?? [];
const repObs = obs.find((o) => o.provenance.valueKind === 'representative');
const repoObs = obs.find((o) => o.provenance.valueKind === 'reported');
check(repObs?.provenance.admissible === false, 'representative observation → inadmissible (Terminal rule, per record)');
check(repoObs?.provenance.admissible === true, 'reported observation → admissible (earned, per record)');
check(obs.every((o) => o.provenance.admissible !== undefined && o.provenance.valueKind), 'every observation evaluated — no unstamped numbers on the wire');
check(tsnap?.data?.assertions?.length === 0, 'no promises upstream → honestly empty assertions');
check(tsnap?.data?.routes?.every((r) => r.geometryBasis === 'great_circle_estimate'), 'projected route geometry says what it IS (great_circle_estimate)');
check(tsnap?.data?.routes?.every((r) => r.estimatedDurationHours === undefined && r.utilization === undefined), 'no fabricated promises: duration/utilization absent, not zero');

// three-valued readings with real teeth
const tr1 = tcall('GET', '/api/state/ent:mine:escondida');
check(tr1?.status === 'ok' && tr1.data.reading === 'unobserved' && tr1.data.state === undefined, 'observed entity, unmeasured state channel → unobserved, no state object');
const tr2 = tcall('GET', '/api/state/nuc-fr-gravelines');
check(tr2?.status === 'ok' && tr2.data.reading === 'no_history', 'entity with no evidence → no_history (a different nothing)');
const tb = tcall('GET', '/api/states?ids=ent:mine:escondida,nuc-fr-gravelines,node:atlantis');
check(
  tb?.data?.states.length === 0 && tb.data.unreadable.length === 2 && tb.data.unknown.length === 1,
  'batch: no fabricated states; unreadable and unknown kept distinct'
);
check(tb.data.examined === tb.data.resolved + tb.data.unreadable.length + tb.data.refused, 'terminal batch conservation holds');

// no counterfactual baseline → typed refusal, not an empty catalog
const tsc = tcall('GET', '/api/scenarios');
check(tsc?.status === 'refused' && tsc.refusal.kind === 'COUNTERFACTUALS_UNSUPPORTED_FOR_CORPUS', 'scenarios refuse on a corpus without a baseline');
const tdev = tcall('GET', '/api/deviations/ent:mine:escondida');
check(tdev?.status === 'refused' && tdev.refusal.kind === 'NO_ASSERTIONS', 'deviations refuse without promises to test');

// determinism of the projection
const tCorpus2 = await loadTerminalCorpus({ fetchImpl: fixtureFetch, fetchedAt: CAPTURED_AT });
check(
  JSON.stringify(tCorpus2.snapshot) === JSON.stringify(tCorpus.snapshot),
  'loader is a pure projection: same capture → byte-identical snapshot'
);

// referential integrity of the mapped graph
const nid = new Set(tsnap.data.nodes.map((n) => n.id));
check(tsnap.data.flows.every((f) => nid.has(f.originId) && nid.has(f.destinationId)), 'no dangling flow endpoints in the mapped graph');

// review regressions ------------------------------------------------------
// (1) observation ids are unique — the Terminal reuses record ids ACROSS
// commodity tables; the loader namespaces them so 31 real records survive
check(new Set(obs.map((o) => o.id)).size === obs.length, `observation ids unique after commodity namespacing (${obs.length})`);
check(obs.every((o) => o.provenance.evidence.some((e) => e.startsWith('upstream_record:'))), 'upstream record ids preserved in evidence');
// (2) timeRange honors VALID time, not just transaction time
const earliestValid = Math.min(...obs.map((o) => Date.parse(o.t)).filter(Number.isFinite));
check(Date.parse(tsnap.data.timeRange.start) <= earliestValid, 'timeRange.start covers earliest valid-time observation');
const oldT = tcall('GET', `/api/state/${encodeURIComponent('ent:mine:escondida')}?t=${encodeURIComponent(new Date(earliestValid).toISOString())}`);
check(oldT?.status === 'ok', 'an instant the corpus describes is answerable, not refused');
// (3) flows are stamped (loader curation class, stated), events are NOT
// (upstream emits no class — absent means not evaluated, never fabricated)
check(tsnap.data.flows.every((f) => f.provenance.valueKind === 'estimated' && f.provenance.admissible === true), 'flows stamped estimated (loader curation, stated in evidence)');
check(tsnap.data.events.every((e) => e.provenance.valueKind === undefined && e.provenance.admissible === undefined), 'events carry NO fabricated evidence class');
// (4) minted routes say derived, not reported
check(tsnap.data.routes.every((r) => r.provenance.valueKind === 'derived'), 'loader-minted routes stamped derived');
// (5) event affects refs resolve or are recorded — nothing dangles silently
const allIds = new Set([...tsnap.data.nodes, ...tsnap.data.routes, ...tsnap.data.flows].map((x) => x.id));
check(tsnap.data.events.every((e) => e.affects.every((id) => allIds.has(id))), 'event affects refs all resolve in the mapped graph');
check(Array.isArray(th.data.mappingReport.unresolvedRefs), 'unresolved refs are recorded in the mapping report');
// (6) as_known_then honestly refused for a single unreplayable capture
const akt = tcall('GET', '/api/snapshot?knowledge=as_known_then');
check(akt?.status === 'refused' && akt.refusal.kind === 'KNOWLEDGE_MODE_UNSUPPORTED_FOR_CORPUS', 'as_known_then refused, never silently aliased to best_known');
check(th.meta.vintages === 1, 'vintages travels with the corpus metaDefaults');
// (7) upstream reconciliation on the record
check(th.data.mappingReport.upstreamReconciliation?.length === 2, 'upstream declared-vs-delivered reconciliation recorded per commodity');

// operations mirror: fail-closed without authority, typed either way
console.log('\n— operations mirror —');
const savedToken = process.env.PAYLOAD_OPERATIONS_TOKEN;
const savedUrl = process.env.TERMINAL_URL;
delete process.env.PAYLOAD_OPERATIONS_TOKEN;
const opsNoAuth = await call('GET', '/api/operations');
check(
  opsNoAuth?.status === 'refused' && opsNoAuth.refusal.kind === 'OPERATIONS_NOT_CONFIGURED',
  'no operations authority → fail-closed typed refusal'
);
check(/never reaches the browser/.test(opsNoAuth?.refusal?.remedy ?? ''), 'remedy states the credential posture');
process.env.PAYLOAD_OPERATIONS_TOKEN = 'test-token';
process.env.TERMINAL_URL = 'http://127.0.0.1:1'; // nothing listens here
const opsDown = await call('GET', '/api/operations');
check(
  opsDown?.status === 'refused' && opsDown.refusal.kind === 'OPERATIONS_UPSTREAM_UNREACHABLE',
  'unreachable Terminal → typed refusal, never an empty desk'
);
if (savedToken === undefined) delete process.env.PAYLOAD_OPERATIONS_TOKEN;
else process.env.PAYLOAD_OPERATIONS_TOKEN = savedToken;
if (savedUrl === undefined) delete process.env.TERMINAL_URL;
else process.env.TERMINAL_URL = savedUrl;

// corpus-build identity: every corpus-derived answer names its build
console.log('\n— corpus build identity —');
const snapEnv = await call('GET', '/api/snapshot');
const cb = snapEnv?.meta?.corpusBuild;
check(
  !!cb && /^[0-9a-f]{16}$/.test(cb.canonicalStateFingerprint),
  'corpus answers carry corpusBuild with a 16-hex canonical-state fingerprint'
);
check(
  !!cb && cb.id.includes(cb.canonicalStateFingerprint.slice(0, 8)),
  'build id embeds the fingerprint prefix'
);
check(
  snapEnv?.data?.meta?.corpusBuild?.canonicalStateFingerprint === cb?.canonicalStateFingerprint,
  'the snapshot itself carries the same build (renderers can display it)'
);
// determinism: the SAME canonical state fingerprints identically —
// registering routes twice over one corpus object must agree
const { loadSyntheticCorpus: loadSynth } = await import('./loaders/synthetic.mjs');
const sameCorpus = await loadSynth();
const callA = makeCall(await registerRoutes(sameCorpus));
const callB = makeCall(await registerRoutes(sameCorpus));
const fpA = (await callA('GET', '/api/snapshot'))?.meta?.corpusBuild?.canonicalStateFingerprint;
const fpB = (await callB('GET', '/api/snapshot'))?.meta?.corpusBuild?.canonicalStateFingerprint;
check(!!fpA && fpA === fpB, 'same canonical state ⇒ same fingerprint (two registrations)');
// and DIFFERENT canonical state must not collide
const tFp = (await tcall('GET', '/api/snapshot'))?.meta?.corpusBuild?.canonicalStateFingerprint;
check(!!tFp && tFp !== fpA, 'different corpora ⇒ different fingerprints (terminal vs synthetic)');

// mining served as a capability: candidates with full lineage, never facts
console.log('\n— payload miner (served) —');
const mineEnv = await call('GET', '/api/mining/patterns');
check(mineEnv?.status === 'ok' && Array.isArray(mineEnv.data?.patterns), 'mining route serves the standard envelope');
const mBuild = mineEnv?.meta?.corpusBuild?.id;
check(
  !!mBuild && mineEnv.data.run?.corpusBuildId === mBuild,
  'the run is stamped with the same corpus build the envelope carries'
);
check(
  mineEnv.data.patterns.every((p) => p.corpusBuildId === mBuild && p.miningRunId === mineEnv.data.run.miningRunId),
  'every pattern carries the run + build lineage'
);
check(
  mineEnv.data.patterns.every((p) => p.validationStatus === 'candidate' && p.supportingRecords.length > 0),
  "every pattern is a supported CANDIDATE — this service never promotes"
);
check(
  mineEnv.data.run?.algorithms?.every((a) => a.name && a.version),
  'the run names every algorithm with its version'
);
// determinism: two registrations over the same corpus mine identically
// (compare patterns — run.generatedAt is wall-clock by design)
const minA = (await callA('GET', '/api/mining/patterns'))?.data?.patterns;
const minB = (await callB('GET', '/api/mining/patterns'))?.data?.patterns;
check(
  !!minA && JSON.stringify(minA) === JSON.stringify(minB),
  'same corpus build ⇒ identical patterns (two registrations)'
);
const capPatterns = (await call('GET', '/api/capabilities'))?.data ?? [];
check(
  capPatterns.some((r) => String(r.pattern).includes('/api/mining/patterns')),
  'capabilities listing names the mining route'
);

// corpus definition: the corpus as a manufactured, self-describing artifact
console.log('\n— corpus definition —');
const defEnv = await call('GET', '/api/corpus/definition');
const def = defEnv?.data;
check(defEnv?.status === 'ok' && !!def?.ontology?.name, 'definition served with a declared ontology');
check(
  Array.isArray(def?.source_registry) && def.source_registry.every((s) => s.id && s.class && s.description),
  'source registry names every source with its class'
);
check(
  !!def?.extraction_rules?.basis && !!def?.resolution_rules?.basis && !!def?.validation_rules?.admissibility,
  'extraction, resolution, and validation rules declared'
);
check(
  def?.entity_types?.basis === 'derived_from_snapshot' &&
    Object.values(def.entity_types.nodeKinds).reduce((a, b) => a + b, 0) ===
      (await call('GET', '/api/snapshot'))?.data?.nodes?.length,
  'entity-type census is DERIVED and sums to the served snapshot'
);
check(
  def?.mining_programs?.programs?.length === 3 &&
    def.mining_programs.programs.every((p) => p.name && p.version),
  'mining programs come from the registered-algorithm registry'
);
check(
  def?.access_policy?.status === 'ABSENT' && /DataPolicy/.test(def?.access_policy?.reason ?? ''),
  'access policy is honestly ABSENT with its reason — never invented'
);
check(
  !!def?.publication_contract?.envelope && Array.isArray(def?.publication_contract?.knowledgeModes),
  'publication contract states the envelope and knowledge modes'
);
const tDef = (await tcall('GET', '/api/corpus/definition'))?.data;
check(
  tDef?.extraction_rules?.basis === 'explicit_field_mapping' &&
    def?.extraction_rules?.basis === 'authored',
  'the two loaders declare DIFFERENT extraction rules — definitions describe, not decorate'
);

// broker seam: fail-closed without a gateway, credential posture stated
console.log('\n— markets broker seam —');
const savedGw = process.env.IBKR_GATEWAY_URL;
delete process.env.IBKR_GATEWAY_URL;
const brokerNoGw = await call('GET', '/api/markets/broker');
check(
  brokerNoGw?.status === 'refused' && brokerNoGw.refusal.kind === 'BROKER_NOT_CONFIGURED',
  'no IB gateway configured → fail-closed typed refusal'
);
check(
  /never in this service or the browser/.test(brokerNoGw?.refusal?.remedy ?? ''),
  'remedy states the credential posture'
);
process.env.IBKR_GATEWAY_URL = 'http://127.0.0.1:1'; // nothing listens here
const brokerDown = await call('GET', '/api/markets/broker');
check(
  brokerDown?.status === 'refused' && brokerDown.refusal.kind === 'BROKER_UNREACHABLE',
  'unreachable gateway → typed refusal, never a fabricated session'
);
if (savedGw === undefined) delete process.env.IBKR_GATEWAY_URL;
else process.env.IBKR_GATEWAY_URL = savedGw;

// malformed inputs are refused, never 500s or silent zeros
const badId = tcall('GET', '/api/state/%ZZ');
check(badId?.status === 'refused' && badId.refusal.kind === 'UNPARSEABLE_ID', 'invalid percent-encoding → typed refusal, not a crash');
const badBox = tcall('GET', '/api/entities?bbox=1,2,3,');
check(badBox?.status === 'refused' && badBox.refusal.kind === 'UNPARSEABLE_BBOX', "bbox with empty component refused (Number('') must not read as 0)");

console.log(failures ? `\n${failures} FAILURES` : '\nSPATIAL API CONTRACT TESTS CLEAN');
process.exit(failures ? 1 : 0);
