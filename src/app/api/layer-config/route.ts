import { NextRequest, NextResponse } from 'next/server';
import { loadRegistry } from '@/lib/layers/registry';
import { serveDatasets } from '@/lib/layers/serve';
import { ADAPTERS } from '@/lib/layers/adapters';
import {
  configStatus, readConfigValue, writeConfigValue, deleteConfigValue,
} from '@/lib/layers/config-store';
import { safeFetch, getClientIp, isRateLimited } from '@/lib/ssrf-guard';

/** No path returns a stored value -- overwrite risk only; OSIRIS_ADMIN_TOKEN gates that. */

function unauthorised(request: NextRequest): boolean {
  const admin = process.env.OSIRIS_ADMIN_TOKEN;
  return !!admin && request.headers.get('x-osiris-admin') !== admin;
}

async function declaredKeys(): Promise<{ key: string; layerId: string }[]> {
  const registry = await loadRegistry();
  return registry.manifests.flatMap(m => m.requiredConfig.map(c => ({ key: c.key, layerId: m.id })));
}

export async function GET() {
  const registry = await loadRegistry();
  const out: Record<string, Record<string, { configured: boolean; source: 'env' | 'store' | null }>> = {};
  for (const m of registry.manifests) {
    if (m.requiredConfig.length === 0) continue;
    out[m.id] = await configStatus(m.requiredConfig.map(c => c.key));
  }
  return NextResponse.json({ layers: out }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  if (unauthorised(request)) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  if (isRateLimited(getClientIp(request), 10, 60_000)) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }

  let body: { key?: string; value?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid body' }, { status: 400 }); }
  const { key, value } = body;
  if (!key || typeof value !== 'string' || !value) {
    return NextResponse.json({ error: "need 'key' and a non-empty 'value'" }, { status: 400 });
  }

  const declared = await declaredKeys();
  const owner = declared.find(d => d.key === key);
  if (!owner) return NextResponse.json({ error: `no layer declares '${key}'` }, { status: 404 });

  if (process.env[key]) {
    return NextResponse.json(
      { error: `${key} is set by the environment and cannot be changed here`, source: 'env' },
      { status: 409 },
    );
  }

  await writeConfigValue(key, value);

  // Probe once so a mistyped token fails visibly now, rather than silently
  // producing an empty layer an hour later.
  const registry = await loadRegistry();
  const manifest = registry.manifests.find(m => m.id === owner.layerId)!;
  const probe = await serveDatasets(manifest, [manifest.datasets[0].key], undefined, {
    fetchText: async (url, headers) => {
      const res = await safeFetch(url, { headers, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    },
    readConfig: readConfigValue,
    adapters: ADAPTERS,
  });

  return NextResponse.json({
    stored: true,
    verified: probe.ok,
    ...(probe.ok ? {} : { error: probe.error }),
  });
}

export async function DELETE(request: NextRequest) {
  if (unauthorised(request)) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  const key = new URL(request.url).searchParams.get('key');
  if (!key) return NextResponse.json({ error: "missing 'key'" }, { status: 400 });
  await deleteConfigValue(key);
  return NextResponse.json({ deleted: true });
}
