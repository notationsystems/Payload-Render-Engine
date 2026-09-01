/**
 * Source registry — every data source the twin can draw from is a
 * self-describing entry: what it feeds, what provenance class its
 * records carry, whether it needs a key, whether it is metered (and so
 * must sit behind a budget-governed server proxy), and how fresh its
 * signal is. The pattern (one module per source layer, each carrying
 * its own provenance, read through one registry) is adapted from
 * gods-eye-view's layer architecture (MIT).
 *
 * Today one entry is constructible: the synthetic demo corpus. The
 * rest are recon entries — the vendor legwork captured as data, so
 * "which feeds are keyless" is a query, not a doc hunt. Constructing
 * a live entry means implementing SpatialDataProvider against it and
 * filling in makeProvider; the renderer never changes.
 */

import type { DataSource } from './contracts';
import type { SpatialDataProvider } from './provider';
import { SyntheticProvider } from './synthetic/provider.ts';
import { RemoteSpatialProvider } from './remote/provider.ts';

/** ?api=<base> (or bare ?api) selects the Spatial API; default local dev port. */
export function resolveApiBase(): string {
  if (typeof location !== 'undefined') {
    const p = new URLSearchParams(location.search).get('api');
    if (p && p !== '1') return p.replace(/\/+$/, '');
  }
  return 'http://127.0.0.1:8787';
}

export type Freshness = 'live' | 'delayed' | 'cached' | 'simulated' | 'unavailable';

export interface SourceDescriptor {
  id: string;
  label: string;
  /** The provenance.source value records from this source carry. */
  sourceClass: DataSource;
  /** Twin layers this source feeds (layer ids or short names). */
  feeds: string[];
  /** True when no API key is required. */
  keyless: boolean;
  /**
   * True when usage costs money — a metered source is NEVER called
   * directly from the client: it sits behind a budget-governed proxy
   * (allowlisted destinations, per-IP throttle, disk cache, response
   * caps, sanitized errors, a per-provider credit governor).
   */
  metered: boolean;
  freshness: Freshness;
  attribution?: string;
  /** Licensing / operational caveats an integrator must know. */
  notes?: string;
  /** Present only when the source is implemented. */
  makeProvider?: () => SpatialDataProvider;
}

class SourceRegistry {
  private sources = new Map<string, SourceDescriptor>();

  register(desc: SourceDescriptor): void {
    this.sources.set(desc.id, desc);
  }

  get(id: string): SourceDescriptor | undefined {
    return this.sources.get(id);
  }

  list(): SourceDescriptor[] {
    return [...this.sources.values()];
  }

  implemented(): SourceDescriptor[] {
    return this.list().filter((s) => s.makeProvider);
  }
}

export const sourceRegistry = new SourceRegistry();

// ------------------------------------------------------------------
// Implemented sources
// ------------------------------------------------------------------

sourceRegistry.register({
  id: 'synthetic-demo',
  label: 'Synthetic demo world',
  sourceClass: 'synthetic:demo',
  feeds: ['nodes', 'routes', 'flows', 'events', 'temporal-state', 'city-lights'],
  keyless: true,
  metered: false,
  freshness: 'simulated',
  makeProvider: () => new SyntheticProvider(),
});

sourceRegistry.register({
  id: 'payload-spatial-api',
  label: 'Payload Spatial API',
  sourceClass: 'payload:spatial',
  feeds: ['snapshot', 'temporal-state', 'scenarios', 'viewport-queries', 'deviations'],
  keyless: true,
  metered: false,
  freshness: 'cached',
  notes:
    'The twin backend (server/): record-level provenance travels the wire untouched — today it serves the synthetic corpus and every envelope says admissible:false. Typed refusals with remedies; knowledge=best_known|as_known_then.',
  makeProvider: () => new RemoteSpatialProvider(resolveApiBase()),
});

// ------------------------------------------------------------------
// Recon entries — free/public feeds, verified keyless-or-not
// ------------------------------------------------------------------

sourceRegistry.register({
  id: 'aisstream',
  label: 'AISStream vessel positions',
  sourceClass: 'external:ais',
  feeds: ['transport.maritime', 'flow ocean legs', 'vessel markers'],
  keyless: false, // free key, websocket
  metered: false,
  freshness: 'live',
  attribution: 'aisstream.io',
  notes: 'Free beta, no formal ToS — fine for prototyping, fragile for production; AIS itself is a public broadcast. Budget a commercial AIS vendor for the production maritime leg.',
});

sourceRegistry.register({
  id: 'nasa-firms',
  label: 'NASA FIRMS active fire detections',
  sourceClass: 'external:gov-gis',
  feeds: ['intel.risk (fire exposure)', 'intel.anomalies'],
  keyless: false, // free key
  metered: false,
  freshness: 'delayed',
  attribution: 'NASA FIRMS',
  notes: 'CC0 / US public domain; free MAP_KEY with a transaction quota — cache server-side and acknowledge EOSDIS.',
});

sourceRegistry.register({
  id: 'opensky',
  label: 'OpenSky / adsb.lol flight states',
  sourceClass: 'external:adsb',
  feeds: ['transport.air', 'aircraft markers'],
  keyless: true, // anonymous tier (rate-limited)
  metered: false,
  freshness: 'live',
  attribution: 'The OpenSky Network / adsb.lol',
  notes: 'OpenSky license is NON-COMMERCIAL — operational use in a commercial product requires a written agreement. For Payload, prefer adsb.lol (ODbL) or a commercial ADS-B vendor.',
});

sourceRegistry.register({
  id: 'usgs-quakes',
  label: 'USGS earthquake feed',
  sourceClass: 'external:gov-gis',
  feeds: ['intel.anomalies', 'event markers'],
  keyless: true,
  metered: false,
  freshness: 'live',
  attribution: 'USGS',
});

sourceRegistry.register({
  id: 'celestrak',
  label: 'CelesTrak orbital elements (SGP4)',
  sourceClass: 'external:celestrak',
  feeds: ['satellite AIS coverage (deferred)'],
  keyless: true,
  metered: false,
  freshness: 'cached',
  attribution: 'CelesTrak',
  notes: 'US-government-origin data, citation requested (Dr. T.S. Kelso). Pair with SGP4+GMST propagation if satellite-AIS coverage ever ships.',
});

sourceRegistry.register({
  id: 'gbfs',
  label: 'GBFS bikeshare (urban micro-logistics)',
  sourceClass: 'external:gbfs',
  feeds: ['urban last-mile (exploratory)'],
  keyless: true,
  metered: false,
  freshness: 'live',
  attribution: 'GBFS operators',
});
