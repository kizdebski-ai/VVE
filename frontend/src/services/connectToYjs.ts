import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { resolveWsUrl } from './backendUrl';

// Message types must match the backend
const messageSync = 0;
const messageAwareness = 1;

export interface YjsConnection {
  ydoc: Y.Doc;
  awareness: Awareness;
  socket: WebSocket;
  yDrawings: Y.Array<any>;
  disconnect: () => void;
}

const buildWebSocketUrl = (roomId: string) => {
  const url = resolveWsUrl(roomId);
  if (url) return url;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${protocol}//${host}/ws/whiteboard/${roomId}`;
};

export function connectToYjs(roomId: string): YjsConnection {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  const yDrawings: Y.Array<any> = ydoc.getArray('drawings');

  // Determine WebSocket URL
  const wsUrl = buildWebSocketUrl(roomId);

  let socket: WebSocket | null = null;
  let reconnectTimeout = 1000;
  const reconnectTimeoutMax = 10000;
  let reconnectTimer: ReturnType<typeof window.setTimeout> | null = null;
  let explicitlyDisconnected = false;
  let listenersAttached = false;

  const clearAwarenessStates = (origin: string) => {
    const knownClientIds = Array.from(awareness.getStates().keys()).filter(
      (clientId) => clientId !== awareness.clientID
    );
    if (knownClientIds.length) {
      removeAwarenessStates(awareness, knownClientIds, origin);
    }
  };

  const ydocUpdateHandler = (update: Uint8Array, origin: any) => {
    console.log('[connectToYjs] ydocUpdateHandler called. Origin:', origin, 'Update size:', update.length);
    if (origin !== 'websocketProvider' && socket?.readyState === WebSocket.OPEN) {
      const message = new Uint8Array(1 + update.length);
      message[0] = messageSync;
      message.set(update, 1);
      socket.send(message);
      console.log('[connectToYjs] Sent update to server, size:', update.length, 'origin:', origin);
    } else {
      if (origin !== 'websocketProvider') {
        console.warn('[connectToYjs] Skipped sending update. Socket readyState:', socket?.readyState);
      }
    }
  };

  const awarenessUpdateHandler = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: any) => {
    const changedClients = added.concat(updated, removed);
    if (origin !== 'websocketProvider' && socket?.readyState === WebSocket.OPEN && changedClients.length) {
      const update = encodeAwarenessUpdate(awareness, changedClients);
      const message = new Uint8Array(1 + update.length);
      message[0] = messageAwareness;
      message.set(update, 1);
      socket.send(message);
    }
  };

  const setupWebSocket = () => {
    if (explicitlyDisconnected) return;
    socket = new WebSocket(wsUrl);
    socket.binaryType = 'arraybuffer';

    socket.onopen = () => {
      console.log('[connectToYjs] WebSocket OPENED for room:', roomId);
      reconnectTimeout = 1000;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      // Send initial awareness state
      if (socket?.readyState === WebSocket.OPEN) {
        const awarenessState = encodeAwarenessUpdate(awareness, [awareness.clientID]);
        const message = new Uint8Array(1 + awarenessState.length);
        message[0] = messageAwareness;
        message.set(awarenessState, 1);
        socket.send(message);
        console.log('[connectToYjs] Sent initial awareness, clientID:', awareness.clientID);
      }

      if (!listenersAttached) {
        ydoc.on('update', ydocUpdateHandler);
        awareness.on('update', awarenessUpdateHandler);
        listenersAttached = true;
      }
    };

    socket.onmessage = (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const data = new Uint8Array(event.data);
      if (!data.length) return;
      const messageType = data[0];
      const payload = data.slice(1);
      switch (messageType) {
        case messageSync:
          Y.applyUpdate(ydoc, payload, 'websocketProvider');
          break;
        case messageAwareness:
          applyAwarenessUpdate(awareness, payload, 'websocketProvider');
          break;
        default:
          break;
      }
    };

    socket.onclose = (event) => {
      socket = null;
      clearAwarenessStates('websocketProvider');

      if (!explicitlyDisconnected) {
        reconnectTimer = window.setTimeout(setupWebSocket, reconnectTimeout);
        reconnectTimeout = Math.min(reconnectTimeout * 2, reconnectTimeoutMax);
      }
    };
  };

  const disconnect = () => {
    explicitlyDisconnected = true;
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    if (listenersAttached) {
      ydoc.off('update', ydocUpdateHandler);
      awareness.off('update', awarenessUpdateHandler);
      listenersAttached = false;
    }
    clearAwarenessStates('disconnect');
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
    disconnect,
  };
}
