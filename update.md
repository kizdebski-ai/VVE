1. Lekkie „board context” dla LLM (ID + koordy + typ)
1.1. Nowy helper – boardAgentContext.ts

Dodaj nowy plik (albo sekcję) obok runBoardAgent:

// boardAgentContext.ts
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
  viewport?: { x: number; y: number; width: number; height: number };
  totalObjectCount: number;
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

    const x = (obj as any).x ?? (obj as any).position?.x ?? 0;
    const y = (obj as any).y ?? (obj as any).position?.y ?? 0;
    const w =
      (obj as any).width ??
      ((obj as any).start && (obj as any).end
        ? Math.abs((obj as any).end.x - (obj as any).start.x)
        : 0);
    const h =
      (obj as any).height ??
      ((obj as any).start && (obj as any).end
        ? Math.abs((obj as any).end.y - (obj as any).start.y)
        : 0);

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

  const filtered = viewport ? objects.filter(intersectsViewport) : [...objects];

  // Sortowanie po zIndex/timestamp, żeby agent widział „górę” stosu
  filtered.sort(
    (a: any, b: any) =>
      (a.zIndex ?? a.timestamp ?? 0) - (b.zIndex ?? b.timestamp ?? 0),
  );

  const trimmed = filtered.slice(0, maxObjects);

  const agentObjects: AgentBoardObject[] = trimmed.map((o: any) => {
    const x = o.x ?? o.position?.x ?? (o.start ? Math.min(o.start.x, o.end?.x ?? o.start.x) : 0);
    const y = o.y ?? o.position?.y ?? (o.start ? Math.min(o.start.y, o.end?.y ?? o.start.y) : 0);

    const width =
      o.width ??
      (o.start && o.end ? Math.abs(o.end.x - o.start.x) : 0);
    const height =
      o.height ??
      (o.start && o.end ? Math.abs(o.end.y - o.start.y) : 0);

    const base: AgentBoardObject = {
      id: o.id,
      type: o.type,
      x,
      y,
      width,
      height,
      kind: inferKind(o),
    };

    if (o.text) {
      base.text = String(o.text).slice(0, 200);
    }
    if (o.latex) {
      base.latex = String(o.latex).slice(0, 200);
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
      return 'handwriting';
    case 'functionPlot':
    case 'mathFunctionPlot':
      return 'functionPlot';
    case 'image':
      return 'image';
    default:
      return 'shape';
  }
}

1.2. Użycie w runBoardAgent zamiast wrzucania całego snapshot

W pliku z agentem:

import { buildAgentBoardContext } from './boardAgentContext';


i na początku runBoardAgent:

export async function runBoardAgent(params: {
    doc: BoardDoc;
    snapshot: BoardSnapshot;
    userMessage: string;
    viewport?: { x: number; y: number; width: number; height: number };
    image?: string;
}): Promise<AgentResult> {
    if (!llmClient) {
        return { reply: 'Board assistant is not configured on the server.' };
    }

    const { doc, snapshot, userMessage, viewport, image } = params;

    // 🔥 LEKKI kontekst zamiast pełnego snapshotu
    const agentContext = buildAgentBoardContext(snapshot, viewport, 64);

    let userContent: any = JSON.stringify({
        boardContext: agentContext,
        request: userMessage,
    });

    if (image) {
        userContent = [
            {
                type: 'text',
                text: JSON.stringify({
                    boardContext: agentContext,
                    request: userMessage,
                    note: 'The image shows the visual board. Use it mainly to read handwriting or check spatial relationships that are not obvious from the JSON context.',
                }),
            },
            {
                type: 'image_url',
                image_url: { url: image },
            },
        ];
    }

    const docs = retrieveBoardDocs(userMessage);

    const baseMessages: ChatCompletionMessageParam[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...(docs.length
            ? [{
                  role: 'system',
                  content:
                      'Board JSON schema and tools (documentation):\n\n' +
                      docs.join('\n\n'),
              } as ChatCompletionMessageParam]
            : []),
        {
            role: 'user',
            content: userContent,
        },
    ];
    // ... reszta funkcji jak poniżej po zmianach promptu / tools


To odcina ci z requestu całe „bebechy” Yjs (punkty pióra itd.) i zostawia tylko lekką wersję z ID + geometrią.

2. Patch z create / update / delete + pełny dostęp do narzędzi
2.1. Typ BoardPatch – dodaj deletes

W modelach:

// models/boardSnapshot.ts
export interface BoardPatch {
  creates?: BoardObject[];
  updates?: { id: string; props: Partial<BoardObject> }[];
  deletes?: string[]; // <--- NOWE
}


toolDrawBoardPatch musi to respektować (delete z Yjs / lokalnej kolekcji).

2.2. Rozszerzenie schema narzędzia draw_board_patch

W boardToolsSchema podmień definicję draw_board_patch:

{
  type: 'function',
  function: {
    name: 'draw_board_patch',
    description:
      'Create, update or delete board objects directly. Use this as the main way to draw/edit on the board.',
    parameters: {
      type: 'object',
      properties: {
        creates: {
          type: 'array',
          items: {
            type: 'object',
            description: 'A board object to create.',
            properties: {
              id: {
                type: 'string',
                description:
                  'Stable unique ID, e.g. "ai-note-1". Reuse it later to edit the same object.',
              },
              type: {
                type: 'string',
                enum: [
                  'rectangle',
                  'circle',
                  'line',
                  'text',
                  'latex',
                  'functionPlot',
                  'path',
                  'image',
                  'triangle',
                  'diamond',
                  'coordinateSystem2D',
                  'mathFunctionPlot',
                  'physicsDataPlot',
                  'coordinateSystem3D',
                  'cube',
                  'cuboid',
                  'sphere',
                  'cylinder',
                  'cone',
                  'pyramid',
                  'tetrahedron',
                ],
              },
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
              text: { type: 'string' },
              latex: { type: 'string' },
              color: {
                type: 'string',
                description: 'Hex color code (e.g. "#ff0000").',
              },
              rotation: {
                type: 'number',
                description: 'Rotation in degrees.',
              },
              points: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    x: { type: 'number' },
                    y: { type: 'number' },
                  },
                },
              },
              // dodatkowe pole na „rodzaj” obiektu jeżeli chcesz
              kind: {
                type: 'string',
                description:
                  'Optional semantic kind: "note", "heading", "example", etc.',
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
                description:
                  'Properties to update (x, y, width, height, text, latex, color, etc.)',
              },
            },
            required: ['id', 'props'],
          },
        },
        deletes: {
          type: 'array',
          items: { type: 'string' },
          description: 'IDs of objects to delete from the board.',
        },
      },
    },
  },
},


Dzięki temu LLM może:

stworzyć obiekt z konkretnym ID,

później w innym wywołaniu zaktualizować go przez updates,

a jak trzeba – usunąć przez deletes.

2.3. toolDrawBoardPatch – obsługa deletes

Schema już wysyła deletes, więc w implementacji:

// tools/boardTools.ts (w toolDrawBoardPatch)
import { BoardPatch } from '../../models/boardSnapshot';

export function toolDrawBoardPatch(
  doc: BoardDoc,
  snapshot: BoardSnapshot,
  args: any,
): BoardPatch {
  const patch: BoardPatch = {
    creates: [],
    updates: [],
    deletes: [],
  };

  if (Array.isArray(args.creates)) {
    // mapujesz BoardObject z args.creates -> swoje elementy/Yjs
    patch.creates = args.creates.map((raw: any) => ({
      ...raw,
      // tutaj możesz mapować type 'rectangle' -> swój internal type itd.
    }));
  }

  if (Array.isArray(args.updates)) {
    patch.updates = args.updates.map((u: any) => ({
      id: u.id,
      props: u.props,
    }));
  }

  if (Array.isArray(args.deletes)) {
    patch.deletes = [...args.deletes];
  }

  // Tu: realna aplikacja patcha do BoardDoc / Yjs
  // np. doc.applyPatch(patch) albo coś podobnego

  return patch;
}


runBoardAgent nie musi się zmieniać – nadal tylko zbiera patch i zwraca do frontu (lub od razu aplikuje).

3. Zmieniony SYSTEM_PROMPT – agent zna ID/koordy i nie robi miliona tool.calli

Podmień SYSTEM_PROMPT:

const SYSTEM_PROMPT = `
You are an "AI Board Assistant" for a collaborative math & diagram whiteboard.

You receive:
- a LIGHTWEIGHT JSON boardContext:
  {
    "objects": [
      {
        "id": string,
        "type": string,
        "x": number,
        "y": number,
        "width": number,
        "height": number,
        "text"?: string,
        "latex"?: string,
        "kind": "shape" | "note" | "latex" | "handwriting" | "functionPlot" | "image" | "other"
      }
    ],
    "viewport"?: { "x": number, "y": number, "width": number, "height": number },
    "totalObjectCount": number
  }
- the user's natural language request.

IMPORTANT BEHAVIOUR:

1. IDs and coordinates
- Treat "id" as STABLE identifiers. Reuse them when updating or deleting objects.
- Use (x, y, width, height) to place new objects precisely on the board.
- Prefer relative and structured layouts (aligned, neat, usable for students).

2. Tools
- Prefer using tools instead of only replying with text.
- Main tool for drawing/editing is "draw_board_patch":
  - create new objects through "creates";
  - update existing objects through "updates";
  - delete objects through "deletes".
- Use "insert_latex_box" for standalone math formulas if it is simpler than a manual patch.
- Use "plot_function" for graphs of functions.
- Use "align_selection_to_grid" ONLY when user asks to tidy/align elements.
- Use "simplify_equation_block" and "text_block_to_latex" ONLY when the user asks to simplify or convert to LaTeX. Do NOT run them on everything automatically.

3. Performance & tool usage
- Group ALL drawing/editing operations into a SINGLE "draw_board_patch" call per response.
- Avoid long chains of tool calls. Usually you should:
  - reason about the change,
  - call "draw_board_patch" once,
  - then answer with a short explanation for the user.
- Do not request or expect the full raw board JSON; the provided boardContext is all you need.

4. Style of responses
- Always produce a short, clear explanation for the user (1–3 sentences).
- When introducing math, keep LaTeX readable and standard.
`;


To daje modelowi jasny sygnał:

ma ID, koordy, typ,

ma używać jednego draw_board_patch na odpowiedź,

ma nie odpalac masowo simplify/LaTeX na wszystkim.

4. runBoardAgent – mała kosmetyka pod nowy prompt i patch

Twój runBoardAgent po wprowadzeniu kontekstu i nowego promptu wygląda prawie tak jak teraz. Jedyne rzeczy, na które trzeba spojrzeć:

Pierwsze wywołanie – już ma lżejszy baseMessages (patrz pkt 1.2).

Case dla draw_board_patch – nic nie zmienia się w strukturze poza tym, że args może zawierać deletes:

case 'draw_board_patch': {
    const patch = toolDrawBoardPatch(doc, snapshot, args);
    lastPatch = patch;
    toolMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify({ status: 'ok', patch }),
    });
    break;
}


Resztę (align, insert_latex_box, plot_function, simplify…) możesz zostawić; pamiętaj tylko, że teraz system prompt ogranicza ich agresywne używanie.

5. Canvas / RoughJS – drobna optymalizacja rysowania

W twoim drawElement tworzysz const rc = rough.canvas(context.canvas); dla każdego elementu.
Lepiej zrobić to raz na ramkę:

5.1. Zmień sygnaturę drawElement
// dopisz optional rc
export const drawElement = (
  context,
  element,
  isHighlighted = false,
  smoothingFactor = 0.65,
  imageCache,
  requestRedraw,
  penStyleOptions = {},
  rcOverride = null,
) => {
  if (!context || !element || !element.type) return;

  // użyj override jeśli jest, inaczej stwórz lokalny
  const rc = rcOverride ?? rough.canvas(context.canvas);

  // ...reszta bez zmian
};

5.2. W miejscu renderowania tablicy

Tam, gdzie robisz pętlę po elementach:

const ctx = canvas.getContext('2d');
const rc = rough.canvas(canvas);

elements.forEach(el => {
  drawElement(ctx, el, false, 0.65, imageCache, requestRedraw, penStyleOptions, rc);
});


To zmniejsza narzut na rysowanie przy dużej liczbie elementów (dokładne krzywe, funkcje itd.).

6. Warstwa UI – żeby AI nie blokowało rysowania

Na froncie trzymaj runBoardAgent jako akcję w store, a nie bezpośredni await z komponentu canvas:

// aiStore.ts (Pinia / Zustand / cokolwiek)
import { runBoardAgent } from '.../ai/boardAgent';
import { makeSnapshotFromDoc, applyPatchToDoc } from '...'; // twoje helpery

export const useAiStore = defineStore('ai', {
  state: () => ({
    isRunning: false,
  }),
  actions: {
    async runBoardAssistant(request: string, viewport?: { x: number; y: number; width: number; height: number }) {
      if (this.isRunning) return;
      this.isRunning = true;
      try {
        const snapshot = makeSnapshotFromDoc(boardDoc);
        const res = await runBoardAgent({
          doc: boardDoc,
          snapshot,
          userMessage: request,
          viewport,
        });

        if (res.patch) {
          applyPatchToDoc(boardDoc, res.patch);
        }

        // tutaj dopiero wrzucasz message do okienka czatu
        chatStore.addAssistantMessage(res.reply);
      } finally {
        this.isRunning = false;
      }
    },
  },
});


A w komponencie canvas/chat tylko:

const ai = useAiStore();

const onSubmitPrompt = () => {
  ai.runBoardAssistant(prompt.value, currentViewport.value);
  // UI OD RAZU działa dalej, nie czeka na await w komponencie
};


Dzięki temu:

UI tablicy rysuje się niezależnie od czasu odpowiedzi LLM,

agent ma ID, typy, koordy i pełną kontrolę przez draw_board_patch,

JSON do LLM jest mocno odchudzony, więc Grok Fast nie dostaje megabajtowych payloadów.