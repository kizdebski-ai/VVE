1. Mapa tablicy + grid w kontekście dla LLM
1.1. Rozszerzony AgentBoardContext

To, co masz teraz, jest spoko, ale można mu dać „świadomość siatki” i stref:

// server/src/ai/agent/boardAgentContext.ts

export type AgentBoardObjectKind =
  | 'shape'
  | 'note'
  | 'latex'
  | 'handwriting'
  | 'functionPlot'
  | 'image'
  | 'axis'
  | 'arrow'
  | 'connector'
  | 'other';

export interface AgentBoardObject {
  id: string;
  type: string;

  // pozycja i rozmiar w układzie siatki
  x: number;
  y: number;
  width: number;
  height: number;

  // środek – dla strzałek, połączeń, layoutu
  centerX: number;
  centerY: number;

  // zoneName = w której części viewportu leży obiekt
  zone: 'top-left' | 'top-center' | 'top-right'
      | 'middle-left' | 'middle' | 'middle-right'
      | 'bottom-left' | 'bottom-center' | 'bottom-right';

  text?: string;
  latex?: string;
  kind: AgentBoardObjectKind;
}

export interface AgentBoardContext {
  gridSize: number; // np. 8
  viewport?: { x: number; y: number; width: number; height: number };
  objects: AgentBoardObject[];
  totalObjectCount: number;
}

1.2. Nowa wersja buildAgentBoardContext

Najważniejsze zmiany:

gridSize jawnie przekazany,

wszystkie współrzędne są zaokrąglone do siatki zanim zobaczy je LLM,

każdy obiekt ma centerX, centerY oraz zone.

const GRID = 8;

function snap(v: number) {
  return Math.round(v / GRID) * GRID;
}

function inferKind(o: any): AgentBoardObjectKind {
  if (o.type === 'latex') return 'latex';
  if (o.type === 'note' || o.type === 'text') return 'note';
  if (o.type === 'pen' || o.type === 'path') return 'handwriting';
  if (o.type === 'functionPlot' || o.type === 'mathFunctionPlot') return 'functionPlot';
  if (o.type === 'image') return 'image';
  if (o.type === 'line' && o.arrowStyle) return 'arrow';
  if (o.type === 'line') return 'connector';
  return 'shape';
}

function computeZone(
  centerX: number,
  centerY: number,
  viewport?: { x: number; y: number; width: number; height: number },
): AgentBoardObject['zone'] {
  if (!viewport) return 'middle';

  const vx1 = viewport.x;
  const vy1 = viewport.y;
  const vx2 = viewport.x + viewport.width;
  const vy2 = viewport.y + viewport.height;

  const nx = (centerX - vx1) / Math.max(1, vx2 - vx1); // 0..1
  const ny = (centerY - vy1) / Math.max(1, vy2 - vy1);

  const col = nx < 1 / 3 ? 'left' : nx < 2 / 3 ? 'center' : 'right';
  const row = ny < 1 / 3 ? 'top' : ny < 2 / 3 ? 'middle' : 'bottom';

  return `${row}-${col}` as AgentBoardObject['zone'];
}

export function buildAgentBoardContext(
  snapshot: BoardSnapshot,
  viewport?: { x: number; y: number; width: number; height: number },
  maxObjects = 64,
): AgentBoardContext {
  const all = snapshot.objects ?? [];

  const intersectsViewport = (obj: any): boolean => {
    if (!viewport) return true;
    const x = obj.x ?? obj.position?.x ?? (obj.start ? Math.min(obj.start.x, obj.end?.x ?? obj.start.x) : 0);
    const y = obj.y ?? obj.position?.y ?? (obj.start ? Math.min(obj.start.y, obj.end?.y ?? obj.start.y) : 0);
    const w = obj.width ?? (obj.start && obj.end ? Math.abs(obj.end.x - obj.start.x) : 0);
    const h = obj.height ?? (obj.start && obj.end ? Math.abs(obj.end.y - obj.start.y) : 0);
    const vx1 = viewport.x;
    const vy1 = viewport.y;
    const vx2 = viewport.x + viewport.width;
    const vy2 = viewport.y + viewport.height;
    const ox1 = x;
    const oy1 = y;
    const ox2 = x + w;
    const oy2 = y + h;
    return !(ox2 < vx1 || ox1 > vx2 || oy2 < vy1 || oy1 > vy2);
  };

  const filtered = viewport ? all.filter(intersectsViewport) : [...all];

  filtered.sort(
    (a: any, b: any) =>
      (a.zIndex ?? a.timestamp ?? 0) - (b.zIndex ?? b.timestamp ?? 0),
  );

  const trimmed = filtered.slice(0, maxObjects);

  const agentObjects: AgentBoardObject[] = trimmed.map((o: any) => {
    const rawX = o.x ?? o.position?.x ?? (o.start ? Math.min(o.start.x, o.end?.x ?? o.start.x) : 0);
    const rawY = o.y ?? o.position?.y ?? (o.start ? Math.min(o.start.y, o.end?.y ?? o.start.y) : 0);
    const rawW = o.width ?? (o.start && o.end ? Math.abs(o.end.x - o.start.x) : 0);
    const rawH = o.height ?? (o.start && o.end ? Math.abs(o.end.y - o.start.y) : 0);

    const x = snap(rawX);
    const y = snap(rawY);
    const width = snap(rawW);
    const height = snap(rawH);

    const centerX = x + width / 2;
    const centerY = y + height / 2;

    const base: AgentBoardObject = {
      id: String(o.id),
      type: String(o.type),
      x,
      y,
      width,
      height,
      centerX,
      centerY,
      zone: computeZone(centerX, centerY, viewport),
      kind: inferKind(o),
    };

    if (o.text) base.text = String(o.text).slice(0, 200);
    if (o.latex) base.latex = String(o.latex).slice(0, 200);

    return base;
  });

  return {
    gridSize: GRID,
    viewport,
    objects: agentObjects,
    totalObjectCount: all.length,
  };
}


Efekt: nawet słaby model dostaje już podane na tacy:

„ten obiekt jest w top-center”,

„ma środek w (320, 160) na siatce 8 px”,

„to jest shape vs arrow vs handwriting”.

2. Prompt dla LLM – jak mu „wcisnąć” siatkę i low-level narzędzia

W SYSTEM_PROMPT + w dokumencie boardCapabilities.ts możesz mu dobitnie powiedzieć:

2.1. Fragment SYSTEM_PROMPT (istotne kawałki)
BOARD GEOMETRY & GRID
- The board uses a fixed grid of gridSize pixels (provided in boardContext.gridSize, usually 8).
- All coordinates and sizes in boardContext are already snapped to this grid.
- When you call draw_board_patch, you MUST keep x, y, width, height aligned to the same grid (multiples of gridSize).

SPATIAL AWARENESS
- Each object has (centerX, centerY) and a "zone" (top-left, middle, bottom-right, etc.).
- Use zone and center coordinates to:
  * keep spacing consistent,
  * align similar shapes horizontally or vertically,
  * place labels close to the objects they annotate.

TOOL PRIORITIES (for both strong and weak models)
1. Use HIGH-LEVEL tools whenever possible:
   - connect_objects      → arrows/vectors between existing objects by ids.
   - label_object         → small labels or LaTeX annotations for existing objects.
   - set_style            → change thickness, dashed/dotted, arrowStyle, colors.
   - align_selection_to_grid → final cleanup of spacing and alignment.
   - plot_function / insert_latex_box / text_block_to_latex / simplify_equation_block for math.

2. Use draw_board_patch ONLY when:
   - you need to create shapes that do not exist yet (rectangles, circles, etc.),
   - no other tool can express what you want.

3. When using draw_board_patch:
   - create a small number of well aligned objects (NOT 50 tiny segments),
   - use type="line" with arrowStyle for vectors, axes and connectors,
   - never approximate straight lines with many points.

WEAK MODELS GUIDANCE
- If you are unsure:
  - start with a simple layout: one main shape in the middle, others in aligned rows/columns,
  - use grid-aligned coordinates (multiples of boardContext.gridSize),
  - prefer connect_objects to manually computing coordinates for arrows.


Dla słabszych modeli ważne są te twarde reguły:

„JEŚLI nie wiesz – rób prosty układ: jedna kolumna / jedna linia”.

„Używaj connect_objects zamiast ręcznej geometrii, kiedy się da”.

„Nie spamuj penem do rysowania prostych linii”.

2.2. Dokument boardCapabilities.ts – przykładowy „gridowy” patch

Wpisz mu do docs jasny przykład:

{
  id: 'tool-draw-patch-grid-example',
  tags: ['draw', 'grid', 'examples'],
  doc: `
Tool: draw_board_patch (grid-aligned example)
Purpose: Create three aligned circles in a vertical column, centered in the middle of the viewport.

Example patch:
{
  "creates": [
    { "id": "snow-top",    "type": "circle", "x": 400, "y": 200, "width": 80, "height": 80, "color": "#000000" },
    { "id": "snow-middle", "type": "circle", "x": 400, "y": 280, "width": 120, "height": 120, "color": "#000000" },
    { "id": "snow-bottom", "type": "circle", "x": 400, "y": 400, "width": 160, "height": 160, "color": "#000000" }
  ]
}
All x, y, width, height are multiples of gridSize=8.
`
}


Takie przykłady bardzo pomagają słabszym modelom, bo mają „wzór na to, jak się rysuje poprawnie”.

3. Backend – twarde wymuszanie porządku

Nawet najlepszy prompt nie wystarczy, jeśli backend nie robi sanity-checku. Dla słabszych modeli to jest kluczowe.

3.1. Snapping i clamp w toolDrawBoardPatch

To w dużej mierze masz, ale dopchnięte „na twardo”:

const GRID = 8;

function snap(v: unknown) {
  const n = typeof v === 'number' ? v : Number(v) || 0;
  return Math.round(n / GRID) * GRID;
}

export function toolDrawBoardPatch(
  doc: BoardDoc,
  _snapshot: BoardSnapshot,
  args: any,
): BoardPatch {
  const patch: BoardPatch = { creates: [], updates: [], deletes: [] };
  const source = args.patch || args;

  if (Array.isArray(source.creates)) {
    patch.creates = source.creates.map((raw: any) => {
      const id = raw.id || `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const type = raw.type;
      const x = snap(raw.x);
      const y = snap(raw.y);
      const width = snap(raw.width ?? 0);
      const height = snap(raw.height ?? 0);

      const base: any = {
        ...raw,
        id,
        type,
        x,
        y,
        width,
        height,
      };

      if (type === 'line') {
        const sx = raw.start?.x ?? x;
        const sy = raw.start?.y ?? y;
        const ex = raw.end?.x ?? (x + width);
        const ey = raw.end?.y ?? (y + height);
        base.start = { x: snap(sx), y: snap(sy) };
        base.end   = { x: snap(ex), y: snap(ey) };
      }

      if (!base.color && !base.strokeColor) {
        base.color = '#000000';
      }

      return base;
    });
  }

  if (Array.isArray(source.updates)) {
    patch.updates = source.updates.map((u: any) => {
      const props: any = { ...u.props };
      if ('x' in props) props.x = snap(props.x);
      if ('y' in props) props.y = snap(props.y);
      if ('width' in props) props.width = snap(props.width);
      if ('height' in props) props.height = snap(props.height);
      if (props.start) {
        props.start = {
          x: snap(props.start.x),
          y: snap(props.start.y),
        };
      }
      if (props.end) {
        props.end = {
          x: snap(props.end.x),
          y: snap(props.end.y),
        };
      }
      return { id: u.id, props };
    });
  }

  if (Array.isArray(source.deletes)) {
    patch.deletes = [...source.deletes];
  }

  const createsLen = patch.creates?.length ?? 0;
  const updatesLen = patch.updates?.length ?? 0;
  const deletesLen = patch.deletes?.length ?? 0;

  if (createsLen + updatesLen + deletesLen > 200) {
    throw new Error('Patch too large from AI');
  }

  if (!createsLen && !updatesLen && !deletesLen) {
    return { creates: [], updates: [], deletes: [] };
  }

  doc.applyPatch(patch);
  return patch;
}


To sprawia, że nawet jeśli słaby model walnie współrzędne „na pałę”, to:

wszystko i tak ląduje na siatce,

linie mają sensowne start/end,

kolor zawsze istnieje.

3.2. Wymuszanie użycia high-level tools „przez biedę”

Możesz jeszcze:

w dokumentacji i promptach podkreślić, że:

connect_objects jest preferowane do strzałek (słabsze modele uwielbiają to, bo nie muszą liczyć współrzędnych),

label_object do podpisów (zamiast tworzyć nowy text w kosmosie),

w przyszłości: dodać proste narzędzia typu:

distribute_horizontally / distribute_vertically – dla równych odstępów,

clone_object – do powielania kształtów zamiast ręcznego rysowania.