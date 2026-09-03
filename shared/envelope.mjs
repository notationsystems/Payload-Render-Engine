/**
 * THE TWO LIMBS — one answer, one kind, declared.
 *
 * The key invariant of this API:
 *
 *   Every ok answer carries EITHER a canonical reference and the proof
 *   root that binds it, OR an explicit declaration that it is an
 *   operational observation, with its limitations named.
 *
 * Never both. Never neither.
 *
 * Why it is a shared module rather than a convention: this service had
 * three route registries - api.mjs, live.mjs and markets.mjs - and the
 * envelope contract lived inside a closure in the first one. The other
 * two could not reach it, so markets.mjs spread ok() and then replaced
 * `meta` wholesale. The result answered `status: ok` with
 * `verification.level: PROVENANCE` and no build, no root and no
 * declaration: an answer that reads as canonical to any client that
 * checks for a verification level, while actually being a daily
 * central-bank fix with a cache age. Its limitation WAS stated - in
 * prose, in a disclaimer string. Prose is not a contract. A client
 * cannot branch on it and a checker cannot hold it.
 *
 * Each builder returns an object with exactly ONE key, so a caller
 * cannot set both limbs by spreading one result. Setting neither is
 * still possible - a caller can simply not call either - and that is
 * what the checker exists to catch, over the live surface rather than
 * by reading the source.
 */

/** The kinds an answer can be. Exhaustive, and closed. */
export const LIMB_KINDS = Object.freeze(['CANONICAL', 'OPERATIONAL']);

export const LIMB_FIELDS = Object.freeze({ CANONICAL: 'reference', OPERATIONAL: 'observation' });

/**
 * Limb 1 - a canonical answer, bound to a proof root.
 *
 * Refuses to mint the limb without a root. A canonical reference with
 * nothing to verify it against is the claim this invariant exists to
 * prevent, so an unstamped corpus does not get a downgraded canonical
 * limb - it gets the operational limb instead, which is the truth.
 */
export function canonicalBasis({ corpusBuildId, proofRoot, verifyWith }) {
  if (!proofRoot) {
    return operationalBasis({
      upstream: 'this service, over a corpus it did not compile',
      observedAt: new Date().toISOString(),
      limitations: [
        'NO PROOF ROOT — this corpus carries no commitment manifest, so no record in this answer can be verified offline',
        'the answer is a faithful read of what was loaded, and nothing binds what was loaded to what was authored',
      ],
      notCanonical:
        'a canonical reference with no root to verify it against is exactly the claim this envelope refuses to make, so the answer is declared operational rather than given a weaker canonical limb',
      unblockedBy:
        'load a corpus compiled by this service (CORPUS=terminal), which stamps a merkle commitment the answer can name',
    });
  }
  return {
    reference: {
      limb: 'CANONICAL',
      // the dataset this answer was drawn from, in the one identity space
      canonical: `notation://dataset/corpus/${corpusBuildId}`,
      proofRoot,
      verifyWith:
        verifyWith ?? 'GET /api/corpus/commitments?record=<id> — returns an inclusion proof that folds to proofRoot offline',
      means:
        'every record in this answer belongs to the committed build named above; an inclusion proof for any one of them folds to proofRoot without trusting this service',
    },
  };
}

/**
 * Limb 2 - an operational observation.
 *
 * `limitations` is required and must be non-empty: an operational
 * answer whose limitations are unstated is indistinguishable from a
 * canonical one to a reader, which is the whole failure mode. A caller
 * that has nothing to say here has not thought about what the reading
 * cannot support.
 */
export function operationalBasis({
  upstream,
  observedAt,
  limitations,
  notCanonical,
  cacheState,
  ageMs,
  unblockedBy,
}) {
  const stated = (limitations ?? []).filter((l) => typeof l === 'string' && l.trim().length > 0);
  return {
    observation: {
      limb: 'OPERATIONAL',
      operational: true,
      upstream: upstream ?? 'UNDECLARED',
      observedAt: observedAt ?? null,
      // absence of a limitation list is itself reported, never defaulted
      // to an empty array that would read as "no limitations"
      limitations: stated.length
        ? stated
        : ['LIMITATIONS UNDECLARED — this reading states no limitations, which is a defect in the route, not a claim that it has none'],
      limitationsDeclared: stated.length > 0,
      notCanonical:
        notCanonical ??
        'a reading taken at a moment from a source this service does not own; it is not canonical state and carries no proof root',
      ...(cacheState !== undefined ? { cacheState } : {}),
      ...(ageMs !== undefined ? { ageMs } : {}),
      ...(unblockedBy ? { unblockedBy } : {}),
    },
  };
}

/**
 * Which limb an envelope carries. Returns the violation rather than
 * throwing: the checker needs to report every offender in one pass,
 * and a route that took down a surface to prove a point about
 * envelopes would be a worse defect than the one it caught.
 */
export function limbOf(meta) {
  const hasRef = Boolean(meta?.reference);
  const hasObs = Boolean(meta?.observation);
  if (hasRef && hasObs) {
    return {
      limb: null,
      violation: 'BOTH_LIMBS',
      detail: 'carries meta.reference AND meta.observation - an operational reading declared canonical',
    };
  }
  if (!hasRef && !hasObs) {
    return {
      limb: null,
      violation: 'NEITHER_LIMB',
      detail: 'carries neither meta.reference nor meta.observation - the reader cannot tell a canonical answer from a live reading',
    };
  }
  if (hasRef) {
    if (!meta.reference.canonical || !meta.reference.proofRoot) {
      return {
        limb: 'CANONICAL',
        violation: 'CANONICAL_INCOMPLETE',
        detail: 'meta.reference must carry both canonical and proofRoot',
      };
    }
    return { limb: 'CANONICAL', violation: null };
  }
  if (meta.observation.operational !== true) {
    return { limb: 'OPERATIONAL', violation: 'OPERATIONAL_UNFLAGGED', detail: 'meta.observation.operational must be exactly true' };
  }
  if (!meta.observation.limitationsDeclared) {
    return {
      limb: 'OPERATIONAL',
      violation: 'LIMITATIONS_UNDECLARED',
      detail: 'an operational reading with no stated limitations reads as canonical to anyone who does not already know better',
    };
  }
  return { limb: 'OPERATIONAL', violation: null };
}
