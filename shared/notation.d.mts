/**
 * Types for the notation:// resolver (./notation.mjs). The OS reads them
 * through src/intel/notation.ts; the projection service consumes the
 * .mjs untyped.
 */

export interface NotationRefusal {
  kind: string;
  message: string;
  remedy: string;
}

export interface NotationKind {
  id: string;
  label: string;
  /** the apparatus that holds this kind; null when no apparatus does */
  holder: string | null;
  /** whether THIS projection can answer it from what it serves */
  resolvableHere: boolean;
  shape: string | null;
  note: string | null;
  unavailable: string | null;
  unblockedBy: string | null;
}

export type ParseResult =
  | { ok: true; kind: string; segments: string[]; uri: string }
  | { ok: false; refusal: NotationRefusal };

export type LocateResult =
  | {
      ok: true;
      uri: string;
      kind: string;
      segments: string[];
      names: string;
      holder: string | null;
      resolvableHere: boolean;
      note: string | null;
      unavailable: string | null;
      unblockedBy: string | null;
    }
  | { ok: false; refusal: NotationRefusal };

export interface NotationSpace {
  scheme: string;
  invariant: string;
  kinds: NotationKind[];
  forbidden: { id: string; why: string }[];
  counts: { kinds: number; resolvableHere: number; heldElsewhere: number; unheld: number };
  posture: string;
  /** measured against the served corpus, when the service answers */
  observed?: {
    of: string;
    corpusBuildId: string;
    shapes: { shape: string; count: number }[];
    distinctShapes: number;
    note: string;
  };
}

export declare const KINDS: Readonly<Record<string, Omit<NotationKind, 'id'>>>;
export declare const FORBIDDEN_KINDS: Readonly<Record<string, string>>;
export declare function parseNotationUri(raw: unknown): ParseResult;
export declare function locate(uri: unknown): LocateResult;
export declare function notationSpace(): NotationSpace;
