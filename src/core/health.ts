/**
 * Feed-health ledger — the OS observing its own feeds over time. A
 * ring buffer of the last 20 attempt outcomes per feed, recorded at
 * the fetcher choke points, so the health strip can say "FX refused 3
 * of the last 20 polls" instead of only the instantaneous state.
 *
 * Honesty rules: this is a SESSION ledger (it starts empty and says
 * so); a feed never attempted is ABSENT from it, not "OK"; outcomes
 * are the typed result kinds, never inferred.
 */

export type FeedOutcome = 'ok' | 'refused' | 'unreachable';

export interface FeedSample {
  t: number; // wall-clock ms at record time
  outcome: FeedOutcome;
}

export interface FeedLedger {
  feed: string;
  samples: FeedSample[]; // oldest → newest, capped
}

const WINDOW = 20;
const feeds = new Map<string, FeedSample[]>();
const listeners = new Set<() => void>();

export function recordFeed(feed: string, outcome: FeedOutcome): void {
  const arr = feeds.get(feed) ?? [];
  arr.push({ t: Date.now(), outcome });
  if (arr.length > WINDOW) arr.shift();
  feeds.set(feed, arr);
  for (const l of listeners) l();
}

/** Every feed attempted this session, alphabetical, samples copied. */
export function feedHealth(): FeedLedger[] {
  return [...feeds.entries()]
    .map(([feed, samples]) => ({ feed, samples: samples.slice() }))
    .sort((a, b) => a.feed.localeCompare(b.feed));
}

export function onFeedHealth(listener: () => void): void {
  listeners.add(listener);
}
