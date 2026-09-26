import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createBoardAccessRouter } from '../src/routes/boardAccess';

describe('board access lifecycle race', () => {
  it('denies an ended lifecycle view instead of issuing a websocket token', async () => {
    const access = {
      decide: vi.fn(async () => ({
        granted: true as const,
        action: 'board.read' as const,
        role: 'student' as const,
        teacherId: 'teacher-1',
        boardId: 'board-1',
        credentialVersion: 1,
        validUntil: null
      }))
    };
    const lifecycle = {
      view: vi.fn(async () => ({
        kind: 'boardEntry' as const,
        board: {
          boardId: 'board-1',
          kind: 'managed' as const,
          title: 'Lesson',
          studentLabel: 'Internal label',
          validUntil: null,
          state: 'ended' as const
        }
      }))
    };
    const app = express();
    app.use(createBoardAccessRouter(access as any, lifecycle as any));

    const response = await request(app).get('/board/lesson?token=student-token');

    expect(response.status).toBe(401);
    expect(response.body.reason).toBe('revoked');
    expect(response.body).not.toHaveProperty('wsToken');
    expect(access.decide).toHaveBeenCalledTimes(1);
  });
});
