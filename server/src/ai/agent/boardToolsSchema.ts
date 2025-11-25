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
            description:
                'Given the ID of an equation/text object, return a simplified LaTeX string.',
            parameters: {
                type: 'object',
                properties: {
                    objectId: { type: 'string' },
                },
                required: ['objectId'],
            },
        },
    },
];
