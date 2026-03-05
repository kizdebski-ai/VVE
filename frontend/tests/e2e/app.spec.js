import { test, expect } from '@playwright/test';

test.describe('WhiteVue App - Basic Loading', () => {

  test('homepage loads without crashing', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/', { waitUntil: 'networkidle' });

    // Should not have Vue/JS setup errors
    const criticalErrors = errors.filter(
      (e) => e.includes('Cannot access') || e.includes('is not defined') || e.includes('is not a function')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('canvas element exists and is visible', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    // Wait for the app to mount
    await page.waitForTimeout(2000);

    // The whiteboard canvas should exist
    const canvas = page.locator('canvas');
    await expect(canvas.first()).toBeVisible({ timeout: 10000 });
  });

  test('toolbar is visible', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Look for toolbar-like elements (buttons or tool icons)
    const toolbar = page.locator('.toolbar, .tools-panel, [class*="toolbar"], [class*="tool"]');
    const count = await toolbar.count();
    expect(count).toBeGreaterThan(0);
  });

  test('no unhandled errors during setup', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Filter out expected errors (e.g. WebSocket connection attempts to backend)
    const criticalErrors = consoleErrors.filter(
      (e) =>
        !e.includes('WebSocket') &&
        !e.includes('ERR_CONNECTION_REFUSED') &&
        !e.includes('Failed to fetch') &&
        !e.includes('net::') &&
        (e.includes('ReferenceError') ||
         e.includes('TypeError') ||
         e.includes('Cannot access') ||
         e.includes('is not a function') ||
         e.includes('Unhandled error during execution of setup'))
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('can interact with canvas (pointer events)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10000 });

    // Get canvas bounding box
    const box = await canvas.boundingBox();
    if (!box) return;

    // Click on canvas center - should not throw
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    await page.mouse.click(centerX, centerY);

    // Draw a stroke
    await page.mouse.move(centerX - 50, centerY - 50);
    await page.mouse.down();
    await page.mouse.move(centerX + 50, centerY + 50, { steps: 10 });
    await page.mouse.up();

    // Should not have crashed
    const canvas2 = page.locator('canvas').first();
    await expect(canvas2).toBeVisible();
  });
});
