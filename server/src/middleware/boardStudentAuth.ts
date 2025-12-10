import { RequestHandler } from 'express';
import { getDb } from '../db';
import { BoardAccessLogRecord } from '../models/teacher';
import { findBoardBySlug, verifyStudentTokenForBoard } from '../services/boardService';
import { teacherSessionCookieName, verifyTeacherSessionToken } from '../services/teacherSessions';

const readCookie = (cookieHeader: string | undefined, name: string): string | null => {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name) {
      return rest.join('=');
    }
  }
  return null;
};

const clientIp = (req: import('express').Request) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() ?? req.ip;
  }
  return req.ip;
};

const unauthorized = (res: import('express').Response, message: string) =>
  res.status(401).json({ error: message });

export const boardStudentAuth: RequestHandler = async (req, res, next) => {
  const slug = req.params.slug;
  if (!slug) {
    res.status(400).json({ error: 'Missing board slug.' });
    return;
  }

  const board = await findBoardBySlug(slug);
  if (!board || board.deleted_at) {
    res.status(404).json({ error: 'Board not found.' });
    return;
  }

  const now = new Date();
  const isExpired = board.valid_until ? new Date(board.valid_until) < now : false;
  const isArchived = Boolean(board.archived_at);
  const readOnly = isExpired || isArchived;

  const ip = clientIp(req);
  const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;

  const teacherCookie = readCookie(req.headers.cookie, teacherSessionCookieName);
  if (teacherCookie) {
    const session = verifyTeacherSessionToken(teacherCookie);
    if (session && session.teacherId === board.teacher_id) {
      req.board = board;
      req.boardRole = 'teacher';
      req.boardReadOnly = readOnly;
      await getDb()('board_access_logs').insert({
        board_id: board.id,
        actor_type: 'teacher',
        actor_id: board.teacher_id,
        ip_addr: ip,
        user_agent: userAgent
      });
      next();
      return;
    }
  }

  const token = typeof req.query.token === 'string' ? req.query.token : readCookie(req.headers.cookie, 'student_token');
  if (!token) {
    unauthorized(res, 'Student token is required.');
    return;
  }

  const isValid = await verifyStudentTokenForBoard(board, token);
  if (!isValid) {
    unauthorized(res, 'Invalid or expired student link.');
    return;
  }

  req.board = board;
  req.boardRole = 'student';
  req.boardReadOnly = readOnly;

  await getDb()('board_access_logs').insert({
    board_id: board.id,
    actor_type: 'student',
    actor_id: board.student_id,
    ip_addr: ip,
    user_agent: userAgent
  });

  next();
};
