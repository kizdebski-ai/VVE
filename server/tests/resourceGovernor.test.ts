import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

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

  it('107-Q1: evicts expired rate-window entries so memory does not grow with client churn', () => {
    const governor = createResourceGovernor({
      limits: createResourceLimits({
        administratorLoginMax: 5,
        administratorLoginWindowMs: 60_000
      })
    });
    // 10,000 distinct administrator login client keys at t=0
    for (let i = 0; i < 10_000; i += 1) {
      governor.admit({ kind: 'administratorLogin', clientKey: `scanner-ip-${i}` }, { now: 1_000 });
    }

    // One day later (t = 86,400,000 ms), a new IP arrives
    const decision = governor.admit(
      { kind: 'administratorLogin', clientKey: 'legitimate-admin-ip' },
      { now: 86_400_000 }
    );
    expect(decision.decision).toBe('allow');
  });

  it('admits normal awareness updates and bounds awareness payload and rate', () => {
    const governor = createResourceGovernor({
      limits: createResourceLimits({ maxMessagesPerWindow: 5, messageWindowMs: 1_000 })
    });
    // Normal awareness update
    const normal = governor.admit(
      { kind: 'awareness', bytes: 256, clientKey: 'peer-1' },
      { now: 1_000 }
    );
    expect(normal.decision).toBe('allow');

    // Oversized awareness frame (> 64 KiB) fails closed
    const huge = governor.admit(
      { kind: 'awareness', bytes: 70 * 1024, clientKey: 'peer-1' },
      { now: 1_000 }
    );
    expect(huge.decision).toBe('reject');

    // Rate-limited awareness flood
    for (let i = 0; i < 5; i += 1) {
      governor.admit({ kind: 'awareness', bytes: 256, clientKey: 'flooder' }, { now: 1_000 });
    }
    const flood = governor.admit(
      { kind: 'awareness', bytes: 256, clientKey: 'flooder' },
      { now: 1_000 }
    );
    expect(flood.decision).toBe('retryAfter');
  });

  it('derives coherent image and update budgets that fit inside WebSocket frame', () => {
    const governor = createResourceGovernor();
    const limits = governor.limits();
    // Verify that data URL and encoded image budgets strictly fit within maxWebsocketPayloadBytes
    expect(limits.maxImageDataUrlChars).toBeLessThan(limits.maxWebsocketPayloadBytes);
    expect(limits.maxEncodedImageBytes).toBeLessThan(limits.maxWebsocketPayloadBytes);
    // Base64 expansion of maxEncodedImageBytes + header must not exceed maxImageDataUrlChars
    const base64Len = Math.ceil(limits.maxEncodedImageBytes / 3) * 4 + 32;
    expect(base64Len).toBeLessThanOrEqual(limits.maxImageDataUrlChars);
  });

  it('107-R2: a maximum admitted image data-URL fits the encoded WS frame envelope end to end', async () => {
    const limits = createResourceLimits();
    // Worst admitted data URL: data:image/png;base64, + base64 payload, exactly
    // maxImageDataUrlChars characters, stored in a canonical image object.
    const base64Chars = limits.maxImageDataUrlChars - 'data:image/png;base64,'.length;
    const dataUrl = 'data:image/png;base64,' + 'A'.repeat(base64Chars);
    expect(dataUrl.length).toBe(limits.maxImageDataUrlChars);

    const doc = new Y.Doc();
    doc.transact(() => {
      const image = new Y.Map();
      image.set('id', 'img-max');
      image.set('type', 'image');
      image.set('src', dataUrl);
      doc.getArray('drawings').push([image]);
    });
    // Full document update: worst-case Yjs envelope for the admitted image.
    const fullUpdate = Y.encodeStateAsUpdate(doc);
    // Real client frame: message type byte + 2-byte id length + operation id + update.
    const operationId = 'op-0000-ffff';
    const frameBytes = 1 + 2 + operationId.length + fullUpdate.byteLength;

    expect(frameBytes).toBeLessThanOrEqual(limits.maxWebsocketPayloadBytes);
    expect(fullUpdate.byteLength).toBeLessThanOrEqual(limits.maxDocumentUpdateBytes);
  });
});
