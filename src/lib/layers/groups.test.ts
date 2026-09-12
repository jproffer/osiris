import { describe, expect, it } from 'vitest';
import { GROUPS, resolveGroup } from './groups';

describe('groups', () => {
  it('covers every group LayerPanel renders today', () => {
    for (const key of ['SDK', 'AVIATION', 'MARITIME', 'SPACE', 'SURVEIL', 'HAZARD',
                       'THREAT', 'NETWORK', 'NETINTEL', 'SIGNALS', 'DISPLAY']) {
      expect(GROUPS[key], `missing group ${key}`).toBeDefined();
    }
  });

  it('falls back to PLUGINS for an unknown group', () => {
    // A drop-in manifest naming a nonexistent group must still appear. Silently
    // disappearing is the worst possible failure mode for a drop-in file.
    expect(resolveGroup('NOT_A_REAL_GROUP').key).toBe('PLUGINS');
  });

  it('resolves a known group to itself', () => {
    expect(resolveGroup('HAZARD').key).toBe('HAZARD');
    expect(resolveGroup('HAZARD').fullLabel).toBe('NATURAL HAZARDS');
  });

  it('gives every group a distinct order', () => {
    const orders = Object.values(GROUPS).map(g => g.order);
    expect(new Set(orders).size).toBe(orders.length);
  });
});
