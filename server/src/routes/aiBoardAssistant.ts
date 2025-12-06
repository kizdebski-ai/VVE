// server/src/routes/aiBoardAssistant.ts
import { Router } from 'express';
import { BoardDoc } from '../yjs/boardDoc';
import { runBoardAgent } from '../ai/agent/boardAgent';
import { RoomManager } from '../rooms';
import { config } from '../config';

export const createAiBoardAssistantRouter = (roomManager: RoomManager) => {
    const router = Router();

    router.post('/', async (req, res) => {
        if (!config.aiBoardAssistantEnabled) {
            res.status(503).json({ error: 'AI Board Assistant is disabled.' });
            return;
        }

        try {
            const { boardId, message, viewport, image, model } = req.body as {
                boardId: string;
                message: string;
                viewport?: { x: number; y: number; width: number; height: number };
                image?: string;
                model?: string;
            };

            console.log(
                `[AI Route] Received request.`,
                `boardId=${boardId}`,
                `msgLen=${message?.length ?? 0}`,
                `image=${!!image}`,
                `viewport=${viewport ? 'yes' : 'no'}`,
                `model=${model ?? 'default'}`,
            );

            // Lazily get/create room & doc from RoomManager
            const { room } = await roomManager.get(boardId);
            console.log(
                `[AI Route] Room lookup: room=${!!room}, doc=${!!room?.doc}`,
            );

            if (!room || !room.doc) {
                res.status(404).json({ error: 'Board not found' });
                return;
            }

            const doc = new BoardDoc(room.doc);

            // Jeden snapshot „przed” – ten sam przekazujemy do agenta jako stan wejściowy
            const snapshot = doc.getSnapshot();
            console.log(
                `[AI Route] Snapshot before: ${snapshot.objects.length} objects`,
            );

            const result = await runBoardAgent({
                doc,
                snapshot,
                userMessage: message,
                ...(viewport && { viewport }),
                ...(image && { image }),
                ...(model && { model }),
            });

            const snapshotAfter = doc.getSnapshot();
            console.log(
                `[AI Route] Snapshot after: ${snapshotAfter.objects.length} objects`,
            );

            console.log(
                `[AI Route] Patch result:`,
                JSON.stringify(
                    {
                        creates: result.patch?.creates?.length ?? 0,
                        updates: result.patch?.updates?.length ?? 0,
                        deletes: result.patch?.deletes?.length ?? 0,
                        replyPreview: result.reply?.substring(0, 100) ?? '',
                    },
                    null,
                    2,
                ),
            );

            res.json(result);
        } catch (err) {
            console.error('[AI] Board assistant error', err);
            res.status(500).json({ error: 'Board assistant failed' });
        }
    });

    return router;
};
