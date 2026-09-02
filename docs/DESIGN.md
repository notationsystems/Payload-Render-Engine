# PayLoad OS — Design Language

The design-system record of the twin's front-of-house: what the
instrument looks like, how it behaves, and — above everything — how
**epistemic state is encoded visually**. The renderer is a projection of
provider state; the design language is how that projection stays honest
at a glance. Codex owns the systems underneath; this document is the
contract for anyone drawing pixels on top of them.

---

## 1. Stance

- **An instrument, not a dashboard.** Quiet glass panels over a dark
  globe; mono type for readings, prose type for names; restraint in
  motion. The operator reads it like avionics.
- **Plain identity.** The wordmark is the words `PayLoad OS` — no
  glyph, no gradient, no ornament.
- **Honesty is the aesthetic.** Every treatment below encodes where a
  number came from. A viewer who knows the vocabulary can audit a
  screenshot.

## 2. The semantic vocabulary

These treatments carry meaning everywhere they appear. Never reuse one
for decoration.

| Treatment | Meaning | Examples |
|---|---|---|
| **SOLID** fill / dot | OBSERVED — an event or reading that happened | Gantt dispatch dots, ADS-B darts, state dots |
| **HOLLOW** (border, faint fill) | DECLARED — a promise or window, not yet an observation | Gantt pickup/delivery windows |
| **DASHED violet** `#d98cff` | HYPOTHETICAL — computed counterfactual, never real-state | Scenario rings/arcs, banner border |
| **DASHED white** `#e8f1fb` | DECLARED LANE, MOVEMENT UNOBSERVED | Operations lane before tracking exists |
| **DIMMED** | OUT OF FOCUS — emphasis only, nothing hidden | Route brush, commodity focus, intelligence preset |
| **GREY** `#6b7688` | STATE UNOBSERVED — absence is not zero | Node/route state, `UNOBSERVED` chips |
| **ABSENT** + stated reason | REFUSED / UNAVAILABLE — the surface says why | Market pulse hides when the feed is down; refusal cards |
| **BEAM** (red/amber pillar + pad) | ALERT-FLAGGED asset — a marker of an alert that exists elsewhere with its basis | Attention beams |
| **MINED gold** `#d9c26a` | MINED CANDIDATE — a structure a named algorithm computed over declared fields; not an observed fact, never promoted without validation | Pattern registry frame, active-pattern card, MINED kicker |

Companion rules:

- **COMPUTED labels.** Any figure the client derives (Δ%, annualized
  basis, funding APR, proximity distance, FX restatement) carries the
  word COMPUTED in text — style alone is not enough — with its inputs
  or instants named.
- **Refusal-first.** An unconfigured or failed surface renders the
  typed refusal WITH ITS REMEDY (`.ops-refusal` idiom). There is no
  state in which a desk silently shows emptiness it cannot vouch for.
- **Stated criteria.** A surface that filters or caps says so on the
  surface (correlation radii on the alerts rail, `SHOWING 160 OF 341`
  on the detection overlay, top-OI cap on the options list) — an empty
  result reads "nothing within stated criteria", never "nothing
  happened".
- **The epistemic ladder is worn, not implied.** `Observation ≠
  DerivedMetric ≠ MinedPattern ≠ Hypothesis` — each rung has its own
  treatment (solid · COMPUTED label · mined gold · dashed violet), and
  a surface never borrows a higher rung's styling for a lower rung's
  content. Every mined candidate names its algorithm@version, mining
  run, corpus build, and supporting-record count in text.
- **Basis lines.** Every desk/panel leads with its source and
  disclaimer (an ECB fix is "informational, not a tradeable quote"; a
  venue mark is "the venue's model"; ops is "journal projection").

## 3. Color

Ground: near-black blue (`#020409` clear color) with glass panels
(`--glass`, `--glass-soft`) and hairlines (`--line`, `--line-strong`).
Text ramp: `--text-hi` / `--text-mid` / `--text-dim`.

**Transport modes** (routes, decoded in legend):
road amber · rail violet · maritime teal · air blue · pipeline
`#d08770` · multimodal `#9aa7c7` · unspecified `#6b7688`.

**Node categories:** logistics blue · extraction amber · processing
magenta/violet · industry green · chokepoint gold.

**State:** ok green `--ok` · degraded amber `--warn` · disrupted red
`--alert` · unobserved grey `#6b7688`.

**Live feeds:** stations `#ffd9a0` · GPS `#7fb8ff` · GLONASS `#b48cff`
· Galileo `#38d6c8` · aircraft `#bfe0ff` (below 10k ft `#9aa7c7`) ·
quakes by magnitude (alert/warn/`#c9a86a`).

**Desk accents (markets):** FX `#4da6ff` · crypto `#ffb454` ·
derivatives `#b48cff` · broker teal. Direction coloring uses state
green/red and never doubles as a category hue.

**Reserved:** violet `#d98cff` belongs to the hypothetical frame only.
White dashed belongs to untracked operational lanes only.

## 4. Typography

- **IBM Plex Mono** — the instrument voice: kickers, readouts,
  evidence lines, chips, numbers (`font-variant-numeric: tabular-nums`
  wherever digits align).
- **Inter** — the prose voice: entity names, descriptions, remedies.
- Uppercase mono always carries letter-spacing (0.06–0.22em by size);
  numbers never letter-spaced.

## 5. Layout and z-bands

One system; every fixed surface declares its band:

```
3D labels 5 · reticle 9 · detection overlay 10 · docks/legend/rails/
pins/sensor 12–15 · inspector/statusbar/panels 20 · timeline 21 ·
track card 22 · scenario banner 25 · command bar 30 ·
overlays (SITREP, arch, toasts, suggest) 40 · tooltip 60
```

Regions: command bar + tabs top-center · layer rail left · analytics
dock left-bottom (240px in) · pins column top-left (240px in) · alerts
rail top-right (240px in) · legend bottom-right · status bar
bottom-left · sensor chips above it · timeline bottom-center · track
card above timeline · toasts right. Reference surfaces (legend, alerts
rail) TUCK when the inspector or a panel takes their space; work
surfaces do not.

## 6. Interaction grammar

Pointer: **drag** rotate · **wheel** zoom (altitude drives disclosure)
· **click** select (corpus first; live contacts outrank the country
pick; any other click releases a live track) · **shift-click** pin A/B
compare (selection untouched) · **double-click** focus · **hold B**
route brush · **hover** identifies before the click (corpus state or
live basis chip).

Keys: **Esc** ladder (arch overlay → demo → live track → panel →
selection) · **D** detection overlay · **1–5** sensor styles ·
**Space** play/pause · **/** search.

Command bar verbs: `find/show/hide/flows/play/speed/compare/what if/
rank/brief/follow the load` + preset names. `help` prints the grammar.

## 7. Surface inventory (one honesty rule each)

| Surface | Rule |
|---|---|
| Command bar + tabs | regime chip states historical/current/forecast; BRIEF/OS chips open overlays |
| Layer rail | toggles visibility only — never filters data |
| Analytics dock | observed-only means; UNOBSERVED stated in the KPI itself |
| Alerts rail | correlation radii printed; feed-off stated; COMPUTED PROXIMITY claims nearness, never impact |
| Legend | every color on the globe decoded, including reserved treatments and beams |
| Status bar | disclaimer chip states the LOADED corpus; market pulse absent (never zero) when the feed is down |
| Timeline | evidence-density strip; future region striped; regime never inferred |
| Inspector | per-record provenance (source, knownAt, valueKind, admissible); MEAN OBSERVED naming |
| Tooltip | identifies before the click; live contacts show basis; clears when a panel opens beneath it |
| Pins (A/B) | deltas computed from corpus state at sim time; one unobserved side = stated refusal to subtract |
| Track card + reticle | OBSERVED fix age + dead-reckoned statement, or COMPUTED SGP4 + TLE age; reticle rides the rendered buffer |
| Detection overlay | basis split in the header; display caps stated |
| Sensor styles | restyle the FEED only; instruments untouched; "same data" stated in the toast |
| OPERATIONS panel | read-only journal mirror; exception-first; Gantt hollow-vs-solid; policy stated, not implied |
| COMMODITIES panel | per-record evidence on every series; granularity split by field; FX lens computed with both dates; no invented metals quote |
| MARKETS panel | desk basis lines; venue ≠ market; fix ≠ quote; broker fail-closed + read-only posture card |
| SCENARIOS panel | counterfactuals in reserved violet under a persistent banner; ranking is computed intelligence |
| SITREP | composes loaded surfaces only; refusing desks appear as refusals; text export keeps labels |
| Arch overlay | the renderer names itself projection-only |

## 8. Motion discipline

Animation only where it carries meaning: state pulse on selected rings,
M5.5+ recent quake pulse, beam breathing, reticle arcs, flow particles,
scenario dash drift. Everything else is still. All of it collapses
under `prefers-reduced-motion`.

## 9. Encoding rules

- Bars are linear with the domain stated in the footer (`min–max ·
  n=…`); ranked bars normalize to the visible peak and say so.
- Sparklines state their time range and observation count.
- Quake radius encodes magnitude, opacity encodes report age — both
  decoded in the legend.
- No composite scores anywhere. Ranked lists rank by one named metric.

## 10. Checklist for a new surface

1. What is the **basis** of every number, and where does the surface
   say it?
2. What does it render when the source **refuses** or is missing —
   and does that state carry the remedy?
3. Are all **derived** figures labeled COMPUTED with inputs named?
4. Does absence render as **stated absence**, never zero?
5. Which **z-band** does it declare, and does it tuck or hold when the
   inspector/panels open?
6. Does it use only palette colors — and none of the **reserved**
   treatments — for decoration?
7. Does its motion collapse under reduced-motion?
