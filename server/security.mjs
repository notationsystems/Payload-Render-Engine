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
export const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);
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

  /**
   * The limit policy as the operator surface reads it. Classes and rates
   * only: bucket state is per-client and would let one caller infer
   * another's traffic.
   */
  describe() {
    return Object.fromEntries(
      Object.entries(this.#classes).map(([cls, conf]) => [
        cls,
        { capacity: conf.capacity, refillPerSec: conf.refillPerSec },
      ])
    );
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

// ------------------------------------------------- bounded upstream reads

/**
 * SEC-151 — an upstream body is untrusted in SIZE as well as content.
 *
 * `await res.json()` buffers whatever the far side sends: a hostile,
 * compromised, or merely broken upstream can exhaust this service's
 * memory with one response. (Reading the whole body and THEN checking
 * its length — as one feed did — allocates first and objects after,
 * which is not a control at all.)
 *
 * This reads through the stream with a running byte count and aborts
 * the moment the cap is crossed, so the peak allocation is bounded by
 * the cap and not by the sender's generosity.
 */
export const UPSTREAM_CAPS = {
  json: 8 * 1024 * 1024, // structured upstream answers (Terminal, markets)
  feed: 24 * 1024 * 1024, // bulk public feeds (TLE sets, FIRMS CSV)
};

export class UpstreamTooLarge extends Error {
  constructor(cap, label) {
    super(`${label ?? 'upstream'} response exceeds the ${cap}B cap`);
    this.name = 'UpstreamTooLarge';
    this.cap = cap;
  }
}

/** Read a fetch Response as text, never buffering past `maxBytes`. */
export async function readCapped(res, maxBytes = UPSTREAM_CAPS.json, label = 'upstream') {
  // a declared length over the cap is refused before a single byte lands
  const declared = Number(res.headers?.get?.('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) throw new UpstreamTooLarge(maxBytes, label);

  const body = res.body;
  if (!body?.getReader) {
    // no stream available (mocked/fixture transports): fall back, then
    // enforce — still better than no bound at all
    const text = await res.text();
    if (text.length > maxBytes) throw new UpstreamTooLarge(maxBytes, label);
    return text;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let out = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new UpstreamTooLarge(maxBytes, label);
      }
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock?.();
  }
  return out + decoder.decode();
}

/** Read a capped JSON body. Parse errors stay the caller's to type. */
export async function readCappedJson(res, maxBytes = UPSTREAM_CAPS.json, label = 'upstream') {
  return JSON.parse(await readCapped(res, maxBytes, label));
}

// ---------------------------------------------------------------------------
// SECURITY JOURNAL - incident observability (SEC-152)
//
// A control that fires silently cannot be operated. Every refusal the
// gate issues is recorded here so the operator surface can answer
// "what has been refused, and why?" without reading a log file.
//
// Two disciplines apply, both already load-bearing elsewhere in this
// system:
//
//   The journal is BOUNDED. It is a ring of RING_CAPACITY entries and it
//   counts what it dropped, so a flood of refusals cannot become the
//   memory-exhaustion vector the refusals were defending against. An
//   unbounded incident log is an attacker's amplifier.
//
//   The journal states its own WINDOW. It knows nothing before service
//   start, so it reports `since` and never lets an empty list read as
//   "nothing has ever happened" - absence is not zero.
//
// Detail fields carry attacker-controlled text (a rejected Host, a
// rejected Origin). They are scrubbed, stripped of control characters,
// bounded to DETAIL_MAX, and escaped again at render. They are never
// used to make a decision - only to tell the operator what arrived.

const RING_CAPACITY = 256;
const DETAIL_MAX = 96;

/** Attacker-controlled text, made safe to store and to show. */
export function safeDetail(value, env = process.env) {
  if (value == null) return null;
  // control characters would corrupt a log line or an operator terminal
  const text = [...scrubSecrets(String(value), env)]
    .map((ch) => {
      const code = ch.codePointAt(0);
      return code < 0x20 || code === 0x7f ? '�' : ch;
    })
    .join('');
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX)}...` : text;
}

export class SecurityJournal {
  constructor(startedAt) {
    this.entries = [];
    this.seq = 0;
    this.dropped = 0;
    this.since = startedAt ?? new Date().toISOString();
    this.byKind = new Map();
  }

  /**
   * Record one security event. `kind` is the typed refusal code, so the
   * journal shares its vocabulary with the refusal the client was given.
   */
  record({ kind, pathname, client, detail, env = process.env }) {
    this.seq += 1;
    this.byKind.set(kind, (this.byKind.get(kind) ?? 0) + 1);
    this.entries.push({
      seq: this.seq,
      at: new Date().toISOString(),
      kind,
      path: typeof pathname === 'string' ? pathname.slice(0, 128) : null,
      client: client ?? null,
      detail: safeDetail(detail, env),
    });
    while (this.entries.length > RING_CAPACITY) {
      this.entries.shift();
      this.dropped += 1;
    }
  }

  /** Newest first, bounded - the shape the operator surface reads. */
  read(limit = 50) {
    const n = Math.max(1, Math.min(RING_CAPACITY, Number(limit) || 50));
    return {
      since: this.since,
      recorded: this.seq,
      retained: this.entries.length,
      dropped: this.dropped,
      capacity: RING_CAPACITY,
      byKind: Object.fromEntries([...this.byKind].sort((a, b) => b[1] - a[1])),
      entries: this.entries.slice(-n).reverse(),
    };
  }
}

// ---------------------------------------------------------------------------
// THE INVARIANT LEDGER - the security model, declared once
//
// docs/SECURITY.md is the prose; this is its machine-readable twin. The
// operator surface renders it, so a control claimed here and absent in
// the code is a claim an operator can act on and be wrong about.
//
// `state` is deliberately three-valued, not two:
//   ENFORCED    the code enforces it and a named check proves it
//   DEPLOYMENT  the control is real but belongs to the deployment, not
//               to this process - stated so nobody assumes we did it
//   ABSENT      the control does not exist here, WITH the reason
//
// ABSENT is not a gap in the model. A control that would secure nothing
// is worse than no control: it reads as protection and buys none. Every
// ABSENT row carries what would have to become true for it to stop
// being ABSENT - the same shape as a refusal carrying its remedy.

export const SECURITY_INVARIANTS = Object.freeze([
  { id: 'SEC-101', domain: 'transport', state: 'ENFORCED', check: 'origin-allowlist',
    statement: 'Cross-origin reads are allowlisted; the API answers CORS only to declared origins.' },
  { id: 'SEC-102', domain: 'transport', state: 'ENFORCED', check: 'host-guard',
    statement: 'The Host header is validated - DNS-rebinding defence.' },
  { id: 'SEC-103', domain: 'transport', state: 'ENFORCED', check: 'no-wildcard-cors',
    statement: 'No wildcard CORS. A service holding authority never answers "*".' },
  { id: 'SEC-104', domain: 'transport', state: 'ENFORCED', check: 'privileged-origin',
    statement: 'Privileged routes fail closed on an unrecognised origin, before spending authority.' },
  { id: 'SEC-105', domain: 'transport', state: 'ENFORCED', check: 'no-dynamic-egress',
    statement: 'Proxy destinations are fixed in code; no input selects an outbound host.' },
  { id: 'SEC-106', domain: 'transport', state: 'ENFORCED', check: 'bind-guard',
    statement: 'The service refuses to bind off-loopback without an explicit host and origin policy.' },
  { id: 'SEC-130', domain: 'transport', state: 'ENFORCED', check: 'tls-verify',
    statement: 'TLS verification is never disabled anywhere in the tree.' },
  { id: 'SEC-018', domain: 'transport', state: 'ENFORCED', check: 'method-guard',
    statement: 'Only GET and OPTIONS are served; every other method is refused at the transport layer.' },

  { id: 'SEC-004', domain: 'authority', state: 'ENFORCED', check: 'secret-scan',
    statement: 'No secret is committed to source control.' },
  { id: 'SEC-013', domain: 'authority', state: 'ENFORCED', check: 'no-credential-echo',
    statement: 'No credential value appears in any response; authority is reported PRESENT/ABSENT only.' },
  { id: 'SEC-141', domain: 'authority', state: 'ENFORCED', check: 'error-redaction',
    statement: 'Secrets and internals are scrubbed from logs and errors; the client gets a correlation id.' },
  { id: 'SEC-005', domain: 'authority', state: 'ENFORCED', check: 'storage-scan',
    statement: 'No long-lived secret in browser storage - view conveniences only.' },
  { id: 'SEC-015', domain: 'authority', state: 'ENFORCED', check: 'operations-mirror',
    statement: 'Authorization failure fails closed: an unconfigured authority yields a typed refusal, never a degraded answer.' },

  { id: 'SEC-011', domain: 'agent', state: 'ENFORCED', check: 'tool-capability',
    statement: 'An agent may not grant itself capabilities; no tool reaches a dispatching or mutating member.' },
  { id: 'SEC-012', domain: 'agent', state: 'ENFORCED', check: 'tool-capability',
    statement: 'Tool invocation is allowlisted; a tool never reaches authority the operator UI itself lacks.' },

  { id: 'SEC-120', domain: 'rendering', state: 'ENFORCED', check: 'single-escaper',
    statement: 'One escaper for the whole UI; no module defines its own.' },
  { id: 'SEC-121', domain: 'rendering', state: 'ENFORCED', check: 'escaper-covers-quotes',
    statement: 'The escaper is safe in attribute position as well as element position.' },
  { id: 'SEC-110', domain: 'rendering', state: 'ENFORCED', check: 'api-base-validation',
    statement: 'The API base is allowlisted; a refused base falls back to the in-browser corpus and says so.' },
  { id: 'SEC-170', domain: 'rendering', state: 'ENFORCED', check: 'csp-policy',
    statement: 'The delivered app carries a CSP: no inline script, no eval, connect-src mirroring the API allowlist.' },
  { id: 'SEC-017', domain: 'rendering', state: 'ENFORCED', check: 'check-seam',
    statement: 'A derived representation cannot mutate canonical state; the renderer holds no write authority (INV-6).' },

  { id: 'SEC-150', domain: 'integrity', state: 'ENFORCED', check: 'rate-limit',
    statement: 'Metered and proxied routes are rate limited per client with a typed refusal.' },
  { id: 'SEC-151', domain: 'integrity', state: 'ENFORCED', check: 'bounded-reads',
    statement: 'Every upstream body read is size-bounded and cancelled at the cap.' },
  { id: 'SEC-152', domain: 'integrity', state: 'ENFORCED', check: 'security-journal',
    statement: 'Every gate refusal is recorded in a bounded journal that states its own window.' },
  { id: 'SEC-154', domain: 'integrity', state: 'ENFORCED', check: 'no-nul-byte',
    statement: 'No source file contains a NUL byte - a file tooling calls binary is a file no sweep reads.' },
  { id: 'SEC-155', domain: 'integrity', state: 'ENFORCED', check: 'assertions-can-fail',
    statement: 'No assertion takes its expected value from the environment - a check that cannot fail is not coverage.' },
  { id: 'SEC-180', domain: 'integrity', state: 'ENFORCED', check: 'disclosure-allowlist',
    statement: 'A served provenance citation names only a repository cleared for disclosure - never a private one.' },
  { id: 'SEC-182', domain: 'integrity', state: 'ENFORCED', check: 'independent-root',
    statement: 'An inclusion proof is verified against a root supplied independently of the proof - a proof checked against the root it carries proves only that it agrees with itself.' },
  { id: 'SEC-181', domain: 'integrity', state: 'ENFORCED', check: 'merkle-domain-separation',
    statement: 'No Merkle leaf preimage can be confused with an internal node - the fold promotes odd nodes, so the structure is ambiguous without it.' },
  { id: 'SEC-160', domain: 'integrity', state: 'ENFORCED', check: 'lockfile',
    statement: 'Dependencies are pinned and minimal; the advisory surface is checked, not assumed.' },
  { id: 'SEC-009', domain: 'integrity', state: 'ENFORCED', check: 'commitment',
    statement: 'Provenance stays cryptographically bound; a tampered record fails offline verification.' },
  { id: 'SEC-014', domain: 'integrity', state: 'ENFORCED', check: 'commitment',
    statement: 'Verification failure fails closed; a proof that does not fold to the root is reported as a failure.' },

  // ---- real, but not this process's to enforce ---------------------------
  { id: 'SEC-018-TLS', domain: 'transport', state: 'DEPLOYMENT', check: null,
    statement: 'Plaintext transport is admissible only at documented local termination.',
    reason: 'TLS is terminated by the deployment, not by this process. Binding off-loopback without an explicit host and origin policy is refused at startup, so the gap cannot be reached by accident.' },
  { id: 'SEC-171', domain: 'rendering', state: 'DEPLOYMENT', check: null,
    statement: 'Framing is denied for the delivered app.',
    reason: 'frame-ancestors is ignored in a meta CSP; it has to arrive as a response header from whatever serves the built bundle. The API already sends X-Frame-Options: DENY for its own responses.' },

  // ---- absent, with the reason -------------------------------------------
  { id: 'SEC-002', domain: 'authority', state: 'ABSENT', check: null,
    statement: 'Subjects are authenticated and requests authorized per subject.',
    reason: 'There are no accounts and no write path. An auth stack here would gate a read-only projection of data the operator already holds, while creating the session and credential surface it claims to protect.',
    unblockedBy: 'a write boundary, or a multi-tenant read - either introduces a subject worth authenticating' },
  { id: 'SEC-016', domain: 'integrity', state: 'ABSENT', check: null,
    statement: 'Confidential data is encrypted at rest.',
    reason: 'This service persists no confidential data. The corpus is a projection recompiled from upstreams and the cache holds public feed payloads; encrypting it would protect nothing and would mint a key with no rotation story.',
    unblockedBy: 'the first confidential record that is written here rather than recompiled' },
  { id: 'SEC-190', domain: 'authority', state: 'ABSENT', check: null,
    statement: 'Keys are managed with a defined rotation and revocation path.',
    reason: 'No key is minted by this process. The credentials it reads are issued and rotated by their own systems - the Terminal, the broker gateway, NASA FIRMS - so a rotation path claimed here would describe a control that lives elsewhere.',
    unblockedBy: 'signing the commitment root: an ATTESTED build needs a signing key, and that key is what makes this row real' },
]);

/**
 * The machine-readable security posture: the policy actually in force,
 * authority PRESENT/ABSENT (never a value), limits, and the ledger.
 */
export function securityPosture(env = process.env, limiter = null) {
  const authority = [
    { id: 'operations', variable: 'PAYLOAD_OPERATIONS_TOKEN', purpose: 'Terminal operations mirror' },
    { id: 'firms', variable: 'FIRMS_MAP_KEY', purpose: 'NASA FIRMS thermal feed' },
    { id: 'broker', variable: 'IBKR_GATEWAY_URL', purpose: 'broker gateway location' },
  ].map((a) => ({
    ...a,
    // SEC-013 - presence, never the value. Nothing downstream can widen this.
    state: env[a.variable] ? 'PRESENT' : 'ABSENT',
    scope: 'server-side only - never returned to a client or an agent',
  }));

  const configuredHosts = allowedHosts(env);

  return {
    model: 'payload-security/0.1',
    threatModel: 'docs/SECURITY.md',
    policy: {
      methodsServed: ['GET', 'OPTIONS'],
      originPolicy: 'allowlist',
      allowedOrigins: allowedOrigins(env),
      // loopback-only is a POLICY, not an empty list. Reporting the
      // gate's null as a blank would tell an operator "no hosts are
      // allowed" when the truth is "only the loopback names are".
      hostPolicy: configuredHosts ? 'allowlist' : 'loopback-only',
      allowedHosts: configuredHosts ?? [...LOOPBACK_HOSTNAMES],
      wildcardCors: false,
      tlsVerification: 'enforced',
      privilegedPrefixes: PRIVILEGED_PREFIXES,
      proxiedPrefixes: PROXIED_PREFIXES,
    },
    authority,
    limits: limiter?.describe ? limiter.describe() : null,
    upstreamCaps: UPSTREAM_CAPS,
    invariants: SECURITY_INVARIANTS,
    counts: {
      enforced: SECURITY_INVARIANTS.filter((i) => i.state === 'ENFORCED').length,
      deployment: SECURITY_INVARIANTS.filter((i) => i.state === 'DEPLOYMENT').length,
      absent: SECURITY_INVARIANTS.filter((i) => i.state === 'ABSENT').length,
    },
  };
}
