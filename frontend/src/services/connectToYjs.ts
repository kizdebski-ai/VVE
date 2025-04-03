import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';

// Define message types
const messageSync = 0;
const messageAwareness = 1;
// Add other types if needed (e.g., messageAuth = 2)

// Define the structure of the returned object
interface YjsConnection {
  ydoc: Y.Doc;
  awareness: Awareness; // Add awareness instance
  socket: WebSocket;
  yDrawings: Y.Array<any>; // Shared array for drawing data
  disconnect: () => void; // Function to manually disconnect
}

// Reconnect parameters
const RECONNECT_TIMEOUT_BASE = 1000; // Initial timeout in ms
const RECONNECT_TIMEOUT_MAX = 10000; // Max timeout in ms
let reconnectTimeout = RECONNECT_TIMEOUT_BASE;
let reconnectTimer: number | null = null;
let explicitlyDisconnected = false; // Flag to prevent reconnect after manual disconnect

/**
 * Establishes a WebSocket connection to synchronize a Yjs document and a specific Y.Array for drawings.
 *
 * @param roomId The unique identifier for the collaboration room.
 * @param wsUrlTemplate Optional template for the WebSocket URL. Defaults to 'ws://localhost:8000/ws/whiteboard/{roomId}/'.
 * @returns An object containing the Yjs document, the WebSocket instance, the shared drawings array, and a disconnect function.
 */
export function connectToYjs(
  roomId: string,
  wsUrlTemplate: string = 'ws://localhost:8000/ws/whiteboard/{roomId}/'
): YjsConnection {
  console.log(`[Yjs Provider] Connecting to room: ${roomId}`);

  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc); // Create awareness instance

  // --- Set Initial Local Awareness State ---
  // TODO: Get actual user info (name, color) from auth/store if available
  const defaultUser = {
    name: `User_${ydoc.clientID.toString().slice(-4)}`, // Simple default name
    color: `#${Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')}` // Random color
  };
  awareness.setLocalStateField('user', defaultUser);
  console.log('[Yjs Provider] Set initial local awareness state:', awareness.getLocalState());
  // ---

  // Get the shared Y.Array named 'drawings'. It will be created if it doesn't exist.
  const yDrawings: Y.Array<any> = ydoc.getArray('drawings');
  const wsUrl = wsUrlTemplate.replace('{roomId}', roomId);
  let socket: WebSocket | null = null;

  const setupWebSocket = () => {
    if (explicitlyDisconnected) {
      console.log('[Yjs Provider] Explicitly disconnected, not reconnecting.');
      return; // Don't reconnect if manually disconnected
    }

    console.log(`[Yjs Provider] Attempting to connect to ${wsUrl}...`);
    socket = new WebSocket(wsUrl);
    socket.binaryType = 'arraybuffer'; // Important for receiving binary data (Uint8Array)

    // --- WebSocket Event Handlers ---

    socket.onopen = () => {
      console.log('[Yjs Provider] WebSocket connection established.');
      // Reset reconnect timeout on successful connection
      reconnectTimeout = RECONNECT_TIMEOUT_BASE;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      // --- Send initial awareness state ---
      // The backend now sends the initial document state upon connection.
      if (socket?.readyState === WebSocket.OPEN) {
        // REMOVED: Sending initial document state (backend handles this)
        // const docState = Y.encodeStateAsUpdate(ydoc);
        // const syncMessage = new Uint8Array([messageSync, ...docState]);
        // socket.send(syncMessage);
        // console.log('[Yjs Provider] Sent initial document state.');

        // Send awareness state (prefixed)
        const awarenessState = encodeAwarenessUpdate(awareness, [awareness.clientID]); // Use awareness.clientID
        const awarenessMessage = new Uint8Array([messageAwareness, ...awarenessState]);
        socket.send(awarenessMessage);
        console.log('[Yjs Provider] Sent initial awareness state.');

        // --- Attach Yjs listeners only AFTER socket is open ---
        // Note: ydoc.on and awareness.on are typically idempotent, but attaching here ensures
        // we don't try to send before the socket is ready after initial connect or reconnect.
        console.log('[Yjs Provider] Attaching ydoc & awareness update listeners.');
        ydoc.on('update', ydocUpdateHandler);
        awareness.on('update', awarenessUpdateHandler);
        // ---

      } else {
        console.error('[Yjs Provider] WebSocket not open when trying to send initial states.');
      }
    };

    socket.onmessage = (event: MessageEvent) => {
      // console.log('[Yjs Provider] Received message from server.');
      if (event.data instanceof ArrayBuffer) {
        const data = new Uint8Array(event.data);
        const messageType = data[0]; // First byte is the type
        const update = data.slice(1); // The rest is the payload

        switch (messageType) {
          case messageSync:
            console.log('[Yjs Provider] Attempting to apply sync update (Type 0)');
            Y.applyUpdate(ydoc, update, 'websocketProvider');
            break;
          case messageAwareness:
            console.log('[Yjs Provider] Attempting to apply awareness update (Type 1)');
            applyAwarenessUpdate(awareness, update, 'websocketProvider');
            break;
          default:
            console.warn(`[Yjs Provider] Received unknown message type: ${messageType}`, data);
        }
      } else {
        console.warn('[Yjs Provider] Received non-binary message:', event.data);
      }
    };

    socket.onerror = (event: Event) => {
      console.error('[Yjs Provider] WebSocket error:', event);
      // Consider triggering reconnect here as well, depending on the error
    };

    socket.onclose = (event: CloseEvent) => {
      console.log(`[Yjs Provider] WebSocket connection closed (Code: ${event.code}, Reason: ${event.reason}).`);
      // --- Clean up awareness state on close ---
      removeAwarenessStates(awareness, Array.from(awareness.getStates().keys()).filter(client => client !== ydoc.clientID), 'websocketProvider');
      socket = null; // Clear the socket reference

      // Attempt to reconnect if not explicitly disconnected
      if (!explicitlyDisconnected) {
        console.log(`[Yjs Provider] Attempting to reconnect in ${reconnectTimeout / 1000} seconds...`);
        if (reconnectTimer) clearTimeout(reconnectTimer); // Clear existing timer if any
        reconnectTimer = window.setTimeout(setupWebSocket, reconnectTimeout);
        // Exponential backoff for reconnect attempts
        reconnectTimeout = Math.min(reconnectTimeout * 2, RECONNECT_TIMEOUT_MAX);
      }
    };
  };

  // --- Yjs Document & Awareness Event Handlers ---
  // Define handlers outside setupWebSocket so they can be referenced in onopen and disconnect

  const ydocUpdateHandler = (update: Uint8Array, origin: any) => {
    // Only send updates that didn't originate from the WebSocket provider itself
    if (origin !== 'websocketProvider' && socket?.readyState === WebSocket.OPEN) {
      // console.log('[Yjs Provider] Local Yjs update detected, sending to server:', update);
      const message = new Uint8Array([messageSync, ...update]); // Prefix with type
      socket.send(message);
    } else if (origin !== 'websocketProvider') {
      // This warning might still appear if updates happen during reconnection attempts
      console.warn('[Yjs Provider] WebSocket not open, unable to send document update.');
    }
  };

  const awarenessUpdateHandler = ({ added, updated, removed }: { added: number[], updated: number[], removed: number[] }, origin: any) => {
    // Only send updates that didn't originate from the WebSocket provider itself
    const changedClients = added.concat(updated, removed);
    if (origin !== 'websocketProvider' && socket?.readyState === WebSocket.OPEN) {
      // console.log('[Yjs Provider] Local awareness update detected, sending to server:', changedClients);
      const update = encodeAwarenessUpdate(awareness, changedClients);
      const message = new Uint8Array([messageAwareness, ...update]); // Prefix with type
      socket.send(message);
    } else if (origin !== 'websocketProvider') {
       // This warning might still appear if updates happen during reconnection attempts
       console.warn('[Yjs Provider] WebSocket not open, unable to send awareness update.');
    }
  };

  // --- Disconnect Function ---
  const disconnect = () => {
    console.log('[Yjs Provider] Disconnecting...');
    explicitlyDisconnected = true; // Set flag to prevent automatic reconnect
    if (reconnectTimer) {
      clearTimeout(reconnectTimer); // Cancel any pending reconnect timer
      reconnectTimer = null;
    }
    // --- Clean up awareness state on explicit disconnect ---
    removeAwarenessStates(awareness, [ydoc.clientID], 'disconnect');
    ydoc.off('update', ydocUpdateHandler); // Stop listening to Yjs updates
    awareness.off('update', awarenessUpdateHandler); // Stop listening to awareness updates
    if (socket) {
      socket.close(); // Close the WebSocket connection
      socket = null;
    }
    console.log('[Yjs Provider] Disconnected.');
  };

  // Initial connection attempt
  setupWebSocket();

  // Return the document, the socket instance, the drawings array, and the disconnect function
  return {
    ydoc,
    // We return a getter for the socket to ensure consumers always get the current instance
    get socket() {
      return socket!; // Use non-null assertion, assuming it will be initialized
    },
    yDrawings, // Return the Y.Array instance
    awareness, // Return the awareness instance
    disconnect,
  };
}
