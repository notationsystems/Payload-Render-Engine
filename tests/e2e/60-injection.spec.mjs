/** What-if injection: violet framing, state basis, backtest lens, frame toggle, Esc. */
import { API, bootedPage, makeRecorder } from './harness.mjs';

export async function run(browser) {
  const r = makeRecorder('60-injection');

  // capability probe — an absent Terminal is a stated skip, not a pass
  const probe = await (
    await fetch(`${API}/api/scenarios/inject?entityId=ent:mine:escondida&type=strike&severity=high&commodity=copper`)
  ).json();
  if (probe?.status === 'refused') {
    await r.skip(`upstream engine unavailable — ${probe.refusal.kind}: ${probe.refusal.message}`);
    return r.done();
  }

  const { page } = await bootedPage(browser);
  const out = await page.evaluate(() =>
    window.payloadEarth.api.runInjection({
      entityId: 'ent:mine:escondida',
      type: 'strike',
      severity: 'high',
      commodity: 'copper',
      asOf: '2025-06-01',
      knowledge: 'as_known_then',
    })
  );
  r.ok(out.kind === 'ok', 'injection runs through the upstream engine');
  await page.waitForSelector('.pe-inject-card:not([hidden])', { timeout: 10000 });

  const card = await page.evaluate(() => ({
    kicker: document.querySelector('.pe-inject-kicker')?.textContent,
    stateBasis: document.querySelector('.pe-inject-statebasis')?.textContent ?? '',
    frameLine:
      [...document.querySelectorAll('.pe-inject-card .pe-query-basis')].map((b) => b.textContent).find((t) => t?.includes('FRAME')) ?? '',
    reasoning: document.querySelectorAll('.pe-inject-line').length,
  }));
  r.ok(card.kicker === 'HYPOTHETICAL', 'card framed HYPOTHETICAL');
  r.ok(/UNOBSERVED/.test(card.stateBasis) && /never a delta against a guess/.test(card.stateBasis), 'unobserved baselines stated per entity');
  r.ok(/as_known_then — BACKTEST/.test(card.frameLine), 'backtest lens labeled on the frame line');
  r.ok(card.reasoning >= 3, 'engine reasoning shown verbatim');

  await page.click('.pe-inject-card .pe-query-chip:text-is("BASELINE")');
  await page.waitForTimeout(250);
  r.ok(
    await page.evaluate(() => window.payloadEarth.api.getInjectionFrame() === 'baseline' && window.payloadEarth.api.isInjectionActive()),
    'frame toggles to baseline without exiting'
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  r.ok(
    await page.evaluate(() => !window.payloadEarth.api.isInjectionActive()),
    'Esc releases the hypothetical first in the ladder'
  );
  await page.close();
  return r.done();
}
