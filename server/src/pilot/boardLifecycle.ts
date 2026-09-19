import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';
import type { Knex } from 'knex';
import { config } from '../config';
import { getDb } from '../db';
import { logger } from '../logger';
import type { CapabilityAccess } from './capabilityAccess';
import type { OperationalSignals } from './operationalSignals';

/**
 * BoardLifecycle — Module 2 of the VVE Pilot deep-module design (slice S2).
 *
 * One Interface for every durable board lifecycle fact:
 *
 *   execute(command, now) → typed outcome
 *   view(query, now)      → derived, side-effect-free facts
 *
 * Commands: ensurePersonalBoard (lazy, concurrent-safe), createManagedBoard
 * (validUntil is FIXED to created + 12 months — the caller cannot select
 * another validity), regenerateBoardAccess (atomic credential-version bump,
 * old link dies, ALL board data and Yjs state preserved), endBoardAccess
 * (access ends immediately, deleteAfter = accessEndedAt + 7 days),
 * deactivateTeacher (coordinates CapabilityAccess's authoritative access end
 * with deletion scheduling for the Personal Board and every Managed Board),
 * purgeDueBoards (idempotent, retry-safe permanent deletion).
 *
 * Queries: the Teacher dashboard (personal + managed boards with states and
 * the deletion countdown), Administrator teacher-list board facts, and board
 * entry facts for the transport surface.
 *
 * Typed failure outcomes: notFound | notOwner | alreadyEnded | inactive |
 * storageUnavailable (plus invalidLabel for createManagedBoard input
 * validation, mirroring CapabilityAccess's invalidEmail precedent).
 *
 * What the Implementation hides: schema details, date calculation, Student
 * Label storage, Personal-vs-Managed rules, credential version changes,
 * delete scheduling, expiry scanning, active-session notification and the
 * transactional cascade order. No renewal, recovery or restore control is
 * exposed anywhere (ADR-0006: the seven-day Deletion Grace Period exists to
 * bound storage, not to offer a product recovery button).
 *
 * Dependencies (see the design doc):
 *  - PostgreSQL is local-substitutable via `options.db`;
 *  - CapabilityAccess is composed for the authoritative teacher-access end
 *    on deactivation — lifecycle facts feed `decide()`, they never bypass it;
 *  - expiry/purge scheduling is in-process (a stoppable sweep timer owned by
 *    the module; VVE-108 formalizes timer ownership);
 *  - room-closure notification after an access end is an optional in-process
 *    callback: the durable transaction is authoritative, the callback only
 *    accelerates socket closure (full runtime integration is VVE-103).
 */

// ---------------------------------------------------------------------------
// Interface types
// ---------------------------------------------------------------------------

export type BoardKind = 'personal' | 'managed';

export type LifecycleFailureReason =
  | 'notFound'
  | 'notOwner'
  | 'alreadyEnded'
  | 'inactive'
  | 'storageUnavailable'
  | 'invalidLabel';

export type LifecycleCommand =
  | { kind: 'ensurePersonalBoard'; teacherId: string }
  | { kind: 'createManagedBoard'; teacherId: string; studentLabel: string; title?: string | null }
  | { kind: 'regenerateBoardAccess'; teacherId: string; boardId: string }
  | { kind: 'endBoardAccess'; teacherId: string; boardId: string }
  | { kind: 'deactivateTeacher'; teacherId: string }
  | { kind: 'purgeDueBoards'; limit?: number };

export interface BoardView {
  boardId: string;
  kind: BoardKind;
  title: string | null;
  /** Student Label (CONTEXT.md) — internal, Teacher-facing only. */
  studentLabel: string | null;
  createdAt: Date;
  /** Managed Boards: created + 12 months. Personal Boards: null (never expire). */
  validUntil: Date | null;
  accessEndedAt: Date | null;
  deleteAfter: Date | null;
  /** Derived against the view's `now`: active, or ended with a deletion countdown. */
  state: 'active' | 'ended';
  /** Whole days until permanent deletion (ended boards only). */
  deletesInDays: number | null;
  /** Teacher entry path: `/board/<slug>` for Managed Boards, `/board/<id>` for the Personal Board. */
  entryPath: string | null;
  /** Public slug; Personal Boards deliberately have none (not addressable by link). */
  publicSlug: string | null;
  /**
   * The ONE active Board Access Link URL. Personal Boards never have one;
   * ended Managed Boards keep their (dead) credentials hidden from views.
   */
  boardAccessLink: string | null;
  /** Durable Board Access credential version. */
  credentialVersion: number;
}

export interface PersonalBoardView extends BoardView {
  /** True when THIS call created the board (idempotent re-visits return false). */
  created: boolean;
}

export interface TeacherBoardFacts {
  teacherId: string;
  managedBoards: number;
  activeManagedBoards: number;
  pendingDeletionBoards: number;
  hasPersonalBoard: boolean;
}

export type LifecycleResult =
  | { ok: true; command: 'ensurePersonalBoard'; board: PersonalBoardView }
  | { ok: true; command: 'createManagedBoard'; board: BoardView; boardAccessLink: string }
  | { ok: true; command: 'regenerateBoardAccess'; board: BoardView; boardAccessLink: string }
  | { ok: true; command: 'endBoardAccess'; board: BoardView }
  | { ok: true; command: 'deactivateTeacher'; boardsScheduled: number }
  | { ok: true; command: 'purgeDueBoards'; scheduled: number; purged: number; failed: number }
  | { ok: false; command: LifecycleCommand['kind']; reason: LifecycleFailureReason };

export type LifecycleQuery =
  | { kind: 'teacherDashboard'; teacherId: string }
  | { kind: 'adminTeacherFacts' }
  | { kind: 'boardEntry'; boardId: string };

export type LifecycleView =
  | { kind: 'teacherDashboard'; personalBoard: BoardView | null; managedBoards: BoardView[] }
  | { kind: 'adminTeacherFacts'; facts: TeacherBoardFacts[] }
  | { kind: 'boardEntry'; board: Pick<BoardView, 'boardId' | 'kind' | 'title' | 'studentLabel' | 'validUntil' | 'state'> | null };

export interface BoardLifecycle {
  execute(command: LifecycleCommand, now: Date): Promise<LifecycleResult>;
  view(query: LifecycleQuery, now: Date): Promise<LifecycleView | { error: 'storageUnavailable' }>;
  /** In-process sweep: reconciles expiry/deactivation transitions and purges due boards. */
  startDeletionSweep(intervalMs?: number): void;
  stopDeletionSweep(): void;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** ADR-0006: permanent deletion seven days after access ends. */
export const DELETION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** The Pilot contract: a Managed Board is valid for exactly twelve months. */
const MANAGED_BOARD_VALIDITY_MONTHS = 12;

const STUDENT_LABEL_MAX = 120;
const SWEEP_DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const PURGE_BATCH_LIMIT = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

type BoardRow = {
  id: string;
  organization_id: string | null;
  teacher_id: string;
  kind: BoardKind;
  title: string | null;
  student_label: string | null;
  public_slug: string | null;
  student_token: string | null;
  valid_until: Date | null;
  created_at: Date;
  access_ended_at: Date | null;
  delete_after: Date | null;
  deleted_at: Date | null;
  access_credential_version: number;
};

type TeacherRow = { id: string; organization_id: string | null; is_active: boolean };

const addMonths = (date: Date, months: number): Date => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
};

const newStudentToken = (): string => randomBytes(32).toString('base64url');

const emptyDocState = (): Buffer => Buffer.from(Y.encodeStateAsUpdate(new Y.Doc()));

const appBaseUrl = (): string => config.teacherAppBaseUrl || 'https://app.whitevue.com';

const boardAccessLinkUrl = (slug: string, token: string): string =>
  `${appBaseUrl()}/board/${slug}?token=${token}`;

const isEnded = (board: Pick<BoardRow, 'access_ended_at' | 'delete_after' | 'valid_until'>, now: Date): boolean =>
  Boolean(board.access_ended_at) ||
  Boolean(board.delete_after) ||
  (board.valid_until !== null && new Date(board.valid_until).getTime() <= now.getTime());

const toBoardView = (board: BoardRow, now: Date): BoardView => {
  const ended = isEnded(board, now);
  const active = board.kind === 'managed' && !ended;
  return {
    boardId: board.id,
    kind: board.kind,
    title: board.title,
    studentLabel: board.student_label,
    createdAt: new Date(board.created_at),
    validUntil: board.valid_until === null ? null : new Date(board.valid_until),
    accessEndedAt: board.access_ended_at === null ? null : new Date(board.access_ended_at),
    deleteAfter: board.delete_after === null ? null : new Date(board.delete_after),
    state: ended ? 'ended' : 'active',
    deletesInDays:
      board.delete_after === null
        ? null
        : Math.max(0, Math.ceil((new Date(board.delete_after).getTime() - now.getTime()) / DAY_MS)),
    entryPath: board.kind === 'personal' ? `/board/${board.id}` : board.public_slug ? `/board/${board.public_slug}` : null,
    publicSlug: board.public_slug,
    boardAccessLink:
      active && board.public_slug && board.student_token
        ? boardAccessLinkUrl(board.public_slug, board.student_token)
        : null,
    credentialVersion: board.access_credential_version
  };
};

export interface CreateBoardLifecycleOptions {
  /** Durable lifecycle state; defaults to the process knex instance. */
  db?: Knex;
  /**
   * Composed for the authoritative teacher-access end on deactivation.
   * Board lifecycle facts feed CapabilityAccess.decide(); they never bypass it.
   */
  access: CapabilityAccess;
  /**
   * In-process CollaborationRuntime notification (VVE-103 owns the full
   * integration): called after the durable transaction commits, only to
   * accelerate socket closure. Failures are logged and never roll back.
   */
  onBoardsAccessEnded?: (boardIds: string[]) => void;
  /** Called after a board is permanently purged (e.g. to drop caches). */
  onBoardsPurged?: (boardIds: string[]) => void;
  /** Internal test seam: runs inside each per-board purge attempt. */
  hooks?: { beforePurgeBoard?: (boardId: string) => Promise<void> | void };
  /** Content-free operational events (VVE-108). */
  signals?: OperationalSignals;
}

const createFailure = (
  command: LifecycleCommand['kind'],
  reason: LifecycleFailureReason
): LifecycleResult => ({ ok: false, command, reason });

export const createBoardLifecycle = (options: CreateBoardLifecycleOptions): BoardLifecycle => {
  const db = () => options.db ?? getDb();
  const failStorage = (command: LifecycleCommand['kind'], error: unknown, context: string): LifecycleResult => {
    logger.error('BoardLifecycle: storage failure', {
      command,
      context,
      message: (error as Error)?.message,
      stack: (error as Error)?.stack?.split('\n').slice(0, 4).join(' | ')
    });
    return createFailure(command, 'storageUnavailable');
  };

  const loadTeacher = async (teacherId: string): Promise<TeacherRow | null> => {
    const teacher = await db()<TeacherRow>('teachers').where({ id: teacherId }).first('id', 'organization_id', 'is_active');
    return teacher ?? null;
  };

  const loadBoardForUpdate = async (trx: Knex, boardId: string): Promise<BoardRow | null> => {
    const board = await trx<BoardRow>('boards').where({ id: boardId }).forUpdate().first();
    return board ?? null;
  };

  // ---- ensurePersonalBoard ------------------------------------------------

  const ensurePersonalBoard = async (teacherId: string, now: Date): Promise<LifecycleResult> => {
    try {
      const teacher = await loadTeacher(teacherId);
      if (!teacher) return createFailure('ensurePersonalBoard', 'notFound');
      if (!teacher.is_active) return createFailure('ensurePersonalBoard', 'inactive');

      return await db().transaction(async (trx): Promise<LifecycleResult> => {
        const boardId = uuidv4();
        const inserted = await trx('boards')
          .insert({
            id: boardId,
            organization_id: teacher.organization_id,
            teacher_id: teacherId,
            kind: 'personal',
            title: 'Tablica prywatna',
            public_slug: null,
            student_token: null,
            valid_until: null,
            access_credential_version: 1,
            created_at: now
          })
          // No conflict target: DO NOTHING covers every unique constraint,
          // including the one-personal-board-per-teacher partial index. A
          // concurrent insert blocks on the index entry, then skips here.
          .onConflict().ignore()
          .returning('id');

        if (inserted.length > 0) {
          await trx('board_yjs_state').insert({ board_id: boardId, ydoc_state: emptyDocState() });
          const board = await trx<BoardRow>('boards').where({ id: boardId }).first();
          return board
            ? { ok: true, command: 'ensurePersonalBoard', board: { ...toBoardView(board, now), created: true } }
            : createFailure('ensurePersonalBoard', 'storageUnavailable');
        }

        const existing = await trx<BoardRow>('boards')
          .where({ teacher_id: teacherId, kind: 'personal' })
          .whereNull('deleted_at')
          .first();
        return existing
          ? { ok: true, command: 'ensurePersonalBoard', board: { ...toBoardView(existing, now), created: false } }
          : createFailure('ensurePersonalBoard', 'storageUnavailable');
      });
    } catch (error) {
      return failStorage('ensurePersonalBoard', error, 'ensure transaction');
    }
  };

  // ---- createManagedBoard -------------------------------------------------

  const generateSlug = async (trx: Knex): Promise<string> => {
    for (let i = 0; i < 5; i += 1) {
      const slug = randomBytes(6).toString('base64url');
      // eslint-disable-next-line no-await-in-loop
      const existing = await trx('boards').where({ public_slug: slug }).first('id');
      if (!existing) return slug;
    }
    return uuidv4().slice(0, 12);
  };

  const createManagedBoard = async (
    teacherId: string,
    rawLabel: unknown,
    rawTitle: unknown,
    now: Date
  ): Promise<LifecycleResult> => {
    const studentLabel = typeof rawLabel === 'string' ? rawLabel.trim() : '';
    if (studentLabel.length < 1 || studentLabel.length > STUDENT_LABEL_MAX) {
      return createFailure('createManagedBoard', 'invalidLabel');
    }
    const title = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle.trim() : null;

    try {
      const teacher = await loadTeacher(teacherId);
      if (!teacher) return createFailure('createManagedBoard', 'notFound');
      if (!teacher.is_active) return createFailure('createManagedBoard', 'inactive');

      return await db().transaction(async (trx): Promise<LifecycleResult> => {
        // The Pilot contract fixes the validity: created + 12 months. The
        // command carries no validity input a caller could select instead.
        const validUntil = addMonths(now, MANAGED_BOARD_VALIDITY_MONTHS);
        const boardId = uuidv4();
        const slug = await generateSlug(trx);
        const studentToken = newStudentToken();

        const [board] = await trx<BoardRow>('boards')
          .insert({
            id: boardId,
            organization_id: teacher.organization_id,
            teacher_id: teacherId,
            kind: 'managed',
            title,
            student_label: studentLabel,
            public_slug: slug,
            student_token: studentToken,
            valid_until: validUntil,
            access_credential_version: 1,
            created_at: now
          })
          .returning('*');

        if (!board) return createFailure('createManagedBoard', 'storageUnavailable');

        await trx('board_yjs_state').insert({ board_id: board.id, ydoc_state: emptyDocState() });

        return {
          ok: true,
          command: 'createManagedBoard',
          board: toBoardView(board, now),
          boardAccessLink: boardAccessLinkUrl(slug, studentToken)
        };
      });
    } catch (error) {
      return failStorage('createManagedBoard', error, 'create transaction');
    }
  };

  // ---- Shared ownership / state guard for board-access commands -----------

  const guardManagedBoardAccess = async (
    command: 'regenerateBoardAccess' | 'endBoardAccess',
    trx: Knex,
    teacherId: string,
    boardId: string,
    now: Date
  ): Promise<{ board: BoardRow } | { failed: LifecycleResult }> => {
    const board = await loadBoardForUpdate(trx, boardId);
    if (!board) return { failed: createFailure(command, 'notFound') };
    if (board.teacher_id !== teacherId) return { failed: createFailure(command, 'notOwner') };
    const teacher = await trx<TeacherRow>('teachers').where({ id: teacherId }).first('id', 'is_active');
    if (!teacher || !teacher.is_active) return { failed: createFailure(command, 'inactive') };
    // A Personal Board has no Board Access credential to regenerate or end:
    // deactivation of the Teacher is its only lifecycle exit.
    if (board.kind !== 'managed') return { failed: createFailure(command, 'notFound') };
    if (isEnded(board, now)) return { failed: createFailure(command, 'alreadyEnded') };
    return { board };
  };

  // ---- regenerateBoardAccess ----------------------------------------------

  const regenerateBoardAccess = async (teacherId: string, boardId: string, now: Date): Promise<LifecycleResult> => {
    try {
      return await db().transaction(async (trx): Promise<LifecycleResult> => {
        const guard = await guardManagedBoardAccess('regenerateBoardAccess', trx, teacherId, boardId, now);
        if ('failed' in guard) return guard.failed;
        const { board } = guard;

        // Atomic version bump + token replacement in ONE statement: every
        // credential issued before this point (student link, ws admission
        // token) is denied immediately afterwards, and no board data, Yjs
        // state or label is touched.
        const studentToken = newStudentToken();
        const [rotated] = await trx<BoardRow>('boards')
          .where({ id: boardId })
          .update({ access_credential_version: board.access_credential_version + 1, student_token: studentToken })
          .returning('*');

        if (!rotated) return createFailure('regenerateBoardAccess', 'storageUnavailable');
        return {
          ok: true,
          command: 'regenerateBoardAccess',
          board: toBoardView(rotated, now),
          boardAccessLink: boardAccessLinkUrl(rotated.public_slug!, studentToken)
        };
      });
    } catch (error) {
      return failStorage('regenerateBoardAccess', error, 'regenerate transaction');
    }
  };

  // ---- endBoardAccess ------------------------------------------------------

  const endBoardAccess = async (teacherId: string, boardId: string, now: Date): Promise<LifecycleResult> => {
    try {
      const result = await db().transaction(async (trx): Promise<LifecycleResult> => {
        const guard = await guardManagedBoardAccess('endBoardAccess', trx, teacherId, boardId, now);
        if ('failed' in guard) return guard.failed;

        const [ended] = await trx<BoardRow>('boards')
          .where({ id: boardId })
          .update({ access_ended_at: now, delete_after: new Date(now.getTime() + DELETION_GRACE_MS) })
          .returning('*');

        if (!ended) return createFailure('endBoardAccess', 'storageUnavailable');
        return { ok: true, command: 'endBoardAccess', board: toBoardView(ended, now) };
      });

      // Notify AFTER the durable commit: the transaction is authoritative.
      if (result.ok) {
        try {
          options.onBoardsAccessEnded?.([boardId]);
        } catch (notifyError) {
          logger.warn('BoardLifecycle: access-end notification failed (durable state stands)', {
            boardId,
            error: (notifyError as Error).message
          });
        }
      }
      return result;
    } catch (error) {
      return failStorage('endBoardAccess', error, 'end transaction');
    }
  };

  // ---- deactivateTeacher ---------------------------------------------------

  const deactivateTeacher = async (teacherId: string, now: Date): Promise<LifecycleResult> => {
    try {
      const teacher = await loadTeacher(teacherId);
      if (!teacher) return createFailure('deactivateTeacher', 'notFound');
      if (!teacher.is_active) return createFailure('deactivateTeacher', 'inactive');

      // CapabilityAccess owns the authoritative access end (credential
      // version bump + link deactivation): every teacher link, session and
      // ws token dies on its next decision, independent of board scheduling.
      const denied = await options.access.deactivateTeacher(teacherId, now);
      if (!denied.ok) {
        if (denied.reason === 'notFound') return createFailure('deactivateTeacher', 'notFound');
        if (denied.reason === 'alreadyInactive') return createFailure('deactivateTeacher', 'inactive');
        return createFailure('deactivateTeacher', 'storageUnavailable');
      }

      // Schedule the Personal Board + ALL Managed Boards for deletion.
      try {
        const boardIds: string[] = await db()('boards')
          .where({ teacher_id: teacherId })
          .whereNull('access_ended_at')
          .whereNull('deleted_at')
          .pluck('id');
        const scheduled = await db()('boards')
          .where({ teacher_id: teacherId })
          .whereNull('access_ended_at')
          .whereNull('deleted_at')
          .update({ access_ended_at: now, delete_after: new Date(now.getTime() + DELETION_GRACE_MS) });

        try {
          options.onBoardsAccessEnded?.(boardIds);
        } catch (notifyError) {
          logger.warn('BoardLifecycle: deactivation notification failed (durable state stands)', {
            teacherId,
            error: (notifyError as Error).message
          });
        }

        return { ok: true, command: 'deactivateTeacher', boardsScheduled: scheduled };
      } catch (scheduleError) {
        // Access has already ended durably. The purge sweep's reconciliation
        // step schedules any board of an inactive teacher, so this outcome is
        // retry-safe by construction, not a lost update.
        logger.error('BoardLifecycle: deletion scheduling after deactivation failed', {
          teacherId,
          error: (scheduleError as Error).message
        });
        return createFailure('deactivateTeacher', 'storageUnavailable');
      }
    } catch (error) {
      return failStorage('deactivateTeacher', error, 'deactivate lookup');
    }
  };

  // ---- purgeDueBoards ------------------------------------------------------

  /**
   * Reconciliation: turn every ended-access fact into a scheduled deletion.
   * Covers expiry at the twelve-month boundary (access_ended_at = validUntil),
   * boards of deactivated teachers (the only exit for Personal Boards), and
   * any board whose scheduling write was lost to a crash. Idempotent.
   */
  const scheduleDueDeletions = async (now: Date): Promise<number> => {
    const expired = await db()('boards')
      .whereNull('access_ended_at')
      .whereNull('deleted_at')
      .whereNotNull('valid_until')
      .where('valid_until', '<=', now)
      .update({
        access_ended_at: db().raw('valid_until'),
        delete_after: db().raw(`valid_until + interval '${Math.round(DELETION_GRACE_MS / 1000)} seconds'`)
      });

    const inactiveTeacherBoards = await db()('boards')
      .whereIn('id', (sub: Knex.QueryBuilder) => {
        void sub.select('b.id')
          .from('boards as b')
          .join('teachers as t', 't.id', 'b.teacher_id')
          .where('b.access_ended_at', null)
          .whereNull('b.deleted_at')
          .where('t.is_active', false);
      })
      .update({
        access_ended_at: now,
        delete_after: new Date(now.getTime() + DELETION_GRACE_MS)
      });

    const unscheduled = await db()('boards')
      .whereNotNull('access_ended_at')
      .whereNull('delete_after')
      .whereNull('deleted_at')
      .update({
        delete_after: db().raw(`access_ended_at + interval '${Math.round(DELETION_GRACE_MS / 1000)} seconds'`)
      });

    return expired + inactiveTeacherBoards + unscheduled;
  };

  const purgeOneBoard = async (boardId: string): Promise<boolean> => {
    await options.hooks?.beforePurgeBoard?.(boardId);
    await db().transaction(async (trx) => {
      // board_access_logs has no FK cascade — delete explicitly, then the
      // document state, then the board row (yjs tables also cascade, but the
      // explicit order keeps the transaction self-describing). One
      // transaction per board: a mid-run failure leaves the remaining boards
      // untouched and the next run completes them.
      await trx('board_access_logs').where({ board_id: boardId }).del();
      await trx('board_yjs_updates').where({ board_id: boardId }).del();
      await trx('board_yjs_state').where({ board_id: boardId }).del();
      await trx('boards').where({ id: boardId }).del();
    });
    return true;
  };

  const purgeDueBoards = async (limit: number | undefined, now: Date): Promise<LifecycleResult> => {
    try {
      const scheduled = await scheduleDueDeletions(now);

      const due = await db()<Pick<BoardRow, 'id'>>('boards')
        .whereNotNull('delete_after')
        .where('delete_after', '<=', now)
        .whereNull('deleted_at')
        .orderBy('delete_after', 'asc')
        .limit(Math.min(limit ?? PURGE_BATCH_LIMIT, PURGE_BATCH_LIMIT))
        .pluck('id');

      let purged = 0;
      let failed = 0;
      for (const boardId of due) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await purgeOneBoard(boardId);
          purged += 1;
        } catch (error) {
          failed += 1;
          logger.error('BoardLifecycle: per-board purge failed (retry-safe)', {
            boardId,
            error: (error as Error).message
          });
        }
      }

      if (purged > 0) {
        try {
          options.onBoardsPurged?.(due.slice(0, purged));
        } catch (notifyError) {
          logger.warn('BoardLifecycle: purge notification failed', { error: (notifyError as Error).message });
        }
      }

      return { ok: true, command: 'purgeDueBoards', scheduled, purged, failed };
    } catch (error) {
      return failStorage('purgeDueBoards', error, 'purge sweep');
    }
  };

  // ---- views ---------------------------------------------------------------

  const teacherDashboard = async (teacherId: string, now: Date): Promise<LifecycleView> => {
    const rows = await db()<BoardRow>('boards')
      .where({ teacher_id: teacherId })
      .whereNull('deleted_at')
      .select('*')
      .orderBy('created_at', 'asc');
    const personal = rows.find((row) => row.kind === 'personal');
    const managed = rows.filter((row) => row.kind === 'managed').reverse();
    return {
      kind: 'teacherDashboard',
      personalBoard: personal ? toBoardView(personal, now) : null,
      managedBoards: managed.map((row) => toBoardView(row, now))
    };
  };

  const adminTeacherFacts = async (): Promise<LifecycleView> => {
    const rows = await db()('boards as b')
      .whereNull('b.deleted_at')
      .groupBy('b.teacher_id')
      .select(
        'b.teacher_id',
        db().raw(`COUNT(*) FILTER (WHERE b.kind = 'managed')::int AS managed_boards`),
        db().raw(
          `COUNT(*) FILTER (WHERE b.kind = 'managed' AND b.access_ended_at IS NULL AND (b.valid_until IS NULL OR b.valid_until > now()))::int AS active_managed_boards`
        ),
        db().raw(`COUNT(*) FILTER (WHERE b.delete_after IS NOT NULL)::int AS pending_deletion_boards`),
        db().raw(`COUNT(*) FILTER (WHERE b.kind = 'personal')::int AS personal_boards`)
      );
    return {
      kind: 'adminTeacherFacts',
      facts: (rows as Array<Record<string, unknown>>).map((row) => ({
        teacherId: String(row.teacher_id),
        managedBoards: Number(row.managed_boards ?? 0),
        activeManagedBoards: Number(row.active_managed_boards ?? 0),
        pendingDeletionBoards: Number(row.pending_deletion_boards ?? 0),
        hasPersonalBoard: Number(row.personal_boards ?? 0) > 0
      }))
    };
  };

  const boardEntry = async (boardId: string, now: Date): Promise<LifecycleView> => {
    const board = await db()<BoardRow>('boards').where({ id: boardId }).whereNull('deleted_at').first();
    if (!board) return { kind: 'boardEntry', board: null };
    const view = toBoardView(board, now);
    return {
      kind: 'boardEntry',
      board: {
        boardId: view.boardId,
        kind: view.kind,
        title: view.title,
        studentLabel: view.studentLabel,
        validUntil: view.validUntil,
        state: view.state
      }
    };
  };

  // ---- sweep timer (in-process, stoppable — VVE-108 formalizes ownership) -

  let sweepTimer: NodeJS.Timeout | undefined;

  const sweepOnce = async (): Promise<void> => {
    const result = await execute({ kind: 'purgeDueBoards' }, new Date());
    if (result.ok && result.command === 'purgeDueBoards') {
      options.signals?.record({
        name: 'lifecycle.job',
        dimensions: {
          job: 'purgeDueBoards',
          scheduled: result.scheduled,
          purged: result.purged,
          failed: result.failed
        }
      });
      if (result.purged > 0 || result.scheduled > 0 || result.failed > 0) {
        logger.info('BoardLifecycle: deletion sweep', {
          scheduled: result.scheduled,
          purged: result.purged,
          failed: result.failed
        });
      }
    }
  };

  const execute = async (command: LifecycleCommand, now: Date): Promise<LifecycleResult> => {
    switch (command.kind) {
      case 'ensurePersonalBoard':
        return ensurePersonalBoard(command.teacherId, now);
      case 'createManagedBoard':
        return createManagedBoard(command.teacherId, command.studentLabel, command.title ?? null, now);
      case 'regenerateBoardAccess':
        return regenerateBoardAccess(command.teacherId, command.boardId, now);
      case 'endBoardAccess':
        return endBoardAccess(command.teacherId, command.boardId, now);
      case 'deactivateTeacher':
        return deactivateTeacher(command.teacherId, now);
      case 'purgeDueBoards':
        return purgeDueBoards(command.limit, now);
    }
  };

  return {
    execute,
    async view(query, now) {
      try {
        switch (query.kind) {
          case 'teacherDashboard':
            return await teacherDashboard(query.teacherId, now);
          case 'adminTeacherFacts':
            return await adminTeacherFacts();
          case 'boardEntry':
            return await boardEntry(query.boardId, now);
        }
      } catch (error) {
        logger.error('BoardLifecycle: view failed', {
          query: query.kind,
          error: (error as Error).message
        });
        return { error: 'storageUnavailable' };
      }
    },
    startDeletionSweep(intervalMs = SWEEP_DEFAULT_INTERVAL_MS): void {
      if (sweepTimer) clearInterval(sweepTimer);
      sweepTimer = setInterval(() => {
        sweepOnce().catch((error) =>
          logger.error('BoardLifecycle: deletion sweep failed', { error: (error as Error).message })
        );
      }, intervalMs);
      sweepTimer.unref?.();
    },
    stopDeletionSweep(): void {
      if (sweepTimer) {
        clearInterval(sweepTimer);
        sweepTimer = undefined;
      }
    }
  };
};
