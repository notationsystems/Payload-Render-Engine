/**
 * Types for the shared Payload Miner implementation (./miner.mjs).
 * The renderer imports these through src/intel/miner.ts; the server
 * consumes the .mjs untyped. EntityId/WorldSnapshot stay canonical in
 * src/data/contracts — this file only narrows what the miner reads.
 */

import type { EntityId, WorldSnapshot } from '../src/data/contracts';

export type PatternType = 'SUPPLY_CONCENTRATION' | 'STRUCTURAL_ARTICULATION' | 'SHARED_CORRIDOR';

export interface MinedPattern {
  id: string;
  patternType: PatternType;
  /** one-line human statement of the structure — always hedged as computed */
  statement: string;
  /** entities that constitute the pattern (lit on the globe) */
  entities: EntityId[];
  /** routes to light alongside (subgraph edges) */
  routes: EntityId[];
  /** record ids supporting the computation (flows/routes) */
  supportingRecords: EntityId[];
  algorithm: string;
  algorithmVersion: string;
  /** 0..1 — the algorithm's own strength measure, named per type */
  score: number;
  scoreBasis: string;
  miningRunId: string;
  corpusBuildId: string;
  validationStatus: 'candidate';
}

export interface MiningRun {
  miningRunId: string;
  corpusBuildId: string;
  algorithms: { name: string; version: string; parameters: Record<string, number> }[];
  inputCounts: { nodes: number; routes: number; flows: number };
  generatedAt: string;
  patternCount: number;
}

/** The subset of WorldSnapshot the miner reads (declared fields only). */
export type MinableSnapshot = WorldSnapshot;

/** The registered mining programs — the single registry both the run
 *  manifest and the corpus definition serve. */
export const MINING_PROGRAMS: { name: string; version: string; parameters: Record<string, number> }[];

export function runMiner(snapshot: MinableSnapshot): { run: MiningRun; patterns: MinedPattern[] };
