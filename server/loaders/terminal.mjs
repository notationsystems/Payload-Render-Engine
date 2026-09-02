/**
 * Terminal-projections corpus loader — the twin fed by payload-terminal-v0.
 *
 * Consumes the Terminal's route-per-capability projections over HTTP
 * (GET /api/economy?commodity=X, /api/economy/table?limit=0,
 * /api/infrastructure) and maps them into a WorldSnapshot. Studied,
 * not copied: every mapping below is an EXPLICIT table over upstream
 * FIELDS — never a semantic derived from an id string — and every
 * record that cannot map is excluded WITH ITS REASON COUNTED, never
 * silently dropped and never guessed into a kind.
 *
 * Admissibility is EARNED PER RECORD here, using the Terminal's own
 * rule (its validator semantics): a value whose value_kind is
 * 'representative' is inadmissible as real-world evidence; everything
 * else is admissible. The corpus therefore MIXES admissible reported/
 * estimated observations with inadmissible representative ones, and
 * each record says which it is — that is the entire point of this
 * loader over the synthetic one.
 *
 * What this corpus honestly does NOT have:
 *   - promises (assertions): the projections carry no transit promises
 *     → /api/deviations refuses with NO_ASSERTIONS, correctly
 *   - deterministic dynamics: no state variables are observed
 *     → readStateAt answers 'unobserved' / 'no_history', never a
 *       synthesized utilization
 *   - a counterfactual baseline → scenario routes refuse
 *   - routed path geometry: the Terminal serves flow ENDPOINTS only,
 *     so route geometry is a great-circle arc and says so via
 *     geometryBasis: 'great_circle_estimate'
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------ mapping tables

/** (upstream kind, upstream stage) → twin NodeKind. Field-based, exhaustive
 *  over the observed vocabulary; unmapped pairs are EXCLUDED + accounted. */
const NODE_KIND = new Map([
  ['mine|*', 'mine'],
  ['smelter|*', 'smelter'],
  ['refinery|*', 'refinery'],
  ['port|*', 'port'],
  ['region|manufacturing', 'manufacturing_cluster'],
  ['region|demand', 'consumption_center'],
  ['region|*', 'region'],
  ['infrastructure|logistics', 'chokepoint'],
  // the stage-less infrastructure entities in the corpus are hydropower
  // (Kemano, the Norwegian grid) — recorded here, revisit if upstream
  // adds stage-less infrastructure that is not power
  ['infrastructure|', 'power_plant'],
]);

const nodeKindOf = (kind, stage) =>
  NODE_KIND.get(`${kind}|${stage ?? ''}`) ?? NODE_KIND.get(`${kind}|*`);

/** Terminal flow mode → twin TransportMode. 'internal' movement carries
 *  no stated inter-facility mode → 'unspecified', never defaulted. */
const FLOW_MODE = new Map([
  ['sea', 'maritime'],
  ['rail', 'rail'],
  ['road', 'road'],
  ['pipeline', 'pipeline'],
  ['mixed', 'multimodal'],
  ['internal', 'unspecified'],
  ['unknown', 'unspecified'],
]);

/** Terminal event type → twin WorldEvent category. The upstream type is
 *  preserved in evidence either way. */
const EVENT_CATEGORY = new Map([
  ['policy', 'policy'],
  ['sanction', 'sanction'],
  ['disruption', 'incident'],
  ['strike', 'strike'],
  ['demand_surge', 'demand_surge'],
  ['closure', 'closure'],
  ['weather', 'weather'],
]);

/** Declared severity class → the twin's 0..1 scale. A PROJECTION CHOICE,
 *  documented here: the class survives in evidence, the number is ours. */
const SEVERITY = new Map([
  ['low', 0.3],
  ['medium', 0.6],
  ['high', 0.85],
]);

/** Nuclear facility status strings → twin LifecycleStatus. Exact strings
 *  from the corpus plus the live-enrichment prefix; anything else maps
 *  'unknown' — never guessed operational. */
const NUCLEAR_STATUS = new Map([
  ['Operational', 'active'],
  ['Operational (Extended)', 'active'],
  ['Partially Operational', 'degraded'],
  ['Partial Shutdown', 'degraded'],
  ['Suspended', 'inactive'],
  ['Under Construction', 'planned'],
  ['Decommissioned / Exclusion Zone', 'inactive'],
  ['Destroyed / Decommissioning', 'inactive'],
  ['Active Conflict Zone', 'disrupted'],
]);
const nuclearStatusOf = (s) =>
  NUCLEAR_STATUS.get(s) ?? (s.startsWith('SEISMIC RISK') ? 'degraded' : 'unknown');

/** The Terminal's admissibility rule, adopted verbatim: representative
 *  values are inadmissible for claims about the real world. */
const admissibleOf = (valueKind) => valueKind !== 'representative';

const COMMODITIES = [
  { key: 'copper', id: 'commodity:copper', name: 'Copper', unit: 'kt/y' },
  { key: 'aluminium', id: 'commodity:aluminium', name: 'Aluminium', unit: 'kt/y' },
];

// ------------------------------------------------------------------ helpers

const DEG = Math.PI / 180;

function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b[1] - a[1]) * DEG;
  const dLon = (b[0] - a[0]) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * DEG) * Math.cos(b[1] * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Densify [lon,lat]→[lon,lat] into a great-circle polyline (slerp). */
function greatCircleArc(a, b, n = 24) {
  const toVec = ([lon, lat]) => [
    Math.cos(lat * DEG) * Math.cos(lon * DEG),
    Math.cos(lat * DEG) * Math.sin(lon * DEG),
    Math.sin(lat * DEG),
  ];
  const va = toVec(a);
  const vb = toVec(b);
  const dot = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-6) return [a, b];
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const s1 = Math.sin((1 - t) * omega) / Math.sin(omega);
    const s2 = Math.sin(t * omega) / Math.sin(omega);
    const x = s1 * va[0] + s2 * vb[0];
    const y = s1 * va[1] + s2 * vb[1];
    const z = s1 * va[2] + s2 * vb[2];
    pts.push([Math.atan2(y, x) / DEG, Math.asin(z / Math.hypot(x, y, z)) / DEG]);
  }
  return pts;
}

const isoDay = (d) => (d && d.length === 10 ? `${d}T00:00:00Z` : d);

// -------------------------------------------------------------------- loader

/**
 * @param baseUrl   Terminal base URL (default http://127.0.0.1:3000)
 * @param fetchImpl injectable transport; tests pass the fixture reader
 * @param fetchedAt capture instant override (fixtures carry their own)
 */
export async function loadTerminalCorpus({
  baseUrl = process.env.TERMINAL_URL ?? 'http://127.0.0.1:3000',
  fetchImpl,
  fetchedAt,
} = {}) {
  const getJson = fetchImpl ?? (async (path) => {
    const res = await fetch(`${baseUrl}${path}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`terminal upstream ${path} → HTTP ${res.status}`);
    return res.json();
  });

  const now = fetchedAt ?? new Date().toISOString();

  const perCommodity = [];
  for (const c of COMMODITIES) {
    perCommodity.push({
      c,
      root: await getJson(`/api/economy?commodity=${c.key}`),
      table: await getJson(`/api/economy/table?commodity=${c.key}&format=json&limit=0`),
    });
  }
  const infra = await getJson('/api/infrastructure');

  // conservation accounting: every upstream record lands in exactly one
  // bucket — mapped, or excluded with a reason
  const excluded = [];
  const account = (id, reason) => excluded.push({ id, reason });

  const nodes = [];
  const routes = [];
  const flows = [];
  const events = [];
  const observations = [];
  const fingerprints = [];
  // what the upstream DECLARES it holds vs what this capture DELIVERED vs
  // what mapped — a gap here is a fact about the projection, on the record
  const upstreamReconciliation = [];

  // valueKind is a CLAIM about the record's evidence class — parameterized
  // so a loader-derived record (a minted route) says 'derived', never a
  // class the upstream didn't earn
  const nodeProv = (evidence, valueKind = 'reported') => ({
    source: 'terminal:projection',
    knownAt: now,
    evidence,
    valueKind,
    admissible: admissibleOf(valueKind),
  });

  // ------------------------------------------------------------ economy
  const routeIndex = new Map(); // `${from}|${to}|${mode}` → route id
  for (const { c, root, table } of perCommodity) {
    const fp = root.attribution?.state?.fingerprint ?? 'unknown';
    fingerprints.push(`${c.key}:${fp}`);
    const upstream = `${baseUrl}/api/economy?commodity=${c.key}`;
    upstreamReconciliation.push({
      commodity: c.key,
      fingerprint: fp,
      declared: {
        observations: root.attribution?.state?.observations ?? null,
        flows: root.attribution?.state?.flows ?? null,
      },
      delivered: {
        entities: root.econ_entities.length,
        flows: root.econ_flows.length,
        events: root.econ_events.length,
        tableRows: table.rows.length,
      },
      note: 'declared counts are the upstream state; the map view and table deliver a projection of it (e.g. flows without mappable geo endpoints are not served) — the gap is upstream filtering, not loader loss',
    });

    for (const e of root.econ_entities) {
      const kind = nodeKindOf(e.kind, e.stage);
      if (!kind) {
        account(e.id, `unmapped kind/stage ${e.kind}|${e.stage}`);
        continue;
      }
      nodes.push({
        id: e.id,
        kind,
        name: e.name,
        geometry: { type: 'Point', coordinates: [e.lng, e.lat] },
        status: e.disrupted ? 'disrupted' : 'active',
        provenance: nodeProv([
          `upstream:${upstream}`,
          `fingerprint:${fp}`,
          `geoPrecision:${e.geoPrecision ?? 'region'}`,
        ]),
        // derived visual weight (LOD), not a data claim
        importance: kind === 'port' ? 0.65 : kind === 'chokepoint' ? 0.75 : kind === 'mine' ? 0.6 : 0.55,
        operator: e.operator ?? undefined,
        tags: [
          `commodity:${c.key}`,
          e.stage ? `stage:${e.stage}` : 'stage:unstated',
          `geo:${e.geoPrecision ?? 'region'}`,
        ],
      });
    }

    const nodeIds = new Set(nodes.map((n) => n.id));
    const maxQty = Math.max(...root.econ_flows.map((f) => f.quantity ?? 0), 1);
    for (const f of root.econ_flows) {
      if (!nodeIds.has(f.from) || !nodeIds.has(f.to)) {
        account(f.id, 'endpoint not in mapped node set');
        continue;
      }
      const mode = FLOW_MODE.get(f.mode);
      if (!mode) {
        account(f.id, `unmapped mode ${f.mode}`);
        continue;
      }
      const rKey = `${f.from}|${f.to}|${mode}`;
      let routeId = routeIndex.get(rKey);
      if (!routeId) {
        routeId = `route:${f.id.replace(/^flow:/, '')}:${mode}`;
        routeIndex.set(rKey, routeId);
        const coords = greatCircleArc(f.fromCoord, f.toCoord);
        routes.push({
          id: routeId,
          kind: 'route',
          name: `${f.from.split(':').pop()} → ${f.to.split(':').pop()} (${mode})`,
          geometry: { type: 'LineString', coordinates: coords },
          status: f.disrupted ? 'disrupted' : 'active',
          // the route is minted BY THE LOADER from flow endpoints — derived
          provenance: nodeProv([`upstream:${upstream}`, `derived_from:${f.id}`], 'derived'),
          importance: 0.5,
          mode,
          originId: f.from,
          destinationId: f.to,
          distanceKm: Math.round(haversineKm(f.fromCoord, f.toCoord)),
          // no promises upstream: estimatedDurationHours / capacity /
          // utilization deliberately ABSENT — absence is not zero
          constraints: [],
          historicalState: [],
          bidirectional: false,
          geometryBasis: 'great_circle_estimate',
        });
      }
      flows.push({
        id: f.id,
        name: `${f.form} ${f.from.split(':').pop()} → ${f.to.split(':').pop()}`,
        commodityId: c.id,
        originId: f.from,
        destinationId: f.to,
        segments: [
          { id: `${f.id}:seg0`, routeId, mode, fromNodeId: f.from, toNodeId: f.to, sequence: 0 },
        ],
        // per-commodity normalized visual weight, not a data claim
        intensity: Math.max(0.08, (f.quantity ?? 0) / maxQty),
        status: f.disrupted ? 'delayed' : 'moving',
        provenance: {
          source: 'terminal:projection',
          knownAt: now, // flows carry no upstream knownAt; this is when the TWIN learned them
          evidence: [
            `upstream:${upstream}`,
            `quantity:${f.quantity} ${f.unit}`,
            `confidence:${f.confidence}`,
            `basis:${f.basis ?? 'unspecified'}`,
            'curation:loader-stamped estimated (upstream flow records carry confidence but no value_kind)',
          ],
          // the honest class for an annual trade-flow estimate; stamped by
          // the loader and stated as such above, evaluated per record
          valueKind: 'estimated',
          admissible: admissibleOf('estimated'),
        },
        tags: [`form:${f.form}`, `commodity:${c.key}`],
      });
    }

    for (const ev of root.econ_events) {
      // strict tables, like nodes and flows: an unmapped type or severity
      // class is excluded + accounted, never guessed into a default
      const category = EVENT_CATEGORY.get(ev.type);
      if (!category) {
        account(ev.id, `unmapped event type ${ev.type}`);
        continue;
      }
      const severity = SEVERITY.get(ev.severity);
      if (severity === undefined) {
        account(ev.id, `unmapped severity class ${ev.severity}`);
        continue;
      }
      events.push({
        id: ev.id,
        name: ev.title,
        description: ev.description ?? ev.magnitude?.note ?? ev.title,
        affects: [ev.entityId],
        severity,
        start: isoDay(ev.start),
        end: ev.end ? isoDay(ev.end) : undefined,
        category,
        provenance: {
          source: 'terminal:projection',
          // bitemporal honesty: the event became KNOWABLE when first
          // reported, not when it started
          knownAt: isoDay(ev.firstReportedAt ?? ev.start),
          evidence: [
            `upstream:${upstream}`,
            `upstream_type:${ev.type}`,
            `severity_class:${ev.severity}`,
            `curation:${ev.curation ?? 'unstated'}`,
          ],
          // valueKind/admissible deliberately ABSENT: the upstream event
          // records emit no evidence class, and asserting one here would
          // fabricate a standing the record never earned. Absent = not
          // evaluated, which is a different fact from either answer.
        },
      });
    }

    for (const r of table.rows) {
      // twin-side id is namespaced by the commodity table the row came
      // from — a loader-held field, not anything parsed from an id. The
      // Terminal's usgs-mcs source reuses record ids ACROSS commodity
      // tables (obs:usgs-mcs2025:production:au:2023 exists in copper AND
      // aluminium with different values), so the upstream id alone would
      // silently collapse 31 real records into one for any id-keyed
      // consumer. The upstream id survives in evidence.
      const twinId = `${c.key}:${r.record_id}`;
      if (r.refusal) {
        account(twinId, `upstream refusal: ${r.refusal.type}`);
        continue;
      }
      if (r.value === null || r.value === undefined || !r.value_kind) {
        account(twinId, 'no value / no value_kind');
        continue;
      }
      observations.push({
        id: twinId,
        entityId: r.subject_id,
        t: isoDay(r.period_end),
        metric: r.metric,
        value: r.value,
        unit: r.unit ?? undefined,
        provenance: {
          source: 'terminal:projection',
          knownAt: isoDay(r.known_at) ?? now,
          validFrom: isoDay(r.period_start),
          validTo: isoDay(r.period_end),
          evidence: [
            `upstream_record:${r.record_id}`,
            `commodity:${c.key}`,
            ...(r.subject_label ? [`subject_label:${r.subject_label}`] : []),
            `source:${r.source_id ?? 'unstated'}`,
            `source_name:${r.source_name ?? 'unstated'}`,
            `confidence:${r.confidence ?? 'unstated'}`,
            `basis:${r.basis ?? 'unspecified'}`,
            ...(r.supersedes ? [`supersedes:${r.supersedes}`] : []),
            ...(r.attestation ? [`attestation:${r.attestation}`] : []),
          ],
          // the per-record admissibility switch, earned or not per THIS record
          valueKind: r.value_kind,
          admissible: admissibleOf(r.value_kind),
        },
      });
    }
  }

  // ------------------------------------------------------- infrastructure
  // curated real-facility list; upstream carries NO provenance fields, so
  // the stamp below is the loader's own curation class, stated as such
  for (const f of infra.infrastructure) {
    nodes.push({
      id: f.id,
      kind: 'power_plant',
      name: f.name,
      geometry: { type: 'Point', coordinates: [f.lng, f.lat] },
      status: nuclearStatusOf(f.status),
      provenance: {
        source: 'terminal:projection',
        knownAt: now,
        evidence: [
          `upstream:${baseUrl}/api/infrastructure`,
          `upstream_status:${f.status}`,
          'curation:loader-stamped (upstream carries no provenance fields)',
        ],
        valueKind: 'reported',
        admissible: admissibleOf('reported'),
      },
      importance: 0.45,
      operator: f.owner ?? undefined,
      capacity: f.capacityMW != null ? { value: f.capacityMW, unit: 'MW' } : undefined,
      tags: ['sector:nuclear', `country:${f.country}`, `reactors:${f.reactors}`],
    });
  }

  // --------------------------------------------------------------- corpus
  // event `affects` refs can name entities the projection does not carry
  // (ent:company:*, ent:country:*) — the event stays, the unresolved ref
  // is moved to evidence and RECORDED, so nothing dangles silently
  const allEntityIds = new Set([
    ...nodes.map((n) => n.id),
    ...routes.map((r) => r.id),
    ...flows.map((f) => f.id),
  ]);
  const unresolvedRefs = [];
  for (const ev of events) {
    const resolved = ev.affects.filter((id) => allEntityIds.has(id));
    const dangling = ev.affects.filter((id) => !allEntityIds.has(id));
    if (dangling.length) {
      ev.affects = resolved;
      ev.provenance.evidence.push(...dangling.map((id) => `affects_unresolved:${id}`));
      unresolvedRefs.push({ eventId: ev.id, refs: dangling });
    }
  }

  // the corpus covers an instant if evidence DESCRIBES it (valid time) or
  // was KNOWN by it (transaction time) — start must honor both, or the
  // range refusal lies about records the snapshot itself carries
  const knownAts = observations.map((o) => Date.parse(o.provenance.knownAt)).filter(Number.isFinite);
  const validTimes = observations
    .flatMap((o) => [Date.parse(o.t), Date.parse(o.provenance.validFrom ?? '')])
    .filter(Number.isFinite);
  const eventStarts = events.map((e) => Date.parse(e.start)).filter(Number.isFinite);
  const startMs = Math.min(...knownAts, ...validTimes, ...eventStarts, Date.parse(now));

  const snapshot = {
    nodes,
    routes,
    flows,
    commodities: COMMODITIES.map((c) => ({
      id: c.id,
      name: c.name,
      category: 'metals',
      unit: c.unit,
      provenance: { source: 'terminal:projection', knownAt: now },
    })),
    events,
    constraints: [],
    assertions: [], // the projections carry no promises — honestly empty
    observations,
    cityLights: [],
    timeRange: {
      start: new Date(startMs).toISOString(),
      end: now,
      now,
    },
    meta: {
      label: `Payload Terminal projection — ${COMMODITIES.map((c) => c.key).join(' + ')}`,
      disclaimer:
        'PROJECTED FROM PAYLOAD-TERMINAL-V0 — mixed admissibility: every record carries its own valueKind/admissible; representative-class records are NOT evidence about the real world',
      generatedAt: now,
    },
  };

  // RELATE: derive the facility↔material fields the query surface
  // answers from — from what the upstream itself declares. A facility
  // OUTPUTS a commodity when a production observation names it as the
  // subject; it INPUTS one when a declared flow of that commodity
  // terminates at it. Loader curation over upstream declarations —
  // never name inference — counted in the mapping report.
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  let outputsDerived = 0;
  let inputsDerived = 0;
  for (const o of observations) {
    if (o.metric !== 'production') continue;
    const n = nodeById.get(o.entityId);
    if (!n) continue;
    const tag = o.provenance.evidence?.find((e) => e.startsWith('commodity:'));
    if (!tag) continue;
    const cid = `commodity:${tag.slice('commodity:'.length)}`;
    n.outputs = n.outputs ?? [];
    if (!n.outputs.includes(cid)) {
      n.outputs.push(cid);
      outputsDerived++;
    }
  }
  for (const f of flows) {
    if (!f.commodityId) continue;
    const n = nodeById.get(f.destinationId);
    if (!n) continue;
    n.inputs = n.inputs ?? [];
    if (!n.inputs.includes(f.commodityId)) {
      n.inputs.push(f.commodityId);
      inputsDerived++;
    }
  }
  // a node is CONNECTED to the routes that declare it as an endpoint
  let routeLinksDerived = 0;
  for (const r of routes) {
    for (const endId of [r.originId, r.destinationId]) {
      const n = nodeById.get(endId);
      if (!n) continue;
      n.connectedRouteIds = n.connectedRouteIds ?? [];
      if (!n.connectedRouteIds.includes(r.id)) {
        n.connectedRouteIds.push(r.id);
        routeLinksDerived++;
      }
    }
  }

  // entities with at least one observation answer 'unobserved' (evidence
  // exists, but the state channel at t was never measured); everything
  // else answers 'no_history'. NOTHING here synthesizes a state.
  const observedIds = new Set(observations.map((o) => o.entityId));

  return {
    kind: 'terminal',
    snapshot,
    scenarios: [],
    // no scenarioEngine: a corpus with no observed baseline cannot answer
    // counterfactuals; the API refuses rather than fabricating one
    readStateAt: (id) => ({ reading: observedIds.has(id) ? 'unobserved' : 'no_history' }),
    metaDefaults: {
      sourceClass: 'terminal:projection',
      // no blanket class: the switch lives on each record
      valueKind: 'per_record',
      admissible: null, // corpus-level admissibility is NOT a fact for a mixed corpus
      admissibleBasis: 'earned_per_record',
      // one capture of the upstream state. The corpus CONTAINS revision
      // chains (supersedes in evidence) but this projection cannot replay
      // them — so as_known_then is REFUSED, not silently aliased
      vintages: 1,
    },
    // knowledge modes this corpus can honestly answer: a single capture
    // with unreplayable revision chains speaks best_known only
    knowledgeModes: ['best_known'],
    attributionExtra: {
      upstream: {
        service: 'payload-terminal-v0',
        baseUrl,
        fingerprints,
        fetchedAt: now,
      },
    },
    // the loader's own conservation report, exposed for tests and /api/health
    mappingReport: {
      mapped: {
        nodes: nodes.length,
        routes: routes.length,
        flows: flows.length,
        events: events.length,
        observations: observations.length,
      },
      excluded,
      unresolvedRefs,
      upstreamReconciliation,
      // facility↔material relations derived from upstream declarations
      derivedFields: {
        outputsFromProductionObservations: outputsDerived,
        inputsFromFlowDestinations: inputsDerived,
        routeLinksFromDeclaredEndpoints: routeLinksDerived,
      },
    },
  };
}

/** Fixture-backed transport: replays the committed capture of a live
 *  Terminal (real bytes, not fabrications — see fixtures/terminal/capture.json). */
export async function fixtureFetch(path) {
  const FIXTURES = new Map([
    ['/api/economy?commodity=copper', 'economy-copper.json'],
    ['/api/economy?commodity=aluminium', 'economy-aluminium.json'],
    ['/api/economy/table?commodity=copper&format=json&limit=0', 'table-copper.json'],
    ['/api/economy/table?commodity=aluminium&format=json&limit=0', 'table-aluminium.json'],
    ['/api/infrastructure', 'infrastructure.json'],
  ]);
  const file = FIXTURES.get(path);
  if (!file) throw new Error(`no fixture for ${path}`);
  return JSON.parse(await readFile(resolve(HERE, '../fixtures/terminal', file), 'utf8'));
}
