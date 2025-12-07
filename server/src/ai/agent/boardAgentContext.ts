import { BoardSnapshot, BoardObject } from '../../models/boardSnapshot';

// Grid size constant - all coordinates will be snapped to this
const GRID = 8;
const TEXT_LIMIT = 200;

export type AgentBoardObjectKind =
    | 'shape'
    | 'note'
    | 'latex'
    | 'handwriting'
    | 'functionPlot'
    | 'image'
    | 'arrow'
    | 'connector'
    | 'axis'
    | 'other';

export type AgentBoardZone =
    | 'top-left' | 'top-center' | 'top-right'
    | 'middle-left' | 'middle' | 'middle-right'
    | 'bottom-left' | 'bottom-center' | 'bottom-right';

export interface AgentBoardObject {
    id: string;
    type: string;

    // Position and size snapped to grid
    x: number;
    y: number;
    width: number;
    height: number;

    // Bounding box edges (for easy spatial calculations)
    left: number;   // same as x
    right: number;  // x + width
    top: number;    // same as y
    bottom: number; // y + height

    // Center coordinates for connections and layout
    centerX: number;
    centerY: number;

    // Spatial zone within the viewport
    zone: AgentBoardZone;

    // Content
    text?: string;
    latex?: string;

    // Object classification
    kind: AgentBoardObjectKind;

    // Nearby objects (IDs within 100px) - helps weak models understand relationships
    nearbyIds?: string[];
}

export interface AgentBoardContext {
    // Grid size in pixels - all coordinates are multiples of this
    gridSize: number;

    // Current viewport (undefined if not provided)
    viewport: { x: number; y: number; width: number; height: number } | undefined;

    // Objects visible in viewport (snapped to grid)
    objects: AgentBoardObject[];

    // Total object count (may be more than objects array due to viewport filtering)
    totalObjectCount: number;
}

/**
 * Snap a value to the grid
 */
function snap(v: number): number {
    return Math.round(v / GRID) * GRID;
}

/**
 * Compute bounding box for any object type
 */
function getBBox(obj: BoardObject) {
    const o: any = obj;

    let x: number = o.x ?? o.position?.x ?? 0;
    let y: number = o.y ?? o.position?.y ?? 0;
    let width: number = o.width ?? 0;
    let height: number = o.height ?? 0;

    // Lines / arrows with start/end
    if (o.start && o.end) {
        const sx = o.start.x;
        const sy = o.start.y;
        const ex = o.end.x;
        const ey = o.end.y;

        x = Math.min(sx, ex);
        y = Math.min(sy, ey);
        width = Math.abs(ex - sx);
        height = Math.abs(ey - sy);
    }

    // Pen/path with points array
    if ((!width || !height) && Array.isArray(o.points) && o.points.length) {
        const xs = o.points.map((p: any) => p.x);
        const ys = o.points.map((p: any) => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);

        x = minX;
        y = minY;
        width = maxX - minX;
        height = maxY - minY;
    }

    return { x, y, width, height };
}

/**
 * Compute which zone of the viewport the object's center is in
 */
function computeZone(
    centerX: number,
    centerY: number,
    viewport?: { x: number; y: number; width: number; height: number },
): AgentBoardZone {
    if (!viewport) return 'middle';

    const vx1 = viewport.x;
    const vy1 = viewport.y;
    const vw = Math.max(1, viewport.width);
    const vh = Math.max(1, viewport.height);

    // Normalize to 0..1 range
    const nx = (centerX - vx1) / vw;
    const ny = (centerY - vy1) / vh;

    const col = nx < 1 / 3 ? 'left' : nx < 2 / 3 ? 'center' : 'right';
    const row = ny < 1 / 3 ? 'top' : ny < 2 / 3 ? 'middle' : 'bottom';

    return `${row}-${col}` as AgentBoardZone;
}

/**
 * Infer the semantic kind of an object from its type and properties
 */
function inferKind(o: any): AgentBoardObjectKind {
    const type = o.type;

    // LaTeX equations
    if (type === 'latex') return 'latex';

    // Text/notes
    if (type === 'note' || type === 'text') return 'note';

    // Handwriting/freeform paths
    if (type === 'pen' || type === 'path' || type === 'roughPath' || type === 'scribble') {
        return 'handwriting';
    }

    // Function plots/graphs
    if (type === 'functionPlot' || type === 'mathFunctionPlot') return 'functionPlot';

    // Images
    if (type === 'image' || type === 'picture') return 'image';

    // Lines with arrows are vectors/arrows
    if (type === 'line') {
        if (o.arrowStyle && o.arrowStyle !== 'none') return 'arrow';
        // Check if it looks like an axis (long straight line)
        const w = o.width ?? Math.abs((o.end?.x ?? 0) - (o.start?.x ?? 0));
        const h = o.height ?? Math.abs((o.end?.y ?? 0) - (o.start?.y ?? 0));
        const length = Math.sqrt(w * w + h * h);
        if (length > 200 && (w < 10 || h < 10)) return 'axis';
        return 'connector';
    }

    // Default to shape
    return 'shape';
}

/**
 * Calculate distance between two object centers
 */
function getDistance(a: { centerX: number; centerY: number }, b: { centerX: number; centerY: number }): number {
    const dx = a.centerX - b.centerX;
    const dy = a.centerY - b.centerY;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Build a lightweight, grid-snapped context for the AI agent
 * - Filters objects by viewport
 * - Limits to maxObjects
 * - Snaps all coordinates to grid
 * - Adds spatial awareness (zones, centers, nearby objects)
 */
export function buildAgentBoardContext(
    snapshot: BoardSnapshot,
    viewport?: { x: number; y: number; width: number; height: number },
    maxObjects = 64,
): AgentBoardContext {
    const objects: BoardObject[] = snapshot.objects ?? [];

    const intersectsViewport = (obj: BoardObject): boolean => {
        if (!viewport) return true;

        const { x, y, width, height } = getBBox(obj);

        const vx1 = viewport.x;
        const vy1 = viewport.y;
        const vx2 = viewport.x + viewport.width;
        const vy2 = viewport.y + viewport.height;

        const ox1 = x;
        const oy1 = y;
        const ox2 = x + width;
        const oy2 = y + height;

        return !(ox2 < vx1 || ox1 > vx2 || oy2 < vy1 || oy1 > vy2);
    };

    const filtered = viewport ? objects.filter(intersectsViewport) : [...objects];

    // Sort by zIndex/timestamp so agent sees most important objects first
    filtered.sort(
        (a: any, b: any) =>
            (b.zIndex ?? b.timestamp ?? 0) - (a.zIndex ?? a.timestamp ?? 0),
    );

    const trimmed = filtered.slice(0, maxObjects);

    // First pass: build base objects with snapped coordinates
    const agentObjects: AgentBoardObject[] = trimmed.map((o: any) => {
        const bbox = getBBox(o);

        // Snap all coordinates to grid
        const x = snap(bbox.x);
        const y = snap(bbox.y);
        const width = snap(bbox.width);
        const height = snap(bbox.height);

        // Compute center
        const centerX = x + width / 2;
        const centerY = y + height / 2;

        const base: AgentBoardObject = {
            id: String(o.id),
            type: String(o.type),
            x,
            y,
            width,
            height,
            left: x,
            right: x + width,
            top: y,
            bottom: y + height,
            centerX,
            centerY,
            zone: computeZone(centerX, centerY, viewport),
            kind: inferKind(o),
        };

        // Include text content (truncated)
        if (o.text) {
            base.text = String(o.text).slice(0, TEXT_LIMIT);
        }
        if (o.latex) {
            base.latex = String(o.latex).slice(0, TEXT_LIMIT);
        }

        return base;
    });

    // Second pass: compute nearby objects (within 100px)
    const NEARBY_THRESHOLD = 100;
    for (const obj of agentObjects) {
        const nearby: string[] = [];
        for (const other of agentObjects) {
            if (other.id === obj.id) continue;
            if (getDistance(obj, other) <= NEARBY_THRESHOLD) {
                nearby.push(other.id);
            }
        }
        if (nearby.length > 0) {
            obj.nearbyIds = nearby.slice(0, 5); // Limit to 5 nearby objects
        }
    }

    return {
        gridSize: GRID,
        viewport,
        objects: agentObjects,
        totalObjectCount: objects.length,
    };
}
