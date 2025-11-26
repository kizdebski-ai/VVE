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
export function toolDrawBoardPatch(
    doc: BoardDoc,
    _snapshot: BoardSnapshot,
    args: DrawBoardPatchArgs,
): BoardPatch {
    const patch = args.patch;
    // Basic validation
    const createsLen = patch.creates?.length ?? 0;
    const updatesLen = patch.updates?.length ?? 0;
    if (createsLen + updatesLen > 200) {
        throw new Error('Patch too large from AI');
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
