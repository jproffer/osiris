import { describe, expect, it } from 'vitest';
import { validateHost } from './ssrf-guard';

describe('validateHost allowHost opt-in', () => {
  it('still blocks loopback by default, with no allowHost', async () => {
    const result = await validateHost('127.0.0.1');
    expect(result.ok).toBe(false);
  });

  it('still blocks RFC1918 by default, with no allowHost', async () => {
    const result = await validateHost('192.168.1.5');
    expect(result.ok).toBe(false);
  });

  it('allows a loopback host when it exactly matches the configured allowHost', async () => {
    const result = await validateHost('127.0.0.1', { allowHost: '127.0.0.1' });
    expect(result.ok).toBe(true);
  });

  it('does not allow an unrelated private host just because some allowHost is configured', async () => {
    const result = await validateHost('10.0.0.5', { allowHost: '127.0.0.1' });
    expect(result.ok).toBe(false);
  });

  it('allowHost match is case-insensitive and checked before the reserved-name blocklist', async () => {
    // 'osiris.internal' would normally match the /\.internal$/ NAME_BLOCKLIST pattern and be
    // rejected outright, before even reaching an IP check -- confirm the allowlist short-circuits
    // that when the configured allowHost matches, case-insensitively.
    const result = await validateHost('OSIRIS.internal', { allowHost: 'osiris.internal' });
    expect(result.ok).toBe(true);
  });

  it('still blocks a reserved-name host when allowHost is configured but does not match it', async () => {
    const result = await validateHost('localhost', { allowHost: '127.0.0.1' });
    expect(result.ok).toBe(false);
  });
});
