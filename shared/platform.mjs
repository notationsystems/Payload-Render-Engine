/**
 * THE DATA PLATFORM, and where this service sits in it.
 *
 * The platform is provenance-first: one canonical state layer and
 * several REBUILDABLE serving layers.
 *
 *     immutable artifacts -> canonical state -> versioned corpus builds
 *     -> graph / spatial / semantic / analytical projections
 *     -> APIs, agents, products, verification
 *
 * This service is the last two rows. It is a serving projection and the
 * API over it. It owns no canonical state, and the standing invariant
 * that a derived representation may not mutate canonical state
 * (SEC-017, INV-6) is the same rule as the platform's "no serving
 * projection writes canonical truth" - reached independently, from the
 * rendering side rather than the storage side.
 *
 * Everything below layer 4 is recorded ABSENT with the reason and the
 * SEAM: the concrete place in this tree where that layer would attach.
 * A seam named with a file is a decision someone can act on; a seam
 * described in prose is a wish.
 *
 * The build order matters and is not this file's to choose. What this
 * file can do is stop the layers being claimed before they exist, and
 * name what each one would plug into.
 */

/** The six layers, in the order they are built. */
export const PLATFORM_LAYERS = Object.freeze([
  {
    ordinal: 1,
    id: 'object-storage',
    label: 'Object storage - immutable evidence',
    owns:
      'raw source files, images, PDFs, API captures, model outputs, manifests and proofs; separate raw, quarantined, canonical-export and published-build zones; every object carrying a content hash, rights, retention, access scope and source metadata',
    presence: 'ABSENT',
    here: [],
    absent:
      'there is no object store. What exists is its smallest honest ancestor: server/fixtures/terminal/capture.json, a committed capture of real upstream bytes that records what it is, where it came from, and the instant it was taken.',
    seam: 'server/fixtures/terminal/capture.json - the capture manifest, and fixtureFetch.capturedAt which now feeds that instant into the build',
    evidence:
      'the capture already carries three of the five required object attributes (content, source, capture instant); it carries no content hash, rights, retention or access scope',
    unblockedBy:
      'an S3-compatible store with the four zones, and a capture writer that records the remaining attributes per object. The loader seam is already shaped for it: a transport declares the instant of the capture it replays, and the build prefers that over the clock',
    owner: 'SYSTEMS_ENGINEER',
  },
  {
    ordinal: 2,
    id: 'canonical-state',
    label: 'PostgreSQL + PostGIS - canonical operational truth',
    owns:
      'entities, aliases, observations, assertions, relationships, bitemporal state, permissions, audit logs and the transactional outbox; row-level security for tenant isolation',
    presence: 'ABSENT',
    here: [],
    absent:
      'this service holds no canonical state and must not. It reads a corpus it was handed and serves projections of it; SEC-017 forbids a derived representation from mutating canonical state, and every route is a GET.',
    seam: 'server/loaders/ - the corpus loader interface. A postgres loader would sit beside terminal.mjs and synthetic.mjs and return the same shape: { kind, snapshot, capture, metaDefaults, readStateAt }',
    evidence:
      'two loaders already implement that interface, so the seam is exercised rather than theoretical. The bitemporal half is partly modelled here already - answers carry asOf, knownAt and a knowledge mode, and refuse as_known_then where the corpus cannot honestly replay it',
    unblockedBy:
      'the database itself. Note the row-level-security caveat: privileged roles bypass RLS unless explicitly constrained, so tenant isolation is a property of the role grants and not of the policy alone',
    owner: 'SYSTEMS_ENGINEER',
  },
  {
    ordinal: 3,
    id: 'outbox-workflow',
    label: 'Outbox + durable workflow - controlled change',
    owns:
      'a PostgreSQL transactional outbox and durable workflows for ingestion, review, compilation, release, challenge and proof jobs',
    presence: 'ABSENT',
    here: [],
    absent:
      'there is no change to control. This service accepts no writes: SEC-018 refuses every method but GET and OPTIONS at the transport layer, before a handler is reached. An outbox with nothing to drain would be infrastructure pretending to be a capability.',
    seam:
      'shared/planes.mjs - the internal ingestion / operator plane, declared and deliberately EMPTY. PLANE-003 fails if a route ever appears in it, so this layer cannot arrive here by accident',
    evidence:
      'the plane is declared with its refusals stated, so the shape of what would arrive is already written down: signed federation packets, acknowledgements, replay reports, audit reads - and never public canonical CRUD',
    unblockedBy:
      'the canonical store existing first. An outbox is a consequence of transactional writes, and there are none until layer 2',
    owner: 'SYSTEMS_ENGINEER',
  },
  {
    ordinal: 4,
    id: 'lakehouse',
    label: 'Lakehouse - historical analytical state',
    owns:
      'canonical snapshots and large historical facts as Parquet/Iceberg, with snapshots, schema evolution and atomic metadata commits supporting reproducible corpus builds and time travel',
    presence: 'PARTIAL',
    here: [
      'reproducible corpus builds, MEASURED rather than claimed: a build is a pure function of its capture, and the contract tests build twice from one capture and compare',
      'a commitment manifest per build - sha256-merkle/0.1, per-record leaves folded to one root, with offline inclusion proofs',
      'build identity that says whether it can be reproduced and from what (corpusBuild.capture), so a rebuilt corpus is distinguishable from a changed one',
    ],
    absent:
      'the table format and the history. There is exactly one build in memory at a time; the compiler console can say the corpus MOVED but not WHICH records moved, because answering that needs two builds contents at once and holding them here would make the projection a store.',
    seam: 'server/api.mjs - the commitment manifest and corpusBuild identity; scripts/verify-inclusion.mjs for the offline fold',
    evidence:
      'this was not true until it was measured: three builds a second apart produced three different merkle roots with identical record counts, because knownAt on the four projected collections was stamped from the wall clock. One value governs it, and the contract tests now hold it',
    unblockedBy:
      'a table format with snapshots to write the builds into. The reproducibility property it depends on is now proven at this end',
    owner: 'SYSTEMS_ENGINEER',
  },
  {
    ordinal: 5,
    id: 'serving-projections',
    label: 'Rebuildable serving projections',
    owns:
      'spatial, graph, semantic and search projections, none of which writes canonical truth',
    presence: 'PARTIAL',
    here: [
      'SPATIAL - the whole service is one, and it is rebuildable: drop it and rebuild from the capture and you get the same root',
      'GRAPH - entity expansion and deterministic mining over the corpus, in memory, with no graph database. Traversal limits have not been measured, which is the stated precondition for adding one',
      'SEARCH - lexical retrieval over the corpus at GET /api/search, in PostgreSQL-less form; it has not been measured against a separate index because there is no PostgreSQL yet to exceed',
      'the projection writes nothing back: every route is a GET, and the renderer is never authoritative',
    ],
    absent:
      'the semantic projection. No vector projection exists, versioned or otherwise, and none should be added before there is a canonical id to key it to - a vector store keyed to ids this service invented would be a projection of a projection.',
    seam: 'src/intel/ and server/api.mjs - the query and projection surfaces; shared/notation.mjs for the canonical ids a vector projection would key to',
    evidence:
      'the no-write property is enforced twice, from both ends: scripts/check-seam.mjs holds INV-6 in the renderer, and SEC-018 refuses non-GET methods at the transport layer',
    unblockedBy:
      'for semantic: canonical ids from layer 2, then a measured latency/scale case for pgvector versus a dedicated store. For graph: a measured traversal limit, not an anticipated one',
    owner: 'SHARED',
  },
  {
    ordinal: 6,
    id: 'trust',
    label: 'Trust and assurance',
    owns:
      'kernel references and digests throughout, corpus-build and result manifests, CI provenance for code/containers/deployment, SP1 proofs for selected deterministic computations, and OpenTelemetry across ingestion, compilation, APIs and agents',
    presence: 'PARTIAL',
    here: [
      'DIGESTS THROUGHOUT - a sha256 leaf per record, folded to one merkle root per build, verifiable offline by a third party holding one record and its path',
      'CORPUS-BUILD MANIFESTS - served, and now stating their own reproducibility',
      'the verification ladder, with unreached levels stated rather than simulated: PROVENANCE and REPRODUCIBLE are reached, ATTESTED and ZK_VERIFIED are not',
    ],
    absent:
      'CI provenance, SP1 proofs and OpenTelemetry. ATTESTED is unreachable for a specific and stated reason: no key is minted or held by this process, so there is nothing to sign the root with, and the invariant ledger records the absence of a rotation path rather than claiming one.',
    seam:
      'server/api.mjs commitment manifest for SP1 to prove against; server/security.mjs SecurityJournal for the span/event surface OpenTelemetry would carry',
    evidence:
      'the ladder is enforced, not decorative: every ok answer states its level AND the basis for it, and the contract tests fail a route that claims a level without a basis',
    unblockedBy:
      'signing the commitment root is the single act that unblocks ATTESTED, trusted signers and a real rotation path. SP1 needs a deterministic computation worth proving - the mining run is the candidate, since it is already named by inputs plus program',
    owner: 'SYSTEMS_ENGINEER',
  },
]);

/** The lean first production footprint, and what of it exists here. */
export const FIRST_FOOTPRINT = Object.freeze([
  { id: 'ci', label: 'GitLab CI/CD', present: false, note: 'no CI configuration in this tree; the check chain runs locally via npm run check' },
  { id: 'postgres', label: 'managed PostgreSQL/PostGIS', present: false, note: 'layer 2 - this service holds no canonical state by design' },
  { id: 's3', label: 'S3-compatible object storage', present: false, note: 'layer 1 - the committed capture manifest is its smallest ancestor' },
  { id: 'workers', label: 'application/API workers', present: true, note: 'this service is one: a read-only Node 22 ESM projection API' },
  { id: 'outbox', label: 'PostgreSQL outbox', present: false, note: 'layer 3 - nothing to drain while the service accepts no writes' },
  { id: 'temporal', label: 'Temporal', present: false, note: 'layer 3 - no ingestion, review, compilation or release job runs here' },
  { id: 'otel', label: 'OpenTelemetry collector/backend', present: false, note: 'layer 6 - the bounded security journal is the only event surface, and it is in-memory' },
]);

/** Explicitly NOT to be started with. Recorded so nobody adds one quietly. */
export const DEFERRED_BY_DECISION = Object.freeze([
  { id: 'kafka', why: 'a PostgreSQL transactional outbox first; a broker is added on workload evidence' },
  { id: 'neo4j', why: 'PostgreSQL recursive queries and materialized views first; a graph database only after MEASURED traversal limits' },
  { id: 'spark', why: 'not warranted before there is historical analytical state to process' },
  { id: 'blockchain', why: 'the commitment manifest already gives tamper-evidence; a chain would add consensus nobody needs' },
  { id: 'kubernetes', why: 'a large estate is infrastructure sprawl before workload evidence demands it' },
]);

export const PLATFORM_INVARIANT =
  'no serving projection writes canonical truth - the same rule this service reached from the rendering side as INV-6 and SEC-017';

export function countLayers(layers = PLATFORM_LAYERS) {
  const tally = { PRESENT: 0, PARTIAL: 0, ABSENT: 0 };
  for (const l of layers) if (l.presence in tally) tally[l.presence] += 1;
  return {
    layers: layers.length,
    ...tally,
    footprintPresent: FIRST_FOOTPRINT.filter((f) => f.present).length,
    footprintTotal: FIRST_FOOTPRINT.length,
    deferredByDecision: DEFERRED_BY_DECISION.length,
  };
}

export function platformPosition() {
  return {
    invariant: PLATFORM_INVARIANT,
    posture:
      'This service is the serving-projection and API rows of the platform. It owns no canonical state, and every layer beneath it is recorded ABSENT with the seam where it would attach.',
    layers: PLATFORM_LAYERS,
    footprint: FIRST_FOOTPRINT,
    deferredByDecision: DEFERRED_BY_DECISION,
    counts: countLayers(),
  };
}
