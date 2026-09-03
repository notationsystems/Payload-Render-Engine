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

**Presence is stated, not assumed.**

| state | means |
| --- | --- |
| `OBSERVED` | this OS reached it and it answered |
| `PRESENT` | its tree carries source; not probeable from here |
| `DECLARED` | a repository exists and carries no implementation |
| `SCAFFOLD` | a starter tree, not yet made into anything |

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
  Gods-Eye                                                              Engine       Engine
                                                                                    Terminal
```

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
- **Refuses** canonical state — the evidence chain and the canonical chain do not import each other, confirmed by grep in both directions and recorded in its own reconnaissance
- **Speaks** *evidence class, fixed at ingest*: `asserted` `computed` `derived` `measured`. A fifth value, `unclassified`, marks the **absence** of a class and is inadmissible for canonical use; a computed object may not be labelled `measured` or `asserted`.

Read from `epistemics/evidence_class.py`, `docs/STANDING_PLAN.md`,
`docs/DAF_STATE_SPACE_BOUNDARY.md`.

### 2.2 Payload OCR Agent — `PRESENT`
`notation://node/apparatus/payload-ocr-agent` · stage: PERCEPTION

Document perception. Transforms documents into structured observations
with their warrant intact. Never into truth.

- **Holds** artifact identity (content-addressed) · extraction · observation construction · conflict detection
- **Refuses** canonical state (no canonical types, stores or writers exist in the package — audited by a test over its own source tree) · resolution (candidates are emitted with adjudication pinned to `pending`) · verification (the observation constructor throws on `RESOLVED` and `VERIFIED`) · financial and freight execution
- **Speaks** *epistemic state*: `OBSERVED` `EXTRACTED` `INFERRED` `RESOLVED` `VERIFIED` — only the first three emittable here. Absence is typed with six reasons; a refusal carries code, detail, remedy and stage.

Read from `docs/BOUNDARIES.md`, `docs/ARCHITECTURE.md`.

### 2.3 Payload Terminal — `PRESENT`
`notation://node/apparatus/payload-terminal` · stages: CANONICAL STATE, OPERATOR

Canonical state for the physical economy, and the operations desk over
it. Freight modelled as discrete manufacturing: a load is a unit under
process control, with a genealogy reconstructible afterwards.

- **Holds** canonical entity + observation records · the `refused:*` queue · operations authority · attestation and the notary
- **Refuses** nothing on this list — it is the authoritative writer, and every other apparatus is upstream or downstream of it
- **Speaks** *value kind*: `reported` `observed` `estimated` `derived` `inferred` `computed` `unobserved`. Counted by frequency in `src/lib/economy`, `reported` dominates — the honest shape for a corpus assembled largely from what counterparties say.

Read from `docs/MANUFACTURING_FRAME.md`, `docs/ARCHITECTURE_LEDGER.md`,
`src/lib/economy/`.

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
`notation://node/apparatus/gods-eye-view` · stage: ACQUISITION

A real-time intelligence console for planet Earth. A sibling observation
surface, not a stage in the corpus lifecycle: it renders live feeds and
keeps none of them.

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
