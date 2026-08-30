import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates
} from 'y-protocols/awareness';
import { resolveWsUrl } from './backendUrl';

export const collaborationMessage = {
  sync: 10,
  awareness: 11,
  mutation: 12,
  acknowledgement: 13,
  synchronizationComplete: 14,
  denial: 15,
  serverDraining: 16,
  update: 17
} as const;

const legacyMessage = { sync: 0, awareness: 1 } as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const prefixed = (type: number, payload = new Uint8Array()): Uint8Array => {
  const frame = new Uint8Array(1 + payload.length);
  frame[0] = type;
  frame.set(payload, 1);
  return frame;
};

export const encodeOperationFrame = (
  type: number,
  operationId: string,
  update: Uint8Array
): Uint8Array => {
  const id = encoder.encode(operationId);
  const payload = new Uint8Array(2 + id.length + update.length);
  new DataView(payload.buffer).setUint16(0, id.length);
  payload.set(id, 2);
  payload.set(update, 2 + id.length);
  return prefixed(type, payload);
};

const decodeOperationFrame = (data: Uint8Array) => {
  if (data.length < 4) throw new Error('Malformed collaboration update.');
  const idLength = new DataView(data.buffer, data.byteOffset + 1, 2).getUint16(0);
  const updateOffset = 3 + idLength;
  if (idLength === 0 || updateOffset >= data.length) {
    throw new Error('Malformed collaboration update.');
  }
  return {
    operationId: decoder.decode(data.slice(3, updateOffset)),
    update: data.slice(updateOffset)
  };
};

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

export interface YjsConnection {
  ydoc: Y.Doc;
  awareness: Awareness;
  socket: WebSocket;
  yDrawings: Y.Array<any>;
  isEditable: () => boolean;
  pendingOperationCount: () => number;
  disconnect: () => void;
}

export interface MutationDenial {
  reason: string;
  operationId: string;
  messageKey?: string;
}

export interface ConnectOptions {
  wsToken?: string | null;
  onStatus?: (status: ConnectionStatus) => void;
  /**
   * Called when the server rejects one specific operation (schema violation
   * or a forbidden command such as a Student clear). The session stays
   * connected; the caller must roll the local document back to the server
   * state, which arrives as a fresh sync.
   */
  onMutationDenied?: (denial: MutationDenial) => void;
}

const buildWebSocketUrl = (roomId: string) => {
  const url = resolveWsUrl(roomId);
  if (url) return url;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/whiteboard/${roomId}`;
};

const operationId = (): string => {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  return `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

/**
 * Managed Board client Adapter. Socket-open is deliberately not connected:
 * editing becomes available only after synchronization-complete. Every local
 * update retains one stable operation id until its durability ACK arrives.
 */
export function connectToYjs(roomId: string, options?: ConnectOptions): YjsConnection {
  const ydoc = new Y.Doc();
  ydoc.gc = true;
  const awareness = new Awareness(ydoc);
  const yDrawings: Y.Array<any> = ydoc.getArray('drawings');
  const managed = Boolean(options?.wsToken);
  const baseUrl = buildWebSocketUrl(roomId);
  const wsUrl = options?.wsToken
    ? `${baseUrl}?wsToken=${encodeURIComponent(options.wsToken)}`
    : baseUrl;

  let socket: WebSocket | null = null;
  let editable = false;
  let reconnectTimeout = 1_000;
  const reconnectTimeoutMax = 10_000;
  let reconnectTimer: number | null = null;
  let explicitlyDisconnected = false;
  const pending = new Map<string, Uint8Array>();

  const setStatus = (status: ConnectionStatus) => options?.onStatus?.(status);
  const handleBrowserOffline = () => {
    editable = false;
    setStatus('disconnected');
    setStatus('reconnecting');
    // Force a fresh authenticated sync instead of trusting a socket whose
    // TCP failure may otherwise take many seconds to surface in the browser.
    socket?.close(4001, 'Browser offline');
  };
  const handleBrowserOnline = () => {
    editable = false;
    if (explicitlyDisconnected || socket) return;
    // Connectivity is back: discard the remaining exponential backoff so a
    // fresh authenticated sync can restore editing within the 5 s gate.
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectTimeout = 1_000;
    setupWebSocket();
  };
  const clearRemoteAwareness = (origin: string) => {
    const remote = Array.from(awareness.getStates().keys()).filter(
      (clientId) => clientId !== awareness.clientID
    );
    if (remote.length) removeAwarenessStates(awareness, remote, origin);
  };

  const sendAwareness = () => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    const update = encodeAwarenessUpdate(awareness, [awareness.clientID]);
    socket.send(prefixed(managed ? collaborationMessage.awareness : legacyMessage.awareness, update));
  };

  const resendPending = () => {
    if (!managed || socket?.readyState !== WebSocket.OPEN || !editable) return;
    pending.forEach((frame) => socket?.send(frame));
  };

  const ydocUpdateHandler = (update: Uint8Array, origin: unknown) => {
    if (origin === 'collaborationRemote') return;
    if (!managed) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(prefixed(legacyMessage.sync, update));
      }
      return;
    }
    // The UI blocks ordinary edits while read-only. A programmatic update
    // racing an open socket is retained and retried instead of being lost.
    if (!editable && socket?.readyState !== WebSocket.OPEN) return;
    const id = operationId();
    const frame = encodeOperationFrame(collaborationMessage.mutation, id, update);
    pending.set(id, frame);
    if (editable && socket?.readyState === WebSocket.OPEN) socket.send(frame);
  };

  const awarenessUpdateHandler = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ) => {
    const changed = added.concat(updated, removed);
    if (
      origin === 'collaborationRemote' ||
      socket?.readyState !== WebSocket.OPEN ||
      !changed.length ||
      (managed && !editable)
    ) return;
    const update = encodeAwarenessUpdate(awareness, changed);
    socket.send(prefixed(managed ? collaborationMessage.awareness : legacyMessage.awareness, update));
  };

  const beforeTransactionHandler = (transaction: Y.Transaction) => {
    if (managed && !editable && transaction.origin !== 'collaborationRemote') {
      throw new Error('Board is read-only until authenticated synchronization completes.');
    }
  };

  ydoc.on('beforeTransaction', beforeTransactionHandler);
  ydoc.on('update', ydocUpdateHandler);
  awareness.on('update', awarenessUpdateHandler);
  window.addEventListener('offline', handleBrowserOffline);
  window.addEventListener('online', handleBrowserOnline);

  const setupWebSocket = () => {
    if (explicitlyDisconnected) return;
    editable = false;
    setStatus(reconnectTimeout === 1_000 ? 'connecting' : 'reconnecting');
    socket = new WebSocket(wsUrl);
    socket.binaryType = 'arraybuffer';

    socket.onopen = () => {
      reconnectTimeout = 1_000;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (!managed) {
        editable = true;
        setStatus('connected');
        sendAwareness();
      }
    };

    socket.onmessage = (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const data = new Uint8Array(event.data);
      if (!data.length) return;
      const type = data[0];

      if (!managed) {
        if (type === legacyMessage.sync) Y.applyUpdate(ydoc, data.slice(1), 'collaborationRemote');
        if (type === legacyMessage.awareness) {
          applyAwarenessUpdate(awareness, data.slice(1), 'collaborationRemote');
        }
        return;
      }

      switch (type) {
        case collaborationMessage.sync:
          Y.applyUpdate(ydoc, data.slice(1), 'collaborationRemote');
          break;
        case collaborationMessage.update: {
          const remote = decodeOperationFrame(data);
          Y.applyUpdate(ydoc, remote.update, 'collaborationRemote');
          break;
        }
        case collaborationMessage.awareness:
          applyAwarenessUpdate(awareness, data.slice(1), 'collaborationRemote');
          break;
        case collaborationMessage.synchronizationComplete:
          editable = true;
          setStatus('connected');
          sendAwareness();
          resendPending();
          break;
        case collaborationMessage.acknowledgement: {
          const acknowledgement = JSON.parse(decoder.decode(data.slice(1))) as {
            operationId?: string;
          };
          if (acknowledgement.operationId) pending.delete(acknowledgement.operationId);
          break;
        }
        case collaborationMessage.denial: {
          let denial: { reason?: string; operationId?: string; messageKey?: string } = {};
          try {
            denial = JSON.parse(decoder.decode(data.slice(1)));
          } catch {
            denial = { reason: decoder.decode(data.slice(1)) };
          }
          if (denial.operationId) {
            pending.delete(denial.operationId);
            options?.onMutationDenied?.({
              reason: denial.reason ?? 'malformed',
              operationId: denial.operationId,
              messageKey: denial.messageKey
            });
            break;
          }
          editable = false;
          setStatus('disconnected');
          break;
        }
        case collaborationMessage.serverDraining:
          editable = false;
          socket?.close(4012, 'Server restarting');
          break;
      }
    };

    socket.onclose = () => {
      socket = null;
      editable = false;
      clearRemoteAwareness('collaborationRemote');
      setStatus('disconnected');
      if (!explicitlyDisconnected) {
        setStatus('reconnecting');
        reconnectTimer = window.setTimeout(setupWebSocket, reconnectTimeout);
        reconnectTimeout = Math.min(reconnectTimeout * 2, reconnectTimeoutMax);
      }
    };
  };

  const disconnect = () => {
    explicitlyDisconnected = true;
    editable = false;
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    ydoc.off('update', ydocUpdateHandler);
    ydoc.off('beforeTransaction', beforeTransactionHandler);
    awareness.off('update', awarenessUpdateHandler);
    window.removeEventListener('offline', handleBrowserOffline);
    window.removeEventListener('online', handleBrowserOnline);
    clearRemoteAwareness('disconnect');
    socket?.close();
  };

  setupWebSocket();

  return {
    ydoc,
    awareness,
    get socket() {
      return socket as WebSocket;
    },
    yDrawings,
    isEditable: () => editable,
    pendingOperationCount: () => pending.size,
    disconnect
  };
}
