/**
 * Live-feed client — the gods-eye-view substrate under PayLoad OS
 * (adapted from bilawalsidhu/gods-eye-view, MIT; see
 * docs/ATTRIBUTIONS.md). Fetches keyless public feeds THROUGH the
 * spatial API's budget-governed proxy, never directly.
 *
 * Position honesty: a satellite dot is a COMPUTED position — SGP4
 * propagation from a TLE whose epoch is stated and ages. The basis
 * and the TLE age travel with every propagated point; a quake is a
 * REPORTED epicenter with its report time. Neither is corpus state.
 */

import * as satellite from 'satellite.js';
import type { LonLat, Timestamp } from '../data/contracts';

export interface LiveSat {
  name: string;
  group: string; // celestrak group: stations | gps-ops | glo-ops | galileo
  satrec: satellite.SatRec;
  /** TLE epoch — the moment the elements describe; positions age from here. */
  epoch: Timestamp;
}

export interface LiveSatSet {
  sats: LiveSat[];
  fetchedAt: Timestamp;
  cacheState: string;
  upstream: string;
}

export interface LiveQuake {
  id: string;
  mag: number;
  place: string;
  time: Timestamp;
  lonLat: LonLat;
  depthKm: number;
}

export interface LiveQuakeSet {
  quakes: LiveQuake[];
  fetchedAt: Timestamp;
  upstream: string;
}

export type LiveResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'refused'; refusal: { kind: string; message: string; remedy: string } }
  | { kind: 'unreachable'; note: string };

async function getEnvelope(apiBase: string, path: string): Promise<LiveResult<unknown>> {
  let body: { status?: string; data?: unknown; refusal?: { kind: string; message: string; remedy: string }; meta?: { upstream?: string } };
  try {
    const res = await fetch(`${apiBase}${path}`, { headers: { Accept: 'application/json' } });
    body = await res.json();
  } catch (err) {
    return { kind: 'unreachable', note: `spatial API unreachable at ${apiBase} — live feeds need the server (${err instanceof Error ? err.message : err})` };
  }
  if (body.status === 'refused' && body.refusal) return { kind: 'refused', refusal: body.refusal };
  if (body.status === 'ok') return { kind: 'ok', data: { data: body.data, meta: body.meta } };
  return { kind: 'unreachable', note: 'unrecognized envelope from the spatial API' };
}

export async function fetchLiveSatellites(apiBase: string): Promise<LiveResult<LiveSatSet>> {
  const r = await getEnvelope(apiBase, '/api/live/satellites');
  if (r.kind !== 'ok') return r;
  const { data, meta } = r.data as {
    data: { groups: { group: string; tles: { name: string; l1: string; l2: string }[] }[]; fetchedAt: string; cacheState: string };
    meta?: { upstream?: string };
  };
  const sats: LiveSat[] = [];
  for (const g of data.groups) {
    for (const t of g.tles) {
      const satrec = satellite.twoline2satrec(t.l1, t.l2);
      if (!satrec) continue;
      // TLE epoch: year + fractional day, from the elements themselves
      const year = satrec.epochyr < 57 ? 2000 + satrec.epochyr : 1900 + satrec.epochyr;
      const epoch = new Date(Date.UTC(year, 0, 1) + (satrec.epochdays - 1) * 86400_000).toISOString();
      sats.push({ name: t.name, group: g.group, satrec, epoch });
    }
  }
  return {
    kind: 'ok',
    data: {
      sats,
      fetchedAt: data.fetchedAt,
      cacheState: data.cacheState,
      upstream: meta?.upstream ?? 'celestrak.org',
    },
  };
}

export async function fetchLiveQuakes(apiBase: string): Promise<LiveResult<LiveQuakeSet>> {
  const r = await getEnvelope(apiBase, '/api/live/quakes');
  if (r.kind !== 'ok') return r;
  const { data, meta } = r.data as {
    data: { quakes: { id: string; mag: number | null; place: string; time: string; coordinates: [number, number, number] }[]; fetchedAt: string };
    meta?: { upstream?: string };
  };
  return {
    kind: 'ok',
    data: {
      quakes: data.quakes
        .filter((q) => q.mag !== null && Number.isFinite(q.coordinates?.[0]))
        .map((q) => ({
          id: q.id,
          mag: q.mag as number,
          place: q.place,
          time: q.time,
          lonLat: [q.coordinates[0], q.coordinates[1]] as LonLat,
          depthKm: q.coordinates[2] ?? 0,
        })),
      fetchedAt: data.fetchedAt,
      upstream: meta?.upstream ?? 'earthquake.usgs.gov',
    },
  };
}

export interface PropagatedSat {
  name: string;
  group: string;
  lonLat: LonLat;
  altitudeKm: number;
  /** the honesty label: computed, and how stale the elements are */
  basis: 'sgp4_propagation';
  tleAgeHours: number;
}

/** Propagate one satellite to an instant. null = propagation failed
 *  (decayed or bad elements) — a failed propagation renders NOTHING. */
export function propagateSat(sat: LiveSat, at: Date): PropagatedSat | null {
  const pv = satellite.propagate(sat.satrec, at);
  if (!pv || typeof pv.position === 'boolean' || !pv.position) return null;
  const gmst = satellite.gstime(at);
  const geo = satellite.eciToGeodetic(pv.position, gmst);
  return {
    name: sat.name,
    group: sat.group,
    lonLat: [satellite.degreesLong(geo.longitude), satellite.degreesLat(geo.latitude)],
    altitudeKm: geo.height,
    basis: 'sgp4_propagation',
    tleAgeHours: (at.getTime() - Date.parse(sat.epoch)) / 3600_000,
  };
}
