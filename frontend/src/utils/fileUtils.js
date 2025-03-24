/**
 * File Utilities
 * Functions for handling files, images, and clipboard data
 */

/**
 * Read a file as a data URL
 * @param {File} file - File to read
 * @returns {Promise<string>} Promise resolving to data URL
 */
export const readFileAsDataURL = (file) => {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No file provided'));
      return;
    }

    const reader = new FileReader();

    reader.onload = (e) => {
      resolve(e.target.result);
    };

    reader.onerror = (e) => {
      reject(new Error('Error reading file: ' + e.target.error));
    };

    reader.readAsDataURL(file);
  });
};

/**
 * Export canvas as a PNG image
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @param {string} filename - Filename for the download
 */
export const exportCanvasAsPNG = (canvas, filename = 'whiteboard.png') => {
  try {
    // Create a new canvas with white background (in case of transparent canvas)
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;

    const ctx = exportCanvas.getContext('2d');

    // Fill with white background
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    // Draw original canvas content
    ctx.drawImage(canvas, 0, 0);

    // Convert to data URL and trigger download
    const dataURL = exportCanvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataURL;
    link.click();

    return dataURL;
  } catch (error) {
    console.error('Error exporting canvas:', error);
    throw error;
  }
};

/**
 * Create an image element from a data URL with specified dimensions
 * @param {string} dataUrl - Image data URL
 * @param {number} maxDimension - Maximum width or height
 * @returns {Promise<HTMLImageElement>} Promise resolving to sized image
 */
export const createSizedImageFromDataURL = (dataUrl, maxDimension = 500) => {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      // Calculate size keeping aspect ratio
      let width = img.width;
      let height = img.height;

      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = height * (maxDimension / width);
          width = maxDimension;
        } else {
          width = width * (maxDimension / height);
          height = maxDimension;
        }
      }

      // Add dimension properties to the image
      img.displayWidth = width;
      img.displayHeight = height;

      resolve(img);
    };

    img.onerror = () => {
      reject(new Error('Error loading image'));
    };

    img.src = dataUrl;
  });
};

/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 * @returns {Promise<void>}
 */
export const copyToClipboard = async (text) => {
  try {
    // Try the modern navigator.clipboard API first
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return;
    }

    // Fallback to the older document.execCommand approach
    const textArea = document.createElement('textarea');
    textArea.value = text;

    // Make the textarea out of viewport
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    const success = document.execCommand('copy');
    document.body.removeChild(textArea);

    if (!success) {
      throw new Error('Copy command failed');
    }
  } catch (error) {
    console.error('Error copying to clipboard:', error);
    throw error;
  }
};

/**
 * Parse a file or blob from a paste event
 * @param {ClipboardEvent} event - Paste event
 * @returns {Object|null} Object with file and type information or null
 */
export const parseClipboardData = (event) => {
  if (!event.clipboardData || !event.clipboardData.items) {
    return null;
  }

  const items = event.clipboardData.items;

  // Check for images first
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      return {
        type: 'image',
        file: items[i].getAsFile()
      };
    }
  }

  // Check for text
  const text = event.clipboardData.getData('text/plain');
  if (text) {
    return {
      type: 'text',
      content: text
    };
  }

  return null;
};