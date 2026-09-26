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
import { MEASURED_RESOURCE_LIMITS } from '../src/pilot/resourceLimits';
import {
  PROTOCOL_GATE_NOT_COVERED,
  runDestructiveScenario,
  runMatureBoardScenario,
  type ScenarioResult
} from './pilotGateScenarios';
import type { BoardCommand, SceneObject } from '../src/pilot/boardScene';
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
    clientErrors: number;
    digestMismatches: number;
    crossBoardLeaks: number;
    /** ACK digests that differed from the local digest and were proven equal by a fresh server reload. */
    ackDigestReloadChecks: number;
  };
  /** The protocol harness drives the production client and server; browser-owned workflows are listed in notCovered. */
  coverage: 'protocol' | 'smoke-only';
  notCovered: typeof PROTOCOL_GATE_NOT_COVERED;
  fixtures: { pdfBytes: number; imageBytes: number } | null;
  mature?: { reloadOpenMs: number; restartOpenMs: number };
  finalDigests?: string[];
  destructive?: {
    attemptedInvalidOperations: number;
    rejectedInvalidOperations: number;
    validOperations: number;
    clientErrors: number;
    nonMapEntryRejectionReason: string;
    malformedFrameCloseCode: number;
    oversizedFrameCloseCode: number;
    resourceLimitBytes: number;
    oversizedFrameBytes: number;
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

export type ExitStatus = { code: number | null; signal: NodeJS.Signals | null; escalated: boolean };
type RunningBackend = { process: ChildProcess; stop: () => Promise<ExitStatus> };
type BackendHooks = {
  onSpawn?: (child: ChildProcess) => void;
  /** Receives every error-level backend log line and any unexpected exit. */
  onBlocker: (description: string) => void;
};

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
): Promise<ExitStatus> => {
  const status = (escalated: boolean): ExitStatus => ({ code: child.exitCode, signal: child.signalCode, escalated });
  if (hasExited(child)) return status(false);
  try {
    child.kill('SIGTERM');
  } catch {
    // The child can exit between the state check and kill().
  }
  if (await waitForExit(child, graceMs)) return status(false);
  try {
    child.kill('SIGKILL');
  } catch {
    // The child can exit between the timeout and kill().
  }
  if (!(await waitForExit(child, killWaitMs))) {
    throw new Error(`Backend process ${child.pid ?? 'unknown'} did not exit after SIGKILL.`);
  }
  return status(true);
};

/** A controlled stop must drain on SIGTERM and exit 0; anything else hides shutdown errors. */
export const assertCleanExit = (status: ExitStatus, label: string): void => {
  if (status.escalated || status.signal !== null || status.code !== 0) {
    throw new Error(
      `Backend ${label} was not clean: code=${status.code ?? 'none'} signal=${status.signal ?? 'none'} sigkill=${status.escalated}.`
    );
  }
};

const scrubLog = (text: string): string => text.replace(/(?:token|secret|password|passphrase|wsToken)[^\s]*/gi, '[redacted]');

const BLOCKING_PHASES = new Set(['unhandledRejection', 'uncaughtException', 'failed']);

/**
 * Classify one backend log line. Structured OperationalSignals events count
 * when their name reports an error, failure, or loss, when they carry an error
 * level or an internal-failure reason, or when a process phase reports a
 * crash or an unclean stop. Plain
 * logger lines count at [ERROR] level, as do bare uncaught-error lines.
 */
export const backendLogBlocker = (line: string): string | null => {
  const text = line.trim();
  if (!text) return null;
  const describe = (): string => scrubLog(text).slice(0, 300);
  if (text.startsWith('{')) {
    let event: Record<string, unknown> | null = null;
    try {
      event = JSON.parse(text) as Record<string, unknown>;
    } catch {
      event = null;
    }
    if (event && typeof event === 'object') {
      const name = String(event.name ?? '');
      const level = String(event.level ?? '').toLowerCase();
      const dimensions = (event.dimensions ?? {}) as Record<string, unknown>;
      if (/error|failure|loss/i.test(name) || level === 'error' || level === 'fatal') return describe();
      // An internal failure closes a live session with 1011 (session.close,
      // session.admission) whatever the event name.
      if (dimensions.reason === 'internal') return describe();
      if (name === 'process.phase') {
        const phase = String(dimensions.phase ?? '');
        if (BLOCKING_PHASES.has(phase) || (phase === 'stopped' && dimensions.clean !== true)) return describe();
      }
      return null;
    }
  }
  if (/\[ERROR\]/.test(text) || /^(?:Uncaught|Unhandled|[A-Za-z]*Error\b:?)/.test(text)) return describe();
  return null;
};

/** Split a byte stream into complete lines; a partial line is kept until the next chunk or flush(). */
const lineSplitter = (onLine: (line: string) => void): { push: (chunk: Buffer) => void; flush: () => void } => {
  let rest = '';
  return {
    push: (chunk) => {
      const lines = `${rest}${chunk.toString()}`.split(/\r?\n/);
      rest = lines.pop() ?? '';
      lines.forEach(onLine);
    },
    flush: () => {
      if (rest) onLine(rest);
      rest = '';
    }
  };
};

const startBackend = async (port: number, pgPort: number, hooks: BackendHooks): Promise<RunningBackend> => {
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
  hooks.onSpawn?.(child);
  let stopRequested = false;
  const output: string[] = [];
  let resolveChildReady!: () => void;
  const childReady = new Promise<void>((resolvePromise) => {
    resolveChildReady = resolvePromise;
  });
  const onLine = (line: string): void => {
    output.push(scrubLog(line).slice(-400));
    if (output.length > 20) output.shift();
    const blocker = backendLogBlocker(line);
    if (blocker) hooks.onBlocker(blocker);
    try {
      const event = JSON.parse(line) as { name?: string; dimensions?: { phase?: string } };
      if (event.name === 'process.phase' && event.dimensions?.phase === 'ready') resolveChildReady();
    } catch {
      // Logger and diagnostics are not all JSON; only structured ready events count.
    }
  };
  const streams = [lineSplitter(onLine), lineSplitter(onLine)];
  child.stdout?.on('data', streams[0]!.push);
  child.stderr?.on('data', streams[1]!.push);
  // 'close' fires after exit once stdio is drained, so every shutdown line is classified.
  const streamsClosed = new Promise<void>((resolvePromise) => {
    child.once('close', () => {
      streams.forEach((stream) => stream.flush());
      resolvePromise();
    });
  });
  child.once('exit', (code, signal) => {
    if (!stopRequested) hooks.onBlocker(`Backend exited unexpectedly (code=${code ?? 'none'} signal=${signal ?? 'none'}).`);
  });
  let stopPromise: Promise<ExitStatus> | null = null;
  const stop = (): Promise<ExitStatus> => {
    stopRequested = true;
    stopPromise ??= (async () => {
      const status = await stopChildProcess(child);
      await Promise.race([streamsClosed, sleep(5_000)]);
      return status;
    })();
    return stopPromise;
  };
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
    throw new Error(`Backend did not become ready within 20 seconds. ${output.join('\n').slice(-400)}`);
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
      await stop();
    } catch (cleanupError) {
      throw new Error(`Backend startup failed and cleanup failed: ${(cleanupError as Error).message}`);
    }
    throw error;
  } finally {
    if (startupTimer) clearTimeout(startupTimer);
  }
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

const mutationOperationId = (bytes: Uint8Array): string | null => {
  if (bytes[0] !== collaborationMessage.mutation || bytes.length < 3) return null;
  const idLength = new DataView(bytes.buffer, bytes.byteOffset + 1, 2).getUint16(0);
  return new TextDecoder().decode(bytes.subarray(3, 3 + idLength));
};

const bytesOf = (data: unknown): Uint8Array => {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array();
};

/**
 * Every unexpected client-side failure of the run, across every client ever
 * created: socket errors, unexpected closes, and server denials of
 * operations the harness intended to be valid. Replacing a client never
 * discards its failures.
 */
const clientErrorLog: string[] = [];

/** Commands whose ACK digest differed from the local digest and were proven by a fresh server reload. */
let ackDigestReloadChecks = 0;

const assertNoClientErrors = (phase: string): void => {
  if (clientErrorLog.length) {
    throw new Error(`${phase}: ${clientErrorLog.length} unexpected client error(s): ${clientErrorLog.slice(0, 5).join('; ')}`);
  }
};

type OperationResponse = { acknowledged: true; digest: string } | { acknowledged: false; reason: string };

/**
 * Server responses to one client's mutations. A command is credited only
 * with the operations it actually sent, so an earlier ACK can never vouch for
 * a command that sent nothing, and a denial of any intended-valid operation
 * is a client error even when it is not the latest one.
 */
export class MutationLedger {
  private readonly acknowledged = new Map<string, string>();
  private readonly denied = new Map<string, string>();
  private readonly expectedDenials = new Set<string>();
  private recording: string[] | null = null;

  constructor(private readonly onUnexpectedDenial: (operationId: string, reason: string) => void) {}

  sent(operationId: string): void {
    this.recording?.push(operationId);
  }

  acknowledge(operationId: string, digest: string): void {
    this.acknowledged.set(operationId, digest);
  }

  deny(operationId: string, reason: string): void {
    this.denied.set(operationId, reason);
    if (!this.expectedDenials.delete(operationId)) this.onUnexpectedDenial(operationId, reason);
  }

  expectDenial(operationId: string): void {
    this.expectedDenials.add(operationId);
  }

  /**
   * Run one command. `run` returns false when the command was refused locally
   * (the result is then null). An accepted command must send at least one new
   * mutation and every one must be acknowledged; the last ACK digest is returned.
   */
  async settle(run: () => boolean, timeoutMs = 10_000): Promise<string | null> {
    const sent: string[] = [];
    this.recording = sent;
    let accepted: boolean;
    try {
      accepted = run();
    } finally {
      this.recording = null;
    }
    if (!accepted) return null;
    if (sent.length === 0) throw new Error('Command sent no mutation; an earlier acknowledgement cannot vouch for it.');
    let digest = '';
    for (const operationId of sent) {
      const response = await this.response(operationId, timeoutMs);
      if (!response.acknowledged) throw new Error(`Server denied operation ${operationId}: ${response.reason}.`);
      digest = response.digest;
    }
    return digest;
  }

  async response(operationId: string, timeoutMs = 10_000): Promise<OperationResponse> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const digest = this.acknowledged.get(operationId);
      if (digest !== undefined) {
        this.acknowledged.delete(operationId);
        return { acknowledged: true, digest };
      }
      const reason = this.denied.get(operationId);
      if (reason !== undefined) {
        this.denied.delete(operationId);
        return { acknowledged: false, reason };
      }
      if (Date.now() >= deadline) throw new Error(`No server response to operation ${operationId} within ${timeoutMs} ms.`);
      await sleep(10);
    }
  }
}

type ProductionConnection = {
  ydoc: Y.Doc;
  yDrawings: Y.Array<unknown>;
  readonly socket: WebSocket | null;
  isEditable: () => boolean;
  pendingOperationCount: () => number;
  disconnect: () => void;
};

type ProductionClientModule = {
  connectToYjs: (
    roomId: string,
    options: { wsToken: string; onMutationDenied?: (denial: { reason: string; operationId: string }) => void }
  ) => ProductionConnection;
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

export const applyAtomicReorder = (
  ydoc: Y.Doc,
  yDrawings: Y.Array<any>,
  ids: readonly string[]
): void => {
  const entries = yDrawings.toArray();
  const byId = new Map(entries.map((entry: any) => [entry?.get?.('id') ?? entry?.id, entry]));
  const permutation = ids.length === entries.length && byId.size === entries.length &&
    new Set(ids).size === ids.length && ids.every((id) => byId.has(id));
  if (!permutation) {
    throw new Error(`Reorder must name every board object exactly once (${ids.length} ids for ${entries.length} objects).`);
  }
  const ordered = ids.map((id) => {
    const entry = byId.get(id);
    const clone = new entry.constructor();
    for (const [key, value] of Object.entries(entry.toJSON ? entry.toJSON() : {})) clone.set(key, value);
    return clone;
  });
  ydoc.transact(() => {
    yDrawings.delete(0, yDrawings.length);
    yDrawings.insert(0, ordered);
  }, { vve109: 'reorder' });
};

/** One connect()..close() span of a client; every socket it opens belongs to it. */
type ConnectionGeneration = { expectedOutage: boolean };
type SocketOwner = { client: ProductionGateClient; generation: ConnectionGeneration };

const liveProductionClients = new Set<ProductionGateClient>();
const socketOwners = new WeakMap<object, SocketOwner>();

/**
 * connectToYjs creates a fresh socket on every automatic reconnect. The first
 * event of a socket always arrives while it is its connection's current
 * socket, so ownership resolves then and stays bound to that generation.
 */
const socketOwner = (socket: object): SocketOwner | null => {
  const known = socketOwners.get(socket);
  if (known) return known;
  for (const client of liveProductionClients) {
    const generation = client.generationOwning(socket);
    if (generation) {
      const owner = { client, generation };
      socketOwners.set(socket, owner);
      return owner;
    }
  }
  return null;
};

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
      // Listeners are registered in the constructor, before connectToYjs
      // assigns its own handlers, so every socket of every reconnect is
      // observed from its first event.
      class HarnessWebSocket extends WebSocket {
        constructor(address: string | URL | null, protocols?: string | string[]) {
          super(address as string | URL, protocols);
          this.on('message', (data: unknown) => {
            const owner = socketOwner(this);
            owner?.client.receiveFrame(bytesOf(data));
          });
          this.on('error', (error: Error) => {
            const owner = socketOwner(this);
            owner?.client.socketEnded(this, owner.generation, `error: ${error.message}`);
          });
          this.on('close', (code: number) => {
            const owner = socketOwner(this);
            owner?.client.socketEnded(this, owner.generation, `close ${code}`);
          });
        }

        override send(data: any, ...rest: any[]): void {
          const operationId = mutationOperationId(bytesOf(data));
          if (operationId !== null) socketOwner(this)?.client.mutationSent(operationId);
          (super.send as (...args: unknown[]) => void)(data, ...rest);
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
  private generation: ConnectionGeneration = { expectedOutage: true };
  private readonly expectedCloses = new WeakSet<object>();
  private readonly ledger = new MutationLedger((operationId, reason) =>
    this.recordError(`server denied intended-valid operation ${operationId}: ${reason}`)
  );
  private failure: string | null = null;
  private rawOperations = 0;
  private base: string | null = null;

  constructor(
    public readonly boardId: string,
    private readonly wsToken: string,
    private readonly role: 'teacher' | 'student',
    private readonly actorId: string
  ) {}

  async connect(base: string): Promise<void> {
    const openedAt = performance.now();
    this.base = base;
    const module = await loadProductionClient();
    const browserWindow = (globalThis as unknown as { window: { location: { protocol: string; host: string; origin: string; port: string } } }).window;
    const url = new URL(base);
    browserWindow.location.protocol = url.protocol;
    browserWindow.location.host = url.host;
    browserWindow.location.origin = url.origin;
    browserWindow.location.port = url.port;
    this.generation = { expectedOutage: false };
    this.failure = null;
    liveProductionClients.add(this);
    this.connection = module.connectToYjs(this.boardId, {
      wsToken: this.wsToken,
      onMutationDenied: (denial) => this.ledger.deny(denial.operationId, denial.reason)
    });
    const deadline = Date.now() + 10_000;
    while (!this.connection.isEditable()) {
      if (this.failure) throw new Error(`Production connectToYjs failed for ${this.actorId}: ${this.failure}`);
      if (Date.now() >= deadline) throw new Error(`Production connectToYjs did not synchronize for ${this.actorId}.`);
      await sleep(25);
    }
    const createSession = module.createWhiteboardSession;
    if (!createSession) throw new Error('Production whiteboard session module is unavailable.');
    this.session = createSession({ ydoc: this.connection.ydoc, role: this.role, isEditable: this.connection.isEditable });
    this.refreshCanonical();
    this.synchronizationMs = performance.now() - openedAt;
  }

  generationOwning(socket: object): ConnectionGeneration | null {
    return this.connection && this.connection.socket === socket ? this.generation : null;
  }

  receiveFrame(bytes: Uint8Array): void {
    const type = bytes[0];
    if (type !== collaborationMessage.acknowledgement && type !== collaborationMessage.denial) return;
    let body: { operationId?: string; digest?: string; reason?: string };
    try {
      body = JSON.parse(new TextDecoder().decode(bytes.subarray(1))) as typeof body;
    } catch {
      this.recordError(`unparseable ${type === collaborationMessage.denial ? 'denial' : 'acknowledgement'} frame`);
      return;
    }
    if (type === collaborationMessage.acknowledgement) {
      if (body.operationId) this.ledger.acknowledge(body.operationId, body.digest ?? '');
    } else if (!body.operationId) {
      // Operation denials arrive through onMutationDenied; a denial without an
      // operation id makes the production client read-only.
      this.recordError(`connection-level denial: ${body.reason ?? 'unknown'}`);
    }
  }

  mutationSent(operationId: string): void {
    this.ledger.sent(operationId);
  }

  socketEnded(socket: object, generation: ConnectionGeneration, detail: string): void {
    if (generation.expectedOutage || this.expectedCloses.has(socket)) return;
    this.recordError(`unexpected production socket ${detail}`);
  }

  private recordError(message: string): void {
    const entry = `${this.actorId}: ${message}`;
    clientErrorLog.push(entry);
    this.failure ??= entry;
  }

  private refreshCanonical(): BoardDocument {
    if (!this.connection) throw new Error('Production client is not connected.');
    this.canonical?.destroy();
    this.canonical = createBoardDocument({ initialState: Y.encodeStateAsUpdate(this.connection.ydoc) });
    return this.canonical;
  }

  private openSocket(): WebSocket {
    const socket = this.connection?.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error(`Production client ${this.actorId} is not connected.`);
    return socket;
  }

  private requireSession(): NonNullable<ProductionGateClient['session']> {
    if (!this.session) throw new Error(`Production whiteboard session is not ready for ${this.actorId}.`);
    return this.session;
  }

  /**
   * Settle one production command and prove the server holds this client's
   * state. The ACK digest hashes the server's live Yjs encoding, which
   * depends on edit history: after a bulk delete (reorder, undo of an add) it
   * can differ from a re-hydration of the same logical state. A mismatch is
   * therefore resolved by a fresh load of server state, which must equal the
   * local digest exactly. Returns false when the command was refused locally.
   */
  private async settle(run: () => boolean): Promise<boolean> {
    const ackDigest = await this.ledger.settle(run);
    if (ackDigest === null) return false;
    const localDigest = this.refreshCanonical().digest();
    if (ackDigest === localDigest) return true;
    if (!this.base) throw new Error(`Production client ${this.actorId} has no server to reload from.`);
    ackDigestReloadChecks += 1;
    const verifier = new ProductionGateClient(this.boardId, this.wsToken, this.role, `${this.actorId}-ack-reload-${ackDigestReloadChecks}`);
    try {
      await verifier.connect(this.base);
      const serverDigest = verifier.digest();
      if (serverDigest !== localDigest) {
        throw new Error(
          `Server state ${serverDigest} (ACK ${ackDigest || '(none)'}) differs from local digest ${localDigest} for ${this.actorId}.`
        );
      }
    } finally {
      await verifier.close();
    }
    return true;
  }

  /**
   * Send a Yjs update straight through the production socket, bypassing every
   * local validator, and require the server to deny it.
   */
  private async requireServerDenial(mutate: (next: Y.Doc) => void): Promise<string> {
    if (!this.connection) throw new Error(`Production client ${this.actorId} is not connected.`);
    const base = Y.encodeStateAsUpdate(this.connection.ydoc);
    const current = new Y.Doc();
    const next = new Y.Doc();
    Y.applyUpdate(current, base);
    Y.applyUpdate(next, base);
    mutate(next);
    const update = Y.encodeStateAsUpdate(next, Y.encodeStateVector(current));
    current.destroy();
    next.destroy();
    const operationId = `vve109-${this.actorId}-invalid-${this.rawOperations++}`;
    this.ledger.expectDenial(operationId);
    this.openSocket().send(encodeMutation(operationId, update));
    const response = await this.ledger.response(operationId);
    if (response.acknowledged) throw new Error(`Production server accepted an invalid update from ${this.actorId}.`);
    return response.reason;
  }

  /** ScenarioClient: a deliberately invalid object goes to the server, never through the local session. */
  async submitInvalidObject(object: Record<string, unknown>): Promise<ScenarioResult> {
    const reason = await this.requireServerDenial((next) => {
      const map = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(object)) map.set(key, value);
      next.getArray('drawings').push([map]);
    });
    return { ok: false, reason };
  }

  /** Send a Y.Array entry that is JSON rather than the canonical Y.Map. */
  rejectNonMapEntry(): Promise<string> {
    return this.requireServerDenial((next) => {
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
    });
  }

  async sendRawFrame(frame: Uint8Array): Promise<number> {
    const socket = this.openSocket();
    this.expectedCloses.add(socket);
    const closed = new Promise<number>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => rejectPromise(new Error(`Production raw frame was not closed for ${this.actorId}.`)), 10_000);
      socket.once('close', (code: number) => { clearTimeout(timer); resolvePromise(code); });
    });
    socket.send(frame);
    return closed;
  }

  async apply(command: BoardCommand): Promise<ScenarioResult> {
    const session = this.requireSession();
    let message = '';
    const applied = await this.settle(() => {
      const result = session.execute(command);
      if (!result.ok) message = result.message;
      return result.ok;
    });
    return applied ? { ok: true, digest: this.refreshCanonical().digest() } : { ok: false, message };
  }

  async addObject(object: SceneObject): Promise<string> {
    const result = await this.apply({ kind: 'add', object });
    if (!result.ok) throw new Error(`Production command rejected for ${this.actorId}: ${result.message ?? 'unknown'}`);
    if (!this.requireSession().snapshot().some((entry) => entry.id === object.id)) {
      throw new Error(`Acknowledged object ${object.id} is absent from the production scene.`);
    }
    return result.digest!;
  }

  undo(): Promise<boolean> {
    const session = this.requireSession();
    return this.settle(() => session.undo());
  }

  redo(): Promise<boolean> {
    const session = this.requireSession();
    return this.settle(() => session.redo());
  }

  async reorder(ids: readonly string[]): Promise<void> {
    const connection = this.connection;
    if (!connection?.isEditable()) throw new Error(`Production client ${this.actorId} is not editable.`);
    await this.settle(() => {
      applyAtomicReorder(connection.ydoc, connection.yDrawings, ids);
      return true;
    });
  }

  isEditable(): boolean {
    return this.connection?.isEditable() ?? false;
  }

  /** The server is about to go away (controlled restart); socket loss in this connection is expected. */
  expectOutage(): void {
    this.generation.expectedOutage = true;
  }

  digest(): string {
    return this.refreshCanonical().digest();
  }

  snapshot(): Record<string, unknown> {
    if (!this.connection) throw new Error('Production client is not connected.');
    return { drawings: this.session?.snapshot() ?? [] };
  }

  /**
   * Resolves once the socket has closed, so harness teardown never overlaps
   * the next operation; a participant leaving mid-edit is exercised only
   * where the scenario does it on purpose.
   */
  close(): Promise<void> {
    this.generation.expectedOutage = true;
    liveProductionClients.delete(this);
    const socket = this.connection?.socket ?? null;
    const closed = !socket || socket.readyState === WebSocket.CLOSED
      ? Promise.resolve()
      : new Promise<void>((resolvePromise) => {
          const timer = setTimeout(resolvePromise, 5_000);
          socket.once('close', () => {
            clearTimeout(timer);
            resolvePromise();
          });
        });
    this.session?.dispose();
    this.session = null;
    this.connection?.disconnect();
    this.connection?.ydoc.destroy();
    this.connection = null;
    this.canonical?.destroy();
    this.canonical = null;
    return closed;
  }
}

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

const closeClients = async (clients: readonly ProductionGateClient[]): Promise<void> => {
  await Promise.all(clients.map((client) => client.close()));
};

export type RuntimeHealth = {
  blockers: number;
  rssBytes: number;
  heapUsedBytes: number;
  eventLoopP95Ms: number;
  connections: number;
  boards: number;
};

/** Parse the protected runtime snapshot strictly; a missing counter must not read as zero. */
export const runtimeHealth = (value: unknown): RuntimeHealth => {
  const soak = (value ?? {}) as Record<string, unknown>;
  const errors = soak.errors as Record<string, unknown> | undefined;
  const memory = soak.memory as Record<string, unknown> | undefined;
  const loop = soak.eventLoopDelayMs as Record<string, unknown> | null | undefined;
  const numbers = [soak.eventsLost, errors?.persistence, errors?.unhandled, memory?.rssBytes, memory?.heapUsedBytes, soak.connections, soak.boards];
  if (numbers.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
    throw new Error('Runtime snapshot is missing error, memory, or connection counters.');
  }
  return {
    blockers: Number(soak.eventsLost) + Number(errors!.persistence) + Number(errors!.unhandled),
    rssBytes: Number(memory!.rssBytes),
    heapUsedBytes: Number(memory!.heapUsedBytes),
    eventLoopP95Ms: Number(loop?.p95 ?? 0),
    connections: Number(soak.connections),
    boards: Number(soak.boards)
  };
};

const assertNoBackendBlockers = (blockers: readonly string[], phase: string): void => {
  if (blockers.length) {
    throw new Error(`${phase}: backend reported ${blockers.length} error-level event(s): ${blockers.slice(0, 5).join(' | ')}`);
  }
};

type RuntimeProbe = {
  sample: (label: string) => Promise<RuntimeHealth>;
  readonly totals: { samples: number; maxRssBytes: number; maxHeapUsedBytes: number; maxEventLoopDelayMs: number };
};

/**
 * Administrator-authenticated runtime sampling. Every sample fails the gate
 * on any server blocker counter or error-level backend log line seen so far.
 */
const createRuntimeProbe = (base: string, adminCookie: string, backendBlockers: readonly string[]): RuntimeProbe => {
  const totals = { samples: 0, maxRssBytes: 0, maxHeapUsedBytes: 0, maxEventLoopDelayMs: 0 };
  const sample = async (label: string): Promise<RuntimeHealth> => {
    const ready = await fetchJson<unknown>(base, '/ready');
    if (ready.status !== 200) throw new Error(`Backend readiness at ${label} failed with HTTP ${ready.status}.`);
    const runtime = await fetchJson<{ soak?: unknown }>(base, '/api/admin/runtime', { headers: { cookie: adminCookie } });
    if (runtime.status !== 200 || !runtime.body.soak) throw new Error(`Runtime metrics at ${label} failed with HTTP ${runtime.status}.`);
    const health = runtimeHealth(runtime.body.soak);
    totals.samples += 1;
    totals.maxRssBytes = Math.max(totals.maxRssBytes, health.rssBytes);
    totals.maxHeapUsedBytes = Math.max(totals.maxHeapUsedBytes, health.heapUsedBytes);
    totals.maxEventLoopDelayMs = Math.max(totals.maxEventLoopDelayMs, health.eventLoopP95Ms);
    if (health.blockers) throw new Error(`Runtime recorded ${health.blockers} blocker event(s) at ${label}.`);
    assertNoBackendBlockers(backendBlockers, label);
    return health;
  };
  return { sample, totals };
};

type Restart = (afterStop?: () => Promise<void>) => Promise<void>;

const runChangeGate = async (base: string, board: BoardAccess, options: ReleaseGateOptions, restart: Restart): Promise<{ clients: number; acknowledged: number; reconnects: number; finalDigests: string[] }> => {
  const clients = await connectClients(base, [board], [3]);
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
    // addObject requires a fresh ACK whose digest equals the local digest.
    await client.addObject(seededChangeObject(0, index));
    assertNoClientErrors(`Change gate operation ${index}`);
    acknowledged += 1;
    if (index === Math.floor(count / 4) || index === Math.floor((count * 3) / 4)) {
      const clientIndex = index % clients.length;
      const before = clients[clientIndex]!.digest();
      await clients[clientIndex]!.close();
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
  if (clients.some((client) => client.digest() !== beforeRestart)) throw new Error('Live client digests diverged before backend restart.');
  assertNoClientErrors('Change gate before restart');
  // Every close handshake completes before SIGTERM, so the restart starts
  // from a deterministic client-side boundary.
  await closeClients(clients);
  await restart();
  const reloaded = await connectClients(base, [board], [3]);
  const finalDigests = reloaded.map((client) => client.digest());
  assertNoClientErrors('Change gate after restart');
  if (finalDigests.some((digest) => digest !== beforeRestart)) throw new Error('A rehydrated client digest changed after backend restart.');
  const drawings = reloaded[0]!.snapshot().drawings as unknown[];
  if (drawings.length !== acknowledged) throw new Error(`Reloaded ${drawings.length} objects; expected ${acknowledged}.`);
  await closeClients(reloaded);
  return { clients: clients.length, acknowledged, reconnects: reconnects + 1, finalDigests };
};

const runMatureGate = async (base: string, board: BoardAccess, restart: Restart): Promise<{ clients: number; acknowledged: number; fixtures: { pdfBytes: number; imageBytes: number }; openMs: { reload: number; restart: number } }> => {
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
  assertNoClientErrors('Mature gate');
  return {
    clients: scenario.clients,
    acknowledged: scenario.acceptedOperations,
    fixtures: { pdfBytes: scenario.fixtures.pdfBytes, imageBytes: scenario.fixtures.imageBytes },
    openMs: scenario.openMs
  };
};

const runDestructiveGate = async (
  base: string,
  board: BoardAccess,
  options: ReleaseGateOptions,
  restart: Restart
): Promise<NonNullable<GateReport['destructive']>> => {
  const createClient = async (label: string): Promise<ProductionGateClient> => {
    const client = new ProductionGateClient(board.boardId, board.studentWsToken, 'student', label);
    await client.connect(base);
    return client;
  };
  // Every invalid object reaches the server through submitInvalidObject; the
  // local session never sees it, so each counted rejection is a server denial.
  const scenario = await runDestructiveScenario({
    base,
    restart,
    createClient: (_role, label) => createClient(label)
  }, {
    invalidOperations: options.smoke ? 12 : 24,
    validOperations: options.smoke ? 4 : 8
  });

  const nonMapClient = await createClient('destructive-non-map-entry');
  const nonMapEntryRejectionReason = await nonMapClient.rejectNonMapEntry();
  await nonMapClient.close();

  const malformedClient = await createClient('destructive-malformed-frame');
  const malformedFrameCloseCode = await malformedClient.sendRawFrame(
    new Uint8Array([collaborationMessage.mutation, 0, 0, 1])
  );
  if (malformedFrameCloseCode !== 1008) {
    throw new Error(`Production malformed frame was closed with ${malformedFrameCloseCode}; expected 1008.`);
  }
  await malformedClient.close();

  const oversizedClient = await createClient('destructive-oversized-frame');
  const maxPayload = Number(process.env.VVE_MAX_WS_PAYLOAD_BYTES ?? MEASURED_RESOURCE_LIMITS.maxWebsocketPayloadBytes);
  if (!Number.isSafeInteger(maxPayload) || maxPayload <= 0) throw new Error('VVE_MAX_WS_PAYLOAD_BYTES must be a positive safe integer.');
  const oversizedFrame = new Uint8Array(maxPayload + 1024);
  oversizedFrame[0] = collaborationMessage.mutation;
  new DataView(oversizedFrame.buffer).setUint16(1, 6);
  oversizedFrame.set(new TextEncoder().encode('vve109'), 3);
  const oversizedFrameCloseCode = await oversizedClient.sendRawFrame(oversizedFrame);
  if (oversizedFrameCloseCode !== 1009 && oversizedFrameCloseCode !== 1013) {
    throw new Error(`Production oversized frame was closed with ${oversizedFrameCloseCode}; expected 1009 or 1013.`);
  }
  await oversizedClient.close();
  assertNoClientErrors('Destructive gate');
  return {
    attemptedInvalidOperations: scenario.attemptedInvalidOperations,
    rejectedInvalidOperations: scenario.rejectedInvalidOperations,
    validOperations: scenario.validOperations,
    clientErrors: clientErrorLog.length,
    nonMapEntryRejectionReason,
    malformedFrameCloseCode,
    oversizedFrameCloseCode,
    resourceLimitBytes: maxPayload,
    oversizedFrameBytes: oversizedFrame.byteLength,
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

const runSoak = async (base: string, boards: BoardAccess[], options: ReleaseGateOptions, restart: Restart, probe: RuntimeProbe): Promise<{ details: SoakDetails; clients: number; acknowledged: number; reconnects: number; digestMismatches: number; crossBoardLeaks: number }> => {
  const studentCounts = boards.map((_, index) => index === 0 ? 3 : index < 12 ? 2 : 1);
  const clients = await connectClients(base, boards, studentCounts);
  const openingSamples = clients.map((client) => client.synchronizationMs);
  const propagationSamples: number[] = [];
  let injectedReconnects = 0;
  let adapterReloads = 0;
  let restartRecoveryMs = 0;
  let freshRestartClients = 0;
  let acknowledged = 0;
  let reconnects = 0;
  let digestMismatches = 0;
  let crossBoardLeaks = 0;
  const started = Date.now();
  let lastProgressAt = started;
  let restarted = false;
  const sampleRuntime = async (label: string, expectedConnections = clients.length): Promise<void> => {
    const health = await probe.sample(label);
    if (health.connections !== expectedConnections || health.boards !== boards.length) {
      throw new Error(`Runtime connection/board count mismatch at ${label}: expected ${expectedConnections}/${boards.length}, got ${health.connections}/${health.boards}.`);
    }
  };
  while (Date.now() - started < options.durationMs) {
    await sampleRuntime('soak');
    assertNoClientErrors('Soak');
    const index = acknowledged % clients.length;
    const operationBoardIndex = boards.findIndex((board) => board.boardId === clients[index]!.boardId);
    if (operationBoardIndex < 0) throw new Error(`Soak client ${clients[index]!.boardId} is not one of the gate boards.`);
    const mutationStarted = performance.now();
    await clients[index]!.addObject(seededChangeObject(operationBoardIndex, acknowledged + 10_000));
    acknowledged += 1;
    assertNoClientErrors('Soak');
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
      await clients[selected]!.close();
      const disconnectedDeadline = Date.now() + 5_000;
      for (;;) {
        const health = await probe.sample('soak-disconnect');
        if (health.connections === clients.length - 1) break;
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
      clients.forEach((client) => client.expectOutage());
      await restart(async () => {
        if (clients.some((client) => client.isEditable())) throw new Error('A production client remained editable during backend drain.');
        // Dispose every local Y.Doc before the server starts. A surviving client
        // could resend its document and conceal missing durable state.
        await closeClients(clients);
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
      if (digestMismatches || crossBoardLeaks) throw new Error('Soak restart checkpoint found divergent or cross-board state.');
      reconnects += clients.length;
      restarted = true;
    }
    if (Date.now() - lastProgressAt >= 60_000) {
      console.log(`VVE-109 soak progress elapsedMs=${Date.now() - started} samples=${probe.totals.samples} clients=${clients.length} acknowledged=${acknowledged} reconnects=${reconnects}`);
      lastProgressAt = Date.now();
    }
    await sleep(options.smoke ? 500 : 1_000);
  }
  const activeDurationMs = Date.now() - started;
  // Final sample while every client is still connected: the last interval's
  // server errors and connection count count as much as the first.
  await sampleRuntime('soak-final');
  assertNoClientErrors('Soak final');
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
  const clientCount = clients.length;
  await closeClients(clients);
  const p95 = (values: number[]): number => values.sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * 0.95) - 1)] ?? 0;
  const details: SoakDetails = {
    activeDurationMs, studentCounts, injectedReconnects, adapterReloads,
    maxHeapUsedBytes: probe.totals.maxHeapUsedBytes, writeToPeerP95Ms: p95(propagationSamples), openingP95Ms: p95(openingSamples),
    restartRecoveryMs, freshRestartClients, roomDigests: Object.fromEntries(digestByBoard)
  };
  return { details, clients: clientCount, acknowledged, reconnects, digestMismatches, crossBoardLeaks };
};

const reportJson = (report: GateReport): string => `${JSON.stringify(report, null, 2)}\n`;

export const assertGateReport = (report: GateReport): void => {
  if (!report.passed) throw new Error('Release gate report is not passing.');
  if (report.metrics.blockerEvents || report.metrics.clientErrors || report.metrics.digestMismatches || report.metrics.crossBoardLeaks) {
    throw new Error('Release gate reported blocker, client, digest, or cross-board failures.');
  }
  // One runtime sample before and after every restart plus a final one.
  if (report.metrics.samples < 1 + 2 * report.backendRestarts || report.metrics.maxRssBytes <= 0) {
    throw new Error('Release gate report lacks authenticated runtime samples around every restart and at the end.');
  }
  if (report.notCovered?.artifactImportExport !== PROTOCOL_GATE_NOT_COVERED.artifactImportExport) {
    throw new Error('Release gate report must declare artifact import/export as browser-owned.');
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
  clientErrorLog.length = 0;
  ackDigestReloadChecks = 0;
  const backendBlockers: string[] = [];
  let stopPostgres: (() => Promise<void>) | null = null;
  let backend: RunningBackend | null = null;
  let backendRestarts = 0;
  let acknowledgedOperations = 0;
  let clientCount = 0;
  let boardCount = 0;
  let reconnects = 0;
  let fixtures: { pdfBytes: number; imageBytes: number } | null = null;
  let digestMismatches = 0;
  let crossBoardLeaks = 0;
  let soakDetails: SoakDetails | undefined;
  let mature: GateReport['mature'];
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
    const launched = await startBackend(options.backendPort, options.pgPort, {
      onSpawn: (child) => {
        backendStarting = child;
      },
      onBlocker: (description) => backendBlockers.push(description)
    });
    backendStarting = null;
    return launched;
  };
  const stopOwnedBackend = async (label: string): Promise<void> => {
    const running = backend;
    backend = null;
    if (!running) throw new Error(`No backend is running at ${label}.`);
    assertCleanExit(await running.stop(), label);
    assertNoBackendBlockers(backendBlockers, label);
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
    const admin = await fetchJson<{ ok: boolean }>(base, '/api/admin/session', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passphrase: TEST_PASS })
    });
    if (admin.status !== 200) throw new Error(`Administrator test login failed with HTTP ${admin.status}.`);
    const adminCookie = cookieOf(admin.headers);
    const probe = createRuntimeProbe(base, adminCookie, backendBlockers);
    await probe.sample('start');
    const restart: Restart = async (afterStop) => {
      // Shutdown errors are invisible to HTTP sampling; the clean exit and the
      // backend log scan in stopOwnedBackend cover the drain itself.
      await probe.sample('before-restart');
      await stopOwnedBackend('restart');
      await afterStop?.();
      backend = await startOwnedBackend();
      backendRestarts += 1;
      await probe.sample('after-restart');
    };
    const boardCountTarget = options.profile === 'soak' || options.profile === 'stress' ? 22 : 1;
    const boards: BoardAccess[] = [];
    for (let index = 0; index < boardCountTarget; index += 1) {
      boards.push(await createBoardAccess(base, adminCookie, index, async (loginIndex) => {
        if (loginIndex > 0 && loginIndex % 10 === 0) await restart();
      }));
    }
    boardCount = boards.length;

    if (options.profile === 'change') {
      const result = await runChangeGate(base, boards[0]!, options, restart);
      clientCount = result.clients; acknowledgedOperations = result.acknowledged; reconnects = result.reconnects;
      finalDigests = result.finalDigests;
    } else if (options.profile === 'mature') {
      const result = await runMatureGate(base, boards[0]!, restart);
      clientCount = result.clients; acknowledgedOperations = result.acknowledged; fixtures = result.fixtures;
      mature = { reloadOpenMs: result.openMs.reload, restartOpenMs: result.openMs.restart };
    } else if (options.profile === 'destructive') {
      destructive = await runDestructiveGate(base, boards[0]!, options, restart);
      clientCount = 1;
      acknowledgedOperations = destructive.validOperations;
    } else if (options.profile === 'soak') {
      const result = await runSoak(base, boards, options, restart, probe);
      soakDetails = result.details;
      clientCount = result.clients; acknowledgedOperations = result.acknowledged; reconnects = result.reconnects;
      digestMismatches = result.digestMismatches; crossBoardLeaks = result.crossBoardLeaks;
    } else {
      const studentCounts = boards.map(() => 3);
      const clients = await connectClients(base, boards, studentCounts);
      clientCount = clients.length;
      await closeClients(clients);
    }
    await probe.sample('final');
    await stopOwnedBackend('final shutdown');
    assertNoClientErrors('Final');
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
      metrics: {
        samples: probe.totals.samples,
        maxRssBytes: probe.totals.maxRssBytes,
        maxEventLoopDelayMs: probe.totals.maxEventLoopDelayMs,
        blockerEvents: backendBlockers.length,
        clientErrors: clientErrorLog.length,
        digestMismatches,
        crossBoardLeaks,
        ackDigestReloadChecks
      },
      coverage: 'protocol',
      notCovered: PROTOCOL_GATE_NOT_COVERED,
      fixtures,
      ...(mature ? { mature } : {}),
      ...(soakDetails ? { soakDetails } : {}),
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
  // main() has already cleaned up the backend and PostgreSQL. Exit explicitly:
  // a client left open by a failed run keeps reconnect timers alive and would
  // otherwise hang an unattended gate forever.
  main()
    .then((report) => { assertGateReport(report); console.log(JSON.stringify(report, null, 2)); process.exit(0); })
    .catch((error) => { console.error(`VVE-109 release gate failed: ${(error as Error).stack ?? (error as Error).message}`); process.exit(1); });
}
