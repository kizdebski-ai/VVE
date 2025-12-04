import { RequestHandler } from 'express';
import { getDb } from '../db';
import { TeacherRecord } from '../models/teacher';
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

export const requireTeacherAuth: RequestHandler = async (req, res, next) => {
  try {
    const rawCookie = readCookie(req.headers.cookie, teacherSessionCookieName);
    if (!rawCookie) {
      res.status(401).json({ error: 'Teacher session is required.' });
      return;
    }
    const session = verifyTeacherSessionToken(rawCookie);
    if (!session) {
      res.status(401).json({ error: 'Invalid or expired teacher session.' });
      return;
    }

    const teacher = await getDb<TeacherRecord>('teachers')
      .where({ id: session.teacherId, is_active: true })
      .first();

    if (!teacher) {
      res.status(401).json({ error: 'Teacher not found or inactive.' });
      return;
    }

    req.teacher = teacher;
    next();
  } catch (error) {
    next(error);
  }
};
