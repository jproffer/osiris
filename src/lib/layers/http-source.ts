import type { GeoFeature } from './types';

/** Dot-path accessor: 'gap.distanceKm', 'a.0.b'. Never throws. */
export function getPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Split one CSV line, honouring double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim() !== '');
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    header.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    return row;
  });
}

export function extractRows(
  format: 'json' | 'geojson' | 'csv',
  text: string,
  arrayPath?: string,
): unknown[] {
  if (format === 'csv') return parseCsv(text);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return []; }

  if (format === 'geojson') {
    const features = (parsed as { features?: unknown })?.features;
    return Array.isArray(features) ? features : [];
  }
  const target = arrayPath ? getPath(parsed, arrayPath) : parsed;
  return Array.isArray(target) ? target : [];
}

function asCoord(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function rowsToFeatures(
  rows: unknown[],
  opts: { lat: string; lng: string; properties: Record<string, string>; passthroughGeometry?: boolean },
): GeoFeature[] {
  const out: GeoFeature[] = [];

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;

    const properties: Record<string, unknown> = {};
    const propSource = opts.passthroughGeometry
      ? ((row as { properties?: unknown }).properties ?? row)
      : row;
    for (const [name, path] of Object.entries(opts.properties)) {
      properties[name] = getPath(propSource, path);
    }

    if (opts.passthroughGeometry) {
      const geometry = (row as { geometry?: unknown }).geometry;
      if (!geometry || typeof geometry !== 'object') continue;
      out.push({ type: 'Feature', geometry: geometry as GeoFeature['geometry'], properties });
      continue;
    }

    const lat = asCoord(getPath(row, opts.lat));
    const lng = asCoord(getPath(row, opts.lng));
    // A row without usable coordinates is dropped. Emitting it at 0,0 would
    // pile every unparseable record into the Gulf of Guinea.
    if (lat === null || lng === null) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;

    out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties });
  }

  return out;
}
