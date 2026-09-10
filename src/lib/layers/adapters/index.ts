import type { GeoFeature } from '../types';

export interface Bbox { west: number; south: number; east: number; north: number }

export interface AdapterContext {
  params: Record<string, unknown>;
  bbox?: Bbox;
  /** Resolves a declared credential. Environment wins over the store. */
  config(key: string): Promise<string | undefined>;
}

export type SourceAdapter = (ctx: AdapterContext) => Promise<GeoFeature[]>;

/** For sources a manifest can't describe (H3 decoding, fan-outs) -- registered, not discovered, so code stays reviewable. */
export const ADAPTERS: Record<string, SourceAdapter> = {};

export function registerAdapter(name: string, fn: SourceAdapter): void {
  ADAPTERS[name] = fn;
}
