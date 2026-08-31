/**
 * AGENTS view — the twin's structured tool surface made visible.
 * Everything listed is real: the same registry the command bar shares,
 * exposed at runtime as window.payloadEarth.invokeTool for agent and
 * MCP bindings (GeoAgent pattern). Nothing here is a mock feature.
 */

import type { AppApi } from '../app/api';
import type { TwinTool } from '../app/toolSurface';

export function createAgentsPanel(api: AppApi, tools: TwinTool[]): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'os-panel';
  el.hidden = true;

  const header = document.createElement('div');
  header.className = 'os-panel-head';
  header.innerHTML = `
    <div>
      <div class="os-panel-kicker">AI &amp; AGENTS</div>
      <div class="os-panel-title">Agent tool surface</div>
    </div>`;
  const close = document.createElement('button');
  close.className = 'os-panel-close';
  close.type = 'button';
  close.textContent = '×';
  close.addEventListener('click', () => api.setPreset(api.getLastLayerPreset()));
  header.appendChild(close);

  const intro = document.createElement('div');
  intro.className = 'os-panel-intro';
  intro.innerHTML =
    'One structured registry of view operations over the twin — the command bar consumes it, ' +
    'and an agent binds to it the way GeoAgent binds to a live map: ' +
    '<code>window.payloadEarth.invokeTool(name, args)</code>. ' +
    'Every operation is a projection query or camera/layer verb; the twin is a mirror, so nothing ' +
    'here mutates canonical state and nothing needs a confirmation gate yet — the safety flags ' +
    'exist so gated operations can be added without changing the shape.';

  const list = document.createElement('div');
  list.className = 'os-tool-list';
  for (const tool of tools) {
    const row = document.createElement('div');
    row.className = 'os-tool';
    const params = tool.params.length
      ? tool.params.map((p) => `${p.name}: ${p.type}${p.required ? '' : '?'}`).join(', ')
      : '—';
    row.innerHTML = `
      <div class="os-tool-head">
        <span class="os-tool-name">${tool.name}</span>
        <span class="os-tool-cat">${tool.category.toUpperCase()}</span>
        ${tool.safety.longRunning ? '<span class="os-tool-flag">LONG-RUNNING</span>' : ''}
      </div>
      <div class="os-tool-desc">${tool.description}</div>
      <div class="os-tool-params">${params}</div>`;
    list.appendChild(row);
  }

  const foot = document.createElement('div');
  foot.className = 'os-panel-foot';
  foot.textContent =
    'FUTURE BINDINGS · Payload agents · MCP server · voice — all consume this registry; capabilities stay defined once.';

  el.append(header, intro, list, foot);

  api.events.on('preset', ({ preset }) => {
    el.hidden = preset !== 'agents';
  });

  return { el };
}
