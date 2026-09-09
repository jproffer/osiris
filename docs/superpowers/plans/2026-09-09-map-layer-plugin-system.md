# Map Layer Plugin System Implementation Plan (Stages 0–1: Foundation)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and unit-test the complete manifest-driven layer engine, plus the two API routes that feed it, without wiring anything into the UI.

**Architecture:** Layers become JSON manifests. A pure library in `src/lib/layers/` validates them, plans their fetches, renders their popups and drives MapLibre through a narrow `MapLike` interface. Two Next.js routes serve layer data (`/api/layer-source`) and layer credentials (`/api/layer-config`).

**Scope of this plan:** Spec stages 0 and 1 only. Every file created here is **new**, and nothing existing is modified except the one-line click-bug fix in Task 1. The engine is fully unit-tested but not yet reachable from the UI, so this plan carries essentially no regression risk.

**Follow-on plans:**
- *Plan 2 — Stage 2 (proof set):* wires the engine into `OsirisMap`, `LayerPanel` and `page.tsx` alongside the existing code, then migrates `radiation`, `balloons`, `war_alerts`, `gps_jamming`, `piracy` and `power_outages`. Written once this plan lands, so it can be informed by what the engine's tests actually reveal.
- *Plan 3 — Stages 3–5:* bulk migration, exotic layers, deletion.
- *CCTV migrates in stage 3 preserving today's behaviour.* The distance-based level-of-detail rendering (§8a of the spec) is a separate feature requiring its own brainstorming pass, and lands after CCTV is migrated and verified.

**Tech Stack:** Next.js 16.2.6 (App Router), React 19.2.4, TypeScript 5, MapLibre GL 5.24.0, vitest 2.1.9, h3-js 4.5.0.

**Spec:** `docs/superpowers/specs/2026-09-09-map-layer-plugin-system-design.md`

## Global Constraints

- **Tests run under vitest's `node` environment** and only match `src/**/*.test.ts`. Nothing inside a `.tsx` file is testable. All logic that needs a test goes in a `.ts` file under `src/lib/`.
- **vitest has no globals.** Every test file must `import { describe, it, expect } from 'vitest';`.
- **Manifest ids are exactly today's `activeLayers` keys.** Do not rename. `private` stays `private`, not `private_flights` — `?layers=` share links depend on it.
- **The browser never sends an upstream URL.** It sends a layer id. `/api/layer-source` resolves id → manifest → URL server-side.
- **Credential values are never returned by any endpoint**, masked or otherwise. Status only.
- **Environment variables win** over stored credentials.
- **`OSIRIS_ADMIN_TOKEN` is unset by default**; when unset, config endpoints are open.
- **Nothing existing is deleted in this plan.** The engine runs alongside the current code. Deletion is stage 5, a separate plan.
- Commit after every task. Run `npm test` before each commit.

## Identifier Rules (used by every task)

```
sourceId(layerId, datasetKey)   = datasetKey === 'default' ? layerId : `${layerId}--${datasetKey}`
mapLayerId(layerId, key, suffix) = `${sourceId(layerId, key)}--${suffix}`
```

Example: `radiation` + `default` + `dots` → source `radiation`, layer `radiation--dots`.
Example: `maritime` + `ships` + `dots` → source `maritime--ships`, layer `maritime--ships--dots`.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/layers/types.ts` | Every manifest type. No logic. |
| `src/lib/layers/format.ts` | `coerce` (MapLibre string-serialisation) + `formatValue`. Pure. |
| `src/lib/layers/values.ts` | `resolveValue` for the four `ValueSpec` forms. Pure. |
| `src/lib/layers/popup.ts` | `htmlEsc`/`urlSafe`/`renderPopup`. Pure. The single escaping path. |
| `src/lib/layers/validate.ts` | Normalise sugar → `datasets`; collect errors, never throw. |
| `src/lib/layers/loader.ts` | Pure fetch planner. |
| `src/lib/layers/substitute.ts` | `{config.X}` and `{today-Nd}` expansion. Server-only. |
| `src/lib/layers/config-store.ts` | Credential store, env-wins precedence. Server-only. |
| `src/lib/layers/registry.ts` | Manifest discovery, merge, reload. Server-only. |
| `src/lib/layers/maplike.ts` | `MapLike` interface + `FakeMap` test double. |
| `src/lib/layers/engine.ts` | `LayerEngine`: mount, visibility, data, palette, interaction. |
| `src/lib/layers/groups.ts` | Group key → `{ icon, fullLabel, order }`. Holds React icons. |
| `src/lib/layers/adapters/index.ts` | Adapter registry + `SourceAdapter` contract. |
| `src/lib/layers/adapters/sondehub.ts` | Balloons. |
| `src/lib/layers/adapters/gpsJamming.ts` | CSV + H3 + date fallback. |
| `src/lib/layers/adapters/acled.ts` | War alerts, key-gated. |
| `src/lib/layers/manifests/*.json` | Built-in manifests. |
| `src/app/api/layer-source/route.ts` | Serves layer data. |
| `src/app/api/layer-config/route.ts` | Credential status/write/delete. |
| `src/hooks/useLayerData.ts` | Executes loader plans into `dataRef`. |

---

## Stage 0 — Baseline and the click fix

### Task 1: Commit the baseline and fix the aircraft click-stealing bug

**Files:**
- Modify: `src/components/OsirisMap.tsx:996-1001`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. This task is a bug fix and a clean git baseline.

**Context:** `CLICKABLE_LAYERS` is the set the satellite GPU pick tests to decide whether another layer already owns the click. It names `flight-dots`, `military-dots`, `jet-dots`, `private-dots` — none of which exist. The real ids, added at line 705-710, are `fl-commercial`, `fl-private`, `fl-jets`, `fl-military`. Because the names never match, clicking an aircraft can be captured by a satellite behind it.

- [ ] **Step 1: Commit the existing uncommitted work as the migration baseline**

```bash
cd /home/firewall/Projects/AI/osiris
git checkout master
git add src/app/api/gps-jamming src/app/api/piracy src/app/api/power-outages src/app/api/dark-fleet
git add src/app/page.tsx src/components/LayerPanel.tsx src/components/OsirisMap.tsx
git commit -m "feat(map): GPS jamming, piracy, power outages and dark-fleet layers

Also re-fetch imported ArcGIS layers and CCTV cameras on moveend, merged
into the accumulated set, so panning to a new area no longer shows an
empty layer."
```

- [ ] **Step 2: Verify the bug — confirm the phantom ids appear nowhere else**

Run: `grep -n "flight-dots\|military-dots\|jet-dots\|private-dots" src/components/OsirisMap.tsx`
Expected: exactly one hit, the `CLICKABLE_LAYERS` definition around line 1000. If any other line matches, stop and re-read before editing.

Run: `grep -n "id: 'fl-" src/components/OsirisMap.tsx`
Expected: four hits — `fl-commercial`, `fl-private`, `fl-jets`, `fl-military`.

- [ ] **Step 3: Fix the ids**

In `src/components/OsirisMap.tsx`, replace this line inside the `CLICKABLE_LAYERS` set:

```ts
      'cf-outage-dots','cf-attack-dots','flight-dots','military-dots','jet-dots','private-dots',
```

with:

```ts
      'cf-outage-dots','cf-attack-dots','fl-commercial','fl-military','fl-jets','fl-private',
```

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: build succeeds.

Manual check: start the app, enable an aviation layer and All Satellites, then click an aircraft icon. Expected: the aircraft popup opens. Before the fix, a satellite readout could open instead.

- [ ] **Step 5: Commit**

```bash
git add src/components/OsirisMap.tsx
git commit -m "fix(map): stop satellites stealing clicks from aircraft

CLICKABLE_LAYERS named flight-dots/military-dots/jet-dots/private-dots,
but the flight layers are fl-commercial/fl-military/fl-jets/fl-private.
The satellite pick tests that set to decide whether another layer already
owns the click, so the test never matched an aircraft and a satellite
behind one could take the click instead."
```

- [ ] **Step 6: Branch for the rest of the work**

```bash
git checkout -b feat/layer-plugin-system
```

---

## Stage 1 — The pure library

### Task 2: Manifest types and the format vocabulary

**Files:**
- Create: `src/lib/layers/types.ts`
- Create: `src/lib/layers/format.ts`
- Test: `src/lib/layers/format.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: every type below (used by all later tasks); `coerce(v: unknown): unknown`; `formatValue(v: unknown, format?: Format, suffix?: string): string`.

**Context:** MapLibre serialises feature properties, so a boolean arrives as the string `'true'` and a number as `'42'`. The existing `cf-outage-dots` handler carries `p.ongoing === true || p.ongoing === 'true'` with a comment explaining exactly this. `coerce` centralises that so no layer rediscovers it.

- [ ] **Step 1: Write `src/lib/layers/types.ts`**

```ts
/** Every manifest type. No logic lives here. */

export type Format =
  | 'text' | 'number' | 'thousands'
  | 'fixed1' | 'fixed2' | 'fixed3'
  | 'percent' | 'date' | 'datetime' | 'upper';

export type ValueSpec =
  | string
  | { property: string }
  | { match: { property: string; cases: Record<string, string>; fallback: string; mode?: 'equals' | 'contains' } }
  | { range: { property: string; stops: [number, string][]; fallback: string } };

export interface PopupFieldSpec { label: string; property: string; format?: Format; suffix?: string }
export interface PopupLinkSpec { label: string; url: string }

export interface PopupSpec {
  accent: ValueSpec;
  title: ValueSpec;
  subtitle?: ValueSpec;
  fields: PopupFieldSpec[];
  links?: PopupLinkSpec[];
}

export type InteractionSpec =
  | { kind: 'popup'; popup: PopupSpec }
  | { kind: 'adapter'; adapter: string }
  | { kind: 'panel'; panel: string };

export type RefreshSpec =
  | { mode: 'once' }
  | { mode: 'poll'; intervalMs: number }
  | { mode: 'viewport'; debounceMs: number; mergeKey: string }
  | { mode: 'stream'; path: string };

export type SourceSpec =
  | {
      kind: 'http';
      url: string;
      format: 'json' | 'geojson' | 'csv';
      arrayPath?: string;
      lat: string;
      lng: string;
      properties: Record<string, string>;
      headers?: Record<string, string>;
      cacheTtlMs?: number;
      refresh: RefreshSpec;
    }
  | { kind: 'adapter'; adapter: string; params?: Record<string, unknown>; refresh: RefreshSpec }
  | { kind: 'computed'; compute: string }
  | { kind: 'none' };

export interface MapLayerSpec {
  suffix: string;
  type: 'circle' | 'symbol' | 'line' | 'fill' | 'fill-extrusion';
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  filter?: unknown[];
  minzoom?: number;
  maxzoom?: number;
  clickable?: boolean;
}

export interface DatasetSpec {
  key: string;
  source: SourceSpec;
  layers: MapLayerSpec[];
  /** Also publish rows under this flat key, for consumers not yet migrated. */
  legacyKey?: string;
}

export interface VariantSpec {
  id: string;
  label: string;
  dataset?: string;
  filter?: unknown[];
  defaultOn?: boolean;
}

export interface ConfigFieldSpec {
  key: string;
  label: string;
  hint?: string;
  docsUrl?: string;
  optional?: boolean;
}

export type RenderSpec =
  | { kind: 'geojson' }
  | { kind: 'custom'; renderer: string }
  | { kind: 'overlay'; component: string };

export interface LayerManifest {
  id: string;
  label: string;
  group: string;
  defaultOn?: boolean;
  parent?: string;
  countFrom?: string;
  requiredConfig?: ConfigFieldSpec[];
  /** Sugar for a single dataset; normalised into `datasets` by validate.ts. */
  source?: SourceSpec;
  layers?: MapLayerSpec[];
  datasets?: DatasetSpec[];
  variants?: VariantSpec[];
  render?: RenderSpec;
  interaction?: InteractionSpec;
}

/** What the engine and loader consume. Sugar is already expanded. */
export interface NormalisedManifest {
  id: string;
  label: string;
  group: string;
  defaultOn: boolean;
  parent?: string;
  countFrom: string;
  requiredConfig: ConfigFieldSpec[];
  datasets: DatasetSpec[];
  variants: VariantSpec[];
  render: RenderSpec;
  interaction?: InteractionSpec;
}

export interface GeoFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] } | { type: string; coordinates: unknown };
  properties: Record<string, unknown>;
}

export function sourceId(layerId: string, datasetKey: string): string {
  return datasetKey === 'default' ? layerId : `${layerId}--${datasetKey}`;
}

export function mapLayerId(layerId: string, datasetKey: string, suffix: string): string {
  return `${sourceId(layerId, datasetKey)}--${suffix}`;
}
```

- [ ] **Step 2: Write the failing test — `src/lib/layers/format.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { coerce, formatValue } from './format';

describe('coerce', () => {
  it('turns MapLibre-serialised booleans back into booleans', () => {
    expect(coerce('true')).toBe(true);
    expect(coerce('false')).toBe(false);
  });

  it('turns numeric strings into numbers', () => {
    expect(coerce('42')).toBe(42);
    expect(coerce('-3.5')).toBe(-3.5);
  });

  it('leaves non-numeric strings alone', () => {
    expect(coerce('Sofia')).toBe('Sofia');
    expect(coerce('')).toBe('');
  });

  it('leaves null and undefined alone', () => {
    expect(coerce(null)).toBe(null);
    expect(coerce(undefined)).toBe(undefined);
  });

  it('does not mangle strings that merely start with digits', () => {
    expect(coerce('4 Privet Drive')).toBe('4 Privet Drive');
  });
});

describe('formatValue', () => {
  it('renders an em dash for missing values', () => {
    expect(formatValue(null)).toBe('—');
    expect(formatValue(undefined)).toBe('—');
    expect(formatValue('')).toBe('—');
  });

  it('formats thousands with separators', () => {
    expect(formatValue(1234567, 'thousands')).toBe('1,234,567');
    expect(formatValue('1234567', 'thousands')).toBe('1,234,567');
  });

  it('formats fixed decimals', () => {
    expect(formatValue(3.14159, 'fixed2')).toBe('3.14');
    expect(formatValue('10', 'fixed1')).toBe('10.0');
  });

  it('formats a ratio as a percentage', () => {
    expect(formatValue(0.42, 'percent')).toBe('42%');
  });

  it('uppercases', () => {
    expect(formatValue('online', 'upper')).toBe('ONLINE');
  });

  it('formats dates and datetimes from ISO strings', () => {
    expect(formatValue('2026-09-08T06:06:00.000Z', 'date')).toBe('2026-09-08');
    expect(formatValue('2026-09-08T06:06:00.000Z', 'datetime')).toBe('2026-09-08 06:06');
  });

  it('returns the raw string when a date cannot be parsed', () => {
    expect(formatValue('not a date', 'date')).toBe('not a date');
  });

  it('appends a suffix', () => {
    expect(formatValue(15, 'number', ' cpm')).toBe('15 cpm');
  });

  it('does not append a suffix to a missing value', () => {
    expect(formatValue(null, 'number', ' cpm')).toBe('—');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/lib/layers/format.test.ts`
Expected: FAIL — cannot resolve `./format`.

- [ ] **Step 4: Write `src/lib/layers/format.ts`**

```ts
import type { Format } from './types';

/**
 * MapLibre serialises feature properties, so a boolean arrives as the string
 * 'true' and a number as '42'. Every popup handler used to rediscover this
 * for itself; it is handled once, here.
 */
export function coerce(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  // Only a string that is *entirely* a number becomes one. "4 Privet Drive"
  // is an address, not the number four.
  if (v !== '' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return v;
}

const MISSING = '—';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatValue(v: unknown, format: Format = 'text', suffix = ''): string {
  const value = coerce(v);
  if (value === null || value === undefined || value === '') return MISSING;

  let out: string;
  switch (format) {
    case 'thousands': {
      const n = Number(value);
      out = Number.isFinite(n) ? n.toLocaleString('en-US') : String(value);
      break;
    }
    case 'number': {
      const n = Number(value);
      out = Number.isFinite(n) ? String(n) : String(value);
      break;
    }
    case 'fixed1':
    case 'fixed2':
    case 'fixed3': {
      const digits = Number(format.slice(-1));
      const n = Number(value);
      out = Number.isFinite(n) ? n.toFixed(digits) : String(value);
      break;
    }
    case 'percent': {
      const n = Number(value);
      out = Number.isFinite(n) ? `${Math.round(n * 100)}%` : String(value);
      break;
    }
    case 'date':
    case 'datetime': {
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) { out = String(value); break; }
      const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
      out = format === 'date' ? day : `${day} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
      break;
    }
    case 'upper':
      out = String(value).toUpperCase();
      break;
    default:
      out = String(value);
  }
  return suffix ? `${out}${suffix}` : out;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/layers/format.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/layers/types.ts src/lib/layers/format.ts src/lib/layers/format.test.ts
git commit -m "feat(layers): manifest types and the value format vocabulary

coerce() handles MapLibre's property serialisation in one place. Every
popup handler currently rediscovers that booleans arrive as the string
'true' -- cf-outage-dots carries that workaround inline today."
```

---

### Task 3: ValueSpec resolution

**Files:**
- Create: `src/lib/layers/values.ts`
- Test: `src/lib/layers/values.test.ts`

**Interfaces:**
- Consumes: `ValueSpec` from `./types`; `coerce` from `./format`.
- Produces: `resolveValue(spec: ValueSpec, props: Record<string, unknown>): string`.

**Context:** Four forms exist because four are needed. Literal covers most accents. `property` covers titles. `match`/`equals` covers `gdelt-dots`' six-entry `KIND` lookup and `cf-outage-dots`' `ongoing` branch. `match`/`contains` is required by `infra-dots`, whose accent derives from `p.status.includes('SEISMIC RISK')`. `range` covers numeric banding, which neither of the others can express.

- [ ] **Step 1: Write the failing test — `src/lib/layers/values.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { resolveValue } from './values';

describe('resolveValue', () => {
  it('returns a literal unchanged', () => {
    expect(resolveValue('#7E57C2', {})).toBe('#7E57C2');
  });

  it('reads a property', () => {
    expect(resolveValue({ property: 'place' }, { place: 'Fukushima' })).toBe('Fukushima');
  });

  it('renders an em dash for a missing property', () => {
    expect(resolveValue({ property: 'place' }, {})).toBe('—');
  });

  it('matches on equality by default', () => {
    const spec = { match: { property: 'kind', cases: { wildfire: '#FF6B1A', flood: '#00B0FF' }, fallback: '#FF3D3D' } };
    expect(resolveValue(spec, { kind: 'wildfire' })).toBe('#FF6B1A');
    expect(resolveValue(spec, { kind: 'volcano' })).toBe('#FF3D3D');
  });

  it('matches a MapLibre-serialised boolean', () => {
    const spec = { match: { property: 'ongoing', cases: { true: '#FFB300', false: '#8B7325' }, fallback: '#999' } };
    expect(resolveValue(spec, { ongoing: 'true' })).toBe('#FFB300');
    expect(resolveValue(spec, { ongoing: false })).toBe('#8B7325');
  });

  it('matches on substring when mode is contains', () => {
    const spec = { match: { property: 'status', cases: { 'SEISMIC RISK': '#E65100' }, fallback: '#26A69A', mode: 'contains' as const } };
    expect(resolveValue(spec, { status: 'Operational — SEISMIC RISK zone' })).toBe('#E65100');
    expect(resolveValue(spec, { status: 'Operational' })).toBe('#26A69A');
  });

  it('picks the first range stop the value meets or exceeds', () => {
    const spec = { range: { property: 'value', stops: [[350, '#D32F2F'], [100, '#E65100']] as [number, string][], fallback: '#7E57C2' } };
    expect(resolveValue(spec, { value: 400 })).toBe('#D32F2F');
    expect(resolveValue(spec, { value: 350 })).toBe('#D32F2F');
    expect(resolveValue(spec, { value: 150 })).toBe('#E65100');
    expect(resolveValue(spec, { value: 15 })).toBe('#7E57C2');
  });

  it('falls back when a range property is not numeric', () => {
    const spec = { range: { property: 'value', stops: [[100, '#E65100']] as [number, string][], fallback: '#7E57C2' } };
    expect(resolveValue(spec, { value: 'unknown' })).toBe('#7E57C2');
    expect(resolveValue(spec, {})).toBe('#7E57C2');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/layers/values.test.ts`
Expected: FAIL — cannot resolve `./values`.

- [ ] **Step 3: Write `src/lib/layers/values.ts`**

```ts
import type { ValueSpec } from './types';
import { coerce } from './format';

/**
 * Resolve a ValueSpec against a feature's properties.
 *
 * Range stops are evaluated in the order written, so a manifest lists them
 * highest-first. That reads the way the thresholds are spoken about ("350 and
 * above is danger, 100 and above is elevated") rather than requiring the
 * author to remember a sort order.
 */
export function resolveValue(spec: ValueSpec, props: Record<string, unknown>): string {
  if (typeof spec === 'string') return spec;

  if ('property' in spec) {
    const v = props[spec.property];
    return v === null || v === undefined || v === '' ? '—' : String(v);
  }

  if ('match' in spec) {
    const { property, cases, fallback, mode = 'equals' } = spec.match;
    const raw = props[property];
    if (raw === null || raw === undefined) return fallback;
    const asString = String(coerce(raw));
    if (mode === 'contains') {
      for (const [needle, out] of Object.entries(cases)) {
        if (asString.includes(needle)) return out;
      }
      return fallback;
    }
    return Object.prototype.hasOwnProperty.call(cases, asString) ? cases[asString] : fallback;
  }

  const { property, stops, fallback } = spec.range;
  const n = Number(coerce(props[property]));
  if (!Number.isFinite(n)) return fallback;
  for (const [threshold, out] of stops) {
    if (n >= threshold) return out;
  }
  return fallback;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/layers/values.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/layers/values.ts src/lib/layers/values.test.ts
git commit -m "feat(layers): resolve the four ValueSpec forms

contains-mode exists because infra-dots derives its accent from
status.includes('SEISMIC RISK'), which an equality table cannot express;
range exists because numeric banding cannot be expressed by either."
```

---

### Task 4: Popup rendering and the single escaping path

**Files:**
- Create: `src/lib/layers/popup.ts`
- Test: `src/lib/layers/popup.test.ts`

**Interfaces:**
- Consumes: `PopupSpec` from `./types`; `resolveValue` from `./values`; `formatValue` from `./format`.
- Produces: `htmlEsc(s: unknown): string`; `urlSafe(s: unknown): string`; `renderPopup(spec: PopupSpec, props: Record<string, unknown>): string`.

**Context:** This closes a live security hole. In `OsirisMap.tsx` today, `rad-dots`, `ship-dots`, `balloon-dots`, `infra-dots`, `maritime-dots` and `choke-dots` interpolate upstream OSINT strings into popup HTML with no escaping, and `weather-dots` writes `p.source` straight into an `href` with no scheme check. Routing every popup through one builder makes escaping structural rather than remembered. `htmlEsc` and `urlSafe` are lifted verbatim from the inline helpers at `OsirisMap.tsx:837-839`.

Link URLs use `{property}` interpolation. Interpolated segments are URL-encoded — the existing flight links already do this correctly with `encodeURIComponent`, and it must not regress.

- [ ] **Step 1: Write the failing test — `src/lib/layers/popup.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { htmlEsc, urlSafe, renderPopup } from './popup';
import type { PopupSpec } from './types';

describe('htmlEsc', () => {
  it('escapes every HTML-significant character', () => {
    expect(htmlEsc(`<script>"x"&'y'</script>`))
      .toBe('&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;');
  });

  it('renders null and undefined as empty', () => {
    expect(htmlEsc(null)).toBe('');
    expect(htmlEsc(undefined)).toBe('');
  });
});

describe('urlSafe', () => {
  it('passes http and https through', () => {
    expect(urlSafe('https://example.org/a')).toBe('https://example.org/a');
    expect(urlSafe('http://example.org')).toBe('http://example.org');
  });

  it('rejects javascript: and data: URLs', () => {
    expect(urlSafe('javascript:alert(1)')).toBe('#');
    expect(urlSafe('data:text/html,<script>alert(1)</script>')).toBe('#');
    expect(urlSafe('JaVaScRiPt:alert(1)')).toBe('#');
  });

  it('rejects missing values', () => {
    expect(urlSafe(null)).toBe('#');
    expect(urlSafe('')).toBe('#');
  });
});

describe('renderPopup', () => {
  const spec: PopupSpec = {
    accent: '#7E57C2',
    title: { property: 'place' },
    fields: [
      { label: 'READING', property: 'value', format: 'number', suffix: ' cpm' },
      { label: 'CAPTURED', property: 'captured', format: 'datetime' },
    ],
  };

  it('renders the title, labels and formatted values', () => {
    const html = renderPopup(spec, { place: 'Fukushima', value: '15', captured: '2026-09-08T06:06:00.000Z' });
    expect(html).toContain('Fukushima');
    expect(html).toContain('READING');
    expect(html).toContain('15 cpm');
    expect(html).toContain('CAPTURED');
    expect(html).toContain('2026-09-08 06:06');
  });

  it('applies the accent colour', () => {
    expect(renderPopup(spec, { place: 'X' })).toContain('#7E57C2');
  });

  it('escapes a hostile title from upstream data', () => {
    const html = renderPopup(spec, { place: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('escapes a hostile field value from upstream data', () => {
    const html = renderPopup(
      { ...spec, fields: [{ label: 'NAME', property: 'n' }] },
      { place: 'X', n: '</div><script>alert(1)</script>' },
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders a missing field as an em dash', () => {
    expect(renderPopup(spec, { place: 'X' })).toContain('—');
  });

  it('interpolates and URL-encodes link templates', () => {
    const withLink: PopupSpec = {
      ...spec,
      links: [{ label: 'SOURCE', url: 'https://example.org/s?q={place}' }],
    };
    const html = renderPopup(withLink, { place: 'a b&c' });
    expect(html).toContain('https://example.org/s?q=a%20b%26c');
    expect(html).toContain('SOURCE');
  });

  it('neutralises a javascript: URL arriving from a feature property', () => {
    const withLink: PopupSpec = { ...spec, links: [{ label: 'SOURCE', url: '{src}' }] };
    const html = renderPopup(withLink, { place: 'X', src: 'javascript:alert(1)' });
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="#"');
  });

  it('omits the links block entirely when there are none', () => {
    expect(renderPopup(spec, { place: 'X' })).not.toContain('<a ');
  });

  it('renders an optional subtitle only when present', () => {
    expect(renderPopup(spec, { place: 'X' })).not.toContain('subtitle');
    const withSub: PopupSpec = { ...spec, subtitle: { property: 'unit' } };
    expect(renderPopup(withSub, { place: 'X', unit: 'cpm' })).toContain('cpm');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/layers/popup.test.ts`
Expected: FAIL — cannot resolve `./popup`.

- [ ] **Step 3: Write `src/lib/layers/popup.ts`**

```ts
import type { PopupSpec } from './types';
import { resolveValue } from './values';
import { formatValue } from './format';

/**
 * The single escaping path for popup content.
 *
 * Escaping used to be per-handler discipline in OsirisMap, and roughly a
 * third of the handlers omitted it -- rad-dots, ship-dots, balloon-dots,
 * infra-dots, maritime-dots and choke-dots all interpolated upstream OSINT
 * strings raw, and weather-dots put an unvalidated feed URL into an href.
 * Every value below goes through htmlEsc or urlSafe on its way out.
 */
export function htmlEsc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function urlSafe(s: unknown): string {
  const u = String(s ?? '');
  return /^https?:\/\//i.test(u) ? u : '#';
}

const SHELL = `background:rgba(12,14,26,0.95);backdrop-filter:blur(16px);border-radius:10px;padding:16px;font-family:'JetBrains Mono',monospace;`;
const LINK = `display:inline-block;margin-top:8px;margin-right:4px;padding:5px 12px;font-size:10px;letter-spacing:0.12em;text-decoration:none;border-radius:5px;font-family:'JetBrains Mono',monospace;`;

/** Expand {property} placeholders, URL-encoding each substituted value. */
function interpolate(template: string, props: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const v = props[key];
    return v === null || v === undefined ? '' : encodeURIComponent(String(v));
  });
}

export function renderPopup(spec: PopupSpec, props: Record<string, unknown>): string {
  const accent = resolveValue(spec.accent, props);
  const title = resolveValue(spec.title, props);
  const subtitle = spec.subtitle ? resolveValue(spec.subtitle, props) : null;

  const fields = spec.fields.map(f => {
    const value = formatValue(props[f.property], f.format, f.suffix ?? '');
    return `<div><span style="color:#5C5A54;font-size:9px;">${htmlEsc(f.label)}</span><br/>` +
           `<span style="color:#E8E6E0;">${htmlEsc(value)}</span></div>`;
  }).join('');

  const links = (spec.links ?? []).map(l => {
    // A template that is a bare {prop} yields the raw property value, which
    // is exactly the case weather-dots got wrong -- so the result is scheme
    // checked whether it came from a literal or from upstream data.
    const raw = /^\{(\w+)\}$/.test(l.url)
      ? String(props[l.url.slice(1, -1)] ?? '')
      : interpolate(l.url, props);
    const href = urlSafe(raw);
    return `<a href="${htmlEsc(href)}" target="_blank" rel="noopener noreferrer" ` +
           `style="${LINK}color:${htmlEsc(accent)};border:1px solid ${htmlEsc(accent)}66;background:${htmlEsc(accent)}1a;">` +
           `${htmlEsc(l.label)}</a>`;
  }).join('');

  return `<div style="${SHELL}border:1px solid ${htmlEsc(accent)}66;min-width:230px;">` +
    `<div style="color:${htmlEsc(accent)};font-size:12px;font-weight:700;letter-spacing:0.08em;margin-bottom:6px;">${htmlEsc(title)}</div>` +
    (subtitle ? `<div style="color:#5C5A54;font-size:9px;margin-bottom:8px;">${htmlEsc(subtitle)}</div>` : '') +
    (fields ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:9px;">${fields}</div>` : '') +
    links +
    `</div>`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/layers/popup.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/layers/popup.ts src/lib/layers/popup.test.ts
git commit -m "feat(layers): one tested popup builder, one escaping path

Six of the current popup handlers interpolate upstream OSINT strings into
HTML with no escaping, and weather-dots writes an unvalidated feed URL
straight into an href -- a javascript: URL from a third-party feed lands
in an anchor. Routing every popup through one builder makes escaping
structural instead of something each handler has to remember."
```

---

### Task 5: Manifest validation and normalisation

**Files:**
- Create: `src/lib/layers/validate.ts`
- Test: `src/lib/layers/validate.test.ts`

**Interfaces:**
- Consumes: `LayerManifest`, `NormalisedManifest` from `./types`.
- Produces: `validateManifest(raw: unknown, origin: string): ValidationResult`, where
  `ValidationResult = { ok: true; manifest: NormalisedManifest } | { ok: false; errors: string[] }`.

**Context:** Validation **returns** errors rather than throwing, because a malformed drop-in file must surface in the plugins diagnostics panel naming the file and the fault — hunting container logs is not a debugging story. `origin` is that filename.

Normalisation expands the single-dataset sugar (`source` + `layers`) into `datasets: [{ key: 'default', ... }]` so the engine only ever sees one shape.

- [ ] **Step 1: Write the failing test — `src/lib/layers/validate.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { validateManifest } from './validate';

const minimal = {
  id: 'radiation', label: 'Radiation Monitors', group: 'HAZARD',
  source: { kind: 'http', format: 'json', url: 'https://example.org/x', lat: 'latitude', lng: 'longitude', properties: {}, refresh: { mode: 'once' } },
  layers: [{ suffix: 'dots', type: 'circle', clickable: true }],
};

describe('validateManifest', () => {
  it('accepts a minimal manifest and expands the single-dataset sugar', () => {
    const r = validateManifest(minimal, 'radiation.json');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.datasets).toHaveLength(1);
    expect(r.manifest.datasets[0].key).toBe('default');
    expect(r.manifest.datasets[0].layers[0].suffix).toBe('dots');
  });

  it('applies defaults for the optional fields', () => {
    const r = validateManifest(minimal, 'radiation.json');
    if (!r.ok) throw new Error('expected ok');
    expect(r.manifest.defaultOn).toBe(false);
    expect(r.manifest.countFrom).toBe('default');
    expect(r.manifest.render).toEqual({ kind: 'geojson' });
    expect(r.manifest.variants).toEqual([]);
    expect(r.manifest.requiredConfig).toEqual([]);
  });

  it('keeps an explicit datasets array as-is', () => {
    const r = validateManifest({
      ...minimal, source: undefined, layers: undefined,
      datasets: [
        { key: 'ports', source: minimal.source, layers: minimal.layers },
        { key: 'ships', source: minimal.source, layers: minimal.layers },
      ],
    }, 'maritime.json');
    if (!r.ok) throw new Error('expected ok');
    expect(r.manifest.datasets.map(d => d.key)).toEqual(['ports', 'ships']);
    expect(r.manifest.countFrom).toBe('ports');
  });

  it('rejects a manifest with no id', () => {
    const r = validateManifest({ ...minimal, id: undefined }, 'bad.json');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(' ')).toContain('id');
    expect(r.errors.join(' ')).toContain('bad.json');
  });

  it('rejects a manifest with neither source nor datasets', () => {
    const r = validateManifest({ id: 'x', label: 'X', group: 'G' }, 'bad.json');
    expect(r.ok).toBe(false);
  });

  it('rejects an unknown source format and names it', () => {
    const r = validateManifest({ ...minimal, source: { ...minimal.source, format: 'jsom' } }, 'bad.json');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(' ')).toContain('jsom');
  });

  it('rejects duplicate dataset keys', () => {
    const r = validateManifest({
      ...minimal, source: undefined, layers: undefined,
      datasets: [
        { key: 'a', source: minimal.source, layers: minimal.layers },
        { key: 'a', source: minimal.source, layers: minimal.layers },
      ],
    }, 'bad.json');
    expect(r.ok).toBe(false);
  });

  it('rejects a variant whose dataset does not exist', () => {
    const r = validateManifest({
      ...minimal,
      variants: [{ id: 'v1', label: 'V1', dataset: 'nope' }],
    }, 'bad.json');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(' ')).toContain('nope');
  });

  it('reports every error at once rather than only the first', () => {
    const r = validateManifest({ label: 'X' }, 'bad.json');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBeGreaterThan(1);
  });

  it('never throws on arbitrary junk', () => {
    expect(() => validateManifest(null, 'x.json')).not.toThrow();
    expect(() => validateManifest('nope', 'x.json')).not.toThrow();
    expect(validateManifest(null, 'x.json').ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/layers/validate.test.ts`
Expected: FAIL — cannot resolve `./validate`.

- [ ] **Step 3: Write `src/lib/layers/validate.ts`**

```ts
import type { DatasetSpec, LayerManifest, NormalisedManifest, SourceSpec } from './types';

export type ValidationResult =
  | { ok: true; manifest: NormalisedManifest }
  | { ok: false; errors: string[] };

const SOURCE_KINDS = ['http', 'adapter', 'computed', 'none'];
const FORMATS = ['json', 'geojson', 'csv'];
const REFRESH_MODES = ['once', 'poll', 'viewport', 'stream'];

function checkSource(src: unknown, where: string, errors: string[]): void {
  if (!src || typeof src !== 'object') { errors.push(`${where}: source is missing`); return; }
  const s = src as Record<string, unknown>;
  if (typeof s.kind !== 'string' || !SOURCE_KINDS.includes(s.kind)) {
    errors.push(`${where}: unknown source kind '${String(s.kind)}'`);
    return;
  }
  if (s.kind === 'http') {
    if (typeof s.url !== 'string' || !s.url) errors.push(`${where}: http source needs a url`);
    if (typeof s.format !== 'string' || !FORMATS.includes(s.format)) {
      errors.push(`${where}: unknown format '${String(s.format)}'`);
    }
    if (typeof s.lat !== 'string' || typeof s.lng !== 'string') {
      errors.push(`${where}: http source needs lat and lng property paths`);
    }
  }
  if (s.kind === 'adapter' && typeof s.adapter !== 'string') {
    errors.push(`${where}: adapter source needs an adapter name`);
  }
  if (s.kind === 'computed' && typeof s.compute !== 'string') {
    errors.push(`${where}: computed source needs a compute name`);
  }
  if (s.kind === 'http' || s.kind === 'adapter') {
    const r = s.refresh as Record<string, unknown> | undefined;
    if (!r || typeof r.mode !== 'string' || !REFRESH_MODES.includes(r.mode)) {
      errors.push(`${where}: unknown refresh mode '${String(r?.mode)}'`);
    }
  }
}

/**
 * Validate and normalise one manifest.
 *
 * Returns errors rather than throwing: a malformed drop-in file has to reach
 * the plugins diagnostics panel naming the file and the fault, so an operator
 * who typos a JSON file sees it in the UI instead of in container logs.
 */
export function validateManifest(raw: unknown, origin: string): ValidationResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: [`${origin}: not a JSON object`] };
  }
  const m = raw as LayerManifest;

  if (typeof m.id !== 'string' || !m.id) errors.push(`${origin}: missing 'id'`);
  if (typeof m.label !== 'string' || !m.label) errors.push(`${origin}: missing 'label'`);
  if (typeof m.group !== 'string' || !m.group) errors.push(`${origin}: missing 'group'`);

  // Expand the single-dataset sugar so the engine only ever sees `datasets`.
  let datasets: DatasetSpec[] = [];
  if (Array.isArray(m.datasets) && m.datasets.length > 0) {
    datasets = m.datasets;
  } else if (m.source) {
    datasets = [{ key: 'default', source: m.source as SourceSpec, layers: m.layers ?? [] }];
  } else {
    errors.push(`${origin}: needs either 'source' or 'datasets'`);
  }

  const seen = new Set<string>();
  datasets.forEach((d, i) => {
    const where = `${origin}: dataset '${d?.key ?? i}'`;
    if (!d || typeof d.key !== 'string' || !d.key) { errors.push(`${where}: missing key`); return; }
    if (seen.has(d.key)) errors.push(`${origin}: duplicate dataset key '${d.key}'`);
    seen.add(d.key);
    if (!Array.isArray(d.layers)) errors.push(`${where}: layers must be an array`);
    checkSource(d.source, where, errors);
  });

  const variants = Array.isArray(m.variants) ? m.variants : [];
  variants.forEach((v, i) => {
    if (!v || typeof v.id !== 'string' || !v.id) errors.push(`${origin}: variant ${i} missing 'id'`);
    if (v?.dataset && !seen.has(v.dataset)) {
      errors.push(`${origin}: variant '${v.id}' names dataset '${v.dataset}', which does not exist`);
    }
  });

  const countFrom = m.countFrom ?? datasets[0]?.key ?? 'default';
  if (m.countFrom && !seen.has(m.countFrom)) {
    errors.push(`${origin}: countFrom '${m.countFrom}' names no dataset`);
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    manifest: {
      id: m.id, label: m.label, group: m.group,
      defaultOn: m.defaultOn ?? false,
      parent: m.parent,
      countFrom,
      requiredConfig: m.requiredConfig ?? [],
      datasets,
      variants,
      render: m.render ?? { kind: 'geojson' },
      interaction: m.interaction,
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/layers/validate.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/layers/validate.ts src/lib/layers/validate.test.ts
git commit -m "feat(layers): validate and normalise manifests

Errors are returned, not thrown, and carry the originating filename, so a
typo in a drop-in manifest can be shown in the plugins panel rather than
buried in container logs. Single-dataset sugar expands here so the engine
only ever sees one shape."
```

---

### Task 6: The pure fetch planner

**Files:**
- Create: `src/lib/layers/loader.ts`
- Test: `src/lib/layers/loader.test.ts`

**Interfaces:**
- Consumes: `NormalisedManifest`, `RefreshSpec` from `./types`.
- Produces:
  - `createLoadState(): LoadState`
  - `planLoads(manifests: NormalisedManifest[], active: ReadonlySet<string>, state: LoadState, viewport: Viewport | null, now: number): LoadPlan[]`
  - `markStarted(state: LoadState, plan: LoadPlan): void`
  - `markSettled(state: LoadState, plan: LoadPlan, ok: boolean, now: number): void`
  - types `LoadState`, `LoadPlan`, `Viewport`

**Context — this task fixes a real bug.** Today 17 layers do `fetchEndpoint(url); layerFetchedRef.current.add(key);` — marked regardless of outcome, so one upstream timeout leaves that layer empty for the rest of the session with no retry. Only two layers use the `loadLayerOnce` helper that marks before awaiting and *releases the mark if nothing landed*. Here there is one code path, so every layer gets the correct semantics: `markStarted` before the request, `markSettled(ok=false)` releases it.

**Dataset activation rule.** A dataset is active when the manifest's own id is active, **or** when any active variant maps to it. A variant maps to `variant.dataset ?? datasets[0].key`. This reproduces `satellites` exactly, where the `satellites` toggle means "all" and the five category toggles are variants over the same dataset.

**Request grouping.** One `LoadPlan` per manifest, carrying all its currently-active dataset keys. The spec's deduplication by resolved `(url, headers)` happens **server-side** in `/api/layer-source`, using `cachedSource`'s existing TTL and in-flight dedup — the browser never sees a URL, so it cannot group by one. A manifest whose datasets share a URL therefore costs one client request and one upstream request; `balloons`, whose two datasets have different SondeHub URLs, costs one client request and two upstream requests.

- [ ] **Step 1: Write the failing test — `src/lib/layers/loader.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createLoadState, planLoads, markStarted, markSettled } from './loader';
import type { NormalisedManifest, SourceSpec } from './types';

const httpSource = (mode: SourceSpec extends { refresh: infer R } ? R : never = { mode: 'once' } as never): SourceSpec => ({
  kind: 'http', url: 'https://example.org/x', format: 'json',
  lat: 'lat', lng: 'lng', properties: {}, refresh: mode as never,
});

function manifest(over: Partial<NormalisedManifest> = {}): NormalisedManifest {
  return {
    id: 'radiation', label: 'R', group: 'HAZARD', defaultOn: false,
    countFrom: 'default', requiredConfig: [], variants: [],
    render: { kind: 'geojson' },
    datasets: [{ key: 'default', source: httpSource(), layers: [] }],
    ...over,
  };
}

describe('planLoads', () => {
  it('plans nothing for an inactive layer', () => {
    expect(planLoads([manifest()], new Set(), createLoadState(), null, 0)).toEqual([]);
  });

  it('plans an initial load for a newly active layer', () => {
    const plans = planLoads([manifest()], new Set(['radiation']), createLoadState(), null, 0);
    expect(plans).toHaveLength(1);
    expect(plans[0].layerId).toBe('radiation');
    expect(plans[0].datasetKeys).toEqual(['default']);
    expect(plans[0].reason).toBe('initial');
  });

  it('does not replan a layer already fetched', () => {
    const state = createLoadState();
    const [plan] = planLoads([manifest()], new Set(['radiation']), state, null, 0);
    markStarted(state, plan);
    markSettled(state, plan, true, 0);
    expect(planLoads([manifest()], new Set(['radiation']), state, null, 1)).toEqual([]);
  });

  it('does not replan a layer whose request is in flight', () => {
    const state = createLoadState();
    const [plan] = planLoads([manifest()], new Set(['radiation']), state, null, 0);
    markStarted(state, plan);
    expect(planLoads([manifest()], new Set(['radiation']), state, null, 1)).toEqual([]);
  });

  it('replans after a failed load — the mark is released', () => {
    const state = createLoadState();
    const [plan] = planLoads([manifest()], new Set(['radiation']), state, null, 0);
    markStarted(state, plan);
    markSettled(state, plan, false, 0);
    const again = planLoads([manifest()], new Set(['radiation']), state, null, 1);
    expect(again).toHaveLength(1);
    expect(again[0].reason).toBe('initial');
  });

  it('does not poll before the interval has elapsed', () => {
    const m = manifest({ datasets: [{ key: 'default', source: httpSource({ mode: 'poll', intervalMs: 1000 } as never), layers: [] }] });
    const state = createLoadState();
    const [plan] = planLoads([m], new Set(['radiation']), state, null, 0);
    markStarted(state, plan);
    markSettled(state, plan, true, 0);
    expect(planLoads([m], new Set(['radiation']), state, null, 999)).toEqual([]);
  });

  it('polls once the interval has elapsed', () => {
    const m = manifest({ datasets: [{ key: 'default', source: httpSource({ mode: 'poll', intervalMs: 1000 } as never), layers: [] }] });
    const state = createLoadState();
    const [plan] = planLoads([m], new Set(['radiation']), state, null, 0);
    markStarted(state, plan);
    markSettled(state, plan, true, 0);
    const again = planLoads([m], new Set(['radiation']), state, null, 1000);
    expect(again).toHaveLength(1);
    expect(again[0].reason).toBe('poll');
  });

  it('replans a viewport layer when the bounds change', () => {
    const m = manifest({ datasets: [{ key: 'default', source: httpSource({ mode: 'viewport', debounceMs: 800, mergeKey: 'id' } as never), layers: [] }] });
    const state = createLoadState();
    const vp1 = { west: 0, south: 0, east: 1, north: 1 };
    const [plan] = planLoads([m], new Set(['radiation']), state, vp1, 0);
    markStarted(state, plan);
    markSettled(state, plan, true, 0);
    expect(planLoads([m], new Set(['radiation']), state, vp1, 1)).toEqual([]);
    const vp2 = { west: 10, south: 10, east: 11, north: 11 };
    const again = planLoads([m], new Set(['radiation']), state, vp2, 2);
    expect(again).toHaveLength(1);
    expect(again[0].reason).toBe('viewport');
    expect(again[0].bbox).toEqual(vp2);
  });

  it('activates a dataset when any variant bound to it is active', () => {
    const m = manifest({
      id: 'satellites',
      variants: [
        { id: 'sat_comms', label: 'Comms' },
        { id: 'sat_military', label: 'Military' },
      ],
    });
    expect(planLoads([m], new Set(['sat_comms']), createLoadState(), null, 0)).toHaveLength(1);
    expect(planLoads([m], new Set(['satellites']), createLoadState(), null, 0)).toHaveLength(1);
    expect(planLoads([m], new Set(['unrelated']), createLoadState(), null, 0)).toEqual([]);
  });

  it('groups a manifest\'s active datasets into one plan', () => {
    const m = manifest({
      id: 'flights',
      datasets: [
        { key: 'commercial', source: httpSource(), layers: [] },
        { key: 'military', source: httpSource(), layers: [] },
      ],
      variants: [
        { id: 'flights', label: 'Commercial', dataset: 'commercial' },
        { id: 'military', label: 'Military', dataset: 'military' },
      ],
      countFrom: 'commercial',
    });
    const plans = planLoads([m], new Set(['flights', 'military']), createLoadState(), null, 0);
    expect(plans).toHaveLength(1);
    expect(plans[0].datasetKeys.sort()).toEqual(['commercial', 'military']);
  });

  it('never plans computed, none or stream sources', () => {
    const computed = manifest({ id: 'day_night', datasets: [{ key: 'default', source: { kind: 'computed', compute: 'solar-terminator' }, layers: [] }] });
    const none = manifest({ id: 'terrain_3d', datasets: [{ key: 'default', source: { kind: 'none' }, layers: [] }] });
    const stream = manifest({ id: 'malware', datasets: [{ key: 'default', source: httpSource({ mode: 'stream', path: '/api/malware/stream' } as never), layers: [] }] });
    expect(planLoads([computed], new Set(['day_night']), createLoadState(), null, 0)).toEqual([]);
    expect(planLoads([none], new Set(['terrain_3d']), createLoadState(), null, 0)).toEqual([]);
    expect(planLoads([stream], new Set(['malware']), createLoadState(), null, 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/layers/loader.test.ts`
Expected: FAIL — cannot resolve `./loader`.

- [ ] **Step 3: Write `src/lib/layers/loader.ts`**

```ts
import type { DatasetSpec, NormalisedManifest, RefreshSpec } from './types';

export interface Viewport { west: number; south: number; east: number; north: number }

export interface LoadPlan {
  layerId: string;
  datasetKeys: string[];
  mode: RefreshSpec['mode'];
  reason: 'initial' | 'poll' | 'viewport';
  bbox?: Viewport;
}

export interface LoadState {
  fetched: Set<string>;
  inflight: Set<string>;
  lastPollAt: Map<string, number>;
  lastViewportKey: Map<string, string>;
}

export function createLoadState(): LoadState {
  return { fetched: new Set(), inflight: new Set(), lastPollAt: new Map(), lastViewportKey: new Map() };
}

/** Coarse enough that a one-pixel drag does not count as a new viewport. */
function viewportKey(v: Viewport): string {
  return [v.west, v.south, v.east, v.north].map(n => n.toFixed(2)).join(',');
}

function refreshOf(d: DatasetSpec): RefreshSpec | null {
  const s = d.source;
  return s.kind === 'http' || s.kind === 'adapter' ? s.refresh : null;
}

/** Datasets a manifest currently needs, given which toggles are on. */
function activeDatasets(m: NormalisedManifest, active: ReadonlySet<string>): string[] {
  const primary = m.datasets[0]?.key;
  const wanted = new Set<string>();
  if (active.has(m.id)) for (const d of m.datasets) wanted.add(d.key);
  for (const v of m.variants) {
    if (active.has(v.id)) wanted.add(v.dataset ?? primary);
  }
  return m.datasets.map(d => d.key).filter(k => wanted.has(k));
}

export function planLoads(
  manifests: NormalisedManifest[],
  active: ReadonlySet<string>,
  state: LoadState,
  viewport: Viewport | null,
  now: number,
): LoadPlan[] {
  const plans: LoadPlan[] = [];

  for (const m of manifests) {
    if (state.inflight.has(m.id)) continue;

    const keys = activeDatasets(m, active);
    if (keys.length === 0) continue;

    // Only fetchable datasets are planned. Computed geometry and display-only
    // layers never hit the network, and streams own their own subscription.
    const fetchable = keys.filter(k => {
      const d = m.datasets.find(x => x.key === k);
      const r = d ? refreshOf(d) : null;
      return r !== null && r.mode !== 'stream';
    });
    if (fetchable.length === 0) continue;

    const first = m.datasets.find(d => d.key === fetchable[0])!;
    const refresh = refreshOf(first)!;

    if (!state.fetched.has(m.id)) {
      plans.push({ layerId: m.id, datasetKeys: fetchable, mode: refresh.mode, reason: 'initial',
                   bbox: refresh.mode === 'viewport' && viewport ? viewport : undefined });
      continue;
    }

    if (refresh.mode === 'poll') {
      const last = state.lastPollAt.get(m.id) ?? 0;
      if (now - last >= refresh.intervalMs) {
        plans.push({ layerId: m.id, datasetKeys: fetchable, mode: 'poll', reason: 'poll' });
      }
      continue;
    }

    if (refresh.mode === 'viewport' && viewport) {
      const key = viewportKey(viewport);
      if (state.lastViewportKey.get(m.id) !== key) {
        plans.push({ layerId: m.id, datasetKeys: fetchable, mode: 'viewport', reason: 'viewport', bbox: viewport });
      }
    }
  }

  return plans;
}

/**
 * Mark before awaiting, so a re-render mid-flight cannot double-fetch.
 */
export function markStarted(state: LoadState, plan: LoadPlan): void {
  state.inflight.add(plan.layerId);
  state.fetched.add(plan.layerId);
  if (plan.bbox) state.lastViewportKey.set(plan.layerId, viewportKey(plan.bbox));
}

/**
 * Release the mark when nothing landed. Without this, one upstream timeout
 * leaves the layer empty for the rest of the session -- which is exactly what
 * 17 layers do today.
 */
export function markSettled(state: LoadState, plan: LoadPlan, ok: boolean, now: number): void {
  state.inflight.delete(plan.layerId);
  if (ok) {
    state.lastPollAt.set(plan.layerId, now);
  } else {
    state.fetched.delete(plan.layerId);
    if (plan.bbox) state.lastViewportKey.delete(plan.layerId);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/layers/loader.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Run the whole suite to check nothing regressed**

Run: `npm test`
Expected: PASS — existing suites plus the four new layer suites.

- [ ] **Step 6: Commit**

```bash
git add src/lib/layers/loader.ts src/lib/layers/loader.test.ts
git commit -m "feat(layers): pure fetch planner with correct retry semantics

Seventeen layers currently mark themselves fetched regardless of outcome,
so one upstream timeout leaves the layer empty for the whole session. The
loadLayerOnce helper already fixes this -- mark before awaiting, release
the mark if nothing landed -- but only two layers use it. One code path
means every layer gets it."
```

---

### Task 7: The credential store and server-side substitution

**Files:**
- Create: `src/lib/layers/config-store.ts`
- Create: `src/lib/layers/substitute.ts`
- Test: `src/lib/layers/config-store.test.ts`
- Test: `src/lib/layers/substitute.test.ts`

**Interfaces:**
- Consumes: `node:fs/promises`, `node:path`.
- Produces:
  - `readConfigValue(key: string): Promise<string | undefined>`
  - `configStatus(keys: string[]): Promise<Record<string, { configured: boolean; source: 'env' | 'store' | null }>>`
  - `writeConfigValue(key: string, value: string): Promise<void>`
  - `deleteConfigValue(key: string): Promise<void>`
  - `setConfigDir(dir: string): void` — test seam only
  - `substitute(template: string, resolve: (key: string) => string | undefined, now?: Date): { text: string; missing: string[] }`

**Context.** Two substitution forms, both expanded **only on the server**: `{config.KEY}` for a declared credential, and a closed set of date tokens `{today}`, `{today-1d}`, `{today-7d}` formatted `YYYY-MM-DD`. The date tokens exist because Safecast's `since` parameter needs one — `order=captured_at desc` is silently ignored by that API, so `since` is the only way to get recent rows. This is not a template language and must not grow into one.

**Environment wins.** If `ACLED_API_KEY` is in `process.env`, it is used and the store is not consulted. An operator who set a key in `docker-compose.yml` must never have it silently shadowed by something typed into a browser.

**`substitute` reports what it could not resolve** rather than emitting an empty string, so `/api/layer-source` can return a clear "this layer needs a key" response instead of firing a request with a blank token and reporting a confusing upstream 401.

- [ ] **Step 1: Write the failing test — `src/lib/layers/substitute.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { substitute } from './substitute';

const at = new Date('2026-09-09T12:00:00.000Z');

describe('substitute', () => {
  it('leaves a template with no tokens alone', () => {
    const r = substitute('https://example.org/a', () => undefined, at);
    expect(r.text).toBe('https://example.org/a');
    expect(r.missing).toEqual([]);
  });

  it('expands {today} and the offset forms', () => {
    expect(substitute('{today}', () => undefined, at).text).toBe('2026-09-09');
    expect(substitute('{today-1d}', () => undefined, at).text).toBe('2026-09-08');
    expect(substitute('{today-7d}', () => undefined, at).text).toBe('2026-09-02');
  });

  it('expands a config token via the resolver', () => {
    const r = substitute('Bearer {config.TOKEN}', k => (k === 'TOKEN' ? 'abc123' : undefined), at);
    expect(r.text).toBe('Bearer abc123');
    expect(r.missing).toEqual([]);
  });

  it('reports an unresolved config token instead of emitting a blank', () => {
    const r = substitute('Bearer {config.TOKEN}', () => undefined, at);
    expect(r.missing).toEqual(['TOKEN']);
  });

  it('reports each missing key once', () => {
    const r = substitute('{config.A}/{config.A}/{config.B}', () => undefined, at);
    expect(r.missing.sort()).toEqual(['A', 'B']);
  });

  it('leaves an unrecognised token untouched rather than guessing', () => {
    const r = substitute('{tomorrow}', () => undefined, at);
    expect(r.text).toBe('{tomorrow}');
    expect(r.missing).toEqual([]);
  });

  it('handles a realistic Safecast URL', () => {
    const r = substitute(
      'https://api.safecast.org/measurements.json?since={today-1d}&limit=2000&unit=cpm',
      () => undefined, at,
    );
    expect(r.text).toBe('https://api.safecast.org/measurements.json?since=2026-09-08&limit=2000&unit=cpm');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/layers/substitute.test.ts`
Expected: FAIL — cannot resolve `./substitute`.

- [ ] **Step 3: Write `src/lib/layers/substitute.ts`**

```ts
/**
 * The two substitutions a manifest may use, expanded server-side only.
 *
 * Deliberately not a template language: a closed set of date tokens, plus
 * {config.KEY} for a declared credential. The date tokens exist because
 * Safecast's `since` parameter is the only way to get recent rows from that
 * API -- `order=captured_at desc` is silently ignored by it.
 */
const DATE_TOKEN = /^today(?:-(\d+)d)?$/;

function isoDay(base: Date, daysBack: number): string {
  const d = new Date(base.getTime() - daysBack * 86400000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function substitute(
  template: string,
  resolve: (key: string) => string | undefined,
  now: Date = new Date(),
): { text: string; missing: string[] } {
  const missing = new Set<string>();

  const text = template.replace(/\{([^}]+)\}/g, (whole, token: string) => {
    if (token.startsWith('config.')) {
      const key = token.slice('config.'.length);
      const value = resolve(key);
      if (value === undefined || value === '') { missing.add(key); return whole; }
      return value;
    }
    const m = DATE_TOKEN.exec(token);
    if (m) return isoDay(now, m[1] ? Number(m[1]) : 0);
    // Unrecognised tokens are left exactly as written rather than guessed at.
    return whole;
  });

  return { text, missing: [...missing] };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/layers/substitute.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the failing test — `src/lib/layers/config-store.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setConfigDir, readConfigValue, writeConfigValue, deleteConfigValue, configStatus } from './config-store';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'osiris-cfg-'));
  setConfigDir(dir);
  delete process.env.TEST_LAYER_KEY;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.TEST_LAYER_KEY;
});

describe('config-store', () => {
  it('returns undefined for an unset key', async () => {
    expect(await readConfigValue('TEST_LAYER_KEY')).toBeUndefined();
  });

  it('round-trips a written value', async () => {
    await writeConfigValue('TEST_LAYER_KEY', 'abc123');
    expect(await readConfigValue('TEST_LAYER_KEY')).toBe('abc123');
  });

  it('lets the environment win over a stored value', async () => {
    await writeConfigValue('TEST_LAYER_KEY', 'from-store');
    process.env.TEST_LAYER_KEY = 'from-env';
    expect(await readConfigValue('TEST_LAYER_KEY')).toBe('from-env');
  });

  it('deletes a stored value', async () => {
    await writeConfigValue('TEST_LAYER_KEY', 'abc123');
    await deleteConfigValue('TEST_LAYER_KEY');
    expect(await readConfigValue('TEST_LAYER_KEY')).toBeUndefined();
  });

  it('reports status without ever revealing a value', async () => {
    await writeConfigValue('TEST_LAYER_KEY', 'super-secret');
    const status = await configStatus(['TEST_LAYER_KEY', 'ABSENT_KEY']);
    expect(status.TEST_LAYER_KEY).toEqual({ configured: true, source: 'store' });
    expect(status.ABSENT_KEY).toEqual({ configured: false, source: null });
    expect(JSON.stringify(status)).not.toContain('super-secret');
  });

  it('reports env as the source when the environment supplies the value', async () => {
    process.env.TEST_LAYER_KEY = 'from-env';
    const status = await configStatus(['TEST_LAYER_KEY']);
    expect(status.TEST_LAYER_KEY).toEqual({ configured: true, source: 'env' });
  });

  it('writes the store file with owner-only permissions', async () => {
    await writeConfigValue('TEST_LAYER_KEY', 'abc123');
    const { stat } = await import('node:fs/promises');
    const s = await stat(join(dir, 'layer-config.json'));
    expect(s.mode & 0o777).toBe(0o600);
  });

  it('survives a corrupt store file rather than throwing', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'layer-config.json'), 'not json at all');
    expect(await readConfigValue('TEST_LAYER_KEY')).toBeUndefined();
    await writeConfigValue('TEST_LAYER_KEY', 'recovered');
    expect(await readConfigValue('TEST_LAYER_KEY')).toBe('recovered');
    expect(JSON.parse(await readFile(join(dir, 'layer-config.json'), 'utf8'))).toBeTruthy();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/lib/layers/config-store.test.ts`
Expected: FAIL — cannot resolve `./config-store`.

- [ ] **Step 7: Write `src/lib/layers/config-store.ts`**

```ts
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Runtime credential store, deliberately separate from the manifest
 * directory: manifests are shareable and commit-friendly, secrets are
 * neither, and one .gitignore mistake must not publish a token.
 *
 * Values are write-only from the outside world. There is no endpoint that
 * returns one, masked or otherwise -- only configStatus(), which reports
 * whether a key is set and where it came from.
 */
let configDir = process.env.OSIRIS_CONFIG_DIR ?? '/app/config';

/** Test seam. Production reads OSIRIS_CONFIG_DIR or falls back to /app/config. */
export function setConfigDir(dir: string): void {
  configDir = dir;
}

function storePath(): string {
  return join(configDir, 'layer-config.json');
}

async function readStore(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(storePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // Missing or corrupt: an unreadable store must not take the app down, and
    // the next write repairs it.
    return {};
  }
}

async function writeStore(data: Record<string, string>): Promise<void> {
  await mkdir(configDir, { recursive: true });
  await writeFile(storePath(), JSON.stringify(data, null, 2), { mode: 0o600 });
  // writeFile only applies `mode` when it creates the file, so an existing
  // file keeps whatever permissions it had.
  await chmod(storePath(), 0o600);
}

export async function readConfigValue(key: string): Promise<string | undefined> {
  const fromEnv = process.env[key];
  if (fromEnv) return fromEnv;
  const store = await readStore();
  return store[key] || undefined;
}

export async function writeConfigValue(key: string, value: string): Promise<void> {
  const store = await readStore();
  store[key] = value;
  await writeStore(store);
}

export async function deleteConfigValue(key: string): Promise<void> {
  const store = await readStore();
  delete store[key];
  await writeStore(store);
}

export async function configStatus(
  keys: string[],
): Promise<Record<string, { configured: boolean; source: 'env' | 'store' | null }>> {
  const store = await readStore();
  const out: Record<string, { configured: boolean; source: 'env' | 'store' | null }> = {};
  for (const key of keys) {
    if (process.env[key]) out[key] = { configured: true, source: 'env' };
    else if (store[key]) out[key] = { configured: true, source: 'store' };
    else out[key] = { configured: false, source: null };
  }
  return out;
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `npx vitest run src/lib/layers/config-store.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 9: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/layers/config-store.ts src/lib/layers/config-store.test.ts \
        src/lib/layers/substitute.ts src/lib/layers/substitute.test.ts
git commit -m "feat(layers): runtime credential store and server-side substitution

Values are write-only from outside: configStatus reports whether a key is
set and where it came from, and no endpoint returns a value, masked or
otherwise. The environment wins over the store so a key set in
docker-compose is never silently shadowed by something typed into a
browser. The store lives outside the manifest directory because manifests
are shareable and secrets are not."
```
