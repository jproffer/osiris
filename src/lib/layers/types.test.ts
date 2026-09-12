import { describe, expect, it } from 'vitest';
import { mapLayerId, sourceId } from './types';

/** The ten legacy source names in OsirisMap's `sources` array that used to collide. */
const LEGACY_SOURCES = [
  'piracy', 'balloons', 'radiation', 'fires', 'weather',
  'cctv', 'maritime', 'satellites', 'earthquakes', 'infrastructure',
];

describe('source and layer id derivation', () => {
  it('prefixes the single-dataset case', () => {
    expect(sourceId('piracy', 'default')).toBe('lyr:piracy');
  });

  it('prefixes the multi-dataset case', () => {
    expect(sourceId('maritime', 'ships')).toBe('lyr:maritime--ships');
  });

  it('derives layer ids from the prefixed source id', () => {
    expect(mapLayerId('earthquakes', 'default', 'circles')).toBe('lyr:earthquakes--circles');
    expect(mapLayerId('maritime', 'ships', 'dots')).toBe('lyr:maritime--ships--dots');
  });

  it('never collides with a legacy OsirisMap source name', () => {
    for (const legacy of LEGACY_SOURCES) {
      expect(sourceId(legacy, 'default')).not.toBe(legacy);
    }
  });
});
