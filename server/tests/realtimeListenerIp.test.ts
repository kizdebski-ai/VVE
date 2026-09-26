import WebSocket from 'ws';
import { describe, expect, it } from 'vitest';

import { createCollaborationRuntime, InMemoryBoardDocumentStore } from '../src/pilot/collaborationRuntime';
import { createOperationalSignals } from '../src/pilot/operationalSignals';
import { createRealtimeListener } from '../src/pilot/realtimeListener';
import { createResourceGovernor } from '../src/pilot/resourceGovernor';
import { createResourceLimits } from '../src/pilot/resourceLimits';
import type { CapabilityAccess } from '../src/pilot/capabilityAccess';
import type { BoardLifecycle } from '../src/pilot/boardLifecycle';
import type { EquationSolver } from '../src/services/aiSolver';
import type { RoomManager } from '../src/rooms';

const BOARD_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

const access = {
  decide: async (input: { target?: { boardId?: string | null } }) => ({
    granted: true as const,
    action: 'board.edit' as const,
    role: 'teacher' as const,
    teacherId: 'teacher-1',
    boardId: input.target?.boardId ?? null,
    credentialVersion: 1,
    validUntil: null
  })
} as unknown as CapabilityAccess;

const lifecycle = { stopDeletionSweep: () => undefined } as unknown as BoardLifecycle;
const roomManager = { closeRoomSockets: () => undefined } as unknown as RoomManager;
const solver = {} as unknown as EquationSolver;

const waitForSync = (socket: WebSocket): Promise<void> => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('socket did not synchronize')), 2_000);
  socket.on('message', (raw) => {
    if (Buffer.from(raw as Buffer)[0] !== 14) return;
    clearTimeout(timer);
    resolve();
  });
  socket.on('error', reject);
});

const waitForClose = (socket: WebSocket): Promise<number> => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('socket did not close')), 2_000);
  socket.on('close', (code) => {
    clearTimeout(timer);
    resolve(code);
  });
  socket.on('error', reject);
});

describe('RealtimeListener client identity', () => {
  it('applies one per-IP limit despite different spoofed forwarded headers', async () => {
    const listener = createRealtimeListener({
      roomManager,
      aiSolver: solver,
      capabilityAccess: access,
      boardLifecycle: lifecycle,
      collaborationRuntime: createCollaborationRuntime({
        store: new InMemoryBoardDocumentStore(),
        signals: createOperationalSignals({ emitJson: false })
      }),
      signals: createOperationalSignals({ emitJson: false }),
      health: {
        live: () => true,
        ready: () => true,
        checks: () => ({ database: true, persistence: true }),
        snapshot: () => createOperationalSignals({ emitJson: false }).snapshot()
      },
      admitting: () => true,
      environment: 'pilot',
      devSurface: false,
      resourceGovernor: createResourceGovernor({
        limits: createResourceLimits({
          maxConnectionsPerIp: 1,
          maxProcessConnections: 2,
          maxBoardConnections: 2
        })
      })
    });
    const port = await listener.listen('127.0.0.1', 0);
    const url = `ws://127.0.0.1:${port}/ws/whiteboard/${BOARD_ID}?wsToken=token`;
    const first = new WebSocket(url, { headers: { 'x-forwarded-for': '198.51.100.1' } });
    const synchronized = waitForSync(first);
    await new Promise<void>((resolve, reject) => {
      first.once('open', resolve);
      first.once('error', reject);
    });
    await synchronized;

    const second = new WebSocket(url, { headers: { 'x-forwarded-for': '198.51.100.2' } });
    const closeCode = await waitForClose(second);

    expect(closeCode).toBe(1013);
    first.close();
    await listener.close(new Date(Date.now() + 1_000));
  });
});
