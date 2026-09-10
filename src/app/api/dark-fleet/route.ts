import { NextResponse } from 'next/server';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — Dark Fleet / AIS Gap Events (Global Fishing Watch)
 *
 * The `public-global-gaps-events` dataset is GFW's own model output: vessels
 * whose AIS transponder went silent for long enough, in a way inconsistent
 * with normal signal loss, that the gap itself is flagged as suspected
 * intentional disabling — the standard proxy for "dark fleet" behavior.
 * Requires a free non-commercial token from
 * https://globalfishingwatch.org/our-apis/tokens/signup.
 */

const EVENTS_URL = 'https://gateway.api.globalfishingwatch.org/v3/events';
const WINDOW_DAYS = 30;
const LIMIT = 500;

interface GfwEvent {
  id: string;
  position?: { lat?: number; lon?: number };
  start?: string;
  end?: string;
  vessel?: { name?: string; flag?: string; type?: string };
  gap?: { intentionalDisabling?: boolean; durationHours?: number; distanceKm?: string };
}

interface DarkFleetEvent {
  id: string;
  lat: number;
  lng: number;
  vesselName: string;
  flag: string;
  vesselType: string;
  start: string;
  end: string;
  durationHours: number;
  distanceKm: number;
}

async function fetchDarkFleetEvents(): Promise<DarkFleetEvent[]> {
  const apiKey = process.env.GFW_API_KEY;
  if (!apiKey) return [];

  const end = new Date();
  const start = new Date(end.getTime() - WINDOW_DAYS * 86400000);
  const params = new URLSearchParams({
    'datasets[0]': 'public-global-gaps-events:latest',
    limit: String(LIMIT),
    offset: '0',
    'start-date': start.toISOString().slice(0, 10),
    'end-date': end.toISOString().slice(0, 10),
  });

  const res = await fetch(`${EVENTS_URL}?${params}`, {
    signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`GFW events HTTP ${res.status}`);
  const data = await res.json();
  const entries: GfwEvent[] = Array.isArray(data?.entries) ? data.entries : [];

  const events: DarkFleetEvent[] = [];
  for (const e of entries) {
    const lat = e.position?.lat;
    const lng = e.position?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!e.gap?.intentionalDisabling) continue;
    events.push({
      id: e.id,
      lat: lat as number,
      lng: lng as number,
      vesselName: (e.vessel?.name || 'Unknown vessel').trim(),
      flag: e.vessel?.flag || '',
      vesselType: e.vessel?.type || '',
      start: e.start || '',
      end: e.end || '',
      durationHours: Math.round(e.gap?.durationHours || 0),
      distanceKm: Math.round(parseFloat(e.gap?.distanceKm || '0')),
    });
  }
  return events;
}

const getDarkFleet = cachedSource('dark-fleet', fetchDarkFleetEvents, 2 * 60 * 60 * 1000);

export async function GET() {
  try {
    const events = await getDarkFleet();
    return NextResponse.json({ events, total: events.length, timestamp: new Date().toISOString() }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
    });
  } catch (error) {
    console.error('Dark fleet fetch error:', error);
    return NextResponse.json({ events: [], error: 'Failed to fetch dark fleet data' }, { status: 500 });
  }
}
