/**
 * The two substitutions a manifest may use, expanded server-side only.
 *
 * Deliberately not a template language: a closed set of date tokens, plus
 * {config.KEY} for a declared credential. The date tokens exist because
 * Safecast's `since` parameter is the only way to get recent rows from that
 * API -- `order=captured_at desc` is silently ignored by it.
 */
const DATE_TOKEN = /^today(?:-(\d+)d)?$/;

function isoDay(base: Date, daysBack: number): string {
  const d = new Date(base.getTime() - daysBack * 86400000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function substitute(
  template: string,
  resolve: (key: string) => string | undefined,
  now: Date = new Date(),
): { text: string; missing: string[] } {
  const missing = new Set<string>();

  const text = template.replace(/\{([^}]+)\}/g, (whole, token: string) => {
    if (token.startsWith('config.')) {
      const key = token.slice('config.'.length);
      const value = resolve(key);
      if (value === undefined || value === '') { missing.add(key); return whole; }
      return value;
    }
    const m = DATE_TOKEN.exec(token);
    if (m) return isoDay(now, m[1] ? Number(m[1]) : 0);
    // Unrecognised tokens are left exactly as written rather than guessed at.
    return whole;
  });

  return { text, missing: [...missing] };
}
