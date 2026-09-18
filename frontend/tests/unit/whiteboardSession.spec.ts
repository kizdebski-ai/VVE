import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { createWhiteboardSession } from '@/board/whiteboardSession';

const rectangle = (id: string, x = 0) => ({
  id,
  type: 'rectangle',
  x,
  y: 10,
  width: 80,
  height: 60,
  rotation: 0,
  color: '#111827',
  lineWidth: 2
});

describe('WhiteboardSession Interface', () => {
  it('executes canonical commands and exposes render state without aliases', () => {
    const ydoc = new Y.Doc();
    const session = createWhiteboardSession({ ydoc, role: 'student' });

    expect(session.execute({
      kind: 'add',
      object: {
        ...rectangle('image-1'),
        type: 'image',
        src: 'data:image/png;base64,iVBORw0KGgo=',
        x: 25,
        y: 35
      }
    })).toEqual({ ok: true });

    expect(session.snapshot()).toEqual([
      expect.objectContaining({
        id: 'image-1',
        type: 'image',
        src: 'data:image/png;base64,iVBORw0KGgo=',
        x: 25,
        y: 35
      })
    ]);
    expect(session.snapshot()[0]).not.toHaveProperty('dataUrl');
    expect(session.snapshot()[0]).not.toHaveProperty('position');
    session.dispose();
  });

  it('keeps the spatial index aligned with Y.Array insertion and deletion order', () => {
    const ydoc = new Y.Doc();
    const session = createWhiteboardSession({ ydoc, role: 'student' });
    expect(session.execute({ kind: 'add', object: rectangle('first', 0) })).toEqual({ ok: true });
    expect(session.execute({ kind: 'add', object: rectangle('last', 200) })).toEqual({ ok: true });

    const inserted = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(rectangle('inserted', 100))) inserted.set(key, value);
    const drawings = ydoc.getArray<Y.Map<unknown>>('drawings');
    ydoc.transact(() => drawings.insert(0, [inserted]), 'remote-import');
    expect(session.queryObjectsNear({ x: 110, y: 40 }, 5).map((object) => object.id)).toContain('inserted');

    ydoc.transact(() => drawings.delete(0, 1), 'remote-delete');
    expect(session.queryObjectsNear({ x: 110, y: 40 }, 5).map((object) => object.id)).not.toContain('inserted');
    expect(session.queryObjectsNear({ x: 10, y: 40 }, 5).map((object) => object.id)).toContain('first');
    session.dispose();
  });

  it('keeps undo and redo scoped to the participant that issued the command', () => {
    const ydoc = new Y.Doc();
    const teacherHistory = vi.fn();
    const teacher = createWhiteboardSession({
      ydoc,
      role: 'teacher',
      onHistoryChange: teacherHistory
    });
    const student = createWhiteboardSession({ ydoc, role: 'student' });

    expect(teacher.execute({ kind: 'add', object: rectangle('teacher-object') })).toEqual({ ok: true });
    expect(student.execute({ kind: 'add', object: rectangle('student-object', 120) })).toEqual({ ok: true });
    expect(teacher.snapshot().map((object) => object.id)).toEqual([
      'teacher-object',
      'student-object'
    ]);

    expect(teacher.undo()).toBe(true);
    expect(teacher.snapshot().map((object) => object.id)).toEqual(['student-object']);
    expect(student.canUndo()).toBe(true);
    expect(teacher.redo()).toBe(true);
    expect(teacher.snapshot().map((object) => object.id).sort()).toEqual([
      'student-object',
      'teacher-object'
    ]);
    expect(teacherHistory).toHaveBeenCalled();

    teacher.dispose();
    student.dispose();
  });

  it('reserves whole-board clear for the Teacher while Students edit shared objects', () => {
    const ydoc = new Y.Doc();
    const teacher = createWhiteboardSession({ ydoc, role: 'teacher' });
    const student = createWhiteboardSession({ ydoc, role: 'student' });
    teacher.execute({ kind: 'add', object: rectangle('shared') });

    expect(student.execute({ kind: 'move', id: 'shared', x: 200, y: 220 })).toEqual({ ok: true });
    expect(student.execute({ kind: 'clear' })).toMatchObject({
      ok: false,
      reason: 'forbiddenCommand',
      message: 'Tylko nauczyciel może wyczyścić całą tablicę.'
    });
    expect(student.snapshot()).toHaveLength(1);
    expect(teacher.execute({ kind: 'clear' })).toEqual({ ok: true });
    expect(teacher.snapshot()).toEqual([]);

    teacher.dispose();
    student.dispose();
  });

  it('blocks document commands while read-only and resets local history on reload', () => {
    const ydoc = new Y.Doc();
    let editable = true;
    const first = createWhiteboardSession({
      ydoc,
      role: 'student',
      isEditable: () => editable
    });
    first.execute({ kind: 'add', object: rectangle('saved') });
    expect(first.canUndo()).toBe(true);

    editable = false;
    expect(first.execute({ kind: 'move', id: 'saved', x: 500, y: 500 })).toMatchObject({
      ok: false,
      reason: 'readOnly'
    });
    expect(first.undo()).toBe(false);
    expect(first.snapshot()[0]).toMatchObject({ x: 0, y: 10 });
    first.dispose();

    const reloaded = createWhiteboardSession({ ydoc, role: 'student' });
    expect(reloaded.snapshot()).toHaveLength(1);
    expect(reloaded.canUndo()).toBe(false);
    expect(reloaded.canRedo()).toBe(false);
    reloaded.dispose();
  });

  it('owns ephemeral selection without writing it to the shared document', () => {
    const ydoc = new Y.Doc();
    const session = createWhiteboardSession({ ydoc, role: 'student' });
    session.execute({ kind: 'add', object: rectangle('selectable') });
    const before = Y.encodeStateAsUpdate(ydoc);

    expect(session.select('missing')).toBe(false);
    expect(session.select('selectable')).toBe(true);
    expect(session.selectedObjectId()).toBe('selectable');
    expect(session.select(null)).toBe(true);
    expect(session.selectedObjectId()).toBeNull();
    expect(Y.encodeStateAsUpdate(ydoc)).toEqual(before);
    session.dispose();
  });

  it('owns pan and zoom as local session state without mutating the document', () => {
    const ydoc = new Y.Doc();
    const session = createWhiteboardSession({ ydoc, role: 'student' });
    const before = Y.encodeStateAsUpdate(ydoc);

    expect(session.panBy(30, -20)).toEqual({ zoom: 1, panX: 30, panY: -20 });
    expect(session.zoomAt(100, 100, 2)).toEqual({ zoom: 2, panX: -40, panY: -140 });
    expect(session.setViewport({ zoom: Number.NaN, panX: 0, panY: 0 })).toEqual({
      zoom: 2,
      panX: -40,
      panY: -140
    });
    expect(session.resetViewport()).toEqual({ zoom: 1, panX: 0, panY: 0 });
    expect(Y.encodeStateAsUpdate(ydoc)).toEqual(before);
    expect(session.canUndo()).toBe(false);
    session.dispose();
  });

  it('provides bounded spatial candidate queries that update with document mutations', () => {
    const ydoc = new Y.Doc();
    const session = createWhiteboardSession({ ydoc, role: 'teacher' });

    session.execute({ kind: 'add', object: rectangle('spatial-target') });
    // Candidate near object
    const hits = session.queryObjectsNear({ x: 50, y: 50 }, 10);
    expect(hits.map((h) => h.id)).toEqual(['spatial-target']);

    // Empty area query returns empty
    const emptyHits = session.queryObjectsNear({ x: 5000, y: 5000 }, 10);
    expect(emptyHits).toHaveLength(0);

    // Move object to (5000, 5000)
    session.execute({ kind: 'move', id: 'spatial-target', x: 5000, y: 5000 });
    expect(session.queryObjectsNear({ x: 50, y: 50 }, 10)).toHaveLength(0);
    expect(session.queryObjectsNear({ x: 5020, y: 5020 }, 10).map((h) => h.id)).toEqual(['spatial-target']);

    // Delete object
    session.execute({ kind: 'delete', ids: ['spatial-target'] });
    expect(session.queryObjectsNear({ x: 5020, y: 5020 }, 10)).toHaveLength(0);

    session.dispose();
  });
  it('preserves pen pressure through commit, snapshot reload and spatial index queries', () => {
    const ydoc = new Y.Doc();
    const session = createWhiteboardSession({ ydoc, role: 'teacher' });

    const penStroke = {
      id: 'pen-1',
      type: 'pen',
      x: 0,
      y: 0,
      width: 100,
      height: 10,
      color: '#111827',
      lineWidth: 3,
      penStyle: 'gel',
      points: [
        { x: 0, y: 0, t: 0, p: 0.15 },
        { x: 50, y: 5, t: 40, p: 0.9 },
        { x: 100, y: 10, t: 80, p: 0.45 }
      ]
    };
    expect(session.execute({ kind: 'add', object: penStroke })).toEqual({ ok: true });

    // Reload path: the committed snapshot keeps pressure in canonical points.
    const reloaded = session.snapshot().find((object) => object.id === 'pen-1');
    expect(reloaded).toBeTruthy();
    expect(reloaded.points.map((point: { p?: number }) => point.p)).toEqual([0.15, 0.9, 0.45]);

    // Hit testing still finds the committed pressure stroke.
    expect(session.queryObjectsNear({ x: 50, y: 5 }, 8).map((object) => object.id))
      .toContain('pen-1');

    session.dispose();
  });

  it('owns exclusive lesson-panel state without touching the shared document', () => {
    const ydoc = new Y.Doc();
    const changes: Array<string | null> = [];
    const session = createWhiteboardSession({
      ydoc,
      role: 'student',
      onPanelChange: (panel) => changes.push(panel)
    });
    const before = Y.encodeStateAsUpdate(ydoc);

    expect(session.togglePanel('calculator')).toBe('calculator');
    expect(session.togglePanel('mathGraph')).toBe('mathGraph');
    expect(session.activePanel()).toBe('mathGraph');
    expect(session.togglePanel('mathGraph')).toBeNull();
    expect(session.setActivePanel('physicsGraph')).toBe('physicsGraph');
    expect(session.setActivePanel(null)).toBeNull();
    expect(changes).toEqual(['calculator', 'mathGraph', null, 'physicsGraph', null]);
    expect(Y.encodeStateAsUpdate(ydoc)).toEqual(before);
    expect(session.canUndo()).toBe(false);
    session.dispose();
  });

  it('creates, transforms, undoes, and redoes canonical math and physics objects', () => {
    const ydoc = new Y.Doc();
    const session = createWhiteboardSession({ ydoc, role: 'student' });

    expect(session.execute({
      kind: 'add',
      object: {
        id: 'math',
        type: 'mathFunctionPlot',
        x: 20,
        y: 30,
        width: 400,
        height: 300,
        expression: 'x^2',
        xRange: [-5, 5],
        color: '#2563eb',
        lineWidth: 3
      }
    })).toEqual({ ok: true });
    expect(session.execute({
      kind: 'add',
      object: {
        id: 'physics',
        type: 'physicsDataPlot',
        x: 60,
        y: 70,
        width: 400,
        height: 300,
        points: [{ x: 0, y: 0 }, { x: 1, y: 9.8 }],
        xLabel: 't',
        yLabel: 'v',
        color: '#f59e0b',
        lineWidth: 2
      }
    })).toEqual({ ok: true });
    expect(session.execute({
      kind: 'resize',
      id: 'math',
      x: 100,
      y: 120,
      width: 500,
      height: 360
    })).toEqual({ ok: true });
    expect(session.snapshot().find((object) => object.id === 'math')).toMatchObject({
      x: 100,
      y: 120,
      width: 500,
      height: 360
    });

    expect(session.undo()).toBe(true);
    expect(session.snapshot().find((object) => object.id === 'math')).toMatchObject({
      x: 20,
      y: 30,
      width: 400,
      height: 300
    });
    expect(session.redo()).toBe(true);
    expect(session.snapshot()).toHaveLength(2);
    for (const object of session.snapshot()) {
      expect(object).not.toHaveProperty('position');
      expect(object).not.toHaveProperty('xData');
      expect(object).not.toHaveProperty('yData');
    }
    session.dispose();
  });
});
