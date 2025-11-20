/**
 * Canvas Drawing Utilities
 * Provides functions for drawing different elements on the canvas
 */

import * as math from 'mathjs'; // Import mathjs

// Throttle function to limit the rate of function calls
export const throttle = (fn, delay) => {
  let lastCall = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      fn.apply(this, args);
    }
  };
};

/**
 * Draw a single element on the canvas.
 * This is the main dispatcher that renders all element types.
 *
 * @param {CanvasRenderingContext2D} context - Canvas 2D context
 * @param {Object} element - Element data (type, geometry, style, etc.)
 * @param {boolean} [isHighlighted=false] - Whether element should be highlighted (e.g. eraser hover)
 * @param {number} [smoothingFactor=0.65] - Reserved for future pen smoothing (currently unused here)
 * @param {Map<string, HTMLImageElement>} [imageCache] - Cache used for image elements
 * @param {Function} [requestRedraw] - Callback to request a redraw when async work (image load) finishes
 */
export const drawElement = (
  context,
  element,
  isHighlighted = false,
  smoothingFactor = 0.65,
  imageCache,
  requestRedraw
) => {
  if (!context || !element || !element.type) return;

  const type = element.type;

  // Base style
  const baseColor = element.color || '#000000';
  const color = isHighlighted ? '#ff5252' : baseColor;
  const lw = element.lineWidth || 2;

  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = lw;

  switch (type) {
    case 'pen':
    case 'eraser': {
      const points = element.points || [];
      if (points.length < 2) break;

      context.beginPath();

      if (points.length < 3 || type === 'eraser') {
        // Simple line for very short strokes or eraser
        context.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          context.lineTo(points[i].x, points[i].y);
        }
      } else {
        // Catmull-Rom spline for smooth pen strokes
        context.moveTo(points[0].x, points[0].y);

        for (let i = 0; i < points.length - 1; i++) {
          const p0 = points[Math.max(0, i - 1)];
          const p1 = points[i];
          const p2 = points[i + 1];
          const p3 = points[Math.min(points.length - 1, i + 2)];

          // Interpolate between p1 and p2
          // Using a fixed number of segments per point pair for simplicity/performance
          // or just using the canvas bezierCurveTo if we convert control points.
          // For simplicity and performance in canvas, quadratic curves often look good enough:
          // Midpoint smoothing:
          const midX = (p1.x + p2.x) / 2;
          const midY = (p1.y + p2.y) / 2;
          // context.quadraticCurveTo(p1.x, p1.y, midX, midY);

          // Better: Catmull-Rom to Bezier conversion for native canvas drawing
          // cp1 = p1 + (p2 - p0) / 6 * tension
          // cp2 = p2 - (p3 - p1) / 6 * tension
          const tension = 1;

          const cp1x = p1.x + (p2.x - p0.x) / 6 * tension;
          const cp1y = p1.y + (p2.y - p0.y) / 6 * tension;

          const cp2x = p2.x - (p3.x - p1.x) / 6 * tension;
          const cp2y = p2.y - (p3.y - p1.y) / 6 * tension;

          context.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
        }
      }

      context.stroke();
      break;
    }

    case 'line': {
      if (!element.start || !element.end) break;

      const rawLineStyle = element.lineStyle || 'solid';
      const normalizedLineStyle = rawLineStyle === 'vector'
        ? 'solid'
        : rawLineStyle === 'dotted_vector'
          ? 'dotted'
          : rawLineStyle;
      const arrowStyle = element.arrowStyle || ((rawLineStyle === 'vector' || rawLineStyle === 'dotted_vector') ? 'end' : 'none');
      let dashPattern = [];
      if (normalizedLineStyle === 'dotted') {
        dashPattern = [lw, lw * 2];
      } else if (normalizedLineStyle === 'dashed') {
        dashPattern = [lw * 4, lw * 2];
      }

      if (dashPattern.length > 0) {
        context.setLineDash(dashPattern);
      }

      context.beginPath();
      context.moveTo(element.start.x, element.start.y);
      context.lineTo(element.end.x, element.end.y);
      context.stroke();

      // Reset line dash *before* drawing arrowhead if needed
      if (dashPattern.length > 0) {
        context.setLineDash([]);
      }

      // Draw arrowheads for arrow styles
      if (arrowStyle === 'end' || arrowStyle === 'both') {
        context.fillStyle = color;
        drawArrowhead(context, element.start, element.end, lw);
      }
      if (arrowStyle === 'start' || arrowStyle === 'both') {
        context.fillStyle = color;
        drawArrowhead(context, element.end, element.start, lw);
      }

      break;
    }

    case 'rectangle':
      if (element.start && element.end) {
        drawRectangle(context, element);
      }
      break;

    case 'square':
      if (element.start && element.end) {
        drawSquare(context, element);
      }
      break;

    case 'triangle':
      if (element.start && element.end) {
        drawTriangle(context, element);
      }
      break;

    case 'trapezoid':
      if (element.start && element.end) {
        drawTrapezoid(context, element);
      }
      break;

    case 'parallelogram':
      if (element.start && element.end) {
        drawParallelogram(context, element);
      }
      break;

    case 'deltoid':
      if (element.start && element.end) {
        drawDeltoid(context, element);
      }
      break;

    case 'cube':
      if (element.start && element.end) {
        drawCube(context, element);
      }
      break;

    case 'cuboid':
      if (element.start && element.end) {
        drawCuboid(context, element);
      }
      break;

    case 'sphere':
      if (element.start && element.end) {
        drawSphere(context, element);
      }
      break;

    case 'cylinder':
      if (element.start && element.end) {
        drawCylinder(context, element);
      }
      break;

    case 'cone':
      if (element.start && element.end) {
        drawCone(context, element);
      }
      break;

    case 'pyramid':
      if (element.start && element.end) {
        drawPyramid(context, element);
      }
      break;

    case 'tetrahedron':
      if (element.start && element.end) {
        drawTetrahedron(context, element);
      }
      break;

    case 'circle':
      if (element.start && element.end) {
        drawCircle(context, element);
      }
      break;

    case 'text':
      if (element.position && element.text) {
        drawText(context, element);
      }
      break;

    case 'image':
      if (imageCache) {
        drawImage(context, element, imageCache, requestRedraw);
      }
      break;

    case 'coordinateSystem2D':
      if (element.position) {
        drawCoordinateSystem2D(context, element);
      }
      break;

    case 'mathFunctionPlot':
      if (element.position && element.expression) {
        drawMathFunctionPlot(context, element);
      }
      break;

    case 'physicsDataPlot':
      if (element.position) {
        drawPhysicsDataPlot(context, element);
      }
      break;

    case 'coordinateSystem3D':
      if (element.position) {
        drawCoordinateSystem3D(context, element);
      }
      break;

    default:
      // Unknown element type; nothing to draw
      break;
  }

  context.restore(); // Restore original context state
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
  // Use element's width and height if available, otherwise rely on canvas transform
  // The position (x, y) is the top-left corner of the text bounding box in whiteboard coordinates
  const x = element.position.x;
  const y = element.position.y;
  const width = element.width; // Use stored width
  const height = element.height; // Use stored height

  // For text, fillText draws from the baseline. Adjust y position to account for height.
  // Assuming element.position.y is the top of the bounding box.
  const textBaseline = 'top'; // Set text baseline to top for consistent positioning
  context.textBaseline = textBaseline;

  // If width and height are available, we could potentially scale or wrap text,
  // but for now, just drawing at the correct transformed position is the goal.
  // The canvas transform already handles scaling based on zoomLevel.
  context.fillText(element.text, x, y);

  // Optional: Draw bounding box for debugging
  // if (width && height) {
  //   context.strokeStyle = 'rgba(0, 0, 255, 0.5)';
  //   context.strokeRect(x, y, width, height);
  // }
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
    // console.error("drawImage called with invalid element data:", element);
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
      // console.log(`Drawing image: ${dataUrl.substring(0,20)}... at (${element.position?.x}, ${element.position?.y}) size ${width}x${height}`);
      // Image loaded, draw it using direct access
      context.drawImage(img, element.position.x, element.position.y, width, height);

    } else if (!img.complete) {
      // Image is loading, maybe draw placeholder or wait
      // console.log(`Image ${dataUrl.substring(0, 20)}... is loading`);
    } else {
      // Image failed to load (e.g., broken dataUrl)
      // console.warn(`Cached image for ${dataUrl.substring(0, 20)}... failed to load previously.`);
      // Optionally draw an error indicator
    }
  } else {
    // Image not in cache, start loading
    img = new Image();
    img.onload = () => { // Remove async/await
      // console.log(`Image ${dataUrl.substring(0, 20)}... loaded successfully.`); // Keep this one for debugging image loading itself
      // Image loaded, request a redraw to display it
      if (requestRedraw) {
        // await new Promise(resolve => setTimeout(resolve, 0)); // Remove await
        requestRedraw(); // Direct call
        // console.log(`Requested redraw after image load: ${dataUrl.substring(0, 20)}...`);
      }
    };
    img.onerror = (err) => {
      // console.error(`Failed to load image: ${dataUrl.substring(0, 20)}...`, err);
      // Mark as failed in cache? Or remove? For now, just log.
      // Consider removing from cache to allow retry?
      // imageCache.delete(dataUrl);
    };
    img.src = dataUrl;
    imageCache.set(dataUrl, img); // Add to cache immediately (while loading)
    // console.log(`Started loading image ${dataUrl.substring(0, 20)}...`);
  }
};

// --- NEW Graph/Coordinate System Drawing Functions ---

/**
 * Draw a 2D Coordinate System
 */
const drawCoordinateSystem2D = (context, element) => {
  const { x, y } = element.position;
  const { width, height, color, lineWidth, grid, xLabel, yLabel } = element;
  const axisColor = color || '#000000';
  const axisLineWidth = lineWidth || 1;
  const labelFont = '12px Arial';
  const labelColor = '#333';
  const gridColor = '#e0e0e0';
  const tickLength = 5;
  const numTicks = 5; // Number of ticks on each side of the origin

  context.save();
  context.strokeStyle = axisColor;
  context.lineWidth = axisLineWidth;
  context.font = labelFont;
  context.fillStyle = labelColor;
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  // Draw axes
  context.beginPath();
  // X-axis
  context.moveTo(x, y + height / 2);
  context.lineTo(x + width, y + height / 2);
  // Y-axis
  context.moveTo(x + width / 2, y);
  context.lineTo(x + width / 2, y + height);
  context.stroke();

  // Draw grid lines (optional)
  if (grid) {
    context.strokeStyle = gridColor;
    context.lineWidth = 0.5;
    context.beginPath();
    // Vertical grid lines
    for (let i = 1; i <= numTicks; i++) {
      const gridXPos = x + width / 2 + (i * (width / 2) / numTicks);
      const gridXNeg = x + width / 2 - (i * (width / 2) / numTicks);
      context.moveTo(gridXPos, y);
      context.lineTo(gridXPos, y + height);
      context.moveTo(gridXNeg, y);
      context.lineTo(gridXNeg, y + height);
    }
    // Horizontal grid lines
    for (let i = 1; i <= numTicks; i++) {
      const gridYPos = y + height / 2 + (i * (height / 2) / numTicks);
      const gridYNeg = y + height / 2 - (i * (height / 2) / numTicks);
      context.moveTo(x, gridYPos);
      context.lineTo(x + width, gridYPos);
      context.moveTo(x, gridYNeg);
      context.lineTo(x + width, gridYNeg);
    }
    context.stroke();
  }

  // Draw ticks and labels
  context.strokeStyle = axisColor; // Reset for ticks
  context.lineWidth = axisLineWidth;
  context.beginPath();
  // X-axis ticks
  for (let i = -numTicks; i <= numTicks; i++) {
    if (i === 0) continue;
    const tickX = x + width / 2 + (i * (width / 2) / numTicks);
    context.moveTo(tickX, y + height / 2 - tickLength);
    context.lineTo(tickX, y + height / 2 + tickLength);
  }
  // Y-axis ticks
  for (let i = -numTicks; i <= numTicks; i++) {
    if (i === 0) continue;
    const tickY = y + height / 2 + (i * (height / 2) / numTicks);
    context.moveTo(x + width / 2 - tickLength, tickY);
    context.lineTo(x + width / 2 + tickLength, tickY);
  }
  context.stroke();

  // Labels
  context.fillText(xLabel || 'x', x + width - 10, y + height / 2 + 15);
  context.fillText(yLabel || 'y', x + width / 2 + 10, y + 10);

  context.restore();
};

/**
 * Draw a Math Function Plot
 */
const drawMathFunctionPlot = (context, element) => {
  const { x: plotX, y: plotY } = element.position;
  const { width, height, expression, color, lineWidth } = element;
  const plotColor = color || '#007bff';
  const plotLineWidth = lineWidth || 2;
  const steps = 100; // Number of points to calculate

  context.save();
  context.strokeStyle = plotColor;
  context.lineWidth = plotLineWidth;
  context.beginPath();

  // --- Basic Coordinate System within the plot area ---
  const axisColor = '#aaaaaa';
  const axisLineWidth = 0.5;
  context.strokeStyle = axisColor;
  context.lineWidth = axisLineWidth;
  // X-axis (relative to plot origin)
  context.moveTo(plotX, plotY + height / 2);
  context.lineTo(plotX + width, plotY + height / 2);
  // Y-axis (relative to plot origin)
  context.moveTo(plotX + width / 2, plotY);
  context.lineTo(plotX + width / 2, plotY + height);
  context.stroke();
  // --- End Basic Coordinate System ---

  // Reset for function plot
  context.strokeStyle = plotColor;
  context.lineWidth = plotLineWidth;
  context.beginPath();

  let firstPoint = true;
  try {
    const compiledExpr = math.compile(expression || 'x');
    const scope = {};

    // Determine plot domain (e.g., map width to -10 to 10)
    const xMin = -10;
    const xMax = 10;
    const yMin = -10;
    const yMax = 10;

    for (let i = 0; i <= steps; i++) {
      const xVal = xMin + (xMax - xMin) * (i / steps);
      scope.x = xVal;
      let yVal;
      try {
        yVal = compiledExpr.evaluate(scope);
      } catch (evalError) {
        // Skip points where evaluation fails (e.g., tan(pi/2))
        firstPoint = true; // Start new line segment after discontinuity
        continue;
      }


      // Check if yVal is a valid number
      if (typeof yVal !== 'number' || !isFinite(yVal)) {
        firstPoint = true; // Start new line segment after discontinuity
        continue;
      }

      // Scale to canvas coordinates within the plot area
      const canvasX = plotX + ((xVal - xMin) / (xMax - xMin)) * width;
      // Invert Y-axis for canvas (0,0 is top-left)
      const canvasY = plotY + height - ((yVal - yMin) / (yMax - yMin)) * height;

      // Clip drawing to the plot area
      if (canvasX >= plotX && canvasX <= plotX + width && canvasY >= plotY && canvasY <= plotY + height) {
        if (firstPoint) {
          context.moveTo(canvasX, canvasY);
          firstPoint = false;
        } else {
          context.lineTo(canvasX, canvasY);
        }
      } else {
        // If point is outside, start a new line segment when it re-enters
        firstPoint = true;
      }
    }
    context.stroke();
  } catch (err) {
    // console.error("Error evaluating or drawing math function:", err);
    // Optionally draw an error message on the canvas
    context.fillStyle = 'red';
    context.font = '12px Arial';
    context.fillText('Error in function', plotX + 10, plotY + 20);
  }

  context.restore();
};

/**
 * Draw a Physics Data Plot
 */
const drawPhysicsDataPlot = (context, element) => {
  const { x: plotX, y: plotY } = element.position;
  const { width, height, xData, yData, color, lineWidth, mode } = element;
  const plotColor = color || '#dc3545';
  const plotLineWidth = lineWidth || 1;
  const plotMode = mode || 'lines+markers'; // 'lines', 'markers', 'lines+markers'
  const markerSize = Math.max(3, plotLineWidth * 1.5);

  if (!xData || !yData || xData.length !== yData.length || xData.length === 0) {
    // console.warn("Invalid or empty data for physics plot:", element);
    // Optionally draw a message
    context.save();
    context.fillStyle = '#888';
    context.font = '12px Arial';
    context.fillText('No data', plotX + 10, plotY + 20);
    context.restore();
    return;
  }

  context.save();
  context.strokeStyle = plotColor;
  context.fillStyle = plotColor;
  context.lineWidth = plotLineWidth;

  // --- Basic Coordinate System within the plot area ---
  const axisColor = '#aaaaaa';
  const axisLineWidth = 0.5;
  context.strokeStyle = axisColor;
  context.lineWidth = axisLineWidth;
  // X-axis
  context.moveTo(plotX, plotY + height / 2);
  context.lineTo(plotX + width, plotY + height / 2);
  // Y-axis
  context.moveTo(plotX + width / 2, plotY);
  context.lineTo(plotX + width / 2, plotY + height);
  context.stroke();
  // --- End Basic Coordinate System ---

  // Reset for data plot
  context.strokeStyle = plotColor;
  context.fillStyle = plotColor;
  context.lineWidth = plotLineWidth;

  // Determine data range
  const xMin = Math.min(...xData);
  const xMax = Math.max(...xData);
  const yMin = Math.min(...yData);
  const yMax = Math.max(...yData);

  // Add padding to range if min === max
  const xRange = (xMax === xMin) ? 1 : xMax - xMin;
  const yRange = (yMax === yMin) ? 1 : yMax - yMin;

  const scaleX = (val) => plotX + ((val - xMin) / xRange) * width;
  const scaleY = (val) => plotY + height - ((val - yMin) / yRange) * height; // Invert Y

  // Draw lines
  if (plotMode.includes('lines')) {
    context.beginPath();
    for (let i = 0; i < xData.length; i++) {
      const canvasX = scaleX(xData[i]);
      const canvasY = scaleY(yData[i]);
      if (i === 0) {
        context.moveTo(canvasX, canvasY);
      } else {
        context.lineTo(canvasX, canvasY);
      }
    }
    context.stroke();
  }

  // Draw markers
  if (plotMode.includes('markers')) {
    for (let i = 0; i < xData.length; i++) {
      const canvasX = scaleX(xData[i]);
      const canvasY = scaleY(yData[i]);
      context.beginPath();
      context.arc(canvasX, canvasY, markerSize / 2, 0, Math.PI * 2);
      context.fill();
    }
  }

  context.restore();
};

/**
 * Draw a 3D Coordinate System (Basic Projection)
 */
const drawCoordinateSystem3D = (context, element) => {
  const { x: centerX, y: centerY } = element.position; // Center point
  const { size, color, lineWidth, xLabel, yLabel, zLabel } = element;
  const axisColor = color || '#000000';
  const axisLineWidth = lineWidth || 1;
  const labelFont = '12px Arial';
  const labelColor = '#333';
  const perspectiveFactor = 0.5; // How much the Z axis is foreshortened/angled

  context.save();
  context.strokeStyle = axisColor;
  context.lineWidth = axisLineWidth;
  context.font = labelFont;
  context.fillStyle = labelColor;
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  const halfSize = size / 2;

  // Projected endpoints
  const xEnd = { x: centerX + halfSize, y: centerY };
  const yEnd = { x: centerX, y: centerY - halfSize }; // Y goes up
  const zEnd = {
    x: centerX - halfSize * perspectiveFactor,
    y: centerY + halfSize * perspectiveFactor * 0.8 // Angle Z slightly down-left
  };

  // Draw axes
  context.beginPath();
  // X-axis
  context.moveTo(centerX, centerY);
  context.lineTo(xEnd.x, xEnd.y);
  // Y-axis
  context.moveTo(centerX, centerY);
  context.lineTo(yEnd.x, yEnd.y);
  // Z-axis (dashed for 'negative' part if needed, simple line for now)
  context.moveTo(centerX, centerY);
  context.lineTo(zEnd.x, zEnd.y);
  context.stroke();

  // Draw arrowheads
  context.fillStyle = axisColor; // Use axis color for arrowheads
  drawArrowhead(context, { x: centerX, y: centerY }, xEnd, axisLineWidth * 3);
  drawArrowhead(context, { x: centerX, y: centerY }, yEnd, axisLineWidth * 3);
  drawArrowhead(context, { x: centerX, y: centerY }, zEnd, axisLineWidth * 3);

  // Labels
  context.fillText(xLabel || 'x', xEnd.x + 10, xEnd.y);
  context.fillText(yLabel || 'y', yEnd.x, yEnd.y - 15);
  context.fillText(zLabel || 'z', zEnd.x - 10, zEnd.y + 10);

  context.restore();
};


// --- End NEW Graph/Coordinate System Drawing Functions ---


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
  // Add a check for element validity
  if (!element || !element.type) return false;

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
      if (!element.start || !element.end) return false;
      // Consider line width for hit detection
      return distanceToSegment(point, element.start, element.end) < (element.lineWidth / 2 + hitDistance);

    case 'rectangle':
    case 'square': // Same hit detection as rectangle
      if (!element.start || !element.end) return false;
      // Check if point is close to any edge of the rectangle
      const width = element.end.x - element.start.x;
      const height = element.end.y - element.start.y;
      const x = element.start.x;
      const y = element.start.y;

      // Check distance to each edge, considering line width
      const halfWidth = element.lineWidth / 2 + hitDistance;
      return (
        distanceToSegment(point, { x, y }, { x: x + width, y }) < halfWidth ||
        distanceToSegment(point, { x: x + width, y }, { x: x + width, y: y + height }) < halfWidth ||
        distanceToSegment(point, { x: x + width, y: y + height }, { x, y: y + height }) < halfWidth ||
        distanceToSegment(point, { x, y: y + height }, { x, y }) < halfWidth
      );

    case 'circle':
      if (!element.start || !element.end) return false;
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
      if (!element.start || !element.end) return false;
      const midX = element.start.x + (element.end.x - element.start.x) / 2;
      const p1 = { x: midX, y: element.start.y };
      const p2 = { x: element.end.x, y: element.end.y };
      const p3 = { x: element.start.x, y: element.end.y };
      return distanceToSegment(point, p1, p2) < hitDistance ||
        distanceToSegment(point, p2, p3) < hitDistance ||
        distanceToSegment(point, p3, p1) < hitDistance;
    }
    case 'trapezoid': {
      if (!element.start || !element.end) return false;
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
      if (!element.start || !element.end) return false;
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
      if (!element.start || !element.end) return false;
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
      if (!element.start || !element.end) return false;
      // Simple bounding box check for all 3D representations
      const minX = Math.min(element.start.x, element.end.x) - hitDistance;
      const maxX = Math.max(element.start.x, element.end.x) + hitDistance;
      const minY = Math.min(element.start.y, element.end.y) - hitDistance;
      const maxY = Math.max(element.start.y, element.end.y) + hitDistance;
      // Adjust for isometric offsets if needed, but simple box is often sufficient
      return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
    }

    case 'text':
      if (!element.position || !element.text || !element.fontSize) return false;
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
      if (!element.position || !element.width || !element.height) return false;
      // Check if point is inside the image rectangle
      // Add hitDistance buffer around the image
      return (
        point.x >= element.position.x - hitDistance &&
        point.x <= element.position.x + element.width + hitDistance &&
        point.y >= element.position.y - hitDistance &&
        point.y <= element.position.y + element.height + hitDistance
      );

    // --- Hit detection for new graph types ---
    case 'coordinateSystem2D':
    case 'mathFunctionPlot':
    case 'physicsDataPlot':
      if (!element.position || !element.width || !element.height) return false;
      // Simple bounding box check for plots/coordinate systems
      return (
        point.x >= element.position.x - hitDistance &&
        point.x <= element.position.x + element.width + hitDistance &&
        point.y >= element.position.y - hitDistance &&
        point.y <= element.position.y + element.height + hitDistance
      );
    case 'coordinateSystem3D':
      if (!element.position || !element.size) return false;
      // Bounding box based on center and size (approximate)
      const halfSize = element.size / 2;
      const perspectiveFactor = 0.5; // Match drawing logic
      const minX = element.position.x - halfSize * perspectiveFactor - hitDistance;
      const maxX = element.position.x + halfSize + hitDistance;
      const minY = element.position.y - halfSize - hitDistance;
      const maxY = element.position.y + halfSize * perspectiveFactor * 0.8 + hitDistance;
      return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;


    default:
      return false;
  }
};
