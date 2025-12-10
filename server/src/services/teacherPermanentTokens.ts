import crypto, { randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { Knex } from 'knex';
import { config } from '../config';
import { getDb } from '../db';
import { TeacherRecord } from '../models/teacher';

const scryptAsync = promisify(crypto.scrypt);

/**
 * Derives a hash from a token for secure storage.
 */
const deriveTokenHash = async (token: string, salt: string): Promise<string> => {
    const buf = (await scryptAsync(token, salt, 64)) as Buffer;
    return buf.toString('base64');
};

/**
 * Hashes a token with a random salt for secure storage.
 */
export const hashPermanentToken = async (token: string): Promise<string> => {
    const salt = randomBytes(16).toString('base64');
    const derived = await deriveTokenHash(token, salt);
    return `${salt}:${derived}`;
};

/**
 * Verifies a token against a stored hash.
 */
export const verifyPermanentToken = async (token: string, stored: string): Promise<boolean> => {
    const [salt, hashed] = stored.split(':');
    if (!salt || !hashed) return false;
    const derived = await deriveTokenHash(token, salt);
    const expected = Buffer.from(hashed);
    const actual = Buffer.from(derived);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
};

/**
 * Builds the permanent dashboard URL for a teacher.
 */
export const buildTeacherDashboardUrl = (token: string, teacherId: string): string => {
    const base = config.teacherAppBaseUrl || 'https://app.whitevue.com';
    let url: URL;
    try {
        url = new URL('/teacher/login', base);
    } catch {
        url = new URL('/teacher/login', 'https://app.whitevue.com');
    }
    url.searchParams.set('token', token);
    url.searchParams.set('id', teacherId);
    url.searchParams.set('permanent', '1');
    return url.toString();
};

export interface PermanentTokenResult {
    token: string;
    url: string;
}

/**
 * Creates or retrieves a permanent access token for a teacher.
 * If the teacher already has a permanent token, generates a new one (for regeneration purposes).
 * The token never expires and can be used repeatedly.
 */
export const createOrGetPermanentToken = async (
    teacherId: string,
    forceRegenerate = false,
    trx?: Knex
): Promise<PermanentTokenResult> => {
    const db = trx ?? getDb();

    // Check if teacher exists and has a token
    const teacher = await db<TeacherRecord>('teachers').where({ id: teacherId }).first();
    if (!teacher) {
        throw new Error('Teacher not found');
    }

    // If teacher has a token and we're not forcing regeneration, we can't retrieve
    // the original token (it's hashed). We need to regenerate.
    // In practice, the URL should be stored/displayed when first created.
    // For admin copy functionality, we always regenerate on demand.

    // Generate a new permanent token
    const token = randomBytes(32).toString('base64url');
    const tokenHash = await hashPermanentToken(token);

    await db('teachers')
        .where({ id: teacherId })
        .update({ permanent_token_hash: tokenHash });

    const url = buildTeacherDashboardUrl(token, teacherId);

    return { token, url };
};

/**
 * Verifies a permanent token for a teacher.
 * Returns the teacher record if valid, null otherwise.
 */
export const verifyTeacherPermanentToken = async (
    teacherId: string,
    token: string
): Promise<TeacherRecord | null> => {
    const db = getDb();
    const teacher = await db<TeacherRecord>('teachers').where({ id: teacherId }).first();

    if (!teacher || !teacher.permanent_token_hash) {
        return null;
    }

    const valid = await verifyPermanentToken(token, teacher.permanent_token_hash);
    return valid ? teacher : null;
};
