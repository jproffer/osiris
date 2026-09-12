import { beforeEach, describe, expect, it } from 'vitest';
import { CAPACITY, clearLog, recent, record } from './request-log';

describe('request log', () => {
  beforeEach(() => clearLog());

  it('returns newest first', () => {
    record({ layer: 'fires', datasets: ['default'], status: 200, ms: 12, bytes: 900 });
    record({ layer: 'weather', datasets: ['default'], status: 502, ms: 40, bytes: 0 });
    expect(recent().map(e => e.layer)).toEqual(['weather', 'fires']);
  });

  it('stamps each entry with a time', () => {
    record({ layer: 'fires', datasets: ['default'], status: 200, ms: 12, bytes: 900 });
    expect(recent()[0].at).toBeGreaterThan(0);
  });

  it('drops the oldest past capacity', () => {
    for (let i = 0; i < CAPACITY + 25; i++) {
      record({ layer: `l${i}`, datasets: ['default'], status: 200, ms: 1, bytes: 1 });
    }
    const all = recent(CAPACITY + 100);
    expect(all).toHaveLength(CAPACITY);
    expect(all[0].layer).toBe(`l${CAPACITY + 24}`);
    expect(all[CAPACITY - 1].layer).toBe('l25');
  });

  it('honours a limit', () => {
    for (let i = 0; i < 10; i++) {
      record({ layer: `l${i}`, datasets: ['default'], status: 200, ms: 1, bytes: 1 });
    }
    expect(recent(3)).toHaveLength(3);
  });

  // Same reasoning as ClientManifest: the resolved upstream URL never leaves
  // the server, and a diagnostics payload is not an exception.
  it('has no field that could carry an upstream url or header', () => {
    record({ layer: 'fires', datasets: ['default'], status: 200, ms: 12, bytes: 900 });
    const json = JSON.stringify(recent()[0]);
    expect(json).not.toContain('http');
    expect(Object.keys(recent()[0]).sort())
      .toEqual(['at', 'bytes', 'datasets', 'layer', 'ms', 'status']);
  });
});
