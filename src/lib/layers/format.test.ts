import { describe, it, expect } from 'vitest';
import { coerce, formatValue } from './format';

describe('coerce', () => {
  it('turns MapLibre-serialised booleans back into booleans', () => {
    expect(coerce('true')).toBe(true);
    expect(coerce('false')).toBe(false);
  });

  it('turns numeric strings into numbers', () => {
    expect(coerce('42')).toBe(42);
    expect(coerce('-3.5')).toBe(-3.5);
  });

  it('leaves non-numeric strings alone', () => {
    expect(coerce('Sofia')).toBe('Sofia');
    expect(coerce('')).toBe('');
  });

  it('leaves null and undefined alone', () => {
    expect(coerce(null)).toBe(null);
    expect(coerce(undefined)).toBe(undefined);
  });

  it('does not mangle strings that merely start with digits', () => {
    expect(coerce('4 Privet Drive')).toBe('4 Privet Drive');
  });
});

describe('formatValue', () => {
  it('renders an em dash for missing values', () => {
    expect(formatValue(null)).toBe('—');
    expect(formatValue(undefined)).toBe('—');
    expect(formatValue('')).toBe('—');
  });

  it('formats thousands with separators', () => {
    expect(formatValue(1234567, 'thousands')).toBe('1,234,567');
    expect(formatValue('1234567', 'thousands')).toBe('1,234,567');
  });

  it('formats fixed decimals', () => {
    expect(formatValue(3.14159, 'fixed2')).toBe('3.14');
    expect(formatValue('10', 'fixed1')).toBe('10.0');
  });

  it('formats a ratio as a percentage', () => {
    expect(formatValue(0.42, 'percent')).toBe('42%');
  });

  it('uppercases', () => {
    expect(formatValue('online', 'upper')).toBe('ONLINE');
  });

  it('formats dates and datetimes from ISO strings', () => {
    expect(formatValue('2026-09-08T06:06:00.000Z', 'date')).toBe('2026-09-08');
    expect(formatValue('2026-09-08T06:06:00.000Z', 'datetime')).toBe('2026-09-08 06:06');
  });

  it('returns the raw string when a date cannot be parsed', () => {
    expect(formatValue('not a date', 'date')).toBe('not a date');
  });

  it('appends a suffix', () => {
    expect(formatValue(15, 'number', ' cpm')).toBe('15 cpm');
  });

  it('does not append a suffix to a missing value', () => {
    expect(formatValue(null, 'number', ' cpm')).toBe('—');
  });
});
