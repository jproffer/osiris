import type { ValueSpec } from './types';
import { coerce } from './format';

/**
 * Resolve a ValueSpec against a feature's properties.
 *
 * Range stops are evaluated in the order written, so a manifest lists them
 * highest-first. That reads the way the thresholds are spoken about ("350 and
 * above is danger, 100 and above is elevated") rather than requiring the
 * author to remember a sort order.
 */
export function resolveValue(spec: ValueSpec, props: Record<string, unknown>): string {
  if (typeof spec === 'string') return spec;

  if ('property' in spec) {
    const v = props[spec.property];
    return v === null || v === undefined || v === '' ? '—' : String(v);
  }

  if ('match' in spec) {
    const { property, cases, fallback, mode = 'equals' } = spec.match;
    const raw = props[property];
    if (raw === null || raw === undefined) return fallback;
    const asString = String(coerce(raw));
    if (mode === 'contains') {
      for (const [needle, out] of Object.entries(cases)) {
        if (asString.includes(needle)) return out;
      }
      return fallback;
    }
    return Object.prototype.hasOwnProperty.call(cases, asString) ? cases[asString] : fallback;
  }

  const { property, stops, fallback } = spec.range;
  const raw = coerce(props[property]);
  // Number(null) is 0 -- without this guard a missing property would be
  // bucketed as if it were the value zero instead of falling through.
  if (raw === null || raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  for (const [threshold, out] of stops) {
    if (n >= threshold) return out;
  }
  return fallback;
}
