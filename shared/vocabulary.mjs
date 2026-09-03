/**
 * PROVENANCE VOCABULARY ALIGNMENT — four words for one idea, measured.
 *
 * The apparatus register recorded a structural divergence: four
 * apparatuses carry four partially-overlapping vocabularies for *how a
 * value came to be known*, and a value crossing two of them is
 * relabelled by hand at each seam. A relabelling nobody wrote down is
 * where provenance is lost.
 *
 * This module writes it down. It does three things and refuses a fourth:
 *
 *   DECLARES  each apparatus's vocabulary as that apparatus states it
 *   ALIGNS    a PROPOSED mapping onto one canonical axis, with every
 *             row typed by what kind of relationship it claims
 *   MEASURES  what adopting it would actually do to the served corpus
 *
 * It does NOT apply. Nothing here relabels a record, and no surface may
 * render a proposed label as if it were the record's own. Choosing a
 * vocabulary has migration cost in four trees; that decision belongs to
 * whoever owns the substrate. What this owes is an accurate statement of
 * the disagreement and a number for what the fix costs.
 *
 * WHY THREE AXES, NOT ONE.
 *
 * The four vocabularies are not four attempts at the same list. They
 * answer three different questions, and the flattening is most of the
 * confusion:
 *
 *   ORIGIN     how did this value come to exist?     measured / asserted / computed
 *   DISTANCE   how far is it from the evidence?      direct / estimated / inferred
 *   STAGE      how far through the pipeline is it?   extracted → resolved → verified
 *
 * `measured` and `estimated` are not alternatives — a value is measured
 * OR asserted on the first axis and, separately, direct OR estimated on
 * the second. Collapsing them forces a choice that discards one of the
 * two facts, which is exactly how `estimated` ends up competing with
 * `observed` in a single enum and neither meaning survives.
 */

/** The axes. A vocabulary term belongs to exactly one. */
export const AXES = Object.freeze([
  {
    id: 'origin',
    label: 'ORIGIN',
    question: 'how did this value come to exist?',
    canonical: ['measured', 'asserted', 'computed', 'derived'],
    basis:
      "DAF's four ingest classes are taken as canonical because they are the only set FIXED AT INGEST and refused on reassignment. A vocabulary that can be changed after the fact is a label, not a class.",
  },
  {
    id: 'distance',
    label: 'DISTANCE FROM EVIDENCE',
    question: 'how far is this value from something observed?',
    canonical: ['direct', 'estimated', 'inferred', 'representative'],
    basis:
      'orthogonal to origin: a measured value can be direct or estimated, and so can an asserted one. Keeping them on one axis destroys one of the two facts.',
  },
  {
    id: 'stage',
    label: 'PIPELINE STAGE',
    question: 'how far through processing is this value?',
    canonical: ['extracted', 'observed', 'resolved', 'verified'],
    basis:
      "the OCR Agent's epistemic states. A stage is not an origin: an EXTRACTED value still has an origin, and pinning stage to origin is what makes a model's output look like a measurement.",
  },
]);

/**
 * The alignment. Each row states what KIND of relationship it claims,
 * which is the part a reviewer needs in order to disagree usefully:
 *
 *   SAME        the same idea under a different word — safe to unify
 *   NARROWS     the source term is a special case of the target
 *   ORTHOGONAL  belongs on a different axis; unifying would destroy a fact
 *   UNMAPPED    no counterpart anywhere; it is a fifth idea, not a synonym
 */
export const ALIGNMENT = Object.freeze([
  // --- origin ---------------------------------------------------------
  { term: 'measured', apparatus: 'daf', axis: 'origin', canonical: 'measured', relation: 'SAME', note: 'the canonical form' },
  { term: 'asserted', apparatus: 'daf', axis: 'origin', canonical: 'asserted', relation: 'SAME', note: 'the canonical form' },
  { term: 'computed', apparatus: 'daf', axis: 'origin', canonical: 'computed', relation: 'SAME', note: 'the canonical form' },
  { term: 'derived', apparatus: 'daf', axis: 'origin', canonical: 'derived', relation: 'SAME', note: 'the canonical form' },
  {
    term: 'observed',
    apparatus: 'terminal',
    axis: 'origin',
    canonical: 'measured',
    relation: 'SAME',
    note: 'an observed value is a measured one; the two words name one idea and the corpus uses both',
  },
  {
    term: 'reported',
    apparatus: 'terminal',
    axis: 'origin',
    canonical: 'asserted',
    relation: 'SAME',
    note: 'THE consequential row. A counterparty telling you a number is exactly what DAF calls asserted, and `reported` is the single most common kind in the corpus. Today it crosses the seam with no counterpart, which means the largest class of values in the system is the one whose origin is least well carried.',
  },
  {
    term: 'computed',
    apparatus: 'terminal',
    axis: 'origin',
    canonical: 'computed',
    relation: 'SAME',
    note: 'agrees already',
  },
  {
    term: 'derived',
    apparatus: 'terminal',
    axis: 'origin',
    canonical: 'derived',
    relation: 'SAME',
    note: 'agrees already',
  },
  {
    term: 'DerivedMetric',
    apparatus: 'render-engine',
    axis: 'origin',
    canonical: 'derived',
    relation: 'SAME',
    note: 'the ladder rung and the ingest class name one thing',
  },
  {
    term: 'MinedPattern',
    apparatus: 'render-engine',
    axis: 'origin',
    canonical: 'computed',
    relation: 'NARROWS',
    note: 'a mined pattern is computed by a named, versioned algorithm — a special case worth keeping distinct in the UI even once the origin agrees',
  },

  // --- distance -------------------------------------------------------
  {
    term: 'estimated',
    apparatus: 'terminal',
    axis: 'distance',
    canonical: 'estimated',
    relation: 'ORTHOGONAL',
    note: 'must NOT be flattened onto origin. An estimated value still has an origin — it was estimated FROM something measured, asserted or computed, and that fact is lost the moment the two share an enum.',
  },
  {
    term: 'inferred',
    apparatus: 'terminal',
    axis: 'distance',
    canonical: 'inferred',
    relation: 'ORTHOGONAL',
    note: 'same axis as estimated, further from the evidence. Merging it onto origin would destroy the same fact: an inferred value was inferred FROM something with an origin of its own, and that origin is discarded the moment the two share an enum.',
  },
  {
    term: 'INFERRED',
    apparatus: 'ocr',
    axis: 'distance',
    canonical: 'inferred',
    relation: 'SAME',
    note: 'the OCR state and the Terminal kind agree once the axis is separated',
  },
  {
    term: 'Inference',
    apparatus: 'render-engine',
    axis: 'distance',
    canonical: 'inferred',
    relation: 'SAME',
    note: 'the top rung of the epistemic ladder',
  },
  {
    term: 'Hypothesis',
    apparatus: 'render-engine',
    axis: 'distance',
    canonical: 'inferred',
    relation: 'NARROWS',
    note: 'a hypothesis is an inference offered for testing rather than for belief; the UI keeps them apart deliberately (violet, dashed)',
  },
  {
    term: 'representative',
    apparatus: 'terminal',
    axis: 'distance',
    canonical: 'representative',
    relation: 'UNMAPPED',
    note: 'NOT A SYNONYM FOR ANYTHING. A representative value is a stand-in carried for shape rather than for claim, and the corpus marks these `admissible: false`. No other apparatus has this idea, and it was missing from the register until the corpus was counted — which is the argument for measuring a vocabulary rather than reading it.',
  },

  // --- stage ----------------------------------------------------------
  { term: 'OBSERVED', apparatus: 'ocr', axis: 'stage', canonical: 'observed', relation: 'SAME', note: 'the pipeline entry state' },
  { term: 'EXTRACTED', apparatus: 'ocr', axis: 'stage', canonical: 'extracted', relation: 'SAME', note: 'perception has run' },
  { term: 'RESOLVED', apparatus: 'ocr', axis: 'stage', canonical: 'resolved', relation: 'SAME', note: 'entity resolution has run; the OCR Agent may not emit it' },
  { term: 'VERIFIED', apparatus: 'ocr', axis: 'stage', canonical: 'verified', relation: 'SAME', note: 'the OCR Agent may not emit it either' },
  {
    term: 'Observation',
    apparatus: 'render-engine',
    axis: 'stage',
    canonical: 'observed',
    relation: 'SAME',
    note: 'the ladder base',
  },
  {
    term: 'unobserved',
    apparatus: 'terminal',
    axis: 'stage',
    canonical: null,
    relation: 'UNMAPPED',
    note: 'this is an ABSENCE, not a value kind. It belongs with the typed-absence vocabulary the OCR Agent already has (six reasons), not on any of these three axes. Carrying it as a kind is what lets an absence be mistaken for a reading.',
  },
]);

/** Terms as each apparatus states them, for the declaration half. */
export const DECLARED = Object.freeze({
  daf: { of: 'evidence class, fixed at ingest', terms: ['asserted', 'computed', 'derived', 'measured'] },
  ocr: { of: 'epistemic state', terms: ['OBSERVED', 'EXTRACTED', 'INFERRED', 'RESOLVED', 'VERIFIED'] },
  terminal: {
    of: 'value kind',
    terms: ['reported', 'observed', 'estimated', 'derived', 'inferred', 'computed', 'unobserved', 'representative'],
  },
  'render-engine': {
    of: 'epistemic ladder',
    terms: ['Observation', 'DerivedMetric', 'MinedPattern', 'Hypothesis', 'Inference'],
  },
});

/** Look up one term's proposed position. Null when nothing claims it. */
export function alignTerm(term, apparatus = null) {
  if (typeof term !== 'string') return null;
  const exact = ALIGNMENT.filter((r) => r.term === term && (!apparatus || r.apparatus === apparatus));
  if (exact.length) return exact[0];

  // A case-insensitive fallback is convenience, and convenience must not
  // decide an AXIS. `observed` is an origin in the Terminal and
  // `OBSERVED` is a pipeline stage in the OCR Agent: matching loosely
  // across them would silently assign the wrong axis, which is the exact
  // relabelling this module exists to prevent. When the loose match is
  // ambiguous, refuse it and let the caller say which apparatus it meant.
  const loose = ALIGNMENT.filter(
    (r) => r.term.toLowerCase() === term.toLowerCase() && (!apparatus || r.apparatus === apparatus)
  );
  if (loose.length === 0) return null;
  const axes = new Set(loose.map((r) => r.axis));
  if (axes.size > 1) {
    return {
      term,
      apparatus: apparatus ?? 'ambiguous',
      axis: null,
      canonical: null,
      relation: 'AMBIGUOUS',
      note: `'${term}' matches ${loose.length} terms on ${axes.size} different axes (${[...axes].join(', ')}) and differs from each only by case. Naming the apparatus resolves it; guessing an axis would be the silent relabelling this alignment exists to stop.`,
    };
  }
  return loose[0];
}

/**
 * What adopting the proposal would DO to a corpus, counted.
 *
 * `tally` is {valueKind: count} measured from the records themselves —
 * never from the declaration, which is exactly how `representative` went
 * unrecorded until something counted.
 */
export function migrationImpact(tally) {
  // An unlabelled corpus is not a corpus with zero of each label. A
  // table of zeroes would read as "nothing to migrate" when the truth
  // is "nothing to migrate FROM" - and that is the more serious
  // finding, because a corpus that does not label value provenance
  // cannot be aligned at all until it does.
  const entries = Object.entries(tally ?? {});
  if (entries.length === 0) {
    return {
      status: 'ABSENT',
      reason:
        'no served record carries provenance.valueKind, so there is nothing to align. This is not a clean bill of health - it is a corpus with no value-provenance vocabulary at all, which is a larger gap than disagreeing about one.',
      unblockedBy:
        'a corpus whose records label how each value came to be known. The Terminal corpus does; this one does not, and the difference is worth seeing rather than smoothing over.',
      rows: [],
      total: 0,
      renamed: 0,
      unchanged: 0,
      needsDecision: 0,
      undecidedTerms: [],
      verdict: 'nothing to align: this corpus does not label value provenance',
    };
  }
  const rows = entries
    .map(([term, count]) => {
      const row = alignTerm(term, 'terminal') ?? alignTerm(term);
      return {
        term,
        count,
        axis: row?.axis ?? null,
        canonical: row?.canonical ?? null,
        relation: row?.relation ?? 'UNKNOWN',
        note: row?.note ?? 'this term appears in the corpus and in no vocabulary declaration — it has to be classified before anything can be aligned',
        // a rename is only work-free when the relation is SAME and the
        // word actually changes; everything else needs a decision
        // AMBIGUOUS and UNMAPPED are never free renames — both need a human
        renames: row?.relation === 'SAME' && row.canonical !== null && row.canonical !== term,
      };
    })
    .sort((a, b) => b.count - a.count);

  const total = rows.reduce((n, r) => n + r.count, 0);
  const renamed = rows.filter((r) => r.renames).reduce((n, r) => n + r.count, 0);
  const needsDecision = rows.filter(
    (r) => r.relation === 'UNMAPPED' || r.relation === 'UNKNOWN' || r.relation === 'AMBIGUOUS'
  );

  return {
    rows,
    total,
    renamed,
    unchanged: total - renamed - needsDecision.reduce((n, r) => n + r.count, 0),
    needsDecision: needsDecision.reduce((n, r) => n + r.count, 0),
    undecidedTerms: needsDecision.map((r) => r.term),
    verdict:
      needsDecision.length === 0
        ? 'every term in this corpus has a proposed target; adoption is a rename'
        : `${needsDecision.length} term(s) in this corpus have no target and are not synonyms for anything — they need a decision before adoption, not a mapping`,
  };
}

/** The whole thing, for a surface or a reviewer. */
export function vocabularyAlignment(tally = null) {
  return {
    status: 'PROPOSED',
    ownedBy: 'substrate — not this surface',
    warning:
      'nothing here is applied. No record is relabelled, and no surface may render a proposed label as if it were the record own. This is a statement of a disagreement and a number for what resolving it costs.',
    axes: AXES,
    declared: DECLARED,
    alignment: ALIGNMENT,
    counts: {
      terms: ALIGNMENT.length,
      same: ALIGNMENT.filter((r) => r.relation === 'SAME').length,
      narrows: ALIGNMENT.filter((r) => r.relation === 'NARROWS').length,
      orthogonal: ALIGNMENT.filter((r) => r.relation === 'ORTHOGONAL').length,
      unmapped: ALIGNMENT.filter((r) => r.relation === 'UNMAPPED').length,
    },
    impact: tally ? migrationImpact(tally) : null,
  };
}
