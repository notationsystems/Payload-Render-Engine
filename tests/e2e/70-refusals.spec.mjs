/** Refusals work queue: grouped by mechanism, one shared remedy, ranked. */
import { API, bootedPage, makeRecorder } from './harness.mjs';

export async function run(browser) {
  const r = makeRecorder('70-refusals');
  const probe = await (await fetch(`${API}/api/refusals?commodity=copper`)).json();
  if (probe?.status === 'refused' && probe.refusal.kind !== 'REFUSALS_QUEUE_UNSUPPORTED_FOR_CORPUS') {
    await r.skip(`upstream digest unavailable — ${probe.refusal.kind}`);
    return r.done();
  }

  const { page } = await bootedPage(browser);
  await page.evaluate(() => window.payloadEarth.api.runCommand('refusals'));
  await page.waitForSelector('.pe-refusals:not([hidden])', { timeout: 6000 });
  await page.waitForFunction(
    () => !!document.querySelector('.pe-refusals .pe-refusals-head, .pe-refusals .pe-corpus-absent'),
    null,
    { timeout: 8000 }
  );
  const doc = await page.evaluate(() => ({
    heads: [...document.querySelectorAll('.pe-refusals-head')].map((h) => h.textContent ?? ''),
    remedies: document.querySelectorAll('.pe-refusals-remedy').length,
    banner: document.querySelector('.pe-refusals-banner')?.textContent ?? '',
  }));
  if (probe?.status === 'ok') {
    r.ok(doc.heads.length >= 1 && /\d+ REFUSALS/.test(doc.heads[0]), 'digest heads state totals per commodity');
    r.ok(doc.remedies >= 1, 'each mechanism group carries its ONE shared remedy');
  } else {
    r.ok(
      await page.evaluate(() => !!document.querySelector('.pe-refusals .pe-corpus-absent')),
      'unsupported corpus renders its typed refusal, never an empty queue'
    );
  }
  r.ok(/work order/i.test(doc.banner), 'banner frames the queue as a work order');
  await page.keyboard.press('Escape');
  await page.close();
  return r.done();
}
