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
