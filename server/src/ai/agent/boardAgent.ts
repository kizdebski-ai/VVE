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
    toolDrawBoardPatch,
    toolInsertLatexBox,
    toolTextBlockToLatexUpdate,
    toolPlotFunction,
} from '../tools/boardTools';
import { retrieveBoardDocs } from '../docs/boardCapabilities';

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

Prefer using tools to modify the board (align to grid, generate diagrams, clean equations, plot functions).
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

    // RAG: Retrieve relevant docs
    const docs = retrieveBoardDocs(userMessage);

    const baseMessages: ChatCompletionMessageParam[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...(docs.length
            ? [
                {
                    role: 'system',
                    content:
                        'Board JSON schema and tools (documentation):\n\n' + docs.join('\n\n'),
                } as ChatCompletionMessageParam,
            ]
            : []),
        {
            role: 'user',
            content: userContent,
        },
    ];

    // 1) First call - model decides on tool_calls
    let first;
    try {
        first = await llmClient.chat.completions.create({
            model: BOARD_AI_MODEL,
            temperature: 0.1,
            messages: baseMessages,
            tools: boardToolsSchema as ChatCompletionTool[],
            tool_choice: 'auto',
        });
    } catch (error) {
        console.error('[AI] Error calling AI model:', error);
        return {
            reply: `Failed to connect to AI service. ${error instanceof Error ? error.message : 'Unknown error'}`
        };
    }

    if (!first.choices || first.choices.length === 0) {
        console.error('[AI] No choices in response:', JSON.stringify(first, null, 2));
        return { reply: 'No response from AI model. Please try again.' };
    }

    const firstMsg = first.choices[0]!.message;

    if (!firstMsg) {
        console.error('[AI] No message in first choice:', JSON.stringify(first.choices[0], null, 2));
        return { reply: 'AI model returned an invalid response. Please try again.' };
    }

    // Validate that the message has either content or tool_calls
    const hasContent = firstMsg.content && firstMsg.content.trim().length > 0;
    const hasToolCalls = firstMsg.tool_calls && firstMsg.tool_calls.length > 0;

    if (!hasContent && !hasToolCalls) {
        console.error('[AI] Empty response from model:', {
            model: BOARD_AI_MODEL,
            message: firstMsg,
            finish_reason: first.choices[0]?.finish_reason,
        });
        return { reply: 'AI model returned an empty response. This may be a temporary issue with the AI service. Please try again.' };
    }

    // If no tool_calls - just return text
    if (!hasToolCalls) {
        return { reply: firstMsg.content ?? '' };
    }

    const toolMessages: ChatCompletionMessageParam[] = [];
    let lastPatch: BoardPatch | undefined;

    // 2) Execute tools on server side
    // At this point, we know hasToolCalls is true, so tool_calls is defined
    for (const toolCall of firstMsg.tool_calls!) {
        // Type guard: ensure toolCall has a 'function' property
        if (!('function' in toolCall) || !toolCall.function) {
            console.warn('[AI] Skipping tool call without function property:', toolCall);
            continue;
        }

        const { name, arguments: rawArgs } = toolCall.function;
        let args;
        try {
            args = JSON.parse(rawArgs || '{}');
        } catch (e) {
            console.error('[AI] Failed to parse tool arguments:', e);
            toolMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify({ status: 'error', message: 'Invalid JSON arguments' }),
            });
            continue;
        }

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
                let nodes: BoardObject[] = [];
                try {
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
                    // Attempt to parse JSON, handling potential markdown code blocks
                    const jsonText = raw.replace(/```json\n?|\n?```/g, '').trim();
                    nodes = JSON.parse(jsonText);
                } catch (e) {
                    console.error('[AI] Failed to generate/parse diagram nodes', e);
                    toolMessages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: JSON.stringify({ status: 'error', message: 'Failed to generate diagram' }),
                    });
                    break;
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
                let latex = original;

                try {
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
                    latex = simp.choices[0]?.message.content ?? original;
                } catch (e) {
                    console.error('[AI] Error simplifying equation:', e);
                    toolMessages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: JSON.stringify({ status: 'error', message: 'Failed to simplify equation' }),
                    });
                    break;
                }
                const patch = toolSimplifyEquationBlock(doc, snapshot, args, latex);
                lastPatch = patch;

                toolMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ status: 'ok', patch }),
                });
                break;
            }

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

            case 'insert_latex_box': {
                const patch = toolInsertLatexBox(doc, snapshot, args);
                lastPatch = patch;
                toolMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ status: 'ok', patch }),
                });
                break;
            }

            case 'text_block_to_latex': {
                const block = snapshot.objects.find(o => o.id === args.objectId);
                const original = block?.text ?? '';
                let latex = original;

                try {
                    const simp = await llmClient.chat.completions.create({
                        model: BOARD_AI_MODEL,
                        temperature: 0.0,
                        messages: [
                            {
                                role: 'system',
                                content:
                                    'Convert the following math text to pure LaTeX (inline or display). Output ONLY LaTeX, no commentary.',
                            },
                            { role: 'user', content: original },
                        ],
                    });
                    latex = simp.choices[0]?.message.content ?? original;
                } catch (e) {
                    console.error('[AI] Error converting text to latex:', e);
                    toolMessages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: JSON.stringify({ status: 'error', message: 'Failed to convert text to latex' }),
                    });
                    break;
                }

                const patch = toolTextBlockToLatexUpdate(doc, snapshot, args, latex);
                lastPatch = patch;

                toolMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ status: 'ok', patch }),
                });
                break;
            }

            case 'plot_function': {
                const patch = toolPlotFunction(doc, snapshot, args);
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
    let second;
    try {
        second = await llmClient.chat.completions.create({
            model: BOARD_AI_MODEL,
            temperature: 0.2,
            messages: [
                ...baseMessages,
                firstMsg,
                ...toolMessages,
            ],
        });
    } catch (error) {
        console.error('[AI] Error in second AI model call:', error);
        return { reply: 'Failed to generate final response from AI service.', ...(lastPatch && { patch: lastPatch }) };
    }

    if (!second.choices || second.choices.length === 0) {
        return { reply: 'AI model returned no final response.', ...(lastPatch && { patch: lastPatch }) };
    }

    const reply = second.choices[0]?.message?.content ?? '';
    return { reply, ...(lastPatch && { patch: lastPatch }) };
}
