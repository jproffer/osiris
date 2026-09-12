import { describe, expect, it } from 'vitest';
import { evaluate } from './condition';

describe('evaluate', () => {
  it('tests presence with exists', () => {
    expect(evaluate({ property: 'end', exists: true }, { end: '2026-01-01' })).toBe(true);
    expect(evaluate({ property: 'end', exists: true }, {})).toBe(false);
    expect(evaluate({ property: 'end', exists: true }, { end: '' })).toBe(false);
    expect(evaluate({ property: 'end', exists: false }, {})).toBe(true);
  });

  // MapLibre serialises feature properties, so a boolean arrives as a string.
  it('treats the string "false" as falsy', () => {
    expect(evaluate({ property: 'ongoing', truthy: true }, { ongoing: 'true' })).toBe(true);
    expect(evaluate({ property: 'ongoing', truthy: true }, { ongoing: 'false' })).toBe(false);
    expect(evaluate({ property: 'ongoing', truthy: true }, { ongoing: true })).toBe(true);
    expect(evaluate({ property: 'ongoing', truthy: true }, { ongoing: '0' })).toBe(false);
  });

  it('compares with equals, coercing strings', () => {
    expect(evaluate({ property: 'net', equals: 'us' }, { net: 'us' })).toBe(true);
    expect(evaluate({ property: 'mag', equals: 5 }, { mag: '5' })).toBe(true);
    expect(evaluate({ property: 'net', equals: 'us' }, { net: 'ci' })).toBe(false);
  });

  it('tests membership with in', () => {
    expect(evaluate({ property: 'cat', in: ['comms', 'military'] }, { cat: 'comms' })).toBe(true);
    expect(evaluate({ property: 'cat', in: ['comms'] }, { cat: 'science' })).toBe(false);
  });

  it('inverts the whole condition with not', () => {
    expect(evaluate({ property: 'source', equals: 'NIGGG-BAS', not: true }, { source: 'us' })).toBe(true);
    expect(evaluate({ property: 'source', equals: 'NIGGG-BAS', not: true }, { source: 'NIGGG-BAS' })).toBe(false);
  });

  it('ands multiple clauses together', () => {
    const cond = { property: 'mag', exists: true, equals: 6 };
    expect(evaluate(cond, { mag: 6 })).toBe(true);
    expect(evaluate(cond, { mag: 5 })).toBe(false);
  });

  it('is true when no clause is given', () => {
    expect(evaluate({ property: 'anything' }, {})).toBe(true);
  });
});
