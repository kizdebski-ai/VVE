/**
 * VVE-108 composition gate (108-I1): the shared ResourceGovernor policy from
 * VVE-107 flows through RuntimeControl into the realtime listener, capability
 * access, collaboration runtime, and socket buffers.
 *
 * Acceptance under review: 57 WebSocket clients from ONE shared IP across the
 * required 22-board distribution are all admitted and exchange normal
 * mutations plus awareness; configured payload limits agree end to end; the
 * overloaded board receives a typed Polish denial instead of a generic 1011.
 */
import { afterAll, describe, expect, it } from 'vitest';
import http from 'http';
import WebSocket from 'ws';
import request from 'supertest';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';

import { createRealtimeListener } from '../src/pilot/realtimeListener';
import {
  createCollaborationRuntime,
  InMemoryBoardDocumentStore
} from '../src/pilot/collaborationRuntime';
import { createOperationalSignals } from '../src/pilot/operationalSignals';
import { createResourceGovernor } from '../src/pilot/resourceGovernor';
import { createResourceLimits, resourceLimitsFromEnv, type ResourceLimits } from '../src/pilot/resourceLimits';
import type { CapabilityAccess } from '../src/pilot/capabilityAccess';
import type { BoardLifecycle } from '../src/pilot/boardLifecycle';
import type { RoomManager } from '../src/rooms';
import type { EquationSolver } from '../src/services/aiSolver';

const BOARDS = 22;
const CLIENTS = 57;

const boardId = (index: number): string =>
  `aaaaaaaa-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;

const grantedAccess = (): CapabilityAccess =>
  ({
    decide: async (input: { target?: { boardId?: string | null } }) => ({
      granted: true as const,
      action: 'board.edit' as const,
      role: 'teacher' as const,
      teacherId: 'teacher-composition',
      boardId: input.target?.boardId ?? null,
      credentialVersion: 1,
      validUntil: null
    })
  }) as unknown as CapabilityAccess;

const stubLifecycle = (): BoardLifecycle => ({ stopDeletionSweep: () => undefined }) as unknown as BoardLifecycle;

const stubRoomManager = (): RoomManager =>
  ({ closeRoomSockets: () => undefined }) as unknown as RoomManager;

const stubSolver = (): EquationSolver => ({} as unknown as EquationSolver);

type CompositionClient = {
  socket: WebSocket;
  boardIndex: number;
  clientIndex: number;
  awareness: awarenessProtocol.Awareness;
  closeInfo: { code: number; reason: string } | null;
  acks: Array<{ operationId: string; digest: string }>;
  updates: Array<{ operationId: string }>;
  awarenessFrames: number;
  initialDrawings: Array<Record<string, unknown>>;
  syncDigest: string | null;
};

const encodeMutationFrame = (operationId: string, update: Uint8Array): Buffer => {
  const id = Buffer.from(operationId);
  const payload = Buffer.alloc(2 + id.length + update.length);
  payload.writeUInt16BE(id.length, 0);
  id.copy(payload, 2);
  Buffer.from(update).copy(payload, 2 + id.length);
  return Buffer.concat([Buffer.from([12]), payload]);
};

const canonicalRectangleUpdate = (objectId: string): Uint8Array => {
  const doc = new Y.Doc();
  const drawings = doc.getArray<Y.Map<unknown>>('drawings');
  const rect = new Y.Map<unknown>();
  rect.set('id', objectId);
  rect.set('type', 'rectangle');
  rect.set('x', 10);
  rect.set('y', 20);
  rect.set('width', 120);
  rect.set('height', 80);
  rect.set('color', '#1f2937');
  rect.set('lineWidth', 2);
  rect.set('timestamp', 1);
  drawings.push([rect]);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
};

const readDrawings = (state: Uint8Array): Array<Record<string, unknown>> => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const objects = doc
    .getArray<Y.Map<unknown>>('drawings')
    .map((entry) => JSON.parse(JSON.stringify(entry.toJSON())) as Record<string, unknown>);
  doc.destroy();
  return objects;
};

const closeListener = async (listener: ReturnType<typeof createRealtimeListener>): Promise<void> => {
  await listener.close(new Date(Date.now() + 1_000));
};

describe('Realtime composition through the shared ResourceGovernor (108-I1)', () => {
  const signals = createOperationalSignals({ emitJson: false });
  const governor = createResourceGovernor({ limits: resourceLimitsFromEnv() });
  const collaboration = createCollaborationRuntime({
    store: new InMemoryBoardDocumentStore(),
    signals
  });
  const listener = createRealtimeListener({
    roomManager: stubRoomManager(),
    aiSolver: stubSolver(),
    capabilityAccess: grantedAccess(),
    boardLifecycle: stubLifecycle(),
    collaborationRuntime: collaboration,
    signals,
    health: {
      live: () => true,
      ready: () => true,
      checks: () => ({ database: true, persistence: true }),
      snapshot: () => signals.snapshot()
    },
    admitting: () => true,
    environment: 'pilot',
    devSurface: false,
    resourceGovernor: governor
  });
  let boundPort = 0;

  const clients: CompositionClient[] = [];

  beforeConnect: {
    // Assign the required 22-board distribution: boards 0-12 host three
    // clients, boards 13-21 host two (13*3 + 9*2 = 57).
    const distribution = (clientIndex: number): number => clientIndex % BOARDS;
    void distribution;
  }

  const connectClient = (clientIndex: number): Promise<CompositionClient> =>
    new Promise((resolve, reject) => {
      const boardIndex = clientIndex % BOARDS;
      const socket = new WebSocket(
        `ws://127.0.0.1:${boundPort}/ws/whiteboard/${boardId(boardIndex)}?wsToken=composition-token`
      );
      socket.binaryType = 'arraybuffer';
      const client: CompositionClient = {
        socket,
        boardIndex,
        clientIndex,
        awareness: new awarenessProtocol.Awareness(new Y.Doc()),
        closeInfo: null,
        acks: [],
        updates: [],
        awarenessFrames: 0,
        initialDrawings: [],
        syncDigest: null
      };
      const timer = setTimeout(
        () => reject(new Error(`client ${clientIndex} not synchronized within 10s`)),
        10_000
      );
      socket.on('message', (raw) => {
        const bytes = Buffer.from(raw as Buffer);
        const type = bytes[0];
        if (type === 10) {
          client.initialDrawings = readDrawings(new Uint8Array(bytes.subarray(1)));
        } else if (type === 14) {
          const payload = JSON.parse(bytes.subarray(1).toString()) as { digest: string };
          client.syncDigest = payload.digest;
          clearTimeout(timer);
          resolve(client);
        } else if (type === 13) {
          client.acks.push(JSON.parse(bytes.subarray(1).toString()));
        } else if (type === 17) {
          const idLength = bytes.readUInt16BE(1);
          client.updates.push({ operationId: bytes.subarray(3, 3 + idLength).toString() });
        } else if (type === 11) {
          client.awarenessFrames += 1;
        } else if (type === 15) {
          client.closeInfo = { code: 15, reason: bytes.subarray(1).toString() };
        }
      });
      socket.on('close', (code, reason) => {
        client.closeInfo = { code, reason: reason.toString() };
      });
      socket.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

  it('admits the 57-client / 22-board shared-IP lesson and carries normal traffic', { timeout: 60_000 }, async () => {
    boundPort = await listener.listen('127.0.0.1', 0);
    const limits = governor.limits();

    // The configured payload limit is the governor's, not a hardcoded 5 MiB.
    expect(limits.maxWebsocketPayloadBytes).toBe(10 * 1024 * 1024);
    expect(limits.maxConnectionsPerIp).toBe(96);
    const wssOptions = (listener.wss as unknown as { options: { maxPayload: number } }).options;
    expect(wssOptions.maxPayload).toBe(limits.maxWebsocketPayloadBytes);
    const published = await request(listener.app).get('/api/resource-limits');
    expect(published.status).toBe(200);
    expect(published.body.maxConnectionsPerIp).toBe(limits.maxConnectionsPerIp);
    expect(published.body.maxWebsocketPayloadBytes).toBe(limits.maxWebsocketPayloadBytes);

    for (let i = 0; i < CLIENTS; i += 1) {
      clients.push(await connectClient(i));
    }
    // Every client from the single shared IP survived admission — the prior
    // hardcoded 20-per-IP transport cap would have dropped 37 of them.
    expect(clients.filter((c) => c.syncDigest !== null)).toHaveLength(CLIENTS);
    expect(clients.every((c) => c.closeInfo === null)).toBe(true);

    // Representative traffic: the first client on every board sends a canonical
    // rectangle mutation; every peer on that board acknowledges fan-out.
    for (let board = 0; board < BOARDS; board += 1) {
      const boardClients = clients.filter((c) => c.boardIndex === board);
      const sender = boardClients[0];
      const operationId = `op-board-${board}`;
      const awaited = new Promise<void>((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error(`board ${board} ack timed out`)), 10_000);
        const check = () => {
          const ack = sender.acks.find((a) => a.operationId === operationId);
          if (!ack) return;
          const peers = boardClients.slice(1);
          const allPeersGotUpdate = peers.every((peer) =>
            peer.updates.some((u) => u.operationId === operationId)
          );
          if (allPeersGotUpdate) {
            clearTimeout(deadline);
            resolve();
          }
        };
        check();
        const interval = setInterval(check, 5);
        const finish = () => clearInterval(interval);
        sender.socket.once('close', () => {
          finish();
          clearTimeout(deadline);
          reject(new Error(`board ${board} sender closed`));
        });
      });
      sender.socket.send(encodeMutationFrame(operationId, canonicalRectangleUpdate(`rect-${board}`)));
      await awaited;
    }

    // Awareness sharing: every client broadcasts presence; every board with a
    // peer sees at least one awareness frame arrive.
    for (const client of clients) {
      client.awareness.setLocalState({
        cursor: { x: client.clientIndex, y: client.boardIndex }
      });
      const update = awarenessProtocol.encodeAwarenessUpdate(client.awareness, [
        client.awareness.clientID
      ]);
      const frame = Buffer.concat([Buffer.from([11]), Buffer.from(update)]);
      client.socket.send(frame);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    const clientsWithPeers = clients.filter((c) => clients.filter((p) => p.boardIndex === c.boardIndex).length > 1);
    expect(clientsWithPeers.every((c) => c.awarenessFrames > 0)).toBe(true);
    expect(clients.every((c) => c.closeInfo === null)).toBe(true);
  });

  it('denies a board over its governor cap with a typed Polish reason, not 1011', { timeout: 20_000 }, async () => {
    // Boards 0 already hosts 3 clients; the default per-board cap is 8. Push
    // board 0 to its cap, then expect the next admission to be denied with the
    // typed Polish message and a 1013 close (not a generic internal error).
    const target = 8;
    const existing = clients.filter((c) => c.boardIndex === 0).length;
    const extra: CompositionClient[] = [];
    for (let i = existing; i < target; i += 1) {
      const client = await new Promise<CompositionClient>((resolve, reject) => {
        const socket = new WebSocket(
          `ws://127.0.0.1:${boundPort}/ws/whiteboard/${boardId(0)}?wsToken=composition-token`
        );
        socket.binaryType = 'arraybuffer';
        const entry: CompositionClient = {
          socket,
          boardIndex: 0,
          clientIndex: 1000 + i,
          awareness: new awarenessProtocol.Awareness(new Y.Doc()),
          closeInfo: null,
          acks: [],
          updates: [],
          awarenessFrames: 0,
          initialDrawings: [],
          syncDigest: null
        };
        const timer = setTimeout(() => reject(new Error('cap client not synchronized')), 10_000);
        socket.on('message', (raw) => {
          const bytes = Buffer.from(raw as Buffer);
          if (bytes[0] === 14) {
            clearTimeout(timer);
            resolve(entry);
          }
        });
        socket.on('close', (code, reason) => {
          entry.closeInfo = { code, reason: reason.toString() };
        });
        socket.on('error', reject);
      });
      extra.push(client);
    }
    expect(extra).toHaveLength(target - existing);

    const denied = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
      const socket = new WebSocket(
        `ws://127.0.0.1:${boundPort}/ws/whiteboard/${boardId(0)}?wsToken=composition-token`
      );
      socket.binaryType = 'arraybuffer';
      socket.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
      socket.on('error', reject);
    });
    expect(denied.code).toBe(1013);
    expect(denied.reason).toBe('Zbyt wiele połączeń. Spróbuj ponownie za chwilę.');

    for (const client of extra) {
      client.socket.close();
    }
  });

  afterAll(async () => {
    for (const client of clients) {
      client.socket.close();
      client.awareness.destroy();
    }
    await closeListener(listener);
  });
});

describe('Composition honours environment-tuned governor limits (108-I1)', () => {
  it('carries custom limits through the listener and collaboration admission', { timeout: 20_000 }, async () => {
    const customLimits: ResourceLimits = createResourceLimits({
      maxConnectionsPerIp: 96,
      maxProcessConnections: 96,
      maxBoardConnections: 2,
      maxMessagesPerWindow: 400
    });
    const signals = createOperationalSignals({ emitJson: false });
    const governor = createResourceGovernor({ limits: customLimits });
    const collaboration = createCollaborationRuntime({
      store: new InMemoryBoardDocumentStore(),
      signals,
      resourceGovernor: governor
    });
    const listener = createRealtimeListener({
      roomManager: stubRoomManager(),
      aiSolver: stubSolver(),
      capabilityAccess: grantedAccess(),
      boardLifecycle: stubLifecycle(),
      collaborationRuntime: collaboration,
      signals,
      health: {
        live: () => true,
        ready: () => true,
        checks: () => ({ database: true, persistence: true }),
        snapshot: () => signals.snapshot()
      },
      admitting: () => true,
      environment: 'pilot',
      devSurface: false,
      resourceGovernor: governor
    });
    const port = await listener.listen('127.0.0.1', 0);
    const target = boardId(5);

    const sockets: WebSocket[] = [];
    const open = (): Promise<number> =>
      new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/whiteboard/${target}?wsToken=t`);
        sockets.push(socket);
        socket.on('message', (raw) => {
          if (Buffer.from(raw as Buffer)[0] === 14) resolve(1);
        });
        socket.on('close', () => resolve(0));
        socket.on('error', reject);
      });

    const first = await open();
    const second = await open();
    expect(first).toBe(1);
    expect(second).toBe(1);
    const deniedCode = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/whiteboard/${target}?wsToken=t`);
      sockets.push(socket);
      socket.on('close', (code) => resolve(code));
      socket.on('error', reject);
    });
    expect(deniedCode).toBe(1013);

    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) socket.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (const socket of sockets) {
      socket.terminate();
    }
    const httpServer = listener.server as http.Server;
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });
});
