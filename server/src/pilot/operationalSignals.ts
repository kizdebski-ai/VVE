/**
 * OperationalSignals — Module 10 of the VVE Pilot deep-module design (slice S8).
 *
 * One Interface for content-free operational evidence:
 *
 *   record(event)  → structured, redacted, sequenced event
 *   measure(sample) → aggregated soak measurement
 *   snapshot()     → content-free runtime picture for soak / readiness
 *
 * Board content, access tokens, passphrases, signed sessions, full Student
 * Labels, and URLs are never recorded. Recording is non-blocking and bounded:
 * a sink failure increments an internal loss signal and never throws into an
 * acknowledged lesson path.
 *
 * Two real Adapters share this Interface: JSON stdout (Railway-compatible)
 * and an in-memory recording Adapter used by tests.
 */

export const OPERATIONAL_EVENT_NAMES = [
  'process.phase',
  'access.decision',
  'access.credential',
  'session.admission',
  'session.close',
  'sync.complete',
  'sync.acknowledgement',
  'persistence.error',
  'persistence.compact',
  'readOnly.transition',
  'artifact.work',
  'resource.denial',
  'lifecycle.job',
  'internal.loss'
] as const;

export type OperationalEventName = (typeof OPERATIONAL_EVENT_NAMES)[number];

export const OPERATIONAL_MEASUREMENT_NAMES = [
  'eventLoop.delayMs',
  'memory.rssBytes',
  'memory.heapUsedBytes',
  'connections.active',
  'boards.active',
  'update.bytes',
  'asset.bytes',
  'persistence.latencyMs',
  'sync.latencyMs',
  'load.latencyMs',
  'board.digest'
] as const;

export type OperationalMeasurementName = (typeof OPERATIONAL_MEASUREMENT_NAMES)[number];

export type OperationalDimensionValue = string | number | boolean | null;

export interface OperationalEventInput {
  name: OperationalEventName;
  correlationId?: string;
  dimensions?: Record<string, unknown>;
}

export interface OperationalEvent {
  name: OperationalEventName;
  sequence: number;
  at: string;
  correlationId: string | null;
  dimensions: Record<string, OperationalDimensionValue>;
}

export interface OperationalMeasurementInput {
  name: OperationalMeasurementName;
  value: number | string;
  dimensions?: Record<string, unknown>;
}

export interface MeasurementAggregate {
  name: OperationalMeasurementName;
  count: number;
  last: number | string;
  min: number | null;
  max: number | null;
  sum: number;
}

export interface OperationalSnapshot {
  at: string;
  sequence: number;
  eventsLost: number;
  eventLoopDelayMs: { min: number; mean: number; p50: number; p95: number; max: number } | null;
  memory: { rssBytes: number; heapUsedBytes: number };
  connections: number;
  boards: number;
  errors: { persistence: number; unhandled: number };
  lastDigests: Record<string, string>;
  counters: Record<string, number>;
  measurements: Record<string, MeasurementAggregate>;
}

export interface OperationalSignals {
  record(event: OperationalEventInput): void;
  measure(sample: OperationalMeasurementInput): void;
  snapshot(): OperationalSnapshot;
}

export interface RecordingOperationalSignals extends OperationalSignals {
  recorded(): OperationalEvent[];
}

const EVENT_NAME_SET = new Set<string>(OPERATIONAL_EVENT_NAMES);
const MEASUREMENT_NAME_SET = new Set<string>(OPERATIONAL_MEASUREMENT_NAMES);

const SENSITIVE_KEY =
  /(token|passphrase|password|secret|cookie|authorization|session|studentlabel|student_label|studentname|accesslink|wsToken|url|href|ydoc|snapshot|payload|content|bytes|update|body|link)/i;

const URL_VALUE = /^(https?:\/\/|wss?:\/\/)/i;

const REDACTED = '[redacted]';
const MAX_STRING = 120;
const MAX_EVENTS = 1000;
const MAX_DIGESTS = 64;

const isEventName = (value: string): value is OperationalEventName => EVENT_NAME_SET.has(value);
const isMeasurementName = (value: string): value is OperationalMeasurementName =>
  MEASUREMENT_NAME_SET.has(value);

const clipString = (value: string): string =>
  value.length <= MAX_STRING ? value : `${value.slice(0, MAX_STRING)}…`;

export const redactDimensions = (
  input: Record<string, unknown> | undefined
): Record<string, OperationalDimensionValue> => {
  const result: Record<string, OperationalDimensionValue> = {};
  if (!input) return result;
  for (const [key, raw] of Object.entries(input)) {
    if (raw instanceof Uint8Array || Buffer.isBuffer(raw)) {
      result[`${key}Bytes`] = raw.length;
      continue;
    }
    if (SENSITIVE_KEY.test(key)) {
      result[key] = REDACTED;
      continue;
    }
    if (raw == null) {
      result[key] = null;
      continue;
    }
    if (typeof raw === 'boolean' || typeof raw === 'number') {
      if (typeof raw === 'boolean' || Number.isFinite(raw)) {
        result[key] = raw;
      }
      continue;
    }
    if (typeof raw === 'string') {
      result[key] = URL_VALUE.test(raw) ? REDACTED : clipString(raw);
    }
    // Nested objects, arrays, and unknown types are dropped rather than stringified.
  }
  return result;
};

const numericValue = (value: number | string): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export interface CreateOperationalSignalsOptions {
  /** Destination for one JSON line per event. Defaults to stdout. Tests inject a recorder. */
  sink?: (line: string) => void;
  now?: () => number;
  maxEvents?: number;
  /** When false, skip the stdout Adapter (tests that only want the recording Adapter). */
  emitJson?: boolean;
}

export const createOperationalSignals = (
  options: CreateOperationalSignalsOptions = {}
): RecordingOperationalSignals => {
  const now = options.now ?? Date.now;
  const maxEvents = options.maxEvents ?? MAX_EVENTS;
  const emitJson = options.emitJson ?? true;
  const sink = options.sink ?? ((line: string) => {
    // Railway-compatible structured log: one JSON object per line, no secrets.
    process.stdout.write(`${line}\n`);
  });

  let sequence = 0;
  let eventsLost = 0;
  const events: OperationalEvent[] = [];
  const measurements = new Map<OperationalMeasurementName, MeasurementAggregate>();
  const lastDigests: Record<string, string> = {};
  const digestOrder: string[] = [];
  let persistenceErrors = 0;
  let unhandledErrors = 0;
  const counters: Record<string, number> = {};

  const bump = (key: string): void => {
    counters[key] = (counters[key] ?? 0) + 1;
  };

  const emit = (payload: Record<string, unknown>): void => {
    if (!emitJson) return;
    try {
      sink(JSON.stringify(payload));
    } catch {
      eventsLost += 1;
      bump('sinkFailure');
    }
  };

  const record: OperationalSignals['record'] = (event) => {
    try {
      if (!isEventName(event.name)) {
        eventsLost += 1;
        bump('unknownEvent');
        return;
      }
      sequence += 1;
      const recorded: OperationalEvent = {
        name: event.name,
        sequence,
        at: new Date(now()).toISOString(),
        correlationId: event.correlationId ? clipString(event.correlationId) : null,
        dimensions: redactDimensions(event.dimensions)
      };
      events.push(recorded);
      if (events.length > maxEvents) events.shift();

      if (event.name === 'persistence.error') persistenceErrors += 1;
      const phase = recorded.dimensions.phase;
      if (
        event.name === 'process.phase' &&
        (phase === 'unhandledRejection' || phase === 'uncaughtException')
      ) {
        unhandledErrors += 1;
      }
      bump(event.name);
      emit({ v: 1, kind: 'event', ...recorded });
    } catch {
      eventsLost += 1;
      bump('recordFailure');
    }
  };

  const measure: OperationalSignals['measure'] = (sample) => {
    try {
      if (!isMeasurementName(sample.name)) {
        eventsLost += 1;
        bump('unknownMeasurement');
        return;
      }
      const dimensions = redactDimensions(sample.dimensions);
      const existing = measurements.get(sample.name);
      const asNumber = numericValue(sample.value as number);
      const aggregate: MeasurementAggregate = existing ?? {
        name: sample.name,
        count: 0,
        last: sample.value,
        min: null,
        max: null,
        sum: 0
      };
      aggregate.count += 1;
      aggregate.last = sample.value;
      if (asNumber != null) {
        aggregate.min = aggregate.min == null ? asNumber : Math.min(aggregate.min, asNumber);
        aggregate.max = aggregate.max == null ? asNumber : Math.max(aggregate.max, asNumber);
        aggregate.sum += asNumber;
      }
      measurements.set(sample.name, aggregate);

      if (sample.name === 'board.digest') {
        const boardId = dimensions.boardId;
        if (typeof boardId === 'string' && typeof sample.value === 'string') {
          if (!(boardId in lastDigests) && digestOrder.length >= MAX_DIGESTS) {
            const oldest = digestOrder.shift();
            if (oldest) delete lastDigests[oldest];
          }
          if (!(boardId in lastDigests)) digestOrder.push(boardId);
          lastDigests[boardId] = sample.value;
        }
      }

      if (sample.name === 'connections.active' && asNumber != null) {
        counters['connections.active'] = asNumber;
      }
      if (sample.name === 'boards.active' && asNumber != null) {
        counters['boards.active'] = asNumber;
      }
    } catch {
      eventsLost += 1;
      bump('measureFailure');
    }
  };

  const snapshot = (): OperationalSnapshot => {
    const memory = process.memoryUsage();
    const eventLoop = measurements.get('eventLoop.delayMs');
    const connections = measurements.get('connections.active');
    const boards = measurements.get('boards.active');
    const rss = measurements.get('memory.rssBytes');
    const heap = measurements.get('memory.heapUsedBytes');
    return {
      at: new Date(now()).toISOString(),
      sequence,
      eventsLost,
      eventLoopDelayMs: eventLoop && typeof eventLoop.last === 'number'
        ? {
            min: eventLoop.min ?? eventLoop.last,
            mean: eventLoop.count ? eventLoop.sum / eventLoop.count : eventLoop.last,
            p50: eventLoop.last,
            p95: eventLoop.max ?? eventLoop.last,
            max: eventLoop.max ?? eventLoop.last
          }
        : null,
      memory: {
        rssBytes: typeof rss?.last === 'number' ? rss.last : memory.rss,
        heapUsedBytes: typeof heap?.last === 'number' ? heap.last : memory.heapUsed
      },
      connections: typeof connections?.last === 'number' ? connections.last : 0,
      boards: typeof boards?.last === 'number' ? boards.last : 0,
      errors: { persistence: persistenceErrors, unhandled: unhandledErrors },
      lastDigests: { ...lastDigests },
      counters: { ...counters },
      measurements: Object.fromEntries(measurements)
    };
  };

  return {
    record,
    measure,
    snapshot,
    recorded: () => events.slice()
  };
};
