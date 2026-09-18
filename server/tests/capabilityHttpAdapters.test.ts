import { describe, expect, it } from 'vitest';
import { clientIpOf } from '../src/pilot/capabilityHttpAdapters';

describe('capability HTTP client identity', () => {
  it('ignores a raw spoofed X-Forwarded-For header', () => {
    const request = {
      ip: '203.0.113.10',
      socket: { remoteAddress: '10.0.0.5' },
      headers: { 'x-forwarded-for': '198.51.100.99' }
    } as any;

    expect(clientIpOf(request)).toBe('203.0.113.10');
  });

  it('falls back to the transport peer when Express has no address', () => {
    const request = {
      ip: '',
      socket: { remoteAddress: '10.0.0.5' },
      headers: { 'x-forwarded-for': '198.51.100.99' }
    } as any;

    expect(clientIpOf(request)).toBe('10.0.0.5');
  });
});
