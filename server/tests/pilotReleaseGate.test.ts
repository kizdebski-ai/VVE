import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyAtomicReorder,
  assertCleanExit,
  assertGateReport,
  assertPortAvailable,
  backendLogBlocker,
  fetchJson,
  MutationLedger,
  parseReleaseGateArgs,
  runtimeHealth,
  stopChildProcess,
  type GateReport
} from '../scripts/pilotReleaseGate';

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
    samples: 3,
    maxRssBytes: 1,
    maxEventLoopDelayMs: 1,
    blockerEvents: 0,
    clientErrors: 0,
    digestMismatches: 0,
    crossBoardLeaks: 0,
    ackDigestReloadChecks: 0
  },
  fixtures: null,
  coverage: 'protocol',
  notCovered: { artifactImportExport: 'browser-owned' },
  passed: true,
  ...overrides
});

/** Spawn a child and resolve only once its SIGTERM handler is installed. */
const spawnWithSigtermHandler = async (handler: string): Promise<ReturnType<typeof spawn>> => {
  const child = spawn(process.execPath, ['-e', `process.on("SIGTERM", ${handler}); console.log("ready"); setInterval(() => {}, 1000);`], {
    stdio: ['ignore', 'pipe', 'ignore']
  });
  await new Promise<void>((resolvePromise) => child.stdout?.once('data', () => resolvePromise()));
  child.stdout?.resume();
  return child;
};

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
    expect(() => assertGateReport(passingReport({ metrics: { ...passingReport().metrics, clientErrors: 1 } }))).toThrow(/client/);
    expect(() => assertGateReport(passingReport({ passed: false }))).toThrow(/not passing/);
  });

  it('applies a reorder as one Yjs transaction', () => {
    const doc = new Y.Doc();
    const drawings = doc.getArray<Y.Map<unknown>>('drawings');
    const first = new Y.Map<unknown>();
    first.set('id', 'a');
    const second = new Y.Map<unknown>();
    second.set('id', 'b');
    drawings.push([first, second]);
    let transactions = 0;
    doc.on('afterTransaction', () => { transactions += 1; });
    applyAtomicReorder(doc, drawings, ['b', 'a']);
    expect(transactions).toBe(1);
    expect(drawings.toArray().map((entry) => entry.get('id'))).toEqual(['b', 'a']);
    doc.destroy();
  });

  it.each([
    ['an unknown id', ['b', 'x']],
    ['a missing id', ['b']],
    ['a duplicated id', ['b', 'b']]
  ])('refuses a reorder with %s instead of dropping objects', (_case, ids) => {
    const doc = new Y.Doc();
    const drawings = doc.getArray<Y.Map<unknown>>('drawings');
    for (const id of ['a', 'b']) {
      const entry = new Y.Map<unknown>();
      entry.set('id', id);
      drawings.push([entry]);
    }
    expect(() => applyAtomicReorder(doc, drawings, ids)).toThrow(/every board object exactly once/);
    expect(drawings.toArray().map((entry) => entry.get('id'))).toEqual(['a', 'b']);
    doc.destroy();
  });

  it('never credits a command with an earlier acknowledgement', async () => {
    const denials: string[] = [];
    const ledger = new MutationLedger((id) => denials.push(id));
    const first = ledger.settle(() => { ledger.sent('op-1'); return true; }, 200);
    ledger.acknowledge('op-1', 'digest-1');
    await expect(first).resolves.toBe('digest-1');
    // A command that sends nothing must not reuse op-1's ACK.
    await expect(ledger.settle(() => true, 200)).rejects.toThrow(/sent no mutation/);
    await expect(ledger.settle(() => false, 200)).resolves.toBeNull();
    const next = ledger.settle(() => { ledger.sent('op-2'); return true; }, 200);
    ledger.acknowledge('op-2', 'digest-2');
    await expect(next).resolves.toBe('digest-2');
    expect(denials).toEqual([]);
  });

  it('counts every denial of an intended-valid operation, not only the latest one', async () => {
    const denials: string[] = [];
    const ledger = new MutationLedger((id, reason) => denials.push(`${id}:${reason}`));
    const settled = ledger.settle(() => { ledger.sent('op-1'); ledger.sent('op-2'); return true; }, 200);
    ledger.deny('op-1', 'invalidObject');
    ledger.acknowledge('op-2', 'digest-2');
    await expect(settled).rejects.toThrow(/denied operation op-1/);
    ledger.deny('background-op', 'resource');
    ledger.expectDenial('intended-invalid');
    ledger.deny('intended-invalid', 'invalidObject');
    await expect(ledger.response('intended-invalid', 200)).resolves.toEqual({ acknowledged: false, reason: 'invalidObject' });
    expect(denials).toEqual(['op-1:invalidObject', 'background-op:resource']);
  });

  it('reads runtime counters strictly and exposes every blocker source', () => {
    const snapshot = {
      eventsLost: 0,
      errors: { persistence: 1, unhandled: 2 },
      memory: { rssBytes: 10, heapUsedBytes: 5 },
      eventLoopDelayMs: { p95: 3 },
      connections: 4,
      boards: 1
    };
    expect(runtimeHealth(snapshot)).toEqual({ blockers: 3, rssBytes: 10, heapUsedBytes: 5, eventLoopP95Ms: 3, connections: 4, boards: 1 });
    expect(() => runtimeHealth({ ...snapshot, errors: undefined })).toThrow(/missing/);
    expect(() => runtimeHealth({ ...snapshot, memory: {} })).toThrow(/missing/);
  });

  it('classifies error-level backend log lines as blockers', () => {
    const event = (name: string, dimensions: Record<string, unknown> = {}): string =>
      JSON.stringify({ v: 1, kind: 'event', name, sequence: 1, at: 'now', correlationId: null, dimensions });
    expect(backendLogBlocker(event('persistence.error', { stage: 'drain' }))).toMatch(/persistence\.error/);
    expect(backendLogBlocker(event('internal.loss'))).toBeTruthy();
    expect(backendLogBlocker(event('session.close', { reason: 'internal' }))).toBeTruthy();
    expect(backendLogBlocker(event('session.close', { reason: 'socket closed', remaining: 3 }))).toBeNull();
    expect(backendLogBlocker(event('process.phase', { phase: 'uncaughtException' }))).toBeTruthy();
    expect(backendLogBlocker(event('process.phase', { phase: 'stopped', clean: false }))).toBeTruthy();
    expect(backendLogBlocker(JSON.stringify({ level: 'error', msg: 'x' }))).toBeTruthy();
    expect(backendLogBlocker('[2026-09-26T00:00:00.000Z] [ERROR] Runtime stop failed {"error":"boom"}')).toBeTruthy();
    expect(backendLogBlocker('TypeError: cannot read properties of undefined')).toBeTruthy();
    expect(backendLogBlocker('[2026-09-26T00:00:00.000Z] [ERROR] token=abc123 leaked')).not.toMatch(/abc123/);
    expect(backendLogBlocker(event('process.phase', { phase: 'stopped', clean: true }))).toBeNull();
    expect(backendLogBlocker(event('resource.denial', { reason: 'payload' }))).toBeNull();
    expect(backendLogBlocker(event('session.close', { code: 1000 }))).toBeNull();
    expect(backendLogBlocker('[2026-09-26T00:00:00.000Z] [INFO] Runtime stop report {"clean":true}')).toBeNull();
    expect(backendLogBlocker('(node:1) ExperimentalWarning: something')).toBeNull();
  });

  it('accepts only a clean SIGTERM exit from the backend', () => {
    expect(() => assertCleanExit({ code: 0, signal: null, escalated: false }, 'restart')).not.toThrow();
    expect(() => assertCleanExit({ code: 1, signal: null, escalated: false }, 'restart')).toThrow(/not clean/);
    expect(() => assertCleanExit({ code: null, signal: 'SIGKILL', escalated: true }, 'restart')).toThrow(/sigkill=true/);
  });

  it('requires runtime samples around every restart and a browser-owned artifact declaration', () => {
    expect(() => assertGateReport(passingReport({ metrics: { ...passingReport().metrics, samples: 2 } }))).toThrow(/runtime samples/);
    expect(() => assertGateReport(passingReport({ metrics: { ...passingReport().metrics, maxRssBytes: 0 } }))).toThrow(/runtime samples/);
    expect(() => assertGateReport(passingReport({ notCovered: undefined as unknown as GateReport['notCovered'] }))).toThrow(/browser-owned/);
  });

  it('does not let a short report claim the full soak', () => {
    expect(() => assertGateReport(passingReport({ profile: 'soak', smoke: false, durationMs: 60_000 }))).toThrow(/three hours/);
  });

  it('does not let smoke-only mature coverage claim a release gate', () => {
    expect(() => assertGateReport(passingReport({ profile: 'mature', smoke: false, coverage: 'smoke-only' }))).toThrow(/smoke-only/);
  });

  it('fails port preflight while the port is occupied', async () => {
    const listener = createServer();
    await new Promise<void>((resolvePromise) => listener.listen(0, '127.0.0.1', resolvePromise));
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('Test listener did not expose a port.');
    try {
      await expect(assertPortAvailable(address.port)).rejects.toThrow(/unavailable/);
    } finally {
      await new Promise<void>((resolvePromise) => listener.close(() => resolvePromise()));
    }
  });

  it('bounds both fetch and response-body reads with one timeout signal', async () => {
    const listener = createHttpServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{"ready":');
      setTimeout(() => response.end('true}'), 100);
    });
    await new Promise<void>((resolvePromise) => listener.listen(0, '127.0.0.1', resolvePromise));
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('Test listener did not expose a port.');
    try {
      await expect(fetchJson(`http://127.0.0.1:${address.port}`, '/', undefined, 20)).rejects.toThrow();
    } finally {
      listener.close();
    }
  });

  it('waits for the child exit after the SIGKILL fallback', async () => {
    const child = await spawnWithSigtermHandler('() => {}');
    await expect(stopChildProcess(child, 50, 1_000)).resolves.toEqual({ code: null, signal: 'SIGKILL', escalated: true });
    expect(child.exitCode).toBeNull();
    expect(child.signalCode).toBe('SIGKILL');
  });

  it('reports a clean exit when the child drains on SIGTERM', async () => {
    const child = await spawnWithSigtermHandler('() => process.exit(0)');
    await expect(stopChildProcess(child, 2_000, 1_000)).resolves.toEqual({ code: 0, signal: null, escalated: false });
  });
});
