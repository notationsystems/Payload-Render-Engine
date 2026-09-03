/** Warrant graph: all subject kinds, layer columns, verification notes, click-to-focus. */
import { bootedPage, makeRecorder } from './harness.mjs';

export async function run(browser) {
  const r = makeRecorder('80-warrant');
  const { page } = await bootedPage(browser);

  const readDoc = () =>
    page.evaluate(() => ({
      title: document.querySelector('.pe-warrant .pe-patterns-title')?.textContent ?? '',
      cols: [...document.querySelectorAll('.pe-warrant .pe-w-coltitle')].map((c) => c.textContent),
      notes: [...document.querySelectorAll('.pe-warrant .pe-corpus-census')].map((n) => n.textContent ?? ''),
      buildSub: [...document.querySelectorAll('.pe-warrant .pe-w-sub')].map((t) => t.textContent).find((t) => t?.includes('committed')) ?? '',
      clickable: document.querySelectorAll('.pe-warrant .pe-w-click').length,
    }));

  // empty state
  await page.evaluate(() => window.payloadEarth.api.runCommand('warrant'));
  await page.waitForSelector('.pe-warrant:not([hidden])', { timeout: 5000 });
  r.ok(
    await page.evaluate(() => !!document.querySelector('.pe-warrant .pe-corpus-absent')),
    'no subject → explainer, not an empty graph'
  );
  await page.keyboard.press('Escape');

  // selection subject
  const nid = await page.evaluate(() => window.payloadEarth.api.store.snapshot.nodes[0].id);
  await page.evaluate((id) => window.payloadEarth.api.select(id, 'command'), nid);
  await page.evaluate(() => window.payloadEarth.api.runCommand('why'));
  await page.waitForSelector('.pe-warrant:not([hidden]) svg', { timeout: 5000 });
  let doc = await readDoc();
  r.ok(doc.cols.join(',') === 'CLAIM,COMPUTATION,RECORDS,SOURCES,BUILD', 'five warrant layers rendered');
  r.ok(/committed ⌗/.test(doc.buildSub), 'BUILD node wears the merkle commitment');
  r.ok(doc.notes.some((n) => n.includes('verification level: PROVENANCE')), 'selection states its verification level');
  await page.keyboard.press('Escape');

  // pattern subject
  await page.evaluate(async () => {
    const { patterns } = await window.payloadEarth.api.getMinedPatterns();
    await window.payloadEarth.api.showMinedPattern(patterns[0].id);
  });
  await page.evaluate(() => window.payloadEarth.api.runCommand('warrant'));
  await page.waitForSelector('.pe-warrant:not([hidden]) svg', { timeout: 5000 });
  doc = await readDoc();
  r.ok(/MINED, NOT OBSERVED/.test(doc.title), 'pattern subject titled as mined');
  r.ok(doc.notes.some((n) => n.includes('REPRODUCIBLE')), 'pattern states REPRODUCIBLE');

  // click a record → focuses on globe, panel closes
  await page.click('.pe-warrant .pe-w-click');
  await page.waitForTimeout(500);
  r.ok(
    await page.evaluate(() => document.querySelector('.pe-warrant')?.hidden === true && !!window.payloadEarth.api.getSelection()),
    'clicking a record focuses it and closes the panel'
  );
  await page.evaluate(() => window.payloadEarth.api.clearMinedPattern());
  await page.close();
  return r.done();
}
