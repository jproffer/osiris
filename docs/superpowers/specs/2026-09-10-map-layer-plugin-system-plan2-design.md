# OSIRIS Map Layer Plugin System — Plan 2 Design

**Date:** 2026-09-10
**Status:** Approved design, ready for implementation planning
**Scope:** Architectural — migrates every map layer onto the manifest engine and deletes the hand-written layer code
**Predecessor:** `docs/superpowers/specs/2026-09-09-map-layer-plugin-system-design.md` (the engine design, implemented as Plan 1)

---

## 1. What this plan is, and how it departs from the approved staging

Plan 1 built the engine: manifest types, validation, the popup builder, the credential store,
the registry, the pure load planner, the two API routes, and `LayerEngine` with its `FakeMap`
test double. All of it is merged on `feat/layer-plugin-system` and unit-tested. **None of it is
wired into the running UI, and no manifest has been authored.**

The Plan 1 spec proposed reaching production in three further stages: stage 2 a six-layer proof
set with both systems coexisting, stages 3–4 the bulk migration, stage 5 deletion. It reserved
stages 3–5 for a separate Plan 3.

**This plan absorbs stages 2 through 5.** Every layer migrates and all hand-written layer code
is deleted, in one plan.

### The scope decision, recorded

This is a deliberate departure from the approved staging, made by the project owner after the
alternatives were laid out. The narrower option — six proof layers, nothing deleted — was
recommended and declined. The argument for the narrower path was that a mistaken assumption
about a *mechanism* gets replicated across every layer before anyone notices, and that a pilot
exists to find such mistakes while they are cheap to correct.

That risk is real and is not removed by the decision; it is **managed by batch ordering and by
the verification regime in §8**. Recording it here means that if a mechanism does prove wrong
mid-migration, the response is a known one — stop, fix the mechanism, re-run the affected
batches — rather than a surprise.

### Decisions taken in this plan

| # | Decision | Made in |
|---|---|---|
| P1 | Full scope: all layers migrate, all old layer code is deleted | §1 |
| P2 | Popup fixtures for **every** layer, plus a manual checklist per batch | §8 |
| P3 | **Every** credential-touching layer declares `requiredConfig`, not only hard-gated ones | §5.4 |
| P4 | Diagnostics panel shows registry state, per-layer runtime state, **and** a request log | §6 |
| P5 | Popups adopt one uniform design; `PopupSpec` is extended to carry the content and a closed set of presentational hints; adapters stay reserved for `flights` and `satellites` | §4 |
| P6 | Batch deploys (~7), no staging instance, no runtime engine flag | §1.3 |
| P7 | Minimal schema growth for exotics: a tile-source pass-through, plus named code modules | §7 |
| P8 | Group-ordered vertical slices, deleting each layer's old code in the commit that migrates it | §1.2 |

### 1.1 Operating context

OSIRIS runs as a **single-user personal instance** at `osiris.profferlabs.com`, reachable only
through local DNS. There is no public traffic, no SLA and no second stakeholder. `deploy.sh`
still references a `osirisai.live` production host; that reference is stale and is not the
deployment this plan targets.

This calibrates the engineering, and it is stated because the obvious reading of "migrating 29
layers on a deployed instance" would call for machinery this situation does not warrant.
Downtime during a rebuild is a non-issue. A layer broken for a few minutes between batches is a
non-issue. **A staging container and a runtime engine flag were both considered and rejected as
ceremony.** The rigor lives in the fixture tests and the per-batch checklist instead.

### 1.2 The eight batches

Batches follow `LayerPanel` groups, so each batch's manual checklist is "open this panel group
and click everything". Batch 0 is unavoidable: nothing can migrate until the engine is mounted
and the panel can render a manifest row.

| # | Batch | Layers |
|---|---|---|
| 0 | **Host wiring** | none — engine mounted, panel reads manifests, diagnostics live, both systems coexisting |
| 1 | **Hazards** | `earthquakes`, `fires`, `weather`, `radiation` ⟵ revived |
| 2 | **Threats** | `infrastructure`, `power_outages`, `global_incidents`, `gdelt_events`, `conflict_zones` ⟵ revived, `war_alerts` ⟵ revived + the credential form UI |
| 3 | **Network** | `cf_outages`, `cf_attacks`, `gps_jamming` |
| 4 | **Maritime** | `maritime` (3 datasets), `piracy`, `dark_fleet`, `sdk_sea` |
| 5 | **Surveillance** | `cctv`, `cctv_previews`, `live_news` |
| 6 | **Aviation** | `flights`/`private`/`jets`/`military`, `flight_paths`, `balloons` ⟵ revived |
| 7 | **Exotics** | `malware` (+ its `network-mesh` dataset), `cyber_attacks`, `satellites` + 5 variants, `day_night`, `terrain_3d` |
| 8 | **Cleanup** | retirements, then the shared scaffolding |

Batches 1–7 each get a deploy and a checklist pass. Batches 0 and 8 fold into their neighbours.
Seven deploys.

`network-mesh` and `sdk-links` are **not** separate panel toggles — they are computed datasets
belonging to the `malware` and `sdk_sea` manifests respectively, and they migrate with their
owners.

**Inventory.** 32 toggles across 11 groups today, plus four revivals (`radiation`, `balloons`,
`war_alerts`, `conflict_zones`) and four retirements (`sdk_air`, `sdk_naval`, `sdk-entities`,
`internet_outages`), resolving to **28 manifests driving 37 panel rows** — fewer manifests than
rows because `satellites` is one manifest with six variant rows, `flights` one with five, and
`balloons` one with two.

### 1.2.1 Which engine capability each batch forces

Group ordering means engine capabilities arrive when a group happens to need them rather than
when they would be most convenient. The consequences are concrete and are listed so the
implementation plan can order tasks within each batch correctly:

| Batch | Capability first needed |
|---|---|
| 0 | `GET /api/layers` + `ClientManifest`; engine mount, sentinel, palette; `useLayerData`; manifest panel rows; diagnostics; same-origin URL resolution (§4.2.1) |
| 1 | Most of the popup schema extensions (§4) — `range`, `when`, `$lat`/`$lng`, `template` |
| 2 | The credential form UI (§5); adapter sources |
| 3 | Multi-dataset manifests sharing one upstream request |
| 4 | **`computed` sources with `dependsOn` (§7.3)** — `sdk_sea` renders from `sdk-links`, which is derived from the cables dataset |
| 5 | `overlay` render kind (§7.6); viewport refresh mode; `panel` interaction |
| 6 | Variants over one dataset; stateful `computed` (`flight-trails`); the `flights` popup adapter |
| 7 | `tiles` source kind (§7.1); `stream` refresh mode (§7.4); `custom` renderers and `behaviour` modules (§7.5) |

The one that would otherwise be missed is **batch 4**: `sdk_sea` is an ordinary-looking maritime
toggle, but it is rendered from a *computed* source, so the whole `computed` + `dependsOn`
mechanism has to exist three batches before the "exotics" batch that nominally owns it.

**`dependsOn` entries name `<layerId>` or `<layerId>.<datasetKey>`,** so a computed dataset may
depend on a sibling dataset inside its own manifest. `sdk_sea` uses exactly this: one `http`
dataset for the cables, one `computed` dataset depending on it.

### 1.2.2 Plan document granularity

Eight batches is more than one implementation plan document comfortably holds. The plan is
expected to be split — most likely batch 0 and batch 1 as one document (the novel work, with
per-task verification), and the remaining batches as a repeated procedure plus a layer
inventory. That matches the granularity guidance in the Plan 1 spec: repeated applications of
one procedure should be planned as the procedure, not as thirty bespoke tasks.

### 1.3 The known cost of group ordering

Capability ordering — batching by the engine mechanism each group of layers needs — was the
recommended alternative and was declined in favour of batches that match the UI. The cost is
specific and is recorded so it is not a surprise when it arrives:

**Batch 1 builds a disproportionate share of the popup schema work.** Hazards needs the `range`
ValueSpec for magnitude and reading bands, conditional fields, *and* coordinate access —
`earthquakes`, `fires` and `gdelt` all print `coords[1].toFixed(3)°, coords[0].toFixed(3)°`, and
`fires` builds a NASA FIRMS link containing the clicked coordinates. So most of §4's extensions
land in batch 1 rather than each being introduced where it is first needed.

Batch 1 is therefore the longest batch and the one most likely to need rework. The
implementation plan must size it accordingly rather than discover it.

### 1.4 Deletion policy

**Per-layer code dies in the batch that migrates it** — the `setGeo` effect, the `setVis` entry,
the `map.on('click', …)` handler, the `addLayer` calls, the `page.tsx` fetch block and poll
interval, and the `LAYER_GROUPS` row, all in the commit that adds the manifest. The branch is
never in a state where one layer has two live code paths.

**Shared scaffolding dies in batch 8,** because it cannot be removed until nothing reads it: the
`sources` array, `CLICKABLE_LAYERS`, the hover-cursor array, the `setVis` block, the
`LAYER_GROUPS` constant, the `legacyKey` projection, and the `capabilities`/`requires`
mechanism.

**The `legacyKey` projection is temporary.** Flat data keys are read well beyond the map —
`LiveAlerts.tsx` reads `data.earthquakes`; `page.tsx` reads `data.commercial_flights`,
`data.private_flights`, `data.private_jets`, `data.military_flights`, `data.maritime_ships` and
`data.cameras` for the flight counter and the HUD camera count. Those consumers move to
canonical `layerId.datasetKey` keys in batch 8 and the projection goes with them.

---

## 2. Host wiring

### 2.1 Manifest delivery to the browser — `GET /api/layers`

`registry.ts` uses `node:fs` and is server-only. `page.tsx` is `'use client'`, as are
`LayerPanel` and the engine. **Plan 1 left no path for a manifest to reach the browser**; it
built the registry and the data endpoint but nothing serving the manifests themselves. Plan 2
adds a third route.

The precedent for server→client configuration here is a client-side fetch into state:
`page.tsx` already does `fetch('/api/cloudflare-radar?probe=1')` and stores the result in
`capabilities`. So `GET /api/layers` is fetched once on mount alongside the existing probes, and
re-fetched after a diagnostics reload.

**It must not return the manifest verbatim.** A manifest's `source` carries `url` and `headers`,
including unexpanded `{config.ACLED_API_KEY}` templates. The Plan 1 spec is explicit that the
upstream URL never leaves the server — that property is why `/api/layer-source` accepts a layer
id rather than a URL, and shipping manifests to the browser would quietly undo it.

The route therefore returns a **`ClientManifest`** projection:

```ts
interface ClientDataset {
  key: string;
  layers: MapLayerSpec[];
  legacyKey?: string;
  /** Only what the client actually reads. No url, no headers, no params. */
  source: { kind: SourceSpec['kind']; refresh?: RefreshSpec;
            /** Passed through only for kind:'tiles' — a public tile endpoint, §7.1. */
            spec?: Record<string, unknown>;
            dependsOn?: string[] };
}

interface ClientManifest {
  id: string; label: string; group: string;
  defaultOn: boolean; parent?: string; countFrom: string; order?: number;
  /** Field descriptors only — key, label, hint, docsUrl, optional. Never a value. */
  requiredConfig: ConfigFieldSpec[];
  datasets: ClientDataset[];
  variants: VariantSpec[];
  render: RenderSpec;
  interaction?: InteractionSpec;
}
```

`{ kind, refresh }` is exactly what the client reads: `loader.ts`'s `refreshOf` tests
`kind === 'http' || kind === 'adapter'` and returns `refresh`; `engine.ts` never touches
`source` at all. So `loader.ts` and `engine.ts` have their signatures narrowed from
`NormalisedManifest` to `ClientManifest`. That is a small refactor of two files and it makes URL
leakage a type error rather than a matter of discipline.

The route returns `{ manifests, errors, loadedAt }` with `Cache-Control: no-store`.

### 2.2 Source-id namespacing

The engine derives a single-dataset manifest's source id as the bare layer id:
`sourceId('piracy', 'default') === 'piracy'`. `OsirisMap` pre-allocates a hand-written `sources`
array containing `'piracy'`, `'balloons'`, `'radiation'`, `'fires'`, `'weather'`, `'cctv'`,
`'maritime'`, `'satellites'`, `'earthquakes'` and `'infrastructure'` — **ten exact collisions**.

Map layer ids do not collide (`piracy--dots` versus `piracy-dots`), but sources do, and the
failure is silent: `engine.mount()` guards with `if (!this.map.getSource(src))`, so it would
*adopt* the legacy source, after which both the engine and the legacy `setGeo` write to it and
the layer flickers between two datasets on every refresh, with no error anywhere.

`sourceId()` and `mapLayerId()` therefore gain a `lyr:` prefix — source `lyr:piracy`, layer
`lyr:piracy--dots`. This makes the two systems disjoint by construction for the whole migration,
rather than depending on someone deleting the right line from an array ten times. It is the same
argument the Plan 1 spec makes for deriving the clickable set. The diagnostics panel strips the
prefix for display.

### 2.3 Engine lifecycle in `OsirisMap`

The engine is constructed once the map is ready, after the legacy `addSource`/`addLayer` block,
and torn down on unmount:

```
new LayerEngine(map, { onSelect, palette, beforeId: 'lyr:overlay-floor' })
  → mount(manifests) → attach()
```

- **Sentinel.** An empty symbol layer `lyr:overlay-floor` is added immediately after the legacy
  block. Every manifest layer inserts before it, so the bespoke overlays `OsirisMap` keeps —
  routes, drawing, user location, watched airports, IP sweep, scan targets — stay above manifest
  layers exactly as they sit above hand-written ones today. Those overlays are added dynamically
  and would land on top anyway; the sentinel makes the ordering explicit rather than incidental.
- **Re-mount on style reload.** `OsirisMap` takes a `mapStyle` prop and switches projection at
  runtime; a style reload discards every source and layer. The engine re-mounts on `styledata`
  and re-applies current data through `setData`.
- **Palette.** The existing `STYLE_EVENT` listener calls `engine.setPalette(next)`. In batch 5
  this replaces the two hardcoded `setPaintProperty` calls for `cctv-dots`/`cctv-label`: they
  become `{palette.cctv}` tokens in the manifest, which is the generalisation the Plan 1 spec
  describes.

### 2.4 `useLayerData.ts` — the executor

A hook owning one `LoadState` and one timer. On each tick, and on any change to
`active` / `manifests` / `viewport`, it calls `planLoads(...)` and for each plan runs
`markStarted` → `fetch('/api/layer-source?layer=…&datasets=…'[+'&bbox='])` → `markSettled(ok)`,
writing features into `dataRef.current` under the canonical `layerId.datasetKey` **and** under
`legacyKey` where declared, then bumping `dataVersion`.

Two consequences worth naming:

**One timer replaces many.** `page.tsx` currently runs a scatter of `setInterval`s at
per-source cadences. `planLoads` already decides what is due from `lastPollAt` and each
dataset's `intervalMs`, so a single coarse tick subsumes all of them.

**`skipWhenHidden` stays background-polls-only.** A plan with `reason: 'initial'` always runs,
even in a hidden tab, because the planner marks the dataset fetched and would otherwise leave
the layer permanently empty. This distinction is already documented in `fetchEndpoint` and is
carried over verbatim.

### 2.5 `activeLayers` ownership and share links

`activeLayers` stays in `page.tsx`; `OsirisMap` and `LayerPanel` keep receiving it as a prop, so
neither component's contract changes. What changes is the source of the defaults: the hardcoded
37-key object literal is replaced by seeding from manifests' `defaultOn` once `/api/layers`
resolves, then applying the `?layers=` parameter over that seed. Unknown ids in the URL are
ignored, as today.

Manifest ids are exactly today's `activeLayers` keys, so existing share links keep resolving.
This constrains naming: `private` is **not** renamed to `private_flights`, however tempting.

The `?layers=balloons` 404-poller bug resolves itself, because `balloons` becomes a layer that
really exists.

### 2.6 The coexistence contract for batches 1–7

Four rules, each mapping to a specific failure that would otherwise occur:

1. **Namespaced ids** (§2.2) — no source is written by both systems.
2. **Same-commit deletion** (§1.4) — a migrated layer never has two live code paths.
3. **`legacyKey` projection** — non-map consumers keep reading flat keys until batch 8.
4. **The satellite pick defers to both clickable sets.** The GPU pick defers to
   `CLICKABLE_LAYERS` before claiming a click. During coexistence it must defer to the **union**
   of `CLICKABLE_LAYERS` and `engine.clickableLayerIds()`. Without this, the moment a layer
   migrates the satellite pick stops knowing about it and starts stealing its clicks —
   reintroducing the exact bug that motivated this project, one layer at a time. The union
   collapses to the derived set alone in batch 7 when `satellites` migrates.

Legacy and engine click handling otherwise coexist cleanly: legacy handlers are registered per
layer id, and the engine's single handler only dispatches for ids in its own derived clickable
set.

---

## 3. Panel generation from manifests

### 3.1 `groups.ts`

```ts
export const GROUPS: Record<string,
  { label: string; fullLabel: string; icon: ComponentType<{ className?: string }>; order: number }>
```

Group metadata stays in code because the icons are React components and cannot be JSON. Eleven
entries mirroring today's headers (`SDK`, `AVIATION`, `MARITIME`, `SPACE`, `SURVEIL`, `HAZARD`,
`THREAT`, `NETWORK`, `NETINTEL`, `SIGNALS`, `DISPLAY`), plus a twelfth: **`PLUGINS`**, the
fallback for a drop-in manifest naming a group that does not exist. A manifest silently
disappearing is the worst failure mode for a drop-in file.

### 3.2 Row construction

`LAYER_GROUPS` is not deleted until batch 8. Through batches 1–7 the panel renders a merged list
per group: manifest rows for migrated layers, `LAYER_GROUPS` rows for the rest. Because deletion
is same-commit, a layer appears in exactly one list at any time.

Rows come from the manifest: `label` for the text, `parent` for the indented sub-row and its
stem (`cctv_previews` under `cctv`), `variants` as sibling rows, `countFrom` for the number.
Existing group behaviours — pinning, ALL/NONE, the active-count badge, the mobile layout, the
`Escape` handler — are untouched; only their input changes.

### 3.3 Two orderings, kept separate

Today the panel order (the `LAYER_GROUPS` array) and the map stacking order (the sequence of 99
`addLayer` calls) are independent and differ. Collapsing them into one would silently restack the
map, so both are preserved:

- **Z-order** is registry order. Built-in manifests carry a numeric filename prefix
  (`10-earthquakes.json`, `20-fires.json`) so `readdir().sort()` makes stacking explicit.
- **Panel order** within a group is an optional `order?: number` on the manifest, falling back to
  registry order.

One small schema addition, preserving a degree of freedom that exists today rather than
inventing a speculative one.

**A drop-in override keeps the built-in's position.** `reloadRegistry` merges into a `Map` keyed
by id with drop-ins read second, and re-setting an existing key leaves its insertion position
unchanged. So an operator overriding a shipped layer to change a colour or a poll interval does
not accidentally restack the map or reorder the panel — which is the behaviour an override
should have.

### 3.4 Counts

`getCount` changes from summing comma-separated flat keys to reading the `countFrom` dataset's
row count. For a variant carrying a `filter`, the count is the **post-filter** row count, which
is what `satellites`' per-category numbers mean today via the server-computed `category_counts`.

**Counts are memoised on `dataVersion`, not computed per render.** `satellites` holds ~19,000
rows behind six variant rows; filtering six times on every React render would be a real
regression against today's precomputed counts. The `dataRef` + `dataVersion` store exists
precisely to provide this signal — the Plan 1 spec calls that indirection "a deliberate
performance choice — one re-render per refresh rather than per render" — and a `useMemo` keyed
on `dataVersion` keeps faith with it.

Rows with nothing to count (`flight_paths`, `cctv_previews`, `day_night`, `terrain_3d`) show no
number, as today.

### 3.5 Credential rows, and why `optional` is load-bearing

The `requires` / `capabilities` mechanism is retired. `cf_outages` and `cf_attacks` stop being
hidden and become visible rows; the `capabilities` prop and the `/api/cloudflare-radar?probe=1`
call are deleted in batch 8.

Decision P3 has **every** credential-touching layer declare `requiredConfig`. That makes the
required/optional distinction do real work, because two cases must not look alike:

- **`optional: false`** (the default) — the layer cannot function without the key. `war_alerts`
  without an ACLED key; `cf_outages` without a Cloudflare token. The row renders **dimmed with a
  key glyph**, label intact, and clicking opens the credential form instead of toggling.
- **`optional: true`** — the layer works without the key but is better with it. `flights`
  without OpenSky credentials still returns anonymous-rate data; `maritime` degrades rather than
  dies. The row renders and toggles **normally**, with a small key affordance exposing the form.

Without that split, declaring credentials across the board would dim a set of layers that
currently work and make the map look broken. Each manifest's `optional` flag is a factual claim
about its upstream, decided when the layer is migrated and **checked against what the existing
route actually does when the key is absent** — not assumed.

Status comes from `GET /api/layer-config`, which returns `{ configured, source: 'env'|'store'|null }`
per key and never a value. A key set in the environment shows as read-only "set by environment",
so an operator's `docker-compose.yml` cannot be shadowed from a browser.

---

## 4. Popup schema extensions

Decision P5: popups adopt one uniform design, `PopupSpec` grows to carry the *content* the
existing 25 handlers express, plus a closed set of presentational hints. Adapters remain
reserved for `flights` and `satellites`, which need async enrichment and a bound button rather
than merely different markup.

### 4.1 What today's popups do that Plan 1's `PopupSpec` cannot

`renderPopup` currently produces a fixed shape: accent-coloured title, optional subtitle, a
two-column grid of label/value pairs, then accent-styled link buttons. Against that, the 25 live
handlers need:

| Need | Example | Resolution |
|---|---|---|
| Conditional fields | `cf-outage` renders `description` and `Ended` only when present | `when` (§4.2) |
| Conditional links | `conflict-icons` renders its source link only when a URL exists | `when` |
| Derived field *values* | `cyber-heads` shows `CRITICAL`/`HIGH`/`MEDIUM` from a numeric severity | `value: ValueSpec` |
| A status pill beside the title | `cyber-heads`' severity badge | `badge` hint (§4.3) |
| Coordinates | `fires`, `gdelt-dots`, `conflict-icons` print the clicked lat/lng | `$lat`/`$lng` |
| Coordinates in links | `fires` builds a FIRMS deep link containing them | `$lat`/`$lng` + `template` |
| Per-field colour | `balloons` colours vertical rate by sign | `color: ValueSpec` |
| Long scrollable text | `piracy`'s sitrep body | `body` hint |
| Leading glyph | ☠️ on piracy, ⚡ on attacks, ☢️ on radiation | `glyph` hint |
| Single-column layout | `radiation` | `columns` hint |
| Arithmetic over properties | `gps-jamming`'s `good + bad`, `badRatio * 100` | **not schema — see §4.4** |

### 4.2 The extended schema

```ts
/** One predicate type, shared with VariantSpec.filter so there is only one to learn. */
interface Condition {
  property: string;          // '$lat' / '$lng' also resolve here
  exists?: boolean;          // property is present and not null/undefined/''
  truthy?: boolean;          // MapLibre-coerced: the string 'false' and '0' are falsy
  equals?: unknown;
  in?: unknown[];
  not?: boolean;             // inverts the whole condition
}

type ValueSpec =
  | string
  | { property: string }
  | { match: { property: string; cases: Record<string, string>; fallback: string;
               mode?: 'equals' | 'contains' } }
  | { range: { property: string; stops: [number, string][]; fallback: string } }
  | { template: string };    // NEW — '{place} ({country})', '{$lat}°, {$lng}°'

interface PopupFieldSpec {
  label: string;
  property?: string;         // the common case, unchanged
  value?: ValueSpec;         // NEW — takes precedence over `property` when present
  format?: Format;
  suffix?: string;
  color?: ValueSpec;         // NEW — per-field colour
  when?: Condition;          // NEW
}

interface PopupLinkSpec { label: string; url: string; when?: Condition }  // `when` NEW

interface PopupSpec {
  accent: ValueSpec;
  title: ValueSpec;
  subtitle?: ValueSpec;
  glyph?: ValueSpec;                                     // NEW — leading character, may be derived
  columns?: 1 | 2;                                       // NEW — default 2
  body?: { value: ValueSpec; maxHeight?: number };       // NEW — scrollable prose block
  badge?: { value: ValueSpec; color?: ValueSpec;         // NEW — pill beside the title
            when?: Condition };
  fields: PopupFieldSpec[];
  links?: PopupLinkSpec[];
}
```

The `badge` renders as a pill on the title row, right-aligned against the title, above the
divider — the shape `cyber-heads` uses today for its severity. `color` defaults to the popup's
`accent` and routes through `resolveColor` (§4.5) like every other colour slot; `when` lets a
badge be conditional, so a layer can show one only for the states that warrant it.

**Two of these shapes were corrected while authoring the batch-1 manifests**, which is the
front-loading §1.3 predicted arriving on schedule:

- **`glyph` is a `ValueSpec`, not a string.** `weather-dots` picks its emoji from the event type
  — 🌀 cyclone, 🌋 volcano, 🌊 flood, 🏜️ drought, 🧊 ice, ⚠️ weather, ⚡ otherwise. A fixed string
  cannot express that; a `match` ValueSpec can, and costs nothing extra since `resolveValue`
  already handles it.
- **`Condition` needs `not`.** `eq-circles` renders one of two mutually exclusive links: a
  NIGGG-BAS link when `source === 'NIGGG-BAS'`, a USGS event link otherwise. Expressing the
  "otherwise" branch requires negation, and `not` inverting the whole condition composes with
  every form rather than adding a `notEquals` beside each one.
- **Coordinates need two precisions.** Popups *display* coordinates rounded to three decimals
  (`coords[1].toFixed(3)`) but *link* with full precision (`fires`' FIRMS deep link, and later
  `gps_jamming`'s gpsjam link). A single `$lat` cannot serve both, and per-token formatting
  inside a template would be a formatting language. So four pseudo-properties are injected, not
  two: **`$lat`/`$lng` at full precision, and `$lat3`/`$lng3` pre-rounded to three decimals.**

### 4.2.1 Same-origin source URLs

Most migrated layers keep their existing bespoke route — `/api/fires` does FIRMS parsing,
`/api/weather` aggregates events — and their manifests point at it rather than at the upstream.
But `serveDatasets` runs server-side and hands the URL to `safeFetch`, which needs an absolute
URL; a bare `/api/fires` has no host.

`serve.ts` therefore resolves a URL beginning with `/` against the instance's own origin, taken
from `OSIRIS_SELF_ORIGIN` and defaulting to `http://127.0.0.1:3000`. This is what makes the Plan
1 spec's claim about submarine cables true in practice — "the loader does not care that the host
is itself" — and most layers in batches 2 through 7 depend on it, so it lands in batch 0 rather
than being discovered per layer.

`renderPopup` gains a third argument: `renderPopup(spec, props, ctx)` where
`ctx = { lng, lat }`. The engine already holds `lngLat` at dispatch, so this is a parameter
change, not new plumbing. `$lat`, `$lng`, `$lat3` and `$lng3` are injected as pseudo-properties
wherever a property is read — fields, conditions and templates alike. The `$` prefix avoids
collision with a genuine upstream property named `lat`.

### 4.3 The `badge` hint — rejected on review, then reinstated

`badge` was initially left out on a YAGNI argument: only `cyber-heads` has a pill-styled
severity badge today, and one consumer does not normally justify a schema concept. The proposal
was to render its severity as an ordinary coloured field, preserving the information and losing
the pill.

**That was overruled on review and `badge` is in the schema.** The reasoning that carried:

- The count of *current* consumers is the wrong measure for a presentational vocabulary whose
  whole purpose is to let future drop-in manifests look like first-class layers. A severity or
  status pill is a generic idea, not a `cyber_attacks` idiosyncrasy, and a plugin author reaching
  for one should not have to write an adapter to get it.
- It costs almost nothing. `badge` reuses `ValueSpec`, `Condition` and `resolveColor` — every
  piece already exists for other hints — so it adds one optional key and a few lines in
  `renderPopup`, not a new mechanism.
- Leaving it out would have made `cyber_attacks` the one migrated layer that visibly lost
  something, which weakens the parity claim the fixtures in §8.1 exist to support.

The discipline the Plan 1 spec applied to date tokens still holds — a closed, enumerated set —
and `badge` is now a member of that set. What remains excluded is arbitrary HTML or CSS in a
manifest: every presentational hint is a named key the renderer understands, so escaping and
colour validation stay structural.

### 4.4 Arithmetic belongs upstream, not in the popup

`gps-jamming` displays `goodAircraft + badAircraft` as one number and `badRatio * 100` as a
percentage. Rather than introduce expressions into `PopupSpec`, **the adapter emits these as
real feature properties** (`sampled`, `badPercent`). `gps_jamming` already requires an adapter
for CSV parsing, H3 cell decoding and the date fallback, so this costs two lines in code that
must exist regardless.

Stated as a rule: **a popup renders properties; it does not compute them.** Anything needing
arithmetic is computed where the feature is built — in the adapter, or in the `properties`
mapping of an `http` source. This keeps `PopupSpec` declarative and keeps one obvious home for
derived values.

### 4.5 Colour values are validated, not merely escaped

`accent` and `color` are interpolated into `style="color:…"`. Today `renderPopup` escapes them
with `htmlEsc`, which prevents attribute-breaking but not CSS injection — a value like
`red;background:url(...)` survives escaping intact. Adding the `template` ValueSpec makes it
newly possible for an upstream-controlled string to reach a colour slot, so:

**`resolveColor()` accepts only `#RGB`, `#RRGGBB`, `#RRGGBBAA` or a small named set, and falls
back to the spec's declared fallback otherwise.** Every colour-valued slot — `accent`, field
`color` — routes through it. This closes a pre-existing hole rather than merely avoiding a new
one, and it is unit-testable with no map.

Text values continue through `htmlEsc`; link URLs continue through `urlSafe`, which already
rejects anything that is not `http(s)`. `template` interpolation returns raw text and the caller
escapes the result, so a template can never smuggle markup.

---

## 5. The credential form

### 5.1 Placement

Inline, expanding beneath the layer's row inside the `LayerPanel` flyout — as the Plan 1 spec
describes, and consistent with the panel's existing behaviour of doing work in place rather than
in a modal. The rail's bottom buttons (Style Studio, Ghost Protocol) remain the pattern for
panels that are not layer rows; a per-layer credential form is a layer row concern.

### 5.2 Behaviour

The form is built from `requiredConfig`: each field renders its `label`, its `hint`, a link to
`docsUrl` where given, and a password-type input.

- **Save** → `POST /api/layer-config { key, value }` → `{ stored, verified, error? }`. The route
  writes the value and then **probes the upstream once**, so a mistyped token fails visibly at
  entry rather than silently producing an empty layer an hour later. The form shows the probe
  result inline.
- **Environment-set fields** render read-only, labelled *"set by environment"*. Environment
  always wins; the POST route already returns `409` for such a key.
- **Clear** → `DELETE /api/layer-config?key=…`.
- On a successful save the panel re-fetches `/api/layer-config`, un-dims the row, and the layer
  becomes toggleable.

### 5.3 Admin token

When `OSIRIS_ADMIN_TOKEN` is set, writes require the `x-osiris-admin` header. The UI prompts
once per session and holds the token in `sessionStorage` — session-scoped, and never sent
anywhere but this instance's own config route. When the variable is unset, which is the default
and the expected case for this instance, the form is open and there is no prompt.

### 5.4 Every credential-touching layer declares

Per decision P3, manifests declare `requiredConfig` for every key they or their backing route
consume. The keys present in the API routes today are `CLOUDFLARE_API_TOKEN`, `AIS_API_KEY`,
`OPENSKY_CLIENT_ID`/`OPENSKY_CLIENT_SECRET`, `GFW_API_KEY`, `SDK_INGEST_KEY` and `SCANNER_KEY`,
plus `ACLED_API_KEY` newly introduced by `war_alerts`.

**The key-to-layer mapping is confirmed per layer during its own batch**, by reading the route
that consumes it, rather than assumed here — several of these keys belong to routes that are not
layer sources at all (`SCANNER_KEY` and `SDK_INGEST_KEY` serve the scanner and SDK ingest paths,
which are out of scope), and declaring a key against the wrong layer would put a credential
prompt on a row it cannot help.

For layers whose manifest points at an existing bespoke route rather than at the upstream
directly, the key is still read server-side inside that route; the declaration is what makes it
**discoverable and settable in-app**. The `optional` flag on each declaration is determined by
reading what that route actually does when the key is absent (§3.5).

### 5.5 ACLED remains unverified

The Plan 1 spec flags that ACLED's endpoint, parameters and response shape were never verified
against the live API, unlike Safecast and SondeHub which were. **Batch 2 must verify ACLED
before authoring `war_alerts`.** If it proves unsuitable the documented fallbacks are a GDELT
`quad == 4` subset (keyless, but overlapping `gdelt_events`) or a Ukraine-specific air-raid feed
(also key-gated, narrower). `war_alerts` is the showcase for the credential UI, so if ACLED is
dropped the showcase moves to `cf_outages`, which is hard-gated on a Cloudflare token and
migrates in batch 3.

---

## 6. Diagnostics panel

Per decision P4, the panel carries registry state, per-layer runtime state and a request log.
After batch 8 it is the only place an operator can learn why a layer is empty, so the scope is
proportionate.

### 6.1 Placement

A new button at the bottom of the `LayerPanel` rail, beside Style Studio and Ghost Protocol,
opening a panel in the same manner as `StyleStudio`.

### 6.2 Contents

**Registry.** How many manifests loaded and when; each manifest's origin file and whether it
came from the built-in directory or the drop-in mount; which drop-in overrode which built-in;
and every validation error with its filename (*"foo.json: unknown format 'jsom'"*). A **Reload**
button issues `POST /api/layer-source?reload=1`, then re-fetches `/api/layers`. Reload re-runs
validation, so a malformed drop-in file surfaces its error immediately rather than at the next
restart — this is what makes "no rebuild, no container restart" true in practice.

**Per-layer runtime.** Last fetch time, per-dataset row count, and the last error where the most
recent fetch failed — including the `428 missing configuration` case, which links directly to
that layer's credential form.

**Request log.** Recent `/api/layer-source` calls: timestamp, layer id, dataset keys, HTTP
status, duration in milliseconds, response size.

### 6.3 Where each part's state lives

**Runtime state is read from the client's own `LoadState`, not from the server.** The client is
what decided to fetch and what received the result; `useLayerData` already holds `fetched`,
`inflight` and `lastPollAt` per dataset, and the data store already holds row counts. Mirroring
this on the server would create a second source of truth that could disagree with the first.

**Registry state and the request log come from the server**, since only the server sees the
manifest files and the outbound calls.

### 6.4 The request log: an in-memory ring buffer

`src/lib/layers/request-log.ts` — a module-scope ring buffer, capacity 200, with `record(entry)`
and `recent(limit)`. `/api/layer-source` records on every GET, successful or not.

**Why in-memory rather than persistent.** This log is diagnostic, not audit. Persisting it would
add a disk write on every layer fetch, introduce a retention and rotation problem nobody asked
for, and produce a file containing resolved upstream URLs — precisely what §2.1 works to keep
off the client. A ring buffer avoids all three. The log does not survive a restart, which on this
deployment means it does not survive a rebuild; that is acceptable for a log whose purpose is
"why is this layer empty right now".

**Redaction.** Entries record the **layer id and dataset keys, never the resolved URL and never
headers** — the same reasoning that shapes `ClientManifest`. Status, duration and size are safe
and are what the log is actually for.

**Process scope.** Module-scope state is per-process. With a single container that is correct;
under multi-process serving the log would show one worker's view. Recorded as a known property,
not a defect to design around here.

### 6.5 Endpoint

`GET /api/layer-diagnostics` returns `{ registry, requests }` with `Cache-Control: no-store`.
It follows the same rule as the other administrative routes: when `OSIRIS_ADMIN_TOKEN` is set
the request must carry `x-osiris-admin`; when it is unset — the default, and the case for this
instance — the route is open. Diagnostics are kept off `/api/layers` so the manifest feed stays
a clean cacheable resource while diagnostics are never cached.

---

## 7. The exotic layers

Per decision P7, the schema grows by exactly one source kind plus one field; everything else
becomes a named code module, the same escape-hatch pattern the Plan 1 spec already established
for adapters.

### 7.1 Tile sources — the one genuine hole

`terrain_3d` cannot be expressed at all today. Verified in `OsirisMap.tsx`, it adds:

```js
map.addSource('osiris-buildings', { type: 'vector', url: 'https://tiles.openfreemap.org/planet' });
map.addLayer({ id: 'osiris-3d-buildings', source: 'osiris-buildings',
               'source-layer': 'building', type: 'fill-extrusion', minzoom: 14.5, paint: {…} });
```

Every `SourceSpec` kind produces GeoJSON features from rows. There is no way to declare a vector
or raster tile source. Two additions close this:

```ts
type SourceSpec = … | { kind: 'tiles'; spec: Record<string, unknown> };

interface MapLayerSpec {
  …
  sourceLayer?: string;   // NEW — required by any vector tile source
}
```

`spec` is a raw MapLibre source object passed to `addSource` verbatim. Validation requires
`spec.type` to be one of `vector`, `raster`, `raster-dem`, and requires either `url` or `tiles`.
`sourceLayer` is emitted as `'source-layer'` in the `addLayer` call.

`tiles` sources never reach `/api/layer-source`: `serveDatasets` rejects them with 400 as it does
`computed` and `none`, and `refreshOf` returns null so the planner skips them.

**Trust note.** Tile URLs are fetched by the browser, not the server, so `safeFetch` and the SSRF
guard do not apply — MapLibre already fetches basemap tiles directly today. A drop-in manifest
can therefore point the browser at any tile host. This is the same trust level as the drop-in
directory itself, which is an operator-installed file on the operator's own machine; it is
recorded as an accepted property, not an oversight.

**This addition also serves planned work** — weather-radar tiles, better 3D buildings and flood
overlays are all tile sources, and all become drop-in JSON rather than code.

### 7.2 Already supported and not to be broken: arbitrary MapLibre expressions

Verified by test during design, not assumed: a manifest declaring
`'icon-rotate': ['get','heading']`, `'icon-rotation-alignment': 'map'`, an `interpolate` opacity
ramp and a `case` expression with a `{palette.cctv}` token nested inside comes out of
`engine.mount()` **byte-identical** in the `addLayer` call, with only the palette token
rewritten. `validate.ts` never inspects `paint` or `layout`; `resolveTokens` recurses through
arrays and objects and touches only `{palette.X}` strings.

So data-driven icon rotation — Flock-style camera directionality, for instance — needs **no
schema change and works today**. This is recorded because it would be easy to reintroduce a
restriction accidentally (by whitelisting paint keys, say) while extending the schema elsewhere.
§8.3 carries a permanent regression test guarding it.

### 7.3 `computed` sources and `dependsOn`

```ts
| { kind: 'computed'; compute: string; dependsOn?: string[]; refresh?: RefreshSpec }
```

`dependsOn` names the layer ids whose rows feed the computation — the dependency that
`network_mesh` (derived from `malware`) and `sdk_links` (derived from the cables dataset) have
always had implicitly and that the schema could not previously state.

`src/lib/layers/computed/index.ts` holds a registry of **factories**, not plain functions:

```ts
type ComputeFactory = () => (inputs: Record<string, GeoFeature[]>, ctx: { now: Date }) => GeoFeature[];
```

A factory per mounted layer, so a computation may keep state across calls. Stateless ones ignore
it; `flight-trails` (§7.6) needs it.

`useLayerData` evaluates computed datasets after each data write and on the tick. `day_night`
declares `refresh: { mode: 'poll', intervalMs: 300000 }`, matching today's five-minute solar
terminator interval exactly.

Members:

| compute | Owner manifest | `dependsOn` | Batch |
|---|---|---|---|
| `sdk-links` | `sdk_sea` | `['sdk_sea.cables']` — its own sibling dataset | 4 |
| `malware-mesh` | `malware` | `['malware.default']` | 7 |
| `day-night` | `day_night` | none | 7 |
| `flight-trails` | `flight_paths` | `['flights']` — all four datasets | 6 |
| `passthrough` | `cctv_previews` | `['cctv']` — identity, feeds the overlay (§7.6) | 5 |

Two of these depend on a sibling dataset within the same manifest, which is why `dependsOn`
accepts `<layerId>.<datasetKey>` as well as a bare layer id (§1.2.1). `sdk_sea` is the reason
this machinery must land in batch 4 rather than batch 7.

### 7.4 Stream mode

`refresh: { mode: 'stream', path: '/api/malware/stream' }`. `useLayerData` opens an
`EventSource` while any dataset with that mode is active and closes it on deactivation and on
unmount. `page.tsx` owns this connection today; it moves to the hook in batch 7.

### 7.5 Renderer and behaviour modules

Two hooks, because the exotic layers split cleanly into two kinds.

**`render: { kind: 'custom'; renderer: string }`** — the layer is not drawn by MapLibre at all.
`src/lib/layers/renderers/index.ts`:

```ts
type RendererFactory = (map: MapLike, ctx: RendererCtx) => {
  onData(datasetKey: string, features: GeoFeature[]): void;
  onActive(active: boolean): void;
  onPalette(palette: Record<string, string>): void;
  hitTest?(point: { x: number; y: number }): Record<string, unknown> | null;
  destroy(): void;
};
```

`engine.mount` currently early-returns on any non-geojson render; it now instantiates the
renderer, forwards `setData`/`setActive`/`setPalette`, and calls the existing
`registerHitTest` when `hitTest` is present — so a custom renderer joins the derived click
ordering and correctly defers to real layer ids. Sole member: **`satellites`**, wrapping
`src/lib/satellite-layer.ts`, which already exports `createSatelliteLayer` with a `pick(x, y)`
method. Variants filter catalogue rows by `category` before `onData`, exactly as today.

**`render: { kind: 'geojson'; behaviour?: string }`** — the layer *is* ordinary MapLibre
geometry, but something animates it. This is the right shape for both animated layers, because
both keep declarative paint and add a driver on top:

- **`cyber-pulse`** — `cyber_attacks` draws seven ordinary geojson layers and runs a
  `requestAnimationFrame` loop mutating `line-dasharray`, `line-opacity` and
  `circle-stroke-color`.
- **`malware-beacons`** — `malware` runs a 200 ms interval that recomputes beacon features via
  `arrivalBeacons(...)`, pushes new GeoJSON, *and* sets a time-varying `circle-radius`
  interpolate expression on `malware-new-ring`.

A behaviour module receives `{ map, layerIds, getRows, setData }`, and the **engine owns its
lifecycle**: `start()` on activation, `stop()` on deactivation, `stop()` on `destroy()`. This is
a real improvement over today, where these loops live in `useEffect` cleanups and a missed
dependency leaks a timer.

Making a fully declarative `animate` block was considered and rejected: there are exactly two
animated layers and they animate by different mechanisms — one oscillates a paint value, the
other regenerates geometry — so any DSL would be generalised from a sample of one and would
still need the escape hatch beside it.

### 7.6 Overlays and the two awkward layers

**`render: { kind: 'overlay'; component: string }`** — a React DOM overlay positioned above the
map, not a MapLibre layer. `OsirisMap` renders an `OverlayHost` mapping component names to the
existing `CctvPreviews` and `LiveNewsPreviews` components. The engine does not manage these, but
the manifest still supplies the panel row, the data loading and the toggle.

**`cctv_previews`** is a manifest with `parent: 'cctv'`, `source: { kind: 'computed',
compute: 'passthrough', dependsOn: ['cctv'] }` and `render: { kind: 'overlay',
component: 'cctv-previews' }` — reusing `dependsOn` rather than inventing an overlay-specific
data path.

**`flight_paths`** is the modifier toggle: no data source of its own, and it changes how the four
flight categories render. It resolves as a computed layer with its own trail geometry —
`source: { kind: 'computed', compute: 'flight-trails', dependsOn: ['flights'] }` with geojson
line layers. The recently added breadcrumb implementation (`flightTrailsRef`,
`MAX_TRAIL_POINTS`, `TRAIL_STALE_MS`) is genuinely a stateful derivation over successive flight
refreshes, which is exactly what the §7.3 factory signature provides. No new concept is needed.

### 7.7 Retirements

Removed in batch 8: `sdk_air` and `sdk_naval` with their six permanently-empty map layers, the
`sdk-entities` source and the ~40-line SDK entity computation in `page.tsx`, the `scm-dots`
handler (registered for a layer that is never added), `war-alerts-lines`, `internet_outages`
(read by `setVis`, never defined), and the phantom hover ids `sdk-sea-glow` and `sdk-sea-atmo`.
`sdk_sea` is kept, with its panel count sourced from the cables dataset it actually renders.

---

## 8. Verification

There is no component test harness and no E2E rig in this repository — vitest runs
`src/**/*.test.ts` in a `node` environment, so nothing inside a `.tsx` file is testable here.
**The migration is therefore not claimed to be covered end-to-end by automated tests.** Four
concrete mechanisms stand in.

### 8.1 Popup fixtures — every layer

Per decision P2, **every** migrated layer gets a fixture, not only those with non-trivial
popups. `src/lib/layers/__fixtures__/<layer>.json` holds one real feature's properties, and a
test asserts the rendered HTML contains every label and every formatted value the old popup
produced.

**Capture is scripted, not manual.** For a layer whose legacy route still exists, the fixture is
captured by calling that route and running the first row through the same transform the legacy
`setGeo` applied — reproducible, and needing no browser. For the revived layers (`radiation`,
`balloons`, `war_alerts`) there is no legacy route, so the fixture is captured from the new
upstream response.

Each fixture test asserts label-and-value containment, plus a full-HTML snapshot so that later
changes are visible in review rather than silent.

This is the single highest-volume, most error-prone work in the plan — transcribing every
in-scope popup field by field, around 22 of the 25 live handlers (`scan-targets-dots`,
`sweep-device-dots` and the dead `scm-dots` belong to non-toggle features that stay with
`OsirisMap`) — and it is exactly the work `popup.ts` being a pure function makes testable.

### 8.2 The manual checklist, per batch

Run against the batch's panel group after deploying it:

1. Toggle each layer on — the panel count matches the value it showed before migration.
2. Markers land in the same places.
3. Click a feature — popup fields and links match the fixture, and links open.
4. Toggle off — the source clears and markers disappear.
5. Switch theme — colours still track the palette.
6. Reload with `?layers=<the batch's ids>` — the share link restores exactly those layers.

### 8.3 Regression tests for the mechanisms

- **Expression pass-through** (§7.2) — the test written during design, made permanent.
- **Engine**, against `FakeMap`: `tiles` sources; `computed` with `dependsOn`; behaviour module
  start/stop/cleanup; renderer forwarding and hit-test ordering; the `ClientManifest` narrowing.
- **`popup.ts`**: each new spec feature — `when` with `exists`/`truthy` against MapLibre's
  string-coerced booleans, `template` with `$lat`/`$lng`, per-field colour, `resolveColor`
  rejecting a non-hex value, and the `glyph`/`columns`/`body`/`badge` hints — `badge` covering
  its default-to-accent colour and its conditional `when`.
- **`validate.ts`**: `tiles` spec validation, the `order` field, `dependsOn` naming an unknown
  layer, and `sourceLayer` on a non-tile source.

### 8.4 Gates

`npm test`, `npm run lint` and `npm run build` all green before a batch is deployed.

### 8.5 Risk register

| Risk | Mitigation |
|---|---|
| Batch 1 carries most of the popup schema work (§1.3) | Sized explicitly in the plan; accepted cost of group ordering |
| A wrong mechanism replicates across layers before discovery (§1) | Batch ordering plus §8.1 fixtures; response is to stop and re-run affected batches |
| Source-id collisions during coexistence | Structurally removed by `lyr:` namespacing (§2.2) |
| Satellite pick steals clicks from migrated layers | Union of both clickable sets until batch 7 (§2.6 rule 4) |
| Z-order drift — 99 `addLayer` calls order implicitly today | Sentinel layer plus numeric manifest filename prefixes (§2.3, §3.3) |
| CCTV volume — 10,000+ cameras through a generic path | Performance check against the current specialised path in batch 5 |
| Satellite migration is the highest-risk single layer | Scheduled in batch 7; stays a custom renderer wrapping existing tested code |
| Panel counts regress on `satellites`' 19,000 rows | Memoised on `dataVersion` (§3.4) |
| ACLED unverified at design time | Verified in batch 2 before authoring; documented fallbacks (§5.5) |
| Style reload discards engine sources and layers | Re-mount on `styledata` (§2.3) |

---

## 9. Success criteria

Inherited from the Plan 1 spec, plus what this plan adds:

1. Adding a layer whose upstream returns clean JSON requires **one new JSON file** in
   `/app/layers` plus a reload action — no code change, no rebuild, no container restart.
2. Adding a layer needing real parsing requires **one JSON file plus one adapter function**.
3. `CLICKABLE_LAYERS`, the hover array, the `sources` array, the `setVis` block and
   `LAYER_GROUPS` no longer exist as hand-maintained lists.
4. All popup escaping and colour resolution passes through one tested code path.
5. A failed initial fetch retries rather than leaving a layer permanently empty.
6. `war_alerts`, `balloons`, `radiation` and `conflict_zones` are working, toggleable layers.
7. Operators can supply every declared credential through the UI without editing `.env`.
8. Existing `?layers=` share links continue to resolve to the same layers.
9. **Every layer in the panel is manifest-driven**; no layer retains a hand-written
   `addLayer`/`setGeo`/`setVis`/click-handler path.
10. **A layer that is empty can be diagnosed from the UI** — registry errors, per-layer fetch
    state and recent requests are all visible without reading container logs.
11. A tile-backed overlay (weather radar, flood map, 3D buildings) is expressible as a drop-in
    manifest with no code.

---

## 10. Deferred, and deliberately not in this plan

**CCTV level-of-detail rendering.** Recorded in §8a of the Plan 1 spec and still deferred. CCTV
migrates in batch 5 **preserving today's behaviour exactly**; distance-based LOD tiering, video
playback debouncing and decoder caps land afterwards as their own feature, against a migrated
and verified layer. Bundling a behaviour change into a structural migration would make any
regression impossible to attribute. The seven open design questions that feature needs answered
are listed in the Plan 1 spec and are not reopened here.

**Browser-supplied manifests and remote manifest catalogues.** Out of scope in Plan 1 and still
out of scope. Adding them later stays purely additive: a third manifest source plus a host
allowlist and per-IP rate limiting on `/api/layer-source`. The manifest schema does not need to
change to accommodate it.

**Non-toggle map features.** Drawing, directions, routes, ArcGIS imports, user location, watched
airports, IP sweep and scan targets stay owned by `OsirisMap.tsx` and are untouched.
