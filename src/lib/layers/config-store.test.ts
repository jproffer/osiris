import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setConfigDir, readConfigValue, writeConfigValue, deleteConfigValue, configStatus } from './config-store';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'osiris-cfg-'));
  setConfigDir(dir);
  delete process.env.TEST_LAYER_KEY;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.TEST_LAYER_KEY;
});

describe('config-store', () => {
  it('returns undefined for an unset key', async () => {
    expect(await readConfigValue('TEST_LAYER_KEY')).toBeUndefined();
  });

  it('round-trips a written value', async () => {
    await writeConfigValue('TEST_LAYER_KEY', 'abc123');
    expect(await readConfigValue('TEST_LAYER_KEY')).toBe('abc123');
  });

  it('lets the environment win over a stored value', async () => {
    await writeConfigValue('TEST_LAYER_KEY', 'from-store');
    process.env.TEST_LAYER_KEY = 'from-env';
    expect(await readConfigValue('TEST_LAYER_KEY')).toBe('from-env');
  });

  it('deletes a stored value', async () => {
    await writeConfigValue('TEST_LAYER_KEY', 'abc123');
    await deleteConfigValue('TEST_LAYER_KEY');
    expect(await readConfigValue('TEST_LAYER_KEY')).toBeUndefined();
  });

  it('reports status without ever revealing a value', async () => {
    await writeConfigValue('TEST_LAYER_KEY', 'super-secret');
    const status = await configStatus(['TEST_LAYER_KEY', 'ABSENT_KEY']);
    expect(status.TEST_LAYER_KEY).toEqual({ configured: true, source: 'store' });
    expect(status.ABSENT_KEY).toEqual({ configured: false, source: null });
    expect(JSON.stringify(status)).not.toContain('super-secret');
  });

  it('reports env as the source when the environment supplies the value', async () => {
    process.env.TEST_LAYER_KEY = 'from-env';
    const status = await configStatus(['TEST_LAYER_KEY']);
    expect(status.TEST_LAYER_KEY).toEqual({ configured: true, source: 'env' });
  });

  it('writes the store file with owner-only permissions', async () => {
    await writeConfigValue('TEST_LAYER_KEY', 'abc123');
    const { stat } = await import('node:fs/promises');
    const s = await stat(join(dir, 'layer-config.json'));
    expect(s.mode & 0o777).toBe(0o600);
  });

  it('survives a corrupt store file rather than throwing', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'layer-config.json'), 'not json at all');
    expect(await readConfigValue('TEST_LAYER_KEY')).toBeUndefined();
    await writeConfigValue('TEST_LAYER_KEY', 'recovered');
    expect(await readConfigValue('TEST_LAYER_KEY')).toBe('recovered');
    expect(JSON.parse(await readFile(join(dir, 'layer-config.json'), 'utf8'))).toBeTruthy();
  });
});
