/**
 * notation:// as an address bar.
 *
 * The command bar already parses a small grammar. This adds one rule to
 * it: a `notation://` URI is an ADDRESS, and typing one navigates the OS
 * to what it names — or refuses with the apparatus that holds it.
 *
 * WHY THIS RESOLVES LOCALLY.
 *
 * The OS already holds the corpus it is rendering, so an entity address
 * is answerable here without asking anyone. That is not a shortcut, it
 * is the honest boundary: this surface can answer for what it has, and
 * for everything else the right answer is a refusal naming the holder —
 * not a fetch that pretends the projection is authoritative for the
 * whole identity space. The service's own resolver
 * (`GET /api/notation/resolve`) answers the same way over the served
 * corpus; the two agree because they share `shared/notation.mjs`.
 *
 * NAVIGATION IS NOT DEREFERENCE.
 *
 * Resolving an address moves the camera and opens a surface. It never
 * grants access to anything the operator could not already open, and no
 * kind in the space names a credential, a session, or an agent.
 */

import { locate } from '../../shared/notation.mjs';
import type { AppApi, CommandResult } from '../app/api';
import type { EntityId } from '../data/contracts';

/** Kinds this OS can navigate to, and the surface each one opens. */
const OPENS: Record<string, { event?: string; what: string }> = {
  node: { event: 'pe:ecosystem-toggle', what: 'the apparatus register' },
  proof: { event: 'pe:warrant-toggle', what: 'the warrant graph' },
  dataset: { event: 'pe:compiler-toggle', what: 'the compiler console' },
  transform: { event: 'pe:patterns-toggle', what: 'the mined patterns' },
};

/** The id shapes this corpus actually mints, tried in order. */
function entityCandidates(head: string, tail: string[]): { id: string; shape: string }[] {
  return [
    { id: `ent:${head}:${tail.join(':')}`, shape: 'ent:type:name' },
    { id: `${head}-${tail.join('-')}`, shape: 'bare-hyphenated' },
    { id: `${head}:${tail.join(':')}`, shape: 'type:name' },
    { id: tail.join(':'), shape: 'bare' },
    { id: [head, ...tail].join(':'), shape: 'joined' },
  ];
}

/**
 * Resolve a notation:// address against what this OS holds, and
 * navigate. Pure over the AppApi facade — no DOM beyond the same
 * CustomEvents the command grammar already dispatches.
 */
export function navigateNotation(api: AppApi, raw: string): CommandResult {
  const found = locate(raw);
  if (!found.ok) {
    return { ok: false, message: `${found.refusal.kind} — ${found.refusal.message}. ${found.refusal.remedy}` };
  }

  // A kind held by another apparatus is refused WITH the holder named.
  // The refusal is the map: it says where the thing lives, which is more
  // useful than a silent miss and is the only honest answer available.
  if (!found.resolvableHere) {
    const holder = found.holder ?? 'no apparatus';
    return {
      ok: false,
      message: `NOT HELD HERE — ${found.uri} names ${found.names}, held by ${holder.toUpperCase()}. ${found.unavailable ?? ''} UNBLOCKED BY: ${found.unblockedBy ?? 'unstated'}`,
    };
  }

  const [head, ...tail] = found.segments;

  if (found.kind === 'entity') {
    const snapshot = api.store.snapshot;
    for (const c of entityCandidates(head, tail)) {
      const rec =
        snapshot.nodes.find((n) => n.id === c.id) ??
        snapshot.routes.find((n) => n.id === c.id) ??
        snapshot.flows.find((n) => n.id === c.id);
      if (!rec) continue;
      api.select(rec.id as EntityId, 'command');
      api.focus(rec.id as EntityId);
      // the shape that answered is REPORTED, never normalised away:
      // an undocumented relabelling is where provenance is lost
      const shapeNote = c.shape === 'ent:type:name' ? '' : ` · resolved through the ${c.shape} id shape this corpus also mints`;
      return { ok: true, message: `${found.uri} → ${rec.id.toUpperCase()}${shapeNote}` };
    }
    return {
      ok: false,
      message: `NAMES NOTHING — ${found.uri} is well formed and nothing in the loaded corpus answers to it. Most of a namespace is unpopulated at any moment; check the identifier, or run 'notation' for the shape each kind takes.`,
    };
  }

  const opener = OPENS[found.kind];
  if (opener?.event) {
    window.dispatchEvent(new CustomEvent(opener.event));
    return { ok: true, message: `${found.uri} → ${opener.what.toUpperCase()}` };
  }

  return {
    ok: false,
    message: `NO SURFACE — ${found.uri} is resolvable but this OS opens no instrument for a ${found.kind}. GET /api/notation/resolve answers it as data.`,
  };
}

/**
 * The reverse of the resolver: a record's notation:// address.
 *
 * The property that matters is ROUND-TRIP — `addressOf(id)` must resolve
 * back to `id` for every record the corpus serves. An address that does
 * not round-trip is worse than none, because it looks authoritative and
 * sends the reader somewhere else.
 *
 * This corpus mints more than one id shape, so the shape used is
 * REPORTED rather than smoothed over, exactly as the resolver reports
 * which shape answered. A single token with no separator names a type
 * and nothing else: refusing is better than inventing a segment to make
 * it parse.
 */
export function addressOf(id: string): { uri: string; shape: string } | null {
  if (typeof id !== 'string' || id === '') return null;

  const ent = /^ent:([^:]+):(.+)$/.exec(id);
  if (ent) return { uri: `notation://entity/${ent[1]}/${ent[2]}`, shape: 'ent:type:name' };

  const prefixed = /^([^:]+):(.+)$/.exec(id);
  if (prefixed) return { uri: `notation://entity/${prefixed[1]}/${prefixed[2]}`, shape: 'type:name' };

  const hyphen = /^([^-]+)-(.+)$/.exec(id);
  if (hyphen) return { uri: `notation://entity/${hyphen[1]}/${hyphen[2]}`, shape: 'bare-hyphenated' };

  return null;
}

export { locate, notationSpace } from '../../shared/notation.mjs';
