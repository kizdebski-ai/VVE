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
  createBoardSpatialIndex,
  normalizeBoardObject,
  sceneDrawings,
  type BoardCommand,
  type BoardRole,
  type BoardSpatialIndex,
  type CommandFailure,
  type SceneObject,
  type ScenePoint
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
  queryObjectsNear(point: ScenePoint, radius: number): SceneObject[];
  spatialIndex(): BoardSpatialIndex;
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

  // Incremental spatial index. Per-map observers catch field mutations
  // (points appended, move/resize fields); the array observer replays its
  // delta so insertions and deletions update the index without ever
  // rebuilding the whole scene per document change or pointer sample.
  const spatialIndex = createBoardSpatialIndex();
  const mapObservers = new WeakMap<Y.Map<unknown>, () => void>();
  const trackedMaps = new Map<string, Y.Map<unknown>>();
  const orderedIds: string[] = [];
  const toSceneObject = (map: Y.Map<unknown>): SceneObject | null => {
    const object = normalizeBoardObject(map.toJSON() as SceneObject);
    return object && typeof object.id === 'string' && object.id ? object : null;
  };
  const trackMap = (map: Y.Map<unknown>, insertionIndex?: number): void => {
    if (mapObservers.has(map)) return;
    const handler = () => {
      const object = toSceneObject(map);
      if (object) spatialIndex.update(object);
    };
    mapObservers.set(map, handler);
    map.observe(handler);
    const object = toSceneObject(map);
    if (object) {
      trackedMaps.set(object.id, map);
      orderedIds.splice(insertionIndex ?? orderedIds.length, 0, object.id);
      spatialIndex.insert(object);
    }
  };
  const untrackMap = (map: Y.Map<unknown>): void => {
    const handler = mapObservers.get(map);
    if (handler) {
      map.unobserve(handler);
      mapObservers.delete(map);
    }
    const object = toSceneObject(map);
    if (object) trackedMaps.delete(object.id);
  };
  const syncSpatialIndexArray = (event: Y.YArrayEvent<unknown>): void => {
    let offset = 0;
    for (const deltaItem of event.delta) {
      if (typeof deltaItem.retain === 'number') {
        offset += deltaItem.retain;
      } else if (Array.isArray(deltaItem.insert)) {
        for (const item of deltaItem.insert) {
          if (item instanceof Y.Map) {
            trackMap(item, offset);
            offset++;
          } else {
            offset++;
          }
        }
      } else if (typeof deltaItem.delete === 'number') {
        const removedIds = orderedIds.splice(offset, deltaItem.delete);
        for (const id of removedIds) {
          const map = trackedMaps.get(id);
          if (map) untrackMap(map);
          spatialIndex.remove(id);
        }
      }
    }
  };
  for (const map of drawings.toArray()) {
    if (map instanceof Y.Map) trackMap(map);
  }
  drawings.observe(syncSpatialIndexArray);

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
    queryObjectsNear: (point: ScenePoint, radius: number) => spatialIndex.queryNear(point, radius),
    spatialIndex: () => spatialIndex,
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
      drawings.unobserve(syncSpatialIndexArray);
      for (const map of Array.from(trackedMaps.values())) untrackMap(map);
      spatialIndex.clear();
      activePanel = null;
      undoManager.off('stack-item-added', notifyHistory);
      undoManager.off('stack-item-popped', notifyHistory);
      undoManager.off('stack-cleared', notifyHistory);
      undoManager.destroy();
    }
  };
};
