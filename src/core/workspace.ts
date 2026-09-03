/**
 * Workspace persistence — the OS remembers how you left it.
 *
 * A versioned localStorage wrapper for VIEW-LEVEL conveniences only:
 * preset, sensor style, flow mode. Nothing here is data, nothing here
 * is state about the world — losing it costs nothing but a click, so
 * every read and write is wrapped and a blocked store degrades to the
 * defaults silently.
 *
 * ONE DELIBERATE WIDENING, stated rather than slipped in. `lastBuild`
 * remembers the corpus build this operator last SAW. That is session
 * memory — a bookmark — not state about the world: it names a build, it
 * reconstructs no record, and losing it costs one notice. It earns its
 * place because "has the corpus moved since I last looked?" is the first
 * question a desk asks each morning, and without a bookmark the OS
 * cannot answer it at all.
 *
 * The line it must not cross is holding build CONTENTS. Two builds kept
 * here so the OS could diff them would make this a store, which is the
 * one thing a projection layer may never become — so what changed is
 * answered as ABSENT with a reason, in the compiler console.
 */

const KEY = 'pe.workspace/v1';

export interface WorkspaceState {
  preset?: string;
  sensorMode?: 0 | 1 | 2 | 3 | 4;
  flowMode?: boolean;
  /** the corpus build this operator last saw — a bookmark, never contents */
  lastBuild?: { id: string; merkleRoot?: string; seenAt: string };
}

/**
 * How the current build compares with the one this operator last saw.
 *
 * The two-field comparison is the whole value and it is free, because
 * the service already stamps both on every answer. A build id contains
 * `generatedAt`, so it changes on every recompile; the Merkle root
 * changes only when a committed record does. Same root with a new id
 * means the corpus was rebuilt and nothing in it moved — which is the
 * answer an operator needs most mornings, and the one a build id alone
 * cannot give.
 */
export type BuildDelta =
  | { kind: 'FIRST_SESSION' }
  | { kind: 'UNCHANGED'; seenAt: string }
  | { kind: 'REBUILT_UNCHANGED'; from: string; seenAt: string }
  | { kind: 'RECORDS_MOVED'; from: string; seenAt: string };

export function compareBuild(current: { id: string; merkleRoot?: string } | null | undefined): BuildDelta {
  if (!current?.id) return { kind: 'FIRST_SESSION' };
  const last = loadWorkspace().lastBuild;
  if (!last?.id) return { kind: 'FIRST_SESSION' };
  if (last.id === current.id) return { kind: 'UNCHANGED', seenAt: last.seenAt };
  // a root that did not move means no committed record differs, however
  // many times the corpus was recompiled in between
  if (last.merkleRoot && current.merkleRoot && last.merkleRoot === current.merkleRoot) {
    return { kind: 'REBUILT_UNCHANGED', from: last.id, seenAt: last.seenAt };
  }
  return { kind: 'RECORDS_MOVED', from: last.id, seenAt: last.seenAt };
}

/** Record the build this operator has now seen. */
export function markBuildSeen(build: { id: string; merkleRoot?: string } | null | undefined): void {
  if (!build?.id) return;
  saveWorkspace({
    lastBuild: { id: build.id, merkleRoot: build.merkleRoot, seenAt: new Date().toISOString() },
  });
}

export function loadWorkspace(): WorkspaceState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as WorkspaceState;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function saveWorkspace(patch: Partial<WorkspaceState>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadWorkspace(), ...patch }));
  } catch {
    // a blocked store loses a convenience, never data
  }
}
