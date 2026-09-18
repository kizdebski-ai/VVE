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
  | 'disconnected'
  | 'draining';

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
  maxPayloadBytes?: number;
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
  let isDraining = false;
  let reconnectTimeout = 1_000;
  // The restart gate promises recovery within 5s of the server coming back.
  // With 1-2-4 doubling the worst wait between attempts would reach 10s;
  // a 3s cap keeps the worst-case wait (3s) plus connect time inside 5s.
  const reconnectTimeoutMax = 3_000;
  let reconnectTimer: number | null = null;
  let explicitlyDisconnected = false;
  const pending = new Map<string, Uint8Array>();
  const pendingUpdates = new Map<string, Uint8Array>();
  let authoritativeDoc = new Y.Doc();
  // A pruned unacked operation leaves its Yjs structs behind as tombstones.
  // Later insert diffs chain onto those structs (origin pointers), so a peer
  // that never received the rejected operation can never integrate them —
  // the update lands in its pending buffer forever. After a reconciliation
  // that removes unacked content, the next mutation must carry the full
  // document state so every peer integrates the same struct set.
  let sendFullStateNextMutation = false;

  const reconcileDrawings = (
    drawingsArray: Y.Array<any>,
    targetList: Array<Record<string, unknown>>
  ) => {
    const targetIds = targetList.map((t) => t.id as string);

    for (let i = drawingsArray.length - 1; i >= 0; i--) {
      const item = drawingsArray.get(i);
      const id = item instanceof Y.Map ? (item.get('id') as string) : (item as any)?.id;
      if (!targetIds.includes(id)) {
        drawingsArray.delete(i, 1);
      }
    }

    for (let i = 0; i < targetList.length; i++) {
      const target = targetList[i];
      const current = i < drawingsArray.length ? drawingsArray.get(i) : null;
      const currentId = current instanceof Y.Map ? (current.get('id') as string) : (current as any)?.id;

      if (current && currentId === target.id) {
        if (current instanceof Y.Map) {
          for (const key of Array.from(current.keys())) {
            if (!(key in target)) current.delete(key);
          }
          for (const [key, value] of Object.entries(target)) {
            if (value === undefined) {
              current.delete(key);
            } else {
              const existingVal = current.get(key);
              if (typeof value === 'object' && value !== null) {
                if (JSON.stringify(existingVal) !== JSON.stringify(value)) {
                  current.set(key, value);
                }
              } else if (existingVal !== value) {
                current.set(key, value);
              }
            }
          }
        }
      } else {
        let foundIndex = -1;
        for (let j = i + 1; j < drawingsArray.length; j++) {
          const item = drawingsArray.get(j);
          const id = item instanceof Y.Map ? (item.get('id') as string) : (item as any)?.id;
          if (id === target.id) {
            foundIndex = j;
            break;
          }
        }
        if (foundIndex !== -1) {
          const item = drawingsArray.get(foundIndex);
          drawingsArray.delete(foundIndex, 1);
          drawingsArray.insert(i, [item]);
          if (item instanceof Y.Map) {
            for (const key of Array.from(item.keys())) {
              if (!(key in target)) item.delete(key);
            }
            for (const [key, value] of Object.entries(target)) {
              if (value === undefined) {
                item.delete(key);
              } else {
                const existingVal = item.get(key);
                if (typeof value === 'object' && value !== null) {
                  if (JSON.stringify(existingVal) !== JSON.stringify(value)) {
                    item.set(key, value);
                  }
                } else if (existingVal !== value) {
                  item.set(key, value);
                }
              }
            }
          }
        } else {
          const map = new Y.Map();
          for (const [k, v] of Object.entries(target)) {
            if (v !== undefined) map.set(k, v);
          }
          drawingsArray.insert(i, [map]);
        }
      }
    }

    if (drawingsArray.length > targetList.length) {
      drawingsArray.delete(targetList.length, drawingsArray.length - targetList.length);
    }
  };

  const reconcileMaps = (doc: Y.Doc, authDoc: Y.Doc) => {
    for (const [key, type] of authDoc.share.entries()) {
      if (key === 'drawings') continue;
      if (type instanceof Y.Map) {
        const targetMap = authDoc.getMap(key);
        const clientMap = doc.getMap(key);
        for (const k of Array.from(clientMap.keys())) {
          if (!targetMap.has(k)) clientMap.delete(k);
        }
        for (const [k, v] of targetMap.entries()) {
          if (clientMap.get(k) !== v) clientMap.set(k, v);
        }
      }
    }
    for (const [key, type] of doc.share.entries()) {
      if (key === 'drawings') continue;
      if (!authDoc.share.has(key) && type instanceof Y.Map) {
        for (const k of Array.from(type.keys())) {
          type.delete(k);
        }
      }
    }
  };

  const reconcileWithAuthoritative = (): boolean => {
    let removedUnackedContent = false;
    let target = authoritativeDoc;
    let targetNeedsDestroy = false;
    if (pendingUpdates.size > 0) {
      const candidate = new Y.Doc();
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(authoritativeDoc));
      for (const update of pendingUpdates.values()) {
        try {
          Y.applyUpdate(candidate, update);
        } catch {
          // ignore updates that cannot apply cleanly
        }
      }
      target = candidate;
      targetNeedsDestroy = true;
    }
    try {
      ydoc.transact(() => {
        const targetDrawings = target.getArray('drawings').toJSON() as Array<Record<string, unknown>>;
        const drawingsBefore = yDrawings.length;
        reconcileDrawings(yDrawings, targetDrawings);
        if (yDrawings.length < drawingsBefore) removedUnackedContent = true;
        reconcileMaps(ydoc, target);
      }, 'collaborationReconciliation');
    } finally {
      if (targetNeedsDestroy) target.destroy();
    }
    if (removedUnackedContent) sendFullStateNextMutation = true;
    return removedUnackedContent;
  };

  const setStatus = (status: ConnectionStatus) => options?.onStatus?.(status);
  const handleBrowserOffline = () => {
    editable = false;
    if (!isDraining) {
      setStatus('disconnected');
      setStatus('reconnecting');
    }
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
    if (origin === 'collaborationRemote' || origin === 'collaborationReconciliation') return;
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
    // After a denial pruned unacked structs, send the whole document so the
    // server integrates the same struct set; later diffs chain onto it.
    const outgoingUpdate = sendFullStateNextMutation ? Y.encodeStateAsUpdate(ydoc) : update;
    const frame = encodeOperationFrame(collaborationMessage.mutation, id, outgoingUpdate);
    const maxPayload = options?.maxPayloadBytes ?? 10_485_760;
    if (frame.byteLength > maxPayload) {
      reconcileWithAuthoritative();
      options?.onMutationDenied?.({
        reason: 'resource',
        operationId: id,
        messageKey: 'resource.updateTooLarge'
      });
      return;
    }
    pending.set(id, frame);
    pendingUpdates.set(id, outgoingUpdate);
    sendFullStateNextMutation = false;
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
    if (
      managed &&
      !editable &&
      transaction.origin !== 'collaborationRemote' &&
      transaction.origin !== 'collaborationReconciliation'
    ) {
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
    if (isDraining) {
      setStatus('draining');
    } else {
      setStatus(reconnectTimeout === 1_000 ? 'connecting' : 'reconnecting');
    }
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
        case collaborationMessage.sync: {
          const update = data.slice(1);
          const freshDoc = new Y.Doc();
          Y.applyUpdate(freshDoc, update);
          authoritativeDoc.destroy();
          authoritativeDoc = freshDoc;
          Y.applyUpdate(ydoc, update, 'collaborationRemote');
          reconcileWithAuthoritative();
          break;
        }
        case collaborationMessage.update: {
          const remote = decodeOperationFrame(data);
          Y.applyUpdate(authoritativeDoc, remote.update);
          Y.applyUpdate(ydoc, remote.update, 'collaborationRemote');
          break;
        }
        case collaborationMessage.awareness:
          applyAwarenessUpdate(awareness, data.slice(1), 'collaborationRemote');
          break;
        case collaborationMessage.synchronizationComplete:
          isDraining = false;
          editable = true;
          setStatus('connected');
          sendAwareness();
          resendPending();
          break;
        case collaborationMessage.acknowledgement: {
          const acknowledgement = JSON.parse(decoder.decode(data.slice(1))) as {
            operationId?: string;
            digest?: string;
          };
          if (acknowledgement.operationId) {
            const unacked = pendingUpdates.get(acknowledgement.operationId);
            if (unacked) {
              Y.applyUpdate(authoritativeDoc, unacked);
              pendingUpdates.delete(acknowledgement.operationId);
            }
            pending.delete(acknowledgement.operationId);
          }
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
            pendingUpdates.delete(denial.operationId);
            sendFullStateNextMutation = true;
            reconcileWithAuthoritative();
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
          isDraining = true;
          setStatus('draining');
          socket?.close(4012, 'Server restarting');
          break;
      }
    };

    socket.onclose = (event?: CloseEvent) => {
      socket = null;
      editable = false;
      clearRemoteAwareness('collaborationRemote');
      if (event?.code === 1012 || event?.code === 4012 || (event?.code === 1013 && isDraining)) {
        isDraining = true;
      }
      if (isDraining) {
        setStatus('draining');
      } else {
        setStatus('disconnected');
      }
      if (event?.code === 1009) {
        const maxPayload = options?.maxPayloadBytes ?? 10_485_760;
        for (const [id, frame] of pending.entries()) {
          if (frame.byteLength > maxPayload) {
            pending.delete(id);
            pendingUpdates.delete(id);
            sendFullStateNextMutation = true;
            options?.onMutationDenied?.({
              reason: 'resource',
              operationId: id,
              messageKey: 'resource.updateTooLarge'
            });
          }
        }
        reconcileWithAuthoritative();
      }
      if (!explicitlyDisconnected) {
        if (!isDraining) {
          setStatus('reconnecting');
        }
        reconnectTimer = window.setTimeout(setupWebSocket, reconnectTimeout);
        reconnectTimeout = Math.min(reconnectTimeout * 2, reconnectTimeoutMax);
      }
    };
  };

  const disconnect = () => {
    explicitlyDisconnected = true;
    isDraining = false;
    editable = false;
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    ydoc.off('update', ydocUpdateHandler);
    ydoc.off('beforeTransaction', beforeTransactionHandler);
    awareness.off('update', awarenessUpdateHandler);
    window.removeEventListener('offline', handleBrowserOffline);
    window.removeEventListener('online', handleBrowserOnline);
    clearRemoteAwareness('disconnect');
    socket?.close();
    authoritativeDoc.destroy();
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
