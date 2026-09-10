import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { loadRegistry, reloadRegistry } from '@/lib/layers/registry';
import { serveDatasets } from '@/lib/layers/serve';
import { ADAPTERS } from '@/lib/layers/adapters';
import { readConfigValue } from '@/lib/layers/config-store';
import { safeFetch, getClientIp, isRateLimited } from '@/lib/ssrf-guard';
import { cachedSource } from '@/lib/sourceCache';

/**
 * The browser never sends an upstream URL -- it sends a layer id, and this
 * route resolves id -> manifest -> URL. That is what stops an unauthenticated
 * instance being usable as an open fetch proxy: the reachable host set is
 * exactly what the operator installed.
 */

/**
 * cachedSource caches arrays (it was written for camera indexes), so a
 * response body rides as [text]. That buys TTL, in-flight dedup and
 * stale-on-error for free -- and the dedup is what makes two datasets
 * sharing a URL cost one upstream request.
 */
const fetchers = new Map<string, () => Promise<string[]>>();

function textFetcher(url: string, headers: Record<string, string>, ttlMs: number) {
  // Headers can carry a real credential after substitution, and cachedSource
  // logs this key verbatim on a fetch failure -- so the key carries a hash of
  // the headers, never the headers themselves, while still uniquely
  // identifying the url+headers pair for caching purposes.
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

  const result = await serveDatasets(manifest, datasetKeys, bbox, {
    fetchText: async (url, headers, ttlMs) => {
      const [text] = await textFetcher(url, headers, ttlMs)();
      // cachedSource resolves to [] (not a rejection) on a first-ever fetch
      // failure with nothing to fall back on -- so `text` is undefined here.
      // Throwing turns that back into a failure serveDatasets' catch block
      // can see, rather than a silent 200 with zero features.
      if (text === undefined) throw new Error(`upstream fetch failed for ${url}`);
      return text;
    },
    readConfig: readConfigValue,
    adapters: ADAPTERS,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.needsConfig ? { needsConfig: result.needsConfig } : {}) },
      { status: result.status },
    );
  }

  return NextResponse.json({ datasets: result.datasets }, {
    headers: { 'Cache-Control': 'no-store' },
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
