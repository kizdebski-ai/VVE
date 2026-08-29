import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// VVE-100: launch the three Pilot browser contexts from the deterministic
// local Managed Board fixture (server/data/pilot-fixture.json, written by
// `npm run seed:pilot` through global-setup) via the CURRENT auth stack.
// VVE-101 re-routes authentication later; this spec must only follow links.

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'server',
  'data',
  'pilot-fixture.json'
);

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

test.describe('Pilot fixture: Administrator, Teacher, Student browser contexts', () => {
  // Declaration order matters in the CURRENT auth stack: opening the admin
  // panel auto-regenerates every teacher's permanent link (loadTeachers
  // POSTs /permanent-link per teacher), so the Teacher context consumes its
  // access link before the Administrator opens the panel. VVE-101 makes
  // admin views side-effect-free.

  test('Teacher opens the access link and lands on the dashboard with the seeded board', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // The Teacher Access Link is consumed by the backend login route (proxied
    // in dev) and exchanged for a session cookie.
    await page.goto(fixture.teacherAccessLink);

    await expect(page.getByRole('heading', { name: 'Moje tablice' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Lekcja pilotażowa').first()).toBeVisible({ timeout: 10000 });

    await context.close();
  });

  test('Student opens the board link and reaches the collaborative canvas', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(fixture.boardAccessLink);

    // Board entry card shows the board title and the Public Teacher Identity.
    await expect(page.getByRole('heading', { name: 'Lekcja pilotażowa' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Dawid Furmaniuk').first()).toBeVisible();

    await page.getByRole('button', { name: 'Dołącz do lekcji' }).click();

    // The collaborative canvas mounts and becomes visible.
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20000 });

    await context.close();
  });

  test('Administrator signs in with the admin secret and manages teachers', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('/admin/teachers');
    await expect(page.getByRole('heading', { name: 'Zarządzanie Nauczycielami' })).toBeVisible();

    // The seeded fixture teacher is listed with its permanent link status.
    await expect(page.getByText('pilot-teacher@vve-pilot.local')).toBeVisible({ timeout: 10000 });

    await context.close();
  });
});
