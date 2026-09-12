'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { ClientManifest } from '@/lib/layers/client-manifest';

interface Diagnostics {
  registry: { count: number; loadedAt: number; layers: { id: string; group: string; label: string }[]; errors: string[] };
  requests: { at: number; layer: string; datasets: string[]; status: number; ms: number; bytes: number; error?: string }[];
}

interface Props {
  onClose(): void;
  manifests: ClientManifest[];
  /** dataRef contents, for the per-layer row counts. */
  data: Record<string, unknown>;
  onReloaded(): void;
}

export default function LayerDiagnostics({ onClose, manifests, data, onReloaded }: Props) {
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch('/api/layer-diagnostics')
      .then(r => (r.ok ? r.json() : null))
      .then(d => setDiag(d))
      .catch(() => setDiag(null));
  }, []);

  useEffect(load, [load]);

  const reload = async () => {
    setBusy(true);
    try {
      await fetch('/api/layer-source?reload=1', { method: 'POST' });
      load();
      onReloaded();
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}
      className="absolute left-14 bottom-0 w-[420px] max-h-[70vh] overflow-y-auto rounded-lg
                 border border-white/10 bg-black/90 backdrop-blur-xl p-4 font-mono text-[11px]"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="tracking-[0.2em] text-white/50">PLUGIN DIAGNOSTICS</span>
        <div className="flex gap-2">
          <button onClick={reload} disabled={busy} className="px-2 py-1 rounded border border-white/15 text-white/60">
            {busy ? 'RELOADING…' : 'RELOAD'}
          </button>
          <button onClick={onClose} className="px-2 py-1 text-white/40">✕</button>
        </div>
      </div>

      <Section title="REGISTRY">
        <div className="text-white/50">
          {diag ? `${diag.registry.count} manifests · loaded ${new Date(diag.registry.loadedAt).toLocaleTimeString()}` : 'loading…'}
        </div>
        {diag?.registry.errors.map(e => (
          <div key={e} className="text-red-400/80 mt-1 break-words">{e}</div>
        ))}
        {diag && diag.registry.errors.length === 0 && <div className="text-white/25 mt-1">no errors</div>}
      </Section>

      <Section title="LAYERS">
        {manifests.length === 0 && <div className="text-white/25">none loaded</div>}
        {manifests.map(m => (
          <div key={m.id} className="flex justify-between gap-3 py-0.5">
            <span className="text-white/60">{m.id}</span>
            <span className="text-white/30">
              {m.datasets.map(d => {
                const rows = data[`${m.id}.${d.key}`];
                return `${d.key}:${Array.isArray(rows) ? rows.length : '—'}`;
              }).join(' ')}
            </span>
          </div>
        ))}
      </Section>

      <Section title="RECENT REQUESTS">
        {!diag?.requests.length && <div className="text-white/25">none yet</div>}
        {diag?.requests.map((r, i) => (
          <div key={`${r.at}-${i}`} className="flex justify-between gap-3 py-0.5">
            <span className={r.status === 200 ? 'text-white/50' : 'text-red-400/80'}>
              {r.status} {r.layer}
            </span>
            <span className="text-white/25">{r.ms}ms · {r.bytes}b</span>
          </div>
        ))}
      </Section>
    </motion.div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-white/30 tracking-[0.15em] mb-1 border-b border-white/[0.06] pb-1">{title}</div>
      {children}
    </div>
  );
}
