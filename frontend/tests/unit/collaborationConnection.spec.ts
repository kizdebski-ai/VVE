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
});
