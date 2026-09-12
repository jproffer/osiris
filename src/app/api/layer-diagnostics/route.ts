import { NextRequest, NextResponse } from 'next/server';
import { loadRegistry } from '@/lib/layers/registry';
import { recent } from '@/lib/layers/request-log';

/** Same admin rule as the other administrative routes: open unless a token is set. */
function unauthorised(request: NextRequest): boolean {
  const admin = process.env.OSIRIS_ADMIN_TOKEN;
  return !!admin && request.headers.get('x-osiris-admin') !== admin;
}

export async function GET(request: NextRequest) {
  if (unauthorised(request)) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  const registry = await loadRegistry();
  return NextResponse.json(
    {
      registry: {
        count: registry.manifests.length,
        loadedAt: registry.loadedAt,
        layers: registry.manifests.map(m => ({ id: m.id, group: m.group, label: m.label })),
        errors: registry.errors,
      },
      requests: recent(100).map(({ error, ...rest }) => rest),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
