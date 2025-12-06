import crypto, { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config';

export const teacherSessionCookieName = config.teacherSessionCookie;
const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export interface TeacherSessionPayload {
  teacherId: string;
  organizationId: string | null;
  exp: number;
}

const sign = (payload: string) => {
  const secret = config.teacherSessionSecret || 'change-me-in-prod';
  return createHmac('sha256', secret).update(payload).digest('base64url');
};

const safeCompare = (a: string, b: string) => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};

export const createTeacherSessionToken = (teacherId: string, organizationId: string | null, ttlMs?: number) => {
  const payload: TeacherSessionPayload = {
    teacherId,
    organizationId,
    exp: Date.now() + (ttlMs ?? DEFAULT_SESSION_TTL_MS)
  };
  const base = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(base);
  return `${base}.${signature}`;
};

export const verifyTeacherSessionToken = (token: string): TeacherSessionPayload | null => {
  const [base, signature] = token.split('.');
  if (!base || !signature) return null;
  const expected = sign(base);
  if (!safeCompare(signature, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(base, 'base64url').toString('utf8')) as TeacherSessionPayload;
    if (typeof payload.exp !== 'number' || !payload.teacherId) {
      return null;
    }
    if (Date.now() > payload.exp) {
      return null;
    }
    return {
      teacherId: payload.teacherId,
      organizationId: payload.organizationId ?? null,
      exp: payload.exp
    };
  } catch {
    return null;
  }
};
