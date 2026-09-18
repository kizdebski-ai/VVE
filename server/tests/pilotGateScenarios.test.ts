import { describe, expect, it } from 'vitest';
import type { BoardCommand, SceneObject } from '../src/pilot/boardScene';
import {
  runDestructiveScenario,
  runMatureBoardScenario,
  type ScenarioClient,
  type ScenarioContext,
  type ScenarioResult
} from '../scripts/pilotGateScenarios';

class ScenarioClientDouble implements ScenarioClient {
  readonly boardId = 'scenario-board';
  private readonly state: Map<string, SceneObject>;
  private readonly order: string[];

  constructor(state: Map<string, SceneObject>, order: string[]) {
    this.state = state;
    this.order = order;
  }

  async apply(command: BoardCommand): Promise<ScenarioResult> {
    if (command.kind === 'add') {
      if (command.object.type === 'not-a-lesson-object' ||
          typeof command.object.x === 'number' && !Number.isFinite(command.object.x) ||
          typeof command.object.width === 'number' && (!Number.isFinite(command.object.width) || command.object.width < 0) ||
          command.object.type === 'text' && typeof command.object.text === 'string' && command.object.text.length > 20_000) {
        return { ok: false, reason: 'invalidObject' };
      }
      this.state.set(command.object.id, structuredClone(command.object));
      if (!this.order.includes(command.object.id)) this.order.push(command.object.id);
      return { ok: true };
    }
    if (command.kind === 'delete') {
      for (const id of command.ids) {
        this.state.delete(id);
        const index = this.order.indexOf(id);
        if (index >= 0) this.order.splice(index, 1);
      }
      return { ok: true };
    }
    if (command.kind === 'updateText') {
      const object = this.state.get(command.id);
      if (object) object.text = command.text;
      return { ok: true };
    }
    return { ok: true };
  }

  digest(): string {
    return JSON.stringify([...this.state.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }

  snapshot(): unknown {
    return { drawings: this.order.map((id) => this.state.get(id)).filter(Boolean) };
  }

  async close(): Promise<void> {}

  async undo(): Promise<boolean> { return true; }
  async redo(): Promise<boolean> { return true; }
  async reorder(ids: readonly string[]): Promise<void> {
    this.order.splice(0, this.order.length, ...ids);
  }
}

const contextFor = (): ScenarioContext => {
  const state = new Map<string, SceneObject>();
  const order: string[] = [];
  return {
    base: 'http://scenario.invalid',
    createClient: async () => new ScenarioClientDouble(state, order)
  };
};

describe('VVE-109 mature and destructive scenario contracts', () => {
  it('exercises canonical fixtures, history, peer convergence, and durable reload', async () => {
    const report = await runMatureBoardScenario(contextFor(), { seed: 1091, historyOperations: 16 });
    expect(report.profile).toBe('mature');
    expect(report.canonicalObjects).toBeGreaterThanOrEqual(9);
    expect(report.acceptedOperations).toBeGreaterThan(report.canonicalObjects);
    expect(report.historyCoverage.edits).toBeGreaterThan(0);
    expect(report.historyCoverage.deletes).toBeGreaterThan(0);
    expect(report.historyCoverage.reorders).toBeGreaterThan(0);
    expect(report.historyCoverage.undos).toBeGreaterThan(0);
    expect(report.historyCoverage.redos).toBeGreaterThan(0);
    expect(report.peerConverged).toBe(true);
    expect(report.reloadDigest).toBeTruthy();
    expect(report.fixtures.pdfHeader).toBe('%PDF-');
    expect(report.fixtures.artifactImportExport).toBe('browser-owned');
  });

  it('rejects seeded invalid operations and proves a later valid write survives reload', async () => {
    const report = await runDestructiveScenario(contextFor(), { seed: 404, invalidOperations: 24 });
    expect(report.rejectedInvalidOperations).toBe(report.attemptedInvalidOperations);
    expect(report.digestAfterInvalid).toBe(report.digestBeforeInvalid);
    expect(report.validOperations).toBe(1);
    expect(report.reloadDigest).not.toBe(report.digestBeforeInvalid);
    expect(report.preservedState).toBe(true);
  });
});
