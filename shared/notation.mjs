/**
 * THE notation:// IDENTITY SPACE — parsing, and who holds what.
 *
 * The standing invariant is *one canonical identity space, many physical
 * representations*. Today each apparatus mints in its own space — DAF
 * content-addresses evidence, the OCR Agent content-addresses artifacts,
 * the Terminal mints `ent:mine:escondida`, this engine adds build
 * fingerprints — and the joins between them are positional. Nothing is
 * broken yet because the joins are few. They stop being few at the first
 * cross-apparatus query.
 *
 * The register named the first useful step, and it was deliberately NOT
 * a migration: a **resolver**. One thing that answers *what does this URI
 * name, and which apparatus holds it* without anything having to
 * renumber. That is what this module is.
 *
 * WHAT IT IS NOT.
 *
 * It is not an allocator: it mints nothing. It is not a registry: it
 * stores nothing. It does not rename any apparatus's ids — an existing
 * id keeps working exactly as it did, and a notation:// URI is a second
 * way to *say* it, never a replacement that something must migrate to.
 *
 * A NAME IS NOT A CAPABILITY.
 *
 * Resolving a URI tells you what it names and where that lives. It never
 * grants access, and this module never dereferences anything. That was
 * already the rule for the identity space (docs/SECURITY.md §5): a URI
 * scheme that could name a credential is a credential that will
 * eventually be dereferenced — which is why no kind here names a secret,
 * a session, or an agent.
 *
 * REFUSAL IS THE POINT.
 *
 * Most of this space has no implementation. A resolver that quietly
 * returned nothing for those would be useless; one that pretended would
 * be worse. So an unheld kind resolves to a typed refusal naming which
 * apparatus WOULD hold it and what would have to exist first. That turns
 * an unimplemented identity space into a navigable map of where things
 * live — which is the honest and, right now, the more useful artifact.
 */

/**
 * The kinds, and where each lives. `holder` is the apparatus id in the
 * register; `resolvableHere` says whether THIS projection can answer it
 * from what it serves, which is a different and much smaller question.
 */
export const KINDS = Object.freeze({
  node: {
    label: 'apparatus or organization',
    holder: 'render-engine',
    resolvableHere: true,
    shape: 'notation://node/apparatus/<id> · notation://node/org/<id>',
    note: 'the register itself — the one kind this surface is authoritative for',
  },
  entity: {
    label: 'a thing in the physical economy',
    holder: 'terminal',
    resolvableHere: true,
    shape: 'notation://entity/<type>/<id>',
    note: 'canonical in the Terminal; this projection serves a representation of it and can focus it',
  },
  observation: {
    label: 'a measured or reported value about an entity',
    holder: 'terminal',
    resolvableHere: true,
    shape: 'notation://observation/<entityType>/<entityId>/<field>',
    note: 'travels on the record with its own provenance; resolvable here through the served snapshot',
  },
  proof: {
    label: 'a commitment or inclusion proof',
    holder: 'render-engine',
    resolvableHere: true,
    shape: 'notation://proof/merkle/<recordId>',
    note: 'the commitment manifest and per-record inclusion proofs are content-addressed and served here',
  },
  transform: {
    label: 'a named, versioned computation over a corpus build',
    holder: 'render-engine',
    resolvableHere: true,
    shape: 'notation://transform/<program>/<version>',
    note: 'mining programs are the transforms this engine runs and can name',
  },
  dataset: {
    label: 'a corpus build',
    holder: 'terminal',
    resolvableHere: true,
    shape: 'notation://dataset/corpus/<buildId>',
    note: 'the build fingerprint this projection stamps on every answer',
  },
  source: {
    label: 'an upstream this ecosystem acquires from',
    holder: 'daf',
    resolvableHere: false,
    shape: 'notation://source/<provider>/<endpoint>',
    unavailable:
      'the acquisition channel holds source identity and this projection has no read path into it; the sources this engine reaches directly are a small subset it names in its own capability list',
    unblockedBy: 'a read surface on the acquisition channel, or a source manifest published into the corpus build',
  },
  artifact: {
    label: 'a document or file that evidence was extracted from',
    holder: 'ocr',
    resolvableHere: false,
    shape: 'notation://artifact/<contentHash>',
    unavailable:
      'artifact identity is content-addressed inside the perception apparatus, which is a library rather than a service — nothing here can dereference it',
    unblockedBy: 'an evidence surface that publishes artifact ids alongside the observations they warranted',
  },
  claim: {
    label: 'an assertion made by a party, distinct from a measurement',
    holder: 'terminal',
    resolvableHere: false,
    shape: 'notation://claim/<party>/<subject>',
    unavailable:
      'the Terminal carries reported values but does not yet address the assertion itself as an object with its own identity',
    unblockedBy:
      'the value-provenance alignment: once `reported` is understood as `asserted`, the assertion becomes a thing worth naming',
  },
  state: {
    label: 'canonical state at a point in knowledge time',
    holder: 'terminal',
    resolvableHere: false,
    shape: 'notation://state/<entityId>@<knownAt>',
    unavailable:
      'this projection serves as-known-at reads but does not address a state VERSION as an object; the Terminal holds versioning',
    unblockedBy: 'a version id on the canonical record that survives into the projection',
  },
  model: {
    label: 'a model whose outputs enter the corpus',
    holder: null,
    resolvableHere: false,
    unavailable:
      'no apparatus holds a model registry. The OCR Agent names its provider in one adapter and versions its prompts by content hash, which is the nearest thing that exists, and it is not addressable from outside that package.',
    unblockedBy: 'a model registry anywhere in the ecosystem — until then this kind names nothing',
  },
});

/** Kinds that would name authority. Deliberately absent, permanently. */
export const FORBIDDEN_KINDS = Object.freeze({
  credential: 'a URI that can name a credential is a credential that will eventually be dereferenced',
  session: 'sessions are authority in flight; naming one makes it forwardable',
  agent: 'an addressable agent identity is a capability handle, and an agent may not hold one',
});

const SEGMENT = /^[A-Za-z0-9._~:@+%-]{1,128}$/;

/**
 * Parse a notation:// URI. Structural only — it neither resolves nor
 * dereferences, and it accepts nothing it cannot fully account for.
 *
 * @returns {{ok: true, kind: string, segments: string[], uri: string}
 *          | {ok: false, refusal: {kind: string, message: string, remedy: string}}}
 */
export function parseNotationUri(raw) {
  const refuse = (kind, message, remedy) => ({ ok: false, refusal: { kind, message, remedy } });
  if (typeof raw !== 'string' || raw.trim() === '') {
    return refuse('NOTATION_URI_EMPTY', 'no URI was given', 'pass a notation:// URI, e.g. notation://node/apparatus/payload-terminal');
  }
  const text = raw.trim();
  if (!text.startsWith('notation://')) {
    return refuse(
      'NOTATION_URI_SCHEME',
      'this resolver answers only for the notation:// scheme',
      'prefix the identity with notation:// — other schemes name things this ecosystem does not mint'
    );
  }
  const rest = text.slice('notation://'.length);
  // A malformed address is REFUSED, never rewritten. Silently collapsing
  // `entity//x` to `entity/x` makes two inputs that should be
  // distinguishable resolve to one thing — a parser differential, and
  // the beginning of every identity bug that is hard to find later.
  const parts = rest.split('/');
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop(); // one trailing slash is idiomatic
  if (parts.some((seg, i) => i > 0 && seg === '')) {
    return refuse(
      'NOTATION_URI_EMPTY_SEGMENT',
      'the URI carries an empty path segment',
      'remove the doubled separator — this resolver refuses a malformed address rather than guessing which one you meant'
    );
  }
  const [kind, ...segments] = parts;
  if (!kind) {
    return refuse(
      'NOTATION_URI_KIND_MISSING',
      'the URI names no kind',
      `use one of: ${Object.keys(KINDS).join(', ')}`
    );
  }
  if (kind in FORBIDDEN_KINDS) {
    return refuse(
      'NOTATION_KIND_FORBIDDEN',
      `'${kind}' is deliberately not addressable: ${FORBIDDEN_KINDS[kind]}`,
      'there is no remedy and this is not an oversight — the omission is the control'
    );
  }
  if (!(kind in KINDS)) {
    return refuse(
      'NOTATION_KIND_UNKNOWN',
      `'${kind}' is not a kind in this identity space`,
      `use one of: ${Object.keys(KINDS).join(', ')}`
    );
  }
  if (segments.length === 0) {
    return refuse(
      'NOTATION_URI_INCOMPLETE',
      `a ${kind} URI names nothing on its own`,
      `expected shape: ${KINDS[kind].shape ?? `notation://${kind}/<id>`}`
    );
  }
  const bad = segments.find((s) => !SEGMENT.test(s));
  if (bad !== undefined) {
    return refuse(
      'NOTATION_URI_SEGMENT_INVALID',
      'a path segment carries characters this space does not admit',
      'segments are letters, digits and . _ ~ : @ + % - and at most 128 characters each'
    );
  }
  return { ok: true, kind, segments, uri: `notation://${kind}/${segments.join('/')}` };
}

/**
 * What this URI names and who holds it — WITHOUT dereferencing it.
 * Binding a resolvable kind to an actual record is the caller's job and
 * happens one layer up, where the corpus is.
 */
export function locate(uri) {
  const parsed = parseNotationUri(uri);
  if (!parsed.ok) return parsed;
  const k = KINDS[parsed.kind];
  return {
    ok: true,
    uri: parsed.uri,
    kind: parsed.kind,
    segments: parsed.segments,
    names: k.label,
    holder: k.holder,
    resolvableHere: k.resolvableHere,
    note: k.note ?? null,
    // an unheld kind is refused with the apparatus that WOULD hold it —
    // a map of where things live is more useful than a silent nothing
    unavailable: k.unavailable ?? null,
    unblockedBy: k.unblockedBy ?? null,
  };
}

/** The space as a whole, for a surface that wants to show what exists. */
export function notationSpace() {
  const kinds = Object.entries(KINDS).map(([id, k]) => ({
    id,
    label: k.label,
    holder: k.holder,
    resolvableHere: k.resolvableHere,
    shape: k.shape ?? null,
    note: k.note ?? null,
    unavailable: k.unavailable ?? null,
    unblockedBy: k.unblockedBy ?? null,
  }));
  return {
    scheme: 'notation://',
    invariant: 'one canonical identity space, many physical representations',
    kinds,
    forbidden: Object.entries(FORBIDDEN_KINDS).map(([id, why]) => ({ id, why })),
    counts: {
      kinds: kinds.length,
      resolvableHere: kinds.filter((k) => k.resolvableHere).length,
      heldElsewhere: kinds.filter((k) => !k.resolvableHere && k.holder).length,
      unheld: kinds.filter((k) => !k.holder).length,
    },
    posture:
      'a resolver, not an allocator: it mints nothing, stores nothing, and renames nothing. An apparatus id keeps working exactly as it did; a notation:// URI is a second way to say it. Resolving a name never grants access to what it names.',
  };
}
