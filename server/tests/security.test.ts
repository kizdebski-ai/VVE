import request from 'supertest';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock multer before importing httpApp
vi.mock('multer', () => {
  const multerStub = (opts?: any) => {
    // 4.7 test: capture limits for assertion
    (multerStub as any).__lastOpts = opts;
    return {
      single: () => (_req: any, _res: any, next: any) => next()
    };
  };
  (multerStub as any).memoryStorage = () => ({});
  return { default: multerStub };
});

vi.mock('csv-parse/sync', () => ({
  parse: () => []
}));

// Mock boardTokens for AI endpoint auth tests
const mockVerifyBoardWsToken = vi.fn();
vi.mock('../src/services/boardTokens', () => ({
  verifyBoardWsToken: (...args: any[]) => mockVerifyBoardWsToken(...args),
  createBoardWsToken: vi.fn(() => 'mock-token')
}));

import { createHttpApp } from '../src/httpApp';
import { RoomManager } from '../src/rooms';
import type { EquationSolver } from '../src/services/aiSolver';

class StubSolver implements EquationSolver {
  async solveEquation(): Promise<string> { return '42'; }
}

const createTestApp = (options: { environment?: 'development' | 'pilot'; devSurface?: boolean } = {}) =>
  createHttpApp({
    roomManager: new RoomManager(),
    aiSolver: new StubSolver(),
    ...options
  });

describe('4.3: Admin auth requires secret ALWAYS', () => {
  it('rejects admin GET without ADMIN_SECRET configured (503)', async () => {
    // config.adminSecret is undefined when env not set → should return 503
    const app = createTestApp();
    const res = await request(app).get('/api/admin/teachers');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });

  it('never allows unauthenticated admin access in dev mode', async () => {
    // The old code allowed admin access without secret in dev.
    // Now it should always block. Verify 503 (not 200).
    const app = createTestApp();
    const res = await request(app).get('/api/admin/teachers');
    expect(res.status).not.toBe(200);
  });
});

describe('4.2: AI board assistant availability and auth gating', () => {
  beforeEach(() => {
    mockVerifyBoardWsToken.mockReset();
  });

  it('is not registered in pilot mode (404, not 503/401)', async () => {
    // ADR-0007: the whole AI route family is unreachable in the Pilot.
    const app = createTestApp({ environment: 'pilot', devSurface: true });
    const res = await request(app)
      .post('/api/ai/board-assistant')
      .send({ boardId: 'test', message: 'hello' });
    expect(res.status).toBe(404);
  });

  it('rejects request without x-board-token header (development)', async () => {
    const app = createTestApp({ environment: 'development', devSurface: true });
    const res = await request(app)
      .post('/api/ai/board-assistant')
      .send({ boardId: 'test', message: 'hello' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/token.*required/i);
  });

  it('rejects request with invalid token (development)', async () => {
    mockVerifyBoardWsToken.mockReturnValue(null);
    const app = createTestApp({ environment: 'development', devSurface: true });
    const res = await request(app)
      .post('/api/ai/board-assistant')
      .set('x-board-token', 'invalid-token')
      .send({ boardId: 'test', message: 'hello' });
    expect(res.status).toBe(401);
  });

  it('rejects student role (development)', async () => {
    mockVerifyBoardWsToken.mockReturnValue({ role: 'student', boardId: 'test' });
    const app = createTestApp({ environment: 'development', devSurface: true });
    const res = await request(app)
      .post('/api/ai/board-assistant')
      .set('x-board-token', 'student-token')
      .send({ boardId: 'test', message: 'hello' });
    expect(res.status).toBe(403);
  });
});

describe('4.5: Rate limiter on AI endpoints', () => {
  it('returns 429 after exceeding limit (development dev surface)', async () => {
    const app = createTestApp({ environment: 'development', devSurface: true });

    // The AI rate limiter allows 20 req/min per IP
    // We'll send 22 requests to /api/ai/solve-equation/ (which has its own handler)
    const results: number[] = [];
    for (let i = 0; i < 22; i++) {
      const res = await request(app).post('/api/ai/solve-equation/').send({ equation: '1+1' });
      results.push(res.status);
    }
    // At least one should be 429
    expect(results).toContain(429);
  });

  it('does not register the AI rate limiter in pilot mode', async () => {
    const app = createTestApp({ environment: 'pilot' });
    const results: number[] = [];
    for (let i = 0; i < 22; i++) {
      const res = await request(app).post('/api/ai/solve-equation/').send({ equation: '1+1' });
      results.push(res.status);
    }
    expect(results).not.toContain(429);
    expect(results.every((status) => status === 404)).toBe(true);
  });
});

describe('4.6: CSP headers present', () => {
  it('includes Content-Security-Policy header', async () => {
    const app = createTestApp();
    const res = await request(app).get('/health');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });
});

describe('4.7: Multer file size limit', () => {
  it('multer is configured with fileSize limit', async () => {
    // The import of adminTeachers triggers multer() with limits
    const multerMod = await import('multer');
    const lastOpts = (multerMod.default as any).__lastOpts;
    expect(lastOpts).toBeDefined();
    expect(lastOpts.limits).toBeDefined();
    expect(lastOpts.limits.fileSize).toBe(5 * 1024 * 1024);
  });
});

describe('4.9: Magic link does not leak teacher existence', () => {
  it('consumeMagicLink reason type does not include not_found', async () => {
    // This is a type-level check — verify the code path returns 'invalid' only
    const { consumeMagicLink } = await import('../src/services/teacherMagicLinks');
    // The function itself requires DB, but we can check that MagicLinkConsumeResult type
    // doesn't expose 'not_found'. We verify the source was updated:
    const fs = await import('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../src/services/teacherMagicLinks.ts'),
      'utf-8'
    );
    // Verify the old leaking pattern is gone
    expect(source).not.toContain("'not_found'");
    // Verify it uses a constant 'invalid' reason
    expect(source).toContain("reason: 'invalid'");
  });
});
