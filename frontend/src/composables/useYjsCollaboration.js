// frontend/src/composables/useYjsCollaboration.js
import { ref, onUnmounted, nextTick, shallowRef } from 'vue';
import * as Y from 'yjs';
import { connectToYjs as connectYjsProvider } from '../services/connectToYjs'; // Assuming this handles the provider connection
import { undoRedoState } from '../utils/undoRedoState';
// import { showToast } from '../utils/notifications'; // Inject a shared notifier when available

// Placeholder for showToast if not passed or imported
const showToast = (message, type) => {
  console.log(`[Toast-${type}] ${message}`);
};

export function useYjsCollaboration(roomId) {
  const yjsConnection = shallowRef(null); // Use shallowRef for complex external objects
  const ydoc = shallowRef(null);
  const yDrawings = shallowRef(null);
  const awareness = shallowRef(null);
  const undoManager = shallowRef(null);

  const isConnected = ref(false);
  const canUndo = ref(false);
  const canRedo = ref(false);
  const localClientId = ref(null);

  // Function to update global and local undo/redo state
  const updateUndoRedoState = () => {
    if (undoManager.value) {
      const hasUndo = undoManager.value.canUndo();
      const hasRedo = undoManager.value.canRedo();
      canUndo.value = hasUndo;
      canRedo.value = hasRedo;
      undoRedoState.update(hasUndo, hasRedo);
      // console.log(`[useYjs] UndoManager state: canUndo=${hasUndo}, canRedo=${hasRedo}`);
    } else {
      canUndo.value = false;
      canRedo.value = false;
      undoRedoState.update(false, false);
    }
  };

  // Initialize UndoManager
  const initializeUndoManager = () => {
    // console.log("[useYjs] Initializing UndoManager...");
    if (undoManager.value) {
      try {
        // Clean up previous listeners before destroying
        undoManager.value.off('stack-item-added', updateUndoRedoState);
        undoManager.value.off('stack-item-popped', updateUndoRedoState);
        undoManager.value.destroy();
      } catch (e) {
        console.error("Error cleaning up previous UndoManager:", e);
      }
      undoManager.value = null;
    }

    if (!ydoc.value || !yDrawings.value) {
      console.error("useYjsCollaboration: Cannot initialize UndoManager without ydoc or yDrawings");
      return;
    }

    // console.log("[useYjs] Creating new UndoManager instance.");
    undoManager.value = new Y.UndoManager(yDrawings.value, {
      // Define specific origins for undo/redo tracking
      trackedOrigins: new Set([
          null, // Default transactions
          undefined, // Also handle undefined origin
          'local-drawing', // Pen, shapes, lines
          'local-erase',   // Eraser tool
          'local-clear',   // Clear canvas action
          'local-text',    // Adding text element
          'local-image',   // Adding image element (from paste or import)
          'local-plot',    // Adding math/physics plots
          'local-coordsys' // Adding coordinate systems
        ])
    });

    undoManager.value.on('stack-item-added', updateUndoRedoState);
    undoManager.value.on('stack-item-popped', updateUndoRedoState);

    updateUndoRedoState(); // Initial state check
    // console.log("[useYjs] UndoManager initialized.");
  };

  // Yjs update handler (kept for potential future use, but redraw is handled by component watcher)
  const handleYjsUpdate = (events, transaction) => {
    // console.log(`[useYjs] Yjs update detected. Origin: ${transaction.origin || 'unspecified'}`);
    // Redrawing will be handled by the component watching yDrawings
  };

  // Connect function
  const connect = () => {
    if (!roomId) {
      showToast("Room ID missing. Collaboration disabled.", "error");
      console.error("useYjsCollaboration: 'roomId' is required to connect.");
      return;
    }
    if (isConnected.value) {
      console.warn("useYjsCollaboration: Already connected.");
      return;
    }

    try {
      // console.log(`[useYjs] Connecting to Yjs room: ${roomId}`);
      const connection = connectYjsProvider(roomId);
      yjsConnection.value = connection;
      ydoc.value = connection.ydoc;
      yDrawings.value = connection.yDrawings; // This should be the Y.Array
      awareness.value = connection.awareness;

      if (!ydoc.value || !yDrawings.value || !awareness.value) {
        throw new Error("Yjs connection failed to provide ydoc, yDrawings, or awareness.");
      }

      localClientId.value = awareness.value.clientID;
      isConnected.value = true;
      // console.log("[useYjs] Connection established. yDrawings length:", yDrawings.value.length);

      // The component using this composable should observe yDrawings for redraws
      // Example: watch(yDrawings, redrawCanvas, { deep: true });

      // Initialize UndoManager after connection and yDrawings is available
      setTimeout(() => {
        initializeUndoManager();
      }, 150);

    } catch (error) {
      console.error("useYjsCollaboration: Failed to connect Yjs provider:", error);
      showToast("Error connecting to collaboration session.", "error");
      isConnected.value = false;
      // Reset refs on failure
      yjsConnection.value = null;
      ydoc.value = null;
      yDrawings.value = null;
      awareness.value = null;
      undoManager.value = null;
    }
  };

  // Disconnect function
  const disconnect = () => {
    // console.log("[useYjs] Disconnecting...");
    if (awareness.value) {
        // Clear local state before destroying awareness
        awareness.value.setLocalState(null);
        awareness.value.destroy();
        awareness.value = null;
    }
    if (undoManager.value) {
      undoManager.value.off('stack-item-added', updateUndoRedoState);
      undoManager.value.off('stack-item-popped', updateUndoRedoState);
      undoManager.value.destroy();
      undoManager.value = null;
      // console.log('[useYjs] UndoManager destroyed');
    }
    // No need to unobserve yDrawings here, the watcher in the component will handle it

    if (yjsConnection.value) {
      yjsConnection.value.disconnect(); // Assuming the provider has a disconnect method
      yjsConnection.value = null;
    }
     if (ydoc.value) {
        // ydoc.value.destroy(); // Destroying ydoc might be too aggressive if shared
        ydoc.value = null;
    }


    isConnected.value = false;
    canUndo.value = false;
    canRedo.value = false;
    localClientId.value = null;
    // console.log("[useYjs] Disconnected.");
  };

  // Undo/Redo methods
  const undo = () => {
    // console.log("[useYjs] Attempting Undo...");
    if (undoManager.value && undoManager.value.canUndo()) {
      undoManager.value.undo();
      // console.log("[useYjs] Undo performed.");
      // State update is handled by the 'stack-item-popped' listener
    } else {
      // console.log("[useYjs] Cannot Undo.");
    }
  };

  const redo = () => {
    // console.log("[useYjs] Attempting Redo...");
    if (undoManager.value && undoManager.value.canRedo()) {
      undoManager.value.redo();
      // console.log("[useYjs] Redo performed.");
      // State update is handled by the 'stack-item-added' listener
    } else {
      // console.log("[useYjs] Cannot Redo.");
    }
  };

  // --- Element Manipulation Abstractions ---

  const performTransaction = (action, origin) => {
    if (!ydoc.value || !yDrawings.value) {
      console.error(`[useYjs] Cannot perform ${origin} action: ydoc or yDrawings not available.`);
      showToast(`Error performing action: ${origin}`, "error");
      return;
    }
    try {
      // Pass the origin to the transaction
      ydoc.value.transact(action, origin);
      // Update undo/redo state immediately after transaction
      // Use nextTick to ensure Yjs state propagation before update check
      nextTick(() => {
        updateUndoRedoState();
      });
    } catch (error) {
      console.error(`[useYjs] Error during ${origin} transaction:`, error);
      showToast(`Error saving element (${origin})`, "error");
    }
  };

  const addElement = (elementData, origin = 'local-drawing') => {
    performTransaction(() => {
      const yElementMap = new Y.Map();
      for (const [key, value] of Object.entries(elementData)) {
        // Convert nested objects (like position, start, end) to Y.Map
        if (key !== 'points' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
          const nestedMap = new Y.Map();
          for (const [nestedKey, nestedValue] of Object.entries(value)) {
            nestedMap.set(nestedKey, nestedValue);
          }
          yElementMap.set(key, nestedMap);
        } else {
          // Keep arrays (like 'points') as plain arrays
          // Keep primitives as they are
          yElementMap.set(key, value);
        }
      }
      yDrawings.value.push([yElementMap]);
      // console.log(`[useYjs:addElement:${origin}] Pushed element:`, JSON.stringify(yElementMap.toJSON()));
    }, origin);
  };

  const deleteElement = (index, origin = 'local-erase') => {
    performTransaction(() => {
      if (index >= 0 && index < yDrawings.value.length) {
        // console.log(`[useYjs:deleteElement:${origin}] Deleting element at index: ${index}`);
        yDrawings.value.delete(index, 1);
      } else {
        console.warn(`[useYjs:deleteElement:${origin}] Invalid index: ${index}`);
      }
    }, origin);
  };

  const clearAllElements = (origin = 'local-clear') => {
    performTransaction(() => {
      const len = yDrawings.value.length;
      if (len > 0) {
        // console.log(`[useYjs:clearAllElements:${origin}] Clearing ${len} elements.`);
        yDrawings.value.delete(0, len);
      }
    }, origin);
  };

  // --- Awareness ---
   const updateAwarenessCursor = (cursorData) => {
     if (awareness.value && isConnected.value) {
       awareness.value.setLocalStateField('cursor', cursorData);
     }
   };

   const setAwarenessUserDetails = (userDetails) => {
     if (awareness.value && isConnected.value) {
       awareness.value.setLocalStateField('user', userDetails);
     }
   };


  // Lifecycle hook
  onUnmounted(() => {
    disconnect();
  });

  // Return reactive state and methods
  return {
    // State
    isConnected,
    yDrawings, // Expose the Y.Array directly for watching
    awareness, // Expose awareness for Collaborators component
    canUndo,
    canRedo,
    localClientId,

    // Methods
    connect,
    disconnect,
    undo,
    redo,
    addElement,
    deleteElement,
    clearAllElements,
    updateAwarenessCursor,
    setAwarenessUserDetails,
  };
}
