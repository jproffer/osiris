import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { loadRegistry, reloadRegistry } from '@/lib/layers/registry';
import { serveDatasets } from '@/lib/layers/serve';
import { ADAPTERS } from '@/lib/layers/adapters';
import { readConfigValue } from '@/lib/layers/config-store';
import { safeFetch, getClientIp, isRateLimited } from '@/lib/ssrf-guard';
import { cachedSource } from '@/lib/sourceCache';
import { record } from '@/lib/layers/request-log';

/** Browser sends a layer id, never a URL -- stops an open instance being used as a fetch proxy. */

/** cachedSource caches arrays, so a response body rides as [text] -- free TTL, dedup, stale-on-error. */
const fetchers = new Map<string, () => Promise<string[]>>();

function textFetcher(url: string, headers: Record<string, string>, ttlMs: number) {
  // Hash the headers into the key -- they may carry a credential, and cachedSource logs the key on failure.
  const headerHash = createHash('sha256').update(JSON.stringify(headers)).digest('hex').slice(0, 16);
  const key = `layer-source:${url}|${headerHash}`;
  let fetcher = fetchers.get(key);
  if (!fetcher) {
    fetcher = cachedSource<string>(key, async () => {
      const res = await safeFetch(url, { headers, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return [await res.text()];
    }, ttlMs);
    fetchers.set(key, fetcher);
  }
  return fetcher;
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (isRateLimited(ip, 120, 60_000)) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const layerId = searchParams.get('layer');
  if (!layerId) return NextResponse.json({ error: "missing 'layer'" }, { status: 400 });

  const registry = await loadRegistry();
  const manifest = registry.manifests.find(m => m.id === layerId);
  if (!manifest) return NextResponse.json({ error: `unknown layer '${layerId}'` }, { status: 404 });

  const requested = (searchParams.get('datasets') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const datasetKeys = requested.length > 0 ? requested : manifest.datasets.map(d => d.key);

  const bboxRaw = searchParams.get('bbox');
  let bbox: { west: number; south: number; east: number; north: number } | undefined;
  if (bboxRaw) {
    const parts = bboxRaw.split(',').map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      bbox = { west: parts[0], south: parts[1], east: parts[2], north: parts[3] };
    }
  }

  const started = Date.now();
  const result = await serveDatasets(manifest, datasetKeys, bbox, {
    fetchText: async (url, headers, ttlMs) => {
      const [text] = await textFetcher(url, headers, ttlMs)();
      // cachedSource swallows a first failure to []; rethrow so serveDatasets reports it, not a silent empty success.
      if (text === undefined) throw new Error(`upstream fetch failed for ${url}`);
      return text;
    },
    readConfig: readConfigValue,
    adapters: ADAPTERS,
  });

  const body = result.ok
    ? { datasets: result.datasets }
    : { error: result.error, ...(result.needsConfig ? { needsConfig: result.needsConfig } : {}) };
  const json = JSON.stringify(body);

  record({
    layer: layerId,
    datasets: datasetKeys,
    status: result.ok ? 200 : result.status,
    ms: Date.now() - started,
    bytes: json.length,
    ...(result.ok ? {} : { error: result.error }),
  });

  return new NextResponse(json, {
    status: result.ok ? 200 : result.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** Re-scan the manifest directories, so a dropped-in layer needs no restart. */
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('reload') !== '1') {
    return NextResponse.json({ error: 'unsupported' }, { status: 400 });
  }
  const admin = process.env.OSIRIS_ADMIN_TOKEN;
  if (admin && request.headers.get('x-osiris-admin') !== admin) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }
  const registry = await reloadRegistry();
  fetchers.clear();
  return NextResponse.json({
    layers: registry.manifests.map(m => m.id),
    errors: registry.errors,
    loadedAt: registry.loadedAt,
  });
}
