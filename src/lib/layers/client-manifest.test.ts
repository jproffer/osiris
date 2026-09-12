import { describe, expect, it } from 'vitest';
import { toClientManifest } from './client-manifest';
import type { NormalisedManifest } from './types';

const SECRET: NormalisedManifest = {
  id: 'war_alerts', label: 'War Alerts', group: 'THREAT',
  defaultOn: false, countFrom: 'default',
  requiredConfig: [{ key: 'ACLED_API_KEY', label: 'ACLED API key', hint: 'free' }],
  datasets: [{
    key: 'default',
    legacyKey: 'war_alerts',
    source: {
      kind: 'http',
      url: 'https://api.acleddata.com/acled/read?key={config.ACLED_API_KEY}',
      format: 'json',
      lat: 'latitude', lng: 'longitude',
      properties: { actor: 'actor1' },
      headers: { Authorization: 'Bearer {config.ACLED_API_KEY}' },
      refresh: { mode: 'poll', intervalMs: 900000 },
    },
    layers: [{ suffix: 'dots', type: 'circle', clickable: true }],
  }],
  variants: [],
  render: { kind: 'geojson' },
};

describe('toClientManifest', () => {
  it('strips the upstream url and headers', () => {
    const json = JSON.stringify(toClientManifest(SECRET));
    expect(json).not.toContain('acleddata.com');
    expect(json).not.toContain('Authorization');
    expect(json).not.toContain('config.ACLED_API_KEY');
  });

  it('keeps only kind and refresh on the source', () => {
    const [dataset] = toClientManifest(SECRET).datasets;
    expect(dataset.source).toEqual({ kind: 'http', refresh: { mode: 'poll', intervalMs: 900000 } });
  });

  it('keeps everything the client renders from', () => {
    const c = toClientManifest(SECRET);
    expect(c.id).toBe('war_alerts');
    expect(c.label).toBe('War Alerts');
    expect(c.group).toBe('THREAT');
    expect(c.countFrom).toBe('default');
    expect(c.datasets[0].layers).toEqual([{ suffix: 'dots', type: 'circle', clickable: true }]);
    expect(c.datasets[0].legacyKey).toBe('war_alerts');
  });

  it('keeps credential descriptors but never a value', () => {
    const c = toClientManifest(SECRET);
    expect(c.requiredConfig).toEqual([{ key: 'ACLED_API_KEY', label: 'ACLED API key', hint: 'free' }]);
  });

  it('passes a tile source spec through, since it is a public endpoint', () => {
    const tiled: NormalisedManifest = {
      ...SECRET, id: 'terrain_3d', requiredConfig: [],
      datasets: [{
        key: 'default',
        source: { kind: 'tiles', spec: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
        layers: [],
      }],
    };
    expect(toClientManifest(tiled).datasets[0].source.spec)
      .toEqual({ type: 'vector', url: 'https://tiles.openfreemap.org/planet' });
  });
});
