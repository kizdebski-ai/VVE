import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';

import {
  CollaborationFailure,
  InMemoryBoardDocumentStore,
  createCollaborationRuntime,
  type AuthenticatedConnection,
  type CollaborationTransport,
  type ServerFrame
} from '../src/pilot/collaborationRuntime';
import { applyBoardCommand, type BoardCommand } from '../src/pilot/boardScene';

const BOARD_A = '11111111-1111-4111-8111-111111111111';
const BOARD_B = '22222222-2222-4222-8222-222222222222';

const mutation = (operationId: string, key: string, value: string) => {
  const doc = new Y.Doc();
  doc.getMap('lesson').set(key, value);
  return { kind: 'mutation' as const, operationId, update: Y.encodeStateAsUpdate(doc) };
};

const connection = (
  boardId = BOARD_A,
  role: 'teacher' | 'student' = 'teacher',
  revalidate: () => Promise<boolean> = async () => true
): AuthenticatedConnection => ({
  boardId,
  grant: {
    granted: true,
    action: 'board.edit',
    role,
    teacherId: role === 'teacher' ? 'teacher-1' : 'teacher-1',
    boardId,
    credentialVersion: 1,
    validUntil: new Date('2027-08-30T00:00:00Z')
  },
  revalidate
});

class MemoryTransport implements CollaborationTransport {
  frames: ServerFrame[] = [];
  closed: { code: number; reason: string } | null = null;

  constructor(private readonly events?: string[]) {}

  async send(frame: ServerFrame) {
    this.frames.push(frame);
    if (frame.kind === 'acknowledgement') {
      this.events?.push(`ack:${frame.operationId}`);
    }
  }

  async close(code: number, reason: string) {
    this.closed = { code, reason };
  }
}

describe('CollaborationRuntime acknowledgement oracle', () => {
  it('stays read-only until snapshot delivery completes, then acknowledges only after durable append', async () => {
    const events: string[] = [];
    const store = new InMemoryBoardDocumentStore({ onEvent: (event) => events.push(event) });
    const runtime = createCollaborationRuntime({ store });
    const teacher = new MemoryTransport(events);
    const student = new MemoryTransport();
    const teacherHandle = await runtime.connect(connection(), teacher);
    await runtime.connect(connection(BOARD_A, 'student'), student);

    expect(teacher.frames.map((frame) => frame.kind).slice(0, 2)).toEqual(['sync', 'synchronizationComplete']);
    teacher.frames.length = 0;
    student.frames.length = 0;

    await teacherHandle.receive(mutation('op-1', 'title', 'Durable lesson'));

    expect(events).toContain('append:op-1');
    expect(teacher.frames.at(-1)).toMatchObject({ kind: 'acknowledgement', operationId: 'op-1' });
    expect(student.frames.at(-1)).toMatchObject({ kind: 'update', operationId: 'op-1' });
    expect(events.indexOf('append:op-1')).toBeLessThan(events.indexOf('ack:op-1'));
  });

  it.each([
    'afterAppendBeforeApply',
    'afterApplyBeforeBroadcast',
    'afterBroadcastBeforeAcknowledgement'
  ] as const)('survives crash injection at %s; retry is idempotent', async (crashPoint) => {
    const store = new InMemoryBoardDocumentStore();
    const crashing = createCollaborationRuntime({
      store,
      crashInjector: async (point) => {
        if (point === crashPoint) throw new Error(`simulated process crash at ${point}`);
      }
    });
    const firstTransport = new MemoryTransport();
    const first = await crashing.connect(connection(), firstTransport);
    const stableMutation = mutation('stable-op', 'proof', 'kept');

    await expect(first.receive(stableMutation)).rejects.toThrow('simulated process crash');
    expect(firstTransport.frames.some((frame) => frame.kind === 'acknowledgement')).toBe(false);

    const restarted = createCollaborationRuntime({ store });
    const secondTransport = new MemoryTransport();
    const second = await restarted.connect(connection(), secondTransport);
    const digestAfterRestart = (await restarted.inspect(BOARD_A)).digest;
    await second.receive(stableMutation);

    expect((await store.inspect(BOARD_A)).operationCount).toBe(1);
    expect((await restarted.inspect(BOARD_A)).digest).toBe(digestAfterRestart);
    expect(secondTransport.frames.at(-1)).toMatchObject({ kind: 'acknowledgement', operationId: 'stable-op' });
  });

  it('replays snapshot plus rows after its cutoff and compacts without deleting a concurrent newer row', async () => {
    const store = new InMemoryBoardDocumentStore();
    const runtime = createCollaborationRuntime({ store, compactAfterOperations: 1_000 });
    const transport = new MemoryTransport();
    const handle = await runtime.connect(connection(), transport);
    await handle.receive(mutation('op-before-cutoff', 'a', '1'));
    const cutoff = (await store.inspect(BOARD_A)).lastSequence;
    await store.compact(BOARD_A, (await runtime.inspect(BOARD_A)).encodedState, cutoff);
    await handle.receive(mutation('op-after-cutoff', 'b', '2'));

    const restarted = createCollaborationRuntime({ store });
    await restarted.connect(connection(), new MemoryTransport());

    expect((await restarted.inspect(BOARD_A)).digest).toBe((await runtime.inspect(BOARD_A)).digest);
    expect((await store.inspect(BOARD_A)).operationIds).toEqual(['op-after-cutoff']);
  });

  it('supports an independent Student and several sessions using the same grant', async () => {
    const runtime = createCollaborationRuntime({ store: new InMemoryBoardDocumentStore() });
    const studentOne = new MemoryTransport();
    const studentTwo = new MemoryTransport();
    const one = await runtime.connect(connection(BOARD_A, 'student'), studentOne);
    await runtime.connect(connection(BOARD_A, 'student'), studentTwo);

    await one.receive(mutation('student-op', 'answer', '42'));

    expect(studentTwo.frames.at(-1)).toMatchObject({ kind: 'update', operationId: 'student-op' });
    expect((await runtime.inspect(BOARD_A)).connections).toBe(2);
  });

  it('hydrates one live document exactly once for four concurrent clients', async () => {
    const store = new InMemoryBoardDocumentStore();
    const hydrate = vi.spyOn(store, 'hydrate');
    const runtime = createCollaborationRuntime({ store });

    await Promise.all([
      runtime.connect(connection(BOARD_A, 'teacher'), new MemoryTransport()),
      runtime.connect(connection(BOARD_A, 'student'), new MemoryTransport()),
      runtime.connect(connection(BOARD_A, 'student'), new MemoryTransport()),
      runtime.connect(connection(BOARD_A, 'student'), new MemoryTransport())
    ]);

    expect(hydrate).toHaveBeenCalledTimes(1);
    expect((await runtime.inspect(BOARD_A)).connections).toBe(4);
  });

  it('hydrates awareness for a later device and removes it when the owner disconnects', async () => {
    const runtime = createCollaborationRuntime({ store: new InMemoryBoardDocumentStore() });
    const firstTransport = new MemoryTransport();
    const first = await runtime.connect(connection(BOARD_A, 'student'), firstTransport);
    const awarenessDoc = new Y.Doc();
    const awareness = new Awareness(awarenessDoc);
    awareness.setLocalStateField('user', { name: 'Student', color: '#123456' });
    await first.receive({
      kind: 'awareness',
      update: encodeAwarenessUpdate(awareness, [awareness.clientID])
    });

    const secondTransport = new MemoryTransport();
    await runtime.connect(connection(BOARD_A, 'student'), secondTransport);
    expect(secondTransport.frames.map((frame) => frame.kind).slice(0, 3)).toEqual([
      'sync',
      'awareness',
      'synchronizationComplete'
    ]);

    secondTransport.frames.length = 0;
    await first.close('device closed');
    expect(secondTransport.frames.at(-1)?.kind).toBe('awareness');
    awareness.destroy();
    awarenessDoc.destroy();
  });

  it('denies wrong-board grants and a revoked live session without cross-board writes', async () => {
    const store = new InMemoryBoardDocumentStore();
    const runtime = createCollaborationRuntime({ store });
    const wrong = connection(BOARD_B);
    wrong.boardId = BOARD_A;

    await expect(runtime.connect(wrong, new MemoryTransport())).rejects.toMatchObject({
      code: 'wrongBoard'
    });

    const revalidate = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const transport = new MemoryTransport();
    const live = await runtime.connect(connection(BOARD_A, 'student', revalidate), transport);
    await live.receive(mutation('revoked-op', 'forbidden', 'write'));

    expect(transport.closed).toMatchObject({ code: 1008 });
    expect((await store.inspect(BOARD_A)).operationCount).toBe(0);
    expect((await store.inspect(BOARD_B)).operationCount).toBe(0);
  });

  it('unloads an idle board and restores the same digest on the next connection', async () => {
    let now = 1_000;
    const store = new InMemoryBoardDocumentStore();
    const runtime = createCollaborationRuntime({ store, now: () => now, idleMs: 500 });
    const handle = await runtime.connect(connection(), new MemoryTransport());
    await handle.receive(mutation('idle-op', 'state', 'survives'));
    const before = (await runtime.inspect(BOARD_A)).digest;
    await handle.close('done');
    now += 501;

    expect(await runtime.unloadIdle()).toEqual([BOARD_A]);
    await runtime.connect(connection(), new MemoryTransport());
    expect((await runtime.inspect(BOARD_A)).digest).toBe(before);
  });

  it('migrates legacy lesson rows and persists the canonical snapshot on close', async () => {
    const store = new InMemoryBoardDocumentStore();
    const legacy = new Y.Doc();
    const plot = new Y.Map<unknown>();
    for (const [key, value] of Object.entries({
      id: 'legacy-physics',
      type: 'physicsDataPlot',
      position: { x: 30, y: 40 },
      width: 400,
      height: 300,
      xData: [0, 1],
      yData: [0, 9.8],
      mode: 'lines+markers'
    })) plot.set(key, value);
    legacy.getArray('drawings').push([plot]);
    await store.append(BOARD_A, 'legacy-lesson', Y.encodeStateAsUpdate(legacy));

    const runtime = createCollaborationRuntime({ store });
    const firstTransport = new MemoryTransport();
    const first = await runtime.connect(connection(), firstTransport);
    const firstState = new Y.Doc();
    Y.applyUpdate(firstState, (await runtime.inspect(BOARD_A)).encodedState);
    expect(firstState.getArray('drawings').toJSON()).toEqual([
      {
        id: 'legacy-physics',
        type: 'physicsDataPlot',
        x: 30,
        y: 40,
        width: 400,
        height: 300,
        points: [{ x: 0, y: 0 }, { x: 1, y: 9.8 }],
        xLabel: 't',
        yLabel: 'v',
        rotation: 0
      }
    ]);
    await first.close('migration compacted');

    const restarted = createCollaborationRuntime({ store });
    const restartedTransport = new MemoryTransport();
    await restarted.connect(connection(), restartedTransport);
    const sync = restartedTransport.frames.find((frame) => frame.kind === 'sync');
    expect(sync?.kind).toBe('sync');
    const restartedState = new Y.Doc();
    if (sync?.kind === 'sync') Y.applyUpdate(restartedState, sync.update);
    expect(restartedState.getArray('drawings').toJSON()).toEqual(
      firstState.getArray('drawings').toJSON()
    );
    expect((await store.inspect(BOARD_A)).operationCount).toBe(0);
  });

  it('returns typed persistence failure and never acknowledges it', async () => {
    const store = new InMemoryBoardDocumentStore({ failAppend: true });
    const runtime = createCollaborationRuntime({ store });
    const transport = new MemoryTransport();
    const handle = await runtime.connect(connection(), transport);

    await expect(handle.receive(mutation('failed-op', 'x', 'y'))).rejects.toBeInstanceOf(CollaborationFailure);
    expect(transport.frames.some((frame) => frame.kind === 'acknowledgement')).toBe(false);
  });
});

describe('CollaborationRuntime document authority (S4)', () => {
  const boardMutation = (
    operationId: string,
    baseState: Uint8Array,
    command: BoardCommand,
    role: 'teacher' | 'student'
  ) => {
    const doc = new Y.Doc();
    if (baseState.length) Y.applyUpdate(doc, baseState);
    const vector = Y.encodeStateVector(doc);
    const result = applyBoardCommand(doc, command, { origin: 'client', role });
    if (!result.ok) throw new Error(result.message);
    return { kind: 'mutation' as const, operationId, update: Y.encodeStateAsUpdate(doc, vector) };
  };

  const rectangle = { id: 'rect-1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 };

  it('denies a forged student clear per-operation and keeps the connection live', async () => {
    const store = new InMemoryBoardDocumentStore();
    const runtime = createCollaborationRuntime({ store });
    const teacher = new MemoryTransport();
    const student = new MemoryTransport();
    const teacherHandle = await runtime.connect(connection(BOARD_A, 'teacher'), teacher);
    const studentHandle = await runtime.connect(connection(BOARD_A, 'student'), student);

    const state = () => runtime.inspect(BOARD_A).then((snapshot) => snapshot.encodedState);
    await teacherHandle.receive(
      boardMutation('op-add', await state(), { kind: 'add', object: rectangle }, 'teacher')
    );

    // A malicious Student client can craft the clear bytes; document
    // authority lives on the server, not in the hidden UI button.
    const forgedClear = boardMutation('op-forged-clear', await state(), { kind: 'clear' }, 'teacher');
    const denied = await studentHandle.receive(forgedClear);
    expect(denied).toEqual({ accepted: false, reason: 'forbidden' });
    expect(student.frames.at(-1)).toEqual({
      kind: 'denial',
      reason: 'forbidden',
      operationId: 'op-forged-clear'
    });
    expect(student.closed).toBeNull();

    // The board still holds the rectangle, nothing was persisted, and the
    // student connection continues to accept lawful mutations.
    expect((await store.inspect(BOARD_A)).operationIds).toEqual(['op-add']);
    const lawful = await studentHandle.receive(
      boardMutation('op-move', await state(), { kind: 'move', id: 'rect-1', x: 7, y: 8 }, 'student')
    );
    expect(lawful).toMatchObject({ accepted: true, operationId: 'op-move' });

    const teacherClear = await teacherHandle.receive(
      boardMutation('op-clear', await state(), { kind: 'clear' }, 'teacher')
    );
    expect(teacherClear).toMatchObject({ accepted: true, operationId: 'op-clear' });
  });

  it('denies schema-violating objects with the offending operation id', async () => {
    const runtime = createCollaborationRuntime({ store: new InMemoryBoardDocumentStore() });
    const transport = new MemoryTransport();
    const handle = await runtime.connect(connection(BOARD_A, 'student'), transport);

    const rogue = new Y.Doc();
    const map = new Y.Map<unknown>();
    map.set('id', 'rogue');
    map.set('type', 'not-a-real-tool');
    rogue.getArray('drawings').push([map]);

    const result = await handle.receive({
      kind: 'mutation',
      operationId: 'op-rogue',
      update: Y.encodeStateAsUpdate(rogue)
    });
    expect(result).toEqual({ accepted: false, reason: 'malformed' });
    expect(transport.frames.at(-1)).toEqual({
      kind: 'denial',
      reason: 'malformed',
      operationId: 'op-rogue'
    });
    expect(transport.closed).toBeNull();
  });
});
