import { NextResponse } from 'next/server';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — US Power Outages (ODIN — Outage Data Initiative Nationwide)
 *
 * DOE/Oak Ridge National Laboratory's near-real-time, county-level outage
 * feed, standard OpenDataSoft REST, no key. poweroutage.us covers more
 * utilities but is a paid product; ODIN is the free, government-backed
 * equivalent. https://ornl.opendatasoft.com/explore/dataset/odin-real-time-outages-county/
 */

const ODIN_URL = 'https://ornl.opendatasoft.com/api/records/1.0/search/?dataset=odin-real-time-outages-county&rows=1000';

interface OdinRecord {
  fields?: {
    geo_point_2d?: [number, number];
    county?: string;
    state?: string;
    name?: string;
    metersaffected?: number;
    reportedstarttime?: string;
    estimatedrestorationtime?: string;
    statuskind?: string;
  };
}

interface PowerOutage {
  id: string;
  lat: number;
  lng: number;
  county: string;
  state: string;
  utility: string;
  customersAffected: number;
  reportedStart: string;
  estimatedRestoration: string;
  status: string;
}

/** ODIN reports this as a JSON-encoded string, `{"ert": "2026-...Z"}`, not a plain date. */
function parseRestorationTime(raw?: string): string {
  if (!raw) return '';
  try {
    return JSON.parse(raw)?.ert || '';
  } catch {
    return raw;
  }
}

async function fetchPowerOutages(): Promise<PowerOutage[]> {
  const res = await fetch(ODIN_URL, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`ODIN HTTP ${res.status}`);
  const data = await res.json();
  const records: OdinRecord[] = Array.isArray(data?.records) ? data.records : [];

  const outages: PowerOutage[] = [];
  records.forEach((rec, i) => {
    const f = rec.fields;
    const point = f?.geo_point_2d;
    if (!f || !point || point.length !== 2) return;
    const [lat, lng] = point;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    outages.push({
      id: `odin-${i}`,
      lat,
      lng,
      county: f.county || 'Unknown County',
      state: f.state || '',
      utility: (f.name || 'Unknown utility').split(',')[0],
      customersAffected: f.metersaffected || 0,
      reportedStart: f.reportedstarttime || '',
      estimatedRestoration: parseRestorationTime(f.estimatedrestorationtime),
      status: f.statuskind || '',
    });
  });

  return outages;
}

const getPowerOutages = cachedSource('power-outages', fetchPowerOutages, 10 * 60 * 1000);

export async function GET() {
  try {
    const outages = await getPowerOutages();
    return NextResponse.json({ outages, total: outages.length, timestamp: new Date().toISOString() }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (error) {
    console.error('Power outage fetch error:', error);
    return NextResponse.json({ outages: [], error: 'Failed to fetch power outage data' }, { status: 500 });
  }
}
