import express, { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { logger } from '../logger';
import { config } from '../config';
import { createTeacherMagicLink } from '../services/teacherMagicLinks';
import { getOrCreateTeacher, findTeacherById, normalizeTeacherEmail } from '../services/teacherService';

const upload = multer({ storage: multer.memoryStorage() });
const textParser = express.text({ type: ['text/csv', 'text/plain', 'application/csv'] });

type ImportRow = { email: string; fullName?: string | null };

const isEmailValid = (email: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);

const parseCsvTeachers = (csv: string): ImportRow[] => {
  try {
    const parsed = parse(csv, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    }) as Array<Record<string, string>>;

    return parsed
      .map((row) => ({
        email: row.email || row.Email || '',
        fullName: row.full_name || row.fullName || row.name || null
      }))
      .filter((row) => row.email);
  } catch (error) {
    logger.warn('Failed to parse teacher CSV', { error: (error as Error).message });
    return [];
  }
};

const parseBodyTeachers = (body: unknown): ImportRow[] => {
  if (!body) return [];
  if (typeof body === 'string') {
    return parseCsvTeachers(body);
  }
  if (Array.isArray((body as any).teachers)) {
    const entries = (body as any).teachers as Array<Record<string, unknown>>;
    return entries
      .map((entry) => ({
        email: typeof entry.email === 'string' ? entry.email : '',
        fullName:
          typeof entry.fullName === 'string'
            ? entry.fullName
            : typeof entry.full_name === 'string'
              ? entry.full_name
              : null
      }))
      .filter((row) => row.email);
  }
  if (typeof (body as any).email === 'string') {
    return [
      {
        email: (body as any).email as string,
        fullName:
          typeof (body as any).fullName === 'string'
            ? ((body as any).fullName as string)
            : typeof (body as any).full_name === 'string'
              ? ((body as any).full_name as string)
              : null
      }
    ];
  }
  return [];
};

const dedupeByEmail = (rows: ImportRow[]): ImportRow[] => {
  const seen = new Set<string>();
  const result: ImportRow[] = [];
  for (const row of rows) {
    const normalized = normalizeTeacherEmail(row.email);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push({ ...row, email: normalized });
  }
  return result;
};

export const createAdminTeachersRouter = () => {
  const router = Router();

  router.post('/import', textParser, upload.single('file'), async (req, res) => {
    const fileContent = req.file ? req.file.buffer.toString('utf-8') : null;
    const rowsFromFile = fileContent ? parseCsvTeachers(fileContent) : [];
    const bodyRows = parseBodyTeachers(req.body);

    const entries = dedupeByEmail([...rowsFromFile, ...bodyRows]).slice(0, 500);
    if (!entries.length) {
      res.status(400).json({ error: 'Brak danych nauczycieli w zadaniu.' });
      return;
    }

    const results: Array<Record<string, unknown>> = [];
    let createdCount = 0;

    for (const row of entries) {
      if (!isEmailValid(row.email)) {
        results.push({ email: row.email, error: 'Nieprawidlowy email.' });
        continue;
      }

      try {
        const { teacher, created } = await getOrCreateTeacher({
          email: row.email,
          fullName: row.fullName ?? null
        });
        if (created) createdCount += 1;

        const magicLink = await createTeacherMagicLink(teacher.id);
        results.push({
          email: teacher.email,
          fullName: teacher.full_name,
          teacherId: teacher.id,
          created,
          expiresAt: magicLink.expiresAt.toISOString(),
          magicLink: config.nodeEnv === 'production' ? undefined : magicLink.url
        });
      } catch (error) {
        logger.error('Failed to import teacher', { email: row.email, error: (error as Error).message });
        results.push({ email: row.email, error: 'Import failed.' });
      }
    }

    res.json({
      imported: results.length,
      created: createdCount,
      results
    });
  });

  router.post('/:id/magic-link', async (req, res) => {
    const teacherId = req.params.id;
    try {
      const teacher = await findTeacherById(teacherId);
      if (!teacher) {
        res.status(404).json({ error: 'Teacher not found.' });
        return;
      }
      const magicLink = await createTeacherMagicLink(teacherId);
      res.json({
        teacherId,
        expiresAt: magicLink.expiresAt.toISOString(),
        magicLink: config.nodeEnv === 'production' ? undefined : magicLink.url
      });
    } catch (error) {
      logger.error('Failed to generate magic link', { teacherId, error: (error as Error).message });
      res.status(500).json({ error: 'Unable to generate magic link.' });
    }
  });

  return router;
};
