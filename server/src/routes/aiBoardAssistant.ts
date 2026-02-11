// server/src/routes/aiBoardAssistant.ts
import { Router } from 'express';
import { BoardDoc } from '../yjs/boardDoc';
import { runBoardAgent } from '../ai/agent/boardAgent';
import { RoomManager } from '../rooms';
import { config } from '../config';
import { logger } from '../logger';
import { verifyBoardWsToken } from '../services/boardTokens';

export const createAiBoardAssistantRouter = (roomManager: RoomManager) => {
    const router = Router();

    router.post('/', async (req, res) => {
        if (!config.aiBoardAssistantEnabled) {
            res.status(503).json({ error: 'AI Board Assistant is disabled.' });
            return;
        }

        // P2-15: Verify board token – students are blocked from AI board assistant
        const boardToken = req.headers['x-board-token'] as string | undefined;
        if (boardToken) {
            const session = verifyBoardWsToken(boardToken);
            if (!session) {
                res.status(401).json({ error: 'Invalid or expired board token.' });
                return;
            }
            if (session.role === 'student') {
                res.status(403).json({ error: 'AI assistant is not available for students.' });
                return;
            }
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
