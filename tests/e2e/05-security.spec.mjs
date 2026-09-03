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
 * 4. The delivered document carries a strict CSP (SEC-170).
 * 5. SEC-153: a service that accepts and never answers must produce a
 *    stated refusal, not a surface that waits forever.
 * 6. The security posture surface: the ledger shows what is ABSENT with
 *    its reason, not a wall of green, and a hostile journal detail from
 *    an untrusted service renders as text (SEC-152 + SEC-120/121).
 */

import { createServer } from 'node:http';
import { API, VITE, makeRecorder } from './harness.mjs';

/** Payloads that break naive escaping in element and attribute position. */
const ELEMENT_PAYLOAD = '<img src=x onerror="window.__xss_element=1">EscondidaX';
const ATTRIBUTE_PAYLOAD = 'Antofagasta" onmouseover="window.__xss_attribute=1" data-x="';
/** A refusal journal is BUILT from attacker-controlled text. Prove it. */
const JOURNAL_PAYLOAD = 'origin=<img src=x onerror="window.__xss_journal=1">https://evil.example';

/** A hostile-but-loopback backend: mirrors the real API, poisons names. */
async function startHostileBackend(port) {
  const snap = await (await fetch(`${API}/api/snapshot`)).json();
  const poison = JSON.parse(JSON.stringify(snap));
  if (poison.data?.nodes?.length >= 2) {
    poison.data.nodes[0].name = ELEMENT_PAYLOAD;
    poison.data.nodes[1].name = ATTRIBUTE_PAYLOAD;
  }
  // a hostile posture: the journal is the one surface built entirely
  // from attacker-controlled text, so it is the one worth poisoning
  const hostilePosture = {
    status: 'ok',
    meta: {},
    data: {
      model: 'payload-security/0.1',
      threatModel: 'docs/SECURITY.md',
      policy: {
        methodsServed: ['GET', 'OPTIONS'],
        originPolicy: 'allowlist',
        allowedOrigins: [ATTRIBUTE_PAYLOAD],
        hostPolicy: 'allowlist',
        allowedHosts: ['127.0.0.1'],
        wildcardCors: false,
        tlsVerification: 'enforced',
        privilegedPrefixes: ['/api/operations'],
        proxiedPrefixes: ['/api/live/'],
      },
      authority: [{ id: 'operations', variable: 'PAYLOAD_OPERATIONS_TOKEN', purpose: ELEMENT_PAYLOAD, state: 'ABSENT', scope: 'server-side only' }],
      limits: { local: { capacity: 240, refillPerSec: 4 } },
      upstreamCaps: { json: 8388608 },
      invariants: [
        { id: 'SEC-101', domain: 'transport', state: 'ENFORCED', check: 'origin-allowlist', statement: 'Cross-origin reads are allowlisted.' },
        { id: 'SEC-999', domain: 'integrity', state: 'ABSENT', check: null, statement: ELEMENT_PAYLOAD, reason: 'a poisoned reason', unblockedBy: 'a poisoned remedy' },
      ],
      counts: { enforced: 1, deployment: 0, absent: 1 },
      events: {
        since: '2026-01-01T00:00:00.000Z',
        recorded: 1,
        retained: 1,
        dropped: 0,
        capacity: 256,
        byKind: { ORIGIN_NOT_ALLOWED: 1 },
        entries: [{ seq: 1, at: '2026-01-01T00:00:00.000Z', kind: 'ORIGIN_NOT_ALLOWED', path: '/api/operations', client: 'aa', detail: JOURNAL_PAYLOAD }],
      },
    },
  };
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*', // hostile server is permissive on purpose
    });
    const body = req.url.startsWith('/api/snapshot')
      ? poison
      : req.url.startsWith('/api/security/posture')
        ? hostilePosture
        : { status: 'ok', data: {}, meta: {} };
    res.end(JSON.stringify(body));
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
      journalFired: !!window.__xss_journal,
    }));
    r.ok(verdict.elementFired === false, 'SEC-120 element-position payload did not execute');
    r.ok(verdict.attributeFired === false, 'SEC-121 attribute-breakout payload did not execute');
    r.ok(verdict.injectedImgs === 0, 'SEC-120 no injected element entered the DOM');
    r.ok(verdict.strayHandlers === 0, 'SEC-121 no inline event handler was injected');
    r.ok(verdict.renderedAsText, 'the hostile name still renders — as text, not markup');
    r.ok(dialogs.length === 0, 'no dialog was raised by injected script');

    // the security surface is itself built from attacker-controlled
    // text — a panel that shows refusals must not be an injection sink
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.payloadEarth.api.runCommand('security'));
    await page.waitForTimeout(1200);
    const sec = await page.evaluate(() => {
      const el = document.querySelector('.pe-security');
      return {
        open: !!el && !el.hidden,
        journalFired: !!window.__xss_journal,
        detailAsText: (el?.innerText ?? '').includes('evil.example'),
        injectedInPanel: (el?.querySelectorAll('img,script,[onerror],[onmouseover]') ?? []).length,
        absentShown: (el?.innerText ?? '').includes('ABSENT'),
      };
    });
    r.ok(sec.open, 'the security posture surface opens from the command vocabulary');
    r.ok(sec.journalFired === false, 'SEC-152 a poisoned journal detail did not execute');
    r.ok(sec.injectedInPanel === 0, 'SEC-152 nothing was injected into the posture surface');
    r.ok(sec.detailAsText, 'the refused origin is still shown to the operator — as text');
    r.ok(sec.absentShown, 'the ledger states what is ABSENT, it does not hide it');
    await page.keyboard.press('Escape');

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

  // ---- 4. the delivered document carries a strict CSP ---------------
  {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.goto(`${VITE}/`, { waitUntil: 'domcontentloaded' });
    const csp = await page.evaluate(() => {
      const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
      const raw = (meta?.getAttribute('content') ?? '').replace(/\s+/g, ' ');
      const dir = (n) => raw.split(';').map((d) => d.trim()).find((d) => d.startsWith(n + ' ')) ?? '';
      return { present: !!meta, scriptSrc: dir('script-src'), defaultSrc: dir('default-src'), objectSrc: dir('object-src') };
    });
    r.ok(csp.present, 'SEC-170 a Content-Security-Policy reached the delivered document');
    r.ok(!/unsafe-inline|unsafe-eval/.test(csp.scriptSrc), `SEC-170 script-src is strict (${csp.scriptSrc})`);
    r.ok(/default-src 'none'/.test(csp.defaultSrc), 'SEC-170 the policy denies by default');
    r.ok(/object-src 'none'/.test(csp.objectSrc), 'SEC-170 plugin content is denied');
    await page.close();
  }

  // ---- 5. the honest posture, against the real gate -----------------
  {
    const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
    await page.goto(`${VITE}/?api=${encodeURIComponent(API)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.payloadEarth, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.payloadEarth.api.runCommand('security'));
    await page.waitForTimeout(1500);
    const view = await page.evaluate(() => {
      const el = document.querySelector('.pe-security');
      const text = el?.innerText ?? '';
      return {
        open: !!el && !el.hidden,
        text,
        enforcedPills: el?.querySelectorAll('.pe-sec-pill.enforced').length ?? 0,
        absentRows: el?.querySelectorAll('.pe-sec-inv.absent').length ?? 0,
        deploymentRows: el?.querySelectorAll('.pe-sec-inv.deployment').length ?? 0,
        unblocked: el?.querySelectorAll('.pe-corpus-remedy').length ?? 0,
      };
    });
    r.ok(view.open, 'the posture surface reads the live gate');
    r.ok(view.absentRows >= 1, `the ledger shows ABSENT rows (${view.absentRows}) — not a wall of green`);
    r.ok(view.deploymentRows >= 1, `the ledger separates what the DEPLOYMENT must close (${view.deploymentRows})`);
    r.ok(view.unblocked >= view.absentRows, 'every ABSENT row carries what would unblock it');
    r.ok(/OBSERVED HERE/.test(view.text), 'the client half is labelled as observed HERE, not inferred');
    r.ok(/IN FORCE AT THE GATE/.test(view.text), 'the service half is labelled as read from the gate');
    r.ok(/PAYLOAD_OPERATIONS_TOKEN/.test(view.text) && !/canary|Bearer /.test(view.text), 'SEC-013 authority is named, its value never shown');
    r.ok(/an observed zero|refusal|REFUSAL JOURNAL/i.test(view.text), 'the refusal journal states its window');
    await page.close();
  }

  // ---- 6. SEC-153: bounded reads ------------------------------------
  // A service that accepts the connection and says nothing is the worst
  // failure for an operator, because the surface neither works nor
  // refuses and they cannot tell it from a slow query. Stand one up.
  {
    const HUNG_PORT = 8796;
    let hung;
    try {
      hung = createServer(() => {
        /* accept, and never answer */
      });
      await new Promise((res, rej) => {
        hung.once('error', rej);
        hung.listen(HUNG_PORT, '127.0.0.1', res);
      });
    } catch (err) {
      await r.skip(`could not stand up the hung backend — ${err?.message ?? err}`);
    }
    if (hung) {
      const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
      await page.goto(`${VITE}/?api=${encodeURIComponent(`http://127.0.0.1:${HUNG_PORT}`)}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForFunction(() => !!window.payloadEarth, null, { timeout: 40000 });
      await page.waitForTimeout(1200);
      const t0 = Date.now();
      await page.evaluate(() => window.payloadEarth.api.runCommand('security'));
      let stated = true;
      try {
        await page.waitForFunction(
          () => /IN FORCE AT THE GATE|REMEDY:|UNREACHABLE/.test(document.querySelector('.pe-security')?.innerText ?? ''),
          null,
          { timeout: 25000 }
        );
      } catch {
        stated = false;
      }
      const elapsed = Date.now() - t0;
      const text = await page.evaluate(() => document.querySelector('.pe-security')?.innerText ?? '');
      r.ok(stated, `SEC-153 a hung service yields a stated outcome, not an endless wait (${elapsed}ms)`);
      r.ok(
        elapsed < 20000,
        `SEC-153 the wait is bounded rather than open-ended (${elapsed}ms)`
      );
      r.ok(
        /no answer within \d+ms/.test(text),
        'the refusal states how long it waited — a bare failure is not actionable'
      );
      r.ok(
        /REMEDY:/.test(text),
        'and carries a remedy, like every other refusal in this system'
      );
      await page.close();
      await new Promise((res) => hung.close(res));
    }
  }

  return r.done();
}
