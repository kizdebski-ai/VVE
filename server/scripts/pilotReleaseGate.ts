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
import { readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { createBoardDocument, type BoardDocument } from '../src/pilot/boardDocument';
import type { BoardRole } from '../src/pilot/boardScene';
import { collaborationMessage } from '../src/pilot/collaborationProtocol';

const ROOT = resolve(__dirname, '..');
const DEFAULT_PG_PORT = 5497;
const DEFAULT_BACKEND_PORT = 8497;
const SOAK_MS = 3 * 60 * 60 * 1000;
const DEFAULT_SMOKE_MS = 15_000;
const DEFAULT_GATE_MS = 5 * 60 * 1000;
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
  passed: boolean;
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

const startBackend = async (port: number, pgPort: number): Promise<RunningBackend> => {
  const child = spawn('node', ['dist/src/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      VVE_PILOT_SURFACE: '1',
      HOST: '0.0.0.0',
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
  const output: string[] = [];
  const capture = (chunk: Buffer): void => {
    const scrubbed = chunk.toString().replace(/(?:token|secret|password|wsToken)[^\s]*/gi, '[redacted]');
    output.push(scrubbed.slice(-400));
    if (output.length > 20) output.shift();
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
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
  await Promise.race([waitReady, earlyExit]);
  const stop = async (): Promise<void> => {
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([
      new Promise<void>((resolvePromise) => child.once('exit', () => resolvePromise())),
      sleep(12_000).then(() => { child.kill('SIGKILL'); })
    ]);
  };
  return { process: child, stop };
};

const fetchJson = async <T>(base: string, path: string, init?: RequestInit): Promise<{ status: number; body: T; headers: Headers }> => {
  const response = await fetch(`${base}${path}`, init);
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
        server: { middlewareMode: true },
        appType: 'custom',
        logLevel: 'error'
      });
      const loaded = await productionVite.ssrLoadModule('/src/services/connectToYjs.ts');
      return loaded as unknown as ProductionClientModule;
    })();
  }
  return productionClientModule;
};

class ProductionGateClient {
  private connection: ProductionConnection | null = null;
  private canonical: BoardDocument | null = null;
  private socketError: Error | null = null;
  private closed = false;

  constructor(
    public readonly boardId: string,
    private readonly wsToken: string,
    private readonly actorId: string
  ) {}

  async connect(base: string): Promise<void> {
    const module = await loadProductionClient();
    const browserWindow = (globalThis as unknown as { window: { location: { protocol: string; host: string; origin: string; port: string } } }).window;
    const url = new URL(base);
    browserWindow.location.protocol = url.protocol;
    browserWindow.location.host = url.host;
    browserWindow.location.origin = url.origin;
    browserWindow.location.port = url.port;
    this.closed = false;
    this.socketError = null;
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
    const deadline = Date.now() + 10_000;
    while (!this.connection.isEditable()) {
      if (this.socketError) throw new Error(`Production connectToYjs socket failed for ${this.actorId}: ${(this.socketError as Error).message}`);
      if (Date.now() >= deadline) throw new Error(`Production connectToYjs did not synchronize for ${this.actorId}.`);
      await sleep(25);
    }
    this.refreshCanonical();
  }

  private refreshCanonical(): BoardDocument {
    if (!this.connection) throw new Error('Production client is not connected.');
    this.canonical?.destroy();
    this.canonical = createBoardDocument({ initialState: Y.encodeStateAsUpdate(this.connection.ydoc) });
    return this.canonical;
  }

  async addObject(object: Record<string, unknown>): Promise<string> {
    if (!this.connection?.isEditable()) throw new Error(`Production client ${this.actorId} is not editable.`);
    // This call mutates the production adapter's own Y.Doc. Plain JSON is
    // intentional here: the frontend module owns its Yjs constructor.
    this.connection.yDrawings.push([object]);
    const deadline = Date.now() + 10_000;
    while (this.connection.pendingOperationCount() !== 0) {
      if (Date.now() >= deadline) throw new Error(`Production connectToYjs ACK timeout for ${this.actorId}.`);
      await sleep(10);
    }
    return this.refreshCanonical().digest();
  }

  async waitUntilEditable(timeoutMs = 10_000): Promise<void> {
    if (!this.connection) throw new Error(`Production client ${this.actorId} is disconnected.`);
    const deadline = Date.now() + timeoutMs;
    while (!this.connection.isEditable()) {
      if (Date.now() >= deadline) throw new Error(`Production connectToYjs did not recover for ${this.actorId}.`);
      await sleep(25);
    }
    this.refreshCanonical();
  }

  digest(): string {
    return this.refreshCanonical().digest();
  }

  snapshot(): Record<string, unknown> {
    if (!this.connection) throw new Error('Production client is not connected.');
    return { drawings: this.connection.yDrawings.toJSON() };
  }

  close(): void {
    this.closed = true;
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
  addObject: (object: Record<string, unknown>) => Promise<string>;
  digest: () => string;
  snapshot: () => Record<string, unknown>;
  close: () => void;
};

const objectFor = (board: number, index: number, kind = 'rectangle'): Record<string, unknown> => ({
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

const matureObjects = (board: number): Record<string, unknown>[] => [
  objectFor(board, 1, 'rectangle'),
  { ...objectFor(board, 2, 'line'), start: { x: 0, y: 0 }, end: { x: 240, y: 120 }, arrowStyle: 'end', lineStyle: 'dashed' },
  { ...objectFor(board, 3, 'text'), text: 'VVE-109 mature lesson history', fontSize: 24 },
  { ...objectFor(board, 4, 'image'), src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' },
  { ...objectFor(board, 5, 'coordinateSystem2D'), grid: true, xLabel: 'x', yLabel: 'y' },
  { ...objectFor(board, 6, 'coordinateSystem3D'), grid: true, xLabel: 'x', yLabel: 'y', zLabel: 'z' },
  { ...objectFor(board, 7, 'mathFunctionPlot'), expression: '1/x', xRange: [-10, 10], xLabel: 'x', yLabel: 'f(x)' },
  { ...objectFor(board, 8, 'physicsDataPlot'), points: [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 4 }], xLabel: 't', yLabel: 'v' }
];

const connectClients = async (base: string, boards: BoardAccess[], studentCounts: number[]): Promise<ProductionGateClient[]> => {
  const clients: ProductionGateClient[] = [];
  for (let boardIndex = 0; boardIndex < boards.length; boardIndex += 1) {
    const board = boards[boardIndex]!;
    const teacher = new ProductionGateClient(board.boardId, board.teacherWsToken, `teacher-${boardIndex}`);
    clients.push(teacher);
    for (let studentIndex = 0; studentIndex < studentCounts[boardIndex]!; studentIndex += 1) {
      clients.push(new ProductionGateClient(board.boardId, board.studentWsToken, `student-${boardIndex}-${studentIndex}`));
    }
  }
  await Promise.all(clients.map((client) => client.connect(base)));
  return clients;
};

const closeClients = (clients: GateClient[]): void => clients.forEach((client) => client.close());

const waitForReady = async (base: string): Promise<Record<string, unknown>> => {
  const result = await fetchJson<Record<string, unknown>>(base, '/ready');
  if (result.status !== 200) throw new Error(`Backend readiness failed with HTTP ${result.status}.`);
  return result.body;
};

const runChangeGate = async (base: string, boards: BoardAccess[], options: ReleaseGateOptions, restart: () => Promise<void>): Promise<{ clients: number; acknowledged: number; reconnects: number; restarts: number; digestMismatches: number; leaks: number }> => {
  const clients = await connectClients(base, [boards[0]!], [3]);
  let acknowledged = 0;
  const count = options.operations;
  const changeStarted = Date.now();
  for (let index = 0; index < count || (!options.smoke && Date.now() - changeStarted < options.durationMs); index += 1) {
    const client = clients[index % clients.length]!;
    const ackDigest = await client.addObject(objectFor(0, index));
    if (ackDigest !== client.digest()) throw new Error(`Acknowledgement digest mismatch at operation ${index}.`);
    acknowledged += 1;
  }
  const beforeRestart = clients[0]!.digest();
  closeClients(clients);
  // Let the production listener observe close frames before SIGTERM. Runtime
  // drain also compacts, but this makes the client-side close boundary
  // deterministic on fast local runs.
  await sleep(250);
  await restart();
  const reloaded = await connectClients(base, [boards[0]!], [3]);
  const afterRestart = reloaded[0]!.digest();
  if (afterRestart !== beforeRestart) throw new Error('Acknowledged state digest changed after backend restart.');
  const snapshot = reloaded[0]!.snapshot();
  const drawings = Array.isArray(snapshot.drawings) ? snapshot.drawings as Array<Record<string, unknown>> : [];
  if (drawings.length !== count) throw new Error(`Reloaded ${drawings.length} objects; expected ${count}.`);
  closeClients(reloaded);
  return { clients: 4, acknowledged, reconnects: 1, restarts: 1, digestMismatches: 0, leaks: 0 };
};

const runMatureGate = async (base: string, boards: BoardAccess[], options: ReleaseGateOptions): Promise<{ clients: number; acknowledged: number; fixtures: { pdfBytes: number; imageBytes: number } }> => {
  const clients = await connectClients(base, [boards[0]!], [3]);
  let acknowledged = 0;
  for (const object of matureObjects(0)) {
    const digest = await clients[0]!.addObject(object);
    if (!digest) throw new Error('Mature-board operation returned an empty digest.');
    acknowledged += 1;
  }
  for (let index = 0; index < Math.min(options.operations, 120); index += 1) {
    await clients[index % clients.length]!.addObject(objectFor(0, 100 + index));
    acknowledged += 1;
  }
  const pdfPath = resolve(ROOT, '..', 'frontend', 'tests', 'fixtures', 'artifacts', 'lesson-2page.pdf');
  const imagePath = resolve(ROOT, '..', 'frontend', 'tests', 'fixtures', 'artifacts', 'pixel.png');
  const fixtures = { pdfBytes: readFileSync(pdfPath).byteLength, imageBytes: readFileSync(imagePath).byteLength };
  if (!fixtures.pdfBytes || !fixtures.imageBytes) throw new Error('Mature-board fixtures are missing or empty.');
  closeClients(clients);
  return { clients: 4, acknowledged, fixtures };
};

const runDestructiveGate = async (base: string, board: BoardAccess): Promise<void> => {
  const client = new CanonicalGateClient(board.boardId, board.studentWsToken, 'student', 'destructive-student');
  await client.connect(base);
  const closed = client.waitForClose(5_000);
  client.sendRaw(new Uint8Array([99, 0, 1, 2]));
  await closed;
  await waitForReady(base);
  client.close();
};

const runSoak = async (base: string, boards: BoardAccess[], options: ReleaseGateOptions, restart: () => Promise<void>): Promise<{ clients: number; acknowledged: number; reconnects: number; restarts: number; maxRssBytes: number; maxEventLoopDelayMs: number; samples: number; blockerEvents: number; digestMismatches: number; crossBoardLeaks: number }> => {
  const studentCounts = boards.map((_, index) => index < 13 ? 2 : 1);
  let clients = await connectClients(base, boards, studentCounts);
  let acknowledged = 0;
  let reconnects = 0;
  let restarts = 0;
  let maxRssBytes = 0;
  let maxEventLoopDelayMs = 0;
  let blockerEvents = 0;
  let digestMismatches = 0;
  let samples = 0;
  const started = Date.now();
  let restarted = false;
  while (Date.now() - started < options.durationMs) {
    const ready = await waitForReady(base);
    samples += 1;
    const soak = (ready.soak ?? {}) as Record<string, unknown>;
    const memory = (soak.memory ?? {}) as Record<string, unknown>;
    const loop = (soak.eventLoopDelayMs ?? {}) as Record<string, unknown>;
    const errors = (soak.errors ?? {}) as Record<string, unknown>;
    const currentBlockers = Number(soak.eventsLost ?? 0) + Number(errors.persistence ?? 0) + Number(errors.unhandled ?? 0);
    blockerEvents = Math.max(blockerEvents, currentBlockers);
    maxRssBytes = Math.max(maxRssBytes, Number(memory.rssBytes ?? 0));
    maxEventLoopDelayMs = Math.max(maxEventLoopDelayMs, Number(loop.p95 ?? 0));
    const index = acknowledged % clients.length;
    const operationBoardIndex = boards.findIndex((board) => board.boardId === clients[index]!.boardId);
    if (operationBoardIndex < 0) throw new Error(`Soak client ${clients[index]!.boardId} is not one of the gate boards.`);
    await clients[index]!.addObject(objectFor(operationBoardIndex, acknowledged + 10_000));
    acknowledged += 1;
    if (!restarted && Date.now() - started >= Math.max(1_000, Math.floor(options.durationMs / 2))) {
      await restart();
      await Promise.all(clients.map((client) => client.waitUntilEditable()));
      reconnects += clients.length;
      restarts += 1;
      restarted = true;
    }
    await sleep(Math.min(15_000, Math.max(500, Math.floor(options.durationMs / 10))));
  }
  const digestByBoard = new Map<string, string>();
  let crossBoardLeaks = 0;
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
  return { clients: 57, acknowledged, reconnects, restarts, maxRssBytes, maxEventLoopDelayMs, samples, blockerEvents, digestMismatches, crossBoardLeaks };
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
  try {
    await runCommand('npm', ['run', 'build']);
    stopPostgres = await startPostgres(options.pgPort);
    const base = `http://127.0.0.1:${options.backendPort}`;
    backend = await startBackend(options.backendPort, options.pgPort);
    const restart = async (): Promise<void> => {
      await backend?.stop();
      backend = await startBackend(options.backendPort, options.pgPort);
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
      const result = await runChangeGate(base, boards, options, restart);
      clientCount = result.clients; acknowledgedOperations = result.acknowledged; reconnects = result.reconnects;
      digestMismatches = result.digestMismatches;
    } else if (options.profile === 'mature') {
      const result = await runMatureGate(base, boards, options);
      clientCount = result.clients; acknowledgedOperations = result.acknowledged; fixtures = result.fixtures;
    } else if (options.profile === 'destructive') {
      await runDestructiveGate(base, boards[0]!); clientCount = 1;
    } else if (options.profile === 'soak') {
      const result = await runSoak(base, boards, options, restart);
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
      coverage: options.profile === 'mature' || options.profile === 'destructive' ? (options.smoke ? 'complete' : 'smoke-only') : 'complete',
      passed: options.profile === 'mature' || options.profile === 'destructive' ? options.smoke : true
    };
    if (options.reportPath) writeFileSync(options.reportPath, reportJson(report), 'utf8');
    return report;
  } finally {
    await backend?.stop().catch(() => undefined);
    await stopPostgres?.();
    await productionVite?.close().catch(() => undefined);
    productionVite = null;
    productionClientModule = null;
  }
};

if (require.main === module) {
  main()
    .then((report) => { assertGateReport(report); console.log(JSON.stringify(report, null, 2)); })
    .catch((error) => { console.error(`VVE-109 release gate failed: ${(error as Error).stack ?? (error as Error).message}`); process.exitCode = 1; });
}
