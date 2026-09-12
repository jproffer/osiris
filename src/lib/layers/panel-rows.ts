import type { ClientManifest } from './client-manifest';
import { evaluate } from './condition';
import { GROUPS, resolveGroup, type GroupMeta } from './groups';
import type { GeoFeature } from './types';

export type CredentialState = 'none' | 'optional-missing' | 'required-missing' | 'satisfied';

export interface PanelRow {
  key: string;
  label: string;
  parent?: string;
  count: number | null;
  credential: CredentialState;
  source: 'manifest' | 'legacy';
}

export interface PanelGroup extends GroupMeta {
  key: string;
  rows: PanelRow[];
}

/** A row still owned by LAYER_GROUPS, for as long as both systems coexist. */
export interface LegacyRow {
  key: string;
  label: string;
  group: string;
  parent?: string;
  count: number | null;
}

export type ConfigStatus =
  Record<string, Record<string, { configured: boolean; source: 'env' | 'store' | null }>>;

export interface PanelInput {
  manifests: ClientManifest[];
  legacy: LegacyRow[];
  /** dataRef contents, keyed `${layerId}.${datasetKey}` plus legacy flat keys. */
  data: Record<string, unknown>;
  configStatus: ConfigStatus;
}

function rowsFor(data: Record<string, unknown>, layerId: string, datasetKey: string): GeoFeature[] | null {
  const v = data[`${layerId}.${datasetKey}`];
  return Array.isArray(v) ? (v as GeoFeature[]) : null;
}

function credentialState(m: ClientManifest, status: ConfigStatus): CredentialState {
  if (m.requiredConfig.length === 0) return 'none';
  const forLayer = status[m.id] ?? {};
  const missing = m.requiredConfig.filter(f => !forLayer[f.key]?.configured);
  if (missing.length === 0) return 'satisfied';
  // A layer that still works without its key must not render as disabled.
  return missing.every(f => f.optional) ? 'optional-missing' : 'required-missing';
}

export function buildPanelGroups(input: PanelInput): PanelGroup[] {
  const byGroup = new Map<string, { meta: GroupMeta & { key: string }; rows: PanelRow[]; order: number[] }>();

  const bucket = (groupKey: string) => {
    const meta = resolveGroup(groupKey);
    let entry = byGroup.get(meta.key);
    if (!entry) {
      entry = { meta, rows: [], order: [] };
      byGroup.set(meta.key, entry);
    }
    return entry;
  };

  input.manifests.forEach((m, index) => {
    const entry = bucket(m.group);
    const credential = credentialState(m, input.configStatus);
    const primary = rowsFor(input.data, m.id, m.countFrom);
    // `order` when given, else registry order -- panel order and z-order are
    // separate concerns and must stay that way.
    const sortKey = m.order ?? Number.MAX_SAFE_INTEGER - input.manifests.length + index;

    entry.rows.push({
      key: m.id, label: m.label, parent: m.parent,
      count: primary === null ? null : primary.length,
      credential, source: 'manifest',
    });
    entry.order.push(sortKey);

    for (const v of m.variants) {
      const dataset = v.dataset ?? m.datasets[0]?.key ?? 'default';
      const rows = rowsFor(input.data, m.id, dataset);
      const count = rows === null
        ? null
        : v.filter
          ? rows.filter(f => evaluate(v.filter!, f.properties ?? {})).length
          : rows.length;
      entry.rows.push({
        key: v.id, label: v.label, parent: m.parent,
        count, credential, source: 'manifest',
      });
      entry.order.push(sortKey);
    }
  });

  for (const row of input.legacy) {
    const entry = bucket(row.group);
    entry.rows.push({
      key: row.key, label: row.label, parent: row.parent,
      count: row.count, credential: 'none', source: 'legacy',
    });
    entry.order.push(Number.MAX_SAFE_INTEGER);
  }

  const out: PanelGroup[] = [];
  for (const entry of byGroup.values()) {
    if (entry.rows.length === 0) continue;
    const paired = entry.rows.map((row, i) => ({ row, sort: entry.order[i], i }));
    paired.sort((a, b) => (a.sort - b.sort) || (a.i - b.i));
    out.push({ ...entry.meta, rows: paired.map(p => p.row) });
  }
  return out.sort((a, b) => a.order - b.order);
}

export { GROUPS };
