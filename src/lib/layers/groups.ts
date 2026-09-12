import {
  Plane, Satellite, AlertTriangle, Camera, Ship, Network, CloudLightning,
  Radio, Sun, Megaphone, Puzzle,
} from 'lucide-react';
import type { ComponentType } from 'react';

export interface GroupMeta {
  label: string;
  fullLabel: string;
  icon: ComponentType<{ className?: string; style?: React.CSSProperties }>;
  order: number;
}

export const GROUPS: Record<string, GroupMeta> = {
  SDK:      { label: 'SDK',      fullLabel: 'OSIRIS SDK',         icon: Network,         order: 10 },
  AVIATION: { label: 'AVIATION', fullLabel: 'AVIATION',           icon: Plane,           order: 20 },
  MARITIME: { label: 'MARITIME', fullLabel: 'MARITIME',           icon: Ship,            order: 30 },
  SPACE:    { label: 'SPACE',    fullLabel: 'SPACE TRACKING',     icon: Satellite,       order: 40 },
  SURVEIL:  { label: 'SURVEIL',  fullLabel: 'SURVEILLANCE',       icon: Camera,          order: 50 },
  HAZARD:   { label: 'HAZARD',   fullLabel: 'NATURAL HAZARDS',    icon: CloudLightning,  order: 60 },
  THREAT:   { label: 'THREAT',   fullLabel: 'THREATS & INTEL',    icon: AlertTriangle,   order: 70 },
  NETWORK:  { label: 'NETWORK',  fullLabel: 'NETWORK INTEL',      icon: Network,         order: 80 },
  NETINTEL: { label: 'NETINTEL', fullLabel: 'NET & EVENT INTEL',  icon: Megaphone,       order: 90 },
  SIGNALS:  { label: 'SIGNALS',  fullLabel: 'SIGNALS INTEL',      icon: Radio,           order: 100 },
  DISPLAY:  { label: 'DISPLAY',  fullLabel: 'DISPLAY',            icon: Sun,             order: 110 },
  /** Fallback so a drop-in naming an unknown group still appears somewhere. */
  PLUGINS:  { label: 'PLUGINS',  fullLabel: 'PLUGINS',            icon: Puzzle,          order: 120 },
};

export function resolveGroup(key: string): GroupMeta & { key: string } {
  const meta = GROUPS[key];
  return meta ? { ...meta, key } : { ...GROUPS.PLUGINS, key: 'PLUGINS' };
}
