# Payload Earth Spatial API

The twin's backend: the HTTP projection service the Terminal's own
architecture ledger anticipated — *"a native 3D world view could one day
consume projections over HTTP — a separate client, not a substrate."*
This service is that layer, built by studying (not copying)
`payload-terminal-v0` and the Data-Acquisition-Channel, and adopting
their conventions so the twin composes with the rest of Payload.

```
npm run server            # synthetic corpus · http://127.0.0.1:8787
npm run server:terminal   # Terminal-projections corpus (TERMINAL_URL=… , default http://127.0.0.1:3000)
node server/test.mjs      # contract tests, both corpora (also part of `npm run check`)
```

Open the globe with `?api` (or `?api=<base-url>`) to hydrate it from
this service instead of the in-browser corpus. If the service is
unreachable, the client falls back to the local corpus and says so —
never silently.

## What it serves

One corpus, zero duplication: the server executes the **same
erasable-TypeScript semantic layer** the client ships (`src/data/**`,
via Node type-stripping — the seam check guarantees it stays runnable).
Dynamic state resolves through the same pure resolver on both sides of
the wire, so the projection cannot drift between server and client.

| Route | Capability |
|---|---|
| `GET /api/health` | Service + corpus identity, counts, time range |
| `GET /api/capabilities` | Every route this service speaks |
| `GET /api/snapshot?asOf&knowledge=` | The full WorldSnapshot |
| `GET /api/state/:id?t=` | Resolved EntityState at an instant |
| `GET /api/states?ids=&t=` | Batch states — per-item outcomes, never all-or-nothing |
| `GET /api/entities?bbox=&kinds=&minImportance=` | Server-side spatial filtering (the `provider.query` seam) |
| `GET /api/search?q=` | Entity resolution by name |
| `GET /api/deviations/:id` | Promises joined to evidence (Assertion/Observation/Deviation) |
| `GET /api/scenarios` · `/rank` · `/:id/impact` | The counterfactual catalog, criticality ranking, frame impacts |

## Conventions (studied from payload-terminal-v0)

- **Envelope**: every response is `{ status, data, meta }`. `meta`
  carries `sourceClass`, `valueKind`, `admissible` + `admissibleBasis`
  (the Terminal's admissibility switch: `representative` fixture data
  is categorically inadmissible, and the basis is stated), `knownAt`,
  `asOf`, `knowledge`, `vintages`, an `EvaluationFrame`
  (`reconstruction` on plain reads, `counterfactual` + `scenarioId` on
  scenario endpoints), an `attribution` fingerprint (service, version,
  corpus, corpus vintage — so "this number looks wrong" is traceable,
  not an anecdote), and `disclaimer` — provenance and admissibility
  are fields on the wire, never banners in a UI.
- **Three-valued readings**: `/api/state/:id` answers
  `{ reading: 'known' | 'unobserved' | 'no_history', state? }`. The
  deterministic corpus always answers `known`; the shape ships now so
  real telemetry can answer honestly without an API break. Batch
  `/api/states` carries conservation accounting on the wire:
  `examined = resolved + refused`, per-item outcomes, never
  all-or-nothing.
- **Typed refusals with remedies**: a question the data cannot answer
  returns `{ status: 'refused', refusal: { kind, message, remedy } }` —
  an out-of-range `asOf` names the corpus range and the fix; a
  too-short search query is refused, not answered with an empty array
  posing as knowledge; an entity with no recorded promises gets
  `NO_ASSERTIONS`, not empty data. Refusal kinds are SCREAMING_SNAKE
  and name the missing observable, and refusals travel as **HTTP 200**:
  an unanswerable question is a first-class answer, not a protocol
  error. 404 is reserved for capabilities the service does not speak
  at all (`unknown_capability`).
- **Knowledge modes**: temporal queries accept
  `knowledge=best_known | as_known_then` (the Terminal's
  HINDSIGHT/AS-KNOWN discipline). The synthetic corpus has a single
  vintage, so the two coincide today — `meta.vintages: 1` says so
  honestly instead of pretending bitemporality it doesn't have. When a
  multi-vintage corpus lands, `knownAt`/`supersedes` on observations
  give this parameter teeth without changing the API shape.
- **Computed vs observed**: scenario endpoints stamp
  `meta.sourceClass: 'synthetic:scenario'` and `meta.computed: true` —
  a simulated outcome is not an outcome, at the protocol level.
- **Projection only**: no route mutates anything. The twin is a mirror;
  writes belong to the decision layer (propose → authorize → execute)
  in the Terminal, never here.
- **Metered upstreams** (none today): when they arrive they sit behind
  the budget-governed proxy discipline recorded in
  `src/data/sources.ts` — allowlisted destinations, per-IP throttles,
  disk-cached responses, response caps, sanitized errors, a
  per-provider credit governor.

## Corpus loaders — the source seam

The routes are corpus-blind: `server/loaders/*` hand them a corpus
object (`snapshot`, `readStateAt`, `scenarios`, `metaDefaults`) and the
admissibility posture travels with it. `CORPUS=synthetic|terminal`
selects the loader.

**`loaders/synthetic.mjs`** — the in-repo demo world. Every reading is
`known` (a computed world has nothing unobserved), and exactly for that
reason every record is inadmissible: `valueKind: 'representative'`,
`admissible: false`, basis stated.

**`loaders/terminal.mjs`** — the Terminal-projections loader the
architecture ledger anticipated, now real. It consumes a live
payload-terminal-v0 over HTTP (`/api/economy?commodity=copper|aluminium`,
`/api/economy/table?limit=0`, `/api/infrastructure`) and maps the
projections into a `WorldSnapshot` through EXPLICIT field-based tables
(kind+stage → NodeKind, flow mode → TransportMode, severity class →
0..1, status strings → LifecycleStatus) — never a semantic derived from
an id string. What that buys:

- **Admissibility earned per record.** Each observation carries the
  Terminal's own `value_kind`, and `admissible` is computed by the
  Terminal's own rule (`value_kind !== 'representative'`). The corpus
  MIXES ~580 admissible reported/estimated observations with ~210
  inadmissible representative ones — and corpus-level `meta.admissible`
  is `null`, because a blanket answer is not a fact for a mixed corpus.
- **Three-valued readings with teeth.** No state variables are observed
  upstream, so `readStateAt` answers `unobserved` (evidence exists,
  state channel unmeasured) or `no_history` (no evidence at all) —
  never a synthesized utilization. The client renders neutral unknown
  states for the same reason (`RemoteSpatialProvider` gates the
  deterministic resolver on `meta.corpusKind`).
- **Conservation accounting.** Every upstream record lands in exactly
  one bucket — mapped, or excluded with a reason (`/api/health`
  exposes the `mappingReport`; upstream refusal rows are preserved as
  exclusions, not mapped into values).
- **Honest absences.** No promises upstream → `assertions: []`,
  deviations refuse `NO_ASSERTIONS`, route `estimatedDurationHours` /
  `capacity` / `utilization` are ABSENT (the UI renders NOT ASSERTED);
  endpoint-only flow geometry → `geometryBasis: 'great_circle_estimate'`;
  no counterfactual baseline → scenario routes refuse
  `COUNTERFACTUALS_UNSUPPORTED_FOR_CORPUS`.

Contract tests for the loader run against **captured bytes from a live
Terminal** (`fixtures/terminal/`, manifest in `capture.json`; the
Terminal was pinned to its committed snapshots with
`PAYLOAD_DISABLE_LIVE=1` so the capture is deterministic and key-free).
The runtime loader always fetches live.
