import { NextResponse } from 'next/server';
import { loadRegistry } from '@/lib/layers/registry';
import { toClientManifest } from '@/lib/layers/client-manifest';

/** The browser's only view of a manifest -- credential-stripped, see client-manifest.ts. */
export async function GET() {
  const registry = await loadRegistry();
  return NextResponse.json(
    {
      manifests: registry.manifests.map(toClientManifest),
      errors: registry.errors,
      loadedAt: registry.loadedAt,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
