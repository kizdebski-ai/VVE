import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// VVE-100 fixture spine: seed the deterministic local Pilot fixture before
// the browser tests start, so every spec can open the three contexts
// (Administrator/Teacher/Student) from server/data/pilot-fixture.json.
// Schema migrations are applied by the backend on boot (see webServer in
// playwright.config.js), so only the fixture seed runs here.

const serverDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'server'
);

export const pilotE2eEnv = {
  DATABASE_URL: process.env.PILOT_DATABASE_URL || 'postgres://vve:vve-test@127.0.0.1:5433/vve_test',
  ADMIN_SECRET: process.env.PILOT_ADMIN_SECRET || 'pilot-e2e-admin-secret',
  TEACHER_SESSION_SECRET: 'pilot-e2e-session-secret',
  // Links must point at the local app origin the browser actually opens.
  TEACHER_APP_BASE_URL: 'http://localhost:5173'
};

export default async function globalSetup() {
  execSync('npm run seed:pilot', {
    cwd: serverDir,
    env: { ...process.env, ...pilotE2eEnv },
    stdio: 'pipe'
  });
}
