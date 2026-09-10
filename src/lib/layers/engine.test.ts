import { describe, it, expect } from 'vitest';
import { FakeMap } from './maplike';
import { LayerEngine } from './engine';
import type { NormalisedManifest } from './types';

function manifest(over: Partial<NormalisedManifest> = {}): NormalisedManifest {
  return {
    id: 'radiation', label: 'R', group: 'HAZARD', defaultOn: false,
    countFrom: 'default', requiredConfig: [], variants: [],
    render: { kind: 'geojson' },
    datasets: [{
      key: 'default',
      source: { kind: 'http', url: 'https://x/a', format: 'json', lat: 'lat', lng: 'lng', properties: {}, refresh: { mode: 'once' } },
      layers: [
        { suffix: 'glow', type: 'circle', paint: { 'circle-color': '#7E57C2' } },
        { suffix: 'dots', type: 'circle', clickable: true, paint: { 'circle-color': '{palette.cctv}' } },
      ],
    }],
    ...over,
  };
}

const engineOf = (map: FakeMap, palette: Record<string, string> = { cctv: '#00E5FF' }) =>
  new LayerEngine(map, { onSelect: () => {}, palette });

const feature = (props: Record<string, unknown>) => ({
  type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: props,
});

describe('LayerEngine.mount', () => {
  it('adds one source per dataset and one layer per spec', () => {
    const map = new FakeMap();
    engineOf(map).mount([manifest()]);
    expect([...map.sources.keys()]).toEqual(['radiation']);
    expect([...map.layers.keys()]).toEqual(['radiation--glow', 'radiation--dots']);
  });

  it('names sources and layers per the id rules for a non-default dataset', () => {
    const map = new FakeMap();
    const m = manifest({ id: 'maritime', datasets: [{ ...manifest().datasets[0], key: 'ships' }] });
    engineOf(map).mount([m]);
    expect([...map.sources.keys()]).toEqual(['maritime--ships']);
    expect([...map.layers.keys()]).toEqual(['maritime--ships--glow', 'maritime--ships--dots']);
  });

  it('mounts every layer hidden', () => {
    const map = new FakeMap();
    engineOf(map).mount([manifest()]);
    expect(map.visibilityOf('radiation--dots')).toBe('none');
    expect(map.visibilityOf('radiation--glow')).toBe('none');
  });

  it('resolves palette tokens in paint', () => {
    const map = new FakeMap();
    engineOf(map).mount([manifest()]);
    expect((map.layers.get('radiation--dots')!.paint as Record<string, unknown>)['circle-color']).toBe('#00E5FF');
  });

  it('leaves non-token paint values alone', () => {
    const map = new FakeMap();
    engineOf(map).mount([manifest()]);
    expect((map.layers.get('radiation--glow')!.paint as Record<string, unknown>)['circle-color']).toBe('#7E57C2');
  });

  it('does not mount custom or overlay render kinds as MapLibre layers', () => {
    const map = new FakeMap();
    engineOf(map).mount([
      manifest({ id: 'satellites', render: { kind: 'custom', renderer: 'satellites' } }),
      manifest({ id: 'cctv_previews', render: { kind: 'overlay', component: 'cctv-previews' } }),
    ]);
    expect(map.layers.size).toBe(0);
  });

  it('is idempotent — mounting twice does not duplicate layers', () => {
    const map = new FakeMap();
    const engine = engineOf(map);
    engine.mount([manifest()]);
    engine.mount([manifest()]);
    expect(map.layers.size).toBe(2);
  });
});

describe('LayerEngine.setActive', () => {
  it('shows a layer when its id is active and hides it otherwise', () => {
    const map = new FakeMap();
    const engine = engineOf(map);
    engine.mount([manifest()]);
    engine.setActive(new Set(['radiation']));
    expect(map.visibilityOf('radiation--dots')).toBe('visible');
    engine.setActive(new Set());
    expect(map.visibilityOf('radiation--dots')).toBe('none');
  });

  it('shows a layer when any of its variants is active', () => {
    const map = new FakeMap();
    const engine = engineOf(map);
    engine.mount([manifest({ id: 'satellites', variants: [{ id: 'sat_comms', label: 'Comms', filter: { property: 'category', equals: 'comms' } }] })]);
    engine.setActive(new Set(['sat_comms']));
    expect(map.visibilityOf('satellites--dots')).toBe('visible');
  });
});

describe('LayerEngine.setData', () => {
  it('pushes features into the dataset source', () => {
    const map = new FakeMap();
    const engine = engineOf(map);
    engine.mount([manifest()]);
    engine.setActive(new Set(['radiation']));
    engine.setData('radiation', 'default', [feature({ n: 1 })]);
    expect(map.featuresIn('radiation')).toHaveLength(1);
  });

  it('filters to the union of active variant filters', () => {
    const map = new FakeMap();
    const engine = engineOf(map);
    engine.mount([manifest({
      id: 'satellites',
      variants: [
        { id: 'sat_comms', label: 'Comms', filter: { property: 'category', equals: 'comms' } },
        { id: 'sat_military', label: 'Mil', filter: { property: 'category', in: ['military'] } },
      ],
    })]);
    const rows = [feature({ category: 'comms' }), feature({ category: 'military' }), feature({ category: 'science' })];

    engine.setActive(new Set(['sat_comms']));
    engine.setData('satellites', 'default', rows);
    expect(map.featuresIn('satellites')).toHaveLength(1);

    engine.setActive(new Set(['sat_comms', 'sat_military']));
    expect(map.featuresIn('satellites')).toHaveLength(2);
  });

  it('shows every feature when the manifest id itself is active', () => {
    const map = new FakeMap();
    const engine = engineOf(map);
    engine.mount([manifest({ id: 'satellites', variants: [{ id: 'sat_comms', label: 'C', filter: { property: 'category', equals: 'comms' } }] })]);
    engine.setData('satellites', 'default', [feature({ category: 'comms' }), feature({ category: 'science' })]);
    engine.setActive(new Set(['satellites']));
    expect(map.featuresIn('satellites')).toHaveLength(2);
  });

  it('clears the source when the layer goes inactive', () => {
    const map = new FakeMap();
    const engine = engineOf(map);
    engine.mount([manifest()]);
    engine.setActive(new Set(['radiation']));
    engine.setData('radiation', 'default', [feature({ n: 1 })]);
    engine.setActive(new Set());
    expect(map.featuresIn('radiation')).toHaveLength(0);
  });
});

describe('LayerEngine.clickableLayerIds', () => {
  it('derives the clickable set from the manifests', () => {
    const map = new FakeMap();
    const engine = engineOf(map);
    engine.mount([manifest()]);
    expect(engine.clickableLayerIds()).toEqual(['radiation--dots']);
  });
});

describe('LayerEngine.setPalette', () => {
  it('re-applies paint when the palette changes', () => {
    const map = new FakeMap();
    const engine = engineOf(map);
    engine.mount([manifest()]);
    engine.setPalette({ cctv: '#FF0000' });
    expect((map.layers.get('radiation--dots')!.paint as Record<string, unknown>)['circle-color']).toBe('#FF0000');
  });
});
