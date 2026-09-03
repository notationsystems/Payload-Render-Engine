/** Workspace persistence + vocabulary overlay: the OS remembers and teaches itself. */
import { API, VITE, launchBrowser, makeRecorder } from './harness.mjs';

export async function run(browser) {
  const r = makeRecorder('15-workspace');
  // a persistent context is not needed — localStorage survives reloads
  // within one page context
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`${VITE}/?api=${encodeURIComponent(API)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.payloadEarth, null, { timeout: 30000 });
  await page.waitForTimeout(2000);

  await page.evaluate(() => {
    window.payloadEarth.api.setPreset('freight');
    window.payloadEarth.api.setSensorMode(2);
    window.payloadEarth.api.setFlowMode(true);
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.payloadEarth, null, { timeout: 30000 });
  await page.waitForTimeout(2000);
  const restored = await page.evaluate(() => ({
    preset: window.payloadEarth.api.getPreset(),
    sensor: window.payloadEarth.api.getSensorMode(),
    flow: window.payloadEarth.api.getFlowMode(),
  }));
  r.ok(restored.preset === 'freight', `preset restored after reload (${restored.preset})`);
  r.ok(restored.sensor === 2, `sensor style restored (${restored.sensor})`);
  r.ok(restored.flow === true, 'flow mode restored');
  await page.evaluate(() => {
    window.payloadEarth.api.setPreset('world');
    window.payloadEarth.api.setSensorMode(0);
    window.payloadEarth.api.setFlowMode(false);
  });

  // '?' opens the vocabulary overlay grouped by intent
  await page.keyboard.press('?');
  await page.waitForSelector('.pe-vocab:not([hidden]) .pe-corpus-sec', { timeout: 5000 });
  const vocab = await page.evaluate(() => ({
    groups: [...document.querySelectorAll('.pe-vocab .pe-corpus-sectitle')].map((s) => s.textContent),
    rows: document.querySelectorAll('.pe-vocab .pe-corpus-row').length,
  }));
  r.ok(
    ['QUERY THE CORPUS', 'MINE & VERIFY', 'HYPOTHESIZE', 'INTERACT'].every((g) => vocab.groups.includes(g)),
    'vocabulary grouped by what it does'
  );
  r.ok(vocab.rows >= 25, `${vocab.rows} capabilities listed`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  r.ok(await page.evaluate(() => document.querySelector('.pe-vocab')?.hidden === true), 'Esc closes the overlay');
  await page.close();
  return r.done();
}
