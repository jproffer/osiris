import type { PopupSpec } from './types';
import { resolveValue, resolveColor, withCoords, type PopupCtx } from './values';
import { formatValue } from './format';
import { evaluate } from './condition';

/** The single escaping path -- was per-handler discipline before, and a third of OsirisMap's handlers skipped it. */
export function htmlEsc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function urlSafe(s: unknown): string {
  const u = String(s ?? '');
  return /^https?:\/\//i.test(u) ? u : '#';
}

const SHELL = `background:rgba(12,14,26,0.95);backdrop-filter:blur(16px);border-radius:10px;padding:16px;font-family:'JetBrains Mono',monospace;`;
const LINK = `display:inline-block;margin-top:8px;margin-right:4px;padding:5px 12px;font-size:10px;letter-spacing:0.12em;text-decoration:none;border-radius:5px;font-family:'JetBrains Mono',monospace;`;

/** Expand {property} placeholders, URL-encoding each substituted value. */
function interpolate(template: string, props: Record<string, unknown>): string {
  return template.replace(/\{(\$?\w+)\}/g, (_m, key: string) => {
    const v = props[key];
    return v === null || v === undefined ? '' : encodeURIComponent(String(v));
  });
}

export function renderPopup(
  spec: PopupSpec,
  rawProps: Record<string, unknown>,
  ctx?: PopupCtx,
): string {
  const props = withCoords(rawProps, ctx);
  const accent = resolveColor(spec.accent, props);
  const title = resolveValue(spec.title, props);
  const subtitle = spec.subtitle ? resolveValue(spec.subtitle, props) : null;

  const fields = spec.fields
    .filter(f => !f.when || evaluate(f.when, props))
    .map(f => {
      const raw = f.value ? resolveValue(f.value, props) : props[f.property ?? ''];
      const value = formatValue(raw, f.format, f.suffix ?? '');
      const colour = f.color ? resolveColor(f.color, props, '#E8E6E0') : '#E8E6E0';
      return `<div><span style="color:#5C5A54;font-size:9px;">${htmlEsc(f.label)}</span><br/>` +
             `<span style="color:${colour};">${htmlEsc(value)}</span></div>`;
    }).join('');

  const links = (spec.links ?? [])
    .filter(l => !l.when || evaluate(l.when, props))
    .map(l => {
      // A bare {prop} yields the raw value (what weather-dots got wrong) -- still scheme-checked either way.
      const raw = /^\{(\$?\w+)\}$/.test(l.url)
        ? String(props[l.url.slice(1, -1)] ?? '')
        : interpolate(l.url, props);
      const href = urlSafe(raw);
      return `<a href="${htmlEsc(href)}" target="_blank" rel="noopener noreferrer" ` +
             `style="${LINK}color:${accent};border:1px solid ${accent}66;background:${accent}1a;">` +
             `${htmlEsc(l.label)}</a>`;
    }).join('');

  return `<div style="${SHELL}border:1px solid ${htmlEsc(accent)}66;min-width:230px;">` +
    `<div style="color:${htmlEsc(accent)};font-size:12px;font-weight:700;letter-spacing:0.08em;margin-bottom:6px;">${htmlEsc(title)}</div>` +
    (subtitle ? `<div style="color:#5C5A54;font-size:9px;margin-bottom:8px;">${htmlEsc(subtitle)}</div>` : '') +
    (fields ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:9px;">${fields}</div>` : '') +
    links +
    `</div>`;
}
