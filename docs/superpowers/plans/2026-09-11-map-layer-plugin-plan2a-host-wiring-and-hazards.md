# Map Layer Plugin System — Plan 2a: Host Wiring and Hazards

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mount the manifest engine into the running map alongside the existing hardcoded layers, then migrate the four hazard layers (`earthquakes`, `fires`, `weather`, `radiation`) onto it and delete their hand-written code.

**Architecture:** Plan 1 built a tested but unwired engine in `src/lib/layers/`. This plan connects it: a new `GET /api/layers` route serves a credential-stripped `ClientManifest` projection to the browser, `useLayerData` executes the pure load planner, `panel-rows.ts` turns manifests into panel rows, and `OsirisMap` mounts the engine below a sentinel layer. Engine source ids are namespaced `lyr:` so the two systems cannot collide while they coexist. Batch 1 then extends `PopupSpec` with the content forms real popups need and migrates the HAZARD group.

**Tech Stack:** Next.js 15 App Router, React, MapLibre GL, TypeScript, vitest (node environment), Tailwind, framer-motion.

**Spec:** `docs/superpowers/specs/2026-09-10-map-layer-plugin-system-plan2-design.md`

## Global Constraints

- **Tests run in a `node` environment.** `vitest.config.ts` sets `environment: 'node'` and `include: ['src/**/*.test.ts']`. **Nothing in a `.tsx` file is testable here.** Tasks touching `.tsx` use `npm run build` plus a scripted manual check, and say so explicitly. Push logic into `.ts` modules so it can be tested.
- **`@/` is an alias for `src/`** (`vitest.config.ts` and `tsconfig.json`).
- **Manifest ids must equal today's `activeLayers` keys** so `?layers=` share links keep resolving. `private` is never renamed to `private_flights`.
- **No upstream URL, header, or credential may ever reach the browser.** Anything added to the client payload goes through the `ClientManifest` projection in Task 3.
- **Errors are returned, never thrown,** in `validate.ts` and the registry, so a bad manifest names its own file in the UI.
- **`npm test`, `npm run lint` and `npm run build` must all pass before any batch is deployed.**
- Commit after every task. Branch is `feat/layer-plugin-system`.

---

## Scope

This plan covers **batch 0 (host wiring)** and **batch 1 (hazards)** of the eight batches in §1.2 of the spec.

Batches 2–8 are planned in a follow-up document written after this one lands, for the same reason Plan 2 was written after Plan 1: the shape of the remaining work depends on what these tasks actually reveal. Spec §1.2.2 records this decision.

**After this plan, the system is in a deliberate half-migrated state:** four layers are manifest-driven, the rest are still hardcoded, and both render on the same map. That is the designed intermediate state, not an unfinished one — the `legacyKey` projection and the `lyr:` namespace exist to make it safe.

---

## File Structure

**New files**

| File | Responsibility |
|---|---|
| `src/lib/layers/condition.ts` | The one predicate type. Evaluates `Condition` against feature properties. Used by popup `when` and by variant filters. |
| `src/lib/layers/client-manifest.ts` | `ClientManifest` types + `toClientManifest()` — strips every server-only field. |
| `src/lib/layers/groups.ts` | Group key → `{ label, fullLabel, icon, order }`, plus the `PLUGINS` fallback. |
| `src/lib/layers/request-log.ts` | In-memory ring buffer of recent `/api/layer-source` calls. |
| `src/lib/layers/panel-rows.ts` | Pure row model: manifests + legacy groups + data + config status → grouped rows with counts. |
| `src/hooks/useLayerData.ts` | Executes `planLoads`, writes into `dataRef`/`dataVersion`. |
| `src/app/api/layers/route.ts` | `GET` — serves `ClientManifest[]`. |
| `src/app/api/layer-diagnostics/route.ts` | `GET` — registry state + request log. |
| `src/components/LayerDiagnostics.tsx` | The diagnostics panel UI. |
| `src/lib/layers/manifests/*.json` | The built-in manifests. First four land in batch 1. |
| `src/lib/layers/__fixtures__/*.json` | Captured feature properties for popup parity tests. |

**Modified files**

| File | Change |
|---|---|
| `src/lib/layers/types.ts` | `lyr:` prefix in `sourceId`; `Condition`; `template` ValueSpec; extended `PopupSpec`. |
| `src/lib/layers/values.ts` | `template` form; `resolveColor`. |
| `src/lib/layers/popup.ts` | Rewritten `renderPopup` — conditions, derived values, colours, presentation hints. |
| `src/lib/layers/engine.ts` | Uses `ClientManifest`; variant filtering via `condition.ts`; passes `lngLat` into `renderPopup`. |
| `src/lib/layers/loader.ts` | Signature narrowed to `ClientManifest`. |
| `src/lib/layers/serve.ts` | Same-origin URL resolution. |
| `src/app/api/layer-source/route.ts` | Records each request in the request log. |
| `src/components/LayerPanel.tsx` | Renders manifest rows beside remaining `LAYER_GROUPS` rows. |
| `src/components/OsirisMap.tsx` | Mounts the engine; hazard layer code deleted in Task 21. |
| `src/app/page.tsx` | Loads manifests, seeds `activeLayers`, uses `useLayerData`; hazard fetches deleted in Task 21. |

---

# BATCH 0 — Host wiring

No layer migrates in this batch. At the end of it the engine is mounted, mounts nothing, and changes no visible behaviour.

---

### Task 1: Namespace engine source and layer ids

The engine derives `sourceId('piracy', 'default') === 'piracy'`, which collides exactly with ten entries in the hand-written `sources` array in `OsirisMap.tsx`. `engine.mount()` guards with `if (!map.getSource(src))`, so it would silently adopt the legacy source and both systems would write to it. Prefixing makes them disjoint by construction.

**Files:**
- Modify: `src/lib/layers/types.ts:133-139`
- Test: `src/lib/layers/types.test.ts` (create)
- Modify: `src/lib/layers/engine.test.ts` (existing assertions reference bare ids)

**Interfaces:**
- Produces: `sourceId(layerId, datasetKey) -> 'lyr:<id>' | 'lyr:<id>--<key>'`, `mapLayerId(layerId, datasetKey, suffix) -> '<sourceId>--<suffix>'`. Every later task uses these.

- [ ] **Step 1: Write the failing test**

Create `src/lib/layers/types.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mapLayerId, sourceId } from './types';

/** The ten legacy source names in OsirisMap's `sources` array that used to collide. */
const LEGACY_SOURCES = [
  'piracy', 'balloons', 'radiation', 'fires', 'weather',
  'cctv', 'maritime', 'satellites', 'earthquakes', 'infrastructure',
];

describe('source and layer id derivation', () => {
  it('prefixes the single-dataset case', () => {
    expect(sourceId('piracy', 'default')).toBe('lyr:piracy');
  });

  it('prefixes the multi-dataset case', () => {
    expect(sourceId('maritime', 'ships')).toBe('lyr:maritime--ships');
  });

  it('derives layer ids from the prefixed source id', () => {
    expect(mapLayerId('earthquakes', 'default', 'circles')).toBe('lyr:earthquakes--circles');
    expect(mapLayerId('maritime', 'ships', 'dots')).toBe('lyr:maritime--ships--dots');
  });

  it('never collides with a legacy OsirisMap source name', () => {
    for (const legacy of LEGACY_SOURCES) {
      expect(sourceId(legacy, 'default')).not.toBe(legacy);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/layers/types.test.ts`
Expected: FAIL — `expected 'piracy' to be 'lyr:piracy'`.

- [ ] **Step 3: Implement**

Replace the two functions at the bottom of `src/lib/layers/types.ts`:

```ts
/** Namespaces every engine-owned id, so nothing can collide with a hand-written source. */
export const ID_PREFIX = 'lyr:';

export function sourceId(layerId: string, datasetKey: string): string {
  return datasetKey === 'default'
    ? `${ID_PREFIX}${layerId}`
    : `${ID_PREFIX}${layerId}--${datasetKey}`;
}

export function mapLayerId(layerId: string, datasetKey: string, suffix: string): string {
  return `${sourceId(layerId, datasetKey)}--${suffix}`;
}
```

- [ ] **Step 4: Run the new test**

Run: `npx vitest run src/lib/layers/types.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Fix the existing engine tests**

Run: `npx vitest run src/lib/layers/engine.test.ts`
Expected: FAIL — assertions naming bare ids like `'radiation--dots'`.

Update every hardcoded id string in `engine.test.ts` to its prefixed form (`'lyr:radiation--dots'`). Do not change the assertions' meaning — only the id strings.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, all suites.

- [ ] **Step 7: Commit**

```bash
git add src/lib/layers/types.ts src/lib/layers/types.test.ts src/lib/layers/engine.test.ts
git commit -m "feat(layers): namespace engine source and layer ids

The engine derived a single-dataset source id as the bare layer id,
colliding exactly with ten entries in OsirisMap's hand-written sources
array. mount() guards with getSource(), so it would have adopted the
legacy source and let both systems write to it -- a layer flickering
between two datasets every refresh, with no error anywhere.

Prefixing makes the two systems disjoint for the whole migration
instead of relying on deleting the right array entry ten times."
```

---

### Task 2: The unified condition evaluator

The spec uses one predicate type in two places: popup `when` clauses and variant filters. `engine.ts` currently has a private `matches()` for variant filters; this replaces it so there is only one predicate to learn and to test.

**Files:**
- Create: `src/lib/layers/condition.ts`
- Create: `src/lib/layers/condition.test.ts`
- Modify: `src/lib/layers/types.ts` (add `Condition`, point `VariantSpec.filter` at it)
- Modify: `src/lib/layers/engine.ts:36-41` (delete private `matches`, import `evaluate`)

**Interfaces:**
- Consumes: `coerce` from `./format`.
- Produces: `evaluate(cond: Condition, props: Record<string, unknown>) -> boolean`. Used by Task 7 (`panel-rows`), Task 14 (popup fields/links) and `engine.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/layers/condition.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { evaluate } from './condition';

describe('evaluate', () => {
  it('tests presence with exists', () => {
    expect(evaluate({ property: 'end', exists: true }, { end: '2026-01-01' })).toBe(true);
    expect(evaluate({ property: 'end', exists: true }, {})).toBe(false);
    expect(evaluate({ property: 'end', exists: true }, { end: '' })).toBe(false);
    expect(evaluate({ property: 'end', exists: false }, {})).toBe(true);
  });

  // MapLibre serialises feature properties, so a boolean arrives as a string.
  it('treats the string "false" as falsy', () => {
    expect(evaluate({ property: 'ongoing', truthy: true }, { ongoing: 'true' })).toBe(true);
    expect(evaluate({ property: 'ongoing', truthy: true }, { ongoing: 'false' })).toBe(false);
    expect(evaluate({ property: 'ongoing', truthy: true }, { ongoing: true })).toBe(true);
    expect(evaluate({ property: 'ongoing', truthy: true }, { ongoing: '0' })).toBe(false);
  });

  it('compares with equals, coercing strings', () => {
    expect(evaluate({ property: 'net', equals: 'us' }, { net: 'us' })).toBe(true);
    expect(evaluate({ property: 'mag', equals: 5 }, { mag: '5' })).toBe(true);
    expect(evaluate({ property: 'net', equals: 'us' }, { net: 'ci' })).toBe(false);
  });

  it('tests membership with in', () => {
    expect(evaluate({ property: 'cat', in: ['comms', 'military'] }, { cat: 'comms' })).toBe(true);
    expect(evaluate({ property: 'cat', in: ['comms'] }, { cat: 'science' })).toBe(false);
  });

  it('inverts the whole condition with not', () => {
    expect(evaluate({ property: 'source', equals: 'NIGGG-BAS', not: true }, { source: 'us' })).toBe(true);
    expect(evaluate({ property: 'source', equals: 'NIGGG-BAS', not: true }, { source: 'NIGGG-BAS' })).toBe(false);
  });

  it('ands multiple clauses together', () => {
    const cond = { property: 'mag', exists: true, equals: 6 };
    expect(evaluate(cond, { mag: 6 })).toBe(true);
    expect(evaluate(cond, { mag: 5 })).toBe(false);
  });

  it('is true when no clause is given', () => {
    expect(evaluate({ property: 'anything' }, {})).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/layers/condition.test.ts`
Expected: FAIL — cannot resolve `./condition`.

- [ ] **Step 3: Implement**

Create `src/lib/layers/condition.ts`:

```ts
import { coerce } from './format';
import type { Condition } from './types';

function present(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '';
}

/**
 * One predicate, shared by popup `when` clauses and variant filters, so there
 * is a single set of coercion rules rather than two that can disagree.
 * Clauses AND together; `not` inverts the result.
 */
export function evaluate(cond: Condition, props: Record<string, unknown>): boolean {
  const raw = props[cond.property];
  let ok = true;

  if (cond.exists !== undefined) ok = ok && present(raw) === cond.exists;

  if (cond.truthy !== undefined) {
    const c = coerce(raw);
    ok = ok && (present(c) && c !== false && c !== 0) === cond.truthy;
  }

  if (cond.equals !== undefined) ok = ok && coerce(raw) === cond.equals;

  if (cond.in !== undefined) ok = ok && cond.in.some(v => v === coerce(raw));

  return cond.not ? !ok : ok;
}
```

Add to `src/lib/layers/types.ts`, replacing `VariantFilter`:

```ts
export interface Condition {
  property: string;
  exists?: boolean;
  truthy?: boolean;
  equals?: unknown;
  in?: unknown[];
  /** Inverts the whole condition. */
  not?: boolean;
}

/** Kept as an alias so variant filters and popup conditions stay one concept. */
export type VariantFilter = Condition;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/layers/condition.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Replace the engine's private matcher**

In `src/lib/layers/engine.ts`, delete the private `matches` function (lines 36–41) and its use in `apply()`. Add `import { evaluate } from './condition';` and change the filter call:

```ts
      : rows.filter(f => filters.some(filter => evaluate(filter, f.properties ?? {})));
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS. The engine's variant-filter tests still pass — `evaluate` is a superset of the old `matches`, differing only in coercing `'5'` to `5`, which no existing filter relies on.

- [ ] **Step 7: Commit**

```bash
git add src/lib/layers/condition.ts src/lib/layers/condition.test.ts src/lib/layers/types.ts src/lib/layers/engine.ts
git commit -m "feat(layers): one predicate for variant filters and popup conditions

The engine had a private matcher for variant filters and the popup spec
needed conditions of its own. Two predicates would have meant two sets
of coercion rules that could disagree about whether the string 'false'
is false -- which, since MapLibre serialises feature properties, it
always arrives as."
```

---

### Task 3: `ClientManifest` projection and `GET /api/layers`

`registry.ts` is `node:fs` and server-only; `page.tsx`, `LayerPanel` and the engine are all client-side. Plan 1 left no route by which a manifest could reach the browser at all. The projection exists because a raw manifest carries `source.url` and `source.headers`, including unexpanded `{config.KEY}` templates.

**Files:**
- Create: `src/lib/layers/client-manifest.ts`
- Create: `src/lib/layers/client-manifest.test.ts`
- Create: `src/app/api/layers/route.ts`
- Modify: `src/lib/layers/loader.ts:1`, `src/lib/layers/engine.ts:1` (narrow signatures)

**Interfaces:**
- Consumes: `NormalisedManifest` from `./types`, `loadRegistry` from `./registry`.
- Produces: `ClientManifest`, `ClientDataset`, `toClientManifest(m: NormalisedManifest) -> ClientManifest`. `GET /api/layers` returns `{ manifests: ClientManifest[]; errors: string[]; loadedAt: number }`. Tasks 7, 8, 9, 10 all consume `ClientManifest`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/layers/client-manifest.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toClientManifest } from './client-manifest';
import type { NormalisedManifest } from './types';

const SECRET: NormalisedManifest = {
  id: 'war_alerts', label: 'War Alerts', group: 'THREAT',
  defaultOn: false, countFrom: 'default',
  requiredConfig: [{ key: 'ACLED_API_KEY', label: 'ACLED API key', hint: 'free' }],
  datasets: [{
    key: 'default',
    legacyKey: 'war_alerts',
    source: {
      kind: 'http',
      url: 'https://api.acleddata.com/acled/read?key={config.ACLED_API_KEY}',
      format: 'json',
      lat: 'latitude', lng: 'longitude',
      properties: { actor: 'actor1' },
      headers: { Authorization: 'Bearer {config.ACLED_API_KEY}' },
      refresh: { mode: 'poll', intervalMs: 900000 },
    },
    layers: [{ suffix: 'dots', type: 'circle', clickable: true }],
  }],
  variants: [],
  render: { kind: 'geojson' },
};

describe('toClientManifest', () => {
  it('strips the upstream url and headers', () => {
    const json = JSON.stringify(toClientManifest(SECRET));
    expect(json).not.toContain('acleddata.com');
    expect(json).not.toContain('Authorization');
    expect(json).not.toContain('config.ACLED_API_KEY');
  });

  it('keeps only kind and refresh on the source', () => {
    const [dataset] = toClientManifest(SECRET).datasets;
    expect(dataset.source).toEqual({ kind: 'http', refresh: { mode: 'poll', intervalMs: 900000 } });
  });

  it('keeps everything the client renders from', () => {
    const c = toClientManifest(SECRET);
    expect(c.id).toBe('war_alerts');
    expect(c.label).toBe('War Alerts');
    expect(c.group).toBe('THREAT');
    expect(c.countFrom).toBe('default');
    expect(c.datasets[0].layers).toEqual([{ suffix: 'dots', type: 'circle', clickable: true }]);
    expect(c.datasets[0].legacyKey).toBe('war_alerts');
  });

  it('keeps credential descriptors but never a value', () => {
    const c = toClientManifest(SECRET);
    expect(c.requiredConfig).toEqual([{ key: 'ACLED_API_KEY', label: 'ACLED API key', hint: 'free' }]);
  });

  it('passes a tile source spec through, since it is a public endpoint', () => {
    const tiled: NormalisedManifest = {
      ...SECRET, id: 'terrain_3d', requiredConfig: [],
      datasets: [{
        key: 'default',
        source: { kind: 'tiles', spec: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
        layers: [],
      }],
    };
    expect(toClientManifest(tiled).datasets[0].source.spec)
      .toEqual({ type: 'vector', url: 'https://tiles.openfreemap.org/planet' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/layers/client-manifest.test.ts`
Expected: FAIL — cannot resolve `./client-manifest`.

- [ ] **Step 3: Implement**

Create `src/lib/layers/client-manifest.ts`:

```ts
import type {
  ConfigFieldSpec, InteractionSpec, MapLayerSpec, NormalisedManifest,
  RefreshSpec, RenderSpec, SourceSpec, VariantSpec,
} from './types';

/** Everything the browser needs about a source, and nothing it must not have. */
export interface ClientSource {
  kind: SourceSpec['kind'];
  refresh?: RefreshSpec;
  /** kind:'tiles' only -- a public tile endpoint the browser fetches itself. */
  spec?: Record<string, unknown>;
  /** kind:'computed' only. */
  dependsOn?: string[];
}

export interface ClientDataset {
  key: string;
  layers: MapLayerSpec[];
  legacyKey?: string;
  source: ClientSource;
}

export interface ClientManifest {
  id: string;
  label: string;
  group: string;
  defaultOn: boolean;
  parent?: string;
  countFrom: string;
  order?: number;
  requiredConfig: ConfigFieldSpec[];
  datasets: ClientDataset[];
  variants: VariantSpec[];
  render: RenderSpec;
  interaction?: InteractionSpec;
}

/**
 * A manifest's url and headers carry unexpanded {config.KEY} templates and the
 * upstream address. Neither may reach the browser: /api/layer-source takes a
 * layer id rather than a URL precisely so an open instance cannot be driven as
 * a fetch proxy, and shipping manifests verbatim would undo that.
 */
function projectSource(source: SourceSpec): ClientSource {
  const out: ClientSource = { kind: source.kind };
  if (source.kind === 'http' || source.kind === 'adapter') out.refresh = source.refresh;
  if (source.kind === 'tiles') out.spec = source.spec;
  if (source.kind === 'computed') {
    if (source.refresh) out.refresh = source.refresh;
    if (source.dependsOn) out.dependsOn = source.dependsOn;
  }
  return out;
}

export function toClientManifest(m: NormalisedManifest): ClientManifest {
  return {
    id: m.id,
    label: m.label,
    group: m.group,
    defaultOn: m.defaultOn,
    parent: m.parent,
    countFrom: m.countFrom,
    order: m.order,
    requiredConfig: m.requiredConfig,
    datasets: m.datasets.map(d => ({
      key: d.key,
      layers: d.layers,
      legacyKey: d.legacyKey,
      source: projectSource(d.source),
    })),
    variants: m.variants,
    render: m.render,
    interaction: m.interaction,
  };
}
```

Add the two new source kinds and `order` to `src/lib/layers/types.ts`:

```ts
export type SourceSpec =
  | { kind: 'http'; url: string; format: 'json' | 'geojson' | 'csv'; arrayPath?: string;
      lat: string; lng: string; properties: Record<string, string>;
      headers?: Record<string, string>; cacheTtlMs?: number; refresh: RefreshSpec }
  | { kind: 'adapter'; adapter: string; params?: Record<string, unknown>; refresh: RefreshSpec }
  | { kind: 'computed'; compute: string; dependsOn?: string[]; refresh?: RefreshSpec }
  | { kind: 'tiles'; spec: Record<string, unknown> }
  | { kind: 'none' };
```

Add `order?: number;` to both `LayerManifest` and `NormalisedManifest`, add `sourceLayer?: string;` to `MapLayerSpec`, and carry `order: m.order` through `validateManifest`'s return object.

Create `src/app/api/layers/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { loadRegistry } from '@/lib/layers/registry';
import { toClientManifest } from '@/lib/layers/client-manifest';

/** The browser's only view of a manifest -- credential-stripped, see client-manifest.ts. */
export async function GET() {
  const registry = await loadRegistry();
  return NextResponse.json(
    {
      manifests: registry.manifests.map(toClientManifest),
      errors: registry.errors,
      loadedAt: registry.loadedAt,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
```

Narrow the two consumer signatures: in `src/lib/layers/loader.ts` change the `NormalisedManifest` import and every use to `ClientManifest`, and change `refreshOf(d: DatasetSpec)` to `refreshOf(d: ClientDataset)` reading `d.source.refresh` directly. In `src/lib/layers/engine.ts` change `NormalisedManifest` to `ClientManifest` throughout. A full `NormalisedManifest` remains structurally assignable to `ClientManifest`, so existing tests keep compiling.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/layers/client-manifest.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Verify the whole suite and the build**

Run: `npm test && npm run build`
Expected: both PASS.

- [ ] **Step 6: Verify the route by hand**

```bash
npm run dev &
sleep 8
curl -s localhost:3000/api/layers
```
Expected: `{"manifests":[],"errors":[],"loadedAt":<number>}` — the manifests directory does not exist yet, which is the correct empty state. Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/lib/layers/client-manifest.ts src/lib/layers/client-manifest.test.ts \
        src/app/api/layers/route.ts src/lib/layers/types.ts \
        src/lib/layers/loader.ts src/lib/layers/engine.ts
git commit -m "feat(layers): serve manifests to the browser, credential-stripped

Plan 1 built the registry and the data endpoint but nothing by which a
manifest could reach the browser -- registry.ts is node:fs and every
consumer is a client component.

The projection is the point. A manifest carries source.url and
source.headers with unexpanded {config.KEY} templates; layer-source
takes a layer id rather than a URL so an open instance cannot be driven
as a fetch proxy, and shipping manifests verbatim would have undone
that. Narrowing loader and engine to ClientManifest makes a leak a type
error rather than a matter of discipline."
```

---

### Task 4: `groups.ts`

**Files:**
- Create: `src/lib/layers/groups.ts`
- Create: `src/lib/layers/groups.test.ts`

**Interfaces:**
- Produces: `GROUPS: Record<string, GroupMeta>`, `resolveGroup(key: string) -> GroupMeta & { key: string }`. Task 7 consumes both.

- [ ] **Step 1: Write the failing test**

Create `src/lib/layers/groups.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { GROUPS, resolveGroup } from './groups';

describe('groups', () => {
  it('covers every group LayerPanel renders today', () => {
    for (const key of ['SDK', 'AVIATION', 'MARITIME', 'SPACE', 'SURVEIL', 'HAZARD',
                       'THREAT', 'NETWORK', 'NETINTEL', 'SIGNALS', 'DISPLAY']) {
      expect(GROUPS[key], `missing group ${key}`).toBeDefined();
    }
  });

  it('falls back to PLUGINS for an unknown group', () => {
    // A drop-in manifest naming a nonexistent group must still appear. Silently
    // disappearing is the worst possible failure mode for a drop-in file.
    expect(resolveGroup('NOT_A_REAL_GROUP').key).toBe('PLUGINS');
  });

  it('resolves a known group to itself', () => {
    expect(resolveGroup('HAZARD').key).toBe('HAZARD');
    expect(resolveGroup('HAZARD').fullLabel).toBe('NATURAL HAZARDS');
  });

  it('gives every group a distinct order', () => {
    const orders = Object.values(GROUPS).map(g => g.order);
    expect(new Set(orders).size).toBe(orders.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/layers/groups.test.ts`
Expected: FAIL — cannot resolve `./groups`.

- [ ] **Step 3: Implement**

Create `src/lib/layers/groups.ts`. Icons are React components and cannot live in JSON, so group metadata stays in code. Labels and icons are copied from the `LAYER_GROUPS` constant in `LayerPanel.tsx:42-115`; order follows its array order.

```ts
import {
  Plane, Satellite, AlertTriangle, Camera, Ship, Network, Ghost,
  Flame, Radio, Mountain, Megaphone, Puzzle,
} from 'lucide-react';
import type { ComponentType } from 'react';

export interface GroupMeta {
  label: string;
  fullLabel: string;
  icon: ComponentType<{ className?: string; style?: React.CSSProperties }>;
  order: number;
}

export const GROUPS: Record<string, GroupMeta> = {
  SDK:      { label: 'SDK',      fullLabel: 'OSIRIS SDK',         icon: Network,       order: 10 },
  AVIATION: { label: 'AVIATION', fullLabel: 'AVIATION',           icon: Plane,         order: 20 },
  MARITIME: { label: 'MARITIME', fullLabel: 'MARITIME',           icon: Ship,          order: 30 },
  SPACE:    { label: 'SPACE',    fullLabel: 'SPACE TRACKING',     icon: Satellite,     order: 40 },
  SURVEIL:  { label: 'SURVEIL',  fullLabel: 'SURVEILLANCE',       icon: Camera,        order: 50 },
  HAZARD:   { label: 'HAZARD',   fullLabel: 'NATURAL HAZARDS',    icon: Flame,         order: 60 },
  THREAT:   { label: 'THREAT',   fullLabel: 'THREATS & INTEL',    icon: AlertTriangle, order: 70 },
  NETWORK:  { label: 'NETWORK',  fullLabel: 'NETWORK INTEL',      icon: Ghost,         order: 80 },
  NETINTEL: { label: 'NETINTEL', fullLabel: 'NET & EVENT INTEL',  icon: Megaphone,     order: 90 },
  SIGNALS:  { label: 'SIGNALS',  fullLabel: 'SIGNALS INTEL',      icon: Radio,         order: 100 },
  DISPLAY:  { label: 'DISPLAY',  fullLabel: 'DISPLAY',            icon: Mountain,      order: 110 },
  /** Fallback so a drop-in naming an unknown group still appears somewhere. */
  PLUGINS:  { label: 'PLUGINS',  fullLabel: 'PLUGINS',            icon: Puzzle,        order: 120 },
};

export function resolveGroup(key: string): GroupMeta & { key: string } {
  const meta = GROUPS[key];
  return meta ? { ...meta, key } : { ...GROUPS.PLUGINS, key: 'PLUGINS' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/layers/groups.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/layers/groups.ts src/lib/layers/groups.test.ts
git commit -m "feat(layers): group metadata, with a PLUGINS fallback

Icons are React components, so group metadata is the one part of the
panel that cannot be JSON. An unknown group resolves to PLUGINS rather
than vanishing -- a drop-in file that silently fails to appear is the
worst debugging story this system could have."
```

---

### Task 5: Same-origin source URL resolution

Most migrated layers keep their existing bespoke route and point at it: `/api/fires` does the FIRMS parsing, `/api/weather` aggregates events. But `serveDatasets` runs server-side and hands the URL to `safeFetch`, which needs an absolute URL.

**Files:**
- Modify: `src/lib/layers/serve.ts`
- Modify: `src/lib/layers/serve.test.ts`

**Interfaces:**
- Produces: `resolveSelfOrigin(url: string) -> string`. Tasks 18 and 19 depend on it; most of batches 2–7 will too.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/layers/serve.test.ts`:

```ts
import { resolveSelfOrigin } from './serve';

describe('resolveSelfOrigin', () => {
  it('leaves an absolute url alone', () => {
    expect(resolveSelfOrigin('https://api.safecast.org/measurements.json'))
      .toBe('https://api.safecast.org/measurements.json');
  });

  it('resolves a root-relative url against the instance origin', () => {
    expect(resolveSelfOrigin('/api/fires')).toBe('http://127.0.0.1:3000/api/fires');
  });

  it('honours OSIRIS_SELF_ORIGIN', () => {
    const prev = process.env.OSIRIS_SELF_ORIGIN;
    process.env.OSIRIS_SELF_ORIGIN = 'http://osiris:3000';
    try {
      expect(resolveSelfOrigin('/api/weather')).toBe('http://osiris:3000/api/weather');
    } finally {
      if (prev === undefined) delete process.env.OSIRIS_SELF_ORIGIN;
      else process.env.OSIRIS_SELF_ORIGIN = prev;
    }
  });

  it('strips a trailing slash from the configured origin', () => {
    const prev = process.env.OSIRIS_SELF_ORIGIN;
    process.env.OSIRIS_SELF_ORIGIN = 'http://osiris:3000/';
    try {
      expect(resolveSelfOrigin('/api/fires')).toBe('http://osiris:3000/api/fires');
    } finally {
      if (prev === undefined) delete process.env.OSIRIS_SELF_ORIGIN;
      else process.env.OSIRIS_SELF_ORIGIN = prev;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/layers/serve.test.ts`
Expected: FAIL — `resolveSelfOrigin` is not exported.

- [ ] **Step 3: Implement**

Add to `src/lib/layers/serve.ts`:

```ts
/**
 * A manifest may point at this instance's own route -- /api/fires does the
 * FIRMS parsing, /api/weather aggregates events -- but serveDatasets runs
 * server-side and safeFetch needs an absolute URL.
 */
export function resolveSelfOrigin(url: string): string {
  if (!url.startsWith('/')) return url;
  const origin = (process.env.OSIRIS_SELF_ORIGIN ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
  return `${origin}${url}`;
}
```

In the `http` branch of `serveDatasets`, apply it to the substituted URL:

```ts
    const url = resolveSelfOrigin(substitute(source.url, resolveKey, deps.now).text);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/layers/serve.test.ts`
Expected: PASS, including the four new cases.

- [ ] **Step 5: Document the variable**

Add to `.env.example`, near the other OSIRIS settings:

```
# Origin this instance reaches itself on, for manifests whose source points at
# one of OSIRIS's own /api routes. Defaults to http://127.0.0.1:3000.
# OSIRIS_SELF_ORIGIN=http://127.0.0.1:3000
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/layers/serve.ts src/lib/layers/serve.test.ts .env.example
git commit -m "feat(layers): resolve same-origin source urls server-side

Most migrated layers keep their bespoke route and point a manifest at
it, but serveDatasets runs server-side and safeFetch needs an absolute
URL. This is what makes the spec's claim about the submarine cables
true in practice -- the loader does not care that the host is itself."
```

---

### Task 6: Request log and `GET /api/layer-diagnostics`

After batch 8 the diagnostics panel is the only place an operator can learn why a layer is empty.

**Files:**
- Create: `src/lib/layers/request-log.ts`
- Create: `src/lib/layers/request-log.test.ts`
- Create: `src/app/api/layer-diagnostics/route.ts`
- Modify: `src/app/api/layer-source/route.ts`

**Interfaces:**
- Produces: `record(entry: Omit<RequestLogEntry,'at'>) -> void`, `recent(limit?: number) -> RequestLogEntry[]` (newest first), `clearLog() -> void` (test seam). `GET /api/layer-diagnostics` returns `{ registry: {...}, requests: RequestLogEntry[] }`. Task 11 consumes the route.

- [ ] **Step 1: Write the failing test**

Create `src/lib/layers/request-log.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { CAPACITY, clearLog, recent, record } from './request-log';

describe('request log', () => {
  beforeEach(() => clearLog());

  it('returns newest first', () => {
    record({ layer: 'fires', datasets: ['default'], status: 200, ms: 12, bytes: 900 });
    record({ layer: 'weather', datasets: ['default'], status: 502, ms: 40, bytes: 0 });
    expect(recent().map(e => e.layer)).toEqual(['weather', 'fires']);
  });

  it('stamps each entry with a time', () => {
    record({ layer: 'fires', datasets: ['default'], status: 200, ms: 12, bytes: 900 });
    expect(recent()[0].at).toBeGreaterThan(0);
  });

  it('drops the oldest past capacity', () => {
    for (let i = 0; i < CAPACITY + 25; i++) {
      record({ layer: `l${i}`, datasets: ['default'], status: 200, ms: 1, bytes: 1 });
    }
    const all = recent(CAPACITY + 100);
    expect(all).toHaveLength(CAPACITY);
    expect(all[0].layer).toBe(`l${CAPACITY + 24}`);
    expect(all[CAPACITY - 1].layer).toBe('l25');
  });

  it('honours a limit', () => {
    for (let i = 0; i < 10; i++) {
      record({ layer: `l${i}`, datasets: ['default'], status: 200, ms: 1, bytes: 1 });
    }
    expect(recent(3)).toHaveLength(3);
  });

  // Same reasoning as ClientManifest: the resolved upstream URL never leaves
  // the server, and a diagnostics payload is not an exception.
  it('has no field that could carry an upstream url or header', () => {
    record({ layer: 'fires', datasets: ['default'], status: 200, ms: 12, bytes: 900 });
    const json = JSON.stringify(recent()[0]);
    expect(json).not.toContain('http');
    expect(Object.keys(recent()[0]).sort())
      .toEqual(['at', 'bytes', 'datasets', 'layer', 'ms', 'status']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/layers/request-log.test.ts`
Expected: FAIL — cannot resolve `./request-log`.

- [ ] **Step 3: Implement**

Create `src/lib/layers/request-log.ts`:

```ts
export interface RequestLogEntry {
  at: number;
  layer: string;
  datasets: string[];
  status: number;
  ms: number;
  bytes: number;
  error?: string;
}

export const CAPACITY = 200;

/**
 * Diagnostic, not audit. Persisting would add a disk write per layer fetch, a
 * retention problem nobody asked for, and a file containing resolved upstream
 * URLs -- exactly what the ClientManifest projection works to keep off the
 * client. Module scope means per-process, which is correct for one container.
 */
const buffer: RequestLogEntry[] = [];

export function record(entry: Omit<RequestLogEntry, 'at'>): void {
  buffer.push({ ...entry, at: Date.now() });
  if (buffer.length > CAPACITY) buffer.splice(0, buffer.length - CAPACITY);
}

export function recent(limit = CAPACITY): RequestLogEntry[] {
  return buffer.slice(-limit).reverse();
}

/** Test seam. */
export function clearLog(): void {
  buffer.length = 0;
}
```

In `src/app/api/layer-source/route.ts`, wrap the serve call. After computing `result` and before returning, record the outcome — capture `const started = Date.now();` immediately before `serveDatasets`:

```ts
  const body = result.ok
    ? { datasets: result.datasets }
    : { error: result.error, ...(result.needsConfig ? { needsConfig: result.needsConfig } : {}) };
  const json = JSON.stringify(body);

  record({
    layer: layerId,
    datasets: datasetKeys,
    status: result.ok ? 200 : result.status,
    ms: Date.now() - started,
    bytes: json.length,
    ...(result.ok ? {} : { error: result.error }),
  });

  return new NextResponse(json, {
    status: result.ok ? 200 : result.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
```

Create `src/app/api/layer-diagnostics/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { loadRegistry } from '@/lib/layers/registry';
import { recent } from '@/lib/layers/request-log';

/** Same admin rule as the other administrative routes: open unless a token is set. */
function unauthorised(request: NextRequest): boolean {
  const admin = process.env.OSIRIS_ADMIN_TOKEN;
  return !!admin && request.headers.get('x-osiris-admin') !== admin;
}

export async function GET(request: NextRequest) {
  if (unauthorised(request)) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  const registry = await loadRegistry();
  return NextResponse.json(
    {
      registry: {
        count: registry.manifests.length,
        loadedAt: registry.loadedAt,
        layers: registry.manifests.map(m => ({ id: m.id, group: m.group, label: m.label })),
        errors: registry.errors,
      },
      requests: recent(100),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/layers/request-log.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Verify build and route**

```bash
npm run build && npm run dev &
sleep 8
curl -s localhost:3000/api/layer-diagnostics
```
Expected: `{"registry":{"count":0,...,"errors":[]},"requests":[]}`. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/lib/layers/request-log.ts src/lib/layers/request-log.test.ts \
        src/app/api/layer-diagnostics/route.ts src/app/api/layer-source/route.ts
git commit -m "feat(layers): request log and the diagnostics endpoint

An in-memory ring buffer rather than a file: this log is diagnostic
rather than audit, and persisting it would add a disk write per layer
fetch, a retention problem, and a file full of resolved upstream URLs.
Entries carry the layer id and dataset keys and never the URL, on the
same reasoning as the ClientManifest projection."
```

---

### Task 7: `panel-rows.ts` — the pure row model

`LayerPanel.tsx` cannot be unit-tested in this repo, so the logic it needs — merging manifest rows with remaining legacy rows, computing counts, deciding credential state — lives in a `.ts` module that can be.

**Files:**
- Create: `src/lib/layers/panel-rows.ts`
- Create: `src/lib/layers/panel-rows.test.ts`

**Interfaces:**
- Consumes: `ClientManifest` (Task 3), `evaluate` (Task 2), `resolveGroup` (Task 4).
- Produces: `buildPanelGroups(input: PanelInput) -> PanelGroup[]`, and the `PanelRow` / `PanelGroup` / `PanelInput` / `CredentialState` types. Task 9 renders them.

- [ ] **Step 1: Write the failing test**

Create `src/lib/layers/panel-rows.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildPanelGroups } from './panel-rows';
import type { ClientManifest } from './client-manifest';

const quakes: ClientManifest = {
  id: 'earthquakes', label: 'Earthquakes', group: 'HAZARD',
  defaultOn: true, countFrom: 'default', order: 10, requiredConfig: [],
  datasets: [{ key: 'default', layers: [], source: { kind: 'http', refresh: { mode: 'once' } } }],
  variants: [], render: { kind: 'geojson' },
};

const sats: ClientManifest = {
  id: 'satellites', label: 'All Satellites', group: 'SPACE',
  defaultOn: false, countFrom: 'default', requiredConfig: [],
  datasets: [{ key: 'default', layers: [], source: { kind: 'http', refresh: { mode: 'once' } } }],
  variants: [
    { id: 'sat_comms', label: 'Starlink / Comms', filter: { property: 'category', equals: 'comms' } },
    { id: 'sat_military', label: 'Military / Intel', filter: { property: 'category', equals: 'military' } },
  ],
  render: { kind: 'geojson' },
};

const gated: ClientManifest = {
  ...quakes, id: 'cf_outages', label: 'Internet Outages', group: 'NETINTEL', order: 10,
  requiredConfig: [{ key: 'CLOUDFLARE_API_TOKEN', label: 'Cloudflare token' }],
};

const softGated: ClientManifest = {
  ...quakes, id: 'flights', label: 'Commercial', group: 'AVIATION', order: 10,
  requiredConfig: [{ key: 'OPENSKY_CLIENT_ID', label: 'OpenSky id', optional: true }],
};

const rowsOf = (groups: ReturnType<typeof buildPanelGroups>, key: string) =>
  groups.find(g => g.key === key)!.rows;

describe('buildPanelGroups', () => {
  it('builds one row per manifest, in its group', () => {
    const groups = buildPanelGroups({ manifests: [quakes], legacy: [], data: {}, configStatus: {} });
    expect(rowsOf(groups, 'HAZARD')).toMatchObject([{ key: 'earthquakes', label: 'Earthquakes' }]);
  });

  it('counts rows from the countFrom dataset', () => {
    const data = { 'earthquakes.default': [{}, {}, {}] };
    const groups = buildPanelGroups({ manifests: [quakes], legacy: [], data, configStatus: {} });
    expect(rowsOf(groups, 'HAZARD')[0].count).toBe(3);
  });

  it('shows a null count when the dataset has never loaded', () => {
    const groups = buildPanelGroups({ manifests: [quakes], legacy: [], data: {}, configStatus: {} });
    expect(rowsOf(groups, 'HAZARD')[0].count).toBeNull();
  });

  it('renders variants as sibling rows, counted post-filter', () => {
    const data = {
      'satellites.default': [
        { properties: { category: 'comms' } },
        { properties: { category: 'comms' } },
        { properties: { category: 'military' } },
      ],
    };
    const rows = rowsOf(buildPanelGroups({ manifests: [sats], legacy: [], data, configStatus: {} }), 'SPACE');
    expect(rows.map(r => r.key)).toEqual(['satellites', 'sat_comms', 'sat_military']);
    expect(rows[0].count).toBe(3);
    expect(rows[1].count).toBe(2);
    expect(rows[2].count).toBe(1);
  });

  it('marks a missing mandatory credential as required-missing', () => {
    const groups = buildPanelGroups({ manifests: [gated], legacy: [], data: {}, configStatus: {} });
    expect(rowsOf(groups, 'NETINTEL')[0].credential).toBe('required-missing');
  });

  // A layer that works without its key must not look disabled, or declaring
  // credentials everywhere would make working layers look broken.
  it('marks a missing optional credential as optional-missing', () => {
    const groups = buildPanelGroups({ manifests: [softGated], legacy: [], data: {}, configStatus: {} });
    expect(rowsOf(groups, 'AVIATION')[0].credential).toBe('optional-missing');
  });

  it('marks a configured credential as satisfied', () => {
    const configStatus = { cf_outages: { CLOUDFLARE_API_TOKEN: { configured: true, source: 'env' as const } } };
    const groups = buildPanelGroups({ manifests: [gated], legacy: [], data: {}, configStatus });
    expect(rowsOf(groups, 'NETINTEL')[0].credential).toBe('satisfied');
  });

  it('puts an unknown group under PLUGINS', () => {
    const odd = { ...quakes, id: 'odd', group: 'NOPE' };
    const groups = buildPanelGroups({ manifests: [odd], legacy: [], data: {}, configStatus: {} });
    expect(rowsOf(groups, 'PLUGINS').map(r => r.key)).toEqual(['odd']);
  });

  it('merges legacy rows into the same group, manifest rows first', () => {
    const legacy = [{ key: 'fires', label: 'Active Fires', group: 'HAZARD', count: 7 }];
    const groups = buildPanelGroups({ manifests: [quakes], legacy, data: {}, configStatus: {} });
    expect(rowsOf(groups, 'HAZARD').map(r => r.source)).toEqual(['manifest', 'legacy']);
    expect(rowsOf(groups, 'HAZARD')[1].count).toBe(7);
  });

  it('sorts groups by their declared order and drops empty ones', () => {
    const groups = buildPanelGroups({ manifests: [sats, quakes], legacy: [], data: {}, configStatus: {} });
    expect(groups.map(g => g.key)).toEqual(['SPACE', 'HAZARD']);
  });

  it('orders rows within a group by `order`, then registry order', () => {
    const a = { ...quakes, id: 'a', order: 30 };
    const b = { ...quakes, id: 'b', order: 10 };
    const c = { ...quakes, id: 'c' };
    const groups = buildPanelGroups({ manifests: [a, b, c], legacy: [], data: {}, configStatus: {} });
    expect(rowsOf(groups, 'HAZARD').map(r => r.key)).toEqual(['b', 'a', 'c']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/layers/panel-rows.test.ts`
Expected: FAIL — cannot resolve `./panel-rows`.

- [ ] **Step 3: Implement**

Create `src/lib/layers/panel-rows.ts`:

```ts
import type { ClientManifest } from './client-manifest';
import { evaluate } from './condition';
import { GROUPS, resolveGroup, type GroupMeta } from './groups';
import type { GeoFeature } from './types';

export type CredentialState = 'none' | 'optional-missing' | 'required-missing' | 'satisfied';

export interface PanelRow {
  key: string;
  label: string;
  parent?: string;
  count: number | null;
  credential: CredentialState;
  source: 'manifest' | 'legacy';
}

export interface PanelGroup extends GroupMeta {
  key: string;
  rows: PanelRow[];
}

/** A row still owned by LAYER_GROUPS, for as long as both systems coexist. */
export interface LegacyRow {
  key: string;
  label: string;
  group: string;
  parent?: string;
  count: number | null;
}

export type ConfigStatus =
  Record<string, Record<string, { configured: boolean; source: 'env' | 'store' | null }>>;

export interface PanelInput {
  manifests: ClientManifest[];
  legacy: LegacyRow[];
  /** dataRef contents, keyed `${layerId}.${datasetKey}` plus legacy flat keys. */
  data: Record<string, unknown>;
  configStatus: ConfigStatus;
}

function rowsFor(data: Record<string, unknown>, layerId: string, datasetKey: string): GeoFeature[] | null {
  const v = data[`${layerId}.${datasetKey}`];
  return Array.isArray(v) ? (v as GeoFeature[]) : null;
}

function credentialState(m: ClientManifest, status: ConfigStatus): CredentialState {
  if (m.requiredConfig.length === 0) return 'none';
  const forLayer = status[m.id] ?? {};
  const missing = m.requiredConfig.filter(f => !forLayer[f.key]?.configured);
  if (missing.length === 0) return 'satisfied';
  // A layer that still works without its key must not render as disabled.
  return missing.every(f => f.optional) ? 'optional-missing' : 'required-missing';
}

export function buildPanelGroups(input: PanelInput): PanelGroup[] {
  const byGroup = new Map<string, { meta: GroupMeta & { key: string }; rows: PanelRow[]; order: number[] }>();

  const bucket = (groupKey: string) => {
    const meta = resolveGroup(groupKey);
    let entry = byGroup.get(meta.key);
    if (!entry) {
      entry = { meta, rows: [], order: [] };
      byGroup.set(meta.key, entry);
    }
    return entry;
  };

  input.manifests.forEach((m, index) => {
    const entry = bucket(m.group);
    const credential = credentialState(m, input.configStatus);
    const primary = rowsFor(input.data, m.id, m.countFrom);
    // `order` when given, else registry order -- panel order and z-order are
    // separate concerns and must stay that way.
    const sortKey = m.order ?? Number.MAX_SAFE_INTEGER - input.manifests.length + index;

    entry.rows.push({
      key: m.id, label: m.label, parent: m.parent,
      count: primary === null ? null : primary.length,
      credential, source: 'manifest',
    });
    entry.order.push(sortKey);

    for (const v of m.variants) {
      const dataset = v.dataset ?? m.datasets[0]?.key ?? 'default';
      const rows = rowsFor(input.data, m.id, dataset);
      const count = rows === null
        ? null
        : v.filter
          ? rows.filter(f => evaluate(v.filter!, f.properties ?? {})).length
          : rows.length;
      entry.rows.push({
        key: v.id, label: v.label, parent: m.parent,
        count, credential, source: 'manifest',
      });
      entry.order.push(sortKey);
    }
  });

  for (const row of input.legacy) {
    const entry = bucket(row.group);
    entry.rows.push({
      key: row.key, label: row.label, parent: row.parent,
      count: row.count, credential: 'none', source: 'legacy',
    });
    entry.order.push(Number.MAX_SAFE_INTEGER);
  }

  const out: PanelGroup[] = [];
  for (const entry of byGroup.values()) {
    if (entry.rows.length === 0) continue;
    const paired = entry.rows.map((row, i) => ({ row, sort: entry.order[i], i }));
    paired.sort((a, b) => (a.sort - b.sort) || (a.i - b.i));
    out.push({ ...entry.meta, rows: paired.map(p => p.row) });
  }
  return out.sort((a, b) => a.order - b.order);
}

export { GROUPS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/layers/panel-rows.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/layers/panel-rows.ts src/lib/layers/panel-rows.test.ts
git commit -m "feat(layers): pure panel row model

LayerPanel.tsx cannot be unit-tested here -- vitest runs node-only -- so
the parts worth testing live in a .ts module: merging manifest rows with
the legacy rows that still exist during migration, post-filter variant
counts, and the credential state that decides whether a row renders
dimmed or merely annotated."
```

---

### Task 8: `useLayerData` — the executor hook

**Files:**
- Create: `src/hooks/useLayerData.ts`
- Create: `src/lib/layers/execute.ts`
- Create: `src/lib/layers/execute.test.ts`

The fetch-and-store logic lives in `execute.ts` so it can be tested; the hook is a thin timer and ref wrapper around it.

**Interfaces:**
- Consumes: `planLoads`, `markStarted`, `markSettled`, `createLoadState` from `./loader`; `ClientManifest`.
- Produces: `executePlan(plan, manifests, deps) -> Promise<boolean>` and `useLayerData({ manifests, active, dataRef, bump })`. Tasks 10 and 21 consume the hook.

- [ ] **Step 1: Write the failing test**

Create `src/lib/layers/execute.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { executePlan } from './execute';
import type { ClientManifest } from './client-manifest';
import type { LoadPlan } from './loader';

const fires: ClientManifest = {
  id: 'fires', label: 'Active Fires', group: 'HAZARD',
  defaultOn: false, countFrom: 'default', requiredConfig: [],
  datasets: [{
    key: 'default', legacyKey: 'fires', layers: [],
    source: { kind: 'http', refresh: { mode: 'once' } },
  }],
  variants: [], render: { kind: 'geojson' },
};

const plan: LoadPlan = { layerId: 'fires', datasetKeys: ['default'], mode: 'once', reason: 'initial' };

describe('executePlan', () => {
  it('requests the layer by id and dataset keys, never a url', async () => {
    const fetchJson = vi.fn().mockResolvedValue({ datasets: { default: { type: 'FeatureCollection', features: [] } } });
    await executePlan(plan, [fires], { fetchJson, write: vi.fn() });
    expect(fetchJson).toHaveBeenCalledWith('/api/layer-source?layer=fires&datasets=default');
  });

  it('writes under the canonical key and the legacy key', async () => {
    const features = [{ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { a: 1 } }];
    const write = vi.fn();
    const fetchJson = vi.fn().mockResolvedValue({ datasets: { default: { type: 'FeatureCollection', features } } });
    await executePlan(plan, [fires], { fetchJson, write });
    expect(write).toHaveBeenCalledWith({ 'fires.default': features, fires: features });
  });

  it('appends a bbox for a viewport plan', async () => {
    const fetchJson = vi.fn().mockResolvedValue({ datasets: {} });
    const viewportPlan: LoadPlan = {
      ...plan, mode: 'viewport', reason: 'viewport',
      bbox: { west: -1, south: -2, east: 3, north: 4 },
    };
    await executePlan(viewportPlan, [fires], { fetchJson, write: vi.fn() });
    expect(fetchJson).toHaveBeenCalledWith('/api/layer-source?layer=fires&datasets=default&bbox=-1,-2,3,4');
  });

  it('reports failure rather than throwing, so the planner can release the mark', async () => {
    const fetchJson = vi.fn().mockRejectedValue(new Error('boom'));
    const write = vi.fn();
    await expect(executePlan(plan, [fires], { fetchJson, write })).resolves.toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it('reports success only when a dataset actually landed', async () => {
    const fetchJson = vi.fn().mockResolvedValue({ error: 'missing configuration', needsConfig: ['X'] });
    await expect(executePlan(plan, [fires], { fetchJson, write: vi.fn() })).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/layers/execute.test.ts`
Expected: FAIL — cannot resolve `./execute`.

- [ ] **Step 3: Implement `execute.ts`**

```ts
import type { ClientManifest } from './client-manifest';
import type { LoadPlan } from './loader';
import type { GeoFeature } from './types';

export interface ExecuteDeps {
  fetchJson(url: string): Promise<unknown>;
  /** Merge these keys into the data store. */
  write(patch: Record<string, GeoFeature[]>): void;
}

/** The browser sends a layer id and dataset keys. It never knows the upstream URL. */
function planUrl(plan: LoadPlan): string {
  const base = `/api/layer-source?layer=${encodeURIComponent(plan.layerId)}` +
               `&datasets=${plan.datasetKeys.map(encodeURIComponent).join(',')}`;
  if (!plan.bbox) return base;
  const { west, south, east, north } = plan.bbox;
  return `${base}&bbox=${west},${south},${east},${north}`;
}

export async function executePlan(
  plan: LoadPlan,
  manifests: ClientManifest[],
  deps: ExecuteDeps,
): Promise<boolean> {
  let body: unknown;
  try {
    body = await deps.fetchJson(planUrl(plan));
  } catch {
    return false;
  }

  const datasets = (body as { datasets?: Record<string, { features?: GeoFeature[] }> })?.datasets;
  if (!datasets) return false;

  const manifest = manifests.find(m => m.id === plan.layerId);
  const patch: Record<string, GeoFeature[]> = {};

  for (const [key, fc] of Object.entries(datasets)) {
    const features = fc?.features ?? [];
    patch[`${plan.layerId}.${key}`] = features;
    // The flat projection, read by consumers outside the map until batch 8.
    const legacyKey = manifest?.datasets.find(d => d.key === key)?.legacyKey;
    if (legacyKey) patch[legacyKey] = features;
  }

  if (Object.keys(patch).length === 0) return false;
  deps.write(patch);
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/layers/execute.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the hook**

Create `src/hooks/useLayerData.ts`. It is a `.ts` file with no JSX, but it imports React hooks — it is not unit-tested here; its logic lives in `execute.ts` and `loader.ts`, which are.

```ts
import { useCallback, useEffect, useRef } from 'react';
import type { ClientManifest } from '@/lib/layers/client-manifest';
import { executePlan } from '@/lib/layers/execute';
import {
  createLoadState, markSettled, markStarted, planLoads, type Viewport,
} from '@/lib/layers/loader';
import type { GeoFeature } from '@/lib/layers/types';

/** Coarse enough that one tick serves every poll cadence the manifests declare. */
const TICK_MS = 5000;

export interface UseLayerDataOptions {
  manifests: ClientManifest[];
  active: ReadonlySet<string>;
  viewport: Viewport | null;
  /** The existing dataRef store -- one re-render per refresh, not per render. */
  write(patch: Record<string, GeoFeature[]>): void;
}

export function useLayerData({ manifests, active, viewport, write }: UseLayerDataOptions): void {
  const state = useRef(createLoadState());
  const latest = useRef({ manifests, active, viewport, write });
  latest.current = { manifests, active, viewport, write };

  const pump = useCallback(async () => {
    const { manifests: ms, active: on, viewport: vp, write: put } = latest.current;
    const plans = planLoads(ms, on, state.current, vp, Date.now());

    await Promise.all(plans.map(async plan => {
      markStarted(state.current, plan);
      const ok = await executePlan(plan, ms, {
        fetchJson: async url => {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        },
        write: put,
      });
      // Releasing the mark on failure is what stops one timeout leaving a
      // layer empty for the rest of the session.
      markSettled(state.current, plan, ok, Date.now());
    }));
  }, []);

  useEffect(() => { void pump(); }, [pump, manifests, active, viewport]);

  useEffect(() => {
    const id = setInterval(() => { void pump(); }, TICK_MS);
    return () => clearInterval(id);
  }, [pump]);
}
```

- [ ] **Step 6: Verify the suite and the build**

Run: `npm test && npm run build`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/layers/execute.ts src/lib/layers/execute.test.ts src/hooks/useLayerData.ts
git commit -m "feat(layers): execute load plans against the data store

One timer replaces the scatter of per-source setIntervals in page.tsx --
planLoads already knows what is due from each dataset's own interval, so
a single coarse tick subsumes all of them.

The fetch and store logic lives in execute.ts so it can be tested; the
hook is the untestable part and holds nothing but a ref and a timer."
```

---

### Task 9: `LayerPanel` renders manifest rows

**This task cannot be unit-tested** — `LayerPanel.tsx` is a `.tsx` component and vitest runs node-only here. Verification is `npm run build` plus a scripted browser check. The logic it depends on was tested in Task 7.

**Files:**
- Modify: `src/components/LayerPanel.tsx`

**Interfaces:**
- Consumes: `buildPanelGroups`, `PanelGroup`, `PanelRow`, `LegacyRow` (Task 7).
- Produces: `LayerPanel` accepts two new props — `manifests: ClientManifest[]` and `configStatus: ConfigStatus`.

- [ ] **Step 1: Add the new props**

In the `LayerPanelProps` interface add:

```ts
  /** Manifest-driven rows, merged with whatever LAYER_GROUPS still owns. */
  manifests?: ClientManifest[];
  configStatus?: ConfigStatus;
```

Default them in the destructure so the component still renders if `/api/layers` has not resolved:

```ts
function LayerPanel({
  data, activeLayers, setActiveLayers, isMobile, theme = 'core', setTheme,
  capabilities = {}, manifests = [], configStatus = {}, onOpenCredentials,
}: LayerPanelProps) {
```

The import line at the top of the file currently reads `import { memo, useEffect, useState } from 'react';` — add `useMemo`, which the next step needs.

- [ ] **Step 2: Replace `visibleGroups` with the merged model**

Replace the `visibleGroups` computation (currently `LayerPanel.tsx:236-241`) with:

```ts
  /* LAYER_GROUPS still owns every layer not yet migrated. Both sets of rows
     merge into one model so the panel does not care which system owns a row. */
  const legacyRows: LegacyRow[] = useMemo(
    () => LAYER_GROUPS.flatMap(g =>
      g.layers
        .filter(l => !l.requires || capabilities[l.requires])
        .filter(l => !manifests.some(m => m.id === l.key || m.variants.some(v => v.id === l.key)))
        .map(l => ({
          key: l.key, label: l.label, group: g.label, parent: l.parent,
          count: getCount(l.dataKey, l.catKey),
        })),
    ),
    [capabilities, manifests, data],
  );

  const panelGroups = useMemo(
    () => buildPanelGroups({ manifests, legacy: legacyRows, data, configStatus }),
    [manifests, legacyRows, data, configStatus],
  );
```

The `.filter()` that drops a legacy row whose id a manifest already claims is the safety net behind the same-commit deletion rule: if a `LAYER_GROUPS` entry is ever left behind, the row appears once, not twice.

- [ ] **Step 3: Render from `panelGroups`**

Both the mobile branch and the desktop branch currently iterate `visibleGroups` and read `group.layers`, `layer.key`, `layer.label`, and `getCount(...)`. Change both to iterate `panelGroups` and read `group.rows`, `row.key`, `row.label`, `row.count`. `group.fullLabel` and `group.icon` come from the group meta as before.

For the credential states, add to the row button:

```tsx
  const locked = row.credential === 'required-missing';
  // ... on the button:
  className={`... ${locked ? 'opacity-40' : ''}`}
  onClick={() => locked ? onOpenCredentials?.(row.key) : toggle(row.key)}
  // ... after the label:
  {row.credential !== 'none' && row.credential !== 'satisfied' && (
    <KeyRound className="w-3 h-3 text-white/25" aria-label="needs a credential" />
  )}
```

Import `KeyRound` from `lucide-react`. An `optional-missing` row toggles normally and shows only the glyph; a `required-missing` row dims and opens the credential form instead of toggling. The credential form itself is built in batch 2 — for now `onOpenCredentials` is an optional prop that may be undefined.

- [ ] **Step 4: Verify the build**

Run: `npm run lint && npm run build`
Expected: both PASS.

- [ ] **Step 5: Manual check**

```bash
npm run dev
```
Open the app. Expected: **the panel looks exactly as it did before.** There are no manifests yet, so every row comes from `LAYER_GROUPS` via the legacy path. Confirm each group still opens, pins, toggles, shows its counts and its ALL/NONE control, and that the mobile layout still renders.

If any group is missing, the `group.label` used as the key in `legacyRows` does not match a key in `GROUPS` — compare against Task 4's table.

- [ ] **Step 6: Commit**

```bash
git add src/components/LayerPanel.tsx
git commit -m "feat(layers): render manifest rows beside the legacy ones

Both systems feed one row model, so the panel does not care which owns a
row. A legacy row whose id a manifest already claims is dropped, so a
LAYER_GROUPS entry left behind by mistake shows once rather than twice.

No visible change yet: no manifests exist, so every row still comes from
LAYER_GROUPS."
```

---

### Task 10: `OsirisMap` mounts the engine

**Not unit-testable** — same reason as Task 9. The engine itself is covered by `engine.test.ts` against `FakeMap`.

**Files:**
- Modify: `src/components/OsirisMap.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `LayerEngine`, `Selection` from `@/lib/layers/engine`; `ClientManifest`; `useLayerData` (Task 8).
- Produces: `OsirisMap` accepts `manifests: ClientManifest[]`.

- [ ] **Step 1: Load manifests and seed `activeLayers` in `page.tsx`**

Add beside the existing capability probe (`page.tsx:404-408`):

```tsx
  const [manifests, setManifests] = useState<ClientManifest[]>([]);
  const [configStatus, setConfigStatus] = useState<ConfigStatus>({});

  useEffect(() => {
    fetch('/api/layers')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d?.manifests) return;
        setManifests(d.manifests);
        /* Seed defaults from the manifests, then let the ?layers= restore below
           apply over the top. Manifest ids are exactly today's activeLayers
           keys, so existing share links keep resolving. */
        setActiveLayers((prev: any) => {
          const next = { ...prev };
          for (const m of d.manifests as ClientManifest[]) {
            if (!(m.id in next)) next[m.id] = m.defaultOn;
            for (const v of m.variants) if (!(v.id in next)) next[v.id] = !!v.defaultOn;
          }
          return next;
        });
      })
      .catch(() => { /* panel falls back to LAYER_GROUPS rows */ });

    fetch('/api/layer-config')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.layers) setConfigStatus(d.layers); })
      .catch(() => { /* rows render without credential annotation */ });
  }, []);
```

Wire the hook, converting `activeLayers` to the set the planner expects:

```tsx
  const activeSet = useMemo(
    () => new Set(Object.entries(activeLayers).filter(([, on]) => on).map(([k]) => k)),
    [activeLayers],
  );

  useLayerData({
    manifests,
    active: activeSet,
    viewport: null, // viewport mode arrives with CCTV in batch 5
    write: useCallback((patch: Record<string, unknown>) => {
      dataRef.current = { ...dataRef.current, ...patch };
      setDataVersion(v => v + 1);
    }, []),
  });
```

Pass the new props through to both `LayerPanel` usages (`page.tsx:1458` and `:1836`) and to `OsirisMap`:

```tsx
  manifests={manifests} configStatus={configStatus}
```

- [ ] **Step 2: Mount the engine in `OsirisMap`**

Add `manifests` to `OsirisMapProps`. After the legacy `addSource`/`addLayer` block in the map-init effect, add the sentinel:

```ts
      /* Manifest layers insert before this, so the bespoke overlays OsirisMap
         keeps -- routes, drawing, user location, watched airports, sweep --
         stay on top exactly as they sit above the hand-written layers today. */
      map.addSource('lyr:sentinel', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'lyr:overlay-floor', type: 'symbol', source: 'lyr:sentinel', layout: {} });
```

Add an effect that owns the engine:

```ts
  const engineRef = useRef<LayerEngine | null>(null);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    const engine = new LayerEngine(map as unknown as MapLike, {
      palette: paletteRef.current as unknown as Record<string, string>,
      beforeId: 'lyr:overlay-floor',
      onSelect: (sel: Selection) => {
        if (sel.kind === 'popup') {
          popupRef.current?.remove();
          popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '420px', offset: 14 })
            .setLngLat(sel.lngLat).setHTML(sel.html).addTo(map);
        } else if (sel.kind === 'panel') {
          onEntityClick?.({ type: sel.panel, ...sel.properties, lng: sel.lngLat[0], lat: sel.lngLat[1] });
        }
        // 'adapter' selections arrive with flights and satellites, batches 6-7.
      },
    });
    engine.mount(manifests);
    engine.attach();
    engineRef.current = engine;

    /* A style reload discards every source and layer, so remount and re-push. */
    const remount = () => { engine.mount(manifests); };
    map.on('styledata', remount);

    return () => {
      map.off('styledata', remount);
      engine.destroy();
      engineRef.current = null;
    };
  }, [mapReady, manifests, onEntityClick]);
```

Push data into the engine whenever it changes:

```ts
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    for (const m of manifests) {
      for (const d of m.datasets) {
        const rows = data[`${m.id}.${d.key}`];
        if (Array.isArray(rows)) engine.setData(m.id, d.key, rows);
      }
    }
  }, [dataVersion, manifests]);
```

Push activation:

```ts
  useEffect(() => {
    engineRef.current?.setActive(
      new Set(Object.entries(activeLayers).filter(([, on]) => on).map(([k]) => k)),
    );
  }, [activeLayers, manifests]);
```

Push palette, in the existing `STYLE_EVENT` effect:

```ts
    engineRef.current?.setPalette(palette as unknown as Record<string, string>);
```

- [ ] **Step 3: Make the satellite pick defer to both clickable sets**

This is the safeguard in spec §2.6 rule 4. Find the satellite pick's `CLICKABLE_LAYERS` test (`OsirisMap.tsx:1008-1013` defines the set; the pick consults it) and widen it:

```ts
      /* The engine derives its own clickable set. Until satellites migrates in
         batch 7 the pick must defer to both, or every layer that migrates
         would start losing its clicks to a satellite behind it -- the exact
         bug this project was started to fix. */
      const engineClickable = engineRef.current?.clickableLayerIds() ?? [];
      const clickable = new Set([...CLICKABLE_LAYERS, ...engineClickable]);
```

and test against `clickable` instead of `CLICKABLE_LAYERS`.

- [ ] **Step 4: Verify the build**

Run: `npm run lint && npm run build`
Expected: both PASS.

- [ ] **Step 5: Manual check**

```bash
npm run dev
```

With zero manifests the engine mounts nothing. Confirm:
1. The map renders and every existing layer still toggles.
2. Clicking a feature still opens its popup.
3. Clicking an aircraft with satellites enabled opens the **aircraft** popup, not the satellite one.
4. Switching theme still recolours layers.
5. Switching projection (globe/mercator) does not throw — check the console for `styledata` errors.
6. `document.querySelector('canvas')` — no console errors about a missing `lyr:overlay-floor`.

- [ ] **Step 6: Commit**

```bash
git add src/components/OsirisMap.tsx src/app/page.tsx
git commit -m "feat(layers): mount the engine into the live map

Mounts nothing yet -- no manifests exist -- but every seam is now in
place: the sentinel layer that keeps bespoke overlays on top, remount on
styledata, data and activation pushed from the existing dataRef store,
and palette forwarding.

The satellite pick now defers to the union of CLICKABLE_LAYERS and the
engine's derived set. Without that, each layer would start losing clicks
to a satellite behind it the moment it migrated -- one layer at a time,
the exact bug this project exists to fix."
```

---

### Task 11: The diagnostics panel

**Not unit-testable.** The data it renders is covered by Task 6.

**Files:**
- Create: `src/components/LayerDiagnostics.tsx`
- Modify: `src/components/LayerPanel.tsx` (add the rail button)

- [ ] **Step 1: Build the panel**

Create `src/components/LayerDiagnostics.tsx`, following the structure of `StyleStudio` (same motion wrapper, same dismiss behaviour). It fetches `/api/layer-diagnostics` on open and on reload, and renders three sections:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { ClientManifest } from '@/lib/layers/client-manifest';

interface Diagnostics {
  registry: { count: number; loadedAt: number; layers: { id: string; group: string; label: string }[]; errors: string[] };
  requests: { at: number; layer: string; datasets: string[]; status: number; ms: number; bytes: number; error?: string }[];
}

interface Props {
  onClose(): void;
  manifests: ClientManifest[];
  /** dataRef contents, for the per-layer row counts. */
  data: Record<string, unknown>;
  onReloaded(): void;
}

export default function LayerDiagnostics({ onClose, manifests, data, onReloaded }: Props) {
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch('/api/layer-diagnostics')
      .then(r => (r.ok ? r.json() : null))
      .then(d => setDiag(d))
      .catch(() => setDiag(null));
  }, []);

  useEffect(load, [load]);

  const reload = async () => {
    setBusy(true);
    try {
      await fetch('/api/layer-source?reload=1', { method: 'POST' });
      load();
      onReloaded();
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}
      className="absolute left-14 bottom-0 w-[420px] max-h-[70vh] overflow-y-auto rounded-lg
                 border border-white/10 bg-black/90 backdrop-blur-xl p-4 font-mono text-[11px]"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="tracking-[0.2em] text-white/50">PLUGIN DIAGNOSTICS</span>
        <div className="flex gap-2">
          <button onClick={reload} disabled={busy} className="px-2 py-1 rounded border border-white/15 text-white/60">
            {busy ? 'RELOADING…' : 'RELOAD'}
          </button>
          <button onClick={onClose} className="px-2 py-1 text-white/40">✕</button>
        </div>
      </div>

      <Section title="REGISTRY">
        <div className="text-white/50">
          {diag ? `${diag.registry.count} manifests · loaded ${new Date(diag.registry.loadedAt).toLocaleTimeString()}` : 'loading…'}
        </div>
        {diag?.registry.errors.map(e => (
          <div key={e} className="text-red-400/80 mt-1 break-words">{e}</div>
        ))}
        {diag && diag.registry.errors.length === 0 && <div className="text-white/25 mt-1">no errors</div>}
      </Section>

      <Section title="LAYERS">
        {manifests.length === 0 && <div className="text-white/25">none loaded</div>}
        {manifests.map(m => (
          <div key={m.id} className="flex justify-between gap-3 py-0.5">
            <span className="text-white/60">{m.id}</span>
            <span className="text-white/30">
              {m.datasets.map(d => {
                const rows = data[`${m.id}.${d.key}`];
                return `${d.key}:${Array.isArray(rows) ? rows.length : '—'}`;
              }).join(' ')}
            </span>
          </div>
        ))}
      </Section>

      <Section title="RECENT REQUESTS">
        {!diag?.requests.length && <div className="text-white/25">none yet</div>}
        {diag?.requests.map((r, i) => (
          <div key={`${r.at}-${i}`} className="flex justify-between gap-3 py-0.5">
            <span className={r.status === 200 ? 'text-white/50' : 'text-red-400/80'}>
              {r.status} {r.layer}
            </span>
            <span className="text-white/25">{r.ms}ms · {r.bytes}b</span>
          </div>
        ))}
      </Section>
    </motion.div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-white/30 tracking-[0.15em] mb-1 border-b border-white/[0.06] pb-1">{title}</div>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Add the rail button**

In `LayerPanel.tsx`, beside the Style Studio button, add a diagnostics button using the same markup pattern and the `Puzzle` icon from `lucide-react`, with `title="Plugin Diagnostics"`, toggling a `diagOpen` state and rendering `<LayerDiagnostics … />` inside the existing `AnimatePresence`. Pass `onReloaded` up so `page.tsx` can re-fetch `/api/layers`.

- [ ] **Step 3: Verify the build**

Run: `npm run lint && npm run build`
Expected: both PASS.

- [ ] **Step 4: Manual check**

Open the app, click the new rail button. Expected: the panel opens showing `0 manifests`, `no errors`, `none loaded`, `none yet`. Click RELOAD — it stays at 0 without error. Confirm the panel closes and does not disturb the Style Studio button.

- [ ] **Step 5: Commit**

```bash
git add src/components/LayerDiagnostics.tsx src/components/LayerPanel.tsx src/app/page.tsx
git commit -m "feat(layers): plugin diagnostics panel

After batch 8 this is the only place to learn why a layer is empty, so
it carries registry state, per-layer row counts and a request log rather
than just validation errors. Runtime state is read from the client's own
store rather than mirrored on the server -- the client is what asked and
what received, and a second source of truth could disagree with it."
```

---

## Batch 0 exit criteria

- [ ] `npm test` passes, including the six new suites: `types`, `condition`, `client-manifest`, `groups`, `request-log`, `panel-rows`, `execute`.
- [ ] `npm run lint` and `npm run build` pass.
- [ ] `curl -s localhost:3000/api/layers` returns `{"manifests":[],"errors":[],"loadedAt":…}`.
- [ ] `curl -s localhost:3000/api/layer-diagnostics` returns a registry block and an empty request log.
- [ ] **The running app is visually and behaviourally unchanged.** Every layer toggles, every popup opens, the theme switch works, and clicking an aircraft with satellites on opens the aircraft popup.
- [ ] `git diff master --stat` shows `OsirisMap.tsx`, `page.tsx` and `LayerPanel.tsx` modified; everything else new.

---

# BATCH 1 — Popup extensions and the hazard layers

---

### Task 12: `template` ValueSpec and coordinate pseudo-properties

**Files:**
- Modify: `src/lib/layers/types.ts`, `src/lib/layers/values.ts`
- Modify: `src/lib/layers/values.test.ts`

**Interfaces:**
- Produces: the `{ template: string }` ValueSpec form, and `withCoords(props, ctx) -> Record<string, unknown>` injecting `$lat`, `$lng`, `$lat3`, `$lng3`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/layers/values.test.ts`:

```ts
import { resolveValue, withCoords } from './values';

describe('template values', () => {
  it('interpolates properties', () => {
    expect(resolveValue({ template: 'M{magnitude} EARTHQUAKE' }, { magnitude: 6.1 }))
      .toBe('M6.1 EARTHQUAKE');
  });

  it('renders a missing property as empty rather than undefined', () => {
    expect(resolveValue({ template: '{a}/{b}' }, { a: 'x' })).toBe('x/');
  });

  it('leaves unmatched braces alone', () => {
    expect(resolveValue({ template: '{a} {not a token}' }, { a: 'x' })).toBe('x {not a token}');
  });
});

describe('withCoords', () => {
  it('injects full and three-decimal coordinates', () => {
    const p = withCoords({ place: 'Off Honshu' }, { lng: 142.369, lat: 38.2971234 });
    expect(p.$lng).toBe(142.369);
    expect(p.$lat).toBe(38.2971234);
    expect(p.$lat3).toBe('38.297');
    expect(p.$lng3).toBe('142.369');
    expect(p.place).toBe('Off Honshu');
  });

  // Popups display three decimals but links need full precision -- one
  // pseudo-property cannot serve both, so there are four.
  it('is a no-op without a context', () => {
    const props = { place: 'x' };
    expect(withCoords(props, undefined)).toBe(props);
  });

  it('lets a real property named lat survive alongside $lat', () => {
    const p = withCoords({ lat: 'not a number' }, { lng: 1, lat: 2 });
    expect(p.lat).toBe('not a number');
    expect(p.$lat).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/layers/values.test.ts`
Expected: FAIL — `withCoords` is not exported and `template` is not handled.

- [ ] **Step 3: Implement**

Add the form to `ValueSpec` in `types.ts`:

```ts
  | { template: string };
```

In `values.ts`, add before the `range` branch:

```ts
  if ('template' in spec) {
    return spec.template.replace(/\{(\$?\w+)\}/g, (_m, key: string) => {
      const v = props[key];
      return v === null || v === undefined ? '' : String(v);
    });
  }
```

and append:

```ts
export interface PopupCtx { lng: number; lat: number }

/**
 * Popups display coordinates rounded to three decimals but link with full
 * precision, so both are injected. The $ prefix keeps them clear of a genuine
 * upstream property named `lat`.
 */
export function withCoords(
  props: Record<string, unknown>,
  ctx: PopupCtx | undefined,
): Record<string, unknown> {
  if (!ctx) return props;
  return {
    ...props,
    $lng: ctx.lng,
    $lat: ctx.lat,
    $lng3: ctx.lng.toFixed(3),
    $lat3: ctx.lat.toFixed(3),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/layers/values.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/layers/types.ts src/lib/layers/values.ts src/lib/layers/values.test.ts
git commit -m "feat(layers): template values and coordinate pseudo-properties

Four coordinates rather than two: popups display three decimals but
links carry full precision, and per-token formatting inside a template
would be a formatting language."
```

---

### Task 13: `resolveColor`

`accent` and per-field colours are interpolated into `style=\"color:…\"`. `htmlEsc` stops an attribute break but not `red;background:url(…)`. Adding `template` makes it newly possible for an upstream string to reach a colour slot, so colours get validated rather than merely escaped. This closes a hole that predates the change.

**Files:**
- Modify: `src/lib/layers/values.ts`, `src/lib/layers/values.test.ts`

**Interfaces:**
- Produces: `resolveColor(spec: ValueSpec, props, fallback?: string) -> string`.

- [ ] **Step 1: Write the failing test**

```ts
import { resolveColor } from './values';

describe('resolveColor', () => {
  it('accepts hex colours in every legal length', () => {
    for (const c of ['#fff', '#ffff', '#FF9500', '#FF9500CC']) {
      expect(resolveColor(c, {})).toBe(c);
    }
  });

  it('resolves a derived colour', () => {
    const spec = { range: { property: 'value', stops: [[350, '#D32F2F'], [100, '#E65100']] as [number, string][], fallback: '#7E57C2' } };
    expect(resolveColor(spec, { value: 400 })).toBe('#D32F2F');
    expect(resolveColor(spec, { value: 1 })).toBe('#7E57C2');
  });

  // The real reason this exists: a template can put an upstream string into a
  // style attribute, and escaping alone would not stop CSS injection.
  it('rejects anything that is not a hex colour', () => {
    expect(resolveColor({ template: '{evil}' }, { evil: 'red;background:url(//x)' })).toBe('#9B978E');
    expect(resolveColor({ template: '{evil}' }, { evil: 'javascript:alert(1)' })).toBe('#9B978E');
    expect(resolveColor('rebeccapurple', {})).toBe('#9B978E');
  });

  it('falls back to the caller-supplied colour', () => {
    expect(resolveColor('nonsense', {}, '#FF9500')).toBe('#FF9500');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/layers/values.test.ts`
Expected: FAIL — `resolveColor` is not exported.

- [ ] **Step 3: Implement**

```ts
const HEX_COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Colours reach a style attribute, where escaping alone does not stop CSS injection. */
export function resolveColor(
  spec: ValueSpec,
  props: Record<string, unknown>,
  fallback = '#9B978E',
): string {
  const v = resolveValue(spec, props);
  return HEX_COLOUR.test(v) ? v : fallback;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/layers/values.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/layers/values.ts src/lib/layers/values.test.ts
git commit -m "fix(layers): validate colours instead of only escaping them

accent lands inside a style attribute, where htmlEsc stops a quote break
but not 'red;background:url(...)'. The template value form makes it newly
reachable from upstream data, so colours are now validated against a hex
pattern and fall back when they fail. Closes a pre-existing hole rather
than merely avoiding a new one."
```

---

### Task 14: Conditional and derived popup fields and links

**Files:**
- Modify: `src/lib/layers/types.ts`, `src/lib/layers/popup.ts`, `src/lib/layers/popup.test.ts`

**Interfaces:**
- Consumes: `evaluate` (Task 2), `withCoords`/`resolveColor` (Tasks 12–13).
- Produces: `renderPopup(spec: PopupSpec, props, ctx?: PopupCtx) -> string`. Tasks 17–20 author manifests against it.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/layers/popup.test.ts`:

```ts
describe('conditional fields and links', () => {
  const base = { accent: '#FF9500', title: 'T' };

  it('omits a field whose condition fails', () => {
    const spec = {
      ...base,
      fields: [
        { label: 'CAUSE', property: 'cause' },
        { label: 'ENDED', property: 'end', when: { property: 'end', exists: true } },
      ],
    };
    expect(renderPopup(spec, { cause: 'cable cut' })).not.toContain('ENDED');
    expect(renderPopup(spec, { cause: 'cable cut', end: '2026-01-01' })).toContain('ENDED');
  });

  it('omits a link whose condition fails, and keeps the one that passes', () => {
    const spec = {
      ...base,
      fields: [],
      links: [
        { label: 'USGS DETAILS', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/{id}',
          when: { property: 'source', equals: 'NIGGG-BAS', not: true } },
        { label: 'NIGGG-BAS', url: 'https://ndc.niggg.bas.bg/',
          when: { property: 'source', equals: 'NIGGG-BAS' } },
      ],
    };
    const usgs = renderPopup(spec, { id: 'us7000', source: 'us' });
    expect(usgs).toContain('USGS DETAILS');
    expect(usgs).toContain('eventpage/us7000');
    expect(usgs).not.toContain('NIGGG-BAS');

    const bas = renderPopup(spec, { id: 'x', source: 'NIGGG-BAS' });
    expect(bas).toContain('ndc.niggg.bas.bg');
    expect(bas).not.toContain('USGS DETAILS');
  });

  it('renders a derived field value', () => {
    const spec = {
      ...base,
      fields: [{
        label: 'SEVERITY',
        value: { range: { property: 'severity', stops: [[8, 'CRITICAL'], [6, 'HIGH']] as [number, string][], fallback: 'MEDIUM' } },
      }],
    };
    expect(renderPopup(spec, { severity: 9 })).toContain('CRITICAL');
    expect(renderPopup(spec, { severity: 7 })).toContain('HIGH');
    expect(renderPopup(spec, { severity: 2 })).toContain('MEDIUM');
  });

  it('colours a field from its own spec', () => {
    const spec = {
      ...base,
      fields: [{
        label: 'VERT RATE', property: 'verticalRate', format: 'fixed1' as const, suffix: ' m/s',
        color: { range: { property: 'verticalRate', stops: [[0, '#00E676']] as [number, string][], fallback: '#FF3D3D' } },
      }],
    };
    expect(renderPopup(spec, { verticalRate: 2.5 })).toContain('#00E676');
    expect(renderPopup(spec, { verticalRate: -1.2 })).toContain('#FF3D3D');
  });

  it('exposes coordinates to fields and links', () => {
    const spec = {
      ...base,
      fields: [{ label: 'COORDS', value: { template: '{$lat3}, {$lng3}' } }],
      links: [{ label: 'FIRMS', url: 'https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@{$lng},{$lat},10z' }],
    };
    const html = renderPopup(spec, {}, { lng: 142.369, lat: 38.2971234 });
    expect(html).toContain('38.297, 142.369');
    expect(html).toContain('142.369');
  });

  it('still escapes every value', () => {
    const spec = { ...base, title: { property: 'name' }, fields: [{ label: 'X', property: 'x' }] };
    const html = renderPopup(spec, { name: '<img src=x onerror=1>', x: '"><script>' });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/layers/popup.test.ts`
Expected: FAIL — `when`, `value` and `color` are ignored.

- [ ] **Step 3: Extend the types**

In `types.ts`:

```ts
export interface PopupFieldSpec {
  label: string;
  property?: string;
  /** Takes precedence over `property` when present. */
  value?: ValueSpec;
  format?: Format;
  suffix?: string;
  color?: ValueSpec;
  when?: Condition;
}

export interface PopupLinkSpec { label: string; url: string; when?: Condition }
```

- [ ] **Step 4: Rewrite `renderPopup`'s field and link handling**

In `popup.ts`, import `evaluate`, `resolveColor`, `withCoords`, and change the signature:

```ts
export function renderPopup(
  spec: PopupSpec,
  rawProps: Record<string, unknown>,
  ctx?: PopupCtx,
): string {
  const props = withCoords(rawProps, ctx);
  const accent = resolveColor(spec.accent, props);
  const title = resolveValue(spec.title, props);
  const subtitle = spec.subtitle ? resolveValue(spec.subtitle, props) : null;

  const fields = spec.fields
    .filter(f => !f.when || evaluate(f.when, props))
    .map(f => {
      const raw = f.value ? resolveValue(f.value, props) : props[f.property ?? ''];
      const value = formatValue(raw, f.format, f.suffix ?? '');
      const colour = f.color ? resolveColor(f.color, props, '#E8E6E0') : '#E8E6E0';
      return `<div><span style="color:#5C5A54;font-size:9px;">${htmlEsc(f.label)}</span><br/>` +
             `<span style="color:${colour};">${htmlEsc(value)}</span></div>`;
    }).join('');

  const links = (spec.links ?? [])
    .filter(l => !l.when || evaluate(l.when, props))
    .map(l => {
      const raw = /^\{(\$?\w+)\}$/.test(l.url)
        ? String(props[l.url.slice(1, -1)] ?? '')
        : interpolate(l.url, props);
      const href = urlSafe(raw);
      return `<a href="${htmlEsc(href)}" target="_blank" rel="noopener noreferrer" ` +
             `style="${LINK}color:${accent};border:1px solid ${accent}66;background:${accent}1a;">` +
             `${htmlEsc(l.label)}</a>`;
    }).join('');

  // ... assembly unchanged for now; Task 15 adds the presentation hints.
}
```

Widen `interpolate`'s regex to `/\{(\$?\w+)\}/g` so coordinate tokens substitute in links.

Note that `accent` no longer needs `htmlEsc` in the style attributes — `resolveColor` guarantees it is a hex colour.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/layers/popup.test.ts`
Expected: PASS, including the pre-existing cases.

- [ ] **Step 6: Pass coordinates from the engine**

In `engine.ts`'s `dispatch`, supply the context:

```ts
      this.opts.onSelect({
        kind: 'popup', layerId: m.id,
        html: renderPopup(interaction.popup, properties, { lng: lngLat[0], lat: lngLat[1] }),
        properties, lngLat,
      });
```

- [ ] **Step 7: Run the full suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/lib/layers/types.ts src/lib/layers/popup.ts src/lib/layers/popup.test.ts src/lib/layers/engine.ts
git commit -m "feat(layers): conditional and derived popup fields and links

Three of the live handlers render a field only when a property exists,
two derive a field's value from a numeric band, and several print the
clicked coordinates -- none of which the Plan 1 PopupSpec could express.

A popup renders properties; it does not compute them. Anything needing
arithmetic is computed where the feature is built."
```

---

### Task 15: Presentation hints — glyph, columns, body, badge

**Files:**
- Modify: `src/lib/layers/types.ts`, `src/lib/layers/popup.ts`, `src/lib/layers/popup.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('presentation hints', () => {
  const base = { accent: '#FF9500', title: 'FIRE', fields: [] };

  it('prefixes a static glyph', () => {
    expect(renderPopup({ ...base, glyph: '🔥' }, {})).toContain('🔥');
  });

  // weather-dots picks its emoji from the event type, so glyph is a ValueSpec.
  it('derives a glyph from a property', () => {
    const spec = {
      ...base,
      glyph: { match: { property: 'icon', cases: { cyclone: '🌀', volcano: '🌋' }, fallback: '⚡' } },
    };
    expect(renderPopup(spec, { icon: 'cyclone' })).toContain('🌀');
    expect(renderPopup(spec, { icon: 'volcano' })).toContain('🌋');
    expect(renderPopup(spec, { icon: 'hail' })).toContain('⚡');
  });

  it('renders one column when asked', () => {
    expect(renderPopup({ ...base, columns: 1, fields: [{ label: 'A', property: 'a' }] }, { a: 1 }))
      .toContain('grid-template-columns:1fr;');
    expect(renderPopup({ ...base, fields: [{ label: 'A', property: 'a' }] }, { a: 1 }))
      .toContain('grid-template-columns:1fr 1fr;');
  });

  it('renders a scrollable body', () => {
    const spec = { ...base, body: { value: { property: 'sitrep' }, maxHeight: 120 } };
    const html = renderPopup(spec, { sitrep: 'Armed men boarded the vessel.' });
    expect(html).toContain('Armed men boarded the vessel.');
    expect(html).toContain('max-height:120px');
    expect(html).toContain('overflow-y:auto');
  });

  it('escapes body text', () => {
    const spec = { ...base, body: { value: { property: 'sitrep' } } };
    expect(renderPopup(spec, { sitrep: '<script>x</script>' })).not.toContain('<script>');
  });

  it('renders a badge, defaulting its colour to the accent', () => {
    const spec = {
      ...base,
      badge: { value: { range: { property: 'severity', stops: [[8, 'CRITICAL']] as [number, string][], fallback: 'MEDIUM' } } },
    };
    const html = renderPopup(spec, { severity: 9 });
    expect(html).toContain('CRITICAL');
    expect(html).toContain('#FF9500');
  });

  it('colours a badge independently', () => {
    const spec = { ...base, badge: { value: 'HIGH', color: '#FF1744' } };
    expect(renderPopup(spec, {})).toContain('#FF1744');
  });

  it('omits a badge whose condition fails', () => {
    const spec = { ...base, badge: { value: 'LIVE', when: { property: 'ongoing', truthy: true } } };
    expect(renderPopup(spec, { ongoing: 'false' })).not.toContain('LIVE');
    expect(renderPopup(spec, { ongoing: 'true' })).toContain('LIVE');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/layers/popup.test.ts`
Expected: FAIL — the hints are ignored.

- [ ] **Step 3: Extend `PopupSpec`**

```ts
export interface PopupSpec {
  accent: ValueSpec;
  title: ValueSpec;
  subtitle?: ValueSpec;
  /** Leading character. A ValueSpec because weather picks its emoji per event. */
  glyph?: ValueSpec;
  columns?: 1 | 2;
  body?: { value: ValueSpec; maxHeight?: number };
  badge?: { value: ValueSpec; color?: ValueSpec; when?: Condition };
  fields: PopupFieldSpec[];
  links?: PopupLinkSpec[];
}
```

- [ ] **Step 4: Implement the assembly**

Replace the return statement in `renderPopup`:

```ts
  const glyph = spec.glyph ? resolveValue(spec.glyph, props) : '';
  const columns = spec.columns === 1 ? '1fr' : '1fr 1fr';

  let badge = '';
  if (spec.badge && (!spec.badge.when || evaluate(spec.badge.when, props))) {
    const text = resolveValue(spec.badge.value, props);
    const colour = spec.badge.color ? resolveColor(spec.badge.color, props, accent) : accent;
    badge = `<span style="${BADGE}background:${colour}20;color:${colour};border:1px solid ${colour}50;">` +
            `${htmlEsc(text)}</span>`;
  }

  let body = '';
  if (spec.body) {
    const text = resolveValue(spec.body.value, props);
    const cap = spec.body.maxHeight ? `max-height:${spec.body.maxHeight}px;overflow-y:auto;` : '';
    body = `<div style="color:#9B978E;font-size:10px;line-height:1.6;margin-bottom:8px;${cap}">` +
           `${htmlEsc(text)}</div>`;
  }

  return `<div style="${SHELL}border:1px solid ${accent}66;min-width:230px;">` +
    `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">` +
      `<span style="color:${accent};font-size:12px;font-weight:700;letter-spacing:0.08em;">` +
        `${glyph ? `${htmlEsc(glyph)} ` : ''}${htmlEsc(title)}</span>` +
      badge +
    `</div>` +
    (subtitle ? `<div style="color:#5C5A54;font-size:9px;margin-bottom:8px;">${htmlEsc(subtitle)}</div>` : '') +
    body +
    (fields ? `<div style="display:grid;grid-template-columns:${columns};gap:6px;font-size:9px;">${fields}</div>` : '') +
    links +
    `</div>`;
```

Add the badge style constant beside `SHELL` and `LINK`:

```ts
const BADGE = `font-size:8px;padding:2px 6px;border-radius:3px;font-weight:700;letter-spacing:0.1em;white-space:nowrap;`;
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/layers/popup.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/layers/types.ts src/lib/layers/popup.ts src/lib/layers/popup.test.ts
git commit -m "feat(layers): popup presentation hints

glyph, columns, body and badge -- a closed, enumerated set, extended the
way the date tokens were rather than by admitting arbitrary HTML, so
escaping and colour validation stay structural.

glyph is a ValueSpec rather than a string because weather picks its
emoji per event type; a fixed string could not express it."
```

---

### Task 16: Guard the expression pass-through

Arbitrary MapLibre expressions already survive `mount()` untouched. This test exists so a later change — whitelisting paint keys, say — cannot silently remove data-driven styling like icon rotation from a heading property.

**Files:**
- Create: `src/lib/layers/expressions.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it } from 'vitest';
import { LayerEngine } from './engine';
import { FakeMap } from './maplike';
import { validateManifest } from './validate';

describe('arbitrary MapLibre expressions pass through untouched', () => {
  it('keeps a data-driven icon-rotate expression byte-identical', () => {
    const raw = {
      id: 'flock', label: 'Flock Cameras', group: 'SURVEILLANCE',
      source: {
        kind: 'http', url: 'https://example.com/f.json', format: 'json',
        lat: 'lat', lng: 'lng', properties: {}, refresh: { mode: 'once' },
      },
      layers: [{
        suffix: 'icons', type: 'symbol',
        layout: {
          'icon-image': 'camera',
          'icon-rotate': ['get', 'heading'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
        },
        paint: {
          'icon-color': ['case', ['>', ['get', 'heading'], 180], '{palette.cctv}', '#fff'],
          'icon-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.2, 12, 1],
        },
      }],
    };

    const result = validateManifest(raw, 'flock.json');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const map = new FakeMap();
    new LayerEngine(map, { onSelect: () => {}, palette: { cctv: '#00E5FF' } })
      .mount([result.manifest]);

    const added = map.layers.get('lyr:flock--icons')!;
    const layout = added.layout as Record<string, unknown>;
    const paint = added.paint as Record<string, unknown>;

    expect(layout['icon-rotate']).toEqual(['get', 'heading']);
    expect(layout['icon-rotation-alignment']).toBe('map');
    expect(layout['icon-allow-overlap']).toBe(true);
    expect(paint['icon-opacity']).toEqual(['interpolate', ['linear'], ['zoom'], 5, 0.2, 12, 1]);
    // Only the {palette.X} token nested inside the expression is rewritten.
    expect(paint['icon-color']).toEqual(['case', ['>', ['get', 'heading'], 180], '#00E5FF', '#fff']);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/lib/layers/expressions.test.ts`
Expected: PASS immediately — this guards existing behaviour rather than driving new behaviour, which is why it is the one test here written green.

- [ ] **Step 3: Commit**

```bash
git add src/lib/layers/expressions.test.ts
git commit -m "test(layers): guard arbitrary expression pass-through

validate.ts never inspects paint or layout and resolveTokens touches only
{palette.X} strings, so data-driven styling -- icon rotation from a
heading property, for instance -- already works with no schema change.
Easy to remove by accident while extending the schema elsewhere."
```

---

### Task 17: `earthquakes`

The first real manifest. It proves the fully declarative path: no adapter, no server code.

**Files:**
- Create: `src/lib/layers/manifests/10-earthquakes.json`
- Create: `src/lib/layers/__fixtures__/earthquakes.json`
- Create: `src/lib/layers/__fixtures__/fixtures.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 12–15.
- Produces: the manifest directory, and the fixture test harness Tasks 18–20 extend.

- [ ] **Step 1: Capture the fixture**

The USGS feed is the live upstream. Capture one real feature's properties as the engine would build them:

```bash
mkdir -p src/lib/layers/__fixtures__
curl -s 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson' \
  | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      const f = JSON.parse(s).features[0];
      console.log(JSON.stringify({
        properties: {
          id: f.id,
          magnitude: f.properties.mag,
          place: f.properties.place,
          depth: f.geometry.coordinates[2],
          url: f.properties.url,
          source: f.properties.net,
        },
        lngLat: [f.geometry.coordinates[0], f.geometry.coordinates[1]],
      }, null, 2));
    });' > src/lib/layers/__fixtures__/earthquakes.json
```

Inspect the file. If `magnitude` or `place` is null, re-run — pick a feature with complete data, since the fixture must exercise the real fields.

- [ ] **Step 2: Write the failing fixture test**

Create `src/lib/layers/__fixtures__/fixtures.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderPopup } from '../popup';
import { validateManifest } from '../validate';
import type { PopupSpec } from '../types';

const MANIFEST_DIR = join(__dirname, '..', 'manifests');

function loadManifest(file: string) {
  const raw = JSON.parse(readFileSync(join(MANIFEST_DIR, file), 'utf8'));
  const result = validateManifest(raw, file);
  if (!result.ok) throw new Error(`${file} is invalid:\n  ${result.errors.join('\n  ')}`);
  return result.manifest;
}

function loadFixture(name: string): { properties: Record<string, unknown>; lngLat: [number, number] } {
  return JSON.parse(readFileSync(join(__dirname, `${name}.json`), 'utf8'));
}

/** Renders a layer's popup from its own manifest and its captured feature. */
function render(manifestFile: string, fixtureName: string): string {
  const manifest = loadManifest(manifestFile);
  const interaction = manifest.interaction;
  if (interaction?.kind !== 'popup') throw new Error(`${manifestFile} has no popup interaction`);
  const fixture = loadFixture(fixtureName);
  return renderPopup(interaction.popup as PopupSpec, fixture.properties,
                     { lng: fixture.lngLat[0], lat: fixture.lngLat[1] });
}

describe('earthquakes popup parity', () => {
  const html = render('10-earthquakes.json', 'earthquakes');
  const fixture = loadFixture('earthquakes');

  it('shows every label the old popup showed', () => {
    for (const label of ['DEPTH', 'COORDS']) expect(html).toContain(label);
  });

  it('shows the magnitude in the title, as M<mag> EARTHQUAKE', () => {
    expect(html).toContain(`M${fixture.properties.magnitude} EARTHQUAKE`);
  });

  it('shows the place', () => {
    expect(html).toContain(String(fixture.properties.place));
  });

  it('shows coordinates to three decimals', () => {
    expect(html).toContain(`${fixture.lngLat[1].toFixed(3)}, ${fixture.lngLat[0].toFixed(3)}`);
  });

  it('links to the USGS event page for a USGS-sourced quake', () => {
    expect(html).toContain(`eventpage/${fixture.properties.id}`);
    expect(html).toContain('USGS DETAILS');
  });

  it('matches its recorded shape', () => {
    expect(html).toMatchSnapshot();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/layers/__fixtures__/fixtures.test.ts`
Expected: FAIL — `10-earthquakes.json` does not exist.

- [ ] **Step 4: Write the manifest**

Create `src/lib/layers/manifests/10-earthquakes.json`. Paint values are copied verbatim from `OsirisMap.tsx:356-363`.

```json
{
  "id": "earthquakes",
  "label": "Earthquakes",
  "group": "HAZARD",
  "order": 10,
  "defaultOn": true,
  "datasets": [
    {
      "key": "default",
      "legacyKey": "earthquakes",
      "source": {
        "kind": "http",
        "url": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson",
        "format": "json",
        "arrayPath": "features",
        "lat": "geometry.coordinates.1",
        "lng": "geometry.coordinates.0",
        "properties": {
          "id": "id",
          "magnitude": "properties.mag",
          "place": "properties.place",
          "depth": "geometry.coordinates.2",
          "url": "properties.url",
          "source": "properties.net"
        },
        "cacheTtlMs": 900000,
        "refresh": { "mode": "poll", "intervalMs": 900000 }
      },
      "layers": [
        {
          "suffix": "circles",
          "type": "circle",
          "clickable": true,
          "paint": {
            "circle-radius": ["interpolate", ["linear"], ["get", "magnitude"], 2.5, 4, 5, 12, 7, 24],
            "circle-color": ["interpolate", ["linear"], ["get", "magnitude"], 2.5, "#F9A825", 4, "#E65100", 6, "#D32F2F"],
            "circle-opacity": 0.55,
            "circle-blur": 0.3,
            "circle-stroke-width": 1,
            "circle-stroke-color": "#F9A825",
            "circle-stroke-opacity": 0.25
          }
        },
        {
          "suffix": "label",
          "type": "symbol",
          "filter": [">=", ["get", "magnitude"], 4.5],
          "layout": {
            "text-field": ["concat", "M", ["to-string", ["get", "magnitude"]]],
            "text-size": 9,
            "text-font": ["Open Sans Regular"],
            "text-offset": [0, 1.5]
          },
          "paint": { "text-color": "#F9A825", "text-halo-color": "#000", "text-halo-width": 1 }
        }
      ]
    }
  ],
  "interaction": {
    "kind": "popup",
    "popup": {
      "accent": "#FF9500",
      "title": { "template": "M{magnitude} EARTHQUAKE" },
      "subtitle": { "property": "place" },
      "fields": [
        { "label": "DEPTH", "property": "depth", "format": "number", "suffix": "km" },
        { "label": "COORDS", "value": { "template": "{$lat3}, {$lng3}" } }
      ],
      "links": [
        {
          "label": "📊 USGS DETAILS",
          "url": "https://earthquake.usgs.gov/earthquakes/eventpage/{id}",
          "when": { "property": "source", "equals": "NIGGG-BAS", "not": true }
        },
        {
          "label": "📊 NIGGG-BAS",
          "url": "https://ndc.niggg.bas.bg/",
          "when": { "property": "source", "equals": "NIGGG-BAS" }
        }
      ]
    }
  }
}
```

**On the NIGGG-BAS branch:** `parseNigggXml` in `src/lib/bulgaria-sources.ts` is exported but imported nowhere, so nothing currently produces a feature with `source: 'NIGGG-BAS'` and that branch is unreachable today. It is preserved because it encodes the intent faithfully and becomes reachable the moment that feed is wired up. The fixture covers only the USGS path, which is the only one the live feed produces.

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/lib/layers/__fixtures__/fixtures.test.ts`
Expected: PASS, writing a new snapshot. Read the snapshot and confirm it looks like a sensible popup — this is the one moment the rendered HTML is reviewed by eye.

- [ ] **Step 6: Verify it loads end-to-end**

```bash
npm run build && npm run dev &
sleep 8
curl -s localhost:3000/api/layers | head -c 400
curl -s 'localhost:3000/api/layer-source?layer=earthquakes&datasets=default' | head -c 300
```
Expected: the manifest appears in `/api/layers` with no `errors`, and `layer-source` returns a `FeatureCollection` with real features. Confirm no upstream URL appears in the `/api/layers` output.

- [ ] **Step 7: Commit**

```bash
git add src/lib/layers/manifests/10-earthquakes.json \
        src/lib/layers/__fixtures__/earthquakes.json \
        src/lib/layers/__fixtures__/fixtures.test.ts \
        src/lib/layers/__fixtures__/__snapshots__
git commit -m "feat(layers): earthquakes as a manifest

The first real manifest, and the proof of the fully declarative path --
no adapter, no server code. getPath's numeric segments let the USGS
GeoJSON be read as plain json with arrayPath 'features', which keeps
both the feature id and the depth from coordinates[2]; the geojson
format would have dropped them, since it reads properties only from
feature.properties.

Both link branches are encoded even though nothing currently produces a
NIGGG-BAS feature -- parseNigggXml is exported but imported nowhere."
```

---

### Task 18: `fires`

**Files:**
- Create: `src/lib/layers/manifests/20-fires.json`
- Create: `src/lib/layers/__fixtures__/fires.json`
- Modify: `src/lib/layers/__fixtures__/fixtures.test.ts`

- [ ] **Step 1: Capture the fixture**

`/api/fires` is retained — it does the FIRMS parsing — so capture from it with the dev server running:

```bash
npm run dev &
sleep 8
curl -s localhost:3000/api/fires | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    const f = JSON.parse(s).fires[0];
    console.log(JSON.stringify({
      properties: { brightness: f.brightness },
      lngLat: [f.lng, f.lat],
    }, null, 2));
  });' > src/lib/layers/__fixtures__/fires.json
```

- [ ] **Step 2: Write the failing test**

Append to `fixtures.test.ts`:

```ts
describe('fires popup parity', () => {
  const html = render('20-fires.json', 'fires');
  const fixture = loadFixture('fires');

  it('shows every label the old popup showed', () => {
    for (const label of ['BRIGHTNESS', 'COORDS']) expect(html).toContain(label);
  });

  it('keeps the fire glyph and heading', () => {
    expect(html).toContain('🔥');
    expect(html).toContain('ACTIVE FIRE DETECTED');
  });

  it('shows brightness in kelvin', () => {
    expect(html).toContain(`${fixture.properties.brightness}K`);
  });

  it('builds the FIRMS deep link at full coordinate precision', () => {
    expect(html).toContain('firms.modaps.eosdis.nasa.gov');
    expect(html).toContain(String(fixture.lngLat[0]));
  });

  it('matches its recorded shape', () => {
    expect(html).toMatchSnapshot();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/layers/__fixtures__/fixtures.test.ts`
Expected: FAIL — `20-fires.json` does not exist.

- [ ] **Step 4: Write the manifest**

`src/lib/layers/manifests/20-fires.json` — paint copied from `OsirisMap.tsx:366-369`:

```json
{
  "id": "fires",
  "label": "Active Fires",
  "group": "HAZARD",
  "order": 20,
  "datasets": [
    {
      "key": "default",
      "legacyKey": "fires",
      "source": {
        "kind": "http",
        "url": "/api/fires",
        "format": "json",
        "arrayPath": "fires",
        "lat": "lat",
        "lng": "lng",
        "properties": { "brightness": "brightness" },
        "cacheTtlMs": 900000,
        "refresh": { "mode": "once" }
      },
      "layers": [
        {
          "suffix": "heat",
          "type": "circle",
          "clickable": true,
          "paint": {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 2, 5, 4, 10, 8],
            "circle-color": "#E65100",
            "circle-opacity": 0.45,
            "circle-blur": 0.5
          }
        }
      ]
    }
  ],
  "interaction": {
    "kind": "popup",
    "popup": {
      "accent": "#FF6B00",
      "glyph": "🔥",
      "title": "ACTIVE FIRE DETECTED",
      "fields": [
        { "label": "BRIGHTNESS", "property": "brightness", "format": "number", "suffix": "K" },
        { "label": "COORDS", "value": { "template": "{$lat3}, {$lng3}" } }
      ],
      "links": [
        {
          "label": "🛰️ NASA FIRMS MAP",
          "url": "https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;l:noaa20-viirs,viirs,modis_a,modis_t;@{$lng},{$lat},10z"
        }
      ]
    }
  }
}
```

The `/api/fires` URL is resolved against `OSIRIS_SELF_ORIGIN` by Task 5.

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/lib/layers/__fixtures__/fixtures.test.ts`
Expected: PASS. Review the new snapshot.

- [ ] **Step 6: Verify the same-origin fetch works**

```bash
curl -s 'localhost:3000/api/layer-source?layer=fires&datasets=default' | head -c 200
```
Expected: a `FeatureCollection` with features. If it returns a 502, `OSIRIS_SELF_ORIGIN` does not match the port the dev server is on — set it and retry.

- [ ] **Step 7: Commit**

```bash
git add src/lib/layers/manifests/20-fires.json src/lib/layers/__fixtures__/fires.json \
        src/lib/layers/__fixtures__/fixtures.test.ts src/lib/layers/__fixtures__/__snapshots__
git commit -m "feat(layers): fires as a manifest

First layer to point at one of OSIRIS's own routes rather than an
upstream -- /api/fires does the FIRMS parsing and is worth keeping --
which is what the same-origin URL resolution exists for.

Also the first use of both coordinate precisions at once: three decimals
in the COORDS field, full precision in the FIRMS deep link."
```

---

### Task 19: `weather`

Exercises the derived glyph and a per-field colour.

**Files:**
- Create: `src/lib/layers/manifests/30-weather.json`
- Create: `src/lib/layers/__fixtures__/weather.json`
- Modify: `src/lib/layers/__fixtures__/fixtures.test.ts`

- [ ] **Step 1: Capture the fixture**

```bash
curl -s localhost:3000/api/weather | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    const w = JSON.parse(s).events[0];
    console.log(JSON.stringify({
      properties: { id: w.id, title: w.title, type: w.type, icon: w.icon, severity: w.severity, source: w.source },
      lngLat: [w.lng, w.lat],
    }, null, 2));
  });' > src/lib/layers/__fixtures__/weather.json
```

- [ ] **Step 2: Write the failing test**

```ts
describe('weather popup parity', () => {
  const html = render('30-weather.json', 'weather');
  const fixture = loadFixture('weather');

  it('shows every label the old popup showed', () => {
    for (const label of ['SEVERITY', 'COORDS']) expect(html).toContain(label);
  });

  it('shows the event type as the heading and the title as the body', () => {
    expect(html).toContain(String(fixture.properties.type));
    expect(html).toContain(String(fixture.properties.title));
  });

  it('shows the severity uppercased', () => {
    expect(html).toContain(String(fixture.properties.severity ?? 'low').toUpperCase());
  });

  it('picks the glyph from the icon', () => {
    const expected: Record<string, string> = {
      cyclone: '🌀', volcano: '🌋', flood: '🌊', drought: '🏜️', ice: '🧊', weather: '⚠️',
    };
    expect(html).toContain(expected[String(fixture.properties.icon)] ?? '⚡');
  });

  it('matches its recorded shape', () => {
    expect(html).toMatchSnapshot();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/layers/__fixtures__/fixtures.test.ts`
Expected: FAIL — `30-weather.json` does not exist.

- [ ] **Step 4: Write the manifest**

Paint copied from `OsirisMap.tsx:558-571`. The old popup coloured SEVERITY red when high and gold otherwise, and only rendered the source link when a source existed.

```json
{
  "id": "weather",
  "label": "Severe Weather",
  "group": "HAZARD",
  "order": 30,
  "datasets": [
    {
      "key": "default",
      "legacyKey": "weather_events",
      "source": {
        "kind": "http",
        "url": "/api/weather",
        "format": "json",
        "arrayPath": "events",
        "lat": "lat",
        "lng": "lng",
        "properties": {
          "id": "id", "title": "title", "type": "type",
          "icon": "icon", "severity": "severity", "source": "source"
        },
        "cacheTtlMs": 900000,
        "refresh": { "mode": "once" }
      },
      "layers": [
        {
          "suffix": "glow",
          "type": "circle",
          "paint": {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 12, 5, 20, 10, 30],
            "circle-color": "#7E57C2", "circle-opacity": 0.08, "circle-blur": 1
          }
        },
        {
          "suffix": "dots",
          "type": "circle",
          "clickable": true,
          "paint": {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 5, 5, 8, 10, 14],
            "circle-color": ["match", ["get", "icon"], "cyclone", "#7E57C2", "volcano", "#D32F2F", "#7E57C2"],
            "circle-opacity": 0.75,
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#7E57C2",
            "circle-stroke-opacity": 0.35
          }
        },
        {
          "suffix": "label",
          "type": "symbol",
          "layout": {
            "text-field": ["get", "title"], "text-size": 9,
            "text-font": ["Open Sans Regular"], "text-offset": [0, 2],
            "text-max-width": 14, "text-allow-overlap": false
          },
          "paint": {
            "text-color": "#7E57C2", "text-halo-color": "#000",
            "text-halo-width": 1, "text-opacity": 0.8
          }
        }
      ]
    }
  ],
  "interaction": {
    "kind": "popup",
    "popup": {
      "accent": "#E040FB",
      "glyph": {
        "match": {
          "property": "icon",
          "cases": {
            "cyclone": "🌀", "volcano": "🌋", "flood": "🌊",
            "drought": "🏜️", "ice": "🧊", "weather": "⚠️"
          },
          "fallback": "⚡"
        }
      },
      "title": { "property": "type" },
      "body": { "value": { "property": "title" } },
      "fields": [
        {
          "label": "SEVERITY",
          "value": { "match": { "property": "severity", "cases": {}, "fallback": "low" } },
          "format": "upper",
          "color": { "match": { "property": "severity", "cases": { "high": "#FF1744" }, "fallback": "#FFD700" } }
        },
        { "label": "COORDS", "value": { "template": "{$lat3}°, {$lng3}°" } }
      ],
      "links": [
        { "label": "📡 SOURCE", "url": "{source}", "when": { "property": "source", "exists": true } }
      ]
    }
  }
}
```

The `SEVERITY` value uses a `match` with empty `cases` purely as a "property or fallback" form — `{ property: 'severity' }` would render `—` for a missing value, whereas the old popup rendered `LOW`.

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/lib/layers/__fixtures__/fixtures.test.ts`
Expected: PASS. Review the snapshot.

- [ ] **Step 6: Commit**

```bash
git add src/lib/layers/manifests/30-weather.json src/lib/layers/__fixtures__/weather.json \
        src/lib/layers/__fixtures__/fixtures.test.ts src/lib/layers/__fixtures__/__snapshots__
git commit -m "feat(layers): weather as a manifest

The layer that forced glyph to be a ValueSpec: its emoji comes from the
event type, across seven cases. Also the first per-field colour and the
first conditional link -- the old handler rendered its source button only
when a source existed, and urlSafe already rejected the javascript: URL
a third-party feed could put there."
```

---

### Task 20: `radiation` — revived

`/api/radiation` does not exist. The map polls it every five minutes and gets a 404, and there is no panel row. This layer is rebuilt from Safecast, keyless, with no server code at all.

**Files:**
- Create: `src/lib/layers/manifests/40-radiation.json`
- Create: `src/lib/layers/__fixtures__/radiation.json`
- Modify: `src/lib/layers/__fixtures__/fixtures.test.ts`

- [ ] **Step 1: Verify the upstream is still live and keyless**

```bash
YESTERDAY=$(date -u -d '1 day ago' +%F)
curl -s "https://api.safecast.org/measurements.json?since=${YESTERDAY}&limit=5&unit=cpm" | head -c 600
```
Expected: a flat JSON array of measurements with `latitude`, `longitude`, `value`, `unit`, `captured_at`, `device_id`, `location_name`. If the shape has changed, stop and reconcile against the spec before writing the manifest.

- [ ] **Step 2: Capture the fixture**

```bash
YESTERDAY=$(date -u -d '1 day ago' +%F)
curl -s "https://api.safecast.org/measurements.json?since=${YESTERDAY}&limit=50&unit=cpm" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    const rows = JSON.parse(s);
    const r = rows.find(x => x.location_name) ?? rows[0];
    console.log(JSON.stringify({
      properties: {
        value: r.value, unit: r.unit, captured: r.captured_at,
        device: r.device_id, place: r.location_name,
      },
      lngLat: [r.longitude, r.latitude],
    }, null, 2));
  });' > src/lib/layers/__fixtures__/radiation.json
```

- [ ] **Step 3: Write the failing test**

```ts
describe('radiation popup parity', () => {
  const html = render('40-radiation.json', 'radiation');
  const fixture = loadFixture('radiation');

  it('shows every label', () => {
    for (const label of ['READING', 'CAPTURED']) expect(html).toContain(label);
  });

  it('shows the reading in cpm', () => {
    expect(html).toContain(`${fixture.properties.value} cpm`);
  });

  it('keeps the radiation glyph', () => {
    expect(html).toContain('☢️');
  });

  it('bands the accent by reading', () => {
    const spec = { accent: { range: { property: 'value', stops: [[350, '#D32F2F'], [100, '#E65100']] as [number, string][], fallback: '#7E57C2' } }, title: 'x', fields: [] };
    expect(renderPopup(spec, { value: 400 })).toContain('#D32F2F');
    expect(renderPopup(spec, { value: 150 })).toContain('#E65100');
    expect(renderPopup(spec, { value: 5 })).toContain('#7E57C2');
  });

  it('matches its recorded shape', () => {
    expect(html).toMatchSnapshot();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/lib/layers/__fixtures__/fixtures.test.ts`
Expected: FAIL — `40-radiation.json` does not exist.

- [ ] **Step 5: Write the manifest**

Paint copied from the worked example in spec §3, which itself mirrors `OsirisMap.tsx:745-759`. `{today-1d}` is expanded server-side by `substitute.ts`.

```json
{
  "id": "radiation",
  "label": "Radiation Monitors",
  "group": "HAZARD",
  "order": 40,
  "datasets": [
    {
      "key": "default",
      "legacyKey": "radiation",
      "source": {
        "kind": "http",
        "url": "https://api.safecast.org/measurements.json?since={today-1d}&limit=2000&unit=cpm",
        "format": "json",
        "lat": "latitude",
        "lng": "longitude",
        "properties": {
          "value": "value", "unit": "unit", "captured": "captured_at",
          "device": "device_id", "place": "location_name"
        },
        "cacheTtlMs": 900000,
        "refresh": { "mode": "poll", "intervalMs": 900000 }
      },
      "layers": [
        {
          "suffix": "glow",
          "type": "circle",
          "paint": {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 10, 5, 20, 10, 40],
            "circle-color": "#7E57C2", "circle-opacity": 0.12, "circle-blur": 1
          }
        },
        {
          "suffix": "dots",
          "type": "circle",
          "clickable": true,
          "paint": {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 4, 5, 6, 10, 8],
            "circle-color": ["interpolate", ["linear"], ["get", "value"], 0, "#7E57C2", 100, "#E65100", 350, "#D32F2F"],
            "circle-opacity": 0.85
          }
        },
        {
          "suffix": "label",
          "type": "symbol",
          "minzoom": 5,
          "layout": {
            "text-field": ["get", "place"], "text-size": 8,
            "text-font": ["Open Sans Regular"], "text-offset": [0, 1.4]
          },
          "paint": { "text-color": "#7E57C2", "text-halo-color": "#000", "text-halo-width": 1 }
        }
      ]
    }
  ],
  "interaction": {
    "kind": "popup",
    "popup": {
      "accent": {
        "range": {
          "property": "value",
          "stops": [[350, "#D32F2F"], [100, "#E65100"]],
          "fallback": "#7E57C2"
        }
      },
      "glyph": "☢️",
      "columns": 1,
      "title": { "property": "place" },
      "badge": {
        "value": { "range": { "property": "value", "stops": [[350, "DANGER"], [100, "WARNING"]], "fallback": "NORMAL" } },
        "color": { "range": { "property": "value", "stops": [[350, "#D32F2F"], [100, "#E65100"]], "fallback": "#7E57C2" } }
      },
      "fields": [
        { "label": "READING", "property": "value", "format": "number", "suffix": " cpm" },
        { "label": "CAPTURED", "property": "captured", "format": "datetime" },
        { "label": "DEVICE", "property": "device", "format": "text" }
      ]
    }
  }
}
```

The DANGER/WARNING/NORMAL banding the old popup showed as a status field becomes the badge — the first real use of the hint reinstated in spec §4.3.

- [ ] **Step 6: Run the test and verify end to end**

Run: `npx vitest run src/lib/layers/__fixtures__/fixtures.test.ts`
Expected: PASS.

```bash
npm run build && npm run dev &
sleep 8
curl -s 'localhost:3000/api/layer-source?layer=radiation&datasets=default' | head -c 300
```
Expected: a `FeatureCollection` with real Safecast features.

- [ ] **Step 7: Commit**

```bash
git add src/lib/layers/manifests/40-radiation.json src/lib/layers/__fixtures__/radiation.json \
        src/lib/layers/__fixtures__/fixtures.test.ts src/lib/layers/__fixtures__/__snapshots__
git commit -m "feat(layers): revive radiation from Safecast

/api/radiation never existed. The map has been polling it every five
minutes for a 404, with no panel row to turn it off -- a ?layers=
share link could switch on a permanent 404 poller.

Now a keyless Safecast feed with no server code at all, and the first
use of the badge hint: the DANGER/WARNING/NORMAL banding the old popup
showed as a field."
```

---

### Task 21: Batch 1 cutover — delete the hardcoded hazard layers

The migration is only real when the old path is gone. Until this task, `earthquakes`, `fires` and `weather` render **twice** — once from the engine and once from the legacy code — which is visible as double-drawn markers.

**Files:**
- Modify: `src/components/OsirisMap.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/components/LayerPanel.tsx`

- [ ] **Step 1: Delete the legacy map code**

In `OsirisMap.tsx` remove:

1. `'earthquakes'`, `'fires'`, `'weather'` and `'radiation'` from the `sources` array (line 309).
2. The `addLayer` calls for `eq-circles`, `eq-label` (356–363), `fires-heat` (366–369), `weather-glow`, `weather-dots`, `weather-label` (558–571), and `rad-glow`, `rad-dots`, `rad-label` (745–759).
3. The click handlers for `eq-circles` (990), `fires-heat` (1096), `weather-dots` (1523) and `rad-dots` (1481).
4. `'eq-circles'`, `'fires-heat'`, `'weather-dots'`, `'rad-dots'` from `CLICKABLE_LAYERS` (1008–1013) and from the hover array (1396).
5. The `setGeo` effects for `earthquakes` (1801), `fires` (2100), `weather` (2125) and `radiation` (2147).
6. The `setVis` calls for those four layers (2263, 2285, 2290, 2299).
7. `'balloon-dots'`/`'rad-dots'` references only where they name `rad-dots`; leave every `balloon-*` id alone — balloons migrates in batch 6.

- [ ] **Step 2: Delete the legacy fetches**

In `page.tsx` remove:

1. `fetchEndpoint(eqUrl, eqTransform)` and the `eqUrl`/`eqTransform` definitions (623–625), plus the 15-minute earthquake interval (649).
2. The `activeLayers.fires` fetch block (695–698).
3. The `activeLayers.weather` fetch block (745–748).
4. The `activeLayers.radiation` fetch block (735–738) and its 5-minute interval (822–824).
5. The now-dead `earthquakes`, `fires`, `weather`, `radiation` keys from the `activeLayers` initialiser — the manifests seed them instead.

**`LiveAlerts.tsx` keeps working** because the `earthquakes` manifest declares `legacyKey: "earthquakes"`, so `executePlan` still writes `data.earthquakes`. Verify this in step 5 rather than assuming it.

- [ ] **Step 3: Delete the legacy panel rows**

In `LayerPanel.tsx`, remove the `earthquakes`, `fires` and `weather` entries from the `HAZARD` group in `LAYER_GROUPS`. The group itself now has no legacy layers left; leave the group definition in place — it is deleted wholesale in batch 8.

- [ ] **Step 4: Verify tests and build**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 5: Run the batch-1 manual checklist**

```bash
npm run dev
```

Open the HAZARD group and work through the checklist from spec §8.2:

1. **Counts.** Toggle each of Earthquakes, Active Fires, Severe Weather, Radiation Monitors. Each row shows a count. Compare the earthquake count against what `LiveAlerts` shows — they read the same data, so they must agree.
2. **Placement.** Markers land where they did before. Earthquake circles scale with magnitude; fires are small orange dots; weather has a glow, a dot and a label.
3. **No double-draw.** Exactly one marker per event. Two overlapping circles means a legacy `addLayer` survived step 1.
4. **Popups.** Click one of each. Fields and values match the fixtures. The earthquake popup links to USGS; the fire popup opens the FIRMS map at the right place; the weather popup shows its source link only when the event has one.
5. **Radiation is new.** It has a panel row for the first time, a banded badge, and single-column fields.
6. **Toggling off** clears the markers.
7. **Theme switch** — colours still track the palette; no hazard layer turns black.
8. **Share links.** Load `?layers=earthquakes,radiation`. Exactly those two come on.
9. **Aircraft clicks.** With satellites enabled, click an aircraft. The aircraft popup opens, not the satellite one.
10. **Diagnostics.** Open the panel: four manifests, no errors, row counts per layer, and recent `/api/layer-source` requests with 200s.

- [ ] **Step 6: Commit and deploy**

```bash
git add src/components/OsirisMap.tsx src/app/page.tsx src/components/LayerPanel.tsx
git commit -m "refactor(layers): delete the hardcoded hazard layers

Batch 1 cutover. Four layers now render from manifests alone: their
addLayer calls, click handlers, setGeo effects, setVis entries,
CLICKABLE_LAYERS and hover entries, fetch blocks and poll intervals are
all gone.

LiveAlerts keeps reading data.earthquakes through the manifest's
legacyKey projection, which is exactly what that projection is for and
what lets the remaining 25 layers stay hardcoded meanwhile."
```

Then deploy the batch.

---

## Batch 1 exit criteria

- [ ] `npm test` passes, including the fixture suite and its four snapshots.
- [ ] `npm run lint` and `npm run build` pass.
- [ ] `curl -s localhost:3000/api/layers` lists exactly `earthquakes`, `fires`, `weather`, `radiation`, with `errors: []` and **no upstream URL anywhere in the payload**.
- [ ] The full batch-1 manual checklist above passes.
- [ ] `grep -n "eq-circles\|fires-heat\|weather-dots\|rad-dots" src/components/OsirisMap.tsx` returns nothing.
- [ ] `grep -n "api/radiation\|api/weather'" src/app/page.tsx` returns nothing.

---

## Self-Review

**Spec coverage for this plan**

| Spec section | Covered by |
|---|---|
| §1.2 batch 0 and batch 1 composition | Tasks 1–11, 12–21 |
| §1.2.1 same-origin resolution lands in batch 0 | Task 5 |
| §2.1 `ClientManifest`, `GET /api/layers` | Task 3 |
| §2.2 `lyr:` namespacing | Task 1 |
| §2.3 engine lifecycle, sentinel, styledata, palette | Task 10 |
| §2.4 `useLayerData`, one timer, retry semantics | Task 8 |
| §2.5 `activeLayers` seeding, share links | Task 10 step 1, checklist item 8 |
| §2.6 rules 1–4, including the satellite union | Tasks 1, 10 step 3, 21 |
| §3.1 `groups.ts`, `PLUGINS` fallback | Task 4 |
| §3.2 merged manifest and legacy rows | Tasks 7, 9 |
| §3.3 two orderings kept separate | Task 7 (`order`), Task 17 (filename prefixes) |
| §3.4 memoised counts, post-filter variants | Tasks 7, 9 |
| §3.5 `optional` credential split | Task 7, Task 9 step 3 |
| §4.2 extended `PopupSpec` | Tasks 12–15 |
| §4.2.1 same-origin URLs | Task 5 |
| §4.3 the `badge` hint | Task 15, first used in Task 20 |
| §4.4 arithmetic belongs upstream | Stated in Task 14's commit; enforced by omission |
| §4.5 `resolveColor` | Task 13 |
| §6.2–6.5 diagnostics, request log, endpoint | Tasks 6, 11 |
| §7.2 expression pass-through guarded | Task 16 |
| §8.1 popup fixtures | Tasks 17–20 |
| §8.2 manual checklist | Task 21 step 5 |
| §8.4 gates | Both exit-criteria sections |

**Deliberately deferred to the batches 2–8 plan:** the credential form UI (§5), `computed`/`dependsOn` (§7.3), the `tiles` source kind (§7.1), stream mode (§7.4), renderer and behaviour modules (§7.5), overlays (§7.6), retirements (§7.7), and the `legacyKey` removal. Task 9 leaves `onOpenCredentials` as an optional undefined prop precisely so batch 2 can fill it in without reworking the panel.

**Type consistency check.** `ClientManifest` is defined in Task 3 and consumed by Tasks 7, 8, 9, 10, 11 under that name. `evaluate(cond, props)` is defined in Task 2 and used in Tasks 7, 14, 15. `buildPanelGroups` is defined in Task 7 and used in Task 9. `executePlan(plan, manifests, deps)` is defined in Task 8 and used only by the hook in the same task. `resolveColor(spec, props, fallback?)` and `withCoords(props, ctx)` are defined in Tasks 12–13 and used in Tasks 14–15. `renderPopup(spec, props, ctx?)` gains its third parameter in Task 14 and is called with it from `engine.ts` in the same task and from the fixture harness in Task 17.

**One known ordering hazard.** Task 1 changes ids that `engine.test.ts` asserts on, and Task 2 changes the engine's variant filtering. Both edit `engine.ts` or its test. They must be done in order, and a worker picking up Task 2 on a tree where Task 1 has not landed will see unrelated failures.
