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
import { createResourceGovernor, type ResourceGovernor } from './resourceGovernor';

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
  resourceGovernor?: ResourceGovernor;
  now?: () => number;
  config?: Partial<RuntimeControlConfig>;
  createDatabase?: (url: string) => Knex;
  migrate?: (db: Knex) => Promise<void>;
  probe?: (input: { db: Knex; store: BoardDocumentStore; signal: AbortSignal }) => Promise<{ database: boolean; persistence: boolean }>;
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
  store,
  signal
}: {
  db: Knex;
  store: BoardDocumentStore;
  signal: AbortSignal;
}): Promise<{ database: boolean; persistence: boolean }> => {
  const throwIfAborted = (): void => {
    if (signal.aborted) throw new Error('Readiness probe aborted.');
  };
  throwIfAborted();
  const query = db.raw(
    "SELECT 1 as ok, (SELECT current_setting('transaction_read_only', true)) as ro, (SELECT pg_is_in_recovery()) as in_recovery"
  );
  const result = await query.catch(async (error) => {
    throwIfAborted();
    return await db.raw('select 1 as ok').catch(() => { throw error; });
  });
  throwIfAborted();
  if (result && Array.isArray(result.rows) && result.rows.length > 0) {
    const row = result.rows[0];
    if (row.ro === 'on' || row.ro === true || row.in_recovery === true) {
      throw new Error('Database is in read-only mode.');
    }
  }
  throwIfAborted();
  await store.hydrate('00000000-0000-4000-8000-000000000001');
  throwIfAborted();
  return { database: true, persistence: true };
};

const withDeadline = async <T>(
  promise: Promise<T>,
  deadline: Date,
  phaseName: string,
  nowFn: () => number = Date.now,
  onTimeout?: () => void
): Promise<{ completed: true; value: T } | { completed: false }> => {
  const ms = deadline.getTime() - nowFn();
  if (ms <= 0) {
    onTimeout?.();
    return { completed: false };
  }
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<{ completed: false }>((resolve) => {
    timer = setTimeout(() => {
      onTimeout?.();
      resolve({ completed: false });
    }, ms);
  });
  try {
    const result = await Promise.race([
      promise.then((value) => ({ completed: true as const, value })),
      timeoutPromise
    ]);
    return result;
  } catch {
    return { completed: false };
  } finally {
    clearTimeout(timer!);
  }
};

export const recordEventLoopDelayWindow = (
  signals: Pick<OperationalSignals, 'measureHistogram'>,
  histogram: IntervalHistogram,
  windowStartAt: string,
  windowEndAt: string
): void => {
  const count = Number(histogram.count);
  const valueMs = (value: number): number | null =>
    count > 0 && Number.isFinite(value) ? value / 1e6 : null;
  const percentileMs = (percentile: number): number | null =>
    count > 0 ? valueMs(Number(histogram.percentile(percentile))) : null;
  const startMs = Date.parse(windowStartAt);
  const endMs = Date.parse(windowEndAt);
  signals.measureHistogram({
    name: 'eventLoop.delayMs',
    count: Number.isSafeInteger(count) && count >= 0 ? count : 0,
    min: valueMs(Number(histogram.min)),
    mean: valueMs(Number(histogram.mean)),
    p50: percentileMs(50),
    p95: percentileMs(95),
    max: valueMs(Number(histogram.max)),
    windowStartAt,
    windowEndAt,
    windowDurationMs: Number.isFinite(startMs) && Number.isFinite(endMs)
      ? Math.max(0, endMs - startMs)
      : 0
  });
  histogram.reset();
};

export const createRuntimeControl = (options: RuntimeControlOptions = {}): RuntimeControl => {
  const signals = options.signals ?? createOperationalSignals();
  const governor = options.resourceGovernor ?? createResourceGovernor();
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
  let activeDb: Knex | null = null;
  let activeStore: BoardDocumentStore | null = null;
  let listener: RealtimeListener | null = null;
  let collaboration: CollaborationRuntime | null = null;
  let boardLifecycle: BoardLifecycle | null = null;
  let roomManager: RoomManager | null = null;
  let histogram: IntervalHistogram | null = null;
  let eventLoopWindowStartedAt = new Date(now()).toISOString();

  const timers = new Map<string, ReturnType<typeof setInterval>>();
  let chain: Promise<unknown> = Promise.resolve();
  let running: RunningRuntime | null = null;

  let probeError: string | null = null;
  // Keep the underlying dependency check single-flight until it actually
  // settles.  The readiness response has a deadline, but timing out that
  // response must not permit the next interval to start a second probe while
  // the first database/store operation is still running.
  type ProbeWork = {
    promise: Promise<{ database: boolean; persistence: boolean }>;
    settled: boolean;
  };
  let probeWorkInFlight: ProbeWork | null = null;
  let probeAbortController: AbortController | null = null;
  let probeSequence = 0;

  const runProbe = async (): Promise<{ database: boolean; persistence: boolean }> => {
    if (!activeDb || !activeStore) {
      checks = { database: false, persistence: false };
      return checks;
    }

    const currentDb = activeDb;
    const currentStore = activeStore;
    // Let an abort-aware probe publish its settled state before this request
    // decides whether it may start the next generation. This yields only one
    // microtask; a still-running adapter remains single-flight.
    if (probeWorkInFlight) {
      await Promise.resolve();
      if (probeWorkInFlight?.settled) probeWorkInFlight = null;
    }
    if (!probeWorkInFlight) {
      const sequence = ++probeSequence;
      const controller = new AbortController();
      probeAbortController = controller;
      const tracked: ProbeWork = {
        promise: Promise.resolve({ database: false, persistence: false }),
        settled: false
      };
      tracked.promise = (async (): Promise<{ database: boolean; persistence: boolean }> => {
        try {
          const probeFn = options.probe ?? defaultProbe;
          const res = await probeFn({ db: currentDb, store: currentStore, signal: controller.signal });
          if (sequence !== probeSequence || currentDb !== activeDb || currentStore !== activeStore) {
            return checks;
          }
          checks = { database: Boolean(res.database), persistence: Boolean(res.persistence) };
          probeError = null;
        } catch (error) {
          if (sequence !== probeSequence || currentDb !== activeDb || currentStore !== activeStore) {
            return checks;
          }
          checks = { database: false, persistence: false };
          probeError = (error as Error).message.slice(0, 160);
          signals.record({
            name: 'persistence.error',
            dimensions: { stage: 'readiness-probe', error: probeError }
          });
        }
        return checks;
      })().finally(() => {
        tracked.settled = true;
        if (probeWorkInFlight === tracked) {
          probeWorkInFlight = null;
          probeAbortController = null;
        }
      });
      probeWorkInFlight = tracked;
    }

    const work = probeWorkInFlight.promise;
    const ms = 1_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Give the underlying adapter a chance to cancel its active query.
        // Adapters that cannot cancel still remain single-flight until their
        // promise settles, so a timeout never creates overlapping probes.
        probeAbortController?.abort();
        reject(new Error(`Readiness probe timed out after ${ms}ms`));
      }, ms);
    });
    try {
      await Promise.race([work, timeoutPromise]);
    } catch {
      // The underlying probe remains in probeWorkInFlight until it settles;
      // callers receive the last known failed readiness state at the bound.
      checks = { database: false, persistence: false };
    } finally {
      if (timer) clearTimeout(timer);
    }
    return checks;
  };

  const health: RuntimeHealthGateway = {
    live: () => live,
    ready: () => ready && phase === 'ready' && checks.database && checks.persistence,
    checks: () => ({ ...checks }),
    snapshot: () => signals.snapshot(),
    refresh: async () => {
      if (phase !== 'ready') return { database: false, persistence: false };
      return await runProbe();
    }
  };

  const resources = (): RuntimeStatus['resources'] => ({
    timers: Array.from(timers.keys()),
    listeners: listener ? ['http', 'ws'] : [],
    pools: db ? ['postgres'] : []
  });

  const status = (): RuntimeStatus => ({
    phase,
    live,
    ready: ready && phase === 'ready' && checks.database && checks.persistence,
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
        const windowEndAt = new Date(now()).toISOString();
        recordEventLoopDelayWindow(signals, histogram, eventLoopWindowStartedAt, windowEndAt);
        eventLoopWindowStartedAt = windowEndAt;
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
    } else if (db) {
      await db.destroy().catch(() => undefined);
      db = null;
    }
    collaboration = null;
    roomManager = null;
    activeDb = null;
    activeStore = null;
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

    try {
      return await startComponents();
    } catch (error) {
      // Startup exceptions never leak partial resources: every unhandled
      // failure is cleaned up and converted into a typed lifecycle outcome.
      if (error instanceof RuntimeControlFailure) throw error;
      await cleanupPartialStart();
      throw fail('dependency-unavailable', `Startup failed: ${(error as Error).message}`);
    }
  };

  const startComponents = async (): Promise<RunningRuntime> => {
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
    const activeDbInstance: Knex = connectedDb as Knex;
    activeDb = activeDbInstance;

    try {
      const migrate = options.migrate ?? (async (instance) => {
        await instance.migrate.latest();
      });
      await migrate(activeDbInstance);
      signals.record({ name: 'process.phase', dimensions: { phase: 'migrated' } });
    } catch (error) {
      await cleanupPartialStart();
      fail('migration-failed', `Migration failed: ${(error as Error).message}`);
    }

    const store = (options.createStore ?? ((instance: Knex) => createPostgresBoardDocumentStore({ db: instance })))(
      activeDbInstance
    );
    activeStore = store;
    collaboration =
      options.createCollaboration?.(store) ??
      createCollaborationRuntime({
        store,
        idleMs: cfg.roomTtlMs,
        signals,
        resourceGovernor: governor
      });

    try {
      checks = await runProbe();
      if (!checks.database || !checks.persistence) {
        throw new Error(
          `Readiness probe did not confirm database and collaboration persistence.` +
            (probeError ? ` Reason: ${probeError}` : '')
        );
      }
    } catch (error) {
      await cleanupPartialStart();
      fail('dependency-unavailable', `Readiness probe failed: ${(error as Error).message}`);
    }

    const capabilityAccess = createCapabilityAccess({ db: activeDbInstance, signals, resourceGovernor: governor });
    boardLifecycle = createBoardLifecycle({
      access: capabilityAccess,
      db: activeDbInstance,
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
      devSurface: cfg.devSurface,
      resourceGovernor: governor
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
    eventLoopWindowStartedAt = new Date(now()).toISOString();
    histogram.enable();
    trackInterval('ping', () => {
      listener?.pingClients();
      roomManager?.cleanup(cfg.roomTtlMs);
      collaboration?.unloadIdle().catch((error) =>
        logger.error('Managed Board idle unload failed', { error: (error as Error).message })
      );
    }, cfg.pingIntervalMs);
    trackInterval('probe', () => {
      runProbe().catch(() => undefined);
    }, 200);
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
    let drainTimedOut = false;
    if (collaboration) {
      const drainAbort = new AbortController();
      const drainResult = await withDeadline(
        collaboration.drain({ deadline: input.deadline, reason: input.reason, signal: drainAbort.signal }),
        input.deadline,
        'collaboration-drain',
        now,
        () => drainAbort.abort()
      );
      if (drainResult.completed) {
        drain = drainResult.value;
        flushed = drain.complete;
        if (!drain.complete) remaining.push('collaboration-drain');
      } else {
        drainTimedOut = true;
        remaining.push('collaboration-drain');
        signals.record({
          name: 'persistence.error',
          dimensions: { stage: 'drain', error: 'deadline exceeded during collaboration drain' }
        });
      }
    }

    if (roomManager) {
      const flushResult = await withDeadline(
        roomManager.flushPending(),
        input.deadline,
        'legacy-room-flush',
        now
      );
      if (!flushResult.completed) {
        remaining.push('legacy-room-flush');
      }
    }

    let listenersClosed = true;
    if (listener) {
      const closeResult = await withDeadline(
        listener.close(input.deadline),
        input.deadline,
        'http-listener',
        now
      );
      if (closeResult.completed) {
        listenersClosed = closeResult.value.listenersClosed;
        if (!closeResult.value.listenersClosed) remaining.push('http-listener');
        if (closeResult.value.remainingClients > 0) remaining.push(`ws-clients:${closeResult.value.remainingClients}`);
      } else {
        listenersClosed = false;
        remaining.push('http-listener');
      }
      listener = null;
    }

    let databaseClosed = true;
    if (boundDb && !drainTimedOut) {
      const destroyPromise = (async () => {
        await destroyDb();
        boundDb = false;
      })();
      const dbResult = await withDeadline(destroyPromise, input.deadline, 'postgres-pool', now);
      if (!dbResult.completed) {
        databaseClosed = false;
        remaining.push('postgres-pool');
        signals.record({
          name: 'persistence.error',
          dimensions: { stage: 'database-close', error: 'deadline exceeded during database destroy' }
        });
      }
    } else if (boundDb) {
      // A timed-out drain may still be unwinding a store operation. Keep its
      // pool alive rather than destroying the dependency underneath late
      // work; the process adapter's bounded exit is the final fallback.
      databaseClosed = false;
      if (!remaining.includes('postgres-pool')) remaining.push('postgres-pool');
    }
    db = null;

    const deadlineExceeded = now() > input.deadline.getTime();
    if (deadlineExceeded && !remaining.includes('deadline')) {
      remaining.push('deadline');
    }
    live = false;
    ready = false;
    host = null;
    port = null;
    running = null;
    collaboration = null;
    boardLifecycle = null;
    roomManager = null;
    activeDb = null;
    activeStore = null;
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
