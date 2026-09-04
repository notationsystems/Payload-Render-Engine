/**
 * THE FOUR PLANES — the API's constitution, as data the service can serve.
 *
 * An API without declared planes grows by accretion: a route is added
 * where it was convenient, and the question "may a tenant read this?"
 * gets answered per-route by whoever wrote it. This file answers it
 * once, for every module family, and a checker holds the answer.
 *
 * THE KEY INVARIANT, and the reason this file exists:
 *
 *   Every ok answer carries EITHER a canonical reference and a proof
 *   root, OR an explicit declaration that it is an operational
 *   observation, with its limitations named.
 *
 * Never both, never neither. Both would claim an operational read is
 * canonical. Neither is the state this service was actually in when
 * this file was written: /api/markets/fx returned `status: ok` with
 * `verification.level: PROVENANCE` and no build, no root, and no
 * declaration - an answer that reads as canonical because it carries a
 * verification level, while being a live central-bank fix with a
 * cache age. The limitation was stated, in prose, in a disclaimer
 * field. Prose is not a contract: a client cannot branch on it, and a
 * checker cannot hold it.
 *
 * PRESENCE is measured, not asserted. Most of the module families
 * below belong to the substrate - the canonical data fabric this
 * service reads and does not own - and are recorded ABSENT with the
 * reason and what would unblock them. An absence with a reason is a
 * decision; an absence without one is a gap.
 */

/** The four planes. A route belongs to exactly one. */
export const PLANES = Object.freeze([
  {
    id: 'tenant_read',
    ordinal: 1,
    label: 'Tenant Read API',
    serves: 'corpus, projection, search, releases, timelines, proof navigation',
    limb: 'EITHER',
    limbNote:
      'this is the plane where both kinds of answer sit side by side - a corpus read that carries a proof root, and a live capture from a source this service does not own. That coexistence is exactly why each answer must declare which it is: an operational reading wearing a verification level, with no root and no stated limitation, reads as canonical to every client that does not know better.',
    refuses: [
      'canonical mutation - this plane is read-only by construction, and the service serves GET only',
      'unbounded result sets - a query with no bound is a denial-of-service surface wearing a feature label',
    ],
  },
  {
    id: 'verification',
    ordinal: 2,
    label: 'Verification API',
    serves: 'any supported VerificationEnvelope, closure, checks, Warrant Graph',
    limb: 'CANONICAL_PROOF',
    limbNote:
      'the plane whose whole purpose is the proof root; an answer here without one would be self-defeating',
    refuses: [
      'softening a failed verification - a proof that does not fold to the root is reported as a failure, never as a warning (SEC-014)',
      'simulating an unreached level - ATTESTED and ZK_VERIFIED are stated as unreached, never approximated',
    ],
  },
  {
    id: 'governance',
    ordinal: 3,
    label: 'Governance API',
    serves:
      'coverage, source-policy windows, retention, readiness, preflight, replay, challenges',
    limb: 'EITHER',
    limbNote:
      'a readiness verdict is an operational observation about a running instance; a retention policy is canonical. This plane carries both kinds, which is exactly why each answer must say which it is',
    refuses: [
      'authorization - a readiness answer states evidence and exceptions, and explicitly does not authorize a release',
      'implying a governance verdict was acted upon - RECOMMENDATION is not AUTHORIZATION is not EXECUTION',
    ],
  },
  {
    id: 'internal_operator',
    ordinal: 4,
    label: 'Internal Ingestion / Operator API',
    serves: 'signed federation packets and controlled operational actions',
    limb: 'CANONICAL_PROOF',
    limbNote: 'an acknowledgement names what was admitted and the root it landed under',
    refuses: [
      'public canonical CRUD - there is no route in this plane that a tenant may call, and none that mutates canonical state through a public path',
      'unsigned ingestion - a packet without a verifiable signature fails closed',
    ],
    presence: 'ABSENT',
    reason:
      'this service accepts no inbound anything: every route is a GET, and SEC-018 refuses every other method at the transport layer. There is no ingestion path to govern and no operator action to control, so the plane is declared and empty rather than half-built.',
    unblockedBy:
      'the substrate landing with a governed ingestion pipeline, and a signing key to verify federation packets against - the same key that would make an ATTESTED verification level real',
  },
]);

/**
 * The module families and their API treatment. `presence` is the state
 * IN THIS SERVICE, which is a read-only spatial projection - not a
 * judgement about the ecosystem, where most of these live elsewhere.
 */
export const MODULE_FAMILIES = Object.freeze([
  {
    id: 'kernel',
    family: 'Kernel, canonical, registry, verification router',
    treatment:
      'Universal reference resolution and proof verification; never direct mutation',
    role: 'proof_verifiable',
    plane: 'verification',
    presence: 'PARTIAL',
    here: [
      'reference resolution over the notation:// identity space (GET /api/notation/resolve, /api/notation/space)',
      'proof verification: the commitment manifest and per-record inclusion proofs (GET /api/corpus/commitments)',
      'the verification router: every answer carries a level and the basis for it',
    ],
    absent:
      'the kernel and canonical store themselves. This service resolves references and verifies proofs against a corpus it was handed; it does not hold canonical state, and SEC-017 forbids a derived representation from mutating it.',
    unblockedBy: 'the canonical data fabric — the substrate owns the kernel',
    routes: ['/api/notation/resolve', '/api/notation/space', '/api/corpus/commitments'],
  },
  {
    id: 'persistence',
    family: 'Journal, closure persistence, PostgreSQL repository',
    treatment:
      'Internal persistence adapters; public API reads only through tenant-bound resolvers',
    role: 'host_infrastructure',
    plane: 'internal_operator',
    presence: 'ABSENT',
    here: [],
    absent:
      'this service persists nothing. Its only journal is a bounded 256-entry in-memory ring for gate refusals, which is deliberately not persistence: it states its own window and counts what it dropped, so an empty list reads as an observed zero for that window rather than as history.',
    unblockedBy:
      'the substrate providing the repository, and a tenant model to bind resolvers to — there is no tenant identity in this service today',
    routes: [],
  },
  {
    id: 'acquisition',
    family: 'Source policy, acquisition, normalization, capture, archive, retention',
    treatment: 'Read policy/receipt/retention status; writes only through governed ingestion',
    role: 'public_read',
    plane: 'governance',
    presence: 'PARTIAL',
    here: [
      'the source registry: every feed declares sourceClass, keyless, metered, freshness and attribution before a single value is drawn from it',
      'refusal receipts for upstreams that declined, with the mechanism and one shared remedy per group (GET /api/refusals)',
    ],
    absent:
      'retention windows, capture receipts and the archive. The acquisition frontier belongs to the Data Acquisition Channel, which carries its own evidence class fixed at ingest — a class this service reads but does not assign.',
    unblockedBy:
      'the Data Acquisition Channel exposing an HTTP surface; its register row records that it has none today, so its claims are read from its tree rather than probed',
    routes: ['/api/refusals', '/api/corpus/definition'],
  },
  {
    id: 'corpus',
    family: 'Corpus build, admission, profiles, identity mapping, diff, corpus release',
    treatment:
      'Corpus catalog, build comparison, membership, provenance, and time-bound read APIs',
    role: 'proof_verifiable',
    plane: 'tenant_read',
    presence: 'PARTIAL',
    here: [
      'the corpus as a self-describing artifact: its definition, ontology, extraction and validation rules (GET /api/corpus/definition)',
      'membership and conservation: what was extracted, what was excluded, and the stated reason for each exclusion',
      'identity mapping: every served record carries its notation:// address, and the address round-trips to that record and not a lookalike',
      'time-bound reads: ?t= / ?asOf= with knowledge modes, refused outside the corpus knowledge range rather than clamped',
    ],
    absent:
      'the record-level build diff. The build delta answers whether the corpus MOVED (FIRST_SESSION / UNCHANGED / REBUILT_UNCHANGED / RECORDS_MOVED) by comparing roots, but not WHICH records moved — that needs two builds contents at once, and holding them here would make the projection a store.',
    unblockedBy: 'the substrate holding build history, which is where a record-level diff belongs',
    // the vocabulary alignment lives here, not with architecture: it is a
    // measurement OF the corpus (it counts how many records carry a
    // value-provenance label), so it is proof-rooted like every other
    // corpus read - not a logical view of the running instance
    routes: ['/api/corpus/definition', '/api/corpus/commitments', '/api/snapshot', '/api/vocabulary/alignment'],
  },
  {
    id: 'projections',
    family: 'Lexical / vector / spatial / analytical / graph / coverage / index projections',
    treatment: 'Projection catalog plus bounded query endpoints with exact proof roots',
    role: 'proof_verifiable',
    plane: 'tenant_read',
    presence: 'PRESENT',
    here: [
      'the spatial projection is what this service IS — the catalog is served at GET /api/capabilities with a probe for each',
      'graph projection: entity expansion and the mined structure over it',
      'analytical projection: derived censuses, labelled DERIVED FROM SNAPSHOT rather than presented as source facts',
      'bounded queries: every result set states its count and its basis',
    ],
    absent:
      'lexical and vector projections, and a coverage projection. Coverage is the one worth naming: this service can say what it holds, but not yet where observation is ABSENT across a region or an interval, which is the answer a desk needs most.',
    unblockedBy:
      'for coverage, a declared observation expectation to measure against — absence is only computable relative to what should have been there',
    routes: ['/api/entities', '/api/states', '/api/search', '/api/mining/patterns', '/api/deviations/(?<entityId>[^/]+)'],
  },
  {
    id: 'agent',
    family: 'Context packages, agent execution, authorized search',
    treatment:
      'Tenant-bound agent/API tools; return references and authorization state, not unrestricted data',
    role: 'public_read',
    plane: 'governance',
    presence: 'PARTIAL',
    here: [
      'a structured tool surface an agent calls, with every invocation journalled with its source',
      'authorization state on the answer: the capability ladder reports observed / proposed / approved / dispatched, and dispatched is lit only from a recorded delivery',
      'references rather than unrestricted data: records travel with their notation:// address, and an address names a record and grants nothing',
    ],
    absent:
      'tenant binding. There is no tenant identity in this service, so "tenant-bound" is currently unenforceable rather than enforced — the honest statement is that this plane is single-tenant by absence, not by policy.',
    unblockedBy:
      'a tenant model, which belongs with the substrate: binding an agent tool to a tenant requires an authority this service does not hold',
    routes: ['/api/capabilities', '/api/system/topology'],
  },
  {
    id: 'release',
    family: 'Methodology, attestation, trusted signers, market release, activation',
    treatment: 'Release and trust-status endpoints; activation and signing stay operator-only',
    role: 'governed_write',
    plane: 'governance',
    presence: 'ABSENT',
    here: [],
    absent:
      'no key is minted or held by this process. The verification ladder therefore stops at REPRODUCIBLE: ATTESTED is stated as unreached rather than approximated, and the invariant ledger records the absence of a rotation path (SEC-190) rather than claiming one.',
    unblockedBy:
      'signing the commitment root. That single act makes ATTESTED reachable, makes trusted signers meaningful, and makes a rotation path a real control instead of a description of one that lives elsewhere.',
    routes: [],
  },
  {
    id: 'readiness',
    family: 'Release preflight and production readiness',
    treatment:
      'Governance/readiness APIs with typed evidence, exceptions, and explicit non-authorization',
    role: 'public_read',
    plane: 'governance',
    presence: 'ABSENT',
    here: [],
    absent:
      'this service has no release gate of its own. The Payload Terminal has one — seven validWhile guards evaluated at RUNTIME against the state the instance is serving, with an explicit distinction from CI verdict about the repository — and this service does not project it.',
    unblockedBy:
      'projecting the upstream guard surface, which is admissible: it is a GET, it is an operational observation about a running instance, and a validWhile guard is a claim that EXPIRES — a notion the invariant ledger here does not yet have',
    routes: [],
  },
  {
    id: 'operations',
    family: 'Projection workers, checkpoints, telemetry, operational snapshots',
    treatment:
      'Operations APIs for lag, replay state, bounded health, and evidence — not provider control',
    role: 'public_read',
    plane: 'governance',
    presence: 'PARTIAL',
    here: [
      'bounded health: every declared capability is probed and its latency measured, and a capability never attempted is reported ABSENT rather than OK',
      'operational evidence: the gate refusal journal, bounded, stating its own window and what it dropped',
      'no provider control: the operations mirror is read-only, and the surface says so',
    ],
    absent:
      'workers, checkpoints and replay lag. This is a single process with no queue and no worker pool, so lag and replay state are not merely unmeasured — they do not exist to measure, and reporting a zero for them would invent a fact.',
    unblockedBy: 'a projection worker pool, which arrives with the substrate rather than here',
    routes: ['/api/health', '/api/capabilities', '/api/security/posture'],
  },
  {
    id: 'architecture',
    family: 'Ecosystem, apparatus, Control Plane, Security Constellation',
    treatment: 'Architecture/topology APIs with logical views and no raw security details',
    role: 'public_read',
    plane: 'governance',
    presence: 'PRESENT',
    here: [
      'the apparatus register: seven apparatuses across a seven-stage corpus lifecycle, each claim carrying where it was read from, presence probed rather than asserted',
      'the control plane topology: nodes, capabilities, the ladder rule, and cost reported ABSENT with its reason',
      'the security posture as a logical view: policy in force, the invariant ledger, and authority reported PRESENT or ABSENT — never as a value (SEC-013)',
    ],
    absent:
      'nothing material. This family is the one the service serves most completely, which is unsurprising: an architecture surface is the one thing a projection can hold entirely, because it is a claim about itself.',
    unblockedBy: '',
    routes: ['/api/ecosystem/register', '/api/system/topology', '/api/security/posture'],
  },
  {
    id: 'federation',
    family: 'Federation, signatures, replay audit',
    treatment:
      'Internal signed-packet ingestion plus acknowledgements, replay reports, and audit reads',
    role: 'governed_write',
    plane: 'internal_operator',
    presence: 'ABSENT',
    here: [],
    absent:
      'there is no ingestion path. Every route is a GET; SEC-018 refuses every other method at the transport layer before a handler is reached. A federation endpoint would be the first write this service has ever accepted, and it is not the component that should hold that.',
    unblockedBy:
      'the substrate owning ingestion, and a signing key to verify packets against — the same key that unblocks ATTESTED',
    routes: [],
  },
  {
    id: 'adjudication',
    family: 'Pattern adjudication, challenges, scientific harness, computation',
    treatment:
      'Governance/research APIs for candidates, reviews, reproducibility, and outcomes',
    // PROOF_VERIFIABLE, not merely readable: reproducibility is named in
    // the treatment, and a reproducibility claim is empty without a root
    // to reproduce against. A mining run here is named by its inputs plus
    // its program and stamped with the committed build, which is what
    // earns it REPRODUCIBLE rather than PROVENANCE.
    role: 'proof_verifiable',
    plane: 'governance',
    presence: 'PARTIAL',
    here: [
      'candidates: the miner emits mined patterns as candidates, stamped with the build that produced them, and none is promoted to an observed fact',
      'reproducibility: a mining run is named by inputs plus program, which is what earns it REPRODUCIBLE rather than PROVENANCE',
      'the candidate/fact boundary is enforced on the surface — a candidate card states that it is not an observed fact',
    ],
    absent:
      'adjudication itself, and challenges. A candidate can be raised here but never resolved: there is no reviewer, no challenge record, and no outcome. That is the correct half to hold — the OCR Agent reaches the same conclusion independently, pinning its own output to adjudication: pending and throwing on any attempt to emit RESOLVED or VERIFIED.',
    unblockedBy:
      'an adjudication authority. Resolution is a decision, and a projection is not the place a decision is recorded.',
    routes: ['/api/mining/patterns'],
  },
  {
    id: 'infrastructure',
    family: 'Object store, token auth, deployment bindings, HTTP/MCP runtime',
    treatment:
      'Infrastructure modules; expose capability/status only, not storage or credential controls',
    role: 'host_infrastructure',
    plane: 'governance',
    presence: 'PARTIAL',
    here: [
      'capability and status only: the posture surface names each authority and reports PRESENT or ABSENT, and the value is never returned to a client or into an agent context (SEC-013)',
      'the HTTP runtime declares its own policy as data: methods served, origin and host allowlists, privileged prefixes, and the rate-limit shape',
    ],
    absent:
      'an object store and an MCP runtime. Neither exists here; the Terminal holds the MCP surface. Exposing a storage or credential control from this service would be the exact confusion this family exists to prevent.',
    unblockedBy: '',
    routes: ['/api/security/posture'],
  },
]);

/**
 * Every registered route, its plane, and the limb its answer must carry.
 *
 * Conservation, not a default: a route absent from this map is a defect
 * the checker names, never a route that quietly inherits a plane. The
 * expected limb is part of the assignment because "which plane" and
 * "what kind of answer" are different questions - a tenant-read route
 * may honestly be either, and saying which one up front is what makes
 * the invariant checkable rather than aspirational.
 */
export const ROUTE_PLANES = Object.freeze({
  // ---- Tenant Read: the corpus, canonical, proof-rooted
  '/api/snapshot': { plane: 'tenant_read', limb: 'CANONICAL_PROOF' },
  '/api/entities': { plane: 'tenant_read', limb: 'CANONICAL_PROOF' },
  '/api/search': { plane: 'tenant_read', limb: 'CANONICAL_PROOF' },
  '/api/states': { plane: 'tenant_read', limb: 'CANONICAL_PROOF' },
  '/api/state/(?<entityId>[^/]+)': { plane: 'tenant_read', limb: 'CANONICAL_PROOF' },
  '/api/deviations/(?<entityId>[^/]+)': { plane: 'tenant_read', limb: 'CANONICAL_PROOF' },
  '/api/scenarios': { plane: 'tenant_read', limb: 'VERIFIED_DERIVATION', method: 'scenario projection over the committed build' },
  '/api/scenarios/(?<scenarioId>[^/]+)/impact': { plane: 'tenant_read', limb: 'CANONICAL_PROOF' },
  '/api/scenarios/rank': { plane: 'tenant_read', limb: 'VERIFIED_DERIVATION', method: 'scenario ranking over the committed build' },
  '/api/scenarios/inject': { plane: 'tenant_read', limb: 'CANONICAL_PROOF' },
  '/api/corpus/definition': { plane: 'tenant_read', limb: 'VERIFIED_DERIVATION', method: 'corpus definition assembled from the loader declaration' },
  '/api/mining/patterns': { plane: 'tenant_read', limb: 'VERIFIED_DERIVATION', method: 'payload-miner/0.1 over the committed build' },

  // ---- Tenant Read: live captures, operational, no root to carry
  '/api/live/aircraft': { plane: 'tenant_read', limb: 'OPERATIONAL_OBSERVATION' },
  '/api/live/satellites': { plane: 'tenant_read', limb: 'OPERATIONAL_OBSERVATION' },
  '/api/live/quakes': { plane: 'tenant_read', limb: 'OPERATIONAL_OBSERVATION' },
  '/api/live/fires': { plane: 'tenant_read', limb: 'OPERATIONAL_OBSERVATION' },
  '/api/markets/fx': { plane: 'tenant_read', limb: 'OPERATIONAL_OBSERVATION' },
  '/api/markets/crypto': { plane: 'tenant_read', limb: 'OPERATIONAL_OBSERVATION' },
  '/api/markets/derivatives': { plane: 'tenant_read', limb: 'OPERATIONAL_OBSERVATION' },
  '/api/markets/broker': { plane: 'tenant_read', limb: 'OPERATIONAL_OBSERVATION' },
  '/api/operations': {
    plane: 'tenant_read',
    limb: 'OPERATIONAL_OBSERVATION',
    upstream: 'the brokerage operations mirror, via the Payload Terminal',
    limitations: [
      'READ-ONLY MIRROR - no order, tender or dispatch capability exists on this surface, and none is implied by anything it shows',
      'MIRROR LAG IS UNSTATED - the upstream does not report how far behind the operational system it is, so freshness here is the fetch time and nothing stronger',
      'RECOMMENDATION is not AUTHORIZATION is not EXECUTION: an exception shown here has not been actioned by this system',
    ],
  },
  '/api/operations/communications': {
    plane: 'tenant_read',
    limb: 'OPERATIONAL_OBSERVATION',
    upstream: 'the brokerage operations mirror, via the Payload Terminal',
    limitations: [
      'READ-ONLY MIRROR - no order, tender or dispatch capability exists on this surface, and none is implied by anything it shows',
      'MIRROR LAG IS UNSTATED - the upstream does not report how far behind the operational system it is, so freshness here is the fetch time and nothing stronger',
      'RECOMMENDATION is not AUTHORIZATION is not EXECUTION: an exception shown here has not been actioned by this system',
    ],
  },
  '/api/operations/fuel': {
    plane: 'tenant_read',
    limb: 'OPERATIONAL_OBSERVATION',
    upstream: 'the brokerage operations mirror, via the Payload Terminal',
    limitations: [
      'READ-ONLY MIRROR - no order, tender or dispatch capability exists on this surface, and none is implied by anything it shows',
      'MIRROR LAG IS UNSTATED - the upstream does not report how far behind the operational system it is, so freshness here is the fetch time and nothing stronger',
      'RECOMMENDATION is not AUTHORIZATION is not EXECUTION: an exception shown here has not been actioned by this system',
    ],
  },

  // the constitution surface obeys the constitution: it is a declaration
  // about the running instance, so it is an operational reading like any
  // other self-report - not a canonical record of what the planes are
  '/api/planes': {
    plane: 'governance',
    limb: 'OPERATIONAL_OBSERVATION',
    upstream: 'this service, declaring its own contract',
    limitations: [
      'A DECLARATION BY THIS BUILD ABOUT ITSELF - the planes are what this build asserts its contract to be, not an externally verified fact about it',
      'presence for each module family is the state IN THIS SERVICE; most of these families live in the substrate and are recorded ABSENT with the reason',
      'the route assignment is conserved by a check, but this surface reports it rather than enforces it - scripts/check-planes.mjs is what actually holds it',
    ],
  },

  '/api/products': {
    plane: 'governance',
    limb: 'OPERATIONAL_OBSERVATION',
    upstream: 'this service, declaring which product each of its streams powers',
    limitations: [
      'A CLAIM BY THIS BUILD ABOUT ITS OWN STREAMS - the assignment is what this twin serves, not the product boundary of any deployed API',
      'LANDSHARK HAS ZERO STREAMS HERE and is reported as such; that is a fact about this twin, not a statement that the product cannot exist',
      'a stream marked `context` informs a product without being one of its records - an aircraft track is not a shipment, and this surface must never be read as though it were',
    ],
  },

  '/api/platform': {
    plane: 'governance',
    limb: 'OPERATIONAL_OBSERVATION',
    upstream: 'this service, declaring its position in the data platform',
    limitations: [
      'A CLAIM BY THIS BUILD ABOUT THE PLATFORM AROUND IT - presence is the state of this tree, not a probe of any deployed infrastructure',
      'layers below the serving projection are ABSENT here BY DESIGN, not by oversight: this service owns no canonical state and accepts no writes',
      'the seams named are places in this repository, not provisioned endpoints - a seam is where a layer would attach, never evidence that it has',
    ],
  },

  // ---- Verification: the plane whose purpose IS the root
  '/api/corpus/commitments': { plane: 'verification', limb: 'CANONICAL_PROOF' },
  '/api/notation/resolve': { plane: 'verification', limb: 'CANONICAL_PROOF' },
  '/api/notation/space': { plane: 'verification', limb: 'CANONICAL_PROOF' },

  // ---- Governance: readiness, policy, architecture, coverage
  '/api/health': {
    plane: 'governance',
    limb: 'OPERATIONAL_OBSERVATION',
    upstream: 'this service, about itself',
    limitations: [
      'INSTANCE LIVENESS AT A MOMENT - this answers for the process that served it, not for the deployment',
      'the counts are of the corpus this instance LOADED, never of the world the corpus describes',
      'a feed never attempted is reported ABSENT rather than OK - an unprobed capability is not a healthy one',
    ],
  },
  '/api/capabilities': {
    plane: 'governance',
    limb: 'OPERATIONAL_OBSERVATION',
    upstream: 'this service, probing its own declared capabilities',
    limitations: [
      'LATENCY MEASURED NOW, FROM THIS PROCESS - a figure here is one sample from one vantage point, not a service level',
      'a probe result is a REACHABILITY fact, never an existence one: a capability that did not answer may exist and be unreachable',
    ],
  },
  '/api/security/posture': {
    plane: 'governance',
    limb: 'OPERATIONAL_OBSERVATION',
    upstream: 'the gate in this process',
    limitations: [
      'THE POLICY IN FORCE IN THIS PROCESS - not the policy of the deployment, and not a claim about any other instance',
      'the CLIENT half of the model cannot be answered from here: the CSP that actually arrived and what is actually in browser storage must be observed in the browser',
      'the refusal journal is a bounded window that states its own `since` - an empty list is an observed zero for that window, never "nothing has ever happened"',
      'authority is reported PRESENT or ABSENT only; no credential value is ever returned (SEC-013)',
    ],
  },
  '/api/system/topology': {
    plane: 'governance',
    limb: 'OPERATIONAL_OBSERVATION',
    upstream: 'this service, declaring the ecosystem it participates in',
    limitations: [
      'A DECLARATION ABOUT THE RUNNING INSTANCE - the model is what this build believes the ecosystem to be, not a discovered fact about it',
      'DISPATCHED is lit only from a recorded delivery; this backend stops at approved and nothing here dispatches',
      'cost is reported ABSENT with its reason - no cost meter exists in this service',
    ],
  },
  '/api/ecosystem/register': {
    plane: 'governance',
    limb: 'OPERATIONAL_OBSERVATION',
    upstream: 'this service, probing sibling apparatuses',
    limitations: [
      'PRESENCE IS PROBED AT A MOMENT - an apparatus that did not answer is UNREACHABLE NOW, which is a different fact from absent from the ecosystem',
      'every claim on a row states where it was read from; a row read from a tree rather than probed says so',
      'the register describes the workspace this build can see - an apparatus outside it is unrecorded rather than known not to exist',
    ],
  },
  '/api/refusals': {
    plane: 'governance',
    limb: 'OPERATIONAL_OBSERVATION',
    upstream: 'the Payload Terminal refusal digest',
    limitations: [
      'UPSTREAM RECEIPTS AS REPORTED AT A MOMENT - the queue is the upstream state when it was asked, not a durable record held here',
      'a refusal absent from this digest was not necessarily served: it may simply not have been attempted in the window',
    ],
  },
  '/api/vocabulary/alignment': { plane: 'governance', limb: 'VERIFIED_DERIVATION', method: 'value-provenance census over the served corpus' },

  // ---- Internal Ingestion / Operator: declared and empty by design.
  // Nothing here. Every route above is a GET, and SEC-018 refuses every
  // other method at the transport layer before a handler is reached.
});

/** Which plane a route belongs to, or null - never a default. */
export function planeOf(pattern) {
  return ROUTE_PLANES[pattern] ?? null;
}

/** Route counts per plane and per limb, derived from the map. */
export function planeCoverage(patterns) {
  const assigned = [];
  const unassigned = [];
  for (const p of patterns) {
    const row = planeOf(p);
    if (row) assigned.push({ pattern: p, ...row });
    else unassigned.push(p);
  }
  const byPlane = {};
  const byLimb = { CANONICAL_PROOF: 0, VERIFIED_DERIVATION: 0, OPERATIONAL_OBSERVATION: 0 };
  for (const a of assigned) {
    byPlane[a.plane] = (byPlane[a.plane] ?? 0) + 1;
    // an unknown limb must not create a null column - it is a defect
    byLimb[a.limb] = (byLimb[a.limb] ?? 0) + 1;
  }
  return {
    total: patterns.length,
    assigned: assigned.length,
    unassigned,
    byPlane,
    byLimb,
    // a pattern in the map that no longer exists is stale, and a stale
    // assignment is how a map stops describing the thing it maps
    stale: Object.keys(ROUTE_PLANES).filter((k) => !patterns.includes(k)),
  };
}

/** The two limbs of the key invariant. An answer carries exactly one. */
export const LIMBS = Object.freeze({
  CANONICAL: {
    id: 'CANONICAL',
    field: 'meta.reference',
    requires: ['canonical', 'proofRoot'],
    means:
      'the answer names a canonical reference and the proof root that binds it; a reader can verify it offline instead of trusting this service',
  },
  OPERATIONAL: {
    id: 'OPERATIONAL',
    field: 'meta.observation',
    requires: ['operational', 'observedAt', 'limitations'],
    means:
      'the answer is a reading taken at a moment, from something this service does not own; its limitations are named so a reader does not mistake it for canonical state',
  },
});

/** API-000, as the ecosystem repo names it (ecosystem/api-planes.json). */
export const INVARIANT_ID = 'API-000';

export const LIMB_INVARIANT =
  'every ok answer carries exactly one of meta.reference (canonical + proof root), meta.derivation (derived from a build by a named method) or meta.observation (operational + limitations) - never more than one, never none';

/**
 * API-000 as the ecosystem repo states it has TWO limbs: a canonical
 * reference with a proof root, or an operational observation with its
 * limitations. This twin implements THREE, and the third is a
 * refinement rather than a disagreement.
 *
 * Under the two-limb reading, a mined pattern had to take the canonical
 * limb - whose text promises membership of the committed build and an
 * inclusion proof - and that promise is false for anything the service
 * computed rather than read. VERIFIED_DERIVATION splits the canonical
 * limb in two so the promise stays true: a reference certifies
 * MEMBERSHIP, a derivation binds INPUTS.
 *
 * Recorded here rather than by quietly rewriting a shared invariant id,
 * because API-000 is the ecosystem's and not this surface's to redefine.
 */
export const INVARIANT_EXTENSION = Object.freeze({
  base: 'API-000',
  baseLimbs: ['CANONICAL_PROOF', 'OPERATIONAL_OBSERVATION'],
  addedHere: 'VERIFIED_DERIVATION',
  why:
    'the canonical limb promises membership of the committed build; a value the service COMPUTED from that build is not a member of it, and no inclusion proof will ever be produced for one. Splitting the limb keeps the promise true rather than weakening it.',
  proposeUpstream:
    'if the bundle adopts it, API-000 gains a third limb and the ecosystem/api-planes.json statement widens. Until then this twin is a superset and says so.',
});

/** Presence, derived from the rows rather than carried alongside them. */
export function countPresence(families = MODULE_FAMILIES, planes = PLANES) {
  const tally = { PRESENT: 0, PARTIAL: 0, ABSENT: 0 };
  for (const f of families) if (f.presence in tally) tally[f.presence] += 1;
  return {
    families: families.length,
    ...tally,
    planes: planes.length,
    planesDeclaredEmpty: planes.filter((p) => p.presence === 'ABSENT').length,
    routesClaimed: new Set(families.flatMap((f) => f.routes ?? [])).size,
  };
}

/** The constitution, as one answerable object. */
export function apiConstitution() {
  return {
    invariant: LIMB_INVARIANT,
    posture:
      'Four planes, declared once. A route belongs to exactly one, and a route with no plane is a defect rather than a default.',
    limbs: LIMBS,
    planes: PLANES,
    families: MODULE_FAMILIES,
    counts: countPresence(),
  };
}
