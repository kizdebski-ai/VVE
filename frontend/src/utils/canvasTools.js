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
 * @param {Number} x - Center X position (renamed from centerX for clarity)
 * @param {Number} y - Center Y position (renamed from centerY for clarity)
 * @returns {Promise<Object>} - Promise resolving to image element object { type, x, y, position, width, height, dataUrl, timestamp }
 */
export const createImageElement = (dataUrl, x, y) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => {
      // Calculate reasonable size (adjust as needed)
      let width = img.width;
      let height = img.height;
      
      // Scale down large images proportionally
      const MAX_SIZE = 500;
      if (width > MAX_SIZE || height > MAX_SIZE) {
        const ratio = Math.min(MAX_SIZE / width, MAX_SIZE / height);
        width *= ratio;
        height *= ratio;
      }
      
      // Calculate top-left from center for the position object
      const topLeftX = x - width / 2;
      const topLeftY = y - height / 2;

      resolve({
        type: 'image',
        x: topLeftX, // Store top-left x
        y: topLeftY, // Store top-left y
        position: { x: topLeftX, y: topLeftY }, // Ensure position object uses top-left
        dataUrl,
        width,
        height,
        timestamp: Date.now()
      });
    };
    
    img.onerror = () => {
      reject(new Error("Failed to load image"));
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
