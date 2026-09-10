import { describe, it, expect } from 'vitest';
import { getPath, parseCsv, extractRows, rowsToFeatures } from './http-source';

describe('getPath', () => {
  it('reads a top-level key', () => {
    expect(getPath({ a: 1 }, 'a')).toBe(1);
  });
  it('reads a nested path', () => {
    expect(getPath({ a: { b: { c: 'x' } } }, 'a.b.c')).toBe('x');
  });
  it('reads through an array index', () => {
    expect(getPath({ a: [{ b: 2 }] }, 'a.0.b')).toBe(2);
  });
  it('returns undefined for a missing path without throwing', () => {
    expect(getPath({ a: 1 }, 'a.b.c')).toBeUndefined();
    expect(getPath(null, 'a')).toBeUndefined();
  });
});

describe('parseCsv', () => {
  it('parses a header and rows', () => {
    expect(parseCsv('hex,good,bad\nabc,10,2\ndef,5,0')).toEqual([
      { hex: 'abc', good: '10', bad: '2' },
      { hex: 'def', good: '5', bad: '0' },
    ]);
  });
  it('ignores a trailing newline and blank lines', () => {
    expect(parseCsv('a,b\n1,2\n\n')).toEqual([{ a: '1', b: '2' }]);
  });
  it('handles quoted fields containing commas', () => {
    expect(parseCsv('a,b\n"x,y",2')).toEqual([{ a: 'x,y', b: '2' }]);
  });
  it('returns an empty array for an empty document', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('justheaders,only')).toEqual([]);
  });
});

describe('extractRows', () => {
  it('returns a top-level JSON array', () => {
    expect(extractRows('json', '[{"a":1}]')).toEqual([{ a: 1 }]);
  });
  it('follows arrayPath into a JSON object', () => {
    expect(extractRows('json', '{"data":{"items":[{"a":1}]}}', 'data.items')).toEqual([{ a: 1 }]);
  });
  it('returns an empty array when arrayPath misses', () => {
    expect(extractRows('json', '{"data":{}}', 'data.items')).toEqual([]);
  });
  it('returns features from a GeoJSON FeatureCollection', () => {
    const fc = '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[1,2]},"properties":{"n":"x"}}]}';
    expect(extractRows('geojson', fc)).toHaveLength(1);
  });
  it('parses CSV', () => {
    expect(extractRows('csv', 'a,b\n1,2')).toEqual([{ a: '1', b: '2' }]);
  });
  it('returns an empty array for unparseable input rather than throwing', () => {
    expect(extractRows('json', 'not json')).toEqual([]);
  });
});

describe('rowsToFeatures', () => {
  const opts = { lat: 'latitude', lng: 'longitude', properties: { value: 'value', place: 'location_name' } };

  it('maps coordinates and the declared properties', () => {
    const out = rowsToFeatures([{ latitude: 37.6, longitude: -112.1, value: 48, location_name: 'Cedar City', extra: 'dropped' }], opts);
    expect(out).toHaveLength(1);
    expect(out[0].geometry).toEqual({ type: 'Point', coordinates: [-112.1, 37.6] });
    expect(out[0].properties).toEqual({ value: 48, place: 'Cedar City' });
  });

  it('coerces numeric strings in coordinates', () => {
    const out = rowsToFeatures([{ latitude: '37.6', longitude: '-112.1' }], opts);
    expect(out[0].geometry).toEqual({ type: 'Point', coordinates: [-112.1, 37.6] });
  });

  it('drops rows with missing or non-numeric coordinates instead of placing them at 0,0', () => {
    const out = rowsToFeatures([
      { latitude: 1, longitude: 2 },
      { latitude: null, longitude: 2 },
      { longitude: 2 },
      { latitude: 'nope', longitude: 2 },
    ], opts);
    expect(out).toHaveLength(1);
  });

  it('drops coordinates outside valid ranges', () => {
    const out = rowsToFeatures([{ latitude: 200, longitude: 2 }, { latitude: 1, longitude: 999 }], opts);
    expect(out).toEqual([]);
  });

  it('reads nested property paths', () => {
    const out = rowsToFeatures(
      [{ latitude: 1, longitude: 2, gap: { distanceKm: '40' } }],
      { lat: 'latitude', lng: 'longitude', properties: { distance: 'gap.distanceKm' } },
    );
    expect(out[0].properties).toEqual({ distance: '40' });
  });

  it('passes GeoJSON geometry through untouched', () => {
    const rows = [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { name: 'cable' } }];
    const out = rowsToFeatures(rows, { lat: '', lng: '', properties: { name: 'name' }, passthroughGeometry: true });
    expect(out[0].geometry).toEqual({ type: 'LineString', coordinates: [[0, 0], [1, 1]] });
    expect(out[0].properties).toEqual({ name: 'cable' });
  });

  it('drops GeoJSON rows with no geometry', () => {
    const rows = [{ type: 'Feature', geometry: null, properties: {} }];
    expect(rowsToFeatures(rows, { lat: '', lng: '', properties: {}, passthroughGeometry: true })).toEqual([]);
  });
});
