/**
 * The one escaper (SEC-120, SEC-121).
 *
 * The renderer is the last line of defence for text it did not write:
 * carrier names, load ids, refusal messages, engine reasoning traces
 * and feed payloads all arrive from an upstream this OS does not
 * control, and much of it lands in `innerHTML`.
 *
 * The earlier per-module escapers covered `& < >` only. That is safe
 * in ELEMENT position and unsafe in ATTRIBUTE position: a value
 * containing a double quote breaks out of `title="…"` and gets an
 * event handler onto the page. Several real sinks did exactly that —
 * `title="${esc(probe.detail)}"` renders an upstream refusal message.
 *
 * So there is now exactly one escaper, it covers quotes, and
 * `scripts/check-security.mjs` fails the build if a module defines its
 * own. Escaping quotes in element position is harmless; a single safe
 * function beats a rule everyone must remember.
 */

const MARKUP = /[&<>"']/g;
const REPLACEMENTS: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Markup-safe in both element and attribute position. */
export function esc(value: unknown): string {
  return String(value ?? '').replace(MARKUP, (c) => REPLACEMENTS[c]);
}

/**
 * For values that ride into a CLASS NAME or other structural slot
 * where escaping is not enough — the value must be one we chose.
 * Anything unrecognised collapses to the stated fallback rather than
 * reaching markup (SEC-122).
 */
export function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}
