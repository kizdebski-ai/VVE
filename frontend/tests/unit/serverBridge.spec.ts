/**
 * VVE-107 re-verification: real CollaborationRuntime (server) bridged to the
 * real connectToYjs client adapter over the real protocol codecs. This is
 * finding 107-R1's reviewer harness replayed against the remediated client.
 * The reviewer's premise is also demonstrated: a plain server Yjs sync MERGES
 * and cannot undo rejected local objects — which is why the client owns
 * explicit reconciliation plus a full-state mutation after a pruned unacked
 * operation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import {
  collaborationMessage,
  connectToYjs,
  type MutationDenial
} from '@/services/connectToYjs';
import {
  createCollaborationRuntime,
  InMemoryBoardDocumentStore,
  type AuthenticatedConnection,
  type BoardDocumentStore,
  type ConnectionHandle,
  type ServerFrame
} from '@pilot/collaborationRuntime';
import { decodeClientFrame, encodeServerFrame } from '@pilot/collaborationProtocol';
import { createResourceGovernor } from '@pilot/resourceGovernor';
import { createResourceLimits } from '@pilot/resourceLimits';

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  static serverSend: ((bytes: Uint8Array) => void) | null = null;

  readyState = FakeWebSocket.CONNECTING;
  sent: Uint8Array[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(bytes: Uint8Array): void {
    this.sent.push(new Uint8Array(bytes));
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  /** Server → client delivery of an encoded server frame. */
  receiveServerFrame(bytes: Uint8Array): void {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    this.onmessage?.({ data: buffer } as MessageEvent);
  }

  close(code = 1000, reason = ''): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason } as CloseEvent);
  }
}

const canonicalDigest = (doc: Y.Doc): string => {
  const drawings = (doc.getArray('drawings').toJSON() as Array<Record<string, unknown>>)
    .map((item) => JSON.stringify(item))
    .sort()
    .join('|');
  const lesson = Object.entries(doc.getMap('lesson').toJSON())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join('|');
  return JSON.stringify({ drawings, lesson });
};

const rectangleDoc = (id: string): Y.Doc => {
  const doc = new Y.Doc();
  doc.transact(() => {
    const map = new Y.Map();
    doc.getArray('drawings').push([map]);
    map.set('id', id);
    map.set('type', 'rectangle');
    map.set('x', 10);
    map.set('y', 10);
    map.set('width', 40);
    map.set('height', 30);
  });
  return doc;
};

const decodeOperationId = (frame: Uint8Array): string => {
  const idLength = new DataView(frame.buffer, frame.byteOffset + 1, 2).getUint16(0);
  return new TextDecoder().decode(frame.slice(3, 3 + idLength));
};

const decodeOperationUpdate = (frame: Uint8Array): Uint8Array => {
  const idLength = new DataView(frame.buffer, frame.byteOffset + 1, 2).getUint16(0);
  return frame.slice(3 + idLength);
};

const flush = async (rounds = 12): Promise<void> => {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

describe('VVE-107 integration: real runtime ↔ real client (107-R1 replay)', () => {
  let runtime: ReturnType<typeof createCollaborationRuntime>;
  let handle: ConnectionHandle | null = null;
  let serverDoc: Y.Doc;
  let denials: MutationDenial[];
  let connection: ReturnType<typeof connectToYjs> | null = null;
  const acceptedUpdates: Uint8Array[] = [];

  const recordingStore = (): BoardDocumentStore => {
    const inner = new InMemoryBoardDocumentStore();
    return {
      hydrate: (boardId) => inner.hydrate(boardId),
      append: async (boardId, operationId, update) => {
        const result = await inner.append(boardId, operationId, update);
        if (!result.duplicate) {
          acceptedUpdates.push(update);
          Y.applyUpdate(serverDoc, update);
        }
        return result;
      },
      compact: (boardId, snapshot, cutoff) => inner.compact(boardId, snapshot, cutoff)
    };
  };

  const serverConnection = (boardId = 'board-1', role = 'teacher'): AuthenticatedConnection => ({
    boardId,
    grant: {
      granted: true,
      action: 'board.edit',
      role,
      teacherId: 'teacher-1',
      boardId,
      credentialVersion: 1
    } as AuthenticatedConnection['grant'],
    revalidate: async () => true,
    clientKey: '203.0.113.7'
  });

  const openManagedSession = async (): Promise<FakeWebSocket> => {
    const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
    socket.open();
    await flush();
    handle = await runtime.connect(serverConnection(), {
      send: async (frame: ServerFrame) => socket.receiveServerFrame(encodeServerFrame(frame)),
      close: async () => socket.close(),
      bufferedBytes: () => 0
    });
    // Deliver every runtime-originated server frame through the bridge.
    return socket;
  };

  beforeEach(async () => {
    FakeWebSocket.instances = [];
    FakeWebSocket.serverSend = null;
    serverDoc = new Y.Doc();
    acceptedUpdates.length = 0;
    denials = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);

    // 2 messages per window: first mutation is acknowledged, the next gets
    // the reviewer's exact `resource.messageRate` denial.
    const limits = createResourceLimits({ maxMessagesPerWindow: 2, messageWindowMs: 250 });
    runtime = createCollaborationRuntime({
      store: recordingStore(),
      resourceGovernor: createResourceGovernor({ limits })
    });

    connection = connectToYjs('board-1', {
      wsToken: 'managed-token',
      onMutationDenied: (denial) => denials.push(denial)
    });

    // Bridge: every frame the client sends is decoded and fed to the real
    // runtime; every frame the runtime sends is encoded to the client.
    const pump = async (): Promise<void> => {
      for (const socket of FakeWebSocket.instances) {
        while (socket.sent.length > 0) {
          const frame = socket.sent.shift()!;
          try {
            await handle?.receive(decodeClientFrame(frame));
          } catch (error) {
            if (!(error instanceof CollaborationFailure)) throw error;
          }
        }
      }
    };
    pumpInterval = setInterval(() => {
      void pump();
    }, 0) as unknown as number;
  });

  let pumpInterval: number | null = null;

  afterEach(() => {
    if (pumpInterval !== null) {
      clearInterval(pumpInterval);
      pumpInterval = null;
    }
    connection?.disconnect();
    connection = null;
    handle = null;
    vi.unstubAllGlobals();
  });

  it('denial → further edits → undo → reconnect: client and server digests converge', async () => {
    const socket = await openManagedSession();
    await flush();
    expect(connection!.isEditable()).toBe(true);
    const undoManager = new Y.UndoManager(connection!.ydoc.getArray('drawings'), { captureTimeout: 0 });

    // Pre-existing server content, seeded through a SECOND connection —
    // broadcasts exclude the origin socket, so the client only receives
    // content authored by someone else (as in the real system).
    const seedHandle = await runtime.connect(serverConnection('board-1', 'teacher'), {
      send: async () => {},
      close: async () => {},
      bufferedBytes: () => 0
    });
    const existing = rectangleDoc('kept-1');
    await seedHandle.receive({
      kind: 'mutation',
      operationId: 'server-seed',
      update: Y.encodeStateAsUpdate(existing)
    });
    await flush();
    await seedHandle.close('seed done');

    // Local edit 1 — accepted (window: message 1 used by seed? no, seed came
    // through handle directly; this is client mutation #1).
    connection!.ydoc.transact(() => {
      const map = new Y.Map();
      connection!.ydoc.getArray('drawings').push([map]);
      map.set('id', 'accepted-1');
      map.set('type', 'rectangle');
      map.set('x', 1);
      map.set('y', 1);
      map.set('width', 5);
      map.set('height', 5);
    });
    await flush();

    // Local edit 2 — client mutation #2 in the window → resource denial.
    connection!.ydoc.transact(() => {
      const map = new Y.Map();
      connection!.ydoc.getArray('drawings').push([map]);
      map.set('id', 'rejected-1');
      map.set('type', 'rectangle');
      map.set('x', 2);
      map.set('y', 2);
      map.set('width', 6);
      map.set('height', 6);
    });
    // Snapshot BEFORE the denial/reconciliation arrives — exactly the state
    // the pre-fix client was left in.
    const preReconciliationState = Y.encodeStateAsUpdate(connection!.ydoc);
    await flush();

    expect(denials.length).toBeGreaterThanOrEqual(1);
    expect(denials.some((d) => d.messageKey === 'resource.messageRate')).toBe(true);

    // The reviewer's premise, demonstrated against plain Yjs: applying the
    // server state as an ordinary sync MERGES and does NOT undo the rejected
    // local object — plain sync cannot repair the divergence.
    const naiveDoc = new Y.Doc();
    Y.applyUpdate(naiveDoc, preReconciliationState);
    Y.applyUpdate(naiveDoc, Y.encodeStateAsUpdate(serverDoc));
    const naiveIds = (naiveDoc.getArray('drawings').toJSON() as Array<{ id: string }>).map((i) => i.id);
    expect(naiveIds).toContain('rejected-1');

    // The remediated client instead reconciles: rejected object gone,
    // accepted work preserved, digests equal.
    const clientIds = (connection!.ydoc.getArray('drawings').toJSON() as Array<{ id: string }>).map((i) => i.id);
    expect(clientIds).not.toContain('rejected-1');
    expect(clientIds).toContain('kept-1');
    expect(clientIds).toContain('accepted-1');
    expect(canonicalDigest(connection!.ydoc)).toBe(canonicalDigest(serverDoc));

    // Further edit — the next mutation carries FULL state (tombstone chain
    // broken) and the server accepts it; digests stay equal.
    connection!.ydoc.transact(() => {
      const map = new Y.Map();
      connection!.ydoc.getArray('drawings').push([map]);
      map.set('id', 'accepted-2');
      map.set('type', 'rectangle');
      map.set('x', 3);
      map.set('y', 3);
      map.set('width', 7);
      map.set('height', 7);
    });
    // The 250 ms window is still exhausted, so this mutation is denied as
    // well; let the window elapse in real time before retrying.
    await flush();
    expect(denials.length).toBeGreaterThanOrEqual(2);
    await new Promise((resolve) => setTimeout(resolve, 300));

    connection!.ydoc.transact(() => {
      const map = new Y.Map();
      connection!.ydoc.getArray('drawings').push([map]);
      map.set('id', 'accepted-2');
      map.set('type', 'rectangle');
      map.set('x', 3);
      map.set('y', 3);
      map.set('width', 7);
      map.set('height', 7);
    });
    await flush();

    const afterIds = (connection!.ydoc.getArray('drawings').toJSON() as Array<{ id: string }>).map((i) => i.id);
    expect(afterIds).toContain('accepted-2');
    expect(canonicalDigest(connection!.ydoc)).toBe(canonicalDigest(serverDoc));

    // Undo of the last local edit — the undo transaction is itself a mutation
    // the real server accepts; digests converge and the rejected object
    // never reappears.
    await new Promise((resolve) => setTimeout(resolve, 300));
    undoManager.undo();
    await flush();
    const undoneIds = (connection!.ydoc.getArray('drawings').toJSON() as Array<{ id: string }>).map((i) => i.id);
    expect(undoneIds).not.toContain('accepted-2');
    expect(undoneIds).not.toContain('rejected-1');
    expect(canonicalDigest(connection!.ydoc)).toBe(canonicalDigest(serverDoc));

    // Reconnect: fresh socket, server resyncs from durable state, digests
    // still converge and the rejected object never reappears.
    socket.close(1006, 'network lost');
    await flush();
    const reconnected = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
    reconnected.open();
    handle = await runtime.connect(serverConnection(), {
      send: async (frame: ServerFrame) => reconnected.receiveServerFrame(encodeServerFrame(frame)),
      close: async () => reconnected.close(),
      bufferedBytes: () => 0
    });
    await flush();

    expect(canonicalDigest(connection!.ydoc)).toBe(canonicalDigest(serverDoc));
    const finalIds = (connection!.ydoc.getArray('drawings').toJSON() as Array<{ id: string }>).map((i) => i.id);
    expect(finalIds).not.toContain('rejected-1');
    expect(finalIds).not.toContain('accepted-2');
    expect(finalIds).toContain('kept-1');
    expect(finalIds).toContain('accepted-1');
    expect(canonicalDigest(connection!.ydoc)).toBe(canonicalDigest(serverDoc));
    expect(connection!.isEditable()).toBe(true);
  });
});
