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
import { fetchBounded } from '../data/sources';
import type { LonLat, Timestamp } from '../data/contracts';
import { recordFeed } from '../core/health';

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
    const res = await fetchBounded(`${apiBase}${path}`, { headers: { Accept: 'application/json' } });
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
  recordFeed('live.satellites', r.kind === 'ok' ? 'ok' : r.kind);
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
  recordFeed('live.seismic', r.kind === 'ok' ? 'ok' : r.kind);
  if (r.kind !== 'ok') return r;
  const { data, meta } = r.data as {
    data: { quakes: { id: string; mag: number | null; place: string | null; time: string; coordinates: [number, number, number] }[]; fetchedAt: string };
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
          // USGS occasionally reports a null place — stated, not crashed on
          place: q.place ?? 'location unstated by USGS',
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

export interface LiveAircraft {
  hex: string;
  flight: string | null;
  lonLat: LonLat;
  altFt: number | null;
  gsKt: number | null;
  /** true course over ground, degrees — drives the world-stable dart */
  track: number | null;
  /** seconds since the position was OBSERVED (ADS-B) */
  seenPosSec: number | null;
  fetchedAtMs: number;
}

export interface LiveAircraftSet {
  aircraft: LiveAircraft[];
  fetchedAt: Timestamp;
  center: { lat: number; lon: number };
  radiusNm: number;
  upstream: string;
}

export async function fetchLiveAircraft(
  apiBase: string,
  lonLat: LonLat
): Promise<LiveResult<LiveAircraftSet>> {
  const r = await getEnvelope(apiBase, `/api/live/aircraft?lat=${lonLat[1].toFixed(2)}&lon=${lonLat[0].toFixed(2)}`);
  recordFeed('live.aircraft', r.kind === 'ok' ? 'ok' : r.kind);
  if (r.kind !== 'ok') return r;
  const { data, meta } = r.data as {
    data: { aircraft: { hex: string; flight: string | null; lat: number; lon: number; altFt: number | null; gsKt: number | null; track: number | null; seenPosSec: number | null }[]; fetchedAt: string; cacheAgeMs?: number; center: { lat: number; lon: number }; radiusNm: number };
    meta?: { upstream?: string };
  };
  // anchor the fix clock to CLIENT receipt time minus the server-stated
  // cache age — dead-reckoning ages must never depend on how far the
  // user's wall clock disagrees with the server's
  const fetchedAtMs = Date.now() - (data.cacheAgeMs ?? 0);
  return {
    kind: 'ok',
    data: {
      aircraft: data.aircraft.map((a) => ({
        hex: a.hex,
        flight: a.flight,
        lonLat: [a.lon, a.lat] as LonLat,
        altFt: a.altFt,
        gsKt: a.gsKt,
        track: a.track,
        seenPosSec: a.seenPosSec,
        fetchedAtMs,
      })),
      fetchedAt: data.fetchedAt,
      center: data.center,
      radiusNm: data.radiusNm,
      upstream: meta?.upstream ?? 'api.adsb.lol',
    },
  };
}

/**
 * Dead-reckoned position at wall-clock now: advance along the observed
 * track at observed ground speed for the seconds since observation.
 * The BASIS stays honest — the readout states observed fix + reckoning
 * age; reckoning stops being drawn past a staleness limit.
 */
export function deadReckon(a: LiveAircraft, nowMs: number): LonLat | null {
  const ageSec = (nowMs - a.fetchedAtMs) / 1000 + (a.seenPosSec ?? 0);
  if (ageSec > 180) return null; // too stale to reckon honestly
  if (a.track === null || a.gsKt === null || ageSec <= 0) return a.lonLat;
  const distKm = (a.gsKt * 1.852 * ageSec) / 3600;
  const R = 6371;
  const brg = (a.track * Math.PI) / 180;
  const lat1 = (a.lonLat[1] * Math.PI) / 180;
  const lon1 = (a.lonLat[0] * Math.PI) / 180;
  const d = distKm / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
  const lon2 = lon1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [((lon2 * 180) / Math.PI + 540) % 360 - 180, (lat2 * 180) / Math.PI];
}
