import type { DatasetSpec, NormalisedManifest, RefreshSpec } from './types';

export interface Viewport { west: number; south: number; east: number; north: number }

export interface LoadPlan {
  layerId: string;
  datasetKeys: string[];
  mode: RefreshSpec['mode'];
  reason: 'initial' | 'poll' | 'viewport';
  bbox?: Viewport;
}

/** Keyed by `${layerId}:${datasetKey}`, not layerId alone -- each dataset needs its own fetch history. */
export interface LoadState {
  fetched: Set<string>;
  inflight: Set<string>;
  lastPollAt: Map<string, number>;
  lastViewportKey: Map<string, string>;
}

export function createLoadState(): LoadState {
  return { fetched: new Set(), inflight: new Set(), lastPollAt: new Map(), lastViewportKey: new Map() };
}

function datasetStateKey(layerId: string, datasetKey: string): string {
  return `${layerId}:${datasetKey}`;
}

/** Coarse enough that a one-pixel drag does not count as a new viewport. */
function viewportKey(v: Viewport): string {
  return [v.west, v.south, v.east, v.north].map(n => n.toFixed(2)).join(',');
}

function refreshOf(d: DatasetSpec): RefreshSpec | null {
  const s = d.source;
  return s.kind === 'http' || s.kind === 'adapter' ? s.refresh : null;
}

/** Is this dataset active, given the on toggle ids -- shared with engine.ts so the two can't drift. */
export function isDatasetActive(m: NormalisedManifest, active: ReadonlySet<string>, datasetKey: string): boolean {
  if (active.has(m.id)) return true;
  const primary = m.datasets[0]?.key;
  return m.variants.some(v => active.has(v.id) && (v.dataset ?? primary) === datasetKey);
}

/** Datasets a manifest currently needs, given which toggles are on. */
function activeDatasets(m: NormalisedManifest, active: ReadonlySet<string>): string[] {
  return m.datasets.map(d => d.key).filter(k => isDatasetActive(m, active, k));
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

    // Never touch a dataset whose previous fetch hasn't settled yet.
    const pending = fetchable.filter(k => !state.inflight.has(datasetStateKey(m.id, k)));
    if (pending.length === 0) continue;

    // Never-fetched datasets group into one "initial" plan; already-fetched ones fall to poll/viewport below.
    const notYetFetched = pending.filter(k => !state.fetched.has(datasetStateKey(m.id, k)));
    if (notYetFetched.length > 0) {
      const first = m.datasets.find(d => d.key === notYetFetched[0])!;
      const refresh = refreshOf(first)!;
      plans.push({
        layerId: m.id, datasetKeys: notYetFetched, mode: refresh.mode, reason: 'initial',
        bbox: refresh.mode === 'viewport' && viewport ? viewport : undefined,
      });
      continue;
    }

    const first = m.datasets.find(d => d.key === pending[0])!;
    const refresh = refreshOf(first)!;

    if (refresh.mode === 'poll') {
      const due = pending.filter(k => now - (state.lastPollAt.get(datasetStateKey(m.id, k)) ?? 0) >= refresh.intervalMs);
      if (due.length > 0) {
        plans.push({ layerId: m.id, datasetKeys: due, mode: 'poll', reason: 'poll' });
      }
      continue;
    }

    if (refresh.mode === 'viewport' && viewport) {
      const key = viewportKey(viewport);
      const stale = pending.filter(k => state.lastViewportKey.get(datasetStateKey(m.id, k)) !== key);
      if (stale.length > 0) {
        plans.push({ layerId: m.id, datasetKeys: stale, mode: 'viewport', reason: 'viewport', bbox: viewport });
      }
    }
  }

  return plans;
}

/** Mark before awaiting so a mid-flight re-render can't double-fetch -- per dataset key, not per manifest. */
export function markStarted(state: LoadState, plan: LoadPlan): void {
  const vk = plan.bbox ? viewportKey(plan.bbox) : null;
  for (const k of plan.datasetKeys) {
    const dk = datasetStateKey(plan.layerId, k);
    state.inflight.add(dk);
    state.fetched.add(dk);
    if (vk) state.lastViewportKey.set(dk, vk);
  }
}

/** Releases the mark on failure -- without it, one timeout empties a layer for the whole session. */
export function markSettled(state: LoadState, plan: LoadPlan, ok: boolean, now: number): void {
  for (const k of plan.datasetKeys) {
    const dk = datasetStateKey(plan.layerId, k);
    state.inflight.delete(dk);
    if (ok) {
      state.lastPollAt.set(dk, now);
    } else {
      state.fetched.delete(dk);
      if (plan.bbox) state.lastViewportKey.delete(dk);
    }
  }
}
