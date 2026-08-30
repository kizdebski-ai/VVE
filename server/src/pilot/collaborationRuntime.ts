import type { AccessGrant } from './capabilityAccess';
import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates
} from 'y-protocols/awareness';
import {
  createBoardDocument,
  type BoardDocument
} from './boardDocument';
import {
  createResourceGovernor,
  polishResourceMessage,
  type ResourceGovernor
} from './resourceGovernor';

export type ClientFrame =
  | { kind: 'mutation'; operationId: string; update: Uint8Array }
  | { kind: 'awareness'; update: Uint8Array };

export type CollaborationDenial =
  | 'unauthorized'
  | 'revoked'
  | 'wrongBoard'
  | 'readOnly'
  | 'notSynchronized'
  | 'malformed'
  | 'forbidden'
  | 'persistenceUnavailable'
  | 'draining'
  | 'internal'
  | 'resource';

export type ServerFrame =
  | { kind: 'sync'; update: Uint8Array }
  | { kind: 'synchronizationComplete'; digest: string }
  | { kind: 'update'; operationId: string; update: Uint8Array }
  | { kind: 'acknowledgement'; operationId: string; digest: string; duplicate: boolean }
  | { kind: 'awareness'; update: Uint8Array }
  | { kind: 'denial'; reason: CollaborationDenial; operationId?: string; messageKey?: string }
  | { kind: 'serverDraining'; reason: string };

export interface CollaborationTransport {
  send(frame: ServerFrame): Promise<void> | void;
  close(code: number, reason: string): Promise<void> | void;
  bufferedBytes?: () => number;
}

export interface AuthenticatedConnection {
  boardId: string;
  grant: AccessGrant;
  /** Re-runs CapabilityAccess against durable state for every mutation. */
  revalidate(): Promise<boolean>;
  /** IP or other occupancy key for ResourceGovernor. */
  clientKey?: string;
}

export interface ConnectionHandle {
  receive(frame: ClientFrame): Promise<ReceiveResult>;
  close(reason: string): Promise<void>;
}

export type ReceiveResult =
  | { accepted: true; operationId?: string; duplicate?: boolean }
  | { accepted: false; reason: CollaborationDenial };

export type CrashPoint =
  | 'afterAppendBeforeApply'
  | 'afterApplyBeforeBroadcast'
  | 'afterBroadcastBeforeAcknowledgement';

export type StoredOperation = {
  sequence: number;
  operationId: string;
  update: Uint8Array;
};

export interface HydratedBoardState {
  snapshot: Uint8Array;
  snapshotCutoff: number;
  operations: StoredOperation[];
}

export interface AppendResult {
  sequence: number;
  duplicate: boolean;
}

export interface BoardDocumentStore {
  hydrate(boardId: string): Promise<HydratedBoardState>;
  append(boardId: string, operationId: string, update: Uint8Array): Promise<AppendResult>;
  compact(boardId: string, snapshot: Uint8Array, cutoff: number): Promise<void>;
}

export class CollaborationFailure extends Error {
  constructor(public readonly code: CollaborationDenial, message: string) {
    super(message);
    this.name = 'CollaborationFailure';
  }
}

type InMemoryRow = StoredOperation;
type InMemoryBoard = {
  snapshot: Uint8Array;
  cutoff: number;
  nextSequence: number;
  rows: InMemoryRow[];
  receipts: Map<string, InMemoryRow>;
};

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const emptyDocumentState = (): Uint8Array => {
  const document = createBoardDocument();
  const state = document.encode();
  document.destroy();
  return state;
};

export interface InMemoryBoardDocumentStoreOptions {
  failAppend?: boolean;
  onEvent?: (event: string) => void;
}

/** Deterministic local Adapter used by the acknowledgement/crash oracle. */
export class InMemoryBoardDocumentStore implements BoardDocumentStore {
  private readonly boards = new Map<string, InMemoryBoard>();

  constructor(private readonly options: InMemoryBoardDocumentStoreOptions = {}) {}

  private board(boardId: string): InMemoryBoard {
    let board = this.boards.get(boardId);
    if (!board) {
      board = {
        snapshot: emptyDocumentState(),
        cutoff: 0,
        nextSequence: 1,
        rows: [],
        receipts: new Map()
      };
      this.boards.set(boardId, board);
    }
    return board;
  }

  async hydrate(boardId: string): Promise<HydratedBoardState> {
    const board = this.board(boardId);
    return {
      snapshot: board.snapshot.slice(),
      snapshotCutoff: board.cutoff,
      operations: board.rows
        .filter((row) => row.sequence > board.cutoff)
        .sort((a, b) => a.sequence - b.sequence)
        .map(({ sequence, operationId, update }) => ({
          sequence,
          operationId,
          update: update.slice()
        }))
    };
  }

  async append(boardId: string, operationId: string, update: Uint8Array): Promise<AppendResult> {
    if (this.options.failAppend) throw new Error('injected persistence failure');
    const board = this.board(boardId);
    const existing = board.receipts.get(operationId);
    if (existing) {
      if (!bytesEqual(existing.update, update)) {
        throw new CollaborationFailure('malformed', 'Operation id was reused with different bytes.');
      }
      return { sequence: existing.sequence, duplicate: true };
    }
    const row: InMemoryRow = {
      sequence: board.nextSequence++,
      operationId,
      update: update.slice()
    };
    board.rows.push(row);
    board.receipts.set(operationId, row);
    this.options.onEvent?.(`append:${operationId}`);
    return { sequence: row.sequence, duplicate: false };
  }

  async compact(boardId: string, snapshot: Uint8Array, cutoff: number): Promise<void> {
    const board = this.board(boardId);
    if (cutoff < board.cutoff) return;
    board.snapshot = snapshot.slice();
    board.cutoff = cutoff;
    board.rows = board.rows.filter((row) => row.sequence > cutoff);
  }

  async inspect(boardId: string) {
    const board = this.board(boardId);
    return {
      operationCount: board.rows.length,
      operationIds: board.rows.map((row) => row.operationId),
      lastSequence: board.nextSequence - 1,
      snapshotCutoff: board.cutoff,
      receiptCount: board.receipts.size
    };
  }
}

type LiveConnection = {
  input: AuthenticatedConnection;
  transport: CollaborationTransport;
  synchronized: boolean;
  closed: boolean;
  awarenessClientIds: Set<number>;
  clientKey: string;
};

type LiveBoard = {
  document: BoardDocument;
  connections: Set<LiveConnection>;
  lastActive: number;
  lastSequence: number;
  operationsSinceCompaction: number;
  queue: Promise<void>;
  awarenessDoc: Y.Doc;
  awareness: Awareness;
};

export interface CollaborationSnapshot {
  boardId: string;
  digest: string;
  encodedState: Uint8Array;
  connections: number;
  lastSequence: number;
}

export interface CreateCollaborationRuntimeOptions {
  store: BoardDocumentStore;
  now?: () => number;
  idleMs?: number;
  compactAfterOperations?: number;
  crashInjector?: (point: CrashPoint) => Promise<void> | void;
  resourceGovernor?: ResourceGovernor;
}

export interface CollaborationRuntime {
  connect(input: AuthenticatedConnection, transport: CollaborationTransport): Promise<ConnectionHandle>;
  inspect(boardId: string): Promise<CollaborationSnapshot>;
  unloadIdle(): Promise<string[]>;
  closeBoard(boardId: string, reason: string): Promise<boolean>;
  drain(input: { deadline: Date; reason: string }): Promise<{ boards: number; connections: number; complete: boolean }>;
}

const validOperationId = (value: string): boolean =>
  value.length >= 1 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value);

// Fail closed: only an explicit Teacher grant carries Teacher document
// authority. Any other role (including an unexpected one) edits as a Student.
const documentRole = (role: string): 'teacher' | 'student' =>
  role === 'teacher' ? 'teacher' : 'student';

export const createCollaborationRuntime = (
  options: CreateCollaborationRuntimeOptions
): CollaborationRuntime => {
  const now = options.now ?? Date.now;
  const idleMs = options.idleMs ?? 30_000;
  const compactAfterOperations = options.compactAfterOperations ?? 20;
  const governor = options.resourceGovernor ?? createResourceGovernor();
  const rooms = new Map<string, LiveBoard>();
  const hydration = new Map<string, Promise<LiveBoard>>();
  let draining = false;

  const hydrate = async (boardId: string): Promise<LiveBoard> => {
    const current = rooms.get(boardId);
    if (current) return current;
    const pending = hydration.get(boardId);
    if (pending) return pending;

    const task = (async () => {
      let stored: HydratedBoardState;
      try {
        stored = await options.store.hydrate(boardId);
      } catch (error) {
        throw new CollaborationFailure('persistenceUnavailable', (error as Error).message);
      }
      const hydrationBytes =
        stored.snapshot.byteLength +
        stored.operations.reduce((sum, operation) => sum + operation.update.byteLength, 0);
      governor.admit({ kind: 'boardHydration', bytes: hydrationBytes, boardId }, { now: now() });
      const document = createBoardDocument({ initialState: stored.snapshot });
      for (const operation of stored.operations.sort((a, b) => a.sequence - b.sequence)) {
        const result = document.apply(operation.update, { kind: 'hydrate' });
        if (!result.ok) {
          document.destroy();
          throw new CollaborationFailure('persistenceUnavailable', `Stored update ${operation.sequence} is invalid.`);
        }
      }
      const awarenessDoc = new Y.Doc();
      const awareness = new Awareness(awarenessDoc);
      // The server is a relay, not a lesson participant.
      awareness.setLocalState(null);
      const room: LiveBoard = {
        document,
        connections: new Set(),
        lastActive: now(),
        lastSequence:
          stored.operations[stored.operations.length - 1]?.sequence ?? stored.snapshotCutoff,
        operationsSinceCompaction: stored.operations.length,
        queue: Promise.resolve(),
        awarenessDoc,
        awareness
      };
      rooms.set(boardId, room);
      return room;
    })();
    hydration.set(boardId, task);
    try {
      return await task;
    } finally {
      hydration.delete(boardId);
    }
  };

  const serial = async <T>(room: LiveBoard, action: () => Promise<T>): Promise<T> => {
    const previous = room.queue;
    let release!: () => void;
    room.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  };

  const connect = async (
    input: AuthenticatedConnection,
    transport: CollaborationTransport
  ): Promise<ConnectionHandle> => {
    if (draining) throw new CollaborationFailure('draining', 'The collaboration runtime is draining.');
    if (!input.grant.granted || input.grant.action !== 'board.edit') {
      throw new CollaborationFailure('unauthorized', 'A board.edit grant is required.');
    }
    if (!input.grant.boardId || input.grant.boardId !== input.boardId) {
      throw new CollaborationFailure('wrongBoard', 'The grant does not target this board.');
    }
    if (!(await input.revalidate())) {
      throw new CollaborationFailure('revoked', 'The durable grant is no longer active.');
    }

    const clientKey = input.clientKey && input.clientKey.length > 0 ? input.clientKey : 'anonymous';
    const connectionAdmit = governor.admit(
      { kind: 'connection', clientKey, boardId: input.boardId },
      { now: now() }
    );
    if (connectionAdmit.decision !== 'allow' && connectionAdmit.decision !== 'allowWithBudget') {
      throw new CollaborationFailure(
        'resource',
        polishResourceMessage(
          'messageKey' in connectionAdmit ? connectionAdmit.messageKey : 'resource.connectionLimit'
        )
      );
    }

    let slotHeld = true;
    const releaseSlot = () => {
      if (!slotHeld) return;
      slotHeld = false;
      governor.observe({
        kind: 'connectionClosed',
        clientKey,
        boardId: input.boardId
      });
    };

    let room: LiveBoard;
    try {
      room = await hydrate(input.boardId);
    } catch (error) {
      releaseSlot();
      throw error;
    }
    const live: LiveConnection = {
      input,
      transport,
      synchronized: false,
      closed: false,
      awarenessClientIds: new Set(),
      clientKey
    };
    room.connections.add(live);
    room.lastActive = now();

    try {
      await transport.send({ kind: 'sync', update: room.document.encode() });
      const existingAwareness = Array.from(room.awareness.getStates().keys());
      if (existingAwareness.length) {
        await transport.send({
          kind: 'awareness',
          update: encodeAwarenessUpdate(room.awareness, existingAwareness)
        });
      }
      await transport.send({ kind: 'synchronizationComplete', digest: room.document.digest() });
      live.synchronized = true;
    } catch (error) {
      room.connections.delete(live);
      releaseSlot();
      throw new CollaborationFailure('internal', (error as Error).message);
    }

    const close = async (reason: string) => {
      if (live.closed) return;
      live.closed = true;
      room.connections.delete(live);
      releaseSlot();
      room.lastActive = now();
      if (live.awarenessClientIds.size) {
        const removed = Array.from(live.awarenessClientIds);
        removeAwarenessStates(room.awareness, removed, live);
        const removalUpdate = encodeAwarenessUpdate(room.awareness, removed);
        for (const peer of room.connections) {
          if (!peer.closed) await peer.transport.send({ kind: 'awareness', update: removalUpdate });
        }
        live.awarenessClientIds.clear();
      }
      // The last participant leaving is a prompt durability boundary. The
      // idle timer only releases memory later; it is not responsible for
      // making the completed lesson restart-safe.
      if (room.connections.size === 0) {
        await serial(room, async () => {
          await options.store.compact(input.boardId, room.document.encode(), room.lastSequence);
          room.operationsSinceCompaction = 0;
        });
      }
    };

    const receive = async (frame: ClientFrame): Promise<ReceiveResult> => {
      if (live.closed) return { accepted: false, reason: 'unauthorized' };
      room.lastActive = now();

      if (frame.kind === 'awareness') {
        let changed: { added: number[]; updated: number[]; removed: number[] } = {
          added: [],
          updated: [],
          removed: []
        };
        const capture = (event: typeof changed, origin: unknown) => {
          if (origin === live) changed = event;
        };
        room.awareness.on('update', capture);
        try {
          applyAwarenessUpdate(room.awareness, frame.update, live);
        } finally {
          room.awareness.off('update', capture);
        }
        changed.added.concat(changed.updated).forEach((id) => live.awarenessClientIds.add(id));
        changed.removed.forEach((id) => live.awarenessClientIds.delete(id));
        for (const peer of room.connections) {
          if (peer !== live && !peer.closed) await peer.transport.send(frame);
        }
        return { accepted: true };
      }

      if (!live.synchronized) {
        await transport.send({ kind: 'denial', reason: 'notSynchronized' });
        return { accepted: false, reason: 'notSynchronized' };
      }
      if (!validOperationId(frame.operationId) || !(frame.update instanceof Uint8Array) || frame.update.length === 0) {
        await transport.send({ kind: 'denial', reason: 'malformed' });
        return { accepted: false, reason: 'malformed' };
      }
      if (!(await input.revalidate())) {
        await transport.send({ kind: 'denial', reason: 'revoked' });
        await transport.close(1008, 'Access revoked');
        await close('revoked');
        return { accepted: false, reason: 'revoked' };
      }

      const messageAdmit = governor.admit(
        { kind: 'message', bytes: frame.update.byteLength, clientKey, boardId: input.boardId },
        { now: now() }
      );
      if (messageAdmit.decision !== 'allow' && messageAdmit.decision !== 'allowWithBudget') {
        const messageKey =
          'messageKey' in messageAdmit ? messageAdmit.messageKey : 'resource.messageRate';
        await transport.send({ kind: 'denial', reason: 'resource', operationId: frame.operationId, messageKey });
        return { accepted: false, reason: 'resource' };
      }
      const updateAdmit = governor.admit(
        { kind: 'documentUpdate', bytes: frame.update.byteLength, clientKey, boardId: input.boardId },
        { now: now() }
      );
      if (updateAdmit.decision !== 'allow' && updateAdmit.decision !== 'allowWithBudget') {
        const messageKey =
          'messageKey' in updateAdmit ? updateAdmit.messageKey : 'resource.updateTooLarge';
        await transport.send({ kind: 'denial', reason: 'resource', operationId: frame.operationId, messageKey });
        return { accepted: false, reason: 'resource' };
      }

      return serial(room, async () => {
        const shadow = createBoardDocument({ initialState: room.document.encode() });
        const validation = shadow.apply(frame.update, {
          kind: 'remote',
          actorId: `${input.grant.role}:${input.grant.teacherId ?? 'student'}`,
          role: documentRole(input.grant.role)
        });
        shadow.destroy();
        if (!validation.ok) {
          const reason: CollaborationDenial =
            validation.reason === 'forbiddenCommand'
              ? 'forbidden'
              : validation.reason === 'resourceViolation'
                ? 'resource'
                : 'malformed';
          const denial: ServerFrame =
            reason === 'resource'
              ? {
                  kind: 'denial',
                  reason,
                  operationId: frame.operationId,
                  messageKey: 'resource.updateTooLarge'
                }
              : { kind: 'denial', reason, operationId: frame.operationId };
          await transport.send(denial);
          return { accepted: false, reason };
        }

        let append: AppendResult;
        try {
          append = await options.store.append(input.boardId, frame.operationId, frame.update);
        } catch (error) {
          if (error instanceof CollaborationFailure) throw error;
          throw new CollaborationFailure('persistenceUnavailable', (error as Error).message);
        }
        room.lastSequence = Math.max(room.lastSequence, append.sequence);
        await options.crashInjector?.('afterAppendBeforeApply');

        const applied = room.document.apply(frame.update, {
          kind: 'remote',
          actorId: `${input.grant.role}:${input.grant.teacherId ?? 'student'}`,
          role: documentRole(input.grant.role)
        });
        if (!applied.ok) {
          throw new CollaborationFailure('internal', applied.message);
        }
        await options.crashInjector?.('afterApplyBeforeBroadcast');

        for (const peer of room.connections) {
          if (peer === live || peer.closed) continue;
          const buffered = peer.transport.bufferedBytes?.() ?? 0;
          const slow = governor.admit(
            {
              kind: 'slowClientBuffer',
              bytes: buffered + frame.update.byteLength,
              clientKey: peer.clientKey,
              boardId: input.boardId
            },
            { now: now() }
          );
          if (slow.decision === 'reject' || slow.decision === 'retryAfter' || slow.decision === 'readOnly') {
            peer.closed = true;
            room.connections.delete(peer);
            governor.observe({
              kind: 'connectionClosed',
              clientKey: peer.clientKey,
              boardId: input.boardId
            });
            await peer.transport.send({
              kind: 'denial',
              reason: 'resource',
              messageKey: 'resource.slowClient'
            });
            await peer.transport.close(1013, 'Slow consumer');
            continue;
          }
          await peer.transport.send({
            kind: 'update',
            operationId: frame.operationId,
            update: frame.update
          });
        }
        await options.crashInjector?.('afterBroadcastBeforeAcknowledgement');

        await transport.send({
          kind: 'acknowledgement',
          operationId: frame.operationId,
          digest: room.document.digest(),
          duplicate: append.duplicate
        });

        if (!append.duplicate) room.operationsSinceCompaction += 1;
        if (room.operationsSinceCompaction >= compactAfterOperations) {
          await options.store.compact(input.boardId, room.document.encode(), room.lastSequence);
          room.operationsSinceCompaction = 0;
        }
        return { accepted: true, operationId: frame.operationId, duplicate: append.duplicate };
      });
    };

    return { receive, close };
  };

  const inspect = async (boardId: string): Promise<CollaborationSnapshot> => {
    const room = await hydrate(boardId);
    return {
      boardId,
      digest: room.document.digest(),
      encodedState: room.document.encode(),
      connections: room.connections.size,
      lastSequence: room.lastSequence
    };
  };

  const unloadIdle = async (): Promise<string[]> => {
    const unloaded: string[] = [];
    for (const [boardId, room] of rooms) {
      if (room.connections.size > 0 || now() - room.lastActive < idleMs) continue;
      await serial(room, async () => {
        await options.store.compact(boardId, room.document.encode(), room.lastSequence);
      });
      room.document.destroy();
      room.awareness.destroy();
      room.awarenessDoc.destroy();
      rooms.delete(boardId);
      unloaded.push(boardId);
    }
    return unloaded;
  };

  const closeBoard = async (boardId: string, reason: string): Promise<boolean> => {
    const room = rooms.get(boardId);
    if (!room) return false;
    const connections = Array.from(room.connections);
    room.connections.clear();
    const awarenessClientIds = connections.flatMap((connection) =>
      Array.from(connection.awarenessClientIds)
    );
    if (awarenessClientIds.length) {
      removeAwarenessStates(room.awareness, awarenessClientIds, 'board-closed');
    }
    for (const connection of connections) {
      connection.closed = true;
      governor.observe({
        kind: 'connectionClosed',
        clientKey: connection.clientKey,
        boardId
      });
      await connection.transport.send({ kind: 'denial', reason: 'revoked' });
      await connection.transport.close(1008, reason);
    }
    room.lastActive = now();
    return true;
  };

  const drain: CollaborationRuntime['drain'] = async ({ deadline, reason }) => {
    draining = true;
    let connectionCount = 0;
    for (const [boardId, room] of rooms) {
      connectionCount += room.connections.size;
      for (const connection of room.connections) {
        await connection.transport.send({ kind: 'serverDraining', reason });
      }
      await serial(room, async () => {
        await options.store.compact(boardId, room.document.encode(), room.lastSequence);
      });
    }
    return {
      boards: rooms.size,
      connections: connectionCount,
      complete: now() <= deadline.getTime()
    };
  };

  return { connect, inspect, unloadIdle, closeBoard, drain };
};
