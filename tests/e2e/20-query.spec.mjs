/** Corpus query: field-based match, chained refinements, honest zero, Esc release. */
import { bootedPage, makeRecorder } from './harness.mjs';

export async function run(browser) {
  const r = makeRecorder('20-query');
  const { page } = await bootedPage(browser);

  const res = await page.evaluate(() => window.payloadEarth.api.runCommand('producers of copper'));
  r.ok(res.ok && /LIT/.test(res.message), 'producers-of query lights a result set');
  await page.waitForSelector('.pe-query:not([hidden])', { timeout: 5000 });
  const card = await page.evaluate(() => ({
    basis: document.querySelector('.pe-query-basis')?.textContent ?? '',
    chips: [...document.querySelectorAll('.pe-query-chip')].map((c) => c.textContent),
  }));
  r.ok(/declared, not inferred/.test(card.basis), 'basis names the declared field');
  r.ok(card.chips.some((c) => /ROUTES/.test(c ?? '')), 'route refinement offered');

  await page.click('.pe-query-chip:text-is("+ ROUTES")');
  await page.waitForTimeout(400);
  const routesChip = await page.evaluate(
    () => [...document.querySelectorAll('.pe-query-chip')].map((c) => c.textContent).find((t) => /ROUTES/.test(t ?? ''))
  );
  r.ok(/ROUTES · \d/.test(routesChip ?? ''), `route refinement states its count (${routesChip})`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  r.ok(
    await page.evaluate(() => !window.payloadEarth.api.isQueryActive() && document.querySelector('.pe-query')?.hidden === true),
    'Esc releases the query'
  );

  const zero = await page.evaluate(() => window.payloadEarth.api.runCommand('producers of unobtainium'));
  r.ok(!zero.ok && /NO COMMODITY/.test(zero.message), 'unknown commodity refused, never guessed');
  await page.evaluate(() => window.payloadEarth.api.clearQuery());
  await page.close();
  return r.done();
}
