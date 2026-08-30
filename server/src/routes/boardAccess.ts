import { Router } from 'express';
import type { CapabilityAccess, PresentedCredential } from '../pilot/capabilityAccess';
import type { BoardLifecycle } from '../pilot/boardLifecycle';
import { PUBLIC_TEACHER_IDENTITY, issueBoardWsToken } from '../pilot/capabilityAccess';
import {
  clientIpOf,
  logBoardAccess,
  studentLinkCredentialOf,
  teacherSessionCredentialOf,
  denyHttp
} from '../pilot/capabilityHttpAdapters';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Board Access entry (Student + owning Teacher) through CapabilityAccess,
 * with entry facts from the BoardLifecycle view (VVE-102).
 *
 * The credential is resolved from the transport (teacher session cookie or
 * the Board Access Link token), authorized once via decide('board.read'),
 * and only then are board facts plus a scoped ws admission token returned.
 * Expiry, End Board Access, the deletion schedule, the durable credential
 * version and teacher activity are checked on every request — an expired or
 * ended board is DENIED here (and at WS admission), never downgraded to a
 * writable or read-only view.
 *
 * A UUID path segment resolves BY BOARD ID and only ever matches the teacher
 * session credential: that is the Personal Board entry (Personal Boards have
 * no public slug and no Board Access Link, so a Student credential can never
 * address them). Managed Boards resolve by their public slug.
 *
 * Students see exactly the immutable Public Teacher Identity (ADR-0009);
 * internal labels never appear on this surface.
 */
export const createBoardAccessRouter = (access: CapabilityAccess, lifecycle: BoardLifecycle) => {
  const router = Router();

  const boardHandler = async (req: import('express').Request, res: import('express').Response) => {
    const slug = req.params.slug;
    if (!slug) {
      res.status(400).json({ error: 'Brak identyfikatora tablicy.' });
      return;
    }

    let credential: PresentedCredential = teacherSessionCredentialOf(req);
    if (credential.kind === 'none') {
      credential = studentLinkCredentialOf(req, slug);
    }

    // Personal Board entry: UUID path + teacher session resolves by board id.
    const resolveById = credential.kind === 'teacherSession' && UUID_PATTERN.test(slug);

    const decision = await access.decide({
      credential,
      action: 'board.read',
      target: resolveById ? { boardId: slug } : { boardSlug: slug },
      now: new Date()
    });

    if (!decision.granted) {
      denyHttp(res, decision, 'board');
      return;
    }

    const boardId = decision.boardId!;
    const entryView = await lifecycle.view({ kind: 'boardEntry', boardId }, new Date());
    const boardFacts =
      !('error' in entryView) && entryView.kind === 'boardEntry' ? entryView.board : null;
    if (!boardFacts) {
      // Durable facts could not be read (or vanished) after the grant: fail
      // closed, never a partial view.
      res.status(503).json({ error: 'Usługa chwilowo niedostępna. Spróbuj ponownie za chwilę.' });
      return;
    }

    await logBoardAccess({
      boardId,
      actorType: decision.role === 'teacher' ? 'teacher' : 'student',
      actorId: decision.role === 'teacher' ? decision.teacherId : null,
      ip: clientIpOf(req),
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null
    });

    const wsToken = issueBoardWsToken({
      boardId,
      role: decision.role === 'teacher' ? 'teacher' : 'student',
      ...(decision.role === 'teacher' && decision.teacherId ? { teacherId: decision.teacherId } : {}),
      cv: decision.credentialVersion
    });

    res.json({
      boardId,
      kind: boardFacts.kind,
      role: decision.role,
      publicSlug: resolveById ? null : slug,
      title: boardFacts.title,
      studentLabel: boardFacts.studentLabel,
      teacherName: PUBLIC_TEACHER_IDENTITY,
      validUntil: boardFacts.validUntil,
      wsToken,
      roomId: boardId
    });
  };

  router.get('/board/:slug', boardHandler);
  router.get('/api/board/:slug', boardHandler);
  router.get('/s/:slug', boardHandler);

  return router;
};
