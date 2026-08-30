/**
 * HTTP + WebSocket transport Adapter owned by RuntimeControl.
 *
 * Construction does not listen. RuntimeControl.start binds the port only after
 * configuration, database, migrations, and Module construction succeed.
 */
import http from 'http';
import { randomUUID } from 'crypto';
import WebSocket, { WebSocketServer } from 'ws';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { Express } from 'express';

import { config, paths } from '../config';
import { logger } from '../logger';
import { RoomManager, RoomContext } from '../rooms';
import { createHttpApp, type RuntimeHealthGateway } from '../httpApp';
import type { EquationSolver } from '../services/aiSolver';
import type { CapabilityAccess } from './capabilityAccess';
import type { BoardLifecycle } from './boardLifecycle';
import { createWsAdmission, isManagedBoardRoomId } from '../wsAdmission';
import {
  CollaborationFailure,
  type CollaborationRuntime,
  type ConnectionHandle,
  type CollaborationTransport
} from './collaborationRuntime';
import { decodeClientFrame, encodeServerFrame } from './collaborationProtocol';
import type { OperationalSignals } from './operationalSignals';

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
  room.connections.forEach((_, client) => {
    if (client !== exclude) {
      send(client, msg);
    }
  });
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

const WS_RATE_LIMIT = 300;
const WS_RATE_WINDOW_MS = 1000;

const checkRateLimit = (ws: ManagedSocket): boolean => {
  const now = Date.now();
  if (!ws.msgWindowStart || now - ws.msgWindowStart > WS_RATE_WINDOW_MS) {
    ws.msgWindowStart = now;
    ws.msgCount = 1;
    return true;
  }
  ws.msgCount = (ws.msgCount || 0) + 1;
  return ws.msgCount <= WS_RATE_LIMIT;
};

const MAX_CONNECTIONS_PER_IP = 20;

const getClientIp = (request: http.IncomingMessage): string => {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0]?.trim() || request.socket.remoteAddress || 'unknown';
  }
  return request.socket.remoteAddress || 'unknown';
};

const handleMessage = (room: RoomContext, ws: ManagedSocket, data: Uint8Array) => {
  if (!data || data.length === 0) return;
  if (!checkRateLimit(ws)) return;

  const messageType = data[0];
  const payload = data.slice(1);

  switch (messageType) {
    case messageSync: {
      try {
        Y.applyUpdate(room.doc, payload, ws);
      } catch (error) {
        logger.warn('Failed to apply doc update', { error: (error as Error).message });
      }
      break;
    }
    case messageAwareness: {
      try {
        awarenessProtocol.applyAwarenessUpdate(room.awareness, payload, ws);
      } catch (error) {
        logger.warn('Failed to apply awareness update', { error: (error as Error).message });
      }
      break;
    }
    default:
      logger.warn('Received unknown message type', { messageType, length: data.length });
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

export interface RealtimeListenerDeps {
  roomManager: RoomManager;
  aiSolver: EquationSolver;
  capabilityAccess: CapabilityAccess;
  boardLifecycle: BoardLifecycle;
  collaborationRuntime: CollaborationRuntime;
  signals: OperationalSignals;
  health: RuntimeHealthGateway;
  admitting: () => boolean;
  environment?: 'pilot' | 'development';
  devSurface?: boolean;
}

export interface RealtimeListener {
  app: Express;
  server: http.Server;
  wss: WebSocketServer;
  listen(host: string, port: number): Promise<number>;
  close(deadline: Date): Promise<{ listenersClosed: boolean; remainingClients: number }>;
  pingClients(): void;
  connectionCount(): number;
}

export const createRealtimeListener = (deps: RealtimeListenerDeps): RealtimeListener => {
  const {
    roomManager,
    aiSolver,
    capabilityAccess,
    boardLifecycle,
    collaborationRuntime,
    signals,
    health,
    admitting
  } = deps;

  const app = createHttpApp({
    roomManager,
    aiSolver,
    capabilityAccess,
    boardLifecycle,
    health,
    signals,
    ...(deps.environment ? { environment: deps.environment } : {}),
    ...(deps.devSurface !== undefined ? { devSurface: deps.devSurface } : {})
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, maxPayload: 5 * 1024 * 1024 });
  const ipConnectionCounts = new Map<string, number>();
  let openConnections = 0;

  const trackIpConnect = (ip: string): boolean => {
    const current = ipConnectionCounts.get(ip) || 0;
    if (current >= MAX_CONNECTIONS_PER_IP) return false;
    ipConnectionCounts.set(ip, current + 1);
    return true;
  };

  const trackIpDisconnect = (ip: string): void => {
    const current = ipConnectionCounts.get(ip) || 0;
    if (current <= 1) {
      ipConnectionCounts.delete(ip);
    } else {
      ipConnectionCounts.set(ip, current - 1);
    }
  };

  const wsAdmission = createWsAdmission(
    capabilityAccess,
    (deps.environment ?? config.pilotEnvironment) === 'development' &&
      (deps.devSurface ?? config.devSurface)
  );

  wss.on('connection', (socket: ManagedSocket, request) => {
    const clientIp = getClientIp(request);
    const correlationId = randomUUID();

    if (!admitting()) {
      signals.record({
        name: 'session.admission',
        correlationId,
        dimensions: { admitted: false, reason: 'draining' }
      });
      socket.close(1013, 'Server draining');
      return;
    }

    if (!trackIpConnect(clientIp)) {
      signals.record({
        name: 'resource.denial',
        correlationId,
        dimensions: { reason: 'perIpConnectionLimit' }
      });
      socket.close(1013, 'Too many connections');
      return;
    }

    let ipTracked = true;
    openConnections += 1;
    const releaseIp = () => {
      if (!ipTracked) return;
      ipTracked = false;
      openConnections = Math.max(0, openConnections - 1);
      trackIpDisconnect(clientIp);
    };

    (async () => {
      const parsed = parseWsParams(request.url);
      if (!parsed) {
        releaseIp();
        socket.close(1008, 'Invalid room');
        return;
      }

      const { roomId, token } = parsed;
      const admission = await wsAdmission.admit(roomId, token);
      if (!admission.admitted) {
        signals.record({
          name: 'session.admission',
          correlationId,
          dimensions: { admitted: false, reason: admission.closeReason }
        });
        releaseIp();
        socket.close(admission.closeCode, admission.closeReason);
        return;
      }

      if (!admitting()) {
        signals.record({
          name: 'session.admission',
          correlationId,
          dimensions: { admitted: false, reason: 'draining' }
        });
        releaseIp();
        socket.close(1013, 'Server draining');
        return;
      }

      socket.isAlive = true;
      socket.on('pong', () => {
        socket.isAlive = true;
      });

      if (isManagedBoardRoomId(roomId)) {
        if (!token) {
          releaseIp();
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
          }
        };

        let handle: ConnectionHandle | null = null;
        handle = await collaborationRuntime.connect(
          {
            boardId: roomId,
            grant: admission.decision,
            revalidate: async () => (await wsAdmission.admit(roomId, token)).admitted
          },
          transport
        );

        socket.on('message', (raw) => {
          if (!checkRateLimit(socket)) {
            socket.close(1013, 'Rate limit exceeded');
            return;
          }
          Promise.resolve()
            .then(() => decodeClientFrame(toUint8Array(raw)))
            .then((frame) => handle?.receive(frame))
            .catch(async (error) => {
              const failure = error instanceof CollaborationFailure ? error : null;
              signals.record({
                name: failure?.code === 'persistenceUnavailable' ? 'persistence.error' : 'session.close',
                correlationId,
                dimensions: { reason: failure?.code ?? 'internal' }
              });
              if (failure?.code === 'persistenceUnavailable') {
                socket.close(1013, 'Persistence unavailable');
              } else if (failure?.code === 'malformed') {
                socket.close(1008, 'Malformed frame');
              } else {
                socket.close(1011, 'Internal error');
              }
            });
        });
        socket.on('close', () => {
          handle?.close('socket closed').catch(() => undefined);
          releaseIp();
        });
        socket.on('error', (error) => {
          logger.warn('Managed Board WebSocket error', { boardId: roomId, error: error.message });
          handle?.close('socket error').catch(() => undefined);
          releaseIp();
        });
        return;
      }

      const { room, created } = await roomManager.get(roomId);
      initializeRoom(room);

      room.connections.set(socket, new Set());
      logger.info('Client connected', { roomId, clients: room.connections.size, created });

      sendInitialSync(room, socket);

      socket.on('message', (raw) => {
        handleMessage(room, socket, toUint8Array(raw));
      });

      socket.on('close', () => {
        removeConnection(roomId, room, socket);
        releaseIp();
      });
      socket.on('error', (error) => {
        logger.warn('WebSocket error', { roomId, error: error.message });
        removeConnection(roomId, room, socket);
        releaseIp();
      });
    })().catch((error) => {
      logger.error('WebSocket connection failed', { error: (error as Error).message });
      signals.record({
        name: 'session.admission',
        correlationId,
        dimensions: { admitted: false, reason: 'internal' }
      });
      releaseIp();
      socket.close(1011, 'Internal error');
    });
  });

  const listen = (host: string, port: number): Promise<number> =>
    new Promise((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        const address = server.address();
        const bound = typeof address === 'object' && address ? address.port : port;
        logger.info('Realtime backend listening', { host, port: bound, path: paths.whiteboard });
        resolve(bound);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });

  const close = async (deadline: Date): Promise<{ listenersClosed: boolean; remainingClients: number }> => {
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.close(1001, 'Server shutting down');
      }
    }
    const terminateAt = Math.max(0, deadline.getTime() - Date.now());
    if (wss.clients.size > 0 && terminateAt > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(terminateAt, 1_000)));
    }
    for (const client of wss.clients) {
      client.terminate();
    }
    const remainingClients = wss.clients.size;
    const listenersClosed = await new Promise<boolean>((resolve) => {
      const leftover = Math.max(0, deadline.getTime() - Date.now());
      const timer = setTimeout(() => resolve(false), leftover);
      wss.close(() => {
        server.close((error) => {
          clearTimeout(timer);
          resolve(!error);
        });
      });
    });
    return { listenersClosed, remainingClients };
  };

  const pingClients = () => {
    wss.clients.forEach((ws) => {
      const socket = ws as ManagedSocket;
      if (!socket.isAlive) {
        socket.terminate();
        return;
      }
      socket.isAlive = false;
      socket.ping();
    });
  };

  return {
    app,
    server,
    wss,
    listen,
    close,
    pingClients,
    connectionCount: () => openConnections
  };
};
