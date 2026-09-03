/** Watches: arm, trip with basis, persist; warrant export carries proofs. */
import { bootedPage, makeRecorder } from './harness.mjs';

export async function run(browser) {
  const r = makeRecorder('85-watches');
  const { page } = await bootedPage(browser);
  await page.evaluate(() => localStorage.removeItem('pe.watches/v1'));

  // arm an entity watch on a known articulation candidate → trips with a MINED basis
  const articEntity = await page.evaluate(async () => {
    const { patterns } = await window.payloadEarth.api.getMinedPatterns();
    const p = patterns.find((x) => x.patternType === 'STRUCTURAL_ARTICULATION');
    return p?.entities[0] ?? null;
  });
  if (!articEntity) {
    await r.skip('no articulation candidate in this corpus — entity-watch trip not exercisable');
  } else {
    await page.evaluate((id) => window.payloadEarth.api.select(id, 'command'), articEntity);
    await page.evaluate(() => window.payloadEarth.api.runCommand('watches'));
    await page.waitForSelector('.pe-watches:not([hidden])', { timeout: 5000 });
    await page.click('[data-add="selected"]');
    await page.waitForFunction(
      () => (document.querySelector('.pe-watches .pe-patterns-count')?.textContent ?? '').includes('1 ARMED'),
      null,
      { timeout: 6000 }
    );
    await page.waitForFunction(
      () => [...document.querySelectorAll('.pe-watches .pe-watch-basis')].some((b) => /MINED/.test(b.textContent ?? '')),
      null,
      { timeout: 8000 }
    );
    r.ok(true, 'entity watch trips on articulation candidacy, basis MINED');
    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('pe.watches/v1') ?? '{}'));
    r.ok(persisted.watches?.length === 1 && persisted.trips?.length >= 1, 'watch + trip persisted');
    await page.keyboard.press('Escape');
  }

  // warrant export: audit object with inclusion proofs
  const nid = await page.evaluate(() => window.payloadEarth.api.store.snapshot.nodes[0].id);
  await page.evaluate((id) => window.payloadEarth.api.select(id, 'command'), nid);
  await page.evaluate(() => window.payloadEarth.api.runCommand('warrant'));
  await page.waitForSelector('.pe-warrant:not([hidden]) .pe-warrant-export', { timeout: 5000 });
  await page.click('.pe-warrant-export');
  await page.waitForFunction(() => !!window.peLastWarrantExport, null, { timeout: 10000 });
  const audit = await page.evaluate(() => {
    const a = window.peLastWarrantExport;
    return {
      hasGraph: Array.isArray(a.graph?.nodes) && a.graph.nodes.length > 2,
      proofCount: Object.keys(a.inclusionProofs ?? {}).length,
      build: a.corpusBuild?.merkleRoot?.length === 64,
      proofNote: a.proofNote ?? '',
      addresses: Object.values(a.addresses ?? {}),
      addressNote: a.addressNote ?? '',
      refs: (a.graph?.nodes ?? []).filter((n) => n.entityRef).map((n) => n.entityRef),
    };
  });
  r.ok(audit.hasGraph, 'export carries the full chain');
  r.ok(audit.proofCount >= 1, `export attaches ${audit.proofCount} inclusion proof(s)`);
  r.ok(audit.build, 'export carries the committed build');
  r.ok(/verify-inclusion/.test(audit.proofNote), 'export states how to verify offline');

  // The ids in the export are shaped by whichever apparatus minted them,
  // so an auditor who does not know that convention has opaque strings.
  // The notation:// form is what makes this object portable rather than
  // only verifiable — an auditor can navigate back to what they checked.
  r.ok(
    audit.addresses.length >= 1,
    `export carries notation:// addresses for its records (${audit.addresses.length})`
  );
  r.ok(
    audit.addresses.every((u) => typeof u === 'string' && u.startsWith('notation://')),
    'every exported address is a notation:// URI'
  );
  r.ok(
    audit.addresses.length === new Set(audit.refs).size,
    `every referenced record got an address (${audit.addresses.length} of ${new Set(audit.refs).size})`
  );
  r.ok(
    /grants no access/i.test(audit.addressNote),
    'the export states that an address names a record and grants nothing'
  );

  await page.evaluate(() => localStorage.removeItem('pe.watches/v1'));
  await page.close();
  return r.done();
}
