#!/usr/bin/env node
/**
 * Payload Earth Spatial API — the twin's backend.
 *
 * The projection service the Terminal's own architecture ledger
 * anticipated: "a native 3D world view could one day consume
 * projections over HTTP — a separate client, not a substrate."
 * This server IS that HTTP projection layer, begun against the
 * conventions studied in payload-terminal-v0 and the DAF:
 *
 *   - route-per-capability, uniform { status, data, meta } envelope
 *   - every response meta carries source class, knownAt, the asOf it
 *     was evaluated at, the knowledge mode, and admissibility —
 *     provenance is a field, never a banner
 *   - a question the data cannot answer returns a TYPED REFUSAL WITH
 *     A REMEDY, never a zero and never a fabricated answer
 *   - knowledge=best_known | as_known_then is accepted on temporal
 *     queries (the synthetic corpus has a single vintage today; the
 *     envelope says so honestly instead of pretending)
 *
 * It executes the SAME erasable-TypeScript semantic layer the client
 * ships (src/data/** via Node type-stripping) — one corpus, one
 * resolver, no second representation to drift. Metered upstreams, when
 * they arrive, sit behind the budget-governed proxy discipline noted
 * in src/data/sources.ts; nothing here calls a paid feed.
 */

import { createServer } from 'node:http';
import { URL } from 'node:url';
import { registerRoutes } from './api.mjs';
import {
  assertSafeBinding,
  clientKey,
  guardRequest,
  isProxied,
  RateLimiter,
  redactError,
  safeRequestLine,
  securityHeaders,
  securityRefusal,
} from './security.mjs';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';

// SEC-102 — a service holding operations authority does not silently
// become world-reachable; binding off-loopback demands an explicit policy
const bindingRefusal = assertSafeBinding(HOST);
if (bindingRefusal) {
  console.error(bindingRefusal);
  process.exit(2);
}

const routes = await registerRoutes();
const limiter = new RateLimiter();

const server = createServer(async (req, res) => {
  const started = Date.now();
  // the Host header is attacker-controlled; parse against a fixed
  // authority so a hostile Host cannot steer URL parsing
  const url = new URL(req.url, 'http://payload.invalid');

  const send = (code, body, corsHeaders = {}) => {
    const json = JSON.stringify(body);
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Payload-Twin': 'spatial-api/0.1',
      ...securityHeaders(),
      ...corsHeaders,
    });
    res.end(json);
    console.log(
      `${new Date().toISOString()} ${req.method} ${safeRequestLine(url.pathname, url.searchParams)} → ${code} ${json.length}B ${Date.now() - started}ms`
    );
  };

  // ---- the request gate: host, method, origin (fails closed) -------
  const { refusal, corsHeaders } = guardRequest({
    method: req.method,
    headers: req.headers,
    pathname: url.pathname,
  });
  if (refusal) {
    const { httpStatus, ...body } = refusal;
    send(httpStatus, body, corsHeaders);
    return;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...securityHeaders(), ...corsHeaders }).end();
    return;
  }

  // ---- SEC-150 rate limit: proxied routes spend an upstream's quota
  const rl = limiter.take(clientKey(req), isProxied(url.pathname) ? 'proxied' : 'local');
  if (!rl.ok) {
    const { httpStatus, ...body } = securityRefusal(
      'RATE_LIMITED',
      'this client has exhausted its request budget for this route class',
      `retry in ~${rl.retryAfterSec}s — proxied routes are limited because they spend an upstream's quota`,
      429
    );
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    send(httpStatus, body, corsHeaders);
    return;
  }

  try {
    for (const route of routes) {
      const match = route.pattern.exec(url.pathname);
      if (!match || req.method !== route.method) continue;
      const result = await route.handler({ params: match.groups ?? {}, query: url.searchParams });
      const { httpStatus, ...body } = result;
      send(httpStatus ?? (result.status === 'refused' ? 422 : 200), body, corsHeaders);
      return;
    }
    send(
      404,
      {
        status: 'refused',
        refusal: {
          kind: 'unknown_capability',
          message: 'no route for this request',
          remedy: 'GET /api/capabilities lists every route this projection service serves',
        },
      },
      corsHeaders
    );
  } catch (err) {
    // SEC-140 — the client gets a correlation id; the detail stays in
    // the operator's log, scrubbed of every configured secret
    const { logLine, body } = redactError(err);
    console.error(logLine);
    send(500, body, corsHeaders);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`payload-earth spatial api listening on http://${HOST}:${PORT}`);
  console.log('projection only — this service never mutates canonical state');
  console.log('security: host+origin allowlisted · GET only · rate limited · errors redacted (docs/SECURITY.md)');
});
