import { Router } from 'express';
import { logger } from '../logger';
import type { CapabilityAccess } from '../pilot/capabilityAccess';
import type { BoardLifecycle, LifecycleFailureReason, LifecycleResult } from '../pilot/boardLifecycle';
import { requireTeacherCapability } from '../pilot/capabilityHttpAdapters';
import { createRateLimiter } from '../middleware/rateLimiter';

/**
 * Teacher dashboard board management through the BoardLifecycle Interface
 * (VVE-102). Every request is authorized through
 * CapabilityAccess.decide('teacher.openDashboard') first; the lifecycle
 * commands then re-verify ownership and board state against durable state.
 *
 *  - GET / lazily ensures the Personal Board (idempotent + concurrent-safe)
 *    and returns the dashboard view — expiry dates, states and the ONE
 *    current Board Access Link (copy without rotation).
 *  - POST / creates a Managed Board. Validity is FIXED at 12 months; the
 *    transport carries no validity input at all. The response's `studentLink`
 *    is the REAL working Board Access Link (QA P1-2: the old field mismatch
 *    showed a dead URL after creation).
 *  - POST /:id/regenerate-access rotates the credential atomically.
 *  - POST /:id/end-access ends access immediately and schedules deletion
 *    after seven days. No renewal, recovery or restore route exists.
 */

const FAILURE_HTTP: Record<LifecycleFailureReason, { status: number; message: string }> = {
  notFound: { status: 404, message: 'Nie znaleziono tablicy.' },
  notOwner: { status: 404, message: 'Nie znaleziono tablicy.' },
  alreadyEnded: { status: 409, message: 'Dostęp do tej tablicy został już zakończony.' },
  inactive: { status: 403, message: 'Konto nauczyciela zostało wyłączone.' },
  storageUnavailable: { status: 503, message: 'Usługa chwilowo niedostępna. Spróbuj ponownie za chwilę.' },
  invalidLabel: { status: 400, message: 'Podaj etykietę ucznia lub grupy (1–120 znaków).' }
};

const respondWithResult = (res: import('express').Response, result: LifecycleResult): void => {
  if (result.ok) {
    return;
  }
  const mapped = FAILURE_HTTP[result.reason];
  res.status(mapped.status).json({ error: mapped.message, reason: result.reason });
};

export const createTeacherBoardsRouter = (access: CapabilityAccess, lifecycle: BoardLifecycle) => {
  const router = Router();

  router.use(requireTeacherCapability(access));
  router.use(
    createRateLimiter({
      windowMs: 60_000,
      max: 120,
      keyResolver: (req) => req.capabilityGrant?.teacherId || req.ip || 'unknown'
    })
  );

  // Dashboard: lazy Personal Board + full board list with lifecycle states.
  router.get('/', async (req, res) => {
    const teacherId = req.capabilityGrant!.teacherId!;
    const now = new Date();

    const ensured = await lifecycle.execute({ kind: 'ensurePersonalBoard', teacherId }, now);
    if (!ensured.ok) {
      respondWithResult(res, ensured);
      return;
    }

    const view = await lifecycle.view({ kind: 'teacherDashboard', teacherId }, now);
    if ('error' in view || view.kind !== 'teacherDashboard') {
      res.status(503).json({ error: 'Nie udało się pobrać tablic. Spróbuj ponownie.' });
      return;
    }

    res.json({
      personalBoard: view.personalBoard,
      boards: view.managedBoards
    });
  });

  // Create a Managed Board: twelve-month validity, one Owning Teacher, one
  // Board Access credential, Student Label stored internally.
  router.post('/', async (req, res) => {
    const teacherId = req.capabilityGrant!.teacherId!;
    const body = req.body ?? {};
    const studentLabel = typeof body.studentLabel === 'string' ? body.studentLabel : '';
    const title = typeof body.title === 'string' ? body.title : null;

    const result = await lifecycle.execute(
      { kind: 'createManagedBoard', teacherId, studentLabel, title },
      new Date()
    );

    if (!result.ok) {
      respondWithResult(res, result);
      return;
    }
    if (result.command !== 'createManagedBoard') {
      res.status(500).json({ error: 'Nieoczekiwany wynik operacji.' });
      return;
    }

    logger.info('Managed Board created', { teacherId, boardId: result.board.boardId });
    res.status(201).json({
      boardId: result.board.boardId,
      publicSlug: result.board.publicSlug,
      studentLink: result.boardAccessLink,
      validUntil: result.board.validUntil
    });
  });

  // Explicit regeneration: the old credential dies atomically, all board
  // data and Yjs state are preserved.
  router.post('/:id/regenerate-access', async (req, res) => {
    const teacherId = req.capabilityGrant!.teacherId!;
    const result = await lifecycle.execute(
      { kind: 'regenerateBoardAccess', teacherId, boardId: req.params.id },
      new Date()
    );

    if (!result.ok) {
      respondWithResult(res, result);
      return;
    }
    if (result.command !== 'regenerateBoardAccess') {
      res.status(500).json({ error: 'Nieoczekiwany wynik operacji.' });
      return;
    }

    res.json({
      boardId: result.board.boardId,
      studentLink: result.boardAccessLink,
      validUntil: result.board.validUntil,
      note: 'Poprzedni link przestał działać natychmiast. Tablica i wszystkie materiały pozostały bez zmian.'
    });
  });

  // End Board Access: access ends immediately, deletion is scheduled seven
  // days out, and no recovery control exists.
  router.post('/:id/end-access', async (req, res) => {
    const teacherId = req.capabilityGrant!.teacherId!;
    const result = await lifecycle.execute(
      { kind: 'endBoardAccess', teacherId, boardId: req.params.id },
      new Date()
    );

    if (!result.ok) {
      respondWithResult(res, result);
      return;
    }
    if (result.command !== 'endBoardAccess') {
      res.status(500).json({ error: 'Nieoczekiwany wynik operacji.' });
      return;
    }

    res.json({
      boardId: result.board.boardId,
      accessEndedAt: result.board.accessEndedAt,
      deleteAfter: result.board.deleteAfter,
      note: 'Dostęp ucznia został zakończony. Tablica zostanie trwale usunięta po 7 dniach.'
    });
  });

  return router;
};
