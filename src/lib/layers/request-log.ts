export interface RequestLogEntry {
  at: number;
  layer: string;
  datasets: string[];
  status: number;
  ms: number;
  bytes: number;
  error?: string;
}

export const CAPACITY = 200;

/**
 * Diagnostic, not audit. Persisting would add a disk write per layer fetch, a
 * retention problem nobody asked for, and a file containing resolved upstream
 * URLs -- exactly what the ClientManifest projection works to keep off the
 * client. Module scope means per-process, which is correct for one container.
 */
const buffer: RequestLogEntry[] = [];

export function record(entry: Omit<RequestLogEntry, 'at'>): void {
  buffer.push({ ...entry, at: Date.now() });
  if (buffer.length > CAPACITY) buffer.splice(0, buffer.length - CAPACITY);
}

export function recent(limit = CAPACITY): RequestLogEntry[] {
  return buffer.slice(-limit).reverse();
}

/** Test seam. */
export function clearLog(): void {
  buffer.length = 0;
}
