import type {
    ChatCompletionMessageParam,
    ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { llmClient, BOARD_AI_MODEL } from '../provider/llmClient';
import { BoardDoc } from '../../yjs/boardDoc';
import { BoardSnapshot, BoardPatch, BoardObject } from '../../models/boardSnapshot';
import { boardToolsSchema } from './boardToolsSchema';
import {
    toolAlignSelectionToGrid,
    toolGenerateDiagramFromPrompt,
    toolSimplifyEquationBlock,
} from '../tools/boardTools';

if (!llmClient) {
    console.warn('[AI] Board Assistant disabled – no LLM client configured');
}

type AgentResult = {
    reply: string;
    patch?: BoardPatch;
};

const SYSTEM_PROMPT = `
You are an "AI Board Assistant" for a collaborative math & diagram whiteboard.
You receive:
- a JSON snapshot of the board
- optional viewport info
- a user request

Prefer using tools to modify the board (align to grid, generate diagrams, clean equations).
Return clear, short explanations for the user.
When generating diagrams, create nodes as BoardObject[] with ids like "ai-node-<n>".
`;

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

    let userContent: any = JSON.stringify({
        board: snapshot,
        viewport,
        request: userMessage,
    });

    if (image) {
        userContent = [
            {
                type: 'text',
                text: JSON.stringify({
                    board: snapshot,
                    viewport,
                    request: userMessage,
                    note: "The image shows the visual representation of the board. Use it to read handwriting or understand spatial context that might be missing in the JSON snapshot."
                }),
            },
            {
                type: 'image_url',
                image_url: { url: image }
            }
        ];
    }

    const baseMessages: ChatCompletionMessageParam[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
            role: 'user',
            content: userContent,
        },
    ];

    // 1) First call - model decides on tool_calls
    const first = await llmClient.chat.completions.create({
        model: BOARD_AI_MODEL,
        temperature: 0.1,
        messages: baseMessages,
        tools: boardToolsSchema as ChatCompletionTool[],
        tool_choice: 'auto',
    });

    const firstMsg = first.choices[0].message;

    // If no tool_calls - just return text
    if (!firstMsg.tool_calls || firstMsg.tool_calls.length === 0) {
        return { reply: firstMsg.content ?? '' };
    }

    const toolMessages: ChatCompletionMessageParam[] = [];
    let lastPatch: BoardPatch | undefined;

    // 2) Execute tools on server side
    for (const toolCall of firstMsg.tool_calls) {
        const { name, arguments: rawArgs } = toolCall.function;
        const args = JSON.parse(rawArgs || '{}');

        switch (name) {
            case 'align_selection_to_grid': {
                const patch = toolAlignSelectionToGrid(doc, snapshot, args);
                lastPatch = patch;
                toolMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ status: 'ok', patch }),
                });
                break;
            }

            case 'generate_diagram_from_prompt': {
                // Second "mini" call just to turn prompt into BoardObject[]
                const gen = await llmClient.chat.completions.create({
                    model: BOARD_AI_MODEL,
                    temperature: 0.3,
                    messages: [
                        {
                            role: 'system',
                            content:
                                'You generate JSON arrays of BoardObject for a whiteboard. Respond with pure JSON.',
                        },
                        {
                            role: 'user',
                            content: JSON.stringify({
                                prompt: args.prompt,
                                centerX: args.centerX,
                                centerY: args.centerY,
                            }),
                        },
                    ],
                });

                const raw = gen.choices[0]?.message.content ?? '[]';
                let nodes: BoardObject[] = [];
                try {
                    // Attempt to parse JSON, handling potential markdown code blocks
                    const jsonText = raw.replace(/```json\n?|\n?```/g, '').trim();
                    nodes = JSON.parse(jsonText);
                } catch (e) {
                    console.error('[AI] Failed to parse generated nodes', e, raw);
                }

                const patch = toolGenerateDiagramFromPrompt(doc, snapshot, args, nodes);
                lastPatch = patch;

                toolMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ status: 'ok', patch }),
                });
                break;
            }

            case 'simplify_equation_block': {
                // Small call to simplify LaTeX
                const equation = snapshot.objects.find(o => o.id === args.objectId);
                const original = equation?.text ?? '';

                const simp = await llmClient.chat.completions.create({
                    model: BOARD_AI_MODEL,
                    temperature: 0.0,
                    messages: [
                        {
                            role: 'system',
                            content:
                                'You simplify math expressions and output LaTeX only, without commentary.',
                        },
                        {
                            role: 'user',
                            content: original,
                        },
                    ],
                });

                const latex = simp.choices[0].message.content ?? original;
                const patch = toolSimplifyEquationBlock(doc, snapshot, args, latex);
                lastPatch = patch;

                toolMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ status: 'ok', patch }),
                });
                break;
            }

            default:
                toolMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ status: 'error', message: 'Unknown tool' }),
                });
        }
    }

    // 3) Second call - model sees tool results and returns text for user
    const second = await llmClient.chat.completions.create({
        model: BOARD_AI_MODEL,
        temperature: 0.2,
        messages: [
            ...baseMessages,
            firstMsg,
            ...toolMessages,
        ],
    });

    const reply = second.choices[0].message.content ?? '';
    return { reply, patch: lastPatch };
}
