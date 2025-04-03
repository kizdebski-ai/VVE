/**
 * Canvas Drawing Utilities
 * Provides functions for drawing different elements on the canvas
 */

// Throttle function to limit the rate of function calls
export const throttle = (fn, delay) => {
  let lastCall = 0;
  return function(...args) {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      fn.apply(this, args);
    }
  };
};

/**
 * Draw a single element on the canvas
 * @param {Object} context - Canvas 2D context
 * @param {Object} element - Element to draw
 * @param {Boolean} isHighlighted - Whether to highlight the element
 * @param {Number} smoothingFactor - Smoothing factor for curves (0-1)
 * @param {Map<string, HTMLImageElement>} imageCache - Optional: Cache for images passed to drawImage
 * @param {function} requestRedraw - Optional: Redraw function passed to drawImage
 */
export const drawElement = (context, element, isHighlighted = false, smoothingFactor = 0.2, imageCache = null, requestRedraw = null) => {
  if (!element || typeof element !== 'object') {
      console.error("drawElement received invalid element:", element);
      return;
  }
  // Ensure essential properties exist, especially for lines/shapes
  if (['line', 'rectangle', 'circle', 'square', 'triangle', 'trapezoid', 'parallelogram', 'deltoid', 'cube', 'cuboid', 'sphere', 'cylinder', 'cone', 'pyramid', 'tetrahedron'].includes(element.type)) {
      if (!element.start || !element.end) {
          // Allow text elements which use 'position' instead of 'start'/'end'
          if (element.type !== 'text' && element.type !== 'image') {
             console.error(`drawElement received element type ${element.type} without start/end points:`, element);
             return;
          }
      }
  }
  if (element.type === 'pen' && (!element.points || element.points.length === 0)) {
      console.error("drawElement received pen element without points:", element);
      return;
  }


  context.save();

  // Set styles
  context.strokeStyle = element.color || '#000000'; // Default color
  context.fillStyle = element.color || '#000000';
  context.lineWidth = element.lineWidth || 2; // Default line width
  context.lineCap = 'round';
  context.lineJoin = 'round';

  // Apply composite operation if specified (for eraser)
  if (element.compositeOperation) {
    context.globalCompositeOperation = element.compositeOperation;
  }

  // Apply highlight effect if needed
  if (isHighlighted) {
    context.shadowColor = 'rgba(255, 0, 0, 0.5)'; // Example highlight
    context.shadowBlur = 10;
  }

  switch (element.type) {
    case 'pen':
      drawPath(context, element, smoothingFactor);
      break;
    case 'eraser':
      // Eraser logic is handled elsewhere (element deletion)
      break;
    case 'line':
      drawLine(context, element);
      break;
    case 'rectangle':
      drawRectangle(context, element);
      break;
    case 'circle':
      drawCircle(context, element);
      break;
    // Add cases for new 2D shapes
    case 'square':
      drawSquare(context, element);
      break;
    case 'triangle':
      drawTriangle(context, element);
      break;
    case 'trapezoid':
      drawTrapezoid(context, element);
      break;
    case 'parallelogram':
      drawParallelogram(context, element);
      break;
    case 'deltoid':
      drawDeltoid(context, element);
      break;
    // Add cases for new 3D shapes (2D representations)
    case 'cube':
      drawCube(context, element);
      break;
    case 'cuboid':
      drawCuboid(context, element);
      break;
    case 'sphere':
      drawSphere(context, element);
      break;
    case 'cylinder':
      drawCylinder(context, element);
      break;
    case 'cone':
      drawCone(context, element);
      break;
    case 'pyramid':
      drawPyramid(context, element);
      break;
    case 'tetrahedron':
      drawTetrahedron(context, element);
      break;
    case 'text':
      drawText(context, element);
      break;
    case 'image':
      // Pass cache and redraw request to drawImage
      drawImage(context, element, imageCache, requestRedraw);
      break;
    default:
        console.warn(`[drawElement] Unknown element type: ${element.type}`);
  }

  // Reset composite operation and shadow
  context.globalCompositeOperation = 'source-over';
  context.shadowColor = 'transparent';
  context.shadowBlur = 0;

  context.restore();
};

/**
 * Draw a free-hand path
 */
const drawPath = (context, element, smoothingFactor) => {
  // Draw free-hand path with smooth curves
  if (element.points && element.points.length > 0) {
    context.beginPath();

    if (element.points.length === 1) {
      // Just a dot
      const point = element.points[0];
      context.arc(point.x, point.y, context.lineWidth / 2, 0, Math.PI * 2);
      context.fill();
    } else if (element.points.length === 2) {
      // Just a line
      const p1 = element.points[0];
      const p2 = element.points[1];
      context.moveTo(p1.x, p1.y);
      context.lineTo(p2.x, p2.y);
      context.stroke();
    } else {
      // Advanced curve smoothing with adaptive control (Catmull-Rom to Bezier)
      context.moveTo(element.points[0].x, element.points[0].y);

      // Use pre-calculated control points if available (e.g., from Yjs)
      if (element.smoothedPoints && element.smoothedPoints.length > 0) {
        for (let i = 0; i < element.smoothedPoints.length; i++) {
           const cp = element.smoothedPoints[i];
           const p2 = element.points[i + 1]; // Target point for this curve segment
           if (cp && p2) {
               context.bezierCurveTo(cp.cp1x, cp.cp1y, cp.cp2x, cp.cp2y, p2.x, p2.y);
           } else {
               // Fallback if smoothed points are missing for a segment
               if (p2) context.lineTo(p2.x, p2.y);
           }
        }
      } else {
        // Calculate curves on the fly with adaptive smoothing
        const adaptiveSmoothingFactor = Math.min(0.4, smoothingFactor * 2);

        for (let i = 0; i < element.points.length - 1; i++) {
          const p0 = i > 0 ? element.points[i - 1] : element.points[i];
          const p1 = element.points[i];
          const p2 = element.points[i + 1];
          const p3 = i < element.points.length - 2 ? element.points[i + 2] : p2;

          // Improved Catmull-Rom to Bezier conversion
          const d1 = Math.sqrt(Math.pow(p1.x - p0.x, 2) + Math.pow(p1.y - p0.y, 2));
          const d2 = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
          const d3 = Math.sqrt(Math.pow(p3.x - p2.x, 2) + Math.pow(p3.y - p2.y, 2));

          // Adjust tension based on point distances (simplified)
          const tensionFactor = (d1 + d2 + d3 > 0) ? Math.min(d1, d2, d3) / Math.max(d1, d2, d3) : 0;
          const tension = adaptiveSmoothingFactor * (0.5 + (isNaN(tensionFactor) ? 0 : tensionFactor) / 2);


          // Control points with adaptive tension
          const cp1x = p1.x + (p2.x - p0.x) / 6 * tension;
          const cp1y = p1.y + (p2.y - p0.y) / 6 * tension;
          const cp2x = p2.x - (p3.x - p1.x) / 6 * tension;
          const cp2y = p2.y - (p3.y - p1.y) / 6 * tension;

          // Add Bezier curve segment
          context.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
        }
      }
      context.stroke();
    }
  }
};

/**
 * Draw a line with different styles (solid, dotted, dashed, vector, dotted_vector)
 */
const drawLine = (context, element) => {
  // DEBUG: Log line element details more thoroughly
  console.log(`[drawLine] Element received:`, JSON.stringify(element));

  context.save(); // Save context state before potentially changing dash/fill
  context.beginPath();
  context.moveTo(element.start.x, element.start.y);

  // Handle line styles
  const lineStyle = element.lineStyle || 'solid'; // Default to solid
  const lw = Math.max(1, element.lineWidth || 1); // Ensure positive line width for dash calculation
  let dashPattern = [];
  console.log(`[drawLine] Processing style: ${lineStyle}, lineWidth: ${lw}`); // DEBUG

  if (lineStyle === 'dotted' || lineStyle === 'dotted_vector') {
    // Use fixed small values for dotted lines, scaled slightly by line width
    dashPattern = [lw * 0.5, lw * 1.5];
  } else if (lineStyle === 'dashed') {
    // Use larger dash and gap, scaled by line width
    dashPattern = [lw * 3, lw * 2];
  }

  if (dashPattern.length > 0) {
    // Ensure dash pattern values are not zero
    dashPattern = dashPattern.map(val => Math.max(0.1, val));
    console.log(`[drawLine] Applying dash pattern: [${dashPattern.join(', ')}]`); // DEBUG
    context.setLineDash(dashPattern);
  } else {
     console.log(`[drawLine] No dash pattern applied (solid line).`); // DEBUG
  }

  context.lineTo(element.end.x, element.end.y);
  context.strokeStyle = element.color; // Ensure strokeStyle is set
  context.lineWidth = lw; // Ensure lineWidth is set
  context.stroke(); // Stroke the line path

  // Reset line dash *before* drawing arrowhead if needed
  if (dashPattern.length > 0) {
    context.setLineDash([]);
  }

  // Draw arrowhead for vector types
  if (lineStyle === 'vector' || lineStyle === 'dotted_vector') {
    // Arrowhead should use the element's color
    context.fillStyle = element.color;
    drawArrowhead(context, element.start, element.end, lw);
  }

  context.restore(); // Restore original context state (including dash setting)
};

/**
 * Helper function to draw an arrowhead
 */
const drawArrowhead = (context, from, to, lineWidth) => {
    // Prevent drawing arrowhead if start and end points are the same
    if (!from || !to || (from.x === to.x && from.y === to.y)) return;

    const headLength = Math.max(8, lineWidth * 3.5); // Adjusted size calculation
    const angle = Math.atan2(to.y - from.y, to.x - from.x);

    // Save context state specifically for arrowhead drawing
    context.save();
    // fillStyle should be set before calling this function
    context.beginPath(); // Start a new path for the arrowhead
    context.translate(to.x, to.y);
    context.rotate(angle);
    // Draw the arrowhead shape relative to the translated/rotated origin (the endpoint)
    context.moveTo(0, 0);
    context.lineTo(-headLength, -headLength / 2.5); // Adjusted shape
    // context.lineTo(-headLength * 0.9, 0); // Removed concave point for simpler arrow
    context.lineTo(-headLength, headLength / 2.5); // Adjusted shape
    context.closePath();
    context.fill(); // Fill the arrowhead path
    context.restore(); // Restore context state
};


/**
 * Draw a rectangle
 */
const drawRectangle = (context, element) => {
  context.beginPath();
  const width = element.end.x - element.start.x;
  const height = element.end.y - element.start.y;
  context.rect(
    element.start.x,
    element.start.y,
    width,
    height
  );
  context.stroke();
};

/**
 * Draw a square (uses rectangle logic but ensures equal sides during creation)
 */
const drawSquare = (context, element) => {
  // Drawing is the same as rectangle, aspect ratio is enforced during creation/update
  drawRectangle(context, element);
};

/**
 * Draw a triangle
 */
const drawTriangle = (context, element) => {
  context.beginPath();
  // Simple isosceles triangle based on bounding box
  const midX = element.start.x + (element.end.x - element.start.x) / 2;
  context.moveTo(midX, element.start.y); // Top point
  context.lineTo(element.end.x, element.end.y); // Bottom right
  context.lineTo(element.start.x, element.end.y); // Bottom left
  context.closePath();
  context.stroke();
};

/**
 * Draw a trapezoid
 */
const drawTrapezoid = (context, element) => {
  context.beginPath();
  const width = element.end.x - element.start.x;
  const inset = width * 0.2; // Adjust for slant
  context.moveTo(element.start.x + inset, element.start.y); // Top left
  context.lineTo(element.end.x - inset, element.start.y); // Top right
  context.lineTo(element.end.x, element.end.y); // Bottom right
  context.lineTo(element.start.x, element.end.y); // Bottom left
  context.closePath();
  context.stroke();
};

/**
 * Draw a parallelogram
 */
const drawParallelogram = (context, element) => {
  context.beginPath();
  const width = element.end.x - element.start.x;
  const slant = width * 0.2; // Adjust for slant
  context.moveTo(element.start.x + slant, element.start.y); // Top left
  context.lineTo(element.end.x + slant, element.start.y); // Top right
  context.lineTo(element.end.x - slant, element.end.y); // Bottom right
  context.lineTo(element.start.x - slant, element.end.y); // Bottom left
  context.closePath();
  context.stroke();
};

/**
 * Draw a deltoid (kite)
 */
const drawDeltoid = (context, element) => {
  context.beginPath();
  const midX = element.start.x + (element.end.x - element.start.x) / 2;
  const midY = element.start.y + (element.end.y - element.start.y) / 2;
  context.moveTo(midX, element.start.y); // Top point
  context.lineTo(element.end.x, midY); // Middle right
  context.lineTo(midX, element.end.y); // Bottom point
  context.lineTo(element.start.x, midY); // Middle left
  context.closePath();
  context.stroke();
};

// --- 3D Shape Drawing Functions (2D Representations) ---

/**
 * Draw a cube (isometric view)
 */
const drawCube = (context, element) => {
  const { x: x1, y: y1 } = element.start;
  const { x: x2, y: y2 } = element.end;
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  const size = Math.min(width, height); // Base size on smaller dimension
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);

  const offsetRatio = 0.4; // How much the back faces are offset
  const offsetX = size * offsetRatio;
  const offsetY = size * offsetRatio * 0.5; // Simulate perspective

  context.beginPath();
  // Front face
  context.rect(x, y, size, size);
  // Back face
  context.rect(x + offsetX, y - offsetY, size, size);
  // Connecting lines
  context.moveTo(x, y);
  context.lineTo(x + offsetX, y - offsetY);
  context.moveTo(x + size, y);
  context.lineTo(x + size + offsetX, y - offsetY);
  context.moveTo(x, y + size);
  context.lineTo(x + offsetX, y + size - offsetY);
  context.moveTo(x + size, y + size);
  context.lineTo(x + size + offsetX, y + size - offsetY);
  context.stroke();
};

/**
 * Draw a cuboid (isometric view)
 */
const drawCuboid = (context, element) => {
  const { x: x1, y: y1 } = element.start;
  const { x: x2, y: y2 } = element.end;
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);

  const depthRatio = 0.4; // How much the back faces are offset
  const depthX = width * depthRatio;
  const depthY = height * depthRatio * 0.5; // Simulate perspective

  context.beginPath();
  // Front face
  context.rect(x, y, width, height);
  // Back face
  context.rect(x + depthX, y - depthY, width, height);
  // Connecting lines
  context.moveTo(x, y);
  context.lineTo(x + depthX, y - depthY);
  context.moveTo(x + width, y);
  context.lineTo(x + width + depthX, y - depthY);
  context.moveTo(x, y + height);
  context.lineTo(x + depthX, y + height - depthY);
  context.moveTo(x + width, y + height);
  context.lineTo(x + width + depthX, y + height - depthY);
  context.stroke();
};


/**
 * Draw a sphere (circle with equator and meridian lines)
 */
const drawSphere = (context, element) => {
  const centerX = (element.start.x + element.end.x) / 2;
  const centerY = (element.start.y + element.end.y) / 2;
  const radiusX = Math.abs(element.end.x - element.start.x) / 2;
  const radiusY = Math.abs(element.end.y - element.start.y) / 2;
  const ellipseHeightRatio = 0.3; // How tall the equator ellipse is relative to radiusY

  context.save();
  context.lineWidth = element.lineWidth;
  context.strokeStyle = element.color;

  // Draw outer circle
  context.beginPath();
  context.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
  context.stroke();

  // Draw equator (dashed back, solid front)
  context.beginPath();
  context.ellipse(centerX, centerY, radiusX, radiusY * ellipseHeightRatio, 0, 0, Math.PI); // Front half (solid)
  context.stroke();

  context.beginPath();
  context.setLineDash([element.lineWidth * 2, element.lineWidth * 2]); // Dashed line
  context.ellipse(centerX, centerY, radiusX, radiusY * ellipseHeightRatio, 0, Math.PI, Math.PI * 2); // Back half (dashed)
  context.stroke();
  context.setLineDash([]); // Reset dash

  // Draw a vertical meridian arc
  context.beginPath();
  context.ellipse(centerX, centerY, radiusX * ellipseHeightRatio * 0.8, radiusY, 0, Math.PI * 0.5, Math.PI * 1.5); // Vertical ellipse (arc)
  context.stroke();

  context.restore();
};

/**
 * Draw a cylinder
 */
const drawCylinder = (context, element) => {
  const { x: x1, y: y1 } = element.start;
  const { x: x2, y: y2 } = element.end;
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);

  const ellipseHeight = Math.min(height * 0.2, width * 0.3); // Height of the top/bottom ellipses
  const radiusX = width / 2;

  context.beginPath();
  // Top ellipse
  context.ellipse(x + radiusX, y + ellipseHeight / 2, radiusX, ellipseHeight / 2, 0, 0, Math.PI * 2);
  // Bottom ellipse (only draw front part)
  context.ellipse(x + radiusX, y + height - ellipseHeight / 2, radiusX, ellipseHeight / 2, 0, 0, Math.PI);
  // Sides
  context.moveTo(x, y + ellipseHeight / 2);
  context.lineTo(x, y + height - ellipseHeight / 2);
  context.moveTo(x + width, y + ellipseHeight / 2);
  context.lineTo(x + width, y + height - ellipseHeight / 2);
  // Draw back part of bottom ellipse
  context.ellipse(x + radiusX, y + height - ellipseHeight / 2, radiusX, ellipseHeight / 2, 0, Math.PI, Math.PI * 2);
  context.stroke();
};

/**
 * Draw a cone
 */
const drawCone = (context, element) => {
  const { x: x1, y: y1 } = element.start;
  const { x: x2, y: y2 } = element.end;
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);

  const ellipseHeight = Math.min(height * 0.2, width * 0.3);
  const radiusX = width / 2;
  const tipY = y; // Tip at the top
  const baseY = y + height - ellipseHeight / 2;

  context.beginPath();
  // Bottom ellipse (draw only front part initially)
  context.ellipse(x + radiusX, baseY, radiusX, ellipseHeight / 2, 0, 0, Math.PI);
  // Sides
  context.moveTo(x, baseY);
  context.lineTo(x + radiusX, tipY);
  context.lineTo(x + width, baseY);
  // Draw back part of bottom ellipse
  context.ellipse(x + radiusX, baseY, radiusX, ellipseHeight / 2, 0, Math.PI, Math.PI * 2);
  context.stroke();
};

/**
 * Draw a pyramid (square base)
 */
const drawPyramid = (context, element) => {
  const { x: x1, y: y1 } = element.start;
  const { x: x2, y: y2 } = element.end;
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);

  const baseInsetRatio = 0.2; // Perspective for base
  const tipX = x + width / 2;
  const tipY = y;
  const baseX1 = x + width * baseInsetRatio;
  const baseX2 = x + width * (1 - baseInsetRatio);
  const baseY1 = y + height * (1 - baseInsetRatio * 0.5);
  const baseY2 = y + height;

  context.beginPath();
  // Base lines (visible)
  context.moveTo(baseX1, baseY1);
  context.lineTo(x, baseY2);
  context.lineTo(x + width, baseY2);
  context.lineTo(baseX2, baseY1); // Connect base corners
  // Edges to tip
  context.moveTo(tipX, tipY);
  context.lineTo(baseX1, baseY1);
  context.moveTo(tipX, tipY);
  context.lineTo(x, baseY2);
  context.moveTo(tipX, tipY);
  context.lineTo(x + width, baseY2);
  context.moveTo(tipX, tipY);
  context.lineTo(baseX2, baseY1);
  // Draw the final base line (previously missing)
  context.moveTo(baseX1, baseY1);
  context.lineTo(baseX2, baseY1);
  context.stroke();
};

/**
 * Draw a tetrahedron (triangular pyramid)
 */
const drawTetrahedron = (context, element) => {
  const { x: x1, y: y1 } = element.start;
  const { x: x2, y: y2 } = element.end;
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);

  const tipX = x + width / 2;
  const tipY = y;
  const baseLeftX = x;
  const baseRightX = x + width;
  const baseMidX = x + width * 0.7; // Back corner x
  const baseY = y + height;
  const baseMidY = y + height * 0.8; // Back corner y

  context.beginPath();
  // Base triangle (visible lines)
  context.moveTo(baseLeftX, baseY);
  context.lineTo(baseRightX, baseY);
  context.lineTo(baseMidX, baseMidY); // Connect base corners
  // Edges to tip
  context.moveTo(tipX, tipY);
  context.lineTo(baseLeftX, baseY);
  context.moveTo(tipX, tipY);
  context.lineTo(baseRightX, baseY);
  context.moveTo(tipX, tipY);
  context.lineTo(baseMidX, baseMidY);
  // Draw the final base line (previously missing)
  context.moveTo(baseLeftX, baseY);
  context.lineTo(baseMidX, baseMidY);
  context.stroke();
};


/**
 * Draw a circle
 */
const drawCircle = (context, element) => {
  context.beginPath();
  const centerX = (element.start.x + element.end.x) / 2;
  const centerY = (element.start.y + element.end.y) / 2;

  // Użyj niezależnych średnic dla X i Y, aby zapewnić dokładne okręgi
  // nawet przy różnych proporcjach ekranu i skali
  const radiusX = Math.abs(element.end.x - element.start.x) / 2;
  const radiusY = Math.abs(element.end.y - element.start.y) / 2;

  // Użyj ellipse zamiast arc dla lepszej obsługi różnych proporcji
  context.ellipse(
    centerX,
    centerY,
    radiusX,
    radiusY,
    0, // rotacja
    0, // początkowy kąt
    Math.PI * 2 // pełny okrąg
  );

  context.stroke();
};

/**
 * Draw text
 */
const drawText = (context, element) => {
  context.font = `${element.fontSize}px Arial, sans-serif`;
  context.fillText(element.text, element.position.x, element.position.y);
};

/**
 * Draw an image using an external cache.
 * @param {CanvasRenderingContext2D} context
 * @param {object} element - The image element data from Yjs { dataUrl, position, width, height }
 * @param {Map<string, HTMLImageElement>} imageCache - A Map or object to store/retrieve loaded Image objects
 * @param {function} requestRedraw - Function to call when an image loads asynchronously
 */
const drawImage = (context, element, imageCache, requestRedraw) => {
  if (!element || !element.dataUrl || !imageCache || !element.position) {
      console.error("drawImage called with invalid element data:", element);
      return;
  }

  // Access properties directly instead of destructuring immediately
  const dataUrl = element.dataUrl;
  const position = element.position; // Keep position object
  const width = element.width;
  const height = element.height;

  // Check cache first
  let img = imageCache.get(dataUrl);

  if (img) {
    // Image is in cache
    if (img.complete && img.naturalWidth > 0) {
      // Log drawing parameters using direct access
      console.log(`Drawing image: ${dataUrl.substring(0,20)}... at (${element.position?.x}, ${element.position?.y}) size ${width}x${height}`);
      // Image loaded, draw it using direct access
      context.drawImage(img, element.position.x, element.position.y, width, height);

    } else if (!img.complete) {
      // Image is loading, maybe draw placeholder or wait
      // console.log(`Image ${dataUrl.substring(0, 20)}... is loading`);
    } else {
      // Image failed to load (e.g., broken dataUrl)
      console.warn(`Cached image for ${dataUrl.substring(0, 20)}... failed to load previously.`);
      // Optionally draw an error indicator
    }
  } else {
    // Image not in cache, start loading
    img = new Image();
    img.onload = () => { // Remove async/await
      console.log(`Image ${dataUrl.substring(0, 20)}... loaded successfully.`);
      // Image loaded, request a redraw to display it
      if (requestRedraw) {
        // await new Promise(resolve => setTimeout(resolve, 0)); // Remove await
        requestRedraw(); // Direct call
        console.log(`Requested redraw after image load: ${dataUrl.substring(0, 20)}...`);
      }
    };
    img.onerror = (err) => {
      console.error(`Failed to load image: ${dataUrl.substring(0, 20)}...`, err);
      // Mark as failed in cache? Or remove? For now, just log.
      // Consider removing from cache to allow retry?
      // imageCache.delete(dataUrl);
    };
    img.src = dataUrl;
    imageCache.set(dataUrl, img); // Add to cache immediately (while loading)
    // console.log(`Started loading image ${dataUrl.substring(0, 20)}...`);
  }
};


/**
 * Calculate distance from point to line segment
 */
export const distanceToSegment = (p, v, w) => {
  // Calculate distance from point to line segment
  const lengthSquared = Math.pow(w.x - v.x, 2) + Math.pow(w.y - v.y, 2);

  if (lengthSquared === 0) {
    // v == w case
    return Math.sqrt(Math.pow(p.x - v.x, 2) + Math.pow(p.y - v.y, 2));
  }

  // Project point onto line segment
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / lengthSquared;
  t = Math.max(0, Math.min(1, t));

  const projectionX = v.x + t * (w.x - v.x);
  const projectionY = v.y + t * (w.y - v.y);

  return Math.sqrt(Math.pow(p.x - projectionX, 2) + Math.pow(p.y - projectionY, 2));
};

/**
 * Check if a point is inside or near an element
 */
export const isPointInElement = (point, element, hitDistance = 10) => {
  switch (element.type) {
    case 'pen':
    case 'eraser': // Eraser hit detection might need refinement based on new logic
      // Check if point is close to any segment of the path
      if (!element.points || element.points.length < 2) return false;

      for (let i = 0; i < element.points.length - 1; i++) {
        const p1 = element.points[i];
        const p2 = element.points[i + 1];

        // Calculate distance from point to line segment
        const distance = distanceToSegment(point, p1, p2);

        // Consider line width for hit detection
        if (distance < (element.lineWidth / 2 + hitDistance)) {
          return true;
        }
      }
      return false;

    case 'line':
      // Consider line width for hit detection
      // Also check if lineStyle includes 'vector' to potentially increase hit area near arrowhead? (For simplicity, keep it the same for now)
      return distanceToSegment(point, element.start, element.end) < (element.lineWidth / 2 + hitDistance);

    case 'rectangle':
    case 'square': // Same hit detection as rectangle
      // Check if point is close to any edge of the rectangle
      const width = element.end.x - element.start.x;
      const height = element.end.y - element.start.y;
      const x = element.start.x;
      const y = element.start.y;

      // Check distance to each edge, considering line width
      const halfWidth = element.lineWidth / 2 + hitDistance;
      return (
        distanceToSegment(point, {x, y}, {x: x + width, y}) < halfWidth ||
        distanceToSegment(point, {x: x + width, y}, {x: x + width, y: y + height}) < halfWidth ||
        distanceToSegment(point, {x: x + width, y: y + height}, {x, y: y + height}) < halfWidth ||
        distanceToSegment(point, {x, y: y + height}, {x, y}) < halfWidth
      );

    case 'circle':
      // Calculate center and radius of circle
      const centerX = (element.start.x + element.end.x) / 2;
      const centerY = (element.start.y + element.end.y) / 2;
      const radius = Math.sqrt(
        Math.pow(element.end.x - element.start.x, 2) +
        Math.pow(element.end.y - element.start.y, 2)
      ) / 2;

      // Calculate distance from point to center
      const distanceFromCenter = Math.sqrt(
        Math.pow(point.x - centerX, 2) +
        Math.pow(point.y - centerY, 2)
      );

      // Check if point is close to the circle edge, considering line width
      return Math.abs(distanceFromCenter - radius) < (element.lineWidth / 2 + hitDistance);

    // --- Hit detection for new shapes ---
    // These are simplified bounding box checks or distance to edges.
    // More accurate point-in-polygon tests could be implemented if needed.

    case 'triangle': {
      const midX = element.start.x + (element.end.x - element.start.x) / 2;
      const p1 = { x: midX, y: element.start.y };
      const p2 = { x: element.end.x, y: element.end.y };
      const p3 = { x: element.start.x, y: element.end.y };
      return distanceToSegment(point, p1, p2) < hitDistance ||
             distanceToSegment(point, p2, p3) < hitDistance ||
             distanceToSegment(point, p3, p1) < hitDistance;
    }
    case 'trapezoid': {
      const width = element.end.x - element.start.x;
      const inset = width * 0.2;
      const p1 = { x: element.start.x + inset, y: element.start.y };
      const p2 = { x: element.end.x - inset, y: element.start.y };
      const p3 = { x: element.end.x, y: element.end.y };
      const p4 = { x: element.start.x, y: element.end.y };
      return distanceToSegment(point, p1, p2) < hitDistance ||
             distanceToSegment(point, p2, p3) < hitDistance ||
             distanceToSegment(point, p3, p4) < hitDistance ||
             distanceToSegment(point, p4, p1) < hitDistance;
    }
    case 'parallelogram': {
       const width = element.end.x - element.start.x;
       const slant = width * 0.2;
       const p1 = { x: element.start.x + slant, y: element.start.y };
       const p2 = { x: element.end.x + slant, y: element.start.y };
       const p3 = { x: element.end.x - slant, y: element.end.y };
       const p4 = { x: element.start.x - slant, y: element.end.y };
       return distanceToSegment(point, p1, p2) < hitDistance ||
              distanceToSegment(point, p2, p3) < hitDistance ||
              distanceToSegment(point, p3, p4) < hitDistance ||
              distanceToSegment(point, p4, p1) < hitDistance;
    }
    case 'deltoid': {
      const midX = element.start.x + (element.end.x - element.start.x) / 2;
      const midY = element.start.y + (element.end.y - element.start.y) / 2;
      const p1 = { x: midX, y: element.start.y };
      const p2 = { x: element.end.x, y: midY };
      const p3 = { x: midX, y: element.end.y };
      const p4 = { x: element.start.x, y: midY };
      return distanceToSegment(point, p1, p2) < hitDistance ||
             distanceToSegment(point, p2, p3) < hitDistance ||
             distanceToSegment(point, p3, p4) < hitDistance ||
             distanceToSegment(point, p4, p1) < hitDistance;
    }
    // 3D shapes - use simple bounding box check for now
    case 'cube':
    case 'cuboid':
    case 'sphere': // Treat as circle for hit detection
    case 'cylinder':
    case 'cone':
    case 'pyramid':
    case 'tetrahedron': {
      // Simple bounding box check for all 3D representations
      const minX = Math.min(element.start.x, element.end.x) - hitDistance;
      const maxX = Math.max(element.start.x, element.end.x) + hitDistance;
      const minY = Math.min(element.start.y, element.end.y) - hitDistance;
      const maxY = Math.max(element.start.y, element.end.y) + hitDistance;
      // Adjust for isometric offsets if needed, but simple box is often sufficient
      return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
    }

    case 'text':
      // Use a rectangular area around text
      // This is a simplification - actual text measurement would be better
      const textWidth = element.text.length * (element.fontSize / 2); // Approximation
      const textHeight = element.fontSize;

      return (
        point.x >= element.position.x - hitDistance &&
        point.x <= element.position.x + textWidth + hitDistance &&
        point.y >= element.position.y - textHeight - hitDistance &&
        point.y <= element.position.y + hitDistance
      );

    case 'image':
      // Check if point is inside the image rectangle
      // Add hitDistance buffer around the image
      return (
        point.x >= element.position.x - hitDistance &&
        point.x <= element.position.x + element.width + hitDistance &&
        point.y >= element.position.y - hitDistance &&
        point.y <= element.position.y + element.height + hitDistance
      );

    default:
      return false;
  }
};


