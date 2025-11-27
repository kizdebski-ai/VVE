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
    toolConnectObjects,
    toolLabelObject,
    toolSetStyle,
    toolDeleteObjects,
    toolDrawHandstroke,
} from '../tools/boardTools';
import { retrieveBoardDocs } from '../docs/boardCapabilities';
import { buildAgentBoardContext } from './boardAgentContext';

if (!llmClient) {
    console.warn('[AI] Board Assistant disabled – no LLM client configured');
}

type AgentResult = {
    reply: string;
    patch?: BoardPatch;
};

const SYSTEM_PROMPT = `
You are an AI Board Assistant for a math & diagram whiteboard.

You receive:
- a JSON snapshot of the board (objects with id, type, x, y, width, height, text/latex),
- optional viewport info,
- a user request.

GENERAL RULES
- Prefer using TOOLS instead of describing what you did.
- Prefer HIGH-LEVEL tools that operate on object ids and relations:
  * connect_objects  – to draw arrows/vectors between existing objects,
  * label_object     – to add text/LaTeX labels to objects,
  * set_style        – to change stroke width / dash / color / arrowStyle,
  * align_selection_to_grid – to clean up spacing,
  * plot_function, insert_latex_box etc. for math.

GEOMETRY
- Do NOT approximate straight lines with many small points; use line objects.
- For axes, vectors and connections always prefer connect_objects or line with arrowStyle.
- Assume grid size is 8px. When giving coordinates in draw_board_patch, keep them multiples of 8.
- When creating several similar shapes (e.g. wheels, snowman circles), align their centers or edges and then call align_selection_to_grid.

STATE
- Trust the JSON snapshot: if an id is not present there, it does not exist on the board.
- If you want to change an object, prefer updates via draw_board_patch or set_style instead of creating a new object in the same place.

MATH & LATEX
- For formulas, vector labels etc. use label_object with mode="latex" when attaching to existing objects.
- Use insert_latex_box only when you need a standalone equation block, not a small label.

HANDWRITING vs SHAPES
- Use draw_handstroke when:
  * the user explicitly asks for "odręczne" writing, underlines, curly braces etc.,
  * you add emphasis (underlining, circling, crossing out),
  * you draw quick sketch marks (ticks, corrections, small brackets).
- Use line / arrows / connect_objects when:
  * drawing axes, vectors, connectors between blocks,
  * suggesting precise geometric constructions,
  * any line that should be perfectly straight or symmetric.
- Use rectangles / circles / triangles etc. for geometric and diagram shapes, not pen strokes.

Respond to the user with a short explanation (1–3 sentences) and rely on tools for actual modifications.
CRITICAL: If you do not call a tool, NO changes will be made to the board. You MUST call a tool (like draw_board_patch) to draw or modify anything. Describing it in text is NOT enough.
`;

export async function runBoardAgent(params: {
    doc: BoardDoc;
    snapshot: BoardSnapshot;
    userMessage: string;
    viewport?: { x: number; y: number; width: number; height: number };
    image?: string;
    model?: string;
}): Promise<AgentResult> {
    if (!llmClient) {
        return { reply: 'Board assistant is not configured on the server.' };
    }

    const { doc, snapshot, userMessage, viewport, image, model } = params;
    const effectiveModel = model || BOARD_AI_MODEL;
    console.log(`[AI Agent] Using model: ${effectiveModel}`);

    // 🔥 LEKKI kontekst zamiast pełnego snapshotu
    const agentContext = buildAgentBoardContext(snapshot, viewport, 64);

    let userContent: any = JSON.stringify({
        boardContext: agentContext,
        request: userMessage,
    });

    if (image) {
        userContent = [
            {
                type: 'text',
                text: JSON.stringify({
                    boardContext: agentContext,
                    request: userMessage,
                    note: 'The image shows the visual board. Use it mainly to read handwriting or check spatial relationships that are not obvious from the JSON context.',
                }),
            },
            {
                type: 'image_url',
                image_url: { url: image },
            },
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
            model: effectiveModel,
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
            console.log(`[AI Agent] Tool Call: ${name}`, JSON.stringify(args).substring(0, 200));
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
                        model: effectiveModel,
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
                        model: effectiveModel,
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
                        model: effectiveModel,
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

            case 'connect_objects': {
                const patch = toolConnectObjects(doc, snapshot, args);
                lastPatch = patch;
                toolMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ status: 'ok', patch }),
                });
                break;
            }

            case 'label_object': {
                const patch = toolLabelObject(doc, snapshot, args);
                lastPatch = patch;
                toolMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ status: 'ok', patch }),
                });
                break;
            }

            case 'set_style': {
                const patch = toolSetStyle(doc, snapshot, args);
                lastPatch = patch;
                toolMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ status: 'ok', patch }),
                });
                break;
            }

            case 'delete_objects': {
                const patch = toolDeleteObjects(doc, snapshot, args);
                lastPatch = patch;
                toolMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ status: 'ok', patch }),
                });
                break;
            }

            case 'draw_handstroke': {
                const patch = toolDrawHandstroke(doc, snapshot, args);
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
            model: effectiveModel,
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
