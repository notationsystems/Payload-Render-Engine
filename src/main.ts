/**
 * Entry point: boot the twin, mount the instrument HUD, expose the
 * structured tool surface for future agent bindings.
 */

import './ui/theme.css';
import './ui/inspect.css';
import './ui/os.css';
import { App } from './app/app';
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
import { createSensorStyles } from './ui/sensorStyles';
import { createDetectionOverlay } from './ui/detectionOverlay';

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
  hud.appendChild(createDetectionOverlay(app).el);
  hud.appendChild(createSensorStyles(app).el);

  // escape: exit demo, else clear selection — but never while typing
  // (the search box owns Escape for its own dropdown/blur)
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const ae = document.activeElement as HTMLElement | null;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    // the architecture overlay owns Escape while it is open
    if (document.querySelector('.os-arch:not([hidden])')) return;
    if (app.isDemoActive()) app.stopFollowTheLoad();
    else if (app.isLiveTracking()) app.releaseLiveTrack();
    else if (
      app.getPreset() === 'agents' ||
      app.getPreset() === 'scenarios' ||
      app.getPreset() === 'markets'
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
