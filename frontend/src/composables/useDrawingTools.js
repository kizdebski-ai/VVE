// frontend/src/composables/useDrawingTools.js
import { ref } from 'vue';
import {
  createNewElement,
  createTextElement // Keep text separate as it involves a prompt
} from '../utils/canvasTools.js';

/**
 * Manages the creation and preview of drawing elements (pen, shapes, lines).
 * Handles tool-specific logic during drawing interactions.
 * @param {object} options - Configuration options.
 * @param {import('vue').Ref<string>} options.currentTool - Ref to the currently selected tool name.
 * @param {import('vue').Ref<string>} options.currentColor - Ref to the current drawing color.
 * @param {import('vue').Ref<number>} options.currentLineWidth - Ref to the current line width.
 * @param {import('vue').Ref<string>} options.currentShape - Ref to the selected shape type (for 'shapes' tool).
 * @param {import('vue').Ref<string>} options.currentLineStyle - Ref to the selected line style (for 'lines' tool).
 * @param {import('vue').Ref<string | number | null>} options.localClientId - Ref to the local client's Yjs ID.
 * @param {function} options.addElementCallback - Function to call when an element is finalized (e.g., addElement from useYjsCollaboration).
 * @param {boolean} [options.debugMode=false] - Optional flag to enable debug logging.
 * @returns {object} Reactive state and methods for managing drawing previews.
 */
export function useDrawingTools(options = {}) {
  const {
    currentTool,
    currentColor,
    currentLineWidth,
    currentShape, // For 'shapes' tool
    currentLineStyle, // For 'lines' tool
    localClientId,
    addElementCallback,
    // redrawCanvasCallback removed
    debugMode = false
  } = options;

  const currentElementPreview = ref(null);
  const isDrawingToolActive = ref(false); // Tracks if a drawing action (pen, shape, line) is in progress

  // --- Preview Management ---

  const startDrawingPreview = (tool, transformedCoords, shiftPressed, startCoordsShift) => {
    // Reset previous state
    currentElementPreview.value = null;
    isDrawingToolActive.value = false;

    // Determine the actual tool type (e.g., 'rectangle' if tool is 'shapes')
    let toolType = tool.value; // Use .value as it's a ref
    let elementData = {};

    // Handle tool specifics
    if (toolType === 'pen' && shiftPressed) {
        if (debugMode) console.log("[useDrawingTools] Start Shift+Pen.");
        // Preview starts as 'pen', will be converted to 'line' on update/finish
    } else if (toolType === 'shapes') {
        toolType = currentShape.value; // Use the specific shape
    } else if (toolType === 'lines') {
        toolType = 'line';
    }

    // Add line style if applicable
    if (toolType === 'line') {
        elementData.lineStyle = currentLineStyle.value;
    }

    // Create the initial preview element
    currentElementPreview.value = createNewElement(
      toolType,
      transformedCoords,
      currentColor.value,
      currentLineWidth.value,
      elementData
    );

    if (currentElementPreview.value) {
        const clientId = localClientId.value || 'unknown';
        currentElementPreview.value.id = `temp_${clientId}_${Date.now()}`;
        isDrawingToolActive.value = true; // Mark drawing as active
        if (debugMode) console.log("[useDrawingTools] Preview started:", JSON.stringify(currentElementPreview.value));
    } else {
        console.error(`[useDrawingTools] Failed to create preview for tool: ${toolType}`);
    }

    return currentElementPreview.value; // Return for immediate drawing if needed
  };

  const updateDrawingPreview = (transformedCoords, isShiftPressed, startCoordsShift) => {
    if (!isDrawingToolActive.value || !currentElementPreview.value) return null;

    const preview = currentElementPreview.value;
    const tool = currentTool.value; // Original tool selected

    if (tool === 'pen') {
        if (isShiftPressed && startCoordsShift) {
            // Update preview for Shift+Pen: Draw straight line
            preview.type = 'line'; // Temporarily change type
            preview.start = startCoordsShift;
            preview.end = transformedCoords;
            delete preview.points;
        } else if (!isShiftPressed) {
            // Normal pen drawing
            preview.type = 'pen'; // Ensure type is correct
            if (!preview.points) preview.points = [];
            preview.points.push(transformedCoords);
            // pointsBuffer logic could be managed here if needed for smoothing previews
        }
    } else if (tool === 'shapes' || tool === 'lines') {
        // Update end coordinates for shapes and regular lines
        preview.end = transformedCoords;

        // Special handling for square aspect ratio during preview
        if (preview.type === 'square') {
            if (!preview.start) return preview; // Need start point
            const dx = Math.abs(transformedCoords.x - preview.start.x);
            const dy = Math.abs(transformedCoords.y - preview.start.y);
            const size = Math.max(dx, dy);
            preview.end = {
                x: preview.start.x + size * Math.sign(transformedCoords.x - preview.start.x),
                y: preview.start.y + size * Math.sign(transformedCoords.y - preview.start.y)
            };
        }
    }
    return currentElementPreview.value; // Return updated preview
  };

  const finalizeDrawingElement = (finalTransformedCoords, wasShiftPressed, startCoordsShift) => {
    if (!isDrawingToolActive.value || !currentElementPreview.value) {
        isDrawingToolActive.value = false;
        currentElementPreview.value = null;
        return;
    }

    let elementToAdd = null;
    const preview = currentElementPreview.value;
    const originalTool = currentTool.value;

    const endCoords = finalTransformedCoords || preview.end;
    if (!endCoords || !preview.start) {
        console.warn("[useDrawingTools] Start or Final coordinates missing.");
        isDrawingToolActive.value = false;
        currentElementPreview.value = null;
        return;
    }

    const isValidElement = preview.start && endCoords && (preview.start.x !== endCoords.x || preview.start.y !== endCoords.y);
    const isValidPen = preview.type === 'pen' && preview.points && preview.points.length >= 2 && !wasShiftPressed;
    const isValidShiftPen = originalTool === 'pen' && wasShiftPressed && startCoordsShift && endCoords && (startCoordsShift.x !== endCoords.x || startCoordsShift.y !== endCoords.y);

    if (isValidPen || (preview.type !== 'pen' && isValidElement) || isValidShiftPen) {
        if (wasShiftPressed && originalTool === 'pen' && isValidShiftPen) {
            elementToAdd = { type: 'line', start: startCoordsShift, end: endCoords, color: preview.color, lineWidth: preview.lineWidth, timestamp: Date.now(), lineStyle: 'solid' };
        } else {
            elementToAdd = { ...preview, end: endCoords };
            delete elementToAdd.id;
            if (originalTool === 'lines' && elementToAdd.type === 'line') {
                elementToAdd.lineStyle = currentLineStyle.value || 'solid';
            }
        }

        if (elementToAdd && typeof addElementCallback === 'function') {
            if (debugMode) console.log(`[useDrawingTools] Adding element:`, JSON.stringify(elementToAdd));
            addElementCallback(elementToAdd, 'local-drawing');
        }
    } else {
        if (debugMode) console.log('[useDrawingTools] Drawing finished but element invalid.');
    }

    // Reset state *after* adding the element
    isDrawingToolActive.value = false;
    currentElementPreview.value = null; // Clear the preview ref now
  };

  const cancelDrawingPreview = () => {
      isDrawingToolActive.value = false;
      currentElementPreview.value = null;
      if (debugMode) console.log('[useDrawingTools] Drawing preview cancelled.');
  };

  const handleTextToolActivation = (transformedCoords) => {
      const text = prompt('Enter text:', '');
      if (text && typeof addElementCallback === 'function') {
          const textElementData = createTextElement(transformedCoords, text, currentColor.value, currentLineWidth.value * 10);
          addElementCallback(textElementData, 'local-text');
      }
  };

  return {
    currentElementPreview, isDrawingToolActive,
    startDrawingPreview, updateDrawingPreview, finalizeDrawingElement,
    cancelDrawingPreview, handleTextToolActivation
  };
}
