/** Corpus definition + compiler console: declared vs derived, commitments, Esc keeps selection. */
import { API, VITE, bootedPage, makeRecorder } from './harness.mjs';

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
  // ---- "since you last looked" ---------------------------------------
  // The first visit has no bookmark and must say so rather than claim
  // nothing changed; the second visit compares. Only a real browser can
  // exercise that, because the bookmark lives in its storage.
  {
    const page2 = await browser.newPage({ viewport: { width: 1600, height: 950 } });
    await page2.goto(`${VITE}/?api=${encodeURIComponent(API)}`, { waitUntil: 'domcontentloaded' });
    await page2.waitForFunction(() => !!window.payloadEarth, null, { timeout: 30000 });
    await page2.evaluate(() => {
      // a clean slate: this operator has never seen a build here
      const raw = JSON.parse(localStorage.getItem('pe.workspace/v1') ?? '{}');
      delete raw.lastBuild;
      localStorage.setItem('pe.workspace/v1', JSON.stringify(raw));
    });
    await page2.waitForTimeout(1200);
    await page2.evaluate(() => window.payloadEarth.api.runCommand('compiler'));
    await page2.waitForTimeout(1800);

    const first = await page2.evaluate(() => document.querySelector('.pe-compiler')?.innerText ?? '');
    r.ok(/SINCE YOU LAST LOOKED/.test(first), 'the compiler console answers "has it moved since I last looked?"');
    r.ok(
      /FIRST SESSION/.test(first),
      'with no bookmark it says FIRST SESSION rather than claiming nothing changed'
    );
    r.ok(
      /WHICH records changed is ABSENT/.test(first),
      'which records moved is stated ABSENT, not left as a blank for the reader to interpret'
    );
    r.ok(/UNBLOCKED BY/.test(first), 'and the absence names what would make it answerable');
    r.ok(
      /would make the projection a store/.test(first),
      'the reason given is the architectural one — a projection reads canonical state and does not keep it'
    );

    // the bookmark was written, so a second look compares instead
    const bookmarked = await page2.evaluate(
      () => JSON.parse(localStorage.getItem('pe.workspace/v1') ?? '{}').lastBuild ?? null
    );
    r.ok(Boolean(bookmarked?.id), 'the build seen is bookmarked for next time');
    r.ok(
      bookmarked && Object.keys(bookmarked).every((k) => ['id', 'merkleRoot', 'seenAt'].includes(k)),
      'the bookmark carries id, root and time only — never build contents'
    );

    await page2.keyboard.press('Escape');
    await page2.waitForTimeout(300);
    await page2.evaluate(() => window.payloadEarth.api.runCommand('compiler'));
    await page2.waitForTimeout(1500);
    const second = await page2.evaluate(() => document.querySelector('.pe-compiler')?.innerText ?? '');
    r.ok(
      /SAME BUILD|REBUILT, NOTHING MOVED|RECORDS MOVED/.test(second),
      'a second look compares against the bookmark rather than repeating FIRST SESSION'
    );
    await page2.close();
  }

  return r.done();
}
