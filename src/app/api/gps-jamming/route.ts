import { NextResponse } from 'next/server';
import { cellToLatLng } from 'h3-js';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — GPS/GNSS Interference (gpsjam.org)
 *
 * gpsjam.org derives daily GPS jamming from ADS-B Exchange aircraft reports:
 * each aircraft's broadcast position quality flags whether its GPS looked
 * degraded that day. The result is published as one CSV per day, keyed by
 * resolution-4 H3 cell (~1,770 km² each) — `{good, bad}` aircraft counts per
 * cell, no API key. See https://github.com/guofengji/gpsjam.org.
 */

const DATE_FMT = (d: Date) => d.toISOString().slice(0, 10);

interface JamCell {
  lat: number;
  lng: number;
  goodAircraft: number;
  badAircraft: number;
  badRatio: number;
}

function parseCsv(text: string): JamCell[] {
  const lines = text.trim().split('\n');
  const cells: JamCell[] = [];
  // header: hex,count_good_aircraft,count_bad_aircraft
  for (let i = 1; i < lines.length; i++) {
    const [hex, goodStr, badStr] = lines[i].split(',');
    if (!hex) continue;
    const good = parseInt(goodStr, 10) || 0;
    const bad = parseInt(badStr, 10) || 0;
    const total = good + bad;
    if (total < 3) continue;
    const badRatio = bad / total;
    // 92% of the global grid reports zero interference at any given time —
    // this layer is meant to show jamming, not "an aircraft flew over here",
    // so cells with only stray bad reports are dropped rather than rendered
    // as 40,000+ near-invisible dots.
    if (badRatio <= 0.05) continue;
    const [lat, lng] = cellToLatLng(hex);
    cells.push({ lat, lng, goodAircraft: good, badAircraft: bad, badRatio });
  }
  return cells;
}

async function fetchLatestJamming(): Promise<JamCell[]> {
  // "Today" is usually 404 until the daily batch finishes, so try today then
  // fall back a day at a time — gpsjam.org itself does the same on load.
  const now = new Date();
  for (let back = 0; back < 3; back++) {
    const d = new Date(now.getTime() - back * 86400000);
    const url = `https://gpsjam.org/data/${DATE_FMT(d)}-h3_4.csv`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const text = await res.text();
      const cells = parseCsv(text);
      if (cells.length > 0) return cells;
    } catch { continue; }
  }
  return [];
}

const getJamming = cachedSource('gps-jamming', fetchLatestJamming, 3 * 60 * 60 * 1000);

export async function GET() {
  try {
    const cells = await getJamming();
    return NextResponse.json({ cells, total: cells.length, timestamp: new Date().toISOString() }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
    });
  } catch (error) {
    console.error('GPS jamming fetch error:', error);
    return NextResponse.json({ cells: [], error: 'Failed to fetch GPS jamming data' }, { status: 500 });
  }
}
