import type { GeoFeature } from '../types';

export interface Bbox { west: number; south: number; east: number; north: number }

export interface AdapterContext {
  params: Record<string, unknown>;
  bbox?: Bbox;
  /** Resolves a declared credential. Environment wins over the store. */
  config(key: string): Promise<string | undefined>;
}

export type SourceAdapter = (ctx: AdapterContext) => Promise<GeoFeature[]>;

/**
 * Named adapters for sources a manifest cannot describe -- H3 decoding, a
 * two-level response keyed by callsign, a 40-source fan-out. Registered here
 * rather than discovered, because an adapter is compiled code and must be
 * reviewable.
 */
export const ADAPTERS: Record<string, SourceAdapter> = {};

export function registerAdapter(name: string, fn: SourceAdapter): void {
  ADAPTERS[name] = fn;
}
