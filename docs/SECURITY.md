# PAYLOAD OS — SECURITY MODEL

The security substrate extends the existing architecture; it does not
replace it. The honesty discipline that governs the data model governs
this document too: **a control that does not exist is stated as absent
with its reason, never implied.**

The code is the ground truth. Every invariant below that can be
machine-checked is checked by `scripts/check-security.mjs` (in
`npm run check`) or by `server/test.mjs`.

---

## 1. What this system actually is

Scoping honestly is a security control: inventing an authentication
stack for a system with no accounts produces theatre, not defence.

| | |
|---|---|
| **Renderer** (`src/**`) | A browser client. Projection only — it never mutates canonical state (INV-6, mechanically enforced by `check-seam.mjs`). |
| **Spatial API** (`server/**`) | A **read-only** Node projection service. Every route is `GET`. There is no write path, no database, no ORM, no SQL, no user accounts, no sessions, no cookies, no JWT. |
| **Upstreams** | The Payload Terminal (own authority), and fixed external hosts reached through proxies. |
| **Secrets held** | `PAYLOAD_OPERATIONS_TOKEN` (Terminal operations authority), `FIRMS_MAP_KEY` (NASA), `IBKR_GATEWAY_URL` (broker gateway location). All server-side environment only. |

### Controls that do not exist here, and why

| Control | Status | Reason |
|---|---|---|
| User authentication (OIDC / passkeys / sessions) | **ABSENT** | No user accounts, no per-user data, no login surface exists. Adding an IdP would secure nothing that exists. |
| Authorization (RBAC/ABAC over subjects) | **ABSENT** | Same: there is no subject to authorize. Authority in this service is **service-to-service** (§5), and *that* is enforced. |
| Encryption at rest / envelope encryption | **ABSENT** | The service stores no data. The corpus is read from an upstream or built in-process; the only writes are a disk cache of *public* feed responses (`.live-cache`). No confidential class exists to encrypt. |
| Multi-tenancy isolation | **ABSENT** | Single-tenant by construction; no tenant identifier exists. |
| Write-path validation / CSRF | **N/A** | No state-changing route exists. `OPTIONS` and `GET` only; non-GET is refused at the transport layer (SEC-018). |

When any of these becomes real — the corpus platform lands writes, or
operators get accounts — the invariants below are the place they
attach, and the ladder in `/api/system/topology` already carries
`approved → dispatched` for the moment a dispatch path exists.

---

## 2. Trust boundaries

```
  browser (operator)  ──┐   UNTRUSTED: the page can be opened from a
                        │   hostile link; query params are attacker-
                        │   reachable (?api=)
                        ▼
  renderer (src/**)   ──┐   SEMI-TRUSTED: renders untrusted upstream
                        │   text; must never grant it markup power
                        ▼
  ─────────────── ORIGIN / HOST BOUNDARY (SEC-101, SEC-102) ─────────
                        ▼
  spatial API         ──┐   HOLDS AUTHORITY: PAYLOAD_OPERATIONS_TOKEN.
                        │   Confused-deputy risk lives here.
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
  corpus (in-proc)  Terminal        external hosts
                   (own authority)  (fixed in code, SEC-105)
```

Trust **decreases** left-to-right into the renderer and
right-to-left out of every upstream. Trust **never** propagates from
a rendered representation back into canonical state: there is no path
for it to travel (mechanically enforced).

---

## 3. Adversaries modelled

| Actor | Capability assumed | Primary control |
|---|---|---|
| **Hostile web page** (operator visits it while the OS runs) | Issue cross-origin requests to `127.0.0.1:8788`; read responses if CORS permits | SEC-101 origin allowlist, SEC-103 no wildcard |
| **DNS rebinder** | Make a hostile origin resolve to loopback, defeating same-origin | SEC-102 Host allowlist |
| **Hostile link author** | Choose the operator's URL — including `?api=` | SEC-110 API-base validation |
| **Compromised / malicious upstream** (Terminal, external feed) | Return arbitrary strings that the OS renders | SEC-120 markup-safe escaping, SEC-121 attribute safety |
| **Network observer** | Read plaintext transport | SEC-130 TLS to every external host, verification never disabled |
| **Log / crash-dump reader** | Read server logs and error responses | SEC-140 error redaction, SEC-141 secret scrubbing |
| **Quota / cost attacker** | Drive proxy routes to exhaust upstream quota or get the operator's key banned | SEC-150 per-client rate limits |
| **Malicious dependency** | Ship code into the build | SEC-160 pinned lockfile, minimal dependency surface, audit in `check` |
| **Curious agent** (LLM through the tool surface) | Invoke exposed tools; read whatever the OS returns | SEC-170 tool surface is read-only by construction; SEC-013 no credential ever enters a response |

---

## 4. Security invariants

Invariants marked **[checked]** have an automated test. The check name
is given so a failure names its own invariant.

### Transport and origin

- **SEC-101** *Cross-origin reads are allowlisted.* The API answers CORS
  only to origins on an explicit allowlist (`PAYLOAD_ALLOWED_ORIGINS`,
  default: loopback dev origins). **[checked: origin-allowlist]**
- **SEC-102** *The Host header is validated.* A request whose Host is
  not loopback or an allowlisted host is refused — DNS-rebinding
  defence. **[checked: host-guard]**
- **SEC-103** *No wildcard CORS.* `Access-Control-Allow-Origin: *` must
  not appear in the served headers. **[checked: no-wildcard-cors]**
- **SEC-104** *Privileged routes fail closed on a foreign origin.* Any
  route that spends the operations authority refuses a request carrying
  a non-allowlisted `Origin`, before any upstream call.
  **[checked: privileged-origin]**
- **SEC-105** *Proxy destinations are fixed in code.* No user input may
  select an outbound host. **[checked: no-dynamic-egress]**
- **SEC-130** *TLS verification is never disabled.* No
  `NODE_TLS_REJECT_UNAUTHORIZED=0`, no `rejectUnauthorized: false`.
  **[checked: tls-verify]**
- **SEC-018** *Only GET/OPTIONS are served.* Any other method is refused
  at the transport layer. **[checked: method-guard]**

### Secrets and authority

- **SEC-004** *No secret in source control.* **[checked: secret-scan]**
- **SEC-013** *No credential value in any response.* Authority is
  reported as PRESENT/ABSENT only. **[checked: no-credential-echo]**
- **SEC-141** *Secrets are scrubbed from logs and errors.* The request
  logger records the path and known-safe params only; error responses
  carry a correlation id, never an internal message.
  **[checked: error-redaction]**
- **SEC-005** *No long-lived secret in browser storage.* The client
  stores only view conveniences (`pe.workspace`, `pe.watches`,
  `pe.alertCue`). **[checked: storage-scan]**
- **SEC-015** *Authorization failure fails closed* — an unconfigured or
  refused authority yields a typed refusal, never a degraded answer.
  (Long-standing; covered by the operations/broker mirror tests.)

### Rendering (the renderer is the last line for upstream text)

- **SEC-120** *One escaper, and it is markup-safe.* Every UI module
  escapes through `src/core/escape.ts`; no module defines its own.
  **[checked: single-escaper]**
- **SEC-121** *Attribute contexts are quote-safe.* The shared escaper
  escapes `& < > " '`, so escaped text is safe in both element and
  attribute position. **[checked: escaper-covers-quotes]**
- **SEC-122** *Class names are never interpolated from wire values* —
  severity/state strings are whitelisted before reaching markup.
  (Existing discipline in `opsPanel`; extended by the escaper.)
- **SEC-110** *The API base is validated.* `?api=` accepts only
  `http(s)` on loopback or an allowlisted host; anything else is
  refused and the OS falls back to the in-browser corpus **and says
  so**. An attacker-chosen backend would otherwise control everything
  the OS renders, including its own verification claims.
  **[checked: api-base-validation]**

### Abuse and integrity

- **SEC-150** *Metered and proxied routes are rate limited* per client,
  with a typed refusal (`RATE_LIMITED`) carrying a retry hint.
  **[checked: rate-limit]**
- **SEC-160** *Dependencies are pinned and minimal.* `package-lock.json`
  is committed; the runtime dependency set is four packages.
  **[checked: lockfile]**
- **SEC-009** *Provenance stays cryptographically bound* — the
  commitment manifest and inclusion proofs (§Verification Envelope,
  ARCHITECTURE §21) are the tamper-evidence layer; a tampered record
  fails offline verification. **[checked: existing commitment tests]**
- **SEC-014** *Verification failure fails closed* — a proof that does
  not fold to the root is reported as a failure, never softened.

---

## 5. Identity separation — the security half of the substrate contract

These are different things and are never collapsed into one identifier
or one trust domain. The right-hand column anticipates the Notation
Substrate's global namespace (`notation://…`): **one canonical identity
space, many physical representations.** Keeping these distinct is what
makes that namespace safe to address — a single opaque id would let a
reader of one class silently acquire the authority of another.

| Identity | Where it lives today | Substrate namespace | Never |
|---|---|---|---|
| **Evidence identity** | `provenance.source`, `evidenceIds` | `notation://artifact/…`, `notation://observation/…` | conflated with data identity |
| **Data identity** | `EntityId` | `notation://entity/…` | reused as an authority |
| **Canonical-state identity** | `corpusBuild.canonicalStateFingerprint`, `merkleRoot` | `notation://state/…` | derived from a representation |
| **Execution identity** | `miningRunId`, `scenarioId`, computation refs | `notation://transform/…` | conflated with verification |
| **Verification identity** | `verification.level` + inclusion proofs | `notation://proof/…` | conflated with execution — proving a computation *ran* is not proving its inputs were *true* |
| **Service identity** | `PAYLOAD_OPERATIONS_TOKEN` (this service → Terminal) | — (never addressable) | given to a browser, logged, or returned |
| **Agent identity** | `journal` source `agent` on the tool surface | — (never addressable) | granted capabilities beyond the read-only surface |
| **Deployment identity** | `attribution.service` / `version` | — | trusted as authority |

Two of these are deliberately **not** addressable in any namespace:
service and agent identity are *authority*, not *knowledge*. A URI
scheme that could name a credential is a credential that will
eventually be dereferenced.

### What this means when the substrate lands

The substrate's rule — *Nodes is a projection, never the database* —
is the same invariant this renderer already enforces (INV-6,
mechanically checked). So the security posture carries over unchanged:

- a projection may **read** through the identity space and must never
  hold write authority over it (SEC-017);
- a `notation://` reference is a **name**, never a capability —
  possession of an id must not imply permission to dereference it,
  which is where the authorization layer attaches when subjects exist
  (§1, currently ABSENT with reason);
- the six substrate layers (evidence lake → canonical state → graph →
  lakehouse → indexes → derived compute) are separate **trust**
  boundaries as well as storage boundaries: an index or a derived
  state is a disposable representation, so a compromise there must be
  recoverable by recompilation and must never be able to rewrite
  canonical state.

---

## 6. Operating the service safely

```
PAYLOAD_ALLOWED_ORIGINS   comma-separated origins allowed to read cross-origin
                          (default: http://localhost:5173, http://127.0.0.1:5173)
PAYLOAD_ALLOWED_HOSTS     comma-separated Host values accepted
                          (default: loopback names only)
PAYLOAD_OPERATIONS_TOKEN  Terminal operations authority — server-side only
FIRMS_MAP_KEY             NASA FIRMS key — server-side only
IBKR_GATEWAY_URL          broker gateway location — server-side only
HOST / PORT               bind address; defaults to 127.0.0.1 (never 0.0.0.0
                          without an origin allowlist and TLS termination)
```

Binding to a non-loopback interface without setting
`PAYLOAD_ALLOWED_HOSTS` and `PAYLOAD_ALLOWED_ORIGINS` is refused at
startup: a service holding operations authority does not silently
become world-reachable.
