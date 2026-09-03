/**
 * Apparatus register spec — the honesty properties, not the layout.
 *
 * The register's whole value is that it does not flatter the ecosystem.
 * So the assertions are about what it REFUSES to hide:
 *
 *   the unowned lifecycle stage is rendered, not omitted
 *   every unbuilt apparatus states why and what would unblock it
 *   every row shows where its claims were read from
 *   every divergence names who owns the decision
 *   the reading says whether it came from the service or the bundle
 *
 * The last one gets its own attack: with the service unreachable the
 * panel must still render from the bundled register AND say that is what
 * it did. A silent fallback would show a map from build time while
 * implying it came from the running system.
 */

import { API, VITE, makeRecorder } from './harness.mjs';

export async function run(browser) {
  const r = makeRecorder('07-ecosystem');

  // ---- 1. the register against the running service ------------------
  {
    const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
    await page.goto(`${VITE}/?api=${encodeURIComponent(API)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.payloadEarth, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.payloadEarth.api.runCommand('ecosystem'));
    await page.waitForTimeout(1800);

    const v = await page.evaluate(() => {
      const el = document.querySelector('.pe-eco');
      const text = el?.innerText ?? '';
      const apps = [...(el?.querySelectorAll('.pe-eco-app') ?? [])];
      return {
        open: !!el && !el.hidden,
        text,
        stages: el?.querySelectorAll('.pe-eco-stage').length ?? 0,
        unownedStages: el?.querySelectorAll('.pe-eco-stage.unowned').length ?? 0,
        unbuiltApps: apps.filter((a) => a.classList.contains('unbuilt')).length,
        // an unbuilt apparatus must carry BOTH its reason and its unblock
        unbuiltWithReason: apps.filter(
          (a) => a.classList.contains('unbuilt') && a.querySelector('.pe-eco-reason') && a.querySelector('.pe-corpus-remedy')
        ).length,
        appsWithProvenance: apps.filter((a) => a.querySelector('.pe-eco-read')).length,
        totalApps: apps.length,
        divergences: el?.querySelectorAll('.pe-eco-div').length ?? 0,
        divergencesWithOwner: el?.querySelectorAll('.pe-eco-div .pe-eco-owner').length ?? 0,
        convergences: el?.querySelectorAll('.pe-eco-conv').length ?? 0,
        refusalRows: el?.querySelectorAll('.pe-eco-row.refuses').length ?? 0,
      };
    });

    r.ok(v.open, 'the apparatus register opens from the command vocabulary');
    r.ok(v.stages >= 7, `the corpus lifecycle renders every stage (${v.stages})`);
    r.ok(
      v.unownedStages >= 1,
      `an unowned lifecycle stage is drawn as the empty slot it is (${v.unownedStages}) — a map that dropped it would show a complete ecosystem that does not exist`
    );
    r.ok(v.unbuiltApps >= 1, `unbuilt apparatuses appear in the register (${v.unbuiltApps})`);
    r.ok(
      v.unbuiltWithReason === v.unbuiltApps,
      `every unbuilt apparatus states why and what would unblock it (${v.unbuiltWithReason}/${v.unbuiltApps})`
    );
    r.ok(
      v.appsWithProvenance === v.totalApps,
      `every apparatus row shows where its claims were read (${v.appsWithProvenance}/${v.totalApps})`
    );
    r.ok(v.refusalRows >= 3, `apparatuses state what they REFUSE, not only what they hold (${v.refusalRows})`);
    r.ok(v.convergences >= 3, `the register records what the trees independently agree on (${v.convergences})`);
    r.ok(
      v.divergences >= 1 && v.divergencesWithOwner === v.divergences,
      `every divergence names who owns the decision (${v.divergencesWithOwner}/${v.divergences})`
    );
    r.ok(/read from the running projection service/i.test(v.text), 'the reading states it came from the service');
    r.ok(
      /notation:\/\/node\/apparatus\//.test(v.text),
      'each apparatus carries the identity it would hold in the notation:// space'
    );
    await page.close();
  }

  // ---- 2. the service is gone: fall back, and SAY SO ----------------
  {
    const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
    // a loopback port with nothing on it: allowlisted by SEC-110, dead
    await page.goto(`${VITE}/?api=${encodeURIComponent('http://127.0.0.1:8791')}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(() => !!window.payloadEarth, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.payloadEarth.api.runCommand('ecosystem'));
    await page.waitForTimeout(1800);
    const v = await page.evaluate(() => {
      const el = document.querySelector('.pe-eco');
      return {
        open: !!el && !el.hidden,
        text: el?.innerText ?? '',
        stages: el?.querySelectorAll('.pe-eco-stage').length ?? 0,
      };
    });
    r.ok(v.open && v.stages >= 7, 'the register still renders with no service to read it from');
    r.ok(
      /read from this bundle/i.test(v.text),
      'the fallback is STATED — a silent one would show a build-time map while implying it came from the running system'
    );
    await page.close();
  }

  return r.done();
}
