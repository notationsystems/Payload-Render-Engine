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

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';

const routes = await registerRoutes();

const server = createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  const send = (code, body) => {
    const json = JSON.stringify(body);
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Payload-Twin': 'spatial-api/0.1',
    });
    res.end(json);
    console.log(
      `${new Date().toISOString()} ${req.method} ${url.pathname}${url.search} → ${code} ${json.length}B ${Date.now() - started}ms`
    );
  };

  try {
    for (const route of routes) {
      const match = route.pattern.exec(url.pathname);
      if (!match || req.method !== route.method) continue;
      const result = await route.handler({ params: match.groups ?? {}, query: url.searchParams });
      const { httpStatus, ...body } = result;
      send(httpStatus ?? (result.status === 'refused' ? 422 : 200), body);
      return;
    }
    send(404, {
      status: 'refused',
      refusal: {
        kind: 'unknown_capability',
        message: `no route for ${req.method} ${url.pathname}`,
        remedy: 'GET /api/capabilities lists every route this projection service serves',
      },
    });
  } catch (err) {
    send(500, {
      status: 'error',
      error: { message: String(err?.message ?? err) },
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`payload-earth spatial api listening on http://${HOST}:${PORT}`);
  console.log('projection only — this service never mutates canonical state');
});
