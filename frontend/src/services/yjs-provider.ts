import * as Y from 'yjs';

// Define the structure of the returned object
interface YjsConnection {
  ydoc: Y.Doc;
  socket: WebSocket;
  disconnect: () => void; // Function to manually disconnect
}

// Reconnect parameters
const RECONNECT_TIMEOUT_BASE = 1000; // Initial timeout in ms
const RECONNECT_TIMEOUT_MAX = 10000; // Max timeout in ms
let reconnectTimeout = RECONNECT_TIMEOUT_BASE;
let reconnectTimer: number | null = null;
let explicitlyDisconnected = false; // Flag to prevent reconnect after manual disconnect

/**
 * Establishes a WebSocket connection to synchronize a Yjs document.
 *
 * @param roomId The unique identifier for the collaboration room.
 * @param wsUrlTemplate Optional template for the WebSocket URL. Defaults to 'ws://localhost:8000/ws/whiteboard/{roomId}/'.
 * @returns An object containing the Yjs document, the WebSocket instance, and a disconnect function.
 */
export function connectToYjs(
  roomId: string,
  wsUrlTemplate: string = 'ws://localhost:8000/ws/whiteboard/{roomId}/'
): YjsConnection {
  console.log(`[Yjs Provider] Connecting to room: ${roomId}`);

  const ydoc = new Y.Doc();
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

      // Send the initial state of the document to the server
      const initialState = Y.encodeStateAsUpdate(ydoc);
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(initialState);
        console.log('[Yjs Provider] Sent initial state update.');
      } else {
        console.error('[Yjs Provider] WebSocket not open when trying to send initial state.');
      }
    };

    socket.onmessage = (event: MessageEvent) => {
      console.log('[Yjs Provider] Received message from server.');
      if (event.data instanceof ArrayBuffer) {
        const update = new Uint8Array(event.data);
        console.log('[Yjs Provider] Applying received update:', update);
        // Apply the update received from the server to the local document
        // The third argument 'provider' is used to identify the origin of the update
        Y.applyUpdate(ydoc, update, 'websocketProvider');
      } else {
        console.warn('[Yjs Provider] Received non-binary message:', event.data);
        // Handle potential non-binary messages if needed (e.g., awareness)
        // TODO: Implement awareness handling here
      }
    };

    socket.onerror = (event: Event) => {
      console.error('[Yjs Provider] WebSocket error:', event);
      // Consider triggering reconnect here as well, depending on the error
    };

    socket.onclose = (event: CloseEvent) => {
      console.log(`[Yjs Provider] WebSocket connection closed (Code: ${event.code}, Reason: ${event.reason}).`);
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

  // --- Yjs Document Event Handler ---

  const ydocUpdateHandler = (update: Uint8Array, origin: any) => {
    // Only send updates that didn't originate from the WebSocket provider itself
    if (origin !== 'websocketProvider') {
      console.log('[Yjs Provider] Local Yjs update detected, sending to server:', update);
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(update);
      } else {
        console.warn('[Yjs Provider] WebSocket not open, unable to send update.');
        // Optionally queue updates if needed, but can get complex
      }
    } else {
      console.log('[Yjs Provider] Ignoring update originating from WebSocket.');
    }
  };

  // Listen for updates on the Yjs document
  ydoc.on('update', ydocUpdateHandler);

  // --- Disconnect Function ---
  const disconnect = () => {
    console.log('[Yjs Provider] Disconnecting...');
    explicitlyDisconnected = true; // Set flag to prevent automatic reconnect
    if (reconnectTimer) {
      clearTimeout(reconnectTimer); // Cancel any pending reconnect timer
      reconnectTimer = null;
    }
    ydoc.off('update', ydocUpdateHandler); // Stop listening to Yjs updates
    if (socket) {
      socket.close(); // Close the WebSocket connection
      socket = null;
    }
    console.log('[Yjs Provider] Disconnected.');
  };

  // Initial connection attempt
  setupWebSocket();

  // Return the document and the socket instance
  // Note: The socket might be null initially or during reconnect attempts.
  // Consumers should check socket.readyState before sending messages directly.
  // However, sending Yjs updates is handled internally.
  return {
    ydoc,
    // We return a getter for the socket to ensure consumers always get the current instance
    get socket() {
      return socket!; // Use non-null assertion, assuming it will be initialized
    },
    disconnect,
  };
}
