/** Corpus definition + compiler console: declared vs derived, commitments, Esc keeps selection. */
import { bootedPage, makeRecorder } from './harness.mjs';

export async function run(browser) {
  const r = makeRecorder('40-corpus-compiler');
  const { page } = await bootedPage(browser);

  await page.evaluate(() => window.payloadEarth.api.runCommand('corpus'));
  await page.waitForSelector('.pe-corpus:not([hidden]):not(.pe-compiler):not(.pe-refusals):not(.pe-warrant) .pe-corpus-sec', { timeout: 6000 });
  const def = await page.evaluate(() => ({
    sections: [...document.querySelectorAll('.pe-corpus:not(.pe-compiler):not(.pe-refusals):not(.pe-warrant) .pe-corpus-sectitle')].map((s) => s.textContent ?? ''),
    derived: document.querySelectorAll('.pe-corpus:not(.pe-compiler) .pe-corpus-derived').length,
  }));
  r.ok(def.sections.some((s) => s.includes('EXTRACTION')) && def.sections.some((s) => s.includes('VALIDATION')), 'definition declares extraction + validation rules');
  r.ok(def.derived >= 3, 'derived censuses labeled DERIVED FROM SNAPSHOT');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  const nid = await page.evaluate(() => window.payloadEarth.api.store.snapshot.nodes[0].id);
  await page.evaluate((id) => window.payloadEarth.api.select(id, 'command'), nid);
  await page.evaluate(() => window.payloadEarth.api.runCommand('compiler'));
  await page.waitForSelector('.pe-compiler:not([hidden]) .pe-corpus-sec', { timeout: 6000 });
  const comp = await page.evaluate(() => ({
    sections: [...document.querySelectorAll('.pe-compiler .pe-corpus-sectitle')].map((s) => s.textContent ?? ''),
    note: [...document.querySelectorAll('.pe-compiler .pe-corpus-absent')].map((n) => n.textContent).join(' '),
  }));
  r.ok(comp.sections.some((s) => s.includes('COMMITMENT MANIFEST')), 'compiler console shows the commitment manifest');
  r.ok(comp.sections.some((s) => s.includes('EXCLUDED, WITH REASONS')), 'conservation report shows exclusions with reasons');
  r.ok(/NOT ATTESTATION/.test(comp.note), 'the manifest states what it is not');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  r.ok(
    await page.evaluate((id) => window.payloadEarth.api.getSelection() === id, nid),
    'Esc closes the console without clearing the selection'
  );
  await page.close();
  return r.done();
}
