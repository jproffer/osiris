import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderPopup } from '../popup';
import { validateManifest } from '../validate';
import type { PopupSpec } from '../types';

const MANIFEST_DIR = join(__dirname, '..', 'manifests');

function loadManifest(file: string) {
  const raw = JSON.parse(readFileSync(join(MANIFEST_DIR, file), 'utf8'));
  const result = validateManifest(raw, file);
  if (!result.ok) throw new Error(`${file} is invalid:\n  ${result.errors.join('\n  ')}`);
  return result.manifest;
}

function loadFixture(name: string): { properties: Record<string, unknown>; lngLat: [number, number] } {
  return JSON.parse(readFileSync(join(__dirname, `${name}.json`), 'utf8'));
}

/** Renders a layer's popup from its own manifest and its captured feature. */
function render(manifestFile: string, fixtureName: string): string {
  const manifest = loadManifest(manifestFile);
  const interaction = manifest.interaction;
  if (interaction?.kind !== 'popup') throw new Error(`${manifestFile} has no popup interaction`);
  const fixture = loadFixture(fixtureName);
  return renderPopup(interaction.popup as PopupSpec, fixture.properties,
                     { lng: fixture.lngLat[0], lat: fixture.lngLat[1] });
}

describe('earthquakes popup parity', () => {
  const html = render('10-earthquakes.json', 'earthquakes');
  const fixture = loadFixture('earthquakes');

  it('shows every label the old popup showed', () => {
    for (const label of ['DEPTH', 'COORDS']) expect(html).toContain(label);
  });

  it('shows the magnitude in the title, as M<mag> EARTHQUAKE', () => {
    expect(html).toContain(`M${fixture.properties.magnitude} EARTHQUAKE`);
  });

  it('shows the place', () => {
    expect(html).toContain(String(fixture.properties.place));
  });

  it('shows coordinates to three decimals', () => {
    expect(html).toContain(`${fixture.lngLat[1].toFixed(3)}, ${fixture.lngLat[0].toFixed(3)}`);
  });

  it('links to the USGS event page for a USGS-sourced quake', () => {
    expect(html).toContain(`eventpage/${fixture.properties.id}`);
    expect(html).toContain('USGS DETAILS');
  });

  it('matches its recorded shape', () => {
    expect(html).toMatchSnapshot();
  });
});

describe('fires popup parity', () => {
  const html = render('20-fires.json', 'fires');
  const fixture = loadFixture('fires');

  it('shows every label the old popup showed', () => {
    for (const label of ['BRIGHTNESS', 'COORDS']) expect(html).toContain(label);
  });

  it('keeps the fire glyph and heading', () => {
    expect(html).toContain('🔥');
    expect(html).toContain('ACTIVE FIRE DETECTED');
  });

  it('shows brightness in kelvin', () => {
    expect(html).toContain(`${fixture.properties.brightness}K`);
  });

  it('builds the FIRMS deep link at full coordinate precision', () => {
    expect(html).toContain('firms.modaps.eosdis.nasa.gov');
    expect(html).toContain(String(fixture.lngLat[0]));
  });

  it('matches its recorded shape', () => {
    expect(html).toMatchSnapshot();
  });
});
