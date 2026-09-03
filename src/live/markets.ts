/**
 * Markets client — the trading-desk substrate, fetched THROUGH the
 * spatial API's markets proxy, never directly from a venue.
 *
 * Basis honesty per desk, carried on every set so the UI can label it:
 *   FX          — REPORTED · ECB daily reference fix (not a tradeable
 *                 quote); the fix DATE travels with the desk.
 *   CRYPTO      — OBSERVED · single-venue prints (Coinbase Exchange),
 *                 24h stats + daily closes.
 *   DERIVATIVES — REPORTED · Deribit venue marks/IV/OI/funding; mark
 *                 values are the venue's model, and anything this
 *                 client derives from them (annualized basis) is
 *                 labeled COMPUTED.
 *   BROKER      — the IBKR adapter seam: usually a typed refusal with
 *                 a remedy until a gateway is configured. Read-only.
 */

import type { Timestamp } from '../data/contracts';
import { fetchBounded } from '../data/sources';
import { recordFeed } from '../core/health';

export interface FxSet {
  base: string; // 'USD'
  dates: string[]; // business days, ascending
  rates: Record<string, Record<string, number>>; // date → symbol → rate
  latestDate: string;
  fetchedAt: Timestamp;
  cacheState: string;
  upstream: string;
  disclaimer: string;
}

export interface CryptoProduct {
  id: string; // 'BTC-USD'
  last: number;
  open24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  daily: { t: number; close: number }[]; // ascending, ~30 days
}

export interface CryptoSet {
  products: CryptoProduct[];
  failures: { product: string; error: string }[];
  fetchedAt: Timestamp;
  cacheState: string;
  upstream: string;
  disclaimer: string;
}

export interface DerivFuture {
  instrument: string;
  kind: 'perpetual' | 'future' | 'option' | 'unknown';
  expiryIso: string | null;
  markPrice: number;
  indexPrice: number | null;
  openInterest: number;
  volume24hUsd: number | null;
  funding8h: number | null;
  currentFunding: number | null;
}

export interface DerivOption {
  instrument: string;
  kind: string;
  expiryIso: string | null;
  strike: number | null;
  optionType: 'call' | 'put' | null;
  markPrice: number; // base-currency terms per venue convention
  markIv: number | null; // venue-computed implied vol, percent
  openInterest: number;
  underlying: number | null;
  volume24hUsd: number | null;
}

export interface DerivCurrency {
  currency: string; // BTC | ETH
  futures: DerivFuture[];
  options: DerivOption[];
  optionsTotal: number; // options existing at the venue before the OI cap
}

export interface DerivSet {
  currencies: DerivCurrency[];
  failures: { currency: string; error: string }[];
  fetchedAt: Timestamp;
  cacheState: string;
  upstream: string;
  disclaimer: string;
}

export interface BrokerStatus {
  authenticated: boolean;
  connected: boolean;
  accounts: { id: string | null; alias: string | null; currency: string | null }[] | null;
  fetchedAt: Timestamp;
  disclaimer: string;
}

export type MarketResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'refused'; refusal: { kind: string; message: string; remedy: string } }
  | { kind: 'unreachable'; note: string };

interface Envelope {
  status?: string;
  data?: unknown;
  refusal?: { kind: string; message: string; remedy: string };
  meta?: { upstream?: string; disclaimer?: string };
}

async function getEnvelope(apiBase: string, path: string): Promise<MarketResult<{ data: unknown; meta?: Envelope['meta'] }>> {
  let body: Envelope;
  try {
    const res = await fetchBounded(`${apiBase}${path}`, { headers: { Accept: 'application/json' } });
    body = (await res.json()) as Envelope;
  } catch (err) {
    return {
      kind: 'unreachable',
      note: `spatial API unreachable at ${apiBase} — market desks need the server (${err instanceof Error ? err.message : err})`,
    };
  }
  if (body.status === 'refused' && body.refusal) return { kind: 'refused', refusal: body.refusal };
  if (body.status === 'ok') return { kind: 'ok', data: { data: body.data, meta: body.meta } };
  return { kind: 'unreachable', note: 'unrecognized envelope from the spatial API' };
}

export async function fetchFx(apiBase: string): Promise<MarketResult<FxSet>> {
  const r = await getEnvelope(apiBase, '/api/markets/fx');
  recordFeed('markets.fx', r.kind === 'ok' ? 'ok' : r.kind);
  if (r.kind !== 'ok') return r;
  const d = r.data.data as Omit<FxSet, 'upstream' | 'disclaimer'>;
  return {
    kind: 'ok',
    data: {
      ...d,
      upstream: r.data.meta?.upstream ?? 'ECB via frankfurter',
      disclaimer: r.data.meta?.disclaimer ?? 'daily reference fix, not a tradeable quote',
    },
  };
}

export async function fetchCrypto(apiBase: string): Promise<MarketResult<CryptoSet>> {
  const r = await getEnvelope(apiBase, '/api/markets/crypto');
  recordFeed('markets.crypto', r.kind === 'ok' ? 'ok' : r.kind);
  if (r.kind !== 'ok') return r;
  const d = r.data.data as Omit<CryptoSet, 'upstream' | 'disclaimer'>;
  return {
    kind: 'ok',
    data: {
      ...d,
      upstream: r.data.meta?.upstream ?? 'Coinbase Exchange',
      disclaimer: r.data.meta?.disclaimer ?? 'single-venue prints, not a composite index',
    },
  };
}

export async function fetchDerivatives(apiBase: string): Promise<MarketResult<DerivSet>> {
  const r = await getEnvelope(apiBase, '/api/markets/derivatives');
  recordFeed('markets.derivatives', r.kind === 'ok' ? 'ok' : r.kind);
  if (r.kind !== 'ok') return r;
  const d = r.data.data as Omit<DerivSet, 'upstream' | 'disclaimer'>;
  return {
    kind: 'ok',
    data: {
      ...d,
      upstream: r.data.meta?.upstream ?? 'Deribit public book summaries',
      disclaimer: r.data.meta?.disclaimer ?? 'venue marks; one venue, not the whole market',
    },
  };
}

export async function fetchBroker(apiBase: string): Promise<MarketResult<BrokerStatus>> {
  const r = await getEnvelope(apiBase, '/api/markets/broker');
  recordFeed('markets.broker', r.kind === 'ok' ? 'ok' : r.kind);
  if (r.kind !== 'ok') return r;
  const d = r.data.data as Omit<BrokerStatus, 'disclaimer'>;
  return {
    kind: 'ok',
    data: {
      ...d,
      disclaimer: r.data.meta?.disclaimer ?? 'read-only broker mirror; no order capability on this surface',
    },
  };
}

/**
 * Annualized basis of a dated future vs its index — COMPUTED here,
 * labeled COMPUTED wherever it renders. null when inputs are missing
 * or the future expires within a day (the annualization degenerates).
 */
export function annualizedBasis(f: DerivFuture, nowMs: number): number | null {
  if (f.kind !== 'future' || !f.expiryIso) return null;
  if (typeof f.indexPrice !== 'number' || !Number.isFinite(f.indexPrice) || f.indexPrice <= 0) return null;
  const years = (Date.parse(f.expiryIso) - nowMs) / (365.25 * 86_400_000);
  if (!Number.isFinite(years) || years < 1 / 365) return null; // near expiry OR unparseable — never NaN out
  return (f.markPrice / f.indexPrice - 1) / years;
}
