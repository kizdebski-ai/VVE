import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { randomUUID } from 'crypto';

import { logger } from './logger';
import type { RoomManager } from './rooms';
import type { EquationSolver } from './services/aiSolver';
import {
  createPilotAvailability,
  type AvailabilityContext,
  type FeatureId,
  type RuntimeEnvironment
} from './pilot/availability';
import { createCapabilityAccess } from './pilot/capabilityAccess';
import { createBoardLifecycle, type BoardLifecycle } from './pilot/boardLifecycle';
import { requireAdminCapability } from './pilot/capabilityHttpAdapters';
import { config } from './config';

import { createRateLimiter } from './middleware/rateLimiter';
import { createAiRoutesRouter } from './routes/aiRoutes';
import { createAiBoardAssistantRouter } from './routes/aiBoardAssistant';
import { createRoomsApiRouter } from './routes/roomsRoutes';
import { createAdminAuthRouter } from './routes/adminAuth';
import { createAdminTeachersRouter } from './routes/adminTeachers';
import { createTeacherAuthRouter } from './routes/teacherAuth';
import { createTeacherBoardsRouter } from './routes/teacherBoards';
import { createBoardAccessRouter } from './routes/boardAccess';
import type { OperationalSignals, OperationalSnapshot } from './pilot/operationalSignals';

export interface RuntimeHealthGateway {
  live(): boolean;
  ready(): boolean;
  checks(): { database: boolean; persistence: boolean };
  snapshot(): OperationalSnapshot;
}

export interface CreateAppOptions {
  roomManager: RoomManager;
  aiSolver: EquationSolver;
  /**
   * PilotAvailability inputs. Defaults come from the process environment:
   * `pilot` when NODE_ENV=production, otherwise `development` with the
   * internal `VVE_DEV_SURFACE=1` flag gating excluded features. Tests inject
   * both variants explicitly.
   */
  environment?: RuntimeEnvironment;
  devSurface?: boolean;
  /** CapabilityAccess dependency; defaults to the process-wide instance. */
  capabilityAccess?: ReturnType<typeof createCapabilityAccess>;
  /** BoardLifecycle dependency (VVE-102); defaults to an instance over the process db + CapabilityAccess. */
  boardLifecycle?: BoardLifecycle;
  /** Truthful liveness/readiness owned by RuntimeControl (VVE-108). */
  health?: RuntimeHealthGateway;
  signals?: OperationalSignals;
}

export const createHttpApp = ({ roomManager, aiSolver, environment, devSurface, capabilityAccess, boardLifecycle, health, signals }: CreateAppOptions) => {
  const app = express();

  const resolvedEnvironment: RuntimeEnvironment = environment ?? config.pilotEnvironment;
  const resolvedDevSurface: boolean = devSurface ?? config.devSurface;
  const access = capabilityAccess ?? createCapabilityAccess();
  const lifecycle =
    boardLifecycle ??
    createBoardLifecycle({
      access,
      onBoardsAccessEnded: (boardIds) =>
        boardIds.forEach((boardId) => roomManager.closeRoomSockets(boardId, 'Dostęp do tablicy został zakończony'))
    });

  // One availability decision source for route registration (Module 9).
  const availability = createPilotAvailability();
  const registrationCtx: AvailabilityContext = {
    environment: resolvedEnvironment,
    role: 'server',
    devSurface: resolvedDevSurface
  };
  const register = (feature: FeatureId, mount: () => void): boolean => {
    const decision = availability.require(feature, registrationCtx);
    if (decision.available) {
      mount();
      return true;
    }
    logger.info('Pilot surface: route group not registered', {
      feature,
      environment: resolvedEnvironment,
      reason: decision.reason
    });
    return false;
  };
  const manifest = availability.resolve({ environment: resolvedEnvironment, role: 'server' });
  logger.info('Pilot availability manifest resolved', {
    version: manifest.version,
    environment: resolvedEnvironment,
    devSurface: resolvedDevSurface,
    serverRoutes: manifest.serverRoutes
  });

  const aiRegistered =
    resolvedEnvironment === 'development' &&
    availability.require('http.ai', registrationCtx).available;

  // 4.6: Security headers via helmet with CSP enabled.
  // The OpenRouter AI provider is only allowed when AI routes are registered.
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: aiRegistered
          ? ["'self'", 'wss:', 'ws:', 'https://openrouter.ai']
          : ["'self'", 'wss:', 'ws:'],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false, // Allow embedding of external images
  }));

  // 4.4: Enforce CORS_ORIGIN in production (no wildcard allowed)
  const corsOrigin = process.env.CORS_ORIGIN;
  if (!corsOrigin && process.env.NODE_ENV === 'production') {
    logger.warn('CORS_ORIGIN not set in production — CORS will be restrictive (no origin allowed)');
  }
  app.use(cors(
    corsOrigin
      ? { origin: corsOrigin.split(',').map(o => o.trim()), credentials: true }
      : process.env.NODE_ENV === 'production'
        ? { origin: false } // Block all cross-origin in production if not configured
        : undefined // Open in development
  ));

  // AI endpoints accept screenshots, so allow a slightly larger body size
  app.use(express.json({ limit: '20mb' }));

  // Correlation ID middleware
  app.use((req, res, next) => {
    const headerId = Array.isArray(req.headers['x-request-id'])
      ? req.headers['x-request-id'][0]
      : req.headers['x-request-id'];
    const correlationId = typeof headerId === 'string' && headerId.trim() ? headerId.trim() : randomUUID();
    (req as any).correlationId = correlationId;
    res.setHeader('x-request-id', correlationId);
    next();
  });

  // Lightweight request logging for sensitive routes — path and method only.
  app.use((req, _res, next) => {
    const correlationId = (req as any).correlationId as string | undefined;
    if (
      req.path.startsWith('/api/teacher/boards') ||
      req.path.startsWith('/board/')
    ) {
      if (signals) {
        signals.record({
          name: 'process.phase',
          ...(typeof correlationId === 'string' ? { correlationId } : {}),
          dimensions: { phase: 'http', method: req.method, path: req.path }
        });
      } else {
        logger.info('HTTP request', { path: req.path, method: req.method, correlationId });
      }
    }
    next();
  });

  // Register routers — every group goes through the PilotAvailability manifest.
  // Administrator surface: passphrase → 12h session (ADR-0005); every teacher
  // management operation enforces the session server-side via decide().
  register('http.adminTeachers', () => {
    app.use('/api/admin', createAdminAuthRouter(access));
    app.use('/api/admin/teachers', requireAdminCapability(access), createAdminTeachersRouter(access, lifecycle));
  });
  register('http.teacherAuth', () => {
    app.use(createTeacherAuthRouter(access));
  });
  register('http.teacherBoards', () => {
    app.use('/api/teacher/boards', createTeacherBoardsRouter(access, lifecycle));
  });
  register('http.boardAccess', () => {
    app.use(createBoardAccessRouter(access, lifecycle));
  });
  register('http.ai', () => {
    // 4.5: Rate limit ALL AI endpoints (20 req/min per IP)
    const aiRateLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });
    app.use('/api/ai', aiRateLimiter);
    app.use('/api/ai', createAiRoutesRouter(aiSolver));
    app.use('/api/ai/board-assistant', createAiBoardAssistantRouter(roomManager));
  });
  register('http.roomsApi', () => {
    app.use(createRoomsApiRouter(roomManager));
  });

  // Basic root status page so Railway shows a friendly message instead of "Cannot GET /"
  app.get('/', (_, res) => {
    res.json({
      status: health?.ready() ? 'ready' : 'ok',
      message: 'WhiteVue realtime backend is running.',
      pilotSurface: manifest.serverRoutes,
      endpoints: ['/live', '/ready', '/health', '/ws/whiteboard/:roomId']
    });
  });

  app.get('/live', (_, res) => {
    const live = health ? health.live() : true;
    res.status(live ? 200 : 503).json({ live, status: live ? 'live' : 'stopped' });
  });

  app.get('/ready', (_, res) => {
    if (!health) {
      res.json({ live: true, ready: true, status: 'ready' });
      return;
    }
    const live = health.live();
    const ready = health.ready();
    const checks = health.checks();
    const soak = health.snapshot();
    res.status(ready ? 200 : 503).json({
      live,
      ready,
      status: ready ? 'ready' : 'not-ready',
      checks,
      soak
    });
  });

  app.get('/health', (_, res) => {
    if (!health) {
      res.json({
        status: 'ok',
        live: true,
        ready: true
      });
      return;
    }
    const live = health.live();
    const ready = health.ready();
    const checks = health.checks();
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'not-ready',
      live,
      ready,
      checks
    });
  });

  // Unregistered paths (including every excluded Pilot feature) return a JSON
  // 404 — never a partial or hidden handler.
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found.', path: req.path });
  });

  // 4.8: Global error handler for uncaught async errors
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error('Unhandled route error', { error: err.message, stack: err.stack });
    const status = (err as any).status || 500;
    res.status(status).json({ error: err.message || 'Internal server error.' });
  });

  return app;
};
