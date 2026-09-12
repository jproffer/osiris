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

/** Resolves a manifest's datasets into FeatureCollections. I/O is injected; two datasets sharing a URL cost one request. */
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

    if (source.kind === 'computed' || source.kind === 'none' || source.kind === 'tiles') {
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
