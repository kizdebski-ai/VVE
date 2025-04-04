/**
 * Canvas Tools Module
 * Provides functionality for different drawing tools
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Create a new element based on the selected tool and initial position
 * @param {string} tool - Current selected tool
 * @param {object} coords - Transformed coordinates {x, y}
 * @param {string} color - Current color
 * @param {number} lineWidth - Current line width
 * @param {object} [extraData={}] - Optional additional data (e.g., lineStyle)
 * @returns {object|null} - New element or null if not applicable
 */
export const createNewElement = (tool, coords, color, lineWidth, extraData = {}) => {
  const elementId = uuidv4();

  switch (tool) {
    case 'pen':
      // Pen doesn't use start/end or lineStyle
      const penElement = {
        id: elementId, // Keep ID for preview consistency if needed
        type: tool,
        points: [coords],
        smoothedPoints: [],
        color: color,
        lineWidth: lineWidth,
        timestamp: Date.now()
      };
      // Remove potential lineStyle from extraData if passed incorrectly
      delete penElement.lineStyle;
      return penElement;

    case 'eraser':
      // Eraser preview might still be needed, but it won't be added to Yjs
      return {
        id: elementId,
        type: tool,
        points: [coords],
        smoothedPoints: [],
        // compositeOperation: 'destination-out', // No longer needed if we delete elements
        color: 'rgba(0,0,0,0.1)', // Placeholder color for preview?
        lineWidth: lineWidth * 2, // Eraser size
        timestamp: Date.now()
      };

    case 'line':
    case 'rectangle':
    case 'circle':
    // Add new shape types here as well
    case 'square':
    case 'triangle':
    case 'trapezoid':
    case 'parallelogram':
    case 'deltoid':
    case 'cube':
    case 'cuboid':
    case 'sphere':
    case 'cylinder':
    case 'cone':
    case 'pyramid':
    case 'tetrahedron':
      return {
        id: elementId,
        type: tool,
        start: coords,
        end: coords,
        color: color,
        lineWidth: lineWidth,
        timestamp: Date.now(),
        ...extraData // Spread additional data like lineStyle
      };

    case 'text':
      return null; // Text is handled separately with prompt

    case 'image':
      return null; // Image is handled separately

    default:
      return null;
  }
};

/**
 * Create a text element
 * @param {Object} position - x, y coordinates
 * @param {String} text - Text content
 * @param {String} color - Text color
 * @param {Number} fontSize - Font size (based on lineWidth)
 * @returns {Object} - Text element
 */
export const createTextElement = (position, text, color, fontSize) => {
  return {
    id: uuidv4(),
    type: 'text',
    position,
    text,
    color,
    fontSize,
    timestamp: Date.now()
  };
};

/**
 * Create an image element from data URL
 * @param {String} dataUrl - Image data URL
 * @param {Number} centerX - Center X position
 * @param {Number} centerY - Center Y position
 * @param {Number} maxDimension - Maximum width/height
 * @returns {Promise<Object>} - Promise resolving to image element object { id, type, position, width, height, dataUrl, timestamp }
 */
export const createImageElement = (dataUrl, centerX, centerY, maxDimension = 500) => {
  return new Promise((resolve, reject) => { // Add reject parameter
    const img = new Image();

    img.onload = () => {
      // Calculate size (max dimension, keeping aspect ratio)
      let width = img.naturalWidth; // Use naturalWidth/Height for original dimensions
      let height = img.naturalHeight;

      if (!width || !height) {
          // Log a warning instead of rejecting, as dimensions might update later
          console.warn("Image loaded with zero dimensions, proceeding anyway:", dataUrl.substring(0,30));
          // Optionally set a default small size or let the browser handle it
          width = width || 50; // Example: Default width if zero
          height = height || 50; // Example: Default height if zero
          // Do not reject or return here
      }

      // Ensure width/height are positive before proceeding with ratio calculation
      if (width > 0 && height > 0 && (width > maxDimension || height > maxDimension)) {
        const ratio = Math.min(maxDimension / width, maxDimension / height);
        width *= ratio;
        height *= ratio;
      }

      // Create image element data object
      resolve({
        // id: uuidv4(), // ID can be handled by Yjs Map structure if needed later
        type: 'image',
        position: { // Calculate top-left corner from center and final dimensions
          x: centerX - width / 2,
          y: centerY - height / 2
        },
        width,
        height,
        dataUrl,
        timestamp: Date.now()
      });
    };

    // Add error handling
    img.onerror = (err) => {
        console.error("Failed to load image in createImageElement:", err, dataUrl.substring(0, 30));
        reject(new Error("Failed to load image from data URL")); // Reject the promise
    };

    img.src = dataUrl;
  });
};


/**
 * Get appropriate cursor style for current tool
 * @param {String} tool - Current tool
 * @param {String} color - Current color
 * @param {String} eraserMode - Eraser mode ('erase' or 'delete')
 * @returns {String} - CSS cursor value
 */
export const getCursorStyle = (tool, color, eraserMode = 'erase') => {
  const encodedColor = encodeURIComponent(color);

  switch (tool) {
    case 'pen':
      return `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${encodedColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3" fill="${encodedColor}"/></svg>') 12 12, crosshair`;

    case 'eraser':
      // Use a consistent eraser cursor now that it deletes elements
       return `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13l-6 6-8-8 6-6 8 8z"/></svg>') 12 12, auto`;
      // if (eraserMode === 'erase') { // Keep old logic commented if needed
      //   return `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13l-6 6-8-8 6-6 8 8z"/></svg>') 12 12, auto`;
      // } else {
      //   return `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="red" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>') 12 12, auto`;
      // }

    case 'line':
      return `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${encodedColor}" stroke-width="2"><circle cx="12" cy="12" r="3" fill="${encodedColor}"/><circle cx="12" cy="12" r="8" stroke="${encodedColor}" stroke-width="1" fill="none"/></svg>') 12 12, crosshair`;

    case 'rectangle':
      return `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${encodedColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>') 12 12, crosshair`;

    case 'circle':
      return `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${encodedColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle></svg>') 12 12, crosshair`;

    case 'text':
      return 'text';

    case 'image':
      return `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${encodedColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>') 12 12, auto`;

    default:
      return 'crosshair';
  }
};
