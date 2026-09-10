/** Every manifest type. No logic lives here. */

export type Format =
  | 'text' | 'number' | 'thousands'
  | 'fixed1' | 'fixed2' | 'fixed3'
  | 'percent' | 'date' | 'datetime' | 'upper';

export type ValueSpec =
  | string
  | { property: string }
  | { match: { property: string; cases: Record<string, string>; fallback: string; mode?: 'equals' | 'contains' } }
  | { range: { property: string; stops: [number, string][]; fallback: string } };

export interface PopupFieldSpec { label: string; property: string; format?: Format; suffix?: string }
export interface PopupLinkSpec { label: string; url: string }

export interface PopupSpec {
  accent: ValueSpec;
  title: ValueSpec;
  subtitle?: ValueSpec;
  fields: PopupFieldSpec[];
  links?: PopupLinkSpec[];
}

export type InteractionSpec =
  | { kind: 'popup'; popup: PopupSpec }
  | { kind: 'adapter'; adapter: string }
  | { kind: 'panel'; panel: string };

export type RefreshSpec =
  | { mode: 'once' }
  | { mode: 'poll'; intervalMs: number }
  | { mode: 'viewport'; debounceMs: number; mergeKey: string }
  | { mode: 'stream'; path: string };

export type SourceSpec =
  | {
      kind: 'http';
      url: string;
      format: 'json' | 'geojson' | 'csv';
      arrayPath?: string;
      lat: string;
      lng: string;
      properties: Record<string, string>;
      headers?: Record<string, string>;
      cacheTtlMs?: number;
      refresh: RefreshSpec;
    }
  | { kind: 'adapter'; adapter: string; params?: Record<string, unknown>; refresh: RefreshSpec }
  | { kind: 'computed'; compute: string }
  | { kind: 'none' };

export interface MapLayerSpec {
  suffix: string;
  type: 'circle' | 'symbol' | 'line' | 'fill' | 'fill-extrusion';
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  filter?: unknown[];
  minzoom?: number;
  maxzoom?: number;
  clickable?: boolean;
}

export interface DatasetSpec {
  key: string;
  source: SourceSpec;
  layers: MapLayerSpec[];
  /** Also publish rows under this flat key, for consumers not yet migrated. */
  legacyKey?: string;
}

export interface VariantFilter { property: string; equals?: unknown; in?: unknown[] }

export interface VariantSpec {
  id: string;
  label: string;
  dataset?: string;
  filter?: VariantFilter;
  defaultOn?: boolean;
}

export interface ConfigFieldSpec {
  key: string;
  label: string;
  hint?: string;
  docsUrl?: string;
  optional?: boolean;
}

export type RenderSpec =
  | { kind: 'geojson' }
  | { kind: 'custom'; renderer: string }
  | { kind: 'overlay'; component: string };

export interface LayerManifest {
  id: string;
  label: string;
  group: string;
  defaultOn?: boolean;
  parent?: string;
  countFrom?: string;
  requiredConfig?: ConfigFieldSpec[];
  /** Sugar for a single dataset; normalised into `datasets` by validate.ts. */
  source?: SourceSpec;
  layers?: MapLayerSpec[];
  datasets?: DatasetSpec[];
  variants?: VariantSpec[];
  render?: RenderSpec;
  interaction?: InteractionSpec;
}

/** What the engine and loader consume. Sugar is already expanded. */
export interface NormalisedManifest {
  id: string;
  label: string;
  group: string;
  defaultOn: boolean;
  parent?: string;
  countFrom: string;
  requiredConfig: ConfigFieldSpec[];
  datasets: DatasetSpec[];
  variants: VariantSpec[];
  render: RenderSpec;
  interaction?: InteractionSpec;
}

export interface GeoFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] } | { type: string; coordinates: unknown };
  properties: Record<string, unknown>;
}

export function sourceId(layerId: string, datasetKey: string): string {
  return datasetKey === 'default' ? layerId : `${layerId}--${datasetKey}`;
}

export function mapLayerId(layerId: string, datasetKey: string, suffix: string): string {
  return `${sourceId(layerId, datasetKey)}--${suffix}`;
}
