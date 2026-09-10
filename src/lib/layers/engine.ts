import type { GeoFeature, MapLayerSpec, NormalisedManifest, VariantFilter } from './types';
import { mapLayerId, sourceId } from './types';
import type { MapLike } from './maplike';

/**
 * What a click resolved to. A discriminated union rather than a bare feature,
 * because the three interaction kinds are handled by different owners: the
 * host renders `popup` html into a MapLibre popup, opens a React panel for
 * `panel`, and calls a named function for `adapter`.
 */
export type Selection =
  | { kind: 'popup'; layerId: string; html: string; properties: Record<string, unknown>; lngLat: [number, number] }
  | { kind: 'panel'; layerId: string; panel: string; properties: Record<string, unknown>; lngLat: [number, number] }
  | { kind: 'adapter'; layerId: string; adapter: string; properties: Record<string, unknown>; lngLat: [number, number] };

export interface EngineOptions {
  onSelect(sel: Selection): void;
  palette: Record<string, string>;
  /** Manifest layers are inserted before this, so bespoke overlays stay on top. */
  beforeId?: string;
}

const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] as GeoFeature[] };

/** Expand {palette.key} tokens anywhere in a paint or layout value. */
function resolveTokens(value: unknown, palette: Record<string, string>): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{palette\.(\w+)\}/g, (whole, key: string) => palette[key] ?? whole);
  }
  if (Array.isArray(value)) return value.map(v => resolveTokens(v, palette));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveTokens(v, palette);
    return out;
  }
  return value;
}

function matches(filter: VariantFilter, props: Record<string, unknown>): boolean {
  const v = props[filter.property];
  if (filter.in) return filter.in.includes(v);
  if ('equals' in filter) return v === filter.equals;
  return true;
}

export class LayerEngine {
  private mounted = new Map<string, NormalisedManifest>();
  private raw = new Map<string, GeoFeature[]>();
  private active: ReadonlySet<string> = new Set();

  constructor(private map: MapLike, private opts: EngineOptions) {}

  /**
   * Add every source and layer once, hidden. Toggling visibility later is far
   * cheaper than adding and removing layers, and it is what OsirisMap already
   * does with its pre-allocated source list.
   */
  mount(manifests: NormalisedManifest[]): void {
    for (const m of manifests) {
      if (this.mounted.has(m.id)) continue;
      this.mounted.set(m.id, m);
      // Custom renderers and DOM overlays are not MapLibre layers.
      if (m.render.kind !== 'geojson') continue;

      for (const dataset of m.datasets) {
        const src = sourceId(m.id, dataset.key);
        if (!this.map.getSource(src)) {
          this.map.addSource(src, { type: 'geojson', data: EMPTY_FC });
        }
        for (const spec of dataset.layers) {
          const id = mapLayerId(m.id, dataset.key, spec.suffix);
          if (this.map.getLayer(id)) continue;
          this.map.addLayer(this.layerSpec(id, src, spec), this.opts.beforeId);
        }
      }
    }
  }

  private layerSpec(id: string, src: string, spec: MapLayerSpec): Record<string, unknown> {
    const out: Record<string, unknown> = {
      id, type: spec.type, source: src,
      paint: resolveTokens(spec.paint ?? {}, this.opts.palette),
      layout: { ...(resolveTokens(spec.layout ?? {}, this.opts.palette) as object), visibility: 'none' },
    };
    if (spec.filter) out.filter = spec.filter;
    if (spec.minzoom !== undefined) out.minzoom = spec.minzoom;
    if (spec.maxzoom !== undefined) out.maxzoom = spec.maxzoom;
    return out;
  }

  private isActive(m: NormalisedManifest): boolean {
    return this.active.has(m.id) || m.variants.some(v => this.active.has(v.id));
  }

  setActive(ids: ReadonlySet<string>): void {
    this.active = new Set(ids);
    for (const m of this.mounted.values()) {
      const visible = this.isActive(m);
      if (m.render.kind === 'geojson') {
        for (const dataset of m.datasets) {
          for (const spec of dataset.layers) {
            const id = mapLayerId(m.id, dataset.key, spec.suffix);
            if (this.map.getLayer(id)) {
              this.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
            }
          }
          this.apply(m, dataset.key);
        }
      }
    }
  }

  setData(layerId: string, datasetKey: string, features: GeoFeature[]): void {
    this.raw.set(`${layerId}:${datasetKey}`, features);
    const m = this.mounted.get(layerId);
    if (m) this.apply(m, datasetKey);
  }

  /**
   * Push the currently-visible slice into the source.
   *
   * Variant filters are row-level, so the union of the active variants'
   * filters decides what is drawn. The manifest's own id being active means
   * "all", which is how the satellites toggle relates to its categories.
   */
  private apply(m: NormalisedManifest, datasetKey: string): void {
    const src = sourceId(m.id, datasetKey);
    if (!this.map.getSource(src)) return;

    if (!this.isActive(m)) {
      this.map.getSource(src)!.setData(EMPTY_FC);
      return;
    }

    const rows = this.raw.get(`${m.id}:${datasetKey}`) ?? [];
    const primary = m.datasets[0]?.key;
    const filters = m.variants
      .filter(v => this.active.has(v.id) && (v.dataset ?? primary) === datasetKey && v.filter)
      .map(v => v.filter!);

    const features = this.active.has(m.id) || filters.length === 0
      ? rows
      : rows.filter(f => filters.some(filter => matches(filter, f.properties ?? {})));

    this.map.getSource(src)!.setData({ type: 'FeatureCollection', features });
  }

  setPalette(palette: Record<string, string>): void {
    this.opts.palette = palette;
    for (const m of this.mounted.values()) {
      if (m.render.kind !== 'geojson') continue;
      for (const dataset of m.datasets) {
        for (const spec of dataset.layers) {
          const id = mapLayerId(m.id, dataset.key, spec.suffix);
          if (!this.map.getLayer(id)) continue;
          for (const [name, value] of Object.entries(spec.paint ?? {})) {
            this.map.setPaintProperty(id, name, resolveTokens(value, palette));
          }
        }
      }
    }
  }

  /**
   * The clickable set, derived rather than authored. This is the structural
   * fix for the CLICKABLE_LAYERS drift bug: there is no second list to
   * disagree with the first.
   */
  clickableLayerIds(): string[] {
    const out: string[] = [];
    for (const m of this.mounted.values()) {
      if (m.render.kind !== 'geojson') continue;
      for (const dataset of m.datasets) {
        for (const spec of dataset.layers) {
          if (spec.clickable) out.push(mapLayerId(m.id, dataset.key, spec.suffix));
        }
      }
    }
    return out;
  }

  destroy(): void {
    this.mounted.clear();
    this.raw.clear();
    this.active = new Set();
  }
}
