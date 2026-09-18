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
import {
  createResourceGovernor,
  polishResourceMessage,
  type ResourceGovernor
} from './resourceGovernor';
import { resourceLimitsFromEnv } from './resourceLimits';

const messageSync = 0;
const messageAwareness = 1;
const messageHeartbeat = 18;

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

// Connection and payload limits live in ResourceGovernor (resourceLimits.ts);
// the listener reads them via governor.limits() so no product limit is
// duplicated here.

const checkRateLimit = (ws: ManagedSocket, max: number, windowMs: number): boolean => {
  const now = Date.now();
  if (!ws.msgWindowStart || now - ws.msgWindowStart > windowMs) {
    ws.msgWindowStart = now;
    ws.msgCount = 1;
    return true;
  }
  ws.msgCount = (ws.msgCount || 0) + 1;
  return ws.msgCount <= max;
};

const getClientIp = (request: http.IncomingMessage): string => {
  // The application has no configured trust-proxy policy. A raw forwarded
  // header is therefore caller-controlled and must not affect per-IP limits.
  // Deployments that need proxy-aware identity must configure that policy at
  // the edge and pass a verified peer address to the process.
  return request.socket.remoteAddress || 'unknown';
};

type MessageWindowLimits = { max: number; windowMs: number };

const handleMessage = (room: RoomContext, ws: ManagedSocket, data: Uint8Array, limits: MessageWindowLimits) => {
  if (!data || data.length === 0) return;
  if (!checkRateLimit(ws, limits.max, limits.windowMs)) return;

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
  resourceGovernor?: ResourceGovernor;
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

  const governor = deps.resourceGovernor ?? createResourceGovernor();

  const app = createHttpApp({
    roomManager,
    aiSolver,
    capabilityAccess,
    boardLifecycle,
    health,
    signals,
    resourceGovernor: governor,
    ...(deps.environment ? { environment: deps.environment } : {}),
    ...(deps.devSurface !== undefined ? { devSurface: deps.devSurface } : {})
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, maxPayload: governor.limits().maxWebsocketPayloadBytes });
  const ipConnectionCounts = new Map<string, number>();
  let openConnections = 0;

  // Transport-level message window. The limit values come from the shared
  // ResourceGovernor; the authoritative per-client accounting also happens in
  // the governor through CollaborationRuntime admission.
  const messageWindow = (): MessageWindowLimits => ({
    max: governor.limits().maxMessagesPerWindow,
    windowMs: governor.limits().messageWindowMs
  });

  const trackIpConnect = (ip: string): boolean => {
    const current = ipConnectionCounts.get(ip) || 0;
    if (current >= governor.limits().maxConnectionsPerIp) return false;
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
      // Too many connections
      socket.close(1013, polishResourceMessage('resource.connectionLimit'));
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

    // The socket can disappear while admission/authentication is awaiting the
    // database. Install the idempotent transport cleanup before that first
    // await; a handle returned later is closed by the post-connect check.
    let handle: ConnectionHandle | null = null;
    let socketClosed = false;
    const closeManagedConnection = (reason: string): void => {
      if (socketClosed) return;
      socketClosed = true;
      releaseIp();
      const closing = handle?.close(reason);
      void closing?.catch(() => undefined);
    };
    socket.on('close', () => closeManagedConnection('socket closed'));
    socket.on('error', (error) => {
      logger.warn('WebSocket error', { error: error.message });
      closeManagedConnection('socket error');
    });

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

      if (socketClosed || socket.readyState !== WebSocket.OPEN) {
        releaseIp();
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
            if (socket.bufferedAmount > governor.limits().maxSlowClientBufferedBytes) {
              governor.observe({ kind: 'slowClientBuffer', bytes: socket.bufferedAmount, clientKey: clientIp, boardId: roomId });
              // 1009 is reserved for an oversized message. A slow consumer
              // is a policy close, matching mapGovernorDenialToSocketClose.
              socket.close(1008, polishResourceMessage('resource.slowClient'));
              throw new CollaborationFailure('resource', polishResourceMessage('resource.slowClient'));
            }
            socket.send(encodeServerFrame(frame), { binary: true });
          },
          close: async (code, reason) => {
            if (socket.readyState === WebSocket.OPEN) socket.close(code, reason);
          }
        };

        handle = await collaborationRuntime.connect(
          {
            boardId: roomId,
            grant: admission.decision,
            revalidate: async () => (await wsAdmission.admit(roomId, token)).admitted,
            clientKey: clientIp
          },
          transport
        );
        if (socketClosed) {
          await handle.close('socket closed during connect').catch(() => undefined);
          return;
        }

        socket.on('message', (raw) => {
          const window = messageWindow();
          if (!checkRateLimit(socket, window.max, window.windowMs)) {
            socket.close(1013, polishResourceMessage('resource.messageRate'));
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
              } else if (failure?.code === 'resource') {
                socket.close(1013, failure.message);
              } else if (failure?.code === 'malformed') {
                socket.close(1008, 'Malformed frame');
              } else {
                socket.close(1011, 'Internal error');
              }
            });
        });
        return;
      }

      const legacyAdmission = governor.admit({ kind: 'connection', clientKey: clientIp });
      if (legacyAdmission.decision !== 'allow' && legacyAdmission.decision !== 'allowWithBudget') {
        signals.record({
          name: 'resource.denial',
          correlationId,
          dimensions: { reason: 'governor' }
        });
        releaseIp();
        socket.close(1013, polishResourceMessage('resource.connectionLimit'));
        return;
      }
      let legacySlotHeld = true;
      const releaseLegacySlot = () => {
        if (!legacySlotHeld) return;
        legacySlotHeld = false;
        governor.observe({ kind: 'connectionClosed', clientKey: clientIp });
      };

      const { room, created } = await roomManager.get(roomId);
      initializeRoom(room);

      room.connections.set(socket, new Set());
      logger.info('Client connected', { roomId, clients: room.connections.size, created });

      sendInitialSync(room, socket);

      socket.on('message', (raw) => {
        handleMessage(room, socket, toUint8Array(raw), messageWindow());
      });

      socket.on('close', () => {
        removeConnection(roomId, room, socket);
        releaseLegacySlot();
        releaseIp();
      });
      socket.on('error', (error) => {
        logger.warn('WebSocket error', { roomId, error: error.message });
        removeConnection(roomId, room, socket);
        releaseLegacySlot();
        releaseIp();
      });
    })().catch((error) => {
      const failure = error instanceof CollaborationFailure ? error : null;
      if (failure?.code === 'resource') {
        signals.record({
          name: 'resource.denial',
          correlationId,
          dimensions: { reason: 'governor' }
        });
        releaseIp();
        socket.close(1013, failure.message);
        return;
      }
      if (failure?.code === 'persistenceUnavailable') {
        signals.record({
          name: 'persistence.error',
          correlationId,
          dimensions: { reason: 'hydrateFailed' }
        });
        releaseIp();
        socket.close(1013, 'Persistence unavailable');
        return;
      }
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
      // Browser WebSockets cannot send control pings. This tiny application
      // heartbeat gives the client a two-second read-only watchdog even when
      // the TCP close event itself is delayed by a silent blackhole.
      send(socket, new Uint8Array([messageHeartbeat]));
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
