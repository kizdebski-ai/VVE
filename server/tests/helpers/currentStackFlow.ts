import request from 'supertest';
import type { Express } from 'express';

/**
 * The admin→teacher→board→student flow through the Pilot stack
 * (CapabilityAccess + BoardLifecycle), expressed once and reusably.
 *
 * Every step is a real HTTP call against the app under test:
 *   1. The Administrator exchanges the shared passphrase for a twelve-hour
 *      HttpOnly session cookie (POST /api/admin/session) and creates a
 *      Teacher with exactly one active retrievable Teacher Access Link.
 *   2. The Teacher opens the access link; CapabilityAccess validates it and
 *      the stack exchanges it for a teacher session cookie, then redirects
 *      to the dashboard.
 *   3. The Teacher's first dashboard GET lazily creates the Personal Board
 *      (idempotent), then the Teacher creates a Managed Board and receives
 *      the working Board Access Link (`studentLink`, QA P1-2). A re-run for
 *      the same teacher reuses the existing boards through the dashboard
 *      view — the flow converges instead of accumulating demo boards.
 *   4. The Student opens the Board Access Link and receives board facts plus
 *      a scoped collaboration ws admission token.
 */
export interface CurrentStackFlowResult {
  teacherId: string;
  teacherAccessPath: string;
  adminSessionCookie: string;
  teacherSessionCookie: string;
  personalBoardId: string;
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
  adminPassphrase: string;
  teacherEmail: string;
  teacherFullName?: string;
  boardTitle?: string;
  studentLabel?: string;
}

const pathOf = (url: string): string => `${new URL(url).pathname}${new URL(url).search}`;

const cookieFrom = (res: request.Response): string => {
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (typeof raw !== 'string') {
    throw new Error('Expected a Set-Cookie header from the login route.');
  }
  return raw.split(';')[0] ?? raw;
};

export const driveCurrentStackLessonFlow = async (
  app: Express,
  {
    adminPassphrase,
    teacherEmail,
    teacherFullName = 'Flow Teacher',
    boardTitle = 'Flow Board',
    studentLabel = 'Flow Student'
  }: CurrentStackFlowOptions
): Promise<CurrentStackFlowResult> => {
  // 1a. Administrator passphrase → twelve-hour HttpOnly session.
  const loginRes = await request(app)
    .post('/api/admin/session')
    .send({ passphrase: adminPassphrase });
  if (loginRes.status !== 200) {
    throw new Error(`Admin session login failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
  }
  const adminSessionCookie = cookieFrom(loginRes);

  // 1b. Administrator creates the teacher and receives the ONE active link.
  const importRes = await request(app)
    .post('/api/admin/teachers')
    .set('Cookie', adminSessionCookie)
    .send({ email: teacherEmail, internalLabel: teacherFullName });
  if (importRes.status !== 200 && importRes.status !== 201) {
    throw new Error(`Admin teacher creation failed: ${importRes.status} ${JSON.stringify(importRes.body)}`);
  }
  const teacherLink: string | undefined = importRes.body.accessLink;
  const teacherId: string | undefined = importRes.body.teacherId;
  if (typeof teacherLink !== 'string' || typeof teacherId !== 'string') {
    throw new Error(`Admin teacher creation returned no access link: ${JSON.stringify(importRes.body)}`);
  }

  // 2. Teacher opens the access link → session cookie + dashboard redirect.
  const teacherLoginRes = await request(app).get(pathOf(teacherLink));
  if (teacherLoginRes.status !== 302) {
    throw new Error(`Teacher login failed: ${teacherLoginRes.status} ${JSON.stringify(teacherLoginRes.body)}`);
  }
  const teacherSessionCookie = cookieFrom(teacherLoginRes);

  // 3a. First dashboard visit lazily creates exactly one Personal Board.
  const dashboardRes = await request(app)
    .get('/api/teacher/boards')
    .set('Cookie', teacherSessionCookie);
  if (dashboardRes.status !== 200) {
    throw new Error(`Teacher dashboard failed: ${dashboardRes.status} ${JSON.stringify(dashboardRes.body)}`);
  }
  const personalBoardId: string | undefined = dashboardRes.body.personalBoard?.boardId;
  if (typeof personalBoardId !== 'string') {
    throw new Error(`Dashboard returned no Personal Board: ${JSON.stringify(dashboardRes.body)}`);
  }

  // 3b. The Teacher creates the demo Managed Board — or, on a re-run, reuses
  // the existing one through the dashboard view (copy WITHOUT rotation), so
  // the flow converges: one Personal Board, one Managed Board, one link.
  const dashboardBoards: Array<{
    boardId: string;
    state: string;
    publicSlug: string | null;
    boardAccessLink: string | null;
  }> = Array.isArray(dashboardRes.body.boards) ? dashboardRes.body.boards : [];
  const reusable = dashboardBoards.find(
    (board) => board.state === 'active' && typeof board.boardAccessLink === 'string' && board.boardAccessLink.length > 0
  );

  let studentLink: string;
  let boardId: string;
  let publicSlug: string;
  if (reusable && reusable.publicSlug) {
    studentLink = reusable.boardAccessLink as string;
    boardId = reusable.boardId;
    publicSlug = reusable.publicSlug;
  } else {
    const createBoardRes = await request(app)
      .post('/api/teacher/boards')
      .set('Cookie', teacherSessionCookie)
      .send({ title: boardTitle, studentLabel });
    if (createBoardRes.status !== 201) {
      throw new Error(
        `Teacher board creation failed: ${createBoardRes.status} ${JSON.stringify(createBoardRes.body)}`
      );
    }
    studentLink = createBoardRes.body.studentLink;
    boardId = createBoardRes.body.boardId;
    publicSlug = createBoardRes.body.publicSlug;
    if (typeof studentLink !== 'string' || studentLink.length === 0) {
      throw new Error(`Board creation returned no working studentLink: ${JSON.stringify(createBoardRes.body)}`);
    }
  }

  // 4. Student opens the Board Access Link and receives board facts + ws token.
  const studentRes = await request(app).get(pathOf(studentLink));
  if (studentRes.status !== 200) {
    throw new Error(`Student board access failed: ${studentRes.status} ${JSON.stringify(studentRes.body)}`);
  }

  return {
    teacherId,
    teacherAccessPath: pathOf(teacherLink),
    adminSessionCookie,
    teacherSessionCookie,
    personalBoardId,
    boardId,
    publicSlug,
    studentAccessPath: pathOf(studentLink),
    studentBoard: {
      wsToken: studentRes.body.wsToken,
      role: studentRes.body.role,
      teacherName: studentRes.body.teacherName,
      title: studentRes.body.title ?? null
    }
  };
};
