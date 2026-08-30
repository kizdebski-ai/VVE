// WhiteboardSession (VVE-104, Module 4): the only write path from the UI to
// the board document. Vue components and composables dispatch typed commands;
// the canonical semantics (schema, bindings, teacher-only clear) live in the
// shared `@pilot/boardScene` module, so the client and the server enforce the
// same contract and a denial is the exception, not the rule.
//
// Interface guarantees:
// - one executed command == one participant-scoped undo entry;
// - undo/redo only ever touches this participant's own transactions
//   (a single unique session origin object is the UndoManager scope);
// - commands are refused while the connection is read-only;
// - a Student session refuses the whole-board clear locally, mirroring the
//   server-authoritative rule.
import * as Y from 'yjs';
import {
  applyBoardCommand,
  normalizeBoardObject,
  sceneDrawings,
  type BoardCommand,
  type BoardRole,
  type CommandFailure,
  type SceneObject
} from '@pilot/boardScene';

export type SessionResult =
  | { ok: true }
  | { ok: false; reason: CommandFailure['reason'] | 'readOnly'; message: string };

export type LessonPanel = 'calculator' | 'mathGraph' | 'physicsGraph';

export interface WhiteboardSession {
  execute(command: BoardCommand): SessionResult;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  snapshot(): readonly SceneObject[];
  select(id: string | null): boolean;
  selectedObjectId(): string | null;
  viewport(): Readonly<SessionViewport>;
  setViewport(next: SessionViewport): Readonly<SessionViewport>;
  panBy(dx: number, dy: number): Readonly<SessionViewport>;
  zoomAt(screenX: number, screenY: number, zoom: number): Readonly<SessionViewport>;
  resetViewport(): Readonly<SessionViewport>;
  /** Local panel state; setting one panel atomically closes the previous one. */
  setActivePanel(panel: LessonPanel | null): LessonPanel | null;
  togglePanel(panel: LessonPanel): LessonPanel | null;
  activePanel(): LessonPanel | null;
  newObjectId(): string;
  /** True while this session may write (synchronized or local board). */
  isEditable(): boolean;
  role: BoardRole;
  dispose(): void;
}

export interface SessionViewport {
  zoom: number;
  panX: number;
  panY: number;
}

export interface CreateWhiteboardSessionOptions {
  ydoc: Y.Doc;
  role: BoardRole;
  isEditable?: () => boolean;
  initialViewport?: SessionViewport;
  onHistoryChange?: (state: { canUndo: boolean; canRedo: boolean }) => void;
  onPanelChange?: (panel: LessonPanel | null) => void;
}

/** Polish copy for the user-facing failure surface (spec: Polish UI text). */
const POLISH_FAILURE: Record<CommandFailure['reason'] | 'readOnly', string> = {
  readOnly: 'Tablica jest w trybie tylko do odczytu — poczekaj na połączenie.',
  forbiddenCommand: 'Tylko nauczyciel może wyczyścić całą tablicę.',
  invalidObject: 'Nie można dodać tego obiektu do tablicy.',
  missingObject: 'Ten obiekt już nie istnieje na tablicy.',
  invalidCommand: 'Ta operacja jest nieprawidłowa.'
};

export const createWhiteboardSession = (
  options: CreateWhiteboardSessionOptions
): WhiteboardSession => {
  const { ydoc, role } = options;
  const isEditable = options.isEditable ?? (() => true);
  // Undo scope: one unique object per session. Remote transactions carry a
  // different origin, so the UndoManager can never rewind another
  // participant's work, and a reload (new session object) resets history.
  const sessionOrigin = { whiteboardSession: true, role };
  const drawings = ydoc.getArray('drawings');
  const undoManager = new Y.UndoManager(drawings, {
    trackedOrigins: new Set<unknown>([sessionOrigin]),
    captureTimeout: 0
  });

  const notifyHistory = () =>
    options.onHistoryChange?.({
      canUndo: undoManager.canUndo(),
      canRedo: undoManager.canRedo()
    });
  undoManager.on('stack-item-added', notifyHistory);
  undoManager.on('stack-item-popped', notifyHistory);
  undoManager.on('stack-cleared', notifyHistory);
  let selection: string | null = null;
  let viewport: SessionViewport = options.initialViewport ?? { zoom: 1, panX: 0, panY: 0 };
  let activePanel: LessonPanel | null = null;

  const commitViewport = (next: SessionViewport): Readonly<SessionViewport> => {
    if (
      Number.isFinite(next.zoom) && next.zoom > 0 &&
      Number.isFinite(next.panX) && Number.isFinite(next.panY)
    ) {
      viewport = { ...next };
    }
    return { ...viewport };
  };

  const execute = (command: BoardCommand): SessionResult => {
    if (!isEditable()) {
      return { ok: false, reason: 'readOnly', message: POLISH_FAILURE.readOnly };
    }
    // Consecutive commands must never merge into one undo entry.
    undoManager.stopCapturing();
    const result = applyBoardCommand(ydoc, command, { origin: sessionOrigin, role });
    if (!result.ok) {
      return { ok: false, reason: result.reason, message: POLISH_FAILURE[result.reason] };
    }
    return { ok: true };
  };

  return {
    execute,
    undo: () => {
      if (!isEditable() || !undoManager.canUndo()) return false;
      undoManager.undo();
      return true;
    },
    redo: () => {
      if (!isEditable() || !undoManager.canRedo()) return false;
      undoManager.redo();
      return true;
    },
    canUndo: () => undoManager.canUndo(),
    canRedo: () => undoManager.canRedo(),
    snapshot: () => sceneDrawings(ydoc).toArray().map((map) =>
      normalizeBoardObject(map.toJSON() as SceneObject)
    ),
    select: (id) => {
      if (id === null) {
        selection = null;
        return true;
      }
      const exists = sceneDrawings(ydoc).toArray().some((map) => map.get('id') === id);
      if (!exists) return false;
      selection = id;
      return true;
    },
    selectedObjectId: () => selection,
    viewport: () => ({ ...viewport }),
    setViewport: commitViewport,
    panBy: (dx, dy) => commitViewport({
      ...viewport,
      panX: viewport.panX + (Number.isFinite(dx) ? dx : 0),
      panY: viewport.panY + (Number.isFinite(dy) ? dy : 0)
    }),
    zoomAt: (screenX, screenY, zoom) => {
      if (!Number.isFinite(screenX) || !Number.isFinite(screenY) || !Number.isFinite(zoom) || zoom <= 0) {
        return { ...viewport };
      }
      const ratio = zoom / viewport.zoom;
      return commitViewport({
        zoom,
        panX: screenX - (screenX - viewport.panX) * ratio,
        panY: screenY - (screenY - viewport.panY) * ratio
      });
    },
    resetViewport: () => commitViewport({ zoom: 1, panX: 0, panY: 0 }),
    setActivePanel: (panel) => {
      activePanel = panel;
      options.onPanelChange?.(activePanel);
      return activePanel;
    },
    togglePanel: (panel) => {
      activePanel = activePanel === panel ? null : panel;
      options.onPanelChange?.(activePanel);
      return activePanel;
    },
    activePanel: () => activePanel,
    newObjectId: () => {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return `obj-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    },
    isEditable,
    role,
    dispose: () => {
      selection = null;
      activePanel = null;
      undoManager.off('stack-item-added', notifyHistory);
      undoManager.off('stack-item-popped', notifyHistory);
      undoManager.off('stack-cleared', notifyHistory);
      undoManager.destroy();
    }
  };
};
