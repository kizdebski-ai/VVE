export interface BoardPoint {
    x: number;
    y: number;
}

export type BoardStrokeMode = 'solid' | 'dashed' | 'dotted';
export type BoardArrowStyle = 'none' | 'start' | 'end' | 'both';

export interface BoardObject {
    id: string;
    type: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    rotation?: number;
    text?: string;
    latex?: string; // For LaTeX content
    expression?: string; // For function plots
    xRange?: number[]; // For function plots
    points?: BoardPoint[];
    selected?: boolean;

    // Style properties
    lineWidth?: number; // Stroke width in pixels
    lineStyle?: BoardStrokeMode; // Line style: solid, dashed, dotted
    arrowStyle?: BoardArrowStyle; // Arrow style for lines
    strokeColor?: string; // Stroke color (hex)
    fillColor?: string; // Fill color (hex)
    strokeMode?: BoardStrokeMode; // Deprecated, use lineStyle
    color?: string; // General color (hex)

    // For line objects with start/end points
    start?: { x: number; y: number };
    end?: { x: number; y: number };

    // Pen-specific properties
    penStyle?: string; // e.g., 'teacher_marker', 'student_pen', 'technical', 'gel_pen'
    penConfig?: {
        smoothing?: number;
        [key: string]: any;
    };
    rawPoints?: Array<{ x: number; y: number; t?: number }>;
    smoothedPoints?: Array<{ x: number; y: number }>;
    timestamp?: number;

    style?: Record<string, unknown>; // For custom properties like function expression, colors, etc.
    [key: string]: any; // Allow other properties loosely
}

export interface BoardSnapshot {
    objects: BoardObject[];
}

export interface BoardPatch {
    updates?: Array<{
        id: string;
        props: Partial<BoardObject>;
    }>;
    creates?: BoardObject[];
    deletes?: string[];
}
