# PAYLOAD EARTH — ARCHITECTURE

This document is the engineering record for the digital-twin client. The code
is the ground truth; everything below cites the files that enforce it.

## 1. The digital-twin stance

The renderer is a **projection** of Payload state. It is never authoritative
and never mutates canonical state. Everything visual — globe, routes, particle
flows, panels — is derived from immutable snapshots handed across a typed
boundary; view-level operations (select, focus, toggle layer, scrub time) act
on the projection only.

```
┌──────────────────────────────────────────────────────────────┐
│                          PAYLOAD                             │
│  (DAF → Canonical State → Spatial Corpus → PostGIS → API)    │
└───────────────────────────┬──────────────────────────────────┘
                            │ WorldSnapshot / stateAt()
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  CANONICAL STATE (contracts.ts)                              │
│    entities · routes · flows · assertions · observations     │
└───────────────────────────┬──────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  SPATIAL STATE / GRAPH (store.ts)                            │
│    indexes · joins · temporal resolution · search            │
└───────────────────────────┬──────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  VISUALIZATION API (app/api.ts — AppApi facade)              │
└───────────────────────────┬──────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  DIGITAL TWIN CLIENT (UI · command bar · timeline · panels)  │
└───────────────────────────┬──────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  EARTH / ROUTES / ENTITIES (earth/*, layers/*, geo/*)        │
└───────────────────────────┬──────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  RENDERER (three.js scene, GPU particles, LOD)               │
└──────────────────────────────────────────────────────────────┘
```

State flows down; nothing flows back up. UI components receive `AppApi` and
nothing else — they never import renderer internals and never mutate data
(`src/app/api.ts` header comment is the contract).

## 2. The seam and its mechanical enforcement

The semantic layer, `src/data/**`, is **renderer-blind by structure, not by
discipline**. `scripts/check-seam.mjs` walks every `.ts` file under
`src/data/` and fails the build on:

- any **bare-module import** (`three`, DOM libs, anything from npm — the data
  layer imports no packages at all), and
- any **relative import that escapes** `src/data/`,

with exactly two allowed pure-kernel exceptions:
`src/core/events.ts` (the typed `EventBus`) and `src/core/time.ts`
(`SimClock`). Both are dependency-free, erasable TypeScript.

The check runs as the first step of `npm run check` (which `npm run build`
runs first). If the renderer ever leaks into canonical-state land, the build
breaks instead of a reviewer having to notice. A useful side effect: because
`src/data` is pure, erasable TypeScript, Node can execute it directly via
type stripping — which is exactly what the provenance check does.

## 3. Provenance discipline

Every record that claims to describe the world carries a `Provenance` block
(`contracts.ts`): `source`, `knownAt`, optional validity window, evidence
descriptors, and confidence. The `source` field is the same field real data
will use:

- today: `'synthetic:demo'`
- tomorrow: `'payload:canonical'`, `'payload:spatial'`, `'external:ais'`,
  `'external:osm'`, `'external:gov-gis'`, ...

`scripts/validate-provenance.mjs` does not lint types — it **executes the
real dataset** (`buildWorldSnapshot()` from `src/data/synthetic/world.ts`)
and fails the build if any node, route, flow, commodity, event, constraint,
assertion, or observation lacks `provenance.source`.

The point: **"is this real?" is a query, not a memory.** The inspector, the
disclaimer, and any future mixed-provenance world all read the same field on
the same records; swapping synthetic data for corpus data touches providers,
never the render layer.

Related: `Route.geometryBasis` (`'routed' | 'great_circle_estimate' |
'synthetic_corridor'`) keeps *what the geometry is* queryable too — a straight
arc over a lake is not where the truck goes, and that difference must never
become cosmetic.

## 4. Promises vs evidence

`contracts.ts` splits claims into three distinct record types, never one
field overwritten by another:

- **`Assertion`** — a promise: something the system claims about an entity
  (`transit_hours`, `capacity`, `dwell_hours`), with its own provenance and
  `assertedAt`.
- **`Observation`** — evidence: a timestamped measurement, with its own
  provenance.
- **`Deviation`** — the join: `delta = observed − asserted`,
  `ratio = observed / asserted`, referencing both records.

`WorldStore.deviationsFor(entityId)` (`store.ts`) performs this join **on
demand**, matching assertions to observations by metric and computing the
mean observed value; nothing is stored back, nothing is overwritten.

`Route.estimatedDurationHours` and `Route.capacity` are convenience
projections of the current assertion of record. They must **never** be
overwritten by outcomes: the deviation history *is* the point. A twin that
replaces its estimate with the actual forgets that it was wrong; this one
keeps both records so it can show where its own estimates run optimistic —
per entity, per metric, over time.

## 5. Data contracts inventory

All shapes live in `src/data/contracts.ts` (provider-independent, WGS84
lon/lat, GeoJSON-compatible geometry subset):

| Area | Types |
|---|---|
| Identity / provenance | `EntityId`, `Timestamp`, `DataSource`, `Provenance`, `LifecycleStatus` |
| Geometry | `LonLat`, `PointGeometry`, `LineStringGeometry`, `Geometry` |
| Ontology | `TransportMode` (road/rail/maritime/air), `NodeKind` (ports … chokepoints), `EntityKind` |
| Base | `Entity` (id, kind, name, geometry, status, provenance, `importance` 0..1 for LOD, country, tags) |
| Facilities | `Facility` + `Port`, `Airport`, `RailTerminal`, `Warehouse`; `QuantityRating` |
| Routes | `Route` (first-class semantic object: origin/destination, distance, promised duration, capacity, utilization, `constraints`, `historicalState` samples, `geometryBasis`), `RouteConstraint`, `RouteStateSample`, `TransportSegment` |
| Commodities / flows | `Commodity`, `Flow` (chain of `TransportSegment`s; `intensity` drives particle density) |
| Promises vs evidence | `Assertion`, `Observation`, `Deviation` |
| Constraints / events | `Constraint`, `WorldEvent` |
| Temporal | `TemporalRegime`, `TemporalState`, `EntityState` |
| Snapshot | `WorldSnapshot` — nodes, routes, flows, commodities, events, constraints, assertions, observations, cityLights, timeRange, meta (label + **disclaimer**) |

### The provider interface

`src/data/provider.ts` defines `SpatialDataProvider` — the only thing the
twin client ever talks to for data:

```ts
interface SpatialDataProvider {
  readonly id: string;
  readonly label: string;
  load(): Promise<WorldSnapshot>;                       // initial hydration
  stateAt(entityId: EntityId, t: Timestamp): EntityState; // deterministic
  query?(viewport: ViewportQuery): Promise<Partial<WorldSnapshot>>; // optional
  subscribe?(onDelta: (delta: Partial<WorldSnapshot>) => void): () => void; // optional
}
```

`SyntheticProvider` (`src/data/synthetic/provider.ts`) implements it today:
all dynamic state is a pure function of `(entityId, t)` — hash-seeded
sinusoids plus smooth event ramps, no randomness, no wall clock. A Payload
Spatial API client implements the same interface tomorrow:

- `load()` / `stateAt()` are mandatory;
- `query(viewport)` enables server-side spatial filtering — bbox, camera
  altitude, and minimum importance map naturally onto PostGIS window queries
  and vector tiles;
- `subscribe()` enables push deltas from canonical state.

The future-integration path is provider-independence end to end:
**DAF → Canonical State → Spatial Corpus → PostGIS → Spatial API → Twin** —
the renderer changes for none of these steps.

`WorldStore` (`src/data/store.ts`) sits on top of whichever provider is
plugged in: it indexes the snapshot (nodes, routes-by-node, flows-by-route,
assertions/observations-by-entity), resolves temporal state through the
provider (`stateAt`), computes deviations, filters active events, and serves
scored fuzzy search. It is read-only by design and renderer-blind by the
seam check.

## 6. Rendering architecture

Three.js scene composed from independent modules:

- **Earth** (`src/earth/*`, `src/geo/texture.ts`): procedural equirectangular
  day/night/mask textures generated at boot from Natural Earth 50m land
  topology (world-atlas TopoJSON in `public/data/`) plus corpus city lights.
  No external imagery — the planet is drawn, not photographed; seeded
  generation makes every boot identical. Atmosphere, graticule, and starfield
  are separate scene modules.
- **Countries** (`src/geo/countries.ts`): Natural Earth 110m borders as line
  geometry, point-in-polygon picking on lon/lat, selection outlines.
- **Routes** (`src/layers/routesLayer.ts`): per-mode route rendering — each
  `TransportMode` gets its palette color (`src/app/palette.ts`) and its
  routes are drawn as polylines on the sphere, driven by the semantic
  `Route` records, never decorative.
- **Flow particles** (`src/layers/flowsLayer.ts`): route polylines are baked
  into a float `DataTexture` (one row per route, 128 arc-length samples);
  each particle is `(row, phase, speed)` and the **vertex shader** advances
  phase with time and reads position from the texture — thousands of moving
  loads in one draw call with zero per-frame CPU geometry work. Particle
  density is proportional to `Flow.intensity`; particles are
  representational, not real shipments.
- **LOD / progressive disclosure**: camera altitude (`CameraFacade.
  altitudeRadii()`) and `Entity.importance` gate what is drawn and labeled —
  high orbit shows the skeleton, descending reveals detail (nodes layer,
  labels layer).
- **Layer compositing** (`src/layers/layerManager.ts`): the `LayerId` set
  from `api.ts` maps onto scene-object visibility; presets are curated layer
  combinations; `layersChange` events keep UI panels in sync.
- **Camera** (`src/core/cameraController.ts` behind `CameraFacade`): fly-to,
  route framing, and the cinematic follow-path dolly used by Follow the Load.

## 7. The command surface as a future agent tool surface

The command bar grammar lives in `src/app/commands.ts`: pure functions
(`executeCommand`, `suggestCommands`) over the `AppApi` facade — no module
state, no DOM. Every operation an agent would need is already expressed as a
facade call: layer toggles, presets, search/focus, flow filtering, clock
control, route comparison, the demo scenario.

`src/app/toolSurface.ts` implements the GeoAgent pattern: **one structured
registry of operations over `AppApi`** — each entry a name, a typed
parameter list, a description, an executor, and safety flags
(`destructive` / `longRunning` / `requiresConfirmation`, all false today
because every operation is a view operation on a mirror). The text grammar
in `commands.ts` is one front end to the same facade; an agent binding
(Payload agents, MCP, tool-use) consumes the registry directly — it is
exposed at runtime as `window.payloadEarth.tools` with
`window.payloadEarth.invokeTool(name, args)`. Capabilities stay defined
once; confirmation gates slot in without changing the shape the day a
mutating operation exists.

## 8. Temporal model

`SimClock` (`src/core/time.ts`) is the global temporal control: sim time is
scrubbed and played independently of the wall clock, configured against the
snapshot's `timeRange { start, end, now }`.

- **Regime**: `TemporalRegime` is derived from sim time vs the dataset's
  `now` — within ±30 minutes is `'current'`, before is `'historical'`, after
  is `'forecast'`. `'scenario'` overrides all three: while
  `SimClock.setScenario(id)` holds a scenario id, the clock reports the
  `'scenario'` regime and carries `scenarioId` in every `TemporalState`
  event (see §13).
- **Playback**: `tick(dtSeconds)` advances sim time at `speed` sim-seconds
  per wall-second (default 3600 = 1h/s; the `speed 6h` command sets 21600),
  clamping and pausing at the range end. `setFraction` scrubs; `jumpToNow`
  returns to the regime boundary.
- **Determinism**: every dynamic layer resolves entity state as
  `store.stateAt(entityId, clock.simTime)`, which delegates to the provider.
  The provider contract requires `stateAt` to be deterministic for a given
  `(entityId, t)` — the synthetic implementation is a pure hash-seeded
  function — so scrubbing is stable: the same instant always renders the
  same world. `world.ts` precomputes `Route.historicalState` with the same
  resolver, so the sparse temporal spine and live `stateAt()` agree by
  construction.

Clock changes fan out through the typed `EventBus` (`src/core/events.ts`) as
`TemporalState` events; the timeline UI, layers, and status bar all subscribe
to the same stream.

## 9. Two surfaces, one state: where this renderer sits

The Payload twin has levels, and they are not the same problem:

- **Levels 0–2 — the network twin** (where is everything, what is at risk,
  what does the flow look like). Two surfaces project it:
  - **The operator map** (Payload Terminal): MapLibre GL basemap +
    deck.gl moving/dense layers + Turf client-side spatial predicates +
    D3 side panels. Working-grain, dispatcher-facing.
  - **This renderer (Payload Earth)**: the cinematic planet-scale world
    view — custom Three.js globe, shader terminator, GPU flow particles.
    Situational-grain, world-facing.

  Both are projections over the same contracts through the same provider
  seam; neither is authoritative; they must never drift into two
  representations of state (the contracts in `src/data/contracts.ts` are
  the single vocabulary).

- **Levels 3–5 — the facility/asset twin** (a specific yard, dock or
  vehicle in real 3D). Game-engine territory (Unity/Isaac; BADOSE is a
  maritime-specific instance). Deferred, and only relevant if physical
  operations are ever operated directly.

**A twin is a state mirror, not a simulator.** Ocean-dynamics (Veros) and
vehicle-control (BADOSE) engines compute *what would happen* at the wrong
grain; the twin renders *what is happening* as observed state. The one
place simulation belongs is the counterfactual branch — propagation +
re-optimization over twin state, rendered as an explicitly marked
hypothetical frame (`TemporalRegime: 'scenario'` exists for exactly this,
and is now wired — see §13). A simulated outcome is not an outcome.

## 10. Disciplines carried from the Terminal

These are product requirements of the whole platform, present in this
renderer from the first record:

- **Provenance is a property of the record, not a label on the UI.**
  Every synthetic record carries `provenance.source: 'synthetic:demo'` in
  the same field a real record will carry `'external:ais'` — "is this
  real?" is a query. The status bar's persistent SYNTHETIC / DEMO DATA
  chip and every inspector's EVIDENCE section *read* that field; they do
  not replace it.
- **A number carries its warrant.** The route inspector shows PROMISED
  transit (an `Assertion`) against OBSERVED transits (`Observation`s) and
  the resulting deviation with `n=` — never a bare number that forgets
  where it came from.
- **Which kind of nothing.** `LifecycleStatus` includes `'unknown'` and the
  palette reserves an unobserved tone (`UNKNOWN`, mirroring the
  Terminal's `--unk`): the render channel for "we do not currently know"
  exists before real telemetry does, so an 11-hour-old position is never
  drawn as a confident dot.
- **Geometry states its basis.** `Route.geometryBasis`
  (`'routed' | 'great_circle_estimate' | 'synthetic_corridor'`) keeps the
  difference between a routed path and an estimate queryable. All
  distances derived in this client are great-circle estimates and are
  presented as such, never as road distance.
- **Cluster placement** (future, at corpus scale): centroids on the sphere
  via vector mean at minimum (correct across the antimeridian, unlike
  lon/lat averaging), geodesic median where outlier robustness matters.

## 11. Ingestion disciplines (adapted from gods-eye-view, MIT)

Patterns lifted from `notationsystems/gods-eye-view` — a live public-feed
globe whose disciplines map cleanly onto the twin's seam:

- **Source registry** (`src/data/sources.ts`): every data source is a
  self-describing entry — what it feeds, the `provenance.source` class its
  records carry, keyless-or-not, metered-or-not, freshness, licensing
  caveats. The synthetic corpus is the one implemented entry; the free-feed
  recon (AISStream, NASA FIRMS, OpenSky/adsb.lol, USGS, CelesTrak, GBFS)
  is captured as queryable data, caveats included (OpenSky is
  non-commercial; AISStream is free-beta with no formal ToS).
- **Budget-governed proxies**: a metered source (Google tiles, TomTom,
  commercial AIS, LLM calls) is never called from the client. It sits
  behind a server proxy with allowlisted destinations, per-IP throttles,
  disk-cached responses with short TTLs, response-size caps, sanitized
  errors, and a per-provider daily credit governor (their TomTom proxy —
  120 s cache + a configurable daily tile budget — is the reference
  implementation). The `metered` flag in the registry marks which sources
  must take this path.
- **Interpolation-behind-realtime**: when live telemetry lands, the twin
  renders one polling interval behind real time and interpolates between
  known fixes, dead-reckoning the gaps — markers glide instead of jumping
  each poll. This is the production form of the last-known + ghost
  discipline in §10: the interpolated position is presentation, the fixes
  are evidence, and the gap between them stays visible.
- **World-stable heading projection**: direction-carrying markers rotate
  by their bearing projected into screen space each frame, with a safe
  fallback when the projected direction degenerates. In this renderer the
  whole pass runs in the flow layer's vertex shader (two route-texture
  samples → clip-space projection → screen bearing → rotated dart SDF;
  round-dot fallback below legibility size or at degenerate angles).
- **SGP4 + GMST orbit propagation** (deferred): only relevant if the
  maritime layer ever tracks vessels via satellite AIS; CelesTrak TLEs +
  SGP4 with GMST-locked rings is the correct implementation to adapt.

## 12. Sea-lane integrity is mechanical

`scripts/check-sea-lanes.mjs` (part of `npm run check`) samples every
maritime route's great-circle chords at 10 km steps against Natural
Earth 50m land polygons and fails the build on any on-land run of
≥ 20 km — outside a 60 km harbor-approach grace at route endpoints and
an explicit allowlist of real waterways below the data's resolution
(Panama and Suez canal transits, the Elbe and Westerschelde estuaries).
"A lane over land is not where the ship goes" is a build gate, not a
review comment: the reviewer sweep that first caught these defects has
been turned into the check that prevents their return.

## 13. The counterfactual layer (wired)

`src/data/scenario.ts` is the one simulator the state mirror allows itself
(§9), and it lives entirely inside the seam: pure, deterministic, no
mutation, no persistence.

**The engine.** `computeScenarioImpact(snapshot, stateAt, spec, t)` is a
pure function from `(WorldSnapshot, resolver, ScenarioSpec, Timestamp)` to
a `ScenarioImpact`. It never touches the snapshot and stores nothing back;
running the same spec at the same sim time yields the same frame. A
`ScenarioSpec` is a named set of `ScenarioPerturbation`s (a route or node
id, `'closure' | 'congestion'`, magnitude 0..1) with a duration;
`buildScenarioCatalog(snapshot)` derives a 72-hour closure spec per
chokepoint / border crossing that any route actually passes, plus the
constraint frames described under **Criticality ranking** below.

**Three named propagation mechanisms**, each attaching a human-readable
`note` explaining why the entity changed — explainable over clever:

1. **Closure** — the perturbed node and every lane through it: closure
   drops route utilization to near zero (traffic stops; the queue builds
   off-lane), pins congestion at 1, and sets status `'disrupted'`;
   congestion-kind perturbations add pressure and degrade instead.
2. **Starvation via flow chains** — every `Flow` whose segment chain
   crosses a perturbed route queues (a `DelayedFlow` with `delayHours`
   scaled by the closure window and magnitude), and every facility
   downstream of the block on that chain starves: utilization down,
   status degraded.
3. **Corridor spillover** — unperturbed routes sharing a `corridorId`
   with a blocked lane absorb diverted pressure: utilization and
   congestion up, degrading when congestion crosses threshold.

When one entity is reached by several mechanisms, the stronger role wins
(`perturbed` > `downstream` > `spillover`).

**Chokepoint resolution.** `routesThroughPoint(routes, point, radiusKm)`
resolves a point perturbation to concrete lanes by great-circle proximity:
any route whose polyline passes within the radius (default 150 km) of the
node is a lane through it. This is how "close the Suez" becomes a set of
specific `Route` records rather than a region annotation.

**The frame contract.** A `ScenarioImpact` is the complete hypothetical
frame: the `spec`, the sim time it was `computedAt`, per-entity
`ScenarioEntityDelta`s (role + full `baseline` and `scenario` state — the
observed values are carried alongside the perturbed ones, never replaced),
the sorted `delayedFlows`, and a summary block (perturbed routes,
downstream facilities, spillover routes, flows delayed, total delay
hours).

**Criticality ranking.** Because `computeScenarioImpact` is pure, every
frame in the catalog can be computed *without being entered*.
`rankScenarioImpacts(snapshot, stateAt, specs, t)` does exactly that: it
runs the whole catalog at the current sim time and orders chokepoints by
simulated queued delay — the rank key is `totalDelayHours`, explainable
like everything else in this module, with `flowsDelayed` then
`perturbedRoutes` as secondary keys. To feed it, the catalog now carries
two frame shapes per chokepoint where they make sense: the 72-hour full
closure, and a **constraint frame** for the common real-world case that
is pressure rather than stoppage — 50% canal capacity (Panama, Suez
draft/slot restriction) or enhanced border inspections, each running
168 hours as a congestion-kind perturbation. The App caches the ranking
per sim-hour bucket (`rankScenarios()` in `src/app/app.ts`): the engine
is deterministic, so one computation per hour is the whole cost. The
standing rule applies with full force: a criticality rank is **computed
intelligence, never observation** — the same rule as every hypothetical
product, and every surface that shows it says so.

**Regime and provenance.** Entering a frame goes through
`AppApi.runScenario(id)`; the clock is told via `SimClock.setScenario(id)`
and reports `TemporalRegime: 'scenario'` until `clearScenario()` — the
same regime channel the timeline and status bar already subscribe to, so
the whole instrument knows it is projecting a hypothesis. Every scenario
record carries `provenance.source: 'synthetic:scenario'`, so "is this
real?" stays a query (§3): a scenario delta answers differently from an
observed record by the same field on the same shape.

**The standing render rule.** A hypothetical frame draws in a distinct
violet dashed treatment — the `#d98cff`-family accent and dashed/striped
edges are reserved for scenario framing and used nowhere else — under a
persistent banner while the frame is active. Observed state never renders
violet; scenario state never renders in the solid look of real state. A
simulated outcome is not an outcome, and the pixels say so as loudly as
the provenance field does.

This deterministic engine is a stand-in with the seam already in place:
Payload's real propagation engine + VROOM re-optimization will produce
`ScenarioImpact` frames through the identical contract, and nothing above
the data layer changes when they do.

### The upstream injection path (terminal corpus)

The terminal corpus has no in-process engine — and now does not need
one for what-if work: `GET /api/scenarios/inject` forwards a single
hypothetical event to the Terminal's own counterfactual engine
(`POST /api/economy/scenario`), which runs its state twice and
answers with the counterfactual frame, the affected set by hop depth,
disrupted volume, spare-capacity alternatives, and its verbatim
reasoning trace. Honesty contract: the answer is computed upstream,
so it carries NO corpusBuild; the frame kind `counterfactual` rides
through untouched; and because this corpus's states are unobserved,
the twin renders structural propagation only — the violet role
treatment and the injection card — and never fabricates a baseline
utilization delta to dress the result up as state. The SCENARIOS
panel's WHAT-IF INJECTION controls drive it; Esc releases it first in
the ladder. Alongside it, `GET /api/refusals` mirrors the upstream
refused:* digest — every group one mechanism with one shared remedy,
ranked by how often it blocked an answer — surfaced by the `refusals`
command as a work queue.

## 14. The backend: the Spatial API (begun)

The twin now has a server — `server/` — begun the way the user asked:
by **studying, not copying** the sibling Payload repos. What each repo
actually contains (including which ones are vapor), what was adopted,
deferred, and rejected is recorded in [`docs/BACKEND_STUDY.md`](./BACKEND_STUDY.md);
the service's own conventions and endpoint inventory live in
[`server/README.md`](../server/README.md).

The load-bearing facts:

- **One semantic layer, both sides of the wire.** The server executes
  the same erasable-TypeScript `src/data/**` the client ships (Node
  type-stripping — the seam check of §2 is what guarantees this stays
  possible), and dynamic state resolves through the shared
  `createStateResolver`. There is no second representation to drift.
- **Projection only.** No route mutates canonical state — INV-6
  enforced at the protocol layer, matching the Terminal ledger's
  anticipation of "a native 3D world view consuming projections over
  HTTP — a separate client, not a substrate."
- **The envelope is the discipline.** Every response carries
  `sourceClass`, `valueKind`, `admissible`+`admissibleBasis`,
  `knownAt`/`asOf`/`knowledge`/`vintages`, an `EvaluationFrame`, and an
  `attribution` fingerprint; unanswerable questions return typed
  SCREAMING_SNAKE refusals with remedies at HTTP 200. Contract tests
  (`server/test.mjs`) pin all of it inside `npm run check`.
- **The client chooses its source honestly.** `?api` hydrates the globe
  from the service via `RemoteSpatialProvider` (registered in the §11
  source registry as `payload-spatial-api`); if the service is
  unreachable the client falls back to the in-browser corpus and says
  so in the UI — never silently. `get_state` on the tool surface
  reports which source is live.

**The Terminal-projections loader (shipped).** `server/loaders/terminal.mjs`
feeds the twin from a live payload-terminal-v0: real facilities, flows,
events and ~830 bitemporal observations, mapped through explicit
field-based tables with conservation accounting (`mappingReport` on
`/api/health`). Admissibility is earned per record by the Terminal's own
rule; the corpus mixes admissible and inadmissible records and
`meta.admissible` is `null` — a blanket answer is not a fact for a mixed
corpus. State readings answer `unobserved`/`no_history` (nothing
synthesizes dynamics for a projected corpus — the client gates its
deterministic resolver on `meta.corpusKind`), promise fields are absent
rather than zero (the inspectors render NOT ASSERTED), scenario routes
refuse for lack of a baseline, and endpoint-only geometry says
`great_circle_estimate`. Details: `server/README.md`,
`docs/BACKEND_STUDY.md`.

## 15. The operations mirror (control tower)

The Terminal's backend direction added a **brokerage control tower** —
live load operations over append-only, hash-chained journals, with an
exception-first queue (named issues, severities, deadlines, operator
remedies — never a composite score) behind a fail-closed operations
authority. The twin mirrors it as the OS's OPERATIONS surface:

- **`GET /api/operations`** on the Spatial API proxies the Terminal's
  `/api/freight/control-tower`. The operations credential lives in the
  SERVER environment and never reaches a browser (the Terminal's own
  posture). Every upstream outcome is a typed answer: unconfigured,
  unauthorized, unreachable, and the tower's own refusals (journal
  corrupt/unavailable) pass through as refusals with remedies — the
  mirror never renders an empty desk it cannot vouch for.
- **The OPERATIONS panel** (`src/ui/opsPanel.ts`) adopts the desk's
  design contract: exception-first ordering, OBSERVED / OPERATOR REMEDY
  split per issue, stated policy thresholds, portfolio as components,
  per-number attestation on economics (a quote flagged NEGOTIATING
  POSITION — the interest axis routes to measurement, it does not
  discount), and a standing READ-ONLY MIRROR banner: propose →
  authorize → execute lives in the Terminal desk; the twin renders, it
  never commands (INV-6 extended to operations).
- **Position honesty on the globe.** The tower serves tracking
  timestamps, never coordinates — so selecting a load draws its
  DECLARED lane as an arc (solid when tracking evidence exists, DASHED
  when movement is unobserved) between endpoints resolved through an
  explicit curated place table, and **no vehicle marker is ever
  drawn**. An endpoint not in the table draws nothing rather than
  guessing. Hold-to-peek lets the operator sight the lane under the
  panel.
- The tool surface gains `get_operations` (read-only, refusals typed).

## 16. Design language — PayLoad OS

The brand is a plain wordmark: **PayLoad OS**, unadorned, at the boot
nameplate and the header — no glyph, no tracking theatrics. Everything
decorative was spent on legibility instead, in a full critique pass
(five surface critics + synthesis) that hardened the instrument:

- **Scene**: route tubes render as a luminous core with a soft halo
  (view-angle profile) and attenuate with altitude, so close range
  reads as lines, not ribbons; additive stacking soft-clips toward the
  mode hue, never white; the earth gained a stop of land contrast, a
  4096px night-light texture with point-crisp metros, and ghost-lit
  continents on the night side.
- **Chrome**: one documented z-band system (labels < docks < inspector
  < timeline < banner < command bar < overlays); the tab strip rides a
  glass ribbon; the analytics dock yields to center panels; the status
  bar sheds detail segments before colliding; `prefers-reduced-motion`
  disables auto-rotation and transitions.
- **Time**: the forecast zone of the scrubber is striped (provisional,
  visibly), the NOW tick is a green marker, each regime chip keeps its
  identity — scenario stays violet-dashed at every indicator — and a
  kepler-style density strip shows where the corpus actually holds
  evidence (observation knownAt + event starts).
- **kepler.gl patterns adapted (MIT, studied not copied)**: cursor
  tooltip (name · kind · state, or STATE UNOBSERVED), hold-B route
  brushing (focus, not filter — nothing hidden, nothing mutated), an
  always-available legend decoding every color incl. the reserved
  overlay treatments, and the timeline density strip. Aggregation
  layers and split maps were assessed and deferred.
- The semantic tone ramp (ok/warn/alert/dim) was resurrected on
  inspector data rows, and honesty typography sharpened: MEAN OBSERVED
  (μ died in uppercase), UNOBSERVED meters, NOT ASSERTED promises.

## 17. The live substrate (gods-eye-view under PayLoad OS)

The LIVE layer group integrates gods-eye-view (MIT, adapted — see
docs/ATTRIBUTIONS.md) as a substrate under this OS's chrome and
through its backend:

- **`/api/live/*` on the Spatial API**: keyless public upstreams only
  (celestrak TLE groups, USGS M2.5+ quakes), behind the
  budget-governed proxy posture — hosts fixed in code, disk-cached
  with stated TTLs, response caps, per-URL partial delivery with
  failures stated, stale-cache-with-stated-age over silence, typed
  refusals otherwise. Live meta carries its own sourceClass /
  disclaimer — a public feed is never conflated with the loaded corpus.
- **Satellites** (`live.satellites`): four constellations (stations
  incl. ISS, GPS, GLONASS, Galileo) at TRUE orbital scale, positions
  COMPUTED client-side by SGP4 from the TLE epoch and repropagated at
  1 Hz — a failed propagation renders nothing, never a ghost. The
  toast and legend say COMPUTED; the TLE age is part of the record.
- **Seismic** (`live.seismic`): reported epicenters as rings sized by
  magnitude and faded by report age; strong recent events pulse.
  Supply-chain relevance is the point of putting a quake feed on an
  operations globe.
- Both layers load lazily on first toggle; an unreachable feed is a
  toast with the refusal's remedy and an empty layer — never
  fabricated points.

## 18. Decision record — the locked platform architecture

**Decided 2026-09-02, operator sign-off. Not to be revisited unless
benchmarks force it.**

PayLoad OS is an **information** operating system. The core mission:

> Acquire → Extract → Normalize → Resolve → Structure → Relate →
> Index → Compress → Retrieve → Compute → Prove

The locked invariant:

> **Canonical Core → Rebuildable Representations → Controlled
> Retrieval → Products/APIs**

Five planes — ingestion, truth, storage, representation, access —
with **security cutting vertically through every plane** (policy
labels + information-flow control, not one perimeter). Storage
topology V0 is Postgres/PostGIS + object storage + a vector store;
dedicated temporal or graph engines only when a workload proves the
need. Temporal semantics live as fields on canonical records
(`event_time / known_at / valid_from / valid_to / recorded_at`).

### Doctrines this repo already embodies

- **Representations are disposable** (`Rᵢ = Cᵢ(K)`, never the
  inverse): this renderer and this projection service are exactly
  such representations — both can be destroyed and regenerated from
  canonical state, and neither can write back (INV-6 / the mechanical
  seam).
- **Answers carry their warrant**: the `{status, data, meta}`
  envelope already carries basis, knownAt, admissibility,
  attribution, and typed refusals — the early form of the
  proof-carrying Answer object
  (`value · basis · evidence · computation · uncertainty · policy ·
  corpus_build`).
- **Corpus-build identity** (implemented here): every corpus-derived
  response carries `meta.corpusBuild` — `id`,
  `canonicalStateFingerprint` (content hash of the canonical
  snapshot), `schemaVersion`, `compilerVersion`, `generatedAt` — so
  *"which version of the corpus produced this answer?"* is always
  answerable. Live-feed and market answers explicitly do NOT carry it:
  they are not corpus-derived, and conflating them would falsify the
  lineage. Version fields appear only when the capability exists — no
  ontology/embedding version is stamped until an ontology/embedding
  exists.

### How this service's routes map to the five API families

| Locked family | Served here today |
|---|---|
| `/v1/entities/*` | `/api/snapshot`, `/api/entities`, `/api/state/{id}` |
| `/v1/evidence/*` | per-record provenance on every entity/observation; inspector evidence rows |
| `/v1/spatial/*` | bbox filtering, geometry on entities (nearby/within/route/exposure are corpus-engine work) |
| `/v1/intelligence/*` | `/api/scenarios/rank`, the query verbs (`producers of`), proximity correlation |
| `/v1/research/*` | not served here — GraphRAG/Context Compiler territory |

This projection service is a **prototype of the Payload API's
semantic boundary**, not the API itself: when the corpus-platform
services land, Payload Earth consumes the same public contract as
Terminal, Tradewind, agents, and customers — dogfooding the product
boundary daily.

### Contract obligations for anything drawn here

1. Corpus answers name their build; non-corpus answers must not.
2. Nothing rendered may require reading a representation back into
   canonical state.
3. When `DataPolicy` labels land on records, every surface that
   displays a derived figure must be able to display its policy
   lineage — the UI contract is reserved now so the field is worn,
   not hidden, when it arrives.

## 19. Payload Miner v0 — corpus builder + data miner

The platform already runs most of a mining loop — ingestion normalizes,
RELATE derives connection fields, the proximity engine correlates, the
counterfactual engine ranks. The miner closes the loop deliberately:
**the Corpus Builder makes knowledge canonical; the Data Miner reads
that canon and emits pattern candidates back into review** — the
SCG-style cycle `K_{t+1} = K_t + V(M(K_t))`, where `V` (validation)
is the gate nothing skips.

### The schema-enforced ladder

> `Observation ≠ DerivedMetric ≠ MinedPattern ≠ Hypothesis`

A mined pattern is a **candidate**, a distinct epistemic type
(`src/intel/miner.ts`): `validationStatus` is literally the type
`'candidate'` — there is no code path that promotes one. Each carries
`algorithm`, `algorithmVersion`, `score`, `scoreBasis`, its
`supportingRecords`, the `miningRunId`, and the `corpusBuildId` it was
mined from. Provenance chain: **Pattern → MiningRun → CorpusBuild →
records** — a pattern mined from a stale build is detectable by id
alone.

### v0 miners (deterministic, pure, field-based)

| Algorithm | Pattern type | What it computes |
|---|---|---|
| `origin-share@0.1` | `SUPPLY_CONCENTRATION` | declared flows of a commodity dominated by one origin (≥4 flows, ≥50% share) |
| `articulation-points (Tarjan)@0.1` | `STRUCTURAL_ARTICULATION` | route-graph cut vertices; an UNDECLARED cut scores 1.0 (the discovery), a declared chokepoint 0.5 (confirmation) |
| `corridor-share@0.1` | `SHARED_CORRIDOR` | single routes ≥5 declared flows traverse |

All three read only declared corpus fields (flow segments, route
endpoints, commodity ids) — never names, never proximity guesses.
Determinism is a contract: ties break lexicographically, so the same
corpus build always yields the same run.

### The surface

The **Pattern Registry** (`patterns` in the command bar) lists
candidates grouped by type under a MINED-gold banner that states the
ladder in words. Clicking a candidate lights its subgraph on the globe
with the same emphasis mechanics as a corpus query (dim ≠ hide) and
raises the active-pattern card: statement, score with its named basis,
`algorithm@version`, run id, build id, supporting-record count. Zero
candidates renders the thresholds that were not cleared — absence with
a stated reason, per the design law.

### The service boundary (mining as a capability)

Mining is served, not renderer-private: `GET /api/mining/patterns`
returns `{run, patterns}` in the standard envelope — the run stamped
with the same `corpusBuild` the meta carries, memoized per build
(asking twice must not fabricate a second discovery event). The
implementation is **single-sourced in `shared/miner.mjs`** (typed by
`shared/miner.d.mts`, re-exported through `src/intel/miner.ts`): the
service and the renderer cannot fork the algorithm. When Payload
Earth runs against the spatial API it **displays the served run**
rather than re-deriving it — dogfooding the product boundary — and
falls back to labeled in-browser mining only for the unstamped
in-browser corpus or a failed fetch; the registry's lineage line
names which path ran (`MINED AT PAYLOAD-SPATIAL-API` /
`IN-BROWSER`). This route is the prototype of the eventual
`/v1/mining/*` family from the locked architecture.

### What v1 adds (when the corpus platform lands)

Temporal miners (lead-time drift, seasonality) once observation
history deepens; mining runs recorded and listable server-side under
`/v1/mining/runs`; a validation workflow that moves a candidate to
`validated`/`rejected` **by a person or a stricter process, never by
the miner itself**.

## 20. CorpusDefinition — corpora as manufactured artifacts

The physical-economy graph (companies → facilities → commodities →
suppliers → trade → logistics → ports → vessels → infrastructure →
markets → flows → events) stays enormous — but it is **one output**
of the corpus machinery, not the machinery itself:

> 𝒞ᵢ = F(Oᵢ, Sᵢ, Rᵢ, Vᵢ, Mᵢ, Pᵢ)

PayloadOS's deep abstraction is the **CorpusDefinition** — ontology,
entity/relation/observation types, source registry, extraction rules,
resolution rules, validation rules, mining programs, access policy,
publication contract. Rather than hard-coding Facility/Port/Vessel
into the platform, the platform manufactures corpora from
definitions.

### v0 in this repo

Every corpus loader now **declares its definition adjacent to the
code that enforces it** (a definition that drifted from the loader
would be a lie): the synthetic loader declares `authored`
extraction/resolution and categorical inadmissibility; the Terminal
loader declares `explicit_field_mapping` extraction (exhaustive
field→kind tables, exclusions counted), `upstream_identity`
resolution, and per-record admissibility. `GET /api/corpus/definition`
serves the assembled artifact:

- the **declared half** from the loader — the rules it enforces;
- **derived censuses** computed from the served snapshot (entity
  kinds, route modes, observation metrics), labeled
  `derived_from_snapshot` — the definition says what the corpus
  *exhibits*, not just what it intends;
- **mining_programs** from the single registered-algorithm registry
  in `shared/miner.mjs` (the same list every MiningRun manifests);
- **publication_contract** — the envelope, the refusal vocabulary,
  the knowledge modes this corpus can honestly answer;
- **access_policy: ABSENT, with its reason** — no DataPolicy labels
  exist yet, and the definition says so rather than inventing them.

The renderer wears it: the `corpus` command opens the definition
overlay (declared rules · derived censuses · stated absences); on the
in-browser corpus the surface refuses with a remedy instead of
reconstructing a definition client-side. Its sibling, the `compiler`
command, opens the **Compiler console** — build identity, record
census, and the loader's conservation report (exclusions grouped WITH
their reasons, unresolved cross-references, upstream reconciliation,
RELATE derivations) — the build/maintain instrument for the corpus
machinery itself.

### What this reserves

When the corpus platform manufactures a second corpus (a different
ontology, different sources), this service loads it by definition
rather than by new code paths; DataPolicy labels land in
`access_policy`; extraction/resolution/validation rule declarations
become executable configuration instead of prose descriptions of
adjacent code.

## 21. Decision record — the Verification Envelope and the trust ladder

**The doctrine:** *provenance everywhere + cryptographic proof where
it adds economic or audit value.* Formally the nested ladder

> `PROVENANCE ⊂ REPRODUCIBLE ⊂ ATTESTED ⊂ ZK_VERIFIED`

Every answer this service serves now carries `meta.verification`:
the level the answer has **earned**, the basis for that level, and —
critically — `unreachedLevels`, stating exactly what each missing
level requires. Absent capability is stated, never simulated.

### What each level means here, today

- **PROVENANCE** (default): per-record provenance (source, knownAt,
  valueKind, admissibility) travels on the records themselves. Plain
  state reads, mirrors, and upstream-computed answers (injection,
  refusals, ops) sit here.
- **REPRODUCIBLE**: inputs + program + versions fully name the
  result. The snapshot (content-addressed by fingerprint + Merkle
  root), the mining run (algorithm@version + parameters + build), the
  corpus definition, and the commitment manifest earn it.
- **ATTESTED** — *absent*: requires a signature over the build root
  by a key the corpus platform holds. No signing capability exists in
  this projection service, and the envelope says so.
- **ZK_VERIFIED** — *absent*: requires the SP1/zkVM execution layer
  proving a computation against committed inputs. Corpus-platform
  work, not begun. When it lands, it proves **computation integrity**
  (given committed inputs and the declared program, this output is
  correct) — never that source observations were true. That
  distinction is preserved in the vocabulary now so it cannot blur
  later.

### The commitment manifest (real today, no zk required)

The compiler seam builds a Merkle tree per corpus build
(`sha256-merkle/0.1`): one leaf per canonical record
(`sha256("<collection>:<id>\n" + JSON(record))`), odd nodes promoted
unchanged. The root rides on `corpusBuild.merkleRoot`.

- `GET /api/corpus/commitments` — the manifest (root, leaf counts by
  collection, the leaf rule).
- `GET /api/corpus/commitments?record=<id>` — an **inclusion proof**:
  the record, its leaf, its path, the root.
- `scripts/verify-inclusion.mjs` — verifies a proof **offline**,
  without trusting this service: recompute the leaf from content,
  fold the path, compare the root. A tampered record fails.

What the proof means is stated in the tool's own verdict: membership
in the build — not truth of the record (provenance's job), not when
the root was made (attestation's job, absent until roots are signed).

### Where it is worn

The compiler console shows the COMMITMENT MANIFEST section; the
warrant graph's BUILD node reads `committed ⌗<root>…`, and every
warrant subject's notes state its verification level (a mined
pattern: REPRODUCIBLE; an upstream hypothetical: PROVENANCE only).

### The discipline (from the lock-in)

Do not zk-prove OCR tokens, embeddings, coordinates, or raw
observations. Reserve proof for: corpus build integrity, important
deterministic metrics, policy-sensitive transformations, historical
snapshot commitments, external attestations, high-value API
computations. Everything else carries ordinary provenance and
deterministic lineage — which this service already serves.

## 22. Control Plane v0 — Payload as the first ecosystem node

Rather than a generic control room, the control plane models ONE real
ecosystem deeply: this stack. `GET /api/system/topology` is the
projection service declaring its own **EcosystemModel** — nodes
(service · store · upstream · external sources, all of them things
that actually run), edges (projects / loaded-from / mirrors / proxies
/ brokers), and capabilities, each with its routes, a probe path, its
provenance class, its authority requirement reported as
PRESENT/ABSENT (never a value), its data domains, the instrument that
opens it, and its **action ladder**. The renderer adds itself as the
first column and consumes the rest through the public contract.

The `system` command opens the SYSTEM panel:

- **Operator strip** — healthy · stale feeds · awaiting authority ·
  blocked, from live probes (every capability GET-probed, latency
  measured, health classified from the TYPED answer, never inferred)
  and the session feed ledger. Cost reads `ABSENT` with its reason:
  no cost meter exists.
- **Live topology** — a four-column SVG (renderer → spatial API and
  corpus → upstreams → external sources); a node's color is its
  capabilities' probed health.
- **Capabilities** — the table, with the ladder
  `observed → proposed → approved → dispatched` per capability.
  **A cell lights only from a recorded fact.** Observe-only
  capabilities light OBSERVED and nothing else; a what-if lights
  PROPOSED ("a proposal to think, never to act"); the operations
  mirror derives its counts from the control-tower journal — approved
  = `authorization: authorized`, dispatched = **tender DELIVERED to
  the carrier**, never a dispatch merely requested. This backend
  stops at approved; the UI never implies an action happened when
  only an authorization or a computation did.
- **Timeline** — the session journal: operator commands, agent tool
  calls, and system trips, each with its source and, always, what was
  dispatched — `nothing`.

The globe behind the panel remains the spatial/temporal dock; the
panel controls the system that feeds it.

### The adapter contract

The EcosystemModel served here is the shape a future ecosystem seeds
into the same control plane: `nodes`, `edges`, `capabilities`
(routes, probe, provenance, authority presence, ladder, data domains,
instrument), `dataDomains`, `cost`. Codex's next step — a Payload
adapter seeding real capabilities, health signals, data domains, and
spatial layers into the Control Plane service — fills this contract
server-side; this panel then reads that instead of the projection
service's self-declaration, with no UI redesign.

## 23. Security substrate

Security extends the substrate rather than sitting beside it — see
**docs/SECURITY.md** for the threat model, the trust boundaries, and
the full invariant list. The engineering shape:

- **`server/security.mjs`** — the request gate. Host allowlist
  (DNS-rebinding defence), origin allowlist (never a wildcard),
  privileged routes fail closed on an unrecognised origin, GET-only
  enforcement, per-client rate limits on routes that spend an
  upstream's quota, error redaction with correlation ids, and secret
  scrubbing for logs. Every control answers with the service's own
  typed refusal shape: a security refusal is an answer, not an
  exception.
- **`src/core/escape.ts`** — one escaper, markup-safe in element AND
  attribute position. The per-module escapers it replaced covered
  `& < >` only, which is safe in element position and unsafe in
  `title="…"` — and real sinks rendered upstream refusal text there.
- **`src/data/sources.ts`** — `?api=` is allowlisted before use. An
  attacker-chosen backend would otherwise control every claim the OS
  renders *including its own verification*, so a refused base fails
  closed to the in-browser corpus and says so.
- **`readCapped` / `readCappedJson`** — every upstream body read is
  bounded (8 MiB JSON, 24 MiB feed): `content-length` is checked, then
  the body is streamed with a byte counter and cancelled the moment the
  cap is crossed. The reads these replaced buffered the whole response
  and *then* measured it, which is not a control — the memory is
  already spent by the time the check runs (SEC-151).
- **`TOOL_CAPABILITY_ALLOWLIST`** (`src/app/toolSurface.ts`) — the agent
  reaches an enumerated set of view-level capabilities and nothing
  else. Adding one is a reviewable edit rather than an import away, and
  no capability whose name dispatches, mutates, writes, commits,
  approves, deletes, rotates or signs may appear (SEC-011/012). There is
  no execution identity here to dispatch *with*; the check exists so
  that the day one lands, the tool surface fails loudly instead of
  inheriting authority by accident.
- **`SecurityJournal` + `SECURITY_INVARIANTS`** (`server/security.mjs`)
  — the security model as data. The journal is a bounded ring of gate
  refusals that counts what it dropped and states its own window; the
  ledger is the machine-readable twin of docs/SECURITY.md, with each
  row ENFORCED (a named check proves it), DEPLOYMENT (real, but not
  this process's to enforce) or ABSENT (with the reason and what would
  unblock it). Both are served at `GET /api/security/posture`.
- **`src/ui/securityPanel.ts`** — the operator surface for that model,
  reached by `security` in the command vocabulary or from its row in
  the control plane. It separates what the browser OBSERVED (the CSP
  that actually arrived, the API base in force, every key actually in
  storage) from what the gate REPORTED, and it shows the ABSENT rows
  with equal weight — a security surface that renders only what works
  is a marketing page. Because SEC-110 admits any loopback backend, the
  panel treats the posture as untrusted input: escaped throughout, and
  a malformed field degrades one row rather than blanking the surface.
- **`index.html`** — SEC-170: `script-src 'self'`, `default-src`,
  `object-src` and `base-uri` at `'none'`, `connect-src` mirroring the
  SEC-110 allowlist as a *policy* (loopback, any port) rather than as
  the two ports in use. Defence in depth behind the escaper.
- **`scripts/check-security.mjs`** — 21 invariants in `npm run check`:
  no committed secret, one escaper, quote coverage, no wildcard CORS,
  TLS never disabled, no user-steerable egress, storage allowlist,
  API-base validation, GET-only routing, error redaction, pinned
  lockfile, tool-capability allowlist, no self-granted capability,
  bounded upstream reads, CSP present + strict + closed by default, and
  a served ledger that cannot drift (an ENFORCED row naming no check,
  or an absence carrying no reason, fails the build). Each failure names
  its invariant and its remedy — and each was proven to bite by
  injecting a real violation before being trusted. One of them did not:
  the ledger's reason check matched the NEXT row's `reason:` across a
  lazy span and reported a missing one as present. It was rewritten to
  parse each row's own body and re-attacked before being trusted.
- **`tests/e2e/05-security.spec.mjs`** — attacks, not assertions: a
  hostile loopback backend serves XSS payloads through the real render
  chain, and a foreign `?api=` is checked to be refused *and never
  fetched*.

Two findings from the pass are worth recording because they were
structural, not incidental:

1. The service answered `Access-Control-Allow-Origin: *` while holding
   the operations credential — a textbook confused deputy. Any page the
   operator visited could read the brokerage desk. Closed by SEC-101/
   103/104, verified by attack.
2. `esc()` did not escape quotes, so every `title="${esc(x)}"` carrying
   upstream text was an attribute-injection sink. Closed by the single
   hardened escaper, verified by driving real payloads through the
   render chain.

3. Every proxy read was unbounded. A hostile or merely broken upstream
   could answer a multi-gigabyte body and exhaust the service — and one
   read that *looked* capped checked the length only after buffering
   the whole payload. Closed by SEC-151, which is now mechanical: a
   bare `res.json()` anywhere under `server/` fails the check.
4. The dev server bound every interface (`host: true`) and its
   toolchain carried two live advisories, one of them "any website can
   read the dev server" — the same confused-deputy class as finding 1,
   one layer down. Closed by loopback-by-default binding, an `fs.deny`
   list, and a toolchain upgrade to a version with a clean advisory
   surface (SEC-106/160).

---

## 24. The apparatus register and the notation:// resolver

**docs/ECOSYSTEM.md** is the register: the seven apparatuses of Notation
Systems, the corpus lifecycle stage each owns, what each refuses, and
where the trees converge and diverge. `shared/ecosystem.mjs` is its
single source, served at `GET /api/ecosystem/register`, rendered by the
ECOSYSTEM instrument, and held to the actual trees by
`scripts/check-ecosystem.mjs` — PRESENT must carry source, DECLARED must
not, every absence must carry its reason, every divergence its owner.

`shared/notation.mjs` implements the identity space the substrate
directive specified: eleven kinds, who holds each, and — the part that
makes it useful today — a typed refusal naming the holder for the kinds
this projection cannot answer for. A `notation://` URI is an address in
the command bar: it navigates or it refuses, and the address rule runs
before any fuzzy match so an identity is never shadowed by its own text.

Presence in the register is probed, not asserted: an apparatus that
exposes an HTTP surface is reached at read time and carries the moment
and latency of the probe that answered. A probe that fails reports
REACHABILITY and never existence — a stopped service must not read as an
unbuilt apparatus. The probe is bounded and cached, and its destination
is validated at the call site (fixed path shape; loopback host unless
the operator named one), because a target read out of a data structure
is the shape of an SSRF primitive whatever its provenance. The presence
counts are derived from the rows they summarise, so a probe that changes
a row changes the headline with it.

`shared/vocabulary.mjs` is the third piece: the provenance vocabulary
alignment. It declares each apparatus's terms, proposes a mapping onto
three orthogonal axes (origin · distance from evidence · pipeline
stage), and — the part that makes it decidable — MEASURES what adopting
it would do to the served corpus. Every row is typed by what kind of
relationship it claims: SAME is a rename, NARROWS is a refinement,
ORTHOGONAL is a hazard (merging destroys a fact), UNMAPPED needs a
human. Nothing is applied, and a test asserts no served record has
acquired a proposed label.

The instruments are lazily mounted. Eight overlay surfaces — the four
new ones plus corpus, compiler, refusals and vocabulary — load on first
open rather than at boot, and the main bundle went from 987 kB to 920 kB
while five surfaces were added.

`lazyPanel` is the helper, and its shape is set by one rule: **the
operator must never press a command and see nothing.** Deferring the
module must not defer the element, so a placeholder wearing the panel's
own class is appended immediately (present in ~40 ms) and swapped for
the real panel when it lands. That keeps the DOM contract other code
relies on — the element exists from the moment it was asked for — and
gives the operator feedback in the window where a chunk is still in
flight. Esc during that window cancels, so a panel never opens behind
someone who has moved on; a failed load raises a toast rather than
swallowing the command.

Two contracts became mechanical alongside them. The **answer envelope**
is now swept across every parameterless route rather than asserted
per-route: verification level AND basis, the corpus build that produced
the answer, and a remedy on every refusal. Per-route assertions test the
routes someone remembered to test; a sweep means a route added later
inherits the contract instead of quietly opting out of it. And **INV-7**
holds the vocabulary overlay to the command grammar — a command the
grammar accepts and the help never lists is a feature nobody can find,
which for an operator surface is the same as not shipping it. Capitalised
entries are exempt as seed examples of generic forms already documented.

Two things this pass measured rather than asserted. The served corpus
mints two entity id shapes (76 `ent:type:name`, 57 bare-hyphenated), so
the identity divergence runs inside one apparatus and not only between
them; the resolver accepts both and reports which answered. And SEC-011
was widened from the tool surface to the whole renderer: `runCommand` is
deliberately broad, so every module the command grammar can reach is
inside an agent's blast radius, and an allowlist that stopped at one
file was checking the door while leaving the corridor unwatched.

---

The identity separation in SECURITY.md §5 is the security half of the
Notation Substrate's `notation://` namespace contract: one canonical
identity space, many representations — with service and agent identity
deliberately **not** addressable, because a URI that can name a
credential is a credential that will eventually be dereferenced.

---

## 25. "Has it moved since I last looked?"

The first question a commodities desk asks each morning, split into the
half this projection can answer and the half it must refuse.

**Answerable, and free.** The OS bookmarks the corpus build each operator
last saw — id, Merkle root, timestamp — in `pe.workspace/v1`. The
two-field comparison is the whole value: a build id contains its own
generation time, so it changes on every recompile and on its own says
nothing, while the root changes only when a committed record does. Same
root with a new id is *rebuilt, nothing moved* — the normal morning, and
the answer that saves an operator the walk. A different root is *records
moved*, and it is the one of the four states that takes the alert tone,
because colouring the normal case teaches people to ignore the colour.
Missing roots on either side report *moved* rather than assuming
unchanged: the safe direction.

**Refused, with the reason.** *Which* records moved needs both builds'
contents, and holding two builds so a surface could diff them would make
this projection a store — the one thing it may never become. So it is
ABSENT with what would unblock it: build history in the substrate,
retaining prior builds and serving a diff. This engine would render it
the day it is served; it cannot hold it.

The bookmark is a deliberate, stated widening of `core/workspace.ts`,
whose contract was "nothing here is state about the world". A build id
is session memory — it names a build and reconstructs no record — but
the boundary moved, and a quietly widened contract is how a view store
becomes a database. The module says so in its own header, and a test
asserts the bookmark carries id, root and time and nothing else.

---
