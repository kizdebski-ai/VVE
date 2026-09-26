import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchServerResourceLimits,
  resetServerResourceLimitsCache
} from '../../src/services/resourceLimitsClient';

const VALID_LIMITS = {
  maxWebsocketPayloadBytes: 10485760,
  maxDocumentUpdateBytes: 10485760,
  maxImageDataUrlChars: 10485504,
  maxEncodedImageBytes: 7864080
};

describe('resourceLimitsClient (VVE-107 one policy owner)', () => {
  afterEach(() => {
    resetServerResourceLimitsCache();
    vi.unstubAllGlobals();
  });

  it('adopts server limits from /api/resource-limits', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => VALID_LIMITS
    })));
    const limits = await fetchServerResourceLimits();
    expect(limits.maxWebsocketPayloadBytes).toBe(10485760);
    expect(limits.maxImageDataUrlChars).toBeLessThanOrEqual(limits.maxWebsocketPayloadBytes);
  });

  it('caches the fetched limits (one fetch for repeated consumers)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => VALID_LIMITS }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchServerResourceLimits();
    await fetchServerResourceLimits();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to compiled defaults when the endpoint is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));
    const limits = await fetchServerResourceLimits();
    expect(limits.maxWebsocketPayloadBytes).toBe(10 * 1024 * 1024);
    expect(limits.maxImageDataUrlChars).toBeLessThanOrEqual(limits.maxWebsocketPayloadBytes);
  });

  it('falls back to compiled defaults on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    const limits = await fetchServerResourceLimits();
    expect(limits.maxWebsocketPayloadBytes).toBe(10 * 1024 * 1024);
  });
});
