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
