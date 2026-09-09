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

---

### Task 8: The manifest registry — discovery, merge and reload

**Files:**
- Create: `src/lib/layers/registry.ts`
- Test: `src/lib/layers/registry.test.ts`

**Interfaces:**
- Consumes: `validateManifest` from `./validate`; `NormalisedManifest` from `./types`.
- Produces:
  - `setManifestDirs(builtin: string, dropin: string): void` — test seam
  - `loadRegistry(): Promise<Registry>` — cached
  - `reloadRegistry(): Promise<Registry>` — forces a re-read
  - `type Registry = { manifests: NormalisedManifest[]; errors: string[]; loadedAt: number }`

**Context.** Two directories: built-ins shipped at `src/lib/layers/manifests/`, and the operator drop-in directory bind-mounted at `/app/layers`. Drop-ins merge over built-ins **by id**, so an operator can override a shipped layer's colour or poll interval without forking.

Discovery runs at first call and again on explicit reload, which is what makes "no rebuild, no container restart" true. A **missing drop-in directory is normal**, not an error — most installs won't have one.

Invalid manifests are excluded from `manifests` but their errors are retained in `errors`, so the plugins panel can name the file and the fault.

- [ ] **Step 1: Write the failing test — `src/lib/layers/registry.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setManifestDirs, loadRegistry, reloadRegistry } from './registry';

let root: string, builtin: string, dropin: string;

const manifest = (id: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  id, label: id, group: 'HAZARD',
  source: { kind: 'http', format: 'json', url: 'https://example.org/x', lat: 'lat', lng: 'lng', properties: {}, refresh: { mode: 'once' } },
  layers: [{ suffix: 'dots', type: 'circle' }],
  ...extra,
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'osiris-reg-'));
  builtin = join(root, 'builtin');
  dropin = join(root, 'dropin');
  await mkdir(builtin, { recursive: true });
  setManifestDirs(builtin, dropin);
});

afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('registry', () => {
  it('loads built-in manifests', async () => {
    await writeFile(join(builtin, 'radiation.json'), manifest('radiation'));
    const r = await reloadRegistry();
    expect(r.manifests.map(m => m.id)).toEqual(['radiation']);
    expect(r.errors).toEqual([]);
  });

  it('treats a missing drop-in directory as normal', async () => {
    await writeFile(join(builtin, 'radiation.json'), manifest('radiation'));
    const r = await reloadRegistry();
    expect(r.errors).toEqual([]);
    expect(r.manifests).toHaveLength(1);
  });

  it('adds drop-in manifests alongside built-ins', async () => {
    await writeFile(join(builtin, 'radiation.json'), manifest('radiation'));
    await mkdir(dropin, { recursive: true });
    await writeFile(join(dropin, 'custom.json'), manifest('custom'));
    const r = await reloadRegistry();
    expect(r.manifests.map(m => m.id).sort()).toEqual(['custom', 'radiation']);
  });

  it('lets a drop-in override a built-in of the same id', async () => {
    await writeFile(join(builtin, 'radiation.json'), manifest('radiation', { label: 'Shipped' }));
    await mkdir(dropin, { recursive: true });
    await writeFile(join(dropin, 'radiation.json'), manifest('radiation', { label: 'Overridden' }));
    const r = await reloadRegistry();
    expect(r.manifests).toHaveLength(1);
    expect(r.manifests[0].label).toBe('Overridden');
  });

  it('reports a malformed manifest by filename and keeps the valid ones', async () => {
    await writeFile(join(builtin, 'good.json'), manifest('good'));
    await writeFile(join(builtin, 'bad.json'), '{ not valid json');
    const r = await reloadRegistry();
    expect(r.manifests.map(m => m.id)).toEqual(['good']);
    expect(r.errors.join(' ')).toContain('bad.json');
  });

  it('reports a manifest that fails validation, naming the fault', async () => {
    await writeFile(join(builtin, 'bad.json'), JSON.stringify({ id: 'x', label: 'X', group: 'G' }));
    const r = await reloadRegistry();
    expect(r.manifests).toEqual([]);
    expect(r.errors.join(' ')).toContain('bad.json');
    expect(r.errors.join(' ')).toContain('datasets');
  });

  it('ignores non-JSON files', async () => {
    await writeFile(join(builtin, 'radiation.json'), manifest('radiation'));
    await writeFile(join(builtin, 'README.md'), '# not a manifest');
    const r = await reloadRegistry();
    expect(r.manifests).toHaveLength(1);
    expect(r.errors).toEqual([]);
  });

  it('caches, and reload picks up a newly dropped file', async () => {
    await writeFile(join(builtin, 'radiation.json'), manifest('radiation'));
    const first = await loadRegistry();
    await mkdir(dropin, { recursive: true });
    await writeFile(join(dropin, 'late.json'), manifest('late'));
    expect((await loadRegistry()).manifests).toHaveLength(first.manifests.length);
    expect((await reloadRegistry()).manifests.map(m => m.id).sort()).toEqual(['late', 'radiation']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/layers/registry.test.ts`
Expected: FAIL — cannot resolve `./registry`.

- [ ] **Step 3: Write `src/lib/layers/registry.ts`**

```ts
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NormalisedManifest } from './types';
import { validateManifest } from './validate';

export interface Registry {
  manifests: NormalisedManifest[];
  errors: string[];
  loadedAt: number;
}

let builtinDir = join(process.cwd(), 'src', 'lib', 'layers', 'manifests');
let dropinDir = process.env.OSIRIS_LAYERS_DIR ?? '/app/layers';
let cached: Registry | null = null;

/** Test seam. Production uses the packaged manifests plus OSIRIS_LAYERS_DIR. */
export function setManifestDirs(builtin: string, dropin: string): void {
  builtinDir = builtin;
  dropinDir = dropin;
  cached = null;
}

async function readDir(dir: string, errors: string[], required: boolean) {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    // A missing drop-in directory is the normal case for most installs.
    if (required) errors.push(`${dir}: manifest directory could not be read`);
    return [] as Array<{ origin: string; raw: unknown }>;
  }
  const out: Array<{ origin: string; raw: unknown }> = [];
  for (const name of names.filter(n => n.endsWith('.json')).sort()) {
    try {
      out.push({ origin: name, raw: JSON.parse(await readFile(join(dir, name), 'utf8')) });
    } catch (e) {
      errors.push(`${name}: not valid JSON (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return out;
}

export async function reloadRegistry(): Promise<Registry> {
  const errors: string[] = [];
  const files = [
    ...(await readDir(builtinDir, errors, true)),
    // Drop-ins are read second so they overwrite a built-in of the same id.
    ...(await readDir(dropinDir, errors, false)),
  ];

  const byId = new Map<string, NormalisedManifest>();
  for (const { origin, raw } of files) {
    const result = validateManifest(raw, origin);
    if (result.ok) byId.set(result.manifest.id, result.manifest);
    else errors.push(...result.errors);
  }

  cached = { manifests: [...byId.values()], errors, loadedAt: Date.now() };
  return cached;
}

export async function loadRegistry(): Promise<Registry> {
  return cached ?? reloadRegistry();
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/layers/registry.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/layers/registry.ts src/lib/layers/registry.test.ts
git commit -m "feat(layers): manifest registry with drop-in override and reload

Drop-ins merge over built-ins by id, so an operator can retune a shipped
layer without forking. A missing drop-in directory is the normal case,
not an error. Invalid manifests are excluded but their errors are kept
with the filename attached, so the plugins panel can show an operator
what they typoed instead of leaving it in container logs."
```

---

### Task 9: Parsing and mapping upstream responses into features

**Files:**
- Create: `src/lib/layers/http-source.ts`
- Test: `src/lib/layers/http-source.test.ts`

**Interfaces:**
- Consumes: `GeoFeature` from `./types`.
- Produces:
  - `getPath(obj: unknown, path: string): unknown`
  - `parseCsv(text: string): Record<string, string>[]`
  - `extractRows(format: 'json' | 'geojson' | 'csv', text: string, arrayPath?: string): unknown[]`
  - `rowsToFeatures(rows: unknown[], opts: { lat: string; lng: string; properties: Record<string, string>; passthroughGeometry?: boolean }): GeoFeature[]`

**Context.** This is deliberately a separate module from the route, because route files are awkward to unit-test and this is where the fiddly correctness lives. `npm test` matches `src/**/*.test.ts` only, so logic that needs a test must not live in `src/app/api/**`.

A row whose coordinates are missing or non-numeric is **dropped, not emitted at 0,0** — otherwise every unparseable record piles up in the Gulf of Guinea, which is a classic map bug.

- [ ] **Step 1: Write the failing test — `src/lib/layers/http-source.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { getPath, parseCsv, extractRows, rowsToFeatures } from './http-source';

describe('getPath', () => {
  it('reads a top-level key', () => {
    expect(getPath({ a: 1 }, 'a')).toBe(1);
  });
  it('reads a nested path', () => {
    expect(getPath({ a: { b: { c: 'x' } } }, 'a.b.c')).toBe('x');
  });
  it('reads through an array index', () => {
    expect(getPath({ a: [{ b: 2 }] }, 'a.0.b')).toBe(2);
  });
  it('returns undefined for a missing path without throwing', () => {
    expect(getPath({ a: 1 }, 'a.b.c')).toBeUndefined();
    expect(getPath(null, 'a')).toBeUndefined();
  });
});

describe('parseCsv', () => {
  it('parses a header and rows', () => {
    expect(parseCsv('hex,good,bad\nabc,10,2\ndef,5,0')).toEqual([
      { hex: 'abc', good: '10', bad: '2' },
      { hex: 'def', good: '5', bad: '0' },
    ]);
  });
  it('ignores a trailing newline and blank lines', () => {
    expect(parseCsv('a,b\n1,2\n\n')).toEqual([{ a: '1', b: '2' }]);
  });
  it('handles quoted fields containing commas', () => {
    expect(parseCsv('a,b\n"x,y",2')).toEqual([{ a: 'x,y', b: '2' }]);
  });
  it('returns an empty array for an empty document', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('justheaders,only')).toEqual([]);
  });
});

describe('extractRows', () => {
  it('returns a top-level JSON array', () => {
    expect(extractRows('json', '[{"a":1}]')).toEqual([{ a: 1 }]);
  });
  it('follows arrayPath into a JSON object', () => {
    expect(extractRows('json', '{"data":{"items":[{"a":1}]}}', 'data.items')).toEqual([{ a: 1 }]);
  });
  it('returns an empty array when arrayPath misses', () => {
    expect(extractRows('json', '{"data":{}}', 'data.items')).toEqual([]);
  });
  it('returns features from a GeoJSON FeatureCollection', () => {
    const fc = '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[1,2]},"properties":{"n":"x"}}]}';
    expect(extractRows('geojson', fc)).toHaveLength(1);
  });
  it('parses CSV', () => {
    expect(extractRows('csv', 'a,b\n1,2')).toEqual([{ a: '1', b: '2' }]);
  });
  it('returns an empty array for unparseable input rather than throwing', () => {
    expect(extractRows('json', 'not json')).toEqual([]);
  });
});

describe('rowsToFeatures', () => {
  const opts = { lat: 'latitude', lng: 'longitude', properties: { value: 'value', place: 'location_name' } };

  it('maps coordinates and the declared properties', () => {
    const out = rowsToFeatures([{ latitude: 37.6, longitude: -112.1, value: 48, location_name: 'Cedar City', extra: 'dropped' }], opts);
    expect(out).toHaveLength(1);
    expect(out[0].geometry).toEqual({ type: 'Point', coordinates: [-112.1, 37.6] });
    expect(out[0].properties).toEqual({ value: 48, place: 'Cedar City' });
  });

  it('coerces numeric strings in coordinates', () => {
    const out = rowsToFeatures([{ latitude: '37.6', longitude: '-112.1' }], opts);
    expect(out[0].geometry).toEqual({ type: 'Point', coordinates: [-112.1, 37.6] });
  });

  it('drops rows with missing or non-numeric coordinates instead of placing them at 0,0', () => {
    const out = rowsToFeatures([
      { latitude: 1, longitude: 2 },
      { latitude: null, longitude: 2 },
      { longitude: 2 },
      { latitude: 'nope', longitude: 2 },
    ], opts);
    expect(out).toHaveLength(1);
  });

  it('drops coordinates outside valid ranges', () => {
    const out = rowsToFeatures([{ latitude: 200, longitude: 2 }, { latitude: 1, longitude: 999 }], opts);
    expect(out).toEqual([]);
  });

  it('reads nested property paths', () => {
    const out = rowsToFeatures(
      [{ latitude: 1, longitude: 2, gap: { distanceKm: '40' } }],
      { lat: 'latitude', lng: 'longitude', properties: { distance: 'gap.distanceKm' } },
    );
    expect(out[0].properties).toEqual({ distance: '40' });
  });

  it('passes GeoJSON geometry through untouched', () => {
    const rows = [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { name: 'cable' } }];
    const out = rowsToFeatures(rows, { lat: '', lng: '', properties: { name: 'name' }, passthroughGeometry: true });
    expect(out[0].geometry).toEqual({ type: 'LineString', coordinates: [[0, 0], [1, 1]] });
    expect(out[0].properties).toEqual({ name: 'cable' });
  });

  it('drops GeoJSON rows with no geometry', () => {
    const rows = [{ type: 'Feature', geometry: null, properties: {} }];
    expect(rowsToFeatures(rows, { lat: '', lng: '', properties: {}, passthroughGeometry: true })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/layers/http-source.test.ts`
Expected: FAIL — cannot resolve `./http-source`.

- [ ] **Step 3: Write `src/lib/layers/http-source.ts`**

```ts
import type { GeoFeature } from './types';

/** Dot-path accessor: 'gap.distanceKm', 'a.0.b'. Never throws. */
export function getPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Split one CSV line, honouring double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim() !== '');
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    header.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    return row;
  });
}

export function extractRows(
  format: 'json' | 'geojson' | 'csv',
  text: string,
  arrayPath?: string,
): unknown[] {
  if (format === 'csv') return parseCsv(text);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return []; }

  if (format === 'geojson') {
    const features = (parsed as { features?: unknown })?.features;
    return Array.isArray(features) ? features : [];
  }
  const target = arrayPath ? getPath(parsed, arrayPath) : parsed;
  return Array.isArray(target) ? target : [];
}

function asCoord(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function rowsToFeatures(
  rows: unknown[],
  opts: { lat: string; lng: string; properties: Record<string, string>; passthroughGeometry?: boolean },
): GeoFeature[] {
  const out: GeoFeature[] = [];

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;

    const properties: Record<string, unknown> = {};
    const propSource = opts.passthroughGeometry
      ? ((row as { properties?: unknown }).properties ?? row)
      : row;
    for (const [name, path] of Object.entries(opts.properties)) {
      properties[name] = getPath(propSource, path);
    }

    if (opts.passthroughGeometry) {
      const geometry = (row as { geometry?: unknown }).geometry;
      if (!geometry || typeof geometry !== 'object') continue;
      out.push({ type: 'Feature', geometry: geometry as GeoFeature['geometry'], properties });
      continue;
    }

    const lat = asCoord(getPath(row, opts.lat));
    const lng = asCoord(getPath(row, opts.lng));
    // A row without usable coordinates is dropped. Emitting it at 0,0 would
    // pile every unparseable record into the Gulf of Guinea.
    if (lat === null || lng === null) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;

    out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties });
  }

  return out;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/layers/http-source.test.ts`
Expected: PASS, 21 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/layers/http-source.ts src/lib/layers/http-source.test.ts
git commit -m "feat(layers): parse and map upstream responses into features

Kept out of the route because vitest only matches src/**/*.test.ts, so
logic living under src/app/api is untestable here -- and this is where
the fiddly correctness sits. Rows without usable coordinates are dropped
rather than emitted at 0,0, which would pile every unparseable record
into the Gulf of Guinea."
```

---

### Task 10: Adapter contract and dataset serving

**Files:**
- Create: `src/lib/layers/adapters/index.ts`
- Create: `src/lib/layers/serve.ts`
- Test: `src/lib/layers/serve.test.ts`

**Interfaces:**
- Consumes: `extractRows`, `rowsToFeatures` from `./http-source`; `substitute` from `./substitute`; `NormalisedManifest`, `GeoFeature` from `./types`.
- Produces:
  - `interface AdapterContext { params: Record<string, unknown>; bbox?: Bbox; config(key: string): Promise<string | undefined> }`
  - `type SourceAdapter = (ctx: AdapterContext) => Promise<GeoFeature[]>`
  - `const ADAPTERS: Record<string, SourceAdapter>`
  - `registerAdapter(name: string, fn: SourceAdapter): void`
  - `serveDatasets(manifest, datasetKeys, bbox, deps): Promise<ServeResult>`
  - `interface ServeDeps { fetchText; readConfig; adapters; now? }`

**Context.** All I/O is injected, so `serveDatasets` is testable with fakes under vitest's `node` environment. The route in Task 11 supplies the real dependencies: `safeFetch` from `src/lib/ssrf-guard.ts` (validates every redirect hop against reserved ranges) wrapped in `cachedSource` from `src/lib/sourceCache.ts` (TTL, in-flight dedup, stale-on-error).

**This is where the spec's request deduplication happens.** `cachedSource` is keyed by the *resolved* URL, so a manifest whose datasets share a URL — `flights` with four `arrayPath`s, `cf_outages`+`cf_attacks`, `maritime` with three — costs exactly one upstream request. `balloons`, whose two datasets have different SondeHub URLs, correctly costs two.

**Missing credentials return HTTP 428** with the list of unset keys, so the UI can say "this layer needs a key" rather than firing a request with a blank token and surfacing a confusing upstream 401.

- [ ] **Step 1: Write `src/lib/layers/adapters/index.ts`**

```ts
import type { GeoFeature } from '../types';

export interface Bbox { west: number; south: number; east: number; north: number }

export interface AdapterContext {
  params: Record<string, unknown>;
  bbox?: Bbox;
  /** Resolves a declared credential. Environment wins over the store. */
  config(key: string): Promise<string | undefined>;
}

export type SourceAdapter = (ctx: AdapterContext) => Promise<GeoFeature[]>;

/**
 * Named adapters for sources a manifest cannot describe -- H3 decoding, a
 * two-level response keyed by callsign, a 40-source fan-out. Registered here
 * rather than discovered, because an adapter is compiled code and must be
 * reviewable.
 */
export const ADAPTERS: Record<string, SourceAdapter> = {};

export function registerAdapter(name: string, fn: SourceAdapter): void {
  ADAPTERS[name] = fn;
}
```

- [ ] **Step 2: Write the failing test — `src/lib/layers/serve.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { serveDatasets } from './serve';
import type { NormalisedManifest, SourceSpec } from './types';
import type { ServeDeps } from './serve';

const httpSource = (url: string, over: Partial<Record<string, unknown>> = {}): SourceSpec => ({
  kind: 'http', url, format: 'json', lat: 'lat', lng: 'lng',
  properties: { n: 'name' }, refresh: { mode: 'once' }, ...over,
} as SourceSpec);

function manifest(datasets: NormalisedManifest['datasets']): NormalisedManifest {
  return {
    id: 'test', label: 'T', group: 'G', defaultOn: false, countFrom: datasets[0].key,
    requiredConfig: [], variants: [], render: { kind: 'geojson' }, datasets,
  };
}

function deps(over: Partial<ServeDeps> = {}): ServeDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async fetchText(url: string) {
      calls.push(url);
      return JSON.stringify([{ lat: 1, lng: 2, name: 'alpha' }]);
    },
    async readConfig() { return undefined; },
    adapters: {},
    ...over,
  } as ServeDeps & { calls: string[] };
}

describe('serveDatasets', () => {
  it('fetches an http dataset and returns a FeatureCollection', async () => {
    const d = deps();
    const r = await serveDatasets(manifest([{ key: 'default', source: httpSource('https://x/a'), layers: [] }]), ['default'], undefined, d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datasets.default.type).toBe('FeatureCollection');
    expect(r.datasets.default.features).toHaveLength(1);
    expect(r.datasets.default.features[0].properties).toEqual({ n: 'alpha' });
  });

  it('expands date tokens in the url before fetching', async () => {
    const d = deps();
    await serveDatasets(
      manifest([{ key: 'default', source: httpSource('https://x/a?since={today-1d}'), layers: [] }]),
      ['default'], undefined, { ...d, now: new Date('2026-09-09T00:00:00Z') } as ServeDeps,
    );
    expect(d.calls[0]).toBe('https://x/a?since=2026-09-08');
  });

  it('returns 428 and the missing keys when a credential is unset', async () => {
    const d = deps();
    const r = await serveDatasets(
      manifest([{ key: 'default', source: httpSource('https://x/a', { headers: { Authorization: 'Bearer {config.ACLED_KEY}' } }), layers: [] }]),
      ['default'], undefined, d,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(428);
    expect(r.needsConfig).toEqual(['ACLED_KEY']);
    expect(d.calls).toEqual([]);
  });

  it('substitutes a resolved credential into headers', async () => {
    const seen: Record<string, string>[] = [];
    const d = deps({
      async readConfig(key: string) { return key === 'ACLED_KEY' ? 'secret' : undefined; },
      async fetchText(_u: string, headers: Record<string, string>) { seen.push(headers); return '[]'; },
    });
    await serveDatasets(
      manifest([{ key: 'default', source: httpSource('https://x/a', { headers: { Authorization: 'Bearer {config.ACLED_KEY}' } }), layers: [] }]),
      ['default'], undefined, d,
    );
    expect(seen[0].Authorization).toBe('Bearer secret');
  });

  it('dispatches to a named adapter and passes params and bbox', async () => {
    let got: { params: unknown; bbox: unknown } | null = null;
    const d = deps({
      adapters: {
        sondehub: async ctx => { got = { params: ctx.params, bbox: ctx.bbox }; return []; },
      },
    });
    const src: SourceSpec = { kind: 'adapter', adapter: 'sondehub', params: { duration: '1d' }, refresh: { mode: 'once' } };
    const bbox = { west: 0, south: 0, east: 1, north: 1 };
    const r = await serveDatasets(manifest([{ key: 'default', source: src, layers: [] }]), ['default'], bbox, d);
    expect(r.ok).toBe(true);
    expect(got).toEqual({ params: { duration: '1d' }, bbox });
  });

  it('returns 500 naming an adapter that is not registered', async () => {
    const src: SourceSpec = { kind: 'adapter', adapter: 'nope', refresh: { mode: 'once' } };
    const r = await serveDatasets(manifest([{ key: 'default', source: src, layers: [] }]), ['default'], undefined, deps());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(500);
    expect(r.error).toContain('nope');
  });

  it('returns 404 for a dataset key the manifest does not define', async () => {
    const r = await serveDatasets(manifest([{ key: 'default', source: httpSource('https://x/a'), layers: [] }]), ['ghost'], undefined, deps());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(404);
  });

  it('serves several datasets in one call', async () => {
    const d = deps({
      async fetchText() { return JSON.stringify({ a: [{ lat: 1, lng: 2, name: 'A' }], b: [{ lat: 3, lng: 4, name: 'B' }] }); },
    });
    const m = manifest([
      { key: 'a', source: httpSource('https://x/shared', { arrayPath: 'a' }), layers: [] },
      { key: 'b', source: httpSource('https://x/shared', { arrayPath: 'b' }), layers: [] },
    ]);
    const r = await serveDatasets(m, ['a', 'b'], undefined, d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datasets.a.features[0].properties).toEqual({ n: 'A' });
    expect(r.datasets.b.features[0].properties).toEqual({ n: 'B' });
  });

  it('returns 502 when the upstream throws', async () => {
    const d = deps({ async fetchText() { throw new Error('upstream exploded'); } });
    const r = await serveDatasets(manifest([{ key: 'default', source: httpSource('https://x/a'), layers: [] }]), ['default'], undefined, d);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(502);
  });

  it('refuses to serve computed and none sources', async () => {
    const computed = manifest([{ key: 'default', source: { kind: 'computed', compute: 'solar-terminator' }, layers: [] }]);
    const r = await serveDatasets(computed, ['default'], undefined, deps());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/lib/layers/serve.test.ts`
Expected: FAIL — cannot resolve `./serve`.

- [ ] **Step 4: Write `src/lib/layers/serve.ts`**

```ts
import type { GeoFeature, NormalisedManifest, SourceSpec } from './types';
import { extractRows, rowsToFeatures } from './http-source';
import { substitute } from './substitute';
import type { Bbox, SourceAdapter } from './adapters';

export interface ServeDeps {
  /** Fetches an upstream URL. The route supplies safeFetch wrapped in cachedSource. */
  fetchText(url: string, headers: Record<string, string>, ttlMs: number): Promise<string>;
  readConfig(key: string): Promise<string | undefined>;
  adapters: Record<string, SourceAdapter>;
  now?: Date;
}

export type FeatureCollection = { type: 'FeatureCollection'; features: GeoFeature[] };

export type ServeResult =
  | { ok: true; datasets: Record<string, FeatureCollection> }
  | { ok: false; status: number; error: string; needsConfig?: string[] };

const DEFAULT_TTL_MS = 15 * 60 * 1000;

/**
 * Resolve one manifest's requested datasets into FeatureCollections.
 *
 * All I/O is injected so this is unit-testable. The route wires in safeFetch
 * (which re-validates every redirect hop against reserved ranges) wrapped in
 * cachedSource -- and because that cache is keyed by the *resolved* URL, two
 * datasets sharing a URL cost exactly one upstream request.
 */
export async function serveDatasets(
  manifest: NormalisedManifest,
  datasetKeys: string[],
  bbox: Bbox | undefined,
  deps: ServeDeps,
): Promise<ServeResult> {
  const out: Record<string, FeatureCollection> = {};

  for (const key of datasetKeys) {
    const dataset = manifest.datasets.find(d => d.key === key);
    if (!dataset) {
      return { ok: false, status: 404, error: `${manifest.id}: no dataset '${key}'` };
    }

    const source: SourceSpec = dataset.source;

    if (source.kind === 'computed' || source.kind === 'none') {
      return { ok: false, status: 400, error: `${manifest.id}/${key}: source kind '${source.kind}' is rendered client-side and is not served` };
    }

    if (source.kind === 'adapter') {
      const adapter = deps.adapters[source.adapter];
      if (!adapter) {
        return { ok: false, status: 500, error: `${manifest.id}/${key}: no adapter registered named '${source.adapter}'` };
      }
      try {
        const features = await adapter({
          params: source.params ?? {},
          bbox,
          config: deps.readConfig,
        });
        out[key] = { type: 'FeatureCollection', features };
      } catch (e) {
        return { ok: false, status: 502, error: `${manifest.id}/${key}: adapter failed — ${e instanceof Error ? e.message : String(e)}` };
      }
      continue;
    }

    // ── http ──
    const resolved = new Map<string, string | undefined>();
    const resolveKey = (k: string) => {
      if (!resolved.has(k)) throw new Error(`unresolved ${k}`);
      return resolved.get(k);
    };

    // Collect every {config.X} referenced by the url and headers, resolve them
    // up front, and refuse before making a request if any is unset.
    const templates = [source.url, ...Object.values(source.headers ?? {})];
    const missing = new Set<string>();
    for (const t of templates) {
      for (const k of substitute(t, () => undefined, deps.now).missing) {
        const value = await deps.readConfig(k);
        resolved.set(k, value);
        if (!value) missing.add(k);
      }
    }
    if (missing.size > 0) {
      return {
        ok: false, status: 428,
        error: `${manifest.id}: missing configuration`,
        needsConfig: [...missing],
      };
    }

    const url = substitute(source.url, resolveKey, deps.now).text;
    const headers: Record<string, string> = {};
    for (const [name, template] of Object.entries(source.headers ?? {})) {
      headers[name] = substitute(template, resolveKey, deps.now).text;
    }

    const withBbox = bbox
      ? url.replace('{bbox}', `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`)
      : url;

    try {
      const text = await deps.fetchText(withBbox, headers, source.cacheTtlMs ?? DEFAULT_TTL_MS);
      const rows = extractRows(source.format, text, source.arrayPath);
      out[key] = {
        type: 'FeatureCollection',
        features: rowsToFeatures(rows, {
          lat: source.lat, lng: source.lng, properties: source.properties,
          passthroughGeometry: source.format === 'geojson',
        }),
      };
    } catch (e) {
      return { ok: false, status: 502, error: `${manifest.id}/${key}: upstream failed — ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  return { ok: true, datasets: out };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run src/lib/layers/serve.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/layers/adapters/index.ts src/lib/layers/serve.ts src/lib/layers/serve.test.ts
git commit -m "feat(layers): adapter contract and dataset serving

All I/O is injected so the resolution logic is testable; the route wires
in safeFetch wrapped in cachedSource. Because that cache keys on the
resolved URL, datasets sharing a URL collapse to one upstream request --
flights' four arrayPaths, cloudflare's two -- while balloons' two
distinct SondeHub endpoints correctly stay two.

Unset credentials return 428 with the missing keys before any request is
made, so the UI can say a key is needed instead of surfacing a confusing
upstream 401."
```
