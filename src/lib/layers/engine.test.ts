import { describe, it, expect } from 'vitest';
import { FakeMap } from './maplike';
import { LayerEngine, type Selection } from './engine';
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

function popupManifest(): NormalisedManifest {
  return {
    ...manifest(),
    interaction: {
      kind: 'popup',
      popup: { accent: '#7E57C2', title: { property: 'place' }, fields: [{ label: 'READING', property: 'value' }] },
    },
  };
}

function engineWithSelections(map: FakeMap) {
  const seen: Selection[] = [];
  const engine = new LayerEngine(map, { onSelect: s => seen.push(s), palette: {} });
  return { engine, seen };
}

const clickEvent = { point: { x: 10, y: 20 }, lngLat: { lng: 5, lat: 6 } };

describe('LayerEngine interaction', () => {
  it('renders popup html for a click on a clickable layer', () => {
    const map = new FakeMap();
    const { engine, seen } = engineWithSelections(map);
    engine.mount([popupManifest()]);
    engine.setActive(new Set(['radiation']));
    engine.attach();

    map.hits = [{ layer: { id: 'radiation--dots' }, properties: { place: 'Fukushima', value: '15' } }];
    map.emit('click', clickEvent);

    expect(seen).toHaveLength(1);
    expect(seen[0].kind).toBe('popup');
    if (seen[0].kind !== 'popup') return;
    expect(seen[0].layerId).toBe('radiation');
    expect(seen[0].html).toContain('Fukushima');
    expect(seen[0].lngLat).toEqual([5, 6]);
  });

  it('ignores a click that hits no clickable layer', () => {
    const map = new FakeMap();
    const { engine, seen } = engineWithSelections(map);
    engine.mount([popupManifest()]);
    engine.setActive(new Set(['radiation']));
    engine.attach();

    map.hits = [{ layer: { id: 'basemap-water' }, properties: {} }];
    map.emit('click', clickEvent);
    expect(seen).toEqual([]);
  });

  it('ignores a click on a non-clickable layer of a mounted manifest', () => {
    const map = new FakeMap();
    const { engine, seen } = engineWithSelections(map);
    engine.mount([popupManifest()]);
    engine.setActive(new Set(['radiation']));
    engine.attach();

    map.hits = [{ layer: { id: 'radiation--glow' }, properties: {} }];
    map.emit('click', clickEvent);
    expect(seen).toEqual([]);
  });

  it('takes the topmost hit when several clickable layers overlap', () => {
    const map = new FakeMap();
    const { engine, seen } = engineWithSelections(map);
    engine.mount([popupManifest(), { ...popupManifest(), id: 'piracy' }]);
    engine.setActive(new Set(['radiation', 'piracy']));
    engine.attach();

    map.hits = [
      { layer: { id: 'piracy--dots' }, properties: { place: 'Gulf of Guinea' } },
      { layer: { id: 'radiation--dots' }, properties: { place: 'Fukushima' } },
    ];
    map.emit('click', clickEvent);
    expect(seen[0].layerId).toBe('piracy');
  });

  it('emits a panel selection rather than html', () => {
    const map = new FakeMap();
    const { engine, seen } = engineWithSelections(map);
    engine.mount([{ ...manifest(), id: 'cctv', interaction: { kind: 'panel', panel: 'cctv' } }]);
    engine.setActive(new Set(['cctv']));
    engine.attach();

    map.hits = [{ layer: { id: 'cctv--dots' }, properties: { id: 'cam-1' } }];
    map.emit('click', clickEvent);
    expect(seen[0].kind).toBe('panel');
    if (seen[0].kind !== 'panel') return;
    expect(seen[0].panel).toBe('cctv');
    expect(seen[0].properties).toEqual({ id: 'cam-1' });
  });

  it('emits an adapter selection by name', () => {
    const map = new FakeMap();
    const { engine, seen } = engineWithSelections(map);
    engine.mount([{ ...manifest(), id: 'flights', interaction: { kind: 'adapter', adapter: 'flights' } }]);
    engine.setActive(new Set(['flights']));
    engine.attach();

    map.hits = [{ layer: { id: 'flights--dots' }, properties: { callsign: 'BA117' } }];
    map.emit('click', clickEvent);
    expect(seen[0].kind).toBe('adapter');
    if (seen[0].kind !== 'adapter') return;
    expect(seen[0].adapter).toBe('flights');
  });

  it('falls through to a registered hit test only when no layer was hit', () => {
    const map = new FakeMap();
    const { engine, seen } = engineWithSelections(map);
    engine.mount([popupManifest(), { ...manifest(), id: 'satellites', render: { kind: 'custom', renderer: 'satellites' }, interaction: { kind: 'adapter', adapter: 'satellites' } }]);
    engine.setActive(new Set(['radiation', 'satellites']));
    engine.registerHitTest('satellites', () => ({ name: 'ISS' }));
    engine.attach();

    // An ordinary layer wins.
    map.hits = [{ layer: { id: 'radiation--dots' }, properties: { place: 'Fukushima' } }];
    map.emit('click', clickEvent);
    expect(seen[0].layerId).toBe('radiation');

    // Nothing ordinary under the cursor: the custom renderer gets it.
    map.hits = [];
    map.emit('click', clickEvent);
    expect(seen[1].layerId).toBe('satellites');
    expect(seen[1].properties).toEqual({ name: 'ISS' });
  });

  it('does not consult a hit test for an inactive layer', () => {
    const map = new FakeMap();
    const { engine, seen } = engineWithSelections(map);
    engine.mount([{ ...manifest(), id: 'satellites', render: { kind: 'custom', renderer: 'satellites' }, interaction: { kind: 'adapter', adapter: 'satellites' } }]);
    engine.registerHitTest('satellites', () => ({ name: 'ISS' }));
    engine.setActive(new Set());
    engine.attach();

    map.hits = [];
    map.emit('click', clickEvent);
    expect(seen).toEqual([]);
  });

  it('sets a pointer cursor over a clickable layer and clears it after', () => {
    const map = new FakeMap();
    const { engine } = engineWithSelections(map);
    engine.mount([popupManifest()]);
    engine.setActive(new Set(['radiation']));
    engine.attach();

    map.hits = [{ layer: { id: 'radiation--dots' }, properties: {} }];
    map.emit('mousemove', clickEvent);
    expect(map.canvas.style.cursor).toBe('pointer');

    map.hits = [];
    map.emit('mousemove', clickEvent);
    expect(map.canvas.style.cursor).toBe('');
  });

  it('does not steal a cursor another owner has already claimed', () => {
    const map = new FakeMap();
    const { engine } = engineWithSelections(map);
    engine.mount([popupManifest()]);
    engine.setActive(new Set(['radiation']));
    engine.attach();

    map.canvas.style.cursor = 'crosshair';
    map.hits = [{ layer: { id: 'radiation--dots' }, properties: {} }];
    map.emit('mousemove', clickEvent);
    expect(map.canvas.style.cursor).toBe('crosshair');
  });

  it('stops responding after detach', () => {
    const map = new FakeMap();
    const { engine, seen } = engineWithSelections(map);
    engine.mount([popupManifest()]);
    engine.setActive(new Set(['radiation']));
    engine.attach();
    engine.detach();

    map.hits = [{ layer: { id: 'radiation--dots' }, properties: { place: 'X' } }];
    map.emit('click', clickEvent);
    expect(seen).toEqual([]);
  });
});
