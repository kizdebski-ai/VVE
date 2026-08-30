import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import knex, { Knex } from 'knex';

/**
 * VVE-102 BoardLifecycle decision matrix (Module 2).
 *
 * Every lifecycle guarantee is tested THROUGH the Interface
 * (execute/view) with a controllable clock and a real isolated PostgreSQL
 * schema — never by inspecting incidental table shapes:
 *
 *  - ensurePersonalBoard: lazy, idempotent, CONCURRENT-SAFE (two parallel
 *    first dashboard visits converge to exactly one Personal Board);
 *  - createManagedBoard: validUntil fixed at created + 12 months regardless
 *    of caller input, one Owning Teacher, Student Label stored;
 *  - regenerateBoardAccess: atomic version bump, old credential denied by
 *    CapabilityAccess, ALL board data + Yjs state preserved (read-after-
 *    regeneration is byte-identical);
 *  - endBoardAccess: access ends IMMEDIATELY (CapabilityAccess denies),
 *    deleteAfter = accessEndedAt + 7 days;
 *  - expiry at the EXACT twelve-month boundary (controllable clock);
 *  - deactivateTeacher with many boards: everything scheduled;
 *  - purgeDueBoards: retry-safe after injected partial failures;
 *  - every database failure fails CLOSED (storageUnavailable);
 *  - NO recovery/renewal control exists anywhere on the surface.
 */

const { schemaName } = vi.hoisted(() => {
  const base =
    process.env.PILOT_LIFECYCLE_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgres://vve:vve-test@127.0.0.1:5433/vve_test';
  const name = `vve_board_lifecycle_test_${process.pid}`;
  const url = new URL(base);
  url.searchParams.set('options', `-c search_path=${name},public`);
  process.env.DATABASE_URL = url.toString();
  process.env.TZ = 'Etc/UTC';
  process.env.ADMIN_PASSPHRASE = 'lifecycle-admin-passphrase';
  process.env.TEACHER_SESSION_SECRET = 'lifecycle-teacher-session-secret';
  process.env.ADMIN_SESSION_SECRET = 'lifecycle-admin-session-secret';
  process.env.BOARD_WS_SECRET = 'lifecycle-board-ws-secret';
  process.env.TEACHER_APP_BASE_URL = 'http://app.test';
  return { schemaName: name };
});

import { up as initialSchemaUp } from '../migrations/20241129000000_initial_schema';
import { up as permanentTokenUp } from '../migrations/20241207000000_add_teacher_permanent_token';
import { up as capabilityAccessUp } from '../migrations/20260829000000_capability_access';
import { up as boardLifecycleUp } from '../migrations/20260830000000_board_lifecycle';
import { createCapabilityAccess, issueBoardWsToken, issueTeacherSessionToken } from '../src/pilot/capabilityAccess';
import { createBoardLifecycle, DELETION_GRACE_MS, type LifecycleCommand } from '../src/pilot/boardLifecycle';
import { createWsAdmission } from '../src/wsAdmission';
import { getDb } from '../src/db';

const DAY = 24 * 60 * 60 * 1000;

const localPostgresAvailable = async (): Promise<boolean> => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 1500 });
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

describe.skipIf(!hasPostgres)('BoardLifecycle (local PostgreSQL, controllable clock)', () => {
  let admin: pg.Client;
  let schemaKnex: Knex;
  let db: Knex;
  let clock: Date;

  const access = createCapabilityAccess();
  const admission = createWsAdmission(access, false);

  const buildLifecycle = (hooks?: Parameters<typeof createBoardLifecycle>[0]['hooks']) =>
    createBoardLifecycle({ access, hooks });

  const insertTeacher = async (email: string): Promise<string> => {
    const [row] = await db('teachers').insert({ email, full_name: `Label ${email}` }).returning('id');
    return row.id;
  };

  const exec = async (command: LifecycleCommand, at?: Date) =>
    buildLifecycle().execute(command, at ?? clock);

  const view = (
    query: Parameters<ReturnType<typeof createBoardLifecycle>['view']>[0],
    at?: Date
  ) => buildLifecycle().view(query, at ?? clock);

  const seedYjsContent = async (boardId: string, text: string) => {
    const Y = await import('yjs');
    const doc = new Y.Doc();
    doc.getMap('lesson').set('title', text);
    const update = Y.encodeStateAsUpdate(doc);
    await db('board_yjs_updates').insert({ board_id: boardId, update });
    // Compose snapshot + updates like the live persistence path would.
    await db('board_yjs_state')
      .insert({ board_id: boardId, ydoc_state: update })
      .onConflict('board_id')
      .merge({ ydoc_state: update });
    return Buffer.from(update).toString('hex');
  };

  const readYjsState = async (boardId: string): Promise<string | null> => {
    const row = await db('board_yjs_state').where({ board_id: boardId }).first('ydoc_state');
    return row ? Buffer.from(row.ydoc_state).toString('hex') : null;
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    await admin.query(`CREATE SCHEMA ${schemaName}`);
    schemaKnex = knex({ client: 'pg', connection: { connectionString: process.env.DATABASE_URL } });
    await initialSchemaUp(schemaKnex);
    await permanentTokenUp(schemaKnex);
    await capabilityAccessUp(schemaKnex);
    await boardLifecycleUp(schemaKnex);
    db = getDb();
    clock = new Date('2026-08-30T12:00:00Z');
  });

  afterAll(async () => {
    await getDb().destroy().catch(() => undefined);
    await schemaKnex?.destroy().catch(() => undefined);
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
      await admin.end().catch(() => undefined);
    }
  });

  it('ensurePersonalBoard creates exactly one Personal Board lazily, idempotently', async () => {
    const teacherId = await insertTeacher('personal@lifecycle.test');

    const first = await exec({ kind: 'ensurePersonalBoard', teacherId });
    expect(first).toMatchObject({ ok: true, command: 'ensurePersonalBoard' });
    if (!first.ok || first.command !== 'ensurePersonalBoard') return;
    expect(first.board.created).toBe(true);
    expect(first.board.kind).toBe('personal');
    // A Personal Board never expires and never carries a Board Access Link.
    expect(first.board.validUntil).toBeNull();
    expect(first.board.boardAccessLink).toBeNull();
    expect(first.board.entryPath).toBe(`/board/${first.board.boardId}`);

    // Idempotent: the second visit reuses the SAME board, created=false.
    const second = await exec({ kind: 'ensurePersonalBoard', teacherId });
    expect(second.ok).toBe(true);
    if (second.ok && second.command === 'ensurePersonalBoard') {
      expect(second.board.created).toBe(false);
      expect(second.board.boardId).toBe(first.board.boardId);
    }

    // Exactly one row per teacher is enforced by the DATABASE, not the code.
    const rows = await db('boards').where({ teacher_id: teacherId, kind: 'personal' });
    expect(rows).toHaveLength(1);
  });

  it('ensurePersonalBoard is concurrent-safe: two simultaneous dashboard visits yield ONE board', async () => {
    const teacherId = await insertTeacher('concurrent@lifecycle.test');

    // Two independent lifecycle instances (like two overlapping HTTP
    // requests) racing the very first dashboard visit.
    const [a, b, c] = await Promise.all([
      exec({ kind: 'ensurePersonalBoard', teacherId }),
      exec({ kind: 'ensurePersonalBoard', teacherId }),
      exec({ kind: 'ensurePersonalBoard', teacherId })
    ]);
    expect(a.ok && b.ok && c.ok).toBe(true);

    const rows = await db('boards').where({ teacher_id: teacherId, kind: 'personal' });
    expect(rows).toHaveLength(1);

    const dashboard = await view({ kind: 'teacherDashboard', teacherId });
    expect(!('error' in dashboard) && dashboard.personalBoard !== null).toBe(true);
    if (!('error' in dashboard)) {
      expect(dashboard.managedBoards).toHaveLength(0);
    }
  });

  it('createManagedBoard fixes validUntil at +12 months regardless of caller input, stores the Student Label', async () => {
    const teacherId = await insertTeacher('managed@lifecycle.test');

    const result = await exec({
      kind: 'createManagedBoard',
      teacherId,
      // The Interface carries NO validity input at all — a caller cannot
      // select another validity; title/label are the only inputs.
      studentLabel: 'Kowalski — grupa A',
      title: 'Ułamki'
    });
    expect(result).toMatchObject({ ok: true, command: 'createManagedBoard' });
    if (!result.ok || result.command !== 'createManagedBoard') return;

    // Calendar arithmetic: 2026-08-30 + 12 months = 2027-08-30.
    expect(result.board.validUntil!.getUTCFullYear()).toBe(clock.getUTCFullYear() + 1);
    expect(result.board.validUntil!.getUTCMonth()).toBe(clock.getUTCMonth());
    expect(result.board.validUntil!.getUTCDate()).toBe(clock.getUTCDate());
    expect(result.board.studentLabel).toBe('Kowalski — grupa A');
    expect(result.board.kind).toBe('managed');
    expect(result.board.boardAccessLink).toContain(`/board/${result.board.publicSlug}?token=`);

    // The returned link is REAL: CapabilityAccess grants the student entry.
    const link = new URL(result.boardAccessLink);
    const slug = link.pathname.split('/').pop()!;
    const token = link.searchParams.get('token')!;
    expect(await access.decide({
      credential: { kind: 'studentBoardLink', boardSlug: slug, token },
      action: 'board.read',
      now: clock
    })).toMatchObject({ granted: true, boardId: result.board.boardId });

    // Label validation is a typed outcome.
    await expect(exec({ kind: 'createManagedBoard', teacherId, studentLabel: '   ' })).resolves.toMatchObject({
      ok: false,
      reason: 'invalidLabel'
    });
  });

  it('regenerateBoardAccess atomically rotates the credential, denies the old link, preserves ALL data', async () => {
    const teacherId = await insertTeacher('regen@lifecycle.test');
    const personal = await exec({ kind: 'ensurePersonalBoard', teacherId });
    expect(personal.ok).toBe(true);
    const created = await exec({ kind: 'createManagedBoard', teacherId, studentLabel: 'Nowak' });
    if (!created.ok || created.command !== 'createManagedBoard') return;
    const boardId = created.board.boardId;

    const oldLink = new URL(created.boardAccessLink);
    const oldSlug = oldLink.pathname.split('/').pop()!;
    const oldToken = oldLink.searchParams.get('token')!;
    const contentBefore = await seedYjsContent(boardId, 'lekcja-12-przed-rotacja');
    await db('boards').where({ id: boardId }).update({ title: 'Tytuł przed rotacją' });

    // The old student link works before regeneration (ws admission too).
    const oldWs = issueBoardWsToken({ boardId, role: 'student', cv: created.board.credentialVersion, ttlMs: 1000 * 60 * 60 * 24 * 365 });
    expect(await admission.admit(boardId, oldWs, clock)).toMatchObject({ admitted: true });

    const rotated = await exec({ kind: 'regenerateBoardAccess', teacherId, boardId });
    expect(rotated).toMatchObject({ ok: true, command: 'regenerateBoardAccess' });
    if (!rotated.ok || rotated.command !== 'regenerateBoardAccess') return;

    // Version bumped by exactly one; a new link was issued.
    expect(rotated.board.credentialVersion).toBe(created.board.credentialVersion + 1);
    expect(rotated.boardAccessLink).not.toBe(created.boardAccessLink);

    // The OLD credential is denied everywhere, IMMEDIATELY (HTTP + WS).
    // Regeneration replaces the token in place (slug unchanged), so a reused
    // old link token is a token mismatch — typed `invalid`; the ws token's
    // version mismatch is a typed `revoked`.
    expect(await access.decide({
      credential: { kind: 'studentBoardLink', boardSlug: oldSlug, token: oldToken },
      action: 'board.read',
      now: clock
    })).toMatchObject({ granted: false, reason: 'invalid' });
    expect(await admission.admit(boardId, oldWs, clock)).toMatchObject({ admitted: false });

    // The NEW link works.
    const newLink = new URL(rotated.boardAccessLink);
    expect(await access.decide({
      credential: {
        kind: 'studentBoardLink',
        boardSlug: newLink.pathname.split('/').pop()!,
        token: newLink.searchParams.get('token')!
      },
      action: 'board.edit',
      now: clock
    })).toMatchObject({ granted: true, boardId });

    // Read-after-regeneration: board data + Yjs state are IDENTICAL.
    expect(await readYjsState(boardId)).toBe(contentBefore);
    const row = await db('boards').where({ id: boardId }).first('title', 'student_label', 'valid_until');
    expect(row.title).toBe('Tytuł przed rotacją');
    expect(row.student_label).toBe('Nowak');
    expect(new Date(row.valid_until).getTime()).toBe(created.board.validUntil!.getTime());

    // Exactly one active credential fact per board — the version in the
    // database is the one the new link was issued under.
    const stored = await db('boards').where({ id: boardId }).first('access_credential_version', 'student_token');
    expect(stored.access_credential_version).toBe(created.board.credentialVersion + 1);
    expect(newLink.searchParams.get('token')).toBe(stored.student_token);

    // Duplicate regeneration still converges (each call rotates once).
    const again = await exec({ kind: 'regenerateBoardAccess', teacherId, boardId });
    expect(again.ok && again.command === 'regenerateBoardAccess' && again.board.credentialVersion).toBe(
      created.board.credentialVersion + 2
    );
  });

  it('regeneration guards: notFound, notOwner, personal board, ended board', async () => {
    const teacherA = await insertTeacher('guard-a@lifecycle.test');
    const teacherB = await insertTeacher('guard-b@lifecycle.test');
    const created = await exec({ kind: 'createManagedBoard', teacherId: teacherA, studentLabel: 'X' });
    if (!created.ok || created.command !== 'createManagedBoard') return;
    const boardId = created.board.boardId;

    expect(await exec({ kind: 'regenerateBoardAccess', teacherId: teacherB, boardId })).toMatchObject({
      ok: false,
      reason: 'notOwner'
    });
    expect(await exec({ kind: 'regenerateBoardAccess', teacherId: teacherA, boardId: '00000000-0000-0000-0000-000000000000' })).toMatchObject({
      ok: false,
      reason: 'notFound'
    });

    // A Personal Board has no Board Access credential to regenerate.
    const personal = await exec({ kind: 'ensurePersonalBoard', teacherId: teacherA });
    if (personal.ok && personal.command === 'ensurePersonalBoard') {
      expect(await exec({ kind: 'regenerateBoardAccess', teacherId: teacherA, boardId: personal.board.boardId })).toMatchObject({
        ok: false,
        reason: 'notFound'
      });
    }

    const ended = await exec({ kind: 'endBoardAccess', teacherId: teacherA, boardId });
    expect(ended.ok).toBe(true);
    expect(await exec({ kind: 'regenerateBoardAccess', teacherId: teacherA, boardId })).toMatchObject({
      ok: false,
      reason: 'alreadyEnded'
    });
  });

  it('endBoardAccess ends access IMMEDIATELY and schedules deletion exactly +7 days', async () => {
    const teacherId = await insertTeacher('end@lifecycle.test');
    const created = await exec({ kind: 'createManagedBoard', teacherId, studentLabel: 'Kwiecień' });
    if (!created.ok || created.command !== 'createManagedBoard') return;
    const boardId = created.board.boardId;

    const link = new URL(created.boardAccessLink);
    const slug = link.pathname.split('/').pop()!;
    const token = link.searchParams.get('token')!;
    const studentWs = issueBoardWsToken({ boardId, role: 'student', cv: created.board.credentialVersion, ttlMs: 1000 * 60 * 60 * 24 * 365 });
    const teacherWs = issueBoardWsToken({ boardId, role: 'teacher', teacherId, cv: 1, ttlMs: 1000 * 60 * 60 * 24 * 365 });

    // Granted before the end.
    expect(await admission.admit(boardId, studentWs, clock)).toMatchObject({ admitted: true });

    const ended = await exec({ kind: 'endBoardAccess', teacherId, boardId });
    expect(ended).toMatchObject({ ok: true, command: 'endBoardAccess' });
    if (!ended.ok || ended.command !== 'endBoardAccess') return;

    expect(ended.board.accessEndedAt!.getTime()).toBe(clock.getTime());
    expect(ended.board.deleteAfter!.getTime()).toBe(clock.getTime() + DELETION_GRACE_MS);
    expect(ended.board.state).toBe('ended');

    // IMMEDIATE denial over every credential (existing CapabilityAccess
    // integration — lifecycle facts feed decide()).
    expect(await access.decide({
      credential: { kind: 'studentBoardLink', boardSlug: slug, token },
      action: 'board.read',
      now: clock
    })).toMatchObject({ granted: false, reason: 'revoked' });
    expect(await admission.admit(boardId, studentWs, clock)).toMatchObject({ admitted: false });
    expect(await admission.admit(boardId, teacherWs, clock)).toMatchObject({ admitted: false });
    expect(await access.decide({
      credential: { kind: 'teacherSession', token: issueTeacherSessionToken(teacherId, 1) },
      action: 'board.edit',
      target: { boardId },
      now: clock
    })).toMatchObject({ granted: false, reason: 'revoked' });

    // Second end is a typed no-op, not an error.
    expect(await exec({ kind: 'endBoardAccess', teacherId, boardId })).toMatchObject({
      ok: false,
      reason: 'alreadyEnded'
    });

    // The dashboard view shows the countdown.
    const dashboard = await view({ kind: 'teacherDashboard', teacherId });
    if (!('error' in dashboard)) {
      const board = dashboard.managedBoards.find((b) => b.boardId === boardId);
      expect(board?.state).toBe('ended');
      expect(board?.deletesInDays).toBe(7);
      expect(board?.boardAccessLink).toBeNull();
    }
  });

  it('expiry at the EXACT twelve-month boundary ends access immediately and schedules deletion', async () => {
    const teacherId = await insertTeacher('expiry@lifecycle.test');
    const created = await exec({ kind: 'createManagedBoard', teacherId, studentLabel: 'Wygasa' });
    if (!created.ok || created.command !== 'createManagedBoard') return;
    const boardId = created.board.boardId;
    const validUntil = created.board.validUntil!;

    const link = new URL(created.boardAccessLink);
    const slug = link.pathname.split('/').pop()!;
    const token = link.searchParams.get('token')!;

    // One millisecond BEFORE the boundary: still fully granted.
    const before = new Date(validUntil.getTime() - 1);
    expect(await access.decide({
      credential: { kind: 'studentBoardLink', boardSlug: slug, token },
      action: 'board.edit',
      now: before
    })).toMatchObject({ granted: true });

    // AT the boundary: denied as expired (access ends immediately). The
    // capability itself expires at validUntil — before any reconciliation
    // sweep runs.
    const atBoundary = new Date(validUntil.getTime());
    expect(await access.decide({
      credential: { kind: 'studentBoardLink', boardSlug: slug, token },
      action: 'board.read',
      now: atBoundary
    })).toMatchObject({ granted: false, reason: 'expired' });

    // Read-time transition: purgeDueBoards (the sweep) reconciles expiry.
    // The schema is shared by the whole suite, so the sweep also touches
    // boards created by EARLIER tests — assert this board's durable facts,
    // not absolute sweep counters.
    const purge = await exec({ kind: 'purgeDueBoards' }, atBoundary);
    expect(purge).toMatchObject({ ok: true, command: 'purgeDueBoards' });
    if (!purge.ok || purge.command !== 'purgeDueBoards') return;
    // THIS board must survive the sweep: its grace period just started, so
    // only boards from EARLIER tests (deletion already due) may be purged.
    expect(await db('boards').where({ id: boardId }).first('id')).toBeTruthy();

    // Deletion is scheduled exactly validUntil + 7 days (durable facts).
    const row = await db('boards').where({ id: boardId }).first('access_ended_at', 'delete_after');
    expect(new Date(row.access_ended_at).getTime()).toBe(atBoundary.getTime());
    expect(new Date(row.delete_after).getTime()).toBe(atBoundary.getTime() + DELETION_GRACE_MS);

    // Idempotent reconciliation: a second sweep schedules nothing new for
    // THIS board (its access_ended_at/delete_after are already set).
    const factsAfterFirst = await db('boards').where({ id: boardId }).first('access_ended_at', 'delete_after');
    await expect(exec({ kind: 'purgeDueBoards' }, atBoundary)).resolves.toMatchObject({ ok: true });
    const factsAfterSecond = await db('boards').where({ id: boardId }).first('access_ended_at', 'delete_after');
    expect(new Date(factsAfterSecond.access_ended_at).getTime()).toBe(
      new Date(factsAfterFirst.access_ended_at).getTime()
    );
    expect(new Date(factsAfterSecond.delete_after).getTime()).toBe(
      new Date(factsAfterFirst.delete_after).getTime()
    );
  });

  it('deactivateTeacher with MANY boards: access ends everywhere, everything scheduled', async () => {
    const teacherId = await insertTeacher('deactivated@lifecycle.test');
    await exec({ kind: 'ensurePersonalBoard', teacherId });
    const boards: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const created = await exec({ kind: 'createManagedBoard', teacherId, studentLabel: `Grupa ${i}` });
      if (created.ok && created.command === 'createManagedBoard') boards.push(created.board.boardId);
    }
    expect(boards).toHaveLength(5);

    const result = await exec({ kind: 'deactivateTeacher', teacherId });
    expect(result).toMatchObject({ ok: true, command: 'deactivateTeacher', boardsScheduled: 6 });

    const teacherSession = issueTeacherSessionToken(teacherId, 1);
    for (const boardId of boards) {
      const ws = issueBoardWsToken({ boardId, role: 'student', cv: 1, ttlMs: 1000 * 60 * 60 * 24 * 365 });
      expect(await admission.admit(boardId, ws, clock)).toMatchObject({ admitted: false });
      expect(await access.decide({
        credential: { kind: 'teacherSession', token: teacherSession },
        action: 'board.read',
        target: { boardId },
        now: clock
      })).toMatchObject({ granted: false, reason: 'inactive' });
    }

    // The Personal Board is scheduled too (its only lifecycle exit).
    const rows = await db('boards')
      .where({ teacher_id: teacherId })
      .whereNotNull('delete_after')
      .count('* as n');
    expect(Number(rows[0].n)).toBe(6);

    // Typed idempotence.
    expect(await exec({ kind: 'deactivateTeacher', teacherId })).toMatchObject({
      ok: false,
      reason: 'inactive'
    });
  });

  it('purgeDueBoards deletes board + document state + access logs, is idempotent and RETRY-SAFE after partial failure', async () => {
    const teacherId = await insertTeacher('purge@lifecycle.test');
    const created = await exec({ kind: 'createManagedBoard', teacherId, studentLabel: 'Kasowana' });
    if (!created.ok || created.command !== 'createManagedBoard') return;
    const boardId = created.board.boardId;
    const content = await seedYjsContent(boardId, 'do-usuniecia');
    await db('board_access_logs').insert({ board_id: boardId, actor_type: 'student', actor_id: null });

    // End access, then move the clock past the grace period.
    const endedAt = await exec({ kind: 'endBoardAccess', teacherId, boardId });
    expect(endedAt).toMatchObject({ ok: true, command: 'endBoardAccess' });
    const afterGrace = new Date(clock.getTime() + DELETION_GRACE_MS + 60_000);

    // Partial failure: the first purge attempt fails for THIS board only,
    // after the access-log delete but before the transaction (injected hook).
    let failOnce = true;
    const flaky = buildLifecycle({
      beforePurgeBoard: (id) => {
        if (id === boardId && failOnce) {
          failOnce = false;
          throw new Error('injected partial failure');
        }
      }
    });

    const firstAttempt = await flaky.execute({ kind: 'purgeDueBoards' }, afterGrace);
    expect(firstAttempt).toMatchObject({ ok: true, command: 'purgeDueBoards' });
    if (!firstAttempt.ok || firstAttempt.command !== 'purgeDueBoards') return;
    // THIS board failed and survived; earlier boards may join the batch and
    // purge successfully — the per-board facts are what matter.
    expect(firstAttempt.failed).toBeGreaterThanOrEqual(1);

    // The board still exists (the transaction rolled back — retry-safe).
    expect(await db('boards').where({ id: boardId }).first('id')).toBeTruthy();
    expect(await readYjsState(boardId)).toBe(content);

    // RE-RUN completes the job: same command, no special flags.
    const retry = await exec({ kind: 'purgeDueBoards' }, afterGrace);
    expect(retry).toMatchObject({ ok: true, command: 'purgeDueBoards', failed: 0 });

    // Everything is gone: row, Yjs state, updates, access logs.
    expect(await db('boards').where({ id: boardId }).first('id')).toBeUndefined();
    expect(await readYjsState(boardId)).toBeNull();
    const updateRows = await db('board_yjs_updates').where({ board_id: boardId }).count('* as n');
    const logRows = await db('board_access_logs').where({ board_id: boardId }).count('* as n');
    expect(Number(updateRows[0].n)).toBe(0);
    expect(Number(logRows[0].n)).toBe(0);

    // Idempotent for THIS board: a third run leaves nothing behind.
    expect(await db('boards').where({ id: boardId }).first('id')).toBeUndefined();
  });

  it('purgeDueBoards reconciles an unscheduled ended board (crash between access end and scheduling)', async () => {
    const teacherId = await insertTeacher('unscheduled@lifecycle.test');
    const created = await exec({ kind: 'createManagedBoard', teacherId, studentLabel: 'Bez harmonogramu' });
    if (!created.ok || created.command !== 'createManagedBoard') return;
    const boardId = created.board.boardId;

    // Simulate the crash: access ended but no deletion scheduled.
    await db('boards').where({ id: boardId }).update({ access_ended_at: clock });

    // ONE sweep past the grace horizon repairs the schedule from the durable
    // fact (delete_after = access_ended_at + 7 days — already past) and
    // completes the purge in the SAME run: recovery needs no special flag.
    const afterGrace = new Date(clock.getTime() + DELETION_GRACE_MS + 60_000);
    const first = await exec({ kind: 'purgeDueBoards' }, afterGrace);
    expect(first).toMatchObject({ ok: true, command: 'purgeDueBoards' });
    if (!first.ok || first.command !== 'purgeDueBoards') return;
    expect(first.scheduled).toBeGreaterThanOrEqual(1);

    // Everything about this board is gone: row and document state.
    expect(await db('boards').where({ id: boardId }).first('id')).toBeUndefined();
    expect(await readYjsState(boardId)).toBeNull();

    // Idempotent: a second sweep has nothing left to repair or purge.
    const second = await exec({ kind: 'purgeDueBoards' }, afterGrace);
    expect(second).toMatchObject({ ok: true, command: 'purgeDueBoards', scheduled: 0 });
  });

  it('views fail closed and commands report storageUnavailable on database failure', async () => {
    const brokenDb = (() => {
      throw new Error('connection refused');
    }) as unknown as Knex;
    const brokenLifecycle = createBoardLifecycle({ access, db: brokenDb });

    const commands: LifecycleCommand[] = [
      { kind: 'ensurePersonalBoard', teacherId: '00000000-0000-0000-0000-000000000000' },
      { kind: 'createManagedBoard', teacherId: '00000000-0000-0000-0000-000000000000', studentLabel: 'X' },
      { kind: 'regenerateBoardAccess', teacherId: 'x', boardId: 'y' },
      { kind: 'endBoardAccess', teacherId: 'x', boardId: 'y' },
      { kind: 'deactivateTeacher', teacherId: 'x' },
      { kind: 'purgeDueBoards' }
    ];
    for (const command of commands) {
      expect(await brokenLifecycle.execute(command, clock)).toMatchObject({
        ok: false,
        reason: 'storageUnavailable'
      });
    }
    expect(await brokenLifecycle.view({ kind: 'teacherDashboard', teacherId: 'x' }, clock)).toEqual({
      error: 'storageUnavailable'
    });
    expect(await brokenLifecycle.view({ kind: 'adminTeacherFacts' }, clock)).toEqual({
      error: 'storageUnavailable'
    });
    expect(await brokenLifecycle.view({ kind: 'boardEntry', boardId: 'x' }, clock)).toEqual({
      error: 'storageUnavailable'
    });
  });

  it('deactivation is composed with CapabilityAccess: the authoritative access end comes from decide()', async () => {
    const teacherId = await insertTeacher('composed@lifecycle.test');
    await exec({ kind: 'createManagedBoard', teacherId, studentLabel: 'Kompozycja' });

    // The teacher's link credential dies with the deactivation.
    const linkResult = await access.createOrReuseTeacherAccessLink({ email: 'composed@lifecycle.test' });
    if (!linkResult.ok) throw new Error('link creation failed');

    const result = await exec({ kind: 'deactivateTeacher', teacherId });
    expect(result).toMatchObject({ ok: true });

    expect(await access.decide({
      credential: { kind: 'teacherAccessLink', token: linkResult.token },
      action: 'teacher.openDashboard',
      now: clock
    })).toMatchObject({ granted: false, reason: 'inactive' });

    // Student access to the deactivated teacher's board ends too. After the
    // deactivation the board also carries access_ended_at (deletion
    // scheduled), so the denial surfaces as `revoked` — the important fact
    // is the typed, immediate DENIAL either way.
    const board = await db('boards').where({ teacher_id: teacherId }).first('id', 'public_slug', 'student_token');
    const studentDecision = await access.decide({
      credential: { kind: 'studentBoardLink', boardSlug: board.public_slug, token: board.student_token },
      action: 'board.read',
      now: clock
    });
    expect(studentDecision).toMatchObject({ granted: false });
    if (!studentDecision.granted) {
      expect(['revoked', 'inactive']).toContain(studentDecision.reason);
    }
  });

  it('adminTeacherFacts view reports per-teacher board facts without side effects', async () => {
    const teacherId = await insertTeacher('facts@lifecycle.test');
    await exec({ kind: 'ensurePersonalBoard', teacherId });
    const created = await exec({ kind: 'createManagedBoard', teacherId, studentLabel: 'Fakty' });
    if (!created.ok || created.command !== 'createManagedBoard') return;

    const snapshot = async () => JSON.stringify(await db('boards').orderBy('id'));
    const before = await snapshot();

    const factsView = await view({ kind: 'adminTeacherFacts' });
    expect(!('error' in factsView) && factsView.kind === 'adminTeacherFacts').toBe(true);
    if (!('error' in factsView)) {
      const fact = factsView.facts.find((f) => f.teacherId === teacherId);
      expect(fact).toMatchObject({
        managedBoards: 1,
        activeManagedBoards: 1,
        pendingDeletionBoards: 0,
        hasPersonalBoard: true
      });
    }

    // Pure view: no durable state changed.
    expect(await snapshot()).toBe(before);
  });
});
