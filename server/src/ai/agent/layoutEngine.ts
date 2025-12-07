/**
 * Layout Engine - Professional-grade coordinate calculation system
 * 
 * This engine takes high-level semantic descriptions and converts them
 * to precise pixel coordinates. AI only needs to describe WHAT to draw,
 * the engine handles WHERE (exact coordinates).
 * 
 * Architecture:
 * 1. AI describes intent: "stack 3 circles, add eyes inside top circle"
 * 2. Layout Engine calculates: precise x, y, width, height for each element
 * 3. Validation Layer verifies: all constraints are met
 * 4. Renderer draws: final result on canvas
 */

// Grid snapping constant
const GRID = 8;
const snap = (v: number): number => Math.round(v / GRID) * GRID;

export interface LayoutElement {
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    color?: string;
    fillColor?: string;
    lineWidth?: number;
    roughness?: number;
    [key: string]: any;
}

export interface LayoutConstraint {
    type: 'touch' | 'contain' | 'align-center' | 'gap';
    source: string;  // element id/name
    target: string;  // element id/name
    direction?: 'vertical' | 'horizontal';
    gap?: number;
}

/**
 * Ensure two elements touch (no gap, no overlap)
 */
export function makeTouch(
    elementA: LayoutElement,
    elementB: LayoutElement,
    direction: 'vertical' | 'horizontal' = 'vertical'
): void {
    if (direction === 'vertical') {
        // B goes below A
        elementB.y = elementA.y + elementA.height;
    } else {
        // B goes to the right of A
        elementB.x = elementA.x + elementA.width;
    }
}

/**
 * Center element B horizontally relative to element A
 */
export function alignCenterHorizontal(
    elementA: LayoutElement,
    elementB: LayoutElement
): void {
    const centerA = elementA.x + elementA.width / 2;
    elementB.x = snap(centerA - elementB.width / 2);
}

/**
 * Center element B vertically relative to element A
 */
export function alignCenterVertical(
    elementA: LayoutElement,
    elementB: LayoutElement
): void {
    const centerA = elementA.y + elementA.height / 2;
    elementB.y = snap(centerA - elementB.height / 2);
}

/**
 * Ensure element B is inside element A with given margins
 */
export function containInside(
    parent: LayoutElement,
    child: LayoutElement,
    margin: number = 10
): boolean {
    const parentLeft = parent.x + margin;
    const parentRight = parent.x + parent.width - margin;
    const parentTop = parent.y + margin;
    const parentBottom = parent.y + parent.height - margin;

    const childRight = child.x + child.width;
    const childBottom = child.y + child.height;

    let wasAdjusted = false;

    // Clamp X
    if (child.x < parentLeft) {
        child.x = parentLeft;
        wasAdjusted = true;
    }
    if (childRight > parentRight) {
        child.x = parentRight - child.width;
        wasAdjusted = true;
    }

    // Clamp Y
    if (child.y < parentTop) {
        child.y = parentTop;
        wasAdjusted = true;
    }
    if (childBottom > parentBottom) {
        child.y = parentBottom - child.height;
        wasAdjusted = true;
    }

    return wasAdjusted;
}

/**
 * Position element at specific ratio within parent
 * ratioX=0.5 means horizontally centered
 * ratioY=0.3 means 30% from top
 */
export function positionAtRatio(
    parent: LayoutElement,
    child: LayoutElement,
    ratioX: number,
    ratioY: number
): void {
    const targetCenterX = parent.x + parent.width * ratioX;
    const targetCenterY = parent.y + parent.height * ratioY;

    child.x = snap(targetCenterX - child.width / 2);
    child.y = snap(targetCenterY - child.height / 2);
}

/**
 * Create a line from edge of elementA towards direction
 */
export function createLineFromEdge(
    element: LayoutElement,
    edge: 'left' | 'right' | 'top' | 'bottom',
    length: number,
    angleFromHorizontal: number = 0  // degrees, 0 = horizontal, 45 = diagonal down-right
): { x: number; y: number; width: number; height: number } {
    const centerY = element.y + element.height / 2;
    const centerX = element.x + element.width / 2;
    const angleRad = (angleFromHorizontal * Math.PI) / 180;

    let startX: number, startY: number;
    let dirX: number, dirY: number;

    switch (edge) {
        case 'left':
            startX = element.x;
            startY = centerY;
            dirX = -Math.cos(angleRad);
            dirY = Math.sin(angleRad);
            break;
        case 'right':
            startX = element.x + element.width;
            startY = centerY;
            dirX = Math.cos(angleRad);
            dirY = Math.sin(angleRad);
            break;
        case 'top':
            startX = centerX;
            startY = element.y;
            dirX = Math.sin(angleRad);
            dirY = -Math.cos(angleRad);
            break;
        case 'bottom':
            startX = centerX;
            startY = element.y + element.height;
            dirX = Math.sin(angleRad);
            dirY = Math.cos(angleRad);
            break;
    }

    const endX = startX + dirX * length;
    const endY = startY + dirY * length;

    return {
        x: snap(startX),
        y: snap(startY),
        width: snap(endX - startX),
        height: snap(endY - startY)
    };
}

/**
 * Normalize and validate all elements in a batch
 * - Ensures all required properties exist
 * - Applies fillColor rendering fix (roughness=0)
 * - Snaps coordinates to grid
 */
export function normalizeElements(elements: LayoutElement[]): LayoutElement[] {
    return elements.map(el => {
        const normalized = { ...el };

        // Snap all coordinates
        normalized.x = snap(normalized.x ?? 0);
        normalized.y = snap(normalized.y ?? 0);
        normalized.width = Math.max(8, snap(normalized.width ?? 50));
        normalized.height = Math.max(8, snap(normalized.height ?? 50));

        // Ensure visibility
        if (!normalized.color) {
            normalized.color = '#000000';
        }

        if (!normalized.lineWidth) {
            normalized.lineWidth = 2;
        }

        // FIX: If fillColor is specified, use clean rendering
        if (normalized.fillColor) {
            normalized.roughness = 0;
        }

        return normalized;
    });
}

/**
 * Apply stacking fixes for circles that should touch
 * Automatically detects stacked circles and adjusts positions
 */
export function fixStackedCircles(elements: LayoutElement[]): LayoutElement[] {
    const circles = elements.filter(e => e.type === 'circle');
    if (circles.length < 2) return elements;

    // Sort by Y to find stacking order  
    circles.sort((a, b) => a.y - b.y);

    // Find horizontally aligned circles (same center X)
    const getCenterX = (c: LayoutElement) => c.x + c.width / 2;
    const tolerance = 50; // pixels

    // Group circles by horizontal center
    const groups: LayoutElement[][] = [];
    for (const circle of circles) {
        let foundGroup = false;
        for (const group of groups) {
            const firstInGroup = group[0];
            if (firstInGroup && Math.abs(getCenterX(firstInGroup) - getCenterX(circle)) < tolerance) {
                group.push(circle);
                foundGroup = true;
                break;
            }
        }
        if (!foundGroup) {
            groups.push([circle]);
        }
    }

    // Fix each group
    for (const group of groups) {
        if (group.length < 2) continue;

        // Sort by Y
        group.sort((a, b) => a.y - b.y);

        // Separate large circles (body) from small (details)
        const bodyCircles = group.filter(c => c.width >= 40);
        const detailCircles = group.filter(c => c.width < 40);

        // Make body circles touch
        for (let i = 1; i < bodyCircles.length; i++) {
            const prev = bodyCircles[i - 1];
            const curr = bodyCircles[i];
            if (!prev || !curr) continue;
            makeTouch(prev, curr, 'vertical');

            // Also align horizontally 
            alignCenterHorizontal(prev, curr);
        }

        // Ensure detail circles are inside nearest body circle
        for (const detail of detailCircles) {
            // Find nearest body circle
            let nearestBody = bodyCircles[0];
            let minDist = Infinity;
            for (const body of bodyCircles) {
                const dist = Math.abs((body.y + body.height / 2) - (detail.y + detail.height / 2));
                if (dist < minDist) {
                    minDist = dist;
                    nearestBody = body;
                }
            }

            if (nearestBody) {
                containInside(nearestBody, detail, 5);
            }
        }
    }

    return elements;
}

/**
 * Apply all layout fixes to a batch of elements
 */
export function applyLayoutFixes(elements: LayoutElement[]): LayoutElement[] {
    let result = [...elements];

    // Step 1: Normalize all elements
    result = normalizeElements(result);

    // Step 2: Fix stacked circles
    result = fixStackedCircles(result);

    return result;
}
