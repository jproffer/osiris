import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NormalisedManifest } from './types';
import { validateManifest } from './validate';

export interface Registry {
  manifests: NormalisedManifest[];
  errors: string[];
  loadedAt: number;
}

let builtinDir = join(process.cwd(), 'src', 'lib', 'layers', 'manifests');
let dropinDir = process.env.OSIRIS_LAYERS_DIR ?? '/app/layers';
let cached: Registry | null = null;

/** Test seam. Production uses the packaged manifests plus OSIRIS_LAYERS_DIR. */
export function setManifestDirs(builtin: string, dropin: string): void {
  builtinDir = builtin;
  dropinDir = dropin;
  cached = null;
}

async function readDir(dir: string, errors: string[], required: boolean) {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    // A missing drop-in directory is the normal case for most installs.
    if (required) errors.push(`${dir}: manifest directory could not be read`);
    return [] as Array<{ origin: string; raw: unknown }>;
  }
  const out: Array<{ origin: string; raw: unknown }> = [];
  for (const name of names.filter(n => n.endsWith('.json')).sort()) {
    try {
      out.push({ origin: name, raw: JSON.parse(await readFile(join(dir, name), 'utf8')) });
    } catch (e) {
      errors.push(`${name}: not valid JSON (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return out;
}

export async function reloadRegistry(): Promise<Registry> {
  const errors: string[] = [];
  const files = [
    ...(await readDir(builtinDir, errors, true)),
    // Drop-ins are read second so they overwrite a built-in of the same id.
    ...(await readDir(dropinDir, errors, false)),
  ];

  const byId = new Map<string, NormalisedManifest>();
  for (const { origin, raw } of files) {
    const result = validateManifest(raw, origin);
    if (result.ok) byId.set(result.manifest.id, result.manifest);
    else errors.push(...result.errors);
  }

  cached = { manifests: [...byId.values()], errors, loadedAt: Date.now() };
  return cached;
}

export async function loadRegistry(): Promise<Registry> {
  return cached ?? reloadRegistry();
}
