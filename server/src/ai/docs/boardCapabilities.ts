export interface BoardCapabilityDoc {
    id: string;
    tags: string[];
    doc: string;
}

export const BOARD_CAPABILITIES: BoardCapabilityDoc[] = [
    {
        id: 'schema-board-object',
        tags: ['schema', 'json', 'board', 'object'],
        doc: `
BoardObject Schema:
{
  "id": "string (unique)",
  "type": "rect" | "note" | "latex" | "functionPlot" | "path" | "circle" | "triangle",
  "x": number,
  "y": number,
  "width": number,
  "height": number,
  "text"?: string,
  "latex"?: string (for type='latex'),
  "points"?: [{ "x": number, "y": number }] (for type='path'),
  "style"?: {
      "expression"?: string (for type='functionPlot', e.g. 'sin(x)'),
      "xMin"?: number,
      "xMax"?: number,
      "fillColor"?: string,
      "strokeColor"?: string
  }
}

BoardPatch Schema:
{
  "creates"?: BoardObject[],
  "updates"?: [{ "id": string, "props": Partial<BoardObject> }]
}
`,
    },
    {
        id: 'tool-plot-function',
        tags: ['function', 'plot', 'math', 'graph'],
        doc: `
Tool: plot_function
Purpose: Insert a mathematical function plot.
Arguments: { "expression": "sin(x)", "xMin": -10, "xMax": 10, "x": 100, "y": 100 }
Result: Creates a BoardObject of type "functionPlot".
`,
    },
    {
        id: 'tool-insert-latex',
        tags: ['latex', 'math', 'equation', 'formula'],
        doc: `
Tool: insert_latex_box
Purpose: Insert a rendered LaTeX equation block.
Arguments: { "latex": "E = mc^2", "x": 100, "y": 100 }
Result: Creates a BoardObject of type "latex".
`,
    },
    {
        id: 'tool-draw-patch',
        tags: ['draw', 'create', 'update', 'low-level', 'rect', 'shape'],
        doc: `
Tool: draw_board_patch
Purpose: Low-level API to create or update any board objects directly via JSON patch.
Arguments: { "patch": { "creates": [...], "updates": [...] } }
Use this for creating shapes, notes, or modifying existing objects when specific tools don't exist.
`,
    },
];

export function retrieveBoardDocs(query: string): string[] {
    const q = query.toLowerCase();
    // Simple keyword matching
    return BOARD_CAPABILITIES
        .filter(c =>
            c.tags.some(t => q.includes(t)) ||
            c.doc.toLowerCase().includes(q)
        )
        .map(c => c.doc);
}
