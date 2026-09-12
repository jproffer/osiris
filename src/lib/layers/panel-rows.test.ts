import { describe, expect, it } from 'vitest';
import { buildPanelGroups } from './panel-rows';
import type { ClientManifest } from './client-manifest';

const quakes: ClientManifest = {
  id: 'earthquakes', label: 'Earthquakes', group: 'HAZARD',
  defaultOn: true, countFrom: 'default', order: 10, requiredConfig: [],
  datasets: [{ key: 'default', layers: [], source: { kind: 'http', refresh: { mode: 'once' } } }],
  variants: [], render: { kind: 'geojson' },
};

const sats: ClientManifest = {
  id: 'satellites', label: 'All Satellites', group: 'SPACE',
  defaultOn: false, countFrom: 'default', requiredConfig: [],
  datasets: [{ key: 'default', layers: [], source: { kind: 'http', refresh: { mode: 'once' } } }],
  variants: [
    { id: 'sat_comms', label: 'Starlink / Comms', filter: { property: 'category', equals: 'comms' } },
    { id: 'sat_military', label: 'Military / Intel', filter: { property: 'category', equals: 'military' } },
  ],
  render: { kind: 'geojson' },
};

const gated: ClientManifest = {
  ...quakes, id: 'cf_outages', label: 'Internet Outages', group: 'NETINTEL', order: 10,
  requiredConfig: [{ key: 'CLOUDFLARE_API_TOKEN', label: 'Cloudflare token' }],
};

const softGated: ClientManifest = {
  ...quakes, id: 'flights', label: 'Commercial', group: 'AVIATION', order: 10,
  requiredConfig: [{ key: 'OPENSKY_CLIENT_ID', label: 'OpenSky id', optional: true }],
};

const rowsOf = (groups: ReturnType<typeof buildPanelGroups>, key: string) =>
  groups.find(g => g.key === key)!.rows;

describe('buildPanelGroups', () => {
  it('builds one row per manifest, in its group', () => {
    const groups = buildPanelGroups({ manifests: [quakes], legacy: [], data: {}, configStatus: {} });
    expect(rowsOf(groups, 'HAZARD')).toMatchObject([{ key: 'earthquakes', label: 'Earthquakes' }]);
  });

  it('counts rows from the countFrom dataset', () => {
    const data = { 'earthquakes.default': [{}, {}, {}] };
    const groups = buildPanelGroups({ manifests: [quakes], legacy: [], data, configStatus: {} });
    expect(rowsOf(groups, 'HAZARD')[0].count).toBe(3);
  });

  it('shows a null count when the dataset has never loaded', () => {
    const groups = buildPanelGroups({ manifests: [quakes], legacy: [], data: {}, configStatus: {} });
    expect(rowsOf(groups, 'HAZARD')[0].count).toBeNull();
  });

  it('renders variants as sibling rows, counted post-filter', () => {
    const data = {
      'satellites.default': [
        { properties: { category: 'comms' } },
        { properties: { category: 'comms' } },
        { properties: { category: 'military' } },
      ],
    };
    const rows = rowsOf(buildPanelGroups({ manifests: [sats], legacy: [], data, configStatus: {} }), 'SPACE');
    expect(rows.map(r => r.key)).toEqual(['satellites', 'sat_comms', 'sat_military']);
    expect(rows[0].count).toBe(3);
    expect(rows[1].count).toBe(2);
    expect(rows[2].count).toBe(1);
  });

  it('marks a missing mandatory credential as required-missing', () => {
    const groups = buildPanelGroups({ manifests: [gated], legacy: [], data: {}, configStatus: {} });
    expect(rowsOf(groups, 'NETINTEL')[0].credential).toBe('required-missing');
  });

  // A layer that works without its key must not look disabled, or declaring
  // credentials everywhere would make working layers look broken.
  it('marks a missing optional credential as optional-missing', () => {
    const groups = buildPanelGroups({ manifests: [softGated], legacy: [], data: {}, configStatus: {} });
    expect(rowsOf(groups, 'AVIATION')[0].credential).toBe('optional-missing');
  });

  it('marks a configured credential as satisfied', () => {
    const configStatus = { cf_outages: { CLOUDFLARE_API_TOKEN: { configured: true, source: 'env' as const } } };
    const groups = buildPanelGroups({ manifests: [gated], legacy: [], data: {}, configStatus });
    expect(rowsOf(groups, 'NETINTEL')[0].credential).toBe('satisfied');
  });

  it('puts an unknown group under PLUGINS', () => {
    const odd = { ...quakes, id: 'odd', group: 'NOPE' };
    const groups = buildPanelGroups({ manifests: [odd], legacy: [], data: {}, configStatus: {} });
    expect(rowsOf(groups, 'PLUGINS').map(r => r.key)).toEqual(['odd']);
  });

  it('merges legacy rows into the same group, manifest rows first', () => {
    const legacy = [{ key: 'fires', label: 'Active Fires', group: 'HAZARD', count: 7 }];
    const groups = buildPanelGroups({ manifests: [quakes], legacy, data: {}, configStatus: {} });
    expect(rowsOf(groups, 'HAZARD').map(r => r.source)).toEqual(['manifest', 'legacy']);
    expect(rowsOf(groups, 'HAZARD')[1].count).toBe(7);
  });

  it('sorts groups by their declared order and drops empty ones', () => {
    const groups = buildPanelGroups({ manifests: [sats, quakes], legacy: [], data: {}, configStatus: {} });
    expect(groups.map(g => g.key)).toEqual(['SPACE', 'HAZARD']);
  });

  it('orders rows within a group by `order`, then registry order', () => {
    const a = { ...quakes, id: 'a', order: 30 };
    const b = { ...quakes, id: 'b', order: 10 };
    const { order, ...quakesNoOrder } = quakes;
    const c = { ...quakesNoOrder, id: 'c' };
    const groups = buildPanelGroups({ manifests: [a, b, c], legacy: [], data: {}, configStatus: {} });
    expect(rowsOf(groups, 'HAZARD').map(r => r.key)).toEqual(['b', 'a', 'c']);
  });
});
