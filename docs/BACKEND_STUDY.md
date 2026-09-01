# Backend study — what the sibling repos actually contain

The twin's backend was begun by **studying, not copying** the other
Payload repositories. This document records what that study found: the
conventions worth adopting (and now adopted in `server/`), the ones
deferred with reasons, and — just as important — what the repos were
*claimed* to contain versus what is actually there. A design doc that
cites a convention should be able to point at running code; where it
cannot, that is recorded here so nobody downstream builds on vapor.

Repos studied (cloned read-only, none of their code copied in):

| Repo | What it actually is |
|---|---|
| `payload-terminal-v0` | The real backend of record. FastAPI-style route-per-capability service + operator terminal. `docs/ARCHITECTURE_LEDGER.md` is the canon — decisions with rationale, including the one this service fulfils: *"a native 3D world view could one day consume projections over HTTP — a separate client, not a substrate."* |
| `data-acquisition-channel` (DAF) | Python acquisition framework: per-source channel modules, evidence classing, staged normalization. Real code, but **not** one unified pipeline (see "vapor and near-vapor" below). |
| `payload-ocr-agent` | Document → structured-record extraction agent. Its useful export is a stance, not code: extracted values keep their attestation (source page, confidence, method) attached to the number. |
| `tradewind-scm-nextjs` | **Empty.** An untouched create-next-app hello-world starter (see below). |
| `PayLoad-Corpus-Graph` | **Empty repo.** No commits of substance. |

## Adopted — now live in `server/` and tested in `server/test.mjs`

| Convention | Origin | Where it landed |
|---|---|---|
| `{ status, data, meta }` envelope on every response | Terminal | `server/api.mjs` `ok()` |
| `meta.sourceClass` + `valueKind: 'representative'` as the admissibility switch; `admissible: false` with `admissibleBasis: 'rests_on_representative'` — the *basis* stated, not implied | Terminal | `meta()` |
| `knownAt` / `asOf` split; `knowledge = best_known \| as_known_then`; `vintages: 1` honesty for the single-vintage corpus | Terminal (HINDSIGHT / AS-KNOWN) | `meta()`, `resolveKnowledge()` |
| `EvaluationFrame { kind: 'reconstruction' \| 'counterfactual', asOf, knowledge, scenarioId }` on every response — scenario endpoints stamp `counterfactual` + `sourceClass: 'synthetic:scenario'` + `computed: true` | Terminal `engine.ts` vocabulary | `meta()`, scenario routes |
| Typed refusals `{ kind, message, remedy }`, SCREAMING_SNAKE kinds naming the missing observable, delivered as **HTTP 200** — unanswerable is an answer, not a protocol error; 404 only for `unknown_capability` | Terminal | `refuse()`, `server/index.mjs` |
| Three-valued state readings `known \| unobserved \| no_history` — shape ships now, deterministic corpus answers `known`, real telemetry can answer honestly later without an API break | Terminal ("which kind of nothing") | `/api/state/:id` |
| Conservation accounting on batch reads: `examined = resolved + refused`, per-item outcomes, never all-or-nothing | DAF | `/api/states` |
| `attribution` fingerprint (service, version, corpus, corpus vintage) so a wrong-looking number is traceable | Terminal / OCR-agent stance | `meta()` |
| Null-means-unknown, never 0; no empty-array-as-answer (`QUERY_TOO_SHORT`, `NO_ASSERTIONS`) | Terminal | search/deviations routes |
| Projection-only service: no route mutates canonical state (INV-6 at the protocol layer); writes belong to the Terminal's decision layer | Terminal ledger | whole service |
| One semantic layer on both sides of the wire: the server executes the client's own erasable-TS `src/data/**` via Node type-stripping; `createStateResolver` shared, so server and client cannot drift | (twin's own seam, validated against Terminal's one-corpus stance) | `server/api.mjs`, `src/data/remote/provider.ts` |

## Deferred — real conventions, not yet earned here

- **Id-prefix mapping** (`ent:` ↔ `node:` etc.): the Terminal's records
  use different id prefixes than the twin's corpus. Deferred until the
  Terminal-projections loader exists; when it lands, the mapping must
  be an explicit table in the loader, because **semantics must never be
  derived from id strings** — an id is a name, not a schema.
- **AttestedWire on derived numbers** (OCR-agent): every derived
  quantity carries its attestation (method, inputs, confidence) as a
  sibling field. The twin's deviation endpoint already joins promises
  to evidence; attaching per-number attestation waits for real
  observations to attest.
- **DAF `evidence_class`**: the DAF's per-channel evidence classing
  (documentary / sensor / declared) maps onto `Observation.provenance`
  but is coarser today (`synthetic:demo` for everything). Adopt when a
  second source class exists — a taxonomy with one member is a label.
- **Multi-vintage bitemporality**: `knowledge=as_known_then` is
  accepted and echoed, but the corpus has one vintage, and
  `meta.vintages: 1` says so. `knownAt`/`supersedes` on observations
  give the parameter teeth later without an API break.

## Rejected

- **Copying any code across repos.** The instruction was "not copy but
  study"; every adopted item above was re-derived in this codebase's
  own idiom against its own contracts, then pinned by contract tests.
- **A write surface on this service.** The Terminal's ledger is
  explicit that mutation belongs to propose → authorize → execute in
  the decision layer. The twin is a mirror; `server/` exposes GET only.
- **Deriving structure from id strings** anywhere (e.g. inferring kind
  from a `node:port-*` prefix server-side). Kind is a field.

## Vapor and near-vapor — do not cite these

- **`tradewind-scm-nextjs` is an untouched create-next-app starter.**
  It contains the default hello-world page and no SCM code of any
  kind. Any design doc citing "TradeWind API conventions" is citing
  vapor; nothing here adopts anything from it.
- **`PayLoad-Corpus-Graph` is an empty repository.** No schema, no
  graph, nothing to study or integrate against.
- **The DAF's unified "DAF → Canonical State" chain does not exist as
  one pipeline.** The channels are real, individually; the end-to-end
  chain is aspiration in prose. Treat each channel as its own source
  with its own evidence class, and do not design against the unified
  pipeline until it runs.
- **`payload-terminal-v0/engine/` is orphaned** — compiled `.pyc`
  artifacts with no corresponding live source wiring. The live canon
  is the route handlers plus `docs/ARCHITECTURE_LEDGER.md`; study
  those, not the dead directory.

## Integration path — SHIPPED (`server/loaders/terminal.mjs`)

The Terminal-projections loader is real: it consumes a live
payload-terminal-v0 over HTTP and maps `/api/economy` (map view: 76
geo-anchored real facilities, 58 flows with modes, 14 real historical
events), `/api/economy/table?limit=0` (~830 bitemporal observations
with per-record `value_kind`), and `/api/infrastructure` (57 curated
nuclear facilities) into a `WorldSnapshot`. Per-record provenance
carries the Terminal's own `valueKind`, and `admissible` is earned per
record by the Terminal's own rule (`value_kind !== 'representative'`)
— the corpus mixes ~580 admissible with ~210 inadmissible records and
says which is which on every record. The client did not change its
contracts; the one client change was an honesty gate: the deterministic
state resolver only runs for the synthetic corpus, so a projected
corpus renders honest unknown states instead of synthesized dynamics.

Facts the loader study added (verified against live wire captures, in
`server/fixtures/terminal/`):

- `PAYLOAD_DISABLE_LIVE=1` pins the Terminal to its committed
  snapshots — deterministic, key-free upstream for tests.
- `limit=0` on the table route is the sanctioned full-corpus pull;
  nothing in the Terminal paginates (bounded-with-stated-bound idiom).
- The table carries inline typed refusal rows (unresolved M49 codes,
  with remedies) — the loader excludes and ACCOUNTS them, never maps
  them into values.
- Flows carry no `knownAt` — the loader stamps flow provenance with
  the fetch instant (when the TWIN learned them), stated as such.
- The Terminal serves NO routed path geometry from committed data
  (`/api/directions` is live-network-bound); flow endpoints become
  great-circle arcs labeled `geometryBasis: 'great_circle_estimate'`.
- `econ_entities` carries `bottleneckScore` — an UNATTESTED derived
  number, the exact defect the Terminal's own attestation module
  documents. The loader deliberately does not ingest it.

## Addendum — the control-tower direction (studied 2026-09-01)

The Terminal's `claude/osiris-physical-economy-7o9g2w` branch added the
**freight operations control tower**: load operations as an append-only
hash-chained journal with a 7-phase lifecycle behind typed command
refusals, carrier communications with idempotent at-least-once tender
delivery, decision episodes with research-safe cohorts and guarded
exploration, authoritative FMCSA/EIA source pulls with per-response
attestation, and `GET /api/freight/control-tower` — an exception-first
projection (named issue + severity + deadline + operator remedy +
evidence refs; no composite scores; refuses on journal corruption
rather than showing an empty desk) behind a fail-closed
`PAYLOAD_OPERATIONS_TOKEN`.

Adopted into the twin (front-of-OS): the OPERATIONS tab + panel
(`src/ui/opsPanel.ts`), the `/api/operations` server mirror (credential
server-side), the OBSERVED/REMEDY issue split, stated policy
thresholds, per-number attestation with the interest flag, and lane
arcs with position honesty (dashed when tracking is unobserved; no
vehicle markers — the tower serves timestamps, not coordinates).
Deliberately NOT adopted: any write surface — the twin renders the
projection and never commands.
