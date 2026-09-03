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
export const LIMB_KINDS = Object.freeze([
  'CANONICAL_PROOF',
  'VERIFIED_DERIVATION',
  'OPERATIONAL_OBSERVATION',
]);

export const LIMB_FIELDS = Object.freeze({
  CANONICAL_PROOF: 'reference',
  VERIFIED_DERIVATION: 'derivation',
  OPERATIONAL_OBSERVATION: 'observation',
});

/**
 * Typed non-success states. A view must keep these VISIBLE rather than
 * replacing them with a zero, a blank that looks complete, or green
 * health. They are answers, not gaps in one.
 */
export const NON_SUCCESS_STATES = Object.freeze([
  { id: 'UNOBSERVED', means: 'no observation exists for this subject in the corpus served' },
  { id: 'UNRESOLVED', means: 'an identity was named but could not be resolved to a record' },
  { id: 'CONFLICTING', means: 'two or more readings disagree, and every reading is retained rather than one being picked' },
  { id: 'NOT_EVIDENCED', means: 'a value is asserted somewhere upstream but carries no evidence this service can show' },
]);

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
      limb: 'CANONICAL_PROOF',
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
 * Limb 2 - a VERIFIED DERIVATION.
 *
 * The class that was missing, and whose absence made this service
 * over-claim. A mined pattern, a derived census, a ranked scenario and
 * a vocabulary measurement were all carrying the canonical limb, whose
 * own text reads: "every record in this answer belongs to the committed
 * build named above; an inclusion proof for any one of them folds to
 * proofRoot". That is FALSE for all four. A mined candidate was derived
 * FROM the build; it is not a member of it, and no inclusion proof will
 * ever be produced for it.
 *
 * The distinction is not pedantic. It is the difference between "this
 * is in the corpus" and "this is what we computed from the corpus" -
 * and a desk that cannot tell those apart cannot tell a fact from a
 * candidate, which is the whole discipline of this system.
 *
 * The root here binds the INPUTS, not the output. That is still a real
 * guarantee: given the same build and the same named method, the same
 * output follows. It is simply a different guarantee from membership.
 */
export function derivedBasis({ corpusBuildId, proofRoot, method, reproducible = true, note }) {
  if (!proofRoot) {
    return operationalBasis({
      upstream: 'this service, deriving from a corpus it did not compile',
      observedAt: new Date().toISOString(),
      limitations: [
        'NO PROOF ROOT ON THE INPUTS - the corpus this was derived from carries no commitment, so the derivation cannot be tied to a verifiable input set',
        'the method is stated and deterministic, but a derivation is only as checkable as the inputs it names',
      ],
      notCanonical:
        'a derivation whose inputs cannot be pinned is not a verified derivation; it is a reading, and is declared as one',
      unblockedBy: 'derive from a corpus compiled by this service, which stamps the commitment the derivation would cite',
    });
  }
  return {
    derivation: {
      limb: 'VERIFIED_DERIVATION',
      // derivedFrom, not canonical: this answer is not IN the dataset
      derivedFrom: `notation://dataset/corpus/${corpusBuildId}`,
      proofRoot,
      method: method ?? 'UNDECLARED',
      methodDeclared: Boolean(method),
      reproducible,
      means:
        'this answer was COMPUTED FROM the committed build named above by the stated method; it is not a record in that build and no inclusion proof exists for it. The root binds the inputs, so the same build and the same method reproduce this output.',
      notCanonical:
        'a derived value is not a member of the corpus it was derived from. Treating it as one is how a candidate becomes a fact by accident.',
    },
  };
}

/**
 * Limb 3 - an operational observation.
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
      limb: 'OPERATIONAL_OBSERVATION',
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
  const present = [
    meta?.reference ? 'CANONICAL_PROOF' : null,
    meta?.derivation ? 'VERIFIED_DERIVATION' : null,
    meta?.observation ? 'OPERATIONAL_OBSERVATION' : null,
  ].filter(Boolean);

  if (present.length > 1) {
    return {
      limb: null,
      violation: 'MULTIPLE_LIMBS',
      detail: `carries ${present.join(' AND ')} - an answer has exactly one kind`,
    };
  }
  if (present.length === 0) {
    return {
      limb: null,
      violation: 'NO_LIMB',
      detail:
        'carries none of meta.reference, meta.derivation or meta.observation - the reader cannot tell a canonical record from a derived value from a live reading',
    };
  }
  const limb = present[0];

  if (limb === 'CANONICAL_PROOF') {
    if (!meta.reference.canonical || !meta.reference.proofRoot) {
      return { limb, violation: 'CANONICAL_INCOMPLETE', detail: 'meta.reference must carry both canonical and proofRoot' };
    }
    return { limb, violation: null };
  }

  if (limb === 'VERIFIED_DERIVATION') {
    if (!meta.derivation.derivedFrom || !meta.derivation.proofRoot) {
      return { limb, violation: 'DERIVATION_INCOMPLETE', detail: 'meta.derivation must carry both derivedFrom and proofRoot' };
    }
    if (!meta.derivation.methodDeclared) {
      return {
        limb,
        violation: 'METHOD_UNDECLARED',
        detail: 'a derivation whose method is unnamed cannot be reproduced or argued with, which is the only thing that makes it verified',
      };
    }
    return { limb, violation: null };
  }

  if (meta.observation.operational !== true) {
    return { limb, violation: 'OPERATIONAL_UNFLAGGED', detail: 'meta.observation.operational must be exactly true' };
  }
  if (!meta.observation.limitationsDeclared) {
    return {
      limb,
      violation: 'LIMITATIONS_UNDECLARED',
      detail: 'an operational reading with no stated limitations reads as canonical to anyone who does not already know better',
    };
  }
  return { limb, violation: null };
}
