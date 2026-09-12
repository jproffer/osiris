'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plane, Satellite, Sun, AlertTriangle, Camera,
  CloudLightning, Ship, Network, Database, Ghost,
  Flame, Tv, Radio, Mountain, Anchor, Megaphone, SlidersHorizontal, KeyRound, Puzzle
} from 'lucide-react';
import StyleStudio from './StyleStudio';
import LayerDiagnostics from './LayerDiagnostics';
import type { ClientManifest } from '@/lib/layers/client-manifest';
import { buildPanelGroups, type ConfigStatus, type LegacyRow } from '@/lib/layers/panel-rows';

interface LayerPanelProps {
  data: any;
  activeLayers: any;
  setActiveLayers: React.Dispatch<React.SetStateAction<any>>;
  isMobile?: boolean;
  theme?: 'core' | 'ghost';
  setTheme?: (theme: 'core' | 'ghost') => void;
  /** Server-side capabilities, e.g. { cloudflare: true }. Layers declaring a
   *  `requires` key stay hidden until the matching capability is present. */
  capabilities?: Record<string, boolean>;
  /** Manifest-driven rows, merged with whatever LAYER_GROUPS still owns. */
  manifests?: ClientManifest[];
  configStatus?: ConfigStatus;
  /** Opens the credential entry UI for a locked (required-missing) row. Built in batch 2. */
  onOpenCredentials?: (key: string) => void;
  /** Re-fetches /api/layers after a diagnostics-panel reload. Desktop only. */
  onReloadManifests?: () => void;
}

interface LayerDef {
  key: string;
  label: string;
  dataKey: string;
  /** Reads a bucket out of data.category_counts instead of a top-level array. */
  catKey?: string;
  /** Capability that must be configured server-side for this layer to appear. */
  requires?: string;
  /** Key of the layer this one modifies. Renders indented beneath it, and reads
   *  as inert while that parent is off — it has nothing to act on. */
  parent?: string;
}

interface LayerGroupDef {
  label: string;
  fullLabel: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  layers: LayerDef[];
}

const LAYER_GROUPS: LayerGroupDef[] = [
  {
    label: 'SDK',
    fullLabel: 'OSIRIS SDK',
    icon: Network,
    layers: [
      { key: 'sdk_sea', label: 'Maritime Lines', dataKey: 'sdk_entities' },
    ],
  },
  {
    label: 'AVIATION',
    fullLabel: 'AVIATION',
    icon: Plane,
    layers: [
      { key: 'flights', label: 'Commercial', dataKey: 'commercial_flights' },
      { key: 'private', label: 'Private', dataKey: 'private_flights' },
      { key: 'jets', label: 'Private Jets', dataKey: 'private_jets' },
      { key: 'military', label: 'Military', dataKey: 'military_flights' },
      /* Modifies whichever of the four categories above are on, rather than
         drawing its own aircraft, so it isn't tied to a single `parent`. */
      { key: 'flight_paths', label: 'Flight Paths', dataKey: '' },
    ],
  },
  {
    label: 'MARITIME',
    fullLabel: 'MARITIME',
    icon: Ship,
    layers: [
      { key: 'maritime', label: 'Maritime / Naval', dataKey: 'maritime_ships,maritime_ports,maritime_chokepoints' },
      { key: 'piracy', label: 'Piracy Incidents', dataKey: 'piracy' },
      { key: 'dark_fleet', label: 'Dark Fleet (AIS Gaps)', dataKey: 'dark_fleet' },
    ],
  },
  {
    label: 'SPACE',
    fullLabel: 'SPACE TRACKING',
    icon: Satellite,
    layers: [
      { key: 'satellites', label: 'All Satellites', dataKey: 'satellites' },
      { key: 'sat_comms', label: 'Starlink / Comms', dataKey: 'satellites', catKey: 'comms' },
      { key: 'sat_military', label: 'Military / Intel', dataKey: 'satellites', catKey: 'military' },
      { key: 'sat_navigation', label: 'GPS / Navigation', dataKey: 'satellites', catKey: 'navigation' },
      { key: 'sat_earth', label: 'Earth Observation', dataKey: 'satellites', catKey: 'earth_obs' },
      { key: 'sat_science', label: 'Stations / Telescopes', dataKey: 'satellites', catKey: 'science' },
    ],
  },
  {
    label: 'SURVEIL',
    fullLabel: 'SURVEILLANCE',
    icon: Camera,
    layers: [
      { key: 'cctv', label: 'CCTV Cameras', dataKey: 'cameras' },
      { key: 'cctv_previews', label: 'Live Previews', dataKey: '', parent: 'cctv' },
      { key: 'live_news', label: 'Live News Feeds', dataKey: 'live_feeds' },
    ],
  },
  {
    label: 'HAZARD',
    fullLabel: 'NATURAL HAZARDS',
    icon: CloudLightning,
    layers: [],
  },
  {
    label: 'THREAT',
    fullLabel: 'THREATS & INTEL',
    icon: AlertTriangle,
    layers: [
      { key: 'infrastructure', label: 'Nuclear Facilities', dataKey: 'infrastructure' },
      { key: 'power_outages', label: 'Power Outages', dataKey: 'power_outages' },
      { key: 'global_incidents', label: 'Global Incidents', dataKey: 'gdelt' },
      { key: 'gdelt_events', label: 'GDELT Events', dataKey: 'gdelt_events' },
    ],
  },
  {
    label: 'NETWORK',
    fullLabel: 'NETWORK INTEL',
    icon: Network,
    layers: [
      { key: 'malware', label: 'Live Malware', dataKey: 'malware_threats' },
      { key: 'cyber_attacks', label: 'Live Attacks', dataKey: 'cyber_attacks' },
    ],
  },
  {
    label: 'NETINTEL',
    fullLabel: 'NET & EVENT INTEL',
    icon: Megaphone,
    layers: [
      { key: 'cf_outages', label: 'Internet Outages', dataKey: 'cf_outages', requires: 'cloudflare' },
      { key: 'cf_attacks', label: 'Attack Origins', dataKey: 'cf_attack_origins', requires: 'cloudflare' },
    ],
  },
  {
    label: 'SIGNALS',
    fullLabel: 'SIGNALS INTEL',
    icon: Radio,
    layers: [
      { key: 'gps_jamming', label: 'GPS/GNSS Jamming', dataKey: 'gps_jamming' },
    ],
  },
  {
    label: 'DISPLAY',
    fullLabel: 'DISPLAY',
    icon: Sun,
    layers: [
      { key: 'day_night', label: 'Day / Night Cycle', dataKey: '' },
      { key: 'terrain_3d', label: '3D Terrain & Buildings', dataKey: '' },
    ],
  },
];

/* Layers with no dataKey modify another layer's rendering rather than drawing
   anything of their own (a parent-tied sub-layer, or a standalone modifier
   like Flight Paths), so they don't count towards the rail's reading. A
   PanelRow no longer carries dataKey once merged, so this structural check
   stays keyed off LAYER_GROUPS directly rather than a runtime count, which
   would otherwise read as "not counted" for a moment on every reload just
   because that layer's dataset hasn't arrived yet. */
const MODIFIER_KEYS = new Set(
  LAYER_GROUPS.flatMap(g => g.layers.filter(l => l.dataKey === '').map(l => l.key)),
);

/* ── Minimal Toggle Switch ── */
/**
 * Presentational only. The row around it is the button, and a button inside a
 * button is invalid HTML — the browser reparents it, which breaks hydration and
 * silently drops the click handler on the inner control.
 */
function ToggleSwitch({ active }: { active: boolean }) {
  return (
    <span
      role="presentation"
      className="relative flex-shrink-0 block"
      style={{ width: 28, height: 14 }}
    >
      <div
        className="absolute inset-0 rounded-full transition-all duration-300"
        style={{
          background: active ? 'rgba(255,255,255,0.2)' : 'transparent',
          border: active ? '1px solid rgba(255,255,255,0.35)' : '1px solid rgba(255,255,255,0.12)',
          boxShadow: active ? '0 0 8px rgba(255,255,255,0.1)' : 'none',
        }}
      />
      <motion.div
        className="absolute top-[2px] rounded-full"
        style={{
          width: 10,
          height: 10,
          background: active ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.2)',
          boxShadow: active ? '0 0 6px rgba(255,255,255,0.4)' : 'none',
        }}
        animate={{ left: active ? 16 : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      />
    </span>
  );
}

/**
 * The elbow that ties a sub-layer row to the layer above it. Indentation alone
 * reads as a typo at this size; the line is what says "this belongs to that".
 */
function SubLayerStem() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute left-[6px] top-0 h-1/2 w-[8px] rounded-bl-[3px] border-b border-l border-white/[0.14]"
    />
  );
}

function LayerPanel({
  data, activeLayers, setActiveLayers, isMobile, theme = 'core', setTheme,
  capabilities = {}, manifests = [], configStatus = {}, onOpenCredentials, onReloadManifests,
}: LayerPanelProps) {
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);
  /**
   * A pinned group stays open when the pointer leaves. Hover-only flyouts are
   * fine to glance at and impossible to work in — reaching for a toggle at the
   * far edge closes the thing you were reaching for.
   */
  const [pinnedGroup, setPinnedGroup] = useState<string | null>(null);
  const [studioOpen, setStudioOpen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);

  useEffect(() => {
    if (!pinnedGroup) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPinnedGroup(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pinnedGroup]);

  const toggle = (key: string) => setActiveLayers((prev: any) => ({ ...prev, [key]: !prev[key] }));

  /** Switch a whole group at once — off if any are on, otherwise all on. */
  const toggleGroup = (rows: { key: string }[]) => {
    const anyOn = rows.some(r => activeLayers[r.key]);
    setActiveLayers((prev: any) => {
      const next = { ...prev };
      for (const r of rows) next[r.key] = !anyOn;
      return next;
    });
  };

  const getCount = (dk: string, catKey?: string): number | null => {
    if (!dk) return null;
    if (catKey && data.category_counts) {
      return data.category_counts[catKey] || 0;
    }
    let total = 0;
    let found = false;
    for (const k of dk.split(',')) {
      if (data[k] && Array.isArray(data[k])) {
        total += data[k].length;
        found = true;
      }
    }
    return found ? total : null;
  };

  /* LAYER_GROUPS still owns every layer not yet migrated. Both sets of rows
     merge into one model so the panel does not care which system owns a row. */
  const legacyRows: LegacyRow[] = useMemo(
    () => LAYER_GROUPS.flatMap(g =>
      g.layers
        .filter(l => !l.requires || capabilities[l.requires])
        .filter(l => !manifests.some(m => m.id === l.key || m.variants.some(v => v.id === l.key)))
        .map(l => ({
          key: l.key, label: l.label, group: g.label, parent: l.parent,
          count: getCount(l.dataKey, l.catKey),
        })),
    ),
    /* getCount reads `data` from closure and is redefined every render;
       `data` is already a dependency, so listing getCount too would just
       defeat the memo. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [capabilities, manifests, data],
  );

  const panelGroups = useMemo(
    () => buildPanelGroups({ manifests, legacy: legacyRows, data, configStatus }),
    [manifests, legacyRows, data, configStatus],
  );

  /* ── MOBILE ── */
  if (isMobile) {
    return (
      <div className="flex flex-col gap-5 py-2">
        {panelGroups.map((group) => (
          <div key={group.key} className="flex flex-col gap-2">
            <div className="text-[10px] font-mono tracking-[0.2em] uppercase text-white/30 border-b border-white/[0.06] pb-1.5">
              {group.fullLabel}
            </div>
            <div className="flex flex-col gap-1">
              {group.rows.map((row) => {
                const isLayerActive = activeLayers[row.key];
                const count = row.count;
                const dormant = !!row.parent && !activeLayers[row.parent];
                const locked = row.credential === 'required-missing';
                return (
                  <button
                    key={row.key}
                    onClick={() => locked ? onOpenCredentials?.(row.key) : toggle(row.key)}
                    aria-pressed={!!isLayerActive}
                    className={`relative w-full flex items-center gap-3 py-2 rounded-md text-left hover:bg-white/[0.04] transition-colors ${row.parent ? 'pl-[22px] pr-1' : 'px-1'} ${(dormant || locked) ? 'opacity-40' : ''}`}
                  >
                    {row.parent && <SubLayerStem />}
                    <ToggleSwitch active={!!isLayerActive} />
                    <span className={`text-[11px] font-mono uppercase tracking-wider flex-1 transition-colors ${isLayerActive ? 'text-white/80' : 'text-white/40'}`}>
                      {row.label}
                    </span>
                    {row.credential !== 'none' && row.credential !== 'satisfied' && (
                      <KeyRound className="w-3 h-3 text-white/25" aria-label="needs a credential" />
                    )}
                    {count !== null && (
                      <span className="text-[10px] font-mono tabular-nums text-white/25">
                        {count.toLocaleString()}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* MOBILE STYLE STUDIO */}
        <div className="flex items-center justify-between mt-2 pt-3 border-t border-white/[0.06] px-1">
          <span className="text-[10px] font-mono tracking-[0.2em] text-white/25 uppercase">Style Studio</span>
          <button
            onClick={() => setStudioOpen(o => !o)}
            aria-pressed={studioOpen}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
            style={{
              background: studioOpen ? 'var(--hover-accent)' : 'transparent',
              boxShadow: studioOpen ? '0 0 12px var(--gold-glow)' : 'none',
            }}
          >
            <SlidersHorizontal className="w-4 h-4" style={{ color: studioOpen ? 'var(--gold-primary)' : 'rgba(255,255,255,0.25)' }} />
          </button>
        </div>
        <AnimatePresence>
          {studioOpen && <StyleStudio isMobile onClose={() => setStudioOpen(false)} />}
        </AnimatePresence>

        {/* MOBILE GHOST TOGGLE */}
        {setTheme && (
          <div className="flex items-center justify-between pt-3 border-t border-white/[0.06] px-1">
            <span className="text-[10px] font-mono tracking-[0.2em] text-white/25 uppercase">Ghost Protocol</span>
            <button
              onClick={() => setTheme(theme === 'core' ? 'ghost' : 'core')}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
              style={{
                background: theme === 'ghost' ? 'rgba(179, 136, 255, 0.15)' : 'transparent',
                boxShadow: theme === 'ghost' ? '0 0 12px rgba(179, 136, 255, 0.3)' : 'none',
              }}
            >
              <Ghost className="w-4 h-4" style={{ color: theme === 'ghost' ? '#B388FF' : 'rgba(255,255,255,0.25)' }} />
            </button>
          </div>
        )}
      </div>
    );
  }

  /* ── DESKTOP ── */
  return (
    <motion.div
      initial={{ x: -60, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: 'spring', damping: 30, stiffness: 200, delay: 2.8 }}
      className="absolute top-0 left-0 h-full w-[48px] flex flex-col items-center pt-24 pb-6 z-50 pointer-events-auto"
      style={{
        background: 'rgba(0,0,0,0.15)',
        backdropFilter: 'blur(24px) saturate(1.2)',
        WebkitBackdropFilter: 'blur(24px) saturate(1.2)',
      }}
    >
      <div className="flex-1 flex flex-col items-center gap-1">
        {panelGroups.map((group) => {
          /* A layer with no dataKey modifies another layer's rendering rather
             than drawing anything of its own (a parent-tied sub-layer, or a
             standalone modifier like Flight Paths), so it doesn't count
             towards the rail's reading. */
          const counted = group.rows.filter(r => !r.parent && !MODIFIER_KEYS.has(r.key));
          const groupActive = counted.some(r => activeLayers[r.key]);
          const isHovered = hoveredGroup === group.key;
          const Icon = group.icon;

          const activeCount = counted.filter(r => activeLayers[r.key]).length;
          const isPinned = pinnedGroup === group.key;
          const isOpen = isHovered || isPinned;

          return (
            <div
              key={group.key}
              className="relative flex items-center justify-center"
              onMouseEnter={() => setHoveredGroup(group.key)}
              onMouseLeave={() => setHoveredGroup(null)}
            >
              {/* A real button, not a div: this is keyboard reachable, focusable
                  and announced. Clicking pins the flyout open so it can be
                  worked in rather than only glanced at. */}
              <button
                onClick={() => setPinnedGroup(isPinned ? null : group.key)}
                aria-expanded={isOpen}
                aria-label={`${group.fullLabel}${activeCount ? ` — ${activeCount} active` : ''}`}
                title={group.fullLabel}
                className="relative w-10 h-10 flex items-center justify-center cursor-pointer rounded-lg transition-all duration-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
                style={{
                  background: isPinned
                    ? 'rgba(255,255,255,0.10)'
                    : isHovered ? 'rgba(255,255,255,0.05)' : 'transparent',
                }}
              >
                <Icon
                  className="transition-all duration-300"
                  style={{
                    width: 16,
                    height: 16,
                    color: groupActive
                      ? 'rgba(255,255,255,0.75)'
                      : isOpen
                        ? 'rgba(255,255,255,0.45)'
                        : 'rgba(255,255,255,0.22)',
                    filter: groupActive ? 'drop-shadow(0 0 4px rgba(255,255,255,0.3))' : 'none',
                  }}
                />

                {/* How many layers in this group are live. Without it the rail
                    gives no reading at all until each icon is hovered in turn. */}
                {activeCount > 0 && (
                  <span
                    className="absolute top-1 right-1 min-w-[13px] h-[13px] px-[3px] rounded-full flex items-center justify-center text-[9px] font-mono tabular-nums leading-none"
                    style={{
                      background: 'rgba(0,229,255,0.9)',
                      color: '#04040A',
                      boxShadow: '0 0 6px rgba(0,229,255,0.5)',
                    }}
                  >
                    {activeCount}
                  </span>
                )}
              </button>

              {/* Flyout (LEFT side) */}
              <AnimatePresence>
                {isOpen && (
                  <motion.div
                    initial={{ opacity: 0, x: -8, filter: 'blur(4px)' }}
                    animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, x: -4, filter: 'blur(2px)' }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                    className="absolute left-[52px] top-1/2 -translate-y-1/2 min-w-[220px] rounded-xl p-3 z-[100] pointer-events-auto"
                    style={{
                      background: 'rgba(0,0,0,0.6)',
                      backdropFilter: 'blur(40px) saturate(1.5)',
                      WebkitBackdropFilter: 'blur(40px) saturate(1.5)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                    }}
                  >
                    <div className="flex items-center gap-2 mb-2.5 pb-1.5 border-b border-white/[0.04]">
                      <span className="text-[10px] font-mono tracking-[0.2em] uppercase text-white/35 flex-1">
                        {group.fullLabel}
                      </span>
                      {/* Switching eight satellite layers one at a time is the
                          kind of thing that makes a panel feel unfinished. */}
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleGroup(group.rows); }}
                        className="px-1.5 py-0.5 rounded text-[10px] font-mono tracking-wider text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                      >
                        {activeCount > 0 ? 'NONE' : 'ALL'}
                      </button>
                      {isPinned && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setPinnedGroup(null); }}
                          aria-label="Close"
                          className="px-1.5 py-0.5 rounded text-[10px] font-mono text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {group.rows.map((row) => {
                        const isLayerActive = activeLayers[row.key];
                        const count = row.count;
                        const dormant = !!row.parent && !activeLayers[row.parent];
                        const locked = row.credential === 'required-missing';

                        return (
                          <button
                            key={row.key}
                            onClick={() => locked ? onOpenCredentials?.(row.key) : toggle(row.key)}
                            aria-pressed={!!isLayerActive}
                            title={dormant ? 'Turn the layer above on to use this' : undefined}
                            className={`relative w-full flex items-center gap-3 py-1.5 rounded-md hover:bg-white/[0.05] transition-colors cursor-pointer text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${row.parent ? 'pl-[22px] pr-1' : 'px-1'} ${(dormant || locked) ? 'opacity-40' : ''}`}
                          >
                            {row.parent && <SubLayerStem />}
                            <ToggleSwitch active={!!isLayerActive} />
                            <span className={`text-[11px] font-mono uppercase tracking-wider flex-1 transition-colors duration-200 ${isLayerActive ? 'text-white/70' : 'text-white/35'}`}>
                              {row.label}
                            </span>
                            {row.credential !== 'none' && row.credential !== 'satisfied' && (
                              <KeyRound className="w-3 h-3 text-white/25" aria-label="needs a credential" />
                            )}
                            {count !== null && (
                              <span className={`text-[10px] font-mono tabular-nums transition-colors ${isLayerActive ? 'text-white/45' : 'text-white/20'}`}>
                                {count.toLocaleString()}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* Subtle separator */}
      <div className="w-5 h-px bg-white/[0.06] my-2" />

      {/* Style Studio */}
      <button
        onClick={() => setStudioOpen(o => !o)}
        aria-pressed={studioOpen}
        className="w-10 h-10 flex items-center justify-center rounded-lg transition-all duration-500 cursor-pointer"
        style={{ background: studioOpen ? 'var(--hover-accent)' : 'transparent' }}
        title="Style Studio"
      >
        <SlidersHorizontal
          className="transition-all duration-500"
          style={{
            width: 15,
            height: 15,
            color: studioOpen ? 'var(--gold-primary)' : 'rgba(255,255,255,0.15)',
            filter: studioOpen ? 'drop-shadow(0 0 6px var(--gold-glow))' : 'none',
          }}
        />
      </button>
      <AnimatePresence>
        {studioOpen && <StyleStudio onClose={() => setStudioOpen(false)} />}
      </AnimatePresence>

      {/* Plugin Diagnostics */}
      <button
        onClick={() => setDiagOpen(o => !o)}
        aria-pressed={diagOpen}
        className="w-10 h-10 flex items-center justify-center rounded-lg transition-all duration-500 cursor-pointer"
        style={{ background: diagOpen ? 'var(--hover-accent)' : 'transparent' }}
        title="Plugin Diagnostics"
      >
        <Puzzle
          className="transition-all duration-500"
          style={{
            width: 15,
            height: 15,
            color: diagOpen ? 'var(--gold-primary)' : 'rgba(255,255,255,0.15)',
            filter: diagOpen ? 'drop-shadow(0 0 6px var(--gold-glow))' : 'none',
          }}
        />
      </button>
      <AnimatePresence>
        {diagOpen && (
          <LayerDiagnostics
            onClose={() => setDiagOpen(false)}
            manifests={manifests}
            data={data}
            onReloaded={() => onReloadManifests?.()}
          />
        )}
      </AnimatePresence>

      {/* Ghost Protocol Toggle */}
      {setTheme && (
        <button
          onClick={() => setTheme(theme === 'core' ? 'ghost' : 'core')}
          className="w-10 h-10 flex items-center justify-center rounded-lg transition-all duration-500 cursor-pointer"
          style={{
            background: theme === 'ghost' ? 'rgba(179, 136, 255, 0.1)' : 'transparent',
          }}
          title="Ghost Protocol"
        >
          <Ghost
            className="transition-all duration-500"
            style={{
              width: 15,
              height: 15,
              color: theme === 'ghost' ? '#B388FF' : 'rgba(255,255,255,0.15)',
              filter: theme === 'ghost' ? 'drop-shadow(0 0 6px rgba(179, 136, 255, 0.5))' : 'none',
            }}
          />
        </button>
      )}
    </motion.div>
  );
}

export default memo(LayerPanel);
