Widzę co się dzieje: sam „mózg” LLM ogarnia koncept bałwana / auta, ale:

ma słabe narzędzia do precyzyjnej geometrii (operuje na surowych pikselach),

snapshot jest dla niego mało „semantyczny”,

a pipeline ma kilka calli do modelu, więc wszystko muli.

Poniżej konkretne poprawki, które realnie rozwiążą:

krzywe spacingi i brak „dociągania”,

używanie złych narzędzi (pen zamiast line/arrow itd.),

brak świadomości usuniętych obiektów,

słabe podpisy LaTeX,

i ogólną wydajność.

1. Z czego wynika bałagan z geometrią i stanem

Agent widzi piksele, nie relacje.
Dostaje JSON z x/y/width/height, ale nie ma narzędzi typu „podpisz ten obiekt”, „połącz te dwa ID strzałką”, „ułóż te obiekty w kolumnie”.
Excalidraw-owe MCP serwery dla LLM-ów mają dokładnie takie high-level akcje: create/update/delete elementy, align, distribute, group itd., zamiast każdorazowo liczyć piksele w modelu.

Twoje tool’e są mocno low-level.
draw_board_patch wymaga od modelu podawania koordynatów; insert_latex_box wymaga pikselowej pozycji. Żadnego „zrób etykietę do koła o ID X”.

Brak delete + ID-owych operacji.
W schema patcha nie ma deletes, więc agent formalnie nie potrafi nic usunąć – najwyżej narysować „nadpisujący” element. To tłumaczy wrażenie, że „myśli, że obiekt wciąż jest”.

Pipeline jest ciężki: 2–4 wywołania LLM na jedno polecenie.
Dla rysowania:

call #1 → decyduje o tool_call,

wewnątrz generate_diagram_from_prompt → call #2 generujący BoardObject[],

call #3 → finalny tekst do usera.
Samo to potrafi zabić UX, nawet na szybkim modelu.

2. Zmień API: narzędzia „na ID”, nie na piksele

Klucz: agent powinien prawie nigdy nie liczyć współrzędnych sam. Tylko mówić:

„połącz A i B strzałką”

„podpisz A latexem”

„wyrównaj te ID w pionie”

„ustaw grubość linii tych ID na 4px, styl dashed”.

Ty po stronie serwera zamieniasz to na konkretne x/y/width/height.

2.1. Nowe tool’e w boardToolsSchema

Dodaj (lub wklej zamiast – zachowując stare, jeśli chcesz):

// boardToolsSchema.ts – DODATKOWE NARZĘDZIA

{
  type: 'function',
  function: {
    name: 'connect_objects',
    description:
      'Draw an arrow (vector) from one existing object to another using their bounding-box centers.',
    parameters: {
      type: 'object',
      properties: {
        fromId: { type: 'string', description: 'Source object id' },
        toId:   { type: 'string', description: 'Target object id' },
        style: {
          type: 'object',
          description: 'Optional style overrides',
          properties: {
            lineWidth: { type: 'number', description: 'Stroke width in px (1–8)' },
            lineStyle: {
              type: 'string',
              enum: ['solid', 'dashed', 'dotted'],
            },
            arrowHead: {
              type: 'string',
              enum: ['end', 'both'],
              description: 'Arrowhead direction (default "end")',
            },
            color: {
              type: 'string',
              description: 'Stroke color hex, e.g. "#000000"',
            },
          },
        },
      },
      required: ['fromId', 'toId'],
    },
  },
},
{
  type: 'function',
  function: {
    name: 'label_object',
    description:
      'Create a short label (plain text or LaTeX) attached to an existing object (top/bottom/left/right/center).',
    parameters: {
      type: 'object',
      properties: {
        objectId: { type: 'string' },
        text: {
          type: 'string',
          description: 'Label content. For LaTeX do NOT add $ or \\( \\).',
        },
        mode: {
          type: 'string',
          enum: ['plain', 'latex'],
          description: 'Render as normal text or LaTeX block.',
          default: 'plain',
        },
        position: {
          type: 'string',
          enum: ['top', 'bottom', 'left', 'right', 'center'],
          default: 'top',
        },
      },
      required: ['objectId', 'text'],
    },
  },
},
{
  type: 'function',
  function: {
    name: 'set_style',
    description:
      'Update visual style of one or more objects: stroke width, dash, color, arrowStyle etc.',
    parameters: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Object ids to update.',
        },
        props: {
          type: 'object',
          description: 'Style props to apply to all given ids.',
          properties: {
            lineWidth: { type: 'number' },
            lineStyle: {
              type: 'string',
              enum: ['solid', 'dashed', 'dotted'],
            },
            color: { type: 'string' },
            fillColor: { type: 'string' },
            arrowStyle: {
              type: 'string',
              enum: ['none', 'start', 'end', 'both'],
            },
          },
        },
      },
      required: ['ids', 'props'],
    },
  },
},
{
  type: 'function',
  function: {
    name: 'delete_objects',
    description: 'Delete one or more objects from the board by their ids.',
    parameters: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['ids'],
    },
  },
},


Teraz model:

strzałki wektorowe rysuje przez connect_objects (masz automatycznie dobre anchor points + spacing),

zmianę grubości / dashed / dotted robi przez set_style,

usuwanie jest realne (nie tylko „w narracji”),

podpisy, też latexowe, robi przez label_object, a nie białe prostokąty w randomowych miejscach.

3. Rozszerz draw_board_patch o styl + arrowStyle

Masz już support w rendererze (lineStyle, arrowStyle, lineWidth, roughness). Brakuje ich tylko w schema tool’a.

Zmień definicję draw_board_patch tak, żeby LLM mógł precyzyjnie prosić o strzałki / stroke width:

{
  type: 'function',
  function: {
    name: 'draw_board_patch',
    description:
      'Create or update board objects directly. Use for low-level drawing when higher-level tools like connect_objects or label_object are not sufficient.',
    parameters: {
      type: 'object',
      properties: {
        creates: {
          type: 'array',
          items: {
            type: 'object',
            description: 'A board object to create.',
            properties: {
              id: { type: 'string', description: 'Unique ID, e.g. "ai-rect-1"' },
              type: {
                type: 'string',
                enum: [
                  'rectangle',
                  'circle',
                  'line',
                  'text',
                  'latex',
                  'image',
                  'triangle',
                  'diamond',
                ],
              },
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
              text: { type: 'string' },
              latex: { type: 'string' },
              color: { type: 'string' },
              rotation: { type: 'number' },
              lineWidth: { type: 'number', description: 'Stroke width in px' },
              lineStyle: {
                type: 'string',
                enum: ['solid', 'dashed', 'dotted'],
              },
              arrowStyle: {
                type: 'string',
                enum: ['none', 'start', 'end', 'both'],
              },
              fillColor: { type: 'string' },
              points: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { x: { type: 'number' }, y: { type: 'number' } },
                },
              },
            },
            required: ['id', 'type', 'x', 'y'],
          },
        },
        updates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              props: {
                type: 'object',
                description: 'Properties to update (x, y, width, height, style, text, latex, ...)',
              },
            },
            required: ['id', 'props'],
          },
        },
        deletes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ids of objects to delete as part of this patch.',
        },
      },
    },
  },
},


Po stronie implementacji toolDrawBoardPatch:

dodaj obsługę deletes (wywal z Yjs / doca po ID),

wszystkie nowe pola stylu przepchnij do Twojego element (masz już lineStyle, arrowStyle, lineWidth, fillColor w rendererze, więc to tylko mapowanie).

To też rozwiązuje: „często wkleja dwa razy w to samo miejsce” – bo możesz nauczyć model, żeby używał updates zamiast zawsze creates.

4. Implementacje nowych tool’i po stronie serwera

Pseudokod (TypeScript) – do wklejenia w pliku z narzędziami (boardTools.ts lub podobnym). Bazuje na tym, co masz w rendererze (start/end, lineStyle, arrowStyle itd.).

4.1. Helpers: bbox + center + snap do siatki
import { nanoid } from 'nanoid';
import { BoardDoc } from '../../yjs/boardDoc';
import { BoardSnapshot, BoardPatch, BoardObject } from '../../models/boardSnapshot';

const GRID = 8; // lub 16 – ta sama wartość, co grid wizualny

function snap(v: number, step = GRID) {
  return Math.round(v / step) * step;
}

function snapObjectToGrid<T extends { x?: number; y?: number; width?: number; height?: number }>(
  obj: T,
): T {
  return {
    ...obj,
    x: obj.x !== undefined ? snap(obj.x) : obj.x,
    y: obj.y !== undefined ? snap(obj.y) : obj.y,
    width: obj.width !== undefined ? snap(obj.width) : obj.width,
    height: obj.height !== undefined ? snap(obj.height) : obj.height,
  };
}

function getBBox(o: BoardObject) {
  // dopasuj do swojego modelu – jeśli trzymasz start/end zamiast x/y,
  // przelicz to tutaj
  const x = o.x ?? o.start?.x ?? 0;
  const y = o.y ?? o.start?.y ?? 0;
  const w = o.width  ?? (o.end ? Math.abs(o.end.x - x) : 0);
  const h = o.height ?? (o.end ? Math.abs(o.end.y - y) : 0);
  return { x, y, width: w, height: h };
}

function getCenter(o: BoardObject) {
  const { x, y, width, height } = getBBox(o);
  return { x: x + width / 2, y: y + height / 2 };
}

function newId(prefix: string) {
  return `${prefix}-${nanoid(8)}`;
}

4.2. connect_objects – strzałki / wektory
export function toolConnectObjects(
  doc: BoardDoc,
  snapshot: BoardSnapshot,
  args: {
    fromId: string;
    toId: string;
    style?: {
      lineWidth?: number;
      lineStyle?: 'solid' | 'dashed' | 'dotted';
      arrowHead?: 'end' | 'both';
      color?: string;
    };
  },
): BoardPatch {
  const from = snapshot.objects.find(o => o.id === args.fromId);
  const to   = snapshot.objects.find(o => o.id === args.toId);
  if (!from || !to) {
    return { creates: [], updates: [] };
  }

  const a = getCenter(from);
  const b = getCenter(to);

  const arrow: BoardObject = {
    id: newId('ai-arrow'),
    type: 'line',
    // w Twoim modelu możesz też chcieć osobne start/end
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

  return { creates: [snapObjectToGrid(arrow)] };
}

4.3. label_object – podpisy tekst / LaTeX
export function toolLabelObject(
  doc: BoardDoc,
  snapshot: BoardSnapshot,
  args: {
    objectId: string;
    text: string;
    mode?: 'plain' | 'latex';
    position?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  },
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
    text: mode === 'plain' ? args.text : undefined,
    latex: mode === 'latex' ? args.text : undefined,
    color: '#000000',
    // możesz dodać fontSize itd.
  };

  return { creates: [snapObjectToGrid(base)] };
}

4.4. set_style & delete_objects
export function toolSetStyle(
  doc: BoardDoc,
  snapshot: BoardSnapshot,
  args: {
    ids: string[];
    props: Partial<BoardObject>;
  },
): BoardPatch {
  const updates = args.ids.map(id => ({
    id,
    props: args.props,
  }));
  return { creates: [], updates };
}

export function toolDeleteObjects(
  doc: BoardDoc,
  snapshot: BoardSnapshot,
  args: { ids: string[] },
): BoardPatch {
  return {
    creates: [],
    updates: [],
    deletes: args.ids,
  };
}


Oczywiście musisz:

dopiąć je w switchu w runBoardAgent (analogicznie jak inne tool’e),

zaimplementować realne deletes w kodzie, który stosuje patch do Yjs / stanu tablicy.

5. Usprawnij prompt i reprezentację sceny (dokładniejsze rysunki)
5.1. Lepszy SYSTEM_PROMPT

Zastąp dotychczasowy czymś w tym stylu (skrót, możesz doprecyzować):

const SYSTEM_PROMPT = `
You are an AI Board Assistant for a math & diagram whiteboard.

You receive:
- a JSON snapshot of the board (objects with id, type, x, y, width, height, text/latex),
- optional viewport info,
- a user request.

GENERAL RULES
- Prefer using TOOLS instead of describing what you did.
- Prefer HIGH-LEVEL tools that operate on object ids and relations:
  * connect_objects  – to draw arrows/vectors between existing objects,
  * label_object     – to add text/LaTeX labels to objects,
  * set_style        – to change stroke width / dash / color / arrowStyle,
  * align_selection_to_grid – to clean up spacing,
  * plot_function, insert_latex_box etc. for math.

GEOMETRY
- Do NOT approximate straight lines with many small points; use line objects.
- For axes, vectors and connections always prefer connect_objects or line with arrowStyle.
- Assume grid size is 8px. When giving coordinates in draw_board_patch, keep them multiples of 8.
- When creating several similar shapes (e.g. wheels, snowman circles), align their centers or edges and then call align_selection_to_grid.

STATE
- Trust the JSON snapshot: if an id is not present there, it does not exist on the board.
- If you want to change an object, prefer updates via draw_board_patch or set_style instead of creating a new object in the same place.

MATH & LATEX
- For formulas, vector labels etc. use label_object with mode="latex" when attaching to existing objects.
- Use insert_latex_box only when you need a standalone equation block, not a small label.

Respond to the user with a short explanation (1–3 sentences) and rely on tools for actual modifications.
`;


To:

dociśnie korzystanie z nowych tool’i,

zmniejszy liczbę sytuacji, gdy „rysuje zwykłą linią, nie strzałką”,

wymusi align do siatki.

5.2. „Odchudzony” snapshot – mniej tokenów → szybciej

Zanim zrobisz JSON.stringify(snapshot) możesz go zredukować do rzeczy istotnych dla LLM-a:

function compressSnapshot(snapshot: BoardSnapshot) {
  return {
    ...snapshot,
    objects: snapshot.objects.map(o => ({
      id: o.id,
      type: o.type,
      x: o.x ?? o.start?.x ?? 0,
      y: o.y ?? o.start?.y ?? 0,
      width: o.width,
      height: o.height,
      text: o.text ? o.text.slice(0, 120) : undefined,
      latex: o.latex ? o.latex.slice(0, 120) : undefined,
    })),
  };
}


I w runBoardAgent:

const compactBoard = compressSnapshot(snapshot);

let userContent: any = JSON.stringify({
  board: compactBoard,
  viewport,
  request: userMessage,
});


Mniej JSON-u → mniej tokenów → krótsze odpowiedzi → mniejsze lagi.

6. Performance pipeline – zlikwiduj zbędne call’e

Największy win:

zdeprecjonuj generate_diagram_from_prompt jako osobny call LLM.

Zamiast:

model: tool_call → generate_diagram_from_prompt(prompt, centerX, centerY)

serwer: drugi call modelu, który z promptu robi BoardObject[]

serwer: patch → tablica

model: trzeci call dla finalnej odpowiedzi

zrób:

w boardToolsSchema wywal/ukryj generate_diagram_from_prompt,

ucz w system prompt, że do rysowania kilku figur naraz ma używać bezpośrednio draw_board_patch z tablicą creates.

To od razu skróci czas rysowania bałwana / auta o ~1/3–1/2.

Jeśli chcesz zostawić „wysokopoziomowe” diagramy (np. flowcharty), możesz dać generate_diagram_from_prompt ale bez drugiego calla – niech pierwszy model od razu wkłada BoardObject[] w arguments.patch.

7. Co to daje w praktyce

Z tym zestawem zmian:

Bałwan / auto / wektory:
– koła, prostokąty i trójkąty są wyrównywane dzięki grid snapping + align tool,
– strzałki są tworzone przez connect_objects (czyli zawsze trafiają w środek / krawędź figury),
– agent może dobrać lineWidth + lineStyle przez set_style – więc np. oś x/y gruba, pomocnicze cienkie, wektory dashed/dotted.

Podpisy LaTeX:
– zamiast białych bloków „z kosmosu”, masz label_object z mode="latex" → podpisy pod wykresami, wektory z 
𝑣
⃗
v
 itd.

Stan tablicy:
– delete_objects + deletes w patchu → realne usuwanie,
– system prompt „ufaj snapshotowi” → mniej fantazjowania o starych obiektach.

Wydajność:
– mniej tokenów (skompresowany snapshot),
– mniej calli (brak dodatkowego LLM wewnątrz generate_diagram_from_prompt),
– mniejsza liczba „ponownych rysowań” – agent częściej robi updates zamiast creates.

Po wdrożeniu tych kroków agent zaczyna zachowywać się dużo bardziej jak „drugi user z myszką”, a nie jak model, który zgaduje współrzędne na ślepo.

1. Naturalne odręczne strokes – bez wysyłania 200 punktów przez LLM

Obecnie pen ma:

type 'pen'
points / rawPoints / smoothedPoints
penStyle, penConfig, smoothing...


LLM nie może realnie wysyłać całej tablicy points (za dużo tokenów, wolno, syf).
Rozwiązanie: wysyła tylko kilka punktów kontrolnych + styl, a backend generuje gęste punkty i tworzy element typu pen.

1.1. Nowe narzędzie: draw_handstroke

Schema w boardToolsSchema:

{
  type: 'function',
  function: {
    name: 'draw_handstroke',
    description:
      'Draw a freehand pen stroke (handwriting style). The model gives only key points, server generates smooth stroke.',
    parameters: {
      type: 'object',
      properties: {
        points: {
          type: 'array',
          description:
            '2–6 key points of the stroke in board coordinates. The server will interpolate and smooth.',
          items: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
            },
            required: ['x', 'y'],
          },
          minItems: 2,
          maxItems: 8,
        },
        style: {
          type: 'string',
          enum: ['teacher_marker', 'student_pen', 'sketch'],
          description:
            'Preset of pen style / smoothing / width jitter. Default "teacher_marker".',
        },
        color: {
          type: 'string',
          description: 'Stroke color (hex). Default: current board color.',
        },
      },
      required: ['points'],
    },
  },
}

1.2. Implementacja po stronie serwera

Przykładowy helper (TypeScript):

import { nanoid } from 'nanoid';
import { BoardDoc } from '../../yjs/boardDoc';
import { BoardSnapshot, BoardPatch, BoardObject } from '../../models/boardSnapshot';

function jitter(val: number, amount: number) {
  return val + (Math.random() * 2 - 1) * amount;
}

// Prosty Catmull-Rom → gęstsze punkty
function interpolateStroke(points: { x: number; y: number }[], step = 0.2) {
  if (points.length <= 2) return points;

  const res: { x: number; y: number }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? i : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1];

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
  res.push(points[points.length - 1]);
  return res;
}

export function toolDrawHandstroke(
  doc: BoardDoc,
  snapshot: BoardSnapshot,
  args: {
    points: { x: number; y: number }[];
    style?: 'teacher_marker' | 'student_pen' | 'sketch';
    color?: string;
  },
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

  const element: BoardObject = {
    id: `ai-pen-${nanoid(6)}`,
    type: 'pen',
    points: dense,
    rawPoints: base,
    smoothedPoints: [],
    color: args.color ?? '#000000',
    lineWidth: cfg.baseWidth,
    penStyle: 'technical', // lub np. 'gel_pen' – co tam masz w drawStyledPen
    penConfig: {
      // możesz to zmapować na swoje presety
      smoothing: cfg.smoothing,
    },
    timestamp: Date.now(),
  };

  return { creates: [element] };
}


To w pełni wykorzystuje Twoje istniejące rysowanie pióra (bo dalej użyjesz drawStyledPen), ale:

LLM podaje tylko 2–6 punktów → mało tokenów,

backend robi interpolację + delikatny jitter → ładny, miękki stroke,

możesz patchować penStyleOptions tak, żeby to współgrało z resztą UI.

1.3. Nie psujesz feelu dla człowieka

To jest ważne: nie zmieniasz logiki Rough.js / pen dla usera.
Ta cała generacja dotyczy tylko stroke’ów tworzonych przez tool draw_handstroke – elementy utworzone tą drogą są po prostu „pen elementami” jak wszystkie inne.

Czyli:

użytkownik nadal rysuje ręcznie dokładnie tak samo,

agent generuje „syntetyczne” pen-elementy, które wyglądają jak pisane tą samą kredą/długopisem.

2. Kiedy pen, a kiedy line/arrow/shape – jak nauczyć agenta

Tu są dwa poziomy:

API / narzędzia – żeby w ogóle miał wybór.

Instrukcje w system prompt + zasady.

2.1. Zasady logiczne (które opisujesz w prompt)

Możesz do SYSTEM_PROMPT dołożyć blok:

HANDWRITING vs SHAPES

- Use draw_handstroke when:
  * the user explicitly asks for "odręczne" writing, underlines, curly braces etc.,
  * you add emphasis (underlining, circling, crossing out),
  * you draw quick sketch marks (ticks, corrections, small brackets).
- Use line / arrows / connect_objects when:
  * drawing axes, vectors, connectors between blocks,
  * suggesting precise geometric constructions,
  * any line that should be perfectly straight or symmetric.
- Use rectangles / circles / triangles etc. for geometric and diagram shapes,
  not pen strokes.


W praktyce:

„Narysuj wektor v i podpisz go” →
– line + arrowStyle: 'end' albo connect_objects + set_style
– label_object(mode='latex', text='\\vec{v}').

„Podkreśl to odręcznie” →
– draw_handstroke z dwoma punkami [początek pod napisem, koniec pod napisem].

„Pokaż różnicę odręcznym nawiasem klamrowym po lewej” →
– draw_handstroke z kilkoma punktami w kształcie klamry {.

2.2. Wiązanie z istniejącymi narzędziami

Możesz lekko rozszerzyć wcześniej dodany label_object, żeby miał tryb „pen”:

// w schema:
mode: {
  type: 'string',
  enum: ['plain', 'latex', 'handwriting'],
  default: 'plain',
}


Implementacja:

plain → tworzysz text;

latex → latex;

handwriting → wywołujesz od środka toolDrawHandstroke, generując 1–2 krótkie linie (np. podpis odręczny w stylu markerowym; tu możesz zacząć od prostego prototypu – np. tylko falista linia zamiast realnych liter, albo zaawansowane: template’y liter, ale to większy projekt).

Na start: sensowniejsze jest, żeby bot do tekstu jednak używał zwykłego text/latex, a piórko wykorzystywał do:

podkreślenia,

zakreślenia,

strzałek-„bazgrołów”,

odręcznych nawiasów, falek, szlaczków.

3. Żeby korzystał z tego „tylko kiedy trzeba”

Żeby agent nie zaczął rysować WSZYSTKIEGO piórem:

Priorytety narzędzi – jasno w prompt:

„Axes, vectors, diagram connectors → connect_objects / line.”

„Freeform doodles, highlights → draw_handstroke.”

Soft limit w docu tool’a:

W opisie draw_handstroke możesz napisać:

„Use this tool sparingly for short strokes (e.g. underline, curly bracket, highlight). Max 200px long.”

To naprawdę pomaga modelowi nie nadużywać tego narzędzia.

Guardrails w backendzie (opcjonalnie):

Jeśli points są bardzo daleko od siebie → możesz albo:

przyciąć stroke,

albo zlogować i odrzucić (zwrócić tool result z status: 'error', message: 'stroke too large' – model zwykle adaptuje się po 1–2 razach).

4. Bonus: jeszcze więcej „human feel” za darmo

Kilka drobiazgów, które mocno poprawiają wrażenie, a prawie nic nie kosztują:

Lekka zmienność grubości – w drawStyledPen możesz (dla pen z source='ai' lub id z prefixem ai-) wprowadzić minimalny jitter lineWidth co parę punktów.

Minimalny noise w kolorze – np. co stroke ±1–2% jasności; oko to lubi.

Użycie tego samego preset’u co user – jeśli użytkownik ma wybrany styl gel_pen, agent powinien używać tego samego penStyle, żeby wszystko wyglądało spójnie.

Podsumowując:

Dodajesz wysokopoziomowe narzędzie draw_handstroke, które bierze kilka punktów kluczowych i na backendzie generuje gładki, naturalny stroke z Twoją logiką pisma (bez naruszania feelu dla człowieka).

Rozszerzasz prompt i toolset tak, żeby pen był używany tylko do freeform / akcentów, a geometria i wektory szły przez line/arrow/connect_objects + set_style.

W efekcie bot potrafi:

odręcznie podkreślać, stawiać nawiasy, zakreślenia,

rysować precyzyjne wektory i osie tam, gdzie trzeba,

robić to wszystko bez lagów, bo po drucie idą tylko 2–6 punktów, a nie cała chmura.

server/src/yjs/boardDoc.ts

server/src/ai/models/boardSnapshot.ts (jeśli zmieniałeś typy)

server/src/ai/tools/boardTools.ts

server/src/ai/agent/boardToolsSchema.ts

server/src/ai/agent/boardAgent.ts

ewentualnie plik z rysowaniem linii/penem, jeśli też go ruszałeś.

Wtedy: