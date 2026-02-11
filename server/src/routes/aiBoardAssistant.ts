// server/src/routes/aiBoardAssistant.ts
import { Router } from 'express';
import { BoardDoc } from '../yjs/boardDoc';
import { runBoardAgent } from '../ai/agent/boardAgent';
import { RoomManager } from '../rooms';
import { config } from '../config';
import { logger } from '../logger';

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

            logger.info('[AI Route] Received request', {
                boardId,
                msgLen: message?.length ?? 0,
                hasImage: !!image,
                hasViewport: !!viewport,
                model: model ?? 'default',
            });

            const { room } = await roomManager.get(boardId);

            if (!room || !room.doc) {
                res.status(404).json({ error: 'Board not found' });
                return;
            }

            const doc = new BoardDoc(room.doc);
            const snapshot = doc.getSnapshot();
            logger.debug('[AI Route] Snapshot before', { objects: snapshot.objects.length });

            const result = await runBoardAgent({
                doc,
                snapshot,
                userMessage: message,
                ...(viewport && { viewport }),
                ...(image && { image }),
                ...(model && { model }),
            });

            const snapshotAfter = doc.getSnapshot();
            logger.debug('[AI Route] Snapshot after', { objects: snapshotAfter.objects.length });

            logger.info('[AI Route] Patch result', {
                creates: result.patch?.creates?.length ?? 0,
                updates: result.patch?.updates?.length ?? 0,
                deletes: result.patch?.deletes?.length ?? 0,
            });

            res.json(result);
        } catch (err) {
            logger.error('[AI] Board assistant error', { error: (err as Error).message });
            res.status(500).json({ error: 'Board assistant failed' });
        }
    });

    return router;
};
