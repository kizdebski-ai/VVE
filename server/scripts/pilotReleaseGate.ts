/**
 * VVE-109 executable release gates.
 *
 * The harness deliberately runs the production process adapter, PostgreSQL
 * migrations, HTTP capability flow, WebSocket collaboration protocol, and the
 * canonical BoardDocument boundary. It does not use the in-memory store or a
 * synthetic getMap('lesson') document.
 *
 * Profiles:
 *   change       one Teacher + three Students, seeded operations/reload/restart
 *   mature       representative canonical scene with fixture assets/history
 *   soak         22 boards, 57 clients, three hours by default
 *   destructive  malformed/oversized/invalid input remains bounded
 *   stress       optional 88-client safe-overload probe
 */
import { writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { createServer } from 'net';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { createBoardDocument, type BoardDocument } from '../src/pilot/boardDocument';
import { runDestructiveScenario, runMatureBoardScenario, type ScenarioResult } from './pilotGateScenarios';
import type { BoardCommand, SceneObject } from '../src/pilot/boardScene';
import type { BoardRole } from '../src/pilot/boardScene';
import { collaborationMessage } from '../src/pilot/collaborationProtocol';

const ROOT = resolve(__dirname, '..');
const DEFAULT_PG_PORT = 5497;
const DEFAULT_BACKEND_PORT = 8497;
const SOAK_MS = 3 * 60 * 60 * 1000;
const DEFAULT_SMOKE_MS = 15_000;
const DEFAULT_GATE_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
const TEST_PASS = 'vve-109-test-admin-passphrase';
const TEST_TEACHER_SECRET = 'vve-109-test-teacher-secret';
const TEST_ADMIN_SECRET = 'vve-109-test-admin-secret';

export type GateProfile = 'change' | 'mature' | 'soak' | 'destructive' | 'stress';

export type ReleaseGateOptions = {
  profile: GateProfile;
  smoke: boolean;
  durationMs: number;
  operations: number;
  pgPort: number;
  backendPort: number;
  reportPath: string | null;
};

export type GateReport = {
  profile: GateProfile;
  smoke: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  clients: number;
  boards: number;
  acknowledgedOperations: number;
  reconnects: number;
  backendRestarts: number;
  metrics: {
    samples: number;
    maxRssBytes: number;
    maxEventLoopDelayMs: number;
    blockerEvents: number;
    digestMismatches: number;
    crossBoardLeaks: number;
  };
  coverage: 'complete' | 'smoke-only';
  fixtures: { pdfBytes: number; imageBytes: number } | null;
  finalDigests?: string[];
  destructive?: {
    attemptedInvalidOperations: number;
    rejectedInvalidOperations: number;
    nonMapEntryRejectionReason: string;
    malformedFrameCloseCode: number;
    oversizedFrameCloseCode: number;
    preservedState: boolean;
    restartVerified: boolean;
  };
  passed: boolean;
  soakDetails?: SoakDetails;
};

type SoakDetails = {
  activeDurationMs: number;
  studentCounts: number[];
  injectedReconnects: number;
  adapterReloads: number;
  maxHeapUsedBytes: number;
  writeToPeerP95Ms: number;
  openingP95Ms: number;
  restartRecoveryMs: number;
  freshRestartClients: number;
  roomDigests: Record<string, string>;
};

const usage = (): never => {
  throw new Error(
    'Usage: ts-node scripts/pilotReleaseGate.ts --profile change|mature|soak|destructive|stress [--smoke] [--duration-ms N] [--operations N] [--report PATH]'
  );
};

const integerArg = (value: string, flag: string): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer.`);
  return parsed;
};

export const parseReleaseGateArgs = (argv: readonly string[]): ReleaseGateOptions => {
  let profile: GateProfile | null = null;
  let smoke = false;
  let durationMs: number | null = null;
  let operations = 2_000;
  let pgPort = DEFAULT_PG_PORT;
  let backendPort = DEFAULT_BACKEND_PORT;
  let reportPath: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--smoke') smoke = true;
    else if (arg === '--profile') profile = argv[++index] as GateProfile;
    else if (arg === '--duration-ms') durationMs = integerArg(argv[++index] ?? '', '--duration-ms');
    else if (arg === '--operations') operations = integerArg(argv[++index] ?? '', '--operations');
    else if (arg === '--pg-port') pgPort = integerArg(argv[++index] ?? '', '--pg-port');
    else if (arg === '--backend-port') backendPort = integerArg(argv[++index] ?? '', '--backend-port');
    else if (arg === '--report') reportPath = resolve(argv[++index] ?? '');
    else if (arg === '--help' || arg === '-h') usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }

  const profiles: GateProfile[] = ['change', 'mature', 'soak', 'destructive', 'stress'];
  if (!profile || !profiles.includes(profile)) throw new Error('--profile is required and must name a release-gate profile.');
  if (profile === 'soak' && !smoke && durationMs !== null && durationMs < SOAK_MS) {
    throw new Error('The 57-client soak defaults to three hours. Use --smoke for a bounded smoke run.');
  }
  if (profile === 'change' && !smoke && durationMs !== null && durationMs < 5 * 60 * 1000) {
    throw new Error('A non-smoke change gate must run for at least five minutes. Use --smoke for a bounded smoke run.');
  }
  if (profile === 'change' && !smoke && operations < 1_000) {
    throw new Error('A non-smoke change gate requires at least 1,000 canonical operations.');
  }
  return {
    profile,
    smoke,
    durationMs: durationMs ?? (smoke ? DEFAULT_SMOKE_MS : profile === 'soak' ? SOAK_MS : DEFAULT_GATE_MS),
    operations: smoke ? Math.min(operations, 80) : operations,
    pgPort,
    backendPort,
    reportPath
  };
};

const sleep = (ms: number): Promise<void> => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

export const assertPortAvailable = async (port: number, host = '127.0.0.1'): Promise<void> => {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const probe = createServer();
    const fail = (error: NodeJS.ErrnoException): void => {
      probe.close(() => undefined);
      rejectPromise(new Error(`Port ${host}:${port} is unavailable (${error.code ?? error.message}).`));
    };
    probe.once('error', fail);
    probe.listen({ host, port }, () => {
      probe.close((error) => {
        if (error) rejectPromise(error);
        else resolvePromise();
      });
    });
  });
};

const runCommand = (command: string, args: string[], cwd = ROOT): Promise<void> =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code ?? 'signal'}.`))));
  });

const dockerName = `vve-109-pg-${process.pid}`;

const startPostgres = async (port: number): Promise<() => Promise<void>> => {
  await runCommand('docker', [
    'run', '--detach', '--rm', '--name', dockerName,
    '-e', 'POSTGRES_USER=postgres',
    '-e', 'POSTGRES_PASSWORD=vve_109_password',
    '-e', 'POSTGRES_DB=vve_109_gate',
    '-p', `127.0.0.1:${port}:5432`,
    'postgres:15-alpine'
  ]);
  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const check = spawnSync('docker', ['exec', dockerName, 'pg_isready', '-U', 'postgres', '-d', 'vve_109_gate'], {
        stdio: 'ignore'
      });
      if (check.status === 0) return async () => { await runCommand('docker', ['rm', '--force', dockerName]).catch(() => undefined); };
      await sleep(500);
    }
    throw new Error('PostgreSQL did not become ready within 30 seconds.');
  } catch (error) {
    await runCommand('docker', ['rm', '--force', dockerName]).catch(() => undefined);
    throw error;
  }
};

type RunningBackend = { process: ChildProcess; stop: () => Promise<void> };
type BackendSpawnObserver = (child: ChildProcess) => void;

const hasExited = (child: ChildProcess): boolean => child.exitCode !== null || child.signalCode !== null;

const waitForExit = (child: ChildProcess, timeoutMs: number): Promise<boolean> =>
  new Promise((resolvePromise) => {
    if (hasExited(child)) {
      resolvePromise(true);
      return;
    }
    const onExit = (): void => {
      clearTimeout(timer);
      resolvePromise(true);
    };
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolvePromise(false);
    }, timeoutMs);
    child.once('exit', onExit);
  });

export const stopChildProcess = async (
  child: ChildProcess,
  graceMs = 12_000,
  killWaitMs = 5_000
): Promise<void> => {
  if (hasExited(child)) return;
  try {
    child.kill('SIGTERM');
  } catch {
    // The child can exit between the state check and kill().
  }
  if (await waitForExit(child, graceMs)) return;
  try {
    child.kill('SIGKILL');
  } catch {
    // The child can exit between the timeout and kill().
  }
  if (!(await waitForExit(child, killWaitMs))) {
    throw new Error(`Backend process ${child.pid ?? 'unknown'} did not exit after SIGKILL.`);
  }
};

const startBackend = async (port: number, pgPort: number, onSpawn?: BackendSpawnObserver): Promise<RunningBackend> => {
  await assertPortAvailable(port);
  const child = spawn('node', ['dist/src/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      VVE_PILOT_SURFACE: '1',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_URL: `postgres://postgres:vve_109_password@127.0.0.1:${pgPort}/vve_109_gate`,
      ADMIN_PASSPHRASE: TEST_PASS,
      TEACHER_SESSION_SECRET: TEST_TEACHER_SECRET,
      ADMIN_SESSION_SECRET: TEST_ADMIN_SECRET,
      BOARD_WS_SECRET: TEST_TEACHER_SECRET,
      DATA_DIR: join(ROOT, 'tmp', `vve-109-${process.pid}`),
      PING_INTERVAL_MS: '1000'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  onSpawn?.(child);
  const output: string[] = [];
  const capture = (chunk: Buffer): void => {
    const scrubbed = chunk.toString().replace(/(?:token|secret|password|wsToken)[^\s]*/gi, '[redacted]');
    output.push(scrubbed.slice(-400));
    if (output.length > 20) output.shift();
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  let resolveChildReady!: () => void;
  const childReady = new Promise<void>((resolvePromise) => {
    resolveChildReady = resolvePromise;
  });
  let readyOutput = '';
  const detectChildReady = (chunk: Buffer): void => {
    const lines = `${readyOutput}${chunk.toString()}`.split(/\r?\n/);
    readyOutput = (lines.pop() ?? '').slice(-4_096);
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as { name?: string; dimensions?: { phase?: string } };
        if (event.name === 'process.phase' && event.dimensions?.phase === 'ready') {
          resolveChildReady();
          return;
        }
      } catch {
        // Logger and diagnostics are not all JSON; only structured ready events count.
      }
    }
  };
  child.stdout?.on('data', detectChildReady);
  const earlyExit = new Promise<never>((_, reject) => {
    child.once('error', (error) => reject(error));
    child.once('exit', (code) => reject(new Error(`Backend exited before readiness (${code ?? 'signal'}).`)));
  });
  // The race below settles as soon as readiness succeeds; keep the exit
  // sentinel observed so a later normal shutdown cannot become an unhandled
  // rejection in the harness process.
  void earlyExit.catch(() => undefined);
  const waitReady = (async () => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/ready`, { signal: AbortSignal.timeout(500) });
        if (response.status === 200) return;
      } catch {
        // process readiness is polled below; an early exit wins through race
      }
      await sleep(250);
    }
    throw new Error(`Backend did not become ready within 20 seconds. ${output.join('').slice(-400)}`);
  })();
  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  const startupDeadline = new Promise<never>((_, rejectPromise) => {
    startupTimer = setTimeout(() => rejectPromise(new Error('Backend did not report readiness within 20 seconds.')), 20_000);
  });
  try {
    // A stale listener can answer /ready before the spawned child reports its
    // own ready phase. Requiring both signals ties readiness to this child.
    await Promise.race([Promise.all([waitReady, childReady]), earlyExit, startupDeadline]);
  } catch (error) {
    try {
      await stopChildProcess(child);
    } catch (cleanupError) {
      throw new Error(`Backend startup failed and cleanup failed: ${(cleanupError as Error).message}`);
    }
    throw error;
  } finally {
    if (startupTimer) clearTimeout(startupTimer);
    child.stdout?.removeListener('data', detectChildReady);
  }
  let stopPromise: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    stopPromise ??= stopChildProcess(child);
    return stopPromise;
  };
  return { process: child, stop };
};

export const fetchJson = async <T>(
  base: string,
  path: string,
  init?: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<{ status: number; body: T; headers: Headers }> => {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(`${base}${path}`, { ...init, signal });
  const text = await response.text();
  let body: T;
  try { body = JSON.parse(text) as T; } catch { body = text as T; }
  return { status: response.status, body, headers: response.headers };
};

const cookieOf = (headers: Headers): string => {
  const setCookies = typeof (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === 'function'
    ? (headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
    : [headers.get('set-cookie') ?? ''];
  const cookie = setCookies.find((value) => value.includes('='));
  if (!cookie) throw new Error('Expected a session cookie from the production HTTP flow.');
  return cookie.split(';', 1)[0]!;
};

const postJson = async <T>(base: string, path: string, body: unknown, cookie?: string): Promise<T> => {
  const result = await fetchJson<T>(base, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body)
  });
  if (result.status < 200 || result.status >= 300) throw new Error(`HTTP ${result.status} at ${path}.`);
  return result.body;
};

type BoardAccess = { boardId: string; publicSlug: string; studentToken: string; teacherWsToken: string; studentWsToken: string };

const createBoardAccess = async (
  base: string,
  adminCookie: string,
  index: number,
  beforeTeacherLogin?: (index: number) => Promise<void>
): Promise<BoardAccess> => {
  const teacher = await postJson<{ teacherId: string; accessLink: string }>(base, '/api/admin/teachers', {
    email: `vve-109-${process.pid}-${index}@example.test`,
    internalLabel: `VVE-109 Teacher ${index}`
  }, adminCookie);
  const teacherLogin = new URL(teacher.accessLink);
  teacherLogin.protocol = 'http:';
  // Exercise the real production login route. Resetting the spawned process
  // between ten-login batches clears only its in-memory rate-limit bucket;
  // PostgreSQL-backed teacher and board state remains durable.
  await beforeTeacherLogin?.(index);
  teacherLogin.hostname = '127.0.0.1';
  teacherLogin.port = new URL(base).port;
  let login: Response;
  login = await fetch(teacherLogin, { redirect: 'manual' });
  if (login.status !== 302) throw new Error(`Teacher login failed with HTTP ${login.status}.`);
  const teacherCookie = cookieOf(login.headers);
  const created = await postJson<{ boardId: string; publicSlug: string; studentLink: string }>(base, '/api/teacher/boards', {
    studentLabel: `VVE-109 Students ${index}`,
    title: `VVE-109 Board ${index}`
  }, teacherCookie);
  const studentUrl = new URL(created.studentLink);
  const studentToken = studentUrl.searchParams.get('token');
  if (!studentToken) throw new Error('Board Access Link did not contain a student token.');
  const teacherEntry = await fetchJson<{ wsToken: string }>(base, `/board/${created.boardId}`, { headers: { cookie: teacherCookie } });
  const studentEntry = await fetchJson<{ wsToken: string }>(base, `${studentUrl.pathname}?${studentUrl.searchParams.toString()}`);
  if (teacherEntry.status !== 200 || studentEntry.status !== 200) throw new Error('Board access HTTP flow failed.');
  return {
    boardId: created.boardId,
    publicSlug: created.publicSlug,
    studentToken,
    teacherWsToken: teacherEntry.body.wsToken,
    studentWsToken: studentEntry.body.wsToken
  };
};

const prefixed = (type: number, payload: Uint8Array): Buffer => Buffer.concat([Buffer.from([type]), Buffer.from(payload)]);
const encodeMutation = (operationId: string, update: Uint8Array): Buffer => {
  const id = Buffer.from(operationId);
  const payload = Buffer.alloc(2 + id.length + update.length);
  payload.writeUInt16BE(id.length, 0);
  id.copy(payload, 2);
  Buffer.from(update).copy(payload, 2 + id.length);
  return prefixed(collaborationMessage.mutation, payload);
};

const frameJson = (data: Uint8Array): Record<string, unknown> => JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>;

class CanonicalGateClient {
  readonly doc = new Y.Doc();
  private canonical: BoardDocument | null = null;
  private socket: WebSocket | null = null;
  private operation = 0;
  private readonly pending = new Map<string, { resolve: (digest: string) => void; reject: (error: Error) => void }>();
  private syncResolve: (() => void) | null = null;
  private syncReject: ((error: Error) => void) | null = null;
  private closed = false;
  acknowledged = 0;

  constructor(readonly boardId: string, readonly wsToken: string, readonly role: BoardRole, readonly actorId: string) {}

  async connect(base: string): Promise<void> {
    const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/ws/whiteboard/${this.boardId}?wsToken=${encodeURIComponent(this.wsToken)}`);
    this.socket = socket;
    socket.binaryType = 'arraybuffer';
    const synchronized = new Promise<void>((resolvePromise, rejectPromise) => {
      this.syncResolve = resolvePromise;
      this.syncReject = rejectPromise;
    });
    socket.on('message', (raw) => this.receive(Buffer.from(raw as Buffer)));
    socket.on('error', (error) => this.syncReject?.(error instanceof Error ? error : new Error('WebSocket error.')));
    socket.on('close', (code) => {
      if (!this.closed && code !== 1000 && this.syncReject) this.syncReject(new Error(`Unexpected WebSocket close ${code}.`));
    });
    await Promise.race([synchronized, sleep(10_000).then(() => { throw new Error('Client did not synchronize within 10 seconds.'); })]);
  }

  private receive(frame: Buffer): void {
    const type = frame[0];
    const payload = new Uint8Array(frame.subarray(1));
    if (type === collaborationMessage.sync) {
      Y.applyUpdate(this.doc, payload, 'collaborationRemote');
      this.canonical?.destroy();
      this.canonical = createBoardDocument({ initialState: payload });
    } else if (type === collaborationMessage.update) {
      const idLength = frame.readUInt16BE(1);
      const update = new Uint8Array(frame.subarray(3 + idLength));
      const checked = this.canonical?.apply(update, { kind: 'remote', actorId: 'peer', role: 'student' });
      if (checked && !checked.ok) throw new Error(`Remote update rejected by canonical BoardDocument: ${checked.message}`);
      Y.applyUpdate(this.doc, update, 'collaborationRemote');
    } else if (type === collaborationMessage.synchronizationComplete) {
      this.syncResolve?.();
      this.syncResolve = null;
    } else if (type === collaborationMessage.acknowledgement) {
      const parsed = frameJson(payload);
      const operationId = String(parsed.operationId ?? '');
      const waiter = this.pending.get(operationId);
      if (waiter) {
        this.pending.delete(operationId);
        this.acknowledged += 1;
        waiter.resolve(String(parsed.digest ?? ''));
      }
    } else if (type === collaborationMessage.denial) {
      const parsed = frameJson(payload);
      const operationId = parsed.operationId ? String(parsed.operationId) : '';
      const waiter = this.pending.get(operationId);
      if (waiter) {
        this.pending.delete(operationId);
        waiter.reject(new Error(`Server denied operation ${operationId}: ${String(parsed.reason ?? 'unknown')}.`));
      }
    }
  }

  addObject(object: Record<string, unknown>): Promise<string> {
    if (!this.canonical) throw new Error('Client is not synchronized.');
    const before = Y.encodeStateAsUpdate(this.doc);
    const current = new Y.Doc();
    Y.applyUpdate(current, before);
    const next = new Y.Doc();
    Y.applyUpdate(next, before);
    const map = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(object)) map.set(key, value);
    next.getArray('drawings').push([map]);
    const update = Y.encodeStateAsUpdate(next, Y.encodeStateVector(current));
    current.destroy();
    next.destroy();
    const checked = this.canonical.apply(update, { kind: 'local', actorId: this.actorId, role: this.role });
    if (!checked.ok) throw new Error(`Local canonical operation rejected: ${checked.message}`);
    Y.applyUpdate(this.doc, update);
    const operationId = `vve109-${this.actorId}-${this.operation++}`;
    return new Promise<string>((resolvePromise, rejectPromise) => {
      this.pending.set(operationId, { resolve: resolvePromise, reject: rejectPromise });
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        rejectPromise(new Error('WebSocket is not open.'));
        return;
      }
      this.socket.send(encodeMutation(operationId, update));
    });
  }

  digest(): string {
    if (!this.canonical) throw new Error('Client is not synchronized.');
    return this.canonical.digest();
  }

  snapshot(): Record<string, unknown> {
    if (!this.canonical) throw new Error('Client is not synchronized.');
    // BoardDocument owns validation and digest. The headless client reads the
    // canonical scene root through Yjs only to assert object isolation; it
    // never uses an unrelated `lesson` map.
    return { drawings: this.doc.getArray('drawings').toJSON() };
  }

  sendRaw(frame: Uint8Array): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('WebSocket is not open.');
    this.socket.send(frame);
  }

  waitForClose(timeoutMs: number): Promise<void> {
    if (!this.socket) return Promise.reject(new Error('WebSocket is not open.'));
    return Promise.race([
      new Promise<void>((resolvePromise) => this.socket?.once('close', () => resolvePromise())),
      sleep(timeoutMs).then(() => { throw new Error('WebSocket did not close within the bounded timeout.'); })
    ]);
  }

  close(): void {
    this.closed = true;
    this.pending.forEach(({ reject }) => reject(new Error('Client closed.')));
    this.pending.clear();
    this.socket?.close();
    this.canonical?.destroy();
    this.doc.destroy();
  }
}

type ProductionConnection = {
  ydoc: Y.Doc;
  yDrawings: Y.Array<unknown>;
  isEditable: () => boolean;
  pendingOperationCount: () => number;
  disconnect: () => void;
};

type ProductionClientModule = {
  connectToYjs: (roomId: string, options: { wsToken: string; onStatus?: (status: string) => void }) => ProductionConnection;
  createWhiteboardSession?: (options: { ydoc: Y.Doc; role: 'teacher' | 'student'; isEditable: () => boolean }) => {
    execute: (command: BoardCommand) => { ok: true } | { ok: false; reason: string; message: string };
    undo: () => boolean;
    redo: () => boolean;
    dispose: () => void;
    snapshot: () => readonly SceneObject[];
  };
};

let productionClientModule: Promise<ProductionClientModule> | null = null;
let productionVite: { ssrLoadModule: (path: string) => Promise<Record<string, unknown>>; close: () => Promise<void> } | null = null;

const loadProductionClient = async (): Promise<ProductionClientModule> => {
  if (!productionClientModule) {
    productionClientModule = (async () => {
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      const browserWindow = {
        location: { protocol: 'http:', host: '127.0.0.1', origin: 'http://127.0.0.1', port: '' },
        addEventListener: (type: string, listener: (...args: unknown[]) => void) => {
          const bucket = listeners.get(type) ?? new Set();
          bucket.add(listener);
          listeners.set(type, bucket);
        },
        removeEventListener: (type: string, listener: (...args: unknown[]) => void) => listeners.get(type)?.delete(listener),
        setTimeout,
        clearTimeout
      };
      (globalThis as unknown as { window: typeof browserWindow }).window = browserWindow;
      class HarnessWebSocket extends WebSocket {
        constructor(address: string | URL | null, protocols?: string | string[]) {
          super(address as string | URL, protocols);
          this.on('error', () => undefined);
        }
      }
      (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = HarnessWebSocket as typeof WebSocket;
      const { createServer } = await import('vite');
      productionVite = await createServer({
        root: resolve(ROOT, '..', 'frontend'),
        configFile: false,
        optimizeDeps: { disabled: true },
        resolve: {
          alias: {
            '@': resolve(ROOT, '..', 'frontend', 'src'),
            '@pilot': resolve(ROOT, 'src', 'pilot')
          },
          dedupe: ['yjs']
        },
        server: { middlewareMode: true, hmr: false },
        appType: 'custom',
        logLevel: 'error'
      });
      const loaded = await productionVite.ssrLoadModule('/src/services/connectToYjs.ts');
      const session = await productionVite.ssrLoadModule('/src/board/whiteboardSession.ts');
      return { ...loaded, ...session } as unknown as ProductionClientModule;
    })();
  }
  return productionClientModule;
};

class ProductionGateClient {
  synchronizationMs = 0;
  private connection: ProductionConnection | null = null;
  private canonical: BoardDocument | null = null;
  private session: ReturnType<NonNullable<ProductionClientModule['createWhiteboardSession']>> | null = null;
  private socketError: Error | null = null;
  private closed = false;
  private acknowledged = new Map<string, string>();
  private denied = new Map<string, string>();

  constructor(
    public readonly boardId: string,
    private readonly wsToken: string,
    private readonly role: 'teacher' | 'student',
    private readonly actorId: string
  ) {}

  async connect(base: string): Promise<void> {
    const openedAt = performance.now();
    const module = await loadProductionClient();
    const browserWindow = (globalThis as unknown as { window: { location: { protocol: string; host: string; origin: string; port: string } } }).window;
    const url = new URL(base);
    browserWindow.location.protocol = url.protocol;
    browserWindow.location.host = url.host;
    browserWindow.location.origin = url.origin;
    browserWindow.location.port = url.port;
    this.closed = false;
    this.socketError = null;
    this.acknowledged.clear();
    this.denied.clear();
    this.connection = module.connectToYjs(this.boardId, {
      wsToken: this.wsToken,
      onStatus: (status) => {
        if (status === 'disconnected') this.canonical?.destroy();
      }
    });
    const socket = (this.connection as ProductionConnection & { socket?: { on?: (event: string, handler: (error: Error) => void) => void } }).socket;
    socket?.on?.('error', (error) => {
      if (!this.closed) this.socketError = error;
    });
    this.attachProtocolHooks();
    const deadline = Date.now() + 10_000;
    while (!this.connection.isEditable()) {
      if (this.socketError) throw new Error(`Production connectToYjs socket failed for ${this.actorId}: ${(this.socketError as Error).message}`);
      if (Date.now() >= deadline) throw new Error(`Production connectToYjs did not synchronize for ${this.actorId}.`);
      await sleep(25);
    }
    const createSession = module.createWhiteboardSession;
    if (!createSession) throw new Error('Production whiteboard session module is unavailable.');
    this.session = createSession({ ydoc: this.connection.ydoc, role: this.role, isEditable: this.connection.isEditable });
    this.refreshCanonical();
    this.synchronizationMs = performance.now() - openedAt;
  }

  private refreshCanonical(): BoardDocument {
    if (!this.connection) throw new Error('Production client is not connected.');
    this.canonical?.destroy();
    this.canonical = createBoardDocument({ initialState: Y.encodeStateAsUpdate(this.connection.ydoc) });
    return this.canonical;
  }

  private attachProtocolHooks(): void {
    const connection = this.connection as (ProductionConnection & { socket?: any }) | null;
    const socket = connection?.socket as any;
    if (!socket || socket.__vve109Hooks) return;
    socket.__vve109Hooks = true;
    const originalSend = socket.send.bind(socket);
    socket.send = (data: unknown) => {
      const bytes = data instanceof Uint8Array
        ? data
        : data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array((data as ArrayBufferView).buffer, (data as ArrayBufferView).byteOffset, (data as ArrayBufferView).byteLength);
      if (bytes[0] === collaborationMessage.mutation && bytes.length >= 3) {
        const idLength = new DataView(bytes.buffer, bytes.byteOffset + 1, 2).getUint16(0);
        socket.__vve109LastOperationId = new TextDecoder().decode(bytes.slice(3, 3 + idLength));
      }
      return originalSend(data);
    };
    const originalMessage = socket.onmessage;
    socket.onmessage = (event: MessageEvent) => {
      const bytes = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : event.data instanceof Uint8Array ? event.data : null;
      if (bytes?.[0] === collaborationMessage.acknowledgement) {
        const body = JSON.parse(new TextDecoder().decode(bytes.slice(1))) as { operationId?: string; digest?: string };
        if (body.operationId && body.digest) this.acknowledged.set(body.operationId, body.digest);
      } else if (bytes?.[0] === collaborationMessage.denial) {
        const body = JSON.parse(new TextDecoder().decode(bytes.slice(1))) as { operationId?: string; reason?: string };
        if (body.operationId) this.denied.set(body.operationId, body.reason ?? 'unknown');
      }
      originalMessage?.call(socket, event);
    };
  }

  private async sendMutationUpdate(update: Uint8Array, operationId: string): Promise<{ acknowledged: boolean; reason?: string }> {
    this.attachProtocolHooks();
    const socket = (this.connection as (ProductionConnection & { socket?: any }) | null)?.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error(`Production client ${this.actorId} is not connected.`);
    this.acknowledged.delete(operationId);
    this.denied.delete(operationId);
    socket.send(encodeMutation(operationId, update));
    const deadline = Date.now() + 10_000;
    while (!this.acknowledged.has(operationId) && !this.denied.has(operationId)) {
      if (Date.now() >= deadline) throw new Error(`Production mutation response timeout for ${this.actorId}.`);
      await sleep(10);
    }
    const reason = this.denied.get(operationId);
    return reason ? { acknowledged: false, reason } : { acknowledged: true };
  }

  /** Send a schema-invalid Yjs update through the production WebSocket boundary. */
  async rejectInvalidObject(object: Record<string, unknown>, operationId: string): Promise<string> {
    if (!this.connection) throw new Error(`Production client ${this.actorId} is not connected.`);
    const base = Y.encodeStateAsUpdate(this.connection.ydoc);
    const current = new Y.Doc();
    const next = new Y.Doc();
    Y.applyUpdate(current, base);
    Y.applyUpdate(next, base);
    const map = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(object)) map.set(key, value);
    next.getArray('drawings').push([map]);
    const update = Y.encodeStateAsUpdate(next, Y.encodeStateVector(current));
    current.destroy();
    next.destroy();
    const result = await this.sendMutationUpdate(update, operationId);
    if (result.acknowledged) throw new Error(`Production server accepted invalid object for ${this.actorId}.`);
    return result.reason ?? 'unknown';
  }

  /** Send a Y.Array entry that is JSON rather than the canonical Y.Map. */
  async rejectNonMapEntry(operationId: string): Promise<string> {
    if (!this.connection) throw new Error(`Production client ${this.actorId} is not connected.`);
    const base = Y.encodeStateAsUpdate(this.connection.ydoc);
    const current = new Y.Doc();
    const next = new Y.Doc();
    Y.applyUpdate(current, base);
    Y.applyUpdate(next, base);
    next.getArray('drawings').push([{
      id: `non-map-${this.actorId}`,
      type: 'rectangle',
      x: 1,
      y: 1,
      width: 20,
      height: 20,
      color: '#2563eb',
      lineWidth: 2,
      timestamp: 1
    }]);
    const update = Y.encodeStateAsUpdate(next, Y.encodeStateVector(current));
    current.destroy();
    next.destroy();
    const result = await this.sendMutationUpdate(update, operationId);
    if (result.acknowledged) throw new Error('Production server accepted a non-Y.Map drawings entry.');
    return result.reason ?? 'unknown';
  }

  async sendRawFrame(frame: Uint8Array): Promise<number> {
    if (!this.connection) throw new Error(`Production client ${this.actorId} is not connected.`);
    const socket = (this.connection as (ProductionConnection & { socket?: any })).socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error(`Production client ${this.actorId} is not connected.`);
    const closed = new Promise<number>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => rejectPromise(new Error(`Production raw frame was not closed for ${this.actorId}.`)), 10_000);
      socket.once('close', (code: number) => { clearTimeout(timer); resolvePromise(code); });
      socket.once('error', (error: Error) => { clearTimeout(timer); rejectPromise(error); });
    });
    socket.send(frame);
    return closed;
  }

  async addObject(object: SceneObject): Promise<string> {
    if (!this.session) throw new Error(`Production client ${this.actorId} has no whiteboard session.`);
    const result = this.session.execute({ kind: 'add', object });
    if (!result.ok) throw new Error(`Production command rejected for ${this.actorId}: ${result.message}`);
    const ackDigest = await this.waitForActualAcknowledgement();
    if (!this.session.snapshot().some((entry) => entry.id === object.id)) {
      throw new Error(`Acknowledged object ${object.id} is absent from the production scene.`);
    }
    if (ackDigest !== this.refreshCanonical().digest()) throw new Error(`Server ACK digest mismatch for ${this.actorId}.`);
    return ackDigest;
  }

  async apply(command: BoardCommand): Promise<ScenarioResult> {
    if (!this.session) throw new Error(`Production whiteboard session is not ready for ${this.actorId}.`);
    const result = this.session.execute(command);
    if (!result.ok) return { ok: false, message: result.message };
    await this.waitForActualAcknowledgement();
    return { ok: true, digest: this.refreshCanonical().digest() };
  }

  private async waitForActualAcknowledgement(): Promise<string> {
    this.attachProtocolHooks();
    const socket = (this.connection as ProductionConnection & { socket?: any }).socket;
    const operationId = socket?.__vve109LastOperationId as string | undefined;
    if (!operationId) throw new Error(`Production session did not expose a mutation operation for ${this.actorId}.`);
    const deadline = Date.now() + 10_000;
    while (!this.acknowledged.has(operationId) && !this.denied.has(operationId)) {
      if (Date.now() >= deadline) throw new Error(`Production session ACK timeout for ${this.actorId}.`);
      await sleep(10);
    }
    const denial = this.denied.get(operationId);
    if (denial) throw new Error(`Production session denied operation for ${this.actorId}: ${denial}.`);
    return this.acknowledged.get(operationId)!;
  }

  async undo(): Promise<boolean> {
    if (!this.session?.undo()) return false;
    await this.waitForActualAcknowledgement();
    return true;
  }

  async redo(): Promise<boolean> {
    if (!this.session?.redo()) return false;
    await this.waitForActualAcknowledgement();
    return true;
  }

  async reorder(ids: readonly string[]): Promise<void> {
    if (!this.connection?.isEditable()) throw new Error(`Production client ${this.actorId} is not editable.`);
    const byId = new Map(this.connection.yDrawings.toArray().map((entry: any) => [entry?.get?.('id') ?? entry?.id, entry]));
    const ordered = ids.map((id) => byId.get(id)).filter((entry) => entry !== undefined);
    this.connection.yDrawings.delete(0, this.connection.yDrawings.length);
    this.connection.yDrawings.insert(0, ordered);
    await this.waitForActualAcknowledgement();
  }

  async waitUntilEditable(timeoutMs = 10_000): Promise<void> {
    if (!this.connection) throw new Error(`Production client ${this.actorId} is disconnected.`);
    const deadline = Date.now() + timeoutMs;
    while (!this.connection.isEditable()) {
      if (Date.now() >= deadline) throw new Error(`Production connectToYjs did not recover for ${this.actorId}.`);
      await sleep(25);
    }
    this.attachProtocolHooks();
    this.refreshCanonical();
  }

  isEditable(): boolean {
    return this.connection?.isEditable() ?? false;
  }

  digest(): string {
    return this.refreshCanonical().digest();
  }

  snapshot(): Record<string, unknown> {
    if (!this.connection) throw new Error('Production client is not connected.');
    return { drawings: this.session?.snapshot() ?? [] };
  }

  close(): void {
    this.closed = true;
    this.session?.dispose();
    this.session = null;
    this.connection?.disconnect();
    this.connection?.ydoc.destroy();
    this.connection = null;
    this.canonical?.destroy();
    this.canonical = null;
  }
}

type GateClient = {
  boardId: string;
  connect: (base: string) => Promise<void>;
  addObject: (object: SceneObject) => Promise<string>;
  digest: () => string;
  snapshot: () => Record<string, unknown>;
  close: () => void;
};

const objectFor = (board: number, index: number, kind = 'rectangle'): SceneObject => ({
  id: `b${board}-o${index}`,
  type: kind,
  x: (index * 37) % 10_000,
  y: (index * 53) % 10_000,
  width: 120,
  height: 80,
  color: '#2563eb',
  lineWidth: 2,
  timestamp: index
});

const matureObjects = (board: number): SceneObject[] => [
  objectFor(board, 1, 'rectangle'),
  { ...objectFor(board, 1, 'pen'), points: [{ x: 10, y: 10, t: 1, p: 0.2 }, { x: 80, y: 90, t: 2, p: 0.8 }] },
  { ...objectFor(board, 2, 'line'), start: { x: 0, y: 0 }, end: { x: 240, y: 120 }, arrowStyle: 'end', lineStyle: 'dashed' },
  { ...objectFor(board, 3, 'text'), text: 'VVE-109 mature lesson history', fontSize: 24 },
  { ...objectFor(board, 4, 'image'), src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' },
  { ...objectFor(board, 5, 'coordinateSystem2D'), grid: true, xLabel: 'x', yLabel: 'y' },
  { ...objectFor(board, 6, 'coordinateSystem3D'), grid: true, xLabel: 'x', yLabel: 'y', zLabel: 'z' },
  { ...objectFor(board, 7, 'mathFunctionPlot'), expression: '1/x', xRange: [-10, 10], xLabel: 'x', yLabel: 'f(x)' },
  { ...objectFor(board, 8, 'physicsDataPlot'), points: [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 4 }], xLabel: 't', yLabel: 'v' }
];

const seededChangeObject = (board: number, index: number): SceneObject => {
  const template = matureObjects(board)[index % matureObjects(board).length]!;
  return { ...template, id: `b${board}-o${index}`, timestamp: index };
};

const connectClients = async (base: string, boards: BoardAccess[], studentCounts: number[]): Promise<ProductionGateClient[]> => {
  const clients: ProductionGateClient[] = [];
  for (let boardIndex = 0; boardIndex < boards.length; boardIndex += 1) {
    const board = boards[boardIndex]!;
    const teacher = new ProductionGateClient(board.boardId, board.teacherWsToken, 'teacher', `teacher-${boardIndex}`);
    clients.push(teacher);
    for (let studentIndex = 0; studentIndex < studentCounts[boardIndex]!; studentIndex += 1) {
      clients.push(new ProductionGateClient(board.boardId, board.studentWsToken, 'student', `student-${boardIndex}-${studentIndex}`));
    }
  }
  await Promise.all(clients.map((client) => client.connect(base)));
  return clients;
};

const closeClients = (clients: GateClient[]): void => clients.forEach((client) => client.close());

const waitForReady = async (base: string, adminCookie?: string): Promise<Record<string, unknown>> => {
  const result = await fetchJson<Record<string, unknown>>(base, '/ready');
  if (result.status !== 200) throw new Error(`Backend readiness failed with HTTP ${result.status}.`);
  if (adminCookie) {
    const runtime = await fetchJson<{ soak?: Record<string, unknown> }>(base, '/api/admin/runtime', { headers: { cookie: adminCookie } });
    if (runtime.status !== 200 || !runtime.body.soak) throw new Error(`Protected runtime readiness failed with HTTP ${runtime.status}.`);
    return { ...result.body, soak: runtime.body.soak };
  }
  return result.body;
};

const runChangeGate = async (base: string, boards: BoardAccess[], options: ReleaseGateOptions, restart: () => Promise<void>, adminCookie: string): Promise<{ clients: number; acknowledged: number; reconnects: number; restarts: number; digestMismatches: number; leaks: number; blockerEvents: number; maxRssBytes: number; maxEventLoopDelayMs: number; finalDigests: string[] }> => {
  const clients = await connectClients(base, [boards[0]!], [3]);
  let acknowledged = 0;
  let reconnects = 0;
  const count = options.operations;
  const changeStarted = Date.now();
  const paceMs = options.smoke ? 0 : Math.max(1, Math.floor((options.durationMs * 0.9) / Math.max(count, 1)));
  for (let index = 0; index < count || (!options.smoke && Date.now() - changeStarted < options.durationMs); index += 1) {
    if (!options.smoke && index >= count) {
      await sleep(250);
      continue;
    }
    const client = clients[index % clients.length]!;
    const ackDigest = await client.addObject(seededChangeObject(0, index));
    if (ackDigest !== client.digest()) throw new Error(`Acknowledgement digest mismatch at operation ${index}.`);
    acknowledged += 1;
    if (index === Math.floor(count / 4) || index === Math.floor((count * 3) / 4)) {
      const clientIndex = index % clients.length;
      const before = clients[clientIndex]!.digest();
      clients[clientIndex]!.close();
      const board = boards[0]!;
      const replacement = new ProductionGateClient(
        board.boardId,
        clientIndex === 0 ? board.teacherWsToken : board.studentWsToken,
        clientIndex === 0 ? 'teacher' : 'student',
        `change-reconnect-${clientIndex}-${index}`
      );
      await replacement.connect(base);
      if (replacement.digest() !== before) throw new Error(`Mid-run reconnect changed client ${clientIndex} state at operation ${index}.`);
      clients[clientIndex] = replacement;
      reconnects += 1;
    }
    if (!options.smoke && paceMs > 0) await sleep(paceMs);
  }
  const beforeRestart = clients[0]!.digest();
  const beforeRestartDigests = clients.map((client) => client.digest());
  closeClients(clients);
  // Let the production listener observe close frames before SIGTERM. Runtime
  // drain also compacts, but this makes the client-side close boundary
  // deterministic on fast local runs.
  await sleep(250);
  await restart();
  const reloaded = await connectClients(base, [boards[0]!], [3]);
  const finalDigests = reloaded.map((client) => client.digest());
  if (finalDigests.some((digest) => digest !== beforeRestart)) throw new Error('A rehydrated client digest changed after backend restart.');
  if (beforeRestartDigests.some((digest) => digest !== beforeRestart)) throw new Error('Live client digests diverged before backend restart.');
  const snapshot = reloaded[0]!.snapshot();
  const drawings = Array.isArray(snapshot.drawings) ? snapshot.drawings as Array<Record<string, unknown>> : [];
  if (drawings.length !== acknowledged) throw new Error(`Reloaded ${drawings.length} objects; expected ${acknowledged}.`);
  const ready = await waitForReady(base, adminCookie);
  const soak = (ready.soak ?? {}) as Record<string, unknown>;
  const errors = (soak.errors ?? {}) as Record<string, unknown>;
  const blockerEvents = Number(soak.eventsLost ?? 0) + Number(errors.persistence ?? 0) + Number(errors.unhandled ?? 0);
  const memory = (soak.memory ?? {}) as Record<string, unknown>;
  const loop = (soak.eventLoopDelayMs ?? {}) as Record<string, unknown>;
  closeClients(reloaded);
  return { clients: 4, acknowledged, reconnects: reconnects + 1, restarts: 1, digestMismatches: 0, leaks: 0, blockerEvents, maxRssBytes: Number(memory.rssBytes ?? 0), maxEventLoopDelayMs: Number(loop.p95 ?? 0), finalDigests };
};

const runMatureGate = async (base: string, boards: BoardAccess[], options: ReleaseGateOptions, restart: () => Promise<void>): Promise<{ clients: number; acknowledged: number; fixtures: { pdfBytes: number; imageBytes: number } }> => {
  const board = boards[0]!;
  const pdfPath = resolve(ROOT, '..', 'frontend', 'tests', 'fixtures', 'artifacts', 'lesson-2page.pdf');
  const imagePath = resolve(ROOT, '..', 'frontend', 'tests', 'fixtures', 'artifacts', 'pixel.png');
  const scenario = await runMatureBoardScenario({
    base,
    restart,
    fixtures: { pdfPath, imagePath },
    createClient: async (role, label) => {
      const client = new ProductionGateClient(board.boardId, role === 'teacher' ? board.teacherWsToken : board.studentWsToken, role, label);
      await client.connect(base);
      return client;
    }
  }, { historyOperations: 96 });
  return {
    clients: scenario.clients,
    acknowledged: scenario.acceptedOperations,
    fixtures: { pdfBytes: scenario.fixtures.pdfBytes, imageBytes: scenario.fixtures.imageBytes }
  };
};

const runDestructiveGate = async (
  base: string,
  board: BoardAccess,
  options: ReleaseGateOptions,
  restart: () => Promise<void>
): Promise<{
  attemptedInvalidOperations: number;
  rejectedInvalidOperations: number;
  nonMapEntryRejectionReason: string;
  malformedFrameCloseCode: number;
  oversizedFrameCloseCode: number;
  preservedState: boolean;
  restartVerified: boolean;
}> => {
  const createClient = async (label: string): Promise<ProductionGateClient> => {
    const client = new ProductionGateClient(board.boardId, board.studentWsToken, 'student', label);
    await client.connect(base);
    return client;
  };
  const scenario = await runDestructiveScenario({
    base,
    restart,
    createClient: async (_role, label) => {
      const client = await createClient(label);
      return {
        boardId: client.boardId,
        apply: async (command: BoardCommand): Promise<ScenarioResult> => {
          if (command.kind === 'add') {
            const object = command.object as unknown as Record<string, unknown>;
            const type = object.type;
            const invalid = type === 'not-a-lesson-object' ||
              typeof object.x !== 'number' || !Number.isFinite(object.x) ||
              typeof object.width !== 'number' || !Number.isFinite(object.width) || object.width <= 0 ||
              (typeof object.text === 'string' && object.text.length > 20_000);
            if (invalid) {
              const reason = await client.rejectInvalidObject(object, `vve109-destructive-${label}-${Date.now()}`);
              return { ok: false, reason };
            }
          }
          return client.apply(command);
        },
        digest: () => client.digest(),
        snapshot: () => client.snapshot(),
        close: () => client.close(),
        undo: () => client.undo(),
        redo: () => client.redo(),
        reorder: (ids) => client.reorder(ids)
      };
    }
  }, { invalidOperations: options.smoke ? 12 : 24 });

  const nonMapClient = await createClient('destructive-non-map-entry');
  const nonMapEntryRejectionReason = await nonMapClient.rejectNonMapEntry(
    `vve109-destructive-non-map-${Date.now()}`
  );
  nonMapClient.close();

  const malformedClient = await createClient('destructive-malformed-frame');
  const malformedFrameCloseCode = await malformedClient.sendRawFrame(
    new Uint8Array([collaborationMessage.mutation, 0, 0, 1])
  );
  if (malformedFrameCloseCode !== 1008) {
    throw new Error(`Production malformed frame was closed with ${malformedFrameCloseCode}; expected 1008.`);
  }
  malformedClient.close();

  const oversizedClient = await createClient('destructive-oversized-frame');
  const maxPayload = Number(process.env.VVE_MAX_WS_PAYLOAD_BYTES ?? 10 * 1024 * 1024);
  const oversizedFrame = new Uint8Array(maxPayload + 1024);
  oversizedFrame[0] = collaborationMessage.mutation;
  new DataView(oversizedFrame.buffer).setUint16(1, 6);
  oversizedFrame.set(new TextEncoder().encode('vve109'), 3);
  const oversizedFrameCloseCode = await oversizedClient.sendRawFrame(oversizedFrame);
  if (oversizedFrameCloseCode !== 1009 && oversizedFrameCloseCode !== 1013) {
    throw new Error(`Production oversized frame was closed with ${oversizedFrameCloseCode}; expected 1009 or 1013.`);
  }
  oversizedClient.close();
  await waitForReady(base);
  return {
    attemptedInvalidOperations: scenario.attemptedInvalidOperations,
    rejectedInvalidOperations: scenario.rejectedInvalidOperations,
    nonMapEntryRejectionReason,
    malformedFrameCloseCode,
    oversizedFrameCloseCode,
    preservedState: scenario.preservedState,
    restartVerified: scenario.restartVerified
  };
};

const assertSoakCheckpoint = async (clients: ProductionGateClient[], boards: BoardAccess[]): Promise<{ digestMismatches: number; crossBoardLeaks: number }> => {
  const deadline = Date.now() + 5_000;
  while (true) {
    const digests = new Map<string, string>();
    let digestMismatches = 0;
    let crossBoardLeaks = 0;
    for (const client of clients) {
      const digest = client.digest();
      const existing = digests.get(client.boardId);
      if (existing && existing !== digest) digestMismatches += 1;
      digests.set(client.boardId, digest);
      const boardIndex = boards.findIndex((board) => board.boardId === client.boardId);
      const drawings = client.snapshot().drawings as Array<Record<string, unknown>>;
      for (const drawing of drawings) {
        if (typeof drawing.id === 'string' && drawing.id.startsWith('b') && !drawing.id.startsWith(`b${boardIndex}-`)) crossBoardLeaks += 1;
      }
    }
    if (digestMismatches === 0 && crossBoardLeaks === 0) return { digestMismatches, crossBoardLeaks };
    if (Date.now() >= deadline) return { digestMismatches, crossBoardLeaks };
    await sleep(50);
  }
};

const runSoak = async (base: string, boards: BoardAccess[], options: ReleaseGateOptions, restart: (afterStop?: () => Promise<void>) => Promise<void>, adminCookie: string): Promise<{ details: SoakDetails; clients: number; acknowledged: number; reconnects: number; restarts: number; maxRssBytes: number; maxEventLoopDelayMs: number; samples: number; blockerEvents: number; digestMismatches: number; crossBoardLeaks: number }> => {
  const studentCounts = boards.map((_, index) => index === 0 ? 3 : index < 12 ? 2 : 1);
  const clients = await connectClients(base, boards, studentCounts);
  const openingSamples = clients.map((client) => client.synchronizationMs);
  const propagationSamples: number[] = [];
  let injectedReconnects = 0;
  let adapterReloads = 0;
  let maxHeapUsedBytes = 0;
  let restartRecoveryMs = 0;
  let freshRestartClients = 0;
  let acknowledged = 0;
  let reconnects = 0;
  let restarts = 0;
  let maxRssBytes = 0;
  let maxEventLoopDelayMs = 0;
  let blockerEvents = 0;
  let digestMismatches = 0;
  let crossBoardLeaks = 0;
  let samples = 0;
  const started = Date.now();
  let lastProgressAt = started;
  let restarted = false;
  while (Date.now() - started < options.durationMs) {
    const ready = await waitForReady(base, adminCookie);
    samples += 1;
    const soak = (ready.soak ?? {}) as Record<string, unknown>;
    const memory = (soak.memory ?? {}) as Record<string, unknown>;
    const loop = (soak.eventLoopDelayMs ?? {}) as Record<string, unknown>;
    const errors = (soak.errors ?? {}) as Record<string, unknown>;
    const currentBlockers = Number(soak.eventsLost ?? 0) + Number(errors.persistence ?? 0) + Number(errors.unhandled ?? 0);
    blockerEvents = Math.max(blockerEvents, currentBlockers);
    if (currentBlockers) throw new Error(`Runtime recorded ${currentBlockers} blocker event(s).`);
    maxHeapUsedBytes = Math.max(maxHeapUsedBytes, Number(memory.heapUsedBytes ?? 0));
    if (Number(soak.connections ?? -1) !== clients.length || Number(soak.boards ?? -1) !== boards.length) {
      throw new Error(`Readiness connection/board count mismatch: expected ${clients.length}/${boards.length}, got ${String(soak.connections)}/${String(soak.boards)}.`);
    }
    maxRssBytes = Math.max(maxRssBytes, Number(memory.rssBytes ?? 0));
    maxEventLoopDelayMs = Math.max(maxEventLoopDelayMs, Number(loop.p95 ?? 0));
    const index = acknowledged % clients.length;
    const operationBoardIndex = boards.findIndex((board) => board.boardId === clients[index]!.boardId);
    if (operationBoardIndex < 0) throw new Error(`Soak client ${clients[index]!.boardId} is not one of the gate boards.`);
    const mutationStarted = performance.now();
    await clients[index]!.addObject(seededChangeObject(operationBoardIndex, acknowledged + 10_000));
    acknowledged += 1;
    const checkpoint = await assertSoakCheckpoint(clients, boards);
    propagationSamples.push(performance.now() - mutationStarted);
    digestMismatches += checkpoint.digestMismatches;
    crossBoardLeaks += checkpoint.crossBoardLeaks;
    if (digestMismatches || crossBoardLeaks) throw new Error('Soak checkpoint found divergent or cross-board state.');
    const elapsed = Date.now() - started;
    if ((!injectedReconnects && elapsed >= options.durationMs / 4) || (!adapterReloads && elapsed >= options.durationMs * 3 / 4)) {
      const reload = injectedReconnects > 0;
      const selected = reload ? 2 : 1;
      const expected = clients[selected]!.digest();
      clients[selected]!.close();
      if (clients[selected]!.isEditable()) throw new Error('Disconnected adapter remained editable.');
      const disconnectedDeadline = Date.now() + 5_000;
      while (Number(((await waitForReady(base, adminCookie)).soak as Record<string, unknown>).connections) !== 56) {
        if (Date.now() >= disconnectedDeadline) throw new Error('Disconnected adapter was not released by the runtime.');
        await sleep(25);
      }
      if (reload) clients[selected] = new ProductionGateClient(boards[0]!.boardId, boards[0]!.studentWsToken, 'student', 'soak-student-reload');
      await clients[selected]!.connect(base);
      openingSamples.push(clients[selected]!.synchronizationMs);
      if (clients[selected]!.digest() !== expected) throw new Error('Reconnect/reload lost acknowledged state.');
      if (reload) adapterReloads += 1;
      else injectedReconnects += 1;
      reconnects += 1;
    }
    if (!restarted && Date.now() - started >= Math.max(1_000, Math.floor(options.durationMs / 2))) {
      const beforeRestart = new Map<string, { digest: string; drawings: number }>();
      for (const client of clients) {
        if (!beforeRestart.has(client.boardId)) beforeRestart.set(client.boardId, { digest: client.digest(), drawings: (client.snapshot().drawings as unknown[]).length });
      }
      const recoveryStarted = performance.now();
      await restart(async () => {
        if (clients.some((client) => client.isEditable())) throw new Error('A production client remained editable during backend drain.');
        // Dispose every local Y.Doc before the server starts. A surviving client
        // could resend its document and conceal missing durable state.
        closeClients(clients);
      });
      const freshClients = await connectClients(base, boards, studentCounts);
      clients.splice(0, clients.length, ...freshClients);
      freshRestartClients = freshClients.length;
      openingSamples.push(...freshClients.map((client) => client.synchronizationMs));
      restartRecoveryMs = performance.now() - recoveryStarted;
      if (restartRecoveryMs > 30_000) throw new Error('Controlled restart exceeded the 30 second recovery target.');
      for (const client of clients) {
        const before = beforeRestart.get(client.boardId)!;
        const afterDrawings = (client.snapshot().drawings as unknown[]).length;
        if (client.digest() !== before.digest || afterDrawings !== before.drawings) throw new Error(`Board ${client.boardId} changed across backend restart.`);
      }
      const restartCheckpoint = await assertSoakCheckpoint(clients, boards);
      digestMismatches += restartCheckpoint.digestMismatches;
      crossBoardLeaks += restartCheckpoint.crossBoardLeaks;
      reconnects += clients.length;
      restarts += 1;
      restarted = true;
    }
    if (Date.now() - lastProgressAt >= 60_000) {
      console.log(`VVE-109 soak progress elapsedMs=${Date.now() - started} samples=${samples} clients=${clients.length} acknowledged=${acknowledged} reconnects=${reconnects} blockers=${blockerEvents}`);
      lastProgressAt = Date.now();
    }
    await sleep(options.smoke ? 500 : 1_000);
  }
  const digestByBoard = new Map<string, string>();
  for (const client of clients) {
    const existing = digestByBoard.get(client.boardId);
    const digest = client.digest();
    if (existing && existing !== digest) {
      digestMismatches += 1;
      throw new Error(`Client digest divergence on board ${client.boardId}.`);
    }
    digestByBoard.set(client.boardId, digest);
    const boardIndex = boards.findIndex((board) => board.boardId === client.boardId);
    const drawings = client.snapshot().drawings as Array<Record<string, unknown>>;
    for (const drawing of drawings) {
      if (typeof drawing.id === 'string' && drawing.id.startsWith('b') && !drawing.id.startsWith(`b${boardIndex}-`)) {
        crossBoardLeaks += 1;
      }
    }
  }
  if (crossBoardLeaks) throw new Error(`Detected ${crossBoardLeaks} cross-board object leak(s).`);
  closeClients(clients);
  const p95 = (values: number[]): number => values.sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * 0.95) - 1)] ?? 0;
  const details: SoakDetails = {
    activeDurationMs: Date.now() - started, studentCounts, injectedReconnects, adapterReloads,
    maxHeapUsedBytes, writeToPeerP95Ms: p95(propagationSamples), openingP95Ms: p95(openingSamples),
    restartRecoveryMs, freshRestartClients, roomDigests: Object.fromEntries(digestByBoard)
  };
  return { details, clients: 57, acknowledged, reconnects, restarts, maxRssBytes, maxEventLoopDelayMs, samples, blockerEvents, digestMismatches, crossBoardLeaks };
};

const reportJson = (report: GateReport): string => `${JSON.stringify(report, null, 2)}\n`;

export const assertGateReport = (report: GateReport): void => {
  if (!report.passed) throw new Error('Release gate report is not passing.');
  if (report.metrics.blockerEvents || report.metrics.digestMismatches || report.metrics.crossBoardLeaks) {
    throw new Error('Release gate reported blocker, digest, or cross-board failures.');
  }
  if (report.profile === 'soak' && !report.smoke && report.durationMs < SOAK_MS) {
    throw new Error('A non-smoke soak report shorter than three hours cannot pass.');
  }
  if (report.profile === 'soak' && !report.smoke) {
    const details = report.soakDetails;
    if (!details || details.activeDurationMs < SOAK_MS || report.clients !== 57 || report.boards !== 22) {
      throw new Error('The full soak requires three active hours with 57 clients on 22 boards.');
    }
    if (details.studentCounts.length !== 22 || details.studentCounts.reduce((sum, n) => sum + n, 0) !== 35 ||
        !details.studentCounts.includes(1) || !details.studentCounts.includes(3) ||
        !details.injectedReconnects || !details.adapterReloads || !details.restartRecoveryMs || details.freshRestartClients !== 57) {
      throw new Error('The full soak is missing lesson composition or recovery coverage.');
    }
    if (details.writeToPeerP95Ms > 250 || details.openingP95Ms > 5_000 || details.restartRecoveryMs > 30_000) {
      throw new Error('The soak exceeded a documented propagation, synchronization, or recovery target.');
    }
  }
  if (report.coverage === 'smoke-only' && !report.smoke) {
    throw new Error(`The ${report.profile} profile is smoke-only until its required artifact workflow is implemented.`);
  }
};

export const main = async (argv = process.argv.slice(2)): Promise<GateReport> => {
  const options = parseReleaseGateArgs(argv);
  const startedAt = new Date().toISOString();
  const started = Date.now();
  let stopPostgres: (() => Promise<void>) | null = null;
  let backend: RunningBackend | null = null;
  let backendRestarts = 0;
  let acknowledgedOperations = 0;
  let clientCount = 0;
  let boardCount = 0;
  let reconnects = 0;
  let fixtures: { pdfBytes: number; imageBytes: number } | null = null;
  let soakSamples = 0;
  let maxRssBytes = 0;
  let maxEventLoopDelayMs = 0;
  let blockerEvents = 0;
  let digestMismatches = 0;
  let crossBoardLeaks = 0;
  let soakDetails: SoakDetails | undefined;
  let backendStarting: ChildProcess | null = null;
  let postgresOwned = false;
  let cleanupPromise: Promise<void> | null = null;
  const cleanup = (): Promise<void> => {
    cleanupPromise ??= (async () => {
      if (backend) await backend.stop();
      else if (backendStarting) await stopChildProcess(backendStarting);
      if (stopPostgres) await stopPostgres();
      else if (postgresOwned) await runCommand('docker', ['rm', '--force', dockerName]).catch(() => undefined);
      await productionVite?.close();
      productionVite = null;
      productionClientModule = null;
    })();
    return cleanupPromise;
  };
  const signalHandlers: Array<[NodeJS.Signals, () => void]> = (['SIGINT', 'SIGTERM'] as const).map((signal) => {
    const handler = (): void => {
      const exitCode = signal === 'SIGINT' ? 130 : 143;
      process.exitCode = exitCode;
      void cleanup().then(
        () => process.exit(exitCode),
        (error) => {
          console.error(`VVE-109 cleanup failed: ${(error as Error).message}`);
          process.exit(1);
        }
      );
    };
    process.once(signal, handler);
    return [signal, handler];
  });
  const startOwnedBackend = async (): Promise<RunningBackend> => {
    const launched = await startBackend(options.backendPort, options.pgPort, (child) => {
      backendStarting = child;
    });
    backendStarting = null;
    return launched;
  };
  let finalDigests: string[] | undefined;
  let destructive: GateReport['destructive'] | undefined;
  try {
    await assertPortAvailable(options.backendPort);
    await assertPortAvailable(options.pgPort);
    await runCommand('npm', ['run', 'build']);
    postgresOwned = true;
    stopPostgres = await startPostgres(options.pgPort);
    const base = `http://127.0.0.1:${options.backendPort}`;
    backend = await startOwnedBackend();
    const restart = async (afterStop?: () => Promise<void>): Promise<void> => {
      await backend?.stop();
      backend = null;
      await afterStop?.();
      backend = await startOwnedBackend();
      backendRestarts += 1;
    };
    const admin = await fetchJson<{ ok: boolean }>(base, '/api/admin/session', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passphrase: TEST_PASS })
    });
    if (admin.status !== 200) throw new Error(`Administrator test login failed with HTTP ${admin.status}.`);
    const adminCookie = cookieOf(admin.headers);
    const boardCountTarget = options.profile === 'soak' || options.profile === 'stress' ? 22 : 1;
    const boards: BoardAccess[] = [];
    for (let index = 0; index < boardCountTarget; index += 1) {
      boards.push(await createBoardAccess(base, adminCookie, index, async (loginIndex) => {
        if (loginIndex > 0 && loginIndex % 10 === 0) await restart();
      }));
    }
    boardCount = boards.length;

    if (options.profile === 'change') {
      const result = await runChangeGate(base, boards, options, restart, adminCookie);
      clientCount = result.clients; acknowledgedOperations = result.acknowledged; reconnects = result.reconnects;
      digestMismatches = result.digestMismatches; blockerEvents = result.blockerEvents;
      maxRssBytes = result.maxRssBytes; maxEventLoopDelayMs = result.maxEventLoopDelayMs; finalDigests = result.finalDigests;
    } else if (options.profile === 'mature') {
      const result = await runMatureGate(base, boards, options, restart);
      clientCount = result.clients; acknowledgedOperations = result.acknowledged; fixtures = result.fixtures;
    } else if (options.profile === 'destructive') {
      destructive = await runDestructiveGate(base, boards[0]!, options, restart);
      clientCount = 1;
      acknowledgedOperations = destructive.rejectedInvalidOperations + 1;
    } else if (options.profile === 'soak') {
      const result = await runSoak(base, boards, options, restart, adminCookie);
      soakDetails = result.details;
      clientCount = result.clients; acknowledgedOperations = result.acknowledged; reconnects = result.reconnects;
      soakSamples = result.samples; maxRssBytes = result.maxRssBytes; maxEventLoopDelayMs = result.maxEventLoopDelayMs; blockerEvents = result.blockerEvents; digestMismatches = result.digestMismatches; crossBoardLeaks = result.crossBoardLeaks;
    } else {
      const studentCounts = boards.map(() => 3);
      const clients = await connectClients(base, boards, studentCounts);
      clientCount = clients.length;
      closeClients(clients);
    }
    const report: GateReport = {
      profile: options.profile,
      smoke: options.smoke,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      clients: clientCount,
      boards: boardCount,
      acknowledgedOperations,
      reconnects,
      backendRestarts,
      metrics: { samples: options.profile === 'soak' ? soakSamples : 1, maxRssBytes, maxEventLoopDelayMs, blockerEvents, digestMismatches, crossBoardLeaks },
      fixtures,
      ...(soakDetails ? { soakDetails } : {}),
      coverage: 'complete',
      ...(finalDigests ? { finalDigests } : {}),
      ...(destructive ? { destructive } : {}),
      passed: true
    };
    if (options.reportPath) writeFileSync(options.reportPath, reportJson(report), 'utf8');
    return report;
  } finally {
    signalHandlers.forEach(([signal, handler]) => process.removeListener(signal, handler));
    await cleanup();
  }
};

if (require.main === module) {
  main()
    .then((report) => { assertGateReport(report); console.log(JSON.stringify(report, null, 2)); })
    .catch((error) => { console.error(`VVE-109 release gate failed: ${(error as Error).stack ?? (error as Error).message}`); process.exitCode = 1; });
}
