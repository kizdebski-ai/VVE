import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// VVE-101: launch the Pilot browser contexts from the deterministic local
// fixture (server/data/pilot-fixture.json, written by `npm run seed:pilot`
// through global-setup) through the CapabilityAccess stack:
//   - Teacher: opens the single active Teacher Access Link.
//   - Student: opens the Board Access Link; sees the exact Public Teacher
//     Identity (ADR-0009).
//   - Administrator: passphrase login (ADR-0005), side-effect-free list with
//     copyable links, explicit regeneration (old link dies immediately) and
//     deactivation — all with Polish copy.

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

const adminPassphrase = process.env.PILOT_ADMIN_PASSPHRASE || 'pilot-e2e-admin-passphrase';

test.describe('Pilot fixture: Administrator, Teacher, Student browser contexts', () => {
  test('Teacher opens the access link and lands on the dashboard with the seeded board', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // The Teacher Access Link is exchanged for a session cookie (proxied in
    // dev); viewing the dashboard never rotates the link.
    await page.goto(fixture.teacherAccessLink);

    await expect(page.getByRole('heading', { name: 'Moje tablice' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Lekcja pilotażowa').first()).toBeVisible({ timeout: 10000 });

    await context.close();
  });

  test('Student opens the board link and reaches the collaborative canvas', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(fixture.boardAccessLink);

    // Board entry card shows the board title and the exact Public Teacher
    // Identity (ADR-0009).
    await expect(page.getByRole('heading', { name: 'Lekcja pilotażowa' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Dawid Furmaniuk - Matsin').first()).toBeVisible();

    await page.getByRole('button', { name: 'Dołącz do lekcji' }).click();

    // The collaborative canvas mounts and becomes visible.
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20000 });

    await context.close();
  });

  test('Two Student sessions converge, disconnect becomes read-only, reconnect and reload preserve the acknowledged lesson', async ({ browser }) => {
    const firstContext = await browser.newContext();
    const secondContext = await browser.newContext();
    const first = await firstContext.newPage();
    const second = await secondContext.newPage();

    const join = async (page) => {
      await page.goto(fixture.boardAccessLink);
      await page.getByRole('button', { name: 'Dołącz do lekcji' }).click();
      await expect(page.locator('canvas.static-layer')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('collaboration-read-only')).toBeHidden({ timeout: 5_000 });
    };
    await join(first);
    await join(second);

    // Presence is hydrated for a later join and converges on both devices.
    await expect(first.getByText('2 online')).toBeVisible({ timeout: 5_000 });
    await expect(second.getByText('2 online')).toBeVisible({ timeout: 5_000 });

    const secondCanvas = second.locator('canvas.static-layer');
    const beforeRemote = await secondCanvas.evaluate((canvas) => canvas.toDataURL());
    const drawCanvas = first.locator('canvas.draw-layer');
    const box = await drawCanvas.boundingBox();
    expect(box).not.toBeNull();
    const startX = box.x + box.width * 0.52;
    const startY = box.y + box.height * 0.56;
    await first.mouse.move(startX, startY);
    await first.mouse.down();
    await first.mouse.move(startX + 70, startY + 35, { steps: 10 });
    await first.mouse.up();

    // Same Board Access Link in another session receives the durable update.
    await expect.poll(
      () => secondCanvas.evaluate((canvas) => canvas.toDataURL()),
      { timeout: 5_000 }
    ).not.toBe(beforeRemote);
    const acknowledgedView = await secondCanvas.evaluate((canvas) => canvas.toDataURL());

    // Network loss changes the session to read-only well inside the 2 s gate.
    const disconnectedAt = Date.now();
    await secondContext.setOffline(true);
    await expect(second.getByTestId('collaboration-read-only')).toBeVisible({ timeout: 2_000 });
    expect(Date.now() - disconnectedAt).toBeLessThan(2_000);

    const whileOffline = await secondCanvas.evaluate((canvas) => canvas.toDataURL());
    const offlineBox = await second.locator('canvas.draw-layer').boundingBox();
    await second.mouse.move(offlineBox.x + 420, offlineBox.y + 360);
    await second.mouse.down();
    await second.mouse.move(offlineBox.x + 480, offlineBox.y + 390, { steps: 6 });
    await second.mouse.up();
    expect(await secondCanvas.evaluate((canvas) => canvas.toDataURL())).toBe(whileOffline);

    // Editing returns only after the fresh synchronization-complete frame.
    await secondContext.setOffline(false);
    await expect(second.getByTestId('collaboration-read-only')).toBeHidden({ timeout: 5_000 });

    // A fresh page hydrates snapshot + durable log to the same visible state.
    await second.reload();
    await expect(second.locator('canvas.static-layer')).toBeVisible({ timeout: 20_000 });
    await expect(second.getByTestId('collaboration-read-only')).toBeHidden({ timeout: 5_000 });
    await expect.poll(
      () => second.locator('canvas.static-layer').evaluate((canvas) => canvas.toDataURL()),
      { timeout: 5_000 }
    ).toBe(acknowledgedView);

    await firstContext.close();
    await secondContext.close();
  });

  test('Whiteboard commands keep undo participant-scoped and whole-board clear Teacher-only', async ({ browser }) => {
    const teacherContext = await browser.newContext();
    const teacher = await teacherContext.newPage();
    await teacher.goto(fixture.teacherAccessLink);
    await expect(teacher.getByRole('heading', { name: 'Moje tablice' })).toBeVisible({ timeout: 15_000 });

    const boardLabel = `E2E komendy ${Date.now()}`;
    await teacher.getByRole('button', { name: 'Nowa tablica ucznia' }).click();
    await teacher.getByLabel('Etykieta ucznia / grupy').fill(boardLabel);
    await teacher.getByLabel('Temat lekcji (opcjonalnie)').fill('Test komend tablicy');
    await teacher.getByRole('button', { name: 'Utwórz tablicę' }).click();
    const freshLink = teacher.locator('.modal-panel .keyway.fresh .keyway-channel');
    await expect(freshLink).toBeVisible({ timeout: 10_000 });
    const boardAccessLink = (await freshLink.innerText()).trim();
    await teacher.locator('.modal-foot').getByRole('button', { name: 'Zamknij' }).click();

    const firstContext = await browser.newContext();
    const secondContext = await browser.newContext();
    const first = await firstContext.newPage();
    const second = await secondContext.newPage();
    const join = async (page) => {
      await page.goto(boardAccessLink);
      await page.getByRole('button', { name: 'Dołącz do lekcji' }).click();
      await expect(page.locator('canvas.static-layer')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('collaboration-read-only')).toBeHidden({ timeout: 5_000 });
    };
    await join(first);
    await join(second);

    const firstStatic = first.locator('canvas.static-layer');
    const secondStatic = second.locator('canvas.static-layer');
    const initial = await secondStatic.evaluate((canvas) => canvas.toDataURL());
    const drawStroke = async (page, xRatio, yRatio) => {
      const box = await page.locator('canvas.draw-layer').boundingBox();
      expect(box).not.toBeNull();
      const x = box.x + box.width * xRatio;
      const y = box.y + box.height * yRatio;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 80, y + 35, { steps: 12 });
      await page.mouse.up();
    };
    const waitForView = async (canvas, expected) => {
      await expect.poll(
        () => canvas.evaluate((node) => node.toDataURL()),
        { timeout: 5_000 }
      ).toBe(expected);
    };

    await drawStroke(first, 0.28, 0.35);
    await expect.poll(
      () => secondStatic.evaluate((canvas) => canvas.toDataURL()),
      { timeout: 5_000 }
    ).not.toBe(initial);
    const firstOnly = await secondStatic.evaluate((canvas) => canvas.toDataURL());

    await drawStroke(second, 0.62, 0.64);
    await expect.poll(
      () => firstStatic.evaluate((canvas) => canvas.toDataURL()),
      { timeout: 5_000 }
    ).not.toBe(firstOnly);
    const both = await firstStatic.evaluate((canvas) => canvas.toDataURL());
    await waitForView(secondStatic, both);

    // First participant rewinds only their own transaction; the second
    // participant's stroke remains and their history is still independent.
    await first.locator('[data-tool-id="tool.undo"]').click();
    await expect.poll(
      () => secondStatic.evaluate((canvas) => canvas.toDataURL()),
      { timeout: 5_000 }
    ).not.toBe(both);
    const secondOnly = await secondStatic.evaluate((canvas) => canvas.toDataURL());
    expect(secondOnly).not.toBe(initial);
    expect(secondOnly).not.toBe(firstOnly);

    await second.locator('[data-tool-id="tool.undo"]').click();
    await waitForView(firstStatic, initial);
    await waitForView(secondStatic, initial);

    await first.locator('[data-tool-id="tool.redo"]').click();
    await waitForView(secondStatic, firstOnly);
    await second.locator('[data-tool-id="tool.redo"]').click();
    await waitForView(firstStatic, both);

    // Students have no whole-board clear affordance. The owning Teacher has
    // it, confirms explicitly, and both Student sessions converge to empty.
    await expect(first.locator('[data-tool-id="tool.clearBoard"]')).toHaveCount(0);
    const row = teacher.locator('.board-row', { hasText: boardLabel });
    const teacherBoardPromise = teacherContext.waitForEvent('page');
    await row.getByRole('button', { name: 'Otwórz' }).click();
    const teacherBoard = await teacherBoardPromise;
    await expect(teacherBoard.getByText('Tablica nauczyciela')).toBeVisible({ timeout: 10_000 });
    await teacherBoard.getByRole('button', { name: 'Otwórz tablicę' }).click();
    await expect(teacherBoard.locator('canvas.static-layer')).toBeVisible({ timeout: 20_000 });
    await expect(teacherBoard.getByTestId('collaboration-read-only')).toBeHidden({ timeout: 5_000 });
    const clearButton = teacherBoard.locator('[data-tool-id="tool.clearBoard"]');
    await expect(clearButton).toBeVisible();
    teacherBoard.once('dialog', (dialog) => dialog.accept());
    await clearButton.click();
    await waitForView(firstStatic, initial);
    await waitForView(secondStatic, initial);

    await firstContext.close();
    await secondContext.close();
    await teacherContext.close();
  });

  test('Math, physics, coordinates, shapes, lines, and calculator complete the collaborative workflow', async ({ browser }) => {
    test.setTimeout(90_000);
    const teacherContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const teacher = await teacherContext.newPage();
    await teacher.goto(fixture.teacherAccessLink);
    await expect(teacher.getByRole('heading', { name: 'Moje tablice' })).toBeVisible({ timeout: 15_000 });

    const boardLabel = `E2E narzędzia ${Date.now()}`;
    await teacher.getByRole('button', { name: 'Nowa tablica ucznia' }).click();
    await teacher.getByLabel('Etykieta ucznia / grupy').fill(boardLabel);
    await teacher.getByLabel('Temat lekcji (opcjonalnie)').fill('Test narzędzi matematycznych i fizycznych');
    await teacher.getByRole('button', { name: 'Utwórz tablicę' }).click();
    const freshLink = teacher.locator('.modal-panel .keyway.fresh .keyway-channel');
    await expect(freshLink).toBeVisible({ timeout: 10_000 });
    const boardAccessLink = (await freshLink.innerText()).trim();
    await teacher.locator('.modal-foot').getByRole('button', { name: 'Zamknij' }).click();

    const firstContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const secondContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const first = await firstContext.newPage();
    const second = await secondContext.newPage();
    const browserErrors = [];
    for (const page of [first, second]) {
      page.on('console', (message) => {
        if (message.type() === 'error') browserErrors.push(message.text());
      });
      page.on('pageerror', (error) => browserErrors.push(error.message));
    }
    const join = async (page) => {
      await page.goto(boardAccessLink);
      await page.getByRole('button', { name: 'Dołącz do lekcji' }).click();
      await expect(page.locator('canvas.static-layer')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('collaboration-read-only')).toBeHidden({ timeout: 5_000 });
    };
    await join(first);
    await join(second);

    // Calculator is functional and opening another required panel closes it.
    await first.locator('[data-tool-id="panel.calculator"]').click();
    const calculator = first.getByRole('dialog', { name: 'Kalkulator naukowy' });
    await expect(calculator).toBeVisible();
    await calculator.locator('.two').click();
    await calculator.locator('.add').click();
    await calculator.locator('.three').click();
    await calculator.locator('.btn-equal').click();
    await expect(calculator.locator('.result')).toHaveText('5');

    await first.locator('[data-tool-id="panel.mathGraph"]').click();
    await expect(calculator).toBeHidden();
    const mathPanel = first.getByRole('dialog', { name: 'Wykres funkcji' });
    await expect(mathPanel).toBeVisible();
    await mathPanel.getByLabel('Funkcja f(x)').fill('sin(x)');
    await mathPanel.getByLabel('Od').fill('-8');
    await mathPanel.getByLabel('Do').fill('8');
    await mathPanel.getByRole('button', { name: 'Dodaj wykres' }).click();
    await expect(mathPanel).toBeHidden();

    const firstMath = first.locator('[data-object-type="mathFunctionPlot"]');
    const secondMath = second.locator('[data-object-type="mathFunctionPlot"]');
    await expect(firstMath).toBeVisible({ timeout: 5_000 });
    await expect(secondMath).toBeVisible({ timeout: 5_000 });

    // A direct manipulation synchronizes, and local undo/redo reverses only
    // this participant's graph movement.
    const initialSecondBox = await secondMath.boundingBox();
    await first.locator('[data-tool-id="tool.select"]').click();
    await firstMath.click();
    await expect(firstMath).toHaveClass(/is-selected/);
    const firstMathBox = await firstMath.boundingBox();
    await first.mouse.move(firstMathBox.x + firstMathBox.width / 2, firstMathBox.y + firstMathBox.height / 2);
    await first.mouse.down();
    await first.mouse.move(
      firstMathBox.x + firstMathBox.width / 2 + 70,
      firstMathBox.y + firstMathBox.height / 2 + 45,
      { steps: 8 }
    );
    await first.mouse.up();
    await expect.poll(async () => (await secondMath.boundingBox()).x, { timeout: 5_000 })
      .not.toBeCloseTo(initialSecondBox.x, 0);
    const movedSecondBox = await secondMath.boundingBox();

    await first.locator('[data-tool-id="tool.undo"]').click();
    await expect.poll(async () => (await secondMath.boundingBox()).x, { timeout: 5_000 })
      .toBeCloseTo(initialSecondBox.x, 0);
    await first.locator('[data-tool-id="tool.redo"]').click();
    await expect.poll(async () => (await secondMath.boundingBox()).x, { timeout: 5_000 })
      .toBeCloseTo(movedSecondBox.x, 0);

    await first.locator('[data-tool-id="panel.physicsGraph"]').click();
    const physicsPanel = first.getByRole('dialog', { name: 'Wykres fizyczny' });
    await physicsPanel.getByLabel(/Punkty danych/).fill('0,0\n1,9.8\n2,19.6');
    await physicsPanel.getByLabel('Opis osi poziomej').fill('czas');
    await physicsPanel.getByLabel('Opis osi pionowej').fill('prędkość');
    await physicsPanel.getByRole('button', { name: 'Dodaj wykres' }).click();
    await expect(second.locator('[data-object-type="physicsDataPlot"]')).toBeVisible({ timeout: 5_000 });

    await first.locator('[data-tool-id="panel.coordinateSystem"]').click();
    await first.getByRole('button', { name: 'Układ współrzędnych 2D' }).click();
    await expect(second.locator('[data-object-type="coordinateSystem2D"]')).toBeVisible({ timeout: 5_000 });

    // Representative shape and line styles cross the same command,
    // collaboration, transform, export, and persistence seams.
    await first.locator('[data-tool-id="tool.shapes"]').click();
    await first.getByRole('button', { name: 'Kreskowana' }).click();
    await first.getByRole('button', { name: 'Trójkąt' }).click();
    const canvasBox = await first.locator('canvas.draw-layer').boundingBox();
    // Stay below the floating properties bar so the real canvas receives the
    // complete direct-manipulation gesture.
    await first.mouse.move(canvasBox.x + 180, canvasBox.y + 320);
    await first.mouse.down();
    await first.mouse.move(canvasBox.x + 300, canvasBox.y + 420, { steps: 6 });
    await first.mouse.up();
    await expect(second.locator('[data-object-type="triangle"]')).toBeVisible({ timeout: 5_000 });

    await first.locator('[data-tool-id="tool.shapes"]').click();
    await first.getByRole('button', { name: 'Po obu stronach' }).click();
    await first.getByRole('button', { name: 'Linia' }).click();
    await first.mouse.move(canvasBox.x + 340, canvasBox.y + 220);
    await first.mouse.down();
    await first.mouse.move(canvasBox.x + 500, canvasBox.y + 300, { steps: 6 });
    await first.mouse.up();
    await expect(second.locator('[data-object-type="line"]')).toBeVisible({ timeout: 5_000 });

    // Reload hydrates all acknowledged lesson objects from durable storage.
    await second.reload();
    await expect(second.getByTestId('collaboration-read-only')).toBeHidden({ timeout: 5_000 });
    for (const type of ['mathFunctionPlot', 'physicsDataPlot', 'coordinateSystem2D', 'triangle', 'line']) {
      await expect(second.locator(`[data-object-type="${type}"]`)).toBeVisible({ timeout: 10_000 });
    }

    // The real PDF action renders and downloads the scene containing all
    // VVE-106 objects.
    await first.locator('.hover-trigger-area').hover();
    await expect(first.locator('.gear-btn')).toBeVisible();
    await first.locator('.gear-btn').click();
    const downloadPromise = first.waitForEvent('download');
    await first.locator('.pdf-menu-wrapper > button').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('whiteboard.pdf');

    for (const hidden of ['experiment.ai', 'experiment.chemistry', 'experiment.gridAlign']) {
      await expect(first.locator(`[data-tool-id="${hidden}"]`)).toHaveCount(0);
    }
    expect(browserErrors).toEqual([]);

    await firstContext.close();
    await secondContext.close();
    await teacherContext.close();
  });

  test('Administrator signs in with the passphrase; viewing the list never rotates links', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('/admin/teachers');

    // Login gate (ADR-0005): a wrong passphrase shows a Polish error.
    await expect(page.getByRole('heading', { name: 'Panel administratora' })).toBeVisible();
    await page.getByLabel('Hasło administratora').fill('zle-haslo');
    await page.getByRole('button', { name: 'Odblokuj panel' }).click();
    await expect(page.getByText('Nieprawidłowe hasło.')).toBeVisible();

    // The correct passphrase opens the panel.
    await page.getByLabel('Hasło administratora').fill(adminPassphrase);
    await page.getByRole('button', { name: 'Odblokuj panel' }).click();
    await expect(page.getByRole('heading', { name: 'Nauczyciele i linki dostępu' })).toBeVisible({ timeout: 10000 });

    // The fixture teacher is listed with its CURRENT retrievable link —
    // exactly the token the Teacher context can still use.
    const fixtureToken = new URL(fixture.teacherAccessLink).searchParams.get('token');
    const row = page.locator('.teacher-row', { hasText: 'pilot-teacher@vve-pilot.local' });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row.locator('.keyway-channel')).toContainText(fixtureToken);

    // Reloading the panel (pure viewing) does NOT rotate the link.
    await page.reload();
    await expect(page.locator('.teacher-row', { hasText: 'pilot-teacher@vve-pilot.local' })).toBeVisible({ timeout: 10000 });
    await expect(
      page.locator('.teacher-row', { hasText: 'pilot-teacher@vve-pilot.local' }).locator('.keyway-channel')
    ).toContainText(fixtureToken);

    await context.close();
  });

  test('Regeneration is explicit: the old link dies immediately, the new one works', async ({ browser }) => {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();

    // Administrator session.
    await adminPage.goto('/admin/teachers');
    await adminPage.getByLabel('Hasło administratora').fill(adminPassphrase);
    await adminPage.getByRole('button', { name: 'Odblokuj panel' }).click();
    await expect(adminPage.getByRole('heading', { name: 'Nauczyciele i linki dostępu' })).toBeVisible({ timeout: 10000 });

    // Add a dedicated teacher so the fixture teacher's link stays untouched.
    // Unique per run: a previous run DEACTIVATED its teacher, and reuse
    // never reactivates — a fresh identity keeps the test re-runnable.
    const regenEmail = `e2e-regen-${Date.now()}@vve-pilot.local`;
    await adminPage.getByLabel('Adres email').fill(regenEmail);
    await adminPage.getByLabel('Etykieta wewnętrzna (opcjonalnie)').fill('E2E Regeneracja');
    await adminPage.getByRole('button', { name: 'Dodaj i wygeneruj link' }).click();
    const newRow = adminPage.locator('.teacher-row', { hasText: regenEmail });
    await expect(newRow).toBeVisible({ timeout: 10000 });

    // The fresh link opens the teacher dashboard in a separate context.
    const firstLink = await newRow.locator('.keyway-channel').innerText();
    const teacherContext = await browser.newContext();
    const teacherPage = await teacherContext.newPage();
    await teacherPage.goto(firstLink.trim());
    await expect(teacherPage.getByRole('heading', { name: 'Moje tablice' })).toBeVisible({ timeout: 15000 });

    // Explicit regeneration with the inline confirmation.
    await newRow.getByRole('button', { name: 'Regeneruj link' }).click();
    await expect(newRow.getByText('Regenerować link?')).toBeVisible();
    await newRow.getByRole('button', { name: 'Potwierdzam' }).click();

    // The panel shows a NEW link for that teacher.
    await expect(newRow.locator('.keyway-channel')).not.toContainText(
      new URL(firstLink.trim()).searchParams.get('token')
    );
    const newLink = (await newRow.locator('.keyway-channel').innerText()).trim();

    // The OLD link is denied with a Polish message (revocation is immediate).
    const oldPage = await teacherContext.newPage();
    await oldPage.goto(firstLink.trim());
    await expect(oldPage.getByText(/unieważniony/i).first()).toBeVisible({ timeout: 10000 });

    // The teacher's already-established session died with the regeneration
    // (durable credential version check on every request).
    await teacherPage.reload();
    await expect(teacherPage.getByText(/unieważniony/i).first()).toBeVisible({ timeout: 10000 });

    // The NEW link logs in again.
    const freshPage = await teacherContext.newPage();
    await freshPage.goto(newLink);
    await expect(freshPage.getByRole('heading', { name: 'Moje tablice' })).toBeVisible({ timeout: 15000 });

    // Deactivation: the fresh link is denied immediately, in Polish.
    await newRow.getByRole('button', { name: 'Wyłącz nauczyciela' }).click();
    await expect(newRow.getByText('Wyłączyć tego nauczyciela?')).toBeVisible();
    await newRow.getByRole('button', { name: 'Potwierdzam' }).click();
    await expect(newRow.locator('.keyway-label').first()).toHaveText(/Dostęp wyłączony/, { timeout: 10000 });

    const deniedPage = await teacherContext.newPage();
    await deniedPage.goto(newLink);
    await expect(deniedPage.getByText(/wyłączon/i).first()).toBeVisible({ timeout: 10000 });

    await teacherContext.close();
    await adminContext.close();
  });

  test('Board lifecycle on the dashboard: Personal Board, create with Student Label, copy, regenerate, end access', async ({ browser }) => {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();

    // A DEDICATED teacher per run (unique email): the first dashboard visit
    // must lazily create the Personal Board and start from an empty list.
    const teacherEmail = `e2e-lifecycle-${Date.now()}@vve-pilot.local`;
    await adminPage.goto('/admin/teachers');
    await adminPage.getByLabel('Hasło administratora').fill(adminPassphrase);
    await adminPage.getByRole('button', { name: 'Odblokuj panel' }).click();
    await expect(adminPage.getByRole('heading', { name: 'Nauczyciele i linki dostępu' })).toBeVisible({ timeout: 10000 });
    await adminPage.getByLabel('Adres email').fill(teacherEmail);
    await adminPage.getByLabel('Etykieta wewnętrzna (opcjonalnie)').fill('E2E Cykl życia');
    await adminPage.getByRole('button', { name: 'Dodaj i wygeneruj link' }).click();
    const teacherRow = adminPage.locator('.teacher-row', { hasText: teacherEmail });
    await expect(teacherRow).toBeVisible({ timeout: 10000 });
    const teacherLink = (await teacherRow.locator('.keyway-channel').innerText()).trim();

    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(teacherLink);
    await expect(page.getByRole('heading', { name: 'Moje tablice' })).toBeVisible({ timeout: 15000 });

    // Personal Board: lazily created on the first visit, no expiry, enterable.
    await expect(page.getByText('Bez terminu ważności')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Otwórz tablicę prywatną' })).toBeVisible();

    // No Managed Boards yet.
    await expect(page.getByText('Brak tablic do wyświetlenia.')).toBeVisible();

    // Create a Managed Board: the Student Label is required and validity is
    // FIXED at twelve months (stated in the modal, shown per row afterwards).
    await page.getByRole('button', { name: 'Nowa tablica ucznia' }).click();
    await expect(page.getByText('Tablica będzie aktywna przez 12 miesięcy od utworzenia.')).toBeVisible();
    await page.getByLabel('Etykieta ucznia / grupy').fill('Kowalski — grupa A');
    await page.getByLabel('Temat lekcji (opcjonalnie)').fill('E2E tablica cyklu życia');
    await page.getByRole('button', { name: 'Utwórz tablicę' }).click();

    // QA P1-2: the creation result shows the REAL, working link.
    const modalFresh = page.locator('.modal-panel .keyway.fresh');
    await expect(modalFresh).toBeVisible({ timeout: 10000 });
    const studentLink = (await modalFresh.locator('.keyway-channel').innerText()).trim();
    expect(studentLink).toContain('/board/');
    await page.locator('.modal-foot').getByRole('button', { name: 'Zamknij' }).click();

    // The row appears with the Student Label, expiry date and active state.
    const row = page.locator('.board-row', { hasText: 'Kowalski — grupa A' });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).toContainText('E2E tablica cyklu życia');
    await expect(row).toContainText('Ważna do:');
    await expect(row.locator('.pill.ok')).toHaveText('Aktywna');

    // Copy is side-effect-free: the label flips, the link does not change.
    const linkBefore = (await row.locator('.keyway-channel').innerText()).trim();
    expect(linkBefore).toContain('/board/');
    await row.getByRole('button', { name: 'Kopiuj' }).click();
    await expect(row.getByRole('button', { name: 'Skopiowano' })).toBeVisible();
    await expect(row.locator('.keyway-channel')).toHaveText(linkBefore);

    // The created link works for a STUDENT — a fresh context WITHOUT the
    // teacher session cookie (the owning teacher's cookie takes precedence
    // over the link token and would mask the student's view).
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await studentPage.goto(studentLink);
    await expect(studentPage.getByRole('heading', { name: 'E2E tablica cyklu życia' })).toBeVisible({ timeout: 10000 });
    await studentContext.close();

    // Regeneration is explicit, confirmed, and the old link dies immediately
    // while the row (and its data) stays.
    await row.getByRole('button', { name: 'Wygeneruj nowy link' }).click();
    await expect(row.getByText(/Wygenerować nowy link\?/)).toBeVisible();
    await row.getByRole('button', { name: 'Potwierdzam' }).click();
    const freshKeyway = row.locator('.keyway.fresh');
    await expect(freshKeyway).toBeVisible({ timeout: 10000 });
    const regeneratedLink = (await freshKeyway.locator('.keyway-channel').innerText()).trim();
    expect(regeneratedLink).not.toBe(linkBefore);
    await expect(row.locator('.pill.ok')).toHaveText('Aktywna');

    const staleContext = await browser.newContext();
    const stalePage = await staleContext.newPage();
    await stalePage.goto(studentLink);
    // The old token is a mismatch (regeneration replaced it in place), so
    // the entry is denied as invalid — in Polish, immediately.
    await expect(stalePage.getByText('Nieprawidłowy link lub sesja.')).toBeVisible({ timeout: 10000 });
    await staleContext.close();

    const regeneratedContext = await browser.newContext();
    const regeneratedPage = await regeneratedContext.newPage();
    await regeneratedPage.goto(regeneratedLink);
    await expect(regeneratedPage.getByRole('heading', { name: 'E2E tablica cyklu życia' })).toBeVisible({ timeout: 10000 });
    await regeneratedPage.getByRole('button', { name: 'Dołącz do lekcji' }).click();
    await expect(regeneratedPage.locator('canvas.static-layer')).toBeVisible({ timeout: 20_000 });
    await expect(regeneratedPage.getByTestId('collaboration-read-only')).toBeHidden({ timeout: 5_000 });

    // Ending access is explicit and confirmed: the state flips immediately,
    // the deletion countdown appears and NO recovery control is offered.
    await row.getByRole('button', { name: 'Zakończ dostęp' }).click();
    await expect(row.getByText(/Zakończyć dostęp do tablicy\?/)).toBeVisible();
    await row.getByRole('button', { name: 'Potwierdzam' }).click();
    await expect(row.locator('.pill')).toHaveText('Dostęp zakończony', { timeout: 10000 });
    await expect(row.locator('.ended-note')).toContainText('Dostępu nie można przywrócić.');
    await expect(row.getByRole('button', { name: 'Wygeneruj nowy link' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Zakończ dostęp' })).toHaveCount(0);

    // The durable lifecycle transaction actively closes an already-open
    // collaboration session; it becomes read-only before any reconnect can
    // be admitted with the revoked credential.
    await expect(regeneratedPage.getByTestId('collaboration-read-only')).toBeVisible({ timeout: 2_000 });

    const endedContext = await browser.newContext();
    const endedPage = await endedContext.newPage();
    await endedPage.goto(regeneratedLink);
    await expect(endedPage.getByText('Dostęp został unieważniony.')).toBeVisible({ timeout: 10000 });
    await endedContext.close();
    await regeneratedContext.close();

    await context.close();
    await adminContext.close();
  });
});
