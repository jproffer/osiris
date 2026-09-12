import { describe, it, expect } from 'vitest';
import { serveDatasets, resolveSelfOrigin } from './serve';
import type { NormalisedManifest, SourceSpec } from './types';
import type { ServeDeps } from './serve';

const httpSource = (url: string, over: Partial<Record<string, unknown>> = {}): SourceSpec => ({
  kind: 'http', url, format: 'json', lat: 'lat', lng: 'lng',
  properties: { n: 'name' }, refresh: { mode: 'once' }, ...over,
} as SourceSpec);

function manifest(datasets: NormalisedManifest['datasets']): NormalisedManifest {
  return {
    id: 'test', label: 'T', group: 'G', defaultOn: false, countFrom: datasets[0].key,
    requiredConfig: [], variants: [], render: { kind: 'geojson' }, datasets,
  };
}

function deps(over: Partial<ServeDeps> = {}): ServeDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async fetchText(url: string) {
      calls.push(url);
      return JSON.stringify([{ lat: 1, lng: 2, name: 'alpha' }]);
    },
    async readConfig() { return undefined; },
    adapters: {},
    ...over,
  } as ServeDeps & { calls: string[] };
}

describe('serveDatasets', () => {
  it('fetches an http dataset and returns a FeatureCollection', async () => {
    const d = deps();
    const r = await serveDatasets(manifest([{ key: 'default', source: httpSource('https://x/a'), layers: [] }]), ['default'], undefined, d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datasets.default.type).toBe('FeatureCollection');
    expect(r.datasets.default.features).toHaveLength(1);
    expect(r.datasets.default.features[0].properties).toEqual({ n: 'alpha' });
  });

  it('expands date tokens in the url before fetching', async () => {
    const d = deps();
    await serveDatasets(
      manifest([{ key: 'default', source: httpSource('https://x/a?since={today-1d}'), layers: [] }]),
      ['default'], undefined, { ...d, now: new Date('2026-09-09T00:00:00Z') } as ServeDeps,
    );
    expect(d.calls[0]).toBe('https://x/a?since=2026-09-08');
  });

  it('returns 428 and the missing keys when a credential is unset', async () => {
    const d = deps();
    const r = await serveDatasets(
      manifest([{ key: 'default', source: httpSource('https://x/a', { headers: { Authorization: 'Bearer {config.ACLED_KEY}' } }), layers: [] }]),
      ['default'], undefined, d,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(428);
    expect(r.needsConfig).toEqual(['ACLED_KEY']);
    expect(d.calls).toEqual([]);
  });

  it('substitutes a resolved credential into headers', async () => {
    const seen: Record<string, string>[] = [];
    const d = deps({
      async readConfig(key: string) { return key === 'ACLED_KEY' ? 'secret' : undefined; },
      async fetchText(_u: string, headers: Record<string, string>) { seen.push(headers); return '[]'; },
    });
    await serveDatasets(
      manifest([{ key: 'default', source: httpSource('https://x/a', { headers: { Authorization: 'Bearer {config.ACLED_KEY}' } }), layers: [] }]),
      ['default'], undefined, d,
    );
    expect(seen[0].Authorization).toBe('Bearer secret');
  });

  it('dispatches to a named adapter and passes params and bbox', async () => {
    let got: { params: unknown; bbox: unknown } | null = null;
    const d = deps({
      adapters: {
        sondehub: async ctx => { got = { params: ctx.params, bbox: ctx.bbox }; return []; },
      },
    });
    const src: SourceSpec = { kind: 'adapter', adapter: 'sondehub', params: { duration: '1d' }, refresh: { mode: 'once' } };
    const bbox = { west: 0, south: 0, east: 1, north: 1 };
    const r = await serveDatasets(manifest([{ key: 'default', source: src, layers: [] }]), ['default'], bbox, d);
    expect(r.ok).toBe(true);
    expect(got).toEqual({ params: { duration: '1d' }, bbox });
  });

  it('returns 500 naming an adapter that is not registered', async () => {
    const src: SourceSpec = { kind: 'adapter', adapter: 'nope', refresh: { mode: 'once' } };
    const r = await serveDatasets(manifest([{ key: 'default', source: src, layers: [] }]), ['default'], undefined, deps());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(500);
    expect(r.error).toContain('nope');
  });

  it('returns 404 for a dataset key the manifest does not define', async () => {
    const r = await serveDatasets(manifest([{ key: 'default', source: httpSource('https://x/a'), layers: [] }]), ['ghost'], undefined, deps());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(404);
  });

  it('serves several datasets in one call', async () => {
    const d = deps({
      async fetchText() { return JSON.stringify({ a: [{ lat: 1, lng: 2, name: 'A' }], b: [{ lat: 3, lng: 4, name: 'B' }] }); },
    });
    const m = manifest([
      { key: 'a', source: httpSource('https://x/shared', { arrayPath: 'a' }), layers: [] },
      { key: 'b', source: httpSource('https://x/shared', { arrayPath: 'b' }), layers: [] },
    ]);
    const r = await serveDatasets(m, ['a', 'b'], undefined, d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datasets.a.features[0].properties).toEqual({ n: 'A' });
    expect(r.datasets.b.features[0].properties).toEqual({ n: 'B' });
  });

  it('returns 502 when the upstream throws', async () => {
    const d = deps({ async fetchText() { throw new Error('upstream exploded'); } });
    const r = await serveDatasets(manifest([{ key: 'default', source: httpSource('https://x/a'), layers: [] }]), ['default'], undefined, d);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(502);
  });

  it('refuses to serve computed and none sources', async () => {
    const computed = manifest([{ key: 'default', source: { kind: 'computed', compute: 'solar-terminator' }, layers: [] }]);
    const r = await serveDatasets(computed, ['default'], undefined, deps());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
  });
});

describe('resolveSelfOrigin', () => {
  it('leaves an absolute url alone', () => {
    expect(resolveSelfOrigin('https://api.safecast.org/measurements.json'))
      .toBe('https://api.safecast.org/measurements.json');
  });

  it('resolves a root-relative url against the instance origin', () => {
    expect(resolveSelfOrigin('/api/fires')).toBe('http://127.0.0.1:3000/api/fires');
  });

  it('honours OSIRIS_SELF_ORIGIN', () => {
    const prev = process.env.OSIRIS_SELF_ORIGIN;
    process.env.OSIRIS_SELF_ORIGIN = 'http://osiris:3000';
    try {
      expect(resolveSelfOrigin('/api/weather')).toBe('http://osiris:3000/api/weather');
    } finally {
      if (prev === undefined) delete process.env.OSIRIS_SELF_ORIGIN;
      else process.env.OSIRIS_SELF_ORIGIN = prev;
    }
  });

  it('strips a trailing slash from the configured origin', () => {
    const prev = process.env.OSIRIS_SELF_ORIGIN;
    process.env.OSIRIS_SELF_ORIGIN = 'http://osiris:3000/';
    try {
      expect(resolveSelfOrigin('/api/fires')).toBe('http://osiris:3000/api/fires');
    } finally {
      if (prev === undefined) delete process.env.OSIRIS_SELF_ORIGIN;
      else process.env.OSIRIS_SELF_ORIGIN = prev;
    }
  });
});
