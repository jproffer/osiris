import { describe, it, expect } from 'vitest';
import { resolveValue } from './values';

describe('resolveValue', () => {
  it('returns a literal unchanged', () => {
    expect(resolveValue('#7E57C2', {})).toBe('#7E57C2');
  });

  it('reads a property', () => {
    expect(resolveValue({ property: 'place' }, { place: 'Fukushima' })).toBe('Fukushima');
  });

  it('renders an em dash for a missing property', () => {
    expect(resolveValue({ property: 'place' }, {})).toBe('—');
  });

  it('matches on equality by default', () => {
    const spec = { match: { property: 'kind', cases: { wildfire: '#FF6B1A', flood: '#00B0FF' }, fallback: '#FF3D3D' } };
    expect(resolveValue(spec, { kind: 'wildfire' })).toBe('#FF6B1A');
    expect(resolveValue(spec, { kind: 'volcano' })).toBe('#FF3D3D');
  });

  it('matches a MapLibre-serialised boolean', () => {
    const spec = { match: { property: 'ongoing', cases: { true: '#FFB300', false: '#8B7325' }, fallback: '#999' } };
    expect(resolveValue(spec, { ongoing: 'true' })).toBe('#FFB300');
    expect(resolveValue(spec, { ongoing: false })).toBe('#8B7325');
  });

  it('matches on substring when mode is contains', () => {
    const spec = { match: { property: 'status', cases: { 'SEISMIC RISK': '#E65100' }, fallback: '#26A69A', mode: 'contains' as const } };
    expect(resolveValue(spec, { status: 'Operational — SEISMIC RISK zone' })).toBe('#E65100');
    expect(resolveValue(spec, { status: 'Operational' })).toBe('#26A69A');
  });

  it('picks the first range stop the value meets or exceeds', () => {
    const spec = { range: { property: 'value', stops: [[350, '#D32F2F'], [100, '#E65100']] as [number, string][], fallback: '#7E57C2' } };
    expect(resolveValue(spec, { value: 400 })).toBe('#D32F2F');
    expect(resolveValue(spec, { value: 350 })).toBe('#D32F2F');
    expect(resolveValue(spec, { value: 150 })).toBe('#E65100');
    expect(resolveValue(spec, { value: 15 })).toBe('#7E57C2');
  });

  it('falls back when a range property is not numeric', () => {
    const spec = { range: { property: 'value', stops: [[100, '#E65100']] as [number, string][], fallback: '#7E57C2' } };
    expect(resolveValue(spec, { value: 'unknown' })).toBe('#7E57C2');
    expect(resolveValue(spec, {})).toBe('#7E57C2');
  });

  it('falls back rather than treating a null range property as zero', () => {
    const spec = { range: { property: 'a', stops: [[0, '#RED']] as [number, string][], fallback: '#GREY' } };
    expect(resolveValue(spec, { a: null })).toBe('#GREY');
  });
});
