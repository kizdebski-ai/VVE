import express, { Request, type RequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { randomUUID, timingSafeEqual } from 'crypto';

/** Timing-safe string comparison to prevent timing attacks on secrets */
const timingSafeCompare = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
};

import { logger } from './logger';
import type { RoomManager } from './rooms';
import type { EquationSolver } from './services/aiSolver';
import {
  createPilotAvailability,
  type AvailabilityContext,
  type FeatureId,
  type RuntimeEnvironment
} from './pilot/availability';
import { config } from './config';

import { createRateLimiter } from './middleware/rateLimiter';
import { createAiRoutesRouter } from './routes/aiRoutes';
import { createAiBoardAssistantRouter } from './routes/aiBoardAssistant';
import { createRoomsApiRouter } from './routes/roomsRoutes';
import { createAdminTeachersRouter } from './routes/adminTeachers';
import { createTeacherAuthRouter } from './routes/teacherAuth';
import { createTeacherBoardsRouter } from './routes/teacherBoards';
import { createBoardAccessRouter } from './routes/boardAccess';

const readAdminSecret = (req: Request) =>
  (req.headers['x-admin-secret'] as string) ||
  (typeof req.query.adminSecret === 'string' ? req.query.adminSecret : undefined);

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
}

export const createHttpApp = ({ roomManager, aiSolver, environment, devSurface }: CreateAppOptions) => {
  const app = express();

  const resolvedEnvironment: RuntimeEnvironment = environment ?? config.pilotEnvironment;
  const resolvedDevSurface: boolean = devSurface ?? config.devSurface;

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

  // Lightweight request logging for sensitive routes
  app.use((req, _res, next) => {
    const correlationId = (req as any).correlationId;
    if (
      req.path.startsWith('/api/teacher/boards') ||
      req.path.startsWith('/board/')
    ) {
      logger.info('HTTP request', { path: req.path, method: req.method, correlationId });
    }
    next();
  });

  // 4.3: Require admin secret ALWAYS (not just in production)
  const requireAdminSecret: RequestHandler = (req, res, next) => {
    const expectedSecret = config.adminSecret;

    if (!expectedSecret) {
      logger.warn('Admin request blocked because ADMIN_SECRET is not configured', { path: req.path });
      res.status(503).json({ error: 'Admin endpoints are not configured. Set ADMIN_SECRET.' });
      return;
    }

    const provided = readAdminSecret(req);
    if (!provided || !timingSafeCompare(provided, expectedSecret)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    next();
  };

  // Register routers — every group goes through the PilotAvailability manifest.
  register('http.adminTeachers', () => {
    app.use('/api/admin/teachers', requireAdminSecret, createAdminTeachersRouter());
  });
  register('http.teacherAuth', () => {
    app.use(createTeacherAuthRouter());
  });
  register('http.teacherBoards', () => {
    app.use('/api/teacher/boards', createTeacherBoardsRouter());
  });
  register('http.boardAccess', () => {
    app.use(createBoardAccessRouter());
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
      status: 'ok',
      message: 'WhiteVue realtime backend is running.',
      pilotSurface: manifest.serverRoutes,
      endpoints: ['/health', '/ws/whiteboard/:roomId']
    });
  });

  app.get('/health', (_, res) => {
    res.json({
      status: 'ok',
      rooms: roomManager.listRooms({ includeArchived: true, limit: 10 }).length
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
