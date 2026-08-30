import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { createBoardDocument } from '../src/pilot/boardDocument';

const updateWith = (key: string, value: unknown): Uint8Array => {
  const doc = new Y.Doc();
  doc.getMap('lesson').set(key, value);
  return Y.encodeStateAsUpdate(doc);
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
});
