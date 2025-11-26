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
            description: 'Create or update board objects directly using a JSON patch. Use this for general drawing.',
            parameters: {
                type: 'object',
                properties: {
                    patch: {
                        type: 'object',
                        description: 'BoardPatch object with "creates" and/or "updates".',
                        properties: {
                            creates: { type: 'array', items: { type: 'object' } },
                            updates: { type: 'array', items: { type: 'object' } }
                        }
                    },
                },
                required: ['patch'],
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
                    latex: { type: 'string', description: 'The LaTeX code to render.' },
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
