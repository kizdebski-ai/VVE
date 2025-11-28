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
                'Create or update board objects directly. Use ONLY when higher-level tools (connect_objects, label_object, set_style, draw_handstroke, etc.) are not sufficient.',
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
                                        'Unique ID, e.g. "ai-rect-1". If omitted, server will generate one.',
                                },
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
                                        'pen',
                                    ],
                                },
                                x: { type: 'number' },
                                y: { type: 'number' },
                                width: { type: 'number' },
                                height: { type: 'number' },
                                rotation: { type: 'number' },

                                text: { type: 'string' },
                                latex: { type: 'string' },

                                // Kolor / styl
                                color: {
                                    type: 'string',
                                    description: 'Stroke color (hex), e.g. "#000000".',
                                },
                                fillColor: {
                                    type: 'string',
                                    description: 'Fill color (hex).',
                                },
                                lineWidth: {
                                    type: 'number',
                                    description: 'Stroke width in px.',
                                },
                                lineStyle: {
                                    type: 'string',
                                    enum: ['solid', 'dashed', 'dotted'],
                                },
                                arrowStyle: {
                                    type: 'string',
                                    enum: ['none', 'start', 'end', 'both'],
                                },

                                // Dla linii / strzałek
                                start: {
                                    type: 'object',
                                    properties: {
                                        x: { type: 'number' },
                                        y: { type: 'number' },
                                    },
                                },
                                end: {
                                    type: 'object',
                                    properties: {
                                        x: { type: 'number' },
                                        y: { type: 'number' },
                                    },
                                },

                                // Dla pióra / ścieżek
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
                            },
                            // ID nie jest już wymagane – serwer potrafi je wygenerować.
                            required: ['type', 'x', 'y'],
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
];
