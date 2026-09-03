/**
 * Security substrate for the Payload Earth Spatial API.
 *
 * This service is READ-ONLY (every route is a GET) and holds no user
 * accounts — but it DOES hold authority: PAYLOAD_OPERATIONS_TOKEN
 * unlocks the Terminal's brokerage desk, and FIRMS_MAP_KEY spends a
 * metered quota. That makes the service a **confused deputy** by
 * default: any web page the operator visits can reach a loopback
 * service, and if the service answers with permissive CORS it hands
 * privileged data to that page. The controls here close exactly that,
 * plus the classes that follow from it.
 *
 * Controls, each mapping to an invariant in docs/SECURITY.md:
 *   SEC-101 origin allowlist (no wildcard: SEC-103)
 *   SEC-102 Host allowlist — DNS-rebinding defence
 *   SEC-104 privileged routes fail closed on a foreign origin
 *   SEC-018 GET/OPTIONS only
 *   SEC-140/141 error redaction + secret scrubbing
 *   SEC-150 per-client rate limits on proxied/metered routes
 *
 * Everything fails CLOSED and answers with the service's own typed
 * refusal shape — a security refusal is an answer, not an exception.
 */

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

// ------------------------------------------------------------------ policy

/**
 * Two different questions, deliberately two different sets:
 *
 *  - as a HOST HEADER, `0.0.0.0` is just an odd way to name this
 *    machine; accepting it costs nothing.
 *  - as a BIND ADDRESS, `0.0.0.0` means EVERY interface — the exact
 *    opposite of loopback. Folding it into one set silently made
 *    world-binding look safe (caught by the binding test).
 */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);
const LOOPBACK_BIND_ADDRESSES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const csv = (v) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Origins allowed to READ cross-origin. Default: loopback dev origins. */
export function allowedOrigins(env = process.env) {
  const configured = csv(env.PAYLOAD_ALLOWED_ORIGINS);
  if (configured.length) return configured;
  const ports = ['5173', '5174', '4173', '8788', '8787'];
  return ports.flatMap((p) => [`http://localhost:${p}`, `http://127.0.0.1:${p}`]);
}

/** Host values this service will answer to (anti-DNS-rebinding). */
export function allowedHosts(env = process.env) {
  const configured = csv(env.PAYLOAD_ALLOWED_HOSTS);
  if (configured.length) return configured.map((h) => h.toLowerCase());
  return null; // null ⇒ loopback-only (hostname must be in LOOPBACK_HOSTNAMES)
}

/**
 * Routes that spend AUTHORITY or a metered quota. A foreign origin is
 * refused here before any upstream call — the deputy never acts for a
 * caller it cannot place.
 */
export const PRIVILEGED_PREFIXES = ['/api/operations', '/api/markets/broker'];

/** Routes that spend an UPSTREAM's quota (rate-limited harder). */
export const PROXIED_PREFIXES = ['/api/live/', '/api/markets/', '/api/operations', '/api/scenarios/inject', '/api/refusals'];

export const isPrivileged = (pathname) => PRIVILEGED_PREFIXES.some((p) => pathname.startsWith(p));
export const isProxied = (pathname) => PROXIED_PREFIXES.some((p) => pathname.startsWith(p));

// ------------------------------------------------------------ refusal shape

/** The service's typed refusal, reused so security answers look like
 *  every other answer: a kind, a message, a remedy. */
export const securityRefusal = (kind, message, remedy, httpStatus = 403) => ({
  status: 'refused',
  refusal: { kind, message, remedy },
  meta: { sourceClass: 'security:policy', knownAt: new Date().toISOString() },
  httpStatus,
});

// ------------------------------------------------------------------- guards

/**
 * SEC-102: the Host header must be one this service answers to.
 * A rebinding attacker controls DNS, so the browser's same-origin
 * check is worthless — but it cannot forge the Host we require.
 */
export function hostAllowed(hostHeader, env = process.env) {
  if (!hostHeader) return false;
  const host = String(hostHeader).toLowerCase();
  const hostname = host.startsWith('[')
    ? host.slice(0, host.indexOf(']') + 1)
    : host.split(':')[0];
  const configured = allowedHosts(env);
  if (configured) return configured.includes(host) || configured.includes(hostname);
  return LOOPBACK_HOSTNAMES.has(hostname);
}

/** SEC-101: is this Origin allowed to read our responses? */
export function originAllowed(origin, env = process.env) {
  if (!origin) return null; // absent ⇒ not a browser cross-origin read
  return allowedOrigins(env).includes(origin);
}

/**
 * The single request gate. Returns a refusal (to send) or null (proceed),
 * plus the CORS headers to echo. Fails closed at every branch.
 */
export function guardRequest({ method, headers, pathname, env = process.env }) {
  const origin = headers.origin ?? headers.Origin ?? null;
  const originVerdict = originAllowed(origin, env);

  // SEC-102 — Host allowlist first: it gates everything, including OPTIONS.
  if (!hostAllowed(headers.host, env)) {
    return {
      refusal: securityRefusal(
        'HOST_NOT_ALLOWED',
        'this service answers only on its allowlisted host names',
        'reach the service on a loopback address, or set PAYLOAD_ALLOWED_HOSTS for the deployed host name'
      ),
      corsHeaders: {},
    };
  }

  // SEC-103 — CORS is echoed ONLY for an allowlisted origin. Never '*'.
  const corsHeaders =
    originVerdict === true
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '600',
          Vary: 'Origin',
        }
      : { Vary: 'Origin' };

  // SEC-018 — read-only service: GET and OPTIONS only.
  if (method !== 'GET' && method !== 'OPTIONS') {
    return {
      refusal: securityRefusal(
        'METHOD_NOT_ALLOWED',
        `this projection service is read-only; ${method} has no meaning here`,
        'use GET — GET /api/capabilities lists every route',
        405
      ),
      corsHeaders,
    };
  }

  // SEC-104 — a privileged route never acts for an origin we cannot place.
  if (isPrivileged(pathname) && originVerdict === false) {
    return {
      refusal: securityRefusal(
        'ORIGIN_NOT_ALLOWED',
        'this capability spends operations authority and refuses requests from an unrecognised origin',
        'add the origin to PAYLOAD_ALLOWED_ORIGINS on the spatial API, or call it from an allowlisted surface — the credential never leaves the server either way'
      ),
      corsHeaders,
    };
  }

  return { refusal: null, corsHeaders };
}

// ---------------------------------------------------------- security headers

/**
 * Response headers for a JSON API. A CSP that forbids everything is
 * correct here: no route returns markup, so nothing legitimate can
 * break, and a reflected-content mistake cannot execute.
 */
export function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'Cross-Origin-Resource-Policy': 'same-site',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=()',
    'Cache-Control': 'no-store',
  };
}

// ------------------------------------------------------------- rate limiting

/**
 * SEC-150 — token bucket per client per class. Proxied routes spend an
 * upstream's quota (and can get the operator's key banned), so they
 * refill slower than local corpus reads.
 */
export class RateLimiter {
  #buckets = new Map();
  #classes;

  constructor(classes = { local: { capacity: 240, refillPerSec: 4 }, proxied: { capacity: 60, refillPerSec: 0.5 } }) {
    this.#classes = classes;
  }

  /** @returns {{ok: true} | {ok: false, retryAfterSec: number}} */
  take(clientKey, cls = 'local', now = Date.now()) {
    const conf = this.#classes[cls] ?? this.#classes.local;
    const key = `${cls}:${clientKey}`;
    const b = this.#buckets.get(key) ?? { tokens: conf.capacity, at: now };
    const refilled = Math.min(conf.capacity, b.tokens + ((now - b.at) / 1000) * conf.refillPerSec);
    if (refilled < 1) {
      this.#buckets.set(key, { tokens: refilled, at: now });
      return { ok: false, retryAfterSec: Math.ceil((1 - refilled) / conf.refillPerSec) };
    }
    this.#buckets.set(key, { tokens: refilled - 1, at: now });
    // bound memory: a long-lived process must not grow a bucket per spoofed key
    if (this.#buckets.size > 4096) {
      for (const [k, v] of this.#buckets) {
        if (now - v.at > 600_000) this.#buckets.delete(k);
        if (this.#buckets.size <= 2048) break;
      }
    }
    return { ok: true };
  }
}

/** Client key: the socket address, hashed — a log should not carry raw IPs. */
export function clientKey(req) {
  const addr = req.socket?.remoteAddress ?? 'unknown';
  return createHash('sha256').update(addr).digest('hex').slice(0, 16);
}

// -------------------------------------------------- redaction and scrubbing

/**
 * SEC-141 — values that must never reach a log line or a response.
 * Read lazily so a late-configured secret is still scrubbed.
 */
function secretValues(env = process.env) {
  return ['PAYLOAD_OPERATIONS_TOKEN', 'FIRMS_MAP_KEY', 'IBKR_GATEWAY_URL']
    .map((k) => env[k])
    .filter((v) => typeof v === 'string' && v.trim().length >= 6);
}

/** Replace any configured secret occurring in text with a marker. */
export function scrubSecrets(text, env = process.env) {
  let out = String(text);
  for (const v of secretValues(env)) out = out.split(v).join('«REDACTED»');
  return out;
}

/**
 * SEC-140 — an internal error becomes a correlation id for the client
 * and a scrubbed line for the operator's log. Stack traces, paths and
 * upstream URLs never cross the boundary.
 */
export function redactError(err, env = process.env) {
  const correlationId = randomUUID();
  return {
    correlationId,
    logLine: scrubSecrets(`[${correlationId}] ${err?.stack ?? err?.message ?? String(err)}`, env),
    body: {
      status: 'error',
      error: {
        kind: 'INTERNAL_ERROR',
        message: 'the service failed to answer this request',
        remedy: 'quote the correlation id to the operator; the detail is in the server log, not in this response',
        correlationId,
      },
    },
  };
}

/** Log-safe request line: path plus only the params we know are benign. */
const SAFE_QUERY_KEYS = new Set([
  'asOf', 'knowledge', 'commodity', 'bbox', 'ids', 'q', 'lat', 'lon',
  'record', 'entityId', 'type', 'severity', 'operationId', 'includeDiesel', 'api', 'view',
]);

export function safeRequestLine(pathname, searchParams, env = process.env) {
  const kept = [];
  for (const [k, v] of searchParams) {
    kept.push(SAFE_QUERY_KEYS.has(k) ? `${k}=${scrubSecrets(v, env).slice(0, 64)}` : `${k}=«dropped»`);
  }
  return `${pathname}${kept.length ? `?${kept.join('&')}` : ''}`;
}

// ------------------------------------------------------------ startup checks

/**
 * A service holding operations authority must not become world-reachable
 * by accident. Binding off-loopback requires an explicit allowlist.
 */
export function assertSafeBinding(host, env = process.env) {
  const offLoopback = !LOOPBACK_BIND_ADDRESSES.has(String(host).toLowerCase());
  if (!offLoopback) return null;
  const hasHosts = csv(env.PAYLOAD_ALLOWED_HOSTS).length > 0;
  const hasOrigins = csv(env.PAYLOAD_ALLOWED_ORIGINS).length > 0;
  if (hasHosts && hasOrigins) return null;
  return (
    `refusing to bind ${host}: this service holds operations authority and would be reachable beyond loopback.\n` +
    'REMEDY: set PAYLOAD_ALLOWED_HOSTS and PAYLOAD_ALLOWED_ORIGINS explicitly (and terminate TLS in front of it), or bind 127.0.0.1.'
  );
}

/** Constant-time compare, for any future shared-secret check. */
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
