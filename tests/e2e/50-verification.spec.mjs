/** Verification envelope + inclusion proof round-trip, verified offline in-process. */
import { API, makeRecorder } from './harness.mjs';
import { verifyInclusion } from '../../scripts/verify-inclusion.mjs';

export async function run() {
  const r = makeRecorder('50-verification');

  const snap = await (await fetch(`${API}/api/snapshot`)).json();
  const v = snap?.meta?.verification;
  r.ok(v?.level === 'REPRODUCIBLE', 'snapshot answers REPRODUCIBLE');
  r.ok(
    (v?.unreachedLevels ?? []).map((u) => u.level).join(',') === 'ATTESTED,ZK_VERIFIED',
    'unreached levels stated, never simulated'
  );

  const manifest = (await (await fetch(`${API}/api/corpus/commitments`)).json())?.data;
  r.ok(/^[0-9a-f]{64}$/.test(manifest?.merkleRoot ?? ''), 'manifest carries a 64-hex merkle root');

  const anyNode = snap?.data?.nodes?.[0]?.id;
  const proof = (
    await (await fetch(`${API}/api/corpus/commitments?record=${encodeURIComponent(anyNode)}`)).json()
  )?.data;
  const verdict = verifyInclusion(proof);
  r.ok(verdict.ok === true, `inclusion proof for ${anyNode} verifies offline`);
  const tampered = { ...proof, record: { ...proof.record, name: 'Tampered Name' } };
  r.ok(verifyInclusion(tampered).ok === false, 'a tampered record fails offline verification');

  return r.done();
}
