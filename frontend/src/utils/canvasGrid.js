/**
 * Canvas Grid Module
 * Provides functionality for drawing the grid
 */

/**
 * Update grid size settings based on zoom level
 * @param {number} zoomLevel - Current zoom level
 * @returns {object} - Grid size settings
 */
export const getGridSettings = (zoomLevel) => {
  // Adjust grid size based on zoom level for better visibility
  if (zoomLevel <= 0.5) {
    return {
      gridSize: 40,
      majorGridSize: 200
    };
  } else if (zoomLevel <= 1) {
    return {
      gridSize: 20,
      majorGridSize: 100
    };
  } else if (zoomLevel <= 2) {
    return {
      gridSize: 10,
      majorGridSize: 50
    };
  } else {
    return {
      gridSize: 5,
      majorGridSize: 25
    };
  }
};

/**
 * Draw grid on canvas
 * @param {object} context - Canvas 2D context
 * @param {number} zoomLevel - Current zoom level
 * @param {object} panOffset - Pan offset {x, y}
 * @param {number} canvasWidth - Canvas width
 * @param {number} canvasHeight - Canvas height
 * @param {boolean} darkMode - Dark mode enabled
 */
export const drawGrid = (context, zoomLevel, panOffset, canvasWidth, canvasHeight, darkMode) => {
  // Save current context state
  context.save();

  // Apply zoom and pan transformations
  context.setTransform(
    zoomLevel, 0, 
    0, zoomLevel, 
    panOffset.x, panOffset.y
  );

  // Clear canvas with background color based on theme
  context.fillStyle = darkMode ? '#121212' : 'white';
  context.fillRect(0, 0, canvasWidth / zoomLevel, canvasHeight / zoomLevel);

  // Get grid settings based on zoom level
  const { gridSize, majorGridSize } = getGridSettings(zoomLevel);

  // Calculate visible area in world coordinates
  const visibleLeft = -panOffset.x / zoomLevel - 100;
  const visibleTop = -panOffset.y / zoomLevel - 100;
  const visibleRight = (canvasWidth - panOffset.x) / zoomLevel + 100;
  const visibleBottom = (canvasHeight - panOffset.y) / zoomLevel + 100;

  // Calculate grid boundaries - with extended area to prevent white space
  const startX = Math.floor(visibleLeft / gridSize) * gridSize;
  const endX = Math.ceil(visibleRight / gridSize) * gridSize;
  const startY = Math.floor(visibleTop / gridSize) * gridSize;
  const endY = Math.ceil(visibleBottom / gridSize) * gridSize;

  // Set colors based on theme
  const minorGridColor = darkMode ? 'rgba(255, 255, 255, 0.1)' : '#e6e6e6';
  const majorGridColor = darkMode ? 'rgba(255, 255, 255, 0.2)' : '#cccccc';

  // Draw minor grid lines
  context.beginPath();
  context.strokeStyle = minorGridColor;
  context.lineWidth = 0.5;

  for (let x = startX; x <= endX; x += gridSize) {
    context.moveTo(x, startY);
    context.lineTo(x, endY);
  }
  for (let y = startY; y <= endY; y += gridSize) {
    context.moveTo(startX, y);
    context.lineTo(endX, y);
  }
  context.stroke();

  // Draw major grid lines
  context.beginPath();
  context.strokeStyle = majorGridColor;
  context.lineWidth = 1;

  const startMajorX = Math.floor(visibleLeft / majorGridSize) * majorGridSize;
  const endMajorX = Math.ceil(visibleRight / majorGridSize) * majorGridSize;
  const startMajorY = Math.floor(visibleTop / majorGridSize) * majorGridSize;
  const endMajorY = Math.ceil(visibleBottom / majorGridSize) * majorGridSize;

  for (let x = startMajorX; x <= endMajorX; x += majorGridSize) {
    context.moveTo(x, startMajorY);
    context.lineTo(x, endMajorY);
  }
  for (let y = startMajorY; y <= endMajorY; y += majorGridSize) {
    context.moveTo(startMajorX, y);
    context.lineTo(endMajorX, y);
  }
  context.stroke();

  // Restore context to previous state
  context.restore();
};