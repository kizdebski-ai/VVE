import { Router } from 'express';
import { boardStudentAuth } from '../middleware/boardStudentAuth';
import { createBoardWsToken } from '../services/boardTokens';

export const createBoardAccessRouter = () => {
  const router = Router();

  router.get('/board/:slug', boardStudentAuth, (req, res) => {
    const board = req.board!;
    const role = req.boardRole || 'student';
    const wsToken = createBoardWsToken(board.id, role);
    res.json({
      boardId: board.id,
      role,
      publicSlug: board.public_slug,
      title: board.title,
      studentName: (board as any).student_name ?? null,
      validUntil: board.valid_until,
      archivedAt: board.archived_at,
      wsToken,
      roomId: board.id
    });
  });

  return router;
};
