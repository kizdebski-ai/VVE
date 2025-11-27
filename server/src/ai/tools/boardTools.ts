import { BoardDoc } from '../../yjs/boardDoc';
import { BoardPatch, BoardSnapshot, BoardObject } from '../../models/boardSnapshot';

type AlignSelectionArgs = {
    gridSize: number;
    selectionIds?: string[];
};

type GenerateDiagramArgs = {
    prompt: string;
    centerX?: number;
    centerY?: number;
    nodes?: BoardObject[]; // Optional, passed from agent if pre-generated
};

type SimplifyEquationArgs = {
    objectId: string;
};

const snap = (v: number, grid: number) =>
    Math.round(v / grid) * grid;

function getSelection(snapshot: BoardSnapshot, selectionIds?: string[]): BoardObject[] {
    if (selectionIds?.length) {
        const set = new Set(selectionIds);
        return snapshot.objects.filter(o => set.has(o.id));
    }
    return snapshot.objects.filter(o => o.selected);
}

// 1) Align to grid
export function toolAlignSelectionToGrid(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: AlignSelectionArgs,
): BoardPatch {
    const { gridSize } = args;
    const sel = getSelection(snapshot, args.selectionIds);
    const updates: NonNullable<BoardPatch['updates']> = [];

    for (const o of sel) {
        const props: Partial<BoardObject> = {
            x: snap(o.x, gridSize),
            y: snap(o.y, gridSize),
        };

        if (o.points && o.points.length) {
            props.points = o.points.map(p => ({
                x: snap(p.x, gridSize),
                y: snap(p.y, gridSize),
            }));
        }

        updates.push({ id: o.id, props });
    }

    const patch: BoardPatch = { updates };
    doc.applyPatch(patch);
    return patch;
}

// 2) Bardzo prosty generator diagramu – LLM zwraca JSON z węzłami.
export function toolGenerateDiagramFromPrompt(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: GenerateDiagramArgs,
    nodes: BoardObject[],
): BoardPatch {
    // Tu zakładamy, że "nodes" to wynik z LLM (parsowany po stronie agenta),
    // już w formacie BoardObject. Agent doda id, typ, x, y itd.
    const patch: BoardPatch = {
        creates: nodes,
    };
    doc.applyPatch(patch);
    return patch;
}

// 3) Uproszczenie równania – w praktyce wywołasz tu dodatkowe LLM albo libkę.
export function toolSimplifyEquationBlock(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: SimplifyEquationArgs,
    simplifiedLatex: string,
): BoardPatch {
    const target = snapshot.objects.find(o => o.id === args.objectId);
    if (!target) return { updates: [] };

    const patch: BoardPatch = {
        updates: [{ id: target.id, props: { text: simplifiedLatex } }],
    };
    doc.applyPatch(patch);
    return patch;
}

// --- New Tools ---

type DrawBoardPatchArgs = { patch: BoardPatch };
type InsertLatexArgs = { latex: string; x?: number; y?: number; width?: number; height?: number };
type TextToLatexArgs = { objectId: string };
type PlotFunctionArgs = { expression: string; xMin?: number; xMax?: number; x?: number; y?: number };

// 4) Draw Board Patch (Low-level)
// 4) Draw Board Patch (Low-level)
export function toolDrawBoardPatch(
    doc: BoardDoc,
    _snapshot: BoardSnapshot,
    args: any,
): BoardPatch {
    const patch: BoardPatch = {
        creates: [],
        updates: [],
        deletes: [],
    };

    // Handle nested 'patch' object if present (legacy/schema variation)
    const source = args.patch || args;

    if (Array.isArray(source.creates)) {
        patch.creates = source.creates.map((raw: any) => ({
            ...raw,
            id: raw.id || `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        }));
    }

    if (Array.isArray(source.updates)) {
        patch.updates = source.updates.map((u: any) => ({
            id: u.id,
            props: u.props,
        }));
    }

    if (Array.isArray(source.deletes)) {
        patch.deletes = [...source.deletes];
    }

    // Basic validation
    const createsLen = patch.creates?.length ?? 0;
    const updatesLen = patch.updates?.length ?? 0;
    const deletesLen = patch.deletes?.length ?? 0;

    if (createsLen + updatesLen + deletesLen > 200) {
        throw new Error('Patch too large from AI');
    }

    if (createsLen === 0 && updatesLen === 0 && deletesLen === 0) {
        return { creates: [], updates: [], deletes: [] };
    }

    doc.applyPatch(patch);
    return patch;
}

// 5) Insert LaTeX Box
export function toolInsertLatexBox(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: InsertLatexArgs,
): BoardPatch {
    const baseX = args.x ?? snapshot.objects[0]?.x ?? 100;
    const baseY = args.y ?? snapshot.objects[0]?.y ?? 100;

    const latexObj: BoardObject = {
        id: `ai-latex-${Date.now()}`,
        type: 'latex',
        x: baseX,
        y: baseY,
        width: args.width ?? 260,
        height: args.height ?? 120,
        latex: args.latex,
    };

    const patch: BoardPatch = { creates: [latexObj] };
    doc.applyPatch(patch);
    return patch;
}

// 6) Text Block to LaTeX Update
export function toolTextBlockToLatexUpdate(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: TextToLatexArgs,
    latex: string,
): BoardPatch {
    const target = snapshot.objects.find(o => o.id === args.objectId);
    if (!target) return { updates: [] };

    const patch: BoardPatch = {
        updates: [
            {
                id: target.id,
                props: {
                    type: 'latex',
                    latex,
                    text: '', // Clear text as it's now latex
                },
            },
        ],
    };

    doc.applyPatch(patch);
    return patch;
}

// 7) Plot Function
export function toolPlotFunction(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: PlotFunctionArgs,
): BoardPatch {
    const baseX = args.x ?? snapshot.objects[0]?.x ?? 100;
    const baseY = args.y ?? snapshot.objects[0]?.y ?? 100;

    const plot: BoardObject = {
        id: `ai-fplot-${Date.now()}`,
        type: 'mathFunctionPlot',
        x: baseX,
        y: baseY,
        width: 400,
        height: 260,
        expression: args.expression,
        xRange: [args.xMin ?? -10, args.xMax ?? 10],
    };

    const patch: BoardPatch = { creates: [plot] };
    doc.applyPatch(patch);
    return patch;
}

// --- NEW HIGH-LEVEL TOOLS (update.md) ---

const GRID = 8; // Grid size for snapping

function snapObjectToGrid<T extends { x?: number; y?: number; width?: number; height?: number }>(
    obj: T,
): T {
    return {
        ...obj,
        x: obj.x !== undefined ? snap(obj.x, GRID) : obj.x,
        y: obj.y !== undefined ? snap(obj.y, GRID) : obj.y,
        width: obj.width !== undefined ? snap(obj.width, GRID) : obj.width,
        height: obj.height !== undefined ? snap(obj.height, GRID) : obj.height,
    };
}

function getBBox(o: BoardObject) {
    const x = o.x ?? o.start?.x ?? 0;
    const y = o.y ?? o.start?.y ?? 0;
    const w = o.width ?? (o.end ? Math.abs(o.end.x - x) : 0);
    const h = o.height ?? (o.end ? Math.abs(o.end.y - y) : 0);
    return { x, y, width: w, height: h };
}

function getCenter(o: BoardObject) {
    const { x, y, width, height } = getBBox(o);
    return { x: x + width / 2, y: y + height / 2 };
}

function newId(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
}

// 8) Connect Objects - arrows/vectors between objects
type ConnectObjectsArgs = {
    fromId: string;
    toId: string;
    style?: {
        lineWidth?: number;
        lineStyle?: 'solid' | 'dashed' | 'dotted';
        arrowHead?: 'end' | 'both';
        color?: string;
    };
};

export function toolConnectObjects(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: ConnectObjectsArgs,
): BoardPatch {
    const from = snapshot.objects.find(o => o.id === args.fromId);
    const to = snapshot.objects.find(o => o.id === args.toId);
    if (!from || !to) {
        return { creates: [], updates: [] };
    }

    const a = getCenter(from);
    const b = getCenter(to);

    const arrow: BoardObject = {
        id: newId('ai-arrow'),
        type: 'line',
        start: a,
        end: b,
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(b.x - a.x),
        height: Math.abs(b.y - a.y),
        color: args.style?.color ?? '#000000',
        lineWidth: args.style?.lineWidth ?? 2,
        lineStyle: args.style?.lineStyle ?? 'solid',
        arrowStyle: args.style?.arrowHead ?? 'end',
    };

    const patch = { creates: [snapObjectToGrid(arrow)] };
    doc.applyPatch(patch);
    return patch;
}

// 9) Label Object - text/LaTeX labels attached to objects
type LabelObjectArgs = {
    objectId: string;
    text: string;
    mode?: 'plain' | 'latex';
    position?: 'top' | 'bottom' | 'left' | 'right' | 'center';
};

export function toolLabelObject(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: LabelObjectArgs,
): BoardPatch {
    const target = snapshot.objects.find(o => o.id === args.objectId);
    if (!target) return { creates: [], updates: [] };

    const mode = args.mode ?? 'plain';
    const pos = args.position ?? 'top';

    const box = getBBox(target);
    const padding = 12;

    let x = box.x;
    let y = box.y;

    switch (pos) {
        case 'top':
            x = box.x + box.width / 2;
            y = box.y - padding;
            break;
        case 'bottom':
            x = box.x + box.width / 2;
            y = box.y + box.height + padding;
            break;
        case 'left':
            x = box.x - padding;
            y = box.y + box.height / 2;
            break;
        case 'right':
            x = box.x + box.width + padding;
            y = box.y + box.height / 2;
            break;
        case 'center':
            x = box.x + box.width / 2;
            y = box.y + box.height / 2;
            break;
    }

    const base: BoardObject = {
        id: newId('ai-label'),
        type: mode === 'latex' ? 'latex' : 'text',
        x,
        y,
        width: 0,
        height: 0,
        ...(mode === 'plain' ? { text: args.text } : { latex: args.text }),
        color: '#000000',
    };

    const patch = { creates: [snapObjectToGrid(base)] };
    doc.applyPatch(patch);
    return patch;
}

// 10) Set Style - update style properties
type SetStyleArgs = {
    ids: string[];
    props: Partial<BoardObject>;
};

export function toolSetStyle(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: SetStyleArgs,
): BoardPatch {
    const updates = args.ids.map(id => ({
        id,
        props: args.props,
    }));
    const patch = { creates: [], updates };
    doc.applyPatch(patch);
    return patch;
}

// 11) Delete Objects
type DeleteObjectsArgs = { ids: string[] };

export function toolDeleteObjects(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: DeleteObjectsArgs,
): BoardPatch {
    const patch = {
        creates: [],
        updates: [],
        deletes: args.ids,
    };
    doc.applyPatch(patch);
    return patch;
}

// 12) Draw Handstroke - natural pen strokes
type DrawHandstrokeArgs = {
    points: { x: number; y: number }[];
    style?: 'teacher_marker' | 'student_pen' | 'sketch';
    color?: string;
};

function jitter(val: number, amount: number) {
    return val + (Math.random() * 2 - 1) * amount;
}

// Simple Catmull-Rom interpolation
function interpolateStroke(points: { x: number; y: number }[], step = 0.2) {
    if (points.length <= 2) return points;
    if (points.length < 3) return points;

    const res: { x: number; y: number }[] = [];
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i === 0 ? i : i - 1]!;
        const p1 = points[i]!;
        const p2 = points[i + 1]!;
        const p3 = points[i + 2 < points.length ? i + 2 : i + 1]!;

        for (let t = 0; t < 1; t += step) {
            const t2 = t * t;
            const t3 = t2 * t;

            const x =
                0.5 *
                ((2 * p1.x) +
                    (-p0.x + p2.x) * t +
                    (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
                    (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);

            const y =
                0.5 *
                ((2 * p1.y) +
                    (-p0.y + p2.y) * t +
                    (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
                    (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);

            res.push({ x, y });
        }
    }
    const lastPoint = points[points.length - 1];
    if (lastPoint) res.push(lastPoint);
    return res;
}

export function toolDrawHandstroke(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: DrawHandstrokeArgs,
): BoardPatch {
    if (!args.points || args.points.length < 2) {
        return { creates: [], updates: [] };
    }

    const base = args.points.map(p => ({
        x: jitter(p.x, 0.5),
        y: jitter(p.y, 0.5),
        t: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    }));

    const dense = interpolateStroke(base, 0.25);

    const style = args.style ?? 'teacher_marker';
    const configByStyle = {
        teacher_marker: { smoothing: 0.5, baseWidth: 3 },
        student_pen: { smoothing: 0.65, baseWidth: 2 },
        sketch: { smoothing: 0.35, baseWidth: 1.5 },
    } as const;

    const cfg = configByStyle[style];

    // Calculate bounding box from points
    const xs = dense.map(p => p.x);
    const ys = dense.map(p => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);

    const element: BoardObject = {
        id: newId('ai-pen'),
        type: 'pen',
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        points: dense,
        rawPoints: base,
        smoothedPoints: [],
        color: args.color ?? '#000000',
        lineWidth: cfg.baseWidth,
        penStyle: 'technical',
        penConfig: {
            smoothing: cfg.smoothing,
        },
        timestamp: Date.now(),
    };

    const patch = { creates: [element] };
    doc.applyPatch(patch);
    return patch;
}

