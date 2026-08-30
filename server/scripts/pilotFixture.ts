import fs from 'fs';
import path from 'path';
import { Knex } from 'knex';

import { getDb } from '../src/db';
import { createCapabilityAccess } from '../src/pilot/capabilityAccess';
import { createBoardLifecycle } from '../src/pilot/boardLifecycle';
import { getOrCreateTeacher } from '../src/services/teacherService';
import { PILOT_MANIFEST_VERSION } from '../src/pilot/availability';

/**
 * Deterministic local Pilot fixture (VVE-100, slice S0; re-routed in
 * VVE-101/102 through the CapabilityAccess + BoardLifecycle modules).
 *
 * Seeds ONE teacher with ONE Personal Board and ONE Managed Board into local
 * PostgreSQL so Playwright/browser tests can launch three contexts through
 * the Pilot stack:
 *
 *   - Administrator: passphrase login (ADMIN_PASSPHRASE → 12h session)
 *   - Teacher:       the printed Teacher Access Link (one active, retrievable)
 *   - Student:       the printed Board Access Link of the fixture Managed Board
 *
 * Determinism: fixed inputs (email, names, board title, Student Label).
 * Re-running deletes the fixture teacher's boards and recreates exactly one
 * of each kind, so the seeded structure converges. The Teacher Access Link is
 * REUSED when already active (viewing never rotates — VVE-101), and
 * credentials are written to server/data/pilot-fixture.json, which is
 * gitignored. The Managed Board's twelve-month validity is fixed by
 * BoardLifecycle, not by this fixture.
 */

export const FIXTURE_TEACHER_EMAIL = 'pilot-teacher@vve-pilot.local';
export const FIXTURE_TEACHER_NAME = 'Nauczyciel Pilotowy';
export const FIXTURE_ORG_NAME = 'VVE Pilot Fixture';
export const FIXTURE_BOARD_TITLE = 'Lekcja pilotażowa';
export const FIXTURE_STUDENT_LABEL = 'Uczeń';

export interface PilotFixture {
  manifestVersion: string;
  seededAt: string;
  teacherId: string;
  personalBoardId: string;
  boardId: string;
  publicSlug: string;
  /** ADMIN_PASSPHRASE the backend must run with for the Administrator context. */
  adminPassphrase: string;
  /** Teacher Access Link (opens the teacher login flow). */
  teacherAccessLink: string;
  /** Board Access Link of the fixture Managed Board (opens the student board entry). */
  boardAccessLink: string;
  validUntil: string;
}

export const seedPilotFixture = async (): Promise<PilotFixture> => {
  const db: Knex = getDb();
  const access = createCapabilityAccess();
  const lifecycle = createBoardLifecycle({ access });

  // Fixed organization (upsert by name keeps reruns deterministic).
  const existingOrg = await db('organizations').where({ name: FIXTURE_ORG_NAME }).first();
  let orgId: string | undefined = existingOrg?.id;
  if (!orgId) {
    const rows: Array<{ id: string }> = await db('organizations')
      .insert({ name: FIXTURE_ORG_NAME })
      .returning('id');
    orgId = rows[0]?.id;
  }
  if (!orgId) {
    throw new Error('Failed to resolve the fixture organization id.');
  }

  // Fixed teacher (upsert by email).
  const { teacher } = await getOrCreateTeacher({
    email: FIXTURE_TEACHER_EMAIL,
    fullName: FIXTURE_TEACHER_NAME,
    organizationId: orgId
  });
  if (!teacher.is_active) {
    await db('teachers').where({ id: teacher.id }).update({ is_active: true });
  }

  // Reset the teacher's boards. Access logs reference boards without a
  // cascade, so they are removed first; the boards row delete cascades the
  // document state, and fixture students no longer exist (VVE-102 stores the
  // Student Label on the board).
  const priorBoardIds = await db('boards').where({ teacher_id: teacher.id }).pluck('id');
  if (priorBoardIds.length > 0) {
    await db('board_access_logs').whereIn('board_id', priorBoardIds).del();
  }
  await db('boards').where({ teacher_id: teacher.id }).del();

  // Exactly ONE active retrievable Teacher Access Link; re-seeding REUSES the
  // existing link (side-effect-free) instead of rotating it.
  const linkResult = await access.createOrReuseTeacherAccessLink({
    email: FIXTURE_TEACHER_EMAIL,
    internalLabel: FIXTURE_TEACHER_NAME,
    organizationId: orgId
  });
  if (!linkResult.ok) {
    throw new Error(`Seeding the Teacher Access Link failed: ${linkResult.reason}`);
  }
  // Fail loudly rather than emit a fixture whose link cannot log in.
  const decision = await access.decide({
    credential: { kind: 'teacherAccessLink', token: linkResult.token },
    action: 'teacher.openDashboard',
    now: new Date()
  });
  if (!decision.granted) {
    throw new Error(`Seeded Teacher Access Link was denied by CapabilityAccess: ${decision.reason}`);
  }

  // One Personal Board (lazy-creation command — the same path the dashboard
  // uses) and one Managed Board with twelve-month validity.
  const personal = await lifecycle.execute({ kind: 'ensurePersonalBoard', teacherId: teacher.id }, new Date());
  if (!personal.ok) {
    throw new Error(`Seeding the Personal Board failed: ${personal.reason}`);
  }
  if (personal.command !== 'ensurePersonalBoard') {
    throw new Error('Personal Board command returned an unexpected result.');
  }

  const managed = await lifecycle.execute(
    {
      kind: 'createManagedBoard',
      teacherId: teacher.id,
      studentLabel: FIXTURE_STUDENT_LABEL,
      title: FIXTURE_BOARD_TITLE
    },
    new Date()
  );
  if (!managed.ok) {
    throw new Error(`Seeding the Managed Board failed: ${managed.reason}`);
  }
  if (managed.command !== 'createManagedBoard' || managed.boardAccessLink === undefined) {
    throw new Error('Seeded Managed Board produced no Board Access Link.');
  }

  const fixture: PilotFixture = {
    manifestVersion: PILOT_MANIFEST_VERSION,
    seededAt: new Date().toISOString(),
    teacherId: teacher.id,
    personalBoardId: personal.board.boardId,
    boardId: managed.board.boardId,
    publicSlug: managed.board.publicSlug as string,
    adminPassphrase: process.env.ADMIN_PASSPHRASE || '',
    teacherAccessLink: linkResult.accessLink,
    boardAccessLink: managed.boardAccessLink,
    validUntil: managed.board.validUntil ? new Date(managed.board.validUntil).toISOString() : ''
  };

  return fixture;
};

export const FIXTURE_OUTPUT_PATH = path.join(process.cwd(), 'data', 'pilot-fixture.json');

export const writeFixtureOutput = (fixture: PilotFixture, target = FIXTURE_OUTPUT_PATH): string => {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(fixture, null, 2)}\n`, { mode: 0o600 });
  return target;
};

const isCli = (() => {
  const entry = process.argv[1] ?? '';
  return entry.endsWith('pilotFixture.ts') || entry.endsWith('pilotFixture.js');
})();

if (isCli) {
  (async () => {
    if (!process.env.DATABASE_URL) {
      console.error(
        '[pilot-fixture] DATABASE_URL is required (local container: postgres://vve:vve-test@127.0.0.1:5433/vve_test).'
      );
      process.exit(1);
    }
    if (!process.env.ADMIN_PASSPHRASE) {
      console.error(
        '[pilot-fixture] ADMIN_PASSPHRASE is required; the backend must run with the same value.'
      );
      process.exit(1);
    }
    if (!process.env.TEACHER_APP_BASE_URL) {
      console.error(
        '[pilot-fixture] TEACHER_APP_BASE_URL is required so links point at the local app origin.'
      );
      process.exit(1);
    }

    const fixture = await seedPilotFixture();
    const target = writeFixtureOutput(fixture);

    console.log('[pilot-fixture] Seeded deterministic local Pilot fixture.');
    console.log(`[pilot-fixture] Teacher:  ${FIXTURE_TEACHER_EMAIL} (${FIXTURE_TEACHER_NAME})`);
    console.log(`[pilot-fixture] Boards:   private + ${FIXTURE_BOARD_TITLE} (valid until ${fixture.validUntil})`);
    console.log('');
    console.log('Browser contexts:');
    console.log(`  Administrator: passphrase login at ${new URL(fixture.teacherAccessLink).origin}/admin/teachers`);
    console.log(`  Teacher:       ${fixture.teacherAccessLink}`);
    console.log(`  Student:       ${fixture.boardAccessLink}`);
    console.log('');
    console.log(`[pilot-fixture] Credentials written to ${target} (gitignored).`);
    process.exit(0);
  })().catch((error) => {
    console.error('[pilot-fixture] Seeding failed:', error);
    process.exit(1);
  });
}
