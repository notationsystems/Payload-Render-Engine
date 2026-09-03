/**
 * Types for the provenance vocabulary alignment (./vocabulary.mjs).
 * PROPOSED throughout — nothing typed here is a record's own label.
 */

export type Relation = 'SAME' | 'NARROWS' | 'ORTHOGONAL' | 'UNMAPPED' | 'UNKNOWN';

export interface Axis {
  id: string;
  label: string;
  question: string;
  canonical: string[];
  basis: string;
}

export interface AlignmentRow {
  term: string;
  apparatus: string;
  axis: string;
  /** the proposed canonical term; null when the row claims no target */
  canonical: string | null;
  relation: Relation;
  note: string;
}

export interface ImpactRow {
  term: string;
  count: number;
  axis: string | null;
  canonical: string | null;
  relation: Relation;
  note: string;
  /** true only when adoption is a pure rename for this term */
  renames: boolean;
}

export interface MigrationImpact {
  /** present only when the corpus labels no value provenance at all */
  status?: 'ABSENT';
  reason?: string;
  unblockedBy?: string;
  rows: ImpactRow[];
  total: number;
  renamed: number;
  unchanged: number;
  needsDecision: number;
  undecidedTerms: string[];
  verdict: string;
}

export interface VocabularyAlignment {
  status: 'PROPOSED';
  ownedBy: string;
  warning: string;
  axes: Axis[];
  declared: Record<string, { of: string; terms: string[] }>;
  alignment: AlignmentRow[];
  counts: { terms: number; same: number; narrows: number; orthogonal: number; unmapped: number };
  /** null when read from the bundle: the count needs the served corpus */
  impact: MigrationImpact | null;
  /** attached by the service, which is the only reader that can count */
  measuredOver?: { corpusBuildId: string; records: number; of: string };
}

export declare const AXES: readonly Axis[];
export declare const ALIGNMENT: readonly AlignmentRow[];
export declare const DECLARED: Readonly<Record<string, { of: string; terms: string[] }>>;
export declare function alignTerm(term: string, apparatus?: string | null): AlignmentRow | null;
export declare function migrationImpact(tally: Record<string, number>): MigrationImpact;
export declare function vocabularyAlignment(tally?: Record<string, number> | null): VocabularyAlignment;
