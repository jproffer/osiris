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

describe('conditional fields and links', () => {
  const base = { accent: '#FF9500', title: 'T' };

  it('omits a field whose condition fails', () => {
    const spec = {
      ...base,
      fields: [
        { label: 'CAUSE', property: 'cause' },
        { label: 'ENDED', property: 'end', when: { property: 'end', exists: true } },
      ],
    };
    expect(renderPopup(spec, { cause: 'cable cut' })).not.toContain('ENDED');
    expect(renderPopup(spec, { cause: 'cable cut', end: '2026-01-01' })).toContain('ENDED');
  });

  it('omits a link whose condition fails, and keeps the one that passes', () => {
    const spec = {
      ...base,
      fields: [],
      links: [
        { label: 'USGS DETAILS', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/{id}',
          when: { property: 'source', equals: 'NIGGG-BAS', not: true } },
        { label: 'NIGGG-BAS', url: 'https://ndc.niggg.bas.bg/',
          when: { property: 'source', equals: 'NIGGG-BAS' } },
      ],
    };
    const usgs = renderPopup(spec, { id: 'us7000', source: 'us' });
    expect(usgs).toContain('USGS DETAILS');
    expect(usgs).toContain('eventpage/us7000');
    expect(usgs).not.toContain('NIGGG-BAS');

    const bas = renderPopup(spec, { id: 'x', source: 'NIGGG-BAS' });
    expect(bas).toContain('ndc.niggg.bas.bg');
    expect(bas).not.toContain('USGS DETAILS');
  });

  it('renders a derived field value', () => {
    const spec = {
      ...base,
      fields: [{
        label: 'SEVERITY',
        value: { range: { property: 'severity', stops: [[8, 'CRITICAL'], [6, 'HIGH']] as [number, string][], fallback: 'MEDIUM' } },
      }],
    };
    expect(renderPopup(spec, { severity: 9 })).toContain('CRITICAL');
    expect(renderPopup(spec, { severity: 7 })).toContain('HIGH');
    expect(renderPopup(spec, { severity: 2 })).toContain('MEDIUM');
  });

  it('colours a field from its own spec', () => {
    const spec = {
      ...base,
      fields: [{
        label: 'VERT RATE', property: 'verticalRate', format: 'fixed1' as const, suffix: ' m/s',
        color: { range: { property: 'verticalRate', stops: [[0, '#00E676']] as [number, string][], fallback: '#FF3D3D' } },
      }],
    };
    expect(renderPopup(spec, { verticalRate: 2.5 })).toContain('#00E676');
    expect(renderPopup(spec, { verticalRate: -1.2 })).toContain('#FF3D3D');
  });

  it('exposes coordinates to fields and links', () => {
    const spec = {
      ...base,
      fields: [{ label: 'COORDS', value: { template: '{$lat3}, {$lng3}' } }],
      links: [{ label: 'FIRMS', url: 'https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@{$lng},{$lat},10z' }],
    };
    const html = renderPopup(spec, {}, { lng: 142.369, lat: 38.2971234 });
    expect(html).toContain('38.297, 142.369');
    expect(html).toContain('142.369');
  });

  it('still escapes every value', () => {
    const spec = { ...base, title: { property: 'name' }, fields: [{ label: 'X', property: 'x' }] };
    const html = renderPopup(spec, { name: '<img src=x onerror=1>', x: '"><script>' });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img');
  });

  describe('presentation hints', () => {
    const base = { accent: '#FF9500', title: 'FIRE', fields: [] };

    it('prefixes a static glyph', () => {
      expect(renderPopup({ ...base, glyph: '🔥' }, {})).toContain('🔥');
    });

    // weather-dots picks its emoji from the event type, so glyph is a ValueSpec.
    it('derives a glyph from a property', () => {
      const spec = {
        ...base,
        glyph: { match: { property: 'icon', cases: { cyclone: '🌀', volcano: '🌋' }, fallback: '⚡' } },
      };
      expect(renderPopup(spec, { icon: 'cyclone' })).toContain('🌀');
      expect(renderPopup(spec, { icon: 'volcano' })).toContain('🌋');
      expect(renderPopup(spec, { icon: 'hail' })).toContain('⚡');
    });

    it('renders one column when asked', () => {
      expect(renderPopup({ ...base, columns: 1, fields: [{ label: 'A', property: 'a' }] }, { a: 1 }))
        .toContain('grid-template-columns:1fr;');
      expect(renderPopup({ ...base, fields: [{ label: 'A', property: 'a' }] }, { a: 1 }))
        .toContain('grid-template-columns:1fr 1fr;');
    });

    it('renders a scrollable body', () => {
      const spec = { ...base, body: { value: { property: 'sitrep' }, maxHeight: 120 } };
      const html = renderPopup(spec, { sitrep: 'Armed men boarded the vessel.' });
      expect(html).toContain('Armed men boarded the vessel.');
      expect(html).toContain('max-height:120px');
      expect(html).toContain('overflow-y:auto');
    });

    it('escapes body text', () => {
      const spec = { ...base, body: { value: { property: 'sitrep' } } };
      expect(renderPopup(spec, { sitrep: '<script>x</script>' })).not.toContain('<script>');
    });

    it('renders a badge, defaulting its colour to the accent', () => {
      const spec = {
        ...base,
        badge: { value: { range: { property: 'severity', stops: [[8, 'CRITICAL']] as [number, string][], fallback: 'MEDIUM' } } },
      };
      const html = renderPopup(spec, { severity: 9 });
      expect(html).toContain('CRITICAL');
      expect(html).toContain('#FF9500');
    });

    it('colours a badge independently', () => {
      const spec = { ...base, badge: { value: 'HIGH', color: '#FF1744' } };
      expect(renderPopup(spec, {})).toContain('#FF1744');
    });

    it('omits a badge whose condition fails', () => {
      const spec = { ...base, badge: { value: 'LIVE', when: { property: 'ongoing', truthy: true } } };
      expect(renderPopup(spec, { ongoing: 'false' })).not.toContain('LIVE');
      expect(renderPopup(spec, { ongoing: 'true' })).toContain('LIVE');
    });
  });
});
