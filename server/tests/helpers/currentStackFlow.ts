import request from 'supertest';
import type { Express } from 'express';

/**
 * The admin→teacher→board→student flow through the CURRENT auth stack,
 * expressed once and reusably (VVE-100 fixture spine; VVE-101 re-routes it).
 *
 * Every step is a real HTTP call against the app under test:
 *   1. Administrator registers a Teacher (x-admin-secret) and receives the
 *      Teacher Access Link (permanent link).
 *   2. The Teacher opens the access link; the stack exchanges it for a
 *      teacher session cookie and redirects to the dashboard.
 *   3. The Teacher creates a Managed Board and receives the Board Access
 *      Link.
 *   4. The Student opens the Board Access Link and receives board facts plus
 *      a collaboration ws token.
 */
export interface CurrentStackFlowResult {
  teacherId: string;
  teacherAccessPath: string;
  teacherSessionCookie: string;
  boardId: string;
  publicSlug: string;
  studentAccessPath: string;
  studentBoard: {
    wsToken: string;
    role: string;
    teacherName: string;
    title: string | null;
  };
}

export interface CurrentStackFlowOptions {
  adminSecret: string;
  teacherEmail: string;
  teacherFullName?: string;
  boardTitle?: string;
}

const pathOf = (url: string): string => `${new URL(url).pathname}${new URL(url).search}`;

const cookieFrom = (res: request.Response): string => {
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (typeof raw !== 'string') {
    throw new Error('Expected a Set-Cookie header from the teacher login route.');
  }
  return raw.split(';')[0] ?? raw;
};

export const driveCurrentStackLessonFlow = async (
  app: Express,
  { adminSecret, teacherEmail, teacherFullName = 'Flow Teacher', boardTitle = 'Flow Board' }: CurrentStackFlowOptions
): Promise<CurrentStackFlowResult> => {
  // 1. Administrator registers the teacher and receives the access link.
  const importRes = await request(app)
    .post('/api/admin/teachers/import')
    .set('x-admin-secret', adminSecret)
    .send({ teachers: [{ email: teacherEmail, fullName: teacherFullName }] });
  if (importRes.status !== 200) {
    throw new Error(`Admin teacher import failed: ${importRes.status} ${JSON.stringify(importRes.body)}`);
  }
  const teacherLink: string | undefined = importRes.body.results?.[0]?.permanentLink;
  const teacherId: string | undefined = importRes.body.results?.[0]?.teacherId;
  if (typeof teacherLink !== 'string' || typeof teacherId !== 'string') {
    throw new Error(`Admin teacher import returned no permanent link: ${JSON.stringify(importRes.body)}`);
  }

  // 2. Teacher opens the access link → session cookie + dashboard redirect.
  const loginRes = await request(app).get(pathOf(teacherLink));
  if (loginRes.status !== 302) {
    throw new Error(`Teacher login failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
  }
  const teacherSessionCookie = cookieFrom(loginRes);

  // 3. Teacher creates a Managed Board and receives the Board Access Link.
  const createBoardRes = await request(app)
    .post('/api/teacher/boards')
    .set('Cookie', teacherSessionCookie)
    .send({ title: boardTitle, studentName: 'Flow Student' });
  if (createBoardRes.status !== 201) {
    throw new Error(
      `Teacher board creation failed: ${createBoardRes.status} ${JSON.stringify(createBoardRes.body)}`
    );
  }
  const studentUrl: string = createBoardRes.body.studentUrl;
  const boardId: string = createBoardRes.body.boardId;
  const publicSlug: string = createBoardRes.body.publicSlug;

  // 4. Student opens the Board Access Link and receives board facts + ws token.
  const studentRes = await request(app).get(pathOf(studentUrl));
  if (studentRes.status !== 200) {
    throw new Error(`Student board access failed: ${studentRes.status} ${JSON.stringify(studentRes.body)}`);
  }

  return {
    teacherId,
    teacherAccessPath: pathOf(teacherLink),
    teacherSessionCookie,
    boardId,
    publicSlug,
    studentAccessPath: pathOf(studentUrl),
    studentBoard: {
      wsToken: studentRes.body.wsToken,
      role: studentRes.body.role,
      teacherName: studentRes.body.teacherName,
      title: studentRes.body.title ?? null
    }
  };
};
