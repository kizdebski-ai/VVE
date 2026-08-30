import { describe, expect, it } from 'vitest';

import {
  createOperationalSignals,
  OPERATIONAL_EVENT_NAMES,
  OPERATIONAL_MEASUREMENT_NAMES,
  redactDimensions
} from '../src/pilot/operationalSignals';

describe('OperationalSignals', () => {
  it('redacts tokens, passphrases, URLs, Student Labels, and binary content', () => {
    const redacted = redactDimensions({
      token: 'super-secret-token',
      passphrase: 'shared-admin',
      studentLabel: 'Anna Kowalska',
      student_label: 'Anna K.',
      url: 'https://app.example/teacher/login?token=abc',
      href: 'https://evil.example',
      boardId: '11111111-1111-4111-8111-111111111111',
      granted: true,
      update: Buffer.from('board-bytes-must-not-appear'),
      reason: 'revoked'
    });

    expect(redacted.token).toBe('[redacted]');
    expect(redacted.passphrase).toBe('[redacted]');
    expect(redacted.studentLabel).toBe('[redacted]');
    expect(redacted.student_label).toBe('[redacted]');
    expect(redacted.url).toBe('[redacted]');
    expect(redacted.href).toBe('[redacted]');
    expect(redacted.boardId).toBe('11111111-1111-4111-8111-111111111111');
    expect(redacted.granted).toBe(true);
    expect(redacted.reason).toBe('revoked');
    expect(redacted.update).toBeUndefined();
    expect(redacted.updateBytes).toBe(Buffer.byteLength('board-bytes-must-not-appear'));
    expect(JSON.stringify(redacted)).not.toMatch(/super-secret|Anna|https:\/\//);
  });

  it('assigns a monotonic sequence, bounds event names, and never throws into the caller', () => {
    const lines: string[] = [];
    const signals = createOperationalSignals({
      emitJson: true,
      sink: (line) => lines.push(line),
      maxEvents: 8
    });

    signals.record({ name: 'process.phase', dimensions: { phase: 'starting' } });
    signals.record({ name: 'access.decision', dimensions: { granted: false, reason: 'revoked' } });
    signals.record({ name: 'not-a-real-event' as 'process.phase', dimensions: { token: 'leak' } });
    expect(() =>
      signals.record({
        name: 'sync.acknowledgement',
        dimensions: { passphrase: 'nope', duplicate: false }
      })
    ).not.toThrow();

    const recorded = signals.recorded();
    expect(recorded.map((event) => event.name)).toEqual([
      'process.phase',
      'access.decision',
      'sync.acknowledgement'
    ]);
    expect(recorded[0]?.sequence).toBe(1);
    expect(recorded[2]?.sequence).toBe(3);
    expect(recorded[2]?.dimensions.passphrase).toBe('[redacted]');
    expect(signals.snapshot().eventsLost).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(lines)).not.toMatch(/leak|nope/);
  });

  it('aggregates soak measurements including event-loop, memory, connections, and digests', () => {
    const signals = createOperationalSignals({ emitJson: false });
    signals.measure({ name: 'eventLoop.delayMs', value: 1.5 });
    signals.measure({ name: 'eventLoop.delayMs', value: 4 });
    signals.measure({ name: 'memory.rssBytes', value: 20_000_000 });
    signals.measure({ name: 'connections.active', value: 4 });
    signals.measure({ name: 'boards.active', value: 2 });
    signals.measure({
      name: 'board.digest',
      value: 'abc123',
      dimensions: { boardId: '11111111-1111-4111-8111-111111111111' }
    });
    signals.record({ name: 'persistence.error', dimensions: { stage: 'append' } });

    const snapshot = signals.snapshot();
    expect(snapshot.eventLoopDelayMs?.max).toBe(4);
    expect(snapshot.connections).toBe(4);
    expect(snapshot.boards).toBe(2);
    expect(snapshot.errors.persistence).toBe(1);
    expect(snapshot.lastDigests['11111111-1111-4111-8111-111111111111']).toBe('abc123');
    expect(JSON.stringify(snapshot)).not.toMatch(/https?:\/\//);
    expect(OPERATIONAL_EVENT_NAMES).toHaveLength(14);
    expect(OPERATIONAL_MEASUREMENT_NAMES).toContain('eventLoop.delayMs');
  });
});
