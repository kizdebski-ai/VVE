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
    {
        type: 'function',
        function: {
            name: 'insert_latex_box',
            description: 'Insert a new LaTeX equation block at a specific position.',
            parameters: {
                type: 'object',
                properties: {
                    latex: { type: 'string', description: 'The LaTeX code to render. Do NOT include delimiters like $ or \\(.' },
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
