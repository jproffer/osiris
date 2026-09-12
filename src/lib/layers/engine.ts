import type { ClientManifest } from './client-manifest';
import type { GeoFeature, MapLayerSpec } from './types';
import { mapLayerId, sourceId } from './types';
import type { MapLike } from './maplike';
import { renderPopup } from './popup';
import { isDatasetActive } from './loader';
import { evaluate } from './condition';

/** What a click resolved to -- one kind per owner: popup html, a React panel, or a named adapter. */
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

export class LayerEngine {
  private mounted = new Map<string, ClientManifest>();
  private raw = new Map<string, GeoFeature[]>();
  private active: ReadonlySet<string> = new Set();
  private hitTests = new Map<string, (point: { x: number; y: number }) => Record<string, unknown> | null>();
  private onClick: ((e: unknown) => void) | null = null;
  private onMove: ((e: unknown) => void) | null = null;
  /** Reverse index: map layer id -> owning manifest id, for clickable layers. */
  private clickOwner = new Map<string, string>();

  constructor(private map: MapLike, private opts: EngineOptions) {}

  /** Add every source/layer once, hidden -- toggling visibility later beats adding/removing layers. */
  mount(manifests: ClientManifest[]): void {
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
          if (spec.clickable) this.clickOwner.set(id, m.id);
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

  private isActive(m: ClientManifest): boolean {
    return this.active.has(m.id) || m.variants.some(v => this.active.has(v.id));
  }

  setActive(ids: ReadonlySet<string>): void {
    this.active = new Set(ids);
    for (const m of this.mounted.values()) {
      if (m.render.kind === 'geojson') {
        for (const dataset of m.datasets) {
          // Per-dataset, not per-manifest: e.g. Commercial on, Military off within one manifest.
          const visible = isDatasetActive(m, this.active, dataset.key);
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

  /** Pushes the visible slice: union of active variant filters, or all rows if the manifest id is active. */
  private apply(m: ClientManifest, datasetKey: string): void {
    const src = sourceId(m.id, datasetKey);
    if (!this.map.getSource(src)) return;

    if (!isDatasetActive(m, this.active, datasetKey)) {
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
      : rows.filter(f => filters.some(filter => evaluate(filter, f.properties ?? {})));

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

  /** The clickable set, derived not authored -- no second list left to drift out of sync. */
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

  registerHitTest(layerId: string, fn: (point: { x: number; y: number }) => Record<string, unknown> | null): void {
    this.hitTests.set(layerId, fn);
  }

  /** One click and one mousemove handler for every layer, replacing 29 hand-registered ones. */
  attach(): void {
    if (this.onClick) return;

    this.onClick = (raw: unknown) => {
      const e = raw as { point: { x: number; y: number }; lngLat: { lng: number; lat: number } };
      const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];

      for (const hit of this.map.queryRenderedFeatures(e.point)) {
        const owner = hit.layer?.id ? this.clickOwner.get(hit.layer.id) : undefined;
        if (!owner) continue;
        const m = this.mounted.get(owner);
        if (!m || !this.isActive(m)) continue;
        this.dispatch(m, hit.properties ?? {}, lngLat);
        return;
      }

      // Only now may a custom renderer claim the click -- defers to any layer with its own handler first.
      for (const [layerId, hitTest] of this.hitTests) {
        const m = this.mounted.get(layerId);
        if (!m || !this.isActive(m)) continue;
        const props = hitTest(e.point);
        if (props) { this.dispatch(m, props, lngLat); return; }
      }
    };

    this.onMove = (raw: unknown) => {
      const e = raw as { point: { x: number; y: number } };
      const canvas = this.map.getCanvas();
      // Never fight another owner that has already claimed the cursor.
      if (canvas.style.cursor && canvas.style.cursor !== 'pointer') return;

      const over = this.map.queryRenderedFeatures(e.point).some(hit => {
        const owner = hit.layer?.id ? this.clickOwner.get(hit.layer.id) : undefined;
        const m = owner ? this.mounted.get(owner) : undefined;
        return !!m && this.isActive(m);
      });

      if (over) canvas.style.cursor = 'pointer';
      else if (canvas.style.cursor === 'pointer') canvas.style.cursor = '';
    };

    this.map.on('click', this.onClick);
    this.map.on('mousemove', this.onMove);
  }

  detach(): void {
    if (this.onClick) { this.map.off('click', this.onClick); this.onClick = null; }
    if (this.onMove) { this.map.off('mousemove', this.onMove); this.onMove = null; }
  }

  private dispatch(m: ClientManifest, properties: Record<string, unknown>, lngLat: [number, number]): void {
    const interaction = m.interaction;
    if (!interaction) return;
    if (interaction.kind === 'popup') {
      this.opts.onSelect({ kind: 'popup', layerId: m.id, html: renderPopup(interaction.popup, properties), properties, lngLat });
    } else if (interaction.kind === 'panel') {
      this.opts.onSelect({ kind: 'panel', layerId: m.id, panel: interaction.panel, properties, lngLat });
    } else {
      this.opts.onSelect({ kind: 'adapter', layerId: m.id, adapter: interaction.adapter, properties, lngLat });
    }
  }

  destroy(): void {
    this.detach();
    this.hitTests.clear();
    this.clickOwner.clear();
    this.mounted.clear();
    this.raw.clear();
    this.active = new Set();
  }
}
