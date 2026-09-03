/**
 * Security spec — attacks, not assertions about intent.
 *
 * 1. XSS through the real render chain: a hostile backend serves the
 *    corpus with markup and attribute-breakout payloads in entity
 *    names. The OS must render them as TEXT, execute nothing, and keep
 *    its DOM intact (SEC-120/121).
 * 2. Backend origin injection: `?api=` pointed at a foreign host must
 *    be REFUSED and stated, and the OS must never fetch from it
 *    (SEC-110).
 * 3. Browser storage holds no credential-shaped value (SEC-005).
 */

import { createServer } from 'node:http';
import { API, VITE, makeRecorder } from './harness.mjs';

/** Payloads that break naive escaping in element and attribute position. */
const ELEMENT_PAYLOAD = '<img src=x onerror="window.__xss_element=1">EscondidaX';
const ATTRIBUTE_PAYLOAD = 'Antofagasta" onmouseover="window.__xss_attribute=1" data-x="';

/** A hostile-but-loopback backend: mirrors the real API, poisons names. */
async function startHostileBackend(port) {
  const snap = await (await fetch(`${API}/api/snapshot`)).json();
  const poison = JSON.parse(JSON.stringify(snap));
  if (poison.data?.nodes?.length >= 2) {
    poison.data.nodes[0].name = ELEMENT_PAYLOAD;
    poison.data.nodes[1].name = ATTRIBUTE_PAYLOAD;
  }
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*', // hostile server is permissive on purpose
    });
    res.end(JSON.stringify(req.url.startsWith('/api/snapshot') ? poison : { status: 'ok', data: {}, meta: {} }));
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return server;
}

export async function run(browser) {
  const r = makeRecorder('05-security');

  // ---- 1. XSS through the whole render chain ------------------------
  const HOSTILE_PORT = 8799;
  let hostile;
  try {
    hostile = await startHostileBackend(HOSTILE_PORT);
  } catch (err) {
    await r.skip(`could not stand up the hostile backend — ${err?.message ?? err}`);
  }
  if (hostile) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const dialogs = [];
    page.on('dialog', async (d) => {
      dialogs.push(d.message());
      await d.dismiss();
    });
    await page.goto(`${VITE}/?api=${encodeURIComponent(`http://127.0.0.1:${HOSTILE_PORT}`)}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(() => !!window.payloadEarth, null, { timeout: 30000 });
    await page.waitForTimeout(2200);

    // drive the payload through surfaces that render entity names
    await page.evaluate(() => {
      const n = window.payloadEarth.api.store.snapshot.nodes[0];
      if (n) window.payloadEarth.api.select(n.id, 'command');
    });
    await page.evaluate(() => window.payloadEarth.api.runCommand('warrant'));
    await page.waitForTimeout(900);
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.payloadEarth.api.runCommand('watches'));
    await page.waitForTimeout(300);
    await page.click('[data-add="selected"]').catch(() => {});
    await page.waitForTimeout(700);

    const verdict = await page.evaluate(() => ({
      elementFired: !!window.__xss_element,
      attributeFired: !!window.__xss_attribute,
      injectedImgs: document.querySelectorAll('img[src="x"]').length,
      // the payload must be present as TEXT somewhere it was rendered
      renderedAsText: document.body.innerText.includes('EscondidaX'),
      strayHandlers: document.querySelectorAll('[onmouseover],[onerror],[onload]').length,
    }));
    r.ok(verdict.elementFired === false, 'SEC-120 element-position payload did not execute');
    r.ok(verdict.attributeFired === false, 'SEC-121 attribute-breakout payload did not execute');
    r.ok(verdict.injectedImgs === 0, 'SEC-120 no injected element entered the DOM');
    r.ok(verdict.strayHandlers === 0, 'SEC-121 no inline event handler was injected');
    r.ok(verdict.renderedAsText, 'the hostile name still renders — as text, not markup');
    r.ok(dialogs.length === 0, 'no dialog was raised by injected script');
    await page.close();
    await new Promise((res) => hostile.close(res));
  }

  // ---- 2. backend origin injection ----------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    // match on the request HOST, not the URL string: the page's own
    // navigation carries the hostile name in its query and would
    // otherwise look like a leak (it is not — nothing was fetched)
    const foreignRequests = [];
    page.on('request', (req) => {
      let host = '';
      try {
        host = new URL(req.url()).host;
      } catch {
        /* opaque url — not a network fetch we can attribute */
      }
      if (host.endsWith('evil.example')) foreignRequests.push(req.url());
    });
    await page.goto(`${VITE}/?api=${encodeURIComponent('https://evil.example')}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(() => !!window.payloadEarth, null, { timeout: 30000 });
    await page.waitForTimeout(2000);
    const state = await page.evaluate(() => ({
      source: window.payloadEarth.api.getDataSourceId(),
      note: window.payloadEarth.api.sourceFallbackNote ?? '',
    }));
    r.ok(foreignRequests.length === 0, 'SEC-110 the OS never fetched from the attacker-named backend');
    r.ok(state.source === 'synthetic-demo', 'SEC-110 refused backend fails closed to the in-browser corpus');
    r.ok(/API BASE REFUSED/.test(state.note), 'SEC-110 the refusal is STATED, not a silent downgrade');
    await page.close();
  }

  // ---- 3. browser storage holds no credential ------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.goto(`${VITE}/?api=${encodeURIComponent(API)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.payloadEarth, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    const stored = await page.evaluate(() => {
      const out = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        out[k] = localStorage.getItem(k) ?? '';
      }
      return out;
    });
    const suspicious = Object.entries(stored).filter(([k, v]) =>
      /token|secret|bearer|password|api[_-]?key/i.test(`${k} ${v}`)
    );
    r.ok(suspicious.length === 0, `SEC-005 no credential-shaped value in browser storage (${Object.keys(stored).length} keys)`);
    await page.close();
  }

  return r.done();
}
