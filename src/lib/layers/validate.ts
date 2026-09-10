import type { DatasetSpec, LayerManifest, NormalisedManifest, SourceSpec } from './types';

export type ValidationResult =
  | { ok: true; manifest: NormalisedManifest }
  | { ok: false; errors: string[] };

const SOURCE_KINDS = ['http', 'adapter', 'computed', 'none'];
const FORMATS = ['json', 'geojson', 'csv'];
const REFRESH_MODES = ['once', 'poll', 'viewport', 'stream'];

function checkSource(src: unknown, where: string, errors: string[]): void {
  if (!src || typeof src !== 'object') { errors.push(`${where}: source is missing`); return; }
  const s = src as Record<string, unknown>;
  if (typeof s.kind !== 'string' || !SOURCE_KINDS.includes(s.kind)) {
    errors.push(`${where}: unknown source kind '${String(s.kind)}'`);
    return;
  }
  if (s.kind === 'http') {
    if (typeof s.url !== 'string' || !s.url) errors.push(`${where}: http source needs a url`);
    if (typeof s.format !== 'string' || !FORMATS.includes(s.format)) {
      errors.push(`${where}: unknown format '${String(s.format)}'`);
    }
    if (typeof s.lat !== 'string' || typeof s.lng !== 'string') {
      errors.push(`${where}: http source needs lat and lng property paths`);
    }
  }
  if (s.kind === 'adapter' && typeof s.adapter !== 'string') {
    errors.push(`${where}: adapter source needs an adapter name`);
  }
  if (s.kind === 'computed' && typeof s.compute !== 'string') {
    errors.push(`${where}: computed source needs a compute name`);
  }
  if (s.kind === 'http' || s.kind === 'adapter') {
    const r = s.refresh as Record<string, unknown> | undefined;
    if (!r || typeof r.mode !== 'string' || !REFRESH_MODES.includes(r.mode)) {
      errors.push(`${where}: unknown refresh mode '${String(r?.mode)}'`);
    }
  }
}

/**
 * Validate and normalise one manifest.
 *
 * Returns errors rather than throwing: a malformed drop-in file has to reach
 * the plugins diagnostics panel naming the file and the fault, so an operator
 * who typos a JSON file sees it in the UI instead of in container logs.
 */
export function validateManifest(raw: unknown, origin: string): ValidationResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: [`${origin}: not a JSON object`] };
  }
  const m = raw as LayerManifest;

  if (typeof m.id !== 'string' || !m.id) errors.push(`${origin}: missing 'id'`);
  if (typeof m.label !== 'string' || !m.label) errors.push(`${origin}: missing 'label'`);
  if (typeof m.group !== 'string' || !m.group) errors.push(`${origin}: missing 'group'`);

  // Expand the single-dataset sugar so the engine only ever sees `datasets`.
  let datasets: DatasetSpec[] = [];
  if (Array.isArray(m.datasets) && m.datasets.length > 0) {
    datasets = m.datasets;
  } else if (m.source) {
    datasets = [{ key: 'default', source: m.source as SourceSpec, layers: m.layers ?? [] }];
  } else {
    errors.push(`${origin}: needs either 'source' or 'datasets'`);
  }

  const seen = new Set<string>();
  datasets.forEach((d, i) => {
    const where = `${origin}: dataset '${d?.key ?? i}'`;
    if (!d || typeof d.key !== 'string' || !d.key) { errors.push(`${where}: missing key`); return; }
    if (seen.has(d.key)) errors.push(`${origin}: duplicate dataset key '${d.key}'`);
    seen.add(d.key);
    if (!Array.isArray(d.layers)) errors.push(`${where}: layers must be an array`);
    checkSource(d.source, where, errors);
  });

  const variants = Array.isArray(m.variants) ? m.variants : [];
  variants.forEach((v, i) => {
    if (!v || typeof v.id !== 'string' || !v.id) errors.push(`${origin}: variant ${i} missing 'id'`);
    if (v?.dataset && !seen.has(v.dataset)) {
      errors.push(`${origin}: variant '${v.id}' names dataset '${v.dataset}', which does not exist`);
    }
  });

  const countFrom = m.countFrom ?? datasets[0]?.key ?? 'default';
  if (m.countFrom && !seen.has(m.countFrom)) {
    errors.push(`${origin}: countFrom '${m.countFrom}' names no dataset`);
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    manifest: {
      id: m.id, label: m.label, group: m.group,
      defaultOn: m.defaultOn ?? false,
      parent: m.parent,
      countFrom,
      requiredConfig: m.requiredConfig ?? [],
      datasets,
      variants,
      render: m.render ?? { kind: 'geojson' },
      interaction: m.interaction,
    },
  };
}
