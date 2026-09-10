/** The narrow MapLibre slice the engine uses -- lets it be unit-tested without WebGL/DOM (vitest is node-only). */
export interface MapLike {
  addSource(id: string, spec: unknown): void;
  getSource(id: string): { setData(data: unknown): void } | undefined;
  addLayer(spec: Record<string, unknown>, beforeId?: string): void;
  getLayer(id: string): unknown | undefined;
  setLayoutProperty(id: string, name: string, value: unknown): void;
  setPaintProperty(id: string, name: string, value: unknown): void;
  queryRenderedFeatures(point: { x: number; y: number }): Array<{
    layer?: { id?: string };
    properties?: Record<string, unknown>;
  }>;
  on(type: string, handler: (e: unknown) => void): void;
  off(type: string, handler: (e: unknown) => void): void;
  getCanvas(): { style: { cursor: string } };
}

export class FakeMap implements MapLike {
  sources = new Map<string, { data: unknown }>();
  layers = new Map<string, Record<string, unknown>>();
  layerOrder: string[] = [];
  handlers = new Map<string, Array<(e: unknown) => void>>();
  canvas = { style: { cursor: '' } };
  /** Features the next queryRenderedFeatures call should return, topmost first. */
  hits: Array<{ layer?: { id?: string }; properties?: Record<string, unknown> }> = [];

  addSource(id: string, spec: unknown): void {
    this.sources.set(id, { data: (spec as { data?: unknown })?.data });
  }
  getSource(id: string) {
    const entry = this.sources.get(id);
    if (!entry) return undefined;
    return { setData: (data: unknown) => { entry.data = data; } };
  }
  addLayer(spec: Record<string, unknown>, beforeId?: string): void {
    const id = String(spec.id);
    this.layers.set(id, spec);
    if (beforeId && this.layerOrder.includes(beforeId)) {
      this.layerOrder.splice(this.layerOrder.indexOf(beforeId), 0, id);
    } else {
      this.layerOrder.push(id);
    }
  }
  getLayer(id: string) { return this.layers.get(id); }
  setLayoutProperty(id: string, name: string, value: unknown): void {
    const layer = this.layers.get(id);
    if (!layer) return;
    layer.layout = { ...(layer.layout as object), [name]: value };
  }
  setPaintProperty(id: string, name: string, value: unknown): void {
    const layer = this.layers.get(id);
    if (!layer) return;
    layer.paint = { ...(layer.paint as object), [name]: value };
  }
  queryRenderedFeatures() { return this.hits; }
  on(type: string, handler: (e: unknown) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }
  off(type: string, handler: (e: unknown) => void): void {
    const list = this.handlers.get(type) ?? [];
    this.handlers.set(type, list.filter(h => h !== handler));
  }
  getCanvas() { return this.canvas; }

  /** Test helper: dispatch an event as MapLibre would. */
  emit(type: string, event: unknown): void {
    for (const handler of [...(this.handlers.get(type) ?? [])]) handler(event);
  }
  visibilityOf(layerId: string): unknown {
    return (this.layers.get(layerId)?.layout as Record<string, unknown> | undefined)?.visibility;
  }
  featuresIn(sourceId: string): unknown[] {
    return ((this.sources.get(sourceId)?.data as { features?: unknown[] })?.features) ?? [];
  }
}
