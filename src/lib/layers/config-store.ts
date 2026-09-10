import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Runtime credential store, deliberately separate from the manifest
 * directory: manifests are shareable and commit-friendly, secrets are
 * neither, and one .gitignore mistake must not publish a token.
 *
 * Values are write-only from the outside world. There is no endpoint that
 * returns one, masked or otherwise -- only configStatus(), which reports
 * whether a key is set and where it came from.
 */
let configDir = process.env.OSIRIS_CONFIG_DIR ?? '/app/config';

/** Test seam. Production reads OSIRIS_CONFIG_DIR or falls back to /app/config. */
export function setConfigDir(dir: string): void {
  configDir = dir;
}

function storePath(): string {
  return join(configDir, 'layer-config.json');
}

async function readStore(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(storePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // Missing or corrupt: an unreadable store must not take the app down, and
    // the next write repairs it.
    return {};
  }
}

async function writeStore(data: Record<string, string>): Promise<void> {
  await mkdir(configDir, { recursive: true });
  await writeFile(storePath(), JSON.stringify(data, null, 2), { mode: 0o600 });
  // writeFile only applies `mode` when it creates the file, so an existing
  // file keeps whatever permissions it had.
  await chmod(storePath(), 0o600);
}

export async function readConfigValue(key: string): Promise<string | undefined> {
  const fromEnv = process.env[key];
  if (fromEnv) return fromEnv;
  const store = await readStore();
  return store[key] || undefined;
}

export async function writeConfigValue(key: string, value: string): Promise<void> {
  const store = await readStore();
  store[key] = value;
  await writeStore(store);
}

export async function deleteConfigValue(key: string): Promise<void> {
  const store = await readStore();
  delete store[key];
  await writeStore(store);
}

export async function configStatus(
  keys: string[],
): Promise<Record<string, { configured: boolean; source: 'env' | 'store' | null }>> {
  const store = await readStore();
  const out: Record<string, { configured: boolean; source: 'env' | 'store' | null }> = {};
  for (const key of keys) {
    if (process.env[key]) out[key] = { configured: true, source: 'env' };
    else if (store[key]) out[key] = { configured: true, source: 'store' };
    else out[key] = { configured: false, source: null };
  }
  return out;
}
