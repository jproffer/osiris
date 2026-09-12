import { useCallback, useEffect, useRef } from 'react';
import type { ClientManifest } from '@/lib/layers/client-manifest';
import { executePlan } from '@/lib/layers/execute';
import {
  createLoadState, markSettled, markStarted, planLoads, type Viewport,
} from '@/lib/layers/loader';
import type { GeoFeature } from '@/lib/layers/types';
import type { LegacyRow } from '@/lib/layers/execute';

/** Coarse enough that one tick serves every poll cadence the manifests declare. */
const TICK_MS = 5000;

export interface UseLayerDataOptions {
  manifests: ClientManifest[];
  active: ReadonlySet<string>;
  viewport: Viewport | null;
  /** The existing dataRef store -- one re-render per refresh, not per render. */
  write(patch: Record<string, GeoFeature[] | LegacyRow[]>): void;
}

export function useLayerData({ manifests, active, viewport, write }: UseLayerDataOptions): void {
  const state = useRef(createLoadState());
  const latest = useRef({ manifests, active, viewport, write });
  latest.current = { manifests, active, viewport, write };

  const pump = useCallback(async () => {
    const { manifests: ms, active: on, viewport: vp, write: put } = latest.current;
    const plans = planLoads(ms, on, state.current, vp, Date.now());

    await Promise.all(plans.map(async plan => {
      markStarted(state.current, plan);
      const ok = await executePlan(plan, ms, {
        fetchJson: async url => {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        },
        write: put,
      });
      // Releasing the mark on failure is what stops one timeout leaving a
      // layer empty for the rest of the session.
      markSettled(state.current, plan, ok, Date.now());
    }));
  }, []);

  useEffect(() => { void pump(); }, [pump, manifests, active, viewport]);

  useEffect(() => {
    const id = setInterval(() => { void pump(); }, TICK_MS);
    return () => clearInterval(id);
  }, [pump]);
}
