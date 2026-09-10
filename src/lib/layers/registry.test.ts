import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setManifestDirs, loadRegistry, reloadRegistry } from './registry';

let root: string, builtin: string, dropin: string;

const manifest = (id: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  id, label: id, group: 'HAZARD',
  source: { kind: 'http', format: 'json', url: 'https://example.org/x', lat: 'lat', lng: 'lng', properties: {}, refresh: { mode: 'once' } },
  layers: [{ suffix: 'dots', type: 'circle' }],
  ...extra,
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'osiris-reg-'));
  builtin = join(root, 'builtin');
  dropin = join(root, 'dropin');
  await mkdir(builtin, { recursive: true });
  setManifestDirs(builtin, dropin);
});

afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('registry', () => {
  it('loads built-in manifests', async () => {
    await writeFile(join(builtin, 'radiation.json'), manifest('radiation'));
    const r = await reloadRegistry();
    expect(r.manifests.map(m => m.id)).toEqual(['radiation']);
    expect(r.errors).toEqual([]);
  });

  it('treats a missing drop-in directory as normal', async () => {
    await writeFile(join(builtin, 'radiation.json'), manifest('radiation'));
    const r = await reloadRegistry();
    expect(r.errors).toEqual([]);
    expect(r.manifests).toHaveLength(1);
  });

  it('adds drop-in manifests alongside built-ins', async () => {
    await writeFile(join(builtin, 'radiation.json'), manifest('radiation'));
    await mkdir(dropin, { recursive: true });
    await writeFile(join(dropin, 'custom.json'), manifest('custom'));
    const r = await reloadRegistry();
    expect(r.manifests.map(m => m.id).sort()).toEqual(['custom', 'radiation']);
  });

  it('lets a drop-in override a built-in of the same id', async () => {
    await writeFile(join(builtin, 'radiation.json'), manifest('radiation', { label: 'Shipped' }));
    await mkdir(dropin, { recursive: true });
    await writeFile(join(dropin, 'radiation.json'), manifest('radiation', { label: 'Overridden' }));
    const r = await reloadRegistry();
    expect(r.manifests).toHaveLength(1);
    expect(r.manifests[0].label).toBe('Overridden');
  });

  it('reports a malformed manifest by filename and keeps the valid ones', async () => {
    await writeFile(join(builtin, 'good.json'), manifest('good'));
    await writeFile(join(builtin, 'bad.json'), '{ not valid json');
    const r = await reloadRegistry();
    expect(r.manifests.map(m => m.id)).toEqual(['good']);
    expect(r.errors.join(' ')).toContain('bad.json');
  });

  it('reports a manifest that fails validation, naming the fault', async () => {
    await writeFile(join(builtin, 'bad.json'), JSON.stringify({ id: 'x', label: 'X', group: 'G' }));
    const r = await reloadRegistry();
    expect(r.manifests).toEqual([]);
    expect(r.errors.join(' ')).toContain('bad.json');
    expect(r.errors.join(' ')).toContain('datasets');
  });

  it('ignores non-JSON files', async () => {
    await writeFile(join(builtin, 'radiation.json'), manifest('radiation'));
    await writeFile(join(builtin, 'README.md'), '# not a manifest');
    const r = await reloadRegistry();
    expect(r.manifests).toHaveLength(1);
    expect(r.errors).toEqual([]);
  });

  it('caches, and reload picks up a newly dropped file', async () => {
    await writeFile(join(builtin, 'radiation.json'), manifest('radiation'));
    const first = await loadRegistry();
    await mkdir(dropin, { recursive: true });
    await writeFile(join(dropin, 'late.json'), manifest('late'));
    expect((await loadRegistry()).manifests).toHaveLength(first.manifests.length);
    expect((await reloadRegistry()).manifests.map(m => m.id).sort()).toEqual(['late', 'radiation']);
  });
});
