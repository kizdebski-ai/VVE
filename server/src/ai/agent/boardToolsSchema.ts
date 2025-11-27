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
    {
        type: 'function',
        function: {
            name: 'generate_diagram_from_prompt',
            description:
                'Generate simple block diagram / flowchart for the given prompt. Returns new nodes in board format.',
            parameters: {
                type: 'object',
                properties: {
                    prompt: { type: 'string' },
                    centerX: { type: 'number', description: 'Center X of generated diagram.' },
                    centerY: { type: 'number', description: 'Center Y of generated diagram.' },
                },
                required: ['prompt'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'simplify_equation_block',
            description: 'Take a raw text block (e.g. handwriting OCR) and replace it with a simplified LaTeX version.',
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
                                        'pen',
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
                    toId: { type: 'string', description: 'Target object id' },
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
    },
    {
        type: 'function',
        function: {
            name: 'insert_latex_box',
            description: 'Insert a new LaTeX equation block at a specific position.',
            parameters: {
                type: 'object',
                properties: {
                    latex: {
                        type: 'string',
                        description: 'The LaTeX code to render. Do NOT include delimiters like $ or \\(.',
                    },
                    x: { type: 'number' },
                    y: { type: 'number' },
                    width: { type: 'number' },
                    height: { type: 'number' },
                },
                required: ['latex'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'text_block_to_latex',
            description: 'Convert an existing text object into a rendered LaTeX block.',
            parameters: {
                type: 'object',
                properties: {
                    objectId: { type: 'string', description: 'ID of the text object to convert.' },
                },
                required: ['objectId'],
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
                    expression: { type: 'string', description: 'Math expression of x, e.g. "sin(x)" or "x^2".' },
                    xMin: { type: 'number', description: 'Domain start (default -10).' },
                    xMax: { type: 'number', description: 'Domain end (default 10).' },
                    x: { type: 'number', description: 'Position X.' },
                    y: { type: 'number', description: 'Position Y.' },
                },
                required: ['expression'],
            },
        },
    },
];
