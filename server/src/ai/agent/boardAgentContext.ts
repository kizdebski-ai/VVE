import { BoardSnapshot, BoardObject } from '../../models/boardSnapshot';

export type AgentBoardObjectKind =
    | 'shape'
    | 'note'
    | 'latex'
    | 'handwriting'
    | 'functionPlot'
    | 'image'
    | 'other';

export interface AgentBoardObject {
    id: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    text?: string;
    latex?: string;
    kind: AgentBoardObjectKind;
}

export interface AgentBoardContext {
    objects: AgentBoardObject[];
    viewport?: { x: number; y: number; width: number; height: number } | undefined;
    totalObjectCount: number;
}

const TEXT_LIMIT = 120;

/**
 * Pomocniczo: prostokąt otaczający obiekt.
 * Obsługuje:
 * - zwykłe figury (x, y, width, height)
 * - linie (start/end)
 * - ścieżki/pen (points)
 */
function getBBox(obj: BoardObject) {
    const o: any = obj;

    let x: number = o.x ?? o.position?.x ?? 0;
    let y: number = o.y ?? o.position?.y ?? 0;
    let width: number = o.width ?? 0;
    let height: number = o.height ?? 0;

    // Linie / strzałki
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

    // Ścieżki / pen – jeśli width/height == 0, policz z points
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
 * Buduje „odchudzony” kontekst tablicy dla agenta:
 * - filtr po viewport
 * - max N obiektów
 * - tylko ID, typ, koordy, tekst (ucięty)
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

    // Sortowanie po zIndex/timestamp, żeby agent widział „górę” stosu (najwyższe jako pierwsze)
    filtered.sort(
        (a: any, b: any) =>
            (b.zIndex ?? b.timestamp ?? 0) - (a.zIndex ?? a.timestamp ?? 0),
    );

    const trimmed = filtered.slice(0, maxObjects);

    const agentObjects: AgentBoardObject[] = trimmed.map((o: any) => {
        const bbox = getBBox(o);

        const base: AgentBoardObject = {
            id: o.id,
            type: o.type,
            x: bbox.x,
            y: bbox.y,
            width: bbox.width,
            height: bbox.height,
            kind: inferKind(o),
        };

        if (o.text) {
            base.text = String(o.text).slice(0, TEXT_LIMIT);
        }
        if (o.latex) {
            base.latex = String(o.latex).slice(0, TEXT_LIMIT);
        }

        return base;
    });

    return {
        objects: agentObjects,
        viewport,
        totalObjectCount: objects.length,
    };
}

function inferKind(o: any): AgentBoardObjectKind {
    switch (o.type) {
        case 'latex':
            return 'latex';
        case 'note':
        case 'text':
            return 'note';
        case 'path':
        case 'pen':
        case 'roughPath':
        case 'scribble':
            return 'handwriting';
        case 'functionPlot':
        case 'mathFunctionPlot':
            return 'functionPlot';
        case 'image':
        case 'picture':
            return 'image';
        default:
            return 'shape';
    }
}
