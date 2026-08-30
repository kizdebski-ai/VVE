import { defineConfig } from '@playwright/test';
import { pilotE2eEnv } from './tests/e2e/global-setup';

const frontendPort = process.env.VVE_E2E_FRONTEND_PORT || '5173';
const backendPort = process.env.VVE_E2E_BACKEND_PORT || '8000';
const frontendOrigin = `http://localhost:${frontendPort}`;
const backendOrigin = `http://127.0.0.1:${backendPort}`;

// VVE-100 E2E spine: backend (:8000, Pilot HTTP surface) + Vite dev app
// (:5173, API/WS/login proxied to the backend), seeded by global-setup with
// the deterministic local Managed Board fixture.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  globalSetup: './tests/e2e/global-setup.js',
  use: {
    baseURL: frontendOrigin,
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    // channel 'chrome' runs the locally installed Google Chrome headlessly;
    // the Playwright CDN download for the pinned build is not needed.
    { name: 'chromium', use: { browserName: 'chromium', channel: 'chrome' } },
  ],
  webServer: [
    {
      command: 'npm run build && node dist/src/server.js',
      cwd: '../server',
      url: `${backendOrigin}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        ...process.env,
        ...pilotE2eEnv,
        HOST: '127.0.0.1',
        PORT: backendPort,
        // Pilot HTTP surface without production fail-fast checks.
        VVE_PILOT_SURFACE: '1',
        CORS_ORIGIN: frontendOrigin,
      },
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${frontendPort}`,
      url: frontendOrigin,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        // Same-origin API/WS through the Vite dev proxy; the Administrator
        // logs in with the passphrase (no build-time secret in the frontend).
        VITE_BACKEND_URL: frontendOrigin,
        VVE_PROXY_TARGET: backendOrigin
      }
    },
  ],
});
