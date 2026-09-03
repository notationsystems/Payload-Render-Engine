/**
 * Offline inclusion-proof verifier — trust math, not the service.
 *
 * Takes the JSON served by GET /api/corpus/commitments?record=<id>
 * (either the whole {status,data,meta} envelope or just its data) and
 * verifies, WITHOUT contacting anything:
 *
 *   1. the leaf hash recomputes from the record content
 *      (sha256(`${collection}:${id}` + "\n" + JSON.stringify(record)))
 *   2. folding the inclusion path reproduces the claimed Merkle root
 *
 * A pass proves the record belongs to the build that published this
 * root — tamper-evidence. It does NOT prove the record is true, and
 * it does NOT prove when the root was made: those are provenance and
 * (future) attestation questions, and this tool says so.
 *
 *   usage: node scripts/verify-inclusion.mjs <proof.json>
 *          curl -s '<api>/api/corpus/commitments?record=<id>' | node scripts/verify-inclusion.mjs
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/**
 * @param {object} doc  the proof (the route's data object)
 * @returns {{ ok: boolean, reason: string, recomputedLeaf: string, recomputedRoot: string }}
 */
export function verifyInclusion(doc) {
  const { record, collection, leaf, path, root, algorithm } = doc ?? {};
  if (algorithm !== 'sha256-merkle/0.1') {
    return { ok: false, reason: `unknown algorithm '${algorithm}' — this verifier speaks sha256-merkle/0.1`, recomputedLeaf: '', recomputedRoot: '' };
  }
  if (!record?.id || !collection || !Array.isArray(path) || !root) {
    return { ok: false, reason: 'proof is missing record/collection/path/root', recomputedLeaf: '', recomputedRoot: '' };
  }
  const recomputedLeaf = sha256(`${collection}:${record.id}\n${JSON.stringify(record)}`);
  if (leaf && leaf !== recomputedLeaf) {
    return { ok: false, reason: 'leaf does not recompute from the record content — the record was altered', recomputedLeaf, recomputedRoot: '' };
  }
  let h = recomputedLeaf;
  for (const step of path) {
    if (step.side !== 'left' && step.side !== 'right') {
      return { ok: false, reason: `malformed path step side '${step.side}'`, recomputedLeaf, recomputedRoot: '' };
    }
    h = step.side === 'left' ? sha256(step.hash + h) : sha256(h + step.hash);
  }
  if (h !== root) {
    return { ok: false, reason: 'folded path does not reproduce the claimed root — proof or root is wrong', recomputedLeaf, recomputedRoot: h };
  }
  return {
    ok: true,
    reason:
      'record is committed in this root. This proves MEMBERSHIP in the build, not truth of the record (provenance) and not when the root was made (attestation — absent until the corpus platform signs roots)',
    recomputedLeaf,
    recomputedRoot: h,
  };
}

// ------------------------------------------------------------- CLI
const invokedDirectly = process.argv[1]?.endsWith('verify-inclusion.mjs');
if (invokedDirectly) {
  const input = process.argv[2]
    ? readFileSync(process.argv[2], 'utf8')
    : readFileSync(0, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch {
    console.error('FAIL input is not JSON');
    process.exit(2);
  }
  const doc = parsed?.data ?? parsed; // accept the whole envelope or just data
  const v = verifyInclusion(doc);
  console.log(`${v.ok ? 'VERIFIED' : 'FAIL'} ${doc?.collection ?? '?'}:${doc?.record?.id ?? '?'}`);
  console.log(`  leaf ${v.recomputedLeaf || '—'}`);
  console.log(`  root ${v.recomputedRoot || '—'}`);
  console.log(`  ${v.reason}`);
  process.exit(v.ok ? 0 : 1);
}
