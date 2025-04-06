// frontend/src/composables/useZoomPan.js
import { ref, onMounted, onUnmounted } from 'vue';

/**
 * Manages zoom and pan state for a canvas element.
 * @param {import('vue').Ref<HTMLCanvasElement | null>} canvasRef - Ref pointing to the canvas element.
 * @param {import('vue').Ref<number>} canvasWidth - Ref containing the canvas width.
 * @param {import('vue').Ref<number>} canvasHeight - Ref containing the canvas height.
 * @param {object} options - Configuration options.
 * @param {function} [options.onUpdate] - Callback function triggered after zoom or pan changes. Receives { zoom, pan }.
 * @returns {object} Reactive state and methods for zoom/pan control.
 */
export function useZoomPan(canvasRef, canvasWidth, canvasHeight, options = {}) {
  const { onUpdate } = options; // Callback to trigger redraw or other updates

  const zoomLevel = ref(1);
  const panOffset = ref({ x: 0, y: 0 });
  const internalCanvasRef = ref(null);

  const handleZoom = (event) => {
    event.preventDefault();
    if (!internalCanvasRef.value) return;

    const rect = internalCanvasRef.value.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Calculate zoom delta (increase for zoom in, decrease for zoom out)
    const delta = event.deltaY < 0 ? 1.1 : 1 / 1.1; // Use reciprocal for zooming out

    const newZoom = Math.max(0.1, Math.min(5, zoomLevel.value * delta)); // Clamp zoom level

    // Calculate the zoom ratio
    const zoomRatio = newZoom / zoomLevel.value;

    // Calculate new pan offset to keep the point under the mouse stationary
    const newPanX = mouseX - (mouseX - panOffset.value.x) * zoomRatio;
    const newPanY = mouseY - (mouseY - panOffset.value.y) * zoomRatio;

    zoomLevel.value = newZoom;
    panOffset.value = { x: newPanX, y: newPanY };

    if (typeof onUpdate === 'function') {
      onUpdate({ zoom: newZoom, pan: { x: newPanX, y: newPanY } });
    }
  };

  const zoomIn = () => {
    if (!internalCanvasRef.value || !canvasWidth?.value || !canvasHeight?.value) return;
    const prevZoom = zoomLevel.value;
    const newZoom = Math.min(5, prevZoom * 1.2); // Increase zoom by 20%

    // Zoom towards the center of the canvas
    const centerX = canvasWidth.value / 2;
    const centerY = canvasHeight.value / 2;
    const zoomRatio = newZoom / prevZoom;

    const newPanX = centerX - (centerX - panOffset.value.x) * zoomRatio;
    const newPanY = centerY - (centerY - panOffset.value.y) * zoomRatio;

    zoomLevel.value = newZoom;
    panOffset.value = { x: newPanX, y: newPanY };

    if (typeof onUpdate === 'function') {
      onUpdate({ zoom: newZoom, pan: { x: newPanX, y: newPanY } });
    }
  };

  const zoomOut = () => {
     if (!internalCanvasRef.value || !canvasWidth?.value || !canvasHeight?.value) return;
    const prevZoom = zoomLevel.value;
    const newZoom = Math.max(0.1, prevZoom / 1.2); // Decrease zoom by factor

    // Zoom out from the center of the canvas
    const centerX = canvasWidth.value / 2;
    const centerY = canvasHeight.value / 2;
    const zoomRatio = newZoom / prevZoom;

    const newPanX = centerX - (centerX - panOffset.value.x) * zoomRatio;
    const newPanY = centerY - (centerY - panOffset.value.y) * zoomRatio;

    zoomLevel.value = newZoom;
    panOffset.value = { x: newPanX, y: newPanY };

    if (typeof onUpdate === 'function') {
      onUpdate({ zoom: newZoom, pan: { x: newPanX, y: newPanY } });
    }
  };

  const resetZoom = () => {
    const newZoom = 1;
    const newPan = { x: 0, y: 0 };
    zoomLevel.value = newZoom;
    panOffset.value = newPan;

    if (typeof onUpdate === 'function') {
      onUpdate({ zoom: newZoom, pan: newPan });
    }
  };

  // Manual pan function used by useCanvasInput's onPan callback
  const applyPan = (dx, dy) => {
      const newPan = {
          x: panOffset.value.x + dx,
          y: panOffset.value.y + dy
      };
      panOffset.value = newPan;
      if (typeof onUpdate === 'function') {
          // Pass zoom level as well, although it didn't change here
          onUpdate({ zoom: zoomLevel.value, pan: newPan });
      }
  };


  onMounted(() => {
    internalCanvasRef.value = canvasRef.value;
    if (!internalCanvasRef.value) {
      console.error("useZoomPan: Canvas element ref is not available on mount.");
      return;
    }
    // Attach the wheel listener directly
    internalCanvasRef.value.addEventListener('wheel', handleZoom, { passive: false });
  });

  onUnmounted(() => {
    if (!internalCanvasRef.value) return;
    internalCanvasRef.value.removeEventListener('wheel', handleZoom);
  });

  return {
    zoomLevel,
    panOffset,
    zoomIn,
    zoomOut,
    resetZoom,
    applyPan // Expose this for the input handler to call
    // handleZoom is internal to this composable now
  };
}
