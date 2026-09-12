import type {
  ConfigFieldSpec, InteractionSpec, MapLayerSpec, NormalisedManifest,
  RefreshSpec, RenderSpec, SourceSpec, VariantSpec,
} from './types';

/** Everything the browser needs about a source, and nothing it must not have. */
export interface ClientSource {
  kind: SourceSpec['kind'];
  refresh?: RefreshSpec;
  /** kind:'tiles' only -- a public tile endpoint the browser fetches itself. */
  spec?: Record<string, unknown>;
  /** kind:'computed' only. */
  dependsOn?: string[];
}

export interface ClientDataset {
  key: string;
  layers: MapLayerSpec[];
  legacyKey?: string;
  source: ClientSource;
}

export interface ClientManifest {
  id: string;
  label: string;
  group: string;
  defaultOn: boolean;
  parent?: string;
  countFrom: string;
  order?: number;
  requiredConfig: ConfigFieldSpec[];
  datasets: ClientDataset[];
  variants: VariantSpec[];
  render: RenderSpec;
  interaction?: InteractionSpec;
}

/**
 * A manifest's url and headers carry unexpanded {config.KEY} templates and the
 * upstream address. Neither may reach the browser: /api/layer-source takes a
 * layer id rather than a URL precisely so an open instance cannot be driven as
 * a fetch proxy, and shipping manifests verbatim would undo that.
 */
function projectSource(source: SourceSpec): ClientSource {
  const out: ClientSource = { kind: source.kind };
  if (source.kind === 'http' || source.kind === 'adapter') out.refresh = source.refresh;
  if (source.kind === 'tiles') out.spec = source.spec;
  if (source.kind === 'computed') {
    if (source.refresh) out.refresh = source.refresh;
    if (source.dependsOn) out.dependsOn = source.dependsOn;
  }
  return out;
}

export function toClientManifest(m: NormalisedManifest): ClientManifest {
  return {
    id: m.id,
    label: m.label,
    group: m.group,
    defaultOn: m.defaultOn,
    parent: m.parent,
    countFrom: m.countFrom,
    order: m.order,
    requiredConfig: m.requiredConfig,
    datasets: m.datasets.map(d => ({
      key: d.key,
      layers: d.layers,
      legacyKey: d.legacyKey,
      source: projectSource(d.source),
    })),
    variants: m.variants,
    render: m.render,
    interaction: m.interaction,
  };
}
