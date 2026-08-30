import { createHash } from 'crypto';
import * as Y from 'yjs';
import {
  collectUpdateEffects,
  migrateLegacyLessonObjects,
  SCENE_LIMITS,
  validateBoardObject,
  type BoardRole
} from './boardScene';

export type OperationOrigin =
  | { kind: 'hydrate' }
  | { kind: 'remote'; actorId: string; role?: BoardRole }
  | { kind: 'local'; actorId: string; role?: BoardRole };

export type DocumentResult =
  | { ok: true; digest: string }
  | {
      ok: false;
      reason:
        | 'incompatibleUpdate'
        | 'resourceViolation'
        | 'forbiddenCommand'
        | 'invalidObject';
      message: string;
    };

export type BoardScene = Readonly<Record<string, unknown>>;

export interface BoardDocument {
  snapshot(): BoardScene;
  apply(update: Uint8Array, origin: OperationOrigin): DocumentResult;
  encode(stateVector?: Uint8Array): Uint8Array;
  stateVector(): Uint8Array;
  digest(): string;
  /** Run idempotent schema migration after all durable update rows replay. */
  migrateLegacyObjects(): number;
  destroy(): void;
}

export interface CreateBoardDocumentOptions {
  initialState?: Uint8Array;
  maxUpdateBytes?: number;
}

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object' && !(value instanceof Uint8Array)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, stableValue(child)])
    );
  }
  return value;
};

/**
 * Canonical server-side document boundary for collaboration.
 *
 * Yjs remains an implementation detail: callers can apply/encode state and
 * compare a stable digest, but cannot reach the underlying collections. A
 * candidate update is first applied to a shadow document so malformed input
 * never partially changes the live lesson, and every non-hydrate update is
 * validated against the canonical scene schema: each object it adds or
 * modifies must conform, and a whole-board clear (boardMeta clearEpoch bump)
 * is a Teacher-only document action, whatever the client claims.
 */
export const createBoardDocument = (
  options: CreateBoardDocumentOptions = {}
): BoardDocument => {
  const doc = new Y.Doc();
  const maxUpdateBytes = options.maxUpdateBytes ?? 5 * 1024 * 1024;

  if (options.initialState?.length) {
    Y.applyUpdate(doc, options.initialState, 'hydrate');
  }

  const encode = (stateVector?: Uint8Array): Uint8Array =>
    stateVector ? Y.encodeStateAsUpdate(doc, stateVector) : Y.encodeStateAsUpdate(doc);

  const digest = (): string =>
    createHash('sha256').update(encode()).digest('hex');

  return {
    snapshot: () => stableValue(doc.toJSON()) as BoardScene,
    apply: (update, origin) => {
      if (!(update instanceof Uint8Array) || update.length === 0) {
        return {
          ok: false,
          reason: 'incompatibleUpdate',
          message: 'The document update is empty or has an incompatible encoding.'
        };
      }
      if (update.length > maxUpdateBytes) {
        return {
          ok: false,
          reason: 'resourceViolation',
          message: `The document update exceeds ${maxUpdateBytes} bytes.`
        };
      }

      if (origin.kind === 'hydrate') {
        try {
          Y.applyUpdate(doc, update, origin);
          return { ok: true, digest: digest() };
        } catch (error) {
          return {
            ok: false,
            reason: 'incompatibleUpdate',
            message: (error as Error).message
          };
        }
      }

      // Shadow validation: decode + schema + authorization on a scratch
      // document, so a rejected update never partially changes live state.
      let effects: ReturnType<typeof collectUpdateEffects>;
      try {
        effects = collectUpdateEffects(encode(), update);
      } catch (error) {
        return {
          ok: false,
          reason: 'incompatibleUpdate',
          message: (error as Error).message
        };
      }

      if (effects.clearEpochChanged && origin.role !== 'teacher' && origin.role !== 'developer') {
        return {
          ok: false,
          reason: 'forbiddenCommand',
          message: 'Only the Teacher may clear the whole board.'
        };
      }

      if (effects.objectCount > SCENE_LIMITS.maxObjects) {
        return {
          ok: false,
          reason: 'resourceViolation',
          message: `The board exceeds ${SCENE_LIMITS.maxObjects} objects.`
        };
      }

      for (const object of effects.changedObjects) {
        const validation = validateBoardObject(object);
        if (!validation.ok) {
          return {
            ok: false,
            reason: 'invalidObject',
            message: `Object "${String(object.id ?? '?')}" was rejected: ${validation.message}`
          };
        }
      }

      try {
        Y.applyUpdate(doc, update, origin);
        return { ok: true, digest: digest() };
      } catch (error) {
        return {
          ok: false,
          reason: 'incompatibleUpdate',
          message: (error as Error).message
        };
      }
    },
    encode,
    stateVector: () => Y.encodeStateVector(doc),
    digest,
    migrateLegacyObjects: () => migrateLegacyLessonObjects(doc),
    destroy: () => doc.destroy()
  };
};
