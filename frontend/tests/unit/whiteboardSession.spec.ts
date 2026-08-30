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
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        position: { x: 25, y: 35 }
      }
    })).toEqual({ ok: true });

    expect(session.snapshot()).toEqual([
      expect.objectContaining({
        id: 'image-1',
        type: 'image',
        src: 'data:image/png;base64,iVBORw0KGgo=',
        x: 0,
        y: 10
      })
    ]);
    expect(session.snapshot()[0]).not.toHaveProperty('dataUrl');
    expect(session.snapshot()[0]).not.toHaveProperty('position');
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
});
