/**
 * Session journal — the event timeline of this OS session.
 *
 * What changed, who or what requested it (operator at the command
 * bar, an agent through the tool surface, or the system on its own
 * cadence), and — always — whether anything was DISPATCHED. In this
 * OS the answer is always "nothing": the renderer projects, the
 * mirrors read, the engines compute and return. The journal states
 * that per entry so the timeline can never imply an action happened
 * when only a computation or an authorization did.
 *
 * Session-scoped by design (starts empty and says so); a durable
 * journal is corpus-platform work.
 */

export type JournalSource = 'operator' | 'agent' | 'system';

export interface JournalEntry {
  at: string;
  source: JournalSource;
  kind: string;
  summary: string;
  /** what this entry did to the world — always stated */
  dispatched: 'nothing — read-only projection' | 'nothing — computed and returned' | 'nothing — condition evaluated';
}

const entries: JournalEntry[] = [];
const listeners = new Set<() => void>();
const CAP = 200;

export function recordEvent(
  source: JournalSource,
  kind: string,
  summary: string,
  dispatched: JournalEntry['dispatched'] = 'nothing — read-only projection'
): void {
  entries.unshift({ at: new Date().toISOString(), source, kind, summary, dispatched });
  if (entries.length > CAP) entries.length = CAP;
  for (const l of listeners) l();
}

/** Newest first, copied. */
export function journal(): JournalEntry[] {
  return entries.slice();
}

export function onJournal(listener: () => void): void {
  listeners.add(listener);
}
