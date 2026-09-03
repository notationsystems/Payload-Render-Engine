/** Control plane: operator strip, topology, capability ladder, session journal. */
import { bootedPage, makeRecorder } from './harness.mjs';

export async function run(browser) {
  const r = makeRecorder('95-system');
  const { page } = await bootedPage(browser);

  // an operator command and an agent tool call both land in the journal
  await page.keyboard.press('/');
  await page.keyboard.type('producers of copper');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.payloadEarth.invokeTool(window.payloadEarth.tools[0].name, {}));

  await page.evaluate(() => window.payloadEarth.api.runCommand('system'));
  await page.waitForSelector('.pe-system:not([hidden])', { timeout: 5000 });
  await page.waitForFunction(() => document.querySelectorAll('.pe-system .pe-sys-row').length > 5, null, { timeout: 20000 });
  await page.waitForFunction(
    () => [...document.querySelectorAll('.pe-system .pe-sys-health')].every((h) => !/UNPROBED/.test(h.textContent ?? '')),
    null,
    { timeout: 20000 }
  );

  const doc = await page.evaluate(() => ({
    kpis: [...document.querySelectorAll('.pe-sys-kpi')].map((k) => `${k.querySelector('b')?.textContent} ${k.querySelector('span')?.textContent}`),
    healths: [...document.querySelectorAll('.pe-sys-health')].map((h) => h.textContent),
    latencies: [...document.querySelectorAll('.pe-sys-lat')].filter((l) => /MS/.test(l.textContent ?? '')).length,
    dispatchedLit: [...document.querySelectorAll('.pe-sys-cell.on')].filter((c) => /DISPATCHED/.test(c.textContent ?? '')).length,
    dispatchedCells: [...document.querySelectorAll('.pe-sys-cell')].filter((c) => /DISPATCHED/.test(c.textContent ?? '')).length,
    topologyNodes: document.querySelectorAll('.pe-system svg g').length,
    journal: [...document.querySelectorAll('.pe-system .pe-corpus-row')].map((r) => r.textContent ?? ''),
    ladderRule: [...document.querySelectorAll('.pe-sys-note')].some((n) => /never imply/.test(n.textContent ?? '')),
  }));

  r.ok(doc.kpis.some((k) => /HEALTHY/.test(k)) && doc.kpis.some((k) => /AWAITING AUTHORITY/.test(k)) && doc.kpis.some((k) => /BLOCKED/.test(k)), 'operator strip answers healthy · stale · awaiting authority · blocked');
  r.ok(doc.kpis.some((k) => /COST · ABSENT/.test(k)), 'cost stated ABSENT, not invented');
  r.ok(doc.healths.length >= 8 && doc.healths.every((h) => h !== 'UNPROBED'), `every capability probed (${doc.healths.length})`);
  r.ok(doc.latencies >= 8, 'latency measured per capability');
  r.ok(doc.topologyNodes >= 12, `topology renders the ecosystem (${doc.topologyNodes} nodes)`);
  r.ok(doc.ladderRule, 'ladder rule stated on the surface');
  // dispatched lights only from a recorded delivery; with none recorded, no cell is lit
  const delivered = await page.evaluate(async () => {
    const res = await fetch(`${new URL(document.location.href).searchParams.get('api')}/api/operations`);
    const body = await res.json();
    return body.status === 'ok' ? body.data.loads.filter((l) => l.state.tenderDelivery === 'delivered').length : 0;
  });
  r.ok(
    delivered > 0 ? doc.dispatchedLit === 1 : doc.dispatchedLit === 0,
    `DISPATCHED lit only from recorded deliveries (${delivered} delivered → ${doc.dispatchedLit} lit of ${doc.dispatchedCells} cells)`
  );
  r.ok(doc.journal.some((j) => /OPERATOR/.test(j) && /producers of copper/.test(j)), 'operator command journaled with its source');
  r.ok(doc.journal.some((j) => /AGENT/.test(j) && /tool:/.test(j)), 'agent tool call journaled with its source');
  r.ok(doc.journal.every((j) => /DISPATCHED: nothing/.test(j)), 'every journal entry states that nothing was dispatched');

  await page.click('.pe-sys-open[data-instrument="compiler"]');
  await page.waitForSelector('.pe-compiler:not([hidden])', { timeout: 5000 });
  r.ok(true, 'capability row opens its instrument');
  await page.keyboard.press('Escape');
  await page.close();
  return r.done();
}
