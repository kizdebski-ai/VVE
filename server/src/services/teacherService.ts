import { Knex } from 'knex';
import { getDb } from '../db';
import { TeacherRecord } from '../models/teacher';

export const normalizeTeacherEmail = (email: string) => email.trim().toLowerCase();

export const findTeacherByEmail = async (
  email: string,
  trx?: Knex
): Promise<TeacherRecord | null> => {
  const db = trx ?? getDb();
  const normalizedEmail = normalizeTeacherEmail(email);
  const teacher = await db<TeacherRecord>('teachers').where({ email: normalizedEmail }).first();
  return teacher ?? null;
};

export const findTeacherById = async (id: string, trx?: Knex): Promise<TeacherRecord | null> => {
  const db = trx ?? getDb();
  const teacher = await db<TeacherRecord>('teachers').where({ id }).first();
  return teacher ?? null;
};

export interface CreateTeacherParams {
  email: string;
  fullName?: string | null;
  organizationId?: string | null;
}

export const createTeacher = async (
  params: CreateTeacherParams,
  trx?: Knex
): Promise<TeacherRecord> => {
  const db = trx ?? getDb();
  const normalizedEmail = normalizeTeacherEmail(params.email);
  const [created] = await db<TeacherRecord>('teachers')
    .insert({
      email: normalizedEmail,
      full_name: params.fullName ?? null,
      organization_id: params.organizationId ?? null
    })
    .returning('*');

  return created;
};

export const getOrCreateTeacher = async (
  params: CreateTeacherParams,
  trx?: Knex
): Promise<{ teacher: TeacherRecord; created: boolean }> => {
  const existing = await findTeacherByEmail(params.email, trx);
  if (existing) {
    return { teacher: existing, created: false };
  }
  const teacher = await createTeacher(params, trx);
  return { teacher, created: true };
};

export const markTeacherLogin = async (teacherId: string, trx?: Knex): Promise<void> => {
  const db = trx ?? getDb();
  await db('teachers')
    .where({ id: teacherId })
    .update({ last_login_at: new Date() });
};
