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

// Debug: Check API Key
const apiKey = process.env.OPENROUTER_API_KEY;
console.log('----------------------------------------');
console.log('Server Startup Config Check:');
console.log(`OPENROUTER_API_KEY present: ${!!apiKey}`);
if (apiKey) {
  console.log(`OPENROUTER_API_KEY length: ${apiKey.length}`);
  console.log(`OPENROUTER_API_KEY prefix: ${apiKey.substring(0, 10)}...`);
} else {
  console.error('CRITICAL: OPENROUTER_API_KEY is MISSING in process.env!');
}
console.log('----------------------------------------');

const messageSync = 0;
const messageAwareness = 1;

type ManagedSocket = WebSocket & { isAlive?: boolean };
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

const handleMessage = (room: RoomContext, ws: WebSocket, data: Uint8Array) => {
  if (!data || data.length === 0) {
    logger.debug('Ignoring empty WebSocket message');
    return;
  }

  const messageType = data[0];
  const payload = data.slice(1);

  switch (messageType) {
    case messageSync: {
      try {
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

const parseRoomId = (requestUrl?: string | null): string | null => {
  if (!requestUrl) return null;
  try {
    const url = new URL(requestUrl, 'http://localhost');
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length >= 3 && segments[0] === 'ws' && segments[1] === 'whiteboard') {
      return decodeURIComponent(segments.slice(2).join('/'));
    }
  } catch {
    return null;
  }
  return null;
};

const persistence = new FilePersistence(config.dataDir);
const roomManager = new RoomManager(persistence);
const aiSolver = new OpenRouterEquationSolver();
export const app = createHttpApp({ roomManager, aiSolver });

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (socket: ManagedSocket, request) => {
  const roomId = parseRoomId(request.url);
  if (!roomId) {
    socket.close(1008, 'Invalid room');
    return;
  }

  const { room, created } = roomManager.get(roomId);
  initializeRoom(room);

  socket.isAlive = true;
  socket.on('pong', () => {
    socket.isAlive = true;
  });

  room.connections.set(socket, new Set());
  logger.info('Client connected', { roomId, clients: room.connections.size, created });

  sendInitialSync(room, socket);

  socket.on('message', (raw) => {
    handleMessage(room, socket, toUint8Array(raw));
  });

  socket.on('close', () => removeConnection(roomId, room, socket));
  socket.on('error', (error) => logger.warn('WebSocket error', { roomId, error: error.message }));
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
}, config.pingIntervalMs);

server.listen(config.port, config.host, () => {
  logger.info('Realtime backend ready', { host: config.host, port: config.port, path: paths.whiteboard });
});

const shutdown = () => {
  logger.info('Shutting down server');
  clearInterval(pingInterval);
  wss.clients.forEach((client) => client.terminate());
  server.close(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
