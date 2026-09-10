import { NextResponse } from 'next/server';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — Maritime Piracy & Armed Robbery (IMB Piracy Reporting Centre)
 *
 * The public map at icc-ccs.org/map/ is a WP Google Maps Pro plugin, which
 * exposes its marker data as plain JSON through the plugin's own REST API —
 * no key, no scraping. The endpoint ignores the `map_id` filter and always
 * returns the full multi-year incident history, so recency is filtered here.
 */

const FEATURES_URL = 'https://icc-ccs.org/wp-json/wpgmza/v1/features';
const MAX_AGE_DAYS = 180;
const MAX_INCIDENTS = 500;

interface WpgmzaCustomField {
  name?: string;
  value?: string;
}

interface WpgmzaMarker {
  id: string;
  lat: string;
  lng: string;
  title?: string;
  custom_field_data?: WpgmzaCustomField[];
}

interface PiracyIncident {
  id: string;
  lat: number;
  lng: number;
  incidentNumber: string;
  date: string;
  sitrep: string;
}

function fieldValue(m: WpgmzaMarker, name: string): string {
  return m.custom_field_data?.find(f => f.name === name)?.value?.trim() || '';
}

async function fetchPiracyIncidents(): Promise<PiracyIncident[]> {
  const res = await fetch(FEATURES_URL, {
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': 'OSIRIS-Intelligence-Platform/3.5' },
  });
  if (!res.ok) throw new Error(`IMB map HTTP ${res.status}`);
  const data = await res.json();
  const markers: WpgmzaMarker[] = Array.isArray(data?.markers) ? data.markers : [];

  const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
  const incidents: PiracyIncident[] = [];
  for (const m of markers) {
    const lat = parseFloat(m.lat);
    const lng = parseFloat(m.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const dateStr = fieldValue(m, 'Date of Incident');
    const ts = dateStr ? Date.parse(dateStr) : NaN;
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    incidents.push({
      id: m.id,
      lat,
      lng,
      incidentNumber: fieldValue(m, 'Incident Number') || m.title || m.id,
      date: dateStr,
      sitrep: fieldValue(m, 'Sitrep:'),
    });
  }

  incidents.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return incidents.slice(0, MAX_INCIDENTS);
}

const getPiracy = cachedSource('piracy', fetchPiracyIncidents, 60 * 60 * 1000);

export async function GET() {
  try {
    const incidents = await getPiracy();
    return NextResponse.json({ incidents, total: incidents.length, timestamp: new Date().toISOString() }, {
      headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' },
    });
  } catch (error) {
    console.error('Piracy fetch error:', error);
    return NextResponse.json({ incidents: [], error: 'Failed to fetch piracy data' }, { status: 500 });
  }
}
