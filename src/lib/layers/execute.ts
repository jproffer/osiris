import type { ClientManifest } from './client-manifest';
import type { LoadPlan } from './loader';
import type { GeoFeature } from './types';

/** The flat shape legacy consumers (outside the map) expect: spread properties plus lat/lng. */
export type LegacyRow = Record<string, unknown>;

export interface ExecuteDeps {
  fetchJson(url: string): Promise<unknown>;
  /** Merge these keys into the data store. Canonical keys hold Features; legacy keys hold flattened rows. */
  write(patch: Record<string, GeoFeature[] | LegacyRow[]>): void;
}

/** The flat shape legacy consumers (outside the map) expect: spread properties plus lat/lng derived from the point. */
function flattenLegacyRow(f: GeoFeature): LegacyRow {
  const g = f.geometry;
  const point = g.type === 'Point' ? (g.coordinates as [number, number]) : undefined;
  return { ...f.properties, lat: point?.[1], lng: point?.[0] };
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
  const patch: Record<string, GeoFeature[] | LegacyRow[]> = {};

  for (const [key, fc] of Object.entries(datasets)) {
    const features = fc?.features ?? [];
    patch[`${plan.layerId}.${key}`] = features;
    // The flat projection, read by consumers outside the map until batch 8.
    const legacyKey = manifest?.datasets.find(d => d.key === key)?.legacyKey;
    if (legacyKey) patch[legacyKey] = features.map(flattenLegacyRow);
  }

  if (Object.keys(patch).length === 0) return false;
  deps.write(patch);
  return true;
}
