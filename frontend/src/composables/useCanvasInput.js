// frontend/src/composables/useCanvasInput.js
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { throttle, isPointInElement } from '../utils/canvasDrawing'; // Assuming isPointInElement is here
import * as Y from 'yjs'; // Need Yjs types for checking elementMap

export function useCanvasInput(canvasRef, zoomLevel, panOffset, currentTool, currentShape, currentLineStyle, eraserMode, yDrawings, options = {}) {
  const {
    onStartDrawing,
    onDraw,
    onFinishDrawing,
    onStartPanning,
    onPan,
    onFinishPanning,
    onHoverElement, // Callback(index) -> index is number or -1
    onEraseElement, // Callback(index)
    onActivateTool, // Callback(toolType, coords) -> e.g., for plot tools
    debugMode = false
  } = options;

  const isDrawing = ref(false);
  const isPanning = ref(false);
  const lastPanPoint = ref(null); // Stores { screenX, screenY }
  const shiftPressedAtStart = ref(false);
  const startCoordsForShiftLine = ref(null); // Stores transformed { x, y }
  const hoveredElementIndex = ref(-1);
  const internalCanvasRef = ref(null); // Internal ref to attach/detach listeners

  // --- Coordinate Helpers ---
  const getCoordinates = (event) => {
    if (!internalCanvasRef.value) return { offsetX: 0, offsetY: 0 };
    const rect = internalCanvasRef.value.getBoundingClientRect();
    let clientX, clientY;

    if (event.touches && event.touches[0]) {
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
    } else {
      clientX = event.clientX;
      clientY = event.clientY;
    }
    return {
      offsetX: clientX - rect.left,
      offsetY: clientY - rect.top
    };
  };

  const transformCoordinates = (x, y) => {
    return {
      x: (x - panOffset.value.x) / zoomLevel.value,
      y: (y - panOffset.value.y) / zoomLevel.value
    };
  };

  // --- Eraser Hover Logic ---
  const checkEraserHover = (transformedCoords) => {
    let foundIndex = -1;
    if (yDrawings.value && currentTool.value === 'eraser') {
      // Iterate backwards to find the topmost element
      for (let i = yDrawings.value.length - 1; i >= 0; i--) {
        const elementMap = yDrawings.value.get(i);
        if (!elementMap || typeof elementMap.get !== 'function') continue; // Skip if not a Y.Map

        try {
          // Convert Y.Map/Y.Array to plain JS object for hit testing
          const element = {};
          for (const [key, value] of elementMap.entries()) {
             if (value instanceof Y.Map || value instanceof Y.Array) {
                 element[key] = value.toJSON();
             } else {
                 element[key] = value;
             }
          }
          // Use a tolerance based on line width, ensure minimum tolerance
          // Adjust tolerance based on zoom level
          const baseTolerance = Math.max(5, (element.lineWidth || 2) / 2);
          const tolerance = baseTolerance / zoomLevel.value;

          if (isPointInElement(transformedCoords, element, tolerance)) {
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
      if (typeof onHoverElement === 'function') {
        onHoverElement(foundIndex); // Notify parent component
      }
    }
    return foundIndex; // Return index for immediate use (e.g., in mousedown)
  };

  // --- Event Handlers ---
  const handleMouseDown = (event) => {
    if (!internalCanvasRef.value) return;
    internalCanvasRef.value.focus(); // Ensure canvas can receive key events if needed

    shiftPressedAtStart.value = event.shiftKey;
    startCoordsForShiftLine.value = null;

    const coords = getCoordinates(event);
    const transformedCoords = transformCoordinates(coords.offsetX, coords.offsetY);

    // Middle mouse or Alt+Left Click for Panning
    if (event.button === 1 || (event.button === 0 && event.altKey)) {
      isPanning.value = true;
      lastPanPoint.value = { screenX: coords.offsetX, screenY: coords.offsetY };
      document.body.style.cursor = 'grabbing'; // Change cursor globally during pan
      if (typeof onStartPanning === 'function') {
        onStartPanning();
      }
      event.preventDefault();
      return;
    }

    // Left Click
    if (event.button === 0) {
      const tool = currentTool.value;

      if (tool === 'eraser') {
        const indexToErase = checkEraserHover(transformedCoords); // Check hover first
        if (indexToErase !== -1) {
          if (typeof onEraseElement === 'function') {
            onEraseElement(indexToErase); // Notify parent to erase
          }
        }
        isDrawing.value = true; // Allow erasing on mouse move
      }
      // Handle tools that activate on click (like plots)
      else if (['mathPlot', 'physicsPlot', 'coordSystem2D', 'coordSystem3D'].includes(tool)) {
         if (typeof onActivateTool === 'function') {
             onActivateTool(tool, transformedCoords);
         }
         // Don't set isDrawing for these tools
      }
      // Handle regular drawing tools
      else {
        isDrawing.value = true;
        if (tool === 'pen' && shiftPressedAtStart.value) {
          startCoordsForShiftLine.value = transformedCoords; // Store start for shift+pen
        }
        if (typeof onStartDrawing === 'function') {
          // Pass the raw event coords and transformed coords
          onStartDrawing(coords, transformedCoords, shiftPressedAtStart.value, startCoordsForShiftLine.value);
        }
      }
    }
  };

  const handleMouseMove = (event) => {
    if (!internalCanvasRef.value) return;
    const coords = getCoordinates(event);
    const transformedCoords = transformCoordinates(coords.offsetX, coords.offsetY);

    // --- Panning ---
    if (isPanning.value && lastPanPoint.value) {
      const dx = coords.offsetX - lastPanPoint.value.screenX;
      const dy = coords.offsetY - lastPanPoint.value.screenY;
      lastPanPoint.value = { screenX: coords.offsetX, screenY: coords.offsetY };
      if (typeof onPan === 'function') {
        onPan(dx, dy); // Send delta pan values
      }
      return; // Don't handle other actions while panning
    }

    // --- Drawing ---
    if (isDrawing.value) {
      if (currentTool.value === 'eraser') {
        const indexToErase = checkEraserHover(transformedCoords);
        if (indexToErase !== -1) {
          if (typeof onEraseElement === 'function') {
            onEraseElement(indexToErase); // Erase immediately on move+hover
          }
        }
      } else {
        // Regular drawing update
        if (typeof onDraw === 'function') {
          // Pass raw and transformed coords
          onDraw(coords, transformedCoords, event.shiftKey, startCoordsForShiftLine.value);
        }
      }
    }
    // --- Hovering (only when not drawing/panning) ---
    else {
       checkEraserHover(transformedCoords); // Update hover state for eraser
    }
  };

  const handleMouseUp = (event) => {
     // Use window coordinates for consistency if needed, but getCoordinates should work
     const coords = getCoordinates(event);
     const transformedCoords = transformCoordinates(coords.offsetX, coords.offsetY);

    if (event.button === 0) { // Left button up
      if (isPanning.value) {
        isPanning.value = false;
        lastPanPoint.value = null;
        document.body.style.cursor = ''; // Reset global cursor
        if (typeof onFinishPanning === 'function') {
          onFinishPanning();
        }
      } else if (isDrawing.value) {
        isDrawing.value = false;
        if (currentTool.value !== 'eraser') { // Don't call finish for eraser move
           if (typeof onFinishDrawing === 'function') {
             // Pass final state needed for element creation
             onFinishDrawing(transformedCoords, shiftPressedAtStart.value, startCoordsForShiftLine.value);
           }
        }
        // Reset shift state after drawing finishes
        shiftPressedAtStart.value = false;
        startCoordsForShiftLine.value = null;
      }
    }
  };

  const handleMouseLeave = (event) => {
    // Similar logic to mouseup, finish any ongoing actions
    if (isPanning.value) {
      isPanning.value = false;
      lastPanPoint.value = null;
      document.body.style.cursor = '';
      if (typeof onFinishPanning === 'function') {
        onFinishPanning();
      }
    }
    if (isDrawing.value) {
      isDrawing.value = false;
      if (currentTool.value !== 'eraser') {
         if (typeof onFinishDrawing === 'function') {
           // Need final coordinates for mouse leave - might be tricky,
           // maybe use last known transformedCoords or just pass the state
           // For simplicity, just pass the state flags
           onFinishDrawing(null, shiftPressedAtStart.value, startCoordsForShiftLine.value); // Pass null for coords on leave
         }
      }
      shiftPressedAtStart.value = false;
      startCoordsForShiftLine.value = null;
    }
    // Reset hover state when leaving canvas
    if (hoveredElementIndex.value !== -1) {
        hoveredElementIndex.value = -1;
        if (typeof onHoverElement === 'function') {
            onHoverElement(-1);
        }
    }
  };

  // --- Touch Handlers (Simplified mapping to mouse events) ---
  let touchIdentifier = null; // Track the primary touch

  const handleTouchStart = (event) => {
    if (event.touches.length === 1 && touchIdentifier === null) {
      event.preventDefault(); // Prevent default touch actions like scrolling
      touchIdentifier = event.touches[0].identifier;
      // Simulate left mouse down
      const simulatedEvent = {
        ...event.touches[0], // Copy touch properties
        button: 0,
        shiftKey: false, // Touch doesn't have shift
        altKey: false,   // Touch doesn't have alt
        preventDefault: () => event.preventDefault(), // Pass preventDefault
        clientX: event.touches[0].clientX, // Ensure clientX/Y are present
        clientY: event.touches[0].clientY,
      };
      handleMouseDown(simulatedEvent);
    }
    // Handle pinch/pan gestures if needed (more complex)
  };

  const handleTouchMove = (event) => {
     const primaryTouch = Array.from(event.changedTouches).find(t => t.identifier === touchIdentifier);
     if (primaryTouch) {
       event.preventDefault(); // Prevent default touch actions like scrolling
       // Simulate mouse move
       const simulatedEvent = {
         ...primaryTouch,
         button: 0, // Assume left button drag
         shiftKey: false,
         altKey: false,
         preventDefault: () => event.preventDefault(),
         clientX: primaryTouch.clientX,
         clientY: primaryTouch.clientY,
       };
       handleMouseMove(simulatedEvent);
     }
  };

  const handleTouchEnd = (event) => {
    const primaryTouch = Array.from(event.changedTouches).find(t => t.identifier === touchIdentifier);
    if (primaryTouch) {
      event.preventDefault(); // Prevent default touch actions
      touchIdentifier = null; // Release primary touch lock
      // Simulate mouse up
      const simulatedEvent = {
        ...primaryTouch,
        button: 0,
        shiftKey: false,
        altKey: false,
        preventDefault: () => event.preventDefault(),
        clientX: primaryTouch.clientX,
        clientY: primaryTouch.clientY,
      };
      handleMouseUp(simulatedEvent); // Trigger mouse up logic
      // Note: MouseLeave might not be the perfect analogy here,
      // but ensures state cleanup if needed. Consider if separate touch end logic is better.
      // handleMouseLeave(simulatedEvent);
    }
  };


  // --- Setup and Teardown ---
  onMounted(() => {
    internalCanvasRef.value = canvasRef.value; // Get the actual DOM element
    if (!internalCanvasRef.value) {
      console.error("useCanvasInput: Canvas element ref is not available on mount.");
      return;
    }
    internalCanvasRef.value.addEventListener('mousedown', handleMouseDown);
    // Add mousemove/mouseup listeners to the window/document to capture events outside the canvas
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    internalCanvasRef.value.addEventListener('mouseleave', handleMouseLeave);
    // Touch events - passive: false allows preventDefault
    internalCanvasRef.value.addEventListener('touchstart', handleTouchStart, { passive: false });
    internalCanvasRef.value.addEventListener('touchmove', handleTouchMove, { passive: false });
    internalCanvasRef.value.addEventListener('touchend', handleTouchEnd, { passive: false });
    internalCanvasRef.value.addEventListener('touchcancel', handleTouchEnd, { passive: false }); // Treat cancel like end

    // Prevent context menu on canvas
    internalCanvasRef.value.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  onUnmounted(() => {
    if (!internalCanvasRef.value) return;
    internalCanvasRef.value.removeEventListener('mousedown', handleMouseDown);
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
    internalCanvasRef.value.removeEventListener('mouseleave', handleMouseLeave);
    internalCanvasRef.value.removeEventListener('touchstart', handleTouchStart);
    internalCanvasRef.value.removeEventListener('touchmove', handleTouchMove);
    internalCanvasRef.value.removeEventListener('touchend', handleTouchEnd);
    internalCanvasRef.value.removeEventListener('touchcancel', handleTouchEnd);
    internalCanvasRef.value.removeEventListener('contextmenu', (e) => e.preventDefault());
    document.body.style.cursor = ''; // Ensure cursor is reset
  });

  // Watch for tool changes to reset hover state if needed
  watch(currentTool, (newTool) => {
      if (newTool !== 'eraser' && hoveredElementIndex.value !== -1) {
          hoveredElementIndex.value = -1;
          if (typeof onHoverElement === 'function') {
              onHoverElement(-1);
          }
      }
  });

  // Return minimal state needed by the parent, if any
  return {
    // State could be exposed if parent needs it, but callbacks are preferred
    // isDrawing, // Parent component manages its own isDrawing state based on callbacks
    // isPanning,
    hoveredElementIndex // Expose hover state for visual feedback in parent
  };
}
