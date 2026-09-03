/**
 * Workspace persistence — the OS remembers how you left it.
 *
 * A versioned localStorage wrapper for VIEW-LEVEL conveniences only:
 * preset, sensor style, flow mode. Nothing here is data, nothing here
 * is state about the world — losing it costs nothing but a click, so
 * every read and write is wrapped and a blocked store degrades to the
 * defaults silently.
 */

const KEY = 'pe.workspace/v1';

export interface WorkspaceState {
  preset?: string;
  sensorMode?: 0 | 1 | 2 | 3 | 4;
  flowMode?: boolean;
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
