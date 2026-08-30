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

import { up as initialSchemaUp } from '../migrations/20241129000000_initial_schema';
import { up as permanentTokenUp } from '../migrations/20241207000000_add_teacher_permanent_token';
import { up as capabilityAccessUp } from '../migrations/20260829000000_capability_access';
import { up as boardLifecycleUp } from '../migrations/20260830000000_board_lifecycle';
import { up as collaborationUp } from '../migrations/20260830010000_acknowledged_collaboration';
import { up as operationReceiptsUp } from '../migrations/20260830011000_operation_receipts';
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
    expect(source).not.toMatch(/process\.exit\s*\(/);
    expect(source).not.toMatch(/server\.listen\s*\(/);
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

const lessonUpdate = (key: string, value: string): Uint8Array => {
  const doc = new Y.Doc();
  doc.getMap('lesson').set(key, value);
  return Y.encodeStateAsUpdate(doc);
};

const connectAndAcknowledge = async (
  port: number,
  boardId: string,
  wsToken: string,
  operationId: string,
  key: string,
  value: string
): Promise<{ digest: string; lesson: Record<string, unknown> }> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/whiteboard/${boardId}?wsToken=${encodeURIComponent(wsToken)}`);
    socket.binaryType = 'arraybuffer';
    let lesson: Record<string, unknown> = {};
    const timer = setTimeout(() => reject(new Error('timed out waiting for acknowledgement')), 8_000);
    socket.on('message', (raw) => {
      const bytes = Buffer.from(raw as Buffer);
      if (bytes[0] === 10) {
        const doc = new Y.Doc();
        Y.applyUpdate(doc, bytes.subarray(1));
        lesson = doc.getMap('lesson').toJSON();
        doc.destroy();
      }
      if (bytes[0] === 14) {
        socket.send(encodeMutation(operationId, lessonUpdate(key, value)));
      }
      if (bytes[0] === 13) {
        const ack = JSON.parse(bytes.subarray(1).toString()) as { digest: string; operationId: string };
        clearTimeout(timer);
        socket.close();
        resolve({ digest: ack.digest, lesson: { ...lesson, [key]: value } });
      }
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

describe.skipIf(!hasPostgres)('RuntimeControl controlled restart (PostgreSQL)', () => {
  let admin: pg.Client;
  let schemaKnex: Knex;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    await admin.query(`CREATE SCHEMA ${schemaName}`);
    schemaKnex = knex({ client: 'pg', connection: { connectionString: databaseUrl } });
    await initialSchemaUp(schemaKnex);
    await permanentTokenUp(schemaKnex);
    await capabilityAccessUp(schemaKnex);
    await boardLifecycleUp(schemaKnex);
    await collaborationUp(schemaKnex);
    await operationReceiptsUp(schemaKnex);
  });

  afterAll(async () => {
    await schemaKnex?.destroy();
    await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`).catch(() => undefined);
    await admin.end();
  });

  it('restores acknowledged work across two controlled restarts within 30 seconds', async () => {
    const cycle = async (proofKey: string): Promise<number> => {
      const started = Date.now();
      const signals = createOperationalSignals({ emitJson: false });
      const runtime = createRuntimeControl({
        signals,
        config: testConfig({ databaseUrl, adminPassphrase }),
        createDatabase: () => schemaKnex,
        migrate: async () => undefined
      });
      const running = await runtime.start();
      const flow = await driveCurrentStackLessonFlow(`http://127.0.0.1:${running.port}` as never, {
        adminPassphrase,
        teacherEmail: `runtime-108-${process.pid}@test.local`,
        boardTitle: 'Runtime recovery',
        studentLabel: 'Runtime Student'
      });

      const acknowledged = await connectAndAcknowledge(
        running.port,
        flow.boardId,
        flow.studentBoard.wsToken,
        `op-${proofKey}`,
        proofKey,
        'kept'
      );
      expect(acknowledged.digest).toMatch(/^[a-f0-9]+$/i);

      const stopped = await runtime.stop({
        reason: 'controlled restart',
        deadline: new Date(Date.now() + 8_000)
      });
      expect(stopped.flushed).toBe(true);

      const restarted = createRuntimeControl({
        signals: createOperationalSignals({ emitJson: false }),
        config: testConfig({ databaseUrl, adminPassphrase }),
        createDatabase: () => schemaKnex,
        migrate: async () => undefined
      });
      const runningAgain = await restarted.start();
      const ready = await request(`http://127.0.0.1:${runningAgain.port}`).get('/ready');
      expect(ready.status).toBe(200);

      const flowAgain = await driveCurrentStackLessonFlow(`http://127.0.0.1:${runningAgain.port}` as never, {
        adminPassphrase,
        teacherEmail: `runtime-108-${process.pid}@test.local`
      });
      const recovered = await new Promise<{ digest: string; lesson: Record<string, unknown> }>((resolve, reject) => {
        const socket = new WebSocket(
          `ws://127.0.0.1:${runningAgain.port}/ws/whiteboard/${flowAgain.boardId}?wsToken=${encodeURIComponent(flowAgain.studentBoard.wsToken)}`
        );
        socket.binaryType = 'arraybuffer';
        let lesson: Record<string, unknown> = {};
        const timer = setTimeout(() => reject(new Error('timed out recovering digest')), 8_000);
        socket.on('message', (raw) => {
          const bytes = Buffer.from(raw as Buffer);
          if (bytes[0] === 10) {
            const doc = new Y.Doc();
            Y.applyUpdate(doc, bytes.subarray(1));
            lesson = doc.getMap('lesson').toJSON();
            doc.destroy();
          }
          if (bytes[0] === 14) {
            const payload = JSON.parse(bytes.subarray(1).toString()) as { digest: string };
            clearTimeout(timer);
            socket.close();
            resolve({ digest: payload.digest, lesson });
          }
        });
        socket.on('error', reject);
      });

      expect(recovered.lesson[proofKey]).toBe('kept');
      expect(recovered.digest).toBe(acknowledged.digest);
      await restarted.stop({ reason: 'cycle complete', deadline: new Date(Date.now() + 5_000) });
      return Date.now() - started;
    };

    const first = await cycle('proof-one');
    const second = await cycle('proof-two');
    expect(first).toBeLessThan(30_000);
    expect(second).toBeLessThan(30_000);
  });
});
