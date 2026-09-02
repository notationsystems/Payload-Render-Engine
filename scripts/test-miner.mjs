/**
 * Unit contract for the shared Payload Miner (shared/miner.mjs) on a
 * CONSTRUCTED snapshot. The live corpora honestly exercise only the
 * articulation miner (top-origin shares sit at 8–11% against the 50%
 * bar; every route carries one declared flow), so concentration and
 * corridor code paths are proven here — never tuned into firing on
 * real data. Runs in plain node as part of `npm run check`.
 */

import { runMiner } from '../shared/miner.mjs';

let failed = 0;
const check = (ok, label) => {
  console.log(`  ${ok ? 'ok ' : 'FAIL'} ${label}`);
  if (!ok) failed = 1;
};

const node = (id, name, kind = 'port') => ({
  id,
  name,
  kind,
  geometry: { type: 'Point', coordinates: [0, 0] },
});
const route = (id, name, originId, destinationId) => ({ id, name, originId, destinationId });
const flow = (id, commodityId, originId, routeIds) => ({
  id,
  commodityId,
  originId,
  segments: routeIds.map((routeId) => ({ routeId })),
});

// A: dominant origin of c1 (3 of 4 flows); H: cut vertex of the star
// A–H, H–B, H–C; r1: corridor carrying 5 of the 6 declared flows.
const snap = {
  meta: { corpusBuild: { id: 'build-unit-test' } },
  commodities: [
    { id: 'c1', name: 'Copper' },
    { id: 'c2', name: 'Bauxite' },
  ],
  nodes: [node('A', 'Mine A', 'mine'), node('B', 'Plant B'), node('C', 'Plant C'), node('H', 'Hub H')],
  routes: [route('r1', 'A–H lane', 'A', 'H'), route('r2', 'H–B lane', 'H', 'B'), route('r3', 'H–C lane', 'H', 'C')],
  flows: [
    flow('f1', 'c1', 'A', ['r1']),
    flow('f2', 'c1', 'A', ['r1']),
    flow('f3', 'c1', 'A', ['r1']),
    flow('f4', 'c1', 'B', ['r2']),
    flow('f5', 'c2', 'A', ['r1']),
    flow('f6', 'c2', 'C', ['r1']),
  ],
};

console.log('— payload miner unit contract —');
const a = runMiner(snap);
const b = runMiner(snap);
const byType = (t) => a.patterns.filter((p) => p.patternType === t);
const conc = byType('SUPPLY_CONCENTRATION');
const artic = byType('STRUCTURAL_ARTICULATION');
const corr = byType('SHARED_CORRIDOR');

check(conc.length === 1, 'one concentration candidate (c1: 3/4 from A; c2 below min-flows)');
check(conc[0]?.score === 0.75 && conc[0]?.entities[0] === 'A', 'concentration score 0.75, entity A');
check(conc[0]?.supportingRecords.length === 4, 'concentration supported by all 4 c1 flows');
check(/declared/.test(conc[0]?.statement ?? ''), 'statement hedged as declared');
check(
  artic.length === 1 && artic[0].entities[0] === 'H' && artic[0].score === 1,
  'one articulation candidate: H (undeclared → score 1)'
);
check(
  corr.length === 1 && corr[0].routes[0] === 'r1' && corr[0].supportingRecords.length === 5,
  'one corridor candidate: r1 with 5 of 6 flows'
);
check(Math.abs(corr[0]?.score - 5 / 6) < 1e-9, 'corridor score = 5/6');
check(JSON.stringify(a.patterns) === JSON.stringify(b.patterns), 'deterministic across runs');
check(
  a.patterns.every((p) => p.corpusBuildId === 'build-unit-test' && p.validationStatus === 'candidate'),
  'all candidates stamped with build + candidate status'
);
check(
  runMiner({ ...snap, meta: {} }).patterns.every((p) => p.corpusBuildId === 'unstamped-corpus'),
  "an unstamped corpus is labeled 'unstamped-corpus', never guessed"
);

if (failed) {
  console.error('MINER UNIT CONTRACT FAILED');
  process.exit(1);
}
console.log('MINER UNIT CONTRACT CLEAN');
