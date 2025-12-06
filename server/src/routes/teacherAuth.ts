import { Router } from 'express';
import { logger } from '../logger';
import { config } from '../config';
import { getDb } from '../db';
import { BoardAccessLogRecord } from '../models/teacher';
import { consumeMagicLink } from '../services/teacherMagicLinks';
import { createTeacherSessionToken, teacherSessionCookieName } from '../services/teacherSessions';
import { findTeacherById, markTeacherLogin } from '../services/teacherService';
import { createRateLimiter } from '../middleware/rateLimiter';

const sessionMaxAgeMs = 1000 * 60 * 60 * 24 * 30; // 30 days

const renderErrorPage = (res: import('express').Response, message: string, status = 400) => {
  res
    .status(status)
    .send(
      `<html><head><title>WhiteVue</title></head><body style="font-family: sans-serif; max-width: 480px; margin: 40px auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.05);"><h2>Link do logowania</h2><p>${message}</p><p>Popros administratora o nowy link.</p></body></html>`
    );
};

const getClientIp = (req: import('express').Request): string | null => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    const first = forwarded.split(',')[0];
    return first ? first.trim() : null;
  }
  return req.ip ?? null;
};

export const createTeacherAuthRouter = () => {
  const router = Router();
  const loginLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

  router.get('/teacher/login', loginLimiter, async (req, res) => {
    const correlationId = req.correlationId;
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const teacherId = typeof req.query.id === 'string' ? req.query.id : '';

    if (!token || !teacherId) {
      renderErrorPage(res, 'Link jest nieprawidlowy lub wygasl.', 400);
      return;
    }

    try {
      const teacher = await findTeacherById(teacherId);
      if (!teacher || !teacher.is_active) {
        renderErrorPage(res, 'Konto nauczyciela jest nieaktywne lub nie istnieje.', 404);
        return;
      }

      const ip = getClientIp(req);
      const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;

      const result = await consumeMagicLink(teacherId, token, { ip, userAgent });
      if (!result.success) {
        const reason = result.reason === 'used'
          ? 'Link zostal juz uzyty.'
          : 'Link jest nieprawidlowy lub wygasl.';
        renderErrorPage(res, reason, 400);
        return;
      }

      const sessionToken = createTeacherSessionToken(teacher.id, teacher.organization_id ?? null);
      res.cookie(teacherSessionCookieName, sessionToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.nodeEnv === 'production',
        maxAge: sessionMaxAgeMs,
        path: '/'
      });

      await markTeacherLogin(teacher.id);
      await getDb()('board_access_logs').insert({
        board_id: null,
        actor_type: 'teacher',
        actor_id: teacher.id,
        ip_addr: ip ?? null,
        user_agent: userAgent
      });

      res.redirect('/teacher/dashboard');
    } catch (error) {
      logger.error('Teacher magic link login failed', {
        error: (error as Error).message,
        teacherId,
        correlationId
      });
      renderErrorPage(res, 'Wystapil blad. Sprobuj ponownie lub popros o nowy link.', 500);
    }
  });

  return router;
};
