import { describe, it, expect } from 'vitest';
import { createLoadState, planLoads, markStarted, markSettled } from './loader';
import type { NormalisedManifest, RefreshSpec, SourceSpec } from './types';

const httpSource = (refresh: RefreshSpec = { mode: 'once' }): SourceSpec => ({
  kind: 'http', url: 'https://example.org/x', format: 'json',
  lat: 'lat', lng: 'lng', properties: {}, refresh,
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
    const m = manifest({ datasets: [{ key: 'default', source: httpSource({ mode: 'poll', intervalMs: 1000 }), layers: [] }] });
    const state = createLoadState();
    const [plan] = planLoads([m], new Set(['radiation']), state, null, 0);
    markStarted(state, plan);
    markSettled(state, plan, true, 0);
    expect(planLoads([m], new Set(['radiation']), state, null, 999)).toEqual([]);
  });

  it('polls once the interval has elapsed', () => {
    const m = manifest({ datasets: [{ key: 'default', source: httpSource({ mode: 'poll', intervalMs: 1000 }), layers: [] }] });
    const state = createLoadState();
    const [plan] = planLoads([m], new Set(['radiation']), state, null, 0);
    markStarted(state, plan);
    markSettled(state, plan, true, 0);
    const again = planLoads([m], new Set(['radiation']), state, null, 1000);
    expect(again).toHaveLength(1);
    expect(again[0].reason).toBe('poll');
  });

  it('replans a viewport layer when the bounds change', () => {
    const m = manifest({ datasets: [{ key: 'default', source: httpSource({ mode: 'viewport', debounceMs: 800, mergeKey: 'id' }), layers: [] }] });
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
    const stream = manifest({ id: 'malware', datasets: [{ key: 'default', source: httpSource({ mode: 'stream', path: '/api/malware/stream' }), layers: [] }] });
    expect(planLoads([computed], new Set(['day_night']), createLoadState(), null, 0)).toEqual([]);
    expect(planLoads([none], new Set(['terrain_3d']), createLoadState(), null, 0)).toEqual([]);
    expect(planLoads([stream], new Set(['malware']), createLoadState(), null, 0)).toEqual([]);
  });
});
