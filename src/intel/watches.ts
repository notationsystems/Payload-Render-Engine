/**
 * Watchlists & tripwires v0 — the standing instrument.
 *
 * A watch is a STATED condition evaluated in-browser against what the
 * OS already holds: the loaded corpus, the served build's mined
 * candidates, the active hypothetical, and the feed-health ledger.
 * Every trip carries its basis. This is deliberately the client-side
 * v0 — server-side standing queries over new builds are corpus-
 * platform work, and this module's conditions are only ones the
 * client can honestly check.
 *
 * Conditions:
 *   entity — a corpus event AFFECTS it at sim time; it enters an
 *            active what-if blast radius; or it appears as an
 *            articulation candidate in the served build
 *   build  — the served corpus build differs from the stored
 *            baseline; new/removed articulation candidates named
 *   feed   — a live feed goes down or recovers (health ledger)
 *
 * Persistence: localStorage, versioned, wrapped — losing watches
 * costs a click, never data.
 */

import type { EntityId, Timestamp, WorldSnapshot } from '../data/contracts';
import type { MinedPattern } from './miner';
import type { InjectionResult } from '../data/injection';

const KEY = 'pe.watches/v1';

export interface EntityWatch {
  kind: 'entity';
  id: string;
  entityId: EntityId;
  label: string;
  createdAt: Timestamp;
}
export interface BuildWatch {
  kind: 'build';
  id: string;
  label: string;
  createdAt: Timestamp;
  baseline: { buildId: string; articulationIds: EntityId[] };
}
export interface FeedWatch {
  kind: 'feed';
  id: string;
  feed: string;
  label: string;
  createdAt: Timestamp;
  lastState?: 'ok' | 'down';
}
export type Watch = EntityWatch | BuildWatch | FeedWatch;

export interface Trip {
  watchId: string;
  watchLabel: string;
  at: Timestamp;
  reason: string;
  basis: string;
}

export interface WatchState {
  watches: Watch[];
  trips: Trip[]; // most recent first, capped
}

export function loadWatches(): WatchState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { watches: [], trips: [] };
    const parsed = JSON.parse(raw) as WatchState;
    return {
      watches: Array.isArray(parsed.watches) ? parsed.watches : [],
      trips: Array.isArray(parsed.trips) ? parsed.trips : [],
    };
  } catch {
    return { watches: [], trips: [] };
  }
}

export function saveWatches(state: WatchState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...state, trips: state.trips.slice(0, 30) }));
  } catch {
    // a blocked store loses conveniences, never data
  }
}

let counter = 0;
export const watchId = (): string => `watch-${Date.now().toString(36)}-${counter++}`;

// ------------------------------------------------------------------
// Evaluations — pure, each trip carries its basis
// ------------------------------------------------------------------

export function evalEntityWatch(
  w: EntityWatch,
  snapshot: WorldSnapshot,
  simTime: Timestamp,
  patterns: MinedPattern[] | null,
  injection: InjectionResult | null
): Trip[] {
  const trips: Trip[] = [];
  const now = new Date().toISOString();
  for (const ev of snapshot.events) {
    if (!ev.affects.includes(w.entityId)) continue;
    if (ev.start <= simTime && (!ev.end || ev.end >= simTime)) {
      trips.push({
        watchId: w.id,
        watchLabel: w.label,
        at: now,
        reason: `corpus event "${ev.name}" affects it at sim time (severity ${Math.round(ev.severity * 100)}%)`,
        basis: 'DECLARED corpus event, active at the sim instant',
      });
    }
  }
  if (patterns) {
    const artic = patterns.find(
      (p) => p.patternType === 'STRUCTURAL_ARTICULATION' && p.entities.includes(w.entityId)
    );
    if (artic) {
      trips.push({
        watchId: w.id,
        watchLabel: w.label,
        at: now,
        reason: 'it is an articulation candidate in the served build — removal disconnects part of the declared network',
        basis: `MINED candidate (${artic.algorithm}@${artic.algorithmVersion}), not an observed fact`,
      });
    }
  }
  if (injection) {
    const impact = injection.scenarioImpacts[0];
    const inFrame =
      impact &&
      (impact.entityId === w.entityId || impact.affected.some((a) => a.entityId === w.entityId));
    if (inFrame) {
      trips.push({
        watchId: w.id,
        watchLabel: w.label,
        at: now,
        reason: `it is inside the active what-if blast radius (${impact.eventTitle})`,
        basis: 'HYPOTHETICAL — computed upstream; a simulated outcome is not an outcome',
      });
    }
  }
  return trips;
}

/** Compares the served build to the baseline; returns trips AND the
 *  refreshed baseline (the caller persists it — one report per build). */
export function evalBuildWatch(
  w: BuildWatch,
  buildId: string | undefined,
  patterns: MinedPattern[] | null
): { trips: Trip[]; baseline: BuildWatch['baseline'] } {
  const now = new Date().toISOString();
  const articulationIds = (patterns ?? [])
    .filter((p) => p.patternType === 'STRUCTURAL_ARTICULATION')
    .flatMap((p) => p.entities);
  const next = { buildId: buildId ?? 'unstamped', articulationIds };
  if (!w.baseline.buildId || w.baseline.buildId === next.buildId) {
    return { trips: [], baseline: w.baseline.buildId ? w.baseline : next };
  }
  const prev = new Set(w.baseline.articulationIds);
  const cur = new Set(articulationIds);
  const added = articulationIds.filter((id) => !prev.has(id));
  const removed = w.baseline.articulationIds.filter((id) => !cur.has(id));
  const trips: Trip[] = [
    {
      watchId: w.id,
      watchLabel: w.label,
      at: now,
      reason: `new corpus build ${next.buildId} (was ${w.baseline.buildId})${added.length ? ` · ${added.length} new articulation candidate(s): ${added.slice(0, 3).join(', ')}${added.length > 3 ? '…' : ''}` : ''}${removed.length ? ` · ${removed.length} no longer candidates` : ''}`,
      basis: 'build identity + MINED candidates compared against the stored baseline',
    },
  ];
  return { trips, baseline: next };
}

export function evalFeedWatch(
  w: FeedWatch,
  lastOutcomeOk: boolean | null
): { trips: Trip[]; lastState: FeedWatch['lastState'] } {
  const now = new Date().toISOString();
  if (lastOutcomeOk === null) return { trips: [], lastState: w.lastState };
  const state: 'ok' | 'down' = lastOutcomeOk ? 'ok' : 'down';
  if (w.lastState === state || (w.lastState === undefined && state === 'ok')) {
    return { trips: [], lastState: state };
  }
  return {
    trips: [
      {
        watchId: w.id,
        watchLabel: w.label,
        at: now,
        reason: state === 'down' ? `feed '${w.feed}' is failing` : `feed '${w.feed}' recovered`,
        basis: 'feed-health ledger (last recorded outcome)',
      },
    ],
    lastState: state,
  };
}
