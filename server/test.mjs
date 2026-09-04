#!/usr/bin/env node
/**
 * Spatial API contract tests: envelope shape, refusal discipline,
 * knowledge modes, projection correctness. Boots the real handlers
 * in-process (no port needed) and fails loudly on any violation.
 */

import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
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
// the deeper mirror routes share the exact posture by construction
const commsDown = await call('GET', '/api/operations/communications?operationId=op-1');
check(
  commsDown?.status === 'refused' && commsDown.refusal.kind === 'OPERATIONS_UPSTREAM_UNREACHABLE',
  'communications mirror shares the fail-closed posture'
);
const fuelDown = await call('GET', '/api/operations/fuel');
check(
  fuelDown?.status === 'refused' && fuelDown.refusal.kind === 'OPERATIONS_UPSTREAM_UNREACHABLE',
  'fuel-benchmark mirror shares the fail-closed posture'
);
const commsBadId = await call('GET', `/api/operations/communications?operationId=${encodeURIComponent('../x')}`);
check(
  commsBadId?.status === 'refused' && commsBadId.refusal.kind === 'OPERATIONS_REQUEST_INVALID',
  'malformed operationId refused before any upstream call'
);
delete process.env.PAYLOAD_OPERATIONS_TOKEN;
const commsNoAuth = await call('GET', '/api/operations/communications');
check(
  commsNoAuth?.status === 'refused' && commsNoAuth.refusal.kind === 'OPERATIONS_NOT_CONFIGURED',
  'communications mirror fail-closed without authority'
);
process.env.PAYLOAD_OPERATIONS_TOKEN = 'test-token';
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

// what-if injection + refusals queue: upstream capabilities, typed everywhere
console.log('\n— injection + refusals mirrors —');
const injSynth = await call('GET', '/api/scenarios/inject?entityId=ent:mine:escondida');
check(
  injSynth?.status === 'refused' && injSynth.refusal.kind === 'INJECTION_UNSUPPORTED_FOR_CORPUS',
  'injection on a corpus without an upstream engine → typed refusal'
);
const refSynth = await call('GET', '/api/refusals');
check(
  refSynth?.status === 'refused' && refSynth.refusal.kind === 'REFUSALS_QUEUE_UNSUPPORTED_FOR_CORPUS',
  'refusals queue on an authored corpus → typed refusal (declines nothing during a compile)'
);
const injNoEntity = await tcall('GET', '/api/scenarios/inject');
check(
  injNoEntity?.status === 'refused' && injNoEntity.refusal.kind === 'INJECTION_REQUEST_INVALID',
  'injection without an entity refused before any upstream call'
);
const injBadType = await tcall('GET', '/api/scenarios/inject?entityId=ent:mine:escondida&type=meteor');
check(
  injBadType?.status === 'refused' && /vocabulary/.test(injBadType.refusal.message),
  'event type outside the upstream vocabulary refused, vocabulary named'
);
const injBadAsOf = await tcall('GET', '/api/scenarios/inject?entityId=ent:mine:escondida&asOf=yesterday');
check(
  injBadAsOf?.status === 'refused' && /YYYY-MM-DD/.test(injBadAsOf.refusal.message),
  'malformed asOf refused before any upstream call'
);
const injBadKnow = await tcall('GET', '/api/scenarios/inject?entityId=ent:mine:escondida&knowledge=hindsight');
check(
  injBadKnow?.status === 'refused' && /as_known_then/.test(injBadKnow.refusal.remedy),
  'unknown knowledge mode refused, backtest mode named in the remedy'
);
const savedTermUrl = process.env.TERMINAL_URL;
process.env.TERMINAL_URL = 'http://127.0.0.1:1'; // nothing listens here
const injDown = await tcall('GET', '/api/scenarios/inject?entityId=ent:mine:escondida&type=strike');
check(
  injDown?.status === 'refused' && injDown.refusal.kind === 'INJECTION_UPSTREAM_UNREACHABLE',
  'unreachable engine → typed refusal, never a fabricated hypothetical'
);
const refDown = await tcall('GET', '/api/refusals?commodity=copper');
check(
  refDown?.status === 'refused' && refDown.refusal.kind === 'REFUSALS_UPSTREAM_UNREACHABLE',
  'unreachable digest → typed refusal, never an empty queue'
);
if (savedTermUrl === undefined) delete process.env.TERMINAL_URL;
else process.env.TERMINAL_URL = savedTermUrl;

// verification envelope + commitment manifest: the trust ladder, honest
console.log('\n— verification envelope + commitments —');
const { verifyInclusion } = await import('../scripts/verify-inclusion.mjs');
const vSnap = (await call('GET', '/api/snapshot'))?.meta?.verification;
check(
  vSnap?.level === 'REPRODUCIBLE' && /^[0-9a-f]{64}$/.test(vSnap?.merkleRoot ?? ''),
  'snapshot answers REPRODUCIBLE with a 64-hex merkle root'
);
check(
  vSnap?.unreachedLevels?.map((u) => u.level).join(',') === 'ATTESTED,ZK_VERIFIED' &&
    vSnap.unreachedLevels.every((u) => u.requires.length > 20),
  'unreached levels named with exactly what each requires — absent, never simulated'
);
const vState = (await call('GET', `/api/state/${encodeURIComponent('node:port-shanghai')}`))?.meta?.verification;
check(vState?.level === 'PROVENANCE', 'a plain state read answers PROVENANCE (per-record, on the data)');
const vMine = (await call('GET', '/api/mining/patterns'))?.meta?.verification;
check(vMine?.level === 'REPRODUCIBLE', 'a mining run answers REPRODUCIBLE (inputs + program fully name it)');
const manifest = (await call('GET', '/api/corpus/commitments'))?.data;
check(
  manifest?.algorithm === 'sha256-merkle/0.1' &&
    manifest.leaves === Object.values(manifest.collections).reduce((a, b) => a + b, 0),
  'manifest leaf count equals the sum of its collection counts — conservation'
);
check(/NOT ATTESTATION/.test(manifest?.note ?? ''), 'the manifest states what it is not');
const rootA = (await callA('GET', '/api/corpus/commitments'))?.data?.merkleRoot;
const rootB = (await callB('GET', '/api/corpus/commitments'))?.data?.merkleRoot;
check(!!rootA && rootA === rootB, 'same canonical state ⇒ same merkle root (two registrations)');
const tRoot = (await tcall('GET', '/api/corpus/commitments'))?.data?.merkleRoot;
check(!!tRoot && tRoot !== rootA, 'different corpora ⇒ different roots');
const proof = (await call('GET', '/api/corpus/commitments?record=node%3Aport-shanghai'))?.data;
check(!!proof?.path?.length && proof.root === manifest.merkleRoot, 'inclusion proof served with a path to the manifest root');
const verdict = verifyInclusion(proof);
check(verdict.ok === true, 'inclusion proof verifies OFFLINE (scripts/verify-inclusion.mjs)');
const tampered = { ...proof, record: { ...proof.record, name: 'Port of Somewhere Else' } };
check(verifyInclusion(tampered).ok === false, 'a tampered record FAILS offline verification');
const badRec = await call('GET', '/api/corpus/commitments?record=node%3Adoes-not-exist');
check(
  badRec?.status === 'refused' && badRec.refusal.kind === 'UNKNOWN_RECORD',
  'unknown record → typed refusal with resolution remedy'
);

// control plane: the service declaring its own ecosystem, facts only
console.log('\n— control plane topology —');
const topo = (await call('GET', '/api/system/topology'))?.data;
check(topo?.ecosystem?.id === 'payload' && Array.isArray(topo.nodes) && Array.isArray(topo.capabilities), 'topology serves the ecosystem model');
const capRoutes = (await call('GET', '/api/capabilities'))?.data?.map((r) => r.pattern) ?? [];
const declaredRoutes = topo.capabilities.flatMap((c) => c.routes);
check(
  declaredRoutes.every((route) => capRoutes.includes(route)),
  'every route a capability declares actually exists — conservation against /api/capabilities'
);
check(
  topo.capabilities.every((c) => capRoutes.includes(c.probe.split('?')[0])),
  'every probe path exists'
);
check(
  topo.capabilities.every((c) => !c.authority || typeof c.authority.present === 'boolean'),
  'authority reported as PRESENT/ABSENT only — never a value'
);
// The topology's credential posture is NOT asserted here. It used to be,
// against `process.env.PAYLOAD_OPERATIONS_TOKEN ?? <sentinel>` — a shape that
// passes vacuously whenever the variable is unset, which is every run of the
// check chain. With a real leak planted in this very handler it printed `ok`.
// A check that reports success on the failure it names is worse than no check,
// because it reads as coverage. The property is proven under SEC-013 below,
// where a canary token is injected into the environment and every served
// surface — this one included — is swept for it. SEC-155 now forbids the shape.
check(
  topo.capabilities.every((c) => c.ladder && c.ladder.dispatched !== true),
  'no capability claims dispatched=true — this backend stops at approved'
);
check(/never imply/.test(topo.ladderRule ?? ''), 'the ladder rule is stated on the model');
check(topo.cost?.status === 'ABSENT' && !!topo.cost.reason, 'cost is honestly ABSENT with its reason');
const edgeIds = new Set(topo.nodes.map((n) => n.id));
check(topo.edges.every((e) => edgeIds.has(e.from) && edgeIds.has(e.to)), 'every edge joins declared nodes');

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

// ---- security substrate: the request gate, fail-closed everywhere ----
// (docs/SECURITY.md — each check names the invariant it defends)
console.log('\n— security gate —');
const {
  guardRequest,
  hostAllowed,
  originAllowed,
  redactError,
  safeRequestLine,
  scrubSecrets,
  securityHeaders,
  RateLimiter,
  assertSafeBinding,
} = await import('./security.mjs');

const CANARY = `canary-${randomUUID()}`; // generated, never a literal (SEC-004)
const ENV = { PAYLOAD_ALLOWED_ORIGINS: 'http://localhost:5173', PAYLOAD_OPERATIONS_TOKEN: CANARY };
const gate = (over = {}) =>
  guardRequest({
    method: 'GET',
    headers: { host: '127.0.0.1:8788' },
    pathname: '/api/snapshot',
    env: ENV,
    ...over,
  });

// SEC-102 host allowlist (DNS-rebinding defence)
check(hostAllowed('127.0.0.1:8788', ENV) && hostAllowed('localhost:5173', ENV), 'SEC-102 loopback hosts allowed');
check(!hostAllowed('evil.example.com', ENV), 'SEC-102 foreign Host refused (DNS rebinding)');
check(
  gate({ headers: { host: 'attacker.test' } }).refusal?.refusal.kind === 'HOST_NOT_ALLOWED',
  'SEC-102 rebinding attempt → typed HOST_NOT_ALLOWED, before any handler'
);

// SEC-101/103 origin allowlist, never a wildcard
check(originAllowed('http://localhost:5173', ENV) === true, 'SEC-101 allowlisted origin recognised');
check(originAllowed('https://evil.example', ENV) === false, 'SEC-101 foreign origin rejected');
check(originAllowed(undefined, ENV) === null, 'SEC-101 absent Origin is not a browser cross-origin read');
{
  const cors = gate({ headers: { host: '127.0.0.1:8788', origin: 'http://localhost:5173' } }).corsHeaders;
  check(cors['Access-Control-Allow-Origin'] === 'http://localhost:5173', 'SEC-103 CORS echoes the exact allowlisted origin');
  const foreign = gate({ headers: { host: '127.0.0.1:8788', origin: 'https://evil.example' } }).corsHeaders;
  check(
    foreign['Access-Control-Allow-Origin'] === undefined,
    'SEC-103 no CORS header for a foreign origin — never a wildcard'
  );
}

// SEC-104 privileged routes fail closed on a foreign origin
check(
  gate({ pathname: '/api/operations', headers: { host: '127.0.0.1:8788', origin: 'https://evil.example' } }).refusal
    ?.refusal.kind === 'ORIGIN_NOT_ALLOWED',
  'SEC-104 privileged route refuses a foreign origin BEFORE spending authority'
);
check(
  gate({ pathname: '/api/operations', headers: { host: '127.0.0.1:8788', origin: 'http://localhost:5173' } }).refusal === null,
  'SEC-104 privileged route proceeds for an allowlisted origin'
);
check(
  gate({ pathname: '/api/snapshot', headers: { host: '127.0.0.1:8788', origin: 'https://evil.example' } }).refusal === null,
  'SEC-104 a non-privileged read is not blocked — CORS alone stops the foreign page reading it'
);

// SEC-018 read-only
check(
  gate({ method: 'POST' }).refusal?.refusal.kind === 'METHOD_NOT_ALLOWED',
  'SEC-018 POST refused at the transport layer'
);
check(gate({ method: 'OPTIONS' }).refusal === null, 'SEC-018 OPTIONS preflight allowed');

// SEC-141 secret scrubbing + SEC-140 error redaction
check(
  scrubSecrets(`upstream said ${CANARY} failed`, ENV) === 'upstream said «REDACTED» failed',
  'SEC-141 configured secrets scrubbed from text'
);
{
  const r = redactError(new Error(`connect ECONNREFUSED with token ${CANARY}`), ENV);
  check(!JSON.stringify(r.body).includes(CANARY), 'SEC-140 the response body carries no secret');
  check(!JSON.stringify(r.body).includes('ECONNREFUSED'), 'SEC-140 the response body carries no internal detail');
  check(/^[0-9a-f-]{36}$/.test(r.body.error.correlationId), 'SEC-140 the client gets a correlation id instead');
  check(!r.logLine.includes(CANARY), 'SEC-141 the server log line is scrubbed too');
}
check(
  safeRequestLine('/api/x', new URLSearchParams({ commodity: 'copper', sneaky: 'value' }), ENV) ===
    '/api/x?commodity=copper&sneaky=«dropped»',
  'SEC-141 request log keeps known-safe params and drops the rest'
);

// security headers
{
  const h = securityHeaders();
  check(h['X-Content-Type-Options'] === 'nosniff' && h['X-Frame-Options'] === 'DENY', 'security headers set nosniff + frame-deny');
  check(/default-src 'none'/.test(h['Content-Security-Policy']), 'CSP denies by default on a JSON API');
}

// SEC-150 rate limiting
{
  const rl = new RateLimiter({ local: { capacity: 2, refillPerSec: 1 }, proxied: { capacity: 1, refillPerSec: 0.1 } });
  const t = 1_000_000;
  check(rl.take('c1', 'local', t).ok && rl.take('c1', 'local', t).ok, 'SEC-150 requests inside the budget pass');
  const blocked = rl.take('c1', 'local', t);
  check(blocked.ok === false && blocked.retryAfterSec >= 1, 'SEC-150 over-budget refused with a retry hint');
  check(rl.take('c2', 'local', t).ok, 'SEC-150 the limit is per client, not global');
  check(rl.take('c1', 'local', t + 5000).ok, 'SEC-150 the bucket refills over time');
}

// safe binding: authority-holding service must not silently go world-reachable
check(assertSafeBinding('127.0.0.1', {}) === null, 'loopback binding permitted');
check(typeof assertSafeBinding('0.0.0.0', {}) === 'string', 'off-loopback binding refused without an explicit allowlist');
check(
  assertSafeBinding('0.0.0.0', { PAYLOAD_ALLOWED_HOSTS: 'twin.internal', PAYLOAD_ALLOWED_ORIGINS: 'https://twin.internal' }) === null,
  'off-loopback binding permitted once host+origin policy is explicit'
);

// SEC-013 — no credential value in any served answer (whole-surface sweep)
{
  const probeToken = `canary-${randomUUID()}`;
  const savedTok = process.env.PAYLOAD_OPERATIONS_TOKEN;
  process.env.PAYLOAD_OPERATIONS_TOKEN = probeToken;
  const surfaces = ['/api/system/topology', '/api/capabilities', '/api/health', '/api/corpus/definition'];
  let leaked = null;
  for (const s of surfaces) {
    const body = JSON.stringify(await call('GET', s));
    if (body.includes(probeToken)) leaked = s;
  }
  check(leaked === null, `SEC-013 no served surface echoes the operations credential${leaked ? ` (leaked at ${leaked})` : ''}`);
  if (savedTok === undefined) delete process.env.PAYLOAD_OPERATIONS_TOKEN;
  else process.env.PAYLOAD_OPERATIONS_TOKEN = savedTok;
}

// --------------------------------------------------------------------
// SEC-152 — the security journal and the served posture
// --------------------------------------------------------------------
console.log('\n— security posture —');
{
  const { SecurityJournal, securityPosture, safeDetail, RateLimiter } = await import('./security.mjs');

  // the journal is BOUNDED, and it counts what it dropped rather than
  // silently forgetting: an unbounded incident log is an amplifier
  const j = new SecurityJournal();
  for (let i = 0; i < 300; i += 1) j.record({ kind: 'HOST_NOT_ALLOWED', pathname: '/api/health', client: 'k', detail: `n=${i}` });
  const w = j.read(10);
  check(w.recorded === 300, 'SEC-152 the journal counts every event it was given');
  check(w.retained === w.capacity, 'SEC-152 retention is capped at the ring capacity');
  check(w.dropped === 300 - w.capacity, 'SEC-152 what fell out of the ring is counted, not forgotten');
  check(w.entries.length === 10 && w.entries[0].seq === 300, 'SEC-152 the read is bounded and newest-first');
  check(typeof w.since === 'string' && w.since.length > 0, 'SEC-152 the journal states its own window');

  // an empty journal must not read as "nothing has ever happened"
  const empty = new SecurityJournal().read();
  check(empty.recorded === 0 && typeof empty.since === 'string', 'SEC-152 an empty window is still a stated window, never a bare zero');

  // detail fields carry attacker-controlled text: bounded, control
  // characters neutralised, and never used to make a decision
  const hostile = `${String.fromCharCode(27)}[2J${'A'.repeat(400)}`;
  const safe = safeDetail(hostile, {});
  check(safe.length <= 100, 'SEC-152 a hostile detail is bounded before it is stored');
  check(!safe.includes(String.fromCharCode(27)), 'SEC-152 control characters never survive into the journal');

  // SEC-141 — a configured secret must never reach the journal either
  const canary = `canary-${randomUUID()}`;
  const scrubbed = safeDetail(`origin=${canary}`, { PAYLOAD_OPERATIONS_TOKEN: canary });
  check(!scrubbed.includes(canary), 'SEC-141 a configured secret is scrubbed out of a journal detail');

  // the posture reports presence, never a value
  const tok = `canary-${randomUUID()}`;
  const posture = securityPosture({ PAYLOAD_OPERATIONS_TOKEN: tok }, new RateLimiter());
  const serialized = JSON.stringify(posture);
  check(!serialized.includes(tok), 'SEC-013 the posture never carries a credential value');
  check(
    posture.authority.find((a) => a.id === 'operations')?.state === 'PRESENT',
    'SEC-013 the posture reports the credential as PRESENT'
  );
  check(posture.policy.wildcardCors === false, 'SEC-103 the posture reports no wildcard CORS');
  check(posture.counts.absent >= 1, 'the ledger carries at least one ABSENT row — a model with no absences is a model that is not being honest');
  check(
    posture.invariants.filter((i) => i.state !== 'ENFORCED').every((i) => typeof i.reason === 'string' && i.reason.length > 20),
    'every non-ENFORCED row carries its reason'
  );
  check(
    posture.invariants.filter((i) => i.state === 'ENFORCED').every((i) => typeof i.check === 'string'),
    'every ENFORCED row names the check that proves it'
  );

  // the served route: posture + journal in one answer
  const jj = new SecurityJournal();
  jj.record({ kind: 'ORIGIN_NOT_ALLOWED', pathname: '/api/operations', client: 'k', detail: 'origin=https://evil.example' });
  const secRoutes = await registerRoutes(null, { limiter: new RateLimiter(), journal: jj });
  const answer = await makeCall(secRoutes)('GET', '/api/security/posture');
  check(answer.status === 'ok', 'GET /api/security/posture answers');
  check(answer.data.events.recorded === 1, 'the served answer carries the live journal, not a copy');
  check(
    answer.data.events.entries[0].detail.includes('evil.example'),
    'a refused origin is shown to the operator — escaped at render, never re-read into a decision'
  );

  // a process without a journal must say so rather than imply an empty one
  const noJournal = await makeCall(await registerRoutes(null, {}))('GET', '/api/security/posture');
  check(
    noJournal.data.events.status === 'ABSENT' && typeof noJournal.data.events.reason === 'string',
    'SEC-152 a missing journal is ABSENT with a reason, never an empty list'
  );
}

// --------------------------------------------------------------------
// The apparatus register — served, and honest about what it is
// --------------------------------------------------------------------
console.log('\n— apparatus register —');
{
  const answer = await call('GET', '/api/ecosystem/register');
  check(answer.status === 'ok', 'GET /api/ecosystem/register answers');
  const d = answer.data;

  check(
    /provenance-bearing computational corpora/.test(d.organization.declares),
    'the register states what the organization does'
  );

  // A scan is not a probe, and the trust level must not claim otherwise.
  check(
    /CLAIMS are a scan/i.test(answer.meta.verification.basis) && /PRESENCE is measured/i.test(answer.meta.verification.basis),
    'the basis distinguishes the scanned claims from the probed presence — two different kinds of knowing on one surface'
  );
  check(
    answer.meta.verification.level === 'PROVENANCE',
    'the register is served at PROVENANCE — claims scanned from the trees, presence probed where probeable'
  );

  // The honesty properties, held mechanically rather than by review.
  const unbuilt = d.apparatuses.filter((a) => a.presence === 'DECLARED' || a.presence === 'SCAFFOLD');
  check(unbuilt.length >= 1, 'unbuilt apparatuses are IN the register, not omitted from it');
  check(
    unbuilt.every((a) => a.absence?.reason && a.absence?.unblockedBy),
    'every unbuilt apparatus carries its reason and what would unblock it'
  );
  // SEC-180: a row whose source lives in a PRIVATE repository may not
  // cite it, because this register is served to anonymous callers. Such
  // a row states basisWithheld instead - sourced and redacted, not
  // unsourced. Silence still fails.
  check(
    d.apparatuses.every(
      (a) =>
        (Array.isArray(a.readFrom) && a.readFrom.length > 0) ||
        (typeof a.basisWithheld === 'string' && a.basisWithheld.length > 20)
    ),
    'every apparatus row names where its claims were read, or why it cannot — a register of provenance-bearing systems may not make unsourced claims'
  );
  const withheld = d.apparatuses.filter((a) => a.basisWithheld);
  check(
    withheld.every((a) => !(a.readFrom ?? []).length),
    `a row that withholds its basis cites nothing (${withheld.length} withheld) — withholding and citing at once would mean the citation was safe after all`
  );
  check(
    d.divergences.every((x) => x.proposal && x.ownedBy),
    'every divergence carries a proposal and names who owns the decision'
  );
  check(
    d.counts.stagesUnowned.length >= 1,
    'a lifecycle stage with no built owner is reported, not smoothed over'
  );
  check(
    d.apparatuses.some((a) => a.stages.includes(d.counts.stagesUnowned[0])),
    'the unowned stage still has an apparatus row, so it cannot vanish from the map'
  );

  // Reachability is measured where it can be, and the measurement is
  // bounded: a register read must not wait on a stopped apparatus.
  check(Array.isArray(d.probing?.probed), 'the register names which apparatuses it probed');
  check(
    d.probing.timeoutMs > 0 && d.probing.timeoutMs <= 5000,
    `the probe is bounded (${d.probing?.timeoutMs}ms) — a register read never waits on a stopped apparatus`
  );
  check(
    /reachability, never whether the tree exists/i.test(d.probing.note),
    'the register states that a failed probe is about reachability, not existence'
  );
  for (const id of d.probing.probed) {
    const row = d.apparatuses.find((a) => a.id === id);
    check(
      row && (row.presence === 'OBSERVED' || row.presence === 'PRESENT'),
      `${id}: a probed apparatus lands on OBSERVED or PRESENT, never DECLARED — a stopped service is not an unbuilt one`
    );
    check(typeof row.probedAt === 'string', `${id}: the probe result says WHEN it was taken`);
  }

  // the headline must never disagree with the table under it
  check(
    d.counts.observed === d.apparatuses.filter((a) => a.presence === 'OBSERVED').length &&
      d.counts.present === d.apparatuses.filter((a) => a.presence === 'PRESENT').length,
    'the presence counts reconcile with the rows after probing'
  );

  // It is a MAP, not a mirror: no apparatus record may travel in it.
  const serialized = JSON.stringify(d);
  check(
    !/"entities"|"observations"|"loads"|"snapshot"/.test(serialized),
    'the register carries no record belonging to any apparatus — it is a map, never a mirror'
  );

  // SEC-013 still applies to a surface that names credentials by variable
  const canary = `canary-${randomUUID()}`;
  const savedTok = process.env.PAYLOAD_OPERATIONS_TOKEN;
  process.env.PAYLOAD_OPERATIONS_TOKEN = canary;
  const again = JSON.stringify(await call('GET', '/api/ecosystem/register'));
  check(!again.includes(canary), 'SEC-013 the register echoes no credential value');
  if (savedTok === undefined) delete process.env.PAYLOAD_OPERATIONS_TOKEN;
  else process.env.PAYLOAD_OPERATIONS_TOKEN = savedTok;
}

// --------------------------------------------------------------------
// The notation:// resolver — a name is not a capability
// --------------------------------------------------------------------
console.log('\n— notation resolver —');
{
  const R = (uri) => call('GET', `/api/notation/resolve?uri=${encodeURIComponent(uri)}`);

  // the space itself
  const space = await call('GET', '/api/notation/space');
  check(space.status === 'ok', 'GET /api/notation/space answers');
  check(
    space.data.counts.kinds >= 10 && space.data.counts.resolvableHere >= 1,
    'the space declares its kinds and how many this projection answers for'
  );
  check(
    space.data.counts.unheld >= 1,
    'a kind no apparatus holds is declared as such, not omitted from the space'
  );
  // the divergence as a MEASUREMENT, not an assertion
  check(
    Array.isArray(space.data.observed?.shapes) && space.data.observed.shapes.length >= 1,
    'the space reports the id shapes actually minted in the served corpus'
  );

  // forbidden kinds are refused permanently, and say so
  const cred = await R('notation://credential/ops/token');
  check(cred.status === 'refused' && cred.refusal.kind === 'NOTATION_KIND_FORBIDDEN', 'a credential URI is refused by design');
  check(
    /not an oversight|omission is the control/i.test(cred.refusal.remedy),
    'the forbidden refusal says the omission is deliberate, not a gap to be filled'
  );
  for (const k of ['session', 'agent']) {
    const out = await R(`notation://${k}/x/y`);
    check(out.status === 'refused' && out.refusal.kind === 'NOTATION_KIND_FORBIDDEN', `a ${k} URI is refused by design`);
  }

  // malformed input is refused with a remedy, never guessed at
  for (const [uri, kind] of [
    ['', 'NOTATION_URI_EMPTY'],
    ['https://evil.example/x', 'NOTATION_URI_SCHEME'],
    ['notation://nonsense/x', 'NOTATION_KIND_UNKNOWN'],
    ['notation://entity', 'NOTATION_URI_INCOMPLETE'],
    ['notation://entity/<script>alert(1)</script>', 'NOTATION_URI_SEGMENT_INVALID'],
    // a malformed address is refused, never silently rewritten: two
    // inputs that should be distinguishable must not collapse to one
    ['notation://entity//escondida', 'NOTATION_URI_EMPTY_SEGMENT'],
    ['notation://node//apparatus/x', 'NOTATION_URI_EMPTY_SEGMENT'],
  ]) {
    const out = await R(uri);
    check(out.status === 'refused' && out.refusal.kind === kind, `${kind} for ${uri || '(empty)'}`);
    check(typeof out.refusal.remedy === 'string' && out.refusal.remedy.length > 10, `${kind} carries a remedy`);
  }

  const trailing = await R('notation://node/org/notation-systems/');
  check(trailing.status === 'ok', 'one trailing slash is idiomatic and still resolves');

  // a kind held elsewhere is refused WITH the holder named — the refusal
  // is the map, and a silent miss would throw the map away
  const held = await R('notation://artifact/abc123');
  check(held.status === 'refused' && held.refusal.kind === 'NOTATION_HELD_ELSEWHERE', 'a kind held by another apparatus is refused');
  check(/ocr|Holder:/i.test(held.refusal.remedy), 'the refusal names the apparatus that holds it');

  // resolvable kinds resolve, and report which id shape answered
  const org = await R('notation://node/org/notation-systems');
  check(org.status === 'ok' && org.data.of === 'organization', 'the organization resolves');
  const app = await R('notation://node/apparatus/payload-ocr-agent');
  check(app.status === 'ok' && app.data.of === 'apparatus', 'an apparatus resolves from the register');
  const build = await R('notation://dataset/corpus/current');
  check(build.status === 'ok' && build.data.of === 'corpusBuild', 'the current corpus build resolves');

  // a well-formed name that names nothing is not an error
  const nothing = await R('notation://entity/mine/definitely-not-here');
  check(
    nothing.status === 'refused' && nothing.refusal.kind === 'NOTATION_NAMES_NOTHING',
    'a well-formed name that answers to nothing is refused, not an error'
  );
  check(
    /most of a namespace is unpopulated/i.test(nothing.refusal.remedy),
    'and the refusal says so — an empty name is the normal case, not a fault'
  );

  // A NAME IS NOT A CAPABILITY: resolution must never carry authority
  const canary = `canary-${randomUUID()}`;
  const savedTok = process.env.PAYLOAD_OPERATIONS_TOKEN;
  process.env.PAYLOAD_OPERATIONS_TOKEN = canary;
  const sweep = JSON.stringify([
    await R('notation://node/apparatus/payload-terminal'),
    await R('notation://dataset/corpus/current'),
    await call('GET', '/api/notation/space'),
  ]);
  check(!sweep.includes(canary), 'SEC-013 no resolution carries a credential value');
  if (savedTok === undefined) delete process.env.PAYLOAD_OPERATIONS_TOKEN;
  else process.env.PAYLOAD_OPERATIONS_TOKEN = savedTok;

  // SEC-105 — a URI must never be able to steer an outbound host
  const ssrf = await R('notation://source/evil.example/steal');
  check(
    ssrf.status === 'refused',
    'SEC-105 a source URI naming a host is refused — no input selects an outbound destination'
  );
}

// --------------------------------------------------------------------
// Provenance vocabulary alignment — proposed, measured, never applied
// --------------------------------------------------------------------
console.log('\n— vocabulary alignment —');
{
  const out = await call('GET', '/api/vocabulary/alignment');
  check(out.status === 'ok', 'GET /api/vocabulary/alignment answers');
  const d = out.data;

  check(d.status === 'PROPOSED', 'the alignment is marked PROPOSED, never adopted');
  check(/substrate/i.test(d.ownedBy), 'the decision is owned by the substrate, not by this surface');
  check(/nothing here is applied/i.test(d.warning), 'the surface states that nothing is relabelled');

  // three axes, and the reason they must stay separate
  check(d.axes.length === 3, 'the proposal separates origin, distance and stage');
  check(
    d.axes.every((a) => typeof a.basis === 'string' && a.basis.length > 40),
    'every axis states WHY it is an axis rather than a value on another'
  );

  // ORTHOGONAL rows are the hazard: they look like agreement
  const orth = d.alignment.filter((r) => r.relation === 'ORTHOGONAL');
  check(orth.length >= 1, 'at least one term is marked ORTHOGONAL — merging it would destroy a fact');
  check(
    orth.every((r) => /destroy|lost|discard|flatten/i.test(r.note)),
    'each orthogonal row says what merging it would cost'
  );

  // UNMAPPED rows must not quietly acquire a target
  const unmapped = d.alignment.filter((r) => r.relation === 'UNMAPPED');
  check(unmapped.length >= 1, 'a term with no counterpart is marked UNMAPPED, not force-fitted');
  check(
    unmapped.some((r) => r.term === 'representative'),
    'representative is UNMAPPED — it is a fifth idea, found by counting the corpus rather than reading a declaration'
  );

  // the measurement, which is the whole point
  check(d.impact !== null, 'the served alignment carries a migration impact');
  check(Boolean(d.measuredOver), 'the impact names the corpus build it was counted over');

  // The corpus under test may label no value provenance at all. That is
  // an ABSENCE, not a clean bill of health, and the surface must say so
  // rather than showing a table of zeroes.
  if (d.impact.status === 'ABSENT') {
    check(
      typeof d.impact.reason === 'string' && /does not label|nothing to align/i.test(d.impact.reason),
      'an unlabelled corpus is reported as ABSENT with its reason, not as zero of every label'
    );
    check(
      typeof d.impact.unblockedBy === 'string' && d.impact.unblockedBy.length > 20,
      'and the absence states what would unblock it'
    );
    check(d.impact.rows.length === 0 && d.impact.total === 0, 'an absent impact carries no invented rows');
  } else {
    check(d.measuredOver.records > 0, `the impact is counted over real records (${d.measuredOver.records})`);
    check(
      d.impact.total === d.impact.rows.reduce((n, r) => n + r.count, 0),
      'the impact total is the sum of its rows — a headline that does not reconcile is worse than none'
    );
    check(
      d.impact.renamed + d.impact.unchanged + d.impact.needsDecision === d.impact.total,
      'every counted record lands in exactly one of rename / unchanged / needs-a-decision'
    );
  }
  check(
    d.impact.needsDecision === 0 || d.impact.undecidedTerms.length > 0,
    'if records need a decision, the terms that need it are named'
  );
  check(
    typeof d.impact.verdict === 'string' && d.impact.verdict.length > 20,
    'the impact states a verdict a reviewer can act on'
  );

  // A case-insensitive lookup must not decide an AXIS. `observed` is an
  // origin in the Terminal and `OBSERVED` a pipeline stage in the OCR
  // Agent; matching loosely across them would silently assign the wrong
  // axis — the exact relabelling this alignment exists to prevent.
  {
    const { alignTerm } = await import('../shared/vocabulary.mjs');
    check(alignTerm('observed')?.axis === 'origin', 'an exact term keeps its own axis');
    check(alignTerm('OBSERVED')?.axis === 'stage', 'a differently-cased term is a DIFFERENT term with its own axis');
    const amb = alignTerm('Observed');
    check(
      amb?.relation === 'AMBIGUOUS' && amb.axis === null,
      'a loose match spanning two axes refuses rather than guessing which one was meant'
    );
    check(
      alignTerm('Observed', 'terminal')?.axis === 'origin',
      'naming the apparatus resolves the ambiguity — the caller says what they meant'
    );
  }

  // an ORTHOGONAL term must never be counted as a clean rename
  const orthRow = d.impact.rows.find((r) => r.relation === 'ORTHOGONAL');
  if (orthRow) check(orthRow.renames === false, 'an orthogonal term is never counted as a free rename');

  // the alignment must not leak into the records themselves
  const snap = await call('GET', '/api/snapshot');
  const kinds = new Set();
  for (const rec of snap.data.observations ?? []) if (rec?.provenance?.valueKind) kinds.add(rec.provenance.valueKind);
  check(
    !kinds.has('asserted'),
    'SEC-017/INV-6 the proposal is not applied to served records — a record still carries the label its apparatus gave it'
  );
}

// --------------------------------------------------------------------
// The answer envelope, swept across EVERY parameterless route
//
// Per-route assertions test the routes someone remembered to test. This
// sweeps the whole surface, so a route added later inherits the contract
// instead of quietly opting out of it. Five routes were added in one
// pass recently; that is exactly when an envelope contract drifts.
// --------------------------------------------------------------------
// --------------------------------------------------------------------
// REPRODUCIBLE CORPUS BUILDS - measured, never assumed.
//
// A serving projection is rebuildable only if a build is a pure
// function of what it was built FROM. This was not true: three builds
// of the terminal corpus a second apart produced three different merkle
// roots while having identical record counts, because `knownAt` on the
// four PROJECTED collections (nodes, routes, flows, commodities) was
// stamped from the wall clock at load. The three collections carrying
// real upstream timestamps were byte-identical throughout.
//
// The operator-facing harm was on the compiler console: it distinguishes
// REBUILT_UNCHANGED from RECORDS_MOVED by comparing roots, so rebuilding
// an unchanged corpus reported RECORDS_MOVED - a false alarm on the one
// feature whose entire job is answering "has anything changed?".
//
// One value governs it. Pinning the capture instant makes even a live
// build reproducible; the loader now prefers the instant the transport
// declares for the capture it replays over the clock.
// --------------------------------------------------------------------
console.log('\n— reproducible corpus builds —');
{
  const sig = (snap) =>
    createHash('sha256')
      .update(
        JSON.stringify(
          ['nodes', 'routes', 'flows', 'commodities', 'events', 'assertions', 'observations'].map(
            (k) => snap[k] ?? []
          )
        )
      )
      .digest('hex');

  const a = await loadTerminalCorpus({ fetchImpl: fixtureFetch });
  const b = await loadTerminalCorpus({ fetchImpl: fixtureFetch });
  check(
    sig(a.snapshot) === sig(b.snapshot),
    'two builds from one capture are byte-identical - the build is a pure function of the capture'
  );
  check(
    typeof fixtureFetch.capturedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(fixtureFetch.capturedAt),
    `the capture declares the instant it was taken (${fixtureFetch.capturedAt})`
  );

  // the instant must come FROM the capture, not be re-decided per build
  const stamped = new Set();
  for (const n of a.snapshot.nodes) if (n.provenance?.knownAt) stamped.add(n.provenance.knownAt);
  check(
    stamped.has(fixtureFetch.capturedAt),
    'projected records carry the capture instant, not the build clock'
  );

  // and an explicit override still wins, which is what lets a rebuild
  // of a historical capture reproduce that capture's build exactly
  const pinned = '2020-01-01T00:00:00.000Z';
  const c = await loadTerminalCorpus({ fetchImpl: fixtureFetch, fetchedAt: pinned });
  check(sig(c.snapshot) !== sig(a.snapshot), 'a different capture instant yields a different build - the instant is load-bearing');
  const d = await loadTerminalCorpus({ fetchImpl: fixtureFetch, fetchedAt: pinned });
  check(sig(c.snapshot) === sig(d.snapshot), 'and pinning it reproduces that build exactly');
}

console.log('\n— answer envelope, whole surface —');
{
  const { PROXIED_PREFIXES } = await import('./security.mjs');
  const swept = [];
  // A route that leaves the sweep must SAY so. This block's whole purpose is
  // that a route added later inherits the envelope contract instead of
  // quietly opting out of it - and a bare `continue` behind a floor of
  // `>= 10` was defeating precisely that. 31 routes are served, 17 reach the
  // sweep, and the floor sat 7 below the real figure: a new route under a
  // proxied prefix dropped out in silence and the check still printed
  // `ok  the sweep covers the served surface`, a message that also claimed
  // the whole surface while covering a little over half of it.
  const excluded = [];
  for (const route of routes) {
    const path = route.pattern.source
      .replace(/^\^|\$$/g, '')
      .replace(/\\\//g, '/');
    if (path.includes('(?<')) {
      excluded.push({ path, why: 'parameterised - the sweep has no id to supply' });
      continue;
    }
    if (PROXIED_PREFIXES.some((p) => path.startsWith(p))) {
      excluded.push({ path, why: "proxied - a test run must not spend an upstream's quota" });
      continue;
    }
    swept.push(path);
  }
  // Conservation, not a floor. Every served route is either swept or
  // excluded with a reason, so a route cannot leave the contract without
  // showing up on one side of this identity.
  check(
    swept.length + excluded.length === routes.length,
    `the sweep accounts for every served route (${swept.length} swept + ${excluded.length} excluded = ${routes.length})`
  );
  check(
    excluded.length > 0 && excluded.every((e) => e.why && e.why.length > 10),
    `every route left out of the sweep states why (${excluded.length}) - a silent exclusion is how a surface stops being covered`
  );

  const noVerification = [];
  const noBuild = [];
  const refusalNoRemedy = [];
  for (const path of swept) {
    const out = await call('GET', path);
    if (out.status === 'refused') {
      if (!out.refusal?.remedy || out.refusal.remedy.length < 10) refusalNoRemedy.push(path);
      continue;
    }
    if (out.status !== 'ok') continue;
    const v = out.meta?.verification;
    if (!v?.level || !v?.basis || v.basis.length < 20) noVerification.push(path);
    if (!out.meta?.corpusBuild?.id) noBuild.push(path);
  }

  check(
    noVerification.length === 0,
    `every ok answer states its verification level AND its basis${noVerification.length ? ` — missing on ${noVerification.join(', ')}` : ''}`
  );
  check(
    noBuild.length === 0,
    `every ok answer names the corpus build that produced it${noBuild.length ? ` — missing on ${noBuild.join(', ')}` : ''}`
  );
  check(
    refusalNoRemedy.length === 0,
    `every refusal carries a remedy${refusalNoRemedy.length ? ` — missing on ${refusalNoRemedy.join(', ')}` : ''}`
  );
}

// --------------------------------------------------------------------
// Every record is addressable, and every address round-trips
// --------------------------------------------------------------------
console.log('\n— addressability —');
{
  const { addressOf } = await import('../src/intel/notation.ts');
  const snap = await call('GET', '/api/snapshot');
  const records = [
    ...(snap.data.nodes ?? []),
    ...(snap.data.routes ?? []),
    ...(snap.data.flows ?? []),
  ];
  check(records.length > 0, `the corpus serves records to address (${records.length})`);

  const unaddressable = [];
  const broken = [];
  for (const rec of records) {
    const a = addressOf(rec.id);
    if (!a) {
      unaddressable.push(rec.id);
      continue;
    }
    const back = await call('GET', `/api/notation/resolve?uri=${encodeURIComponent(a.uri)}`);
    if (back.status !== 'ok' || back.data.canonicalId !== rec.id) {
      broken.push(`${rec.id} -> ${a.uri} -> ${back.data?.canonicalId ?? back.refusal?.kind}`);
    }
  }
  check(
    unaddressable.length === 0,
    `every served record has an address${unaddressable.length ? ` — ${unaddressable.slice(0, 3).join(', ')}` : ''}`
  );
  check(
    broken.length === 0,
    `every address resolves back to its own record${broken.length ? ` — ${broken.slice(0, 3).join(' · ')}` : ''}`
  );

  // the shape is reported, never smoothed over
  const shapes = new Set(records.map((r) => addressOf(r.id)?.shape).filter(Boolean));
  check(shapes.size >= 1, `the address reports which id shape it used (${[...shapes].join(', ')})`);

  // a bare token names a type and nothing else — refused, not invented
  check(addressOf('escondida') === null, 'a separator-less id is refused rather than given an invented segment');
  check(addressOf('') === null && addressOf(undefined) === null, 'empty input yields no address');
}

// --------------------------------------------------------------------
// "Has the corpus moved since I last looked?" — the four states
//
// The build id contains its own generation time, so it changes on every
// recompile and on its own says nothing. The Merkle root changes only
// when a committed record does. Distinguishing those two is the whole
// value: same root with a new id is the normal morning, and telling an
// operator otherwise sends them looking for a change that is not there.
// --------------------------------------------------------------------
console.log('\n— build delta —');
{
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  const { compareBuild, markBuildSeen } = await import('../src/core/workspace.ts');

  const A = { id: 'build-x-1111', merkleRoot: 'a'.repeat(64) };
  const A2 = { id: 'build-x-2222', merkleRoot: 'a'.repeat(64) }; // recompiled, same records
  const B = { id: 'build-x-3333', merkleRoot: 'b'.repeat(64) }; // a record moved

  check(compareBuild(A).kind === 'FIRST_SESSION', 'with no bookmark the answer is FIRST_SESSION, never "unchanged"');
  check(compareBuild(null).kind === 'FIRST_SESSION', 'an unstamped corpus yields FIRST_SESSION rather than a guess');

  markBuildSeen(A);
  check(compareBuild(A).kind === 'UNCHANGED', 'the same build reads UNCHANGED');

  const rebuilt = compareBuild(A2);
  check(
    rebuilt.kind === 'REBUILT_UNCHANGED' && rebuilt.from === A.id,
    'a new build id with the SAME root reads REBUILT_UNCHANGED — the id moves on every compile, the root only on a record'
  );

  const moved = compareBuild(B);
  check(
    moved.kind === 'RECORDS_MOVED' && moved.from === A.id,
    'a different root reads RECORDS_MOVED, and names the build it is comparing against'
  );

  // the bookmark is a bookmark: it must never carry build CONTENTS
  markBuildSeen(B);
  const raw = JSON.parse(store.get('pe.workspace/v1'));
  const keys = Object.keys(raw.lastBuild ?? {});
  check(
    keys.every((k) => ['id', 'merkleRoot', 'seenAt'].includes(k)),
    `the bookmark holds only id, root and time (${keys.join(', ')}) — two builds' contents here would make the projection a store`
  );
  check(
    !JSON.stringify(raw).includes('nodes') && !JSON.stringify(raw).includes('observations'),
    'no record travels into browser storage with the bookmark'
  );

  // a root that is missing on either side must not be read as a match
  markBuildSeen({ id: 'build-x-4444' });
  check(
    compareBuild({ id: 'build-x-5555' }).kind === 'RECORDS_MOVED',
    'without roots to compare, a changed build is reported as moved rather than assumed unchanged — the safe direction'
  );
  delete globalThis.localStorage;
}

// --------------------------------------------------------------------
// One answer to "what is this part of"
// --------------------------------------------------------------------
console.log('\n— scope —');
{
  const topo = await call('GET', '/api/system/topology');
  const reg = await call('GET', '/api/ecosystem/register');
  const eco = topo.data.ecosystem;
  check(Boolean(eco.organization), 'the control plane names the organization its program belongs to');
  check(
    eco.organization.id === reg.data.organization.id,
    `the topology and the register agree on the organization (${eco.organization.id} vs ${reg.data.organization.id})`
  );
  check(
    eco.id !== eco.organization.id,
    'the program and the organization are distinct — collapsing them answers the question at only one scale'
  );
  check(
    typeof eco.scopeNote === 'string' && /register/i.test(eco.scopeNote),
    'and the topology points at the wider frame rather than implying it is the whole ecosystem'
  );
}

console.log(failures ? `\n${failures} FAILURES` : '\nSPATIAL API CONTRACT TESTS CLEAN');
process.exit(failures ? 1 : 0);
