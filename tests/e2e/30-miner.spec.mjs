/** Miner: served run displayed, registry lineage, subgraph lighting, displacement, Esc. */
import { bootedPage, makeRecorder } from './harness.mjs';

export async function run(browser) {
  const r = makeRecorder('30-miner');
  const { page } = await bootedPage(browser);

  const mineRequests = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/mining/')) mineRequests.push(req.url());
  });

  const data = await page.evaluate(async () => {
    const res = await window.payloadEarth.api.getMinedPatterns();
    const buildId = window.payloadEarth.api.store.snapshot.meta.corpusBuild?.id;
    return {
      minedAt: res.minedAt,
      count: res.run.patternCount,
      allCandidates: res.patterns.every((p) => p.validationStatus === 'candidate'),
      allStamped: res.patterns.every((p) => p.corpusBuildId === buildId),
    };
  });
  r.ok(data.minedAt === 'payload-spatial-api', 'renderer displays the SERVED run (dogfooding)');
  r.ok(mineRequests.length === 1, 'exactly one mining fetch (memoized)');
  r.ok(data.count > 0 && data.allCandidates, `${data.count} candidates, none promoted`);
  r.ok(data.allStamped, 'every candidate stamped with the served build');

  await page.evaluate(() => window.payloadEarth.api.runCommand('patterns'));
  await page.waitForSelector('.pe-patterns:not([hidden]) .pe-pattern-row', { timeout: 6000 });
  const lineage = await page.evaluate(() => document.querySelector('.pe-patterns-lineage')?.textContent ?? '');
  r.ok(/RUN mine-/.test(lineage) && /MINED AT PAYLOAD-SPATIAL-API/.test(lineage), 'registry lineage names run + mining site');

  await page.click('.pe-pattern-row');
  await page.waitForSelector('.pe-pattern-card:not([hidden])', { timeout: 5000 });
  r.ok(
    await page.evaluate(() => window.payloadEarth.api.isPatternActive()),
    'clicking a candidate lights its subgraph'
  );
  const cardBasis = await page.evaluate(
    () => [...document.querySelectorAll('.pe-pattern-card .pe-query-basis')].map((b) => b.textContent).join(' ')
  );
  r.ok(/CANDIDATE/.test(cardBasis) && /not an observed fact/.test(cardBasis), 'card states candidate ≠ observed fact');

  // one lit structure at a time — a query displaces the pattern
  await page.evaluate(() => window.payloadEarth.api.runCommand('producers of copper'));
  await page.waitForTimeout(300);
  r.ok(
    await page.evaluate(() => !window.payloadEarth.api.isPatternActive() && window.payloadEarth.api.isQueryActive()),
    'query displaces pattern (one lit structure at a time)'
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.close();
  return r.done();
}
