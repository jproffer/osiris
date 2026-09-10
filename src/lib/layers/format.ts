import type { Format } from './types';

/** MapLibre serialises properties, so booleans/numbers arrive as strings -- handled once, here. */
export function coerce(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  // Only a string that is *entirely* a number becomes one. "4 Privet Drive"
  // is an address, not the number four.
  if (v !== '' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return v;
}

const MISSING = '—';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatValue(v: unknown, format: Format = 'text', suffix = ''): string {
  const value = coerce(v);
  if (value === null || value === undefined || value === '') return MISSING;

  let out: string;
  switch (format) {
    case 'thousands': {
      const n = Number(value);
      out = Number.isFinite(n) ? n.toLocaleString('en-US') : String(value);
      break;
    }
    case 'number': {
      const n = Number(value);
      out = Number.isFinite(n) ? String(n) : String(value);
      break;
    }
    case 'fixed1':
    case 'fixed2':
    case 'fixed3': {
      const digits = Number(format.slice(-1));
      const n = Number(value);
      out = Number.isFinite(n) ? n.toFixed(digits) : String(value);
      break;
    }
    case 'percent': {
      const n = Number(value);
      out = Number.isFinite(n) ? `${Math.round(n * 100)}%` : String(value);
      break;
    }
    case 'date':
    case 'datetime': {
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) { out = String(value); break; }
      const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
      out = format === 'date' ? day : `${day} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
      break;
    }
    case 'upper':
      out = String(value).toUpperCase();
      break;
    default:
      out = String(value);
  }
  return suffix ? `${out}${suffix}` : out;
}
