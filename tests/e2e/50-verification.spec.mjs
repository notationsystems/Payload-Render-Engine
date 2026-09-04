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
  // SEC-182: fetch the root from the MANIFEST in its own request. A proof
  // verified against the root it carries proves only self-consistency.
  // the manifest was already fetched above, in its OWN request - that is
  // exactly the independence SEC-182 requires
  const trustedRoot = manifest?.merkleRoot;
  const verdict = verifyInclusion(proof, trustedRoot);
  r.ok(verdict.ok === true, `inclusion proof for ${anyNode} verifies offline against the manifest root`);
  const tampered = { ...proof, record: { ...proof.record, name: 'Tampered Name' } };
  r.ok(verifyInclusion(tampered, trustedRoot).ok === false, 'a tampered record fails offline verification');
  r.ok(verifyInclusion(proof, undefined).ok === false, 'SEC-182 no independent root -> refused, never verified');

  return r.done();
}
