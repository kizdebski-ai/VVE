import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import type { Knex } from 'knex';
import pg from 'pg';
import knex from 'knex';
import request from 'supertest';
import WebSocket from 'ws';
import * as Y from 'yjs';

const { schemaName, adminPassphrase, databaseUrl } = vi.hoisted(() => {
  const base =
    process.env.PILOT_RUNTIME_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgres://vve:vve-test@127.0.0.1:5432/vve_test';
  const name = `vve_runtime_test_${process.pid}`;
  const url = new URL(base);
  url.searchParams.set('options', `-c search_path=${name},public`);
  process.env.DATABASE_URL = url.toString();
  process.env.ADMIN_PASSPHRASE = 'runtime-admin-passphrase';
  process.env.TEACHER_SESSION_SECRET = 'runtime-teacher-session-secret';
  process.env.ADMIN_SESSION_SECRET = 'runtime-admin-session-secret';
  process.env.BOARD_WS_SECRET = 'runtime-board-ws-secret';
  process.env.TEACHER_APP_BASE_URL = 'http://app.test';
  return {
    schemaName: name,
    adminPassphrase: process.env.ADMIN_PASSPHRASE,
    databaseUrl: url.toString()
  };
});

import {
  createRuntimeControl,
  RuntimeControlFailure,
  snapshotIsContentFree,
  type RuntimeControlConfig
} from '../src/pilot/runtimeControl';
import { createOperationalSignals } from '../src/pilot/operationalSignals';
import { InMemoryBoardDocumentStore, createCollaborationRuntime } from '../src/pilot/collaborationRuntime';
import { isProcessEntrypoint } from '../src/server';
import { driveCurrentStackLessonFlow } from './helpers/currentStackFlow';

const localPostgresAvailable = async (): Promise<boolean> => {
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 1_500 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    await client.end().catch(() => undefined);
    return false;
  }
};

const hasPostgres = await localPostgresAvailable();

const testConfig = (overrides: Partial<RuntimeControlConfig> = {}): RuntimeControlConfig => ({
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 0,
  databaseUrl: 'postgres://injected',
  adminPassphrase: 'runtime-admin-passphrase',
  teacherSessionSecret: 'runtime-teacher-session-secret',
  adminSessionSecret: 'runtime-admin-session-secret',
  dataDir: path.join('/tmp', `vve-108-${process.pid}`),
  pingIntervalMs: 60_000,
  roomTtlMs: 60_000,
  pilotEnvironment: 'pilot',
  devSurface: false,
  ...overrides
});

const fakeDb = {
  raw: async () => ({ rows: [{ ok: 1 }] }),
  destroy: async () => undefined,
  migrate: { latest: async () => undefined }
} as unknown as Knex;

const adapters = () => ({
  createDatabase: () => fakeDb,
  migrate: async () => undefined,
  probe: async () => ({ database: true, persistence: true }),
  createStore: () => new InMemoryBoardDocumentStore()
});

describe('RuntimeControl process lifecycle', () => {
  it('does not start or exit as a side effect of importing the process Adapter', () => {
    expect(isProcessEntrypoint()).toBe(false);
    const source = readFileSync(path.resolve(__dirname, '../src/server.ts'), 'utf8');
    // The Module (RuntimeControl) never exits; the process Adapter owns the
    // final exit, only as a bounded step after stop() has reported.
    expect(source).toMatch(/EXIT_AFTER_STOP_MS/);
    const exitCalls = source.match(/process\.exit\s*\(/g) ?? [];
    expect(exitCalls.length).toBeGreaterThan(0);
    for (const match of source.matchAll(/setTimeout\(\(\) => process\.exit\([^)]*\), EXIT_AFTER_STOP_MS\)/g)) {
      expect(match[0]).toContain('EXIT_AFTER_STOP_MS');
    }
    expect(source).not.toMatch(/server\.listen\s*\(/);
    const moduleSource = readFileSync(path.resolve(__dirname, '../src/pilot/runtimeControl.ts'), 'utf8');
    expect(moduleSource).not.toMatch(/process\.exit\s*\(/);
  });

  it('fails before listening when required configuration is missing', async () => {
    let listened = false;
    const signals = createOperationalSignals({ emitJson: false });
    const runtime = createRuntimeControl({
      signals,
      config: testConfig({ databaseUrl: undefined, nodeEnv: 'production', adminPassphrase: undefined }),
      createDatabase: () => fakeDb,
      listen: async () => {
        listened = true;
        return 0;
      }
    });

    await expect(runtime.start()).rejects.toBeInstanceOf(RuntimeControlFailure);
    await expect(runtime.start()).rejects.toMatchObject({ kind: 'invalid-configuration' });
    expect(listened).toBe(false);
    expect(runtime.status().phase).toBe('failed');
    expect(runtime.status().ready).toBe(false);
    expect(signals.recorded().some((event) => event.dimensions.kind === 'invalid-configuration')).toBe(true);
  });

  it('fails before listening when the database cannot be reached', async () => {
    let listened = false;
    const runtime = createRuntimeControl({
      signals: createOperationalSignals({ emitJson: false }),
      config: testConfig(),
      createDatabase: () => {
        throw new Error('ECONNREFUSED');
      },
      listen: async () => {
        listened = true;
        return 0;
      }
    });
    await expect(runtime.start()).rejects.toMatchObject({ kind: 'dependency-unavailable' });
    expect(listened).toBe(false);
  });

  it('fails before listening when migrations fail', async () => {
    let listened = false;
    const runtime = createRuntimeControl({
      signals: createOperationalSignals({ emitJson: false }),
      config: testConfig(),
      createDatabase: () => fakeDb,
      migrate: async () => {
        throw new Error('migration exploded');
      },
      listen: async () => {
        listened = true;
        return 0;
      }
    });
    await expect(runtime.start()).rejects.toMatchObject({ kind: 'migration-failed' });
    expect(listened).toBe(false);
  });

  it('fails with listener-failed when the port cannot bind', async () => {
    const runtime = createRuntimeControl({
      signals: createOperationalSignals({ emitJson: false }),
      config: testConfig(),
      ...adapters(),
      listen: async () => {
        throw new Error('EADDRINUSE');
      }
    });
    await expect(runtime.start()).rejects.toMatchObject({ kind: 'listener-failed' });
    expect(runtime.status().ready).toBe(false);
  });

  it('separates liveness from readiness, samples soak metrics, and stops idempotently', async () => {
    const signals = createOperationalSignals({ emitJson: false });
    const runtime = createRuntimeControl({
      signals,
      config: testConfig(),
      createDatabase: () => fakeDb,
      migrate: async () => undefined,
      probe: async () => ({ database: true, persistence: true }),
      createStore: () => new InMemoryBoardDocumentStore()
    });

    const running = await runtime.start();
    const again = await runtime.start();
    expect(again.port).toBe(running.port);

    const live = await request(`http://127.0.0.1:${running.port}`).get('/live');
    expect(live.status).toBe(200);
    expect(live.body.live).toBe(true);

    const ready = await request(`http://127.0.0.1:${running.port}`).get('/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.ready).toBe(true);
    expect(ready.body.checks).toEqual({ database: true, persistence: true });
    expect(snapshotIsContentFree(ready.body.soak)).toBe(true);

    const health = await request(`http://127.0.0.1:${running.port}`).get('/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');
    expect(health.body).not.toHaveProperty('rooms');

    expect(runtime.status().resources.timers.length).toBeGreaterThan(0);
    expect(runtime.status().resources.listeners).toEqual(['http', 'ws']);

    const first = await runtime.stop({ reason: 'test-stop', deadline: new Date(Date.now() + 5_000) });
    expect(first.clean).toBe(true);
    expect(first.timersStopped).toBe(true);
    expect(runtime.status().resources.timers).toEqual([]);
    expect(runtime.status().live).toBe(false);
    expect(runtime.status().ready).toBe(false);

    const second = await runtime.stop({ reason: 'test-stop-again', deadline: new Date(Date.now() + 5_000) });
    expect(second).toEqual(first);

    await expect(request(`http://127.0.0.1:${running.port}`).get('/live')).rejects.toThrow();
  });

  it('rejects new WebSocket admissions while draining', async () => {
    const runtime = createRuntimeControl({
      signals: createOperationalSignals({ emitJson: false }),
      config: testConfig(),
      createDatabase: () => fakeDb,
      migrate: async () => undefined,
      probe: async () => ({ database: true, persistence: true }),
      createStore: () => new InMemoryBoardDocumentStore(),
      createCollaboration: (store) => {
        const inner = createCollaborationRuntime({ store });
        return {
          ...inner,
          drain: async (input) => {
            await new Promise((resolve) => setTimeout(resolve, 250));
            return inner.drain(input);
          }
        };
      }
    });
    const running = await runtime.start();
    const stopping = runtime.stop({
      reason: 'controlled restart',
      deadline: new Date(Date.now() + 5_000)
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    const ready = await request(`http://127.0.0.1:${running.port}`).get('/ready');
    expect(ready.status).toBe(503);
    const live = await request(`http://127.0.0.1:${running.port}`).get('/live');
    expect(live.status).toBe(200);

    const code = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${running.port}/ws/whiteboard/11111111-1111-4111-8111-111111111111`);
      socket.on('close', (closeCode) => resolve(closeCode));
      socket.on('error', reject);
    });
    expect(code).toBe(1013);

    const report = await stopping;
    expect(report.listenersClosed).toBe(true);
  });

  it('re-evaluates readiness when dependencies fail and recover (108-R1)', async () => {
    let dbDown = false;
    const mutableDb = {
      raw: async () => {
        if (dbDown) throw new Error('terminal checkout failure');
        return { rows: [{ ok: 1, ro: 'off', in_recovery: false }] };
      },
      destroy: async () => undefined,
      migrate: { latest: async () => undefined }
    } as unknown as Knex;
    const runtime = createRuntimeControl({
      signals: createOperationalSignals({ emitJson: false }),
      config: testConfig(),
      createDatabase: () => mutableDb,
      migrate: async () => undefined,
      createStore: () => new InMemoryBoardDocumentStore()
    });

    const running = await runtime.start();
    const before = await request(`http://127.0.0.1:${running.port}`).get('/ready');
    expect(before.status).toBe(200);
    expect(before.body.checks).toEqual({ database: true, persistence: true });

    dbDown = true;
    const lostAt = Date.now();
    const during = await request(`http://127.0.0.1:${running.port}`).get('/ready');
    expect(during.status).toBe(503);
    expect(during.body.checks.database).toBe(false);
    // Dependency loss surfaces within the documented probe bound (1s + scheduling).
    expect(Date.now() - lostAt).toBeLessThan(1_500);
    expect(runtime.status().ready).toBe(false);

    dbDown = false;
    const after = await request(`http://127.0.0.1:${running.port}`).get('/ready');
    expect(after.status).toBe(200);
    expect(after.body.checks).toEqual({ database: true, persistence: true });
    expect(runtime.status().ready).toBe(true);

    await runtime.stop({ reason: 'test-stop', deadline: new Date(Date.now() + 5_000) });
  });

  it('does not pass readiness while a dependency hangs, bounded by the probe deadline (108-R1)', async () => {
    let hang = false;
    const runtime = createRuntimeControl({
      signals: createOperationalSignals({ emitJson: false }),
      config: testConfig(),
      createDatabase: () => fakeDb,
      migrate: async () => undefined,
      probe: async ({ signal }) => {
        if (!hang) return { database: true, persistence: true };
        await new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('probe cancelled')), { once: true });
        });
        return { database: false, persistence: false };
      },
      createStore: () => new InMemoryBoardDocumentStore()
    });
    const running = await runtime.start();
    hang = true;
    const t0 = Date.now();
    const res = await request(`http://127.0.0.1:${running.port}`).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.checks.database).toBe(false);
    // A never-settling dependency is bounded by the 1s probe deadline.
    expect(Date.now() - t0).toBeLessThan(1_300);
    hang = false;
    const recovered = await request(`http://127.0.0.1:${running.port}`).get('/ready');
    expect(recovered.status).toBe(200);
    await runtime.stop({ reason: 'test-stop', deadline: new Date(Date.now() + 5_000) });
  });

  it('serializes probes and prevents an older result from overwriting a newer state', async () => {
    let calls = 0;
    let releaseSlowProbe!: () => void;
    const slowProbe = new Promise<void>((resolve) => { releaseSlowProbe = resolve; });
    const runtime = createRuntimeControl({
      signals: createOperationalSignals({ emitJson: false }),
      config: testConfig(),
      createDatabase: () => fakeDb,
      migrate: async () => undefined,
      probe: async () => {
        calls += 1;
        if (calls === 1) return { database: true, persistence: true };
        if (calls === 2) {
          await slowProbe;
          return { database: false, persistence: false };
        }
        return { database: true, persistence: true };
      },
      createStore: () => new InMemoryBoardDocumentStore()
    });
    const running = await runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 460));
    expect(calls).toBe(2);
    expect(runtime.status().ready).toBe(true);

    releaseSlowProbe();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runtime.status().ready).toBe(false);
    await runtime.stop({ reason: 'test-stop', deadline: new Date(Date.now() + 5_000) });
  });

  it('keeps a timed-out readiness probe single-flight until its dependency work settles', async () => {
    let calls = 0;
    let releaseSlowProbe!: () => void;
    const slowProbe = new Promise<void>((resolve) => { releaseSlowProbe = resolve; });
    const runtime = createRuntimeControl({
      signals: createOperationalSignals({ emitJson: false }),
      config: testConfig(),
      createDatabase: () => fakeDb,
      migrate: async () => undefined,
      probe: async () => {
        calls += 1;
        if (calls === 1) return { database: true, persistence: true };
        await slowProbe;
        return { database: true, persistence: true };
      },
      createStore: () => new InMemoryBoardDocumentStore()
    });

    const running = await runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(calls).toBe(2);

    // The one-second response deadline must not release the underlying probe.
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const [first, second] = await Promise.all([
      request(`http://127.0.0.1:${running.port}`).get('/ready'),
      request(`http://127.0.0.1:${running.port}`).get('/ready')
    ]);
    expect(first.status).toBe(503);
    expect(second.status).toBe(503);
    expect(calls).toBe(2);

    releaseSlowProbe();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await runtime.stop({ reason: 'test-stop', deadline: new Date(Date.now() + 5_000) });
  });

  it('does not pass initial readiness when the database is read-only (108-R1)', async () => {
    const readOnlyDb = {
      raw: async () => ({ rows: [{ ok: 1, ro: 'on', in_recovery: false }] }),
      destroy: async () => undefined,
      migrate: { latest: async () => undefined }
    } as unknown as Knex;
    const runtime = createRuntimeControl({
      signals: createOperationalSignals({ emitJson: false }),
      config: testConfig(),
      createDatabase: () => readOnlyDb,
      migrate: async () => undefined,
      createStore: () => new InMemoryBoardDocumentStore()
    });
    await expect(runtime.start()).rejects.toMatchObject({ kind: 'dependency-unavailable' });
    expect(runtime.status().ready).toBe(false);
    expect(runtime.status().lastError?.message).toContain('read-only');
  });

  it('fails initial readiness when the persisted collaboration layer rejects hydration (108-R1)', async () => {
    const runtime = createRuntimeControl({
      signals: createOperationalSignals({ emitJson: false }),
      config: testConfig(),
      createDatabase: () => fakeDb,
      migrate: async () => undefined,
      createStore: () => new InMemoryBoardDocumentStore(),
      probe: async () => {
        throw new Error('collaboration hydration rejected');
      }
    });
    await expect(runtime.start()).rejects.toMatchObject({ kind: 'dependency-unavailable' });
    expect(runtime.status().resources.timers).toEqual([]);
    expect(runtime.status().resources.pools).toEqual([]);
  });

  it('cleans up every partial resource when a startup component throws (108-R1)', async () => {
    const runtime = createRuntimeControl({
      signals: createOperationalSignals({ emitJson: false }),
      config: testConfig(),
      ...adapters(),
      createCollaboration: () => {
        throw new Error('component exploded during construction');
      }
    });
    await expect(runtime.start()).rejects.toMatchObject({ kind: 'dependency-unavailable' });
    expect(runtime.status().lastError?.message).toContain('component exploded');
    expect(runtime.status().phase).toBe('failed');
    expect(runtime.status().resources.timers).toEqual([]);
    expect(runtime.status().resources.listeners).toEqual([]);
    expect(runtime.status().resources.pools).toEqual([]);
    // A retry after cleanup is possible instead of leaking a stuck phase.
    const retry = createRuntimeControl({
      signals: createOperationalSignals({ emitJson: false }),
      config: testConfig(),
      ...adapters()
    });
    const running = await retry.start();
    expect(running.port).toBeGreaterThan(0);
    await retry.stop({ reason: 'test-stop', deadline: new Date(Date.now() + 5_000) });
  });

  it('returns a failed report by the deadline when drain never settles (108-R2)', async () => {
    const runtime = createRuntimeControl({
      signals: createOperationalSignals({ emitJson: false }),
      config: testConfig(),
      ...adapters(),
      createCollaboration: (store) => {
        const inner = createCollaborationRuntime({ store });
        return {
          ...inner,
          drain: () => new Promise<never>(() => {})
        };
      }
    });
    const running = await runtime.start();
    const t0 = Date.now();
    const report = await runtime.stop({
      reason: 'never-settling drain',
      deadline: new Date(t0 + 80)
    });
    const elapsed = Date.now() - t0;
    // Deadline (80ms) plus a small documented scheduling tolerance.
    expect(elapsed).toBeLessThan(80 + 500);
    expect(report.durationMs).toBeLessThan(80 + 500);
    expect(report.clean).toBe(false);
    expect(report.deadlineExceeded).toBe(true);
    expect(report.remaining).toContain('collaboration-drain');
    expect(report.remaining).toContain('deadline');
    expect(report.flushed).toBe(false);
  });

  it('aborts a slow drain at the shared deadline instead of waiting it out (108-R2)', async () => {
    const runtime = createRuntimeControl({
      signals: createOperationalSignals({ emitJson: false }),
      config: testConfig(),
      ...adapters(),
      createCollaboration: (store) => {
        const inner = createCollaborationRuntime({ store });
        return {
          ...inner,
          drain: async (input) => {
            // The prior review measured stop() waiting 402ms for a 400ms
            // drain under an 80ms deadline.
            await new Promise((resolve) => setTimeout(resolve, 400));
            return inner.drain(input);
          }
        };
      }
    });
    const running = await runtime.start();
    const t0 = Date.now();
    const report = await runtime.stop({
      reason: 'slow drain',
      deadline: new Date(t0 + 80)
    });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(380);
    expect(report.durationMs).toBeLessThan(380);
    expect(report.clean).toBe(false);
    expect(report.remaining).toContain('collaboration-drain');
  });

  it('cancels drain work at the deadline so no late operation runs after shutdown', async () => {
    let lateWork = false;
    let aborted = false;
    const runtime = createRuntimeControl({
      signals: createOperationalSignals({ emitJson: false }),
      config: testConfig(),
      ...adapters(),
      createCollaboration: (store) => {
        const inner = createCollaborationRuntime({ store });
        return {
          ...inner,
          drain: async ({ signal }) => {
            await new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, 250);
              signal?.addEventListener('abort', () => {
                aborted = true;
                clearTimeout(timer);
                resolve();
              }, { once: true });
            });
            if (!signal?.aborted) lateWork = true;
            return { boards: 0, connections: 0, complete: false };
          }
        };
      }
    });
    const running = await runtime.start();
    const report = await runtime.stop({
      reason: 'deadline safety',
      deadline: new Date(Date.now() + 80)
    });
    expect(report.clean).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(aborted).toBe(true);
    expect(lateWork).toBe(false);
    expect(running.status().phase).toBe('stopped');
  });

  it('reports deadline failures without claiming a clean shutdown', async () => {
    const runtime = createRuntimeControl({
      signals: createOperationalSignals({ emitJson: false }),
      config: testConfig(),
      ...adapters()
    });
    await runtime.start();
    const report = await runtime.stop({
      reason: 'expired deadline',
      deadline: new Date(Date.now() - 1)
    });
    expect(report.deadlineExceeded).toBe(true);
    expect(report.clean).toBe(false);
    expect(report.remaining).toContain('deadline');
  });
});

const encodeMutation = (operationId: string, update: Uint8Array): Buffer => {
  const id = Buffer.from(operationId);
  const payload = Buffer.alloc(2 + id.length + update.length);
  payload.writeUInt16BE(id.length, 0);
  id.copy(payload, 2);
  Buffer.from(update).copy(payload, 2 + id.length);
  return Buffer.concat([Buffer.from([12]), payload]);
};

/**
 * A canonical whiteboard rectangle, encoded exactly the way the production
 * client mutates the shared `drawings` collection — never a private side-map.
 */
const canonicalRectangleUpdate = (
  objectId: string,
  x: number,
  y: number,
  width: number,
  height: number
): Uint8Array => {
  const doc = new Y.Doc();
  const drawings = doc.getArray<Y.Map<unknown>>('drawings');
  const rect = new Y.Map<unknown>();
  rect.set('id', objectId);
  rect.set('type', 'rectangle');
  rect.set('x', x);
  rect.set('y', y);
  rect.set('width', width);
  rect.set('height', height);
  rect.set('color', '#1f2937');
  rect.set('lineWidth', 2);
  rect.set('timestamp', 1);
  drawings.push([rect]);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
};

const readDrawings = (state: Uint8Array): Array<Record<string, unknown>> => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const objects = doc
    .getArray<Y.Map<unknown>>('drawings')
    .map((entry) => JSON.parse(JSON.stringify(entry.toJSON())) as Record<string, unknown>);
  doc.destroy();
  return objects;
};

type RestartClient = {
  socket: WebSocket;
  drawings: Array<Record<string, unknown>>;
  digest: string | null;
  drainingAt: number | null;
  closed: { code: number } | null;
};

const openLiveStudent = (
  port: number,
  boardId: string,
  wsToken: string
): Promise<RestartClient> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/ws/whiteboard/${boardId}?wsToken=${encodeURIComponent(wsToken)}`
    );
    socket.binaryType = 'arraybuffer';
    const client: RestartClient = {
      socket,
      drawings: [],
      digest: null,
      drainingAt: null,
      closed: null
    };
    const timer = setTimeout(() => reject(new Error('timed out waiting for synchronization')), 10_000);
    socket.on('message', (raw) => {
      const bytes = Buffer.from(raw as Buffer);
      if (bytes[0] === 10) {
        client.drawings = readDrawings(new Uint8Array(bytes.subarray(1)));
      }
      if (bytes[0] === 14) {
        const payload = JSON.parse(bytes.subarray(1).toString()) as { digest: string };
        client.digest = payload.digest;
        clearTimeout(timer);
        resolve(client);
      }
      if (bytes[0] === 16 && client.drainingAt === null) {
        client.drainingAt = Date.now();
      }
    });
    socket.on('close', (code) => {
      client.closed = { code };
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

const acknowledgeCanonicalRectangle = (
  client: RestartClient,
  operationId: string,
  objectId: string,
  x: number,
  y: number
): Promise<{ digest: string }> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for acknowledgement')), 8_000);
    const onMessage = (raw: unknown) => {
      const bytes = Buffer.from(raw as Buffer);
      if (bytes[0] === 13) {
        const ack = JSON.parse(bytes.subarray(1).toString()) as { digest: string; operationId: string };
        if (ack.operationId !== operationId) return;
        clearTimeout(timer);
        client.socket.off('message', onMessage);
        resolve({ digest: ack.digest });
      }
    };
    client.socket.on('message', onMessage);
    client.socket.send(encodeMutation(operationId, canonicalRectangleUpdate(objectId, x, y, 120, 80)));
  });

describe.skipIf(!hasPostgres)('RuntimeControl controlled restart (PostgreSQL)', () => {
  // 108-S2 gate: REAL migrations (knex migrate.latest over the compiled
  // migrations-js directory, exactly like server/knexfile.ts), REAL canonical
  // drawings acknowledged by a live client socket, REAL process stop/start.
  // If no database is configured the gate reports its absence explicitly
  // instead of passing silently.
  let admin: pg.Client;
  let schemaKnex: Knex;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    await admin.query(`CREATE SCHEMA ${schemaName}`);
    schemaKnex = knex({
      client: 'pg',
      connection: { connectionString: databaseUrl },
      migrations: {
        directory: path.join(__dirname, '../migrations-js'),
        extension: 'js',
        loadExtensions: ['.js']
      }
    });
    const [, applied] = await schemaKnex.migrate.latest();
    // The gate runs on the REAL migration path; a run that applies nothing
    // would mean the fixture drifted from the shipped migrations.
    expect(applied.length).toBeGreaterThan(0);
  }, 30_000);

  afterAll(async () => {
    await schemaKnex?.destroy();
    await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`).catch(() => undefined);
    await admin.end();
  });

  it('restores acknowledged canonical work across two controlled restarts within 30 seconds', async () => {
    const cycle = async (proof: { objectId: string; operationId: string; x: number; y: number }): Promise<void> => {
      const started = Date.now();
      const startRuntime = async () =>
        createRuntimeControl({
          signals: createOperationalSignals({ emitJson: false }),
          config: testConfig({ databaseUrl, adminPassphrase }),
          createDatabase: () => schemaKnex
          // No `migrate` injection: the REAL knex migration path runs on every
          // start, exactly like the deployed process.
        });

      const runtime = await startRuntime();
      const running = await runtime.start();
      const flow = await driveCurrentStackLessonFlow(`http://127.0.0.1:${running.port}` as never, {
        adminPassphrase,
        teacherEmail: `runtime-108-${process.pid}@test.local`,
        boardTitle: 'Runtime recovery',
        studentLabel: 'Runtime Student'
      });

      // A live client stays connected across the whole controlled restart.
      const live = await openLiveStudent(running.port, flow.boardId, flow.studentBoard.wsToken);
      expect(live.digest).toMatch(/^[a-f0-9]+$/i);

      const acknowledged = await acknowledgeCanonicalRectangle(
        live,
        proof.operationId,
        proof.objectId,
        proof.x,
        proof.y
      );
      expect(acknowledged.digest).toMatch(/^[a-f0-9]+$/i);

      // Controlled stop: the live client must see the draining (read-only)
      // signal within 2 seconds of the stop beginning.
      const stopStarted = Date.now();
      const stopping = runtime.stop({
        reason: 'controlled restart',
        deadline: new Date(stopStarted + 8_000)
      });
      const sawDraining = await new Promise<number>((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error('client never saw serverDraining')), 5_000);
        const check = setInterval(() => {
          if (live.drainingAt !== null) {
            clearInterval(check);
            clearTimeout(deadline);
            resolve(live.drainingAt - stopStarted);
          }
        }, 10);
      });
      expect(sawDraining).toBeLessThan(2_000);

      const stopped = await stopping;
      expect(stopped.flushed).toBe(true);
      expect(live.closed?.code).toBe(1012);
      live.socket.terminate();

      // Restart on the SAME database: readiness, reconnect and digest parity.
      const restartedRuntime = await startRuntime();
      const runningAgain = await restartedRuntime.start();
      const reconnectStarted = Date.now();
      const ready = await request(`http://127.0.0.1:${runningAgain.port}`).get('/ready');
      expect(ready.status).toBe(200);

      const recovered = await openLiveStudent(
        runningAgain.port,
        flow.boardId,
        flow.studentBoard.wsToken
      );
      const reconnectMs = Date.now() - reconnectStarted;
      expect(reconnectMs).toBeLessThan(5_000);

      // The canonical rectangle survived with no acknowledged loss, and the
      // durable digest equals the acknowledged digest from before the stop.
      const rectangle = recovered.drawings.find((object) => object.id === proof.objectId);
      expect(rectangle).toMatchObject({
        type: 'rectangle',
        x: proof.x,
        y: proof.y,
        width: 120,
        height: 80
      });
      expect(recovered.digest).toBe(acknowledged.digest);

      await restartedRuntime.stop({ reason: 'cycle complete', deadline: new Date(Date.now() + 5_000) });
      expect(Date.now() - started).toBeLessThan(30_000);
    };

    await cycle({ objectId: 'rect-proof-one', operationId: 'op-proof-one', x: 10, y: 20 });
    await cycle({ objectId: 'rect-proof-two', operationId: 'op-proof-two', x: 140, y: 60 });
  });
});
