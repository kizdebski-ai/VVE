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

  it('replays canonical lesson objects with snapshot and update parity', () => {
    const source = createBoardDocument();
    const math = {
      id: 'canon-math',
      type: 'mathFunctionPlot',
      x: 75,
      y: 85,
      width: 400,
      height: 300,
      expression: 'x^2',
      xRange: [-10, 10],
      xLabel: 'x',
      yLabel: 'f(x)',
      lineWidth: 3,
      color: '#2563eb',
      rotation: 0
    };
    const physics = {
      id: 'canon-physics',
      type: 'physicsDataPlot',
      x: 30,
      y: 40,
      width: 400,
      height: 300,
      points: [{ x: 0, y: 0 }, { x: 1, y: 9.8 }, { x: 2, y: 19.6 }],
      xLabel: 't',
      yLabel: 'v',
      lineWidth: 2,
      color: '#2563eb',
      rotation: 0
    };
    expect(source.apply(commandUpdate(source, { kind: 'add', object: math }, 'teacher'), { kind: 'local', actorId: 't1', role: 'teacher' }).ok).toBe(true);
    const snapshot = source.encode();

    const replica = createBoardDocument({ initialState: snapshot });
    expect(source.apply(commandUpdate(source, { kind: 'add', object: physics }, 'teacher'), { kind: 'local', actorId: 't1', role: 'teacher' }).ok).toBe(true);

    const update = source.encode(replica.stateVector());
    expect(replica.apply(update, { kind: 'hydrate' }).ok).toBe(true);

    expect(drawingsOf(replica)).toEqual([math, physics]);
    expect(replica.digest()).toBe(source.digest());
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
