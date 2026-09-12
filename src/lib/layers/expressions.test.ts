import { describe, expect, it } from 'vitest';
import { LayerEngine } from './engine';
import { FakeMap } from './maplike';
import { validateManifest } from './validate';

describe('arbitrary MapLibre expressions pass through untouched', () => {
  it('keeps a data-driven icon-rotate expression byte-identical', () => {
    const raw = {
      id: 'flock', label: 'Flock Cameras', group: 'SURVEILLANCE',
      source: {
        kind: 'http', url: 'https://example.com/f.json', format: 'json',
        lat: 'lat', lng: 'lng', properties: {}, refresh: { mode: 'once' },
      },
      layers: [{
        suffix: 'icons', type: 'symbol',
        layout: {
          'icon-image': 'camera',
          'icon-rotate': ['get', 'heading'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
        },
        paint: {
          'icon-color': ['case', ['>', ['get', 'heading'], 180], '{palette.cctv}', '#fff'],
          'icon-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.2, 12, 1],
        },
      }],
    };

    const result = validateManifest(raw, 'flock.json');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const map = new FakeMap();
    new LayerEngine(map, { onSelect: () => {}, palette: { cctv: '#00E5FF' } })
      .mount([result.manifest]);

    const added = map.layers.get('lyr:flock--icons')!;
    const layout = added.layout as Record<string, unknown>;
    const paint = added.paint as Record<string, unknown>;

    expect(layout['icon-rotate']).toEqual(['get', 'heading']);
    expect(layout['icon-rotation-alignment']).toBe('map');
    expect(layout['icon-allow-overlap']).toBe(true);
    expect(paint['icon-opacity']).toEqual(['interpolate', ['linear'], ['zoom'], 5, 0.2, 12, 1]);
    // Only the {palette.X} token nested inside the expression is rewritten.
    expect(paint['icon-color']).toEqual(['case', ['>', ['get', 'heading'], 180], '#00E5FF', '#fff']);
  });
});
