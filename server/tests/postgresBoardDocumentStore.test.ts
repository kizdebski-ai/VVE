import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import knex, { type Knex } from 'knex';
import pg from 'pg';
import * as Y from 'yjs';

const { schemaName, databaseUrl } = vi.hoisted(() => {
  const base =
    process.env.PILOT_COLLABORATION_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgres://vve:vve-test@127.0.0.1:5433/vve_test';
  const name = `vve_collaboration_test_${process.pid}`;
  const url = new URL(base);
  url.searchParams.set('options', `-c search_path=${name},public`);
  return { schemaName: name, databaseUrl: url.toString() };
});

import { up as initialSchemaUp } from '../migrations/20241129000000_initial_schema';
import { up as permanentTokenUp } from '../migrations/20241207000000_add_teacher_permanent_token';
import { up as capabilityAccessUp } from '../migrations/20260829000000_capability_access';
import { up as boardLifecycleUp } from '../migrations/20260830000000_board_lifecycle';
import { up as collaborationUp } from '../migrations/20260830010000_acknowledged_collaboration';
import { up as operationReceiptsUp } from '../migrations/20260830011000_operation_receipts';
import { createPostgresBoardDocumentStore } from '../src/pilot/postgresBoardDocumentStore';
import {
  createCollaborationRuntime,
  type AuthenticatedConnection,
  type CollaborationTransport,
  type ServerFrame
} from '../src/pilot/collaborationRuntime';

const BOARD_ID = '33333333-3333-4333-8333-333333333333';

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

class Transport implements CollaborationTransport {
  frames: ServerFrame[] = [];
  async send(frame: ServerFrame) { this.frames.push(frame); }
  async close() {}
}

const authenticated = (): AuthenticatedConnection => ({
  boardId: BOARD_ID,
  grant: {
    granted: true,
    action: 'board.edit',
    role: 'student',
    teacherId: '44444444-4444-4444-8444-444444444444',
    boardId: BOARD_ID,
    credentialVersion: 1,
    validUntil: new Date('2027-08-30T00:00:00Z')
  },
  revalidate: async () => true
});

const update = (value: string): Uint8Array => {
  const doc = new Y.Doc();
  doc.getMap('lesson').set('value', value);
  return Y.encodeStateAsUpdate(doc);
};

describe.skipIf(!hasPostgres)('PostgreSQL BoardDocument store', () => {
  let admin: pg.Client;
  let db: Knex;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    await admin.query(`CREATE SCHEMA ${schemaName}`);
    db = knex({ client: 'pg', connection: { connectionString: databaseUrl } });
    await initialSchemaUp(db);
    await permanentTokenUp(db);
    await capabilityAccessUp(db);
    await boardLifecycleUp(db);
    await collaborationUp(db);
    await operationReceiptsUp(db);
    await db('teachers').insert({
      id: '44444444-4444-4444-8444-444444444444',
      email: 'collaboration@vve.test'
    });
    await db('boards').insert({
      id: BOARD_ID,
      teacher_id: '44444444-4444-4444-8444-444444444444',
      title: 'Durable lesson',
      public_slug: 'durable-lesson',
      student_token: 'student-token',
      valid_until: new Date('2027-08-30T00:00:00Z'),
      kind: 'managed',
      student_label: 'Student'
    });
    await db('board_yjs_state').insert({
      board_id: BOARD_ID,
      ydoc_state: Buffer.from(Y.encodeStateAsUpdate(new Y.Doc()))
    });
  });

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
      await admin.end().catch(() => undefined);
    }
  });

  it('executes append -> acknowledgement -> restart -> equal digest against PostgreSQL', async () => {
    const store = createPostgresBoardDocumentStore({ db });
    const first = createCollaborationRuntime({ store, compactAfterOperations: 1_000 });
    const firstTransport = new Transport();
    const firstConnection = await first.connect(authenticated(), firstTransport);
    const durableUpdate = update('survives restart');

    await firstConnection.receive({ kind: 'mutation', operationId: 'pg-op-1', update: durableUpdate });
    expect(firstTransport.frames.at(-1)).toMatchObject({
      kind: 'acknowledgement',
      operationId: 'pg-op-1'
    });
    const before = (await first.inspect(BOARD_ID)).digest;

    const restarted = createCollaborationRuntime({ store, compactAfterOperations: 1_000 });
    await restarted.connect(authenticated(), new Transport());
    expect((await restarted.inspect(BOARD_ID)).digest).toBe(before);
  });

  it('deduplicates an exact retry and rejects operation-id reuse with different bytes', async () => {
    const store = createPostgresBoardDocumentStore({ db });
    const bytes = update('dedupe');
    const first = await store.append(BOARD_ID, 'pg-dedupe', bytes);
    const retry = await store.append(BOARD_ID, 'pg-dedupe', bytes);

    expect(first.duplicate).toBe(false);
    expect(retry).toMatchObject({ duplicate: true, sequence: first.sequence });
    await expect(store.append(BOARD_ID, 'pg-dedupe', update('different'))).rejects.toMatchObject({
      code: 'malformed'
    });
  });

  it('deletes only rows at or before the snapshot cutoff', async () => {
    const store = createPostgresBoardDocumentStore({ db });
    const beforeBytes = update('before');
    const before = await store.append(BOARD_ID, 'pg-before-cutoff', beforeBytes);
    const after = await store.append(BOARD_ID, 'pg-after-cutoff', update('after'));
    await store.compact(BOARD_ID, Y.encodeStateAsUpdate(new Y.Doc()), before.sequence);

    const rows = await db('board_yjs_updates')
      .where({ board_id: BOARD_ID })
      .orderBy('id', 'asc')
      .pluck('operation_id');
    expect(rows).toContain('pg-after-cutoff');
    expect(rows).not.toContain('pg-before-cutoff');
    expect(after.sequence).toBeGreaterThan(before.sequence);

    // Receipt outlives the replay row: a very late retry remains idempotent
    // even after compaction removed its update bytes from the log.
    const lateRetry = await store.append(BOARD_ID, 'pg-before-cutoff', beforeBytes);
    expect(lateRetry).toMatchObject({ duplicate: true, sequence: before.sequence });
    const replayRows = await db('board_yjs_updates')
      .where({ board_id: BOARD_ID, operation_id: 'pg-before-cutoff' });
    expect(replayRows).toHaveLength(0);
  });
});
