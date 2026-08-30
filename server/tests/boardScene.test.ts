import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  applyBoardCommand,
  collectUpdateEffects,
  normalizeBoardObject,
  queryObjectsNear,
  sceneClearEpoch,
  sceneDrawings,
  sceneObjectBounds,
  validateBoardObject,
  SCENE_LIMITS,
  SHAPE_TYPES,
  type BoardCommand,
  type BoardRole,
  type SceneObject
} from '../src/pilot/boardScene';

const teacher = { origin: 'test-origin', role: 'teacher' as BoardRole };
const student = { origin: 'test-origin', role: 'student' as BoardRole };

const pen = (id = 'pen-1'): SceneObject => ({
  id,
  type: 'pen',
  points: [
    { x: 10, y: 10 },
    { x: 30, y: 50 }
  ],
  color: '#1f2937',
  lineWidth: 3
});

const shape = (id = 'shape-1'): SceneObject => ({
  id,
  type: 'rectangle',
  x: 100,
  y: 100,
  width: 80,
  height: 60,
  color: '#111827',
  lineWidth: 2,
  lineStyle: 'solid',
  roughness: 1
});

const line = (id = 'line-1'): SceneObject => ({
  id,
  type: 'line',
  start: { x: 0, y: 0 },
  end: { x: 50, y: 50 },
  color: '#111827',
  lineWidth: 2,
  arrowStyle: 'end'
});

const textObject = (id = 'text-1'): SceneObject => ({
  id,
  type: 'text',
  text: 'Twierdzenie Pitagorasa',
  x: 40,
  y: 40,
  fontSize: 24
});

const image = (id = 'image-1'): SceneObject => ({
  id,
  type: 'image',
  src: 'data:image/png;base64,iVBORw0KGgo=',
  x: 10,
  y: 20,
  width: 120,
  height: 90
});

const sceneJson = (doc: Y.Doc) => sceneDrawings(doc).toJSON() as Array<Record<string, unknown>>;

const addAll = (doc: Y.Doc, objects: SceneObject[]) => {
  for (const object of objects) {
    const result = applyBoardCommand(doc, { kind: 'add', object }, teacher);
    expect(result).toEqual({ ok: true });
  }
};

describe('canonical schema validation', () => {
  it('accepts every canonical object family', () => {
    expect(validateBoardObject(normalizeBoardObject(pen()))).toEqual({ ok: true });
    for (const type of SHAPE_TYPES) {
      expect(validateBoardObject(normalizeBoardObject({ ...shape(`s-${type}`), type }))).toEqual({
        ok: true
      });
    }
    expect(validateBoardObject(normalizeBoardObject(line()))).toEqual({ ok: true });
    expect(validateBoardObject(normalizeBoardObject(textObject()))).toEqual({ ok: true });
    expect(validateBoardObject(normalizeBoardObject(image()))).toEqual({ ok: true });
  });

  it('rejects unknown types, missing ids and non-finite geometry', () => {
    expect(validateBoardObject({ id: 'x', type: 'polygon-soup' })).toMatchObject({
      ok: false,
      reason: 'unknownType'
    });
    expect(validateBoardObject({ type: 'pen', points: [{ x: 0, y: 0 }] })).toMatchObject({
      ok: false,
      reason: 'invalidId'
    });
    expect(
      validateBoardObject({ ...normalizeBoardObject(shape()), x: Number.NaN })
    ).toMatchObject({ ok: false, reason: 'invalidGeometry' });
    expect(
      validateBoardObject({ ...normalizeBoardObject(pen()), points: [{ x: Infinity, y: 0 }] })
    ).toMatchObject({ ok: false, reason: 'invalidGeometry' });
  });

  it('bounds coordinates, point counts and payload sizes', () => {
    expect(
      validateBoardObject(
        normalizeBoardObject({ ...textObject(), x: SCENE_LIMITS.maxCoordinate * 2 })
      )
    ).toMatchObject({ ok: false, reason: 'invalidGeometry' });
    expect(
      validateBoardObject({
        ...normalizeBoardObject(textObject()),
        text: 'a'.repeat(SCENE_LIMITS.maxTextLength + 1)
      })
    ).toMatchObject({ ok: false, reason: 'invalidContent' });
    expect(
      validateBoardObject(normalizeBoardObject({ ...image(), src: 'https://evil.example/x.png' }))
    ).toMatchObject({ ok: false, reason: 'invalidContent' });
  });

  it('normalization strips legacy aliases and derives canonical bounds', () => {
    const normalized = normalizeBoardObject({
      id: 'legacy-1',
      type: 'image',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      position: { x: 5, y: 7 },
      width: 10,
      height: 10,
      strokeColor: '#123456'
    });
    expect(normalized).not.toHaveProperty('dataUrl');
    expect(normalized).not.toHaveProperty('position');
    expect(normalized).not.toHaveProperty('strokeColor');
    expect(normalized).toMatchObject({ src: 'data:image/png;base64,iVBORw0KGgo=', x: 5, y: 7 });

    const stroke = normalizeBoardObject(pen());
    expect(stroke).toMatchObject({ x: 10, y: 10, width: 20, height: 40 });

    const connector = normalizeBoardObject({ ...line(), points: [[0.1, 0.2]] });
    expect(connector).not.toHaveProperty('points');
    expect(connector).toMatchObject({ x: 0, y: 0, width: 50, height: 50 });
  });

  it('rejects aliases and unknown fields after the legacy intake edge', () => {
    expect(validateBoardObject({ ...image(), dataUrl: image().src })).toMatchObject({
      ok: false,
      reason: 'invalidContent'
    });
    expect(validateBoardObject({ ...shape(), position: { x: 100, y: 100 } })).toMatchObject({
      ok: false,
      reason: 'invalidContent'
    });
  });
});

describe('board commands', () => {
  it('adds, restyles, retexts, moves, resizes and rotates through one write path', () => {
    const doc = new Y.Doc();
    addAll(doc, [pen(), shape(), textObject()]);

    expect(
      applyBoardCommand(
        doc,
        { kind: 'updateStyle', id: 'shape-1', patch: { color: '#dc2626', lineStyle: 'dashed' } },
        student
      )
    ).toEqual({ ok: true });
    expect(
      applyBoardCommand(doc, { kind: 'updateText', id: 'text-1', text: 'Nowa treść' }, student)
    ).toEqual({ ok: true });
    expect(applyBoardCommand(doc, { kind: 'move', id: 'shape-1', x: 200, y: 250 }, student)).toEqual(
      { ok: true }
    );
    expect(
      applyBoardCommand(
        doc,
        { kind: 'resize', id: 'shape-1', x: 200, y: 250, width: 160, height: 120 },
        student
      )
    ).toEqual({ ok: true });
    expect(applyBoardCommand(doc, { kind: 'rotate', id: 'shape-1', rotation: 45 }, student)).toEqual(
      { ok: true }
    );

    const objects = sceneJson(doc);
    const rect = objects.find((object) => object.id === 'shape-1');
    expect(rect).toMatchObject({
      color: '#dc2626',
      lineStyle: 'dashed',
      x: 200,
      y: 250,
      width: 160,
      height: 120,
      rotation: 45
    });
    expect(objects.find((object) => object.id === 'text-1')).toMatchObject({ text: 'Nowa treść' });
  });

  it('scales pen points with resize and keeps bounds consistent', () => {
    const doc = new Y.Doc();
    addAll(doc, [pen()]);
    expect(
      applyBoardCommand(
        doc,
        { kind: 'resize', id: 'pen-1', x: 0, y: 0, width: 40, height: 80 },
        student
      )
    ).toEqual({ ok: true });
    const stroke = sceneJson(doc)[0] as { points: Array<{ x: number; y: number }> };
    expect(stroke.points[0]).toEqual({ x: 0, y: 0 });
    expect(stroke.points[1]).toEqual({ x: 40, y: 80 });
    expect(stroke).toMatchObject({ x: 0, y: 0, width: 40, height: 80 });
  });

  it('rejects invalid additions and unknown targets without mutating the scene', () => {
    const doc = new Y.Doc();
    addAll(doc, [shape()]);
    const before = sceneJson(doc);

    expect(
      applyBoardCommand(doc, { kind: 'add', object: { id: 'bad', type: 'nope' } }, teacher)
    ).toMatchObject({ ok: false, reason: 'invalidObject' });
    expect(
      applyBoardCommand(doc, { kind: 'add', object: shape() }, teacher)
    ).toMatchObject({ ok: false, reason: 'invalidObject' });
    expect(
      applyBoardCommand(doc, { kind: 'move', id: 'ghost', x: 0, y: 0 }, teacher)
    ).toMatchObject({ ok: false, reason: 'missingObject' });
    expect(
      applyBoardCommand(doc, { kind: 'move', id: 'shape-1', x: Number.NaN, y: 0 }, teacher)
    ).toMatchObject({ ok: false, reason: 'invalidCommand' });

    expect(sceneJson(doc)).toEqual(before);
  });

  it('rejects commands that would add fields outside an object family schema', () => {
    const doc = new Y.Doc();
    addAll(doc, [image()]);
    const before = sceneJson(doc);

    expect(
      applyBoardCommand(
        doc,
        { kind: 'updateStyle', id: 'image-1', patch: { fontSize: 48 } },
        student
      )
    ).toMatchObject({ ok: false, reason: 'invalidObject' });
    expect(sceneJson(doc)).toEqual(before);
  });

  it('keeps bound lines attached through move, resize and rotate of the target', () => {
    const doc = new Y.Doc();
    addAll(doc, [shape(), line()]);
    expect(
      applyBoardCommand(
        doc,
        {
          kind: 'setLineEndpoints',
          id: 'line-1',
          start: { x: 0, y: 0 },
          end: { x: 96, y: 130 },
          endBinding: {
            elementId: 'shape-1',
            ratioX: 0,
            ratioY: 0.5,
            normalLocal: { x: -1, y: 0 },
            gap: 4
          }
        },
        student
      )
    ).toEqual({ ok: true });

    const endBefore = (sceneJson(doc)[1] as { end: { x: number; y: number } }).end;
    expect(endBefore).toEqual({ x: 96, y: 130 });

    expect(applyBoardCommand(doc, { kind: 'move', id: 'shape-1', x: 300, y: 400 }, student)).toEqual(
      { ok: true }
    );
    const endAfterMove = (sceneJson(doc)[1] as { end: { x: number; y: number } }).end;
    expect(endAfterMove).toEqual({ x: 296, y: 430 });

    expect(
      applyBoardCommand(doc, { kind: 'detachLineBindings', id: 'line-1' }, student)
    ).toEqual({ ok: true });
    expect(applyBoardCommand(doc, { kind: 'move', id: 'shape-1', x: 0, y: 0 }, student)).toEqual({
      ok: true
    });
    expect((sceneJson(doc)[1] as { end: { x: number; y: number } }).end).toEqual(endAfterMove);
  });

  it('removes dangling bindings when the bound target is deleted', () => {
    const doc = new Y.Doc();
    addAll(doc, [shape(), line()]);
    applyBoardCommand(
      doc,
      {
        kind: 'setLineEndpoints',
        id: 'line-1',
        start: { x: 0, y: 0 },
        end: { x: 96, y: 130 },
        endBinding: {
          elementId: 'shape-1',
          ratioX: 0,
          ratioY: 0.5,
          normalLocal: { x: -1, y: 0 },
          gap: 4
        }
      },
      student
    );
    expect(applyBoardCommand(doc, { kind: 'delete', ids: ['shape-1'] }, student)).toEqual({
      ok: true
    });
    const objects = sceneJson(doc);
    expect(objects).toHaveLength(1);
    expect(objects[0]).not.toHaveProperty('endBinding');
  });

  it('clones an object without carrying over bindings or identity', () => {
    const doc = new Y.Doc();
    addAll(doc, [shape(), line()]);
    applyBoardCommand(
      doc,
      {
        kind: 'setLineEndpoints',
        id: 'line-1',
        start: { x: 0, y: 0 },
        end: { x: 96, y: 130 },
        startBinding: {
          elementId: 'shape-1',
          ratioX: 1,
          ratioY: 0.5,
          normalLocal: { x: 1, y: 0 },
          gap: 4
        }
      },
      student
    );
    expect(
      applyBoardCommand(doc, { kind: 'clone', id: 'line-1', newId: 'line-2', offset: 10 }, student)
    ).toEqual({ ok: true });
    const clone = sceneJson(doc).find((object) => object.id === 'line-2') as {
      start: { x: number; y: number };
    };
    expect(clone).toBeDefined();
    expect(clone).not.toHaveProperty('startBinding');
    expect(clone.start).toEqual({ x: 10, y: 10 });
    expect(
      applyBoardCommand(doc, { kind: 'clone', id: 'line-1', newId: 'line-2' }, student)
    ).toMatchObject({ ok: false, reason: 'invalidObject' });
  });

  it('translates a group of objects together, following their bindings', () => {
    const doc = new Y.Doc();
    addAll(doc, [shape(), pen(), textObject()]);
    expect(
      applyBoardCommand(
        doc,
        { kind: 'translateObjects', ids: ['shape-1', 'pen-1', 'text-1'], dx: 11, dy: -7 },
        student
      )
    ).toEqual({ ok: true });
    const objects = sceneJson(doc);
    expect(objects.find((object) => object.id === 'shape-1')).toMatchObject({ x: 111, y: 93 });
    expect(objects.find((object) => object.id === 'text-1')).toMatchObject({ x: 51, y: 33 });
    const stroke = objects.find((object) => object.id === 'pen-1') as {
      points: Array<{ x: number; y: number }>;
    };
    expect(stroke.points[0]).toEqual({ x: 21, y: 3 });
  });

  it('reserves whole-board clear for the Teacher and records a clear epoch', () => {
    const doc = new Y.Doc();
    addAll(doc, [pen(), shape()]);

    const deniedClear = applyBoardCommand(doc, { kind: 'clear' }, student);
    expect(deniedClear).toMatchObject({ ok: false, reason: 'forbiddenCommand' });
    expect(sceneJson(doc)).toHaveLength(2);
    expect(sceneClearEpoch(doc)).toBe(0);

    expect(applyBoardCommand(doc, { kind: 'clear' }, teacher)).toEqual({ ok: true });
    expect(sceneJson(doc)).toHaveLength(0);
    expect(sceneClearEpoch(doc)).toBe(1);
  });

  it('a student may still edit and delete individual teacher objects', () => {
    const doc = new Y.Doc();
    addAll(doc, [shape(), textObject()]);
    expect(
      applyBoardCommand(doc, { kind: 'move', id: 'shape-1', x: 1, y: 2 }, student)
    ).toEqual({ ok: true });
    expect(applyBoardCommand(doc, { kind: 'delete', ids: ['text-1'] }, student)).toEqual({
      ok: true
    });
    expect(sceneJson(doc)).toHaveLength(1);
  });

  it('one command is one transaction with the caller-supplied origin', () => {
    const doc = new Y.Doc();
    const origins: unknown[] = [];
    doc.on('afterTransaction', (transaction: Y.Transaction) => {
      if (transaction.origin === 'test-origin') origins.push(transaction.origin);
    });
    addAll(doc, [shape(), line()]);
    applyBoardCommand(
      doc,
      {
        kind: 'setLineEndpoints',
        id: 'line-1',
        start: { x: 0, y: 0 },
        end: { x: 96, y: 130 },
        endBinding: {
          elementId: 'shape-1',
          ratioX: 0,
          ratioY: 0.5,
          normalLocal: { x: -1, y: 0 },
          gap: 4
        }
      },
      student
    );
    // move mutates the shape AND re-anchors the bound line in the SAME
    // transaction — the collaborative history sees one atomic step.
    applyBoardCommand(doc, { kind: 'move', id: 'shape-1', x: 300, y: 400 }, student);
    expect(origins).toHaveLength(4);
  });

  it('two documents converge when commands are exchanged as updates', () => {
    const alpha = new Y.Doc();
    const beta = new Y.Doc();
    addAll(alpha, [pen(), shape()]);
    Y.applyUpdate(beta, Y.encodeStateAsUpdate(alpha));

    applyBoardCommand(beta, { kind: 'move', id: 'shape-1', x: 500, y: 600 }, student);
    applyBoardCommand(alpha, { kind: 'updateStyle', id: 'pen-1', patch: { color: '#16a34a' } }, teacher);
    Y.applyUpdate(alpha, Y.encodeStateAsUpdate(beta, Y.encodeStateVector(alpha)));
    Y.applyUpdate(beta, Y.encodeStateAsUpdate(alpha, Y.encodeStateVector(beta)));

    expect(sceneJson(alpha)).toEqual(sceneJson(beta));
    expect(sceneJson(alpha).find((object) => object.id === 'shape-1')).toMatchObject({
      x: 500,
      y: 600
    });
    expect(sceneJson(alpha).find((object) => object.id === 'pen-1')).toMatchObject({
      color: '#16a34a'
    });
  });
});

describe('collectUpdateEffects', () => {
  const updateBetween = (base: Y.Doc, mutate: (doc: Y.Doc) => void): Uint8Array => {
    const fork = new Y.Doc();
    Y.applyUpdate(fork, Y.encodeStateAsUpdate(base));
    const vector = Y.encodeStateVector(base);
    mutate(fork);
    return Y.encodeStateAsUpdate(fork, vector);
  };

  it('reports exactly the objects an update adds or modifies', () => {
    const base = new Y.Doc();
    addAll(base, [shape(), pen()]);

    const update = updateBetween(base, (doc) => {
      applyBoardCommand(doc, { kind: 'move', id: 'shape-1', x: 900, y: 900 }, student);
      applyBoardCommand(doc, { kind: 'add', object: textObject('text-9') }, student);
    });

    const effects = collectUpdateEffects(Y.encodeStateAsUpdate(base), update);
    expect(effects.clearEpochChanged).toBe(false);
    expect(effects.objectCount).toBe(3);
    const ids = effects.changedObjects.map((object) => object.id).sort();
    expect(ids).toEqual(['shape-1', 'text-9']);
  });

  it('flags a clear-epoch change and counts removals', () => {
    const base = new Y.Doc();
    addAll(base, [shape(), pen()]);

    const clearUpdate = updateBetween(base, (doc) => {
      applyBoardCommand(doc, { kind: 'clear' }, teacher);
    });
    const effects = collectUpdateEffects(Y.encodeStateAsUpdate(base), clearUpdate);
    expect(effects.clearEpochChanged).toBe(true);
    expect(effects.removedCount).toBe(2);
    expect(effects.objectCount).toBe(0);

    const deleteUpdate = updateBetween(base, (doc) => {
      applyBoardCommand(doc, { kind: 'delete', ids: ['pen-1'] }, student);
    });
    const deletion = collectUpdateEffects(Y.encodeStateAsUpdate(base), deleteUpdate);
    expect(deletion.clearEpochChanged).toBe(false);
    expect(deletion.removedCount).toBe(1);
  });

  it('surfaces nested mutations made below the object map', () => {
    const base = new Y.Doc();
    const nested = new Y.Map<unknown>();
    nested.set('id', 'legacy-nested');
    nested.set('type', 'rectangle');
    const inner = new Y.Map<unknown>();
    inner.set('x', 1);
    nested.set('meta', inner);
    base.getArray('drawings').push([nested]);

    const update = updateBetween(base, (doc) => {
      const map = doc.getArray<Y.Map<unknown>>('drawings').get(0);
      (map.get('meta') as Y.Map<unknown>).set('x', 99);
    });
    const effects = collectUpdateEffects(Y.encodeStateAsUpdate(base), update);
    expect(effects.changedObjects.map((object) => object.id)).toEqual(['legacy-nested']);
  });
});

describe('BoardDocument candidate query', () => {
  it('keeps optional pen pressure through normalization', () => {
    const object = normalizeBoardObject({
      id: 'pressured',
      type: 'pen',
      points: [
        { x: 0, y: 0, t: 1, p: 0.2 },
        { x: 8, y: 3, t: 4, p: 0.9 }
      ],
      color: '#111827',
      lineWidth: 2
    });
    expect(object.points).toEqual([
      { x: 0, y: 0, t: 1, p: 0.2 },
      { x: 8, y: 3, t: 4, p: 0.9 }
    ]);
  });

  it('rejects out-of-range pressure instead of storing a corrupt point', () => {
    expect(
      validateBoardObject({
        id: 'bad-pressure',
        type: 'pen',
        points: [{ x: 0, y: 0, p: 1.4 }],
        color: '#111827',
        lineWidth: 2
      })
    ).toMatchObject({ ok: false, reason: 'invalidGeometry' });
  });

  it('returns nearby objects without scanning past the AABB', () => {
    const far = normalizeBoardObject({
      id: 'far',
      type: 'rectangle',
      x: 400,
      y: 400,
      width: 40,
      height: 40,
      color: '#111827',
      lineWidth: 2
    });
    const near = normalizeBoardObject(pen('near'));
    const hits = queryObjectsNear([far, near], { x: 12, y: 12 }, 8);
    expect(hits.map((object) => object.id)).toEqual(['near']);
    expect(sceneObjectBounds(near)).toMatchObject({ x: 10, y: 10 });
  });
});
