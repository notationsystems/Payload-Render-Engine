/**
 * Markets proxy — the trading-desk substrate, run through the same
 * discipline as the live-feed proxy: keyless public upstreams with
 * hosts FIXED IN CODE, cached responses with stated TTLs and ages,
 * response caps, partial delivery with failures stated, and typed
 * refusals with remedies when an upstream cannot answer.
 *
 * Provenance stance per desk:
 *   FX          — ECB daily REFERENCE RATES via Frankfurter. A daily
 *                 informational fix from a disinterested central bank;
 *                 NOT a tradeable quote and never presented as one.
 *   CRYPTO      — Coinbase Exchange last trade + 24h stats + daily
 *                 candles. OBSERVED venue prints from ONE venue; venue
 *                 truth, not an index.
 *   DERIVATIVES — Deribit public book summaries: futures term structure
 *                 (incl. perpetual funding), option marks/IV/OI. Mark
 *                 prices and mark IV are the VENUE'S OWN MODEL VALUES —
 *                 labeled venue-computed, never conflated with trades.
 *   BROKER      — Interactive Brokers Client Portal adapter SEAM.
 *                 Fail-closed until IBKR_GATEWAY_URL is configured;
 *                 credentials live in the gateway, never in this
 *                 service and never in a browser. READ-ONLY: this
 *                 surface navigates; order execution belongs to the
 *                 Terminal backend with its own controls, not here.
 *
 * Instrument semantics (expiry/strike/type) are derived HERE, once,
 * from the venue's documented naming contract, and emitted as FIELDS —
 * the client never parses instrument-name strings.
 */

import { readCappedJson, UPSTREAM_CAPS } from './security.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { operationalBasis } from '../shared/envelope.mjs';

const CACHE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../.live-cache');

const FETCH_HEADERS = {
  'user-agent': 'payload-os-live-proxy/0.1 (+https://github.com/notationsystems/Payload-Render-Engine)',
};

// ------------------------------------------------------------------ cache
// memory + disk, stale-served-with-stated-age (same posture as live.mjs)

const memCache = new Map(); // name → {fetchedAt, payload}
const inflight = new Map(); // name → Promise — concurrent misses share ONE upstream run

async function cachedJson(name, ttlMs, fetcher) {
  await mkdir(CACHE_DIR, { recursive: true });
  const path = resolve(CACHE_DIR, `mkt-${name}.json`);
  let cached = memCache.get(name) ?? null;
  if (!cached) {
    try {
      cached = JSON.parse(await readFile(path, 'utf8'));
      memCache.set(name, cached); // disk survivors are memoized too
    } catch {
      /* no cache yet */
    }
  }
  const age = cached ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;
  if (cached && age < ttlMs) return { ...cached, cacheState: age === 0 ? 'live' : 'fresh', ageMs: age };

  // single-flight: a second request during a fetch awaits the first —
  // never a duplicated paced upstream sequence, never a spurious
  // refusal while a sibling is filling the cache
  if (inflight.has(name)) return inflight.get(name);
  const run = (async () => {
    try {
      const payload = await fetcher();
      const fresh = { fetchedAt: new Date().toISOString(), payload };
      memCache.set(name, fresh);
      // a LOCAL disk failure after a successful fetch must not be
      // reported as an upstream one — the fresh payload is served
      try {
        await writeFile(path, JSON.stringify(fresh));
      } catch (err) {
        console.warn(`[markets] cache write failed for ${name}: ${err?.message ?? err}`);
      }
      return { ...fresh, cacheState: 'live', ageMs: 0 };
    } catch (err) {
      if (cached) {
        // age re-measured at serve time — a slow failed fetch must not
        // understate how old the served snapshot really is
        const servedAge = Date.now() - Date.parse(cached.fetchedAt);
        return { ...cached, cacheState: 'stale', ageMs: servedAge, upstreamError: String(err?.message ?? err) };
      }
      throw err;
    } finally {
      inflight.delete(name);
    }
  })();
  inflight.set(name, run);
  return run;
}

async function getJson(url, timeoutMs = 15_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`${new URL(url).host} → HTTP ${res.status}`);
  // SEC-151 — bounded read: a market upstream is untrusted in size too
  return readCappedJson(res, UPSTREAM_CAPS.json, new URL(url).host);
}

const pace = (ms = 150) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ FX

/** Majors quoted against USD — a fixed watchlist, not a parameter. */
const FX_SYMBOLS = ['EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'CNY', 'INR', 'BRL', 'MXN', 'KRW', 'SGD'];
const FX_TTL_MS = 60 * 60_000; // ECB fixes once per business day

async function fetchFx() {
  const start = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
  const series = await getJson(
    `https://api.frankfurter.dev/v1/${start}..?base=USD&symbols=${FX_SYMBOLS.join(',')}`
  );
  // series.rates: { 'YYYY-MM-DD': {EUR: n, ...}, ... } — business days only
  const dates = Object.keys(series.rates).sort();
  if (!dates.length) throw new Error('frankfurter returned an empty series');
  return { base: 'USD', dates, rates: series.rates, latestDate: dates[dates.length - 1] };
}

// ------------------------------------------------------------------ crypto

const CRYPTO_PRODUCTS = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'LTC-USD', 'LINK-USD'];
const CRYPTO_TTL_MS = 60_000;

async function fetchCrypto() {
  const products = [];
  const failures = [];
  for (const id of CRYPTO_PRODUCTS) {
    try {
      const stats = await getJson(`https://api.exchange.coinbase.com/products/${id}/stats`);
      await pace();
      const candles = await getJson(
        `https://api.exchange.coinbase.com/products/${id}/candles?granularity=86400`
      );
      // an HTTP-200 stats body with a missing/garbled field is a
      // FAILURE for this product, never a NaN→null smuggled to the
      // client as a number
      const last = Number(stats.last);
      const open24h = Number(stats.open);
      const high24h = Number(stats.high);
      const low24h = Number(stats.low);
      const volume24h = Number(stats.volume);
      if (![last, open24h, high24h, low24h, volume24h].every(Number.isFinite)) {
        throw new Error('stats body missing or non-numeric fields');
      }
      // candles: [[time, low, high, open, close, volume], ...] newest first
      const daily = (Array.isArray(candles) ? candles : [])
        .slice(0, 30)
        .reverse()
        .map((c) => ({ t: c[0], close: c[4] }));
      products.push({ id, last, open24h, high24h, low24h, volume24h, daily });
    } catch (err) {
      // partial delivery: the desk states what did not answer
      failures.push({ product: id, error: String(err?.message ?? err) });
    }
    await pace();
  }
  if (!products.length) throw new Error(failures.map((f) => `${f.product}: ${f.error}`).join('; '));
  return { products, failures };
}

// ------------------------------------------------------------- derivatives

const DERIV_CURRENCIES = ['BTC', 'ETH'];
const DERIV_TTL_MS = 60_000;
const OPTIONS_CAP = 150; // per currency, top open interest

const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

/**
 * Deribit instrument-name contract → fields. 'BTC-26MAR27-104000-C' →
 * option; 'BTC-27NOV26' → dated future; 'BTC-PERPETUAL' → perp.
 * Derived once here from the venue's documented convention; downstream
 * consumers read FIELDS, never re-parse names.
 */
function parseInstrument(name) {
  const parts = name.split('-');
  if (parts[1] === 'PERPETUAL') return { kind: 'perpetual', expiryIso: null, strike: null, optionType: null };
  const m = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(parts[1] ?? '');
  const expiryIso = m
    ? new Date(Date.UTC(2000 + Number(m[3]), MONTHS[m[2]], Number(m[1]), 8)).toISOString()
    : null;
  if (parts.length === 2) return { kind: 'future', expiryIso, strike: null, optionType: null };
  if (parts.length === 4) {
    return {
      kind: 'option',
      expiryIso,
      strike: Number(parts[2]),
      optionType: parts[3] === 'C' ? 'call' : 'put',
    };
  }
  return { kind: 'unknown', expiryIso: null, strike: null, optionType: null };
}

async function fetchDerivatives() {
  const currencies = [];
  const failures = [];
  for (const ccy of DERIV_CURRENCIES) {
    try {
      const fut = await getJson(
        `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${ccy}&kind=future`
      );
      await pace();
      const opt = await getJson(
        `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${ccy}&kind=option`
      );
      // an HTTP-200 JSON-RPC error envelope is a FAILURE, never an
      // empty term structure cached as an answer
      if (!Array.isArray(fut.result) || !Array.isArray(opt.result)) {
        throw new Error(
          `deribit envelope missing result${fut.error?.message ? `: ${fut.error.message}` : ''}${opt.error?.message ? `: ${opt.error.message}` : ''}`
        );
      }
      const futures = fut.result
        .map((r) => ({
          instrument: r.instrument_name,
          ...parseInstrument(r.instrument_name),
          markPrice: r.mark_price,
          indexPrice: r.estimated_delivery_price ?? null,
          openInterest: r.open_interest,
          volume24hUsd: r.volume_usd ?? null,
          funding8h: r.funding_8h ?? null,
          currentFunding: r.current_funding ?? null,
        }))
        .sort((a, b) => (a.expiryIso ?? '').localeCompare(b.expiryIso ?? ''));
      const options = opt.result
        .filter((r) => (r.open_interest ?? 0) > 0)
        .sort((a, b) => (b.open_interest ?? 0) - (a.open_interest ?? 0))
        .slice(0, OPTIONS_CAP)
        .map((r) => ({
          instrument: r.instrument_name,
          ...parseInstrument(r.instrument_name),
          markPrice: r.mark_price, // in base-currency terms, per venue convention
          markIv: r.mark_iv ?? null, // venue-computed implied vol, percent
          openInterest: r.open_interest,
          underlying: r.underlying_price ?? null,
          volume24hUsd: r.volume_usd ?? null,
        }));
      currencies.push({ currency: ccy, futures, options, optionsTotal: (opt.result ?? []).length });
    } catch (err) {
      failures.push({ currency: ccy, error: String(err?.message ?? err) });
    }
    await pace();
  }
  if (!currencies.length) throw new Error(failures.map((f) => `${f.currency}: ${f.error}`).join('; '));
  return { currencies, failures };
}

// ------------------------------------------------------------------ routes

export function registerMarketRoutes(get, { ok, refuse, meta }) {
  // A venue or central-bank answer is NOT corpus-derived, and this
  // helper already knew it - it dropped the build id and said why. What
  // it did not do was say what the answer IS. The result answered
  // `status: ok` with `verification.level: PROVENANCE` and no build, no
  // root and no declaration: canonical-looking to any client that
  // checks for a level. The limitation was stated in a disclaimer
  // string, and prose is not a contract - a client cannot branch on it
  // and a checker cannot hold it. Now the declaration is structural.
  const mktMeta = (fetchedAt, { limitations, upstream, ...over } = {}) => ({
    ...meta(fetchedAt, 'best_known'),
    valueKind: 'reported',
    admissible: true,
    knownAt: fetchedAt,
    corpusBuild: undefined,
    // limb 1 is inherited from meta() and must not survive here
    reference: undefined,
    ...operationalBasis({
      upstream: upstream ?? 'UNDECLARED',
      observedAt: fetchedAt,
      // the route's own disclaimer IS its first limitation. Deriving it
      // rather than restating it means a market route added later
      // carries a real limitation instead of a generic one, and the two
      // can never drift apart into different sentences.
      limitations: limitations ?? [
        ...(typeof over.disclaimer === 'string' && over.disclaimer.trim() ? [over.disclaimer] : []),
        'NO PROOF ROOT - nothing binds this reading to a committed build, so it cannot be verified offline',
        'NOT PART OF THE LOADED CORPUS - context for the desk, never a record the corpus depends on',
      ],
      notCanonical:
        'a market reading is a quote or a published fix observed at a moment; it is not canonical state and no record in the corpus depends on it',
    }),
    ...(upstream ? { upstream } : {}),
    ...over,
  });

  get('/api/markets/fx', async () => {
    let r;
    try {
      r = await cachedJson('fx', FX_TTL_MS, fetchFx);
    } catch (err) {
      return refuse(
        'MARKET_FEED_UNAVAILABLE',
        `frankfurter/ECB did not answer: ${err?.message ?? err}`,
        'retry shortly — the FX desk serves the last good fix with its age once one fetch succeeds'
      );
    }
    return {
      ...ok({ ...r.payload, fetchedAt: r.fetchedAt, cacheState: r.cacheState, cacheAgeMs: r.ageMs }),
      meta: mktMeta(r.fetchedAt, {
        sourceClass: 'external:ecb-frankfurter',
        admissibleBasis: 'reported_disinterested',
        upstream: 'ECB daily reference rates via api.frankfurter.dev (keyless)',
        disclaimer:
          'DAILY REFERENCE FIX — an informational central-bank rate published once per business day; NOT a tradeable quote and not a live market',
        ...(r.upstreamError ? { upstreamError: r.upstreamError } : {}),
      }),
    };
  });

  get('/api/markets/crypto', async () => {
    let r;
    try {
      r = await cachedJson('crypto', CRYPTO_TTL_MS, fetchCrypto);
    } catch (err) {
      return refuse(
        'MARKET_FEED_UNAVAILABLE',
        `Coinbase Exchange did not answer: ${err?.message ?? err}`,
        'retry shortly; snapshots cache for 60s once one fetch succeeds'
      );
    }
    return {
      ...ok({ ...r.payload, fetchedAt: r.fetchedAt, cacheState: r.cacheState, cacheAgeMs: r.ageMs }),
      meta: mktMeta(r.fetchedAt, {
        sourceClass: 'external:coinbase-exchange',
        admissibleBasis: 'reported_venue',
        upstream: 'Coinbase Exchange public market data (keyless): 24h stats + daily candles',
        disclaimer:
          'SINGLE-VENUE PRINTS — last trade and 24h stats from one exchange; venue truth, not a composite index',
        ...(r.upstreamError ? { upstreamError: r.upstreamError } : {}),
      }),
    };
  });

  get('/api/markets/derivatives', async () => {
    let r;
    try {
      r = await cachedJson('derivatives', DERIV_TTL_MS, fetchDerivatives);
    } catch (err) {
      return refuse(
        'MARKET_FEED_UNAVAILABLE',
        `Deribit did not answer: ${err?.message ?? err}`,
        'retry shortly; snapshots cache for 60s once one fetch succeeds'
      );
    }
    return {
      ...ok({ ...r.payload, fetchedAt: r.fetchedAt, cacheState: r.cacheState, cacheAgeMs: r.ageMs }),
      meta: mktMeta(r.fetchedAt, {
        sourceClass: 'external:deribit',
        admissibleBasis: 'reported_venue',
        upstream: `Deribit public book summaries (keyless): futures term structure + top-${OPTIONS_CAP}-OI options per currency`,
        disclaimer:
          'VENUE MARKS — mark price and mark IV are Deribit model values, open interest and funding are venue-reported; one venue, not the whole market',
        ...(r.upstreamError ? { upstreamError: r.upstreamError } : {}),
      }),
    };
  });

  // ---- Interactive Brokers Client Portal adapter seam (fail-closed) ----
  // Read-only navigation: auth status + accounts. The gateway holds the
  // session and credentials; this service holds only its URL. No order
  // routes exist here BY DESIGN — execution is the Terminal backend's
  // concern, behind its own authority model.
  get('/api/markets/broker', async () => {
    const base = process.env.IBKR_GATEWAY_URL?.trim();
    if (!base) {
      return refuse(
        'BROKER_NOT_CONFIGURED',
        'no Interactive Brokers Client Portal Gateway is configured; the broker desk is fail-closed without one',
        'run the IB Client Portal Gateway (interactivebrokers.github.io → Client Portal API), authenticate in its login page, set IBKR_GATEWAY_URL (e.g. https://localhost:5000/v1/api), and trust its self-signed certificate by pointing NODE_EXTRA_CA_CERTS at the gateway cert when starting this service — credentials stay in the gateway, never in this service or the browser'
      );
    }
    try {
      const auth = await fetch(`${base.replace(/\/+$/, '')}/iserver/auth/status`, {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
        headers: FETCH_HEADERS,
      });
      if (!auth.ok) throw new Error(`gateway → HTTP ${auth.status}`);
      const status = await readCappedJson(auth, UPSTREAM_CAPS.json, "ibkr gateway");
      let accounts = null;
      if (status.authenticated) {
        // a bad accounts response degrades to accounts:null — it must
        // not discard the auth status already in hand as UNREACHABLE
        try {
          const acc = await fetch(`${base.replace(/\/+$/, '')}/portfolio/accounts`, {
            signal: AbortSignal.timeout(10_000),
            headers: FETCH_HEADERS,
          });
          if (acc.ok) accounts = await readCappedJson(acc, UPSTREAM_CAPS.json, "ibkr gateway");
        } catch {
          accounts = null;
        }
      }
      const fetchedAt = new Date().toISOString();
      return {
        ...ok({
          authenticated: Boolean(status.authenticated),
          connected: Boolean(status.connected),
          accounts: Array.isArray(accounts)
            ? accounts.map((a) => ({ id: a.id ?? a.accountId ?? null, alias: a.accountAlias ?? null, currency: a.currency ?? null }))
            : null,
          fetchedAt,
        }),
        meta: mktMeta(fetchedAt, {
          sourceClass: 'broker:ibkr-cpapi',
          admissibleBasis: 'reported_broker',
          upstream: 'Interactive Brokers Client Portal Gateway (local, credentialed there)',
          disclaimer:
            'READ-ONLY BROKER MIRROR — session and account identity only; no order capability exists on this surface',
        }),
      };
    } catch (err) {
      return refuse(
        'BROKER_UNREACHABLE',
        `the configured IB gateway did not answer: ${err?.message ?? err}`,
        'check that the Client Portal Gateway is running and its session is authenticated (it logs out after inactivity), then retry'
      );
    }
  });
}
