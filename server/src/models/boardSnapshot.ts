// server/src/models/boardSnapshot.ts

export interface BoardPoint {
    x: number;
    y: number;
}

export type BoardStrokeMode = 'solid' | 'dashed' | 'dotted';
export type BoardArrowStyle = 'none' | 'start' | 'end' | 'both';

export interface BoardObject {
    id: string;
    type: string;

    // Pozycja / rozmiar
    x: number;
    y: number;
    width?: number;
    height?: number;
    rotation?: number;

    // Treść
    text?: string;
    latex?: string;        // LaTeX content
    expression?: string;   // dla wykresów funkcji
    xRange?: number[];     // np. [xMin, xMax] dla functionPlot
    points?: BoardPoint[];
    selected?: boolean;

    // Styl linii / wypełnienia
    lineWidth?: number;            // grubość linii (px)
    lineStyle?: BoardStrokeMode;   // 'solid' | 'dashed' | 'dotted'
    arrowStyle?: BoardArrowStyle;  // dla linii / strzałek

    strokeColor?: string;          // kolor konturu (#rrggbb)
    fillColor?: string;            // kolor wypełnienia (#rrggbb)
    color?: string;                // ogólny kolor (np. fallback)

    // Dodatkowe parametry używane przez renderer (RoughJS / clean mode)
    fillOpacity?: number;          // 0–1
    fillStyle?: string;            // np. 'solid', 'hachure', 'cross-hatch'
    roughness?: number;            // 0 = clean, 1 = default, 2 = bardziej odręczne
    hachureGap?: number;           // rozstaw kresek w wypełnieniu

    // Legacy
    strokeMode?: BoardStrokeMode;  // deprecated – prefer lineStyle

    // Dla obiektów typu "line" z osobnymi start/end
    start?: { x: number; y: number };
    end?: { x: number; y: number };

    // Parametry pisaka / odręcznego rysowania
    penStyle?: string;  // np. 'teacher_marker', 'student_pen', 'technical', 'gel_pen'
    penConfig?: {
        smoothing?: number;
        [key: string]: any;
    };
    rawPoints?: Array<{ x: number; y: number; t?: number }>;
    smoothedPoints?: Array<{ x: number; y: number }>;
    timestamp?: number;

    // Pole na dodatkowe właściwości (np. style dla functionPlot, custom metadane)
    style?: Record<string, unknown>;

    // Luz na przyszłe rozszerzenia – agent/LLaM może dodać inne pola
    [key: string]: any;
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
    deletes?: string[]; // ID obiektów do usunięcia
}
