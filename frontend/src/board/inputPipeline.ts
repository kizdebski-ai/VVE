// InputPipeline (VVE-105, Module 6): converts ordered pointer samples into
// a bounded list of drawing, pan, pinch, hover, and awareness intents.
//
// The Implementation hides capture bookkeeping (Adapter), coalesced-sample
// folding, palm/gesture arbitration, pressure curves, Mysz/Pióro smoothing,
// resampling, coordinate conversion, and hover throttling. Callers — the
// Pointer Event Adapter and deterministic traces — share this Interface.
//
// Invariants:
// - samples are ordered by pointer id then timestamp before reduction;
// - one viewport snapshot converts the whole batch;
// - two-finger touch navigates and never commits a stroke;
// - a live Apple Pencil / pen pointer rejects palm (touch) samples;
// - cancel() never emits drawFinish;
// - invalid, duplicate, out-of-order, or unsupported samples are typed
//   ignored results rather than a partial commit.

import {
  resampleStep,
  smoothingAlpha,
  type InputProfile,
  type PointerKind
} from './inputStyle';

export type { InputProfile } from './inputStyle';

export type PointerType = PointerKind;

export type InputPhase = 'down' | 'move' | 'up' | 'cancel' | 'hover';

export type CancelReason = 'blur' | 'lostcapture' | 'gesture' | 'dispose';

export type IgnoredReason =
  | 'duplicate'
  | 'outOfOrder'
  | 'invalidCoordinate'
  | 'unsupported'
  | 'palm'
  | 'noContact';

export interface PointerSample {
  pointerId: number;
  pointerType: PointerType;
  isPrimary: boolean;
  buttons: number;
  button?: number;
  pressure: number;
  tiltX?: number;
  tiltY?: number;
  clientX: number;
  clientY: number;
  timeStamp: number;
  coalesced?: boolean;
}

export interface ViewportTransform {
  zoom: number;
  panX: number;
  panY: number;
  canvasLeft: number;
  canvasTop: number;
}

export interface PointerSampleBatch {
  samples: PointerSample[];
  phase: InputPhase;
  viewport: ViewportTransform;
  reducedMotion?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  spacePan?: boolean;
  panTool?: boolean;
  /** When false, drawing intents keep native coordinates (shapes, eraser, select). */
  smoothPath?: boolean;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface WorldPoint {
  x: number;
  y: number;
  p?: number;
  t?: number;
}

type DrawIntent = {
  kind: 'drawStart' | 'drawUpdate' | 'drawFinish';
  pointerId: number;
  world: WorldPoint;
  screen: ScreenPoint;
  pressure: number;
  timeStamp: number;
  shiftKey?: boolean;
};

type DrawCancelIntent = {
  kind: 'drawCancel';
  pointerId: number;
  reason: CancelReason;
  timeStamp: number;
};

type PanIntent =
  | {
      kind: 'panStart';
      pointerId: number;
      screen: ScreenPoint;
      timeStamp: number;
    }
  | {
      kind: 'panUpdate';
      pointerId: number;
      dx: number;
      dy: number;
      screen: ScreenPoint;
      timeStamp: number;
    }
  | {
      kind: 'panFinish';
      pointerId: number;
      timeStamp: number;
    }
  | {
      kind: 'panCancel';
      pointerId: number;
      reason: CancelReason;
      timeStamp: number;
    };

type PinchIntent =
  | {
      kind: 'pinchStart';
      pointerIds: [number, number];
      screen: ScreenPoint;
      distance: number;
      timeStamp: number;
    }
  | {
      kind: 'pinchUpdate';
      pointerIds: [number, number];
      screen: ScreenPoint;
      dx: number;
      dy: number;
      scale: number;
      distance: number;
      timeStamp: number;
    }
  | {
      kind: 'pinchFinish';
      pointerIds: [number, number];
      timeStamp: number;
    }
  | {
      kind: 'pinchCancel';
      reason: CancelReason;
      timeStamp: number;
    };

export type InputIntent =
  | DrawIntent
  | DrawCancelIntent
  | PanIntent
  | PinchIntent
  | { kind: 'hover'; world: WorldPoint; screen: ScreenPoint; timeStamp: number }
  | { kind: 'awareness'; world: WorldPoint | null; timeStamp: number }
  | { kind: 'ignored'; reason: IgnoredReason; pointerId?: number };

export interface InputWork {
  samplesAccepted: number;
  samplesIgnored: number;
  intentsEmitted: number;
}

export interface InputResult {
  intents: InputIntent[];
  profile: InputProfile;
  work: InputWork;
}

export interface InputPipeline {
  configure(profile: InputProfile): void;
  ingest(batch: PointerSampleBatch): InputResult;
  cancel(reason: CancelReason): InputResult;
  profile(): InputProfile;
  dispose(): void;
}

export interface CreateInputPipelineOptions {
  initialProfile?: InputProfile;
}

interface TrackedPointer {
  sample: PointerSample;
  screen: ScreenPoint;
  world: WorldPoint;
  down: boolean;
}

type GestureState =
  | { type: 'idle' }
  | {
      type: 'draw';
      pointerId: number;
      lastSmoothed: WorldPoint;
      lastRaw: WorldPoint;
    }
  | { type: 'pan'; pointerId: number; lastScreen: ScreenPoint }
  | {
      type: 'pinch';
      pointerIds: [number, number];
      startDistance: number;
      lastCenter: ScreenPoint;
    };

const HOVER_THROTTLE_MS = 16;
const MAX_INTENTS_PER_BATCH = 64;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const cloneWorld = (point: WorldPoint): WorldPoint => {
  const next: WorldPoint = { x: point.x, y: point.y };
  if (point.p !== undefined) next.p = point.p;
  if (point.t !== undefined) next.t = point.t;
  return next;
};

const toScreen = (sample: PointerSample, viewport: ViewportTransform): ScreenPoint => ({
  x: sample.clientX - viewport.canvasLeft,
  y: sample.clientY - viewport.canvasTop
});

const toWorld = (screen: ScreenPoint, viewport: ViewportTransform, sample: PointerSample): WorldPoint => {
  const zoom = viewport.zoom > 0 && Number.isFinite(viewport.zoom) ? viewport.zoom : 1;
  const world: WorldPoint = {
    x: (screen.x - viewport.panX) / zoom,
    y: (screen.y - viewport.panY) / zoom,
    t: sample.timeStamp
  };
  if (sample.pressure > 0) world.p = sample.pressure;
  return world;
};

const sampleKey = (sample: PointerSample): string =>
  `${sample.pointerId}:${sample.timeStamp}:${sample.clientX}:${sample.clientY}:${sample.buttons}`;

const wantsPan = (sample: PointerSample, batch: PointerSampleBatch): boolean => {
  const button = sample.button ?? -1;
  return (
    batch.panTool === true ||
    batch.spacePan === true ||
    batch.altKey === true ||
    button === 1 ||
    (sample.buttons & 4) === 4
  );
};

const isContacting = (sample: PointerSample, phase: InputPhase): boolean => {
  if (phase === 'up' || phase === 'cancel') return false;
  if (phase === 'down') return true;
  return sample.buttons !== 0;
};

const touchPointersDown = (pointers: Map<number, TrackedPointer>): TrackedPointer[] => {
  const touches: TrackedPointer[] = [];
  for (const tracked of pointers.values()) {
    if (tracked.down && tracked.sample.pointerType === 'touch') touches.push(tracked);
  }
  return touches;
};

const hasPenDown = (pointers: Map<number, TrackedPointer>): boolean => {
  for (const tracked of pointers.values()) {
    if (tracked.down && tracked.sample.pointerType === 'pen') return true;
  }
  return false;
};

const pinchGeometry = (a: ScreenPoint, b: ScreenPoint): { center: ScreenPoint; distance: number } => ({
  center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
  distance: Math.hypot(a.x - b.x, a.y - b.y)
});

const smoothToward = (
  previous: WorldPoint,
  next: WorldPoint,
  profile: InputProfile
): WorldPoint => {
  const alpha = smoothingAlpha(profile);
  const mixed: WorldPoint = {
    x: previous.x + (next.x - previous.x) * alpha,
    y: previous.y + (next.y - previous.y) * alpha,
    t: next.t
  };
  const prevP = previous.p ?? 0.5;
  const nextP = next.p ?? prevP;
  // Pióro keeps nearly-native pressure; Mysz still interpolates so width does
  // not chatter from noisy mouse reports.
  const pressureAlpha = profile === 'pen' ? 0.92 : alpha;
  mixed.p = prevP + (nextP - prevP) * pressureAlpha;
  return mixed;
};

const resampleBetween = (
  from: WorldPoint,
  to: WorldPoint,
  profile: InputProfile
): WorldPoint[] => {
  const step = resampleStep(profile);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= step * 1.5) return [to];
  const count = Math.min(8, Math.floor(distance / step));
  const points: WorldPoint[] = [];
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    const point: WorldPoint = {
      x: from.x + dx * t,
      y: from.y + dy * t,
      t: (from.t ?? 0) + ((to.t ?? from.t ?? 0) - (from.t ?? 0)) * t
    };
    if (from.p !== undefined || to.p !== undefined) {
      point.p = (from.p ?? 0.5) + ((to.p ?? from.p ?? 0.5) - (from.p ?? 0.5)) * t;
    }
    points.push(point);
  }
  points.push(to);
  return points;
};

const emptyResult = (profile: InputProfile, intents: InputIntent[], accepted: number, ignored: number): InputResult => ({
  intents,
  profile,
  work: {
    samplesAccepted: accepted,
    samplesIgnored: ignored,
    intentsEmitted: intents.length
  }
});

export const createInputPipeline = (
  options: CreateInputPipelineOptions = {}
): InputPipeline => {
  let profile: InputProfile = options.initialProfile ?? 'mouse';
  let gesture: GestureState = { type: 'idle' };
  const pointers = new Map<number, TrackedPointer>();
  const lastTimestamp = new Map<number, number>();
  const recentKeys = new Set<string>();
  let lastHoverAt = Number.NEGATIVE_INFINITY;
  let lastAwareness: WorldPoint | null = null;
  let disposed = false;

  const resetRecentKeys = () => {
    if (recentKeys.size > 256) recentKeys.clear();
  };

  const emitAwareness = (intents: InputIntent[], world: WorldPoint | null, timeStamp: number) => {
    const same =
      (world === null && lastAwareness === null) ||
      (world !== null &&
        lastAwareness !== null &&
        world.x === lastAwareness.x &&
        world.y === lastAwareness.y);
    if (same) return;
    lastAwareness = world ? cloneWorld(world) : null;
    intents.push({ kind: 'awareness', world: lastAwareness, timeStamp });
  };

  const cancelGesture = (reason: CancelReason, timeStamp: number, intents: InputIntent[]) => {
    if (gesture.type === 'draw') {
      intents.push({
        kind: 'drawCancel',
        pointerId: gesture.pointerId,
        reason,
        timeStamp
      });
    } else if (gesture.type === 'pan') {
      intents.push({
        kind: 'panCancel',
        pointerId: gesture.pointerId,
        reason,
        timeStamp
      });
    } else if (gesture.type === 'pinch') {
      intents.push({ kind: 'pinchCancel', reason, timeStamp });
    }
    gesture = { type: 'idle' };
  };

  const beginPinch = (touches: TrackedPointer[], timeStamp: number, intents: InputIntent[]) => {
    if (touches.length < 2) return;
    const first = touches[0];
    const second = touches[1];
    if (!first || !second) return;
    if (gesture.type === 'draw' || gesture.type === 'pan') {
      cancelGesture('gesture', timeStamp, intents);
    }
    const { center, distance } = pinchGeometry(first.screen, second.screen);
    gesture = {
      type: 'pinch',
      pointerIds: [first.sample.pointerId, second.sample.pointerId],
      startDistance: distance || 1,
      lastCenter: center
    };
    intents.push({
      kind: 'pinchStart',
      pointerIds: gesture.pointerIds,
      screen: center,
      distance,
      timeStamp
    });
  };

  const updatePinch = (timeStamp: number, intents: InputIntent[]) => {
    if (gesture.type !== 'pinch') return;
    const a = pointers.get(gesture.pointerIds[0]);
    const b = pointers.get(gesture.pointerIds[1]);
    if (!a?.down || !b?.down) return;
    const { center, distance } = pinchGeometry(a.screen, b.screen);
    const scale = gesture.startDistance ? distance / gesture.startDistance : 1;
    const dx = center.x - gesture.lastCenter.x;
    const dy = center.y - gesture.lastCenter.y;
    gesture.lastCenter = center;
    intents.push({
      kind: 'pinchUpdate',
      pointerIds: gesture.pointerIds,
      screen: center,
      dx,
      dy,
      scale,
      distance,
      timeStamp
    });
  };

  const ingestOne = (
    sample: PointerSample,
    batch: PointerSampleBatch,
    viewport: ViewportTransform,
    intents: InputIntent[]
  ): 'accepted' | 'ignored' => {
    if (!isFiniteNumber(sample.clientX) || !isFiniteNumber(sample.clientY)) {
      intents.push({ kind: 'ignored', reason: 'invalidCoordinate', pointerId: sample.pointerId });
      return 'ignored';
    }
    if (!isFiniteNumber(sample.pointerId) || !isFiniteNumber(sample.timeStamp)) {
      intents.push({ kind: 'ignored', reason: 'unsupported', pointerId: sample.pointerId });
      return 'ignored';
    }
    const key = sampleKey(sample);
    if (recentKeys.has(key)) {
      intents.push({ kind: 'ignored', reason: 'duplicate', pointerId: sample.pointerId });
      return 'ignored';
    }
    recentKeys.add(key);
    const previousTime = lastTimestamp.get(sample.pointerId);
    if (previousTime !== undefined && sample.timeStamp < previousTime) {
      intents.push({ kind: 'ignored', reason: 'outOfOrder', pointerId: sample.pointerId });
      return 'ignored';
    }
    lastTimestamp.set(sample.pointerId, sample.timeStamp);

    const screen = toScreen(sample, viewport);
    if (!isFiniteNumber(screen.x) || !isFiniteNumber(screen.y)) {
      intents.push({ kind: 'ignored', reason: 'invalidCoordinate', pointerId: sample.pointerId });
      return 'ignored';
    }
    const world = toWorld(screen, viewport, sample);
    if (!isFiniteNumber(world.x) || !isFiniteNumber(world.y)) {
      intents.push({ kind: 'ignored', reason: 'invalidCoordinate', pointerId: sample.pointerId });
      return 'ignored';
    }

    const contacting = isContacting(sample, batch.phase);
    const tracked: TrackedPointer = { sample, screen, world, down: contacting };
    if (batch.phase === 'up' || batch.phase === 'cancel') {
      tracked.down = false;
    } else if (contacting) {
      tracked.down = true;
    } else {
      const existing = pointers.get(sample.pointerId);
      tracked.down = existing?.down === true && batch.phase === 'move';
    }

    // Palm / touch rejection: a live pen owns the stroke. Extra finger
    // contact is ignored rather than turned into a second stroke or a pan.
    if (sample.pointerType === 'touch' && hasPenDown(pointers)) {
      tracked.down = false;
      pointers.set(sample.pointerId, tracked);
      intents.push({ kind: 'ignored', reason: 'palm', pointerId: sample.pointerId });
      return 'ignored';
    }
    if (sample.pointerType === 'pen' && tracked.down) {
      for (const [id, other] of pointers) {
        if (other.sample.pointerType === 'touch' && other.down) {
          other.down = false;
          pointers.set(id, other);
          if (gesture.type === 'draw' && gesture.pointerId === id) {
            cancelGesture('gesture', sample.timeStamp, intents);
          }
        }
      }
    }

    pointers.set(sample.pointerId, tracked);

    if (batch.phase === 'cancel') {
      if (gesture.type === 'draw' && gesture.pointerId === sample.pointerId) {
        cancelGesture('lostcapture', sample.timeStamp, intents);
      } else if (gesture.type === 'pan' && gesture.pointerId === sample.pointerId) {
        cancelGesture('lostcapture', sample.timeStamp, intents);
      } else if (gesture.type === 'pinch' && gesture.pointerIds.includes(sample.pointerId)) {
        cancelGesture('lostcapture', sample.timeStamp, intents);
      }
      pointers.delete(sample.pointerId);
      emitAwareness(intents, null, sample.timeStamp);
      return 'accepted';
    }

    const touches = touchPointersDown(pointers);

    if (touches.length >= 2) {
      if (gesture.type !== 'pinch') {
        beginPinch(touches, sample.timeStamp, intents);
      } else if (batch.phase === 'move') {
        updatePinch(sample.timeStamp, intents);
      }
      return 'accepted';
    }

    if (gesture.type === 'pinch' && touches.length < 2) {
      intents.push({
        kind: 'pinchFinish',
        pointerIds: gesture.pointerIds,
        timeStamp: sample.timeStamp
      });
      gesture = { type: 'idle' };
      if (batch.phase === 'up' || batch.phase === 'cancel' || !tracked.down) {
        emitAwareness(intents, null, sample.timeStamp);
        if (!tracked.down) pointers.delete(sample.pointerId);
        return 'accepted';
      }
    }

    if (batch.phase === 'hover' || (batch.phase === 'move' && !tracked.down && gesture.type === 'idle')) {
      if (sample.timeStamp - lastHoverAt >= HOVER_THROTTLE_MS) {
        lastHoverAt = sample.timeStamp;
        intents.push({
          kind: 'hover',
          world: cloneWorld(world),
          screen,
          timeStamp: sample.timeStamp
        });
        emitAwareness(intents, world, sample.timeStamp);
      }
      return 'accepted';
    }

    if (batch.phase === 'down' && tracked.down) {
      if (wantsPan(sample, batch)) {
        if (gesture.type === 'draw') cancelGesture('gesture', sample.timeStamp, intents);
        gesture = { type: 'pan', pointerId: sample.pointerId, lastScreen: screen };
        intents.push({
          kind: 'panStart',
          pointerId: sample.pointerId,
          screen,
          timeStamp: sample.timeStamp
        });
        emitAwareness(intents, world, sample.timeStamp);
        return 'accepted';
      }
      if (sample.button === 2 || (sample.buttons & 2) === 2) {
        intents.push({ kind: 'ignored', reason: 'unsupported', pointerId: sample.pointerId });
        return 'ignored';
      }
      gesture = {
        type: 'draw',
        pointerId: sample.pointerId,
        lastSmoothed: cloneWorld(world),
        lastRaw: cloneWorld(world)
      };
      intents.push({
        kind: 'drawStart',
        pointerId: sample.pointerId,
        world: cloneWorld(world),
        screen,
        pressure: sample.pressure,
        timeStamp: sample.timeStamp,
        shiftKey: batch.shiftKey === true
      });
      emitAwareness(intents, world, sample.timeStamp);
      return 'accepted';
    }

    if (batch.phase === 'move' && gesture.type === 'draw' && gesture.pointerId === sample.pointerId) {
      const useSmoothing = batch.smoothPath !== false;
      const target = useSmoothing ? smoothToward(gesture.lastSmoothed, world, profile) : cloneWorld(world);
      const points = useSmoothing
        ? resampleBetween(gesture.lastSmoothed, target, profile)
        : [target];
      gesture.lastSmoothed = cloneWorld(target);
      gesture.lastRaw = cloneWorld(world);
      for (const point of points) {
        if (intents.length >= MAX_INTENTS_PER_BATCH) break;
        intents.push({
          kind: 'drawUpdate',
          pointerId: sample.pointerId,
          world: cloneWorld(point),
          screen,
          pressure: point.p ?? sample.pressure,
          timeStamp: point.t ?? sample.timeStamp,
          shiftKey: batch.shiftKey === true
        });
      }
      emitAwareness(intents, target, sample.timeStamp);
      return 'accepted';
    }

    if (batch.phase === 'move' && gesture.type === 'pan' && gesture.pointerId === sample.pointerId) {
      const dx = screen.x - gesture.lastScreen.x;
      const dy = screen.y - gesture.lastScreen.y;
      gesture.lastScreen = screen;
      intents.push({
        kind: 'panUpdate',
        pointerId: sample.pointerId,
        dx,
        dy,
        screen,
        timeStamp: sample.timeStamp
      });
      emitAwareness(intents, world, sample.timeStamp);
      return 'accepted';
    }

    if (batch.phase === 'up') {
      if (gesture.type === 'draw' && gesture.pointerId === sample.pointerId) {
        intents.push({
          kind: 'drawFinish',
          pointerId: sample.pointerId,
          world: cloneWorld(gesture.lastSmoothed),
          screen,
          pressure: sample.pressure,
          timeStamp: sample.timeStamp,
          shiftKey: batch.shiftKey === true
        });
        gesture = { type: 'idle' };
      } else if (gesture.type === 'pan' && gesture.pointerId === sample.pointerId) {
        intents.push({
          kind: 'panFinish',
          pointerId: sample.pointerId,
          timeStamp: sample.timeStamp
        });
        gesture = { type: 'idle' };
      }
      pointers.delete(sample.pointerId);
      emitAwareness(intents, null, sample.timeStamp);
      return 'accepted';
    }

    if (!tracked.down) {
      intents.push({ kind: 'ignored', reason: 'noContact', pointerId: sample.pointerId });
      return 'ignored';
    }
    return 'accepted';
  };

  const ingest = (batch: PointerSampleBatch): InputResult => {
    if (disposed) {
      return emptyResult(profile, [{ kind: 'ignored', reason: 'unsupported' }], 0, 1);
    }
    const viewport = batch.viewport;
    if (
      !viewport ||
      !isFiniteNumber(viewport.zoom) ||
      viewport.zoom <= 0 ||
      !isFiniteNumber(viewport.panX) ||
      !isFiniteNumber(viewport.panY) ||
      !isFiniteNumber(viewport.canvasLeft) ||
      !isFiniteNumber(viewport.canvasTop)
    ) {
      return emptyResult(
        profile,
        [{ kind: 'ignored', reason: 'invalidCoordinate' }],
        0,
        batch.samples.length || 1
      );
    }

    const ordered = [...batch.samples].sort((a, b) => {
      if (a.pointerId !== b.pointerId) return a.pointerId - b.pointerId;
      return a.timeStamp - b.timeStamp;
    });

    const intents: InputIntent[] = [];
    let accepted = 0;
    let ignored = 0;
    resetRecentKeys();
    for (const sample of ordered) {
      if (intents.length >= MAX_INTENTS_PER_BATCH) {
        ignored += 1;
        continue;
      }
      const status = ingestOne(sample, batch, viewport, intents);
      if (status === 'accepted') accepted += 1;
      else ignored += 1;
    }
    return emptyResult(profile, intents, accepted, ignored);
  };

  const cancel = (reason: CancelReason): InputResult => {
    if (disposed && reason !== 'dispose') {
      return emptyResult(profile, [], 0, 0);
    }
    const intents: InputIntent[] = [];
    const timeStamp =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    cancelGesture(reason, timeStamp, intents);
    pointers.clear();
    lastTimestamp.clear();
    recentKeys.clear();
    emitAwareness(intents, null, timeStamp);
    if (reason === 'dispose') disposed = true;
    return emptyResult(profile, intents, 0, 0);
  };

  return {
    configure: (next) => {
      if (next === 'mouse' || next === 'pen') profile = next;
    },
    ingest,
    cancel,
    profile: () => profile,
    dispose: () => {
      cancel('dispose');
    }
  };
};
