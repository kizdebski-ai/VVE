<template>
  <div
    ref="containerRef"
    class="whiteboard-container"
    :class="{ 'dark-mode': darkMode, 'collaboration-read-only': collaborationReadOnly }"
    :data-input-paint-p95="inputPaintP95Ms == null ? '' : String(inputPaintP95Ms)"
    :data-input-paint-samples="String(inputPaintSampleCount)"
  >
    <div v-if="debugMode" style="position: absolute; top: 5px; left: 5px; z-index: 9999;
     background: rgba(0,0,0,0.7); color: white; padding: 5px; border-radius: 4px; font-size: 12px;">
  UndoManager: CanUndo={{canUndo}}, CanRedo={{canRedo}}
</div>
    <canvas 
      ref="staticCanvas" 
      class="whiteboard-canvas static-layer"
      style="position: absolute; top: 0; left: 0; pointer-events: none; z-index: 0;"
    ></canvas>
    <canvas 
      ref="drawCanvas" 
      class="whiteboard-canvas draw-layer"
      style="position: absolute; top: 0; left: 0; z-index: 1;"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerup="handlePointerUp"
      @pointercancel="handlePointerCancel"
      @lostpointercapture="handleLostPointerCapture"
      @pointerleave="handlePointerLeave"
      @wheel="handleZoom"
      @contextmenu.prevent
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
      :key="elementMap.get('id') || elementMap._tempKey || `fallback-${elementMap.doc?.clientID || 'u'}-${Date.now()}`"
      :object="elementMap"
      :zoom-level="zoomLevel"
      :pan-offset="panOffset"
      :is-selected="elementMap.get('id') === selectedObjectId"
      :interaction-enabled="currentTool === 'select' && !collaborationReadOnly"
      @update:object="handleObjectUpdate"
      @commit-transform="handleCommitTransform"
      @request-select="handleObjectSelectionRequest"
      @clone-object="handleCloneObject"
      @update:snap-guides="handleSnapGuidesUpdate"
      @interaction-start="handleInteractionStart"
      @interaction-end="handleInteractionEnd"
      :snap-targets="snapTargets"
    ></movable-object>
    
    <!-- Snap Guides -->
    <svg v-if="snapGuides.length > 0" class="snap-guides-layer" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1000;">
      <line v-for="(guide, i) in snapGuides" :key="i"
        :x1="transformX(guide.x1)" :y1="transformY(guide.y1)"
        :x2="transformX(guide.x2)" :y2="transformY(guide.y2)"
        stroke="#ff0000" stroke-width="1" stroke-dasharray="4"
      />
    </svg>

    <!-- Inline Text Editor -->
    <textarea
      v-if="inlineTextEditor.visible"
      ref="inlineTextRef"
      v-model="inlineTextEditor.value"
      class="inline-text-editor"
      autofocus
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

    <!-- Connection loading indicator -->
    <div v-if="isConnecting" class="connection-loading">
      <div class="connection-spinner"></div>
      <span>Connecting...</span>
    </div>

    <div
      v-if="collaborationReadOnly"
      class="connection-read-only"
      role="status"
      aria-live="polite"
      data-testid="collaboration-read-only"
    >
      <span class="read-only-dot" aria-hidden="true"></span>
      Tylko podgląd — czekamy na bezpieczną synchronizację
    </div>

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
import { ref, onMounted, onBeforeUnmount, watch, nextTick, shallowRef, reactive, computed, toRaw } from 'vue';
import rough from 'roughjs';
import * as Y from 'yjs';
import { v4 as uuidv4 } from 'uuid';
// jsPDF loaded dynamically only when PDF export is triggered (code splitting)
import 'katex/dist/katex.min.css';
// undoRedoState moved to useUndoRedo composable
import Collaborators from './Collaborators.vue';
import ZoomPanControls from './ZoomPanControls.vue';
import EraserModeControls from './EraserModeControls.vue';
import StatusMessage from './StatusMessage.vue';
// Helper modules
import GridAlignModule from '../modules/GridAlignModule.js';
import HandwritingStylerModule from '../modules/HandwritingStylerModule.js';
import MathRecognizerModule from '../modules/MathRecognizerModule.js';
// DEFAULT_PEN_PRESETS moved to useDrawingEngine composable
// Utils and Services
import { resolveBackendBaseUrl } from '../services/backendUrl';
import { connectToYjs } from '../services/connectToYjs';
import { drawElement, throttle, isPointInElement, distanceToSegment } from '../utils/canvasDrawing.js';
import { isPointInRotatedRectangle } from '../utils/geometry.js';
import {
  createImageElement,
  getCursorStyle,
  createCoordinateSystem2DElement,
  createCoordinateSystem3DElement
} from '../utils/canvasTools.js';
import { drawGrid as drawUtilGrid, computeGridSteps } from '../utils/canvasGrid.js';
import MovableObject from './MovableObject.vue';
import { useNotifications } from '../composables/useNotifications';
import { createWhiteboardSession } from '../board/whiteboardSession';
import { createInputPipeline } from '../board/inputPipeline';
import {
  batchFromPointerEvent,
  prefersReducedMotion,
  viewportFromElement
} from '../board/pointerEventAdapter';
import { suggestProfile } from '../board/inputStyle';
import { normalizeBoardObject, queryObjectsNear } from '@pilot/boardScene';
import { undoRedoState } from '../utils/undoRedoState';
import { useLineBindings } from '../composables/useLineBindings';
import { usePdfExport } from '../composables/usePdfExport';
import { useKeyboardShortcuts } from '../composables/useKeyboardShortcuts';
import { useHelperModules } from '../composables/useHelperModules';
import { useDrawingEngine } from '../composables/useDrawingEngine';


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
    currentRoughness: { type: Number, default: 1 }, // 0 = clean, 1 = default/sloppy
    currentFillColor: { type: String, default: null },
    // Feature configuration
    activeFeature: { type: String, default: null },
    gridAlignOptions: { type: Object, default: () => ({}) },
    handwritingStylerOptions: { type: Object, default: () => ({}) },
    mathRecognizerOptions: { type: Object, default: () => ({}) },
    inputProfile: { type: String, default: 'mouse' },
    // Props from App.vue (already existed)
    roomId: { type: String, required: true },
    roomKey: { type: [String, Object], default: null },
    username: { type: String, default: 'Anonymous' },
    wsToken: { type: String, default: null },
    // Participant document role: 'teacher' | 'student' | 'developer'. Gates
    // Teacher-only document commands (whole-board clear) in the session; the
    // server enforces the same rule authoritatively.
    role: { type: String, default: 'developer' },
    onConnectionStatus: { type: Function, default: null }
  },
  emits: [
    'state-updated',
    'update:recognition-status',
    'update:latex-equation',
    'update:solution',
    'update:has-char-groups',
    'update:has-stylized-strokes',
    'update:active-users',
    'select-pen-preset',
    'pointer-observed',
    'update:input-profile'
  ],
  setup(props, { emit, expose }) {
    const devicePixelRatio = ref(clampDevicePixelRatio());
    
    // Canvas refs
    // Canvas refs
    const containerRef = ref(null);
    const staticCanvas = ref(null);
    const staticContext = ref(null);
    const drawCanvas = ref(null);
    const drawContext = ref(null);
    const canvasWidth = ref(0);
    const canvasHeight = ref(0);

    // Module refs
    const gridAlignModule = ref(null);
    const handwritingStylerModule = ref(null);
    const mathRecognizerModule = ref(null);

    // UI State Refs
    const activeConfigPanel = ref(null);
    const configPanelCoords = ref(null);
    const lastMouseCoords = ref(null); // Track mouse position for auto-text
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
    const focusInlineEditor = () => {
      // Try multiple times in case of layout/nextTick timing
      const tryFocus = (attempt = 0) => {
        const el = inlineTextRef.value;
        if (el) {
          el.focus({ preventScroll: true });
          // Place caret at end to start typing immediately
          const len = el.value?.length ?? 0;
          try { el.setSelectionRange(len, len); } catch (_) { /* Safari etc. */ }
          return;
        }
        if (attempt < 3) {
          requestAnimationFrame(() => tryFocus(attempt + 1));
        }
      };
      requestAnimationFrame(() => tryFocus());
    };

    // --- Computed ---
    const inlineTextStyle = computed(() => {
      const screenX = inlineTextEditor.x * zoomLevel.value + panOffset.value.x;
      const screenY = inlineTextEditor.y * zoomLevel.value + panOffset.value.y;
      const safeColor = currentColor.value || '#000000';
      return {
        position: 'absolute',
        left: `${screenX}px`,
        top: `${screenY}px`,
        fontSize: `${inlineTextEditor.fontSize * zoomLevel.value}px`,
        color: safeColor,
        minWidth: '50px',
        minHeight: '1.2em',
        zIndex: 2000,
        background: 'rgba(255, 255, 255, 0.05)',
        border: '1px dashed rgba(99, 102, 241, 0.4)',
        outline: 'none',
        borderRadius: '2px',
        resize: 'none',
        overflow: 'hidden',
        fontFamily: '"Kalam", cursive', // Hand-like font
        fontWeight: '400',
        lineHeight: '1.2',
        padding: '0',              // Remove padding to match text render
        margin: '0'
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
    // --- Composables ---
    const { statusMessage, notifications, showStatus, showToast } = useNotifications();
    const isConnecting = ref(false);
    const darkMode = ref(false);
    const eraserMode = ref('erase');
    const eraserSize = ref(30);
    const lastReleasedElementIndex = ref(-1);
    // currentElementPreview, pointsBuffer, snapIndicator, shiftPressedAtStart,
    // startCoordsForShiftLine moved to useDrawingEngine composable
    const smoothingFactor = ref(0.65);
    // notifications and notificationId moved to useNotifications composable
    const debugModeEnabled = ref(props.debugMode);
    const debugLog = (...args) => {
      if (debugModeEnabled.value) {
        console.log(...args);
      }
    };
    const debugWarn = (...args) => {
      if (debugModeEnabled.value) {
        console.warn(...args);
      }
    };
    const clipboardInput = ref(null);
    const imageCache = ref(new Map());

    // PDF Export Composable — moved after yDrawings/ydoc declaration (see below)
    // activePenPresetKey, activePenPreset moved to useDrawingEngine composable
    const movableElementTypes = new Set([
        'pen',
        'line',
        'rectangle',
        'diamond',
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
        'physicsDataPlot',
        'latex'
    ]);

    const CONTENT_RENDER_TYPES = new Set([
        'text', 
        'image', 
        'latex', 
        'functionPlot', 
        'mathFunctionPlot', 
        'physicsDataPlot', 
        'coordinateSystem2D', 
        'coordinateSystem3D'
    ]);

    // SHAPE_TOOLS moved to useDrawingEngine composable
    const movableElements = shallowRef([]);
    const hoveredElementIndex = ref(-1);
    const selectedObjectId = ref(null); // Added for selection state
    // Watch selection changes to update DOM elements (placed at setup root to avoid leak)
    watch(selectedObjectId, () => {
        refreshMovableElements();
    });
    const interactingElementId = ref(null); // Track which element is being interacted with (drag/resize/rotate)
    const spacePanActive = ref(false);
    const connectorsVisible = computed(() => currentTool.value === 'lines' || (isDrawing.value && currentElementPreview.value?.type === 'line'));
    const panStartedWithSpace = ref(false);
    const pinchGesture = ref(null);
    let resizeObserver = null;
    let clipboardFocusHandler = null;

    const handleInteractionStart = (id) => {
        interactingElementId.value = id;
        redrawCanvas(); // Force redraw to show ghost
    };

    const handleInteractionEnd = (id) => {
        if (interactingElementId.value === id) {
            interactingElementId.value = null;
            redrawCanvas(); // Force redraw to hide ghost (if selected) or show normal
        }
    };

    // Helper module instances
    const yjsConnection = shallowRef(null);
    const ydoc = shallowRef(null);
    const yDrawings = shallowRef(null);
    const activeRoomId = ref(null);
    const latestUsername = ref(props.username);
    const connectionStatus = ref(props.wsToken ? 'connecting' : 'connected');
    const collaborationReadOnly = computed(() =>
      Boolean(props.wsToken) && connectionStatus.value !== 'connected'
    );
    const canMutateDocument = () =>
      !props.wsToken || yjsConnection.value?.isEditable?.() === true;
    const denyReadOnlyMutation = () => {
      showToast('Tablica jest tylko do odczytu do czasu zakończenia synchronizacji.', 'warning');
      return false;
    };

    // --- WhiteboardSession (VVE-104): the single write path to the document ---
    // Created per connection in connectToRoom; owns typed commands, canonical
    // validation and the participant-scoped undo history.
    const session = shallowRef(null);
    const reflectViewport = (viewport) => {
      zoomLevel.value = viewport.zoom;
      panOffset.value = { x: viewport.panX, y: viewport.panY };
      return viewport;
    };
    const setSessionViewport = (viewport) => reflectViewport(
      session.value?.setViewport(viewport) ?? viewport
    );
    const panSessionBy = (dx, dy) => {
      if (session.value) return reflectViewport(session.value.panBy(dx, dy));
      return setSessionViewport({
        zoom: zoomLevel.value,
        panX: panOffset.value.x + dx,
        panY: panOffset.value.y + dy
      });
    };
    const zoomSessionAt = (screenX, screenY, nextZoom) => {
      if (session.value) return reflectViewport(session.value.zoomAt(screenX, screenY, nextZoom));
      const ratio = nextZoom / zoomLevel.value;
      return setSessionViewport({
        zoom: nextZoom,
        panX: screenX - (screenX - panOffset.value.x) * ratio,
        panY: screenY - (screenY - panOffset.value.y) * ratio
      });
    };
    const resetSessionViewport = () => reflectViewport(
      session.value?.resetViewport() ?? { zoom: 1, panX: 0, panY: 0 }
    );

    // --- PDF Export Composable (after yDrawings/ydoc are declared) ---
    const {
      exportBoardAsPdf, exportBoardAsPdfPaged,
      getSnapshot, getSerializableState, loadState, exportAsText, importFromText,
    } = usePdfExport({ session, yDrawings, ydoc, smoothingFactor, imageCache, showToast, debugLog, debugWarn });
    const canUndo = ref(false);
    const canRedo = ref(false);
    const updateGlobalState = () => {
      const hasUndo = session.value?.canUndo() === true;
      const hasRedo = session.value?.canRedo() === true;
      canUndo.value = hasUndo;
      canRedo.value = hasRedo;
      undoRedoState.update(hasUndo, hasRedo);
    };

    // --- Line Bindings Composable (read-only geometry since VVE-104) ---
    const {
      BINDABLE_ELEMENT_TYPES,
      BINDING_DISTANCE_THRESHOLD,
      getConnectorAnchors,
      findElementMapById,
      getRectFromElementMap,
      findBindingTargetNearPoint,
      attachBindingsToLineDraft,
      computeLineBindingUpdate,
    } = useLineBindings(yDrawings);

    const undo = () => {
      if (!canMutateDocument()) return denyReadOnlyMutation();
      if (session.value?.undo()) {
        nextTick(() => {
          redrawCanvas(true);
          updateGlobalState();
        });
      }
    };
    const redo = () => {
      if (!canMutateDocument()) return denyReadOnlyMutation();
      if (session.value?.redo()) {
        nextTick(() => {
          redrawCanvas(true);
          updateGlobalState();
        });
      }
    };

    // --- Helper Modules Composable (must be before useDrawingEngine because it provides getActiveModule) ---
    const {
      getActiveModule,
      syncModulesWithYjs,
      renderLatex,
      applyMathAnswer,
      alignToGrid,
      groupStrokes,
      applyStyleTransformation,
      confirmStyleChanges,
      cancelStyleChanges,
      recognizeEquation,
    } = useHelperModules({
      gridAlignModule,
      handwritingStylerModule,
      mathRecognizerModule,
      ydoc,
      yDrawings,
      yjsConnection,
      zoomLevel,
      session,
      updateGlobalState,
      redrawCanvas: (...args) => redrawCanvas(...args),
      refreshMovableElements: () => refreshMovableElements(),
      getActiveFeature: () => props.activeFeature,
      getGridAlignOptions: () => props.gridAlignOptions,
      emit,
      debugLog,
      debugWarn,
      showToast,
    });

    // --- Drawing Engine Composable ---
    const {
      currentElementPreview,
      pointsBuffer,
      snapIndicator,
      shiftPressedAtStart,
      startCoordsForShiftLine,
      activePenPresetKey,
      activePenPreset,
      cancelActiveDrawing,
      startDrawing,
      startDrawingAt,
      draw,
      finishDrawing,
      eraseElement,
    } = useDrawingEngine({
      isDrawing,
      currentTool,
      currentColor,
      currentLineWidth,
      zoomLevel,
      panOffset,
      ydoc,
      yDrawings,
      yjsConnection,
      session,
      smoothingFactor,
      debugModeEnabled,
      getCurrentShape: () => props.currentShape,
      getCurrentLineStyle: () => props.currentLineStyle,
      getCurrentRoughness: () => props.currentRoughness,
      getCurrentFillColor: () => props.currentFillColor,
      getCurrentArrowStyle: () => props.currentArrowStyle,
      getActiveFeature: () => props.activeFeature,
      getHandwritingStylerOptions: () => props.handwritingStylerOptions,
      updateGlobalState,
      redrawCanvas: (...args) => redrawCanvas(...args),
      scheduleRedraw: (...args) => scheduleRedraw(...args),
      refreshMovableElements: () => refreshMovableElements(),
      openConfigPanel: (...args) => openConfigPanel(...args),
      startInlineText: (...args) => startInlineText(...args),
      attachBindingsToLineDraft,
      getActiveModule,
      emit,
      debugLog,
      debugWarn,
      showToast,
    });

    // --- Methods ---

    // renderLatex moved to useHelperModules composable


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
      if (!canMutateDocument()) return denyReadOnlyMutation();
      if (!session.value || !elementData || !elementData.type) {
        console.error("Invalid data received from panel or session not ready", elementData);
        closeConfigPanel();
        return;
      }

      try {
        const object = { ...elementData };
        if (!object.id) object.id = uuidv4();

        // Mirror geometry for MovableObject overlays (extension types keep
        // their `position` payload until VVE-106 canonicalizes them)
        const hasPosition = object.position && typeof object.position.x === 'number' && typeof object.position.y === 'number';
        if (hasPosition) {
          object.x = object.position.x;
          object.y = object.position.y;
        }
        if (object.type === 'coordinateSystem3D' && typeof object.size === 'number') {
          const planeSize = object.size * 1.2;
          object.width = planeSize;
          object.height = planeSize;
        }

        const result = session.value.execute({ kind: 'add', object });
        if (!result.ok) {
          showToast(result.message, 'error');
          return;
        }
        refreshMovableElements();

        nextTick(() => {
          updateGlobalState();
          redrawCanvas(true); // Redraw to show the new element
        });
      } finally {
        closeConfigPanel(); // Close panel after adding
      }
    };

    // applyMathAnswer moved to useHelperModules composable


    // Local scene cache to avoid expensive Yjs toJSON calls
    let localScene = [];
    const ELEMENT_COUNT_WARNING = 500;
    let elementCountWarningShown = false;

    const updateLocalScene = (overrideObject = null) => {
        if (!yDrawings.value) {
            localScene = [];
            return;
        }
        // Map Yjs elements to canonical plain objects once. Normalization is
        // the single legacy-intake edge: documents written before VVE-104
        // (aliases like strokeColor/dataUrl/position, relative line points)
        // render through the same canonical shape as new ones.
        const rawArray = yDrawings.value.toArray();
        const snapshot = session.value?.snapshot() ?? rawArray.map(map => normalizeBoardObject(map.toJSON()));
        localScene = snapshot.map(json => {
            if (overrideObject && json.id === overrideObject.id) {
                return { ...json, ...overrideObject };
            }
            return json;
        });

        // UX-006: Warn user when element count is getting high
        if (rawArray.length >= ELEMENT_COUNT_WARNING && !elementCountWarningShown) {
            elementCountWarningShown = true;
            showToast(`Board has ${rawArray.length}+ elements. Performance may degrade.`, "warning");
        } else if (rawArray.length < ELEMENT_COUNT_WARNING) {
            elementCountWarningShown = false;
        }
        
        // Also sync with helper modules if needed
        if (props.activeFeature === 'styleHandwriting' && handwritingStylerModule.value?.hasStylizedStrokes()) {
             // If styler is active, we might need to merge or replace strokes. 
             // For simplicity, let's assume styler handles its own data or we overlay it.
             // But the original code replaced strokesToDraw.
             // Let's keep the original logic but use localScene as base.
        }
    };

    const isElementVisible = (element, viewRect) => {
        let minX, minY, maxX, maxY;

        if (element.type === 'line' && element.start && element.end) {
            minX = Math.min(element.start.x, element.end.x);
            minY = Math.min(element.start.y, element.end.y);
            maxX = Math.max(element.start.x, element.end.x);
            maxY = Math.max(element.start.y, element.end.y);
            const padding = (element.lineWidth || 2) / 2;
            minX -= padding; minY -= padding; maxX += padding; maxY += padding;
        } else if (typeof element.x === 'number' && typeof element.y === 'number'
                   && typeof element.width === 'number' && typeof element.height === 'number') {
            // Use stored bounds (x, y, width, height) - works for pen, shapes, images, text
            minX = element.x;
            minY = element.y;
            maxX = element.x + element.width;
            maxY = element.y + element.height;
            // Add padding for pen strokes that may extend beyond bounds
            const padding = (element.lineWidth || 2);
            minX -= padding; minY -= padding; maxX += padding; maxY += padding;
        } else if (element.points && element.points.length > 0) {
            // Compute bounds from points on the fly (cached via _bounds)
            if (element._bounds) {
                ({ minX, minY, maxX, maxY } = element._bounds);
            } else {
                minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
                for (const pt of element.points) {
                    const px = typeof pt.x === 'number' ? pt.x : (Array.isArray(pt) ? pt[0] : 0);
                    const py = typeof pt.y === 'number' ? pt.y : (Array.isArray(pt) ? pt[1] : 0);
                    if (px < minX) minX = px;
                    if (py < minY) minY = py;
                    if (px > maxX) maxX = px;
                    if (py > maxY) maxY = py;
                }
                const padding = (element.lineWidth || 2);
                minX -= padding; minY -= padding; maxX += padding; maxY += padding;
                // Cache computed bounds on the element for subsequent frames
                element._bounds = { minX, minY, maxX, maxY };
            }
        } else {
            return true; // Default to visible if bounds unknown
        }

        return !(maxX < viewRect.x || minX > viewRect.x + viewRect.width ||
                 maxY < viewRect.y || minY > viewRect.y + viewRect.height);
    };

    const redrawStatic = () => {
      if (!staticContext.value) return;
      const ctx = staticContext.value;
      const ratio = devicePixelRatio.value || 1;
      
      // Ensure base HiDPI transform before clearing
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, canvasWidth.value, canvasHeight.value);
      
      const rc = rough.canvas(ctx.canvas);

      // Draw utility grid
      // Optimization: Grid is drawn on every static redraw. 
      // If grid is heavy, it should be on a separate canvas, but for now it's okay here as it's static.
      drawUtilGrid(ctx, zoomLevel.value, panOffset.value, canvasWidth.value, canvasHeight.value, darkMode.value);

      ctx.save();
      ctx.setTransform(
        zoomLevel.value * ratio, 0,
        0, zoomLevel.value * ratio,
        panOffset.value.x * ratio, panOffset.value.y * ratio
      );

      // Determine strokes to draw
      let strokesToDraw = localScene;
      // debugLog(`[WhiteboardCanvas] redrawStatic: drawing ${strokesToDraw.length} strokes`);
      if (props.activeFeature === 'styleHandwriting' && handwritingStylerModule.value?.hasStylizedStrokes()) {
          strokesToDraw = handwritingStylerModule.value.getStrokes();
      }

      // Calculate view rect in world coordinates for culling
      const viewRect = {
          x: -panOffset.value.x / zoomLevel.value,
          y: -panOffset.value.y / zoomLevel.value,
          width: canvasWidth.value / zoomLevel.value,
          height: canvasHeight.value / zoomLevel.value
      };

      // Draw visible elements
      strokesToDraw.forEach((element) => {
        // Skip elements that are currently rendered by the DOM layer (MovableObject)
        // This prevents double-rendering (e.g. bold text) and ensures complex plots are only in DOM
        const isContentRenderedInDom = CONTENT_RENDER_TYPES.has(element.type);
        const hasDomOverlay = ALWAYS_DOM_TYPES.has(element.type) || element.id === selectedObjectId.value;
        const isInteracting = element.id === interactingElementId.value;
        
        // Skip canvas drawing if it has a DOM overlay (MovableObject)
        // This prevents double rendering since MovableObject renders it (either via content or local canvas)
        if (hasDomOverlay) {
            return;
        }
        
        // Also skip ALL objects (including shapes) that are selected or being interacted with
        // because MovableObject now renders them locally during interaction for smooth manipulation
        if (isInteracting || element.id === selectedObjectId.value) {
            return;
        }
        
        if (!isElementVisible(element, viewRect)) {
            return;
        }

        drawElement(
          ctx,
          element,
          false, // isHighlighted - handled in dynamic layer
          smoothingFactor.value,
          imageCache.value,
          () => invalidate(true), // callback for image load - triggers static redraw
          props.handwritingStylerOptions || {},
          rc
        );
      });
      
      ctx.restore();
    };

    const redrawDynamic = () => {
      if (!drawContext.value) return;
      const ctx = drawContext.value;
      const ratio = devicePixelRatio.value || 1;
      const gridMetrics = computeGridSteps(zoomLevel.value);
      const rc = rough.canvas(ctx.canvas); // Reuse single rc for all dynamic draws

      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, canvasWidth.value, canvasHeight.value);

      ctx.save();
      ctx.setTransform(
        zoomLevel.value * ratio, 0,
        0, zoomLevel.value * ratio,
        panOffset.value.x * ratio, panOffset.value.y * ratio
      );

      // 1. Draw Highlighted Element (Eraser Hover)
      if (hoveredElementIndex.value !== -1 && currentTool.value === 'eraser' && yDrawings.value) {
         const elementMap = yDrawings.value.get(hoveredElementIndex.value);
         if (elementMap) {
             const element = elementMap.toJSON();
             drawElement(
                ctx,
                element,
                true, // isHighlighted
                smoothingFactor.value,
                imageCache.value,
                undefined,
                props.handwritingStylerOptions || {},
                rc
             );
         }
      }

      // 2. Connector handles
      const drawCircle = (x, y, r, fill = 'rgba(99,102,241,0.28)', stroke = 'rgba(99,102,241,0.9)') => {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1 / (zoomLevel.value * (devicePixelRatio.value || 1));
        ctx.fill();
        ctx.stroke();
      };

      const drawConnectorDotsForElement = (element) => {
        const rect = getRectFromElementMap({
          get: (k) => element[k],
        });
        if (!rect) return;
        const anchors = getConnectorAnchors(rect);
        anchors.forEach(({ anchorWorld }) => {
          drawCircle(anchorWorld.x, anchorWorld.y, Math.max(4, 6 / zoomLevel.value));
        });
      };

      // Reuse localScene for connector dots (avoid expensive toArray().toJSON() on every dynamic redraw)
      const strokesToDraw = localScene;

      if (connectorsVisible.value) {
        const connectorElementIds = new Set();
        const collectNearbyElements = (point) => {
          if (!point) return;
          const hits = findBindingTargetNearPoint(point, null, BINDING_DISTANCE_THRESHOLD * 1.1, true);
          hits.forEach((hit) => {
            const elementId = hit?.map?.get?.('id');
            if (elementId) connectorElementIds.add(elementId);
          });
        };

        if (lastMouseCoords.value) collectNearbyElements(lastMouseCoords.value);
        if (isDrawing.value && currentElementPreview.value?.type === 'line') {
          if (currentElementPreview.value.start) collectNearbyElements(currentElementPreview.value.start);
          if (currentElementPreview.value.end) collectNearbyElements(currentElementPreview.value.end);
        }

        if (connectorElementIds.size > 0) {
          strokesToDraw.forEach((element) => {
            const elementId = element.id;
            if (elementId && connectorElementIds.has(elementId) && BINDABLE_ELEMENT_TYPES.has(element.type)) {
              drawConnectorDotsForElement(element);
            }
          });
        }

        if (isDrawing.value && currentElementPreview.value?.type === 'line' && currentElementPreview.value.start && currentElementPreview.value.end) {
          drawCircle(currentElementPreview.value.start.x, currentElementPreview.value.start.y, Math.max(4, 6 / zoomLevel.value), 'rgba(147,197,253,0.35)', 'rgba(37,99,235,0.9)');
          drawCircle(currentElementPreview.value.end.x, currentElementPreview.value.end.y, Math.max(4, 6 / zoomLevel.value), 'rgba(147,197,253,0.35)', 'rgba(37,99,235,0.9)');
        }
      }

      // 3. Draw current preview
      if (isDrawing.value && currentElementPreview.value) {
        drawElement(
          ctx,
          currentElementPreview.value,
          false,
          smoothingFactor.value,
          undefined,
          undefined,
          props.handwritingStylerOptions || {},
          rc
        );
      }

      // 4. Helper overlays
      if (props.activeFeature === 'gridAlign' && gridAlignModule.value) {
        if (props.gridAlignOptions.showBaselines) {
          gridAlignModule.value.setOptions({ ...props.gridAlignOptions, gridSize: gridMetrics.worldGridStep });
          gridAlignModule.value.detectBaselines();
          gridAlignModule.value.drawBaselines(ctx);
        }
      } else if (props.activeFeature === 'styleHandwriting' && handwritingStylerModule.value) {
        handwritingStylerModule.value.drawCharGroups(ctx);
      } else if (props.activeFeature === 'mathRecognizer' && mathRecognizerModule.value) {
        mathRecognizerModule.value.drawGhostAnswer(ctx);
      }

      // 5. Snap Indicator
      if (snapIndicator.value && props.activeFeature === 'gridAlign') {
        const indicator = snapIndicator.value;
        const scale = zoomLevel.value * ratio;
        const worldWidth = canvasWidth.value / zoomLevel.value;
        const worldStartX = -panOffset.value.x / zoomLevel.value;
        ctx.save();
        ctx.lineWidth = 1 / scale;
        ctx.strokeStyle = 'rgba(33, 150, 243, 0.9)';
        ctx.fillStyle = 'rgba(33, 150, 243, 0.15)';

        if (indicator.axis === 'y') {
          const y = indicator.y;
          ctx.beginPath();
          ctx.moveTo(worldStartX, y);
          ctx.lineTo(worldStartX + worldWidth, y);
          ctx.stroke();
          const r = Math.min(indicator.radius || 4, 8 / zoomLevel.value);
          ctx.beginPath();
          ctx.arc(indicator.x ?? worldStartX, y, r, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const fallbackRadius = gridMetrics.worldGridStep * 0.35;
          const r = indicator.radius || fallbackRadius;
          ctx.beginPath();
          ctx.arc(indicator.x, indicator.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(indicator.x, indicator.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }
      
      ctx.restore();
    };

    // --- Render Loop Optimization ---
    let redrawStaticNeeded = false;
    let redrawDynamicNeeded = false;
    let rafId = null;

    const invalidate = (full = false) => {
        redrawDynamicNeeded = true;
        if (full) redrawStaticNeeded = true;
    };

    const redrawCanvas = (full = true) => {
        invalidate(full);
    };

    const scheduleRedraw = (full = false) => {
        invalidate(full);
    };

    const renderLoop = () => {
        rafId = requestAnimationFrame(renderLoop);
        
        if (!redrawStaticNeeded && !redrawDynamicNeeded) return;

        if (redrawStaticNeeded) {
            redrawStatic();
            redrawStaticNeeded = false;
        }
        
        if (redrawDynamicNeeded) {
            redrawDynamic();
            redrawDynamicNeeded = false;
        }
    };

    // syncModulesWithYjs moved to useHelperModules composable

    // Types that MUST be rendered in DOM (interactive elements with MovableObject overlays)
    // Matching commit 60e77346 - ALL shapes need overlays for interaction
    const ALWAYS_DOM_TYPES = new Set([
        // 'text', // Removed to avoid double rendering (Canvas + DOM)
        // 'image', // Removed to avoid double rendering
        'latex', // Kept because Canvas does not render latex
        'functionPlot', 
        'mathFunctionPlot', 
        'physicsDataPlot', 
        'coordinateSystem2D', 
        'coordinateSystem3D',
        // ALL shapes - they are drawn on canvas but need DOM overlays for interaction
        'rectangle',
        'circle',
        'square',
        'triangle',
        'diamond',
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
        'line'
    ]);

    const refreshMovableElements = () => {
        const beforeCount = movableElements.value.length;
        if (!yDrawings.value) {
            movableElements.value = [];
            return;
        }
        
        // Optimization: Only render DOM elements for complex types or the currently selected object.
        // Simple shapes (pen, rect, circle, line) are drawn on canvas and don't need a DOM element unless selected.
        const filtered = yDrawings.value
            .toArray()
            .filter(map => {
                const type = map.get('type');
                const id = map.get('id');
                // Include if it's a complex type OR if it's the currently selected object
                return ALWAYS_DOM_TYPES.has(type) || id === selectedObjectId.value;
            })
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
        // debugLog(`[refreshMovableElements] Updated: before=${beforeCount}, after=${filtered.length}, yDrawings=${yDrawings.value.length}`);
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

    // Setup awareness listener to track other users
    let awarenessRedrawScheduled = false;
    const setupAwarenessListener = () => {
        debugLog('[WhiteboardCanvas] setupAwarenessListener called');
        if (!yjsConnection.value?.awareness) {
            console.warn('[WhiteboardCanvas] No awareness available!');
            return;
        }

        const awareness = yjsConnection.value.awareness;
        debugLog('[WhiteboardCanvas] Setting up awareness listener, clientID:', awareness.clientID);

        // Listen for awareness changes (cursors, online users)
        // Throttled via rAF to avoid full dynamic redraw on every cursor move from every user
        const publishActiveUsers = () => {
            emit('update:active-users', Array.from(awareness.getStates().entries()).map(([clientId, state]) => ({
                clientId,
                user: state?.user || null
            })));
        };
        awareness.on('change', () => {
            publishActiveUsers();
            if (!awarenessRedrawScheduled) {
                awarenessRedrawScheduled = true;
                requestAnimationFrame(() => {
                    awarenessRedrawScheduled = false;
                    redrawCanvas(false); // Cursors are dynamic
                });
            }
        });
        publishActiveUsers();
    };

    const teardownYjsConnection = () => {
        if (yDrawings.value) {
            yDrawings.value.unobserveDeep(handleYjsUpdate);
        }
        if (session.value) {
            session.value.dispose();
            session.value = null;
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
        emit('update:active-users', []);
    };

    const handleYjsUpdate = (event) => {
        // debugLog('[WhiteboardCanvas] Yjs update received', event);
        updateLocalScene(); // Sync local cache
        refreshMovableElements();
        syncModulesWithYjs();
        redrawCanvas(true); // Remote update -> static update

        nextTick(() => updateGlobalState());
    };

    const connectToRoom = async (targetRoomId) => {
        const normalizedRoomId = targetRoomId?.trim();
        if (!normalizedRoomId) {
            showToast("Room ID missing. Collaboration disabled.", "error");
            return;
        }
        if (normalizedRoomId === activeRoomId.value) {
            return;
        }

        teardownYjsConnection();
        session.value?.select(null);
        selectedObjectId.value = null;
        isConnecting.value = true;

        try {
            // Pass roomKey to connectToYjs for E2E encryption
            const connection = await connectToYjs(normalizedRoomId, {
              wsToken: props.wsToken || undefined,
              onMutationDenied: (denial) => {
                // Defense-in-depth path: the session enforces the same rules
                // locally, so an honest client should never see this.
                showToast(
                  denial.reason === 'forbidden'
                    ? 'Serwer odrzucił operację: tylko nauczyciel może wyczyścić tablicę.'
                    : 'Serwer odrzucił nieprawidłową operację.',
                  'error'
                );
              },
              onStatus: (status) => {
                connectionStatus.value = status;
                isConnecting.value = status === 'connecting' || status === 'reconnecting';
                if (status !== 'connected') {
                  // A stroke that started before network loss must not be
                  // committed after the session becomes read-only.
                  isDrawing.value = false;
                  currentElementPreview.value = null;
                  inlineTextEditor.visible = false;
                  inlineTextEditor.value = '';
                }
                if (typeof props.onConnectionStatus === 'function') {
                  props.onConnectionStatus(status);
                }
              }
            });
            yjsConnection.value = connection;
            ydoc.value = connection.ydoc;
            yDrawings.value = connection.yDrawings;

            if (!yDrawings.value) {
                throw new Error('Yjs shared drawings array is unavailable.');
            }

            session.value = createWhiteboardSession({
              ydoc: connection.ydoc,
              role: props.role,
              initialViewport: {
                zoom: zoomLevel.value,
                panX: panOffset.value.x,
                panY: panOffset.value.y
              },
              isEditable: canMutateDocument,
              onHistoryChange: ({ canUndo: nextCanUndo, canRedo: nextCanRedo }) => {
                canUndo.value = nextCanUndo;
                canRedo.value = nextCanRedo;
                undoRedoState.update(nextCanUndo, nextCanRedo);
              }
            });

            yDrawings.value.observeDeep(handleYjsUpdate);
            setupAwarenessListener(); // Enable cursor tracking and online count
            activeRoomId.value = normalizedRoomId;
            updateLocalScene(); // Initial sync
            refreshMovableElements();

            // Ensure helpers and the session view sync with the new document.
            syncModulesWithYjs();
            setTimeout(() => {
                updateGlobalState();
                redrawCanvas(true);
            }, 100);

            updateAwarenessUser(latestUsername.value);
        } catch (error) {
            console.error("Failed to connect Yjs provider:", error);
            showToast("Error connecting to collaboration session.", "error");
        }
    };




    const initCanvas = () => {
      if (staticCanvas.value) {
        staticContext.value = staticCanvas.value.getContext('2d');
        staticContext.value.lineCap = 'round';
        staticContext.value.lineJoin = 'round';
      }
      if (drawCanvas.value) {
        drawContext.value = drawCanvas.value.getContext('2d');
        drawContext.value.lineCap = 'round';
        drawContext.value.lineJoin = 'round';
        drawContext.value.strokeStyle = currentColor.value;
        drawContext.value.lineWidth = currentLineWidth.value;
      }
      
      darkMode.value = document.body.classList.contains('dark-mode');
      redrawCanvas(true);
      updateCursor();
      nextTick(() => {
        const activeEl = document.activeElement;
        if (
          clipboardInput.value &&
          (!activeEl || activeEl === document.body)
        ) {
          clipboardInput.value.focus({ preventScroll: true });
        }
      });
    };

    const initClipboardHandler = () => {
      if (clipboardFocusHandler) return;
      clipboardFocusHandler = (event) => {
        if (!clipboardInput.value) return;

        const target = event?.target;
        const tagName = target?.tagName?.toUpperCase?.() || '';
        const isInteractive =
          tagName === 'INPUT' ||
          tagName === 'TEXTAREA' ||
          target?.isContentEditable;

        // Do not steal focus while typing in any input (including inline text)
        if (isInteractive || inlineTextEditor.visible) return;

        clipboardInput.value.focus({ preventScroll: true });
      };
      document.addEventListener('click', clipboardFocusHandler);
    };

    const applyHiDPIScaling = (ratio = devicePixelRatio.value) => {
      const displayWidth = canvasWidth.value;
      const displayHeight = canvasHeight.value;
      if (!displayWidth || !displayHeight) return;

      const scaledWidth = Math.floor(displayWidth * ratio);
      const scaledHeight = Math.floor(displayHeight * ratio);

      [staticCanvas.value, drawCanvas.value].forEach(cvs => {
        if (!cvs) return;
        cvs.width = scaledWidth;
        cvs.height = scaledHeight;
        cvs.style.width = `${displayWidth}px`;
        cvs.style.height = `${displayHeight}px`;
      });

      [staticContext.value, drawContext.value].forEach(ctx => {
        if (!ctx) return;
        if (typeof ctx.resetTransform === 'function') {
           ctx.resetTransform();
           ctx.scale(ratio, ratio);
        } else {
           ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        }
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      });
      
      if (drawContext.value) {
        drawContext.value.strokeStyle = currentColor.value;
        drawContext.value.lineWidth = currentLineWidth.value;
      }
    };

    const updateCanvasSize = (width, height) => {
      if (!staticCanvas.value || !drawCanvas.value) return;
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
      redrawCanvas(true);
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

    // cancelActiveDrawing moved to useDrawingEngine composable

    const resetSpacePanState = (shouldRedraw = false) => {
      spacePanActive.value = false;
      if (panStartedWithSpace.value) {
        isPanning.value = false;
        panStartedWithSpace.value = false;
        lastPanPoint.value = null;
        if (shouldRedraw) redrawCanvas(true);
      }
      updateCursor();
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
         redrawCanvas(true);
       }
    };

    const darkModeObserver = new MutationObserver(handleDarkModeChange);

    // --- Input Handlers (Pointer Events → InputPipeline) ---

    const getCoordinates = (event) => {
      if (!drawCanvas.value) return { offsetX: 0, offsetY: 0 };
      const rect = drawCanvas.value.getBoundingClientRect();
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

    const inputPipeline = createInputPipeline({
      initialProfile: props.inputProfile === 'pen' ? 'pen' : 'mouse'
    });
    const inputPaintSamples = [];
    const inputPaintP95Ms = ref(null);
    const inputPaintSampleCount = ref(0);
    let pinchStartZoom = 1;
    const capturedPointers = new Set();

    const recordInputPaint = (timeStamp) => {
      if (typeof performance === 'undefined' || !Number.isFinite(timeStamp)) return;
      const dt = performance.now() - timeStamp;
      if (dt >= 0 && dt < 1000) {
        inputPaintSamples.push(dt);
        if (inputPaintSamples.length > 240) inputPaintSamples.shift();
        inputPaintSampleCount.value = inputPaintSamples.length;
        const sorted = [...inputPaintSamples].sort((a, b) => a - b);
        const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
        inputPaintP95Ms.value = sorted[index];
      }
    };

    const inputPaintP95 = () => inputPaintP95Ms.value;

    const lightweightScene = () => {
      if (!yDrawings.value) return [];
      return yDrawings.value.toArray().map((map) => ({
        id: map.get('id'),
        type: map.get('type'),
        x: map.get('x'),
        y: map.get('y'),
        width: map.get('width'),
        height: map.get('height'),
        lineWidth: map.get('lineWidth'),
        points: map.get('points'),
        start: map.get('start'),
        end: map.get('end')
      }));
    };

    const indexOfObjectId = (id) => {
      if (!yDrawings.value || !id) return -1;
      const elements = yDrawings.value.toArray();
      for (let i = 0; i < elements.length; i++) {
        if (elements[i].get('id') === id) return i;
      }
      return -1;
    };

    const hitTestAt = (world) => {
      const radius = Math.max(eraserSize.value / 2, 8);
      const candidates = queryObjectsNear(lightweightScene(), world, radius);
      for (const element of candidates) {
        const hitPadding = Math.max((element.lineWidth || 2) / 2 + 5, eraserSize.value / 2);
        if (isPointInElement(world, element, hitPadding)) return element;
      }
      return null;
    };

    const setEraserHover = (id) => {
      const foundIndex = indexOfObjectId(id);
      if (hoveredElementIndex.value !== foundIndex) {
        hoveredElementIndex.value = foundIndex;
        redrawCanvas(false);
      }
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

    const clearAwarenessCursor = () => {
      if (!yjsConnection.value?.awareness) return;
      yjsConnection.value.awareness.setLocalStateField('cursor', null);
      const userState = yjsConnection.value.awareness.getLocalState()?.user;
      if (userState) {
        yjsConnection.value.awareness.setLocalStateField('user', userState);
      }
    };

    const applyInputIntents = (result) => {
      for (const intent of result.intents) {
        switch (intent.kind) {
          case 'drawStart': {
            lastMouseCoords.value = intent.world;
            updateLocalAwarenessCursor(intent.world);
            recordInputPaint(intent.timeStamp);
            if (activeConfigPanel.value) break;
            if (!canMutateDocument()) {
              denyReadOnlyMutation();
              break;
            }
            if (currentTool.value === 'select') {
              const hitObjectId = findMovableElementIdAtPoint(intent.world);
              if (hitObjectId) {
                handleObjectSelectionRequest(hitObjectId);
              } else if (selectedObjectId.value) {
                session.value?.select(null);
                selectedObjectId.value = null;
                redrawCanvas(false);
              }
              break;
            }
            if (selectedObjectId.value) {
              session.value?.select(null);
              selectedObjectId.value = null;
            }
            if (currentTool.value === 'eraser') {
              isDrawing.value = true;
              const hit = hitTestAt(intent.world);
              setEraserHover(hit?.id);
              if (hit?.id) eraseElement(hit.id);
              break;
            }
            if (currentTool.value === 'mathPlot') {
              openConfigPanel('math', intent.world);
              break;
            }
            if (currentTool.value === 'physicsPlot') {
              openConfigPanel('physics', intent.world);
              break;
            }
            if (currentTool.value === 'coordSystem2D') {
              addElementFromPanel(createCoordinateSystem2DElement(intent.world));
              break;
            }
            if (currentTool.value === 'coordSystem3D') {
              addElementFromPanel(createCoordinateSystem3DElement(intent.world));
              break;
            }
            startDrawingAt(intent.world, intent.timeStamp, { pressure: intent.pressure });
            break;
          }
          case 'drawUpdate': {
            lastMouseCoords.value = intent.world;
            updateLocalAwarenessCursor(intent.world);
            recordInputPaint(intent.timeStamp);
            if (activeConfigPanel.value || !canMutateDocument()) break;
            if (currentTool.value === 'eraser') {
              const hit = hitTestAt(intent.world);
              setEraserHover(hit?.id);
              if (isDrawing.value && hit?.id) eraseElement(hit.id);
            } else {
              draw(
                { ...intent.world, p: intent.pressure },
                intent.shiftKey === true,
                intent.timeStamp
              );
            }
            break;
          }
          case 'drawFinish': {
            recordInputPaint(intent.timeStamp);
            if (currentTool.value === 'eraser') {
              isDrawing.value = false;
            } else if (canMutateDocument()) {
              finishDrawing();
            } else {
              isDrawing.value = false;
              currentElementPreview.value = null;
            }
            snapIndicator.value = null;
            redrawCanvas(true);
            break;
          }
          case 'drawCancel': {
            cancelActiveDrawing();
            isDrawing.value = false;
            snapIndicator.value = null;
            redrawCanvas(false);
            break;
          }
          case 'panStart': {
            isPanning.value = true;
            panStartedWithSpace.value = spacePanActive.value === true;
            lastPanPoint.value = { ...intent.screen, screenX: intent.screen.x, screenY: intent.screen.y };
            updateCursor();
            break;
          }
          case 'panUpdate': {
            panSessionBy(intent.dx, intent.dy);
            lastPanPoint.value = { ...intent.screen, screenX: intent.screen.x, screenY: intent.screen.y };
            redrawCanvas(true);
            break;
          }
          case 'panFinish':
          case 'panCancel': {
            isPanning.value = false;
            lastPanPoint.value = null;
            panStartedWithSpace.value = false;
            updateCursor();
            break;
          }
          case 'pinchStart': {
            pinchStartZoom = zoomLevel.value;
            pinchGesture.value = { pointerIds: intent.pointerIds };
            isPanning.value = true;
            panStartedWithSpace.value = false;
            updateCursor();
            break;
          }
          case 'pinchUpdate': {
            panSessionBy(intent.dx, intent.dy);
            const targetZoom = clampZoom(pinchStartZoom * (intent.scale || 1));
            zoomSessionAt(intent.screen.x, intent.screen.y, targetZoom);
            redrawCanvas();
            showStatus(`Zoom: ${Math.round(zoomLevel.value * 100)}%`);
            break;
          }
          case 'pinchFinish':
          case 'pinchCancel': {
            endTouchGesture();
            break;
          }
          case 'hover': {
            lastMouseCoords.value = intent.world;
            updateLocalAwarenessCursor(intent.world);
            if (currentTool.value === 'eraser' && canMutateDocument()) {
              const hit = hitTestAt(intent.world);
              setEraserHover(hit?.id);
            } else if (hoveredElementIndex.value !== -1) {
              hoveredElementIndex.value = -1;
              redrawCanvas(false);
            }
            break;
          }
          case 'awareness': {
            if (intent.world) updateLocalAwarenessCursor(intent.world);
            else clearAwarenessCursor();
            break;
          }
          default:
            break;
        }
      }
    };

    const pointerViewport = () => {
      if (!drawCanvas.value) return null;
      return viewportFromElement(drawCanvas.value, {
        zoom: zoomLevel.value,
        panX: panOffset.value.x,
        panY: panOffset.value.y
      });
    };

    const ingestPointerEvent = (event, phase) => {
      const viewport = pointerViewport();
      if (!viewport) return;
      const result = inputPipeline.ingest(batchFromPointerEvent(event, {
        phase,
        viewport,
        reducedMotion: prefersReducedMotion(),
        altKey: event.altKey === true,
        shiftKey: event.shiftKey === true,
        spacePan: spacePanActive.value === true,
        panTool: currentTool.value === 'pan',
        smoothPath: currentTool.value === 'pen'
      }));
      applyInputIntents(result);
    };

    const capturePointer = (event) => {
      const target = event.currentTarget;
      if (target && typeof target.setPointerCapture === 'function' && event.pointerId != null) {
        try {
          target.setPointerCapture(event.pointerId);
          capturedPointers.add(event.pointerId);
        } catch {
          /* happy-dom and detached nodes */
        }
      }
    };

    const handleRightClickSelect = (event) => {
      if (isDrawing.value) return;
      const coords = getCoordinates(event);
      const transformedCoords = transformCoordinates(coords.offsetX, coords.offsetY);
      const clickedObjectFoundId = findMovableElementIdAtPoint(transformedCoords);
      session.value?.select(clickedObjectFoundId);
      selectedObjectId.value = session.value?.selectedObjectId() ?? clickedObjectFoundId;
      debugLog('[WhiteboardCanvas] Right-click selected:', selectedObjectId.value);
    };

    const handlePointerDown = (event) => {
      shiftPressedAtStart.value = event.shiftKey;
      startCoordsForShiftLine.value = null;
      emit('pointer-observed', event.pointerType || 'mouse');
      if (event.button === 2) {
        event.preventDefault();
        handleRightClickSelect(event);
        return;
      }
      event.preventDefault();
      capturePointer(event);
      if (activeConfigPanel.value) return;
      ingestPointerEvent(event, 'down');
    };

    const handlePointerMove = (event) => {
      event.preventDefault();
      const phase = event.buttons ? 'move' : 'hover';
      ingestPointerEvent(event, phase);
    };

    const handlePointerUp = (event) => {
      event.preventDefault();
      capturedPointers.delete(event.pointerId);
      ingestPointerEvent(event, 'up');
    };

    const handlePointerCancel = (event) => {
      event.preventDefault();
      capturedPointers.delete(event.pointerId);
      ingestPointerEvent(event, 'cancel');
    };

    const handleLostPointerCapture = (event) => {
      if (!capturedPointers.has(event.pointerId)) return;
      capturedPointers.delete(event.pointerId);
      ingestPointerEvent(event, 'cancel');
    };

    const handlePointerLeave = () => {
      if (isDrawing.value || isPanning.value || pinchGesture.value) return;
      clearAwarenessCursor();
      snapIndicator.value = null;
      if (hoveredElementIndex.value !== -1) {
        hoveredElementIndex.value = -1;
        redrawCanvas(false);
      }
    };

    const cancelPipeline = (reason) => {
      applyInputIntents(inputPipeline.cancel(reason));
      capturedPointers.clear();
    };

    // --- Drawing Logic (Yjs Integration) ---

    // --- Inline Text Methods ---
    const addTextElement = (coords, text, fontSize = 24) => {
      if (!session.value) return;

      const id = session.value.newObjectId();

      try {
        let width = text.length * fontSize * 0.6;
        if (drawContext.value) {
          drawContext.value.save();
          drawContext.value.font = `${fontSize}px "Kalam", cursive`;
          width = drawContext.value.measureText(text).width;
          drawContext.value.restore();
        }
        const result = session.value.execute({
          kind: 'add',
          object: {
            id,
            type: 'text',
            x: coords.x,
            y: coords.y,
            text,
            fontSize,
            color: currentColor.value,
            timestamp: Date.now(),
            rotation: 0,
            width,
            height: fontSize * 1.2
          }
        });
        if (!result.ok) {
          showToast(result.message, 'error');
          return;
        }
        refreshMovableElements();

        nextTick(() => {
            updateGlobalState();
            redrawCanvas(true);
        });
      } catch (error) {
        console.error("Error adding text element:", error);
        showToast("Failed to add text", "error");
      }
    };

    const startInlineText = (coords) => {
      inlineTextEditor.x = coords.x;
      inlineTextEditor.y = coords.y;
      inlineTextEditor.value = '';
      inlineTextEditor.visible = true;
      // Heuristic for font size based on line width or default
      inlineTextEditor.fontSize = currentLineWidth.value * 10 > 20 ? currentLineWidth.value * 10 : 24; 

      // Move focus away from the hidden clipboard input so typing goes to the editor
      if (clipboardInput.value) {
        clipboardInput.value.blur();
      }
      
      nextTick(focusInlineEditor);
    };

    const finalizeInlineText = () => {
      if (!inlineTextEditor.visible) return;
      if (!canMutateDocument()) {
        inlineTextEditor.visible = false;
        inlineTextEditor.value = '';
        return denyReadOnlyMutation();
      }
      
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



    // startDrawing, eraseElement moved to useDrawingEngine composable

    // LINE_TOOLS, draw, finishDrawing moved to useDrawingEngine composable

    const handleObjectUpdate = (preview) => {
      if (!preview) return;
      // MovableObject emits plain preview geometry while a gesture is active.
      // The final pointer-up emits commit-transform and crosses the session
      // Interface exactly once.
      updateLocalScene(preview instanceof Y.Map ? null : preview);
      redrawCanvas();
    };

    const handleCommitTransform = (payload) => {
      if (!canMutateDocument()) return denyReadOnlyMutation();
      if (!session.value || !payload?.id) return;

      let command;
      if (payload.kind === 'line-endpoints') {
        const binding = computeLineBindingUpdate(
          payload.id,
          payload.start,
          payload.end,
          payload.lineWidth
        );
        command = {
          kind: 'setLineEndpoints',
          id: String(payload.id),
          start: binding.start,
          end: binding.end,
          startBinding: binding.startBinding,
          endBinding: binding.endBinding
        };
      } else {
        command = { ...payload, id: String(payload.id) };
        delete command.lineWidth;
      }

      const result = session.value.execute(command);
      if (!result.ok) showToast(result.message, 'error');
      refreshMovableElements();
      updateLocalScene();
      redrawCanvas(true);
      nextTick(updateGlobalState);
    };

    const handleCloneObject = (objectData) => {
      if (!canMutateDocument()) return denyReadOnlyMutation();
      if (!session.value || !objectData?.id) return;
      const newId = session.value.newObjectId();
      const result = session.value.execute({
        kind: 'clone',
        id: String(objectData.id),
        newId,
        offset: 20
      });
      if (!result.ok) {
        showToast(result.message, 'error');
        return;
      }

      refreshMovableElements();
      redrawCanvas();
      nextTick(updateGlobalState);
      debugLog('[handleCloneObject] Cloned element', objectData.id, '->', newId);
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
    const setEraserSize = (size) => { eraserSize.value = Number(size) || 30; };

    const updateCursor = () => {
      if (!drawCanvas.value) return;

      if (activeConfigPanel.value) {
        drawCanvas.value.style.cursor = 'default';
        return;
      }

      if (spacePanActive.value || currentTool.value === 'pan') {
        drawCanvas.value.style.cursor = isPanning.value ? 'grabbing' : 'grab';
        return;
      }

      if (isPanning.value) {
        drawCanvas.value.style.cursor = 'grabbing';
        return;
      }

      let toolForCursor = currentTool.value;
      if (toolForCursor === 'shapes') {
          toolForCursor = props.currentShape;
      } else if (toolForCursor === 'lines') {
          toolForCursor = 'line';
      }
      drawCanvas.value.style.cursor = getCursorStyle(toolForCursor, currentColor.value, eraserMode.value);
    };

    // --- Zoom/Pan ---
    const handleZoom = (event) => {
      event.preventDefault();
      if (!drawCanvas.value) return;
      const rect = drawCanvas.value.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      const delta = event.deltaY < 0 ? 1.1 : 0.9;
      const prevZoom = zoomLevel.value;
      const newZoom = clampZoom(prevZoom * delta);
      zoomSessionAt(mouseX, mouseY, newZoom);
      redrawCanvas();
      showStatus(`Zoom: ${Math.round(zoomLevel.value * 100)}%`);
    };

    const zoomIn = () => {
        const nextZoom = clampZoom(zoomLevel.value * 1.2);
        const centerX = canvasWidth.value / 2;
        const centerY = canvasHeight.value / 2;
        zoomSessionAt(centerX, centerY, nextZoom);
        redrawCanvas();
    };

    const zoomOut = () => {
        const nextZoom = clampZoom(zoomLevel.value / 1.2);
        const centerX = canvasWidth.value / 2;
        const centerY = canvasHeight.value / 2;
        zoomSessionAt(centerX, centerY, nextZoom);
        redrawCanvas();
    };

    const resetZoom = () => {
        resetSessionViewport();
        redrawCanvas();
    };

    // --- Keyboard Handlers (inline, using useKeyboardShortcuts logic) ---
    const { handleKeyDown, handleKeyUp, handleWindowBlur } = useKeyboardShortcuts({
      currentTool,
      inlineTextEditor,
      spacePanActive,
      activeConfigPanel,
      pinchGesture,
      getActiveFeature: () => props.activeFeature,
      mathRecognizerModule,
      zoomIn,
      zoomOut,
      resetZoom,
      setTool,
      cancelActiveDrawing: () => {
        cancelPipeline('gesture');
        return cancelActiveDrawing();
      },
      closeConfigPanel,
      undo,
      redo,
      updateCursor,
      resetSpacePanState,
      endTouchGesture,
      applyMathAnswer,
      selectPenPreset: (presetKey) => emit('select-pen-preset', presetKey),
    });
    const onWindowBlur = () => {
      handleWindowBlur();
      cancelPipeline('blur');
    };

    // --- Other Actions ---
    const handlePaste = (event) => {
       event.preventDefault();
       if (!canMutateDocument()) return denyReadOnlyMutation();
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

    const MAX_IMAGE_DATAURL_BYTES = 5 * 1024 * 1024; // 5 MB limit for base64 dataUrl

    const addImageFromDataUrl = (dataUrl) => {
        if (!canMutateDocument()) return denyReadOnlyMutation();
        if (!session.value) {
            console.error("[addImageFromDataUrl] Error: session not available!");
            showToast("Cannot add image - connection issue", "error");
            return;
        }

        // SEC-003: Validate image size before syncing via Yjs
        if (typeof dataUrl === 'string' && dataUrl.length > MAX_IMAGE_DATAURL_BYTES) {
            const sizeMB = (dataUrl.length / (1024 * 1024)).toFixed(1);
            showToast(`Image too large (${sizeMB} MB). Maximum is 5 MB.`, "error");
            return;
        }

        const centerX = (canvasWidth.value / 2 - panOffset.value.x) / zoomLevel.value;
        const centerY = (canvasHeight.value / 2 - panOffset.value.y) / zoomLevel.value;

        createImageElement(dataUrl, centerX, centerY)
            .then(imageData => {
                imageData.id = session.value.newObjectId();

                try {
                    const result = session.value.execute({
                      kind: 'add',
                      object: {
                        id: imageData.id,
                        type: 'image',
                        timestamp: Date.now(),
                        x: imageData.x,
                        y: imageData.y,
                        src: imageData.dataUrl,
                        width: imageData.width,
                        height: imageData.height,
                        rotation: 0
                      }
                    });
                    if (!result.ok) {
                      showToast(result.message, 'error');
                      return;
                    }
                    refreshMovableElements();

                    nextTick(() => {
                        redrawCanvas();
                        updateGlobalState();
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

    // showStatus and showToast moved to useNotifications composable

    // --- Public methods exposed via ref ---
    const clearCanvas = (options = {}) => {
        if (!canMutateDocument()) return denyReadOnlyMutation();
        const skipConfirm = options?.skipConfirm === true;
        if (!session.value) {
            showToast("Tablica nie jest jeszcze gotowa do wyczyszczenia.", "warning");
            return;
        }
        if (!skipConfirm && !confirm('Czy na pewno chcesz wyczyścić całą tablicę?')) {
            return;
        }

        try {
            const result = session.value.execute({ kind: 'clear' });
            if (!result.ok) {
              showToast(result.message, 'error');
              return;
            }
            session.value.select(null);
            selectedObjectId.value = null;
            snapGuides.value = [];
            refreshMovableElements();
            redrawCanvas();
            showStatus('Tablica została wyczyszczona');

            // After each transaction make sure global state and helpers are reset
            nextTick(() => {
               updateGlobalState();
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
            showToast("Nie udało się wyczyścić tablicy.", "error");
        }
    };

    // PDF export helpers (normalizePointForBounds, getElementBounds, getSceneBounds,
    // preloadImagesForExport, EXPORT_DPI, PAGE_PX, PDF_IMAGE_COMPRESSION,
    // drawGridForExport) moved to usePdfExport composable

    // exportBoardAsPdf, exportBoardAsPdfPaged, getSnapshot, getSerializableState,
    // loadState, exportAsText, importFromText moved to usePdfExport composable

    const toggleDebug = (enabled) => {
        debugModeEnabled.value = enabled;
        redrawCanvas();
    };

    const getViewportCenter = () => ({
        x: (canvasWidth.value / 2 - panOffset.value.x) / zoomLevel.value,
        y: (canvasHeight.value / 2 - panOffset.value.y) / zoomLevel.value,
    });
    const testUndoManager = () => {
      try {
        if (!session.value) {
          alert("Brak aktywnej sesji tablicy!");
          return;
        }
        const result = session.value.execute({
          kind: 'add',
          object: {
            id: session.value.newObjectId(),
            type: 'rectangle',
            x: 100,
            y: 100,
            width: 100,
            height: 100,
            rotation: 0,
            timestamp: Date.now(),
            color: '#ff0000',
            lineWidth: 2
          }
        });
        if (!result.ok) throw new Error(result.message);

        nextTick(() => {
          updateGlobalState();
          alert(`Test wykonany. canUndo = ${canUndo.value}`);
        });
      } catch (error) {
        // console.error("Błąd testu:", error); // Commented out
        alert("Błąd testu: " + error.message);
      }
    };

    // --- Helper module integration (moved to useHelperModules composable) ---

    // alignToGrid, groupStrokes, applyStyleTransformation, confirmStyleChanges, cancelStyleChanges, recognizeEquation moved to useHelperModules composable
    // --- Watchers ---
    watch(() => props.debugMode, (newDebug) => {
        debugModeEnabled.value = newDebug;
        redrawCanvas();
    });

    watch(() => props.currentShape, (newShape) => {
        if (debugModeEnabled.value) {
            debugLog(`[Watch] currentShape changed to: ${newShape}`);
        }
        if (currentTool.value === 'shapes') {
            updateCursor();
        }
    });

    watch(() => props.currentLineStyle, (newLineStyle) => {
        if (debugModeEnabled.value) {
            debugLog(`[Watch] currentLineStyle changed to: ${newLineStyle}`);
        }
        if (currentTool.value === 'lines') {
            updateCursor();
        }
    });

    // Feature activation watcher
    watch(() => props.activeFeature, (newFeature, oldFeature) => {
        debugLog(`[Watch] Active feature changed from ${oldFeature} to ${newFeature}`);
        snapIndicator.value = null;
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
        const sanitized = newOptions ? {
            angleNormalization: newOptions.angleNormalization,
            heightNormalization: newOptions.heightNormalization,
            widthNormalization: newOptions.widthNormalization,
            smoothingFactor: newOptions.smoothingFactor,
            groupingTimeThreshold: newOptions.groupingTimeThreshold,
            groupingDistanceThreshold: newOptions.groupingDistanceThreshold
        } : {};
        handwritingStylerModule.value?.setOptions(sanitized);
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

    watch(() => props.inputProfile, (next) => {
      if (next === 'pen' || next === 'mouse') {
        inputPipeline.configure(next);
      }
    });

    watch(() => props.username, (newUsername) => {
        latestUsername.value = newUsername;
        updateAwarenessUser(newUsername);
    });


    // --- Lifecycle Hooks ---
    onMounted(() => {
      renderLoop();
      initCanvas();
      initClipboardHandler();
      initResizeObserver();
      window.addEventListener('resize', handleResize);
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);
      window.addEventListener('paste', handlePaste);
      window.addEventListener('blur', onWindowBlur);
      darkModeObserver.observe(document.body, { attributes: true });
      handleResize(); // Initial resize call

      // Initialize helper modules after context is ready
      if (drawContext.value) {
          gridAlignModule.value = new GridAlignModule(drawContext.value, props.gridAlignOptions);
          const stylerOpts = props.handwritingStylerOptions ? {
              angleNormalization: props.handwritingStylerOptions.angleNormalization,
              heightNormalization: props.handwritingStylerOptions.heightNormalization,
              widthNormalization: props.handwritingStylerOptions.widthNormalization,
              smoothingFactor: props.handwritingStylerOptions.smoothingFactor,
              groupingTimeThreshold: props.handwritingStylerOptions.groupingTimeThreshold,
              groupingDistanceThreshold: props.handwritingStylerOptions.groupingDistanceThreshold
          } : {};
          handwritingStylerModule.value = new HandwritingStylerModule(drawContext.value, stylerOpts);
          mathRecognizerModule.value = new MathRecognizerModule(drawContext.value, {
              ...props.mathRecognizerOptions,
              renderLatexFn: renderLatex, // Pass the render function
              backendUrl: resolveBackendBaseUrl()
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
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('blur', onWindowBlur);
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
      cancelPipeline('dispose');
      inputPipeline.dispose();
    });

    const snapGuides = ref([]);
    
    const handleSnapGuidesUpdate = (guides) => {
        snapGuides.value = guides;
    };
    
    const transformX = (x) => x * zoomLevel.value + panOffset.value.x;
    const transformY = (y) => y * zoomLevel.value + panOffset.value.y;

    const snapTargets = computed(() => {
      if (!selectedObjectId.value || !yDrawings.value) return { vertical: [], horizontal: [] };
      
      const targets = { vertical: [], horizontal: [] };
      yDrawings.value.forEach(el => {
        if (el.get('id') === selectedObjectId.value) return; // Skip self
        
        const x = el.get('x');
        const y = el.get('y');
        const w = el.get('width');
        const h = el.get('height');
        
        if (x === undefined || y === undefined || w === undefined || h === undefined) return;
        
        targets.vertical.push(x, x + w/2, x + w);
        targets.horizontal.push(y, y + h/2, y + h);
      });
      return targets;
    });

    const handleObjectSelectionRequest = (id) => {
      if (session.value?.select(String(id)) === false) return;
      selectedObjectId.value = session.value?.selectedObjectId() ?? id;
      redrawCanvas();
    };

    const publicApi = {
      // Refs
      containerRef,
      staticCanvas,
      drawCanvas,

      // State
      roomId: props.roomId, // Expose roomId for AI Panel
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
      connectionStatus,
      collaborationReadOnly,
      canUndo,
      canRedo,
      selectedObjectId,
      movableElements,

      // Methods
      handlePointerDown,
      handlePointerMove,
      handlePointerUp,
      handlePointerCancel,
      handleZoom,
      handlePaste,
      handleResize,
      handleObjectSelectionRequest,
      handleCloneObject,
      handleCommitTransform,
      inputPaintP95,
      inputPaintP95Ms,
      inputPaintSampleCount,

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
      getSnapshot,
      getSerializableState,
      loadState,
      exportAsText,
      importFromText,
      exportBoardAsPdf,
      exportBoardAsPdfPaged,
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
      handleInteractionStart,
      handleInteractionEnd,
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
      // Snap guides
      snapTargets,
      snapGuides,
      handleSnapGuidesUpdate,
      transformX,
      transformY,

      // Connection state
      isConnecting,
      
      applyGhostAnswer: (payload) => { 
            const stroke = mathRecognizerModule.value?.applyGhostAnswer();
            if (stroke) applyMathAnswer(stroke);
      }
    };

    expose(publicApi);
    return publicApi;
  }
};

// detachLineBindings moved to useLineBindings composable (was incorrectly outside setup scope)

</script>

<style scoped>
.whiteboard-container {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: #f8f9fa;
  touch-action: none;
  user-select: none;
  overscroll-behavior: none;
}

.whiteboard-container.dark-mode {
  background-color: #121212;
}

.whiteboard-canvas {
  position: absolute;
  top: 0;
  left: 0;
  cursor: crosshair;
  touch-action: none;
}

.inline-text-editor {
  position: absolute;
  background: transparent;
  border: 1px dashed #007bff;
  outline: none;
  padding: 0;
  margin: 0;
  resize: none;
  overflow: hidden;
  font-family: 'Kalam', cursive;
  line-height: 1.2;
  z-index: 100;
  color: black;
}

.clipboard-input {
  position: absolute;
  top: -9999px;
  left: -9999px;
  opacity: 0;
}

.notifications {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 2000;
  pointer-events: none;
}

.notification {
  background: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 10px 20px;
  border-radius: 4px;
  font-size: 14px;
  pointer-events: auto;
  transition: all 0.3s ease;
}

.notification.info { background: rgba(33, 150, 243, 0.9); }
.notification.success { background: rgba(76, 175, 80, 0.9); }
.notification.warning { background: rgba(255, 152, 0, 0.9); }
.notification.error { background: rgba(244, 67, 54, 0.9); }

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s, transform 0.3s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

.ai-assistant-toggle {
  position: absolute;
  top: 20px;
  right: 20px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: white;
  border: 1px solid #ddd;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  cursor: pointer;
  z-index: 1000;
  transition: transform 0.2s;
}

.ai-assistant-toggle:hover {
  transform: scale(1.1);
}

.dark-mode .ai-assistant-toggle {
  background: #333;
  border-color: #555;
}

.connection-loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  z-index: 3000;
  font-size: 14px;
  pointer-events: none;
}

.connection-read-only {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3100;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: calc(100% - 32px);
  padding: 9px 14px;
  border: 1px solid rgba(180, 125, 25, 0.28);
  border-radius: 999px;
  background: rgba(255, 248, 225, 0.94);
  color: #704d0b;
  box-shadow: 0 8px 24px rgba(74, 50, 8, 0.14);
  backdrop-filter: blur(12px);
  font-size: 13px;
  font-weight: 650;
  white-space: nowrap;
  pointer-events: none;
}

.read-only-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #d6941b;
  box-shadow: 0 0 0 4px rgba(214, 148, 27, 0.14);
}

.dark-mode .connection-read-only {
  border-color: rgba(236, 181, 72, 0.32);
  background: rgba(49, 39, 20, 0.94);
  color: #f6d58f;
}

@media (max-width: 720px) {
  .connection-read-only {
    top: 10px;
    max-width: calc(100% - 20px);
    white-space: normal;
    text-align: center;
  }
}

.connection-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>

<style>
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

.inline-text-editor {
  color: #0f172a;
  background: #ffffff;
  border: 1px dashed #94a3b8;
}

.inline-text-editor::placeholder {
  color: #94a3b8;
}
</style>
