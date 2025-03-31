<template>
  <div class="whiteboard-container" :class="{ 'dark-mode': darkMode }">
    <canvas
      ref="canvas"
      :width="canvasWidth"
      :height="canvasHeight"
      class="whiteboard-canvas"
      @mousedown="handleMouseDown"
      @mousemove="handleMouseMove"
      @mouseup="handleMouseUp"
      @mouseleave="handleMouseLeave"
      @wheel="handleZoom"
      @contextmenu.prevent
      @touchstart="handleTouchStart"
      @touchmove="handleTouchMove"
      @touchend="handleTouchEnd"
      @touchcancel="handleTouchEnd"
    ></canvas>

    <!-- Cursor overlays for other users -->
    <Collaborators
      v-if="yjsConnection?.awareness"
      ref="collaborators"
      :awareness="yjsConnection.awareness"
      :zoom-level="zoomLevel"
      :pan-offset="panOffset"
      :local-client-id="yjsConnection.awareness.clientID"
    />

    <!-- Zoom and pan controls -->
    <ZoomPanControls
      :zoomLevel="zoomLevel"
      @zoom-in="zoomIn"
      @zoom-out="zoomOut"
      @reset-zoom="resetZoom"
    />

    <!-- Eraser mode controls (Keep if eraser logic remains local or adapted) -->
    <EraserModeControls
      v-if="currentTool === 'eraser'"
      :mode="eraserMode"
      @update:mode="setEraserMode"
    />

    <!-- Status message -->
    <StatusMessage :message="statusMessage" />

    <!-- Clipboard handler (Keep for paste functionality) -->
    <input
      ref="clipboardInput"
      type="text"
      class="clipboard-input"
      @paste="handlePaste"
    />

    <!-- Toast powiadomień -->
    <div class="notifications">
      <transition-group name="fade">
        <div
          v-for="notification in notifications"
          :key="notification.id"
          class="notification"
          :class="notification.type"
        >
          {{ notification.message }}
        </div>
      </transition-group>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'; // Removed computed as yDrawings is now a direct ref
import * as Y from 'yjs';
// import { v4 as uuidv4 } from 'uuid'; // Use Yjs mechanisms for IDs if possible
import Collaborators from './Collaborators.vue';
import ZoomPanControls from './ZoomPanControls.vue';
import EraserModeControls from './EraserModeControls.vue';
import StatusMessage from './StatusMessage.vue';
import { connectToYjs } from '../services/connectToYjs'; // Import the new provider
import { drawElement, throttle, isPointInElement, distanceToSegment } from '../utils/canvasDrawing.js';
import { createNewElement, createTextElement, createImageElement, getCursorStyle } from '../utils/canvasTools.js'; // Adapt these for Yjs maps
import { drawGrid } from '../utils/canvasGrid.js';

// Debounce function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}


export default {
  name: 'WhiteboardCanvas',
  components: {
    Collaborators,
    ZoomPanControls,
    EraserModeControls,
    StatusMessage,
  },
  props: {
    // Removed ydoc and awareness props - connection handled internally now
    debugMode: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['state-updated'], // Keep for now if needed by parent for autosave/export trigger

  setup(props, { emit }) {
    const canvas = ref(null);
    const context = ref(null);
    const canvasWidth = ref(1200);
    const canvasHeight = ref(800);
    const isDrawing = ref(false);
    const currentTool = ref('pen');
    const currentColor = ref('#000000');
    const currentLineWidth = ref(2);
    const zoomLevel = ref(1);
    const panOffset = ref({ x: 0, y: 0 });
    const isPanning = ref(false);
    const lastPanPoint = ref(null);
    const statusMessage = ref('');
    const statusTimeout = ref(null);
    const darkMode = ref(false);
    const eraserMode = ref('erase');
    const lastReleasedElementIndex = ref(-1); // Keep for delete mode highlight? Needs Yjs adaptation.
    const currentElementPreview = ref(null); // For drawing preview
    const pointsBuffer = ref([]); // For smoothing preview
    const smoothingFactor = ref(0.2);
    const notifications = ref([]);
    const notificationId = ref(0);
    const clipboardInput = ref(null); // Ref for clipboard input

    // --- Yjs specific state (managed internally) ---
    const yjsConnection = ref(null); // Stores the connection object { ydoc, socket, yDrawings, disconnect }
    const ydoc = ref(null); // Y.Doc instance from the provider
    const yDrawings = ref(null); // Y.Array for drawings from the provider
    // Awareness will be handled later via yjsConnection if needed

    // --- Local component state ---
    // const localAwarenessState = ref({}); // Awareness state is not handled by this provider yet

    // --- Methods ---

    const redrawCanvas = () => {
      // Use the local yDrawings ref
      if (!context.value || !yDrawings.value) return;

      const ctx = context.value;
      ctx.clearRect(0, 0, canvasWidth.value, canvasHeight.value);
      drawGrid(ctx, zoomLevel.value, panOffset.value, canvasWidth.value, canvasHeight.value, darkMode.value);

      ctx.save();
      ctx.setTransform(
        zoomLevel.value, 0,
        0, zoomLevel.value,
        panOffset.value.x, panOffset.value.y
      );

      // Draw elements from Yjs array (now yDrawings)
      yDrawings.value.forEach((elementMap, index) => {
        // Convert Y.Map to plain JS object for drawing function
        const element = elementMap.toJSON();
        // TODO: Adapt highlighting logic if needed for delete mode
        const isHighlighted = false; // index === lastReleasedElementIndex.value;
        drawElement(ctx, element, isHighlighted, smoothingFactor.value);
      });

      // Draw the preview of the element currently being drawn
      if (isDrawing.value && currentElementPreview.value) {
        drawElement(ctx, currentElementPreview.value, false, smoothingFactor.value);
      }

      ctx.restore();

      // Emit state update if needed (e.g., for autosave trigger)
      // emit('state-updated', {}); // Pass relevant info if needed
    };

    // Debounced redraw for performance during rapid updates
    const debouncedRedraw = debounce(redrawCanvas, 16); // ~60fps

    const handleYjsUpdate = (events, transaction) => { // Y.Array observeDeep provides events and transaction
      // Check if the update originated locally (optional, provider handles echo prevention)
      // if (transaction.local) return;

      // Redraw whenever the shared array changes
      console.log(`Yjs update detected for drawings. yDrawings length: ${yDrawings.value?.length || 0}. Redrawing.`);
      debouncedRedraw();

      // Trigger state update for parent if needed
      emit('state-updated', {});
    };

    const initCanvas = () => {
      if (!canvas.value) return;
      context.value = canvas.value.getContext('2d');
      context.value.lineCap = 'round';
      context.value.lineJoin = 'round';
      context.value.strokeStyle = currentColor.value;
      context.value.lineWidth = currentLineWidth.value;
      darkMode.value = document.body.classList.contains('dark-mode');
      redrawCanvas();
      updateCursor();
      nextTick(() => {
        if (clipboardInput.value) clipboardInput.value.focus();
      });
    };

    const initClipboardHandler = () => {
      document.addEventListener('click', () => {
        if (clipboardInput.value) clipboardInput.value.focus();
      });
    };

    const handleResize = () => {
      const container = canvas.value?.parentElement;
      if (container) {
        canvasWidth.value = container.clientWidth;
        canvasHeight.value = container.clientHeight;
        nextTick(() => { // Ensure DOM updates before redraw
           if (canvas.value) {
             canvas.value.width = canvasWidth.value;
             canvas.value.height = canvasHeight.value;
           }
           redrawCanvas();
        });
      }
    };

    const handleDarkModeChange = () => {
       const newDarkMode = document.body.classList.contains('dark-mode');
       if (darkMode.value !== newDarkMode) {
         darkMode.value = newDarkMode;
         redrawCanvas();
       }
    };

    const darkModeObserver = new MutationObserver(handleDarkModeChange);

    onMounted(() => {
      initCanvas();
      initClipboardHandler();
      window.addEventListener('resize', handleResize);
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('paste', handlePaste); // Keep global paste listener
      darkModeObserver.observe(document.body, { attributes: true });
      handleResize(); // Initial size calculation

      // --- Yjs Setup ---
      const urlParams = new URLSearchParams(window.location.search);
      const roomId = urlParams.get('room');

      if (roomId) {
        try {
          const connection = connectToYjs(roomId);
          yjsConnection.value = connection;
          ydoc.value = connection.ydoc;
          yDrawings.value = connection.yDrawings;

          // Observe the shared drawings array for changes
          yDrawings.value.observeDeep(handleYjsUpdate);

          // Initial draw based on Yjs state
          redrawCanvas();

          // TODO: Setup awareness handling here when implemented in the provider
          // Example: setupAwareness(connection.ydoc, connection.socket);

        } catch (error) {
          console.error("Failed to connect Yjs provider:", error);
          showToast("Error connecting to collaboration session.", "error");
        }
      } else {
        console.error("WhiteboardCanvas: 'room' parameter missing in URL!");
        showToast("Room ID missing. Collaboration disabled.", "error");
      }
    });

    onBeforeUnmount(() => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('paste', handlePaste);
      darkModeObserver.disconnect();

      // --- Yjs Cleanup ---
      // Unobserve before disconnecting
      yDrawings.value?.unobserveDeep(handleYjsUpdate);
      // Disconnect the WebSocket connection
      yjsConnection.value?.disconnect();
      // TODO: Cleanup awareness handling here
    });

    // --- Input Handlers ---

    const getCoordinates = (event) => {
      if (!canvas.value) return { offsetX: 0, offsetY: 0 };
      const rect = canvas.value.getBoundingClientRect();
      if (event.touches && event.touches[0]) {
        return {
          offsetX: event.touches[0].clientX - rect.left,
          offsetY: event.touches[0].clientY - rect.top
        };
      }
      return {
        offsetX: event.clientX - rect.left, // Use clientX/Y for consistency
        offsetY: event.clientY - rect.top
      };
    };

    const transformCoordinates = (x, y) => {
      return {
        x: (x - panOffset.value.x) / zoomLevel.value,
        y: (y - panOffset.value.y) / zoomLevel.value
      };
    };

    const updateLocalAwarenessCursor = throttle((coords) => {
        if (yjsConnection.value?.awareness) { // Check if awareness exists
            // Also send user info if available (example)
            const userState = yjsConnection.value.awareness.getLocalState()?.user || { name: 'Anonymous', color: '#000000' };
            yjsConnection.value.awareness.setLocalStateField('cursor', {
                x: coords.x,
                y: coords.y,
            });
             // Keep user info when updating cursor
            yjsConnection.value.awareness.setLocalStateField('user', userState);
        }
    }, 50); // Throttle cursor updates

    const handleMouseMove = (e) => {
      const coords = getCoordinates(e);
      const transformedCoords = transformCoordinates(coords.offsetX, coords.offsetY);

      // Update local awareness state (cursor position)
      updateLocalAwarenessCursor(transformedCoords);

      if (isPanning.value && lastPanPoint.value) {
        const currentPanPoint = transformCoordinates(coords.offsetX, coords.offsetY);
        panOffset.value.x += coords.offsetX - lastPanPoint.value.screenX;
        panOffset.value.y += coords.offsetY - lastPanPoint.value.screenY;
        lastPanPoint.value = { ...currentPanPoint, screenX: coords.offsetX, screenY: coords.offsetY };
        redrawCanvas();
        return;
      }

      if (isDrawing.value) {
        draw(transformedCoords);
      }
      // TODO: Adapt highlight logic for delete mode if kept
    };

    const handleMouseDown = (event) => {
      if (event.button === 1 || (event.button === 0 && event.altKey)) { // Middle or Alt+Left
        isPanning.value = true;
        const coords = getCoordinates(event);
        lastPanPoint.value = { ...transformCoordinates(coords.offsetX, coords.offsetY), screenX: coords.offsetX, screenY: coords.offsetY };
        event.preventDefault();
        return;
      }
      if (event.button === 0) { // Left click
        startDrawing(event);
      }
    };

    const handleMouseUp = (event) => {
      if (isPanning.value) {
        isPanning.value = false;
        lastPanPoint.value = null;
        return;
      }
      if (isDrawing.value) {
        finishDrawing();
      }
      // TODO: Adapt delete logic if kept
    };

    const handleMouseLeave = (event) => {
      if (isPanning.value) {
        isPanning.value = false;
        lastPanPoint.value = null;
      }
      if (isDrawing.value) {
        finishDrawing(); // Finish drawing if mouse leaves canvas
      }
       // Clear local awareness cursor when mouse leaves
       if (yjsConnection.value?.awareness) {
           yjsConnection.value.awareness.setLocalStateField('cursor', null);
           // Keep user info even when cursor is null
           const userState = yjsConnection.value.awareness.getLocalState()?.user;
           if (userState) {
               yjsConnection.value.awareness.setLocalStateField('user', userState);
           }
       }
    };

     // --- Touch Handlers ---
    const handleTouchStart = (event) => {
        if (event.touches.length === 1) {
            // Prevent default scroll/zoom behavior
            event.preventDefault();
            startDrawing(event.touches[0]);
        }
        // Handle panning with two fingers? (More complex)
    };

    const handleTouchMove = (event) => {
        if (event.touches.length === 1) {
            // Prevent default scroll/zoom behavior
            event.preventDefault();
            const coords = getCoordinates(event);
            const transformedCoords = transformCoordinates(coords.offsetX, coords.offsetY);
            updateLocalAwarenessCursor(transformedCoords); // Update cursor for touch

            if (isDrawing.value) {
                draw(transformedCoords);
            }
        }
    };

    const handleTouchEnd = (event) => {
        // Prevent default behaviors
        event.preventDefault();
        if (isDrawing.value) {
            finishDrawing();
        }
         // Clear local awareness cursor on touch end
        if (yjsConnection.value?.awareness) {
            yjsConnection.value.awareness.setLocalStateField('cursor', null);
            // Keep user info even when cursor is null
            const userState = yjsConnection.value.awareness.getLocalState()?.user;
            if (userState) {
                yjsConnection.value.awareness.setLocalStateField('user', userState);
            }
        }
    };


    // --- Drawing Logic (Yjs Integration) ---

    const startDrawing = (event) => {
      // Use local ydoc ref
      if (!ydoc.value) return;
      isDrawing.value = true;
      const coords = getCoordinates(event);
      const transformedCoords = transformCoordinates(coords.offsetX, coords.offsetY);
      pointsBuffer.value = []; // Reset points buffer

      // Create a preview element locally, don't add to Yjs yet
      currentElementPreview.value = createNewElement(
        currentTool.value,
        transformedCoords,
        currentColor.value,
        currentLineWidth.value
      );
      // Use the clientID from the connection's awareness object
      const localClientId = yjsConnection.value?.awareness?.clientID || 'unknown';
      currentElementPreview.value.id = `temp_${localClientId}_${Date.now()}`; // Temporary ID

      // Special handling for text tool
      if (currentTool.value === 'text') {
        const text = prompt('Enter text:', '');
        if (text) {
          const textElementData = createTextElement(
            transformedCoords,
            text,
            currentColor.value,
        currentLineWidth.value * 10 // Example size calculation
      );
      // Add directly to Yjs within a transaction using local ydoc and yDrawings
      ydoc.value.transact(() => {
        yDrawings.value.push([new Y.Map(Object.entries(textElementData))]);
      });
    }
    isDrawing.value = false; // Text is added immediately
        currentElementPreview.value = null;
      }
    };

    const draw = (coords) => {
      if (!isDrawing.value || !currentElementPreview.value) return;

      switch (currentTool.value) {
        case 'pen':
        case 'eraser': // Eraser might need different logic (modifying existing elements or using blend modes)
          currentElementPreview.value.points.push(coords);
          pointsBuffer.value.push(coords);
          if (pointsBuffer.value.length > 3) pointsBuffer.value.shift();
          redrawCanvas(); // Redraw for preview
          break;
        case 'line':
        case 'rectangle':
        case 'circle':
          currentElementPreview.value.end = coords;
          redrawCanvas(); // Redraw for preview
          break;
      }
    };

    const finishDrawing = () => {
      // Use local ydoc and yDrawings refs
      if (!isDrawing.value || !currentElementPreview.value || !ydoc.value || !yDrawings.value) return;
      isDrawing.value = false;

      let elementToAdd = null;
      const preview = currentElementPreview.value;

      // Finalize element data and check if it's valid to add
      switch (preview.type) {
        case 'pen':
        case 'eraser':
          if (preview.points && preview.points.length > 1) {
            elementToAdd = { ...preview };
          }
          break;
        case 'line':
        case 'rectangle':
        case 'circle':
          if (preview.start.x !== preview.end.x || preview.start.y !== preview.end.y) {
             elementToAdd = { ...preview };
          }
          break;
      }

      // Add the finalized element to Yjs within a transaction
      if (elementToAdd) {
         // Assign a permanent ID (optional, Yjs handles object identity)
         // elementToAdd.id = `elem_${props.awareness.clientID}_${Date.now()}`;
         // Assign a permanent ID (optional, Yjs handles object identity)
         // elementToAdd.id = `elem_${props.awareness.clientID}_${Date.now()}`;
         delete elementToAdd.id; // Remove temporary ID
         console.log('Adding element to Yjs drawings array:', JSON.stringify(elementToAdd)); // Log element being added

         // Use local ydoc and yDrawings
         ydoc.value.transact(() => {
           yDrawings.value.push([new Y.Map(Object.entries(elementToAdd))]);
         });
      }

      currentElementPreview.value = null;
      pointsBuffer.value = [];
      redrawCanvas(); // Redraw final state
    };

    // --- Tool and Style Setters ---
    const setTool = (tool) => { currentTool.value = tool; updateCursor(); };
    const setColor = (color) => { currentColor.value = color; updateCursor(); };
    const setLineWidth = (width) => { currentLineWidth.value = Number(width) || 2; updateCursor(); };
    const setEraserMode = (mode) => { eraserMode.value = mode; updateCursor(); };

    const updateCursor = () => {
      if (canvas.value) {
        canvas.value.style.cursor = getCursorStyle(currentTool.value, currentColor.value, eraserMode.value);
      }
    };

    // --- Zoom/Pan ---
    const handleZoom = (event) => {
      event.preventDefault();
      if (!canvas.value) return;
      const rect = canvas.value.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      const delta = event.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = Math.max(0.1, Math.min(5, zoomLevel.value * delta));
      const zoomRatio = newZoom / zoomLevel.value;

      panOffset.value.x = mouseX - (mouseX - panOffset.value.x) * zoomRatio;
      panOffset.value.y = mouseY - (mouseY - panOffset.value.y) * zoomRatio;
      zoomLevel.value = newZoom;
      redrawCanvas();
      showStatus(`Zoom: ${Math.round(zoomLevel.value * 100)}%`);
    };
    const zoomIn = () => {
        const prevZoom = zoomLevel.value;
        zoomLevel.value = Math.min(5, zoomLevel.value * 1.2);
        const centerX = canvasWidth.value / 2;
        const centerY = canvasHeight.value / 2;
        const zoomRatio = zoomLevel.value / prevZoom;
        panOffset.value.x = centerX - (centerX - panOffset.value.x) * zoomRatio;
        panOffset.value.y = centerY - (centerY - panOffset.value.y) * zoomRatio;
        redrawCanvas();
        // showStatus(`Zoom: ${Math.round(zoomLevel.value * 100)}%`); // Reduce status spam
    };
    const zoomOut = () => {
        const prevZoom = zoomLevel.value;
        zoomLevel.value = Math.max(0.1, zoomLevel.value / 1.2);
        const centerX = canvasWidth.value / 2;
        const centerY = canvasHeight.value / 2;
        const zoomRatio = zoomLevel.value / prevZoom;
        panOffset.value.x = centerX - (centerX - panOffset.value.x) * zoomRatio;
        panOffset.value.y = centerY - (centerY - panOffset.value.y) * zoomRatio;
        redrawCanvas();
        // showStatus(`Zoom: ${Math.round(zoomLevel.value * 100)}%`); // Reduce status spam
    };
    const resetZoom = () => {
        zoomLevel.value = 1;
        panOffset.value = { x: 0, y: 0 };
        redrawCanvas();
        // showStatus('View reset'); // Reduce status spam
    };

    // --- Other Actions ---
    const handleKeyDown = (event) => {
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
      // Basic tool shortcuts (adapt as needed)
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        switch (event.key.toLowerCase()) {
          case 'p': setTool('pen'); break;
          case 'e': setTool('eraser'); break;
          case 'l': setTool('line'); break;
          // Add other tool shortcuts
        }
      }
      // Undo/Redo shortcuts are typically handled by UndoManager listener in Toolbar/App
    };

    const handlePaste = (event) => {
       event.preventDefault();
       const items = (event.clipboardData || window.clipboardData).items;
       // Use local ydoc ref
       if (!items || !ydoc.value) return;

       for (let i = 0; i < items.length; i++) {
         if (items[i].type.indexOf('image') !== -1) {
           const blob = items[i].getAsFile();
           const reader = new FileReader();
           reader.onload = (e) => addImageFromDataUrl(e.target.result); // Add image via Yjs
           reader.readAsDataURL(blob);
           return; // Handle first image found
         }
       }

       const text = (event.clipboardData || window.clipboardData).getData('text');
       if (text) {
         const centerX = (canvasWidth.value / 2 - panOffset.value.x) / zoomLevel.value;
         const centerY = (canvasHeight.value / 2 - panOffset.value.y) / zoomLevel.value;
         addTextElement({ x: centerX, y: centerY }, text); // Add text via Yjs
       }
    };

    const addImageFromDataUrl = (dataUrl) => {
        // Use local ydoc and yDrawings refs
        if (!ydoc.value || !yDrawings.value) return;
        const centerX = (canvasWidth.value / 2 - panOffset.value.x) / zoomLevel.value;
        const centerY = (canvasHeight.value / 2 - panOffset.value.y) / zoomLevel.value;
        createImageElement(dataUrl, centerX, centerY).then(imageData => {
            ydoc.value.transact(() => {
                yDrawings.value.push([new Y.Map(Object.entries(imageData))]);
            });
        });
    };

     const addTextElement = (position, text) => {
        // Use local ydoc and yDrawings refs
        if (!ydoc.value || !yDrawings.value || !text) return;
        const textElementData = createTextElement(
            position,
            text,
            currentColor.value,
            currentLineWidth.value * 10 // Example size
        );
        ydoc.value.transact(() => {
            yDrawings.value.push([new Y.Map(Object.entries(textElementData))]);
        });
    };


    // --- Status & Notifications ---
    const showStatus = (message, duration = 2000) => {
      statusMessage.value = message;
      if (statusTimeout.value) clearTimeout(statusTimeout.value);
      statusTimeout.value = setTimeout(() => { statusMessage.value = ''; }, duration);
    };

    const showToast = (message, type = 'default', duration = 3000) => {
      const id = ++notificationId.value;
      notifications.value.push({ id, message, type });
      setTimeout(() => {
        notifications.value = notifications.value.filter(n => n.id !== id);
      }, duration);
    };

    // --- Public methods exposed via ref ---
    // (These might be called by parent or Toolbar)
    const clearCanvas = () => { // Called by App.vue via ref
        // Use local ydoc and yDrawings refs
        if (ydoc.value && yDrawings.value && confirm('Are you sure you want to clear the canvas?')) {
            ydoc.value.transact(() => {
                // Clear the drawings array
                while (yDrawings.value.length > 0) {
                    yDrawings.value.delete(0);
                }
            });
            showStatus('Canvas cleared');
        }
    };
    const undo = () => { /* Handled by UndoManager */ };
    const redo = () => { /* Handled by UndoManager */ };
    const getSerializableState = () => { /* Needs Yjs adaptation if still needed */ return {}; };
    const loadState = (state) => { /* Needs Yjs adaptation */ return false; };
    const exportAsText = () => { /* Needs Yjs adaptation */ return ''; };
    const importFromText = (text) => { /* Needs Yjs adaptation */ return false; };
    const toggleDebug = (enabled) => { /* Keep if needed */ };
    const getViewportCenter = () => ({
        x: (canvasWidth.value / 2 - panOffset.value.x) / zoomLevel.value,
        y: (canvasHeight.value / 2 - panOffset.value.y) / zoomLevel.value,
    });


    // --- Watchers ---
    // Removed watchers for props.ydoc and props.awareness as they are no longer props


    return {
      canvas,
      canvasWidth,
      canvasHeight,
      isDrawing,
      currentTool,
      currentColor,
      currentLineWidth,
      zoomLevel,
      panOffset,
      isPanning,
      lastPanPoint,
      statusMessage,
      darkMode,
      eraserMode,
      notifications,
      clipboardInput,
      yjsConnection, // Expose the connection object which contains awareness
      // Methods
      handleMouseDown,
      handleMouseMove,
      handleMouseUp,
      handleMouseLeave,
      handleZoom,
      handleKeyDown,
      handlePaste,
      handleResize,
      handleTouchStart,
      handleTouchMove,
      handleTouchEnd,
      zoomIn,
      zoomOut,
      resetZoom,
      setTool,
      setColor,
      setLineWidth,
      setEraserMode,
      showToast, // Expose for parent
      clearCanvas, // Expose for parent
      undo, // Expose for parent (delegates to UndoManager)
      redo, // Expose for parent (delegates to UndoManager)
      getSerializableState, // Expose if needed
      loadState, // Expose if needed
      exportAsText, // Expose if needed
      importFromText, // Expose if needed
      toggleDebug, // Expose for parent
      addImageFromDataUrl, // Expose if needed by parent/toolbar
      getViewportCenter, // Expose for image placement etc.
      redrawCanvas // Expose for parent (e.g., after theme change)
    };
  }
}
</script>

<style scoped>
.whiteboard-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: white;
  position: relative;
  flex: 1; /* Ensure it fills space if in flex container */
  cursor: crosshair; /* Default cursor */
}

.whiteboard-container.dark-mode {
  background-color: #1e1e1e; /* Darker background for dark mode */
}

.whiteboard-canvas {
  display: block; /* Remove extra space below canvas */
  width: 100%;
  height: 100%;
  /* Cursor is set dynamically via JS */
}

.clipboard-input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
  top: -100px;
  left: -100px; /* Position off-screen */
}

/* Styles for notifications container */
.notifications {
  position: fixed;
  bottom: 20px;
  left: 20px;
  z-index: 1050; /* Ensure notifications are above other elements */
  display: flex;
  flex-direction: column;
  gap: 10px; /* Space between notifications */
}

/* Individual notification style */
.notification {
  padding: 10px 15px;
  border-radius: 4px;
  color: #fff;
  font-size: 14px;
  box-shadow: 0 2px 5px rgba(0,0,0,0.2);
  transition: all 0.3s ease-in-out;
  opacity: 0.9;
}

.notification.default { background-color: #555; }
.notification.info { background-color: #2196F3; }
.notification.success { background-color: #4CAF50; }
.notification.warning { background-color: #FF9800; }
.notification.error { background-color: #F44336; }

/* Fade animation for notifications */
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.5s, transform 0.5s;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

</style>

<style>
/* Global toast styles (if not defined elsewhere) */
.toast {
  position: fixed;
  top: 20px;
  right: 20px;
  padding: 12px 20px;
  border-radius: 6px;
  background-color: #333;
  color: white;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
  z-index: 9999;
  font-size: 14px;
  opacity: 0;
  transform: translateY(-20px);
  transition: all 0.3s ease;
  max-width: 300px;
  text-align: center;
}

.toast.show {
  opacity: 1;
  transform: translateY(0);
}

.toast-default { background-color: #333; }
.toast-info { background-color: #2196F3; }
.toast-success { background-color: #4CAF50; }
.toast-warning { background-color: #FF9800; }
.toast-error { background-color: #F44336; }
</style>
