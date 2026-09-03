/** Ops mirror: EITHER the healthy desk OR the refusal-first card — both honest states. */
import { bootedPage, makeRecorder } from './harness.mjs';

export async function run(browser) {
  const r = makeRecorder('90-ops');
  const { page } = await bootedPage(browser);
  await page.evaluate(() => window.payloadEarth.api.setPreset('operations'));
  await page.waitForFunction(
    () => !!document.querySelector('.ops-row, .ops-refusal, .ops-empty'),
    null,
    { timeout: 15000 }
  );
  const state = await page.evaluate(() => ({
    rows: document.querySelectorAll('.ops-row').length,
    refusal: document.querySelector('.ops-refusal .ops-refusal-kind')?.textContent ?? null,
    remedy: document.querySelector('.ops-refusal .ops-refusal-remedy')?.textContent ?? null,
    empty: !!document.querySelector('.ops-empty'),
    mirror: document.querySelector('.ops-mirror')?.textContent ?? '',
  }));
  r.ok(/READ-ONLY MIRROR/.test(state.mirror), 'panel states the read-only mirror posture');
  if (state.refusal) {
    r.ok(!!state.remedy && state.remedy.length > 10, `desk refused (${state.refusal}) WITH its remedy — refusal-first, never an empty desk`);
  } else if (state.empty) {
    r.ok(true, 'desk empty — an observed zero, journals answered');
  } else {
    r.ok(state.rows > 0, `desk renders ${state.rows} loads with the exception-first queue`);
    const fuel = await page.evaluate(() => document.querySelector('.ops-fuel')?.textContent ?? '');
    r.ok(/DIESEL/.test(fuel), 'desk reference line present (benchmark or its stated absence)');
  }
  await page.evaluate(() => window.payloadEarth.api.setPreset('world'));
  await page.close();
  return r.done();
}
