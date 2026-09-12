import type { ValueSpec } from './types';
import { coerce } from './format';

/** Range stops evaluate highest-first, as written -- matches how thresholds are spoken about ("350+ is danger"). */
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

  if ('template' in spec) {
    return spec.template.replace(/\{(\$?\w+)\}/g, (_m, key: string) => {
      const v = props[key];
      return v === null || v === undefined ? '' : String(v);
    });
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

export interface PopupCtx { lng: number; lat: number }

/**
 * Popups display coordinates rounded to three decimals but link with full
 * precision, so both are injected. The $ prefix keeps them clear of a genuine
 * upstream property named `lat`.
 */
export function withCoords(
  props: Record<string, unknown>,
  ctx: PopupCtx | undefined,
): Record<string, unknown> {
  if (!ctx) return props;
  return {
    ...props,
    $lng: ctx.lng,
    $lat: ctx.lat,
    $lng3: ctx.lng.toFixed(3),
    $lat3: ctx.lat.toFixed(3),
  };
}
