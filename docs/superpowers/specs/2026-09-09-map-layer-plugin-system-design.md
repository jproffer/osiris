# OSIRIS Map Layer Plugin System — Design

**Date:** 2026-09-09
**Status:** Approved design, ready for implementation planning
**Scope:** Architectural — restructures how map rendering, data loading and layer-toggle UI fit together

---

## 1. Problem

Adding one map layer to OSIRIS requires editing four files in six or more places:

1. A new API route under `src/app/api/<name>/route.ts`.
2. One entry in `LAYER_GROUPS` in `src/components/LayerPanel.tsx`.
3. In `src/app/page.tsx`: a default flag in the `activeLayers` state object, plus an
   `if (activeLayers.x && !layerFetchedRef.current.has('x')) {…}` block in a shared effect,
   plus (sometimes) a polling interval and a viewport-refetch effect.
4. In `src/components/OsirisMap.tsx` (3,096 lines): the source name appended to a `sources`
   array, one or more `map.addLayer(...)` calls, an entry in `CLICKABLE_LAYERS`, an entry in
   a separate hover-cursor array, a `map.on('click', …)` handler building popup HTML, a
   `useEffect` calling `setGeo(...)`, and a `setVis(...)` call.

The duplication is not merely tedious — it has produced live bugs, because the same layer id
is written by hand into four independent lists that can and do drift apart.

### Verified inventory of the current system

| Measure | Count |
|---|---|
| Toggles in `LAYER_GROUPS` | 31, across 10 groups |
| Keys in `activeLayers` | 37 |
| Pre-allocated GeoJSON sources in `OsirisMap` | 41 |
| `map.addLayer(...)` calls | 99 |
| `map.on('click', …)` handlers | 29 |
| `setGeo(...)` calls | 48 |
| `setVis(...)` calls | 33 |

**Seven rendering modalities exist**, not one:

1. GeoJSON source + circle/symbol/line layers (the majority).
2. GeoJSON + an animation loop — `malware` (a `setInterval` beacon pulse), `cyber_attacks`
   (a `requestAnimationFrame` paint-property mutation loop).
3. A hand-written WebGL `CustomLayerInterface` with GPU pixel-picking — `satellites`,
   in `src/lib/satellite-layer.ts`.
4. Client-computed geometry with no fetch — the day/night solar terminator, `network-mesh`
   (derived from malware data), `sdk-links` (derived from submarine cables).
5. Basemap/style mutation — `terrain_3d` adds a vector source and a `fill-extrusion` layer on demand.
6. React DOM overlays keyed off layer state — `CctvPreviews`, `LiveNewsPreviews`.
7. Map features with no toggle at all — drawing, directions, ArcGIS imports, user location,
   watched airports, IP sweep, scan targets. **These are out of scope.**

**Seven data-loading modalities exist:** fetch-once-on-toggle; fetch-once plus interval poll;
debounced viewport `moveend` re-fetch-and-merge (CCTV, ArcGIS); SSE stream (malware); static
file fetch (`/data/submarine-cables.json`); self-fetching inside `OsirisMap` (conflicts); and none.

### Accumulated defects found during inventory

| Item | State |
|---|---|
| `war_alerts` | `activeLayers` key + two allocated sources (`war-alerts-targets`, `war-alerts-lines`); zero layers, zero data, no toggle |
| `balloons`, `radiation` | Complete render paths, popups, `setVis`, `setGeo`, fetch **and 5-minute polling** against `/api/balloons` and `/api/radiation` — **neither route exists** |
| `sdk_air`, `sdk_naval` | Default-on, six layers rendered visible, but `sdk-links` is only ever fed `domain: 'SEA'` features; the AIR/INTEL filters have never matched anything |
| `sdk-entities` | Source allocated, only ever `setGeo(…, [])`. `LayerPanel` shows the `sdk_sea` row a count read from `data.sdk_entities` — an array `page.tsx` computes but the map never draws |
| `scm-dots` click handler | Registered for a layer that is never added |
| `CLICKABLE_LAYERS` | Names `flight-dots`/`military-dots`/`jet-dots`/`private-dots`; the real ids are `fl-commercial`/`fl-military`/`fl-jets`/`fl-private` |
| `conflict_zones` | Not in `activeLayers`; `!== false` makes it permanently on, self-fetching, with no way to turn it off |
| `internet_outages` | Read by `setVis`, never defined anywhere |

Two of these are user-visible bugs:

- **Aircraft click-stealing.** The satellite GPU pick defers to "layers with their own click
  handler" by testing `CLICKABLE_LAYERS`. Because the flight ids in that set are wrong, the
  test never matches an aircraft, so clicking a plane can be captured by a satellite behind
  it — the exact failure the code comment says the check exists to prevent.
- **`?layers=balloons` enables a 404-poller.** The URL restore does
  `Object.keys(next).forEach(k => next[k] = active.includes(k))`, so a shared link can switch
  on a layer that then polls a non-existent route every five minutes forever.

**Escaping is applied per handler and roughly a third omit it.** Verified in `OsirisMap.tsx`:
`rad-dots`, `ship-dots`, `balloon-dots`, `infra-dots`, `maritime-dots` and `choke-dots` all
interpolate upstream-controlled strings into popup HTML with no `htmlEsc`; `weather-dots`
places `p.source` directly into an `href` with no `urlSafe` check, so a `javascript:` URL from
a third-party feed lands in an anchor. All of these values originate in external OSINT APIs.

**A retry bug affects 17 layers.** The helper `loadLayerOnce` marks a layer fetched *before*
awaiting (so a mid-flight re-render cannot double-fetch) and *releases the mark if nothing
landed* — its comment states that otherwise "one failed request leaves the layer permanently
empty." Only two layers use it. Seventeen others do:

```js
fetchEndpoint('/api/fires');            // not awaited, result ignored
layerFetchedRef.current.add('fires');   // marked regardless of outcome
```

One timeout leaves that layer empty for the rest of the session, with no retry and no indication.

---

## 2. Decisions taken

| # | Decision | Rationale |
|---|---|---|
| D1 | **Runtime plugin host.** Layers are serializable JSON manifests loadable without a rebuild; exotic layers use a code escape hatch. | User decision. |
| D2 | **Generic manifest-driven fetch endpoint** (`/api/layer-source`) with **named adapters** for sources needing real parsing. | A manifest cannot express H3 decoding, CSV date-fallback, or CCTV's 40-source fan-out. |
| D3 | **Manifests ship in-repo plus an operator drop-in directory.** Browser-supplied and remote-catalog manifests are out of scope. | Matches the self-hosted Docker/CasaOS distribution model; adds essentially no attack surface. |
| D4 | **Typed declarative popup spec**, with named adapters for `flights` and `satellites` and a `panel` action for `cctv`/`live_news`. | Covers ~24 of 29 handlers; makes escaping structural. |
| D5 | **Revive `war_alerts`, `balloons`, `radiation` and `conflict_zones` as working plugins.** Fix the `CLICKABLE_LAYERS` bug. | User decision. |
| D6 | **Standalone engine in `src/lib/layers/`, thin React shell in `OsirisMap.tsx`.** | This repo tests `src/lib/**/*.test.ts` under vitest's `node` environment; nothing in a `.tsx` component is testable here. |
| D7 | **Manifests may declare required credentials; operators enter them in-app.** | User requirement. |

### Explicitly out of scope

- Browser-supplied manifests (a visitor pasting a manifest into the UI) and remote manifest
  catalogues. Adding browser-supplied manifests later is purely additive — a third manifest
  source plus a host allowlist and per-IP rate limiting on `/api/layer-source`. The manifest
  schema does not need to change to accommodate it. **Recorded as a deliberate exclusion.**
- Non-toggle map features: drawing, directions, routes, ArcGIS imports, user location,
  watched airports, IP sweep, scan targets. These stay owned by `OsirisMap.tsx`.

---

## 3. Manifest schema

One layer is one JSON file. Types are TypeScript; all values are plain JSON.

```ts
interface LayerManifest {
  id: string;              // 'gps_jamming' — also the activeLayers key and source-id root
  label: string;           // 'GPS/GNSS Jamming' — the LayerPanel row
  group: string;           // 'SIGNALS' — key into the group table
  defaultOn?: boolean;     // replaces the hand-kept activeLayers defaults
  parent?: string;         // sub-layer, e.g. cctv_previews → cctv
  countFrom?: string;      // which dataset feeds the panel count; defaults to the only one

  requiredConfig?: ConfigFieldSpec[];

  // Sugar for the common single-dataset case; normalised to `datasets` by the validator.
  source?: SourceSpec;
  layers?: MapLayerSpec[];
  datasets?: DatasetSpec[];

  variants?: VariantSpec[]; // several panel toggles over one fetch
  render?: RenderSpec;      // defaults to { kind: 'geojson' }
  interaction?: InteractionSpec;
}

interface DatasetSpec {
  key: string;                 // source-id suffix; 'default' when singular
  source: SourceSpec;
  layers: MapLayerSpec[];
  legacyKey?: string;          // compatibility projection — see §6
}

interface VariantSpec {
  id: string;                  // its own activeLayers key and panel row
  label: string;
  dataset?: string;            // its own dataset (different arrayPath, same fetch)
  filter?: unknown[];          // or a MapLibre-style predicate over the shared dataset
  defaultOn?: boolean;
}
```

### Sources

```ts
type SourceSpec =
  | { kind: 'http'; url: string; format: 'json' | 'geojson' | 'csv';
      arrayPath?: string; lat: string; lng: string;
      properties: Record<string, string>;   // featureProp -> path in the upstream row
      headers?: Record<string, string>;
      cacheTtlMs?: number; refresh: RefreshSpec }
  | { kind: 'adapter'; adapter: string; params?: Record<string, unknown>; refresh: RefreshSpec }
  | { kind: 'computed'; compute: string }   // 'solar-terminator' | 'malware-mesh' | 'sdk-links'
  | { kind: 'none' };                       // display-only, e.g. terrain_3d

type RefreshSpec =
  | { mode: 'once' }
  | { mode: 'poll'; intervalMs: number }
  | { mode: 'viewport'; debounceMs: number; mergeKey: string }
  | { mode: 'stream'; path: string };
```

`url` and `headers` may contain two substitution forms, both expanded **server-side only**:

- `{config.KEY}` — a declared credential (§4).
- A small closed set of date tokens: `{today}`, `{today-1d}`, `{today-7d}`, formatted `YYYY-MM-DD`.
  This is not a template language. `{today-1d}` exists because the Safecast `since` parameter
  requires it.

### Rendering

```ts
type RenderSpec =
  | { kind: 'geojson' }                     // default — MapLayerSpec[] drives it
  | { kind: 'custom'; renderer: string }    // 'satellites'
  | { kind: 'overlay'; component: string }; // 'cctv-previews' | 'live-news-previews'

interface MapLayerSpec {
  suffix: string;                           // final layer id is `${manifest.id}--${suffix}`
  type: 'circle' | 'symbol' | 'line' | 'fill' | 'fill-extrusion';
  paint?: Record<string, unknown>;          // raw MapLibre expressions, passed through
  layout?: Record<string, unknown>;
  filter?: unknown[];
  minzoom?: number;
  maxzoom?: number;
  clickable?: boolean;                      // drives hit-testing AND the hover cursor
}
```

### Interaction and popups

```ts
type InteractionSpec =
  | { kind: 'popup'; popup: PopupSpec }
  | { kind: 'adapter'; adapter: string }    // 'flights' | 'satellites'
  | { kind: 'panel'; panel: string };       // 'cctv' | 'live_news'

interface PopupSpec {
  accent: ValueSpec;
  title: ValueSpec;
  subtitle?: ValueSpec;
  fields: { label: string; property: string; format?: Format; suffix?: string }[];
  links?: { label: string; url: string }[]; // '{prop}' interpolation, urlSafe-checked
}

type ValueSpec =
  | string                                                     // literal
  | { property: string }                                       // read a feature property
  | { match: { property: string; cases: Record<string, string>;
               fallback: string; mode?: 'equals' | 'contains' } }
  | { range: { property: string; stops: [number, string][]; fallback: string } };

type Format = 'text' | 'number' | 'thousands' | 'fixed1' | 'fixed2' | 'fixed3'
            | 'percent' | 'date' | 'datetime' | 'upper';
```

`ValueSpec` has four forms because four are required by real layers:

- literal — most layers use a fixed accent colour.
- `property` — titles read from a feature field.
- `match` with `equals` — `gdelt-dots`' six-entry `KIND` lookup; `cf-outage-dots`' `ongoing` branch.
- `match` with `contains` — `infra-dots` derives its accent from `p.status.includes('SEISMIC RISK')`.
- `range` — numeric thresholds (radiation banding, earthquake magnitude, outage size), which
  neither equality nor substring matching can express.

`format.ts` absorbs a MapLibre behaviour: feature properties are serialised, so booleans arrive
as the string `'true'` and numbers as strings. The `cf-outage` handler already carries
`p.ongoing === true || p.ongoing === 'true'` with a comment explaining this. Coercion is
implemented once and tested, rather than rediscovered per layer.

### Worked example — `radiation`, requiring no server code

```json
{
  "id": "radiation", "label": "Radiation Monitors", "group": "HAZARD",
  "source": {
    "kind": "http", "format": "json",
    "url": "https://api.safecast.org/measurements.json?since={today-1d}&limit=2000&unit=cpm",
    "lat": "latitude", "lng": "longitude",
    "properties": { "value": "value", "unit": "unit", "captured": "captured_at",
                    "device": "device_id", "place": "location_name" },
    "cacheTtlMs": 900000, "refresh": { "mode": "poll", "intervalMs": 900000 }
  },
  "layers": [
    { "suffix": "glow", "type": "circle",
      "paint": { "circle-radius": ["interpolate",["linear"],["zoom"],1,10,5,20,10,40],
                 "circle-color": "#7E57C2", "circle-opacity": 0.12, "circle-blur": 1 } },
    { "suffix": "dots", "type": "circle", "clickable": true,
      "paint": { "circle-radius": ["interpolate",["linear"],["zoom"],1,4,5,6,10,8],
                 "circle-color": ["interpolate",["linear"],["get","value"],
                                  0,"#7E57C2", 100,"#E65100", 350,"#D32F2F"],
                 "circle-opacity": 0.85 } }
  ],
  "interaction": {
    "kind": "popup",
    "popup": {
      "accent": { "range": { "property": "value",
                             "stops": [[350,"#D32F2F"],[100,"#E65100"]],
                             "fallback": "#7E57C2" } },
      "title": { "property": "place" },
      "fields": [
        { "label": "READING", "property": "value", "format": "number", "suffix": " cpm" },
        { "label": "CAPTURED", "property": "captured", "format": "datetime" }
      ]
    }
  }
}
```

### Schema design principles

**Layer ids are derived, never authored.** A manifest names a `suffix`; the engine composes
`${id}--${suffix}`. The clickable set, hover-cursor set and visibility lists are *computed*.
This structurally eliminates the class of bug that `CLICKABLE_LAYERS` represents — there is no
second hand-maintained list left to drift from the first.

**MapLibre paint expressions pass through raw.** No styling DSL is invented. MapLibre's
expression syntax is already JSON, is what every existing layer is written in, and is
documented externally. Migration becomes copy-paste and expressiveness is uncapped.

**Multi-dataset layers use `datasets`; single-dataset layers do not pay for it.** `maritime`
owns three sources and nine map layers; `piracy` owns one and one. The validator normalises
the sugar so the engine only ever sees `datasets`.

**The upstream URL never leaves the server.** The browser calls
`/api/layer-source?layer=radiation`. It never transmits a URL, so the endpoint cannot be
driven as an open fetch proxy by an anonymous visitor; the reachable host set is exactly what
the operator installed.

---

## 4. Declared configuration and in-app credential entry

```ts
requiredConfig?: ConfigFieldSpec[];

interface ConfigFieldSpec {
  key: string;          // 'ACLED_API_KEY'
  label: string;        // 'ACLED API key'
  hint?: string;        // 'Free — register at acleddata.com'
  docsUrl?: string;
  optional?: boolean;   // e.g. a key that only raises a rate limit
}
```

**This replaces `requires`.** The existing `requires: 'cloudflare'` hides the row entirely,
which tells an operator nothing — they cannot discover the layer exists, let alone that a
token would enable it. Under `requiredConfig` the row *renders*, dimmed with a key glyph and
its label intact; clicking opens an inline form built from the declared fields.
`cf_outages` and `cf_attacks` migrate from hidden-when-unconfigured to configurable-in-app.

### Persistence

A bind mount `./config:/app/config` holding `layer-config.json` at mode `0600`, accessed
through `src/lib/layers/config-store.ts`. Deliberately **not** the `./layers` directory:
manifests are shareable and commit-friendly, secrets are neither, and one `.gitignore` mistake
must not publish a token. The file is never served statically.

### Precedence: environment wins

If `ACLED_API_KEY` is set in the environment it is used, and the UI shows the field as
*"set by environment"*, read-only. An operator who configured a key in `docker-compose.yml`
must never have it silently shadowed by something typed into a browser. Every existing key
(`FIRMS_API_KEY`, `AIS_API_KEY`, `OPENSKY_CLIENT_ID`/`_SECRET`, `N2YO_API_KEY`, `SCANNER_KEY`)
continues to behave exactly as today.

### Endpoints are asymmetric by design

- `GET /api/layer-config` returns **status only** —
  `{ war_alerts: { ACLED_API_KEY: { configured: true, source: 'env' } } }`.
  Never a value, not even masked. There is no read path for a stored secret from anywhere.
- `POST /api/layer-config` writes a value, then **probes the upstream once** and reports
  whether it authenticated. A mistyped token must fail visibly at entry, not silently produce
  an empty layer an hour later.
- `DELETE /api/layer-config` clears one field.

### The no-auth reality

OSIRIS ships with no authentication — `src/middleware.ts` only fires analytics — so anyone who
can reach the instance can reach this form. Write-only plus status-only reads means a visitor
**cannot exfiltrate** the operator's key, which is the genuine risk; they can overwrite one,
breaking a layer until the operator re-enters it.

Two things make this proportionate. It is not a new class of exposure: an unauthenticated
visitor can already drive every existing route and consume the operator's configured keys
through `/api/flights` and similar. And the blast radius is a layer going dark, not a
credential leaking.

For instances exposed to the internet, an optional **`OSIRIS_ADMIN_TOKEN`**: when unset — the
default — the config endpoints are open and the self-host experience stays zero-config,
matching how `SCANNER_KEY` is already treated as optional; when set, writes require it and the
UI prompts for it once per session.

---

## 5. The layer engine

```
src/lib/layers/
  types.ts          manifest types (§3)
  validate.ts       parse → normalise sugar → validate; returns errors, never throws
  registry.ts       load and merge builtin + drop-in manifests; resolve config status
  engine.ts         LayerEngine
  format.ts         the closed Format vocabulary — pure
  popup.ts          PopupSpec → HTML string — pure, centrally escaped
  config-store.ts   the runtime credential store (§4)
  loader.ts         pure load planner (§6)
  groups.ts         group key → { icon, fullLabel, order }
  adapters/         named server-side source adapters
  computed/         solar-terminator, malware-mesh, sdk-links
  renderers/        custom renderers — 'satellites' wraps src/lib/satellite-layer.ts
  __fixtures__/     captured feature properties for popup regression tests (§8)
```

### Engine surface

```ts
class LayerEngine {
  constructor(map: MapLike, opts: { onSelect(sel: Selection): void; palette: MapPalette });
  mount(manifests: LayerManifest[]): void;      // add every source + layer once, hidden
  setActive(ids: ReadonlySet<string>): void;    // visibility only
  setData(layerId: string, datasetKey: string, rows: unknown[]): void;
  setPalette(p: MapPalette): void;
  destroy(): void;
}
```

`MapLike` is a narrow hand-written interface — `addSource`, `addLayer`, `getLayer`,
`getSource`, `setLayoutProperty`, `setPaintProperty`, `queryRenderedFeatures`, `on`, `off`.
This is the testability lever: a fake `MapLike` is roughly 40 lines, so mount, activation and
click routing get real unit tests in the repo's existing `node`-environment vitest, alongside
`draw.test.ts` and `aoi.test.ts`. `popup.ts` and `format.ts` are pure string functions and test
with no map at all — which finally puts the XSS escaping under test.

### Three mechanisms

**Derived sets, never authored ones.** The engine computes the clickable set, the hover-cursor
set and each layer's visibility list from the mounted manifests. The four hand-maintained lists
in `OsirisMap.tsx` — `sources`, `CLICKABLE_LAYERS`, the hover array and the `setVis` block —
cease to exist.

**One click handler, not 29.** The engine registers a single `click` and a single `mousemove`.
On click it runs `queryRenderedFeatures`, finds the topmost feature whose layer id is in the
derived clickable set, and dispatches by that layer's `InteractionSpec`: `popup` renders via
`popup.ts`; `panel` calls `onSelect` (how CCTV and live-news open their React panels today);
`adapter` calls a named function. Custom renderers contribute a `hitTest` hook, so the
satellite GPU pick joins the same ordering and correctly defers to real layer ids.

**Palette tokens resolve in the engine.** Paint values may contain `{palette.cctv}`; the engine
substitutes on mount and re-applies on the existing `STYLE_EVENT`. This generalises the two
hardcoded `setPaintProperty` calls for `cctv-dots`/`cctv-label` into behaviour every layer gets.

**Z-order** is registry order, with all manifest layers inserted before a sentinel layer, so
the bespoke overlays `OsirisMap` retains — routes, drawing, user location, watched airports,
sweep — stay on top exactly as they do now.

### Popup adapters

```ts
type PopupAdapter = (feature, ctx) => { html: string; onMount?(el: HTMLElement): () => void };
```

`onMount` lets the flights adapter run its two async enrichment fetches (`/api/aircraft`,
`/api/flight-route`) and bind its watch button against a real element reference — replacing the
current `document.getElementById` lookups and the `window.osirisWatchFlight` global, and giving
it a teardown so a late reply cannot write into a closed popup.

### Generated panel UI

`LAYER_GROUPS` in `LayerPanel.tsx` is deleted. Rows come from manifests: `label`, `parent` for
indented sub-rows and their stem, `variants` as sibling rows, counts via `countFrom`. Group
*metadata* stays in code (`groups.ts`) because the icons are React components and cannot be
JSON. Existing group behaviours — pinning, ALL/NONE, the active-count badge, the mobile layout
— are untouched; only their input changes.

Two properties the runtime-plugin promise requires:

- **An unknown group must not swallow the layer.** A drop-in manifest naming a nonexistent
  group falls into a default `PLUGINS` group. Silently disappearing is the worst possible
  failure mode for a drop-in file.
- **Bad manifests must be visible.** `validate.ts` returns errors rather than throwing; the
  registry retains them and the panel shows a diagnostics entry naming the file and the fault
  (e.g. *"layers/foo.json: unknown format 'jsom'"*). Hunting container logs is not a debugging story.

---

## 6. Data loading

Two pieces: `src/lib/layers/loader.ts`, a **pure planner**, and `src/hooks/useLayerData.ts`, a
thin executor.

```ts
function planLoads(
  manifests: LayerManifest[], active: ReadonlySet<string>,
  state: LoadState, viewport: Viewport | null, now: number,
): LoadPlan[];
```

The hook executes plans and writes results into the existing `dataRef` + `dataVersion` store.
That indirection is a deliberate performance choice — one re-render per refresh rather than per
render — and is retained.

**One manifest is one fetch, however many toggles it has.** The engine fetches when *any*
variant is active. This turns three hand-written special cases into default behaviour:
`flights`' four toggles off one `/api/flights` call become four datasets; `satellites`' six
category toggles become six filters over one array; `cf_outages` + `cf_attacks` sharing one
`/api/cloudflare-radar` request becomes ordinary. `maritime`'s three sources likewise.

| Mode | Behaviour | Existing precedent |
|---|---|---|
| `once` | Fetch on first activation | 17 layers |
| `poll` | `once`, plus an interval while active, `skipWhenHidden: true` | flights, maritime, cyber_attacks |
| `viewport` | Debounced on `moveend`; merge into accumulated rows by `mergeKey` | cctv (`id`), arcgis (`OBJECTID`) |
| `stream` | SSE subscription while active | malware |

`skipWhenHidden` stays **background-polls-only**. A user-initiated load — a toggle click, or
first paint in a background tab — must never be skipped, because the caller then believes it
fetched and the layer stays empty until a reload. This distinction is already documented in
`fetchEndpoint` and is preserved verbatim.

**The 17-layer retry bug is fixed by generalisation.** The engine has one code path, which
implements `loadLayerOnce`'s correct semantics: mark before awaiting, release the mark if
nothing landed.

**The `legacyKey` compatibility projection.** Each dataset may declare
`legacyKey: 'commercial_flights'`. The store publishes under both the canonical
`layerId.datasetKey` and the legacy flat key. This is required because the flat keys are read
well beyond the map: `LiveAlerts.tsx` reads `data.earthquakes`; `page.tsx` reads
`data.commercial_flights`, `data.private_flights`, `data.private_jets`,
`data.military_flights`, `data.maritime_ships`, `data.earthquakes` and `data.cameras` for the
SDK entity computation, the flight counter and the HUD camera count.

It is also what makes a *staged* migration possible: during stages 2–4 some layers are
manifest-driven and some are still hand-written, and both must read from one store. The
projection is a documented removal candidate for stage 5, not permanent API.

**Existing oddities resolved:** `conflicts` stops self-fetching inside `OsirisMap` and becomes
an ordinary manifest. Submarine cables become `{ kind: 'http' }` pointing at
`/data/submarine-cables.json` — the loader does not care that the host is itself. `day_night`,
`malware-mesh` and `sdk-links` become `{ kind: 'computed' }` and never touch the network.

---

## 7. Revived layers, retirements and the click fix

### `radiation` — pure manifest, no server code

`https://api.safecast.org/measurements.json?since={today-1d}&limit=2000&unit=cpm`.
**Verified live and keyless**, returning current rows in a single flat array. `unit=cpm` is
pinned — verified to work — because Safecast mixes `cpm` and `usv` and plotting both on one
colour ramp would be misleading. Fields map directly: `latitude`, `longitude`, `value`,
`captured_at`, `device_id`, `location_name`. The DANGER/WARNING/normal banding the old popup
showed becomes a `range` ValueSpec; the paint ramp is an ordinary `interpolate`.
**Proves the declarative path end-to-end.**

### `balloons` — named adapter

`https://api.v2.sondehub.org/amateur/telemetry?duration=1d`. **Verified live and keyless**,
returning ~62 payloads. The response is a two-level object — callsign → timestamp → frame — so
the adapter selects the newest frame per callsign. This is not expressible as an array path,
which is precisely why the escape hatch exists. `lat`, `lon`, `alt`, `vel_h`, `temp`, `sats`,
`type`, `modulation` map onto the fields the old popup showed; the ascending/descending/floating
`status` is derived from vertical rate. `duration` accepts only an enum of values.

Two variants off one fetch group: **Amateur Balloons** (`/amateur/telemetry`, `duration=1d`,
default on) and **Radiosondes** (`/sondes/telemetry`, `duration=1h`, far higher volume, default
off). **Proves the adapter path.**

### `war_alerts` — ACLED, key-gated

No keyless war-alert feed exists: `api.ukrainealarm.com` returns 403, `alerts.in.ua` returns
401 *"API token required"*, `sirens.in.ua` is unreachable. ACLED provides global armed-conflict
events with coordinates, dates, actors and fatalities, on a free key obtained by registration.

`war_alerts` declares `requiredConfig: [{ key: 'ACLED_API_KEY', … }]` and is therefore the
**showcase for the credential UI**: the operator sees the layer, sees that a key is required,
pastes one, and the write-and-probe confirms it authenticated. The unused `war-alerts-lines`
source is dropped rather than inventing trajectory data ACLED does not provide.

*Implementation note:* the exact ACLED endpoint, parameter names and response shape must be
verified against live API documentation during stage 2, in the same way Safecast and SondeHub
were verified for this design.

### `conflict_zones` — a real toggle

Becomes a manifest with a real `LayerPanel` row in the **THREAT** group, `defaultOn: true`.
Default-on preserves today's behaviour exactly (`!== false` makes it permanently visible) while
making it switchable for the first time. It stops self-fetching inside `OsirisMap` and becomes
an adapter over the existing `/api/conflicts` route, merging `zones` and `liveEvents` as the
current code does. **The six-zone hardcoded fallback on fetch failure is preserved** — that is
deliberate resilience, not clutter.

### Retirements

`sdk_air`, `sdk_naval`, their six permanently-empty map layers, the `sdk-entities` source and
the ~40-line SDK entity computation in `page.tsx` are removed. `sdk_sea` is kept, with its panel
count sourced from the cables dataset it actually renders.

Also removed during stage 5: the `scm-dots` handler, `war-alerts-lines`, `internet_outages`,
and the phantom hover ids (`sdk-sea-glow`, `sdk-sea-atmo`).

### The click bug — fixed first, separately

`CLICKABLE_LAYERS` names `flight-dots`/`military-dots`/`jet-dots`/`private-dots`; the real ids
are `fl-commercial`/`fl-military`/`fl-jets`/`fl-private`. This is fixed as a **standalone
one-line change before any engine work**. It is a user-visible bug today, the fix is
independently verifiable, and it should not wait behind a migration. The engine later makes it
unrecurrable by deriving the set; that is the permanent fix, but the immediate one ships first.

---

## 8. Staged rollout

### Stage 0 — baseline and the click fix

Commit the currently-uncommitted working tree: the four new layers (`gps-jamming`, `piracy`,
`power-outages`, `dark-fleet`) are untracked and `page.tsx`, `LayerPanel.tsx`, `OsirisMap.tsx`
are modified on `master`. A migration this size needs a committed baseline to diff and revert
against. Then the standalone `CLICKABLE_LAYERS` fix as its own commit. Then branch.

### Stage 1 — engine, no behaviour change

`types.ts`, `validate.ts`, `format.ts`, `popup.ts`, `config-store.ts`, `registry.ts`,
`loader.ts`, `groups.ts`, `engine.ts` with the `MapLike` fake; plus `/api/layer-source`,
`/api/layer-config`, and the two `docker-compose` volume mounts (`./layers`, `./config`).
**All new files; nothing wired into the UI.** Zero risk to running behaviour, and everything is
unit-tested before it renders a pixel.

### Stage 2 — proof set, running in parallel

| Layer | Proves |
|---|---|
| `radiation` | The pure declarative path — no server code |
| `balloons` | The named-adapter path |
| `war_alerts` | `requiredConfig` and the credential UI end-to-end |
| `gps_jamming` | An adapter over CSV + H3 + date-fallback |
| `piracy`, `power_outages` | Declarative popups with a known-good predecessor to diff against |

Engine and hardcoded paths coexist; the `legacyKey` projection makes this possible.
`LayerPanel` renders manifest rows for migrated layers and `LAYER_GROUPS` rows for the rest.
**This is the stage at which the design is validated** — on six layers rather than thirty.

### Stage 3 — bulk mechanical migration

In reviewable batches: hazards (`earthquakes`, `fires`, `weather`) → threat (`infrastructure`,
`global_incidents`, `gdelt_events`, `conflict_zones`) → network (`cf_outages`, `cf_attacks`) →
maritime (`maritime`'s three datasets, `sdk_sea`) → surveillance (`cctv`, `cctv_previews`,
`live_news`) → aviation (`flights`' four variants plus the flights popup adapter).

### Stage 4 — exotic layers

Deliberately last: `satellites` (custom renderer wrapping `satellite-layer.ts` plus its
`hitTest` hook), `malware` (SSE plus the `setInterval` beacon pulse), `cyber_attacks` (the rAF
paint-mutation loop), the `computed` layers (`day_night`, `malware-mesh`, `sdk-links`), and
`terrain_3d`.

### Stage 5 — cleanup

Delete the `legacyKey` projection, `LAYER_GROUPS`, the `sources` array, `CLICKABLE_LAYERS`, the
hover array, the `setVis` block, the `scm-dots` handler, `war-alerts-lines`,
`internet_outages`, and the retired SDK code. This is where `OsirisMap.tsx` becomes small.

### Verification

There is no component test harness and no E2E rig in this repo, so the migration is not claimed
to be covered by automated tests. Three concrete mechanisms instead:

**Popup fixtures — the one that matters.** Transcribing 24 popups field-by-field is the
highest-volume, most error-prone work in the plan, and it is exactly the work that `popup.ts`
being pure makes testable. Before migrating a layer, capture one real feature's properties from
the live API into `src/lib/layers/__fixtures__/<layer>.json`. After migrating, a test asserts
the rendered HTML contains every label and formatted value the old popup produced.

**A per-layer manual checklist**, applied at each batch: toggle on → panel count matches the old
count; markers land in the same places; click → popup fields and links match; toggle off →
source clears; theme switch → colours still track the palette.

**Gates per stage:** `npm test`, `npm run lint`, `npm run build` all green before a batch is done.

### Risks

- **Satellites** are the highest-risk migration — GPU pick, altitude rendering, orbit fetch,
  selection resync across catalogue refreshes. Scheduled last; may reasonably remain a custom
  renderer with a thin manifest wrapper rather than being genuinely absorbed.
- **CCTV volume** — 10,000+ cameras through a generic path needs a performance check against
  the current specialised one.
- **Z-order** — the 99 `addLayer` calls currently establish ordering implicitly by sequence;
  the sentinel approach must reproduce it.
- **`?layers=` URLs must keep working.** Manifest ids are exactly today's `activeLayers` keys,
  so shared links survive. This constrains naming: `private` is **not** renamed to
  `private_flights`, however tempting.
- **ACLED integration is unverified** at design time, unlike Safecast and SondeHub. If its API
  proves unsuitable, the fallbacks are a GDELT `quad == 4` subset (keyless, but overlaps
  `gdelt_events`) or a Ukraine-specific air-raid feed (also key-gated, narrower).

---

## 9. Success criteria

1. Adding a layer whose upstream returns clean JSON requires **one new JSON file** and no
   code changes, no rebuild, and no restart beyond re-reading the drop-in directory.
2. Adding a layer needing real parsing requires **one JSON file plus one adapter function**.
3. `CLICKABLE_LAYERS`, the hover array, the `sources` array and the `setVis` block no longer
   exist as hand-maintained lists.
4. All popup escaping passes through one tested code path.
5. A failed initial fetch retries rather than leaving a layer permanently empty.
6. `war_alerts`, `balloons`, `radiation` and `conflict_zones` are working, toggleable layers.
7. Operators can supply required credentials through the UI without editing `.env`.
8. Existing `?layers=` share links continue to resolve to the same layers.
