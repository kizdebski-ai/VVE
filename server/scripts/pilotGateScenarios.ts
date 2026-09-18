/**
 * VVE-109 mature-board and destructive scenario runners.
 *
 * The production gate owns transport, PostgreSQL, and process lifecycle. This
 * module owns only the workload contract so the same scenarios can run through
 * a production WebSocket client or a browser-backed adapter. The client is
 * deliberately structural: canonical BoardCommand application, digest, and
 * snapshot stay behind the adapter's real BoardDocument/BoardHistory seams.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BoardCommand, SceneObject } from '../src/pilot/boardScene';

export type ScenarioRole = 'teacher' | 'student';

export type ScenarioResult =
  | { ok: true; digest?: string }
  | { ok: false; reason?: string; message?: string };

/**
 * An adapter may reject a deliberately malformed command by throwing this
 * typed denial. Other thrown errors are harness failures and must escape the
 * destructive scenario instead of being counted as successful rejections.
 */
export class ScenarioCommandDenied extends Error {
  readonly code = 'SCENARIO_COMMAND_DENIED';

  constructor(message = 'The scenario command was denied.') {
    super(message);
    this.name = 'ScenarioCommandDenied';
  }
}

export interface ScenarioClient {
  readonly boardId: string;
  apply(command: BoardCommand): Promise<ScenarioResult | void>;
  digest(): Promise<string> | string;
  snapshot(): Promise<unknown> | unknown;
  close(): Promise<void> | void;
  /** BoardHistory owns these invariants; the runner must not emulate them. */
  undo?(): Promise<boolean | void> | boolean | void;
  redo?(): Promise<boolean | void> | boolean | void;
  reorder?(ids: readonly string[]): Promise<void> | void;
}

export interface ScenarioContext {
  readonly base: string;
  readonly createClient: (role: ScenarioRole, label: string) => Promise<ScenarioClient>;
  /** A release gate must prove durability across a controlled backend restart. */
  readonly restart: () => Promise<void>;
  readonly fixtures?: { pdfPath?: string; imagePath?: string };
}

export interface ScenarioFixtureEvidence {
  pdfBytes: number;
  imageBytes: number;
  encodedImageBytes: number;
  pdfHeader: string;
  imageMime: 'image/png' | 'image/jpeg' | 'image/webp';
  artifactImportExport: 'browser-owned';
}

export interface MatureScenarioReport {
  profile: 'mature';
  seed: number;
  clients: number;
  canonicalObjects: number;
  canonicalObjectBytes: number;
  snapshotBytes: number;
  historyOperations: number;
  acceptedOperations: number;
  reloadDigest: string;
  peerDigests: string[];
  peerConverged: boolean;
  restartVerified: boolean;
  historyCoverage: { edits: number; deletes: number; reorders: number; undos: number; redos: number };
  fixtures: ScenarioFixtureEvidence;
}

export interface DestructiveScenarioReport {
  profile: 'destructive';
  seed: number;
  attemptedInvalidOperations: number;
  rejectedInvalidOperations: number;
  validOperations: number;
  digestBeforeInvalid: string;
  digestAfterInvalid: string;
  reloadDigest: string;
  preservedState: boolean;
  restartVerified: boolean;
}

const REPO_ROOT = resolve(__dirname, '..', '..');
const DEFAULT_PDF = resolve(REPO_ROOT, 'frontend', 'tests', 'fixtures', 'artifacts', 'lesson-2page.pdf');
const DEFAULT_IMAGE = resolve(REPO_ROOT, 'frontend', 'tests', 'fixtures', 'artifacts', 'pixel.png');

const awaitValue = async <T>(value: Promise<T> | T): Promise<T> => value;

const requireApplied = async (client: ScenarioClient, command: BoardCommand): Promise<void> => {
  const result = await client.apply(command);
  if (result && 'ok' in result && result.ok === false) {
    throw new Error(`Scenario command ${command.kind} was rejected: ${result.reason ?? result.message ?? 'unknown reason'}`);
  }
};

const requireRejected = async (client: ScenarioClient, command: BoardCommand): Promise<void> => {
  try {
    const result = await client.apply(command);
    if (result && 'ok' in result && result.ok === true) {
      throw new Error(`Destructive scenario accepted invalid ${command.kind} operation.`);
    }
    if (!result) {
      throw new Error(`Destructive scenario adapter did not report the invalid ${command.kind} operation.`);
    }
  } catch (error) {
    if (error instanceof Error && /accepted invalid|did not report/.test(error.message)) throw error;
    if (error instanceof ScenarioCommandDenied) return;
    if (
      error &&
      typeof error === 'object' &&
      (error as { code?: unknown }).code === 'SCENARIO_COMMAND_DENIED'
    ) return;
    throw error;
  }
};

const digestOf = async (client: ScenarioClient): Promise<string> => {
  const digest = await awaitValue(client.digest());
  if (typeof digest !== 'string' || digest.length === 0) throw new Error('Scenario client returned no state digest.');
  return digest;
};

const closeAll = async (clients: readonly ScenarioClient[]): Promise<void> => {
  await Promise.all(clients.map((client) => awaitValue(client.close())));
};

const convergeDigests = async (
  clients: readonly ScenarioClient[],
  options: { attempts?: number; delayMs?: number } = {}
): Promise<string[]> => {
  const attempts = options.attempts ?? 40;
  const delayMs = options.delayMs ?? 25;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const digests = await Promise.all(clients.map((client) => digestOf(client)));
    if (digests.every((digest) => digest === digests[0])) return digests;
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Mature scenario peers did not converge within ${attempts} checks.`);
};

const seededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
};

const objectFor = (id: string, index: number, type = 'rectangle'): SceneObject => ({
  id,
  type,
  x: (index * 37) % 10_000,
  y: (index * 53) % 10_000,
  width: 120,
  height: 80,
  color: '#2563eb',
  lineWidth: 2,
  rotation: 0,
  timestamp: index
});

const readFixtureEvidence = (paths: ScenarioContext['fixtures'] = {}): ScenarioFixtureEvidence => {
  const pdf = readFileSync(paths.pdfPath ?? DEFAULT_PDF);
  const image = readFileSync(paths.imagePath ?? DEFAULT_IMAGE);
  const pdfHeader = pdf.subarray(0, 5).toString('ascii');
  if (pdfHeader !== '%PDF-') throw new Error('Mature scenario PDF fixture is not a PDF.');
  let imageMime: ScenarioFixtureEvidence['imageMime'];
  if (image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) imageMime = 'image/png';
  else if (image.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) imageMime = 'image/jpeg';
  else if (image.subarray(0, 4).toString('ascii') === 'RIFF' && image.subarray(8, 12).toString('ascii') === 'WEBP') imageMime = 'image/webp';
  else throw new Error('Mature scenario image fixture is not PNG, JPEG, or WebP.');
  return {
    pdfBytes: pdf.byteLength,
    imageBytes: image.byteLength,
    encodedImageBytes: Buffer.byteLength(`data:${imageMime};base64,${image.toString('base64')}`, 'utf8'),
    pdfHeader,
    imageMime,
    artifactImportExport: 'browser-owned'
  };
};

const canonicalObjects = (imageDataUrl: string): SceneObject[] => [
  objectFor('mature-rectangle', 1),
  { ...objectFor('mature-pen', 2, 'pen'), points: [{ x: 10, y: 10, t: 1, p: 0.2 }, { x: 80, y: 90, t: 2, p: 0.8 }] },
  { ...objectFor('mature-line', 3, 'line'), start: { x: 0, y: 0 }, end: { x: 240, y: 120 }, arrowStyle: 'end', lineStyle: 'dashed' },
  { ...objectFor('mature-text', 4, 'text'), text: 'Mature lesson history', fontSize: 24 },
  { ...objectFor('mature-image', 5, 'image'), src: imageDataUrl },
  { ...objectFor('mature-coordinate-2d', 6, 'coordinateSystem2D'), grid: true, xLabel: 'x', yLabel: 'y' },
  { ...objectFor('mature-coordinate-3d', 7, 'coordinateSystem3D'), grid: true, xLabel: 'x', yLabel: 'y', zLabel: 'z' },
  { ...objectFor('mature-math', 8, 'mathFunctionPlot'), expression: '1/x', xRange: [-10, 10], xLabel: 'x', yLabel: 'f(x)' },
  { ...objectFor('mature-physics', 9, 'physicsDataPlot'), points: [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 4 }], xLabel: 't', yLabel: 'v' }
];

export const MATURE_PRETELEMETRY_PRESET = Object.freeze({
  canonicalObjectCount: 120,
  historyOperations: 96
});

const boundedCanonicalObjects = (imageDataUrl: string, count: number): SceneObject[] => {
  const base = canonicalObjects(imageDataUrl);
    const shapeTypes = ['rectangle', 'circle', 'triangle', 'diamond', 'trapezoid'] as const;
  for (let index = base.length; index < count; index += 1) {
    const type = shapeTypes[index % shapeTypes.length]!;
    base.push(objectFor(`mature-shape-${index}`, index + 1, type));
  }
  return base;
};

export const runMatureBoardScenario = async (
  context: ScenarioContext,
  options: { seed?: number; historyOperations?: number; canonicalObjectCount?: number } = {}
): Promise<MatureScenarioReport> => {
  const seed = options.seed ?? 109_2026;
  const random = seededRandom(seed);
  const fixturePaths = context.fixtures ?? {};
  const evidence = readFixtureEvidence(fixturePaths);
  const imageBytes = readFileSync(fixturePaths.imagePath ?? DEFAULT_IMAGE);
  const imageDataUrl = `data:${evidence.imageMime};base64,${imageBytes.toString('base64')}`;
  const canonicalObjectCount = options.canonicalObjectCount ?? MATURE_PRETELEMETRY_PRESET.canonicalObjectCount;
  const objects = boundedCanonicalObjects(imageDataUrl, canonicalObjectCount);
  const historyOperations = options.historyOperations ?? MATURE_PRETELEMETRY_PRESET.historyOperations;
  if (canonicalObjectCount < 100) throw new Error('Mature scenario requires at least 100 canonical objects.');
  if (historyOperations < 48) throw new Error('Mature scenario requires at least 48 history operations.');

  const clients: ScenarioClient[] = [];
  const tracked = new Set<ScenarioClient>();
  const createTracked = async (role: ScenarioRole, label: string): Promise<ScenarioClient> => {
    const client = await context.createClient(role, label);
    clients.push(client);
    tracked.add(client);
    return client;
  };
  await createTracked('teacher', 'mature-teacher');
  await createTracked('student', 'mature-student-1');
  await createTracked('student', 'mature-student-2');
  await createTracked('student', 'mature-student-3');
  const activeIds = new Set(objects.map((object) => object.id));
  const coverage = { edits: 0, deletes: 0, reorders: 0, undos: 0, redos: 0 };
  let acceptedOperations = 0;
  try {
    for (const object of objects) {
      await requireApplied(clients[0]!, { kind: 'add', object });
      acceptedOperations += 1;
    }
    for (let index = 0; index < historyOperations; index += 1) {
      const client = clients[index % clients.length]!;
      const ids = [...activeIds];
      const id = ids[Math.floor(random() * ids.length)] ?? objects[0]!.id;
      const x = 100 + index * 7;
      const y = 120 + index * 5;
      await requireApplied(client, { kind: 'move', id, x, y });
      if (id === 'mature-line') {
        await requireApplied(client, {
          kind: 'setLineEndpoints',
          id,
          start: { x, y },
          end: { x: x + 160 + (index % 5) * 20, y: y + 90 + (index % 4) * 15 }
        });
      } else {
        await requireApplied(client, { kind: 'resize', id, x, y, width: 100 + (index % 5) * 20, height: 70 + (index % 4) * 15 });
      }
      await requireApplied(client, { kind: 'updateStyle', id, patch: { lineWidth: 2 + (index % 3), color: index % 2 ? '#1d4ed8' : '#2563eb' } });
      coverage.edits += 3;
      acceptedOperations += 3;
      if (index % 3 === 0 && activeIds.has('mature-text')) {
        await requireApplied(client, { kind: 'updateText', id: 'mature-text', text: `Mature lesson history ${index}`, width: 320, height: 48 });
        coverage.edits += 1;
        acceptedOperations += 1;
      }
      if (index % 6 === 0 && activeIds.size > 4) {
        const deleted = ids[ids.length - 1]!;
        await requireApplied(client, { kind: 'delete', ids: [deleted] });
        activeIds.delete(deleted);
        coverage.deletes += 1;
        acceptedOperations += 1;
        const replacement = objectFor(`mature-replacement-${index}`, index + 100, index % 2 ? 'rectangle' : 'circle');
        await requireApplied(client, { kind: 'add', object: replacement });
        activeIds.add(replacement.id);
        acceptedOperations += 1;
      }
      if (index % 4 === 0) {
        const reorder = [...activeIds].reverse();
        if (!client.reorder) throw new Error('Mature scenario client does not expose BoardHistory reorder.');
        await awaitValue(client.reorder(reorder));
        coverage.reorders += 1;
      }
      if (index % 8 === 0) {
        if (!client.undo || !client.redo) throw new Error('Mature scenario client does not expose BoardHistory undo/redo.');
        if ((await awaitValue(client.undo())) === false) throw new Error('Mature scenario undo was not accepted.');
        if ((await awaitValue(client.redo())) === false) throw new Error('Mature scenario redo was not accepted.');
        coverage.undos += 1;
        coverage.redos += 1;
      }
    }
    const peerDigests = await convergeDigests(clients);
    const peerConverged = true;
    const beforeReload = peerDigests[0]!;
    const closeTracked = async (client: ScenarioClient): Promise<void> => {
      if (!tracked.delete(client)) return;
      await awaitValue(client.close());
    };
    await closeTracked(clients[1]!);
    clients[1] = await context.createClient('student', 'mature-student-reload');
    tracked.add(clients[1]!);
    const reloadDigest = await digestOf(clients[1]!);
    if (reloadDigest !== beforeReload) throw new Error('Mature scenario durable reload changed the acknowledged digest.');
    await Promise.all([...tracked].map((client) => closeTracked(client)));
    await context.restart();
    const restartClient = await createTracked('student', 'mature-student-restart');
    const restartDigest = await digestOf(restartClient);
    if (restartDigest !== beforeReload) throw new Error('Mature scenario lost acknowledged state after backend restart.');
    const snapshot = await awaitValue(restartClient.snapshot());
    const snapshotBytes = Buffer.byteLength(JSON.stringify(snapshot) ?? 'null', 'utf8');
    return {
      profile: 'mature',
      seed,
      clients: 4,
      canonicalObjects: objects.length,
      canonicalObjectBytes: Buffer.byteLength(JSON.stringify(objects), 'utf8'),
      snapshotBytes,
      historyOperations,
      acceptedOperations,
      reloadDigest,
      peerDigests,
      peerConverged: true,
      restartVerified: true,
      historyCoverage: coverage,
      fixtures: evidence
    };
  } finally {
    await closeAll([...tracked]);
  }
};

const invalidObjects = (seed: number): SceneObject[] => {
  const random = seededRandom(seed);
  const result: SceneObject[] = [];
  for (let index = 0; index < 12; index += 1) {
    const object = objectFor(`invalid-${seed}-${index}`, index);
    if (index % 4 === 0) result.push({ ...object, type: 'not-a-lesson-object' });
    else if (index % 4 === 1) result.push({ ...object, x: Number.NaN });
    else if (index % 4 === 2) result.push({ ...object, type: 'text', text: 'x'.repeat(20_001) });
    else result.push({ ...object, width: random() > 0.5 ? -1 : Number.POSITIVE_INFINITY });
  }
  return result;
};

export const runDestructiveScenario = async (
  context: ScenarioContext,
  options: { seed?: number; invalidOperations?: number } = {}
): Promise<DestructiveScenarioReport> => {
  const seed = options.seed ?? 109_404;
  const clients = new Set<ScenarioClient>();
  const client = await context.createClient('student', 'destructive-student');
  clients.add(client);
  const attemptedInvalidOperations = options.invalidOperations ?? 24;
  if (attemptedInvalidOperations < 12) throw new Error('Destructive scenario requires at least 12 invalid operations.');
  try {
    const digestBeforeInvalid = await digestOf(client);
    const candidates = invalidObjects(seed);
    let rejectedInvalidOperations = 0;
    for (let index = 0; index < attemptedInvalidOperations; index += 1) {
      const object = candidates[index % candidates.length]!;
      await requireRejected(client, { kind: 'add', object });
      rejectedInvalidOperations += 1;
    }
    const digestAfterInvalid = await digestOf(client);
    if (digestAfterInvalid !== digestBeforeInvalid) throw new Error('Destructive invalid operations changed acknowledged board state.');
    const validId = `destructive-valid-${seed}`;
    await requireApplied(client, { kind: 'add', object: objectFor(validId, 900) });
    const afterValid = await digestOf(client);
    if (afterValid === digestBeforeInvalid) throw new Error('Destructive scenario valid write did not change the board.');
    await awaitValue(client.close());
    clients.delete(client);
    const reloaded = await context.createClient('student', 'destructive-reload');
    clients.add(reloaded);
    let reloadDigest = await digestOf(reloaded);
    await awaitValue(reloaded.close());
    clients.delete(reloaded);
    await context.restart();
    const afterRestart = await context.createClient('student', 'destructive-restart-reload');
    clients.add(afterRestart);
    reloadDigest = await digestOf(afterRestart);
    const restartVerified = true;
    if (reloadDigest !== afterValid) throw new Error('Destructive scenario lost the valid write after reload/restart.');
    return {
      profile: 'destructive',
      seed,
      attemptedInvalidOperations,
      rejectedInvalidOperations,
      validOperations: 1,
      digestBeforeInvalid,
      digestAfterInvalid,
      reloadDigest,
      preservedState: true,
      restartVerified
    };
  } finally {
    await closeAll([...clients]);
  }
};
