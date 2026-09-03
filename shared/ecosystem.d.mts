/**
 * Types for the Notation Systems apparatus register (./ecosystem.mjs).
 * The renderer reads them through src/data/ecosystem.ts; the projection
 * service consumes the .mjs untyped.
 */

export type Presence = 'OBSERVED' | 'PRESENT' | 'DECLARED' | 'SCAFFOLD';

export interface LifecycleStage {
  id: string;
  label: string;
  /** the question this stage exists to answer */
  question: string;
}

export interface ApparatusVocabulary {
  name: string;
  terms: string[];
  note: string;
}

export interface Apparatus {
  id: string;
  /** the identity this apparatus would carry in the notation:// space */
  notation: string;
  repo: string;
  label: string;
  /** compact form for the lifecycle spine, where seven stages share one row */
  short: string;
  /** lifecycle stages this apparatus owns */
  stages: string[];
  presence: Presence;
  /** how the presence was established — never inferred from the name */
  presenceBasis: string;
  /** what the apparatus says it is, in its own words. null when it says nothing */
  declares: string | null;
  holds: string[];
  /** the boundaries — the most informative half of any apparatus row */
  refuses: string[];
  vocabulary: ApparatusVocabulary | null;
  /** present only for DECLARED / SCAFFOLD rows */
  absence?: { reason: string; unblockedBy: string };
  /** provenance of the row itself: the files the claims were read from */
  readFrom: string[];
}

export interface Convergence {
  id: string;
  statement: string;
  seenIn: string[];
  evidence: string;
}

export interface Divergence {
  id: string;
  severity: 'structural' | 'gap';
  statement: string;
  detail: string[];
  whyItMatters: string;
  proposal: string;
  /** who the decision belongs to — never the surface that noticed */
  ownedBy: string;
}

export interface EcosystemRegister {
  organization: { id: string; notation: string; label: string; declares: string };
  lifecycle: LifecycleStage[];
  apparatuses: Apparatus[];
  convergences: Convergence[];
  divergences: Divergence[];
  counts: {
    apparatuses: number;
    observed: number;
    present: number;
    declared: number;
    scaffold: number;
    /** lifecycle stages no built apparatus owns — the visible holes */
    stagesUnowned: string[];
  };
  basis: string;
}

export declare const LIFECYCLE: readonly LifecycleStage[];
export declare const APPARATUSES: readonly Apparatus[];
export declare const CONVERGENCES: readonly Convergence[];
export declare const DIVERGENCES: readonly Divergence[];
export declare function ecosystemRegister(): EcosystemRegister;
