import { describe, it, expect } from 'vitest';
import { htmlEsc, urlSafe, renderPopup } from './popup';
import type { PopupSpec } from './types';

describe('htmlEsc', () => {
  it('escapes every HTML-significant character', () => {
    expect(htmlEsc(`<script>"x"&'y'</script>`))
      .toBe('&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;');
  });

  it('renders null and undefined as empty', () => {
    expect(htmlEsc(null)).toBe('');
    expect(htmlEsc(undefined)).toBe('');
  });
});

describe('urlSafe', () => {
  it('passes http and https through', () => {
    expect(urlSafe('https://example.org/a')).toBe('https://example.org/a');
    expect(urlSafe('http://example.org')).toBe('http://example.org');
  });

  it('rejects javascript: and data: URLs', () => {
    expect(urlSafe('javascript:alert(1)')).toBe('#');
    expect(urlSafe('data:text/html,<script>alert(1)</script>')).toBe('#');
    expect(urlSafe('JaVaScRiPt:alert(1)')).toBe('#');
  });

  it('rejects missing values', () => {
    expect(urlSafe(null)).toBe('#');
    expect(urlSafe('')).toBe('#');
  });
});

describe('renderPopup', () => {
  const spec: PopupSpec = {
    accent: '#7E57C2',
    title: { property: 'place' },
    fields: [
      { label: 'READING', property: 'value', format: 'number', suffix: ' cpm' },
      { label: 'CAPTURED', property: 'captured', format: 'datetime' },
    ],
  };

  it('renders the title, labels and formatted values', () => {
    const html = renderPopup(spec, { place: 'Fukushima', value: '15', captured: '2026-09-08T06:06:00.000Z' });
    expect(html).toContain('Fukushima');
    expect(html).toContain('READING');
    expect(html).toContain('15 cpm');
    expect(html).toContain('CAPTURED');
    expect(html).toContain('2026-09-08 06:06');
  });

  it('applies the accent colour', () => {
    expect(renderPopup(spec, { place: 'X' })).toContain('#7E57C2');
  });

  it('escapes a hostile title from upstream data', () => {
    const html = renderPopup(spec, { place: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('escapes a hostile field value from upstream data', () => {
    const html = renderPopup(
      { ...spec, fields: [{ label: 'NAME', property: 'n' }] },
      { place: 'X', n: '</div><script>alert(1)</script>' },
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders a missing field as an em dash', () => {
    expect(renderPopup(spec, { place: 'X' })).toContain('—');
  });

  it('interpolates and URL-encodes link templates', () => {
    const withLink: PopupSpec = {
      ...spec,
      links: [{ label: 'SOURCE', url: 'https://example.org/s?q={place}' }],
    };
    const html = renderPopup(withLink, { place: 'a b&c' });
    expect(html).toContain('https://example.org/s?q=a%20b%26c');
    expect(html).toContain('SOURCE');
  });

  it('neutralises a javascript: URL arriving from a feature property', () => {
    const withLink: PopupSpec = { ...spec, links: [{ label: 'SOURCE', url: '{src}' }] };
    const html = renderPopup(withLink, { place: 'X', src: 'javascript:alert(1)' });
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="#"');
  });

  it('omits the links block entirely when there are none', () => {
    expect(renderPopup(spec, { place: 'X' })).not.toContain('<a ');
  });

  it('renders an optional subtitle only when present', () => {
    expect(renderPopup(spec, { place: 'X' })).not.toContain('subtitle');
    const withSub: PopupSpec = { ...spec, subtitle: { property: 'unit' } };
    expect(renderPopup(withSub, { place: 'X', unit: 'cpm' })).toContain('cpm');
  });
});
