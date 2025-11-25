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
    points?: BoardPoint[];   // paths, handwriting etc.
    selected?: boolean;      // selection flag from frontend
    [key: string]: any;      // Allow other properties
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
