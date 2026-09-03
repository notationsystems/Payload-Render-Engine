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

import { readCapped, readCappedJson, UPSTREAM_CAPS } from './security.mjs';
import { operationalBasis } from '../shared/envelope.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Egress: Node's fetch ignores HTTP(S)_PROXY, so environments whose only
// outbound path is a proxy would see every upstream refused. Honor the
// standard proxy variables when they are set (NO_PROXY keeps localhost
// direct); without them this is a no-op and fetch behaves as before.
// TLS trust for an intercepting proxy still comes from the standard
// NODE_EXTRA_CA_CERTS variable at process start.
if (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy) {
  try {
    const { EnvHttpProxyAgent, setGlobalDispatcher } = await import('undici');
    // EnvHttpProxyAgent honors ONLY an explicit NO_PROXY — it has no
    // implicit loopback exemption. The Terminal mirror and the IBKR
    // gateway are localhost fetches from this same process; without a
    // bypass they would tunnel to the remote proxy's OWN loopback and
    // refuse. Operator NO_PROXY wins when set; loopback is the floor.
    const noProxy = process.env.NO_PROXY ?? process.env.no_proxy ?? 'localhost,127.0.0.1,::1';
    setGlobalDispatcher(new EnvHttpProxyAgent({ noProxy }));
  } catch (err) {
    console.warn(
      `[live] proxy env set but no proxy dispatcher could be built (${err?.message ?? err}) — using direct egress`
    );
  }
}

const CACHE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../.live-cache');

// Identify honestly to upstreams. Node's fetch sends no User-Agent at
// all, and at least adsb.lol (Cloudflare-fronted) rejects UA-less
// requests with 403 — a self-naming agent string is both the fix and
// the polite posture toward free public feeds.
const FETCH_HEADERS = {
  'user-agent': 'payload-os-live-proxy/0.1 (+https://github.com/notationsystems/Payload-Render-Engine)',
};

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

/** adsb.lol point snapshots: bucketed by rounded degree, short TTL. */
const AIRCRAFT_TTL_MS = 30_000;
const AIRCRAFT_CAP = 400;
const aircraftCache = new Map(); // bucket → {fetchedAt, ac}

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
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: FETCH_HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // capped DURING the read: checking length after res.text() has
      // already allocated the whole body is not a control (SEC-151)
      const text = await readCapped(res, feed.capBytes, url);
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
  // a live public feed is NOT corpus-derived: the corpus-build identity
  // must never ride on it (undefined keys drop in JSON serialization)
  // THE ONE PATH. Two of the four feeds used to build meta inline and
  // skip this helper, so they inherited the corpus build id - and, once
  // the canonical limb landed, would have inherited a canonical
  // reference naming a dataset their own disclaimer says they are not
  // part of. The rule was written in the comment above and two routes
  // did not follow it, which is what an unenforced rule does. Every
  // feed now goes through here, and SEC-156 holds it.
  const liveMeta = (base, { upstream, observedAt, limitations, ...over } = {}) => ({
    ...base,
    corpusBuild: undefined,
    // limb 1 is inherited from meta() and must not survive here
    reference: undefined,
    ...operationalBasis({
      upstream: upstream ?? over.upstream ?? 'UNDECLARED',
      observedAt: observedAt ?? over.knownAt ?? null,
      limitations: limitations ?? [
        'LIVE PUBLIC FEED - reported by the named upstream, proxied and cached by this service; not part of the loaded corpus',
        'no proof root - nothing binds this reading to a committed build, so it cannot be verified offline',
      ],
      notCanonical:
        'a live feed is a reading taken at a moment from a source this service does not own; it is context for the corpus, never a record in it',
    }),
    ...over,
  });

  // observed air traffic around a point — gods-eye-view's adsb.lol
  // fallback pattern: regional observed context, never claimed as
  // worldwide completeness (ODbL — attribution in the envelope)
  get('/api/live/aircraft', async ({ query }) => {
    const lat = Number(query.get('lat'));
    const lon = Number(query.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) {
      return refuse('UNPARSEABLE_POINT', 'lat/lon required (abs(lat) ≤ 85)', 'pass lat=51.9&lon=4.5 — the snapshot covers 250 nm around the point');
    }
    const bucket = `${Math.round(lat)}:${Math.round(lon)}`;
    const cached = aircraftCache.get(bucket);
    let entry = cached;
    if (!cached || Date.now() - Date.parse(cached.fetchedAt) > AIRCRAFT_TTL_MS) {
      try {
        const res = await fetch(
          `https://api.adsb.lol/v2/lat/${Math.round(lat)}/lon/${Math.round(lon)}/dist/250`,
          { signal: AbortSignal.timeout(20_000), headers: FETCH_HEADERS }
        );
        if (!res.ok) throw new Error(`api.adsb.lol → HTTP ${res.status}`);
        const body = await readCappedJson(res, UPSTREAM_CAPS.json, "adsb.lol");
        const ac = (body.ac ?? [])
          .filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon))
          .sort((a, b) => (a.dst ?? 999) - (b.dst ?? 999))
          .slice(0, AIRCRAFT_CAP)
          .map((a) => ({
            hex: a.hex,
            flight: (a.flight ?? '').trim() || null,
            lat: a.lat,
            lon: a.lon,
            altFt: typeof a.alt_baro === 'number' ? a.alt_baro : null,
            gsKt: a.gs ?? null,
            track: a.track ?? a.mag_heading ?? null,
            seenPosSec: a.seen_pos ?? null,
          }));
        entry = { fetchedAt: new Date().toISOString(), ac };
        aircraftCache.set(bucket, entry);
        if (aircraftCache.size > 64) aircraftCache.delete(aircraftCache.keys().next().value);
      } catch (err) {
        if (!cached) {
          return refuse('LIVE_FEED_UNAVAILABLE', `adsb.lol did not answer: ${err?.message ?? err}`, 'retry shortly; snapshots cache for 30s per region once one fetch succeeds');
        }
        entry = cached; // stale-with-stated-age below
      }
    }
    const ageMs = Date.now() - Date.parse(entry.fetchedAt);
    return {
      ...ok({ aircraft: entry.ac, fetchedAt: entry.fetchedAt, cacheAgeMs: ageMs, center: { lat: Math.round(lat), lon: Math.round(lon) }, radiusNm: 250 }),
      meta: liveMeta(meta(entry.fetchedAt, 'best_known'), {
        sourceClass: 'external:adsb-lol',
        valueKind: 'reported',
        admissible: true,
        admissibleBasis: 'reported_disinterested',
        knownAt: entry.fetchedAt,
        upstream: 'api.adsb.lol 250nm point snapshot (keyless, ODbL — © adsb.lol contributors)',
        disclaimer: 'LIVE PUBLIC FEED — ADS-B position reports around the requested point; regional observed context, not worldwide completeness',
      }),
    };
  });

  // NASA FIRMS active fires — key-gated: fail-closed until configured
  get('/api/live/fires', async () => {
    const key = process.env.FIRMS_MAP_KEY;
    if (!key?.trim()) {
      return refuse(
        'LIVE_FEED_NOT_CONFIGURED',
        'NASA FIRMS requires a (free) MAP_KEY; the fires layer is fail-closed without it',
        'get a key at https://firms.modaps.eosdis.nasa.gov/api/map_key/ and set FIRMS_MAP_KEY in the spatial API environment'
      );
    }
    // SEC-105 — the vendor puts the key in the URL PATH, so a malformed
    // key is a path-injection primitive against their API. Validate the
    // shape before it can travel; the refusal never echoes the value.
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(key.trim())) {
      return refuse(
        'LIVE_FEED_MISCONFIGURED',
        'FIRMS_MAP_KEY is not a well-formed map key (expected 8–128 chars of [A-Za-z0-9_-])',
        'check the value copied from firms.modaps.eosdis.nasa.gov — the key is never echoed by this service'
      );
    }
    try {
      const res = await fetch(
        `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/VIIRS_NOAA20_NRT/world/1`,
        { signal: AbortSignal.timeout(30_000), headers: FETCH_HEADERS }
      );
      if (!res.ok) throw new Error(`firms → HTTP ${res.status}`);
      const text = await readCapped(res, UPSTREAM_CAPS.feed, "firms");
      const lines = text.split('\n');
      const header = lines[0].split(',');
      const ix = (n) => header.indexOf(n);
      const [iLat, iLon, iFrp, iConf, iDate, iTime] = [ix('latitude'), ix('longitude'), ix('frp'), ix('confidence'), ix('acq_date'), ix('acq_time')];
      const fires = [];
      for (let i = 1; i < lines.length; i++) {
        const c = lines[i].split(',');
        if (c.length < header.length) continue;
        fires.push({ lat: Number(c[iLat]), lon: Number(c[iLon]), frp: Number(c[iFrp]) || 0, confidence: c[iConf], acq: `${c[iDate]}T${String(c[iTime]).padStart(4, '0').replace(/(..)(..)/, '$1:$2')}:00Z` });
      }
      fires.sort((a, b) => b.frp - a.frp);
      const fetchedAt = new Date().toISOString();
      return {
        ...ok({ fires: fires.slice(0, 1500), total: fires.length, fetchedAt }),
        meta: liveMeta(meta(fetchedAt, 'best_known'), {
          sourceClass: 'external:nasa-firms',
          valueKind: 'reported',
          admissible: true,
          admissibleBasis: 'reported_disinterested',
          knownAt: fetchedAt,
          upstream: 'NASA FIRMS VIIRS NOAA-20 NRT, world/24h (keyed); NASA EOSDIS acknowledgement applies',
          disclaimer: 'LIVE PUBLIC FEED — satellite-detected thermal anomalies, top 1500 by fire radiative power',
        }),
      };
    } catch (err) {
      return refuse('LIVE_FEED_UNAVAILABLE', `FIRMS did not answer: ${err?.message ?? err}`, 'retry later or check the MAP_KEY quota');
    }
  });

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
      meta: liveMeta(meta(r.fetchedAt, 'best_known'), {
        upstream: 'celestrak.org (keyless, cached 6h)',
        observedAt: r.fetchedAt,
        limitations: [
          'LIVE PUBLIC FEED - reported by the named upstream, proxied and cached by this service; not part of the loaded corpus',
          'TLE ELEMENT SETS ONLY - no position is served here. A position must be COMPUTED by SGP4 on the client and labelled computed, with the element-set age stated',
          'no proof root - nothing binds this reading to a committed build',
        ],
        sourceClass: FEEDS.satellites.sourceClass,
        valueKind: 'reported',
        admissible: true,
        admissibleBasis: 'reported_disinterested',
        knownAt: r.fetchedAt,
        disclaimer:
          'LIVE PUBLIC FEED - reported by the named upstream, proxied and cached by the spatial API; not part of the loaded corpus',
      }),
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
      meta: liveMeta(meta(r.fetchedAt, 'best_known'), {
        upstream: 'earthquake.usgs.gov M2.5+ past day (keyless, cached 5min)',
        observedAt: r.fetchedAt,
        limitations: [
          'LIVE PUBLIC FEED - reported by the named upstream, proxied and cached by this service; not part of the loaded corpus',
          'MAGNITUDE FLOOR M2.5 - an event below the floor is absent from this reading, which is not the same fact as no event having occurred',
          'no proof root - nothing binds this reading to a committed build',
        ],
        sourceClass: FEEDS.quakes.sourceClass,
        valueKind: 'reported',
        admissible: true,
        admissibleBasis: 'reported_disinterested',
        knownAt: r.fetchedAt,
        disclaimer:
          'LIVE PUBLIC FEED - reported by the named upstream, proxied and cached by the spatial API; not part of the loaded corpus',
      }),
    };
  });
}
