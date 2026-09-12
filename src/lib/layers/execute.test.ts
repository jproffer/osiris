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
