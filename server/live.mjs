/**
 * Live-feed proxy — the gods-eye-view substrate, run through this
 * service's own discipline (adapted from bilawalsidhu/gods-eye-view,
 * MIT — see docs/ATTRIBUTIONS.md).
 *
 * Keyless public upstreams only, behind the budget-governed proxy
 * posture recorded in src/data/sources.ts: allowlisted hosts fixed in
 * code, disk-cached responses with stated TTLs, response caps, and
 * typed refusals when an upstream is down — a stale cache is served
 * WITH ITS AGE STATED rather than silently, and never invented.
 *
 * Provenance stance: a TLE set and a quake list are REPORTED records
 * from disinterested sources (admissible per record); every response
 * states fetchedAt, so the client can label the age of what it renders.
 * Satellite POSITIONS are not served here at all — the client computes
 * them by SGP4 and must label them as computed (basis + TLE age).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../.live-cache');

/** The whole reachable upstream surface — fixed in code, never a parameter. */
const FEEDS = {
  satellites: {
    // six celestrak groups, the gods-eye-view catalog (minus dense mode)
    urls: [
      'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle',
      'https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tle',
      'https://celestrak.org/NORAD/elements/gp.php?GROUP=glo-ops&FORMAT=tle',
      'https://celestrak.org/NORAD/elements/gp.php?GROUP=galileo&FORMAT=tle',
    ],
    ttlMs: 6 * 3600_000, // TLEs age slowly; celestrak asks for restraint
    capBytes: 900_000,
    sourceClass: 'external:celestrak',
    kind: 'tle',
  },
  quakes: {
    urls: ['https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson'],
    ttlMs: 5 * 60_000,
    capBytes: 2_000_000,
    sourceClass: 'external:usgs',
    kind: 'geojson',
  },
};

async function cachedFetch(name, feed) {
  await mkdir(CACHE_DIR, { recursive: true });
  const cachePath = resolve(CACHE_DIR, `${name}.json`);
  let cache = null;
  try {
    cache = JSON.parse(await readFile(cachePath, 'utf8'));
  } catch {
    /* no cache yet */
  }
  const age = cache ? Date.now() - Date.parse(cache.fetchedAt) : Infinity;
  if (cache && age < feed.ttlMs) return { ...cache, cacheState: 'fresh', ageMs: age };

  // per-URL resilience: deliver what answered, STATE what did not —
  // partial with accounting beats all-or-nothing
  const bodies = [];
  const failures = [];
  for (const url of feed.urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.length > feed.capBytes) throw new Error(`exceeds ${feed.capBytes}B cap`);
      bodies.push({ url, text });
    } catch (err) {
      failures.push({ url, error: String(err?.message ?? err) });
    }
    // polite pacing between upstream hits
    if (feed.urls.length > 1) await new Promise((r) => setTimeout(r, 250));
  }
  if (bodies.length) {
    const fresh = { fetchedAt: new Date().toISOString(), bodies, failures };
    await writeFile(cachePath, JSON.stringify(fresh));
    return { ...fresh, cacheState: failures.length ? 'partial' : 'live', ageMs: 0 };
  }
  if (cache) {
    // stale beats silent — but the staleness is ON the response
    return { ...cache, cacheState: 'stale', ageMs: age, upstreamError: failures.map((f) => f.error).join('; ') };
  }
  throw new Error(failures.map((f) => `${new URL(f.url).host} → ${f.error}`).join('; '));
}

/** TLE text → [{name, l1, l2}] */
function parseTle(text) {
  const lines = text.split('\n').map((l) => l.trimEnd()).filter(Boolean);
  const out = [];
  for (let i = 0; i + 2 < lines.length + 1; i += 3) {
    if (lines[i + 1]?.startsWith('1 ') && lines[i + 2]?.startsWith('2 ')) {
      out.push({ name: lines[i].trim(), l1: lines[i + 1], l2: lines[i + 2] });
    }
  }
  return out;
}

export function registerLiveRoutes(get, { ok, refuse, meta }) {
  get('/api/live/satellites', async () => {
    let r;
    try {
      r = await cachedFetch('satellites', FEEDS.satellites);
    } catch (err) {
      return refuse(
        'LIVE_FEED_UNAVAILABLE',
        `celestrak did not answer and no cache exists: ${err?.message ?? err}`,
        'retry later; the proxy caches TLE sets for 6h once one fetch succeeds'
      );
    }
    const groups = r.bodies.map((b) => ({
      url: b.url,
      group: new URL(b.url).searchParams.get('GROUP'),
      tles: parseTle(b.text),
    }));
    return {
      ...ok({
        groups,
        fetchedAt: r.fetchedAt,
        cacheState: r.cacheState,
        cacheAgeMs: r.ageMs,
        // which upstream groups did NOT answer — never silent
        failures: r.failures ?? [],
        note: 'TLE element sets only — positions must be COMPUTED by SGP4 client-side and labeled as computed, with the TLE age stated',
      }),
      meta: {
        ...meta(r.fetchedAt, 'best_known'),
        sourceClass: FEEDS.satellites.sourceClass,
        valueKind: 'reported',
        admissible: true,
        admissibleBasis: 'reported_disinterested',
        knownAt: r.fetchedAt,
        upstream: 'celestrak.org (keyless, cached 6h)',
        // a live public feed is NOT the loaded corpus — its own disclaimer
        disclaimer:
          'LIVE PUBLIC FEED — reported by the named upstream, proxied and cached by the spatial API; not part of the loaded corpus',
      },
    };
  });

  get('/api/live/quakes', async () => {
    let r;
    try {
      r = await cachedFetch('quakes', FEEDS.quakes);
    } catch (err) {
      return refuse(
        'LIVE_FEED_UNAVAILABLE',
        `USGS did not answer and no cache exists: ${err?.message ?? err}`,
        'retry later; the proxy caches the quake feed for 5min once one fetch succeeds'
      );
    }
    let features;
    try {
      features = JSON.parse(r.bodies[0].text).features ?? [];
    } catch {
      return refuse('LIVE_FEED_UNREADABLE', 'USGS answered with unparseable JSON', 'check the upstream feed status');
    }
    const quakes = features.map((f) => ({
      id: f.id,
      mag: f.properties.mag,
      place: f.properties.place,
      time: new Date(f.properties.time).toISOString(),
      coordinates: f.geometry.coordinates, // [lon, lat, depthKm]
    }));
    return {
      ...ok({ quakes, fetchedAt: r.fetchedAt, cacheState: r.cacheState, cacheAgeMs: r.ageMs }),
      meta: {
        ...meta(r.fetchedAt, 'best_known'),
        sourceClass: FEEDS.quakes.sourceClass,
        valueKind: 'reported',
        admissible: true,
        admissibleBasis: 'reported_disinterested',
        knownAt: r.fetchedAt,
        upstream: 'earthquake.usgs.gov M2.5+ past day (keyless, cached 5min)',
        disclaimer:
          'LIVE PUBLIC FEED — reported by the named upstream, proxied and cached by the spatial API; not part of the loaded corpus',
      },
    };
  });
}
