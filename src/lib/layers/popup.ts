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
const BADGE = `font-size:8px;padding:2px 6px;border-radius:3px;font-weight:700;letter-spacing:0.1em;white-space:nowrap;`;

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

  const glyph = spec.glyph ? resolveValue(spec.glyph, props) : '';
  const columns = spec.columns === 1 ? '1fr' : '1fr 1fr';

  let badge = '';
  if (spec.badge && (!spec.badge.when || evaluate(spec.badge.when, props))) {
    const text = resolveValue(spec.badge.value, props);
    const colour = spec.badge.color ? resolveColor(spec.badge.color, props, accent) : accent;
    badge = `<span style="${BADGE}background:${colour}20;color:${colour};border:1px solid ${colour}50;">` +
            `${htmlEsc(text)}</span>`;
  }

  let body = '';
  if (spec.body) {
    const text = resolveValue(spec.body.value, props);
    const cap = spec.body.maxHeight ? `max-height:${spec.body.maxHeight}px;overflow-y:auto;` : '';
    body = `<div style="color:#9B978E;font-size:10px;line-height:1.6;margin-bottom:8px;${cap}">` +
           `${htmlEsc(text)}</div>`;
  }

  return `<div style="${SHELL}border:1px solid ${accent}66;min-width:230px;">` +
    `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">` +
      `<span style="color:${accent};font-size:12px;font-weight:700;letter-spacing:0.08em;">` +
        `${glyph ? `${htmlEsc(glyph)} ` : ''}${htmlEsc(title)}</span>` +
      badge +
    `</div>` +
    (subtitle ? `<div style="color:#5C5A54;font-size:9px;margin-bottom:8px;">${htmlEsc(subtitle)}</div>` : '') +
    body +
    (fields ? `<div style="display:grid;grid-template-columns:${columns};gap:6px;font-size:9px;">${fields}</div>` : '') +
    links +
    `</div>`;
}
