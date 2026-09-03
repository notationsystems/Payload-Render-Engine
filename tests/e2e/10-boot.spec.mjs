/** Boot: the OS comes up against the spatial API, names its source, no page errors. */
import { bootedPage, makeRecorder } from './harness.mjs';

export async function run(browser) {
  const r = makeRecorder('10-boot');
  const { page, pageErrors } = await bootedPage(browser);
  const state = await page.evaluate(() => ({
    source: window.payloadEarth.api.getDataSourceId(),
    build: window.payloadEarth.api.store.snapshot.meta.corpusBuild?.id ?? null,
    nodes: window.payloadEarth.api.store.snapshot.nodes.length,
    tools: window.payloadEarth.tools.length,
  }));
  r.ok(state.source === 'payload-spatial-api', 'hydrated from the spatial API');
  r.ok(!!state.build && /^build-/.test(state.build), 'served snapshot carries a corpus build id');
  r.ok(state.nodes > 50, `corpus has entities (${state.nodes} nodes)`);
  r.ok(state.tools > 5, 'structured tool surface exposed');
  r.ok(pageErrors.length === 0, `no page errors during boot${pageErrors.length ? ` (${pageErrors[0]})` : ''}`);
  await page.close();
  return r.done();
}
