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
            const { boardId, message, viewport, image } = req.body as {
                boardId: string;
                message: string;
                viewport?: { x: number; y: number; width: number; height: number };
                image?: string;
            };

            // Get the room/doc from RoomManager
            // We use get() which lazily loads or creates. 
            // Ideally we should check if it exists first, but get() is safe.
            const { room } = roomManager.get(boardId);
            console.log(`[AI Route] Request for boardId: ${boardId}. Room exists: ${!!room}, Doc exists: ${!!room?.doc}`);

            if (!room || !room.doc) {
                res.status(404).json({ error: 'Board not found' });
                return;
            }

            const doc = new BoardDoc(room.doc);
            const snapshotBefore = doc.getSnapshot();
            console.log(`[AI Route] Snapshot before: ${snapshotBefore.objects.length} objects`);

            // Optimization: We could filter the snapshot here based on viewport to save tokens
            const snapshot = doc.getSnapshot();

            const result = await runBoardAgent({
                doc,
                snapshot,
                userMessage: message,
                ...(viewport && { viewport }),
                ...(image && { image }),
            });

            const snapshotAfter = doc.getSnapshot();
            console.log(`[AI Route] Snapshot after: ${snapshotAfter.objects.length} objects`);

            res.json(result);
        } catch (err) {
            console.error('[AI] Board assistant error', err);
            res.status(500).json({ error: 'Board assistant failed' });
        }
    });

    return router;
};
