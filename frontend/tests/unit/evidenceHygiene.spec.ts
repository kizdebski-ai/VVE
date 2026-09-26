import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

/**
 * VVE-108 evidence hygiene (108-S1): captured evidence must be content-free.
 * Access credentials (Board Access / Teacher Access / ws tokens) and student
 * material must never reach the repository. The capture boundary redacts
 * query strings; this gate fails if any VVE-108 evidence artifact still
 * carries a recoverable credential.
 */
const evidenceDir = path.resolve(__dirname, '../../../docs/implementation/evidence/vve-108');

describe('VVE-108 evidence hygiene (108-S1)', () => {
  it('contains no access tokens in any evidence JSON', () => {
    const files = readdirSync(evidenceDir).filter((file) => file.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(path.join(evidenceDir, file), 'utf8');
      if (/token=[A-Za-z0-9_-]{6,}/.test(content) || /eyJ[A-Za-z0-9_-]{16,}/.test(content)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the restart timing evidence truthful and redacted', () => {
    const timings = JSON.parse(
      readFileSync(path.join(evidenceDir, 'restart-timings.json'), 'utf8')
    ) as {
      cycles: Array<{ readOnlyBannerFirstSeenMsAfterSigterm?: number; recoveryMsAfterServerReady?: number; serverSideWsReadmissionMsAfterListen?: number }>;
      durableStateAfterRestart: { digestParity: boolean };
    };
    expect(timings.durableStateAfterRestart.digestParity).toBe(true);
    const readOnly = timings.cycles
      .map((cycle) => cycle.readOnlyBannerFirstSeenMsAfterSigterm)
      .filter((value): value is number => typeof value === 'number');
    const reconnect = timings.cycles
      .map((cycle) => cycle.recoveryMsAfterServerReady ?? cycle.serverSideWsReadmissionMsAfterListen)
      .filter((value): value is number => typeof value === 'number');
    expect(readOnly.length).toBeGreaterThan(0);
    expect(reconnect.length).toBeGreaterThan(0);
    // Documented bounds: read-only within 2s, reconnect within 5s.
    for (const value of readOnly) expect(value).toBeLessThan(2_000);
    for (const value of reconnect) expect(value).toBeLessThan(5_000);
  });
});
