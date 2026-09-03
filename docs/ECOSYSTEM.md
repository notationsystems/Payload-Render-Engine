# NOTATION SYSTEMS — THE APPARATUS REGISTER

> Notation Systems builds and operates provenance-bearing computational
> corpora.

That sentence is a claim about *structure*, not about output. A corpus
that bears its provenance is not one that happens to record where things
came from; it is one where a value cannot exist without its warrant,
because the constructors refuse to build one. Which means the company is
not a program — it is a set of **apparatuses**, each owning one stage of
the corpus lifecycle and refusing the others, and the refusals are what
make the guarantee hold across the seams.

This document is the register of those apparatuses, as read from their
own trees. The same register is served at `GET /api/ecosystem/register`
and rendered by the ECOSYSTEM instrument in the OS (`ecosystem` in the
command vocabulary), and it is checked against the trees by
`npm run ecosystem` so it cannot quietly rot.

---

## 0. How to read this

Three rules, and they are the same three the apparatuses apply to their
own data.

**Every row carries `readFrom`.** The provenance of a claim about an
apparatus is the file in that apparatus's tree where the claim was read.
Nothing here was inferred from a repository name, a README summary, or a
guess about intent. A register that made unsourced assertions about
provenance-bearing systems would be self-refuting.

**Presence is measured where it can be, stated where it cannot.**

| state | means |
| --- | --- |
| `OBSERVED` | probed and answered — the row carries the moment and the latency |
| `PRESENT` | its tree carries source; either nothing to probe, or probed and it did not answer |
| `DECLARED` | a repository exists and carries no implementation |
| `SCAFFOLD` | a starter tree, not yet made into anything |

An apparatus that exposes an HTTP surface is probed at read time and
upgraded to `OBSERVED`. Leaving such a row at `PRESENT` would understate
what the system already knows about itself — and understating is the
more dangerous direction, because it hides a dependency other
apparatuses may already be relying on.

A **failed probe reports reachability, never existence.** An apparatus
that did not answer stays `PRESENT` and says why. Collapsing those two
would let a stopped service read as an unbuilt apparatus, which is the
one confusion this register exists to prevent.

The probe is bounded (1.5s, cached 15s) so a register read never waits
on a stopped apparatus, and its destination is constrained at the call
site: a fixed path shape, and a host that must be loopback unless the
operator named it in `PAYLOAD_ALLOWED_HOSTS`. Pointed at
`169.254.169.254` it refuses and says so — a probe target read out of a
data structure is the shape of an SSRF primitive, so it is validated as
if it were untrusted even though nothing a caller sends reaches it.

**The gaps are rows, not omissions.** A named-but-unbuilt apparatus gets
a `DECLARED` row with the reason and what would unblock it. A register
that listed only the built apparatuses would show a complete ecosystem
that does not exist — which is exactly the failure mode every apparatus
here already refuses on its own data.

---

## 1. The corpus lifecycle

```
ACQUISITION → PERCEPTION → EVIDENCE → CANONICAL STATE → GRAPH PLANE → PROJECTION → OPERATOR
     DAF          OCR         DAF         Terminal        (nobody)      Render        Render
                                                                        Engine       Engine
                                                                                    Terminal
```

God's Eye View sits beside this diagram rather than on it, and Tradewind
is not on it at all — see §2.6 and §2.7.

Each stage is a question:

| stage | the question it exists to answer |
| --- | --- |
| ACQUISITION | what reached us, from where, and under what method? |
| PERCEPTION | what does this artifact say — with its warrant intact? |
| EVIDENCE | is this admissible, and under which class? |
| CANONICAL STATE | what does the corpus hold as authoritative right now? |
| GRAPH PLANE | how do the entities relate, and along which edges? |
| PROJECTION | what is a disposable representation of that state? |
| OPERATOR | what is healthy, stale, awaiting authority, or blocked? |

**One stage has no built owner: GRAPH PLANE.** Entity-to-entity structure
is currently computed per-read inside apparatuses that are forbidden to
hold it — the Render Engine mines it, the Terminal expands it. That is
correct today and stops being correct the moment an edge needs to be
evidenced and versioned in its own right, because there is nowhere to
put it. See §4.3.

---

## 2. The apparatuses

### 2.1 Data Acquisition Channel — `PRESENT`
`notation://node/apparatus/data-acquisition-channel` · stages: ACQUISITION, EVIDENCE

The acquisition frontier and the evidence admission gate. Adapters for
USGS, NOAA and EDGAR; method provenance and uncertainty carried on the
observation; a class assigned at ingest that cannot later be reassigned.

- **Holds** acquisition intent · evidence identity · admissibility · method provenance
- **Refuses** canonical state — the evidence chain and the canonical chain do not import each other. That is DAF's own finding, confirmed by grep in both directions in its state-space reconnaissance; this register reports it rather than re-deriving it, which is why the row cites that document
- **Speaks** *evidence class, fixed at ingest*: `asserted` `computed` `derived` `measured`. A fifth value, `unclassified`, marks the **absence** of a class and is inadmissible for canonical use; a computed object may not be labelled `measured` or `asserted`.

Read from `epistemics/evidence_class.py`, `docs/STANDING_PLAN.md`,
`docs/DAF_STATE_SPACE_BOUNDARY.md`.

### 2.2 Payload OCR Agent — `PRESENT`
`notation://node/apparatus/payload-ocr-agent` · stage: PERCEPTION

Document perception. Transforms documents into structured observations
with their warrant intact. Never into truth.

- **Holds** artifact identity (content-addressed) · extraction · observation construction · conflict detection
- **Refuses** canonical state — writing it is structurally forbidden: what leaves the agent is a `CanonicalStateCandidate` with `adjudication` fixed at `'pending'`, and the constructor throws `CanonicalStateBreach` rather than emit anything else, with a source-tree audit in its own suite holding the boundary · resolution (candidates are emitted with adjudication pinned to `pending`) · verification (the observation constructor throws on `RESOLVED` and `VERIFIED`) · financial and freight execution
- **Speaks** *epistemic state*: `OBSERVED` `EXTRACTED` `INFERRED` `RESOLVED` `VERIFIED` — only the first three emittable here. Absence is typed with six reasons; a refusal carries code, detail, remedy and stage.

Read from `docs/BOUNDARIES.md`, `docs/ARCHITECTURE.md`.

### 2.3 Payload Terminal — `PRESENT`
`notation://node/apparatus/payload-terminal` · stages: CANONICAL STATE, OPERATOR

Canonical state for the physical economy, and the operations desk over
it. Freight modelled as discrete manufacturing: a load is a unit under
process control, with a genealogy reconstructible afterwards.

- **Holds** canonical entity + observation records · the `refused:*` queue · operations authority · attestation and the notary
- **Refuses** execution without authorization (the gate is deterministic and blocking, on the critical path, and nothing executes without it) · the collapse of recommendation into authorization into execution — its own source states `RECOMMENDATION != AUTHORIZATION != EXECUTION` and keeps the three as separate objects · cryptography on the critical path, because notarization produces evidence *about* an execution rather than gating one, so a prover never sits between a dispatcher and a booking
- **Speaks** *value kind*: `reported` `observed` `estimated` `derived` `inferred` `computed` `unobserved`. Counted by frequency in `src/lib/economy`, `reported` dominates — the honest shape for a corpus assembled largely from what counterparties say.

Read from `docs/MANUFACTURING_FRAME.md`, `docs/ARCHITECTURE_LEDGER.md`,
`src/lib/economy/authorization.ts`, `src/lib/economy/`.

### 2.4 Payload Corpus Graph — `DECLARED`
`notation://node/apparatus/payload-corpus-graph` · stage: GRAPH PLANE

The repository exists and contains only `.git` — no source, no commit on
any branch reachable here.

**Why it is not built:** the graph plane of the substrate has a name and
a repository and no implementation. This row exists so the gap is
visible; an ecosystem map that omitted it would show a complete
lifecycle where one stage is missing.

**Unblocked by:** the first commit that gives entity-to-entity edges an
owner outside the Terminal. Until then the graph is a projection
computed per-read, not a plane.

### 2.5 PayLoad OS — Render Engine — `OBSERVED`
`notation://node/apparatus/payload-render-engine` · stages: PROJECTION, OPERATOR

The visual query surface and navigation environment over the corpus.
Earth as the query interface; every answer carries the build that
produced it and the level at which it can be verified.

- **Holds** disposable representations · the operator surfaces · the verification envelope · mined pattern candidates
- **Refuses** canonical state (INV-6 / SEC-017, mechanically checked) · authority (every credential stays server-side) · dispatch (no tool reaches a mutating or dispatching capability, SEC-011)
- **Speaks** *epistemic ladder*: `Observation` `DerivedMetric` `MinedPattern` `Hypothesis` `Inference`, and orthogonally the *verification ladder* `PROVENANCE ⊂ REPRODUCIBLE ⊂ ATTESTED ⊂ ZK_VERIFIED`, with the unreached levels stating what each missing rung requires.

### 2.6 God's Eye View — `PRESENT`
`notation://node/apparatus/gods-eye-view` · **owns no lifecycle stage**

A real-time intelligence console for planet Earth. It renders live feeds
and keeps none of them.

It owns no stage, and the distinction is the point. Acquisition *into
the corpus* is the Data Acquisition Channel's; God's Eye observes the
same world through a different surface and contributes nothing to the
corpus. Listing it under ACQUISITION would say this ecosystem acquires
from it — crediting the corpus with evidence it never received.

- **Speaks** *layer honesty*: `LIVE` `UNAVAILABLE` `KEY REQUIRED`. A keyless install is told which half of a mission it is getting, on the layer row, rather than the launcher trimming what it offers down to the lowest-configured install.

### 2.7 Tradewind SCM — `SCAFFOLD`
`notation://node/apparatus/tradewind-scm` · no stage

Nineteen files, one commit reading *"Initial commit from
Webflow-Examples/hello-world-nextjs-minimal"* — an unmodified starter. It
is listed because a register showing only the built apparatuses would
misrepresent what is actually in the workspace.

---

## 3. Convergence — what the trees agree on

None of this was coordinated. Each tree arrived at these separately,
which is the strongest available evidence that they are load-bearing
rather than stylistic: a convention adopted once is a preference; one
arrived at four times, under different pressures, is a constraint the
work keeps rediscovering.

| the convention | seen in | evidence |
| --- | --- | --- |
| **Unanswerable is an answer.** A refusal is typed and carries its remedy. | DAF · OCR · Terminal · Render Engine | OCR `Refusal(code, detail, remedy, stage)`; Terminal's `refused:*` queue grouped by mechanism with one shared remedy per group; Render Engine's SCREAMING_SNAKE refusals at HTTP 200; DAF's admission-gate refusals that name the gate |
| **Absence is typed** and never collapses to null or zero. | OCR · Terminal · Render Engine | OCR's six absence reasons; Terminal's `unobserved` as a value kind in its own right; the Render Engine's ABSENT-with-reason and *absence is not zero* stated on every surface that could imply it |
| **Confidence is not truth.** A model score is never promoted to a fact. | OCR · Render Engine | OCR carries `extractionConfidence`, `sourceReliability`, `evidenceStatus`, `verificationStatus` as four separate fields and pins the last two; the Render Engine keeps mined candidates gold and never renders them as observed |
| **A projection may not mutate what it derives from.** | DAF · OCR · Render Engine | OCR: no canonical writer exists in the package, audited over its own source tree; Render Engine: INV-6, checked by `scripts/check-seam.mjs`; DAF: the projection chain and the evidence chain do not import each other |
| **A check is not trusted until a planted violation makes it fail by name.** | DAF · Render Engine | DAF's cycle step 6 states it as doctrine; the Render Engine's security passes did exactly this, and one check failed to bite and had to be rewritten |
| **Proposing, authorizing and acting are three things**, and a surface may never let one read as another. | Terminal · Render Engine · OCR | The Terminal's authorization gate states `RECOMMENDATION != AUTHORIZATION != EXECUTION` in its own source. The Render Engine's control plane runs the same ladder as observed → proposed → approved → dispatched, where DISPATCHED needs a *delivered* tender, never an authorization. The OCR Agent draws the line one stage earlier: candidates carry `adjudication: 'pending'` and it may not resolve or verify |
| **Doctrine that restates code is generated from it**, so it cannot drift. | DAF · Render Engine | DAF generates `docs/generated/DOCTRINE.md` from `architecture/*.yaml` and diffs it as a gate; the Render Engine's invariant ledger is declared once in code, served, and checked for drift |

That last pair is why this document exists in the shape it does: it is
generated-adjacent (single-sourced in `shared/ecosystem.mjs`) and checked
against the trees (`scripts/check-ecosystem.mjs`).

---

## 4. Divergence — where they do not agree

These are **surfaced, not resolved.** Choosing one vocabulary over
another carries migration cost in four trees; that decision belongs to
whoever owns the substrate, not to the surface that noticed. What this
register owes is an accurate statement of the disagreement and a proposal
that can be accepted or rejected on its merits — never a silent
unification that makes the map agree with itself while the trees still
disagree.

### 4.1 Four vocabularies for how a value came to be known — *structural*

```
DAF evidence class      asserted · computed · derived · measured
OCR epistemic state     OBSERVED · EXTRACTED · INFERRED · RESOLVED · VERIFIED
Terminal value kind     reported · observed · estimated · derived · inferred · computed · unobserved
Render Engine ladder    Observation · DerivedMetric · MinedPattern · Hypothesis · Inference
```

**Why it matters.** `derived` and `computed` appear in three of the four
and are not defined identically. `observed`, `measured` and `OBSERVED`
are plausibly the same idea under three names. And `reported` — the
single most common kind in the Terminal — has no counterpart anywhere
else, even though a counterparty assertion is exactly what DAF calls
`asserted`. A value crossing two apparatuses is being relabelled by hand
at each seam, and a relabelling nobody wrote down is where provenance is
lost.

**Proposed.** Treat DAF's four ingest classes as the canonical axis —
they are the only set fixed at ingest and refused on reassignment. Map
Terminal `reported → asserted` and Terminal `observed → measured`. Keep
`estimated`/`inferred` as a **second, orthogonal axis** (distance from
the evidence) rather than as competing values on the first. The OCR
states are a **third axis** (position in the pipeline) and should not be
flattened into either.

**Measured, and it changed the finding.** `GET /api/vocabulary/alignment`
counts the `valueKind` on every served record. Against the Terminal
corpus, at the time of writing — **the route is the source, this table
is a reading of it**, and a number quoted from a document rather than
from the system is how a measurement becomes a belief:

| kind | records | relation | proposed |
| --- | ---: | --- | --- |
| `reported` | 547 | SAME | → `asserted` |
| `estimated` | 227 | **ORTHOGONAL** | stays — different axis |
| `representative` | 211 | **UNMAPPED** | needs a decision |
| `derived` | 59 | SAME | unchanged |

Two things fell out of counting that reading the declarations had
missed:

**A fifth kind nobody had written down.** `representative` — 211 records,
all carrying `admissible: false` — is a stand-in value held for shape
rather than for claim. No apparatus declares it and no vocabulary has a
counterpart. It is not a synonym for anything, so the alignment marks it
`UNMAPPED` and it needs a human decision rather than a mapping. This is
the argument for measuring a vocabulary instead of reading it.

**The proposal needs three axes, not one canonical list.** `estimated`
is not an alternative to `measured` — a value is measured OR asserted on
the ORIGIN axis and, separately, direct OR estimated on the DISTANCE
axis. Collapsing them forces a choice that discards one of the two
facts, which is exactly how `estimated` ends up competing with
`observed` in a single enum and neither meaning survives. The OCR states
are a third axis (position in the pipeline) and belong to neither.

So the shape of the fix is: 547 records rename cleanly, 227 stay put on a
second axis, and 211 need someone to decide what `representative` means
before anything is adopted.

**Nothing is applied.** `GET /api/vocabulary/alignment` and the
PROVENANCE instrument (`provenance`) render the proposal as PROPOSED,
and a test asserts that no served record has acquired a proposed label.
A surface that made the map agree with itself while the trees still
disagreed would be the silent relabelling this exists to stop.

**Owned by:** substrate.

### 4.2 The `notation://` identity space is specified and unimplemented — *structural*

DAF mints content-addressed evidence ids; OCR mints content-addressed
`artifactId`s; the Terminal mints entity ids shaped `ent:mine:escondida`;
the Render Engine reads Terminal ids and adds its own build fingerprints.

**Why it matters.** *One canonical identity space, many physical
representations* was the stated invariant. Today each apparatus mints in
its own space and the joins between them are positional. Nothing is
broken yet because the joins are few; they stop being few at the first
cross-apparatus query.

**Proposed.** The first useful step is not a migration but a **resolver**:
one apparatus that answers *"what does this `notation://` URI name, and
which apparatus holds it"* without anything having to renumber.

**Built** — see §7. The resolver exists in the projection layer, which
is the one place it could be built without asking any apparatus to
change. It resolves what this projection holds and refuses everything
else with the holder named. That does not close the divergence; it makes
it navigable, and it measures it.

**Owned by:** substrate.

### 4.3 The graph plane has a repository and no implementation — *gap*

**Why it matters.** Entity-to-entity structure is computed per-read
inside apparatuses that are forbidden to hold it. Correct for now;
incorrect the moment an edge must be evidenced and versioned in its own
right.

**Proposed.** Leave it `DECLARED` and visible. An empty repository
everyone can see is a better artifact than a graph half-built inside a
projection layer that is forbidden to hold state.

**Owned by:** substrate.

---

## 7. The `notation://` resolver

The identity space is specified in the substrate directive and, until
now, unimplemented. §4.2 named the first useful step and it was
deliberately not a migration. That step is built:

- `shared/notation.mjs` — the scheme: eleven kinds, who holds each, and
  whether this projection can answer for it
- `GET /api/notation/space` — the space, plus the **measurement** below
- `GET /api/notation/resolve?uri=…` — resolution over the served corpus
- the command bar — a `notation://` URI is an **address**: typing one
  navigates the OS or refuses with the apparatus that holds it
- the NOTATION instrument (`notation`) — the space, the measurement, and
  a working address field

### What it is, and is not

A **resolver, not an allocator**: it mints nothing, stores nothing, and
renames nothing. Every apparatus id keeps working exactly as it did; a
`notation://` URI is a second way to *say* one, never a thing anything
has to migrate to.

**A name is not a capability.** Resolving a URI reports what it names and
where that lives; it never grants access to it. Three kinds are
permanently absent from the space and the surface shows them as such —
`credential`, `session`, `agent` — because a URI that can name a
credential is a credential that will eventually be dereferenced. An
omission nobody can see is indistinguishable from an oversight, so it is
stated as a decision.

**Refusal is the point.** Six of eleven kinds resolve here; four are held
by another apparatus and one is held by nobody. Each of those refuses
with the holder named and what would have to exist first. A resolver
that returned nothing for them would be useless, and one that pretended
would be worse — so the refusals are the map.

### Both directions

The resolver turns an address into a record. A desk needs the other
direction far more often — *what do I paste into the channel so a
colleague lands on exactly this?* — and without it, precise reference
degrades to prose: "the big copper mine in Chile" is how two people look
at different records and agree with each other.

So every record carries its address, shown under its name in the info
panel and copyable in one click. The property that makes it worth
anything is **round-trip**: `addressOf(id)` must resolve back to `id`,
for every record the corpus serves. An address that does not round-trip
is worse than none, because it looks authoritative and sends the reader
somewhere else. A test holds that over the whole corpus rather than a
sample, so a corpus that grows a new id shape fails there before anyone
pastes a wrong address into a desk channel.

Where an address resolves through a non-primary id shape, the shape is
**shown**, not smoothed over — the corpus mints more than one, and an
undocumented relabelling is where provenance goes.

### The measurement

`GET /api/notation/space` counts the entity id shapes actually present
in the served corpus. Against the Terminal corpus it reported, at the
time of writing — again, the route is the source:

```
  76  ent:type:name
  57  bare-hyphenated
```

*One canonical identity space* is a claim; that is the number saying how
true it currently is — and the divergence turns out to run **inside** a
single apparatus, not only between them. The resolver accepts both
shapes and **reports which one answered** rather than normalising them,
because an undocumented relabelling is exactly where provenance is lost.

---

## 5. Where this OS sits

The Render Engine owns PROJECTION and shares OPERATOR with the Terminal.
Its standing constraint is that it must never become the database — it is
a projection and navigation environment over a canonical substrate that
lives elsewhere.

**That rule applies to this register too.** It is a map of apparatuses,
never a mirror of their state: it carries names, stages, boundaries and
vocabularies, and holds no record belonging to any apparatus. Reading it
gives you the shape of the ecosystem, never its data — and its served
trust level is `PROVENANCE`, not `REPRODUCIBLE`, because it is a scan
taken at a stated time rather than a probe taken now.

## 6. Keeping it honest

`scripts/check-ecosystem.mjs` (in `npm run check`) holds the register to
the trees:

- shape — every stage exists in the lifecycle; every `DECLARED`/`SCAFFOLD`
  row carries its reason; every row names where its claims were read;
  every convergence cites evidence; every divergence carries a proposal
  **and an owner**; every unowned stage has a row stating the gap
- against the trees — `PRESENT` must carry source, `DECLARED` must not
  (understating what exists is the more dangerous direction: it hides a
  plane other apparatuses may already depend on), `SCAFFOLD` must still
  be small, and every cited `readFrom` path must exist

When the sibling trees are not checked out beside this one — as in CI —
the tree checks **refuse with a reason** rather than failing. A check that
fails for being run in the wrong place teaches people to ignore it.
