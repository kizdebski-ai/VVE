// Browser Pointer Event Adapter for InputPipeline. The only production
// path that reads DOM PointerEvents; tests replay recorded traces instead.

import type {
  InputPhase,
  PointerSample,
  PointerSampleBatch,
  PointerType,
  ViewportTransform
} from './inputPipeline';

const asPointerType = (value: unknown): PointerType => {
  if (value === 'mouse' || value === 'pen' || value === 'touch') return value;
  return 'unknown';
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Pen keeps the native pressure, including light values. Mouse/touch that
 * report the browser default of 0.5 (or 0 while a button is down) become a
 * constant 0.5 so rendering does not treat them as a real pressure curve.
 */
export const normalizePressure = (
  pointerType: PointerType,
  pressure: number,
  buttons: number
): number => {
  const finite = Number.isFinite(pressure) ? pressure : 0;
  if (pointerType === 'pen') return clamp01(finite);
  if (finite > 0 && finite !== 0.5) return clamp01(finite);
  return buttons ? 0.5 : 0;
};

export const sampleFromPointerEvent = (
  event: Pick<
    PointerEvent,
    | 'pointerId'
    | 'pointerType'
    | 'isPrimary'
    | 'buttons'
    | 'button'
    | 'pressure'
    | 'tiltX'
    | 'tiltY'
    | 'clientX'
    | 'clientY'
    | 'timeStamp'
  >,
  coalesced = false
): PointerSample => {
  const pointerType = asPointerType(event.pointerType);
  const buttons = Number.isFinite(event.buttons) ? event.buttons : 0;
  const sample: PointerSample = {
    pointerId: event.pointerId,
    pointerType,
    isPrimary: event.isPrimary !== false,
    buttons,
    button: Number.isFinite(event.button) ? event.button : -1,
    pressure: normalizePressure(pointerType, event.pressure, buttons),
    clientX: event.clientX,
    clientY: event.clientY,
    timeStamp: Number.isFinite(event.timeStamp) ? event.timeStamp : 0,
    coalesced
  };
  if (Number.isFinite(event.tiltX)) sample.tiltX = event.tiltX;
  if (Number.isFinite(event.tiltY)) sample.tiltY = event.tiltY;
  return sample;
};

export const coalescedSamplesFromEvent = (event: PointerEvent): PointerSample[] => {
  const extra =
    typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
  if (!extra.length) return [sampleFromPointerEvent(event, false)];
  const samples = extra.map((item) => sampleFromPointerEvent(item, true));
  // The dispatched event is the latest sample and is not coalesced.
  const last = extra[extra.length - 1];
  if (
    !last ||
    last.timeStamp !== event.timeStamp ||
    last.clientX !== event.clientX ||
    last.clientY !== event.clientY
  ) {
    samples.push(sampleFromPointerEvent(event, false));
  } else {
    samples[samples.length - 1] = sampleFromPointerEvent(event, false);
  }
  return samples;
};

export interface AdapterBatchOptions {
  phase: InputPhase;
  viewport: ViewportTransform;
  reducedMotion?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  spacePan?: boolean;
  panTool?: boolean;
  smoothPath?: boolean;
}

export const batchFromPointerEvent = (
  event: PointerEvent,
  options: AdapterBatchOptions
): PointerSampleBatch => ({
  samples:
    options.phase === 'move' || options.phase === 'hover'
      ? coalescedSamplesFromEvent(event)
      : [sampleFromPointerEvent(event, false)],
  phase: options.phase,
  viewport: options.viewport,
  reducedMotion: options.reducedMotion === true,
  altKey: options.altKey === true,
  shiftKey: options.shiftKey === true,
  spacePan: options.spacePan === true,
  panTool: options.panTool === true,
  smoothPath: options.smoothPath !== false
});

export const viewportFromElement = (
  element: Pick<Element, 'getBoundingClientRect'>,
  viewport: { zoom: number; panX: number; panY: number }
): ViewportTransform => {
  const rect = element.getBoundingClientRect();
  return {
    zoom: viewport.zoom,
    panX: viewport.panX,
    panY: viewport.panY,
    canvasLeft: rect.left,
    canvasTop: rect.top
  };
};

export const prefersReducedMotion = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};
