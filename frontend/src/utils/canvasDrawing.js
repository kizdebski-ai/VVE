/**
 * Canvas Drawing Utilities
 * Provides functions for drawing different elements on the canvas using Rough.js for a hand-drawn aesthetic.
 */

import rough from 'roughjs';
import * as math from 'mathjs';

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
 * @param {number} [smoothingFactor=0.65] - Reserved for future pen smoothing
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
  const rc = rough.canvas(context.canvas);

  // Base style
  const baseColor = element.color || '#000000';
  const color = isHighlighted ? '#ff5252' : baseColor;
  const lw = element.lineWidth || 2;

  // RoughJS options
  const options = {
    stroke: color,
    strokeWidth: lw,
    roughness: 1.5, // Hand-drawn feel
    bowing: 1,      // Slight curve to lines
    seed: element.seed || 1 // Consistent seed for stable rendering
  };

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
        context.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          context.lineTo(points[i].x, points[i].y);
        }
      } else {
        // Catmull-Rom spline for smooth pen strokes (native canvas for performance)
        context.moveTo(points[0].x, points[0].y);
        for (let i = 0; i < points.length - 1; i++) {
          const p0 = points[Math.max(0, i - 1)];
          const p1 = points[i];
          const p2 = points[i + 1];
          const p3 = points[Math.min(points.length - 1, i + 2)];

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
      rc.line(element.start.x, element.start.y, element.end.x, element.end.y, options);

      // Arrowheads
      const arrowStyle = element.arrowStyle || 'none';
      if (arrowStyle === 'end' || arrowStyle === 'both') {
        drawArrowheadRough(rc, element.start, element.end, options);
      }
      if (arrowStyle === 'start' || arrowStyle === 'both') {
        drawArrowheadRough(rc, element.end, element.start, options);
      }
      break;
    }

    case 'rectangle':
    case 'square':
      if (element.start && element.end) {
        const x = Math.min(element.start.x, element.end.x);
        const y = Math.min(element.start.y, element.end.y);
        const w = Math.abs(element.end.x - element.start.x);
        const h = Math.abs(element.end.y - element.start.y);
        rc.rectangle(x, y, w, h, options);
      }
      break;

    case 'circle':
      if (element.start && element.end) {
        const centerX = (element.start.x + element.end.x) / 2;
        const centerY = (element.start.y + element.end.y) / 2;
        const width = Math.abs(element.end.x - element.start.x);
        const height = Math.abs(element.end.y - element.start.y);
        rc.ellipse(centerX, centerY, width, height, options);
      }
      break;

    case 'triangle':
      if (element.start && element.end) {
        const midX = element.start.x + (element.end.x - element.start.x) / 2;
        rc.polygon([
          [midX, element.start.y],
          [element.end.x, element.end.y],
          [element.start.x, element.end.y]
        ], options);
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

    // --- Advanced Shapes (RoughJS Implementation) ---

    case 'coordinateSystem2D':
      if (element.position) drawCoordinateSystem2D(rc, context, element, options);
      break;

    case 'mathFunctionPlot':
      if (element.position && element.expression) drawMathFunctionPlot(rc, context, element, options);
      break;

    case 'physicsDataPlot':
      if (element.position) drawPhysicsDataPlot(rc, context, element, options);
      break;

    case 'coordinateSystem3D':
      if (element.position) drawCoordinateSystem3D(rc, context, element, options);
      break;

    // --- 3D Primitives (2D Projection) ---
    case 'cube':
      drawCube(rc, element, options);
      break;
    case 'sphere':
      drawSphere(rc, element, options);
      break;
    case 'cylinder':
      drawCylinder(rc, element, options);
      break;
    case 'pyramid':
      drawPyramid(rc, element, options);
      break;

    default:
      break;
  }

  context.restore();
};

// --- Helper Functions ---

const drawArrowheadRough = (rc, from, to, options) => {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const headLength = 15;
  const x1 = to.x - headLength * Math.cos(angle - Math.PI / 6);
  const y1 = to.y - headLength * Math.sin(angle - Math.PI / 6);
  const x2 = to.x - headLength * Math.cos(angle + Math.PI / 6);
  const y2 = to.y - headLength * Math.sin(angle + Math.PI / 6);

  rc.line(to.x, to.y, x1, y1, options);
  rc.line(to.x, to.y, x2, y2, options);
};

const drawText = (context, element) => {
  context.font = `${element.fontSize}px "Virgil", "Segoe UI Emoji", sans-serif`; // Use handwritten font if available
  context.textBaseline = 'top';
  context.fillText(element.text, element.position.x, element.position.y);
};

const drawImage = (context, element, imageCache, requestRedraw) => {
  const { dataUrl, position, width, height } = element;
  if (!dataUrl || !position) return;

  let img = imageCache.get(dataUrl);
  if (img) {
    if (img.complete && img.naturalWidth > 0) {
      context.drawImage(img, position.x, position.y, width, height);
    }
  } else {
    img = new Image();
    img.onload = () => requestRedraw && requestRedraw();
    img.src = dataUrl;
    imageCache.set(dataUrl, img);
  }
};

// --- Graph & Plot Implementations ---

const drawCoordinateSystem2D = (rc, context, element, options) => {
  const { x, y } = element.position;
  const { width, height, xLabel, yLabel } = element;

  // Axes
  rc.line(x, y + height / 2, x + width, y + height / 2, options); // X
  rc.line(x + width / 2, y, x + width / 2, y + height, options); // Y

  // Arrows
  drawArrowheadRough(rc, { x, y: y + height / 2 }, { x: x + width, y: y + height / 2 }, options);
  drawArrowheadRough(rc, { x: x + width / 2, y: y + height }, { x: x + width / 2, y }, options);

  // Labels
  context.fillStyle = options.stroke;
  context.font = '16px sans-serif';
  context.fillText(xLabel || 'x', x + width - 15, y + height / 2 + 10);
  context.fillText(yLabel || 'y', x + width / 2 + 10, y);
};

const drawMathFunctionPlot = (rc, context, element, options) => {
  const { x: plotX, y: plotY } = element.position;
  const { width, height, expression } = element;

  // Draw axes first
  drawCoordinateSystem2D(rc, context, { ...element, xLabel: 'x', yLabel: 'f(x)' }, { ...options, stroke: '#666' });

  // Plot function
  try {
    const compiled = math.compile(expression || 'x');
    const points = [];
    const steps = 100;
    const xMin = -10, xMax = 10;
    const yMin = -10, yMax = 10;

    for (let i = 0; i <= steps; i++) {
      const xVal = xMin + (xMax - xMin) * (i / steps);
      const scope = { x: xVal };
      const yVal = compiled.evaluate(scope);

      if (typeof yVal === 'number' && isFinite(yVal)) {
        const canvasX = plotX + ((xVal - xMin) / (xMax - xMin)) * width;
        const canvasY = plotY + height - ((yVal - yMin) / (yMax - yMin)) * height;

        if (canvasY >= plotY && canvasY <= plotY + height) {
          points.push([canvasX, canvasY]);
        } else {
          if (points.length > 1) rc.curve(points, { ...options, stroke: element.color || '#007bff', strokeWidth: 3 });
          points.length = 0;
        }
      }
    }
    if (points.length > 1) rc.curve(points, { ...options, stroke: element.color || '#007bff', strokeWidth: 3 });

  } catch (e) {
    context.fillText('Error', plotX, plotY);
  }
};

const drawPhysicsDataPlot = (rc, context, element, options) => {
  const { x: plotX, y: plotY } = element.position;
  const { width, height, xData, yData } = element;

  // Axes
  drawCoordinateSystem2D(rc, context, { ...element, xLabel: 't', yLabel: 'v' }, { ...options, stroke: '#666' });

  if (!xData || !yData || xData.length === 0) return;

  const xMin = Math.min(...xData), xMax = Math.max(...xData);
  const yMin = Math.min(...yData), yMax = Math.max(...yData);
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  const points = xData.map((val, i) => {
    const cx = plotX + ((val - xMin) / xRange) * width;
    const cy = plotY + height - ((yData[i] - yMin) / yRange) * height;
    return [cx, cy];
  });

  // Draw curve
  rc.curve(points, { ...options, stroke: element.color || '#dc3545', strokeWidth: 3 });

  // Draw points
  points.forEach(([px, py]) => {
    rc.circle(px, py, 6, { ...options, fill: element.color || '#dc3545', fillStyle: 'solid' });
  });
};

const drawCoordinateSystem3D = (rc, context, element, options) => {
  const { x, y } = element.position;
  const size = element.size || 200;
  const half = size / 2;

  // Center
  const cx = x, cy = y;

  // Axes (Isometric-ish)
  const xEnd = { x: cx + half, y: cy + half * 0.5 };
  const yEnd = { x: cx - half, y: cy + half * 0.5 };
  const zEnd = { x: cx, y: cy - half };

  rc.line(cx, cy, xEnd.x, xEnd.y, options);
  rc.line(cx, cy, yEnd.x, yEnd.y, options);
  rc.line(cx, cy, zEnd.x, zEnd.y, options);

  context.fillText('x', xEnd.x, xEnd.y);
  context.fillText('y', yEnd.x, yEnd.y);
  context.fillText('z', zEnd.x, zEnd.y);
};

// --- 3D Shapes ---

const drawCube = (rc, element, options) => {
  const { start, end } = element;
  const size = Math.min(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);

  // Front face
  rc.rectangle(x, y + size * 0.25, size, size, options);
  // Top face
  rc.polygon([
    [x, y + size * 0.25],
    [x + size * 0.5, y],
    [x + size * 1.5, y],
    [x + size, y + size * 0.25]
  ], options);
  // Side face
  rc.polygon([
    [x + size, y + size * 0.25],
    [x + size * 1.5, y],
    [x + size * 1.5, y + size],
    [x + size, y + size + size * 0.25]
  ], options);
};

const drawSphere = (rc, element, options) => {
  const cx = (element.start.x + element.end.x) / 2;
  const cy = (element.start.y + element.end.y) / 2;
  const w = Math.abs(element.end.x - element.start.x);

  rc.circle(cx, cy, w, options);
  rc.ellipse(cx, cy, w, w * 0.3, options); // Equator
};

const drawCylinder = (rc, element, options) => {
  const w = Math.abs(element.end.x - element.start.x);
  const h = Math.abs(element.end.y - element.start.y);
  const x = Math.min(element.start.x, element.end.x);
  const y = Math.min(element.start.y, element.end.y);

  rc.ellipse(x + w / 2, y, w, w * 0.3, options); // Top
  rc.ellipse(x + w / 2, y + h, w, w * 0.3, options); // Bottom
  rc.line(x, y, x, y + h, options);
  rc.line(x + w, y, x + w, y + h, options);
};

const drawPyramid = (rc, element, options) => {
  const w = Math.abs(element.end.x - element.start.x);
  const h = Math.abs(element.end.y - element.start.y);
  const x = Math.min(element.start.x, element.end.x);
  const y = Math.min(element.start.y, element.end.y);

  const top = { x: x + w / 2, y: y };
  const bl = { x: x, y: y + h };
  const br = { x: x + w, y: y + h };
  const back = { x: x + w * 0.7, y: y + h * 0.8 };

  rc.polygon([
    [bl.x, bl.y], [br.x, br.y], [top.x, top.y]
  ], options);
  rc.line(top.x, top.y, back.x, back.y, { ...options, strokeLineDash: [5, 5] });
};

// Export hit detection (kept mostly same but imported)

// For now, let's keep the hit detection logic in this file to avoid breaking imports if it was here before.
// Re-implementing basic hit detection here for completeness as per instruction "Replace entire file".

export const distanceToSegment = (p, v, w) => {
  const l2 = Math.pow(w.x - v.x, 2) + Math.pow(w.y - v.y, 2);
  if (l2 === 0) return Math.sqrt(Math.pow(p.x - v.x, 2) + Math.pow(p.y - v.y, 2));
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const px = v.x + t * (w.x - v.x);
  const py = v.y + t * (w.y - v.y);
  return Math.sqrt(Math.pow(p.x - px, 2) + Math.pow(p.y - py, 2));
};

export const isPointInElement = (point, element, hitDistance = 10) => {
  if (!element || !element.type) return false;

  // Simplified hit detection for now
  const { start, end, position, width, height } = element;

  if (position && width && height) {
    return point.x >= position.x - hitDistance &&
      point.x <= position.x + width + hitDistance &&
      point.y >= position.y - hitDistance &&
      point.y <= position.y + height + hitDistance;
  }

  if (start && end) {
    const minX = Math.min(start.x, end.x) - hitDistance;
    const maxX = Math.max(start.x, end.x) + hitDistance;
    const minY = Math.min(start.y, end.y) - hitDistance;
    const maxY = Math.max(start.y, end.y) + hitDistance;
    return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
  }

  if (element.points) {
    for (let i = 0; i < element.points.length - 1; i++) {
      if (distanceToSegment(point, element.points[i], element.points[i + 1]) < hitDistance) return true;
    }
  }

  return false;
};
