/**
 * Synthetic corpus loader — the in-repo demo world, served by the
 * Spatial API exactly as the client ships it.
 *
 * A corpus loader is the server's source seam. It returns:
 *
 *   {
 *     kind,          // which loader produced this corpus
 *     snapshot,      // a WorldSnapshot
 *     scenarios,     // ScenarioSpec[] — [] when the corpus cannot
 *                    //   support counterfactuals honestly
 *     readStateAt,   // (id, t) => { reading: 'known'|'unobserved'|'no_history', state? }
 *     metaDefaults,  // the admissibility posture of THIS corpus:
 *                    //   sourceClass, valueKind, admissible, admissibleBasis
 *   }
 *
 * The synthetic corpus answers every state read 'known' because its
 * dynamics are deterministic functions — there is nothing unobserved
 * in a world that is computed. That is exactly why it is inadmissible:
 * valueKind 'representative', admissible false, basis stated.
 */

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const load = (p) => import(pathToFileURL(resolve(ROOT, p)).href);

export async function loadSyntheticCorpus() {
  // the SAME semantic layer the client ships — one corpus, no drift
  const world = await load('src/data/synthetic/world.ts');
  const providerMod = await load('src/data/synthetic/provider.ts');
  const scenarioMod = await load('src/data/scenario.ts');

  const snapshot = world.buildWorldSnapshot();
  const resolver = providerMod.createStateResolver(snapshot);

  return {
    kind: 'synthetic',
    snapshot,
    scenarios: scenarioMod.buildScenarioCatalog(snapshot),
    scenarioEngine: {
      rank: (stateAt, scenarios, t) =>
        scenarioMod.rankScenarioImpacts(snapshot, stateAt, scenarios, t),
      impact: (stateAt, spec, t) =>
        scenarioMod.computeScenarioImpact(snapshot, stateAt, spec, t),
    },
    readStateAt: (id, t) => ({ reading: 'known', state: resolver(id, t) }),
    metaDefaults: {
      sourceClass: 'synthetic:demo',
      // the Terminal's admissibility switch: representative fixture data
      // is categorically inadmissible, and the BASIS is stated, not implied
      valueKind: 'representative',
      admissible: false,
      admissibleBasis: 'rests_on_representative',
      vintages: 1, // single-vintage: as_known_then === best_known, honestly
    },
    // one vintage means the two modes genuinely coincide — both are honest
    knowledgeModes: ['best_known', 'as_known_then'],
  };
}
