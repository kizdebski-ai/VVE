/**
 * VVE-107: fetch the server's live ResourceGovernor limits so the client
 * enforces the same policy the server does (one owner, no duplicated
 * compiled defaults). Falls back to the compiled measurement defaults when
 * the endpoint is unreachable (offline, dev tooling).
 */
import { createResourceLimits, type ResourceLimits } from '@pilot/resourceLimits';

let cached: ResourceLimits | null = null;
let inflight: Promise<ResourceLimits> | null = null;

const fallbackLimits = (): ResourceLimits => createResourceLimits();

export const fetchServerResourceLimits = async (): Promise<ResourceLimits> => {
  if (cached) return cached;
  if (!inflight) {
    inflight = (async () => {
      try {
        const response = await fetch('/api/resource-limits', { credentials: 'omit' });
        if (!response.ok) throw new Error(`status ${response.status}`);
        const payload = (await response.json()) as Record<string, unknown>;
        const limits = createResourceLimits(payload as Partial<ResourceLimits>);
        cached = limits;
        return limits;
      } catch {
        return fallbackLimits();
      } finally {
        inflight = null;
      }
    })();
  }
  return inflight;
};

export const resetServerResourceLimitsCache = (): void => {
  cached = null;
  inflight = null;
};
