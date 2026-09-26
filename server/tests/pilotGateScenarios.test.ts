import { describe, expect, it } from 'vitest';
import { validateBoardObject, type BoardCommand, type SceneObject } from '../src/pilot/boardScene';
import {
  invalidSceneObjects,
  MATURE_OPEN_TARGET_MS,
  runDestructiveScenario,
  runMatureBoardScenario,
  ScenarioCommandDenied,
  type ScenarioClient,
  type ScenarioContext,
  type ScenarioResult
} from '../scripts/pilotGateScenarios';

/** Durable server state; accepted writes are broadcast to every connected client. */
class ServerDouble {
  readonly state = new Map<string, SceneObject>();
  readonly order: string[] = [];
  readonly connected = new Set<ScenarioClientDouble>();
  /** Simulates a server that denies an invalid object but persists it anyway. */
  leakInvalid = false;

  commit(mutate: (state: Map<string, SceneObject>) => void): void {
    mutate(this.state);
    this.connected.forEach((client) => mutate(client.local));
  }
}

/**
 * Each client holds its own local view, loaded from the server when it opens
 * and updated only by broadcasts; a server-side change that is never
 * broadcast stays invisible until a fresh client reloads.
 */
class ScenarioClientDouble implements ScenarioClient {
  readonly boardId = 'scenario-board';
  synchronizationMs = 0;
  readonly invalidSubmissions: Record<string, unknown>[] = [];
  readonly appliedIds: string[] = [];
  readonly local: Map<string, SceneObject>;

  constructor(private readonly server: ServerDouble, readonly label: string) {
    this.local = new Map([...server.state].map(([id, object]) => [id, structuredClone(object)]));
    server.connected.add(this);
  }

  async apply(command: BoardCommand): Promise<ScenarioResult> {
    this.server.commit((target) => {
      if (command.kind === 'add') target.set(command.object.id, structuredClone(command.object));
      else if (command.kind === 'delete') command.ids.forEach((id) => target.delete(id));
      else if (command.kind === 'updateText') {
        const object = target.get(command.id);
        if (object) object.text = command.text;
      }
    });
    if (command.kind === 'add') {
      this.appliedIds.push(command.object.id);
      if (!this.server.order.includes(command.object.id)) this.server.order.push(command.object.id);
    }
    if (command.kind === 'delete') {
      this.server.order.splice(0, this.server.order.length, ...this.server.order.filter((id) => !command.ids.includes(id)));
    }
    return { ok: true };
  }

  async submitInvalidObject(object: Record<string, unknown>): Promise<ScenarioResult> {
    this.invalidSubmissions.push(object);
    if (validateBoardObject(object).ok) return { ok: true };
    if (this.server.leakInvalid) this.server.state.set(String(object.id), object as SceneObject);
    return { ok: false, reason: 'invalidObject' };
  }

  digest(): string {
    return JSON.stringify([...this.local.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }

  snapshot(): unknown {
    return { drawings: this.server.order.map((id) => this.local.get(id)).filter(Boolean) };
  }

  async close(): Promise<void> {
    this.server.connected.delete(this);
  }

  async undo(): Promise<boolean> { return true; }
  async redo(): Promise<boolean> { return true; }
  async reorder(ids: readonly string[]): Promise<void> {
    this.server.order.splice(0, this.server.order.length, ...ids);
  }
}

const contextFor = (
  configure: (client: ScenarioClientDouble) => void = () => undefined
): ScenarioContext & { server: ServerDouble; created: ScenarioClientDouble[] } => {
  const server = new ServerDouble();
  const created: ScenarioClientDouble[] = [];
  return {
    server,
    created,
    base: 'http://scenario.invalid',
    createClient: async (_role, label) => {
      const client = new ScenarioClientDouble(server, label);
      configure(client);
      created.push(client);
      return client;
    },
    restart: async () => {}
  };
};

describe('VVE-109 mature and destructive scenario contracts', () => {
  it('exercises canonical fixtures, history, peer convergence, and durable reload', async () => {
    const report = await runMatureBoardScenario(contextFor(), { seed: 1091, canonicalObjectCount: 100, historyOperations: 48 });
    expect(report.profile).toBe('mature');
    expect(report.canonicalObjects).toBeGreaterThanOrEqual(100);
    expect(report.canonicalObjectBytes).toBeGreaterThan(0);
    expect(report.snapshotBytes).toBeGreaterThan(0);
    expect(report.acceptedOperations).toBeGreaterThan(report.canonicalObjects);
    expect(report.historyCoverage.edits).toBeGreaterThan(0);
    expect(report.historyCoverage.deletes).toBeGreaterThan(0);
    expect(report.historyCoverage.reorders).toBeGreaterThan(0);
    expect(report.historyCoverage.undos).toBeGreaterThan(0);
    expect(report.historyCoverage.redos).toBeGreaterThan(0);
    expect(report.peerConverged).toBe(true);
    expect(report.reloadDigest).toBeTruthy();
    expect(report.openMs).toEqual({ reload: 0, restart: 0 });
    expect(report.fixtures.pdfHeader).toBe('%PDF-');
    expect(report.fixtures.encodedImageBytes).toBeGreaterThan(report.fixtures.imageBytes);
    expect(report.fixtures.artifactImportExport).toBe('browser-owned');
  });

  it.each(['mature-student-reload', 'mature-student-restart'])('fails when the %s client opens the mature board too slowly', async (slowLabel) => {
    const context = contextFor((client) => {
      if (client.label === slowLabel) client.synchronizationMs = MATURE_OPEN_TARGET_MS + 1;
    });
    await expect(runMatureBoardScenario(context, { canonicalObjectCount: 100, historyOperations: 48 }))
      .rejects.toThrow(/open took .* target is 5000 ms/);
  });

  it('rejects seeded invalid operations on the server and proves a later valid write survives reload', async () => {
    const context = contextFor();
    const report = await runDestructiveScenario(context, { seed: 404, invalidOperations: 24 });
    expect(report.rejectedInvalidOperations).toBe(report.attemptedInvalidOperations);
    expect(report.digestAfterInvalid).toBe(report.digestBeforeInvalid);
    expect(report.validOperations).toBeGreaterThan(1);
    expect(report.reloadDigest).not.toBe(report.digestBeforeInvalid);
    expect(report.restartDigest).toBe(report.reloadDigest);
    expect(report.preservedState).toBe(true);
    expect(report.restartVerified).toBe(true);
    const submitter = context.created[0]!;
    // Every counted rejection went through the server path, never the local command path.
    expect(submitter.invalidSubmissions).toHaveLength(24);
    expect(submitter.appliedIds.some((id) => id.startsWith('invalid-'))).toBe(false);
  });

  it('detects an invalid object that the server denied but persisted', async () => {
    const context = contextFor();
    context.server.leakInvalid = true;
    await expect(runDestructiveScenario(context, { seed: 404, invalidOperations: 12 }))
      .rejects.toThrow(/invalid operations changed acknowledged board state/);
  });

  it('compares the first reload with the acknowledged valid state', async () => {
    const context = contextFor((client) => {
      if (client.label === 'destructive-reload') client.digest = () => 'lost-write';
    });
    await expect(runDestructiveScenario(context, { seed: 404, invalidOperations: 12 }))
      .rejects.toThrow(/lost the valid write after reload/);
  });

  it('propagates unexpected adapter failures instead of counting them as denials', async () => {
    const context = contextFor((client) => {
      client.submitInvalidObject = async () => { throw new Error('persistence connection lost'); };
    });
    await expect(runDestructiveScenario(context, { seed: 404, invalidOperations: 24 }))
      .rejects.toThrow('persistence connection lost');
  });

  it('accepts only the explicit typed denial when an adapter throws', async () => {
    const context = contextFor((client) => {
      client.submitInvalidObject = async () => { throw new ScenarioCommandDenied('invalid object'); };
    });
    const report = await runDestructiveScenario(context, { seed: 404, invalidOperations: 24 });
    expect(report.rejectedInvalidOperations).toBe(24);
    expect(report.restartVerified).toBe(true);
  });

  it('refuses an adapter that cannot submit invalid objects to the server', async () => {
    const context = contextFor((client) => {
      (client as { submitInvalidObject?: unknown }).submitInvalidObject = undefined;
    });
    await expect(runDestructiveScenario(context, { seed: 404, invalidOperations: 12 }))
      .rejects.toThrow(/cannot submit an invalid object/);
  });

  it('varies seeded invalid cases while every block covers every canonical limit', () => {
    const fingerprint = (objects: Record<string, unknown>[]): string =>
      JSON.stringify(objects.map((object) => [object.type, object.x, object.y, object.width, object.height, String(object.text ?? '').length]));
    const first = invalidSceneObjects(404, 12);
    const second = invalidSceneObjects(405, 12);
    expect(fingerprint(first)).not.toBe(fingerprint(second));
    expect(fingerprint(invalidSceneObjects(404, 12))).toBe(fingerprint(first));
    for (const object of [...first, ...second]) expect(validateBoardObject(object).ok).toBe(false);
    const caseOf = (object: Record<string, unknown>): string => {
      if (String(object.type).startsWith('not-a-lesson-object')) return 'type';
      if (typeof object.text === 'string') return 'text';
      const outsideCoordinates = (value: unknown): boolean => !Number.isFinite(value as number) || Math.abs(value as number) > 1_000_000;
      if (outsideCoordinates(object.x)) return 'x';
      if (outsideCoordinates(object.y)) return 'y';
      if ((object.width as number) !== 120) return 'width';
      return 'height';
    };
    for (const objects of [first, second]) {
      expect(new Set(objects.slice(0, 6).map(caseOf)).size).toBe(6);
      expect(new Set(objects.slice(6, 12).map(caseOf)).size).toBe(6);
    }
  });
});
