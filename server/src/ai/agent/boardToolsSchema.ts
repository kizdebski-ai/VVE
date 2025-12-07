import type { ChatCompletionTool } from 'openai/resources/chat/completions';

export const boardToolsSchema: ChatCompletionTool[] = [
    {
        type: 'function',
        function: {
            name: 'align_selection_to_grid',
            description:
                'Align selected board objects to the nearest grid lines. Works for shapes and handwriting paths.',
            parameters: {
                type: 'object',
                properties: {
                    gridSize: {
                        type: 'number',
                        description: 'Grid spacing in pixels, e.g. 16.',
                    },
                    selectionIds: {
                        type: 'array',
                        items: { type: 'string' },
                        description:
                            'Optional: IDs of objects to align. If omitted, use objects marked as selected=true.',
                    },
                },
                required: ['gridSize'],
            },
        },
    },

    // UWAGA: generate_diagram_from_prompt celowo usunięte z listy tools,
    // żeby nie odpalać drugiego calla do LLM.

    {
        type: 'function',
        function: {
            name: 'simplify_equation_block',
            description:
                'Take a raw text block (e.g. handwriting OCR) and replace it with a simplified LaTeX version.',
            parameters: {
                type: 'object',
                properties: {
                    objectId: {
                        type: 'string',
                        description: 'The ID of the object containing the raw equation text.',
                    },
                },
                required: ['objectId'],
            },
        },
    },

    {
        type: 'function',
        function: {
            name: 'draw_board_patch',
            description:
                'Create, update or delete board objects. Use this to draw new shapes (circles, rectangles, triangles, lines, etc.). IMPORTANT: Every shape MUST have type, x, y, width, height, and color properties.',
            parameters: {
                type: 'object',
                properties: {
                    creates: {
                        type: 'array',
                        description: 'Array of new objects to create on the board.',
                        items: {
                            type: 'object',
                            description: 'A board object to create. Remember: Y increases DOWNWARD (y=100 is above y=300).',
                            properties: {
                                id: {
                                    type: 'string',
                                    description:
                                        'Unique ID, e.g. "ai-circle-1". If omitted, server will generate one.',
                                },
                                type: {
                                    type: 'string',
                                    enum: [
                                        'rectangle',
                                        'circle',
                                        'line',
                                        'text',
                                        'latex',
                                        'triangle',
                                        'diamond',
                                        'square',
                                    ],
                                    description: 'Shape type. Use "circle" for circles/ellipses, "rectangle" for rectangles, "line" for straight lines/arrows.',
                                },
                                x: {
                                    type: 'number',
                                    description: 'LEFT edge X coordinate. Board origin (0,0) is top-left. X increases rightward.',
                                },
                                y: {
                                    type: 'number',
                                    description: 'TOP edge Y coordinate. Y increases DOWNWARD (y=100 is visually ABOVE y=300).',
                                },
                                width: {
                                    type: 'number',
                                    description: 'Horizontal size in pixels. Minimum 20 for visibility. Common values: 40 (small), 80 (medium), 120 (large).',
                                },
                                height: {
                                    type: 'number',
                                    description: 'Vertical size in pixels. Minimum 20 for visibility. For circles, use same value as width.',
                                },
                                color: {
                                    type: 'string',
                                    description: 'Stroke color as hex string. REQUIRED for visibility. Use "#000000" for black, "#ff0000" for red, etc.',
                                },
                                rotation: {
                                    type: 'number',
                                    description: 'Rotation angle in degrees (optional).',
                                },

                                text: { type: 'string', description: 'Text content for type="text".' },
                                latex: { type: 'string', description: 'LaTeX content for type="latex".' },

                                fillColor: {
                                    type: 'string',
                                    description: 'Fill color (hex). Use "#FFFFFF" for white fill (e.g., snowman body), "#ADD8E6" for light blue.',
                                },
                                lineWidth: {
                                    type: 'number',
                                    description: 'Stroke width in px. Default 2. Use 1-4 for thin lines, 4-8 for thick.',
                                },
                                lineStyle: {
                                    type: 'string',
                                    enum: ['solid', 'dashed', 'dotted'],
                                },
                                arrowStyle: {
                                    type: 'string',
                                    enum: ['none', 'start', 'end', 'both'],
                                    description: 'For type="line". Use "end" for arrow pointing to end, "both" for double arrow.',
                                },

                                // Dla linii / strzałek
                                start: {
                                    type: 'object',
                                    description: 'Starting point for lines. Alternative to x/y/width/height.',
                                    properties: {
                                        x: { type: 'number' },
                                        y: { type: 'number' },
                                    },
                                },
                                end: {
                                    type: 'object',
                                    description: 'Ending point for lines.',
                                    properties: {
                                        x: { type: 'number' },
                                        y: { type: 'number' },
                                    },
                                },

                                // Dla pióra / ścieżek
                                points: {
                                    type: 'array',
                                    description: 'Array of points for type="pen". Usually not needed.',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            x: { type: 'number' },
                                            y: { type: 'number' },
                                        },
                                    },
                                },
                            },
                            // Require the essential fields for visibility
                            required: ['type', 'x', 'y', 'width', 'height', 'color'],
                            additionalProperties: true,
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
                                        'Properties to update (x, y, width, height, style, text, latex, ...).',
                                    additionalProperties: true,
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
                additionalProperties: false,
            },
        },
    },

    {
        type: 'function',
        function: {
            name: 'connect_objects',
            description:
                'Draw an arrow (vector) from one existing object to another using their bounding-box centers.',
            parameters: {
                type: 'object',
                properties: {
                    fromId: { type: 'string', description: 'Source object id.' },
                    toId: { type: 'string', description: 'Target object id.' },
                    style: {
                        type: 'object',
                        description: 'Optional style overrides.',
                        properties: {
                            lineWidth: {
                                type: 'number',
                                description: 'Stroke width in px (1–8).',
                            },
                            lineStyle: {
                                type: 'string',
                                enum: ['solid', 'dashed', 'dotted'],
                            },
                            arrowHead: {
                                type: 'string',
                                enum: ['end', 'both'],
                                description: 'Arrowhead direction (default "end").',
                            },
                            color: {
                                type: 'string',
                                description: 'Stroke color hex, e.g. "#000000".',
                            },
                        },
                        additionalProperties: false,
                    },
                },
                required: ['fromId', 'toId'],
                additionalProperties: false,
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
                        description:
                            'Label content. For LaTeX do NOT add $ or \\( \\).',
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
                additionalProperties: false,
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
                        description:
                            'Style props to apply to all given ids. Non-style fields are allowed but discouraged.',
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
                        additionalProperties: true,
                    },
                },
                required: ['ids', 'props'],
                additionalProperties: false,
            },
        },
    },

    {
        type: 'function',
        function: {
            name: 'delete_objects',
            description:
                'Delete one or more objects from the board by their ids.',
            parameters: {
                type: 'object',
                properties: {
                    ids: {
                        type: 'array',
                        items: { type: 'string' },
                    },
                },
                required: ['ids'],
                additionalProperties: false,
            },
        },
    },

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
                            '2–8 key points of the stroke in board coordinates. Server will interpolate and smooth.',
                        items: {
                            type: 'object',
                            properties: {
                                x: { type: 'number' },
                                y: { type: 'number' },
                            },
                            required: ['x', 'y'],
                            additionalProperties: false,
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
                        description:
                            'Stroke color (hex). Default: current board color.',
                    },
                },
                required: ['points'],
                additionalProperties: false,
            },
        },
    },

    {
        type: 'function',
        function: {
            name: 'insert_latex_box',
            description:
                'Insert a new LaTeX equation block at a specific position.',
            parameters: {
                type: 'object',
                properties: {
                    latex: {
                        type: 'string',
                        description:
                            'The LaTeX code to render. Do NOT include delimiters like $ or \\(.',
                    },
                    x: { type: 'number' },
                    y: { type: 'number' },
                    width: { type: 'number' },
                    height: { type: 'number' },
                },
                required: ['latex'],
                additionalProperties: false,
            },
        },
    },

    {
        type: 'function',
        function: {
            name: 'text_block_to_latex',
            description:
                'Convert an existing text object into a rendered LaTeX block.',
            parameters: {
                type: 'object',
                properties: {
                    objectId: {
                        type: 'string',
                        description: 'ID of the text object to convert.',
                    },
                },
                required: ['objectId'],
                additionalProperties: false,
            },
        },
    },

    {
        type: 'function',
        function: {
            name: 'plot_function',
            description: 'Create a function plot (graph) on the board.',
            parameters: {
                type: 'object',
                properties: {
                    expression: {
                        type: 'string',
                        description:
                            'Math expression of x, e.g. "sin(x)" or "x^2".',
                    },
                    xMin: {
                        type: 'number',
                        description: 'Domain start (default -10).',
                    },
                    xMax: {
                        type: 'number',
                        description: 'Domain end (default 10).',
                    },
                    x: {
                        type: 'number',
                        description: 'Position X of the plot (optional).',
                    },
                    y: {
                        type: 'number',
                        description: 'Position Y of the plot (optional).',
                    },
                },
                required: ['expression'],
                additionalProperties: false,
            },
        },
    },

    // ---------- New High-Level Tools ----------

    {
        type: 'function',
        function: {
            name: 'distribute_horizontally',
            description:
                'Evenly distribute selected objects horizontally. Requires at least 3 object IDs. Objects at the leftmost and rightmost positions are anchored.',
            parameters: {
                type: 'object',
                properties: {
                    ids: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'IDs of the objects to distribute (minimum 3).',
                        minItems: 3,
                    },
                },
                required: ['ids'],
                additionalProperties: false,
            },
        },
    },

    {
        type: 'function',
        function: {
            name: 'distribute_vertically',
            description:
                'Evenly distribute selected objects vertically. Requires at least 3 object IDs. Objects at the topmost and bottommost positions are anchored.',
            parameters: {
                type: 'object',
                properties: {
                    ids: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'IDs of the objects to distribute (minimum 3).',
                        minItems: 3,
                    },
                },
                required: ['ids'],
                additionalProperties: false,
            },
        },
    },

    {
        type: 'function',
        function: {
            name: 'clone_object',
            description:
                'Duplicate an existing object with an optional offset. Useful for creating copies instead of drawing new shapes from scratch.',
            parameters: {
                type: 'object',
                properties: {
                    id: {
                        type: 'string',
                        description: 'ID of the object to clone.',
                    },
                    offsetX: {
                        type: 'number',
                        description: 'Horizontal offset from original (default 40px).',
                    },
                    offsetY: {
                        type: 'number',
                        description: 'Vertical offset from original (default 40px).',
                    },
                },
                required: ['id'],
                additionalProperties: false,
            },
        },
    },

    {
        type: 'function',
        function: {
            name: 'move_object',
            description:
                'Move a single object to a new position. Simpler than draw_board_patch for moving one object. Supports absolute (x, y) or relative (deltaX, deltaY) positioning.',
            parameters: {
                type: 'object',
                properties: {
                    id: {
                        type: 'string',
                        description: 'ID of the object to move.',
                    },
                    x: {
                        type: 'number',
                        description: 'New absolute X position (optional).',
                    },
                    y: {
                        type: 'number',
                        description: 'New absolute Y position (optional).',
                    },
                    deltaX: {
                        type: 'number',
                        description: 'Move by this amount in X direction (optional).',
                    },
                    deltaY: {
                        type: 'number',
                        description: 'Move by this amount in Y direction (optional).',
                    },
                },
                required: ['id'],
                additionalProperties: false,
            },
        },
    },
];
