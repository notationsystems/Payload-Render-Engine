/**
 * Entry point: boot the twin, mount the instrument HUD, expose the
 * structured tool surface for future agent bindings.
 */

import './ui/theme.css';
import './ui/inspect.css';
import './ui/os.css';
import { App } from './app/app';
import type { AppApi } from './app/api';
import { buildToolSurface } from './app/toolSurface';
import { createCommandBar } from './ui/commandBar';
import { createLayerPanel } from './ui/layerPanel';
import { createStatusBar } from './ui/statusBar';
import { createToasts } from './ui/toasts';
import { createInfoPanel } from './ui/infoPanel';
import { createTimeline } from './ui/timeline';
import { createAnalyticsDock } from './ui/analyticsDock';
import { createAgentsPanel } from './ui/agentsPanel';
import { createScenariosPanel } from './ui/scenariosPanel';
import { createOpsPanel } from './ui/opsPanel';
import { createTooltip } from './ui/tooltip';
import { createLegend } from './ui/legend';
import { createCommoditiesPanel } from './ui/commoditiesPanel';
import { createArchOverlay } from './ui/archOverlay';
import { createScenarioBanner } from './ui/scenarioBanner';
import { createTrackCard } from './ui/trackCard';
import { createMarketsPanel } from './ui/marketsPanel';
import { createAlertsRail } from './ui/alertsRail';
import { createSitrep } from './ui/sitrep';
import { createReticle } from './ui/reticle';
import { createPinsPanel } from './ui/pinsPanel';
import { createQueryCard } from './ui/queryCard';
import { createPatternsPanel } from './ui/patternsPanel';
import { createInjectionCard } from './ui/injectionCard';
import { createWarrantPanel } from './ui/warrantPanel';
import { createWatchesPanel } from './ui/watchesPanel';
import { loadWorkspace, saveWorkspace } from './core/workspace';
import { recordEvent } from './core/journal';
import { createSystemPanel } from './ui/systemPanel';
import { createSensorStyles } from './ui/sensorStyles';
import { createDetectionOverlay } from './ui/detectionOverlay';

/**
 * Mount an overlay instrument the first time it is asked for.
 *
 * These panels are opened by command and none of them is needed to
 * render the Earth, so loading them at boot spends startup on surfaces
 * most sessions never open.
 *
 * The operator must never press a command and see nothing. A dynamic
 * import takes a beat — a chunk fetch in production, a module transform
 * in dev — and an empty screen during it reads as "the command did not
 * work", which is the one impression an operator surface cannot afford.
 * So a placeholder wearing the panel's own class is appended
 * IMMEDIATELY, and swapped for the real panel when it lands. That also
 * keeps the DOM contract other code relies on: the element with that
 * class exists from the moment it was asked for, not from whenever the
 * network settled.
 *
 * Esc during the wait cancels: the placeholder goes and the panel is not
 * opened behind the operator's back when it finally arrives.
 *
 * A failed load is stated rather than swallowed — the operator pressed a
 * key and is owed an answer either way — and the mount is released so a
 * retry is possible.
 */
function lazyPanel(
  hud: HTMLElement,
  api: AppApi,
  event: string,
  panelClass: string,
  load: () => Promise<{ el: HTMLElement }>
): void {
  let mounted = false;
  const name = event.replace('pe:', '').replace('-toggle', '').toUpperCase();

  window.addEventListener(event as keyof WindowEventMap, () => {
    if (mounted) return; // the real panel owns this event now
    mounted = true;

    let cancelled = false;
    const placeholder = document.createElement('div');
    placeholder.className = `pe-corpus ${panelClass} pe-lazy`;
    placeholder.innerHTML =
      '<div class="pe-patterns-head"><span class="pe-patterns-title"></span></div>' +
      '<div class="pe-corpus-body"><div class="pe-patterns-lineage"></div></div>';
    const title = placeholder.querySelector('.pe-patterns-title');
    const line = placeholder.querySelector('.pe-patterns-lineage');
    if (title) title.textContent = name;
    if (line) line.textContent = 'OPENING…';
    hud.appendChild(placeholder);

    const onEsc = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      cancelled = true;
      placeholder.remove();
      mounted = false;
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onEsc);
    const done = (): void => {
      window.removeEventListener('keydown', onEsc);
      placeholder.remove();
    };

    void load()
      .then(({ el }) => {
        done();
        if (cancelled) return; // the operator changed their mind mid-load
        hud.appendChild(el);
        window.dispatchEvent(new CustomEvent(event));
      })
      .catch((err) => {
        done();
        mounted = false;
        api.events.emit('toast', {
          title: `INSTRUMENT UNAVAILABLE — ${name}`,
          body: `the surface failed to load: ${err instanceof Error ? err.message : String(err)}. The command is still valid — try again, or check that the bundle is complete.`,
          tone: 'alert',
        });
      });
  });
}

async function start(): Promise<void> {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const hud = document.getElementById('hud') as HTMLElement;

  const app = new App();
  try {
    await app.boot(canvas, hud);
  } catch (err) {
    const status = document.getElementById('boot-status');
    if (status) status.textContent = `BOOT FAILED — ${String(err)}`;
    throw err;
  }

  // structured tool surface first — the agents panel renders it
  const tools = buildToolSurface(app);

  // instrument layer
  hud.appendChild(createCommandBar(app).el);
  hud.appendChild(createLayerPanel(app).el);
  hud.appendChild(createStatusBar(app).el);
  hud.appendChild(createToasts(app).el);
  hud.appendChild(createInfoPanel(app).el);
  hud.appendChild(createTimeline(app).el);
  hud.appendChild(createAnalyticsDock(app).el);
  hud.appendChild(createAgentsPanel(app, tools).el);
  hud.appendChild(createScenariosPanel(app).el);
  hud.appendChild(createOpsPanel(app).el);
  hud.appendChild(createTooltip(app).el);
  hud.appendChild(createLegend(app).el);
  hud.appendChild(createCommoditiesPanel(app).el);
  hud.appendChild(createArchOverlay(app).el);
  hud.appendChild(createScenarioBanner(app).el);
  hud.appendChild(createTrackCard(app).el);
  hud.appendChild(createMarketsPanel(app).el);
  hud.appendChild(createAlertsRail(app).el);
  hud.appendChild(createSitrep(app).el);
  hud.appendChild(createReticle(app).el);
  hud.appendChild(createPinsPanel(app).el);
  hud.appendChild(createQueryCard(app).el);
  hud.appendChild(createPatternsPanel(app).el);
  lazyPanel(hud, app, 'pe:corpus-toggle', '', async () => (await import('./ui/corpusPanel')).createCorpusPanel(app));
  lazyPanel(hud, app, 'pe:compiler-toggle', 'pe-compiler', async () => (await import('./ui/compilerPanel')).createCompilerPanel(app));
  hud.appendChild(createInjectionCard(app).el);
  lazyPanel(hud, app, 'pe:refusals-toggle', 'pe-refusals', async () => (await import('./ui/refusalsPanel')).createRefusalsPanel(app));
  lazyPanel(hud, app, 'pe:security-toggle', 'pe-security', async () => (await import('./ui/securityPanel')).createSecurityPanel(app));
  lazyPanel(hud, app, 'pe:ecosystem-toggle', 'pe-eco', async () => (await import('./ui/ecosystemPanel')).createEcosystemPanel(app));
  lazyPanel(hud, app, 'pe:notation-toggle', 'pe-nota', async () => (await import('./ui/notationPanel')).createNotationPanel(app));
  lazyPanel(hud, app, 'pe:vocabulary-toggle', 'pe-voc', async () => (await import('./ui/vocabularyPanel')).createVocabularyPanel(app));
  hud.appendChild(createWarrantPanel(app).el);
  lazyPanel(hud, app, 'pe:vocab-toggle', 'pe-vocab', async () => (await import('./ui/vocabPanel')).createVocabPanel(app));
  hud.appendChild(createWatchesPanel(app).el);
  hud.appendChild(createSystemPanel(app).el);
  hud.appendChild(createDetectionOverlay(app).el);
  hud.appendChild(createSensorStyles(app).el);

  // ---- workspace: the OS remembers how you left it (view-level only)
  const PRESETS = new Set([
    'world', 'freight', 'trade', 'commodities', 'network', 'intelligence',
    'agents', 'scenarios', 'operations', 'markets',
  ]);
  const ws = loadWorkspace();
  if (typeof ws.preset === 'string' && PRESETS.has(ws.preset) && ws.preset !== 'world') {
    app.setPreset(ws.preset as Parameters<typeof app.setPreset>[0]);
  }
  if (ws.sensorMode !== undefined && ws.sensorMode >= 0 && ws.sensorMode <= 4) {
    app.setSensorMode(ws.sensorMode);
  }
  if (ws.flowMode) app.setFlowMode(true);
  app.events.on('preset', ({ preset }) => saveWorkspace({ preset }));
  app.events.on('sensor', ({ mode }) => saveWorkspace({ sensorMode: mode }));
  app.events.on('flowMode', ({ enabled }) => saveWorkspace({ flowMode: enabled }));

  // '?' opens the vocabulary overlay — never while typing
  window.addEventListener('keydown', (e) => {
    if (e.key !== '?') return;
    const ae = document.activeElement as HTMLElement | null;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('pe:vocab-toggle'));
  });

  // escape: exit demo, else clear selection — but never while typing
  // (the search box owns Escape for its own dropdown/blur)
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const ae = document.activeElement as HTMLElement | null;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    // the architecture overlay owns Escape while it is open
    if (document.querySelector('.os-arch:not([hidden])')) return;
    // so do the pattern registry and the corpus definition overlay
    // (their own handlers close them)
    if (document.querySelector('.pe-patterns:not([hidden])')) return;
    if (document.querySelector('.pe-corpus:not([hidden])')) return;
    if (app.isDemoActive()) app.stopFollowTheLoad();
    else if (app.isLiveTracking()) app.releaseLiveTrack();
    else if (app.isInjectionActive()) app.clearInjection();
    else if (app.isPatternActive()) app.clearMinedPattern();
    else if (app.isQueryActive()) app.clearQuery();
    else if (
      app.getPreset() === 'agents' ||
      app.getPreset() === 'scenarios' ||
      app.getPreset() === 'markets' ||
      app.getPreset() === 'operations'
    ) {
      app.setPreset(app.getLastLayerPreset());
    } else {
      app.select(null);
      app.selectCountry(null);
    }
  });

  // structured tool surface (GeoAgent pattern): the same operations the
  // command bar uses, exposed for a future agent/MCP binding.
  (window as unknown as Record<string, unknown>).payloadEarth = {
    api: app,
    tools,
    invokeTool: (name: string, args: Record<string, unknown> = {}) => {
      const tool = tools.find((t) => t.name === name);
      if (!tool) throw new Error(`unknown tool: ${name}`);
      // an agent's request lands in the session journal with its
      // source — and, like every entry, with what it dispatched: nothing
      recordEvent('agent', `tool:${name}`, JSON.stringify(args).slice(0, 160));
      return tool.invoke(args);
    },
  };

  const sourceLabel =
    app.getDataSourceId() === 'payload-spatial-api'
      ? 'SOURCE · PAYLOAD SPATIAL API'
      : 'SOURCE · IN-BROWSER CORPUS';
  app.events.emit('toast', {
    title: 'PAYLOAD OS ONLINE',
    body: `${sourceLabel} · ${app.store.snapshot.meta.label} · ${app.store.snapshot.meta.disclaimer}`,
    tone: 'info',
  });
  if (app.sourceFallbackNote) {
    app.events.emit('toast', {
      title: 'SPATIAL API UNREACHABLE',
      body: `${app.sourceFallbackNote} — running on the in-browser corpus instead.`,
      tone: 'warn',
    });
  }
}

void start();
