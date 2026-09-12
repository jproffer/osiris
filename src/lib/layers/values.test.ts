import { describe, it, expect } from 'vitest';
import { resolveValue, withCoords, resolveColor } from './values';

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

describe('template values', () => {
  it('interpolates properties', () => {
    expect(resolveValue({ template: 'M{magnitude} EARTHQUAKE' }, { magnitude: 6.1 }))
      .toBe('M6.1 EARTHQUAKE');
  });

  it('renders a missing property as empty rather than undefined', () => {
    expect(resolveValue({ template: '{a}/{b}' }, { a: 'x' })).toBe('x/');
  });

  it('leaves unmatched braces alone', () => {
    expect(resolveValue({ template: '{a} {not a token}' }, { a: 'x' })).toBe('x {not a token}');
  });
});

describe('withCoords', () => {
  it('injects full and three-decimal coordinates', () => {
    const p = withCoords({ place: 'Off Honshu' }, { lng: 142.369, lat: 38.2971234 });
    expect(p.$lng).toBe(142.369);
    expect(p.$lat).toBe(38.2971234);
    expect(p.$lat3).toBe('38.297');
    expect(p.$lng3).toBe('142.369');
    expect(p.place).toBe('Off Honshu');
  });

  // Popups display three decimals but links need full precision -- one
  // pseudo-property cannot serve both, so there are four.
  it('is a no-op without a context', () => {
    const props = { place: 'x' };
    expect(withCoords(props, undefined)).toBe(props);
  });

  it('lets a real property named lat survive alongside $lat', () => {
    const p = withCoords({ lat: 'not a number' }, { lng: 1, lat: 2 });
    expect(p.lat).toBe('not a number');
    expect(p.$lat).toBe(2);
  });
});

describe('resolveColor', () => {
  it('accepts hex colours in every legal length', () => {
    for (const c of ['#fff', '#ffff', '#FF9500', '#FF9500CC']) {
      expect(resolveColor(c, {})).toBe(c);
    }
  });

  it('resolves a derived colour', () => {
    const spec = { range: { property: 'value', stops: [[350, '#D32F2F'], [100, '#E65100']] as [number, string][], fallback: '#7E57C2' } };
    expect(resolveColor(spec, { value: 400 })).toBe('#D32F2F');
    expect(resolveColor(spec, { value: 1 })).toBe('#7E57C2');
  });

  // The real reason this exists: a template can put an upstream string into a
  // style attribute, and escaping alone would not stop CSS injection.
  it('rejects anything that is not a hex colour', () => {
    expect(resolveColor({ template: '{evil}' }, { evil: 'red;background:url(//x)' })).toBe('#9B978E');
    expect(resolveColor({ template: '{evil}' }, { evil: 'javascript:alert(1)' })).toBe('#9B978E');
    expect(resolveColor('rebeccapurple', {})).toBe('#9B978E');
  });

  it('falls back to the caller-supplied colour', () => {
    expect(resolveColor('nonsense', {}, '#FF9500')).toBe('#FF9500');
  });
});
