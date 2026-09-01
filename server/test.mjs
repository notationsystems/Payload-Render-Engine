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

console.log(failures ? `\n${failures} FAILURES` : '\nSPATIAL API CONTRACT TESTS CLEAN');
process.exit(failures ? 1 : 0);
