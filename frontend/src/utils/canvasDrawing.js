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
  if (!element) return;

  context.save();

  // Set styles
  context.strokeStyle = element.color;
  context.fillStyle = element.color;
  context.lineWidth = element.lineWidth;
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
      // Eraser logic will be changed later to remove elements, not draw
      // For now, keep the path drawing if needed for preview? Or remove?
      // Let's comment it out for now, assuming eraser will target elements.
      // drawPath(context, element, smoothingFactor);
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
    case 'text':
      drawText(context, element);
      break;
    case 'image':
      // Pass cache and redraw request to drawImage
      drawImage(context, element, imageCache, requestRedraw);
      break;
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
      // Zaawansowane wygładzanie krzywych z adaptacyjną kontrolą

      // Start from the first point
      context.moveTo(element.points[0].x, element.points[0].y);

      // Jeśli element ma już obliczone punkty kontrolne, użyj ich
      if (element.smoothedPoints && element.smoothedPoints.length > 0) {
        for (let i = 1; i < element.points.length - 1; i++) {
          if (element.smoothedPoints[i]) {
            const cp = element.smoothedPoints[i];
            context.bezierCurveTo(
              cp.cp1x, cp.cp1y,
              cp.cp2x, cp.cp2y,
              element.points[i+1].x, element.points[i+1].y
            );
          } else {
            // Fallback jeśli brak punktów kontrolnych
            context.lineTo(element.points[i+1].x, element.points[i+1].y);
          }
        }
      } else {
        // Oblicz krzywe w locie z adaptacyjnym wygładzaniem

        // Użyj wyższej wartości smoothingFactor dla większej płynności
        const adaptiveSmoothingFactor = Math.min(0.4, smoothingFactor * 2);

        // Przepuść przez wszystkie punkty z większą precyzją
        for (let i = 0; i < element.points.length - 1; i++) {
          const p0 = i > 0 ? element.points[i-1] : element.points[i];
          const p1 = element.points[i];
          const p2 = element.points[i+1];
          const p3 = i < element.points.length - 2 ? element.points[i+2] : p2;

          // Usprawniona konwersja Catmull-Rom do krzywej Beziera
          const d1 = Math.sqrt(Math.pow(p1.x - p0.x, 2) + Math.pow(p1.y - p0.y, 2));
          const d2 = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
          const d3a = Math.sqrt(Math.pow(p3.x - p2.x, 2) + Math.pow(p3.y - p2.y, 2));

          // Dostosuj współczynnik wygładzania w zależności od odległości punktów
          const tensionFactor = Math.min(d1, d2, d3a) / Math.max(d1, d2, d3a);
          const tension = adaptiveSmoothingFactor * (0.5 + tensionFactor / 2);

          // Punkty kontrolne z adaptacyjną tensją
          const cp1x = p1.x + (p2.x - p0.x) / 6 * tension;
          const cp1y = p1.y + (p2.y - p0.y) / 6 * tension;
          const cp2x = p2.x - (p3.x - p1.x) / 6 * tension;
          const cp2y = p2.y - (p3.y - p1.y) / 6 * tension;

          // Dodaj krzywą Beziera
          if (i === 0) {
            context.lineTo(p1.x, p1.y);
          }
          context.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
        }
      }

      context.stroke();
    }
  }
};

/**
 * Draw a line
 */
const drawLine = (context, element) => {
  context.beginPath();
  context.moveTo(element.start.x, element.start.y);
  context.lineTo(element.end.x, element.end.y);
  context.stroke();
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
      return distanceToSegment(point, element.start, element.end) < (element.lineWidth / 2 + hitDistance);

    case 'rectangle':
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
