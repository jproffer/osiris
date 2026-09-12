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
