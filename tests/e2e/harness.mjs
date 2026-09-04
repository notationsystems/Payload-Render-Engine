/**
 * E2E harness — one browser, sequential specs, accumulated failures.
 *
 * Preconditions are checked with remedies, and capability-dependent
 * specs SKIP WITH A STATED REASON rather than silently passing: an
 * absent Terminal is a fact the run reports, never a green light it
 * invents. The ops mirror is the exception that proves the design —
 * it asserts EITHER the healthy desk OR the refusal-first card,
 * because both are valid honest states of the OS.
 *
 *   npm run e2e            (stack: vite :5173 + spatial API :8788;
 *                           Terminal :3000 enables the upstream specs)
 */

import { chromium } from 'playwright';

export const VITE = process.env.E2E_VITE ?? 'http://localhost:5173';
export const API = process.env.E2E_API ?? 'http://127.0.0.1:8788';

/**
 * How long to wait on a panel whose content arrives through a bounded
 * client fetch.
 *
 * The client is allowed DEFAULT_TIMEOUT_MS (10s, SEC-153) before it
 * gives up and states a refusal. A spec that waits LESS than that is
 * not testing the system - it is testing the machine's speed, and it
 * can fail while the panel is still inside its own budget. Worse, it
 * can never observe the system's actual failure mode, which is the
 * stated refusal the client produces at 10s.
 *
 * 70-refusals waited 8000ms and crashed the suite under load while
 * /api/refusals was answering in 11ms. The wait must outlast the
 * client, so that a timeout here means the panel genuinely never
 * rendered.
 */
export const CLIENT_FETCH_BUDGET_MS = 10_000;
export const FETCH_BACKED_MS = CLIENT_FETCH_BUDGET_MS + 5_000;

const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium';

export async function reachable(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch {
    return false;
  }
}

export function makeRecorder(specName) {
  const failures = [];
  let checks = 0;
  return {
    ok(cond, label) {
      checks++;
      if (!cond) failures.push(label);
      console.log(`    ${cond ? 'ok ' : 'FAIL'} ${label}`);
    },
    async skip(reason) {
      console.log(`    SKIP ${reason}`);
    },
    done() {
      return { spec: specName, checks, failures };
    },
  };
}

export async function launchBrowser() {
  return chromium.launch({
    executablePath: CHROMIUM,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'],
  });
}

/** A booted app page against the spatial API. Caller closes it. */
export async function bootedPage(browser, { api = API, extraQuery = '' } = {}) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`${VITE}/?api=${encodeURIComponent(api)}${extraQuery}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => !!window.payloadEarth, null, { timeout: 30000 });
  await page.waitForTimeout(2200); // boot settle: corpus hydrate + first frame
  return { page, pageErrors };
}
