/**
 * Scenario banner — the standing chrome of a HYPOTHETICAL frame.
 *
 * While a counterfactual is active, this banner sits directly under
 * the command-bar tab strip and never leaves the screen: violet,
 * dashed, striped — deliberately unconfusable with the solid look of
 * observed state. A simulated outcome is not an outcome, and the
 * banner says so in as many words for as long as the frame is open.
 */

import type { AppApi } from '../app/api';
import type { ScenarioImpact } from '../data/scenario';
import './scenario.css';

export function createScenarioBanner(api: AppApi): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'sc-banner sc-hidden-guard';
  el.hidden = true;

  const chip = document.createElement('span');
  chip.className = 'sc-chip';
  chip.textContent = 'HYPOTHETICAL FRAME';

  const name = document.createElement('span');
  name.className = 'sc-banner-name';

  const standing = document.createElement('span');
  standing.className = 'sc-banner-standing';
  standing.textContent = 'simulated outcome — not an outcome';

  const summary = document.createElement('span');
  summary.className = 'sc-banner-summary';

  const exit = document.createElement('button');
  exit.className = 'sc-exit';
  exit.type = 'button';
  exit.textContent = 'EXIT FRAME';
  exit.addEventListener('click', () => api.clearScenario());

  el.append(chip, name, standing, summary, exit);

  const render = (impact: ScenarioImpact | null): void => {
    if (!impact) {
      el.hidden = true;
      return;
    }
    const s = impact.summary;
    name.textContent = impact.spec.name;
    name.title = impact.spec.description;
    summary.textContent =
      `${s.perturbedRoutes} BLOCKED · ${s.flowsDelayed} FLOWS QUEUED · +${s.totalDelayHours} H`;
    el.hidden = false;
  };

  api.events.on('scenario', ({ active, impact }) => {
    render(active && impact ? impact : null);
  });
  render(api.getActiveScenario());

  return { el };
}
