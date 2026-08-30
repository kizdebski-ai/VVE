/**
 * RuntimeControl — Module 11 of the VVE Pilot deep-module design (slice S8).
 *
 * The executable process lifecycle used by the Railway entry point and
 * process-level integration tests:
 *
 *   start()  → validate, connect, migrate, construct, listen, mark ready
 *   status() → separate liveness and readiness
 *   stop()   → unready, reject admissions, drain, flush, close, report
 *
 * Invalid configuration, dependency-unavailable, migration-failed,
 * listener-failed, drain-timeout, and flush-failed are typed outcomes.
 * Startup and stop are serialized and idempotent. The process Adapter
 * (server.ts) owns OS signals; this Module never calls process.exit.
 */

import { monitorEventLoopDelay, type IntervalHistogram } from 'perf_hooks';
import type { Knex } from 'knex';
import type { Server } from 'http';

import { config as processConfig } from '../config';
import { bindDb, createDb, destroyDb } from '../db';
import { logger } from '../logger';
import { FilePersistence } from '../persistence';
import { RoomManager } from '../rooms';
import { OpenRouterEquationSolver } from '../services/aiSolver';
import { createCapabilityAccess } from './capabilityAccess';
import { createBoardLifecycle, type BoardLifecycle } from './boardLifecycle';
import {
  createCollaborationRuntime,
  type BoardDocumentStore,
  type CollaborationRuntime
} from './collaborationRuntime';
import { createPostgresBoardDocumentStore } from './postgresBoardDocumentStore';
import {
  createOperationalSignals,
  type OperationalSignals,
  type OperationalSnapshot
} from './operationalSignals';
import { createRealtimeListener, type RealtimeListener } from './realtimeListener';
import type { RuntimeHealthGateway } from '../httpApp';
import { createPilotAvailability } from './availability';

export type LifecycleFailureKind =
  | 'invalid-configuration'
  | 'dependency-unavailable'
  | 'migration-failed'
  | 'listener-failed'
  | 'drain-timeout'
  | 'flush-failed';

export class RuntimeControlFailure extends Error {
  constructor(
    public readonly kind: LifecycleFailureKind,
    message: string
  ) {
    super(message);
    this.name = 'RuntimeControlFailure';
  }
}

export type RuntimePhase =
  | 'idle'
  | 'starting'
  | 'ready'
  | 'draining'
  | 'stopped'
  | 'failed';

export interface RuntimeStatus {
  phase: RuntimePhase;
  live: boolean;
  ready: boolean;
  host: string | null;
  port: number | null;
  startedAt: string | null;
  lastError: { kind: LifecycleFailureKind; message: string } | null;
  resources: {
    timers: string[];
    listeners: string[];
    pools: string[];
  };
}

export interface ShutdownReport {
  clean: boolean;
  reason: string;
  phase: RuntimePhase;
  remaining: string[];
  drain: { boards: number; connections: number; complete: boolean } | null;
  flushed: boolean;
  listenersClosed: boolean;
  databaseClosed: boolean;
  timersStopped: boolean;
  deadlineExceeded: boolean;
  durationMs: number;
}

export interface RunningRuntime {
  status(): RuntimeStatus;
  stop(input: { reason: string; deadline: Date }): Promise<ShutdownReport>;
  port: number;
  host: string;
}

export interface RuntimeControlConfig {
  nodeEnv: string;
  host: string;
  port: number;
  databaseUrl: string | undefined;
  adminPassphrase: string | undefined;
  teacherSessionSecret: string;
  adminSessionSecret: string;
  dataDir: string;
  pingIntervalMs: number;
  roomTtlMs: number;
  pilotEnvironment: 'pilot' | 'development';
  devSurface: boolean;
}

export interface RuntimeControlOptions {
  signals?: OperationalSignals;
  now?: () => number;
  config?: Partial<RuntimeControlConfig>;
  createDatabase?: (url: string) => Knex;
  migrate?: (db: Knex) => Promise<void>;
  probe?: (input: { db: Knex; store: BoardDocumentStore }) => Promise<{ database: boolean; persistence: boolean }>;
  listen?: (server: Server, host: string, port: number) => Promise<number>;
  createStore?: (db: Knex) => BoardDocumentStore;
  createCollaboration?: (store: BoardDocumentStore) => CollaborationRuntime;
}

export interface RuntimeControl {
  start(): Promise<RunningRuntime>;
  status(): RuntimeStatus;
  stop(input: { reason: string; deadline: Date }): Promise<ShutdownReport>;
}

const defaultConfig = (): RuntimeControlConfig => ({
  nodeEnv: processConfig.nodeEnv,
  host: processConfig.host,
  port: processConfig.port,
  databaseUrl: processConfig.databaseUrl,
  adminPassphrase: processConfig.adminPassphrase,
  teacherSessionSecret: processConfig.teacherSessionSecret,
  adminSessionSecret: processConfig.adminSessionSecret,
  dataDir: processConfig.dataDir,
  pingIntervalMs: processConfig.pingIntervalMs,
  roomTtlMs: processConfig.roomTtlMs,
  pilotEnvironment: processConfig.pilotEnvironment,
  devSurface: processConfig.devSurface
});

const missingSecrets = (cfg: RuntimeControlConfig): string[] => {
  const missing: string[] = [];
  if (!cfg.databaseUrl) missing.push('DATABASE_URL');
  if (cfg.nodeEnv === 'production') {
    if (!cfg.adminPassphrase) missing.push('ADMIN_PASSPHRASE');
    if (cfg.teacherSessionSecret === 'change-me-in-prod') missing.push('TEACHER_SESSION_SECRET');
    if (cfg.adminSessionSecret === 'change-me-in-prod') missing.push('ADMIN_SESSION_SECRET');
  }
  return missing;
};

const defaultProbe = async ({
  db,
  store
}: {
  db: Knex;
  store: BoardDocumentStore;
}): Promise<{ database: boolean; persistence: boolean }> => {
  await db.raw('select 1 as ok');
  await store.hydrate('00000000-0000-4000-8000-000000000001');
  return { database: true, persistence: true };
};

export const createRuntimeControl = (options: RuntimeControlOptions = {}): RuntimeControl => {
  const signals = options.signals ?? createOperationalSignals();
  const now = options.now ?? Date.now;
  const cfg: RuntimeControlConfig = { ...defaultConfig(), ...options.config };

  let phase: RuntimePhase = 'idle';
  let live = false;
  let ready = false;
  let host: string | null = null;
  let port: number | null = null;
  let startedAt: string | null = null;
  let lastError: { kind: LifecycleFailureKind; message: string } | null = null;
  let lastShutdown: ShutdownReport | null = null;
  let checks = { database: false, persistence: false };

  let db: Knex | null = null;
  let boundDb = false;
  let listener: RealtimeListener | null = null;
  let collaboration: CollaborationRuntime | null = null;
  let boardLifecycle: BoardLifecycle | null = null;
  let roomManager: RoomManager | null = null;
  let histogram: IntervalHistogram | null = null;

  const timers = new Map<string, ReturnType<typeof setInterval>>();
  let chain: Promise<unknown> = Promise.resolve();
  let running: RunningRuntime | null = null;

  const health: RuntimeHealthGateway = {
    live: () => live,
    ready: () => ready && checks.database && checks.persistence,
    checks: () => ({ ...checks }),
    snapshot: () => signals.snapshot()
  };

  const resources = (): RuntimeStatus['resources'] => ({
    timers: Array.from(timers.keys()),
    listeners: listener ? ['http', 'ws'] : [],
    pools: db ? ['postgres'] : []
  });

  const status = (): RuntimeStatus => ({
    phase,
    live,
    ready: ready && checks.database && checks.persistence,
    host,
    port,
    startedAt,
    lastError,
    resources: resources()
  });

  const fail = (kind: LifecycleFailureKind, message: string): never => {
    lastError = { kind, message };
    phase = 'failed';
    ready = false;
    live = false;
    signals.record({ name: 'process.phase', dimensions: { phase: 'failed', kind, error: message.slice(0, 160) } });
    throw new RuntimeControlFailure(kind, message);
  };

  const clearTimers = (): boolean => {
    for (const id of timers.values()) clearInterval(id);
    timers.clear();
    if (histogram) {
      histogram.disable();
      histogram = null;
    }
    return true;
  };

  const trackInterval = (name: string, fn: () => void, ms: number): void => {
    const existing = timers.get(name);
    if (existing) clearInterval(existing);
    timers.set(name, setInterval(fn, ms));
  };

  const sampleSoak = (): void => {
    try {
      const memory = process.memoryUsage();
      signals.measure({ name: 'memory.rssBytes', value: memory.rss });
      signals.measure({ name: 'memory.heapUsedBytes', value: memory.heapUsed });
      if (histogram) {
        signals.measure({
          name: 'eventLoop.delayMs',
          value: Number(histogram.percentile(95)) / 1e6
        });
      }
      if (collaboration) {
        const stats = collaboration.stats();
        signals.measure({ name: 'boards.active', value: stats.boards });
        signals.measure({ name: 'connections.active', value: stats.connections });
      } else if (listener) {
        signals.measure({ name: 'connections.active', value: listener.connectionCount() });
      }
    } catch {
      signals.record({ name: 'internal.loss', dimensions: { stage: 'soak-sample' } });
    }
  };

  const cleanupPartialStart = async (): Promise<void> => {
    clearTimers();
    boardLifecycle?.stopDeletionSweep();
    if (listener) {
      await listener.close(new Date(now() + 500)).catch(() => undefined);
      listener = null;
    }
    if (boundDb) {
      await destroyDb().catch(() => undefined);
      boundDb = false;
      db = null;
    } else {
      db = null;
    }
    collaboration = null;
    roomManager = null;
  };

  const startInternal = async (): Promise<RunningRuntime> => {
    if (running && (phase === 'ready' || phase === 'starting')) return running;
    if (phase === 'draining') {
      throw new RuntimeControlFailure('invalid-configuration', 'Cannot start while draining.');
    }

    phase = 'starting';
    ready = false;
    live = false;
    lastError = null;
    lastShutdown = null;
    checks = { database: false, persistence: false };
    signals.record({ name: 'process.phase', dimensions: { phase: 'starting' } });

    createPilotAvailability().resolve({
      environment: cfg.pilotEnvironment,
      role: 'server'
    });

    const missing = missingSecrets(cfg);
    if (missing.length) {
      await cleanupPartialStart();
      fail('invalid-configuration', `Missing required configuration: ${missing.join(', ')}`);
    }

    const databaseUrl = cfg.databaseUrl as string;

    try {
      db = (options.createDatabase ?? ((url: string) => createDb({ databaseUrl: url, quiet: true })))(
        databaseUrl
      );
      if (!options.createDatabase) {
        bindDb(db);
        boundDb = true;
      }
    } catch (error) {
      await cleanupPartialStart();
      fail('dependency-unavailable', `Database connect failed: ${(error as Error).message}`);
    }

    const connectedDb = db;
    if (!connectedDb) {
      fail('dependency-unavailable', 'Database connect failed: no connection');
    }
    const activeDb: Knex = connectedDb as Knex;

    try {
      const migrate = options.migrate ?? (async (instance) => {
        await instance.migrate.latest();
      });
      await migrate(activeDb);
      signals.record({ name: 'process.phase', dimensions: { phase: 'migrated' } });
    } catch (error) {
      await cleanupPartialStart();
      fail('migration-failed', `Migration failed: ${(error as Error).message}`);
    }

    const store = (options.createStore ?? ((instance: Knex) => createPostgresBoardDocumentStore({ db: instance })))(
      activeDb
    );
    collaboration =
      options.createCollaboration?.(store) ??
      createCollaborationRuntime({
        store,
        idleMs: cfg.roomTtlMs,
        signals
      });

    try {
      const probe = options.probe ?? defaultProbe;
      checks = await probe({ db: activeDb, store });
      if (!checks.database || !checks.persistence) {
        throw new Error('Readiness probe did not confirm database and collaboration persistence.');
      }
    } catch (error) {
      await cleanupPartialStart();
      fail('dependency-unavailable', `Readiness probe failed: ${(error as Error).message}`);
    }

    const capabilityAccess = createCapabilityAccess({ db: activeDb, signals });
    boardLifecycle = createBoardLifecycle({
      access: capabilityAccess,
      db: activeDb,
      signals,
      onBoardsAccessEnded: (boardIds) =>
        Promise.all(
          boardIds.map((boardId) =>
            collaboration?.closeBoard(boardId, 'Dostęp do tablicy został zakończony') ?? Promise.resolve(false)
          )
        ).then(() => undefined)
    });
    boardLifecycle.startDeletionSweep();

    const persistence = new FilePersistence(cfg.dataDir);
    roomManager = new RoomManager(persistence);
    await roomManager.hydrateFromDisk();

    const aiSolver = new OpenRouterEquationSolver();
    listener = createRealtimeListener({
      roomManager,
      aiSolver,
      capabilityAccess,
      boardLifecycle,
      collaborationRuntime: collaboration,
      signals,
      health,
      admitting: () => phase === 'ready',
      environment: cfg.pilotEnvironment,
      devSurface: cfg.devSurface
    });

    try {
      const boundPort = options.listen
        ? await options.listen(listener.server, cfg.host, cfg.port)
        : await listener.listen(cfg.host, cfg.port);
      host = cfg.host;
      port = boundPort;
    } catch (error) {
      await cleanupPartialStart();
      fail('listener-failed', `Listener failed: ${(error as Error).message}`);
    }

    histogram = monitorEventLoopDelay({ resolution: 20 });
    histogram.enable();
    trackInterval('ping', () => {
      listener?.pingClients();
      roomManager?.cleanup(cfg.roomTtlMs);
      collaboration?.unloadIdle().catch((error) =>
        logger.error('Managed Board idle unload failed', { error: (error as Error).message })
      );
    }, cfg.pingIntervalMs);
    trackInterval('soak', sampleSoak, Math.min(cfg.pingIntervalMs, 10_000));
    sampleSoak();

    live = true;
    ready = true;
    phase = 'ready';
    startedAt = new Date(now()).toISOString();
    signals.record({
      name: 'process.phase',
      dimensions: { phase: 'ready', port: port ?? 0 }
    });

    running = {
      status,
      stop: (input) => stop(input),
      port: port as number,
      host: host as string
    };
    return running;
  };

  const stopInternal = async (input: { reason: string; deadline: Date }): Promise<ShutdownReport> => {
    if (lastShutdown && (phase === 'stopped' || phase === 'idle' || phase === 'failed')) {
      return lastShutdown;
    }
    const started = now();
    const remaining: string[] = [];
    phase = 'draining';
    ready = false;
    live = true;
    signals.record({
      name: 'process.phase',
      dimensions: { phase: 'draining', reason: input.reason }
    });

    const timersStopped = clearTimers();
    boardLifecycle?.stopDeletionSweep();

    let drain: ShutdownReport['drain'] = null;
    let flushed = false;
    if (collaboration) {
      try {
        drain = await collaboration.drain({ deadline: input.deadline, reason: input.reason });
        flushed = drain.complete;
        if (!drain.complete) remaining.push('collaboration-drain');
      } catch (error) {
        remaining.push('collaboration-drain');
        signals.record({
          name: 'persistence.error',
          dimensions: { stage: 'drain', error: (error as Error).message.slice(0, 120) }
        });
      }
    }
    try {
      await roomManager?.flushPending();
    } catch {
      remaining.push('legacy-room-flush');
    }

    let listenersClosed = true;
    if (listener) {
      const closed = await listener.close(input.deadline);
      listenersClosed = closed.listenersClosed;
      if (!closed.listenersClosed) remaining.push('http-listener');
      if (closed.remainingClients > 0) remaining.push(`ws-clients:${closed.remainingClients}`);
      listener = null;
    }

    let databaseClosed = true;
    try {
      if (boundDb) {
        await destroyDb();
        boundDb = false;
      }
      db = null;
    } catch (error) {
      databaseClosed = false;
      remaining.push('postgres-pool');
      signals.record({
        name: 'persistence.error',
        dimensions: { stage: 'database-close', error: (error as Error).message.slice(0, 120) }
      });
    }

    const deadlineExceeded = now() > input.deadline.getTime();
    if (deadlineExceeded) remaining.push('deadline');
    live = false;
    ready = false;
    host = null;
    port = null;
    running = null;
    collaboration = null;
    boardLifecycle = null;
    roomManager = null;
    checks = { database: false, persistence: false };
    phase = 'stopped';

    const clean =
      remaining.length === 0 &&
      flushed &&
      listenersClosed &&
      databaseClosed &&
      timersStopped &&
      !deadlineExceeded;

    const report: ShutdownReport = {
      clean,
      reason: input.reason,
      phase,
      remaining,
      drain,
      flushed,
      listenersClosed,
      databaseClosed,
      timersStopped,
      deadlineExceeded,
      durationMs: now() - started
    };
    lastShutdown = report;
    signals.record({
      name: 'process.phase',
      dimensions: {
        phase: 'stopped',
        clean,
        deadlineExceeded,
        remaining: remaining.length
      }
    });
    return report;
  };

  const serialized = async <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };

  const start = (): Promise<RunningRuntime> => serialized(startInternal);
  const stop = (input: { reason: string; deadline: Date }): Promise<ShutdownReport> =>
    serialized(() => stopInternal(input));

  return { start, status, stop };
};

export const snapshotIsContentFree = (snapshot: OperationalSnapshot): boolean => {
  const blob = JSON.stringify(snapshot);
  return !/https?:\/\//i.test(blob) && !/passphrase|wsToken|student_label/i.test(blob);
};
