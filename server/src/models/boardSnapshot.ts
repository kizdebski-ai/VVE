export interface BoardPoint {
    x: number;
    y: number;
}

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
}
