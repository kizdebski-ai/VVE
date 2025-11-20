<template>
  <div
    ref="containerRef"
    class="whiteboard-container"
    :class="{ 'dark-mode': darkMode }"
  >
    <div v-if="debugMode" style="position: absolute; top: 5px; left: 5px; z-index: 9999;
     background: rgba(0,0,0,0.7); color: white; padding: 5px; border-radius: 4px; font-size: 12px;">
  UndoManager: CanUndo={{canUndo}}, CanRedo={{canRedo}}
</div>
    <canvas 
      ref="canvas" 
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

    <!-- Render MovableObject components -->
    <movable-object
      v-for="elementMap in movableElements"
      :key="elementMap.get('id') || elementMap._tempKey || Math.random()"
      :object="elementMap"
      :zoom-level="zoomLevel"
      :pan-offset="panOffset"
      :is-selected="elementMap.get('id') === selectedObjectId"
      :interaction-enabled="currentTool === 'select' || ['coordinateSystem2D', 'coordinateSystem3D', 'mathFunctionPlot', 'physicsDataPlot'].includes(elementMap.get('type'))"
      @update:object="handleObjectUpdate"
      @request-select="handleObjectSelectionRequest"
    ></movable-object>

    <!-- Inline Text Editor -->
    <textarea
      v-if="inlineTextEditor.visible"
      ref="inlineTextRef"
      v-model="inlineTextEditor.value"
      class="inline-text-editor"
      :style="inlineTextStyle"
      @blur="finalizeInlineText"
      @keydown.enter.stop="handleInlineTextEnter"
      @keydown.stop
      @mousedown.stop
      placeholder="Type here..."
    ></textarea>

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
import { ref, onMounted, onBeforeUnmount, watch, nextTick, shallowRef, reactive, computed } from 'vue';
import * as Y from 'yjs';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { undoRedoState } from '../utils/undoRedoState';
import Collaborators from './Collaborators.vue';
import ZoomPanControls from './ZoomPanControls.vue';
import EraserModeControls from './EraserModeControls.vue';
import StatusMessage from './StatusMessage.vue';
// Helper modules
import GridAlignModule from '../modules/GridAlignModule.js';
import HandwritingStylerModule from '../modules/HandwritingStylerModule.js';
import MathRecognizerModule from '../modules/MathRecognizerModule.js';
// Utils and Services
import { connectToYjs } from '../services/connectToYjs';
import { drawElement, throttle, isPointInElement, distanceToSegment } from '../utils/canvasDrawing.js';
import { isPointInRotatedRectangle } from '../utils/geometry.js';
import {
  createNewElement,
  createImageElement,
  getCursorStyle,
  createCoordinateSystem2DElement,
  createCoordinateSystem3DElement
} from '../utils/canvasTools.js';
import { drawGrid as drawUtilGrid } from '../utils/canvasGrid.js';
import MovableObject from './MovableObject.vue';


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

const MAX_DEVICE_PIXEL_RATIO = 3;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;

const clampDevicePixelRatio = () => {
  if (typeof window === 'undefined' || typeof window.devicePixelRatio === 'undefined') {
    return 1;
  }
  const ratio = window.devicePixelRatio || 1;
  return Math.min(Math.max(ratio, 1), MAX_DEVICE_PIXEL_RATIO);
};

const clampZoom = (value) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));

const getTouchDistance = (touchA, touchB) => {
  const dx = touchA.clientX - touchB.clientX;
  const dy = touchA.clientY - touchB.clientY;
  return Math.hypot(dx, dy);
};

const getTouchCenter = (touchA, touchB, rect) => ({
  x: ((touchA.clientX + touchB.clientX) / 2) - rect.left,
  y: ((touchA.clientY + touchB.clientY) / 2) - rect.top,
});


export default {
  name: 'WhiteboardCanvas',
  components: {
    Collaborators,
    ZoomPanControls,
    EraserModeControls,
    StatusMessage,
    MovableObject, // Register MovableObject
  },
  props: {
    debugMode: { type: Boolean, default: false },
    currentShape: { type: String, default: 'rectangle' },
    currentLineStyle: { type: String, default: 'solid' },
    currentArrowStyle: { type: String, default: 'none' },
    // Feature configuration
    activeFeature: { type: String, default: null },
    gridAlignOptions: { type: Object, default: () => ({}) },
    handwritingStylerOptions: { type: Object, default: () => ({}) },
    mathRecognizerOptions: { type: Object, default: () => ({}) },
    // Props from App.vue (already existed)
    roomId: { type: String, required: true },
    username: { type: String, default: 'Anonymous' }
  },
  emits: [
    'state-updated',
    'update:recognition-status',
    'update:latex-equation',
    'update:solution',
    'update:has-char-groups',
    'update:has-stylized-strokes'
  ],
  setup(props, { emit, expose }) {
    const devicePixelRatio = ref(clampDevicePixelRatio());
    
    // Canvas refs
    const containerRef = ref(null);
    const canvas = ref(null);
    const context = ref(null);
    const canvasWidth = ref(0);
    const canvasHeight = ref(0);

    // Module refs
    const gridAlignModule = ref(null);
    const handwritingStylerModule = ref(null);
    const mathRecognizerModule = ref(null);

    // UI State Refs
    const activeConfigPanel = ref(null);
    const configPanelCoords = ref(null);
    // Inline Text Editor State
    const inlineTextEditor = reactive({
      visible: false,
      value: '',
      x: 0,
      y: 0,
      width: 200,
      height: 50,
      fontSize: 24
    });
    const inlineTextRef = ref(null);

    // --- Computed ---
    const inlineTextStyle = computed(() => {
      const screenX = inlineTextEditor.x * zoomLevel.value + panOffset.value.x;
      const screenY = inlineTextEditor.y * zoomLevel.value + panOffset.value.y;
      return {
        position: 'absolute',
        left: `${screenX}px`,
        top: `${screenY}px`,
        fontSize: `${inlineTextEditor.fontSize * zoomLevel.value}px`,
        color: currentColor.value,
        minWidth: '50px',
        minHeight: '1.2em',
        zIndex: 1000,
        background: 'transparent',
        border: '1px dashed #ccc',
        outline: 'none',
        resize: 'none',
        overflow: 'hidden',
        fontFamily: 'sans-serif',
        lineHeight: '1.2'
      };
    });

    const isDrawing = ref(false);
    const currentTool = ref('pen'); // Default to pen (matches App.vue)
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
    const smoothingFactor = ref(0.65);
    const PEN_SMOOTHING_WINDOW = 4;
    const PEN_COORD_PRECISION = 2;
    const shiftPressedAtStart = ref(false); // Track shift key state at mousedown
    const startCoordsForShiftLine = ref(null); // Store start coords specifically for Shift+Pen
    const notifications = ref([]);
    const notificationId = ref(0);
    const debugLog = (...args) => {
      if (props.debugMode) {
        console.log(...args);
      }
    };
    const debugWarn = (...args) => {
      if (props.debugMode) {
        console.warn(...args);
      }
    };
    const clipboardInput = ref(null);
    const imageCache = ref(new Map());
    const movableElementTypes = new Set([
        'pen',
        'line',
        'rectangle',
        'circle',
        'square',
        'triangle',
        'trapezoid',
        'parallelogram',
        'deltoid',
        'cube',
        'cuboid',
        'sphere',
        'cylinder',
        'cone',
        'pyramid',
        'tetrahedron',
        'text',
        'image',
        'coordinateSystem2D',
        'coordinateSystem3D',
        'mathFunctionPlot',
        'physicsDataPlot'
    ]);
    const movableElements = shallowRef([]);
    const hoveredElementIndex = ref(-1);
    const selectedObjectId = ref(null); // Added for selection state
    const spacePanActive = ref(false);
    const panStartedWithSpace = ref(false);
    const pinchGesture = ref(null);
    let resizeObserver = null;
    let clipboardFocusHandler = null;

    // Helper module instances
    const yjsConnection = ref(null);
    const ydoc = ref(null);
    const yDrawings = ref(null);
    const activeRoomId = ref(null);
    const latestUsername = ref(props.username);
    const undoManager = ref(null);
    const canUndo = ref(false);
    const canRedo = ref(false);

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

        // debugLog(`[Canvas] UndoManager stan: canUndo=${hasUndo}, canRedo=${hasRedo}`); // Commented out
      } else {
        canUndo.value = false;
        canRedo.value = false;
        undoRedoState.update(false, false);
      }
    };

    // 2. Zastąp całą implementację UndoManager
    const initializeUndoManager = () => {
      // debugLog("[Canvas] Inicjalizacja UndoManager..."); // Commented out

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

      // Konfiguracja UndoManager ze śledzeniem origin
      undoManager.value = new Y.UndoManager(yDrawings.value, {
        trackedOrigins: new Set([
          null, undefined, // Default local changes
          'local-drawing', 'local-erase', 'local-clear', 'local-text', 'local-image', 'local-plot', 'local-coordsys', // Existing origins
          'ai-align', 'ai-style', 'ai-math' // Reserved origins for helper modules
        ])
      });

      // Use the externally defined updateGlobalState function
      undoManager.value.on('stack-item-added', updateGlobalState);
      undoManager.value.on('stack-item-popped', updateGlobalState);

      // Inicjalne ustawienie stanu
      updateGlobalState();

      // debugLog("[Canvas] UndoManager zainicjalizowany"); // Commented out
    };

    // 3. Zastąp metody undo/redo
    const undo = () => {
      // debugLog("[Canvas] Undo - próba wykonania"); // Commented out

      try {
        if (undoManager.value && undoManager.value.canUndo()) {
          undoManager.value.undo();
          // debugLog("[Canvas] Undo wykonane"); // Commented out

          // Dodatkowa aktualizacja globalnego stanu (już obsłużona przez listener 'stack-item-popped')
          // undoRedoState.update(undoManager.value.canUndo(), undoManager.value.canRedo());

          // Wymuś redraw
          nextTick(() => {
            redrawCanvas();
          });
        } else {
          // debugLog("[Canvas] Undo niemożliwe"); // Commented out
        }
      } catch (error) {
        // console.error("[Canvas] Błąd podczas undo:", error); // Commented out
      }
    };

    const redo = () => {
      // debugLog("[Canvas] Redo - próba wykonania"); // Commented out

      try {
        if (undoManager.value && undoManager.value.canRedo()) {
          undoManager.value.redo();
          // debugLog("[Canvas] Redo wykonane"); // Commented out

          // Dodatkowa aktualizacja globalnego stanu (już obsłużona przez listener 'stack-item-added')
          // undoRedoState.update(undoManager.value.canUndo(), undoManager.value.canRedo());

          // Wymuś redraw
          nextTick(() => {
            redrawCanvas();
          });
        } else {
          // debugLog("[Canvas] Redo niemożliwe"); // Commented out
        }
      } catch (error) {
        // console.error("[Canvas] Błąd podczas redo:", error); // Commented out
      }
    };

    // --- Methods ---

    // Method to render LaTeX using KaTeX
    const renderLatex = (latexString) => {
      // Find the target element within App.vue's template (or create if needed)
      // This assumes App.vue has <span id="latex-render-output"></span> inside the math panel
      const targetElement = document.getElementById('latex-render-output');
      if (targetElement) {
        try {
          katex.render(latexString || '', targetElement, { // Render empty string if null/undefined
            throwOnError: false, // Don't throw errors, display them in the output
            displayMode: false // Render inline
          });
          // No need to emit here, App.vue already has latexEquation ref
        } catch (error) {
          console.error('Error rendering LaTeX:', error);
          targetElement.textContent = `Error: ${error.message}`;
          // Emit the error message? Or let the module handle status?
          // emit('update:latex-equation', `Error: ${error.message}`);
        }
      } else {
        debugWarn('LaTeX render target element #latex-render-output not found.');
      }
    };


    // Method to open a configuration panel
    const openConfigPanel = (panelType, coords) => {
      configPanelCoords.value = coords; // Store transformed coords
      activeConfigPanel.value = panelType;
      // Prevent drawing while config panel is open
      isDrawing.value = false;
      currentElementPreview.value = null;
    };

    // Method to close the active configuration panel
    const closeConfigPanel = () => {
      activeConfigPanel.value = null;
    };

    // Method to add a plot/coord system from panel data
    const addElementFromPanel = (elementData) => {
      if (!ydoc.value || !yDrawings.value || !elementData || !elementData.type) {
        console.error("Invalid data received from panel or Yjs not ready", elementData);
        closeConfigPanel();
        return;
      }

      try {
        ydoc.value.transact(() => {
          const yElementMap = new Y.Map();

          // Convert JS object/array properties to Yjs types
          for (const [key, value] of Object.entries(elementData)) {
            if (key === 'position' && typeof value === 'object' && value !== null) {
              const posMap = new Y.Map();
              posMap.set('x', value.x);
              posMap.set('y', value.y);
              yElementMap.set(key, posMap);
            } else if (Array.isArray(value)) {
              // Store plain arrays directly for data points (simpler for now)
              yElementMap.set(key, value);
            } else {
              yElementMap.set(key, value);
            }
          }

          // Apply default arrow style for lines if missing
          if (elementData.type === 'line' && !elementData.arrowStyle) {
              yElementMap.set('arrowStyle', props.currentArrowStyle || 'none');
          }

          yDrawings.value.push([yElementMap]);
          refreshMovableElements();
        });

        nextTick(() => {
          if (undoManager.value) {
            updateGlobalState();
          }
          redrawCanvas(); // Redraw to show the new element
        });

      } catch (error) {
        console.error('[addElementFromPanel] Error during Yjs transaction:', error);
        showToast("Error saving element.", "error");
      } finally {
        closeConfigPanel(); // Close panel after adding
      }
    };

    const applyMathAnswer = (newStrokeData) => {
        if (!newStrokeData || !ydoc.value || !yDrawings.value) return;

        try {
            ydoc.value.transact(() => {
                const yElementMap = new Y.Map();
                for (const [key, value] of Object.entries(newStrokeData)) {
                    yElementMap.set(key, value);
                }
                yDrawings.value.push([yElementMap]);
            }, 'ai-math'); // Origin

            nextTick(() => {
                updateGlobalState();
                // Reset math state in App.vue via emits
                emit('update:recognition-status', '');
                emit('update:latex-equation', '');
                emit('update:solution', '');
                redrawCanvas();
            });
        } catch (error) {
            console.error("Error applying math answer:", error);
            showToast("Failed to apply math answer.", "error");
        }
    };


    const redrawCanvas = () => {
      if (!context.value) return;

      const ctx = context.value;
      const ratio = devicePixelRatio.value || 1;

      // Ensure base HiDPI transform before clearing
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, canvasWidth.value, canvasHeight.value);

      // Draw utility grid first
      drawUtilGrid(ctx, zoomLevel.value, panOffset.value, canvasWidth.value, canvasHeight.value, darkMode.value);

      ctx.save();
      ctx.setTransform(
        zoomLevel.value * ratio, 0,
        0, zoomLevel.value * ratio,
        panOffset.value.x * ratio, panOffset.value.y * ratio
      );

      // Determine strokes to draw (original or stylized)
      let strokesToDraw = [];
      if (yDrawings.value) {
        strokesToDraw = yDrawings.value.toArray().map(map => map.toJSON()); // Convert Y.Array of Y.Map to JS Array of Objects
        if (props.activeFeature === 'styleHandwriting' && handwritingStylerModule.value?.hasStylizedStrokes()) {
          strokesToDraw = handwritingStylerModule.value.getStrokes(); // Get potentially modified strokes
        }
      }

      // Draw all elements; MovableObject overlays handle interactions but canvas still renders visuals
      strokesToDraw.forEach((element, index) => {
        const isHighlighted = index === hoveredElementIndex.value && currentTool.value === 'eraser';
        drawElement(ctx, element, isHighlighted, smoothingFactor.value, imageCache.value, redrawCanvas);
      });

      // Draw current preview if any
      if (isDrawing.value && currentElementPreview.value) {
        drawElement(ctx, currentElementPreview.value, false, smoothingFactor.value);
      }

      // Draw helper overlays
    // For now, keep them, but they might draw over or under MovableObjects depending on DOM order
    // and their own drawing logic (e.g., if they directly draw on the main canvas context).
      if (props.activeFeature === 'gridAlign' && gridAlignModule.value) {
        // Draw grid (if needed, or rely on drawUtilGrid)
        // drawGrid(); // This component's grid drawing method
        if (props.gridAlignOptions.showBaselines) {
          gridAlignModule.value.drawBaselines(ctx);
        }
      } else if (props.activeFeature === 'styleHandwriting' && handwritingStylerModule.value) {
        handwritingStylerModule.value.drawCharGroups(ctx);
      } else if (props.activeFeature === 'mathRecognizer' && mathRecognizerModule.value) {
        mathRecognizerModule.value.drawGhostAnswer(ctx);
      }


      ctx.restore();
    };

    const handleYjsUpdate = (events, transaction) => {
      // Only log detailed info if debugging is enabled
      if (props.debugMode) {
        debugLog(`[handleYjsUpdate] Yjs update detected. Origin: ${transaction.origin || 'unspecified'}`);
      }

      // Sync helper modules if the change didn't originate from them
      const aiOrigins = ['ai-align', 'ai-style', 'ai-math'];
        if (!aiOrigins.includes(transaction.origin)) {
          syncModulesWithYjs();
      }
      refreshMovableElements();

      // Directly call redrawCanvas without throttling
      redrawCanvas();
      // State update is handled by undoManager listeners now
    };

    // Helper to sync module state from Yjs
    const syncModulesWithYjs = () => {
        if (!yDrawings.value) return;
        const currentStrokes = yDrawings.value.toArray().map(m => ({ id: m.get('id'), ...m.toJSON() })); // Ensure IDs are included if stored in Yjs map keys or properties
        if (gridAlignModule.value?.enabled) gridAlignModule.value.setStrokes(currentStrokes);
        if (handwritingStylerModule.value?.enabled) handwritingStylerModule.value.setStrokes(currentStrokes);
        if (mathRecognizerModule.value?.enabled) mathRecognizerModule.value.setStrokes(currentStrokes);
    };

    const refreshMovableElements = () => {
        if (!yDrawings.value) {
            movableElements.value = [];
            return;
        }
        const filtered = yDrawings.value
            .toArray()
            .filter(map => movableElementTypes.has(map.get('type')))
            .map(map => {
                if (!map.get('id')) {
                    if (!map._tempKey) {
                        const clientId = map.doc?.clientID ?? 'local';
                        map._tempKey = `temp-${clientId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                    }
                } else if (map._tempKey) {
                    delete map._tempKey;
                }
                return map;
            });
        movableElements.value = filtered;
    };

    const findMovableElementIdAtPoint = (coords) => {
        if (!yDrawings.value) return null;
        const elements = yDrawings.value.toArray().slice().reverse();
        for (const elementMap of elements) {
            const type = elementMap.get('type');
            if (!movableElementTypes.has(type)) continue;
            const x = elementMap.get('x');
            const y = elementMap.get('y');
            const width = elementMap.get('width');
            const height = elementMap.get('height');
            if (![x, y, width, height].every(value => typeof value === 'number' && !Number.isNaN(value))) {
                continue;
            }
            const rotation = elementMap.get('rotation') || 0;
            if (isPointInRotatedRectangle(coords, x, y, width, height, rotation)) {
                return elementMap.get('id');
            }
        }
        return null;
    };

    const updateAwarenessUser = (name = latestUsername.value) => {
        if (!yjsConnection.value?.awareness) {
            return;
        }
        const existingUser = yjsConnection.value.awareness.getLocalState()?.user || {};
        const normalizedName = (name && name.trim().length > 0 ? name.trim() : existingUser.name) || 'Anonymous';
        yjsConnection.value.awareness.setLocalStateField('user', {
            ...existingUser,
            name: normalizedName,
            color: existingUser.color || currentColor.value || '#000000'
        });
    };

    const teardownYjsConnection = () => {
        if (yDrawings.value) {
            yDrawings.value.unobserve(handleYjsUpdate);
        }
        if (undoManager.value) {
            undoManager.value.off('stack-item-added', updateGlobalState);
            undoManager.value.off('stack-item-popped', updateGlobalState);
            undoManager.value.destroy();
            undoManager.value = null;
            updateGlobalState();
        }
        if (yjsConnection.value) {
            yjsConnection.value.disconnect();
        }
        yjsConnection.value = null;
        ydoc.value = null;
        yDrawings.value = null;
        activeRoomId.value = null;
        movableElements.value = [];
    };

    const connectToRoom = (targetRoomId) => {
        const normalizedRoomId = targetRoomId?.trim();
        if (!normalizedRoomId) {
            showToast("Room ID missing. Collaboration disabled.", "error");
            return;
        }
        if (normalizedRoomId === activeRoomId.value) {
            return;
        }

        teardownYjsConnection();
        selectedObjectId.value = null;

        try {
            const connection = connectToYjs(normalizedRoomId);
            yjsConnection.value = connection;
            ydoc.value = connection.ydoc;
            yDrawings.value = connection.yDrawings;

            if (!yDrawings.value) {
                throw new Error('Yjs shared drawings array is unavailable.');
            }

            yDrawings.value.observe(handleYjsUpdate);
            activeRoomId.value = normalizedRoomId;
            refreshMovableElements();

            // Ensure modules and undo manager sync with the new document
            syncModulesWithYjs();
            setTimeout(() => {
                initializeUndoManager();
                redrawCanvas();
            }, 100);

            updateAwarenessUser(latestUsername.value);
        } catch (error) {
            console.error("Failed to connect Yjs provider:", error);
            showToast("Error connecting to collaboration session.", "error");
        }
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
      if (clipboardFocusHandler) return;
      clipboardFocusHandler = () => {
        if (clipboardInput.value) {
          clipboardInput.value.focus();
        }
      };
      document.addEventListener('click', clipboardFocusHandler);
    };

    const applyHiDPIScaling = (ratio = devicePixelRatio.value) => {
      if (!canvas.value || !context.value) return;
      const displayWidth = canvasWidth.value;
      const displayHeight = canvasHeight.value;
      if (!displayWidth || !displayHeight) return;

      const scaledWidth = Math.floor(displayWidth * ratio);
      const scaledHeight = Math.floor(displayHeight * ratio);

      canvas.value.width = scaledWidth;
      canvas.value.height = scaledHeight;
      canvas.value.style.width = `${displayWidth}px`;
      canvas.value.style.height = `${displayHeight}px`;

      if (typeof context.value.resetTransform === 'function') {
        context.value.resetTransform();
        context.value.scale(ratio, ratio);
      } else {
        context.value.setTransform(ratio, 0, 0, ratio, 0, 0);
      }

      context.value.lineCap = 'round';
      context.value.lineJoin = 'round';
      context.value.strokeStyle = currentColor.value;
      context.value.lineWidth = currentLineWidth.value;
    };

    const updateCanvasSize = (width, height) => {
      if (!canvas.value || !context.value) return;
      const logicalWidth = Math.floor(width);
      const logicalHeight = Math.floor(height);
      if (logicalWidth <= 0 || logicalHeight <= 0) return;

      const nextRatio = clampDevicePixelRatio();
      const sizeChanged = logicalWidth !== canvasWidth.value || logicalHeight !== canvasHeight.value;
      const ratioChanged = nextRatio !== devicePixelRatio.value;

      if (!sizeChanged && !ratioChanged) {
        return;
      }

      if (sizeChanged) {
        canvasWidth.value = logicalWidth;
        canvasHeight.value = logicalHeight;
      }

      if (ratioChanged) {
        devicePixelRatio.value = nextRatio;
      }

      applyHiDPIScaling(nextRatio);
      redrawCanvas();
    };

    const handleResize = () => {
      const container = containerRef.value;
      if (!container) return;
      updateCanvasSize(container.clientWidth, container.clientHeight);
    };

    const initResizeObserver = () => {
      if (resizeObserver || typeof ResizeObserver === 'undefined') return;
      const target = containerRef.value;
      if (!target) return;
      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const { width, height } = entry.contentRect;
        updateCanvasSize(width, height);
      });
      resizeObserver.observe(target);
    };

    const cancelActiveDrawing = () => {
      if (!isDrawing.value && !currentElementPreview.value) return false;
      isDrawing.value = false;
      currentElementPreview.value = null;
      pointsBuffer.value = [];
      redrawCanvas();
      return true;
    };

    const resetSpacePanState = (shouldRedraw = false) => {
      spacePanActive.value = false;
      if (panStartedWithSpace.value) {
        isPanning.value = false;
        panStartedWithSpace.value = false;
        lastPanPoint.value = null;
        if (shouldRedraw) redrawCanvas();
      }
      updateCursor();
    };

    const startPinchGesture = (touches) => {
      if (touches.length < 2 || !canvas.value) return;
      const rect = canvas.value.getBoundingClientRect();
      const touchA = touches[0];
      const touchB = touches[1];
      if (!touchA || !touchB) return;
      pinchGesture.value = {
        startDistance: getTouchDistance(touchA, touchB),
        initialZoom: zoomLevel.value,
        lastCanvasCenter: getTouchCenter(touchA, touchB, rect),
      };
      if (isDrawing.value) {
        finishDrawing();
      }
      isPanning.value = true;
      panStartedWithSpace.value = false;
      updateCursor();
    };

    const updatePinchGesture = (touches) => {
      if (!pinchGesture.value || touches.length < 2 || !canvas.value) return;
      const rect = canvas.value.getBoundingClientRect();
      const touchA = touches[0];
      const touchB = touches[1];
      if (!touchA || !touchB) return;
      const canvasCenter = getTouchCenter(touchA, touchB, rect);
      const gesture = pinchGesture.value;
      const prevCenter = gesture.lastCanvasCenter || canvasCenter;

      panOffset.value.x += canvasCenter.x - prevCenter.x;
      panOffset.value.y += canvasCenter.y - prevCenter.y;

      const distance = getTouchDistance(touchA, touchB);
      const scale = gesture.startDistance ? distance / gesture.startDistance : 1;
      const targetZoom = clampZoom(gesture.initialZoom * scale);
      const prevZoom = zoomLevel.value;

      const worldX = (canvasCenter.x - panOffset.value.x) / prevZoom;
      const worldY = (canvasCenter.y - panOffset.value.y) / prevZoom;

      zoomLevel.value = targetZoom;
      panOffset.value.x = canvasCenter.x - worldX * zoomLevel.value;
      panOffset.value.y = canvasCenter.y - worldY * zoomLevel.value;
      gesture.lastCanvasCenter = canvasCenter;

      redrawCanvas();
      showStatus(`Zoom: ${Math.round(zoomLevel.value * 100)}%`);
    };

    const endTouchGesture = () => {
      pinchGesture.value = null;
      if (!panStartedWithSpace.value) {
        isPanning.value = false;
      }
      lastPanPoint.value = null;
      updateCursor();
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

    const addSmoothedPenPoint = (coords) => {
      pointsBuffer.value.push(coords);
      if (pointsBuffer.value.length > PEN_SMOOTHING_WINDOW) {
        pointsBuffer.value.shift();
      }
      const len = pointsBuffer.value.length;
      if (!len) {
        return coords;
      }
      const averaged = pointsBuffer.value.reduce(
        (acc, point) => ({
          x: acc.x + point.x,
          y: acc.y + point.y,
        }),
        { x: 0, y: 0 }
      );
      return {
        x: parseFloat((averaged.x / len).toFixed(PEN_COORD_PRECISION)),
        y: parseFloat((averaged.y / len).toFixed(PEN_COORD_PRECISION)),
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

      // Don't handle drawing/panning if a config panel is active
      if (activeConfigPanel.value) return;

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
            const elementsArray = yDrawings.value.toArray(); // Get a JS array
            for (let i = elementsArray.length - 1; i >= 0; i--) {
                const elementMap = elementsArray[i];
                try {
                    // Convert Y.Map to plain object for hit testing
                    const element = {};
                    for (const [key, value] of elementMap.entries()) {
                        element[key] = (value instanceof Y.Map || value instanceof Y.Array) ? value.toJSON() : value;
                    }
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
      shiftPressedAtStart.value = event.shiftKey; 
      startCoordsForShiftLine.value = null; 

      if (activeConfigPanel.value) return;

      const coords = getCoordinates(event);
      const transformedCoords = transformCoordinates(coords.offsetX, coords.offsetY);

      if (event.button === 2) { // Right-click
        event.preventDefault();
        if (isDrawing.value) return; // Don't select if in the middle of drawing a new shape

        const clickedObjectFoundId = findMovableElementIdAtPoint(transformedCoords);
        selectedObjectId.value = clickedObjectFoundId;
        debugLog('[WhiteboardCanvas] Right-click selected:', selectedObjectId.value);
        redrawCanvas(); // To show selection changes on MovableObject
        return;
      }

      const shouldSpacePan = event.button === 0 && spacePanActive.value;
      if (event.button === 1 || (event.button === 0 && event.altKey) || shouldSpacePan) { // Middle mouse, Alt+Left, or Space+Left
        isPanning.value = true;
        lastPanPoint.value = { ...transformedCoords, screenX: coords.offsetX, screenY: coords.offsetY };
        panStartedWithSpace.value = shouldSpacePan;
        event.preventDefault();
        updateCursor();
        return;
      }
      
      if (event.button === 0) { // Left-click
        if (currentTool.value === 'select') {
            const hitObjectId = findMovableElementIdAtPoint(transformedCoords);
            if (hitObjectId) {
                handleObjectSelectionRequest(hitObjectId);
            } else if (selectedObjectId.value) {
                selectedObjectId.value = null;
                redrawCanvas();
            }
            return;
        }

        if (selectedObjectId.value) {
            selectedObjectId.value = null;
        }

        if (currentTool.value === 'eraser') {
            // Eraser logic (hover and click to erase is handled in mouseMove)
            isDrawing.value = true; // Allow dragging eraser over elements
        } else if (currentTool.value === 'mathPlot') {
          openConfigPanel('math', transformedCoords);
        } else if (currentTool.value === 'physicsPlot') {
          openConfigPanel('physics', transformedCoords);
        } else if (currentTool.value === 'coordSystem2D') {
          const elementData = createCoordinateSystem2DElement(transformedCoords);
          addElementFromPanel(elementData);
        } else if (currentTool.value === 'coordSystem3D') {
          const elementData = createCoordinateSystem3DElement(transformedCoords);
          addElementFromPanel(elementData);
        } else {
          startDrawing(event); 
        }
      }
      redrawCanvas();
    };
    
    const handleObjectSelectionRequest = (objectId) => {
      debugLog('[WhiteboardCanvas] Received object selection request for ID:', objectId);
      
      if (currentTool.value === 'eraser') {
        if (yDrawings.value) {
          const elementsArray = yDrawings.value.toArray();
          const index = elementsArray.findIndex(elMap => elMap.get('id') === objectId);
          if (index !== -1) {
            debugLog(`[WhiteboardCanvas] Eraser tool active, erasing element ID ${objectId} at index ${index} due to selection request.`);
            eraseElement(index); 
            if (selectedObjectId.value === objectId) { 
              selectedObjectId.value = null;
            }
          } else {
             debugWarn(`[WhiteboardCanvas] Eraser tool: Element with ID ${objectId} not found for erasure via selection request.`);
          }
        }
        return; 
      }
      selectedObjectId.value = objectId;
      debugLog('[WhiteboardCanvas] Object selected via request:', selectedObjectId.value);
      redrawCanvas();
    };


    const handleMouseUp = (event) => {
      // Don't handle mouse up if a config panel is active
      if (activeConfigPanel.value) return;

      if (isPanning.value) {
        isPanning.value = false;
        lastPanPoint.value = null;
        panStartedWithSpace.value = false;
        updateCursor();
        return;
      }
      if (isDrawing.value) {
         if (currentTool.value === 'eraser') {
             isDrawing.value = false;
         } else {
             finishDrawing();
         }
      }
      redrawCanvas();
    };

    const handleWindowMouseUp = (event) => {
      if (isDrawing.value || isPanning.value) {
        handleMouseUp(event);
      }
    };

    const handleMouseLeave = (event) => {
      // Don't handle mouse leave if a config panel is active
      if (activeConfigPanel.value) return;

      if (isPanning.value) {
        isPanning.value = false;
        lastPanPoint.value = null;
        panStartedWithSpace.value = false;
        updateCursor();
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
       redrawCanvas();
    };

    const handleTouchStart = (event) => {
        if (event.touches.length >= 2) {
            event.preventDefault();
            startPinchGesture(event.touches);
            return;
        }

        if (event.touches.length === 1 && !pinchGesture.value) {
            event.preventDefault();
            const syntheticMouseEvent = {
                clientX: event.touches[0].clientX,
                clientY: event.touches[0].clientY,
                button: 0,
                shiftKey: event.shiftKey,
                altKey: event.altKey,
                preventDefault: () => event.preventDefault(),
            };
            handleMouseDown(syntheticMouseEvent);
        }
    };

    const handleTouchMove = (event) => {
        if (pinchGesture.value && event.touches.length >= 2) {
            event.preventDefault();
            updatePinchGesture(event.touches);
            return;
        }

        if (event.touches.length === 1 && !pinchGesture.value) {
            event.preventDefault();
            const coords = getCoordinates(event);
            const transformedCoords = transformCoordinates(coords.offsetX, coords.offsetY);
            updateLocalAwarenessCursor(transformedCoords);

            if (isDrawing.value) {
                draw(transformedCoords, false);
            }
        }
    };

    const handleTouchEnd = (event) => {
        event.preventDefault();

        if (pinchGesture.value && event.touches.length < 2) {
            endTouchGesture();
        }

        if (event.touches.length === 0) {
            const syntheticMouseEvent = {
                button: 0,
            };
            handleMouseUp(syntheticMouseEvent);
        }

        if (yjsConnection.value?.awareness && event.touches.length === 0) {
            yjsConnection.value.awareness.setLocalStateField('cursor', null);
            const userState = yjsConnection.value.awareness.getLocalState()?.user;
            if (userState) {
                yjsConnection.value.awareness.setLocalStateField('user', userState);
            }
        }
    };

    // --- Drawing Logic (Yjs Integration) ---

    // --- Inline Text Methods ---
    const startInlineText = (coords) => {
      inlineTextEditor.x = coords.x;
      inlineTextEditor.y = coords.y;
      inlineTextEditor.value = '';
      inlineTextEditor.visible = true;
      // Heuristic for font size based on line width or default
      inlineTextEditor.fontSize = currentLineWidth.value * 10 > 20 ? currentLineWidth.value * 10 : 24; 
      
      nextTick(() => {
        if (inlineTextRef.value) {
          inlineTextRef.value.focus();
        }
      });
    };

    const finalizeInlineText = () => {
      if (!inlineTextEditor.visible) return;
      
      const text = inlineTextEditor.value.trim();
      if (text) {
        addTextElement({ x: inlineTextEditor.x, y: inlineTextEditor.y }, text, inlineTextEditor.fontSize);
      }
      
      inlineTextEditor.visible = false;
      inlineTextEditor.value = '';
    };

    const handleInlineTextEnter = (e) => {
      if (!e.shiftKey) {
        e.preventDefault();
        finalizeInlineText();
      }
    };

    const addTextElement = (coords, text, fontSize = 24) => {
       if (!ydoc.value || !yDrawings.value) return;

       const textElement = {
         id: `text-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
         type: 'text',
         x: coords.x,
         y: coords.y,
         text: text,
         color: currentColor.value,
         fontSize: fontSize,
         rotation: 0,
         width: text.length * (fontSize * 0.6), // Approx width
         height: fontSize * 1.2
       };

       ydoc.value.transact(() => {
         const yMap = new Y.Map();
         for (const [key, value] of Object.entries(textElement)) {
           yMap.set(key, value);
         }
         yDrawings.value.push([yMap]);
       }, 'local-add-text');
       
       refreshMovableElements();
    };

    // --- Drawing Logic (Yjs Integration) ---

    const startDrawing = (event) => {
      if (!ydoc.value) return;
      if (currentTool.value === 'select') return;
      // Don't start drawing if a graph tool is selected (handled by handleMouseDown)
      const graphTools = ['mathPlot', 'physicsPlot', 'coordSystem2D', 'coordSystem3D'];
      if (graphTools.includes(currentTool.value)) {
          return;
      }

      const coords = getCoordinates(event);
      const transformedCoords = transformCoordinates(coords.offsetX, coords.offsetY);

      // Handle text tool inline
      if (currentTool.value === 'text') {
        startInlineText(transformedCoords);
        isDrawing.value = false;
        currentElementPreview.value = null;
        return;
      }

      isDrawing.value = true;
      pointsBuffer.value = [];

      let toolType = currentTool.value;
      let elementData = {}; // Object to hold extra data like lineStyle

      // Handle Shift+Pen combination: Keep type 'pen' for now, store start point
      if (toolType === 'pen' && shiftPressedAtStart.value) {
          if (props.debugMode) {
              debugLog("[startDrawing] Shift+Pen detected, storing start point.");
          }
          startCoordsForShiftLine.value = transformedCoords; // Store the starting point
          // Preview element remains 'pen' type initially for simplicity
      } else if (toolType === 'shapes') {
          toolType = props.currentShape; // Use the specific shape from prop
          if (props.debugMode) {
              debugLog(`[startDrawing] Starting shape drawing with type: ${toolType}`);
          }
      } else if (toolType === 'lines') {
          toolType = 'line';
      }

      // If it's a line - always set lineStyle, even if toolType wasn't "lines"
      if (toolType === 'line') {
          elementData.lineStyle = props.currentLineStyle;
          elementData.arrowStyle = props.currentArrowStyle;
          if (props.debugMode) {
              debugLog(`[startDrawing] Line style set to: ${elementData.lineStyle}`);
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
              debugLog("[startDrawing] Preview element created:", JSON.stringify(currentElementPreview.value));
          }
      } else {
          // console.error(`[startDrawing] Failed to create preview element for tool type: ${toolType} with data:`, elementData); // Commented out
          isDrawing.value = false; // Stop drawing if preview failed
          return;
      }
    };

    const eraseElement = (indexOrId) => { // Can now accept index or ID
      if (!ydoc.value || !yDrawings.value) return;

      let elementIndex = -1;
      if (typeof indexOrId === 'number') {
        elementIndex = indexOrId;
      } else if (typeof indexOrId === 'string') {
        elementIndex = yDrawings.value.toArray().findIndex(elMap => elMap.get('id') === indexOrId);
      }
      
      if (elementIndex !== -1 && elementIndex >= 0 && elementIndex < yDrawings.value.length) {
        debugLog(`[eraseElement] Removing element at index: ${elementIndex}`);

        ydoc.value.transact(() => {
          yDrawings.value.delete(elementIndex, 1);
        }, 'local-erase'); 
        refreshMovableElements();

        nextTick(() => {
          if (undoManager.value) {
             updateGlobalState(); 
          }
        });
      } else {
        debugWarn(`[eraseElement] Element not found for index/ID: ${indexOrId}`);
      }
    };

    // Tools that behave like shapes (use start/end points)
    const SHAPE_TOOLS = new Set([
      'rectangle',
      'circle',
      'square',
      'triangle',
      'trapezoid',
      'parallelogram',
      'deltoid',
      'cube',
      'cuboid',
      'sphere',
      'cylinder',
      'cone',
      'pyramid',
      'tetrahedron',
    ]);

    const LINE_TOOLS = new Set(['line']);

    const draw = (coords, isShiftPressed) => { // Accept shift key state
      if (!isDrawing.value || !currentElementPreview.value) return;
      if (currentTool.value === 'eraser') return;

      const preview = currentElementPreview.value;
      const tool = currentTool.value;

      // Update logic based on the actual tool and shift state
      if (tool === 'pen') {
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
              const smoothedPoint = addSmoothedPenPoint(coords);
              preview.points.push(smoothedPoint);
          }
      } else if (SHAPE_TOOLS.has(tool) || LINE_TOOLS.has(tool)) {
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
                  debugLog("[finishDrawing] Shift held with Pen, creating Line element.");
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
                     debugLog(`[finishDrawing] lineStyle missing or needs override, setting from prop: ${styleFromProps}`);
                 }
                 elementToAdd.lineStyle = styleFromProps;
              }
          }

          // Add only if elementToAdd is not null
          if (elementToAdd) {
              // Assign a unique ID before adding to Yjs
              elementToAdd.id = `${yjsConnection.value?.awareness?.clientID || 'local'}-${Date.now()}`;

              if (props.debugMode) {
                  debugLog('[finishDrawing] Final elementToAdd before Yjs transaction:', JSON.stringify(elementToAdd));
              }

              try {
                  ydoc.value.transact(() => {
                      const yElementMap = new Y.Map();

                      // Set basic properties that all elements have
                      yElementMap.set('id', elementToAdd.id); // Store the ID
                      yElementMap.set('type', elementToAdd.type);
                      yElementMap.set('color', elementToAdd.color);
                      yElementMap.set('lineWidth', elementToAdd.lineWidth);
                      yElementMap.set('timestamp', Date.now());
                      yElementMap.set('rotation', 0); // Default rotation

                      // Handle type-specific properties and x, y, width, height
                      if (elementToAdd.type === 'pen') {
                          // Store points as an array (not a Y.Array)
                          yElementMap.set('points', elementToAdd.points);
                          if (elementToAdd.points && elementToAdd.points.length > 0) {
                              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                              elementToAdd.points.forEach(p => {
                                  minX = Math.min(minX, p.x);
                                  minY = Math.min(minY, p.y);
                                  maxX = Math.max(maxX, p.x);
                                  maxY = Math.max(maxY, p.y);
                              });
                              yElementMap.set('x', minX);
                              yElementMap.set('y', minY);
                              yElementMap.set('width', Math.max(0, maxX - minX)); // Ensure non-negative
                              yElementMap.set('height', Math.max(0, maxY - minY)); // Ensure non-negative
                              // Points remain absolute to preserve compatibility with the renderer
                          } else {
                              yElementMap.set('x', 0);
                              yElementMap.set('y', 0);
                              yElementMap.set('width', 0);
                              yElementMap.set('height', 0);
                          }
                      }
                      else if (elementToAdd.type === 'line' || 
                               (elementToAdd.start && elementToAdd.end)) { // Covers shapes
                          const x = Math.min(elementToAdd.start.x, elementToAdd.end.x);
                          const y = Math.min(elementToAdd.start.y, elementToAdd.end.y);
                          const width = Math.abs(elementToAdd.start.x - elementToAdd.end.x);
                          const height = Math.abs(elementToAdd.start.y - elementToAdd.end.y);
                          yElementMap.set('x', x);
                          yElementMap.set('y', y);
                          yElementMap.set('width', width);
                          yElementMap.set('height', height);

                          // Store start/end as nested Y.Maps (can be kept for now)
                          const startMap = new Y.Map();
                          startMap.set('x', elementToAdd.start.x);
                          startMap.set('y', elementToAdd.start.y);
                          yElementMap.set('start', startMap);

                          const endMap = new Y.Map();
                          endMap.set('x', elementToAdd.end.x);
                          endMap.set('y', elementToAdd.end.y);
                          yElementMap.set('end', endMap);

                          if (elementToAdd.type === 'line') {
                            const lineStyle = elementToAdd.lineStyle || props.currentLineStyle || 'solid';
                            yElementMap.set('lineStyle', lineStyle);
                            const arrowStyle = elementToAdd.arrowStyle || props.currentArrowStyle || 'none';
                            yElementMap.set('arrowStyle', arrowStyle);
                          }
                      }
                      // text and image types are handled in their respective functions (addTextElement, addImageFromDataUrl)
                      // and should already have x, y, width, height. We just need to ensure rotation is set.
                      // Plotting elements from addElementFromPanel also need this.

                      // Push to the shared array only if not text/image (handled elsewhere, but they are pushed there)
                      if (elementToAdd.type !== 'text' && elementToAdd.type !== 'image') {
                        yDrawings.value.push([yElementMap]);
                        refreshMovableElements();
                      }

                      if (props.debugMode) {
                          debugLog('[finishDrawing] Successfully pushed Y.Map to yDrawings');
                      }
                  }, 'local-drawing'); // Add origin

                  // Notify helper modules after element is committed
                  if (props.activeFeature && elementToAdd.type !== 'text' && elementToAdd.type !== 'image') {
                      const module = getActiveModule();
                      if (module && module.addStroke) {
                          // Pass the element with its new ID
                          module.addStroke({ ...elementToAdd });
                          // Update UI feedback state if needed (e.g., for styler)
                          if (props.activeFeature === 'styleHandwriting') {
                              emit('update:has-char-groups', false);
                              emit('update:has-stylized-strokes', false);
                          }
                      }
                  }

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
              debugLog('Drawing finished but element was too small or invalid, not adding.');
          }
      }

      currentElementPreview.value = null;
      pointsBuffer.value = [];
      redrawCanvas(); // Redraw to remove the preview
    };

    const handleObjectUpdate = (updatedYMap) => {
      // This function will be called when MovableObject emits an update.
      // The yMap is already updated by MovableObject itself, so we might just need to
      // trigger undo/redo state updates or redraw other parts of the UI if necessary.
      // For now, we can log it.
      debugLog('[WhiteboardCanvas] MovableObject updated:', updatedYMap.toJSON());
      // Potentially update undo/redo state if the change wasn't already part of a transaction
      // that UndoManager is tracking from MovableObject.
      // updateGlobalState(); // This might be redundant if MovableObject uses ydoc.transact
      redrawCanvas(); // Redraw overlays or other elements if needed
    };

    const selectObject = (objectId) => {
      // This was the old @select handler from MovableObject.
      // Its primary selection role is now handled by handleObjectSelectionRequest or right-click.
      debugLog('[WhiteboardCanvas] selectObject (old handler) called with ID:', objectId);
    };


    // --- Tool and Style Setters ---
    const setTool = (tool) => { currentTool.value = tool; updateCursor(); };
    const setColor = (color) => { currentColor.value = color; updateCursor(); };
    const setLineWidth = (width) => { currentLineWidth.value = Number(width) || 2; updateCursor(); };
    const setEraserMode = (mode) => { eraserMode.value = mode; updateCursor(); };

    const updateCursor = () => {
      if (!canvas.value) return;

      if (activeConfigPanel.value) {
        canvas.value.style.cursor = 'default';
        return;
      }

      if (spacePanActive.value) {
        canvas.value.style.cursor = isPanning.value ? 'grabbing' : 'grab';
        return;
      }

      if (isPanning.value) {
        canvas.value.style.cursor = 'grabbing';
        return;
      }

      let toolForCursor = currentTool.value;
      if (toolForCursor === 'shapes') {
          toolForCursor = props.currentShape;
      } else if (toolForCursor === 'lines') {
          toolForCursor = 'line';
      }
      canvas.value.style.cursor = getCursorStyle(toolForCursor, currentColor.value, eraserMode.value);
    };

    // --- Zoom/Pan ---
    const handleZoom = (event) => {
      event.preventDefault();
      if (!canvas.value) return;
      const rect = canvas.value.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      const delta = event.deltaY < 0 ? 1.1 : 0.9;
      const prevZoom = zoomLevel.value;
      const newZoom = clampZoom(prevZoom * delta);
      const zoomRatio = newZoom / prevZoom;

      panOffset.value.x = mouseX - (mouseX - panOffset.value.x) * zoomRatio;
      panOffset.value.y = mouseY - (mouseY - panOffset.value.y) * zoomRatio;
      zoomLevel.value = newZoom;
      redrawCanvas();
      showStatus(`Zoom: ${Math.round(zoomLevel.value * 100)}%`);
    };

    const zoomIn = () => {
        const prevZoom = zoomLevel.value;
        zoomLevel.value = clampZoom(zoomLevel.value * 1.2);
        const centerX = canvasWidth.value / 2;
        const centerY = canvasHeight.value / 2;
        const zoomRatio = zoomLevel.value / prevZoom;
        panOffset.value.x = centerX - (centerX - panOffset.value.x) * zoomRatio;
        panOffset.value.y = centerY - (centerY - panOffset.value.y) * zoomRatio;
        redrawCanvas();
    };

    const zoomOut = () => {
        const prevZoom = zoomLevel.value;
        zoomLevel.value = clampZoom(zoomLevel.value / 1.2);
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

      if (event.code === 'Space') {
        event.preventDefault();
        if (!spacePanActive.value) {
          spacePanActive.value = true;
          updateCursor();
        }
        return;
      }

      if (event.key === 'Escape') {
        let handled = false;
        if (activeConfigPanel.value) {
          closeConfigPanel();
          handled = true;
        }
        handled = cancelActiveDrawing() || handled;
        if (handled) {
          event.preventDefault();
          updateCursor();
          return;
        }
      }

      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.key === '+' || (event.key === '=' && event.shiftKey)) {
          event.preventDefault();
          zoomIn();
          return;
        }
        if (event.key === '-' || event.key === '_') {
          event.preventDefault();
          zoomOut();
          return;
        }
        if (event.key === '0') {
          event.preventDefault();
          resetZoom();
          return;
        }
      }

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

      // Handle Tab or Shift+Enter for accepting ghost answer
      if (event.key === 'Tab' || (event.shiftKey && event.key === 'Enter')) {
          if (props.activeFeature === 'mathRecognizer' && mathRecognizerModule.value) {
              const newStroke = mathRecognizerModule.value.acceptGhostAnswer();
              if (newStroke) {
                  event.preventDefault(); // Prevent default Tab behavior
                  applyMathAnswer(newStroke);
                  return;
              }
          }
      }
    };

    const handleKeyUp = (event) => {
      if (event.code === 'Space' && spacePanActive.value) {
        event.preventDefault();
        resetSpacePanState(true);
      }
    };

    const handleWindowBlur = () => {
      resetSpacePanState(true);
      if (pinchGesture.value) {
        endTouchGesture();
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

    const addImageFromDataUrl = (dataUrl) => {
        if (!ydoc.value || !yDrawings.value) {
            console.error("[addImageFromDataUrl] Error: ydoc or yDrawings not available!");
            showToast("Cannot add image - connection issue", "error");
            return;
        }

        const centerX = (canvasWidth.value / 2 - panOffset.value.x) / zoomLevel.value;
        const centerY = (canvasHeight.value / 2 - panOffset.value.y) / zoomLevel.value;

        createImageElement(dataUrl, centerX, centerY)
            .then(imageData => {
                imageData.id = `${yjsConnection.value?.awareness?.clientID || 'local'}-${Date.now()}`; // Assign ID

                try {
                    ydoc.value.transact(() => {
                        const imageMap = new Y.Map();

                        // Set basic properties
                        imageMap.set('id', imageData.id); // Store ID
                        imageMap.set('type', 'image');
                        imageMap.set('timestamp', Date.now());

                        // Set position (x,y), dimensions, and rotation
                        imageMap.set('x', imageData.x); // Already top-left
                        imageMap.set('y', imageData.y); // Already top-left
                        // The 'position' Y.Map can be removed if x,y are at root, or kept for consistency
                        const posMap = new Y.Map();
                        posMap.set('x', imageData.x);
                        posMap.set('y', imageData.y);
                        imageMap.set('position', posMap); // Keep for now if other parts use it

                        imageMap.set('dataUrl', imageData.dataUrl);
                        imageMap.set('src', imageData.dataUrl);
                        imageMap.set('width', imageData.width);
                        imageMap.set('height', imageData.height);
                        imageMap.set('rotation', 0); // Default rotation

                        yDrawings.value.push([imageMap]);
                        refreshMovableElements();
                    }, 'local-image'); // Specify origin

                    nextTick(() => {
                        redrawCanvas();

                        // Update undo state
                        if (undoManager.value) {
                            updateGlobalState();
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
    const clearCanvas = () => {
        if (ydoc.value && yDrawings.value) {
            if (confirm('Are you sure you want to clear the canvas?')) {
                // debugLog('[clearCanvas] Clearing all elements'); // Commented out

                try {
                    ydoc.value.transact(() => {
                      // Store current length for better performance
                      const length = yDrawings.value.length;
                      if (length > 0) {
                        yDrawings.value.delete(0, length);
                      }
                    }, 'local-clear'); // Add origin
                    refreshMovableElements();

                    showStatus('Canvas cleared');

                    // Po każdej transakcji dodaj (inside try block):
                    nextTick(() => {
                       if (undoManager.value) {
                          updateGlobalState(); // Use the shared function
                       }
                       // Reset helper module states as well
                       gridAlignModule.value?.clear();
                       handwritingStylerModule.value?.clear();
                       mathRecognizerModule.value?.clear();
                       emit('update:has-char-groups', false);
                       emit('update:has-stylized-strokes', false);
                       emit('update:recognition-status', '');
                       emit('update:latex-equation', '');
                       emit('update:solution', '');
                    });
                } catch (error) {
                    // console.error('[clearCanvas] Error clearing canvas:', error); // Commented out
                    showToast("Error clearing canvas.", "error");
                }
            }
        }
    };

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
    const testUndoManager = () => {
      // debugLog("=== TEST UNDOMANAGER ==="); // Commented out

      try {
        if (!ydoc.value || !yDrawings.value) {
          alert("Brak ydoc lub yDrawings!");
          return;
        }

        // debugLog("Dodaję testowy element..."); // Commented out

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
          // debugLog("Test element dodany. canUndo =", undoManager.value?.canUndo()); // Commented out
          alert(`Test wykonany. canUndo = ${canUndo.value}`);
        });
      } catch (error) {
        // console.error("Błąd testu:", error); // Commented out
        alert("Błąd testu: " + error.message);
      }
    };

    // --- Helper module integration ---

    const getActiveModule = () => {
        switch (props.activeFeature) {
            case 'gridAlign': return gridAlignModule.value;
            case 'styleHandwriting': return handwritingStylerModule.value;
            case 'mathRecognizer': return mathRecognizerModule.value;
            default: return null;
        }
    };

    // --- Helper module actions (invoked via App.vue) ---

    const alignToGrid = () => {
        if (!gridAlignModule.value || !ydoc.value || !yDrawings.value) {
            debugWarn('[alignToGrid] Module or Yjs not ready.');
            return;
        }
        debugLog('[alignToGrid] Calling module.alignToGrid()');
        const changedStrokes = gridAlignModule.value.alignToGrid(); // Module calculates changes

        if (changedStrokes && changedStrokes.length > 0) {
            debugLog(`[alignToGrid] Module returned ${changedStrokes.length} changed strokes. Applying to Yjs...`);
            ydoc.value.transact(() => {
                // Iterate through yDrawings directly for potentially better performance/reliability
                for (let i = 0; i < yDrawings.value.length; i++) {
                    const yMap = yDrawings.value.get(i);
                    const strokeId = yMap.get('id');
                    const updatedStroke = changedStrokes.find(s => s.id === strokeId);

                    if (updatedStroke) {
                        debugLog(`[alignToGrid] Updating Y.Map for stroke ID: ${strokeId}`);
                        // Update points in the Y.Map
                        yMap.set('points', updatedStroke.points);
                        yMap.set('aligned', true); // Mark as aligned
      } else {
                        // Log if a changed stroke ID wasn't found in yDrawings (shouldn't happen often)
                        // if (changedStrokes.some(s => s.id === strokeId)) {
                        //     console.warn(`[alignToGrid] Mismatch: Changed stroke ${strokeId} present but not found during Y.Map iteration?`);
                        // }
                    }
                }
            }, 'ai-align'); // Origin for undo/redo

            nextTick(() => {
                debugLog('[alignToGrid] Yjs transaction complete. Updating global state and redrawing.');
                updateGlobalState();
                redrawCanvas(); // Redraw to show aligned strokes
            });
        } else {
             debugLog('[alignToGrid] Module returned no changed strokes.');
             // Still redraw in case baselines visibility changed
             redrawCanvas();
        }
    };

    const groupStrokes = () => {
        if (!handwritingStylerModule.value) return;
        handwritingStylerModule.value.groupStrokes();
        emit('update:has-char-groups', handwritingStylerModule.value.hasCharGroups());
        emit('update:has-stylized-strokes', false); // Reset stylized state
        redrawCanvas(); // Redraw to show group bounds
    };

    const applyStyleTransformation = () => {
        if (!handwritingStylerModule.value) return;
        handwritingStylerModule.value.applyStyleTransformation();
        emit('update:has-stylized-strokes', handwritingStylerModule.value.hasStylizedStrokes());
        redrawCanvas(); // Redraw to show stylized preview
    };

    const confirmStyleChanges = () => {
        if (!handwritingStylerModule.value || !ydoc.value || !yDrawings.value) {
            debugWarn('[confirmStyleChanges] Module or Yjs not ready.');
             return;
        }
         debugLog('[confirmStyleChanges] Calling module.confirmStyleChanges()');
        const updatedStrokes = handwritingStylerModule.value.confirmStyleChanges(); // Module returns updated strokes and resets its internal state

        if (updatedStrokes && updatedStrokes.length > 0) {
             debugLog(`[confirmStyleChanges] Module returned ${updatedStrokes.length} updated strokes. Applying to Yjs...`);
             ydoc.value.transact(() => {
                 // Iterate through yDrawings directly
                 for (let i = 0; i < yDrawings.value.length; i++) {
                    const yMap = yDrawings.value.get(i);
                    const strokeId = yMap.get('id');
                    const updatedStroke = updatedStrokes.find(s => s.id === strokeId);

                    if (updatedStroke) {
                        debugLog(`[confirmStyleChanges] Updating Y.Map for stroke ID: ${strokeId}`);
                        yMap.set('points', updatedStroke.points); // Update points
                    } else {
                         // Log if a changed stroke ID wasn't found in yDrawings
                        // if (updatedStrokes.some(s => s.id === strokeId)) {
                        //    console.warn(`[confirmStyleChanges] Mismatch: Updated stroke ${strokeId} present but not found during Y.Map iteration?`);
                        // }
                    }
                }
            }, 'ai-style'); // Origin

            nextTick(() => {
                debugLog('[confirmStyleChanges] Yjs transaction complete. Updating global state and redrawing.');
                updateGlobalState();
                emit('update:has-stylized-strokes', false); // Update App state
                emit('update:has-char-groups', false);    // Update App state
                redrawCanvas();
            });
        } else {
            debugLog('[confirmStyleChanges] Module returned no updated strokes. Resetting state.');
            // If no strokes were updated (e.g., module error or nothing to confirm), just reset state and redraw
            emit('update:has-stylized-strokes', false);
            emit('update:has-char-groups', false);
            redrawCanvas();
        }
    };

    const cancelStyleChanges = () => {
        if (!handwritingStylerModule.value) return;
        handwritingStylerModule.value.cancelStyleChanges();
        emit('update:has-stylized-strokes', false);
        // Keep char groups? Or reset? Let's reset for now.
        // emit('update:has-char-groups', false);
        redrawCanvas(); // Redraw to show original strokes
    };

    const recognizeEquation = async () => {
        if (!mathRecognizerModule.value) return;
        emit('update:recognition-status', 'Recognizing...');
        emit('update:latex-equation', '');
        emit('update:solution', '');
        try {
            const result = await mathRecognizerModule.value.recognizeEquation();
            emit('update:recognition-status', mathRecognizerModule.value.getRecognitionStatus());
            if (result) {
                // renderLatex is called internally by the module if configured
                // emit('update:latex-equation', result.latex || ''); // Already handled by renderLatex emit
                emit('update:solution', result.solution || '');
            }
        } catch (error) {
             emit('update:recognition-status', `Error: ${error.message}`);
        } finally {
            redrawCanvas(); // Redraw to show ghost answer if generated
        }
    };



    // --- Watchers ---
    watch(() => props.currentShape, (newShape) => {
        if (props.debugMode) {
            debugLog(`[Watch] currentShape changed to: ${newShape}`);
        }
        if (currentTool.value === 'shapes') {
            updateCursor();
        }
    });

    watch(() => props.currentLineStyle, (newLineStyle) => {
        if (props.debugMode) {
            debugLog(`[Watch] currentLineStyle changed to: ${newLineStyle}`);
        }
        if (currentTool.value === 'lines') {
            updateCursor();
        }
    });

    // Feature activation watcher
    watch(() => props.activeFeature, (newFeature, oldFeature) => {
        debugLog(`[Watch] Active feature changed from ${oldFeature} to ${newFeature}`);
        // Disable old module
        const oldModule = getActiveModule(oldFeature); // Pass old feature name
        if (oldModule?.disable) {
            oldModule.disable();
            debugLog(`Disabled module: ${oldFeature}`);
        }

        // Enable new module and sync strokes
        const newModule = getActiveModule(newFeature); // Pass new feature name
        if (newModule?.enable) {
            newModule.enable();
            debugLog(`Enabled module: ${newFeature}`);
            // Sync strokes from Yjs
            if (yDrawings.value) {
                 const currentStrokes = yDrawings.value.toArray().map(m => ({ id: m.get('id'), ...m.toJSON() }));
                 if (newModule.setStrokes) {
                     newModule.setStrokes(currentStrokes);
                     debugLog(`Synced ${currentStrokes.length} strokes to module: ${newFeature}`);
                 }
            }
             // Reset specific UI states when activating a module
             if (newFeature === 'styleHandwriting') {
                 emit('update:has-char-groups', false);
                 emit('update:has-stylized-strokes', false);
             } else if (newFeature === 'mathRecognizer') {
                 emit('update:recognition-status', '');
                 emit('update:latex-equation', '');
                 emit('update:solution', '');
             }
        }
        redrawCanvas(); // Redraw to reflect module state change (e.g., hide/show overlays)
    });

    // Watchers for module options
    watch(() => props.gridAlignOptions, (newOptions) => {
        gridAlignModule.value?.setOptions(newOptions);
        if (props.activeFeature === 'gridAlign') redrawCanvas(); // Redraw if active
    }, { deep: true });

    watch(() => props.handwritingStylerOptions, (newOptions) => {
        handwritingStylerModule.value?.setOptions(newOptions);
        // Re-apply style preview if options change while preview is active
        if (props.activeFeature === 'styleHandwriting' && handwritingStylerModule.value?.hasStylizedStrokes()) {
            applyStyleTransformation();
        }
    }, { deep: true });

    watch(() => props.mathRecognizerOptions, (newOptions) => {
        mathRecognizerModule.value?.setOptions(newOptions);
        if (props.activeFeature === 'mathRecognizer') redrawCanvas(); // Redraw ghost answer with new opacity
    }, { deep: true });

    watch(() => props.roomId, (newRoomId, oldRoomId) => {
        if (newRoomId && newRoomId !== oldRoomId) {
            connectToRoom(newRoomId);
        }
    });

    watch(() => props.username, (newUsername) => {
        latestUsername.value = newUsername;
        updateAwarenessUser(newUsername);
    });


    // --- Lifecycle Hooks ---
    onMounted(() => {
      initCanvas();
      initClipboardHandler();
      initResizeObserver();
      window.addEventListener('resize', handleResize);
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);
      window.addEventListener('paste', handlePaste);
      window.addEventListener('blur', handleWindowBlur);
      window.addEventListener('mouseup', handleWindowMouseUp);
      darkModeObserver.observe(document.body, { attributes: true });
      handleResize(); // Initial resize call

      // Initialize helper modules after context is ready
      if (context.value) {
          gridAlignModule.value = new GridAlignModule(context.value, props.gridAlignOptions);
          handwritingStylerModule.value = new HandwritingStylerModule(context.value, props.handwritingStylerOptions);
          mathRecognizerModule.value = new MathRecognizerModule(context.value, {
              ...props.mathRecognizerOptions,
              renderLatexFn: renderLatex, // Pass the render function
              backendUrl: import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'
          });
          debugLog("Helper modules initialised");
      } else {
          console.error("Failed to initialize helper modules: Canvas context not available.");
      }


      const urlParams = new URLSearchParams(window.location.search);
      const initialRoomId = props.roomId || urlParams.get('room'); // Prefer prop, fallback to URL

      if (initialRoomId) {
        connectToRoom(initialRoomId);
      } else {
        // console.error("WhiteboardCanvas: 'room' parameter missing in URL!"); // Commented out
        showToast("Room ID missing. Collaboration disabled.", "error");
      }
  });

    onBeforeUnmount(() => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      darkModeObserver.disconnect();
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (clipboardFocusHandler) {
        document.removeEventListener('click', clipboardFocusHandler);
        clipboardFocusHandler = null;
      }
      teardownYjsConnection();
    });

    // Expose methods and state for App.vue to call via template ref
    expose({
      // Core state used by App.vue
      yjsConnection,
      undoManager,
      canUndo,
      canRedo,

      // Tool / style setters
      setTool,
      setColor,
      setLineWidth,
      setEraserMode,

      // Undo / redo & canvas control
      undo,
      redo,
      clearCanvas,
      redrawCanvas,

      // Serialization / import-export
      getSerializableState,
      loadState,
      exportAsText,
      importFromText,

      // Media helpers
      addImageFromDataUrl,

      // Misc helpers
      getViewportCenter,
      toggleDebug,

      // Feature actions
      alignToGrid,
      groupStrokes,
      applyStyleTransformation,
      confirmStyleChanges,
      cancelStyleChanges,
      recognizeEquation,
      applyGhostAnswer: (payload) => { 
        const stroke = mathRecognizerModule.value?.applyGhostAnswer();
        if (stroke) applyMathAnswer(stroke);
      },

      // Graph / panel integration
      addElementFromPanel,
    });

    return {
      // Refs
      containerRef,
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
      selectedObjectId,
      movableElements,

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
      handleObjectSelectionRequest,

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
      testUndoManager,

      // Graph/Coord System Panel State & Handlers
      activeConfigPanel,
      configPanelCoords,
      closeConfigPanel,
      addElementFromPanel,

      // MovableObject handlers & selection state
      handleObjectUpdate,
      selectObject, 

      // Inline Text Editor
      inlineTextEditor,
      inlineTextRef,
      inlineTextStyle,
      finalizeInlineText,
      handleInlineTextEnter,

      // Helper action methods (also exposed)
      alignToGrid,
      groupStrokes,
      applyStyleTransformation,
      confirmStyleChanges,
      cancelStyleChanges,
      recognizeEquation,
      applyGhostAnswer: (payload) => { 
            const stroke = mathRecognizerModule.value?.applyGhostAnswer();
            if (stroke) applyMathAnswer(stroke);
      }
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
  /* Ensure container allows absolute positioning of panels */
  position: relative;
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
.toast-warning { background-color: #FF9800; }
.toast-error { background-color: #F44336; }


</style>
