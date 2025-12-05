import { Router } from 'express';
import { boardStudentAuth } from '../middleware/boardStudentAuth';
import { createBoardWsToken } from '../services/boardTokens';

export const createBoardAccessRouter = () => {
  const router = Router();

  // Board access endpoints - both /board/ and /api/board/ for different use cases
  const boardHandler = (req: import('express').Request, res: import('express').Response) => {
    const board = req.board!;
    const role = req.boardRole || 'student';
    const wsToken = createBoardWsToken(board.id, role);
    res.json({
      boardId: board.id,
      role,
      publicSlug: board.public_slug,
      title: board.title,
      studentName: (board as any).student_name ?? null,
      teacherName: (board as any).teacher_full_name ?? null,
      validUntil: board.valid_until,
      archivedAt: board.archived_at,
      readOnly: req.boardReadOnly ?? false,
      wsToken,
      roomId: board.id
    });
  };

  router.get('/board/:slug', boardStudentAuth, boardHandler);
  router.get('/api/board/:slug', boardStudentAuth, boardHandler);

  router.get('/s/:slug', boardStudentAuth, (req, res) => {
    const board = req.board!;
    const role = req.boardRole || 'student';
    const wsToken = createBoardWsToken(board.id, role);
    res.json({
      boardId: board.id,
      role,
      publicSlug: board.public_slug,
      title: board.title,
      studentName: (board as any).student_name ?? null,
      teacherName: (board as any).teacher_full_name ?? null,
      validUntil: board.valid_until,
      archivedAt: board.archived_at,
      readOnly: req.boardReadOnly ?? false,
      wsToken,
      roomId: board.id
    });
  });

  return router;
};
