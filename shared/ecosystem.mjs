/**
 * THE NOTATION SYSTEMS APPARATUS REGISTER
 *
 * Notation Systems builds and operates provenance-bearing computational
 * corpora. It does that through several apparatuses, each of which owns
 * one stage of the corpus lifecycle and refuses the others. This module
 * is the register of those apparatuses: what each one is, where it sits,
 * what authority it holds, and — the part that matters — what it
 * refuses.
 *
 * THE REGISTER IS DERIVED, NOT DECLARED ABOUT.
 *
 * Every claim below carries `readFrom`: the file in that apparatus's own
 * tree where the claim was read. Nothing here is inferred from a name, a
 * README summary, or a guess about intent. An apparatus that says
 * nothing about itself gets a row that says so — an empty register row
 * is a finding, not a blank to fill in with something plausible.
 *
 * THE REGISTER IS NOT THE SUBSTRATE.
 *
 * The standing rule for this projection layer is that Nodes must never
 * become the database — it is a projection and navigation environment
 * over a canonical substrate that lives elsewhere. The same rule applies
 * one level up: this register is a *map of apparatuses*, not a mirror of
 * their state. It never holds an apparatus's records, and reading it
 * gives you names and boundaries, never data.
 *
 * OBSERVED vs DECLARED.
 *
 * `presence` distinguishes what was seen from what was said:
 *
 *   OBSERVED   this OS has probed it and it answered
 *   PRESENT    the tree exists and carries source; not probeable from
 *              here (no HTTP surface, or not running)
 *   DECLARED   a repository exists and carries no implementation yet
 *   SCAFFOLD   a starter tree that has not been made into anything
 *
 * DECLARED is the honest state for a named-but-unbuilt apparatus, and it
 * must render as such. A register that quietly omitted the unbuilt rows
 * would show a complete ecosystem that does not exist.
 */

/** The corpus lifecycle. Every apparatus owns a stage and refuses the rest. */
export const LIFECYCLE = Object.freeze([
  {
    id: 'acquisition',
    label: 'ACQUISITION',
    question: 'what reached us, from where, and under what method?',
  },
  {
    id: 'perception',
    label: 'PERCEPTION',
    question: 'what does this artifact say — with its warrant intact?',
  },
  {
    id: 'evidence',
    label: 'EVIDENCE',
    question: 'is this admissible, and under which class?',
  },
  {
    id: 'canonical',
    label: 'CANONICAL STATE',
    question: 'what does the corpus hold as authoritative right now?',
  },
  {
    id: 'graph',
    label: 'GRAPH PLANE',
    question: 'how do the entities relate, and along which edges?',
  },
  {
    id: 'projection',
    label: 'PROJECTION',
    question: 'what is a disposable representation of that state?',
  },
  {
    id: 'operator',
    label: 'OPERATOR',
    question: 'what is healthy, stale, awaiting authority, or blocked?',
  },
]);

/**
 * The apparatuses. `readFrom` is the provenance of the row itself: the
 * path, relative to the workspace root, where the claim was read.
 */
export const APPARATUSES = Object.freeze([
  {
    id: 'daf',
    notation: 'notation://node/apparatus/data-acquisition-channel',
    repo: 'notationsystems/data-acquisition-channel',
    label: 'Data Acquisition Channel',
    short: 'DAF',
    stages: ['acquisition', 'evidence'],
    presence: 'PRESENT',
    presenceBasis: 'tree carries source; no HTTP surface to probe from here',
    declares:
      'The acquisition frontier and the evidence admission gate. Adapters for USGS, NOAA and EDGAR; method provenance and uncertainty carried on the observation; a class assigned at ingest that cannot later be reassigned.',
    holds: ['acquisition intent', 'evidence identity', 'admissibility', 'method provenance'],
    refuses: [
      'canonical state — the evidence chain and the canonical chain do not import each other, confirmed by grep in both directions',
    ],
    vocabulary: {
      name: 'evidence class, fixed at ingest',
      terms: ['asserted', 'computed', 'derived', 'measured'],
      note: 'a fifth value, unclassified, marks the ABSENCE of a class and is inadmissible for canonical use; a computed object may not be labelled measured or asserted',
    },
    readFrom: [
      'notationsystems/data-acquisition-channel/epistemics/evidence_class.py',
      'notationsystems/data-acquisition-channel/docs/STANDING_PLAN.md',
      'notationsystems/data-acquisition-channel/docs/DAF_STATE_SPACE_BOUNDARY.md',
    ],
  },
  {
    id: 'ocr',
    notation: 'notation://node/apparatus/payload-ocr-agent',
    repo: 'notationsystems/payload-ocr-agent',
    label: 'Payload OCR Agent',
    short: 'OCR Agent',
    stages: ['perception'],
    presence: 'PRESENT',
    presenceBasis: 'tree carries source; a library, not a service — nothing to probe',
    declares:
      'Document perception. Transforms documents into structured observations with their warrant intact. Never into truth.',
    holds: ['artifact identity (content-addressed)', 'extraction', 'observation construction', 'conflict detection'],
    refuses: [
      'canonical state — no canonical types, stores or writers exist in the package, audited by a test over its own source tree',
      'resolution — it emits candidates with adjudication pinned to pending',
      'verification — the observation constructor throws on RESOLVED and VERIFIED',
      'financial or freight execution',
    ],
    vocabulary: {
      name: 'epistemic state',
      terms: ['OBSERVED', 'EXTRACTED', 'INFERRED', 'RESOLVED', 'VERIFIED'],
      note: 'only the first three may be emitted here; typed absence carries six reasons (NOT_PRESENT, NOT_READABLE, NOT_EXTRACTED, NOT_APPLICABLE, UNKNOWN, CONFLICTING) and a refusal carries code, detail, remedy and stage',
    },
    readFrom: [
      'notationsystems/payload-ocr-agent/docs/BOUNDARIES.md',
      'notationsystems/payload-ocr-agent/docs/ARCHITECTURE.md',
    ],
  },
  {
    id: 'terminal',
    notation: 'notation://node/apparatus/payload-terminal',
    repo: 'notationsystems/payload-terminal-v0',
    label: 'Payload Terminal',
    short: 'Terminal',
    stages: ['canonical', 'operator'],
    presence: 'PRESENT',
    presenceBasis: 'serves an HTTP surface; this OS reads it through the projection service',
    declares:
      'Canonical state for the physical economy, and the operations desk over it. Freight modelled as discrete manufacturing: a load is a unit under process control, with a genealogy reconstructible afterwards.',
    holds: [
      'canonical entity + observation records',
      'the refused:* queue',
      'operations authority (authorize, dispatch, tender)',
      'attestation and the notary',
    ],
    refuses: ['nothing on this list — it is the authoritative writer; every other apparatus is downstream or upstream of it'],
    vocabulary: {
      name: 'value kind',
      terms: ['reported', 'observed', 'estimated', 'derived', 'inferred', 'computed', 'unobserved'],
      note: 'counted by frequency in src/lib/economy: reported dominates, which is the honest shape for a corpus assembled largely from what counterparties say',
    },
    readFrom: [
      'notationsystems/payload-terminal-v0/docs/MANUFACTURING_FRAME.md',
      'notationsystems/payload-terminal-v0/docs/ARCHITECTURE_LEDGER.md',
      'notationsystems/payload-terminal-v0/src/lib/economy/',
    ],
  },
  {
    id: 'corpus-graph',
    notation: 'notation://node/apparatus/payload-corpus-graph',
    repo: 'notationsystems/payload-corpus-graph',
    label: 'Payload Corpus Graph',
    short: 'Corpus Graph',
    stages: ['graph'],
    presence: 'DECLARED',
    presenceBasis:
      'the repository exists and contains only .git — no source, no commit on any branch reachable here',
    declares: null,
    holds: [],
    refuses: [],
    vocabulary: null,
    absence: {
      reason:
        'the graph plane of the substrate has a name and a repository and no implementation. This row exists so the gap is visible: an ecosystem map that omitted it would show a complete lifecycle where one stage is missing.',
      unblockedBy:
        'the first commit that gives entity-to-entity edges an owner outside the Terminal — until then the graph is a projection computed per-read, not a plane',
    },
    readFrom: ['notationsystems/payload-corpus-graph/ (directory listing)'],
  },
  {
    id: 'render-engine',
    notation: 'notation://node/apparatus/payload-render-engine',
    repo: 'notationsystems/Payload-Render-Engine',
    label: 'PayLoad OS — Render Engine',
    short: 'Render Engine',
    stages: ['projection', 'operator'],
    presence: 'OBSERVED',
    presenceBasis: 'this apparatus — you are reading its projection right now',
    declares:
      'The visual query surface and navigation environment over the corpus. Earth as the query interface; every answer carries the build that produced it and the level at which it can be verified.',
    holds: ['disposable representations', 'the operator surfaces', 'the verification envelope', 'mined pattern candidates'],
    refuses: [
      'canonical state — the renderer holds no write authority, mechanically checked (INV-6 / SEC-017)',
      'authority — every credential stays server-side; the browser never holds one',
      'dispatch — no tool reaches a mutating or dispatching capability (SEC-011)',
    ],
    vocabulary: {
      name: 'epistemic ladder + verification ladder',
      terms: ['Observation', 'DerivedMetric', 'MinedPattern', 'Hypothesis', 'Inference'],
      note: 'and, orthogonally, PROVENANCE subset REPRODUCIBLE subset ATTESTED subset ZK_VERIFIED — with the unreached levels stating what each missing rung requires',
    },
    readFrom: ['docs/ARCHITECTURE.md', 'docs/SECURITY.md', 'shared/miner.mjs'],
  },
  {
    id: 'gods-eye',
    notation: 'notation://node/apparatus/gods-eye-view',
    repo: 'notationsystems/gods-eye-view',
    label: "God's Eye View",
    short: "God's Eye",
    stages: ['acquisition'],
    presence: 'PRESENT',
    presenceBasis: 'tree carries source; a separate browser application, not a service this OS reads',
    declares:
      'A real-time intelligence console for planet Earth — live aircraft, ships, satellites and earthquakes on a photorealistic globe. A sibling observation surface, not a stage in the corpus lifecycle.',
    holds: ['live contact rendering', 'first-run mission framing'],
    refuses: ['corpus state — it renders live feeds and keeps none of them'],
    vocabulary: {
      name: 'layer honesty',
      terms: ['LIVE', 'UNAVAILABLE', 'KEY REQUIRED'],
      note: 'a keyless install is told which half of a mission it is getting, on the layer row, rather than the launcher trimming what it offers down to the lowest-configured install',
    },
    readFrom: ['notationsystems/gods-eye-view/docs/CURRENT-STATE.md', 'notationsystems/gods-eye-view/package.json'],
  },
  {
    id: 'tradewind',
    notation: 'notation://node/apparatus/tradewind-scm',
    repo: 'tradewind-scm-nextjs',
    label: 'Tradewind SCM',
    short: 'Tradewind',
    stages: [],
    presence: 'SCAFFOLD',
    presenceBasis:
      'nineteen files, one commit reading "Initial commit from Webflow-Examples/hello-world-nextjs-minimal" — an unmodified starter',
    declares: null,
    holds: [],
    refuses: [],
    vocabulary: null,
    absence: {
      reason:
        'a starter tree that has not yet been made into anything. It is listed because a register that showed only the built apparatuses would misrepresent what is actually in the workspace.',
      unblockedBy: 'the first commit that makes it something other than the Webflow template',
    },
    readFrom: ['tradewind-scm-nextjs/package.json', 'tradewind-scm-nextjs/ (git log)'],
  },
]);

/**
 * What the apparatuses independently agree on.
 *
 * These were not coordinated. Each tree arrived at them separately, and
 * that is the strongest evidence that they are load-bearing rather than
 * stylistic — a convention adopted once is a preference, a convention
 * arrived at four times under different pressures is a constraint.
 */
export const CONVERGENCES = Object.freeze([
  {
    id: 'typed-refusal',
    statement: 'Unanswerable is an answer. A refusal is typed and carries its remedy.',
    seenIn: ['daf', 'ocr', 'terminal', 'render-engine'],
    evidence:
      'OCR: Refusal(code, detail, remedy, stage). Terminal: the refused:* queue grouped by mechanism, one shared remedy per group. Render Engine: SCREAMING_SNAKE refusals at HTTP 200. DAF: admission-gate refusals that name the gate.',
  },
  {
    id: 'typed-absence',
    statement: 'Absence is typed and never collapses to null or zero.',
    seenIn: ['ocr', 'terminal', 'render-engine'],
    evidence:
      'OCR: six absence reasons. Terminal: unobserved as a value kind in its own right. Render Engine: ABSENT-with-reason, and absence is not zero stated on every surface that could imply it.',
  },
  {
    id: 'confidence-is-not-truth',
    statement: 'A model score is never promoted to a fact.',
    seenIn: ['ocr', 'render-engine'],
    evidence:
      'OCR carries extractionConfidence, sourceReliability, evidenceStatus and verificationStatus as four separate fields and pins the last two. The Render Engine keeps mined candidates gold and never renders them as observed.',
  },
  {
    id: 'projection-cannot-write',
    statement: 'A derived representation may not mutate the state it derives from.',
    seenIn: ['daf', 'ocr', 'render-engine'],
    evidence:
      'OCR: no canonical writer exists in the package, audited over its own source tree. Render Engine: INV-6, mechanically checked by scripts/check-seam.mjs. DAF: the projection chain and the evidence chain do not import each other.',
  },
  {
    id: 'prove-the-check',
    statement: 'A check is not trusted until a planted violation has made it fail by name.',
    seenIn: ['daf', 'render-engine'],
    evidence:
      "DAF's cycle step 6: plant the violation and watch the check fail by name before trusting it. The Render Engine's security passes did exactly this, and one check failed to bite and had to be rewritten.",
  },
  {
    id: 'generated-not-written',
    statement: 'Doctrine that restates the code is generated from it, so it cannot drift.',
    seenIn: ['daf', 'render-engine'],
    evidence:
      "DAF generates docs/generated/DOCTRINE.md from architecture/*.yaml and diffs it as a gate. The Render Engine's invariant ledger is declared once in code, served, and checked for drift.",
  },
]);

/**
 * Where the apparatuses do NOT agree.
 *
 * These are surfaced rather than resolved. Choosing one vocabulary over
 * another is an architecture decision with migration cost in four trees;
 * it belongs to whoever owns the substrate, not to the surface that
 * noticed. What this register owes is an accurate statement of the
 * disagreement and a proposal that can be accepted or rejected on its
 * merits — never a silent unification that makes the map agree with
 * itself while the trees still disagree.
 */
export const DIVERGENCES = Object.freeze([
  {
    id: 'value-provenance',
    severity: 'structural',
    statement:
      'Four apparatuses carry four partially-overlapping vocabularies for how a value came to be known.',
    detail: [
      'DAF evidence class: asserted · computed · derived · measured',
      'OCR epistemic state: OBSERVED · EXTRACTED · INFERRED · RESOLVED · VERIFIED',
      'Terminal value kind: reported · observed · estimated · derived · inferred · computed · unobserved',
      'Render Engine ladder: Observation · DerivedMetric · MinedPattern · Hypothesis · Inference',
    ],
    whyItMatters:
      'derived and computed appear in three of the four and are not defined identically; observed, measured and OBSERVED are plausibly the same idea under three names; and reported — the single most common kind in the Terminal — has no counterpart anywhere else, even though a counterparty assertion is exactly what DAF calls asserted. A value crossing two apparatuses is being relabelled by hand at each seam, and a relabelling nobody wrote down is where provenance is lost.',
    proposal:
      'Treat DAF\'s four ingest classes as the canonical axis, because they are the only set fixed at ingest and refused on reassignment. Map Terminal reported to asserted, Terminal observed to measured, and keep estimated/inferred as a SECOND, orthogonal axis (how far from the evidence) rather than a competing value on the first. The OCR states are a third axis (how far through the pipeline) and should not be flattened into either.',
    ownedBy: 'substrate — not this surface',
  },
  {
    id: 'identity-space',
    severity: 'structural',
    statement: 'The notation:// identity space is specified and unimplemented.',
    detail: [
      'DAF mints content-addressed evidence ids',
      'OCR mints content-addressed artifactIds',
      'Terminal mints entity ids of the shape ent:mine:escondida',
      'Render Engine reads Terminal ids and adds its own build fingerprints',
    ],
    whyItMatters:
      'One canonical identity space with many physical representations was the stated invariant. Today each apparatus mints in its own space and the joins between them are positional. Nothing is wrong yet because the joins are few; they stop being few at the first cross-apparatus query.',
    proposal:
      'The scheme already has a shape in docs/SECURITY.md §5 and the substrate directive. The first useful step is not a migration but a resolver: one apparatus that answers "what does this notation:// URI name, and which apparatus holds it" without anything having to renumber.',
    ownedBy: 'substrate — not this surface',
  },
  {
    id: 'graph-plane-unbuilt',
    severity: 'gap',
    statement: 'The graph plane has a repository and no implementation.',
    detail: ['notationsystems/payload-corpus-graph contains only .git'],
    whyItMatters:
      'Entity-to-entity structure is currently computed per-read inside other apparatuses (the Render Engine mines it; the Terminal expands it). That is correct for now and stops being correct as soon as an edge needs to be evidenced and versioned in its own right, because there is nowhere to put it.',
    proposal:
      'Leave it DECLARED and visible. An empty repository that everyone can see is a better artifact than a graph half-built inside a projection layer that is forbidden to hold state.',
    ownedBy: 'substrate — not this surface',
  },
]);

/** The register as one object, with its own provenance attached. */
export function ecosystemRegister() {
  return {
    organization: {
      id: 'notation-systems',
      notation: 'notation://node/org/notation-systems',
      label: 'Notation Systems',
      declares: 'Notation Systems builds and operates provenance-bearing computational corpora.',
    },
    lifecycle: LIFECYCLE,
    apparatuses: APPARATUSES,
    convergences: CONVERGENCES,
    divergences: DIVERGENCES,
    counts: {
      apparatuses: APPARATUSES.length,
      observed: APPARATUSES.filter((a) => a.presence === 'OBSERVED').length,
      present: APPARATUSES.filter((a) => a.presence === 'PRESENT').length,
      declared: APPARATUSES.filter((a) => a.presence === 'DECLARED').length,
      scaffold: APPARATUSES.filter((a) => a.presence === 'SCAFFOLD').length,
      stagesUnowned: LIFECYCLE.filter(
        (s) => !APPARATUSES.some((a) => a.stages.includes(s.id) && a.presence !== 'DECLARED')
      ).map((s) => s.id),
    },
    basis:
      'Read from each apparatus\'s own tree on 2026-09-03. Every row carries readFrom: the files the claim came from. This register is a map of apparatuses, never a mirror of their state — it holds no record belonging to any of them.',
  };
}
