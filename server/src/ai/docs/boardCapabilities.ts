export interface BoardCapabilityDoc {
  id: string;
  tags: string[];
  doc: string;
}

export const BOARD_CAPABILITIES: BoardCapabilityDoc[] = [
  {
    id: 'schema-board-object',
    tags: ['schema', 'json', 'board', 'object', 'patch'],
    doc: `
BoardObject (uproszczony schemat JSON używany przez narzędzia):

{
  "id": "string (unikalne, np. 'ai-rect-123')",
  "type": "string",
  // typy spotykane najczęściej:
  // "rectangle", "circle", "line", "text", "latex", "note",
  // "image", "triangle", "diamond", "pen", "mathFunctionPlot"

  "x": number,
  "y": number,
  "width"?: number,
  "height"?: number,
  "rotation"?: number,

  // zawartość
  "text"?: string,
  "latex"?: string,
  "expression"?: string,        // dla wykresów funkcji
  "xRange"?: [number, number],  // np. [-10, 10]

  // styl / stroke
  "lineWidth"?: number,                         // grubość linii w px
  "lineStyle"?: "solid" | "dashed" | "dotted",
  "arrowStyle"?: "none" | "start" | "end" | "both",
  "color"?: string,                             // główny kolor linii (hex)
  "strokeColor"?: string,                       // alias dla color
  "fillColor"?: string,                         // kolor wypełnienia (hex)

  // geometria linii / wektorów
  "start"?: { "x": number, "y": number },
  "end"?:   { "x": number, "y": number },

  // ścieżki / odręczne pisanie
  "points"?: [{ "x": number, "y": number }],
  "rawPoints"?: [{ "x": number, "y": number, "t"?: number }],
  "smoothedPoints"?: [{ "x": number, "y": number }],
  "penStyle"?: "teacher_marker" | "student_pen" | "sketch" | string,
  "penConfig"?: { "smoothing"?: number },

  // meta
  "selected"?: boolean,
  "timestamp"?: number,
  "style"?: { [key: string]: any } // dowolne dodatkowe metadane
}

BoardPatch (używane przez draw_board_patch i wewnętrznie):

{
  "creates"?: BoardObject[],
  "updates"?: [
    { "id": string, "props": Partial<BoardObject> }
  ],
  "deletes"?: string[] // ID obiektów do usunięcia
}
`,
  },
  {
    id: 'tool-align-grid',
    tags: ['align', 'grid', 'layout'],
    doc: `
Tool: align_selection_to_grid
Purpose: dociąga zaznaczone obiekty do linii siatki, żeby były równo wyrównane.

Args:
{
  "gridSize": 16,
  "selectionIds": ["id-1", "id-2"] // opcjonalne; gdy brak, użyj obiektów z selected=true
}

Effect:
Aktualizuje x/y (oraz points przy ścieżkach), tak aby były wielokrotnością gridSize.
`,
  },
  {
    id: 'tool-simplify-equation',
    tags: ['equation', 'simplify', 'latex', 'math'],
    doc: `
Tool: simplify_equation_block
Purpose: zastępuje surowy tekst równania jego uproszczoną wersją w LaTeX.

Args:
{
  "objectId": "id-tekstu-z-rowaniem"
}

Effect:
Aktualizuje dany obiekt tak, aby jego zawartość była prostszą wersją w LaTeX (np. do dalszego renderu).
`,
  },
  {
    id: 'tool-plot-function',
    tags: ['function', 'plot', 'math', 'graph'],
    doc: `
Tool: plot_function
Purpose: wstawia wykres funkcji matematycznej.

Args:
{
  "expression": "sin(x)",
  "xMin": -10,
  "xMax": 10,
  "x": 100,
  "y": 100
}

Result:
Tworzy BoardObject o type "mathFunctionPlot" z:
- expression = podany wzór,
- xRange = [xMin, xMax] (domyślnie [-10, 10]),
- width/height ustawionym tak, by wykres był czytelny.
`,
  },
  {
    id: 'tool-insert-latex',
    tags: ['latex', 'math', 'equation', 'formula'],
    doc: `
Tool: insert_latex_box
Purpose: wstawia nowy blok z równaniem LaTeX.

Args:
{
  "latex": "E = mc^2",
  "x": 100,
  "y": 100,
  "width": 260,   // opcjonalne
  "height": 120   // opcjonalne
}

Result:
Tworzy BoardObject o type "latex" w podanym miejscu.
`,
  },
  {
    id: 'tool-text-to-latex',
    tags: ['latex', 'text', 'convert'],
    doc: `
Tool: text_block_to_latex
Purpose: zamienia istniejący blok tekstu w renderowany blok LaTeX.

Args:
{
  "objectId": "id-tekstu"
}

Result:
Ten sam obiekt zmienia type na "latex", ustawia pole "latex" i czyści "text".
`,
  },
  {
    id: 'tool-draw-patch',
    tags: ['draw', 'create', 'update', 'low-level', 'rect', 'shape'],
    doc: `
Tool: draw_board_patch
Purpose: niskopoziomowe API do bezpośredniego tworzenia/aktualizacji obiektów tablicy.

Najprostszy wariant:
{
  "creates": [ BoardObject, ... ],
  "updates": [
    { "id": "existing-id", "props": Partial<BoardObject> }
  ],
  "deletes": ["id-do-usuniecia-1", "id-do-usuniecia-2"]
}

Server akceptuje też wariant zagnieżdżony:
{ "patch": { "creates": [...], "updates": [...], "deletes": [...] } }

Używaj, gdy inne narzędzia (connect_objects, label_object itd.) nie wystarczają.
`,
  },
  {
    id: 'tool-connect-objects',
    tags: ['connect', 'arrow', 'vector', 'line'],
    doc: `
Tool: connect_objects
Purpose: łączy dwa istniejące obiekty strzałką / wektorem od środka bounding boxu A do środka B.

Args:
{
  "fromId": "id-zrodla",
  "toId": "id-celu",
  "style": {
    "lineWidth": 2,
    "lineStyle": "dashed",
    "arrowHead": "end",       // lub "both"
    "color": "#000000"
  }
}

Result:
Tworzy BoardObject o type "line" ze start/end ustawionym między obiektami
i prostymi propercjami stylu (lineWidth, lineStyle, arrowStyle, color).
`,
  },
  {
    id: 'tool-label-object',
    tags: ['label', 'text', 'latex', 'annotation'],
    doc: `
Tool: label_object
Purpose: dodaje krótki podpis (plain lub LaTeX) do istniejącego obiektu.

Args:
{
  "objectId": "id-obiektu",
  "text": "F = ma",
  "mode": "latex",                 // "plain" lub "latex" (domyślnie "plain")
  "position": "top"                // "top" | "bottom" | "left" | "right" | "center"
}

Result:
Tworzy nowy BoardObject typu "text" lub "latex" umieszczony w wybranej pozycji
względem obiektu bazowego (z zachowaniem niewielkiego odstępu).
`,
  },
  {
    id: 'tool-set-style',
    tags: ['style', 'color', 'stroke', 'arrow', 'batch'],
    doc: `
Tool: set_style
Purpose: masowa zmiana stylu wielu obiektów naraz (grubość linii, kolor, strzałki, wypełnienie).

Args:
{
  "ids": ["id-1", "id-2", "id-3"],
  "props": {
    "lineWidth": 3,
    "lineStyle": "dotted",
    "color": "#ff0000",
    "fillColor": "#ffe0e0",
    "arrowStyle": "end"
  }
}

Result:
Dla każdego ID wykonuje update z podanymi właściwościami stylu (Partial<BoardObject>).
`,
  },
  {
    id: 'tool-delete-objects',
    tags: ['delete', 'remove', 'erase'],
    doc: `
Tool: delete_objects
Purpose: usuwa jeden lub wiele obiektów z tablicy po ID.

Args:
{
  "ids": ["id-1", "id-2"]
}

Result:
Logika BoardPatch ustawia "deletes" na te ID; odpowiada to realnemu usunięciu z dokumentu Yjs.
`,
  },
  {
    id: 'tool-draw-handstroke',
    tags: ['pen', 'handwriting', 'stroke', 'path'],
    doc: `
Tool: draw_handstroke
Purpose: rysuje odręczny stroke (jak marker/długopis). Model podaje tylko kilka punktów,
serwer zagęszcza i wygładza linię.

Args:
{
  "points": [
    { "x": 100, "y": 200 },
    { "x": 160, "y": 220 },
    { "x": 220, "y": 210 }
  ],
  "style": "teacher_marker",   // "teacher_marker" | "student_pen" | "sketch"
  "color": "#000000"
}

Result:
Tworzy BoardObject typu "pen" z:
- rawPoints = podane + lekkie jitterowanie,
- points = zagęszczone punkty po interpolacji,
- lineWidth/penStyle/penConfig dobranym do wybranego stylu.
`,
  },
  {
    id: 'tool-draw-patch-grid-example',
    tags: ['draw', 'grid', 'examples', 'alignment'],
    doc: `
Tool: draw_board_patch (grid-aligned example)
Purpose: Create three aligned circles in a vertical column, centered in the middle of the viewport.

All x, y, width, height are multiples of gridSize=8.

Example patch:
{
  "creates": [
    { "id": "snow-top",    "type": "circle", "x": 400, "y": 200, "width": 80, "height": 80, "color": "#000000" },
    { "id": "snow-middle", "type": "circle", "x": 400, "y": 280, "width": 120, "height": 120, "color": "#000000" },
    { "id": "snow-bottom", "type": "circle", "x": 400, "y": 400, "width": 160, "height": 160, "color": "#000000" }
  ]
}

Key points:
- Objects are vertically aligned (same x center)
- Sizes are grid-aligned (80, 120, 160)
- Positions are grid-aligned (200, 280, 400)
`,
  },
  {
    id: 'tool-distribute',
    tags: ['distribute', 'align', 'spacing', 'layout'],
    doc: `
Tools: distribute_horizontally / distribute_vertically
Purpose: równomierne rozłożenie obiektów poziomo lub pionowo.

Args:
{
  "ids": ["id-1", "id-2", "id-3"]
}

Notes:
- Wymaga minimum 3 obiektów.
- Pierwszy i ostatni obiekt (skrajne) pozostają na miejscu.
- Pozostałe obiekty są przesuwane tak, aby odstępy były równe.
`,
  },
  {
    id: 'tool-clone',
    tags: ['clone', 'duplicate', 'copy'],
    doc: `
Tool: clone_object
Purpose: duplikowanie istniejącego obiektu z opcjonalnym przesunięciem.

Args:
{
  "id": "id-źródła",
  "offsetX": 40,  // opcjonalne, domyślnie 40
  "offsetY": 40   // opcjonalne, domyślnie 40
}

Result:
Tworzy kopię obiektu z nowym ID, przesuniętą o (offsetX, offsetY).
Kopiuje też start/end dla linii oraz points dla ścieżek.
`,
  },
  {
    id: 'tool-move',
    tags: ['move', 'reposition', 'position'],
    doc: `
Tool: move_object
Purpose: przeniesienie pojedynczego obiektu (prostsze niż draw_board_patch).

Args:
{
  "id": "id-obiektu",
  "x": 100,       // pozycja absolutna X (opcjonalna)
  "y": 200,       // pozycja absolutna Y (opcjonalna)
  "deltaX": 50,   // przesunięcie względne X (opcjonalne)
  "deltaY": -20   // przesunięcie względne Y (opcjonalne)
}

Notes:
- Można użyć pozycji absolutnej (x, y) lub względnej (deltaX, deltaY).
- Jeśli obiekt ma start/end (linia), są one również przesuwane.
- Wszystkie współrzędne są automatycznie zaokrąglane do siatki.
`,
  },
  {
    id: 'spatial-awareness',
    tags: ['zone', 'spatial', 'center', 'nearby'],
    doc: `
Spatial Awareness (świadomość przestrzenna)

Każdy obiekt w boardContext ma:
- centerX, centerY: środek obiektu (współrzędne)
- zone: jedna z 9 stref viewportu:
  * top-left, top-center, top-right
  * middle-left, middle, middle-right
  * bottom-left, bottom-center, bottom-right
- nearbyIds: lista ID obiektów w promieniu 100px

Jak używać:
- zone pomaga określić gdzie umieścić nowe obiekty (np. "w lewym górnym rogu")
- centerX/centerY pomocne do wyrównywania (np. "ustaw środki w jednej linii")
- nearbyIds pokazuje które obiekty są blisko siebie (do łączenia strzałkami)
`,
  },
];

export function retrieveBoardDocs(query: string): string[] {
  const q = query.toLowerCase();
  // Proste dopasowanie po tagach / treści
  return BOARD_CAPABILITIES
    .filter(c =>
      c.tags.some(t => q.includes(t)) ||
      c.doc.toLowerCase().includes(q),
    )
    .map(c => c.doc);
}
