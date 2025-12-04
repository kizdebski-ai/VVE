import crypto from 'crypto';
import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';
import { Knex } from 'knex';
import { getDb } from '../db';
import { BoardRecord, BoardWithStudent } from '../models/board';
import { hashToken, verifyToken } from './teacherMagicLinks';
import { config } from '../config';

const DEFAULT_VALID_MONTHS = 6;

const addMonths = (date: Date, months: number) => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
};

const deriveStudentToken = (boardId: string, slug: string) => {
  const secret = process.env.STUDENT_TOKEN_SECRET || process.env.TEACHER_SESSION_SECRET || 'change-me';
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`${boardId}:${slug}`);
  return hmac.digest('base64url');
};

const generateSlug = async (db: Knex): Promise<string> => {
  // Try a few times to avoid collisions
  for (let i = 0; i < 5; i += 1) {
    const slug = randomBytes(6).toString('base64url');
    // eslint-disable-next-line no-await-in-loop
    const existing = await db<BoardRecord>('boards').where({ public_slug: slug }).first();
    if (!existing) return slug;
  }
  // Fallback to uuid fragment
  return uuidv4().slice(0, 12);
};

export interface CreateBoardParams {
  teacherId: string;
  organizationId: string | null;
  title?: string | null;
  studentName?: string | null;
  validUntil?: Date | null;
}

export interface CreateBoardResult {
  board: BoardRecord;
  studentToken: string;
  studentUrl: string;
}

export const createBoardForTeacher = async (params: CreateBoardParams): Promise<CreateBoardResult> => {
  const db = getDb();
  const now = new Date();
  const validUntil = params.validUntil ?? addMonths(now, DEFAULT_VALID_MONTHS);

  const slug = await generateSlug(db);
  const boardId = uuidv4();
  const studentToken = deriveStudentToken(boardId, slug);
  const studentTokenHash = await hashToken(studentToken);

  return db.transaction(async (trx) => {
    let studentId: string | null = null;
    if (params.studentName) {
      const studentRows = await trx('students')
        .insert({
          id: uuidv4(),
          teacher_id: params.teacherId,
          organization_id: params.organizationId,
          full_name: params.studentName
        })
        .returning('id');
      const first = studentRows[0];
      if (first) {
        studentId = typeof first === 'string' ? first : (first as any).id;
      }
    }

    const [board] = await trx<BoardRecord>('boards')
      .insert({
        id: boardId,
        organization_id: params.organizationId,
        teacher_id: params.teacherId,
        student_id: studentId,
        title: params.title ?? null,
        public_slug: slug,
        student_token_hash: studentTokenHash,
        valid_until: validUntil
      })
      .returning('*');

    const emptyDoc = new Y.Doc();
    const encoded = Y.encodeStateAsUpdate(emptyDoc);

    await trx('board_yjs_state').insert({
      board_id: board.id,
      ydoc_state: Buffer.from(encoded)
    });

    const studentUrl = `${config.teacherAppBaseUrl}/board/${slug}?token=${studentToken}`;

    return { board, studentToken, studentUrl };
  });
};

export interface ListBoardsResult {
  id: string;
  title: string | null;
  student_name: string | null;
  created_at: Date;
  valid_until: Date;
  public_slug: string | null;
  student_url: string;
  archived_at: Date | null;
}

export const listBoardsForTeacher = async (teacherId: string): Promise<ListBoardsResult[]> => {
  const db = getDb();
  const rows = await db<BoardRecord>('boards')
    .leftJoin('students', 'boards.student_id', 'students.id')
    .where('boards.teacher_id', teacherId)
    .andWhereNull('boards.deleted_at')
    .select(
      'boards.id',
      'boards.title',
      'students.full_name as student_name',
      'boards.created_at',
      'boards.valid_until',
      'boards.public_slug',
      'boards.archived_at'
    )
    .orderBy('boards.created_at', 'desc');

  return rows.map((row: any) => {
    const slug = row.public_slug;
    const token = deriveStudentToken(row.id, slug);
    const studentUrl = `${config.teacherAppBaseUrl}/board/${slug}?token=${token}`;
    return {
      id: row.id,
      title: row.title,
      student_name: row.student_name ?? null,
      created_at: row.created_at,
      valid_until: row.valid_until,
      public_slug: slug,
      student_url: studentUrl,
      archived_at: row.archived_at ?? null
    };
  });
};

export const findBoardBySlug = async (slug: string): Promise<BoardWithStudent | null> => {
  const db = getDb();
  const row = await db<BoardRecord>('boards')
    .leftJoin('students', 'boards.student_id', 'students.id')
    .where('boards.public_slug', slug)
    .first(
      'boards.*',
      db.ref('students.full_name').as('student_name')
    );
  if (!row) return null;
  return row as unknown as BoardWithStudent;
};

export interface UpdateBoardParams {
  title?: string | null;
  validUntil?: Date | null;
  archivedAt?: Date | null;
}

export const updateBoard = async (boardId: string, teacherId: string, params: UpdateBoardParams): Promise<BoardRecord | null> => {
  const db = getDb();
  const updates: Record<string, unknown> = {};
  if (params.title !== undefined) updates.title = params.title;
  if (params.validUntil !== undefined) updates.valid_until = params.validUntil;
  if (params.archivedAt !== undefined) updates.archived_at = params.archivedAt;

  const [updated] = await db<BoardRecord>('boards')
    .where({ id: boardId, teacher_id: teacherId, deleted_at: null })
    .update(updates)
    .returning('*');

  return updated ?? null;
};

export const verifyStudentTokenForBoard = async (board: BoardRecord, token: string): Promise<boolean> => {
  // Token is derived deterministically from board id + slug to keep it shareable without storing plaintext.
  const expectedRaw = deriveStudentToken(board.id, board.public_slug ?? '');
  const expectedBuf = Buffer.from(expectedRaw);
  const providedBuf = Buffer.from(token);
  if (expectedBuf.length !== providedBuf.length) return false;
  const sameRaw = crypto.timingSafeEqual(expectedBuf, providedBuf);
  if (!sameRaw) return false;
  return verifyToken(token, board.student_token_hash);
};
