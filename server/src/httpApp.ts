import express, { Request } from 'express';
import cors from 'cors';
import * as fs from 'fs';
import * as path from 'path';

import { logger } from './logger';
import type { RoomManager } from './rooms';
import type { EquationSolver } from './services/aiSolver';

const API_ROOMS = '/api/rooms';
const AI_SOLVER_ROUTE = '/api/ai/solve-equation/';

const parseBooleanFlag = (value: unknown) => {
  if (typeof value === 'string') {
    return value === '1' || value.toLowerCase() === 'true';
  }
  return Boolean(value);
};

const parseLimit = (value: unknown, fallback = 25) => {
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 100);
};

const readOwnerSecret = (req: Request) =>
  (req.headers['x-owner-secret'] as string) ||
  (req.body && typeof req.body.ownerSecret === 'string' ? req.body.ownerSecret : undefined) ||
  (typeof req.query.ownerSecret === 'string' ? req.query.ownerSecret : undefined);

export interface CreateAppOptions {
  roomManager: RoomManager;
  aiSolver: EquationSolver;
}

export const createHttpApp = ({ roomManager, aiSolver }: CreateAppOptions) => {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  app.get('/health', (_, res) => {
    res.json({
      status: 'ok',
      rooms: roomManager.listRooms({ includeArchived: true, limit: 10 }).length
    });
  });

  app.get(API_ROOMS, (req, res) => {
    const options: import('./rooms').ListRoomsOptions = {
      includeArchived: parseBooleanFlag(req.query.include_archived),
      limit: parseLimit(req.query.limit)
    };
    if (typeof req.query.search === 'string') {
      options.search = req.query.search;
    }
    const rooms = roomManager.listRooms(options);
    res.json({ rooms });
  });

  app.post(API_ROOMS, (req, res) => {
    try {
      const payload = req.body || {};
      const room = roomManager.createRoom({
        displayName: typeof payload.displayName === 'string' ? payload.displayName : undefined,
        ownerName: typeof payload.ownerName === 'string' ? payload.ownerName : undefined,
        roomId: typeof payload.roomId === 'string' ? payload.roomId : undefined
      });
      res.status(201).json(room);
    } catch (error) {
      const message = (error as Error).message || 'Failed to create room.';
      const status = message.includes('exists') ? 409 : 400;
      res.status(status).json({ error: message });
    }
  });

  app.get(`${API_ROOMS}/:roomId`, (req, res) => {
    const ownerSecret = readOwnerSecret(req);
    const room = roomManager.getRoomMetadata(req.params.roomId, ownerSecret);
    if (!room) {
      res.status(404).json({ error: 'Room not found.' });
      return;
    }
    res.json(room);
  });

  app.patch(`${API_ROOMS}/:roomId`, (req, res) => {
    const ownerSecret = readOwnerSecret(req);
    if (!ownerSecret) {
      res.status(403).json({ error: 'ownerSecret is required.' });
      return;
    }
    try {
      const payload = req.body || {};
      const room = roomManager.updateRoom(req.params.roomId, ownerSecret, {
        displayName: typeof payload.displayName === 'string' ? payload.displayName : undefined,
        ownerName: typeof payload.ownerName === 'string' ? payload.ownerName : undefined,
        isListed: typeof payload.isListed === 'boolean' ? payload.isListed : undefined,
        metadata: typeof payload.metadata === 'object' ? payload.metadata : undefined
      });
      res.json(room);
    } catch (error) {
      const message = (error as Error).message || 'Unable to update room.';
      const status = message === 'Room not found.' ? 404 : 403;
      res.status(status).json({ error: message });
    }
  });

  app.delete(`${API_ROOMS}/:roomId`, (req, res) => {
    const ownerSecret = readOwnerSecret(req);
    if (!ownerSecret) {
      res.status(403).json({ error: 'ownerSecret is required.' });
      return;
    }
    try {
      const room = roomManager.archiveRoom(req.params.roomId, ownerSecret);
      res.json(room);
    } catch (error) {
      const message = (error as Error).message || 'Unable to archive room.';
      const status = message === 'Room not found.' ? 404 : 403;
      res.status(status).json({ error: message });
    }
  });

  app.get('/rooms', (_, res) => {
    res.json({
      rooms: roomManager.listRooms({ includeArchived: true, limit: 200 })
    });
  });

  app.post(AI_SOLVER_ROUTE, async (req, res) => {
    const equation = (req.body?.equation as string | undefined)?.trim();
    const image = req.body?.image as string | undefined;

    try {
      if (image) {
        // Image-based solving (OCR + Solve)
        const result = await aiSolver.solveEquationFromImage(image);
        res.json(result);
      } else if (equation) {
        // Text-based solving
        const solution = await aiSolver.solveEquation(equation);
        res.json({ solution });
      } else {
        res.status(400).json({ error: 'Field "equation" or "image" is required.' });
      }
    } catch (error) {
      const err = error as Error;
      logger.error('AI solver failed', { error: err.message });

      // Write to debug log file
      try {
        const logPath = path.join(process.cwd(), 'debug_error.log');
        const logEntry = `[${new Date().toISOString()}] Error: ${err.message}\nStack: ${err.stack}\n\n`;
        fs.appendFileSync(logPath, logEntry);
      } catch (e) {
        console.error('Failed to write to debug log', e);
      }

      res.status(502).json({ error: err.message || 'Failed to solve equation.' });
    }
  });

  app.post('/api/ai/vision-chat', async (req, res) => {
    const messages = req.body?.messages;

    if (!Array.isArray(messages)) {
      res.status(400).json({ error: 'Field "messages" must be an array.' });
      return;
    }

    try {
      // Check if aiSolver has chatWithVision method (it should if updated)
      if ('chatWithVision' in aiSolver) {
        const reply = await (aiSolver as any).chatWithVision(messages);
        res.json({ reply });
      } else {
        res.status(501).json({ error: 'Vision chat not implemented on server.' });
      }
    } catch (error) {
      const err = error as Error;
      logger.error('AI Vision Chat failed', { error: err.message });
      res.status(502).json({ error: err.message || 'Failed to process vision chat.' });
    }
  });

  return app;
};
