import { describe, it, expect } from 'vitest';
import { validateManifest } from './validate';

const minimal = {
  id: 'radiation', label: 'Radiation Monitors', group: 'HAZARD',
  source: { kind: 'http', format: 'json', url: 'https://example.org/x', lat: 'latitude', lng: 'longitude', properties: {}, refresh: { mode: 'once' } },
  layers: [{ suffix: 'dots', type: 'circle', clickable: true }],
};

describe('validateManifest', () => {
  it('accepts a minimal manifest and expands the single-dataset sugar', () => {
    const r = validateManifest(minimal, 'radiation.json');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.datasets).toHaveLength(1);
    expect(r.manifest.datasets[0].key).toBe('default');
    expect(r.manifest.datasets[0].layers[0].suffix).toBe('dots');
  });

  it('applies defaults for the optional fields', () => {
    const r = validateManifest(minimal, 'radiation.json');
    if (!r.ok) throw new Error('expected ok');
    expect(r.manifest.defaultOn).toBe(false);
    expect(r.manifest.countFrom).toBe('default');
    expect(r.manifest.render).toEqual({ kind: 'geojson' });
    expect(r.manifest.variants).toEqual([]);
    expect(r.manifest.requiredConfig).toEqual([]);
  });

  it('keeps an explicit datasets array as-is', () => {
    const r = validateManifest({
      ...minimal, source: undefined, layers: undefined,
      datasets: [
        { key: 'ports', source: minimal.source, layers: minimal.layers },
        { key: 'ships', source: minimal.source, layers: minimal.layers },
      ],
    }, 'maritime.json');
    if (!r.ok) throw new Error('expected ok');
    expect(r.manifest.datasets.map(d => d.key)).toEqual(['ports', 'ships']);
    expect(r.manifest.countFrom).toBe('ports');
  });

  it('rejects a manifest with no id', () => {
    const r = validateManifest({ ...minimal, id: undefined }, 'bad.json');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(' ')).toContain('id');
    expect(r.errors.join(' ')).toContain('bad.json');
  });

  it('rejects a manifest with neither source nor datasets', () => {
    const r = validateManifest({ id: 'x', label: 'X', group: 'G' }, 'bad.json');
    expect(r.ok).toBe(false);
  });

  it('rejects an unknown source format and names it', () => {
    const r = validateManifest({ ...minimal, source: { ...minimal.source, format: 'jsom' } }, 'bad.json');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(' ')).toContain('jsom');
  });

  it('rejects duplicate dataset keys', () => {
    const r = validateManifest({
      ...minimal, source: undefined, layers: undefined,
      datasets: [
        { key: 'a', source: minimal.source, layers: minimal.layers },
        { key: 'a', source: minimal.source, layers: minimal.layers },
      ],
    }, 'bad.json');
    expect(r.ok).toBe(false);
  });

  it('rejects a variant whose dataset does not exist', () => {
    const r = validateManifest({
      ...minimal,
      variants: [{ id: 'v1', label: 'V1', dataset: 'nope' }],
    }, 'bad.json');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(' ')).toContain('nope');
  });

  it('reports every error at once rather than only the first', () => {
    const r = validateManifest({ label: 'X' }, 'bad.json');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBeGreaterThan(1);
  });

  it('never throws on arbitrary junk', () => {
    expect(() => validateManifest(null, 'x.json')).not.toThrow();
    expect(() => validateManifest('nope', 'x.json')).not.toThrow();
    expect(validateManifest(null, 'x.json').ok).toBe(false);
  });
});
