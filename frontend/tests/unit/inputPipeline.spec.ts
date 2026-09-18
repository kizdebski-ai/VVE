import { describe, expect, it } from 'vitest';

import {
  createInputPipeline,
  type PointerSample,
  type PointerSampleBatch,
  type ViewportTransform
} from '@/board/inputPipeline';
import {
  defaultInputStyle,
  loadInputStyle,
  saveInputStyle,
  suggestProfile,
  INPUT_STYLE_STORAGE_KEY
} from '@/board/inputStyle';
import { normalizePressure, sampleFromPointerEvent } from '@/board/pointerEventAdapter';

const view = (overrides: Partial<ViewportTransform> = {}): ViewportTransform => ({
  zoom: 1,
  panX: 0,
  panY: 0,
  canvasLeft: 0,
  canvasTop: 0,
  ...overrides
});

const sample = (overrides: Partial<PointerSample> & Pick<PointerSample, 'pointerId' | 'timeStamp' | 'clientX' | 'clientY'>): PointerSample => ({
  pointerType: 'mouse',
  isPrimary: true,
  buttons: 1,
  button: 0,
  pressure: 0.5,
  ...overrides
});

const batch = (
  phase: PointerSampleBatch['phase'],
  samples: PointerSample[],
  extras: Partial<PointerSampleBatch> = {}
): PointerSampleBatch => ({
  samples,
  phase,
  viewport: view(),
  ...extras
});

const kinds = (result: { intents: Array<{ kind: string }> }) => result.intents.map((intent) => intent.kind);

describe('InputPipeline Interface', () => {
  it('replays a mouse stroke into start/update/finish intents with Mysz smoothing', () => {
    const pipeline = createInputPipeline({ initialProfile: 'mouse' });
    const down = pipeline.ingest(
      batch('down', [sample({ pointerId: 1, timeStamp: 0, clientX: 0, clientY: 0 })])
    );
    expect(kinds(down)).toContain('drawStart');

    const corner = pipeline.ingest(
      batch('move', [
        sample({ pointerId: 1, timeStamp: 16, clientX: 40, clientY: 0 }),
        sample({ pointerId: 1, timeStamp: 32, clientX: 80, clientY: 0 }),
        sample({ pointerId: 1, timeStamp: 48, clientX: 80, clientY: 40 }),
        sample({ pointerId: 1, timeStamp: 64, clientX: 80, clientY: 80 })
      ])
    );
    const updates = corner.intents.filter((intent) => intent.kind === 'drawUpdate');
    expect(updates.length).toBeGreaterThan(3);
    const last = updates[updates.length - 1];
    if (last?.kind !== 'drawUpdate') throw new Error('expected drawUpdate');
    // Strong smoothing pulls the right-angle corner inward instead of keeping
    // the raw (80, 80) pointer sample.
    expect(last.world.x).toBeLessThan(80);
    expect(last.world.y).toBeLessThan(80);
    expect(last.world.x).toBeGreaterThan(40);

    const finish = pipeline.ingest(
      batch('up', [sample({ pointerId: 1, timeStamp: 80, clientX: 80, clientY: 80, buttons: 0, button: 0 })])
    );
    expect(kinds(finish)).toContain('drawFinish');
    expect(kinds(finish)).not.toContain('drawCancel');
    pipeline.dispose();
  });

  it('preserves pen pressure and consumes coalesced samples for Pióro', () => {
    const pipeline = createInputPipeline({ initialProfile: 'pen' });
    pipeline.ingest(
      batch('down', [
        sample({
          pointerId: 7,
          pointerType: 'pen',
          timeStamp: 0,
          clientX: 10,
          clientY: 10,
          pressure: 0.18
        })
      ])
    );
    const move = pipeline.ingest(
      batch('move', [
        sample({
          pointerId: 7,
          pointerType: 'pen',
          timeStamp: 8,
          clientX: 12,
          clientY: 14,
          pressure: 0.22,
          coalesced: true
        }),
        sample({
          pointerId: 7,
          pointerType: 'pen',
          timeStamp: 12,
          clientX: 16,
          clientY: 18,
          pressure: 0.81,
          coalesced: true
        }),
        sample({
          pointerId: 7,
          pointerType: 'pen',
          timeStamp: 16,
          clientX: 22,
          clientY: 21,
          pressure: 0.84
        })
      ])
    );
    const updates = move.intents.filter((intent) => intent.kind === 'drawUpdate');
    expect(move.work.samplesAccepted).toBe(3);
    expect(updates.length).toBeGreaterThanOrEqual(3);
    const pressures = updates.map((intent) =>
      intent.kind === 'drawUpdate' ? intent.pressure : 0
    );
    expect(Math.max(...pressures)).toBeGreaterThan(0.7);
    expect(pressures.some((value) => value > 0.5 && value < 0.95)).toBe(true);
    pipeline.dispose();
  });

  it('lets Apple Pencil draw while rejecting simultaneous palm touch', () => {
    const pipeline = createInputPipeline({ initialProfile: 'pen' });
    pipeline.ingest(
      batch('down', [
        sample({
          pointerId: 11,
          pointerType: 'pen',
          timeStamp: 0,
          clientX: 40,
          clientY: 40,
          pressure: 0.6
        })
      ])
    );
    const palm = pipeline.ingest(
      batch('down', [
        sample({
          pointerId: 12,
          pointerType: 'touch',
          timeStamp: 4,
          clientX: 48,
          clientY: 90,
          pressure: 1
        })
      ])
    );
    expect(palm.intents.some((intent) => intent.kind === 'ignored' && intent.reason === 'palm')).toBe(true);
    expect(kinds(palm)).not.toContain('drawStart');
    expect(kinds(palm)).not.toContain('pinchStart');

    const move = pipeline.ingest(
      batch('move', [
        sample({
          pointerId: 11,
          pointerType: 'pen',
          timeStamp: 20,
          clientX: 70,
          clientY: 55,
          pressure: 0.7
        })
      ])
    );
    expect(kinds(move)).toContain('drawUpdate');
    pipeline.dispose();
  });

  it('turns two-finger touch into pinch/pan navigation and cancels an in-progress stroke', () => {
    const pipeline = createInputPipeline();
    pipeline.ingest(
      batch('down', [sample({ pointerId: 1, pointerType: 'touch', timeStamp: 0, clientX: 100, clientY: 100 })])
    );
    const pinch = pipeline.ingest(
      batch('down', [sample({ pointerId: 2, pointerType: 'touch', timeStamp: 10, clientX: 180, clientY: 100 })])
    );
    expect(kinds(pinch)).toEqual(expect.arrayContaining(['drawCancel', 'pinchStart']));
    expect(kinds(pinch)).not.toContain('drawFinish');

    const update = pipeline.ingest(
      batch('move', [
        sample({ pointerId: 1, pointerType: 'touch', timeStamp: 24, clientX: 90, clientY: 110 }),
        sample({ pointerId: 2, pointerType: 'touch', timeStamp: 24, clientX: 210, clientY: 110 })
      ])
    );
    const pinchUpdate = [...update.intents].reverse().find((intent) => intent.kind === 'pinchUpdate');
    expect(pinchUpdate?.kind).toBe('pinchUpdate');
    if (pinchUpdate?.kind === 'pinchUpdate') {
      expect(pinchUpdate.scale).toBeGreaterThan(1);
      expect(pinchUpdate.screen.x).toBeCloseTo(150, 0);
    }

    const finish = pipeline.ingest(
      batch('up', [
        sample({ pointerId: 1, pointerType: 'touch', timeStamp: 40, clientX: 90, clientY: 110, buttons: 0 }),
        sample({ pointerId: 2, pointerType: 'touch', timeStamp: 41, clientX: 210, clientY: 110, buttons: 0 })
      ])
    );
    expect(kinds(finish)).toContain('pinchFinish');
    expect(kinds(finish)).not.toContain('drawStart');
    pipeline.dispose();
  });

  it('emits pan intents for the pan tool and never starts a stroke', () => {
    const pipeline = createInputPipeline();
    const down = pipeline.ingest(
      batch('down', [sample({ pointerId: 3, timeStamp: 0, clientX: 10, clientY: 10 })], { panTool: true })
    );
    expect(kinds(down)).toContain('panStart');
    expect(kinds(down)).not.toContain('drawStart');
    const move = pipeline.ingest(
      batch('move', [sample({ pointerId: 3, timeStamp: 16, clientX: 40, clientY: 18 })], { panTool: true })
    );
    const pan = move.intents.find((intent) => intent.kind === 'panUpdate');
    expect(pan?.kind).toBe('panUpdate');
    if (pan?.kind === 'panUpdate') {
      expect(pan.dx).toBe(30);
      expect(pan.dy).toBe(8);
    }
    pipeline.dispose();
  });

  it('converts coordinates once per batch using the supplied viewport', () => {
    const pipeline = createInputPipeline({ initialProfile: 'pen' });
    const result = pipeline.ingest(
      batch(
        'down',
        [sample({ pointerId: 1, timeStamp: 0, clientX: 120, clientY: 80 })],
        { viewport: view({ zoom: 2, panX: 10, panY: 20, canvasLeft: 20, canvasTop: 10 }) }
      )
    );
    const start = result.intents.find((intent) => intent.kind === 'drawStart');
    expect(start?.kind).toBe('drawStart');
    if (start?.kind === 'drawStart') {
      // screen = (100, 70); world = ((100-10)/2, (70-20)/2) = (45, 25)
      expect(start.screen).toEqual({ x: 100, y: 70 });
      expect(start.world.x).toBeCloseTo(45);
      expect(start.world.y).toBeCloseTo(25);
    }
    pipeline.dispose();
  });

  it('ignores invalid, duplicate, and out-of-order samples instead of committing them', () => {
    const pipeline = createInputPipeline();
    pipeline.ingest(batch('down', [sample({ pointerId: 1, timeStamp: 10, clientX: 5, clientY: 5 })]));
    const invalid = pipeline.ingest(
      batch('move', [sample({ pointerId: 1, timeStamp: 20, clientX: Number.NaN, clientY: 8 })])
    );
    expect(invalid.intents.some((intent) => intent.kind === 'ignored' && intent.reason === 'invalidCoordinate')).toBe(true);

    const first = sample({ pointerId: 1, timeStamp: 30, clientX: 9, clientY: 9 });
    pipeline.ingest(batch('move', [first]));
    const duplicate = pipeline.ingest(batch('move', [first]));
    expect(duplicate.intents.some((intent) => intent.kind === 'ignored' && intent.reason === 'duplicate')).toBe(true);

    const outOfOrder = pipeline.ingest(
      batch('move', [sample({ pointerId: 1, timeStamp: 11, clientX: 40, clientY: 40 })])
    );
    expect(outOfOrder.intents.some((intent) => intent.kind === 'ignored' && intent.reason === 'outOfOrder')).toBe(true);
    pipeline.dispose();
  });

  it('cancel() never finishes a stroke, including lost capture and blur', () => {
    const pipeline = createInputPipeline();
    pipeline.ingest(batch('down', [sample({ pointerId: 4, timeStamp: 0, clientX: 1, clientY: 1 })]));
    pipeline.ingest(batch('move', [sample({ pointerId: 4, timeStamp: 10, clientX: 12, clientY: 8 })]));
    const lost = pipeline.cancel('lostcapture');
    expect(kinds(lost)).toContain('drawCancel');
    expect(kinds(lost)).not.toContain('drawFinish');

    pipeline.ingest(batch('down', [sample({ pointerId: 5, timeStamp: 40, clientX: 3, clientY: 3 })]));
    const blur = pipeline.cancel('blur');
    expect(kinds(blur)).toContain('drawCancel');
    expect(kinds(blur)).not.toContain('drawFinish');
    pipeline.dispose();
  });

  it('throttles hover/awareness and bounds work to the accepted batch', () => {
    const pipeline = createInputPipeline();
    const hover = pipeline.ingest(
      batch('hover', [
        sample({ pointerId: 1, timeStamp: 0, clientX: 4, clientY: 4, buttons: 0, button: -1 }),
        sample({ pointerId: 1, timeStamp: 5, clientX: 6, clientY: 6, buttons: 0, button: -1 }),
        sample({ pointerId: 1, timeStamp: 20, clientX: 8, clientY: 9, buttons: 0, button: -1 })
      ])
    );
    const hoverCount = hover.intents.filter((intent) => intent.kind === 'hover').length;
    expect(hoverCount).toBe(2);
    expect(hover.work.samplesAccepted + hover.work.samplesIgnored).toBe(3);
    expect(hover.work.intentsEmitted).toBeLessThanOrEqual(8);
    pipeline.dispose();
  });

  it('keeps Pióro closer to native samples than Mysz on the same trace', () => {
    const trace = [
      sample({ pointerId: 1, timeStamp: 10, clientX: 0, clientY: 0 }),
      sample({ pointerId: 1, timeStamp: 20, clientX: 30, clientY: 0 }),
      sample({ pointerId: 1, timeStamp: 30, clientX: 30, clientY: 30 })
    ];
    const follow = (profile: 'mouse' | 'pen') => {
      const pipeline = createInputPipeline({ initialProfile: profile });
      pipeline.ingest(batch('down', [trace[0]!]));
      const result = pipeline.ingest(batch('move', [trace[1]!, trace[2]!]));
      pipeline.dispose();
      const last = [...result.intents].reverse().find((intent) => intent.kind === 'drawUpdate');
      if (last?.kind !== 'drawUpdate') throw new Error('missing update');
      return last.world;
    };
    const mouse = follow('mouse');
    const pen = follow('pen');
    const nativeY = 30;
    expect(Math.abs(pen.y - nativeY)).toBeLessThan(Math.abs(mouse.y - nativeY));
  });
});

describe('Input Style persistence', () => {
  it('auto-selects Pióro for pen pointers and keeps a manual override', () => {
    expect(suggestProfile('pen')).toBe('pen');
    expect(suggestProfile('mouse')).toBe('mouse');
    expect(suggestProfile('touch')).toBe('mouse');

    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      }
    };
    expect(loadInputStyle(storage)).toEqual(defaultInputStyle());
    saveInputStyle({ profile: 'pen', overridden: true }, storage);
    expect(loadInputStyle(storage)).toEqual({ profile: 'pen', overridden: true });
    expect(memory.get(INPUT_STYLE_STORAGE_KEY)).toContain('pen');
  });
});

describe('Pointer Event Adapter pressure', () => {
  it('does not replace useful native pen pressure with the mouse default', () => {
    expect(normalizePressure('pen', 0.13, 1)).toBeCloseTo(0.13);
    expect(normalizePressure('mouse', 0.5, 1)).toBeCloseTo(0.5);
    expect(normalizePressure('mouse', 0, 1)).toBeCloseTo(0.5);
    const sample = sampleFromPointerEvent({
      pointerId: 9,
      pointerType: 'pen',
      isPrimary: true,
      buttons: 1,
      button: 0,
      pressure: 0.42,
      tiltX: 8,
      tiltY: -3,
      clientX: 1,
      clientY: 2,
      timeStamp: 4
    });
    expect(sample.pressure).toBeCloseTo(0.42);
    expect(sample.tiltX).toBe(8);
  });
});
