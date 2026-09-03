/**
 * The apparatus register, as the OS reads it.
 *
 * This bridge lives in src/intel rather than src/data on purpose. The
 * data layer is the corpus's semantic contract and imports nothing from
 * outside itself (INV-6, checked by scripts/check-seam.mjs) — and the
 * register is not corpus semantics. It is a map of the apparatuses that
 * produce the corpus, which is a different kind of object and belongs on
 * a different side of the seam. The miner's bridge sits here for the
 * same reason.
 *
 * The register is one file (shared/ecosystem.mjs) with two consumers,
 * the same discipline the miner already follows: the projection service
 * serves it at GET /api/ecosystem/register, and this bundle carries the
 * identical module. The OS prefers the SERVED register — a running
 * service is the more current reading — and falls back to the bundled
 * one, **saying which it used**. A surface that silently fell back would
 * be showing a map from build time while implying it came from the
 * service.
 */

import { ecosystemRegister } from '../../shared/ecosystem.mjs';
import type { EcosystemRegister } from '../../shared/ecosystem.mjs';
import { fetchBounded, resolveApiBase } from '../data/sources';

export type { Apparatus, Convergence, Divergence, EcosystemRegister, LifecycleStage, Presence } from '../../shared/ecosystem.mjs';

export interface RegisterRead {
  register: EcosystemRegister;
  /** where this reading came from — never left implicit */
  source: 'service' | 'bundle';
  note: string;
}

export async function readRegister(): Promise<RegisterRead> {
  const bundled: RegisterRead = {
    register: ecosystemRegister(),
    source: 'bundle',
    note: 'read from this bundle, not from the service — the register you are seeing is as of this build',
  };
  try {
    const res = await fetchBounded(`${resolveApiBase()}/api/ecosystem/register`, {
      headers: { Accept: 'application/json' },
    });
    const body = (await res.json()) as { status?: string; data?: EcosystemRegister };
    if (body.status === 'ok' && body.data) {
      return {
        register: body.data,
        source: 'service',
        note: 'read from the running projection service',
      };
    }
    return bundled;
  } catch {
    return bundled;
  }
}

/** Apparatuses sitting on one lifecycle stage, in register order. */
export function apparatusesAt(register: EcosystemRegister, stageId: string) {
  return register.apparatuses.filter((a) => a.stages.includes(stageId));
}
