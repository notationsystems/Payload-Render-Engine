/**
 * Payload Miner v0 — typed facade over the single canonical
 * implementation in shared/miner.mjs, which the projection service
 * also serves at GET /api/mining/patterns. One algorithm, two
 * consumers: the renderer's in-browser fallback must produce exactly
 * the run the service would serve, so the code cannot fork here.
 *
 * The epistemic ladder is schema-enforced at the shared types:
 *
 *   Observation ≠ DerivedMetric ≠ MinedPattern ≠ Hypothesis
 *
 * Everything the miner emits is a MINED PATTERN CANDIDATE — a
 * structure computed by a named, versioned algorithm over declared
 * corpus fields, never an observed fact, never silently promoted.
 * Provenance chain: Pattern → MiningRun → CorpusBuild → records.
 */

export { runMiner } from '../../shared/miner.mjs';
export type { MinedPattern, MiningRun, PatternType } from '../../shared/miner.mjs';
