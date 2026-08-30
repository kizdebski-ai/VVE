import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';

import { config, paths } from './config';
import { logger } from './logger';
import { RoomManager, RoomContext } from './rooms';
import { FilePersistence } from './persistence';
import { createHttpApp } from './httpApp';
import { OpenRouterEquationSolver } from './services/aiSolver';
import { createCapabilityAccess } from './pilot/capabilityAccess';
import { createBoardLifecycle } from './pilot/boardLifecycle';
import { createWsAdmission, isManagedBoardRoomId } from './wsAdmission';
import {
  CollaborationFailure,
  createCollaborationRuntime,
  type ConnectionHandle,
  type CollaborationTransport
} from './pilot/collaborationRuntime';
import { createPostgresBoardDocumentStore } from './pilot/postgresBoardDocumentStore';
import { decodeClientFrame, encodeServerFrame } from './pilot/collaborationProtocol';
import { getDb } from './db';
import { createResourceGovernor } from './pilot/resourceGovernor';
import { resourceLimitsFromEnv } from './pilot/resourceLimits';

// Startup config check (no secrets logged)
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  logger.warn('OPENROUTER_API_KEY is not set - AI features will be unavailable');
} else {
  logger.info('OPENROUTER_API_KEY configured', { length: apiKey.length });
}

const messageSync = 0;
const messageAwareness = 1;

type ManagedSocket = WebSocket & {
  isAlive?: boolean;
  msgCount?: number;
  msgWindowStart?: number;
};
type AwarenessChange = {
  added: number[];
  updated: number[];
  removed: number[];
};

const send = (ws: WebSocket, data: Uint8Array) => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(data, { binary: true });
  }
};

const createMessage = (type: number, payload: Uint8Array = new Uint8Array(0)) => {
  const message = new Uint8Array(1 + payload.length);
  message[0] = type;
  message.set(payload, 1);
  return message;
};

const broadcast = (
  room: RoomContext,
  type: number,
  payload: Uint8Array,
  exclude?: WebSocket | null
) => {
  const msg = createMessage(type, payload);
  let sentCount = 0;
  room.connections.forEach((_, client) => {
    if (client !== exclude) {
      send(client, msg);
      sentCount++;
    }
  });
  // Verbose sync logging removed for performance
};

const toUint8Array = (raw: WebSocket.RawData): Uint8Array => {
  if (typeof raw === 'string') {
    return new Uint8Array(Buffer.from(raw));
  }
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (Array.isArray(raw)) return new Uint8Array(Buffer.concat(raw));
  if (Buffer.isBuffer(raw)) return new Uint8Array(raw);
  if (ArrayBuffer.isView(raw)) {
    const view = raw as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  return new Uint8Array(Buffer.from(raw as any));
};

const initializeRoom = (room: RoomContext) => {
  if (room.initialized) return;

  room.doc.on('update', (update: Uint8Array, origin) => {
    const timestamp = Date.now();
    room.meta.updatedAt = timestamp;
    room.meta.lastActiveAt = timestamp;
    room.lastActive = timestamp;
    logger.debug('Generated update', { size: update.length, originIsWs: origin instanceof WebSocket });
    broadcast(room, messageSync, update, origin as WebSocket | null);
  });

  room.awareness.on('update', (changes: AwarenessChange, origin: WebSocket | null) => {
    const timestamp = Date.now();
    room.meta.lastActiveAt = timestamp;
    room.lastActive = timestamp;
    const { added, updated, removed } = changes;
    const targets = added.concat(updated, removed);
    if (targets.length === 0) {
      return;
    }
    const awarenessPayload = awarenessProtocol.encodeAwarenessUpdate(room.awareness, targets);
    broadcast(room, messageAwareness, awarenessPayload, origin as WebSocket | null);

    if (origin instanceof WebSocket) {
      const trackedStates = room.connections.get(origin);
      if (trackedStates) {
        added.concat(updated).forEach((clientId) => trackedStates.add(clientId));
        removed.forEach((clientId) => trackedStates.delete(clientId));
      }
    }
  });

  room.initialized = true;
};

const sendInitialSync = (room: RoomContext, ws: WebSocket) => {
  const docState = Y.encodeStateAsUpdate(room.doc);
  send(ws, createMessage(messageSync, docState));

  const awarenessStates = room.awareness.getStates();
  if (awarenessStates.size > 0) {
    const payload = awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(awarenessStates.keys()));
    send(ws, createMessage(messageAwareness, payload));
  }
};

const getClientIp = (request: http.IncomingMessage): string => {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0]?.trim() || request.socket.remoteAddress || 'unknown';
  }
  return request.socket.remoteAddress || 'unknown';
};

const resourceGovernor = createResourceGovernor({ limits: resourceLimitsFromEnv() });

const checkRateLimit = (clientKey: string): boolean => {
  const decision = resourceGovernor.admit(
    { kind: 'message', bytes: 1, clientKey },
    { now: Date.now() }
  );
  return decision.decision === 'allow' || decision.decision === 'allowWithBudget';
};

const handleMessage = (room: RoomContext, ws: ManagedSocket, data: Uint8Array, clientKey: string) => {
  if (!data || data.length === 0) {
    logger.debug('Ignoring empty WebSocket message');
    return;
  }

  if (!checkRateLimit(clientKey)) {
    logger.warn('WebSocket rate limit exceeded, dropping message');
    return;
  }

  const messageType = data[0];
  const payload = data.slice(1);

  switch (messageType) {
    case messageSync: {
      try {
        logger.debug('Processing sync message', { size: payload.length });
        Y.applyUpdate(room.doc, payload, ws);
      } catch (error) {
        logger.warn('Failed to apply doc update', {
          error: (error as Error).message
        });
      }
      break;
    }
    case messageAwareness: {
      try {
        awarenessProtocol.applyAwarenessUpdate(room.awareness, payload, ws);
      } catch (error) {
        logger.warn('Failed to apply awareness update', {
          error: (error as Error).message
        });
      }
      break;
    }
    default:
      logger.warn('Received unknown message type', {
        messageType,
        length: data.length
      });
  }
};

const removeConnection = (roomId: string, room: RoomContext, ws: WebSocket) => {
  const tracked = room.connections.get(ws);
  if (tracked) {
    room.connections.delete(ws);
    awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(tracked), ws);
  }
  logger.info('Client disconnected', { roomId, clients: room.connections.size });
};

const parseWsParams = (
  requestUrl?: string | null
): { roomId: string; token: string | null } | null => {
  if (!requestUrl) return null;
  try {
    const url = new URL(requestUrl, 'http://localhost');
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length >= 3 && segments[0] === 'ws' && segments[1] === 'whiteboard') {
      const roomId = decodeURIComponent(segments.slice(2).join('/'));
      const token = url.searchParams.get('wsToken') || url.searchParams.get('token');
      return { roomId, token };
    }
  } catch {
    return null;
  }
  return null;
};

const persistence = new FilePersistence(config.dataDir);
// Legacy peer rooms are a separate developer-only surface. Managed Boards
// never enter RoomManager or its raw-frame persistence path (VVE-103).
const roomManager = new RoomManager(persistence);
const aiSolver = new OpenRouterEquationSolver();
// VVE-101: one CapabilityAccess instance owns every authorization decision
// for HTTP and WebSocket. Legacy peer rooms remain reachable only on the
// development surface with the internal dev flag (ADR-0010).
const capabilityAccess = createCapabilityAccess({ resourceGovernor });
const collaborationRuntime = createCollaborationRuntime({
  store: createPostgresBoardDocumentStore(),
  idleMs: config.roomTtlMs,
  resourceGovernor
});
// VVE-102: one BoardLifecycle instance owns every durable lifecycle fact.
// The old BoardYjsPersistence cleanup job (Yjs-only deletion after ~15
// months, board row left behind) is deleted: purge happens through the
// module's seven-day schedule.
const boardLifecycle = createBoardLifecycle({
  access: capabilityAccess,
  onBoardsAccessEnded: (boardIds) =>
    Promise.all(
      boardIds.map((boardId) =>
        collaborationRuntime.closeBoard(boardId, 'Dostęp do tablicy został zakończony')
      )
    ).then(() => undefined)
});
boardLifecycle.startDeletionSweep();
const wsAdmission = createWsAdmission(
  capabilityAccess,
  config.pilotEnvironment === 'development' && config.devSurface
);
export const app = createHttpApp({
  roomManager,
  aiSolver,
  capabilityAccess,
  boardLifecycle,
  resourceGovernor
});

const server = http.createServer(app);
const wss = new WebSocketServer({
  server,
  maxPayload: resourceGovernor.limits().maxWebsocketPayloadBytes
});

wss.on('connection', (socket: ManagedSocket, request) => {
  const clientIp = getClientIp(request);

  (async () => {
    const parsed = parseWsParams(request.url);
    if (!parsed) {
      socket.close(1008, 'Invalid room');
      return;
    }

    const { roomId, token } = parsed;

    // VVE-101: admission goes through CapabilityAccess.decide() — fail-closed
    // on every database error (the previous fail-open path is deleted), with
    // expiry/revocation/credential-version re-verified at admission time.
    const admission = await wsAdmission.admit(roomId, token);
    if (!admission.admitted) {
      socket.close(admission.closeCode, admission.closeReason);
      return;
    }

    socket.isAlive = true;
    socket.on('pong', () => {
      socket.isAlive = true;
    });

    if (isManagedBoardRoomId(roomId)) {
      if (!token) {
        socket.close(1008, 'Unauthorized');
        return;
      }

      const transport: CollaborationTransport = {
        send: async (frame) => {
          if (socket.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket is not open.');
          }
          socket.send(encodeServerFrame(frame), { binary: true });
        },
        close: async (code, reason) => {
          if (socket.readyState === WebSocket.OPEN) socket.close(code, reason);
        },
        bufferedBytes: () => socket.bufferedAmount
      };

      let handle: ConnectionHandle | null = null;
      try {
        handle = await collaborationRuntime.connect(
          {
            boardId: roomId,
            grant: admission.decision,
            clientKey: clientIp,
            revalidate: async () => (await wsAdmission.admit(roomId, token)).admitted
          },
          transport
        );
      } catch (error) {
        const failure = error instanceof CollaborationFailure ? error : null;
        if (failure?.code === 'resource') {
          socket.close(1013, failure.message.slice(0, 120));
          return;
        }
        throw error;
      }
      logger.info('Managed Board client synchronized', {
        boardId: roomId,
        role: admission.decision.role
      });

      socket.on('message', (raw) => {
        Promise.resolve()
          .then(() => decodeClientFrame(toUint8Array(raw)))
          .then((frame) => handle?.receive(frame))
          .catch(async (error) => {
            const failure = error instanceof CollaborationFailure ? error : null;
            logger.warn('Managed Board frame rejected', {
              boardId: roomId,
              reason: failure?.code ?? 'internal',
              error: (error as Error).message
            });
            if (failure?.code === 'persistenceUnavailable') {
              socket.close(1013, 'Persistence unavailable');
            } else if (failure?.code === 'malformed') {
              socket.close(1008, 'Malformed frame');
            } else if (failure?.code === 'resource') {
              socket.close(1013, failure.message.slice(0, 120));
            } else {
              socket.close(1011, 'Internal error');
            }
          });
      });
      socket.on('close', () => {
        handle?.close('socket closed').catch(() => undefined);
      });
      socket.on('error', (error) => {
        logger.warn('Managed Board WebSocket error', { boardId: roomId, error: error.message });
        handle?.close('socket error').catch(() => undefined);
      });
      return;
    }

    // Developer-only legacy peer room.
    const legacyAdmit = resourceGovernor.admit(
      { kind: 'connection', clientKey: clientIp, boardId: roomId },
      { now: Date.now() }
    );
    if (legacyAdmit.decision !== 'allow' && legacyAdmit.decision !== 'allowWithBudget') {
      socket.close(1013, 'Too many connections');
      return;
    }
    const releaseLegacy = () =>
      resourceGovernor.observe({ kind: 'connectionClosed', clientKey: clientIp, boardId: roomId });

    const { room, created } = await roomManager.get(roomId);
    initializeRoom(room);

    room.connections.set(socket, new Set());
    logger.info('Client connected', { roomId, clients: room.connections.size, created });

    sendInitialSync(room, socket);

    socket.on('message', (raw) => {
      handleMessage(room, socket, toUint8Array(raw), clientIp);
    });

    socket.on('close', () => {
      removeConnection(roomId, room, socket);
      releaseLegacy();
    });
    socket.on('error', (error) => {
      logger.warn('WebSocket error', { roomId, error: error.message });
      removeConnection(roomId, room, socket);
      releaseLegacy();
    });
  })().catch((error) => {
    logger.error('WebSocket connection failed', { error: (error as Error).message });
    socket.close(1011, 'Internal error');
  });
});

const pingInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    const socket = ws as ManagedSocket;
    if (!socket.isAlive) {
      socket.terminate();
      return;
    }
    socket.isAlive = false;
    socket.ping();
  });
  roomManager.cleanup(config.roomTtlMs);
  collaborationRuntime.unloadIdle().catch((error) =>
    logger.error('Managed Board idle unload failed', { error: (error as Error).message })
  );
}, config.pingIntervalMs);

// Run migrations and start server
const startServer = async () => {
  try {
    // Run migrations programmatically
    if (config.databaseUrl) {
      const db = getDb();
      console.log('[Server] Running database migrations...');
      const result = await db.migrate.latest();
      console.log('[Server] Migrations completed:', result);
    } else {
      console.log('[Server] No DATABASE_URL, skipping migrations');
    }
  } catch (error) {
    console.error('[Server] Migration failed:', error);
    // Continue anyway - tables might already exist
  }

  server.listen(config.port, config.host, () => {
    logger.info('Realtime backend ready', { host: config.host, port: config.port, path: paths.whiteboard });
  });
};

startServer();

let shutdownStarted = false;
const shutdown = async () => {
  if (shutdownStarted) return;
  shutdownStarted = true;
  logger.info('Shutting down server');
  clearInterval(pingInterval);
  boardLifecycle.stopDeletionSweep();
  await collaborationRuntime.drain({
    deadline: new Date(Date.now() + 3_000),
    reason: 'Server restarting'
  }).catch((error) =>
    logger.error('Collaboration drain failed', { error: (error as Error).message })
  );
  // BE-004: Graceful close instead of hard terminate
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.close(1001, 'Server shutting down');
    }
  });
  // Force terminate any lingering connections after 3 seconds
  setTimeout(() => {
    wss.clients.forEach((client) => client.terminate());
  }, 3000);
  server.close(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// BE-005: Global error handlers to prevent silent crashes
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { error: String(reason) });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception - shutting down', { error: error.message, stack: error.stack });
  void shutdown();
});
