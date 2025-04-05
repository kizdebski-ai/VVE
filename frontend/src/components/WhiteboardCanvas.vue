<template>
  <div class="whiteboard-container" :class="{ 'dark-mode': darkMode }">
    <div v-if="debugMode" style="position: absolute; top: 5px; left: 5px; z-index: 9999; 
     background: rgba(0,0,0,0.7); color: white; padding: 5px; border-radius: 4px; font-size: 12px;">
  UndoManager: CanUndo={{canUndo}}, CanRedo={{canRedo}}
</div>
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

    <!-- Eraser mode controls -->
    <EraserModeControls
      v-if="currentTool === 'eraser'"
      :mode="eraserMode"
      @update:mode="setEraserMode"
    />

    <!-- Status message -->
    <StatusMessage :message="statusMessage" />

    <!-- Clipboard handler -->
    <input
      ref="clipboardInput"
      type="text"
      class="clipboard-input"
      @paste="handlePaste"
    />

    <!-- Toast notifications -->
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
    <button v-if="debugMode" 
      style="position: absolute; bottom: 10px; left: 10px; z-index: 9999; 
             background: #2196F3; color: white; border: none; padding: 5px 10px; 
             border-radius: 4px; cursor: pointer;"
      @click="testUndoManager">
      Test UndoManager
    </button>
  </div>
</template>

<script>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import * as Y from 'yjs';
// Removed explicit UndoManager import as it's part of Y.* now
import { undoRedoState } from '../utils/undoRedoState'; // 1. Add import
import Collaborators from './Collaborators.vue';
import ZoomPanControls from './ZoomPanControls.vue';
import EraserModeControls from './EraserModeControls.vue';
import StatusMessage from './StatusMessage.vue';
import { connectToYjs } from '../services/connectToYjs';
import { drawElement, throttle, isPointInElement, distanceToSegment } from '../utils/canvasDrawing.js';
import { createNewElement, createTextElement, createImageElement, getCursorStyle } from '../utils/canvasTools.js';
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
    roomId: { // 1. Add new prop
      type: String,
      required: true
    },
    debugMode: { type: Boolean, default: false },
    currentShape: { type: String, default: 'rectangle' },
    currentLineStyle: { type: String, default: 'solid' }
  },
  emits: ['state-updated', 'ready'], // 2. Add 'ready' event

  setup(props, { emit }) {
    // 3. Define emitReady function
    const emitReady = () => {
      console.log('WhiteboardCanvas: Emitting ready event');
      emit('ready');
    };

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
    const lastReleasedElementIndex = ref(-1);
    const currentElementPreview = ref(null);
    const pointsBuffer = ref([]);
    const smoothingFactor = ref(0.2);
    const shiftPressedAtStart = ref(false); // Track shift key state at mousedown
    const startCoordsForShiftLine = ref(null); // Store start coords specifically for Shift+Pen
    const notifications = ref([]);
    const notificationId = ref(0);
    const clipboardInput = ref(null);
    const imageCache = ref(new Map());
    const hoveredElementIndex = ref(-1);

    // ===== FRAGMENT 1 START =====
    // --- Yjs specific state (managed internally) ---
    const yjsConnection = ref(null);
    const ydoc = ref(null);
    const yDrawings = ref(null);
    const undoManager = ref(null);
    const canUndo = ref(false);
    const canRedo = ref(false);
    const isYjsReady = ref(false); // Signal for Yjs initialization completion

    // Define updateGlobalState outside initializeUndoManager to make it accessible in onBeforeUnmount
    const updateGlobalState = () => {
      if (undoManager.value) {
        const hasUndo = undoManager.value.canUndo();
        const hasRedo = undoManager.value.canRedo();
        
        // Aktualizuj stan lokalny (nadal potrzebny dla debug panelu w tym komponencie)
        canUndo.value = hasUndo;
        canRedo.value = hasRedo;
        
        // Aktualizuj stan globalny
        undoRedoState.update(hasUndo, hasRedo);
        
        // console.log(`[Canvas] UndoManager stan: canUndo=${hasUndo}, canRedo=${hasRedo}`); // Commented out
      } else {
        canUndo.value = false;
        canRedo.value = false;
        undoRedoState.update(false, false);
      }
    };

    // 2. Zastąp całą implementację UndoManager
    const initializeUndoManager = () => {
      // console.log("[Canvas] Inicjalizacja UndoManager..."); // Commented out
      
      if (undoManager.value) {
        try {
          undoManager.value.destroy();
        } catch (e) {
          // console.error("Błąd podczas czyszczenia UndoManagera:", e); // Commented out
        }
        undoManager.value = null;
      }
      
      if (!ydoc.value || !yDrawings.value) {
        // console.error("initializeUndoManager: Brak ydoc lub yDrawings"); // Commented out
        return;
      }
      
      // Konfiguracja UndoManager ze śledzeniem origin 'image'
      undoManager.value = new Y.UndoManager(yDrawings.value, {
        // Rejestruj zarówno transakcje bez origin jak i te z origin 'image'
        trackedOrigins: new Set([null, undefined, 'image'])
      });
      
      // Use the externally defined updateGlobalState function
      undoManager.value.on('stack-item-added', updateGlobalState);
      undoManager.value.on('stack-item-popped', updateGlobalState);
      
      // Inicjalne ustawienie stanu
      updateGlobalState();
      
      // console.log("[Canvas] UndoManager zainicjalizowany"); // Commented out
    };

    // 3. Zastąp metody undo/redo
    const undo = () => {
      // console.log("[Canvas] Undo - próba wykonania"); // Commented out
      
      try {
        if (undoManager.value && undoManager.value.canUndo()) {
          undoManager.value.undo();
          // console.log("[Canvas] Undo wykonane"); // Commented out
          
          // Dodatkowa aktualizacja globalnego stanu (już obsłużona przez listener 'stack-item-popped')
          // undoRedoState.update(undoManager.value.canUndo(), undoManager.value.canRedo());
          
          // Wymuś redraw
          nextTick(() => {
            redrawCanvas();
          });
        } else {
          // console.log("[Canvas] Undo niemożliwe"); // Commented out
        }
      } catch (error) {
        // console.error("[Canvas] Błąd podczas undo:", error); // Commented out
      }
    };

    const redo = () => {
      // console.log("[Canvas] Redo - próba wykonania"); // Commented out
      
      try {
        if (undoManager.value && undoManager.value.canRedo()) {
          undoManager.value.redo();
          // console.log("[Canvas] Redo wykonane"); // Commented out
          
          // Dodatkowa aktualizacja globalnego stanu (już obsłużona przez listener 'stack-item-added')
          // undoRedoState.update(undoManager.value.canUndo(), undoManager.value.canRedo());
          
          // Wymuś redraw
          nextTick(() => {
            redrawCanvas();
          });
        } else {
          // console.log("[Canvas] Redo niemożliwe"); // Commented out
        }
      } catch (error) {
        // console.error("[Canvas] Błąd podczas redo:", error); // Commented out
      }
    };

    // --- Methods ---

    // Add normalizeRoomId function
    const normalizeRoomId = (roomIdInput) => {
      if (!roomIdInput) {
        return 'default';
      }
      // Jeśli to już jest UUID lub ma prefiks board_, pozostaw jak jest
      if (roomIdInput.includes('-') || roomIdInput.startsWith('board_') || 
          roomIdInput === 'default' || roomIdInput === 'landing_page') {
        return roomIdInput;
      }
      // W przeciwnym razie dodaj prefiks
      return `board_${roomIdInput}`;
    };

    // 4. Modify initYjs
    const initYjs = () => {
      // Zamknij istniejące połączenie jeśli istnieje
      if (yjsConnection.value) { // Check .value
        console.log("Cleaning up existing Yjs connection...");
        yjsConnection.value.disconnect();
        if (undoManager.value) {
          undoManager.value.destroy();
          undoManager.value = null;
        }
        yDrawings.value?.unobserve(handleYjsUpdate);
        yjsConnection.value = null;
        ydoc.value = null;
        yDrawings.value = null;
        isYjsReady.value = false;
      }

      // Pobierz roomId z props i znormalizuj
      const rawRoomId = props.roomId || 'default';
      const roomName = normalizeRoomId(rawRoomId); // Use normalize function
      
      console.log(`WhiteboardCanvas: Initializing Yjs with normalized roomId: '${roomName}' (original: '${rawRoomId}')`);
      
      // Upewnij się, że roomId jest niepuste - This check seems redundant now with normalization
      // if (!roomName || roomName.trim() === '') {
      //   console.error('initYjs: Room ID missing or empty!');
      //   showToast("Room ID missing. Collaboration disabled.", "error");
      //   // roomActual.value = 'default_' + Math.random().toString(36).substring(2, 9); // roomActual is not defined here
      //   // console.log(`Using fallback room ID: ${roomActual.value}`);
      // } else {
      //   // roomActual.value = roomName; // roomActual is not defined here
      // }

      try {
        // Use the normalized roomName for connection
        const connection = connectToYjs(roomName); 
        yjsConnection.value = connection;
        ydoc.value = connection.ydoc;
        yDrawings.value = connection.yDrawings;

        if (!yDrawings.value) {
          console.error("[initYjs] Error: yDrawings not available after connection!");
          showToast("Error initializing collaboration.", "error");
          return;
        }

        yDrawings.value.observe(handleYjsUpdate); // Observe changes

        // Initialize UndoManager after Yjs setup
        initializeUndoManager();

        // Add Yjs update listener for debugging
        ydoc.value.on('update', (update, origin) => {
          console.log('Yjs document updated:', {
            updateSize: update.byteLength,
            origin,
            canExport: !!yjsConnection?.value?.ydoc,
            drawingsCount: yDrawings.value?.length || 0 // Use optional chaining and provide default
          });
        });
        
        isYjsReady.value = true; // Signal Yjs is ready
        console.log('Yjs initialized successfully');
        
        // Poczekaj chwilę, aby upewnić się, że wszystko jest gotowe
        setTimeout(emitReady, 500); // Call emitReady

      } catch (error) {
        console.error("Failed to connect Yjs provider:", error);
        showToast("Error connecting to collaboration session.", "error");
        isYjsReady.value = false;
      }
    };


    const redrawCanvas = () => {
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

      yDrawings.value.forEach((elementMap, index) => {
        let element;
        const type = elementMap.get('type');

        if (type === 'image') {
            const rawPosition = elementMap.get('position');
            let finalPosition = { x: 0, y: 0 };

            // Spróbuj różne sposoby odczytania pozycji
            if (rawPosition instanceof Y.Map) {
                finalPosition = { 
                    x: rawPosition.get('x') || 0, 
                    y: rawPosition.get('y') || 0 
                };
            } else if (rawPosition && typeof rawPosition === 'object') {
                if (typeof rawPosition.x === 'number' && typeof rawPosition.y === 'number') {
                    finalPosition = { x: rawPosition.x, y: rawPosition.y };
                } else if (typeof rawPosition.toJSON === 'function') {
                    const posJSON = rawPosition.toJSON();
                    finalPosition = { 
                        x: posJSON.x || 0, 
                        y: posJSON.y || 0 
                    };
                }
            }

            element = {
                type: type,
                position: finalPosition,
                dataUrl: elementMap.get('dataUrl'),
                width: elementMap.get('width') || 300,
                height: elementMap.get('height') || 200
            };

            console.log(`[redrawCanvas] Image Element ${index} data:`, JSON.stringify({
                ...element,
                dataUrl: element.dataUrl ? element.dataUrl.substring(0, 30) + '...' : 'undefined' // skróć dataUrl w logach
            }));
        } else {
            try {
                // Ensure all properties are extracted, especially lineStyle
                element = {};
                for (const [key, value] of elementMap.entries()) {
                    if (value instanceof Y.Array || value instanceof Y.Map) {
                         // Check if the value is a Y.Map representing coordinates
                         if ((key === 'start' || key === 'end' || key === 'position') && value instanceof Y.Map) {
                             element[key] = value.toJSON();
                         } else {
                             // For other Y types (like potentially points array if using Y.Array)
                             // This might need adjustment if points become collaborative
                             element[key] = value.toJSON();
                         }
                    } else {
                        element[key] = value;
                    }
                }
                 // DEBUG: Log the element data being passed to drawElement if in debug mode
                 if (props.debugMode) {
                    console.log(`[redrawCanvas] Element ${index} data from Yjs:`, JSON.stringify(element));
                 }
            } catch (e) {
                // console.error("Error converting elementMap to JSON:", elementMap, e); // Commented out
                return;
            }
        }

        if (!element || typeof element !== 'object') {
            // console.error("Invalid element data after conversion:", element); // Commented out
            return;
        }

        const isHighlighted = index === hoveredElementIndex.value && currentTool.value === 'eraser';
        drawElement(ctx, element, isHighlighted, smoothingFactor.value, imageCache.value, redrawCanvas);
      });

      if (isDrawing.value && currentElementPreview.value) {
        drawElement(ctx, currentElementPreview.value, false, smoothingFactor.value);
      }

      ctx.restore();
    };

    const debouncedRedraw = debounce(redrawCanvas, 16);

    const handleYjsUpdate = (events, transaction) => {
      // Only log detailed info if debugging is enabled
      if (props.debugMode) {
        console.log(`[handleYjsUpdate] Yjs update detected. Origin: ${transaction.origin || 'unspecified'}`);
      }
      
      debouncedRedraw();
      
      // Only emit state-updated for non-undo/redo transactions to prevent circular updates
      // Note: This check might need adjustment based on the new UndoManager logic
      // if (transaction.origin !== 'undo' && transaction.origin !== 'redo') {
      //   emit('state-updated', {});
      // }
      // For simplicity with the new UndoManager, let's always redraw on Yjs update
      redrawCanvas();
    };

    /**
     * Eksportuje stan tablicy jako string Base64
     * @returns {string | null} Zakodowany stan tablicy lub null w przypadku błędu
     */
    // 7. Napraw funkcję exportStateAsBase64:
    const exportStateAsBase64 = () => {
      try {
        if (!yjsConnection.value || !yjsConnection.value.ydoc) {
          console.error('Cannot export: Yjs document not initialized');
          return null;
        }
        
        // Zakoduj stan jako update YJS
        const update = Y.encodeStateAsUpdate(yjsConnection.value.ydoc);
        if (!update || update.byteLength === 0) {
          console.warn('Empty state or no changes to export');
          return null;
        }
        
        // Konwertuj do Base64
        return btoa(
          Array.from(new Uint8Array(update))
            .map(b => String.fromCharCode(b))
            .join('')
        );
      } catch (error) {
        console.error('Error exporting state:', error);
        return null;
      }
    };

    /**
     * Importuje stan tablicy z zakodowanego stringa Base64
     * @param {string} base64State - Zakodowany stan tablicy
     * @returns {boolean} Czy import się powiódł
     */
    const importStateFromBase64 = (base64State) => {
      if (!base64State || !yjsConnection.value || !yjsConnection.value.ydoc) {
        console.error('Cannot import: Missing data or Yjs not initialized');
        showToast('Error importing: Connection not ready or no data', 'error');
        return false;
      }
      
      try {
        // Dekoduj Base64 do binarnego stanu
        // Use atob for browser environments
        const binaryString = atob(base64State);
        const bytes = new Uint8Array(binaryString.length);
        
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        
        // Zastosuj zaktualizowany stan do dokumentu Yjs
        // Wrap in transact to ensure atomicity and proper event handling
        ydoc.value.transact(() => {
            Y.applyUpdate(yjsConnection.value.ydoc, bytes);
        });
        
        console.log('State imported successfully');
        showToast('Whiteboard state loaded', 'success');
        // Force redraw after applying update
        nextTick(() => {
            redrawCanvas();
            // Also update undo/redo state after import
            if (undoManager.value) {
                updateGlobalState();
            }
        });
        return true;
      } catch (error) {
        console.error('Error importing state:', error);
        showToast('Error importing whiteboard state (invalid format?)', 'error');
        return false;
      }
    };

    // Removed original updateUndoRedoState and initializeUndoManager as they are replaced by Fragment 1

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
        offsetX: event.clientX - rect.left,
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
        if (yjsConnection.value?.awareness) {
            const userState = yjsConnection.value.awareness.getLocalState()?.user || { name: 'Anonymous', color: '#000000' };
            yjsConnection.value.awareness.setLocalStateField('cursor', {
                x: coords.x,
                y: coords.y,
            });
            yjsConnection.value.awareness.setLocalStateField('user', userState);
        }
    }, 50);

    const handleMouseMove = (e) => {
      const coords = getCoordinates(e);
      const transformedCoords = transformCoordinates(coords.offsetX, coords.offsetY);
      updateLocalAwarenessCursor(transformedCoords);

      if (isPanning.value && lastPanPoint.value) {
        const currentPanPoint = transformCoordinates(coords.offsetX, coords.offsetY);
        panOffset.value.x += coords.offsetX - lastPanPoint.value.screenX;
        panOffset.value.y += coords.offsetY - lastPanPoint.value.screenY;
        lastPanPoint.value = { ...currentPanPoint, screenX: coords.offsetX, screenY: coords.offsetY };
        redrawCanvas();
        return;
      }

      if (isDrawing.value && currentTool.value !== 'eraser') {
        draw(transformedCoords, e.shiftKey); // Pass shift key state
      } else if (currentTool.value === 'eraser') {
        let foundIndex = -1;
        if (yDrawings.value) {
            for (let i = yDrawings.value.length - 1; i >= 0; i--) {
                const elementMap = yDrawings.value.get(i);
                try {
                    const element = elementMap.toJSON ? elementMap.toJSON() : elementMap;
                    if (isPointInElement(transformedCoords, element, (element.lineWidth || 2) / 2 + 5)) {
                        foundIndex = i;
                        break;
                    }
                } catch (error) {
                    // console.error("Error processing element for eraser hover:", elementMap, error); // Commented out
                }
            }
        }
        if (hoveredElementIndex.value !== foundIndex) {
            hoveredElementIndex.value = foundIndex;
            redrawCanvas();
        }
        if (isDrawing.value && foundIndex !== -1) {
           eraseElement(foundIndex);
        }
      } else {
         if (hoveredElementIndex.value !== -1) {
             hoveredElementIndex.value = -1;
             redrawCanvas();
         }
      }
    };

    const handleMouseDown = (event) => {
      shiftPressedAtStart.value = event.shiftKey; // Record shift state on mousedown
      startCoordsForShiftLine.value = null; // Reset shift line start point

      if (event.button === 1 || (event.button === 0 && event.altKey)) {
        isPanning.value = true;
        const coords = getCoordinates(event);
        lastPanPoint.value = { ...transformCoordinates(coords.offsetX, coords.offsetY), screenX: coords.offsetX, screenY: coords.offsetY };
        event.preventDefault();
        return;
      }
      if (event.button === 0) {
        if (currentTool.value === 'eraser') {
            if (hoveredElementIndex.value !== -1) {
                eraseElement(hoveredElementIndex.value);
                hoveredElementIndex.value = -1;
            }
            isDrawing.value = true;
        } else {
            startDrawing(event);
        }
      }
    };

    const handleMouseUp = (event) => {
      if (isPanning.value) {
        isPanning.value = false;
        lastPanPoint.value = null;
        return;
      }
      if (isDrawing.value) {
         if (currentTool.value === 'eraser') {
             isDrawing.value = false;
         } else {
             finishDrawing();
         }
      }
    };

    const handleMouseLeave = (event) => {
      if (isPanning.value) {
        isPanning.value = false;
        lastPanPoint.value = null;
      }
      if (isDrawing.value) {
        finishDrawing();
      }
       if (yjsConnection.value?.awareness) {
           yjsConnection.value.awareness.setLocalStateField('cursor', null);
           const userState = yjsConnection.value.awareness.getLocalState()?.user;
           if (userState) {
               yjsConnection.value.awareness.setLocalStateField('user', userState);
           }
       }
    };

    const handleTouchStart = (event) => {
        if (event.touches.length === 1) {
            event.preventDefault();
            startDrawing(event.touches[0]);
        }
    };

    const handleTouchMove = (event) => {
        if (event.touches.length === 1) {
            event.preventDefault();
            const coords = getCoordinates(event);
            const transformedCoords = transformCoordinates(coords.offsetX, coords.offsetY);
            updateLocalAwarenessCursor(transformedCoords);

            if (isDrawing.value) {
                // Touch events don't have shiftKey, so pass false
                draw(transformedCoords, false);
            }
        }
    };

    const handleTouchEnd = (event) => {
        event.preventDefault();
        if (isDrawing.value) {
            finishDrawing();
        }
        if (yjsConnection.value?.awareness) {
            yjsConnection.value.awareness.setLocalStateField('cursor', null);
            const userState = yjsConnection.value.awareness.getLocalState()?.user;
            if (userState) {
                yjsConnection.value.awareness.setLocalStateField('user', userState);
            }
        }
    };

    // --- Drawing Logic (Yjs Integration) ---

    const startDrawing = (event) => {
      if (!ydoc.value) return;
      isDrawing.value = true;
      const coords = getCoordinates(event);
      const transformedCoords = transformCoordinates(coords.offsetX, coords.offsetY);
      pointsBuffer.value = [];

      let toolType = currentTool.value;
      let elementData = {}; // Object to hold extra data like lineStyle

      // Handle Shift+Pen combination: Keep type 'pen' for now, store start point
      if (toolType === 'pen' && shiftPressedAtStart.value) {
          if (props.debugMode) {
              console.log("[startDrawing] Shift+Pen detected, storing start point.");
          }
          startCoordsForShiftLine.value = transformedCoords; // Store the starting point
          // Preview element remains 'pen' type initially for simplicity
      } else if (toolType === 'shapes') {
          toolType = props.currentShape; // Use the specific shape from prop
          if (props.debugMode) {
              console.log(`[startDrawing] Starting shape drawing with type: ${toolType}`);
          }
      } else if (toolType === 'lines') {
          toolType = 'line';
      }

      // If it's a line - always set lineStyle, even if toolType wasn't "lines"
      if (toolType === 'line') {
          elementData.lineStyle = props.currentLineStyle;
          if (props.debugMode) {
              console.log(`[startDrawing] Line style set to: ${elementData.lineStyle}`);
          }
      }

      // Create preview element based on the determined toolType
      currentElementPreview.value = createNewElement(
        toolType,
        transformedCoords,
        currentColor.value,
        currentLineWidth.value,
        elementData // Pass extra data
      );

      if (currentElementPreview.value) {
          const localClientId = yjsConnection.value?.awareness?.clientID || 'unknown';
          currentElementPreview.value.id = `temp_${localClientId}_${Date.now()}`;
          if (props.debugMode) {
              console.log("[startDrawing] Preview element created:", JSON.stringify(currentElementPreview.value));
          }
      } else {
          // console.error(`[startDrawing] Failed to create preview element for tool type: ${toolType} with data:`, elementData); // Commented out
          isDrawing.value = false; // Stop drawing if preview failed
          return;
      }

      if (currentTool.value === 'text') {
        const text = prompt('Enter text:', '');
        if (text) {
          const textElementData = createTextElement(
            transformedCoords,
            text,
            currentColor.value,
            currentLineWidth.value * 10
          );
          // 4. Zmodyfikuj finishDrawing, addTextElement, addImageFromDataUrl i eraseElement
          ydoc.value.transact(() => {
            const textMap = new Y.Map();
            for (const [key, value] of Object.entries(textElementData)) {
              if (key === 'position') {
                const posMap = new Y.Map();
                posMap.set('x', value.x);
                posMap.set('y', value.y);
                textMap.set(key, posMap);
              } else {
                textMap.set(key, value);
              }
            }
            yDrawings.value.push([textMap]);
          }); // BEZ trzeciego parametru
          // Po każdej transakcji dodaj (inside try block):
          nextTick(() => {
            if (undoManager.value) {
              updateGlobalState(); // Use the shared function
            }
          });
        }
        isDrawing.value = false;
        currentElementPreview.value = null;
      }
    };

    // ===== FRAGMENT 3 Modification START (eraseElement) =====
    const eraseElement = (index) => {
      if (ydoc.value && yDrawings.value && index >= 0 && index < yDrawings.value.length) {
        // console.log(`[eraseElement] Usuwanie elementu pod indeksem: ${index}`); // Commented out
        
        ydoc.value.transact(() => {
          yDrawings.value.delete(index, 1);
        }); // BEZ trzeciego parametru
        
        // Po każdej transakcji dodaj (inside try block):
        nextTick(() => {
          if (undoManager.value) {
             updateGlobalState(); // Use the shared function
          }
        });
      }
    };

    const draw = (coords, isShiftPressed) => { // Accept shift key state
      if (!isDrawing.value || !currentElementPreview.value) return;
      if (currentTool.value === 'eraser') return;

      const preview = currentElementPreview.value;

      // Update logic based on the actual tool and shift state
      if (currentTool.value === 'pen') {
          if (shiftPressedAtStart.value && startCoordsForShiftLine.value) {
              // Update preview for Shift+Pen: Draw straight line from stored start to current coords
              // Modify the preview element directly to represent a line for drawing purposes
              preview.type = 'line'; // Temporarily change type for drawElement
              preview.start = startCoordsForShiftLine.value;
              preview.end = coords;
              delete preview.points; // Remove points array for line preview
          } else if (!shiftPressedAtStart.value) {
              // Normal pen drawing - ensure preview type is 'pen'
              preview.type = 'pen';
              if (!preview.points) preview.points = []; // Initialize if needed
              preview.points.push(coords);
              pointsBuffer.value.push(coords);
              if (pointsBuffer.value.length > 3) pointsBuffer.value.shift();
          }
      } else if (currentTool.value === 'shapes' || currentTool.value === 'lines') {
          // Update end coordinates for shapes and regular lines
          preview.end = coords;

          // Special handling for square aspect ratio during preview
          if (preview.type === 'square') {
              const dx = Math.abs(coords.x - preview.start.x); // Use coords directly here
              const dy = Math.abs(coords.y - preview.start.y);
              const size = Math.max(dx, dy);
              preview.end = {
                  x: preview.start.x + size * Math.sign(coords.x - preview.start.x),
                  y: preview.start.y + size * Math.sign(coords.y - preview.start.y)
              };
          }
      }
      // Redraw after updating preview element
      redrawCanvas();
    };

    const finishDrawing = () => {
      const wasShiftPressed = shiftPressedAtStart.value; // Capture state before resetting
      const shiftStartPoint = startCoordsForShiftLine.value; // Capture start point
      const originalTool = currentTool.value; // Capture the tool selected in the toolbar
      shiftPressedAtStart.value = false; // Reset shift state
      startCoordsForShiftLine.value = null; // Reset start point

      if (!isDrawing.value || !currentElementPreview.value || !ydoc.value || !yDrawings.value) {
          isDrawing.value = false; // Ensure drawing state is reset
          currentElementPreview.value = null;
          return;
      }
      
      isDrawing.value = false;

      let elementToAdd = null;
      const preview = currentElementPreview.value;

      // Check if the element is valid (e.g., has size)
      const isValidElement = preview.start && preview.end && (preview.start.x !== preview.end.x || preview.start.y !== preview.end.y);
      // Pen needs at least two distinct points unless it was a Shift+Pen action
      const isValidPen = preview.type === 'pen' && preview.points && preview.points.length >= 2 && !wasShiftPressed;
      // Shift+Pen is valid if we have the start point and the preview end point
      const isValidShiftPen = originalTool === 'pen' && wasShiftPressed && shiftStartPoint && preview.end && (shiftStartPoint.x !== preview.end.x || shiftStartPoint.y !== preview.end.y);

      if (isValidPen || (preview.type !== 'pen' && isValidElement) || isValidShiftPen) {
          // If Shift was held with the pen tool, create a 'line' element
          if (wasShiftPressed && originalTool === 'pen' && isValidShiftPen) {
              if (props.debugMode) {
                  console.log("[finishDrawing] Shift held with Pen, creating Line element.");
              }
              elementToAdd = {
                  type: 'line',
                  start: shiftStartPoint, // Use the stored start point
                  end: preview.end, // Use the final end point from the preview
                  color: preview.color,
                  lineWidth: preview.lineWidth,
                  timestamp: Date.now(), // Use current timestamp
                  lineStyle: 'solid' // Force solid line style for Shift+Pen
              };
          } else {
              // Otherwise, use the preview element as is
              elementToAdd = { ...preview };
              delete elementToAdd.id; // Remove temporary ID

              // Ensure lineStyle is included if the original tool was 'lines'
              if (originalTool === 'lines' && elementToAdd.type === 'line') {
                 // Always assign the style from props when the tool was 'lines'
                 const styleFromProps = props.currentLineStyle || 'solid';
                 if (props.debugMode) {
                     console.log(`[finishDrawing] lineStyle missing or needs override, setting from prop: ${styleFromProps}`);
                 }
                 elementToAdd.lineStyle = styleFromProps;
              }
          }

          // Add only if elementToAdd is not null
          if (elementToAdd) {
              if (props.debugMode) {
                  console.log('[finishDrawing] Final elementToAdd before Yjs transaction:', JSON.stringify(elementToAdd));
              }
              
              try {
                  ydoc.value.transact(() => {
                      const yElementMap = new Y.Map();
                      
                      // Set basic properties that all elements have
                      yElementMap.set('type', elementToAdd.type);
                      yElementMap.set('color', elementToAdd.color);
                      yElementMap.set('lineWidth', elementToAdd.lineWidth);
                      yElementMap.set('timestamp', Date.now());
                      
                      // Handle type-specific properties
                      if (elementToAdd.type === 'pen') {
                          // Store points as an array (not a Y.Array)
                          yElementMap.set('points', elementToAdd.points);
                      } 
                      else if (elementToAdd.type === 'line') {
                          // Store start/end as nested Y.Maps
                          const startMap = new Y.Map();
                          startMap.set('x', elementToAdd.start.x);
                          startMap.set('y', elementToAdd.start.y);
                          yElementMap.set('start', startMap);
                          
                          const endMap = new Y.Map();
                          endMap.set('x', elementToAdd.end.x);
                          endMap.set('y', elementToAdd.end.y);
                          yElementMap.set('end', endMap);
                          
                          // Explicitly add lineStyle
                          const lineStyle = elementToAdd.lineStyle || props.currentLineStyle || 'solid';
                          yElementMap.set('lineStyle', lineStyle);
                      }
                      else if (elementToAdd.type === 'text') {
                          // Handled separately in startDrawing
                      }
                      else if (elementToAdd.type === 'image') {
                          // Handled separately in addImageFromDataUrl
                      }
                      else {
                          // Handle shapes and other element types with start/end points
                          const startMap = new Y.Map();
                          startMap.set('x', elementToAdd.start.x);
                          startMap.set('y', elementToAdd.start.y);
                          yElementMap.set('start', startMap);
                          
                          const endMap = new Y.Map();
                          endMap.set('x', elementToAdd.end.x);
                          endMap.set('y', elementToAdd.end.y);
                          yElementMap.set('end', endMap);
                      }
                      
                      // Push to the shared array only if not text/image (handled elsewhere)
                      if (elementToAdd.type !== 'text' && elementToAdd.type !== 'image') {
                        yDrawings.value.push([yElementMap]);
                      }
                      
                      if (props.debugMode) {
                          console.log('[finishDrawing] Successfully pushed Y.Map to yDrawings');
                      }
                  }); // BEZ trzeciego parametru
                  
                  // Po każdej transakcji dodaj (inside try block):
                  nextTick(() => {
                     if (undoManager.value) {
                        updateGlobalState(); // Use the shared function
                     }
                  });
              } catch (error) {
                  // console.error('[finishDrawing] Error during Yjs transaction:', error); // Commented out
                  showToast("Error saving drawing element.", "error");
              }
          }
      } else {
          if (props.debugMode) {
              console.log('Drawing finished but element was too small or invalid, not adding.');
          }
      }

      currentElementPreview.value = null;
      pointsBuffer.value = [];
      redrawCanvas(); // Redraw to remove the preview
    };

    // --- Tool and Style Setters ---
    const setTool = (tool) => { currentTool.value = tool; updateCursor(); };
    const setColor = (color) => { currentColor.value = color; updateCursor(); };
    const setLineWidth = (width) => { currentLineWidth.value = Number(width) || 2; updateCursor(); };
    const setEraserMode = (mode) => { eraserMode.value = mode; updateCursor(); };

    const updateCursor = () => {
      if (canvas.value) {
        let toolForCursor = currentTool.value;
        if (toolForCursor === 'shapes') {
            toolForCursor = props.currentShape;
        } else if (toolForCursor === 'lines') {
            toolForCursor = 'line';
        }
        canvas.value.style.cursor = getCursorStyle(toolForCursor, currentColor.value, eraserMode.value);
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
    };
    
    const resetZoom = () => {
        zoomLevel.value = 1;
        panOffset.value = { x: 0, y: 0 };
        redrawCanvas();
    };

    // --- Keyboard handling ---
    const handleKeyDown = (event) => {
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;

      // Handle Undo/Redo shortcuts
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
          event.preventDefault();
          undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'z') {
          event.preventDefault();
          redo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
          event.preventDefault();
          redo();
      }
    };

    // --- Other Actions ---
    const handlePaste = (event) => {
       event.preventDefault();
       const items = (event.clipboardData || window.clipboardData).items;
       if (!items || !ydoc.value) return;

       for (let i = 0; i < items.length; i++) {
         if (items[i].type.indexOf('image') !== -1) {
           const blob = items[i].getAsFile();
           const reader = new FileReader();
           reader.onload = (e) => addImageFromDataUrl(e.target.result);
           reader.readAsDataURL(blob);
           return;
         }
       }

       const text = (event.clipboardData || window.clipboardData).getData('text');
       if (text) {
         const centerX = (canvasWidth.value / 2 - panOffset.value.x) / zoomLevel.value;
         const centerY = (canvasHeight.value / 2 - panOffset.value.y) / zoomLevel.value;
         addTextElement({ x: centerX, y: centerY }, text);
       }
    };

    // ===== FRAGMENT 3 Modification START (addImageFromDataUrl) =====
    const addImageFromDataUrl = (dataUrl) => {
        console.log("[WhiteboardCanvas] addImageFromDataUrl called with dataUrl (first 50 chars):", dataUrl.substring(0, 50));
        
        if (!ydoc.value || !yDrawings.value) {
            console.error("[addImageFromDataUrl] Error: ydoc or yDrawings not available!");
            showToast("Cannot add image - connection issue", "error");
            return;
        }
        
        // Calculate center position
        const centerX = (canvasWidth.value / 2 - panOffset.value.x) / zoomLevel.value;
        const centerY = (canvasHeight.value / 2 - panOffset.value.y) / zoomLevel.value;
        
        console.log("[addImageFromDataUrl] Creating image at position:", centerX, centerY);
        
        // Use createImageElement to get proper dimensions and position
        createImageElement(dataUrl, centerX, centerY)
            .then(imageData => {
                console.log("[addImageFromDataUrl] Image created:", imageData);
                
                try {
                    // Create transaction WITHOUT origin parameter for compatibility
                    ydoc.value.transact(() => {
                        console.log("[addImageFromDataUrl] Creating Y.Map for image");
                        const imageMap = new Y.Map();
                        
                        // Set basic properties
                        imageMap.set('type', 'image');
                        imageMap.set('timestamp', Date.now());
                        
                        // Set position as Y.Map
                        const posMap = new Y.Map();
                        posMap.set('x', imageData.x);
                        posMap.set('y', imageData.y);
                        imageMap.set('position', posMap);
                        
                        // Set image data
                        imageMap.set('dataUrl', imageData.dataUrl);
                        imageMap.set('width', imageData.width);
                        imageMap.set('height', imageData.height);
                        
                        // Push to shared array
                        console.log("[addImageFromDataUrl] Pushing image to yDrawings");
                        yDrawings.value.push([imageMap]);
                    });
                    
                    // Force redraw
                    console.log("[addImageFromDataUrl] Forcing redraw after adding image");
                    nextTick(() => {
                        redrawCanvas();
                        
                        // Update undo state
                        if (undoManager.value) {
                            const hasUndo = undoManager.value.canUndo();
                            const hasRedo = undoManager.value.canRedo();
                            canUndo.value = hasUndo;
                            canRedo.value = hasRedo;
                            
                            // Update global state
                            if (typeof undoRedoState !== 'undefined') {
                                undoRedoState.update(hasUndo, hasRedo);
                            }
                            
                            console.log(`[addImageFromDataUrl] Updated undo state: canUndo=${hasUndo}, canRedo=${hasRedo}`);
                        }
                    });
                    
                    // Show success message
                    showToast("Image added successfully", "success");
                }
                catch (error) {
                    console.error("[addImageFromDataUrl] Error adding image:", error);
                    showToast("Failed to add image", "error");
                }
            })
            .catch(error => {
                console.error("[addImageFromDataUrl] Error creating image:", error);
                showToast("Failed to process image", "error");
            });
    };
    // ===== FRAGMENT 3 Modification END (addImageFromDataUrl) =====

    // ===== FRAGMENT 3 Modification START (addTextElement - outer call) =====
    const addTextElement = (position, text) => {
        if (!ydoc.value || !yDrawings.value || !text) return;
        const textElementData = createTextElement(
            position,
            text,
            currentColor.value,
            currentLineWidth.value * 10
        );
        
        try {
            ydoc.value.transact(() => {
              const textMap = new Y.Map();
              for (const [key, value] of Object.entries(textElementData)) {
                if (key === 'position') {
                  const posMap = new Y.Map();
                  posMap.set('x', value.x);
                  posMap.set('y', value.y);
                  textMap.set(key, posMap);
                } else {
                  textMap.set(key, value);
                }
              }
              yDrawings.value.push([textMap]);
            }); // BEZ trzeciego parametru
            
            // Po każdej transakcji dodaj (inside try block):
            nextTick(() => {
               if (undoManager.value) {
                  updateGlobalState(); // Use the shared function
               }
            });
        } catch (error) {
            // console.error("Error adding text element:", error); // Commented out
            showToast("Failed to add text to whiteboard.", "error");
        }
    };
    // ===== FRAGMENT 3 Modification END (addTextElement - outer call) =====

    // --- Undo/Redo Methods --- (Replaced by Fragment 1)

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
    // ===== FRAGMENT 3 Modification START (clearCanvas) =====
    const clearCanvas = () => {
        if (ydoc.value && yDrawings.value) {
            if (confirm('Are you sure you want to clear the canvas?')) {
                // console.log('[clearCanvas] Clearing all elements'); // Commented out
                
                try {
                    ydoc.value.transact(() => {
                      // Store current length for better performance
                      const length = yDrawings.value.length;
                      if (length > 0) {
                        yDrawings.value.delete(0, length);
                      }
                    }); // BEZ trzeciego parametru
                    
                    showStatus('Canvas cleared');
                    
                    // Po każdej transakcji dodaj (inside try block):
                    nextTick(() => {
                       if (undoManager.value) {
                          updateGlobalState(); // Use the shared function
                       }
                    });
                } catch (error) {
                    // console.error('[clearCanvas] Error clearing canvas:', error); // Commented out
                    showToast("Error clearing canvas.", "error");
                }
            }
        }
    };
    // ===== FRAGMENT 3 Modification END (clearCanvas) =====

    const getSerializableState = () => { return {}; }; // Placeholder
    const loadState = (state) => { return false; }; // Placeholder
    const exportAsText = () => { return ''; }; // Placeholder
    const importFromText = (text) => { return false; }; // Placeholder
    
    const toggleDebug = (enabled) => {
        props.debugMode = enabled;
        redrawCanvas();
    };
    
    const getViewportCenter = () => ({
        x: (canvasWidth.value / 2 - panOffset.value.x) / zoomLevel.value,
        y: (canvasHeight.value / 2 - panOffset.value.y) / zoomLevel.value,
    });

    // ===== FRAGMENT 5 START =====
    const testUndoManager = () => {
      // console.log("=== TEST UNDOMANAGER ==="); // Commented out
      
      try {
        if (!ydoc.value || !yDrawings.value) {
          alert("Brak ydoc lub yDrawings!");
          return;
        }
        
        // console.log("Dodaję testowy element..."); // Commented out
        
        ydoc.value.transact(() => {
          const testElement = new Y.Map();
          testElement.set('type', 'test');
          testElement.set('timestamp', Date.now());
          testElement.set('color', '#ff0000');
          
          const startMap = new Y.Map();
          startMap.set('x', 100);
          startMap.set('y', 100);
          testElement.set('start', startMap);
          
          const endMap = new Y.Map();
          endMap.set('x', 200);
          endMap.set('y', 200);
          testElement.set('end', endMap);
          
          yDrawings.value.push([testElement]);
        });
        
        nextTick(() => {
          // console.log("Test element dodany. canUndo =", undoManager.value?.canUndo()); // Commented out
          alert(`Test wykonany. canUndo = ${canUndo.value}`);
        });
      } catch (error) {
        // console.error("Błąd testu:", error); // Commented out
        alert("Błąd testu: " + error.message);
      }
    };
    // ===== FRAGMENT 5 END =====

    // --- Watchers ---
    // Watcher for props.roomId (already added, but ensure it uses normalizeRoomId)
    watch(() => props.roomId, (newRoomId, oldRoomId) => {
      const newNormalizedId = normalizeRoomId(newRoomId);
      const oldNormalizedId = normalizeRoomId(oldRoomId);
      
      if (newNormalizedId !== oldNormalizedId) {
        console.log(`WhiteboardCanvas: props.roomId changed from '${oldRoomId}' to '${newRoomId}'`);
        console.log(`WhiteboardCanvas: normalized roomId changed from '${oldNormalizedId}' to '${newNormalizedId}'`);
        
        // Reinicjalizacja Yjs z nowym roomId
        initYjs();
      }
    }); // This replaces the watcher added in the previous step, ensuring normalization is used.

    watch(() => props.currentShape, (newShape) => {
        if (props.debugMode) {
            console.log(`[Watch] currentShape changed to: ${newShape}`);
        }
        if (currentTool.value === 'shapes') {
            updateCursor();
        }
    });

    watch(() => props.currentLineStyle, (newLineStyle) => {
        if (props.debugMode) {
            console.log(`[Watch] currentLineStyle changed to: ${newLineStyle}`);
        }
        if (currentTool.value === 'lines') {
            updateCursor();
        }
    });

    // Watcher for roomId changes is now handled above with normalization

    // --- Lifecycle Hooks ---
    // ===== FRAGMENT 6 START =====
    // 5. Modify onMounted
    onMounted(() => {
      console.log('WhiteboardCanvas: onMounted');
      initCanvas();
      initClipboardHandler(); // Keep clipboard handler init
      
      // Inicjalizacja Yjs z roomId z props
      initYjs(); // Call the updated initYjs

      window.addEventListener('resize', handleResize);
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('paste', handlePaste);
      darkModeObserver.observe(document.body, { attributes: true });
      handleResize(); // Initial resize call

      const urlParams = new URLSearchParams(window.location.search);
      const roomId = urlParams.get('room');

      if (roomId) {
        try {
          // console.log("[onMounted] Łączenie z Yjs dla pokoju:", roomId); // Commented out
          const connection = connectToYjs(roomId);
          yjsConnection.value = connection;
          ydoc.value = connection.ydoc;
          yDrawings.value = connection.yDrawings;
          
          if (!yDrawings.value) {
            // console.error("[onMounted] Błąd: yDrawings not available after connection!"); // Commented out
            return;
          }
          
          // console.log("[onMounted] yDrawings zainicjalizowany, długość:", yDrawings.value.length); // Commented out
          
          // Obserwuj zmiany w yDrawings
          yDrawings.value.observe(event => {
            // console.log("[yDrawings.observe] Zmiana w yDrawings:", event); // Commented out
            redrawCanvas(); // Use direct redraw instead of debounced for immediate feedback
          });
          
          // Inicjalizuj UndoManager po krótkim opóźnieniu
          setTimeout(() => {
            // console.log("[onMounted] Inicjalizacja UndoManager po opóźnieniu..."); // Commented out
            initializeUndoManager();
            redrawCanvas(); // Redraw after UndoManager init
          }, 100);
          
          // console.log('[onMounted] Yjs connection established successfully.'); // Commented out
          isYjsReady.value = true; // Signal that Yjs is ready
        } catch (error) {
          // console.error("Failed to connect Yjs provider:", error); // Commented out
          showToast("Error connecting to collaboration session.", "error");
        }
      } else {
        // console.error("WhiteboardCanvas: 'room' parameter missing in URL!"); // Commented out
        showToast("Room ID missing. Collaboration disabled.", "error");
      }
    });
    // ===== FRAGMENT 6 END =====

    onBeforeUnmount(() => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('paste', handlePaste);
      darkModeObserver.disconnect();
      
      // Clean up Yjs observers
      if (yDrawings.value) {
        // Use the correct unobserve method based on how it was observed in onMounted
        yDrawings.value.unobserve(handleYjsUpdate); // Assuming observe was used, adjust if observeDeep was intended
      }
      
      // Clean up UndoManager
      if (undoManager.value) {
        // Use the externally defined updateGlobalState function reference
        undoManager.value.off('stack-item-added', updateGlobalState);
        undoManager.value.off('stack-item-popped', updateGlobalState);
        undoManager.value.destroy();
        undoManager.value = null;
        // console.log('[Canvas] UndoManager destroyed'); // Commented out
      }
      
      // Disconnect from Yjs
      if (yjsConnection.value) {
        yjsConnection.value.disconnect();
      }
    });

    return {
      // Refs
      canvas,
      
      // State
      canvasWidth,
      canvasHeight,
      isDrawing,
      currentTool,
      currentColor,
      currentLineWidth,
      zoomLevel,
      panOffset,
      darkMode,
      eraserMode,
      notifications,
      statusMessage,
      yjsConnection,
      canUndo,
      canRedo,
      
      // Methods
      handleMouseDown,
      handleMouseMove,
      handleMouseUp,
      handleMouseLeave,
      handleZoom,
      handlePaste,
      handleResize,
      handleTouchStart,
      handleTouchMove,
      handleTouchEnd,
      
      // Public API
      setTool,
      setColor,
      setLineWidth,
      setEraserMode,
      zoomIn,
      zoomOut,
      resetZoom,
      undo,
      redo,
      clearCanvas,
      showToast,
      getSerializableState,
      loadState,
      exportAsText,
      importFromText,
      addImageFromDataUrl,
      getViewportCenter,
      toggleDebug,
      redrawCanvas,
      testUndoManager, // ===== FRAGMENT 7 =====
      // Expose new functions
      exportStateAsBase64,
      importStateFromBase64,
      isYjsReady, // Expose the readiness signal
      // Expose methods needed by App.vue
      undo,
      redo,
      clearCanvas,
      setTool,
      setColor,
      setLineWidth,
      addImageFromDataUrl,
      toggleDebug,
      redrawCanvas, // Might be useful for parent component
      // 8. W defineExpose dodaj canvasReady:
      canvasReady: () => !!yjsConnection?.value?.ydoc // Check if ydoc exists
    };
  }
};
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
