import { describe, expect, it } from 'vitest';

import {
  createResourceGovernor,
  polishResourceMessage
} from '../src/pilot/resourceGovernor';
import { createResourceLimits, MEASURED_RESOURCE_LIMITS } from '../src/pilot/resourceLimits';

describe('ResourceGovernor Interface', () => {
  it('admits 57-client normal traffic with measured defaults', () => {
    const governor = createResourceGovernor();
    const decisions = Array.from({ length: 57 }, (_, index) =>
      governor.admit(
        {
          kind: 'connection',
          clientKey: 'ci-host',
          boardId: `board-${Math.floor(index / 3)}`
        },
        { now: 1_000 }
      )
    );
    expect(decisions.every((decision) => decision.decision === 'allowWithBudget')).toBe(true);

    const stroke = governor.admit(
      { kind: 'documentUpdate', bytes: 8_192, clientKey: 'ci-host' },
      { now: 1_000 }
    );
    expect(stroke.decision).toBe('allowWithBudget');

    const image = governor.admit(
      {
        kind: 'decodedImage',
        bytes: 2 * 1024 * 1024,
        decodedPixels: 2_200_000,
        clientKey: 'teacher-1'
      },
      { now: 1_000 }
    );
    expect(image.decision).toBe('allowWithBudget');
  });

  it('rejects oversized PDF, image, and document updates with Polish keys', () => {
    const governor = createResourceGovernor({
      limits: createResourceLimits({
        maxPdfBytes: 100,
        maxPdfPages: 2,
        maxEncodedImageBytes: 50,
        maxDecodedPixelsPerImage: 10,
        maxDocumentUpdateBytes: 20
      })
    });

    expect(governor.admit({ kind: 'pdf', bytes: 101, pageCount: 1 })).toMatchObject({
      decision: 'reject',
      messageKey: 'resource.pdfTooLarge'
    });
    expect(governor.admit({ kind: 'pdf', bytes: 10, pageCount: 3 })).toMatchObject({
      decision: 'reject',
      messageKey: 'resource.pdfTooManyPages'
    });
    expect(
      governor.admit({ kind: 'decodedImage', bytes: 51, decodedPixels: 4 })
    ).toMatchObject({ decision: 'reject', messageKey: 'resource.imageTooLarge' });
    expect(governor.admit({ kind: 'documentUpdate', bytes: 21 })).toMatchObject({
      decision: 'reject',
      messageKey: 'resource.updateTooLarge'
    });
    expect(polishResourceMessage('resource.pdfTooLarge')).toMatch(/PDF/);
  });

  it('bounds concurrent artifact jobs and releases them on observe', () => {
    const governor = createResourceGovernor({
      limits: createResourceLimits({ maxConcurrentArtifactJobs: 1, maxConcurrentArtifactJobsPerClient: 1 })
    });
    expect(governor.admit({ kind: 'pdf', bytes: 10, pageCount: 1, clientKey: 'a' }).decision).toBe(
      'allowWithBudget'
    );
    expect(governor.admit({ kind: 'pdf', bytes: 10, pageCount: 1, clientKey: 'b' })).toMatchObject({
      decision: 'retryAfter',
      messageKey: 'resource.artifactBusy'
    });
    governor.observe({ kind: 'artifactFinished', clientKey: 'a' });
    expect(governor.admit({ kind: 'artifactWork', clientKey: 'b' }).decision).toBe('allowWithBudget');
  });

  it('rejects a slow consumer without changing an already accepted result', () => {
    const governor = createResourceGovernor({
      limits: createResourceLimits({ maxSlowClientBufferedBytes: 100 })
    });
    const allowed = governor.admit({ kind: 'slowClientBuffer', bytes: 20 });
    expect(allowed.decision).toBe('allow');
    expect(governor.admit({ kind: 'slowClientBuffer', bytes: 101 })).toMatchObject({
      decision: 'reject',
      messageKey: 'resource.slowClient'
    });
    expect(allowed.decision).toBe('allow');
  });

  it('fails closed on unknown usage and invalid configuration', () => {
    const governor = createResourceGovernor();
    expect(
      governor.admit({ kind: 'not-a-real-kind' as 'message' })
    ).toMatchObject({ decision: 'reject', messageKey: 'resource.unknownUsage' });

    const broken = createResourceGovernor({
      limits: createResourceLimits({ maxProcessConnections: 0 })
    });
    expect(broken.admit({ kind: 'connection', clientKey: 'x' })).toMatchObject({
      decision: 'reject',
      messageKey: 'resource.invalidConfiguration'
    });
  });

  it('never puts board content into a decision', () => {
    const governor = createResourceGovernor();
    const decision = governor.admit({
      kind: 'documentUpdate',
      bytes: 12,
      clientKey: 'student-secret-material'
    });
    expect(JSON.stringify(decision)).not.toMatch(/secret-material|data:image|stroke/);
    expect(governor.limits().maxProcessConnections).toBe(MEASURED_RESOURCE_LIMITS.maxProcessConnections);
  });

  it('observes 88 clients without requiring distributed quota storage', () => {
    const governor = createResourceGovernor();
    const decisions = Array.from({ length: 88 }, (_, index) =>
      governor.admit(
        {
          kind: 'connection',
          clientKey: 'ci-host',
          boardId: `board-${index}`
        },
        { now: 2_000 }
      )
    );
    expect(decisions.filter((decision) => decision.decision === 'allowWithBudget')).toHaveLength(88);
    expect(governor.limits().maxProcessConnections).toBeGreaterThanOrEqual(88);
  });

  it('frees connection occupancy so a later client can enter', () => {
    const governor = createResourceGovernor({
      limits: createResourceLimits({ maxProcessConnections: 1, maxConnectionsPerIp: 1, maxBoardConnections: 1 })
    });
    expect(
      governor.admit({ kind: 'connection', clientKey: 'ip', boardId: 'board' }).decision
    ).toBe('allowWithBudget');
    expect(
      governor.admit({ kind: 'connection', clientKey: 'ip', boardId: 'board' }).decision
    ).toBe('reject');
    governor.observe({ kind: 'connectionClosed', clientKey: 'ip', boardId: 'board' });
    expect(
      governor.admit({ kind: 'connection', clientKey: 'ip', boardId: 'board' }).decision
    ).toBe('allowWithBudget');
  });
});
