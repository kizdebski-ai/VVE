// Canonical board scene schema and command layer (VVE-104, Module 3).
//
// This is the single owner of the document shape shared by the frontend
// session, server-side collaboration validation, rendering and export. It is
// deliberately dependency-free apart from Yjs so the frontend consumes it
// unchanged through the `@pilot` alias (the same seam as `availability.ts`).
//
// Invariants owned here:
// - one canonical geometry representation per object type (no field aliases);
// - every mutation is a typed BoardCommand applied in one Yjs transaction;
// - line bindings follow their target inside the same transaction;
// - a whole-board clear is an explicit command (meta clearEpoch) that is
//   distinguishable from ordinary deletion and reserved for the Teacher;
// - validation bounds coordinates, point counts, string sizes and image size.
import * as Y from 'yjs';
import { MEASURED_RESOURCE_LIMITS } from './resourceLimits';

export type BoardRole = 'teacher' | 'student' | 'developer';

export const BOARD_SCHEMA_VERSION = 1;

export const DRAWINGS_KEY = 'drawings';
export const BOARD_META_KEY = 'boardMeta';
export const CLEAR_EPOCH_KEY = 'clearEpoch';

export const SHAPE_TYPES = [
  'rectangle',
  'square',
  'circle',
  'triangle',
  'diamond',
  'trapezoid',
  'parallelogram',
  'deltoid',
  'cube',
  'cuboid',
  'sphere',
  'cylinder',
  'cone',
  'pyramid',
  'tetrahedron'
] as const;
export type ShapeType = (typeof SHAPE_TYPES)[number];

/** VVE-106 lesson objects with fully canonical, bounded schemas. */
export const LESSON_OBJECT_TYPES = [
  'coordinateSystem2D',
  'coordinateSystem3D',
  'mathFunctionPlot',
  'physicsDataPlot'
] as const;
export type LessonObjectType = (typeof LESSON_OBJECT_TYPES)[number];

export const LESSON_OBJECT_DEFAULTS = {
  coordinateSystem2D: {
    width: 400,
    height: 300,
    grid: true,
    xLabel: 'x',
    yLabel: 'y',
    lineWidth: 2,
    color: '#1f2937'
  },
  coordinateSystem3D: {
    width: 400,
    height: 300,
    grid: true,
    xLabel: 'x',
    yLabel: 'y',
    zLabel: 'z',
    lineWidth: 2,
    color: '#1f2937'
  },
  mathFunctionPlot: {
    width: 400,
    height: 300,
    expression: 'x',
    xRange: [-10, 10] as [number, number],
    xLabel: 'x',
    yLabel: 'f(x)',
    lineWidth: 3,
    color: '#2563eb'
  },
  physicsDataPlot: {
    width: 400,
    height: 300,
    xLabel: 't',
    yLabel: 'v',
    lineWidth: 2,
    color: '#2563eb'
  }
} as const;

export const BINDABLE_TYPES: ReadonlySet<string> = new Set([
  ...SHAPE_TYPES,
  'text',
  'image',
  'coordinateSystem2D',
  'coordinateSystem3D',
  'mathFunctionPlot',
  'physicsDataPlot'
]);

export const LINE_STYLES = ['solid', 'dashed', 'dotted'] as const;
export const ARROW_STYLES = ['none', 'start', 'end', 'both'] as const;

export const SCENE_LIMITS = {
  maxObjects: 20_000,
  maxCoordinate: 1_000_000,
  maxSize: 100_000,
  maxPoints: 20_000,
  maxTextLength: 20_000,
  maxStringLength: 20_000,
  maxColorLength: 64,
  maxIdLength: 128,
  maxLineWidth: 200,
  maxFontSize: 400,
  minFontSize: 4,
  maxRoughness: 3,
  maxImageSrcBytes: MEASURED_RESOURCE_LIMITS.maxImageDataUrlChars,
  maxExtensionJsonBytes: 512 * 1024,
  maxPenConfigJsonBytes: 4 * 1024
} as const;

export interface ScenePoint {
  x: number;
  y: number;
  t?: number;
  /** Pointer pressure in [0, 1]. Omitted when the input device did not report it. */
  p?: number;
}

export interface SceneBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LineBinding {
  elementId: string;
  ratioX: number;
  ratioY: number;
  normalLocal: { x: number; y: number };
  gap: number;
}

export type SceneObject = Record<string, unknown> & { id: string; type: string };

export type ValidationFailure = {
  ok: false;
  reason:
    | 'unknownType'
    | 'invalidId'
    | 'invalidGeometry'
    | 'invalidStyle'
    | 'invalidContent'
    | 'oversized';
  message: string;
};
export type ValidationResult = { ok: true } | ValidationFailure;

export type StylePatch = Partial<{
  color: string;
  lineWidth: number;
  lineStyle: (typeof LINE_STYLES)[number];
  roughness: number;
  fillColor: string | null;
  arrowStyle: (typeof ARROW_STYLES)[number];
  fontSize: number;
}>;

export type BoardCommand =
  | { kind: 'add'; object: SceneObject }
  | { kind: 'updateStyle'; id: string; patch: StylePatch }
  | { kind: 'updateText'; id: string; text: string; width?: number; height?: number }
  | { kind: 'setPenPoints'; id: string; points: ScenePoint[] }
  | { kind: 'move'; id: string; x: number; y: number }
  | { kind: 'resize'; id: string; x: number; y: number; width: number; height: number }
  | { kind: 'rotate'; id: string; rotation: number }
  | {
      kind: 'setLineEndpoints';
      id: string;
      start: ScenePoint;
      end: ScenePoint;
      startBinding?: LineBinding | null;
      endBinding?: LineBinding | null;
    }
  | { kind: 'detachLineBindings'; id: string }
  | { kind: 'translateObjects'; ids: string[]; dx: number; dy: number }
  | { kind: 'delete'; ids: string[] }
  | { kind: 'clone'; id: string; newId: string; offset?: number }
  | { kind: 'clear' };

export type CommandFailure = {
  ok: false;
  reason: 'invalidObject' | 'missingObject' | 'forbiddenCommand' | 'invalidCommand';
  message: string;
};
export type CommandResult = { ok: true } | CommandFailure;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isCoordinate = (value: unknown): value is number =>
  isFiniteNumber(value) && Math.abs(value) <= SCENE_LIMITS.maxCoordinate;

const isSizeValue = (value: unknown): value is number =>
  isFiniteNumber(value) && value >= 0 && value <= SCENE_LIMITS.maxSize;

const isBoundedString = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

const isPlainPoint = (value: unknown): value is ScenePoint => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const point = value as Record<string, unknown>;
  if (!isCoordinate(point.x) || !isCoordinate(point.y)) return false;
  if (point.t !== undefined && !isFiniteNumber(point.t)) return false;
  if (
    point.p !== undefined &&
    (!isFiniteNumber(point.p) || point.p < 0 || point.p > 1)
  ) {
    return false;
  }
  return true;
};

const fail = (reason: ValidationFailure['reason'], message: string): ValidationFailure => ({
  ok: false,
  reason,
  message
});

const commandFail = (reason: CommandFailure['reason'], message: string): CommandFailure => ({
  ok: false,
  reason,
  message
});

const validateCommonStyle = (object: Record<string, unknown>): ValidationResult => {
  if (object.color !== undefined && !isBoundedString(object.color, SCENE_LIMITS.maxColorLength)) {
    return fail('invalidStyle', 'The color value is invalid.');
  }
  if (
    object.lineWidth !== undefined &&
    (!isFiniteNumber(object.lineWidth) ||
      object.lineWidth <= 0 ||
      object.lineWidth > SCENE_LIMITS.maxLineWidth)
  ) {
    return fail('invalidStyle', 'The line width is out of bounds.');
  }
  if (object.rotation !== undefined && !isFiniteNumber(object.rotation)) {
    return fail('invalidGeometry', 'The rotation is not a finite number.');
  }
  if (object.timestamp !== undefined && !isFiniteNumber(object.timestamp)) {
    return fail('invalidContent', 'The timestamp is invalid.');
  }
  if (
    object.lineStyle !== undefined &&
    !LINE_STYLES.includes(object.lineStyle as (typeof LINE_STYLES)[number])
  ) {
    return fail('invalidStyle', 'The line style is unsupported.');
  }
  if (
    object.roughness !== undefined &&
    (!isFiniteNumber(object.roughness) ||
      object.roughness < 0 ||
      object.roughness > SCENE_LIMITS.maxRoughness)
  ) {
    return fail('invalidStyle', 'The roughness is out of bounds.');
  }
  if (
    object.fillColor !== undefined &&
    object.fillColor !== null &&
    !isBoundedString(object.fillColor, SCENE_LIMITS.maxColorLength)
  ) {
    return fail('invalidStyle', 'The fill color is invalid.');
  }
  if (
    object.fillOpacity !== undefined &&
    (!isFiniteNumber(object.fillOpacity) || object.fillOpacity < 0 || object.fillOpacity > 1)
  ) {
    return fail('invalidStyle', 'The fill opacity is out of bounds.');
  }
  if (object.fillStyle !== undefined && !isBoundedString(object.fillStyle, 32)) {
    return fail('invalidStyle', 'The fill style is invalid.');
  }
  if (object.seed !== undefined && !isFiniteNumber(object.seed)) {
    return fail('invalidStyle', 'The seed is invalid.');
  }
  return { ok: true };
};

const validateBounds = (object: Record<string, unknown>): ValidationResult => {
  if (!isCoordinate(object.x) || !isCoordinate(object.y)) {
    return fail('invalidGeometry', 'The object origin is not a finite coordinate.');
  }
  if (!isSizeValue(object.width) || !isSizeValue(object.height)) {
    return fail('invalidGeometry', 'The object dimensions are out of bounds.');
  }
  return { ok: true };
};

const validateBinding = (value: unknown): boolean => {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const binding = value as Record<string, unknown>;
  return (
    isBoundedString(binding.elementId, SCENE_LIMITS.maxIdLength) &&
    isFiniteNumber(binding.ratioX) &&
    isFiniteNumber(binding.ratioY) &&
    isFiniteNumber(binding.gap) &&
    !!binding.normalLocal &&
    typeof binding.normalLocal === 'object' &&
    isFiniteNumber((binding.normalLocal as Record<string, unknown>).x) &&
    isFiniteNumber((binding.normalLocal as Record<string, unknown>).y)
  );
};

const validatePointList = (
  value: unknown,
  minPoints: number
): value is ScenePoint[] =>
  Array.isArray(value) &&
  value.length >= minPoints &&
  value.length <= SCENE_LIMITS.maxPoints &&
  value.every(isPlainPoint);

const jsonByteLength = (value: unknown): number => {
  try {
    return JSON.stringify(value)?.length ?? Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};


/**
 * Validate one scene object against the canonical schema. The input is plain
 * JSON (`Y.Map#toJSON()` output or a command payload), never a Yjs type.
 */
export const validateBoardObject = (value: unknown): ValidationResult => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('invalidContent', 'A board object must be a plain object.');
  }
  const object = value as Record<string, unknown>;

  if (!isBoundedString(object.id, SCENE_LIMITS.maxIdLength)) {
    return fail('invalidId', 'The object id is missing or too long.');
  }
  if (typeof object.type !== 'string') {
    return fail('unknownType', 'The object type is missing.');
  }

  const common = validateCommonStyle(object);
  if (!common.ok) return common;

  const type = object.type;

  const canonicalKeys = (SHAPE_TYPES as readonly string[]).includes(type)
    ? CANONICAL_KEYS.shape
    : CANONICAL_KEYS[type];
  if (canonicalKeys) {
    const unknownKey = Object.keys(object).find((key) => !canonicalKeys.includes(key));
    if (unknownKey) {
      return fail('invalidContent', `The field "${unknownKey}" is not part of the canonical ${type} schema.`);
    }
  }

  if (type === 'pen') {
    if (!validatePointList(object.points, 1)) {
      return fail('invalidGeometry', 'A pen stroke needs a bounded list of finite points.');
    }
    if (
      object.rawPoints !== undefined &&
      !validatePointList(object.rawPoints, 1)
    ) {
      return fail('invalidGeometry', 'The raw point list is invalid.');
    }
    if (object.penStyle !== undefined && !isBoundedString(object.penStyle, 64)) {
      return fail('invalidStyle', 'The pen style is invalid.');
    }
    if (
      object.penConfig !== undefined &&
      jsonByteLength(object.penConfig) > SCENE_LIMITS.maxPenConfigJsonBytes
    ) {
      return fail('oversized', 'The pen configuration is too large.');
    }
    return validateBounds(object);
  }

  if ((SHAPE_TYPES as readonly string[]).includes(type)) {
    if (object.text !== undefined && !isBoundedString(object.text, SCENE_LIMITS.maxTextLength)) {
      return fail('invalidContent', 'The shape label is invalid.');
    }
    return validateBounds(object);
  }

  if (type === 'line') {
    if (!isPlainPoint(object.start) || !isPlainPoint(object.end)) {
      return fail('invalidGeometry', 'A line needs finite start and end points.');
    }
    if (
      object.arrowStyle !== undefined &&
      !ARROW_STYLES.includes(object.arrowStyle as (typeof ARROW_STYLES)[number])
    ) {
      return fail('invalidStyle', 'The arrow style is unsupported.');
    }
    if (!validateBinding(object.startBinding) || !validateBinding(object.endBinding)) {
      return fail('invalidContent', 'A line binding is malformed.');
    }
    return validateBounds(object);
  }

  if (type === 'text') {
    if (!isBoundedString(object.text, SCENE_LIMITS.maxTextLength)) {
      return fail('invalidContent', 'The text content is missing or too long.');
    }
    if (
      object.fontSize !== undefined &&
      (!isFiniteNumber(object.fontSize) ||
        object.fontSize < SCENE_LIMITS.minFontSize ||
        object.fontSize > SCENE_LIMITS.maxFontSize)
    ) {
      return fail('invalidStyle', 'The font size is out of bounds.');
    }
    if (!isCoordinate(object.x) || !isCoordinate(object.y)) {
      return fail('invalidGeometry', 'The text origin is not a finite coordinate.');
    }
    if (object.width !== undefined && !isSizeValue(object.width)) {
      return fail('invalidGeometry', 'The text width is out of bounds.');
    }
    if (object.height !== undefined && !isSizeValue(object.height)) {
      return fail('invalidGeometry', 'The text height is out of bounds.');
    }
    return { ok: true };
  }

  if (type === 'image') {
    if (
      typeof object.src !== 'string' ||
      !object.src.startsWith('data:image/') ||
      object.src.length > SCENE_LIMITS.maxImageSrcBytes
    ) {
      return fail(
        object.src && typeof object.src === 'string' && object.src.length > SCENE_LIMITS.maxImageSrcBytes
          ? 'oversized'
          : 'invalidContent',
        'The image source must be an inline image within the allowed size.'
      );
    }
    return validateBounds(object);
  }

  if (type === 'coordinateSystem2D' || type === 'coordinateSystem3D') {
    const bounds = validateBounds(object);
    if (!bounds.ok) return bounds;
    const labels = type === 'coordinateSystem3D'
      ? [object.xLabel, object.yLabel, object.zLabel]
      : [object.xLabel, object.yLabel];
    if (labels.some((label) => label !== undefined && !isBoundedString(label, 32))) {
      return fail('invalidContent', 'An axis label is missing or too long.');
    }
    if (object.grid !== undefined && typeof object.grid !== 'boolean') {
      return fail('invalidContent', 'The coordinate grid setting is invalid.');
    }
    return { ok: true };
  }

  if (type === 'mathFunctionPlot') {
    const bounds = validateBounds(object);
    if (!bounds.ok) return bounds;
    if (!isBoundedString(object.expression, 1_024)) {
      return fail('invalidContent', 'A mathematical graph needs a bounded expression.');
    }
    const range = object.xRange;
    if (
      !Array.isArray(range) ||
      range.length !== 2 ||
      !isCoordinate(range[0]) ||
      !isCoordinate(range[1]) ||
      range[0] >= range[1]
    ) {
      return fail('invalidGeometry', 'The mathematical graph range is invalid.');
    }
    return { ok: true };
  }

  if (type === 'physicsDataPlot') {
    const bounds = validateBounds(object);
    if (!bounds.ok) return bounds;
    if (!validatePointList(object.points, 2)) {
      return fail('invalidGeometry', 'A physical graph needs at least two finite data points.');
    }
    if (
      (object.points as ScenePoint[]).some((point) =>
        Object.keys(point).some((key) => key !== 'x' && key !== 'y')
      )
    ) {
      return fail('invalidContent', 'A physical graph point must contain only x and y.');
    }
    if (
      [object.xLabel, object.yLabel].some(
        (label) => label !== undefined && !isBoundedString(label, 32)
      )
    ) {
      return fail('invalidContent', 'A physical graph axis label is missing or too long.');
    }
    return { ok: true };
  }


  return fail('unknownType', `The object type "${type}" is not part of the Pilot schema.`);
};

// --- Canonical normalization -------------------------------------------------

const boundsFromPoints = (points: ScenePoint[]) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY)
  };
};

const plainPoint = (point: ScenePoint): ScenePoint => {
  const next: ScenePoint = { x: point.x, y: point.y };
  if (point.t !== undefined) next.t = point.t;
  if (point.p !== undefined) next.p = point.p;
  return next;
};

/**
 * Axis-aligned bounds used by InputPipeline hit testing. Prefers stored
 * `x/y/width/height` (canonical for every S4 family after VVE-104) so a
 * pointer sample never has to convert nested Yjs values.
 */
export const sceneObjectBounds = (object: SceneObject): SceneBounds | null => {
  const x = object.x;
  const y = object.y;
  const width = object.width;
  const height = object.height;
  if (isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(width) && isFiniteNumber(height)) {
    return { x, y, width: Math.abs(width), height: Math.abs(height) };
  }
  const start = object.start as ScenePoint | undefined;
  const end = object.end as ScenePoint | undefined;
  if (isPlainPoint(start) && isPlainPoint(end)) {
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y)
    };
  }
  if (validatePointList(object.points, 1)) {
    return boundsFromPoints(object.points as ScenePoint[]);
  }
  return null;
};

/**
 * Spatial candidate index: spatial hash grid for fast, bounded hit testing.
 * Updated incrementally on document changes instead of converting or scanning
 * the full scene per pointer sample.
 */
export interface BoardSpatialIndex {
  insert(object: SceneObject): void;
  update(object: SceneObject): void;
  remove(id: string): void;
  clear(): void;
  load(objects: readonly SceneObject[]): void;
  size(): number;
  queryNear(point: ScenePoint, radius: number): SceneObject[];
  lastQueryCandidateCount(): number;
}

const DEFAULT_CELL_SIZE = 256;
const MAX_CELL_SPAN = 64;

export const createBoardSpatialIndex = (
  initialObjects?: readonly SceneObject[],
  cellSize = DEFAULT_CELL_SIZE
): BoardSpatialIndex => {
  const grid = new Map<string, Set<string>>();
  interface Entry {
    object: SceneObject;
    bounds: SceneBounds | null;
    cellKeys: string[];
    isLarge: boolean;
    order: number;
  }
  const entries = new Map<string, Entry>();
  const largeObjectIds = new Set<string>();
  let orderSeq = 0;
  let lastCandidatesCount = 0;

  const computeCells = (bounds: SceneBounds): { cellKeys: string[]; isLarge: boolean } => {
    const minCX = Math.floor(bounds.x / cellSize);
    const maxCX = Math.floor((bounds.x + bounds.width) / cellSize);
    const minCY = Math.floor(bounds.y / cellSize);
    const maxCY = Math.floor((bounds.y + bounds.height) / cellSize);
    const totalCells = (maxCX - minCX + 1) * (maxCY - minCY + 1);
    if (totalCells > MAX_CELL_SPAN) {
      return { cellKeys: [], isLarge: true };
    }
    const cellKeys: string[] = [];
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        cellKeys.push(`${cx}:${cy}`);
      }
    }
    return { cellKeys, isLarge: false };
  };

  const removeEntryCells = (entry: Entry) => {
    if (entry.isLarge) {
      largeObjectIds.delete(entry.object.id);
    }
    for (const key of entry.cellKeys) {
      const set = grid.get(key);
      if (set) {
        set.delete(entry.object.id);
        if (set.size === 0) grid.delete(key);
      }
    }
  };

  const insert = (object: SceneObject): void => {
    if (!object || !object.id) return;
    const existing = entries.get(object.id);
    if (existing) {
      update(object);
      return;
    }
    orderSeq++;
    const bounds = sceneObjectBounds(object);
    if (!bounds) {
      largeObjectIds.add(object.id);
      entries.set(object.id, {
        object,
        bounds: null,
        cellKeys: [],
        isLarge: true,
        order: orderSeq
      });
      return;
    }
    const { cellKeys, isLarge } = computeCells(bounds);
    if (isLarge) {
      largeObjectIds.add(object.id);
    } else {
      for (const key of cellKeys) {
        let set = grid.get(key);
        if (!set) {
          set = new Set();
          grid.set(key, set);
        }
        set.add(object.id);
      }
    }
    entries.set(object.id, {
      object,
      bounds,
      cellKeys,
      isLarge,
      order: orderSeq
    });
  };

  const update = (object: SceneObject): void => {
    if (!object || !object.id) return;
    const existing = entries.get(object.id);
    if (!existing) {
      insert(object);
      return;
    }
    removeEntryCells(existing);
    const bounds = sceneObjectBounds(object);
    if (!bounds) {
      largeObjectIds.add(object.id);
      existing.object = object;
      existing.bounds = null;
      existing.cellKeys = [];
      existing.isLarge = true;
      return;
    }
    const { cellKeys, isLarge } = computeCells(bounds);
    if (isLarge) {
      largeObjectIds.add(object.id);
    } else {
      for (const key of cellKeys) {
        let set = grid.get(key);
        if (!set) {
          set = new Set();
          grid.set(key, set);
        }
        set.add(object.id);
      }
    }
    existing.object = object;
    existing.bounds = bounds;
    existing.cellKeys = cellKeys;
    existing.isLarge = isLarge;
  };

  const remove = (id: string): void => {
    const existing = entries.get(id);
    if (!existing) return;
    removeEntryCells(existing);
    entries.delete(id);
  };

  const clear = (): void => {
    grid.clear();
    entries.clear();
    largeObjectIds.clear();
    orderSeq = 0;
    lastCandidatesCount = 0;
  };

  const load = (objects: readonly SceneObject[]): void => {
    clear();
    if (!Array.isArray(objects)) return;
    for (const obj of objects) {
      insert(obj);
    }
  };

  const queryNear = (point: ScenePoint, radius: number): SceneObject[] => {
    if (!isPlainPoint(point) || !Number.isFinite(radius) || radius < 0) {
      lastCandidatesCount = 0;
      return [];
    }
    const minCX = Math.floor((point.x - radius) / cellSize);
    const maxCX = Math.floor((point.x + radius) / cellSize);
    const minCY = Math.floor((point.y - radius) / cellSize);
    const maxCY = Math.floor((point.y + radius) / cellSize);

    const candidateIds = new Set<string>();
    for (const id of largeObjectIds) {
      candidateIds.add(id);
    }
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const set = grid.get(`${cx}:${cy}`);
        if (set) {
          for (const id of set) candidateIds.add(id);
        }
      }
    }
    lastCandidatesCount = candidateIds.size;
    if (candidateIds.size === 0) return [];

    const hits: Entry[] = [];
    for (const id of candidateIds) {
      const entry = entries.get(id);
      if (!entry) continue;
      const bounds = entry.bounds;
      if (!bounds) {
        hits.push(entry);
        continue;
      }
      if (
        point.x >= bounds.x - radius &&
        point.x <= bounds.x + bounds.width + radius &&
        point.y >= bounds.y - radius &&
        point.y <= bounds.y + bounds.height + radius
      ) {
        hits.push(entry);
      }
    }
    // Return top-most-first (reverse document order)
    hits.sort((a, b) => b.order - a.order);
    return hits.map((entry) => entry.object);
  };

  if (initialObjects) {
    load(initialObjects);
  }

  return {
    insert,
    update,
    remove,
    clear,
    load,
    size: () => entries.size,
    queryNear,
    lastQueryCandidateCount: () => lastCandidatesCount
  };
};

/**
 * Bounded candidate query: AABB overlap around a world point. Returns
 * top-most-first (reverse document order) so eraser/select hit testing
 * never walks or converts the rest of the scene. Supports BoardSpatialIndex
 * or a static object array.
 */
export const queryObjectsNear = (
  objectsOrIndex: readonly SceneObject[] | BoardSpatialIndex,
  point: ScenePoint,
  radius: number
): SceneObject[] => {
  if (!isPlainPoint(point) || !Number.isFinite(radius) || radius < 0) return [];
  if (
    typeof objectsOrIndex === 'object' &&
    objectsOrIndex !== null &&
    'queryNear' in objectsOrIndex &&
    typeof (objectsOrIndex as BoardSpatialIndex).queryNear === 'function'
  ) {
    return (objectsOrIndex as BoardSpatialIndex).queryNear(point, radius);
  }
  const objects = objectsOrIndex as readonly SceneObject[];
  const hits: SceneObject[] = [];
  for (let index = objects.length - 1; index >= 0; index--) {
    const object = objects[index];
    if (!object) continue;
    const bounds = sceneObjectBounds(object);
    if (!bounds) continue;
    if (
      point.x >= bounds.x - radius &&
      point.x <= bounds.x + bounds.width + radius &&
      point.y >= bounds.y - radius &&
      point.y <= bounds.y + bounds.height + radius
    ) {
      hits.push(object);
    }
  }
  return hits;
};

const CANONICAL_COMMON_KEYS = ['id', 'type', 'rotation', 'timestamp', 'color', 'lineWidth'] as const;
const CANONICAL_KEYS: Record<string, readonly string[]> = {
  pen: [
    ...CANONICAL_COMMON_KEYS,
    'points',
    'rawPoints',
    'penStyle',
    'penConfig',
    'x',
    'y',
    'width',
    'height'
  ],
  line: [
    ...CANONICAL_COMMON_KEYS,
    'start',
    'end',
    'startBinding',
    'endBinding',
    'arrowStyle',
    'lineStyle',
    'roughness',
    'x',
    'y',
    'width',
    'height'
  ],
  text: [...CANONICAL_COMMON_KEYS, 'text', 'fontSize', 'x', 'y', 'width', 'height'],
  image: [...CANONICAL_COMMON_KEYS, 'src', 'x', 'y', 'width', 'height'],
  coordinateSystem2D: [
    ...CANONICAL_COMMON_KEYS,
    'x',
    'y',
    'width',
    'height',
    'grid',
    'xLabel',
    'yLabel'
  ],
  coordinateSystem3D: [
    ...CANONICAL_COMMON_KEYS,
    'x',
    'y',
    'width',
    'height',
    'grid',
    'xLabel',
    'yLabel',
    'zLabel'
  ],
  mathFunctionPlot: [
    ...CANONICAL_COMMON_KEYS,
    'x',
    'y',
    'width',
    'height',
    'expression',
    'xRange',
    'xLabel',
    'yLabel'
  ],
  physicsDataPlot: [
    ...CANONICAL_COMMON_KEYS,
    'x',
    'y',
    'width',
    'height',
    'points',
    'xLabel',
    'yLabel'
  ],
  shape: [
    ...CANONICAL_COMMON_KEYS,
    'lineStyle',
    'roughness',
    'fillColor',
    'fillStyle',
    'fillOpacity',
    'seed',
    'text',
    'fontSize',
    'x',
    'y',
    'width',
    'height'
  ]
};

/**
 * Normalize a candidate object to its canonical shape: apply canonical
 * lesson-object defaults, derive bounds, and keep only canonical keys.
 * Canonical command paths deliberately do not migrate historical aliases.
 */
export const normalizeBoardObject = (candidate: SceneObject): SceneObject => {
  const object: Record<string, unknown> = { ...candidate };
  const type = String(object.type ?? '');

  if (type === 'coordinateSystem2D') {
    if (object.grid === undefined) object.grid = LESSON_OBJECT_DEFAULTS.coordinateSystem2D.grid;
    if (object.xLabel === undefined) object.xLabel = LESSON_OBJECT_DEFAULTS.coordinateSystem2D.xLabel;
    if (object.yLabel === undefined) object.yLabel = LESSON_OBJECT_DEFAULTS.coordinateSystem2D.yLabel;
    if (object.width === undefined) object.width = LESSON_OBJECT_DEFAULTS.coordinateSystem2D.width;
    if (object.height === undefined) object.height = LESSON_OBJECT_DEFAULTS.coordinateSystem2D.height;
  }
  if (type === 'coordinateSystem3D') {
    if (object.grid === undefined) object.grid = LESSON_OBJECT_DEFAULTS.coordinateSystem3D.grid;
    if (object.xLabel === undefined) object.xLabel = LESSON_OBJECT_DEFAULTS.coordinateSystem3D.xLabel;
    if (object.yLabel === undefined) object.yLabel = LESSON_OBJECT_DEFAULTS.coordinateSystem3D.yLabel;
    if (object.zLabel === undefined) object.zLabel = LESSON_OBJECT_DEFAULTS.coordinateSystem3D.zLabel;
    if (object.width === undefined) object.width = LESSON_OBJECT_DEFAULTS.coordinateSystem3D.width;
    if (object.height === undefined) object.height = LESSON_OBJECT_DEFAULTS.coordinateSystem3D.height;
  }
  if (type === 'mathFunctionPlot') {
    if (object.xRange === undefined) object.xRange = [...LESSON_OBJECT_DEFAULTS.mathFunctionPlot.xRange];
    if (object.expression === undefined) object.expression = LESSON_OBJECT_DEFAULTS.mathFunctionPlot.expression;
    if (object.xLabel === undefined) object.xLabel = LESSON_OBJECT_DEFAULTS.mathFunctionPlot.xLabel;
    if (object.yLabel === undefined) object.yLabel = LESSON_OBJECT_DEFAULTS.mathFunctionPlot.yLabel;
    if (object.width === undefined) object.width = LESSON_OBJECT_DEFAULTS.mathFunctionPlot.width;
    if (object.height === undefined) object.height = LESSON_OBJECT_DEFAULTS.mathFunctionPlot.height;
  }
  if (type === 'physicsDataPlot') {
    if (Array.isArray(object.points)) {
      object.points = object.points.map((point) => {
        if (!point || typeof point !== 'object' || Array.isArray(point)) return point;
        return {
          x: (point as Record<string, unknown>).x,
          y: (point as Record<string, unknown>).y
        };
      });
    }
    if (object.xLabel === undefined) object.xLabel = LESSON_OBJECT_DEFAULTS.physicsDataPlot.xLabel;
    if (object.yLabel === undefined) object.yLabel = LESSON_OBJECT_DEFAULTS.physicsDataPlot.yLabel;
    if (object.width === undefined) object.width = LESSON_OBJECT_DEFAULTS.physicsDataPlot.width;
    if (object.height === undefined) object.height = LESSON_OBJECT_DEFAULTS.physicsDataPlot.height;
  }

  if (object.rotation === undefined) object.rotation = 0;

  if (type === 'pen' && validatePointList(object.points, 1)) {
    const points = (object.points as ScenePoint[]).map(plainPoint);
    object.points = points;
    if (Array.isArray(object.rawPoints)) {
      object.rawPoints = (object.rawPoints as ScenePoint[]).map(plainPoint);
    }
    Object.assign(object, boundsFromPoints(points));
  } else if (type === 'line' && isPlainPoint(object.start) && isPlainPoint(object.end)) {
    const start = plainPoint(object.start as ScenePoint);
    const end = plainPoint(object.end as ScenePoint);
    object.start = start;
    object.end = end;
    object.x = Math.min(start.x, end.x);
    object.y = Math.min(start.y, end.y);
    object.width = Math.abs(end.x - start.x);
    object.height = Math.abs(end.y - start.y);
    if (object.startBinding === null) delete object.startBinding;
    if (object.endBinding === null) delete object.endBinding;
  }

  const canonicalKeys = (SHAPE_TYPES as readonly string[]).includes(type)
    ? CANONICAL_KEYS.shape
    : CANONICAL_KEYS[type];
  if (canonicalKeys) {
    for (const key of Object.keys(object)) {
      if (!canonicalKeys.includes(key)) delete object[key];
    }
  }
  return object as SceneObject;
};

/**
 * Normalize an object arriving through an explicitly legacy-aware import
 * boundary. General board commands must use `normalizeBoardObject` so a
 * newly submitted alias is rejected by the canonical schema.
 */
export const normalizeImportedBoardObject = (candidate: SceneObject): SceneObject => {
  const object: Record<string, unknown> = { ...candidate };
  const type = String(object.type ?? '');
  if (type === 'image' && object.dataUrl !== undefined && object.src === undefined) {
    object.src = object.dataUrl;
  }
  if (object.position && typeof object.position === 'object') {
    const position = object.position as { x?: unknown; y?: unknown };
    if (object.x === undefined && typeof position.x === 'number') object.x = position.x;
    if (object.y === undefined && typeof position.y === 'number') object.y = position.y;
  }
  return normalizeBoardObject(object as SceneObject);
};

// --- Yjs access helpers ------------------------------------------------------

export const sceneDrawings = (doc: Y.Doc): Y.Array<Y.Map<unknown>> =>
  doc.getArray<Y.Map<unknown>>(DRAWINGS_KEY);

export const sceneClearEpoch = (doc: Y.Doc): number => {
  const epoch = doc.getMap(BOARD_META_KEY).get(CLEAR_EPOCH_KEY);
  return typeof epoch === 'number' && Number.isFinite(epoch) ? epoch : 0;
};

const findObjectEntry = (
  doc: Y.Doc,
  id: string
): { map: Y.Map<unknown>; index: number } | null => {
  const drawings = sceneDrawings(doc);
  for (let index = 0; index < drawings.length; index++) {
    const map = drawings.get(index);
    if (map instanceof Y.Map && map.get('id') === id) return { map, index };
  }
  return null;
};

const toSceneMap = (object: SceneObject): Y.Map<unknown> => {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(object)) {
    if (value !== undefined) map.set(key, value);
  }
  return map;
};

const objectJson = (map: Y.Map<unknown>): SceneObject => map.toJSON() as SceneObject;

/**
 * Canonical scene bounds for any board scene object.
 *
 * For canonical lesson objects (`physicsDataPlot`, `mathFunctionPlot`),
 * bounds are strictly defined by their displayed layout rectangle
 * `[x, y, x + width, y + height]`. The `points` property on a physical graph
 * contains plotted data values (e.g. time vs velocity, 0..1,000,000) and
 * must NEVER be treated as world coordinates.
 */
export const canonicalObjectBounds = (
  object: SceneObject | Record<string, unknown>
): [number, number, number, number] | null => {
  if (!object || typeof object !== 'object') return null;
  const type = String(object.type ?? '');

  if (type === 'pen' && Array.isArray(object.points) && object.points.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of object.points as ScenePoint[]) {
      if (p && isFiniteNumber(p.x) && isFiniteNumber(p.y)) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
    if (minX !== Infinity && minY !== Infinity && maxX !== -Infinity && maxY !== -Infinity) {
      return [minX, minY, maxX, maxY];
    }
    return null;
  }

  if (type === 'line' && object.start && object.end) {
    const start = object.start as ScenePoint;
    const end = object.end as ScenePoint;
    if (isFiniteNumber(start.x) && isFiniteNumber(start.y) && isFiniteNumber(end.x) && isFiniteNumber(end.y)) {
      return [
        Math.min(start.x, end.x),
        Math.min(start.y, end.y),
        Math.max(start.x, end.x),
        Math.max(start.y, end.y)
      ];
    }
    return null;
  }

  // All rectangular objects (shapes, lesson objects, text, image, coordinate systems)
  const x = object.x;
  const y = object.y;
  const width = object.width;
  const height = object.height;
  if (isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(width) && isFiniteNumber(height)) {
    const minX = Math.min(x as number, (x as number) + (width as number));
    const maxX = Math.max(x as number, (x as number) + (width as number));
    const minY = Math.min(y as number, (y as number) + (height as number));
    const maxY = Math.max(y as number, (y as number) + (height as number));
    return [minX, minY, maxX, maxY];
  }

  return null;
};

const rectOf = (map: Y.Map<unknown>) => {
  const x = map.get('x');
  const y = map.get('y');
  const width = map.get('width');
  const height = map.get('height');
  const rotation = map.get('rotation');
  if (![x, y, width, height].every(isFiniteNumber)) return null;
  return {
    x: x as number,
    y: y as number,
    width: Math.abs(width as number),
    height: Math.abs(height as number),
    rotation: isFiniteNumber(rotation) ? (rotation as number) : 0
  };
};

/** Anchor point of a binding on its target, offset along the stored normal. */
export const resolveBindingPoint = (
  doc: Y.Doc,
  binding: LineBinding
): ScenePoint | null => {
  const entry = findObjectEntry(doc, binding.elementId);
  if (!entry) return null;
  const rect = rectOf(entry.map);
  if (!rect) return null;
  const rot = (rect.rotation || 0) * (Math.PI / 180);
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const anchorLocal = {
    x: (binding.ratioX ?? 0.5) * rect.width - rect.width / 2,
    y: (binding.ratioY ?? 0.5) * rect.height - rect.height / 2
  };
  const anchorWorld = {
    x: cx + anchorLocal.x * cosR - anchorLocal.y * sinR,
    y: cy + anchorLocal.x * sinR + anchorLocal.y * cosR
  };
  const normalLocal = binding.normalLocal ?? { x: 1, y: 0 };
  const normalWorld = {
    x: normalLocal.x * cosR - normalLocal.y * sinR,
    y: normalLocal.x * sinR + normalLocal.y * cosR
  };
  const length = Math.hypot(normalWorld.x, normalWorld.y) || 1;
  const gap = isFiniteNumber(binding.gap) ? binding.gap : 4;
  return {
    x: anchorWorld.x + (normalWorld.x / length) * gap,
    y: anchorWorld.y + (normalWorld.y / length) * gap
  };
};

const setLineGeometry = (map: Y.Map<unknown>, start: ScenePoint, end: ScenePoint) => {
  map.set('start', plainPoint(start));
  map.set('end', plainPoint(end));
  map.set('x', Math.min(start.x, end.x));
  map.set('y', Math.min(start.y, end.y));
  map.set('width', Math.abs(end.x - start.x));
  map.set('height', Math.abs(end.y - start.y));
};

/** Re-anchor every line bound to `targetId` after its geometry changed. */
const followBindingsForTarget = (doc: Y.Doc, targetId: string) => {
  const drawings = sceneDrawings(doc);
  drawings.forEach((map) => {
    if (!(map instanceof Y.Map) || map.get('type') !== 'line') return;
    const start = map.get('start') as ScenePoint | undefined;
    const end = map.get('end') as ScenePoint | undefined;
    if (!isPlainPoint(start) || !isPlainPoint(end)) return;
    let nextStart = start;
    let nextEnd = end;
    let changed = false;
    const startBinding = map.get('startBinding') as LineBinding | undefined;
    if (startBinding?.elementId === targetId) {
      const point = resolveBindingPoint(doc, startBinding);
      if (point) {
        nextStart = point;
        changed = true;
      }
    }
    const endBinding = map.get('endBinding') as LineBinding | undefined;
    if (endBinding?.elementId === targetId) {
      const point = resolveBindingPoint(doc, endBinding);
      if (point) {
        nextEnd = point;
        changed = true;
      }
    }
    if (changed) setLineGeometry(map, nextStart, nextEnd);
  });
};

/** Remove bindings that reference objects deleted in this transaction. */
const detachBindingsForDeleted = (doc: Y.Doc, deletedIds: ReadonlySet<string>) => {
  sceneDrawings(doc).forEach((map) => {
    if (!(map instanceof Y.Map) || map.get('type') !== 'line') return;
    const startBinding = map.get('startBinding') as LineBinding | undefined;
    if (startBinding && deletedIds.has(startBinding.elementId)) map.delete('startBinding');
    const endBinding = map.get('endBinding') as LineBinding | undefined;
    if (endBinding && deletedIds.has(endBinding.elementId)) map.delete('endBinding');
  });
};

const translateObjectMap = (map: Y.Map<unknown>, dx: number, dy: number) => {
  const type = map.get('type');
  if (type === 'line') {
    const start = map.get('start') as ScenePoint | undefined;
    const end = map.get('end') as ScenePoint | undefined;
    if (isPlainPoint(start) && isPlainPoint(end)) {
      setLineGeometry(
        map,
        { ...start, x: start.x + dx, y: start.y + dy },
        { ...end, x: end.x + dx, y: end.y + dy }
      );
    }
    return;
  }
  if (isFiniteNumber(map.get('x'))) map.set('x', (map.get('x') as number) + dx);
  if (isFiniteNumber(map.get('y'))) map.set('y', (map.get('y') as number) + dy);
  // Pen points are board-space geometry. Physics points are domain data and
  // must remain unchanged when the plot frame moves.
  if (type === 'pen') {
    const points = map.get('points');
    if (Array.isArray(points)) {
      map.set(
        'points',
        points.map((point: ScenePoint) => ({ ...point, x: point.x + dx, y: point.y + dy }))
      );
    }
    if (Array.isArray(map.get('rawPoints'))) {
      map.set(
        'rawPoints',
        (map.get('rawPoints') as ScenePoint[]).map((point) => ({
          ...point,
          x: point.x + dx,
          y: point.y + dy
        }))
      );
    }
  }
};

const resizeObjectMap = (
  map: Y.Map<unknown>,
  frame: { x: number; y: number; width: number; height: number }
): CommandResult => {
  const rect = rectOf(map);
  if (!rect) return commandFail('invalidCommand', 'The object has no resizable bounds.');
  if (!isCoordinate(frame.x) || !isCoordinate(frame.y) || !isSizeValue(frame.width) || !isSizeValue(frame.height)) {
    return commandFail('invalidCommand', 'The requested frame is out of bounds.');
  }
  const scaleX = rect.width === 0 ? 1 : frame.width / rect.width;
  const scaleY = rect.height === 0 ? 1 : frame.height / rect.height;
  // Only pen points describe board-space geometry. Resizing a physical graph
  // changes its frame, not the measured values stored in `points`.
  if (map.get('type') === 'pen') {
    const points = map.get('points');
    if (Array.isArray(points)) {
      map.set(
        'points',
        (points as ScenePoint[]).map((point) => ({
          ...point,
          x: frame.x + (point.x - rect.x) * scaleX,
          y: frame.y + (point.y - rect.y) * scaleY
        }))
      );
      if (Array.isArray(map.get('rawPoints'))) {
        map.set(
          'rawPoints',
          (map.get('rawPoints') as ScenePoint[]).map((point) => ({
            ...point,
            x: frame.x + (point.x - rect.x) * scaleX,
            y: frame.y + (point.y - rect.y) * scaleY
          }))
        );
      }
    }
  }
  map.set('x', frame.x);
  map.set('y', frame.y);
  map.set('width', frame.width);
  map.set('height', frame.height);
  return { ok: true };
};

const STYLE_PATCH_KEYS: readonly (keyof StylePatch)[] = [
  'color',
  'lineWidth',
  'lineStyle',
  'roughness',
  'fillColor',
  'arrowStyle',
  'fontSize'
];

// --- Command application -----------------------------------------------------

export interface CommandContext {
  origin: unknown;
  role: BoardRole;
}

/**
 * Apply one canonical command inside one Yjs transaction. Rejected commands
 * leave the document untouched; there is no partial mutation. This is the
 * only supported write path for product callers — UI adapters and tests must
 * not touch Yjs collections directly.
 */
export const applyBoardCommand = (
  doc: Y.Doc,
  command: BoardCommand,
  context: CommandContext
): CommandResult => {
  const drawings = sceneDrawings(doc);

  switch (command.kind) {
    case 'add': {
      const object = normalizeBoardObject(command.object);
      const validation = validateBoardObject(object);
      if (!validation.ok) return commandFail('invalidObject', validation.message);
      if (drawings.length >= SCENE_LIMITS.maxObjects) {
        return commandFail('invalidObject', 'The board object limit was reached.');
      }
      if (findObjectEntry(doc, object.id)) {
        return commandFail('invalidObject', `An object with id "${object.id}" already exists.`);
      }
      doc.transact(() => {
        drawings.push([toSceneMap(object)]);
      }, context.origin);
      return { ok: true };
    }

    case 'updateStyle': {
      const entry = findObjectEntry(doc, command.id);
      if (!entry) return commandFail('missingObject', `Object "${command.id}" does not exist.`);
      const preview = { ...objectJson(entry.map) };
      for (const key of STYLE_PATCH_KEYS) {
        const value = command.patch[key];
        if (value === undefined) continue;
        if (value === null) delete preview[key];
        else preview[key] = value;
      }
      const validation = validateBoardObject(preview);
      if (!validation.ok) return commandFail('invalidObject', validation.message);
      doc.transact(() => {
        for (const key of STYLE_PATCH_KEYS) {
          const value = command.patch[key];
          if (value === undefined) continue;
          if (value === null) entry.map.delete(key);
          else entry.map.set(key, value);
        }
      }, context.origin);
      return { ok: true };
    }

    case 'updateText': {
      const entry = findObjectEntry(doc, command.id);
      if (!entry) return commandFail('missingObject', `Object "${command.id}" does not exist.`);
      const preview = { ...objectJson(entry.map), text: command.text };
      const validation = validateBoardObject(preview);
      if (!validation.ok) return commandFail('invalidObject', validation.message);
      doc.transact(() => {
        entry.map.set('text', command.text);
        if (isSizeValue(command.width)) entry.map.set('width', command.width);
        if (isSizeValue(command.height)) entry.map.set('height', command.height);
      }, context.origin);
      return { ok: true };
    }

    case 'setPenPoints': {
      const entry = findObjectEntry(doc, command.id);
      if (!entry) return commandFail('missingObject', `Object "${command.id}" does not exist.`);
      if (entry.map.get('type') !== 'pen') {
        return commandFail('invalidCommand', 'Only pen strokes support point replacement.');
      }
      if (!validatePointList(command.points, 1)) {
        return commandFail('invalidObject', 'The replacement point list is invalid.');
      }
      doc.transact(() => {
        const points = command.points.map(plainPoint);
        entry.map.set('points', points);
        const bounds = boundsFromPoints(points);
        entry.map.set('x', bounds.x);
        entry.map.set('y', bounds.y);
        entry.map.set('width', bounds.width);
        entry.map.set('height', bounds.height);
      }, context.origin);
      return { ok: true };
    }

    case 'move': {
      const entry = findObjectEntry(doc, command.id);
      if (!entry) return commandFail('missingObject', `Object "${command.id}" does not exist.`);
      if (!isCoordinate(command.x) || !isCoordinate(command.y)) {
        return commandFail('invalidCommand', 'The move target is out of bounds.');
      }
      const rect = rectOf(entry.map);
      const currentX = rect ? rect.x : 0;
      const currentY = rect ? rect.y : 0;
      const dx = command.x - currentX;
      const dy = command.y - currentY;
      doc.transact(() => {
        translateObjectMap(entry.map, dx, dy);
        followBindingsForTarget(doc, command.id);
      }, context.origin);
      return { ok: true };
    }

    case 'resize': {
      const entry = findObjectEntry(doc, command.id);
      if (!entry) return commandFail('missingObject', `Object "${command.id}" does not exist.`);
      if (entry.map.get('type') === 'line') {
        return commandFail('invalidCommand', 'Lines are resized through their endpoints.');
      }
      let result: CommandResult = { ok: true };
      doc.transact(() => {
        result = resizeObjectMap(entry.map, command);
        if (result.ok) followBindingsForTarget(doc, command.id);
      }, context.origin);
      return result;
    }

    case 'rotate': {
      const entry = findObjectEntry(doc, command.id);
      if (!entry) return commandFail('missingObject', `Object "${command.id}" does not exist.`);
      if (!isFiniteNumber(command.rotation)) {
        return commandFail('invalidCommand', 'The rotation is not a finite number.');
      }
      doc.transact(() => {
        entry.map.set('rotation', command.rotation);
        followBindingsForTarget(doc, command.id);
      }, context.origin);
      return { ok: true };
    }

    case 'setLineEndpoints': {
      const entry = findObjectEntry(doc, command.id);
      if (!entry) return commandFail('missingObject', `Object "${command.id}" does not exist.`);
      if (entry.map.get('type') !== 'line') {
        return commandFail('invalidCommand', 'Only lines have endpoints.');
      }
      if (!isPlainPoint(command.start) || !isPlainPoint(command.end)) {
        return commandFail('invalidCommand', 'The endpoints are out of bounds.');
      }
      if (
        (command.startBinding && !validateBinding(command.startBinding)) ||
        (command.endBinding && !validateBinding(command.endBinding))
      ) {
        return commandFail('invalidCommand', 'A line binding is malformed.');
      }
      doc.transact(() => {
        setLineGeometry(entry.map, command.start, command.end);
        if (command.startBinding !== undefined) {
          if (command.startBinding === null) entry.map.delete('startBinding');
          else entry.map.set('startBinding', command.startBinding);
        }
        if (command.endBinding !== undefined) {
          if (command.endBinding === null) entry.map.delete('endBinding');
          else entry.map.set('endBinding', command.endBinding);
        }
      }, context.origin);
      return { ok: true };
    }

    case 'detachLineBindings': {
      const entry = findObjectEntry(doc, command.id);
      if (!entry) return commandFail('missingObject', `Object "${command.id}" does not exist.`);
      if (entry.map.get('type') !== 'line') {
        return commandFail('invalidCommand', 'Only lines have bindings.');
      }
      doc.transact(() => {
        entry.map.delete('startBinding');
        entry.map.delete('endBinding');
      }, context.origin);
      return { ok: true };
    }

    case 'translateObjects': {
      if (!isFiniteNumber(command.dx) || !isFiniteNumber(command.dy)) {
        return commandFail('invalidCommand', 'The translation delta is invalid.');
      }
      const entries = command.ids.map((id) => findObjectEntry(doc, id));
      if (entries.some((entry) => !entry)) {
        return commandFail('missingObject', 'A translated object does not exist.');
      }
      doc.transact(() => {
        for (const entry of entries) translateObjectMap(entry!.map, command.dx, command.dy);
        for (const id of command.ids) followBindingsForTarget(doc, id);
      }, context.origin);
      return { ok: true };
    }

    case 'delete': {
      const drawingsIds = new Set(command.ids);
      if (!command.ids.length) return commandFail('invalidCommand', 'Nothing to delete.');
      let found = false;
      doc.transact(() => {
        for (let index = drawings.length - 1; index >= 0; index--) {
          const map = drawings.get(index);
          if (map instanceof Y.Map && drawingsIds.has(String(map.get('id')))) {
            drawings.delete(index, 1);
            found = true;
          }
        }
        if (found) detachBindingsForDeleted(doc, drawingsIds);
      }, context.origin);
      return found
        ? { ok: true }
        : commandFail('missingObject', 'None of the objects exist any more.');
    }

    case 'clone': {
      const entry = findObjectEntry(doc, command.id);
      if (!entry) return commandFail('missingObject', `Object "${command.id}" does not exist.`);
      if (findObjectEntry(doc, command.newId)) {
        return commandFail('invalidObject', `An object with id "${command.newId}" already exists.`);
      }
      const offset = isFiniteNumber(command.offset) ? command.offset : 20;
      const source = objectJson(entry.map);
      const clone = normalizeBoardObject({
        ...source,
        id: command.newId,
        timestamp: undefined
      });
      // A clone starts unbound: bindings belong to the original line.
      delete clone.startBinding;
      delete clone.endBinding;
      const validation = validateBoardObject(clone);
      if (!validation.ok) return commandFail('invalidObject', validation.message);
      doc.transact(() => {
        const map = toSceneMap(clone);
        drawings.push([map]);
        translateObjectMap(map, offset, offset);
      }, context.origin);
      return { ok: true };
    }

    case 'clear': {
      if (context.role !== 'teacher' && context.role !== 'developer') {
        return commandFail(
          'forbiddenCommand',
          'Only the Teacher may clear the whole board.'
        );
      }
      doc.transact(() => {
        const meta = doc.getMap(BOARD_META_KEY);
        meta.set(CLEAR_EPOCH_KEY, sceneClearEpoch(doc) + 1);
        if (drawings.length > 0) drawings.delete(0, drawings.length);
      }, context.origin);
      return { ok: true };
    }

    default:
      return commandFail('invalidCommand', 'Unknown board command.');
  }
};

// --- Server-side update inspection -------------------------------------------

export interface UpdateEffects {
  /** JSON of objects added or modified by the update (post-state). */
  changedObjects: SceneObject[];
  removedCount: number;
  clearEpochChanged: boolean;
  objectCount: number;
}

/**
 * Apply a candidate binary update to a scratch document built from
 * `baseState` and report what it touches, without ever mutating live state.
 * Used by the server to validate remote mutations object-by-object instead
 * of rescanning the whole scene, and to authorize the explicit clear command.
 */
export const collectUpdateEffects = (
  baseState: Uint8Array | null,
  update: Uint8Array
): UpdateEffects => {
  const doc = new Y.Doc();
  try {
    if (baseState?.length) Y.applyUpdate(doc, baseState, 'effects-base');
    const drawings = sceneDrawings(doc);
    const epochBefore = sceneClearEpoch(doc);

    const changed = new Set<Y.Map<unknown>>();
    let removedCount = 0;
    const observer = (events: Y.YEvent<any>[]) => {
      for (const event of events) {
        if (event.target === drawings) {
          for (const delta of event.changes.delta) {
            if (delta.delete) removedCount += delta.delete;
            if (Array.isArray(delta.insert)) {
              for (const inserted of delta.insert) {
                if (inserted instanceof Y.Map) changed.add(inserted);
              }
            }
          }
          continue;
        }
        let node: Y.AbstractType<any> | null = event.target;
        while (node && node.parent && node.parent !== drawings) {
          node = node.parent as Y.AbstractType<any>;
        }
        if (node instanceof Y.Map && node.parent === drawings) changed.add(node);
      }
    };
    drawings.observeDeep(observer);
    try {
      Y.applyUpdate(doc, update, 'effects-candidate');
    } finally {
      drawings.unobserveDeep(observer);
    }

    const changedObjects: SceneObject[] = [];
    for (const map of changed) {
      // A map inserted and removed inside the same update no longer has a
      // parent; only surviving objects need validation.
      if (map.parent === drawings) changedObjects.push(objectJson(map));
    }

    return {
      changedObjects,
      removedCount,
      clearEpochChanged: sceneClearEpoch(doc) !== epochBefore,
      objectCount: drawings.length
    };
  } finally {
    doc.destroy();
  }
};
