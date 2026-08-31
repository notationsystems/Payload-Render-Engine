/**
 * Provider-independent spatial data interface.
 *
 * The digital-twin client only ever talks to this interface. The
 * synthetic demo provider implements it today; a Payload Spatial API
 * client implements it tomorrow (server-side spatial filtering,
 * vector tiles, viewport queries) without the renderer changing.
 */

import type {
  EntityId,
  EntityState,
  Timestamp,
  WorldSnapshot,
} from './contracts';

export interface ViewportQuery {
  /** [west, south, east, north] in degrees. */
  bbox?: [number, number, number, number];
  /** Camera altitude in earth-radii above surface — providers use it for LOD. */
  altitude?: number;
  /** Minimum importance to include (progressive disclosure). */
  minImportance?: number;
}

export interface SpatialDataProvider {
  readonly id: string;
  readonly label: string;

  /** Load the world snapshot (initial hydration). */
  load(): Promise<WorldSnapshot>;

  /**
   * Resolve dynamic state for an entity at a sim time.
   * Deterministic for a given (entityId, t) so scrubbing is stable.
   */
  stateAt(entityId: EntityId, t: Timestamp): EntityState;

  /**
   * Future: viewport-scoped incremental fetch (vector tiles / PostGIS
   * window queries). The synthetic provider answers from memory.
   */
  query?(viewport: ViewportQuery): Promise<Partial<WorldSnapshot>>;

  /** Future: push-based updates from Payload canonical state. */
  subscribe?(onDelta: (delta: Partial<WorldSnapshot>) => void): () => void;
}
