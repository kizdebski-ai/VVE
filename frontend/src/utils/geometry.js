/**
 * Geometry Utilities
 */

/**
 * Checks if a point is inside a rotated rectangle.
 *
 * @param {object} point - The point to check, with x and y properties.
 * @param {number} rectX - The x-coordinate of the rectangle's top-left corner.
 * @param {number} rectY - The y-coordinate of the rectangle's top-left corner.
 * @param {number} rectWidth - The width of the rectangle.
 * @param {number} rectHeight - The height of the rectangle.
 * @param {number} rectRotationDegrees - The rotation of the rectangle in degrees.
 * @returns {boolean} True if the point is inside the rectangle, false otherwise.
 */
export function isPointInRotatedRectangle(point, rectX, rectY, rectWidth, rectHeight, rectRotationDegrees) {
    if (rectWidth <= 0 || rectHeight <= 0) { // Cannot be inside a zero-area rectangle
        return false;
    }
    const angleRad = -rectRotationDegrees * (Math.PI / 180); // Convert to radians and negate for inverse rotation
    
    // Rectangle center
    const centerX = rectX + rectWidth / 2;
    const centerY = rectY + rectHeight / 2;

    // Translate point to be relative to rectangle center
    const translatedX = point.x - centerX;
    const translatedY = point.y - centerY;

    // Rotate point
    const rotatedX = translatedX * Math.cos(angleRad) - translatedY * Math.sin(angleRad);
    const rotatedY = translatedX * Math.sin(angleRad) + translatedY * Math.cos(angleRad);

    // Check if rotated point is within the axis-aligned rectangle bounds
    const halfWidth = rectWidth / 2;
    const halfHeight = rectHeight / 2;

    return rotatedX >= -halfWidth && rotatedX <= halfWidth &&
           rotatedY >= -halfHeight && rotatedY <= halfHeight;
}
