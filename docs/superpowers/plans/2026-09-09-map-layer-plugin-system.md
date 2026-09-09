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
