import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

// Configuration (consider moving to environment variables or config file)
// Node.js backend runs on localhost:8000 by default
const WEBSOCKET_ENDPOINT = 'ws://localhost:8000/ws/whiteboard/';

let ydoc = null;
let provider = null;
let awareness = null;

/**
 * Initializes the Yjs document and WebSocket provider for a given room.
 * @param {string} roomId The unique identifier for the whiteboard room.
 * @param {object} [options] Optional configuration for the provider.
 * @param {string} [options.username] Display name for the current user.
 */
export function initYjs(roomId, options = {}) {
  if (provider) {
    // If already connected, disconnect the old provider first
    // This might happen if the user switches rooms without a full page reload
    console.warn('Disconnecting existing Yjs provider before initializing a new one.');
    destroyYjs();
  }

  if (!roomId) {
    console.error('Room ID is required to initialize Yjs connection.');
    return null;
  }

  // Create a new Yjs document
  ydoc = new Y.Doc();

  // Create a WebSocket provider
  // It connects to the backend and syncs the document
  // The WebsocketProvider constructor likely appends the roomName (roomId) to the base URL.
  // So, we provide only the base endpoint here.
  const baseWsUrl = WEBSOCKET_ENDPOINT; // e.g., ws://localhost:8000/ws/whiteboard/
  console.log(`Initializing Yjs WebSocket provider for room: ${roomId} at endpoint: ${baseWsUrl}`);

  provider = new WebsocketProvider(
    baseWsUrl, // Use the base URL without roomId and trailing slash if provider adds it
    roomId,    // The provider should append this room name
    ydoc,
    {
      // You can pass provider options here if needed
      // connect: true, // Auto-connect is default
      // params: { auth: 'your-auth-token' } // Example for auth
    }
  );

  // Get the awareness protocol instance for presence information (cursors, names)
  awareness = provider.awareness;

  // Set initial local awareness state (e.g., username)
  if (options.username) {
    awareness.setLocalStateField('user', {
      name: options.username,
      // You can add color or other user-specific info here
      // color: '#ff0000',
    });
  }

  // Optional: Listen to connection events
  provider.on('status', event => {
    console.log(`Yjs WebSocket status: ${event.status}`); // e.g. "connected", "disconnected"
    // You could potentially trigger UI updates based on status here
  });

  provider.on('sync', isSynced => {
    console.log(`Yjs document ${isSynced ? 'synced' : 'syncing...'}`);
    // Called when the document is initially synced with the server
  });

  // Handle connection errors
  provider.on('connection-error', (event) => {
    console.error('Yjs WebSocket connection error:', event);
    // Potentially show an error message to the user
  });

  // Expose the instances
  return { ydoc, provider, awareness };
}

/**
 * Destroys the current Yjs provider and document instance.
 * Call this when the component unmounts or the user leaves the room.
 */
export function destroyYjs() {
  if (awareness) {
    awareness.destroy();
    awareness = null;
    console.log('Yjs awareness destroyed.');
  }
  if (provider) {
    provider.disconnect();
    provider.destroy(); // Ensure provider resources are cleaned up
    provider = null;
    console.log('Yjs WebSocket provider disconnected and destroyed.');
  }
  if (ydoc) {
    // Optional: Depending on lifecycle, you might want to keep the doc
    // ydoc.destroy(); // Use if you are sure the doc is no longer needed anywhere
    ydoc = null; // For now, just nullify the reference
    console.log('Yjs document reference removed.');
  }
}

/**
 * Returns the current Yjs instances.
 * Make sure initYjs has been called first.
 */
export function getYjsInstances() {
  if (!ydoc || !provider || !awareness) {
    console.warn('Yjs has not been initialized. Call initYjs first.');
    // Optionally, attempt initialization with a default room?
    // return initYjs('default_room');
    return null;
  }
  return { ydoc, provider, awareness };
}

// Example of how to get shared data types from the document:
// const yElements = ydoc.getArray('elements'); // For storing whiteboard elements
// const yMap = ydoc.getMap('settings'); // For shared settings
