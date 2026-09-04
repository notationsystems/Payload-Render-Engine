/**
 * THE COMMITMENT LEAF RULE - one definition.
 *
 * SEC-181 asserted that no leaf preimage can be confused with an
 * internal node. The assertion REBUILT the preimage format inline
 * instead of calling the function under test, so changing the real
 * leafHash would have left the check green - the exact defect class the
 * check exists to catch, in the check itself. Caught by an adversarial
 * audit of my own work.
 *
 * The format now lives here and nowhere else: the commitment builder
 * calls it, and the test calls the same function, so a change to the
 * rule is visible to both.
 */

import { createHash } from 'node:crypto';

export const COMMIT_ALGORITHM = 'sha256-merkle/0.1';

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/**
 * A leaf's preimage. Exported separately from the hash so a test can
 * inspect the SHAPE, which is what the domain separation depends on.
 */
export function leafPreimage(collection, rec) {
  return `${collection}:${rec.id}\n${JSON.stringify(rec)}`;
}

export function leafHash(collection, rec) {
  return sha256(leafPreimage(collection, rec));
}

/** An internal node's preimage: two concatenated hex digests. */
export function internalPreimage(a, b) {
  return a + b;
}

/** The shape an internal preimage always has, and a leaf never may. */
export const INTERNAL_PREIMAGE_SHAPE = /^[0-9a-f]{128}$/;
