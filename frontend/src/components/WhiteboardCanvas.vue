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
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import * as Y from 'yjs';
import { UndoManager } from 'yjs';
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
    debugMode: { type: Boolean, default: false },
    currentShape: { type: String, default: 'rectangle' }, // Already exists
    currentLineStyle: { type: String, default: 'solid' } // Add currentLineStyle prop
  },
  emits: ['state-updated'],

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
    const lastReleasedElementIndex = ref(-1);
    const currentElementPreview = ref(null);
    const pointsBuffer = ref([]);
    const smoothingFactor = ref(0.2);
    const notifications = ref([]);
    const notificationId = ref(0);
    const clipboardInput = ref(null);
    const imageCache = ref(new Map());
    const hoveredElementIndex = ref(-1);

    // --- Yjs specific state (managed internally) ---
    const yjsConnection = ref(null);
    const ydoc = ref(null);
    const yDrawings = ref(null);
    const undoManager = ref(null);
    const canUndo = ref(false);
    const canRedo = ref(false);


    // --- Methods ---

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

            if (rawPosition instanceof Y.Map) {
                finalPosition = rawPosition.toJSON();
            } else if (rawPosition && typeof rawPosition === 'object' && typeof rawPosition.x === 'number' && typeof rawPosition.y === 'number') {
                finalPosition = rawPosition;
            } else {
                console.error("[redrawCanvas] Image position data is invalid:", rawPosition);
                return;
            }

            element = {
              type: type,
              position: finalPosition,
              dataUrl: elementMap.get('dataUrl'),
              width: elementMap.get('width'),
              height: elementMap.get('height')
            };

        } else {
            try {
                element = elementMap.toJSON ? elementMap.toJSON() : elementMap;
            } catch (e) {
                console.error("Error converting elementMap to JSON:", elementMap, e);
                return;
            }
        }

        if (!element || typeof element !== 'object') {
            console.error("Invalid element data after conversion:", element);
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
      // console.log(`Yjs update detected for drawings. yDrawings length: ${yDrawings.value?.length || 0}. Redrawing.`);
      debouncedRedraw();
      emit('state-updated', {});
    };

    const updateUndoRedoState = () => {
      if (undoManager.value) {
        canUndo.value = undoManager.value.canUndo();
        canRedo.value = undoManager.value.canRedo();
      } else {
        canUndo.value = false;
        canRedo.value = false;
      }
    };

    const initializeUndoManager = () => {
      if (ydoc.value && yDrawings.value instanceof Y.Array) {
        if (undoManager.value) {
          undoManager.value.off('stack-item-added', updateUndoRedoState);
          undoManager.value.off('stack-item-popped', updateUndoRedoState);
          undoManager.value.destroy();
          undoManager.value = null;
        }
        undoManager.value = new UndoManager(yDrawings.value);
        undoManager.value.on('stack-item-added', updateUndoRedoState);
        undoManager.value.on('stack-item-popped', updateUndoRedoState);
        updateUndoRedoState();
        console.log('[Canvas] UndoManager initialized successfully for yDrawings.');
      } else {
        console.warn('[Canvas] Cannot initialize UndoManager: ydoc or yDrawings (Y.Array) not available or not ready.', { ydoc: ydoc.value, yDrawings: yDrawings.value });
        canUndo.value = false;
        canRedo.value = false;
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
      document.addEventListener('click', () => {
        if (clipboardInput.value) clipboardInput.value.focus();
      });
    };

    const handleResize = () => {
      const container = canvas.value?.parentElement;
      if (container) {
        canvasWidth.value = container.clientWidth;
        canvasHeight.value = container.clientHeight;
        nextTick(() => {
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

    const handleKeyDown = (event) => {
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;

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

    onMounted(() => {
      initCanvas();
      initClipboardHandler();
      window.addEventListener('resize', handleResize);
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('paste', handlePaste);
      darkModeObserver.observe(document.body, { attributes: true });
      handleResize();

      const urlParams = new URLSearchParams(window.location.search);
      const roomId = urlParams.get('room');

      if (roomId) {
        try {
          const connection = connectToYjs(roomId);
          yjsConnection.value = connection;
          ydoc.value = connection.ydoc;
          yDrawings.value = connection.yDrawings;
          yDrawings.value.observeDeep(handleYjsUpdate);
          initializeUndoManager();
          redrawCanvas();
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
      yDrawings.value?.unobserveDeep(handleYjsUpdate);
      if (undoManager.value) {
        undoManager.value.off('stack-item-added', updateUndoRedoState);
        undoManager.value.off('stack-item-popped', updateUndoRedoState);
        undoManager.value.destroy();
        undoManager.value = null;
        console.log('[Canvas] UndoManager destroyed');
      }
      yjsConnection.value?.disconnect();
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
        draw(transformedCoords);
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
                    console.error("Error processing element for eraser hover:", elementMap, error);
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
                draw(transformedCoords);
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

      if (toolType === 'shapes') {
          toolType = props.currentShape; // Use the specific shape from prop
          console.log(`[Canvas] Starting shape drawing with type: ${toolType}`);
      } else if (toolType === 'lines') {
          toolType = 'line'; // Base type is 'line'
          elementData.lineStyle = props.currentLineStyle; // Add lineStyle
          console.log(`[Canvas] Starting line drawing with style: ${props.currentLineStyle}`);
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
      } else {
          console.error(`[Canvas] Failed to create preview element for tool type: ${toolType} with data:`, elementData);
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
          ydoc.value.transact(() => {
            yDrawings.value.push([new Y.Map(Object.entries(textElementData))]);
          });
        }
        isDrawing.value = false;
        currentElementPreview.value = null;
      }
    };

    const eraseElement = (index) => {
        if (ydoc.value && yDrawings.value && index >= 0 && index < yDrawings.value.length) {
            ydoc.value.transact(() => {
                console.log(`Erasing element at index: ${index}`);
                yDrawings.value.delete(index, 1);
            });
        }
    };

    const draw = (coords) => {
      if (!isDrawing.value || !currentElementPreview.value) return;
      if (currentTool.value === 'eraser') return;

      const preview = currentElementPreview.value;

      // Update logic based on the actual tool, not just preview type initially
      if (currentTool.value === 'pen') {
          preview.points.push(coords);
          pointsBuffer.value.push(coords);
          if (pointsBuffer.value.length > 3) pointsBuffer.value.shift();
      } else if (currentTool.value === 'shapes' || currentTool.value === 'lines') {
          // Update end coordinates for all shape/line types during drag
          preview.end = coords;

          // Special handling for square to maintain aspect ratio during preview
          if (preview.type === 'square') {
              const dx = Math.abs(coords.x - preview.start.x);
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
      const isValidPen = preview.type === 'pen' && preview.points && preview.points.length > 1;

      if (isValidPen || (preview.type !== 'pen' && isValidElement)) {
          elementToAdd = { ...preview };
          delete elementToAdd.id; // Remove temporary ID

          // Ensure lineStyle is included if it's a line element
          if (elementToAdd.type === 'line' && !elementToAdd.lineStyle) {
              elementToAdd.lineStyle = props.currentLineStyle || 'solid';
          }

          console.log('Adding element to Yjs drawings array:', JSON.stringify(elementToAdd));
          ydoc.value.transact(() => {
              yDrawings.value.push([new Y.Map(Object.entries(elementToAdd))]);
          });
      } else {
          console.log('Drawing finished but element was too small or invalid, not adding.');
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
    // Note: setShape and setLineStyle are handled by props now

    const updateCursor = () => {
      if (canvas.value) {
        let toolForCursor = currentTool.value;
        if (toolForCursor === 'shapes') {
            toolForCursor = props.currentShape;
        } else if (toolForCursor === 'lines') {
            // Maybe use a specific cursor for lines/vectors? For now, use default crosshair.
            toolForCursor = 'line'; // Or keep 'lines' if getCursorStyle handles it
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
        if (!ydoc.value || !yDrawings.value) return;
        const centerX = (canvasWidth.value / 2 - panOffset.value.x) / zoomLevel.value;
        const centerY = (canvasHeight.value / 2 - panOffset.value.y) / zoomLevel.value;
        createImageElement(dataUrl, centerX, centerY).then(imageData => {
             const imageMap = new Y.Map();
             imageMap.set('type', 'image');
             // FIX: Store position as a nested Y.Map for consistency
             const positionMap = new Y.Map();
             positionMap.set('x', imageData.x);
             positionMap.set('y', imageData.y);
             imageMap.set('position', positionMap);
             imageMap.set('dataUrl', imageData.dataUrl);
             imageMap.set('width', imageData.width);
             imageMap.set('height', imageData.height);
             ydoc.value.transact(() => {
                 yDrawings.value.push([imageMap]);
             });
             console.log('Added image Y.Map to yDrawings');
        }).catch(err => {
            console.error("Error creating image element:", err);
            showToast("Failed to process image.", "error");
        });
    };

     const addTextElement = (position, text) => {
        if (!ydoc.value || !yDrawings.value || !text) return;
        const textElementData = createTextElement(
            position,
            text,
            currentColor.value,
            currentLineWidth.value * 10
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
    const clearCanvas = () => {
        if (ydoc.value && yDrawings.value && confirm('Are you sure you want to clear the canvas?')) {
            ydoc.value.transact(() => {
                while (yDrawings.value.length > 0) {
                    yDrawings.value.delete(0);
                }
            });
            showStatus('Canvas cleared');
      }
    };
    const undo = () => {
      if (undoManager.value && undoManager.value.canUndo()) {
        undoManager.value.undo();
        console.log('[Canvas] Undo triggered');
      } else {
        console.log('[Canvas] Cannot undo');
      }
    };
    const redo = () => {
      if (undoManager.value && undoManager.value.canRedo()) {
        undoManager.value.redo();
        console.log('[Canvas] Redo triggered');
      } else {
        console.log('[Canvas] Cannot redo');
      }
    };
    const getSerializableState = () => { return {}; };
    const loadState = (state) => { return false; };
    const exportAsText = () => { return ''; };
    const importFromText = (text) => { return false; };
    const toggleDebug = (enabled) => { };
    const getViewportCenter = () => ({
        x: (canvasWidth.value / 2 - panOffset.value.x) / zoomLevel.value,
        y: (canvasHeight.value / 2 - panOffset.value.y) / zoomLevel.value,
    });


    // --- Watchers ---
    watch(() => props.currentShape, (newShape) => {
        if (currentTool.value === 'shapes') {
            updateCursor();
        }
    });

    // Watch line style changes to update cursor if 'lines' tool is active
    watch(() => props.currentLineStyle, (newLineStyle) => {
        if (currentTool.value === 'lines') {
            updateCursor();
        }
    });

    return {
      // Canvas & Context
      canvas,
      context, // Expose context if needed externally, otherwise keep internal

      // Dimensions
      canvasWidth,
      canvasHeight,

      // Drawing State
      isDrawing,
      currentTool, // Keep internal? Or controlled by parent? Assuming internal for now.
      currentColor, // Keep internal?
      currentLineWidth, // Keep internal?
      currentElementPreview, // Internal preview state
      pointsBuffer, // Internal buffer

      // View State
      zoomLevel,
      panOffset,
      isPanning,
      lastPanPoint, // Internal panning state
      darkMode, // Internal dark mode state

      // Tool Specific State
      eraserMode,
      hoveredElementIndex, // Internal hover state

      // Yjs & Collaboration
      yjsConnection, // Expose connection details if needed
      ydoc, // Expose ydoc if needed
      yDrawings, // Expose yDrawings if needed
      undoManager, // Expose undoManager if needed
      canUndo, // Expose undo state
      canRedo, // Expose redo state
      collaborators: ref(null), // Ref for Collaborators component

      // UI Elements Refs
      clipboardInput,

      // Notifications & Status
      notifications,
      statusMessage,

      // --- Methods ---

      // Input Handlers (Expose if needed, e.g., for testing, otherwise keep internal)
      handleMouseDown,
      handleMouseMove,
      handleMouseUp,
      handleMouseLeave,
      handleZoom,
      handlePaste,
      handleResize, // Expose if parent needs to trigger resize
      handleTouchStart,
      handleTouchMove,
      handleTouchEnd,

      // Drawing Control (Internal)
      // startDrawing, draw, finishDrawing - likely internal

      // Tool Setters (Public API for parent component)
      setTool,
      setColor,
      setLineWidth,
      setEraserMode, // Expose if parent controls eraser mode

      // Zoom/Pan Controls (Public API)
      zoomIn,
      zoomOut,
      resetZoom,

      // Undo/Redo (Public API)
      undo,
      redo,

      // Canvas Actions (Public API)
      clearCanvas,
      showToast, // Expose if parent needs to show toasts
      // showStatus, // Likely internal

      // Data Handling (Public API if needed)
      getSerializableState,
      loadState,
      exportAsText,
      importFromText,
      addImageFromDataUrl, // Expose if parent triggers image adding
      getViewportCenter, // Expose if parent needs viewport info

      // Debugging (Public API if needed)
      toggleDebug,

      // Lifecycle related (Internal)
      // initCanvas, initClipboardHandler, handleYjsUpdate, redrawCanvas etc.

      // Expose redrawCanvas if external trigger is needed
      redrawCanvas, // Added comma
    };
  }, // Added comma
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
