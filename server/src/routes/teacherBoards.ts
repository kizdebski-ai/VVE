import { Router } from 'express';
import { requireTeacherAuth } from '../middleware/requireTeacherAuth';
import { createBoardForTeacher, listBoardsForTeacher, updateBoard } from '../services/boardService';
import { createRateLimiter } from '../middleware/rateLimiter';

const parseDate = (value: unknown): Date | null => {
  if (typeof value !== 'string') return null;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return null;
  return new Date(ts);
};

export const createTeacherBoardsRouter = () => {
  const router = Router();

  router.use(requireTeacherAuth);
  router.use(
    createRateLimiter({
      windowMs: 60_000,
      max: 120,
      keyResolver: (req) => req.teacher?.id || req.ip || 'unknown'
    })
  );

  router.get('/', async (req, res) => {
    const teacher = req.teacher!;
    const boards = await listBoardsForTeacher(teacher.id);
    res.json({ boards });
  });

  router.post('/', async (req, res) => {
    const teacher = req.teacher!;
    const body = req.body ?? {};
    const title = typeof body.title === 'string' ? body.title : null;
    const studentName = typeof body.studentName === 'string' ? body.studentName : null;
    const validUntil = parseDate(body.validUntil);

    const result = await createBoardForTeacher({
      teacherId: teacher.id,
      organizationId: teacher.organization_id ?? null,
      title,
      studentName,
      validUntil
    });

    res.status(201).json({
      boardId: result.board.id,
      studentUrl: result.studentUrl,
      publicSlug: result.board.public_slug,
      validUntil: result.board.valid_until
    });
  });

  router.patch('/:id', async (req, res) => {
    const teacher = req.teacher!;
    const body = req.body ?? {};
    const title = body.title === undefined ? undefined : typeof body.title === 'string' ? body.title : null;
    const validUntil = body.validUntil === undefined ? undefined : parseDate(body.validUntil);
    const archived = body.archived === undefined ? undefined : Boolean(body.archived);

    const updated = await updateBoard(req.params.id, teacher.id, {
      title,
      validUntil,
      archivedAt: archived === undefined ? undefined : archived ? new Date() : null
    });

    if (!updated) {
      res.status(404).json({ error: 'Board not found.' });
      return;
    }

    res.json({ board: updated });
  });

  return router;
};
