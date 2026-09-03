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
 *   a notation:// address navigates, and an unheld one refuses with its
 *   holder named rather than missing silently
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

  // ---- 3. notation:// as a working address ---------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
    await page.goto(`${VITE}/?api=${encodeURIComponent(API)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.payloadEarth, null, { timeout: 30000 });
    await page.waitForTimeout(1800);

    // an entity address navigates the globe
    const nav = await page.evaluate(() => {
      const api = window.payloadEarth.api;
      const first = api.store.snapshot.nodes.find((n) => n.id.startsWith('ent:'));
      if (!first) return { skipped: true };
      const [, type, ...rest] = first.id.split(':');
      const res = api.runCommand(`notation://entity/${type}/${rest.join(':')}`);
      return { skipped: false, res, selected: api.getSelection(), expected: first.id };
    });
    if (nav.skipped) {
      await r.skip('no ent:-shaped entity in the loaded corpus to address');
    } else {
      r.ok(nav.res.ok, `an entity address resolves (${nav.res.message})`);
      r.ok(nav.selected === nav.expected, 'the address selected the record it names');
    }

    // the id-shape divergence: a non-primary shape resolves AND says so
    const legacy = await page.evaluate(() => {
      const api = window.payloadEarth.api;
      const bare = api.store.snapshot.nodes.find((n) => !n.id.includes(':') && n.id.includes('-'));
      if (!bare) return { skipped: true };
      const [head, ...rest] = bare.id.split('-');
      return { skipped: false, res: api.runCommand(`notation://entity/${head}/${rest.join('-')}`), id: bare.id };
    });
    if (legacy.skipped) {
      await r.skip('this corpus mints one id shape — nothing to test the second path against');
    } else {
      r.ok(legacy.res.ok, `a non-primary id shape still resolves (${legacy.id})`);
      r.ok(
        /id shape this corpus also mints/i.test(legacy.res.message),
        'and the surface SAYS which shape answered — an undocumented relabelling is where provenance is lost'
      );
    }

    // a kind held by another apparatus refuses WITH the holder
    const held = await page.evaluate(() =>
      window.payloadEarth.api.runCommand('notation://artifact/deadbeef')
    );
    r.ok(!held.ok, 'a kind held elsewhere does not pretend to resolve');
    r.ok(/NOT HELD HERE/.test(held.message) && /OCR/i.test(held.message), 'the refusal names the apparatus that holds it');
    r.ok(/UNBLOCKED BY/.test(held.message), 'and what would have to exist first');

    // authority is not addressable, permanently
    for (const kind of ['credential', 'session', 'agent']) {
      const out = await page.evaluate((k) => window.payloadEarth.api.runCommand(`notation://${k}/x/y`), kind);
      r.ok(
        !out.ok && /FORBIDDEN/.test(out.message),
        `notation://${kind} is refused by design, not by omission`
      );
    }

    // an address must never be shadowed by a fuzzy search on its text
    const shadow = await page.evaluate(() => window.payloadEarth.api.runCommand('notation://nonsense/x'));
    r.ok(
      !shadow.ok && /KIND_UNKNOWN/.test(shadow.message),
      'an unknown kind refuses as an address — the address rule runs before any fuzzy match'
    );

    // the instrument, and the measurement on it
    await page.evaluate(() => window.payloadEarth.api.runCommand('notation'));
    await page.waitForTimeout(1500);
    const panel = await page.evaluate(() => {
      const el = document.querySelector('.pe-nota');
      return {
        open: !!el && !el.hidden,
        text: el?.innerText ?? '',
        kinds: el?.querySelectorAll('.pe-nota-kind').length ?? 0,
        shapes: el?.querySelectorAll('.pe-nota-shaperow').length ?? 0,
        forbidden: el?.querySelectorAll('.pe-nota-pill.forbidden').length ?? 0,
      };
    });
    r.ok(panel.open, 'the identity-space instrument opens');
    r.ok(panel.kinds >= 10, `every kind is listed with its holder (${panel.kinds})`);
    r.ok(panel.shapes >= 1, `the id shapes actually minted are counted, not asserted (${panel.shapes})`);
    r.ok(panel.forbidden >= 3, `the permanently-absent kinds are shown, not omitted (${panel.forbidden})`);
    r.ok(
      /one canonical identity space/i.test(panel.text),
      'the invariant the measurement is measuring against is stated on the surface'
    );
    await page.close();
  }

  // ---- 4. the provenance vocabulary, and what adopting it costs ------
  {
    const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
    await page.goto(`${VITE}/?api=${encodeURIComponent(API)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.payloadEarth, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.payloadEarth.api.runCommand('provenance'));
    await page.waitForTimeout(1800);

    const v = await page.evaluate(() => {
      const el = document.querySelector('.pe-voc');
      return {
        open: !!el && !el.hidden,
        text: el?.innerText ?? '',
        axes: el?.querySelectorAll('.pe-voc-axis').length ?? 0,
        impactRows: el?.querySelectorAll('.pe-voc-row').length ?? 0,
        absent: el?.querySelectorAll('.pe-corpus-absent').length ?? 0,
        orthogonal: el?.querySelectorAll('.pe-voc-rel.orthogonal').length ?? 0,
        unmapped: el?.querySelectorAll('.pe-voc-rel.unmapped').length ?? 0,
        mapRows: el?.querySelectorAll('.pe-voc-map').length ?? 0,
      };
    });

    r.ok(v.open, 'the provenance vocabulary surface opens');
    r.ok(/PROPOSED/.test(v.text), 'the alignment is labelled PROPOSED on the surface itself');
    r.ok(
      /nothing here is applied/i.test(v.text),
      'the surface states that no record is relabelled — a proposal that looked adopted would be the silent relabelling this exists to stop'
    );
    r.ok(/DECISION OWNED BY SUBSTRATE/i.test(v.text), 'the decision is attributed to the substrate, not taken here');
    r.ok(v.axes === 3, `the three axes are separated (${v.axes})`);
    r.ok(v.mapRows >= 15, `the full mapping is shown, term by term (${v.mapRows})`);
    r.ok(v.orthogonal >= 1, 'a term that must not be merged is flagged ORTHOGONAL');
    r.ok(v.unmapped >= 1, 'a term with no counterpart is flagged UNMAPPED rather than force-fitted');
    // either a real impact table or an honest absence — never zeroes
    r.ok(
      v.impactRows >= 1 || v.absent >= 1,
      'the impact is either counted or stated ABSENT, never rendered as a table of zeroes'
    );
    if (v.impactRows >= 1) {
      r.ok(/RENAME CLEANLY/.test(v.text) && /NEED A DECISION/.test(v.text), 'the cost is stated as figures a decision can use');
      r.ok(/representative/.test(v.text), 'the fifth kind found by counting the corpus appears in the impact');
    } else {
      r.ok(/does not label value provenance/i.test(v.text), 'an unlabelled corpus says so, with its reason');
    }
    await page.close();
  }

  return r.done();
}
