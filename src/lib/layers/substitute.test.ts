import { describe, it, expect } from 'vitest';
import { substitute } from './substitute';

const at = new Date('2026-09-09T12:00:00.000Z');

describe('substitute', () => {
  it('leaves a template with no tokens alone', () => {
    const r = substitute('https://example.org/a', () => undefined, at);
    expect(r.text).toBe('https://example.org/a');
    expect(r.missing).toEqual([]);
  });

  it('expands {today} and the offset forms', () => {
    expect(substitute('{today}', () => undefined, at).text).toBe('2026-09-09');
    expect(substitute('{today-1d}', () => undefined, at).text).toBe('2026-09-08');
    expect(substitute('{today-7d}', () => undefined, at).text).toBe('2026-09-02');
  });

  it('expands a config token via the resolver', () => {
    const r = substitute('Bearer {config.TOKEN}', k => (k === 'TOKEN' ? 'abc123' : undefined), at);
    expect(r.text).toBe('Bearer abc123');
    expect(r.missing).toEqual([]);
  });

  it('reports an unresolved config token instead of emitting a blank', () => {
    const r = substitute('Bearer {config.TOKEN}', () => undefined, at);
    expect(r.missing).toEqual(['TOKEN']);
  });

  it('reports each missing key once', () => {
    const r = substitute('{config.A}/{config.A}/{config.B}', () => undefined, at);
    expect(r.missing.sort()).toEqual(['A', 'B']);
  });

  it('leaves an unrecognised token untouched rather than guessing', () => {
    const r = substitute('{tomorrow}', () => undefined, at);
    expect(r.text).toBe('{tomorrow}');
    expect(r.missing).toEqual([]);
  });

  it('handles a realistic Safecast URL', () => {
    const r = substitute(
      'https://api.safecast.org/measurements.json?since={today-1d}&limit=2000&unit=cpm',
      () => undefined, at,
    );
    expect(r.text).toBe('https://api.safecast.org/measurements.json?since=2026-09-08&limit=2000&unit=cpm');
  });
});
