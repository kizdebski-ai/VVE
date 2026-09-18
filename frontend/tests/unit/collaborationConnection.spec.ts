import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import {
  collaborationMessage,
  connectToYjs,
  encodeOperationFrame
} from '@/services/connectToYjs';

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  binaryType = '';
  sent: Uint8Array[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(bytes: Uint8Array) {
    this.sent.push(new Uint8Array(bytes));
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  receive(bytes: Uint8Array) {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    this.onmessage?.({ data: buffer } as MessageEvent);
  }

  close(code = 1000, reason = '') {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason } as CloseEvent);
  }
}

const serverFrame = (type: number, payload = new Uint8Array()) => {
  const frame = new Uint8Array(1 + payload.length);
  frame[0] = type;
  frame.set(payload, 1);
  return frame;
};

describe('acknowledged collaboration client', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'stable-client-op') });
    window.history.replaceState({}, '', '/?room=test');
  });

  it('remains read-only on socket open and becomes editable only after synchronization-complete', () => {
    const statuses: string[] = [];
    const connection = connectToYjs('board-1', { wsToken: 'managed-token', onStatus: (status) => statuses.push(status) });
    const socket = FakeWebSocket.instances[0]!;

    expect(connection.isEditable()).toBe(false);
    socket.open();
    expect(connection.isEditable()).toBe(false);
    expect(statuses.at(-1)).toBe('connecting');

    socket.receive(serverFrame(collaborationMessage.sync, Y.encodeStateAsUpdate(new Y.Doc())));
    socket.receive(serverFrame(collaborationMessage.synchronizationComplete));

    expect(connection.isEditable()).toBe(true);
    expect(statuses.at(-1)).toBe('connected');
  });

  it('becomes read-only immediately on connection loss and only recovers after a new sync', () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    const connection = connectToYjs('board-1', { wsToken: 'managed-token', onStatus: (status) => statuses.push(status) });
    const first = FakeWebSocket.instances[0]!;
    first.open();
    first.receive(serverFrame(collaborationMessage.synchronizationComplete));
    expect(connection.isEditable()).toBe(true);

    first.close(1006, 'network lost');
    expect(connection.isEditable()).toBe(false);
    expect(statuses).toContain('disconnected');
    expect(() => connection.ydoc.getMap('lesson').set('offline', 'blocked')).toThrow(/read-only/);
    expect(connection.ydoc.getMap('lesson').has('offline')).toBe(false);

    vi.advanceTimersByTime(1_000);
    const second = FakeWebSocket.instances[1]!;
    second.open();
    expect(connection.isEditable()).toBe(false);
    second.receive(serverFrame(collaborationMessage.synchronizationComplete));
    expect(connection.isEditable()).toBe(true);
    vi.useRealTimers();
  });

  it('keeps one stable pending operation across reconnect and removes it only on acknowledgement', () => {
    vi.useFakeTimers();
    const connection = connectToYjs('board-1', { wsToken: 'managed-token' });
    const first = FakeWebSocket.instances[0]!;
    first.open();
    first.receive(serverFrame(collaborationMessage.synchronizationComplete));
    first.sent.length = 0;

    connection.ydoc.getMap('lesson').set('answer', '42');
    const originalMutation = first.sent.find((frame) => frame[0] === collaborationMessage.mutation)!;
    expect(originalMutation).toBeDefined();
    expect(connection.pendingOperationCount()).toBe(1);

    first.close(1006, 'network lost');
    vi.advanceTimersByTime(1_000);
    const second = FakeWebSocket.instances[1]!;
    second.open();
    second.receive(serverFrame(collaborationMessage.synchronizationComplete));
    const retriedMutation = second.sent.find((frame) => frame[0] === collaborationMessage.mutation)!;
    expect(retriedMutation).toEqual(originalMutation);

    second.receive(serverFrame(
      collaborationMessage.acknowledgement,
      new TextEncoder().encode(JSON.stringify({ operationId: 'stable-client-op', digest: 'abc', duplicate: true }))
    ));
    expect(connection.pendingOperationCount()).toBe(0);
    vi.useRealTimers();
  });

  it('reconnects immediately on browser connectivity, discarding the remaining backoff', () => {
    vi.useFakeTimers();
    const connection = connectToYjs('board-1', { wsToken: 'managed-token' });
    const first = FakeWebSocket.instances[0]!;
    first.open();
    first.receive(serverFrame(collaborationMessage.synchronizationComplete));

    first.close(1006, 'network lost');
    vi.advanceTimersByTime(1_000);
    const second = FakeWebSocket.instances[1]!;
    second.close(1006, 'still offline');
    expect(FakeWebSocket.instances).toHaveLength(2);

    window.dispatchEvent(new Event('online'));
    expect(FakeWebSocket.instances).toHaveLength(3);
    const third = FakeWebSocket.instances[2]!;
    third.open();
    third.receive(serverFrame(collaborationMessage.synchronizationComplete));
    expect(connection.isEditable()).toBe(true);

    vi.advanceTimersByTime(20_000);
    expect(FakeWebSocket.instances).toHaveLength(3);
    vi.useRealTimers();
  });

  it('becomes read-only immediately on a server-draining frame and reconnects', () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    const connection = connectToYjs('board-1', { wsToken: 'managed-token', onStatus: (status) => statuses.push(status) });
    const first = FakeWebSocket.instances[0]!;
    first.open();
    first.receive(serverFrame(collaborationMessage.synchronizationComplete));
    expect(connection.isEditable()).toBe(true);

    first.receive(serverFrame(collaborationMessage.serverDraining, new TextEncoder().encode('Server restarting')));
    expect(connection.isEditable()).toBe(false);
    expect(statuses.at(-1)).toBe('draining');

    first.close(4012, 'Server restarting');
    expect(statuses.at(-1)).toBe('draining');

    vi.advanceTimersByTime(1_000);
    const second = FakeWebSocket.instances[1]!;
    expect(statuses.at(-1)).toBe('draining');
    second.open();
    expect(connection.isEditable()).toBe(false);
    expect(statuses.at(-1)).toBe('draining');
    second.receive(serverFrame(collaborationMessage.synchronizationComplete));
    expect(connection.isEditable()).toBe(true);
    expect(statuses.at(-1)).toBe('connected');
    vi.useRealTimers();
  });

  it('applies a versioned remote update without re-sending it', () => {
    const connection = connectToYjs('board-1', { wsToken: 'managed-token' });
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.receive(serverFrame(collaborationMessage.synchronizationComplete));
    socket.sent.length = 0;
    const remote = new Y.Doc();
    remote.getMap('lesson').set('remote', 'visible');

    socket.receive(encodeOperationFrame(
      collaborationMessage.update,
      'remote-op',
      Y.encodeStateAsUpdate(remote)
    ));

    expect(connection.ydoc.getMap('lesson').get('remote')).toBe('visible');
    expect(socket.sent.some((frame) => frame[0] === collaborationMessage.mutation)).toBe(false);
  });

  it('reconciles local document back to authoritative state when server denies a mutation', () => {
    const deniedEvents: Array<{ reason: string; operationId: string; messageKey?: string }> = [];
    const connection = connectToYjs('board-1', {
      wsToken: 'managed-token',
      onMutationDenied: (denial) => deniedEvents.push(denial)
    });
    const socket = FakeWebSocket.instances[0]!;
    socket.open();

    const initial = new Y.Doc();
    const itemMap = new Y.Map<unknown>();
    itemMap.set('id', 'kept-1');
    itemMap.set('type', 'rectangle');
    initial.getArray('drawings').push([itemMap]);

    socket.receive(serverFrame(collaborationMessage.sync, Y.encodeStateAsUpdate(initial)));
    socket.receive(serverFrame(collaborationMessage.synchronizationComplete));

    expect(connection.ydoc.getArray('drawings').length).toBe(1);

    // Client makes a local edit
    const rejectedMap = new Y.Map<unknown>();
    rejectedMap.set('id', 'rejected-mutation');
    rejectedMap.set('type', 'rectangle');
    connection.ydoc.getArray('drawings').push([rejectedMap]);
    connection.ydoc.getMap('lesson').set('unauthorized', 'value');

    expect(connection.ydoc.getArray('drawings').length).toBe(2);
    expect(connection.ydoc.getMap('lesson').get('unauthorized')).toBe('value');
    expect(connection.pendingOperationCount()).toBe(1);

    // Server denies the mutation
    socket.receive(serverFrame(
      collaborationMessage.denial,
      new TextEncoder().encode(JSON.stringify({
        operationId: 'stable-client-op',
        reason: 'rate',
        messageKey: 'rate.burstLimit'
      }))
    ));

    // Client rolls back to authoritative state
    expect(connection.pendingOperationCount()).toBe(0);
    expect(connection.ydoc.getArray('drawings').length).toBe(1);
    expect((connection.ydoc.getArray('drawings').get(0) as Y.Map<unknown>).get('id')).toBe('kept-1');
    expect(connection.ydoc.getMap('lesson').has('unauthorized')).toBe(false);
    expect(deniedEvents).toHaveLength(1);
    expect(deniedEvents[0]).toMatchObject({
      reason: 'rate',
      operationId: 'stable-client-op',
      messageKey: 'rate.burstLimit'
    });
  });

  it('purges oversized frame on WS 1009 close and reconciles document to prevent resend loops', () => {
    vi.useFakeTimers();
    const deniedEvents: Array<{ reason: string; operationId: string }> = [];
    const connection = connectToYjs('board-1', {
      wsToken: 'managed-token',
      maxPayloadBytes: 100, // artificially small limit
      onMutationDenied: (denial) => deniedEvents.push(denial)
    });
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.receive(serverFrame(collaborationMessage.synchronizationComplete));

    // Generate mutation larger than maxPayloadBytes
    connection.ydoc.getMap('lesson').set('large-blob', 'x'.repeat(200));

    // When maxPayloadBytes is reached in ydocUpdateHandler, it directly rejects and reconciles
    expect(connection.pendingOperationCount()).toBe(0);
    expect(connection.ydoc.getMap('lesson').has('large-blob')).toBe(false);
    expect(deniedEvents).toHaveLength(1);
    expect(deniedEvents[0].reason).toBe('resource');

    vi.useRealTimers();
  });
});

const decodeOperationId = (frame: Uint8Array): string => {
  const idLength = new DataView(frame.buffer, frame.byteOffset + 1, 2).getUint16(0);
  return new TextDecoder().decode(frame.slice(3, 3 + idLength));
};

const decodeOperationUpdate = (frame: Uint8Array): Uint8Array => {
  const idLength = new DataView(frame.buffer, frame.byteOffset + 1, 2).getUint16(0);
  return frame.slice(3 + idLength);
};

describe('authoritative rejected-mutation reconciliation (VVE-107 107-R1)', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'stable-client-op') });
    window.history.replaceState({}, '', '/?room=test');
  });

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

  const rectangle = (id: string) => {
    const map = new Y.Map<unknown>();
    map.set('id', id);
    map.set('type', 'rectangle');
    map.set('x', 10);
    map.set('y', 10);
    map.set('width', 40);
    map.set('height', 30);
    return map;
  };

  it('denial, further edits, undo, reconnect and reload keep client and server digests equal', () => {
    vi.useFakeTimers();
    let opCounter = 0;
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => `op-${++opCounter}`) });

    const connection = connectToYjs('board-1', { wsToken: 'managed-token' });
    const socket = FakeWebSocket.instances[0]!;
    socket.open();

    // Server-authoritative state: one pre-existing rectangle.
    const serverDoc = new Y.Doc();
    serverDoc.getArray('drawings').push([rectangle('kept-1')]);
    socket.receive(serverFrame(collaborationMessage.sync, Y.encodeStateAsUpdate(serverDoc)));
    socket.receive(serverFrame(collaborationMessage.synchronizationComplete));
    expect(connection.isEditable()).toBe(true);

    const undoManager = new Y.UndoManager(connection.ydoc.getArray('drawings'));

    // Local edit 1 — accepted by the server.
    connection.ydoc.getArray('drawings').push([rectangle('accepted-1')]);
    let mutation = socket.sent.findLast((frame) => frame[0] === collaborationMessage.mutation)!;
    const op1 = decodeOperationId(mutation);
    Y.applyUpdate(serverDoc, decodeOperationUpdate(mutation));
    socket.receive(serverFrame(collaborationMessage.acknowledgement,
      new TextEncoder().encode(JSON.stringify({ operationId: op1, digest: 'd1' }))));
    expect(canonicalDigest(connection.ydoc)).toBe(canonicalDigest(serverDoc));

    // Local edit 2 — rejected by the server (resource denial).
    connection.ydoc.getArray('drawings').push([rectangle('rejected-1')]);
    mutation = socket.sent.findLast((frame) => frame[0] === collaborationMessage.mutation)!;
    const op2 = decodeOperationId(mutation);
    // NOTE: the server never applies this update.
    socket.receive(serverFrame(collaborationMessage.denial,
      new TextEncoder().encode(JSON.stringify({ operationId: op2, reason: 'resource', messageKey: 'resource.messageRate' }))));
    expect(connection.pendingOperationCount()).toBe(0);
    expect(canonicalDigest(connection.ydoc)).toBe(canonicalDigest(serverDoc));
    expect(connection.ydoc.getArray('drawings').toJSON().map((i: { id: string }) => i.id))
      .toEqual(['kept-1', 'accepted-1']);

    // Further dependent edit 3 — accepted.
    connection.ydoc.getArray('drawings').push([rectangle('accepted-2')]);
    mutation = socket.sent.findLast((frame) => frame[0] === collaborationMessage.mutation)!;
    const op3 = decodeOperationId(mutation);
    Y.applyUpdate(serverDoc, decodeOperationUpdate(mutation));
    socket.receive(serverFrame(collaborationMessage.acknowledgement,
      new TextEncoder().encode(JSON.stringify({ operationId: op3, digest: 'd3' }))));
    expect(canonicalDigest(connection.ydoc)).toBe(canonicalDigest(serverDoc));

    // Undo of the last local edit — the undo transaction is itself a mutation
    // the server accepts; the rejected object must never reappear.
    undoManager.undo();;
    mutation = socket.sent.findLast((frame) => frame[0] === collaborationMessage.mutation);
    if (mutation) {
      Y.applyUpdate(serverDoc, decodeOperationUpdate(mutation));
      socket.receive(serverFrame(collaborationMessage.acknowledgement,
        new TextEncoder().encode(JSON.stringify({ operationId: decodeOperationId(mutation), digest: 'd4' }))));
    }
    expect(canonicalDigest(connection.ydoc)).toBe(canonicalDigest(serverDoc));
    expect(connection.ydoc.getArray('drawings').toJSON().map((i: { id: string }) => i.id).includes('rejected-1'))
      .toBe(false);

    // Reconnect: full server sync + reload-equivalent reconciliation.
    socket.close(1006, 'network lost');
    vi.advanceTimersByTime(1_000);
    const second = FakeWebSocket.instances[1]!;
    second.open();
    second.receive(serverFrame(collaborationMessage.sync, Y.encodeStateAsUpdate(serverDoc)));
    second.receive(serverFrame(collaborationMessage.synchronizationComplete));

    expect(canonicalDigest(connection.ydoc)).toBe(canonicalDigest(serverDoc));
    expect(connection.ydoc.getArray('drawings').toJSON().map((i: { id: string }) => i.id).includes('rejected-1'))
      .toBe(false);
    expect(connection.isEditable()).toBe(true);
    vi.useRealTimers();
  });
});
