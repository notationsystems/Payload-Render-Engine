/**
 * THE THREE APIS, AND WHICH STREAM POWERS WHICH.
 *
 *   Notation Systems Ecosystem
 *     -> Payload OS
 *         -> Caravan API
 *         -> Tradewind API
 *         -> Landshark API
 *
 * Payload OS is the shared operating, evidence, provenance, identity,
 * corpus, release, policy, access and verification layer. It is NOT a
 * fourth public API, and this file must never let it be rendered as
 * one.
 *
 * A THIRD AXIS, ORTHOGONAL TO THE OTHER TWO.
 *
 * A route already answers two questions. shared/planes.mjs says which
 * PLANE it belongs to - who may read it and under what promise. The
 * envelope says which LIMB its answer carries - canonical proof,
 * verified derivation, or operational observation. This file answers a
 * third: which PRODUCT owns it.
 *
 * The three are independent and collapsing any two loses information.
 * A Tradewind market read and a Caravan corpus read sit in the same
 * plane (tenant_read) and carry different limbs; a Caravan corpus read
 * and a Payload OS commitment read carry the same limb and sit in
 * different planes. Owning-API is not derivable from either.
 *
 * CORE VERSUS CONTEXT, and why the distinction is load-bearing.
 *
 * The charter forbids Tradewind inferring physical delivery from market
 * data. The symmetric rule holds inside Caravan: an aircraft track is
 * not a shipment, and a wildfire is not a delay. Streams that inform a
 * product without being records of it are marked `context`, so a view
 * cannot quietly promote one into the product's own object class.
 *
 * LANDSHARK IS EMPTY, and says so.
 *
 * Zero streams. Not a gap in this file - a fact about the twin. The
 * charter itself says Tradewind and Landshark are compatible shells
 * until their own source, release, rights and customer-service evidence
 * exists. Landshark has none of the four. Recording it as an empty
 * product with a stated reason is the honest shape; padding it with
 * whatever geographic data happened to be lying around would produce
 * exactly the false coverage this system exists to refuse.
 */

/** The fixed hierarchy. The bundle is a layer, never a product row. */
export const PRODUCT_HIERARCHY = Object.freeze({
  ecosystem: 'Notation Systems Ecosystem',
  bundle: {
    id: 'payload-os',
    label: 'Payload OS',
    isPublicApi: false,
    // NOT a fourth API - and not a mere layer either. Payload OS is the
    // TWIN: the environment this repository is, used to visualize,
    // manage, track, index, log and mine the physical economy. The three
    // APIs are derived FROM it; it is not assembled from them.
    is: 'the twin - the operating environment over the physical economy',
    does: 'visualize, manage, track, index, log and mine physical-economy data',
    holds:
      'the shared operating, evidence, provenance, identity, corpus, release, policy, access and verification layer beneath all three products',
    rule: 'Payload OS is not one of the three public APIs and is not offered as a fourth. That is a statement about the API bundle, not a demotion: the OS is the twin the APIs are derived from.',
    naming:
      'the `Payload` corpus, profile and `payload-*` identifiers in this tree name the OS itself and are correct. They are not legacy compatibility names and must not be renamed away; what must never happen is Payload OS appearing in the product list beside Caravan, Tradewind and Landshark.',
    derivation:
      'the physical economy is the subject; the twin holds it as canonical state; each API is a DERIVATION over that state, scoped to one industry. This is the same relation the envelope names VERIFIED_DERIVATION - bound to the build it was derived from, not a member of it.',
  },
  apis: Object.freeze(['caravan', 'tradewind', 'landshark']),
});

export const APIS = Object.freeze([
  {
    id: 'caravan',
    label: 'Caravan API',
    sector: 'Logistics · Freight · Cargo · Maritime supply chain',
    derivedFrom:
      'the movement half of the physical economy the twin holds: corridors, chokepoints, ports, facilities and the flows over them',
    task: 'Inspect a bounded logistics slice: party/site/shipment resolution, movement lineage, changes, and exceptions.',
    objectClasses: ['shipment', 'load', 'container', 'voyage', 'party', 'node', 'milestone'],
    job: 'move physical goods',
    notTheJob: 'the price of a commodity; the zoning of a lot',
    status: 'FIRST_SLICE',
    statusNote:
      'the first planned customer-facing slice, and the only product with streams in this twin today',
    refuses: [
      'inferring a shipment from an observation - an aircraft track is a track, and promoting it to a movement record would invent a consignment nobody shipped',
      'price - that is Tradewind, and a corridor read that carried a price would be two products in one answer',
    ],
  },
  {
    id: 'tradewind',
    label: 'Tradewind API',
    sector: 'Commodities markets · Derivatives markets · Prediction markets',
    derivedFrom:
      'the pricing half of the same physical economy: what a cargo is worth, what its risk costs, and what a market believes about an event that would move it',
    task: 'Inspect market state, price/risk context, and its governed connection to a relevant movement.',
    objectClasses: ['instrument', 'contract', 'curve', 'print', 'position', 'event market', 'venue'],
    venueClasses:
      'three source classes under one product, each with its own rights profile: listed derivatives, physical commodity assessments, and prediction-market venues. A prediction market is a third venue class here, never a separate product and never a venue clone.',
    job: 'price and risk',
    notTheJob: 'track a truck',
    status: 'SHELL',
    statusNote:
      'four market streams exist and are honest about what they are, but this is a compatible shell rather than a released product: no Tradewind release, rights profile or customer-service evidence exists',
    refuses: [
      'inferring physical delivery from market data - a settled contract is not a delivered cargo, and nothing in this twin may draw that line',
      'presenting a single venue as the market - each stream states the venue it read',
    ],
  },
  {
    id: 'landshark',
    label: 'Landshark API',
    sector: 'AEC - zoning, surveying, planning, development, and buy/sell/lease',
    derivedFrom:
      'the ground the physical economy stands on: the parcels facilities occupy, what may lawfully be built on them, and the process by which that changes',
    task: 'Inspect legal parcel, zoning, entitlement, and development context.',
    objectClasses: ['parcel', 'zone', 'survey', 'plan', 'entitlement', 'listing/lease', 'application', 'permit'],
    job: 'land as a legal and development object',
    notTheJob: 'clash detection in a BIM authoring tool',
    status: 'ABSENT',
    statusNote:
      'no stream in this twin powers Landshark. Zero routes, zero registered sources, and no parcel, zone, survey, plan or entitlement anywhere in the served corpus.',
    reason:
      'the twin holds facilities and corridors, which are physical-economy objects, not legal-geometry objects. A parcel is a legal instrument with an owner, a boundary of record and an entitlement history; nothing here has any of the three, and a facility point is not a parcel however close its coordinates.',
    unblockedBy:
      'a parcel source with lawful intake and a rights profile - the charter names the four gates (source, release, rights, customer-service evidence) and Landshark currently has none of them',
    refuses: [
      'implying an action or entitlement beyond evidenced state - the whole product is a claim about legal status, and an unevidenced legal claim is the worst thing this system could serve',
      'becoming a listings portal - a listing is an observation on a parcel, not the product',
    ],
  },
]);

/**
 * Which product each served stream powers.
 *
 * `role`:
 *   core    - a record of the product's own object class
 *   context - informs the product without being one of its records
 *   shared  - Payload OS substrate, standing under all three
 */
export const STREAM_OWNERS = Object.freeze({
  // ---- Caravan: the logistics slice itself
  '/api/snapshot': { api: 'caravan', role: 'core', stream: 'the served corpus: facilities, corridors and the flows over them' },
  '/api/entities': { api: 'caravan', role: 'core', stream: 'facility and node resolution' },
  '/api/search': { api: 'caravan', role: 'core', stream: 'lexical retrieval over the slice' },
  '/api/states': { api: 'caravan', role: 'core', stream: 'per-entity state across the corpus' },
  '/api/state/(?<entityId>[^/]+)': { api: 'caravan', role: 'core', stream: 'one entity state, with its reading basis' },
  '/api/deviations/(?<entityId>[^/]+)': { api: 'caravan', role: 'core', stream: 'exceptions against an entity baseline' },
  '/api/scenarios': { api: 'caravan', role: 'core', stream: 'declared disruption scenarios over the corridors' },
  '/api/scenarios/(?<scenarioId>[^/]+)/impact': { api: 'caravan', role: 'core', stream: 'modelled impact of one scenario' },
  '/api/scenarios/rank': { api: 'caravan', role: 'core', stream: 'scenarios ranked by modelled impact' },
  '/api/scenarios/inject': { api: 'caravan', role: 'core', stream: 'counterfactual injection through the upstream engine' },
  '/api/mining/patterns': { api: 'caravan', role: 'core', stream: 'mined structural candidates over the slice' },
  '/api/operations': { api: 'caravan', role: 'core', stream: 'the freight operations mirror - loads under process control' },
  '/api/operations/communications': { api: 'caravan', role: 'core', stream: 'carrier communication timeline' },
  '/api/operations/fuel': { api: 'caravan', role: 'core', stream: 'fuel and diesel desk reference' },

  // ---- Caravan CONTEXT: informs movement, is not a movement record
  '/api/live/aircraft': { api: 'caravan', role: 'context', stream: 'observed air traffic around a point (ADS-B)' },
  '/api/live/satellites': { api: 'caravan', role: 'context', stream: 'orbital element sets - positions must be COMPUTED, never read' },
  '/api/live/quakes': { api: 'caravan', role: 'context', stream: 'seismic events above a stated magnitude floor' },
  '/api/live/fires': { api: 'caravan', role: 'context', stream: 'thermal anomalies (VIIRS NRT)' },

  // ---- Tradewind
  '/api/markets/fx': { api: 'tradewind', role: 'core', stream: 'daily central-bank reference fixes' },
  '/api/markets/crypto': { api: 'tradewind', role: 'core', stream: 'single-venue prints and 24h statistics' },
  '/api/markets/derivatives': { api: 'tradewind', role: 'core', stream: 'venue marks, open interest and funding' },
  '/api/markets/broker': { api: 'tradewind', role: 'core', stream: 'read-only broker session identity - no order capability' },

  // ---- Landshark: nothing. Deliberately, and stated on the product row.

  // ---- Payload OS: the shared layer under all three
  '/api/corpus/definition': { api: 'payload-os', role: 'shared', stream: 'the corpus as a self-describing artifact' },
  '/api/corpus/commitments': { api: 'payload-os', role: 'shared', stream: 'the commitment manifest and inclusion proofs' },
  '/api/notation/resolve': { api: 'payload-os', role: 'shared', stream: 'identity resolution over the notation:// space' },
  '/api/notation/space': { api: 'payload-os', role: 'shared', stream: 'the identity space and its measured id shapes' },
  '/api/vocabulary/alignment': { api: 'payload-os', role: 'shared', stream: 'provenance-vocabulary alignment across apparatuses' },
  '/api/refusals': { api: 'payload-os', role: 'shared', stream: 'the upstream refusal digest' },
  '/api/health': { api: 'payload-os', role: 'shared', stream: 'instance liveness' },
  '/api/capabilities': { api: 'payload-os', role: 'shared', stream: 'the capability catalog and its probes' },
  '/api/security/posture': { api: 'payload-os', role: 'shared', stream: 'the security model as an operator surface' },
  '/api/system/topology': { api: 'payload-os', role: 'shared', stream: 'the control-plane topology' },
  '/api/ecosystem/register': { api: 'payload-os', role: 'shared', stream: 'the apparatus register' },
  '/api/planes': { api: 'payload-os', role: 'shared', stream: 'the API constitution' },
  '/api/platform': { api: 'payload-os', role: 'shared', stream: 'the data-platform position' },
  '/api/products': { api: 'payload-os', role: 'shared', stream: 'the three-product stream register' },
});

export function ownerOf(pattern) {
  return STREAM_OWNERS[pattern] ?? null;
}

/** Coverage, derived from the map rather than carried beside it. */
export function streamCoverage(patterns) {
  const assigned = [];
  const unassigned = [];
  for (const p of patterns) {
    const row = ownerOf(p);
    if (row) assigned.push({ pattern: p, ...row });
    else unassigned.push(p);
  }
  const byApi = {};
  for (const id of [...PRODUCT_HIERARCHY.apis, 'payload-os']) byApi[id] = { core: 0, context: 0, shared: 0, total: 0 };
  for (const a of assigned) {
    const b = byApi[a.api];
    if (!b) continue;
    b[a.role] = (b[a.role] ?? 0) + 1;
    b.total += 1;
  }
  return {
    total: patterns.length,
    assigned: assigned.length,
    unassigned,
    byApi,
    stale: Object.keys(STREAM_OWNERS).filter((k) => !patterns.includes(k)),
    empty: PRODUCT_HIERARCHY.apis.filter((id) => byApi[id].total === 0),
  };
}

export function apiRegister(patterns = Object.keys(STREAM_OWNERS)) {
  return {
    hierarchy: PRODUCT_HIERARCHY,
    apis: APIS,
    streams: STREAM_OWNERS,
    coverage: streamCoverage(patterns),
    axes:
      'a stream carries three independent facts: its PLANE (who may read it), its LIMB (what kind of answer it is) and its API (which product owns it). None is derivable from the others.',
  };
}
