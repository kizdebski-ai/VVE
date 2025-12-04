import crypto, { randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { Knex } from 'knex';
import { config } from '../config';
import { getDb } from '../db';
import { TeacherMagicLinkRecord } from '../models/teacher';

const scryptAsync = promisify(crypto.scrypt);
const MAGIC_LINK_TTL_MS = 30 * 60 * 1000; // 30 minutes

const sanitizeUserAgent = (ua?: string | null) => {
  if (!ua) return null;
  const trimmed = ua.trim();
  return trimmed.slice(0, 500);
};

const buildMagicLinkUrl = (token: string, teacherId: string) => {
  const base = config.teacherAppBaseUrl || 'https://app.whitevue.com';
  let url: URL;
  try {
    url = new URL('/teacher/login', base);
  } catch {
    url = new URL('/teacher/login', 'https://app.whitevue.com');
  }
  url.searchParams.set('token', token);
  url.searchParams.set('id', teacherId);
  return url.toString();
};

const deriveTokenHash = async (token: string, salt: string): Promise<string> => {
  const buf = (await scryptAsync(token, salt, 64)) as Buffer;
  return buf.toString('base64');
};

export const hashToken = async (token: string): Promise<string> => {
  const salt = randomBytes(16).toString('base64');
  const derived = await deriveTokenHash(token, salt);
  return `${salt}:${derived}`;
};

export const verifyToken = async (token: string, stored: string): Promise<boolean> => {
  const [salt, hashed] = stored.split(':');
  if (!salt || !hashed) return false;
  const derived = await deriveTokenHash(token, salt);
  const expected = Buffer.from(hashed);
  const actual = Buffer.from(derived);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

export interface MagicLinkMetadata {
  ip?: string | null;
  userAgent?: string | null;
}

export interface MagicLinkCreationResult {
  token: string;
  url: string;
  expiresAt: Date;
  record: TeacherMagicLinkRecord;
}

export const createTeacherMagicLink = async (
  teacherId: string,
  meta?: MagicLinkMetadata,
  trx?: Knex
): Promise<MagicLinkCreationResult> => {
  const db = trx ?? getDb();
  const token = randomBytes(32).toString('base64url');
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS);

  const [record] = await db<TeacherMagicLinkRecord>('teacher_magic_links')
    .insert({
      teacher_id: teacherId,
      token_hash: tokenHash,
      expires_at: expiresAt,
      user_agent: sanitizeUserAgent(meta?.userAgent) ?? null,
      ip_addr: meta?.ip ?? null
    })
    .returning('*');

  const url = buildMagicLinkUrl(token, teacherId);
  return { token, url, expiresAt, record };
};

export interface MagicLinkConsumeResult {
  success: boolean;
  reason?: 'invalid' | 'expired' | 'used' | 'not_found';
  link?: TeacherMagicLinkRecord;
}

export const consumeMagicLink = async (
  teacherId: string,
  token: string,
  meta?: MagicLinkMetadata
): Promise<MagicLinkConsumeResult> => {
  const db = getDb();
  const now = new Date();
  const candidates = await db<TeacherMagicLinkRecord>('teacher_magic_links')
    .where({ teacher_id: teacherId })
    .andWhere('expires_at', '>', now)
    .andWhereNull('used_at')
    .orderBy('created_at', 'desc');

  let match: TeacherMagicLinkRecord | undefined;
  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await verifyToken(token, candidate.token_hash);
    if (ok) {
      match = candidate;
      break;
    }
  }

  if (!match) {
    return { success: false, reason: candidates.length ? 'invalid' : 'not_found' };
  }

  const userAgent = sanitizeUserAgent(meta?.userAgent);
  const ip = meta?.ip ?? null;

  return db.transaction(async (trx) => {
    const updated = await trx<TeacherMagicLinkRecord>('teacher_magic_links')
      .where({ id: match!.id, used_at: null })
      .update({
        used_at: new Date(),
        user_agent: userAgent ?? match!.user_agent ?? null,
        ip_addr: ip ?? match!.ip_addr ?? null
      });

    if (updated === 0) {
      return { success: false, reason: 'used' } as MagicLinkConsumeResult;
    }

    const [fresh] = await trx<TeacherMagicLinkRecord>('teacher_magic_links')
      .where({ id: match!.id })
      .limit(1);

    return { success: true, link: fresh };
  });
};
