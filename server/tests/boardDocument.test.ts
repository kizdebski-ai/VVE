import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { createBoardDocument, type BoardDocument } from '../src/pilot/boardDocument';
import { applyBoardCommand, type BoardCommand, type BoardRole } from '../src/pilot/boardScene';

const updateWith = (key: string, value: unknown): Uint8Array => {
  const doc = new Y.Doc();
  doc.getMap('lesson').set(key, value);
  return Y.encodeStateAsUpdate(doc);
};

/** Encode `command` as the incremental update a client would send. */
const commandUpdate = (
  document: BoardDocument,
  command: BoardCommand,
  role: BoardRole
): Uint8Array => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, document.encode());
  const vector = Y.encodeStateVector(doc);
  const result = applyBoardCommand(doc, command, { origin: 'client', role });
  if (!result.ok) throw new Error(result.message);
  return Y.encodeStateAsUpdate(doc, vector);
};

const rectangle = {
  id: 'rect-1',
  type: 'rectangle',
  x: 0,
  y: 0,
  width: 10,
  height: 10
};

const drawingsOf = (document: BoardDocument): Array<Record<string, unknown>> => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, document.encode());
  return doc.getArray('drawings').toJSON() as Array<Record<string, unknown>>;
};

describe('BoardDocument Interface', () => {
  it('converges through encode/apply and exposes a deterministic digest', () => {
    const source = createBoardDocument();
    const replica = createBoardDocument();

    expect(source.apply(updateWith('title', 'Lesson 1'), { kind: 'remote', actorId: 'teacher-1' }).ok).toBe(true);
    expect(replica.apply(source.encode(), { kind: 'hydrate' }).ok).toBe(true);

    expect(replica.digest()).toBe(source.digest());
    expect(replica.snapshot()).toEqual(source.snapshot());
  });

  it('encodes only the state missing from a supplied state vector', () => {
    const source = createBoardDocument();
    const replica = createBoardDocument();
    source.apply(updateWith('topic', 'algebra'), { kind: 'remote', actorId: 'student-1' });

    const delta = source.encode(replica.stateVector());
    replica.apply(delta, { kind: 'remote', actorId: 'teacher-1' });

    expect(replica.digest()).toBe(source.digest());
    expect(source.encode(replica.stateVector())).toHaveLength(2);
  });

  it('rejects malformed updates without changing state', () => {
    const document = createBoardDocument();
    const before = document.digest();

    const result = document.apply(new Uint8Array([255, 0, 17]), {
      kind: 'remote',
      actorId: 'student-1'
    });

    expect(result).toMatchObject({ ok: false, reason: 'incompatibleUpdate' });
    expect(document.digest()).toBe(before);
  });

  it('rejects updates whose objects violate the canonical schema', () => {
    const document = createBoardDocument();
    const before = document.digest();

    const rogue = new Y.Doc();
    const map = new Y.Map<unknown>();
    map.set('id', 'rogue-1');
    map.set('type', 'teleporter');
    rogue.getArray('drawings').push([map]);

    const result = document.apply(Y.encodeStateAsUpdate(rogue), {
      kind: 'remote',
      actorId: 'student-1',
      role: 'student'
    });
    expect(result).toMatchObject({ ok: false, reason: 'invalidObject' });
    expect(document.digest()).toBe(before);
  });

  it('authorizes a whole-board clear for the Teacher only', () => {
    const document = createBoardDocument();
    const add = document.apply(
      commandUpdate(document, { kind: 'add', object: rectangle }, 'student'),
      { kind: 'remote', actorId: 'student-1', role: 'student' }
    );
    expect(add.ok).toBe(true);

    const clearUpdate = commandUpdate(document, { kind: 'clear' }, 'teacher');
    const deniedClear = document.apply(clearUpdate, {
      kind: 'remote',
      actorId: 'student-1',
      role: 'student'
    });
    expect(deniedClear).toMatchObject({ ok: false, reason: 'forbiddenCommand' });
    expect(drawingsOf(document)).toMatchObject([rectangle]);

    const allowedClear = document.apply(clearUpdate, {
      kind: 'remote',
      actorId: 'teacher-1',
      role: 'teacher'
    });
    expect(allowedClear.ok).toBe(true);
    expect(drawingsOf(document)).toEqual([]);
  });

  it('a student edit of another participant object stays allowed', () => {
    const document = createBoardDocument();
    document.apply(commandUpdate(document, { kind: 'add', object: rectangle }, 'teacher'), {
      kind: 'remote',
      actorId: 'teacher-1',
      role: 'teacher'
    });
    const moved = document.apply(
      commandUpdate(document, { kind: 'move', id: 'rect-1', x: 42, y: 24 }, 'student'),
      { kind: 'remote', actorId: 'student-1', role: 'student' }
    );
    expect(moved.ok).toBe(true);
    expect(drawingsOf(document)).toMatchObject([{ id: 'rect-1', x: 42, y: 24 }]);
  });

  it('validates and converges canonical math, physics, and coordinate updates', () => {
    const document = createBoardDocument();
    const objects = [
      {
        id: 'coordinate',
        type: 'coordinateSystem2D',
        x: 10,
        y: 20,
        width: 400,
        height: 300,
        grid: true,
        xLabel: 'x',
        yLabel: 'y'
      },
      {
        id: 'math',
        type: 'mathFunctionPlot',
        x: 30,
        y: 40,
        width: 400,
        height: 300,
        expression: 'x^2',
        xRange: [-10, 10]
      },
      {
        id: 'physics',
        type: 'physicsDataPlot',
        x: 50,
        y: 60,
        width: 400,
        height: 300,
        points: [{ x: 0, y: 0 }, { x: 1, y: 9.8 }],
        xLabel: 't',
        yLabel: 'v'
      }
    ];

    for (const object of objects) {
      const result = document.apply(
        commandUpdate(document, { kind: 'add', object }, 'student'),
        { kind: 'remote', actorId: 'student-1', role: 'student' }
      );
      expect(result.ok).toBe(true);
    }
    const replica = createBoardDocument();
    expect(replica.apply(document.encode(), { kind: 'hydrate' }).ok).toBe(true);
    expect(replica.digest()).toBe(document.digest());
    expect(replica.snapshot()).toEqual(document.snapshot());
    expect(drawingsOf(replica)).toHaveLength(3);
  });

  it('migrates legacy lesson objects after snapshot and update replay', () => {
    const legacy = new Y.Doc();
    const drawings = legacy.getArray<Y.Map<unknown>>('drawings');
    const math = new Y.Map<unknown>();
    for (const [key, value] of Object.entries({
      id: 'legacy-math',
      type: 'mathFunctionPlot',
      position: { x: 10, y: 20 },
      width: 400,
      height: 300,
      expression: 'x^2'
    })) math.set(key, value);
    const physics = new Y.Map<unknown>();
    for (const [key, value] of Object.entries({
      id: 'legacy-physics',
      type: 'physicsDataPlot',
      position: { x: 30, y: 40 },
      width: 400,
      height: 300,
      xData: [0, 1, 2],
      yData: [0, 9.8, 19.6],
      mode: 'lines+markers'
    })) physics.set(key, value);
    drawings.push([math, physics]);

    const storedSnapshot = Y.encodeStateAsUpdate(legacy);
    const snapshotVector = Y.encodeStateVector(legacy);
    math.set('position', { x: 75, y: 85 });
    const laterStoredUpdate = Y.encodeStateAsUpdate(legacy, snapshotVector);

    const document = createBoardDocument({ initialState: storedSnapshot });
    expect(document.apply(laterStoredUpdate, { kind: 'hydrate' }).ok).toBe(true);
    expect(document.migrateLegacyObjects()).toBe(2);
    expect(document.migrateLegacyObjects()).toBe(0);

    expect(drawingsOf(document)).toEqual([
      {
        id: 'legacy-math',
        type: 'mathFunctionPlot',
        x: 75,
        y: 85,
        width: 400,
        height: 300,
        expression: 'x^2',
        xRange: [-10, 10],
        rotation: 0
      },
      {
        id: 'legacy-physics',
        type: 'physicsDataPlot',
        x: 30,
        y: 40,
        width: 400,
        height: 300,
        points: [{ x: 0, y: 0 }, { x: 1, y: 9.8 }, { x: 2, y: 19.6 }],
        xLabel: 't',
        yLabel: 'v',
        rotation: 0
      }
    ]);
  });

  it('hydrate updates bypass schema authorization (trusted stored history)', () => {
    const source = createBoardDocument();
    source.apply(commandUpdate(source, { kind: 'add', object: rectangle }, 'teacher'), {
      kind: 'remote',
      actorId: 'teacher-1',
      role: 'teacher'
    });
    source.apply(commandUpdate(source, { kind: 'clear' }, 'teacher'), {
      kind: 'remote',
      actorId: 'teacher-1',
      role: 'teacher'
    });

    const replica = createBoardDocument();
    expect(replica.apply(source.encode(), { kind: 'hydrate' }).ok).toBe(true);
    expect(replica.digest()).toBe(source.digest());
  });
});
