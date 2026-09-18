import { describe, expect, it } from 'vitest';
import { assertGateReport, parseReleaseGateArgs, type GateReport } from '../scripts/pilotReleaseGate';

const passingReport = (overrides: Partial<GateReport> = {}): GateReport => ({
  profile: 'change',
  smoke: true,
  startedAt: new Date(0).toISOString(),
  finishedAt: new Date(1).toISOString(),
  durationMs: 1,
  clients: 4,
  boards: 1,
  acknowledgedOperations: 80,
  reconnects: 1,
  backendRestarts: 1,
  metrics: {
    samples: 1,
    maxRssBytes: 1,
    maxEventLoopDelayMs: 1,
    blockerEvents: 0,
    digestMismatches: 0,
    crossBoardLeaks: 0
  },
  fixtures: null,
  coverage: 'complete',
  passed: true,
  ...overrides
});

describe('VVE-109 release gate harness contract', () => {
  it('requires an explicit profile and caps smoke work', () => {
    expect(() => parseReleaseGateArgs([])).toThrow(/--profile is required/);
    expect(parseReleaseGateArgs(['--profile', 'change', '--smoke', '--operations', '2000'])).toMatchObject({
      profile: 'change',
      smoke: true,
      operations: 80,
      durationMs: 15_000
    });
  });

  it('does not allow a shortened non-smoke 57-client soak', () => {
    expect(() => parseReleaseGateArgs(['--profile', 'soak', '--duration-ms', '60000'])).toThrow(/three hours/);
    expect(parseReleaseGateArgs(['--profile', 'soak', '--smoke', '--duration-ms', '60000'])).toMatchObject({
      profile: 'soak',
      smoke: true,
      durationMs: 60_000
    });
  });

  it('keeps the non-smoke change gate at its duration and operation floor', () => {
    expect(() => parseReleaseGateArgs(['--profile', 'change', '--duration-ms', '60000'])).toThrow(/five minutes/);
    expect(() => parseReleaseGateArgs(['--profile', 'change', '--operations', '99'])).toThrow(/1,000/);
    expect(parseReleaseGateArgs(['--profile', 'change'])).toMatchObject({ durationMs: 300_000, operations: 2_000 });
  });

  it('fails reports with blockers or digest divergence', () => {
    expect(() => assertGateReport(passingReport({ metrics: { ...passingReport().metrics, digestMismatches: 1 } }))).toThrow(/blocker|digest/);
    expect(() => assertGateReport(passingReport({ passed: false }))).toThrow(/not passing/);
  });

  it('does not let a short report claim the full soak', () => {
    expect(() => assertGateReport(passingReport({ profile: 'soak', smoke: false, durationMs: 60_000 }))).toThrow(/three hours/);
  });

  it('does not let smoke-only mature coverage claim a release gate', () => {
    expect(() => assertGateReport(passingReport({ profile: 'mature', smoke: false, coverage: 'smoke-only' }))).toThrow(/smoke-only/);
  });
});
