/**
 * useDrawingEngine - core drawing logic extracted from WhiteboardCanvas.
 *
 * Contains: pen smoothing, grid snapping, startDrawing, draw, finishDrawing,
 * eraseElement, and the Ramer-Douglas-Peucker simplification algorithm.
 */
import { ref, computed, nextTick } from 'vue';
import { createNewElement } from '../utils/canvasTools.js';
import { computeGridSteps } from '../utils/canvasGrid.js';
import { DEFAULT_PEN_PRESETS } from '../utils/penStyles.js';

const PEN_COORD_PRECISION = 2;

// Tools that behave like shapes (use start/end points)
const SHAPE_TOOLS = new Set([
  'rectangle', 'diamond', 'circle', 'square', 'triangle',
  'trapezoid', 'parallelogram', 'deltoid',
  'cube', 'cuboid', 'sphere', 'cylinder', 'cone', 'pyramid', 'tetrahedron',
]);

const LINE_TOOLS = new Set(['line']);

export { SHAPE_TOOLS };

export function useDrawingEngine({
  // Refs (shared)
  isDrawing,
  currentTool,
  currentColor,
  currentLineWidth,
  zoomLevel,
  panOffset,
  ydoc,
  yDrawings,
  yjsConnection,
  session,
  smoothingFactor,
  debugModeEnabled,
  // Props getters
  getCurrentShape,
  getCurrentLineStyle,
  getCurrentRoughness,
  getCurrentFillColor,
  getCurrentArrowStyle,
  getActiveFeature,
  getHandwritingStylerOptions,
  // Functions
  updateGlobalState,
  redrawCanvas,
  scheduleRedraw,
  refreshMovableElements,
  openConfigPanel,
  startInlineText,
  attachBindingsToLineDraft,
  getActiveModule,
  emit,
  debugLog,
  debugWarn,
  showToast,
}) {

  // --- Internal state ---
  const currentElementPreview = ref(null);
  const pointsBuffer = ref([]);
  const snapIndicator = ref(null);
  const shiftPressedAtStart = ref(false);
  const startCoordsForShiftLine = ref(null);

  const activePenPresetKey = computed(() => {
    const opts = getHandwritingStylerOptions();
    return opts?.preset || 'gel';
  });

  const activePenPreset = computed(() => {
    const options = getHandwritingStylerOptions() || {};
    return (options.presets && options.presets[activePenPresetKey.value])
      || DEFAULT_PEN_PRESETS[activePenPresetKey.value]
      || {};
  });

  // --- Pen Smoothing ---

  // InputPipeline (VVE-105) owns Mysz/Pióro path smoothing. The live stroke
  // records the already-reduced point; averaging here would double-filter
  // Pióro pressure and put corners back on Mysz.
  const addSmoothedPenPoint = (coords) => {
    const stamped = {
      x: parseFloat(Number(coords.x).toFixed(PEN_COORD_PRECISION)),
      y: parseFloat(Number(coords.y).toFixed(PEN_COORD_PRECISION)),
      t: coords.t ?? (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    };
    if (typeof coords.p === 'number' && Number.isFinite(coords.p)) {
      stamped.p = coords.p;
    }
    pointsBuffer.value = [stamped];
    return stamped;
  };

  const computePenWidthFromPreset = (presetConfig, requestedWidth) => {
    const base = presetConfig?.baseWidth
      || presetConfig?.lineWidth
      || presetConfig?.width
      || requestedWidth
      || 2;
    const scale = Math.max(0.5, (requestedWidth || 2) / 2);
    return parseFloat((base * scale).toFixed(2));
  };

  // --- Grid Snapping ---

  // Will be set by setGridAlignOptionsGetter
  let _gridAlignOptionsGetter = () => ({});
  const setGridAlignOptionsGetter = (fn) => { _gridAlignOptionsGetter = fn; };

  const getSnapSettings = () => {
    const strengthRaw = _gridAlignOptionsGetter()?.snapStrength ?? 0;
    const strength = Math.max(0, Math.min(1, strengthRaw / 100));
    const showBaselines = !!_gridAlignOptionsGetter()?.showBaselines;
    const { worldGridStep, screenGridSize } = computeGridSteps(zoomLevel.value);
    return { strength, showBaselines, gridSizeWorld: worldGridStep, gridSizeScreen: screenGridSize };
  };

  const applySoftGridSnap = (point, prevRawPoint = null) => {
    if (getActiveFeature() !== 'gridAlign') {
      snapIndicator.value = null;
      return point;
    }

    const { strength, showBaselines, gridSizeWorld, gridSizeScreen } = getSnapSettings();
    if (strength <= 0 || !gridSizeWorld) {
      snapIndicator.value = null;
      return point;
    }

    const snapRadiusPx = 2 + strength * gridSizeScreen * 0.8;
    const snapRadiusWorld = snapRadiusPx / zoomLevel.value;

    const gx = Math.round(point.x / gridSizeWorld) * gridSizeWorld;
    const gy = Math.round(point.y / gridSizeWorld) * gridSizeWorld;

    const dx = showBaselines ? 0 : gx - point.x;
    const dy = gy - point.y;
    const dist = showBaselines ? Math.abs(dy) : Math.hypot(dx, dy);

    if (dist < snapRadiusWorld && dist > 0.0001) {
      const proximity = 1 - dist / snapRadiusWorld;
      let alpha = proximity * strength;

      if (prevRawPoint && typeof prevRawPoint.t === 'number') {
        const dt = Math.max(1, point.t - prevRawPoint.t);
        const v = Math.hypot(point.x - prevRawPoint.x, point.y - prevRawPoint.y) / dt;
        const speedFactor = 1 / (1 + v * 0.02);
        alpha *= speedFactor;
      }

      const snappedX = showBaselines ? point.x : point.x + alpha * dx;
      const snappedY = point.y + alpha * dy;
      snapIndicator.value = {
        x: showBaselines ? point.x : gx,
        y: gy,
        axis: showBaselines ? 'y' : 'both',
        radius: snapRadiusWorld,
      };
      return { ...point, x: snappedX, y: snappedY };
    }

    snapIndicator.value = null;
    return point;
  };

  const applyGridSnapHard = (point, gridSize, axisMode = 'both') => {
    if (!point || !gridSize) return point;
    const x = point.x ?? point[0];
    const y = point.y ?? point[1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return point;
    const snappedX = axisMode === 'y' ? x : Math.round(x / gridSize) * gridSize;
    const snappedY = Math.round(y / gridSize) * gridSize;
    if (Array.isArray(point)) {
      return [snappedX, snappedY, point[2]];
    }
    return { ...point, x: snappedX, y: snappedY };
  };

  // --- Cancel Active Drawing ---

  const cancelActiveDrawing = () => {
    if (!isDrawing.value && !currentElementPreview.value) return false;
    isDrawing.value = false;
    currentElementPreview.value = null;
    pointsBuffer.value = [];
    snapIndicator.value = null;
    redrawCanvas(false);
    return true;
  };

  // --- Start Drawing ---

  const startDrawingAt = (transformedCoords, inputTime, extras = {}) => {
    if (!ydoc.value) return;
    if (currentTool.value === 'select') return;
    const graphTools = ['mathPlot', 'physicsPlot', 'coordSystem2D', 'coordSystem3D'];
    if (graphTools.includes(currentTool.value)) return;

    // Handle text tool inline
    if (currentTool.value === 'text') {
      startInlineText(transformedCoords);
      isDrawing.value = false;
      currentElementPreview.value = null;
      return;
    }

    isDrawing.value = true;
    pointsBuffer.value = [];

    let toolType = currentTool.value;
    let elementData = {};
    let lineWidthForElement = currentLineWidth.value;
    let colorForElement = currentColor.value;

    // Handle Shift+Pen
    if (toolType === 'pen' && shiftPressedAtStart.value) {
      if (debugModeEnabled.value) {
        debugLog?.('[startDrawing] Shift+Pen detected, storing start point.');
      }
      startCoordsForShiftLine.value = transformedCoords;
    } else if (toolType === 'shapes') {
      toolType = getCurrentShape();
      if (debugModeEnabled.value) {
        debugLog?.(`[startDrawing] Starting shape drawing with type: ${toolType}`);
      }
    } else if (toolType === 'lines') {
      toolType = 'line';
    }

    if (toolType === 'pen') {
      elementData.penStyle = activePenPresetKey.value;
      elementData.penConfig = { ...activePenPreset.value };
      lineWidthForElement = computePenWidthFromPreset(activePenPreset.value, currentLineWidth.value);
      const presetColor = activePenPreset.value?.color;
      const prefersPreset = !currentColor.value || ['#000000', '#000', 'black'].includes(String(currentColor.value).toLowerCase());
      colorForElement = prefersPreset ? (presetColor || currentColor.value || '#000000') : currentColor.value;
    }

    // Apply styles to all shapes and lines
    if (SHAPE_TOOLS.has(toolType) || toolType === 'line') {
      elementData.lineStyle = getCurrentLineStyle();
      elementData.roughness = getCurrentRoughness();
      const fillColor = getCurrentFillColor();
      if (fillColor) elementData.fillColor = fillColor;
      if (toolType === 'line') {
        elementData.arrowStyle = getCurrentArrowStyle();
      }
      if (debugModeEnabled.value) {
        debugLog?.(`[startDrawing] Style set: ${elementData.lineStyle}, Roughness: ${elementData.roughness}, Fill: ${elementData.fillColor}`);
      }
    }

    currentElementPreview.value = createNewElement(toolType, transformedCoords, colorForElement, lineWidthForElement, elementData);

    if (currentElementPreview.value) {
      const localClientId = yjsConnection.value?.awareness?.clientID || 'unknown';
      currentElementPreview.value.id = `temp_${localClientId}_${Date.now()}`;
      const startTime = typeof inputTime === 'number'
        ? inputTime
        : (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const pressure = typeof extras.pressure === 'number' && Number.isFinite(extras.pressure)
        ? extras.pressure
        : undefined;
      if (toolType === 'pen') {
        const stampedStart = { ...transformedCoords, t: startTime };
        if (pressure !== undefined) stampedStart.p = pressure;
        const snappedStart = applySoftGridSnap(stampedStart, null);
        currentElementPreview.value.rawPoints = [stampedStart];
        currentElementPreview.value.points = [{
          x: snappedStart.x,
          y: snappedStart.y,
          t: snappedStart.t ?? startTime,
          ...(pressure !== undefined ? { p: pressure } : {}),
        }];
        currentElementPreview.value.snappedPoints = currentElementPreview.value.points;
      } else if (SHAPE_TOOLS.has(toolType) || toolType === 'line') {
        const snappedStart = applySoftGridSnap({ ...transformedCoords, t: startTime }, null);
        currentElementPreview.value.start = { x: snappedStart.x, y: snappedStart.y };
      }
      if (debugModeEnabled.value) {
        debugLog?.('[startDrawing] Preview element created:', JSON.stringify(currentElementPreview.value));
      }
    } else {
      isDrawing.value = false;
      return;
    }
  };

  const startDrawing = (event, getCoordinates, transformCoordinates) => {
    if (!ydoc.value) return;
    const coords = getCoordinates(event);
    const transformedCoords = transformCoordinates(coords.offsetX, coords.offsetY);
    startDrawingAt(transformedCoords, event.timeStamp, {
      pressure: typeof event.pressure === 'number' ? event.pressure : undefined,
    });
  };

  // --- Draw (continuous) ---

  const draw = (coords, isShiftPressed, inputTime) => {
    if (!isDrawing.value || !currentElementPreview.value) return;
    if (currentTool.value === 'eraser') return;

    const preview = currentElementPreview.value;
    const resolvedTool = currentTool.value === 'shapes'
      ? getCurrentShape()
      : currentTool.value === 'lines'
        ? 'line'
        : currentTool.value;
    const previewType = preview.type || resolvedTool;
    const timestamp = typeof inputTime === 'number'
      ? inputTime
      : (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const stampedCoords = { ...coords, t: timestamp };
    if (typeof coords.p === 'number' && Number.isFinite(coords.p)) {
      stampedCoords.p = coords.p;
    }

    if (resolvedTool === 'pen') {
      if (shiftPressedAtStart.value && startCoordsForShiftLine.value) {
        preview.type = 'line';
        const baseStart = preview.rawPoints?.[0] || { ...startCoordsForShiftLine.value, t: timestamp };
        if (!preview.rawPoints) preview.rawPoints = [baseStart];
        const snappedStart = applySoftGridSnap(baseStart, null);
        // Angle snapping to nearest 45°
        const dx = stampedCoords.x - snappedStart.x;
        const dy = stampedCoords.y - snappedStart.y;
        const dist = Math.hypot(dx, dy);
        const ANGLE_STEP = Math.PI / 4;
        const angle = Math.atan2(dy, dx);
        const snappedAngle = Math.round(angle / ANGLE_STEP) * ANGLE_STEP;
        const angleSnappedEnd = {
          x: snappedStart.x + dist * Math.cos(snappedAngle),
          y: snappedStart.y + dist * Math.sin(snappedAngle),
        };
        preview.start = { x: snappedStart.x, y: snappedStart.y };
        preview.end = { x: angleSnappedEnd.x, y: angleSnappedEnd.y };
        delete preview.points;
      } else if (!shiftPressedAtStart.value) {
        preview.type = 'pen';
        if (!preview.points) preview.points = [];
        if (!preview.rawPoints) preview.rawPoints = [];
        const prevRaw = preview.rawPoints[preview.rawPoints.length - 1] || null;
        preview.rawPoints.push(stampedCoords);
        const smoothedPoint = addSmoothedPenPoint(stampedCoords);
        const snappedPoint = applySoftGridSnap(smoothedPoint, prevRaw);

        // Pipeline already resamples; keep only a sub-pixel collapse guard
        // so duplicate coalesced samples do not bloat the stroke.
        const MIN_DIST_SQ = 0.25;
        let shouldAdd = true;
        if (preview.points.length > 0) {
          const last = preview.points[preview.points.length - 1];
          const ddx = snappedPoint.x - last.x;
          const ddy = snappedPoint.y - last.y;
          if (ddx * ddx + ddy * ddy < MIN_DIST_SQ) shouldAdd = false;
        }
        if (shouldAdd) {
          preview.points.push({
            x: snappedPoint.x,
            y: snappedPoint.y,
            t: snappedPoint.t ?? smoothedPoint.t,
            ...(smoothedPoint.p !== undefined ? { p: smoothedPoint.p } : {}),
          });
          preview.snappedPoints = preview.points;
        }
      }
    } else if (SHAPE_TOOLS.has(previewType) || LINE_TOOLS.has(previewType)) {
      const snappedCoords = applySoftGridSnap(stampedCoords, preview.start ? { ...preview.start, t: timestamp } : null);
      preview.end = { x: snappedCoords.x, y: snappedCoords.y };

      // Angle snapping for lines when Shift is held
      if (preview.type === 'line' && isShiftPressed && preview.start) {
        const dx = snappedCoords.x - preview.start.x;
        const dy = snappedCoords.y - preview.start.y;
        const dist = Math.hypot(dx, dy);
        const ANGLE_STEP = Math.PI / 4;
        const angle = Math.atan2(dy, dx);
        const snappedAngle = Math.round(angle / ANGLE_STEP) * ANGLE_STEP;
        preview.end = {
          x: preview.start.x + dist * Math.cos(snappedAngle),
          y: preview.start.y + dist * Math.sin(snappedAngle),
        };
      }

      // Square aspect ratio constraint
      if (preview.type === 'square') {
        const dx = Math.abs(snappedCoords.x - preview.start.x);
        const dy = Math.abs(snappedCoords.y - preview.start.y);
        const size = Math.max(dx, dy);
        preview.end = {
          x: preview.start.x + size * Math.sign(snappedCoords.x - preview.start.x),
          y: preview.start.y + size * Math.sign(snappedCoords.y - preview.start.y),
        };
      }

      // Live binding snap for lines
      if (preview.type === 'line' && !isShiftPressed) {
        attachBindingsToLineDraft(preview);
      }
    }

    scheduleRedraw(false); // Dynamic only
  };

  // --- Finish Drawing ---

  // Ramer-Douglas-Peucker simplification
  const getSqSegDist = (p, p1, p2) => {
    let x = p1.x, y = p1.y, dx = p2.x - x, dy = p2.y - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = p2.x; y = p2.y; }
      else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = p.x - x; dy = p.y - y;
    return dx * dx + dy * dy;
  };

  const simplifyPoints = (points, epsilon) => {
    if (points.length <= 2) return points;
    const sqTolerance = epsilon * epsilon;
    let maxSqDist = 0;
    let index = 0;
    const end = points.length - 1;
    for (let i = 1; i < end; i++) {
      const sqDist = getSqSegDist(points[i], points[0], points[end]);
      if (sqDist > maxSqDist) { maxSqDist = sqDist; index = i; }
    }
    if (maxSqDist > sqTolerance) {
      const res1 = simplifyPoints(points.slice(0, index + 1), epsilon);
      const res2 = simplifyPoints(points.slice(index), epsilon);
      return [...res1.slice(0, res1.length - 1), ...res2];
    }
    return [points[0], points[end]];
  };

  const finishDrawing = () => {
    const wasShiftPressed = shiftPressedAtStart.value;
    const shiftStartPoint = startCoordsForShiftLine.value;
    const originalTool = currentTool.value;
    shiftPressedAtStart.value = false;
    startCoordsForShiftLine.value = null;
    snapIndicator.value = null;

    if (!isDrawing.value || !currentElementPreview.value || !ydoc.value || !yDrawings.value) {
      isDrawing.value = false;
      currentElementPreview.value = null;
      return;
    }

    isDrawing.value = false;

    let elementToAdd = null;
    const preview = currentElementPreview.value;

    const isValidElement = preview.start && preview.end && (preview.start.x !== preview.end.x || preview.start.y !== preview.end.y);
    // 1.5: Allow single-point pen strokes (dots) — ensure min 1 point even after throttling
    const isValidPen = preview.type === 'pen' && preview.points && preview.points.length >= 1 && !wasShiftPressed;
    // If pen has rawPoints but no points survived throttling, add the first rawPoint
    if (preview.type === 'pen' && !wasShiftPressed && preview.rawPoints?.length > 0 && (!preview.points || preview.points.length === 0)) {
      const firstRaw = preview.rawPoints[0];
      preview.points = [{ x: firstRaw.x, y: firstRaw.y, t: firstRaw.t }];
    }
    const isValidShiftPen = originalTool === 'pen' && wasShiftPressed && shiftStartPoint && preview.end && (shiftStartPoint.x !== preview.end.x || shiftStartPoint.y !== preview.end.y);

    if (isValidPen || (preview.type !== 'pen' && isValidElement) || isValidShiftPen) {
      if (wasShiftPressed && originalTool === 'pen' && isValidShiftPen) {
        if (debugModeEnabled.value) {
          debugLog?.('[finishDrawing] Shift held with Pen, creating Line element.');
        }
        elementToAdd = {
          type: 'line',
          start: preview.start || shiftStartPoint,
          end: preview.end,
          color: preview.color,
          lineWidth: preview.lineWidth,
          timestamp: Date.now(),
          lineStyle: 'solid',
          rawPoints: preview.rawPoints || [],
        };
      } else {
        elementToAdd = { ...preview };
        delete elementToAdd.id;

        // RDP simplification for pen strokes
        if (elementToAdd.type === 'pen' && elementToAdd.points && elementToAdd.points.length > 2) {
          elementToAdd.points = simplifyPoints(elementToAdd.points, 0.15);
        }

        // Ensure lineStyle for lines tool
        if (originalTool === 'lines' && elementToAdd.type === 'line') {
          const styleFromProps = getCurrentLineStyle() || 'solid';
          if (debugModeEnabled.value) {
            debugLog?.(`[finishDrawing] lineStyle setting from prop: ${styleFromProps}`);
          }
          elementToAdd.lineStyle = styleFromProps;
        }
      }

      if (elementToAdd && elementToAdd.type !== 'text' && elementToAdd.type !== 'image') {
        if (elementToAdd.type === 'line') {
          attachBindingsToLineDraft(elementToAdd);
        }

        // Canonical scene object (VVE-104): one geometry per family. Shapes
        // store x/y/width/height (never start/end), lines store plain
        // start/end points, pens store absolute points with derived bounds.
        const shapeOrLine = SHAPE_TOOLS.has(elementToAdd.type) || elementToAdd.type === 'line';
        const object = {
          id: `${yjsConnection.value?.awareness?.clientID || 'local'}-${Date.now()}`,
          type: elementToAdd.type,
          color: elementToAdd.color,
          lineWidth: elementToAdd.lineWidth,
          timestamp: Date.now(),
          rotation: 0,
        };
        const resolvedLineStyle = elementToAdd.lineStyle ?? (shapeOrLine ? getCurrentLineStyle() || 'solid' : undefined);
        const resolvedRoughness = elementToAdd.roughness ?? (shapeOrLine ? getCurrentRoughness() ?? 1 : undefined);
        const resolvedFillColor = elementToAdd.fillColor ?? (shapeOrLine ? getCurrentFillColor() : undefined);
        if (resolvedLineStyle != null) object.lineStyle = resolvedLineStyle;
        if (resolvedRoughness != null) object.roughness = resolvedRoughness;
        if (resolvedFillColor != null) object.fillColor = resolvedFillColor;

        if (elementToAdd.type === 'pen') {
          if (elementToAdd.penStyle) object.penStyle = elementToAdd.penStyle;
          if (elementToAdd.penConfig) {
            object.penConfig = Object.fromEntries(
              Object.entries(elementToAdd.penConfig).filter(
                ([, val]) => val !== undefined && val !== null && typeof val !== 'function'
              )
            );
          }
          object.points = elementToAdd.points;
          if (elementToAdd.rawPoints) object.rawPoints = elementToAdd.rawPoints;
        } else if (elementToAdd.type === 'line') {
          object.start = { x: elementToAdd.start.x, y: elementToAdd.start.y };
          object.end = { x: elementToAdd.end.x, y: elementToAdd.end.y };
          object.arrowStyle = elementToAdd.arrowStyle || getCurrentArrowStyle() || 'none';
          if (elementToAdd.startBinding) object.startBinding = elementToAdd.startBinding;
          if (elementToAdd.endBinding) object.endBinding = elementToAdd.endBinding;
        } else if (elementToAdd.start && elementToAdd.end) {
          object.x = Math.min(elementToAdd.start.x, elementToAdd.end.x);
          object.y = Math.min(elementToAdd.start.y, elementToAdd.end.y);
          object.width = Math.abs(elementToAdd.start.x - elementToAdd.end.x);
          object.height = Math.abs(elementToAdd.start.y - elementToAdd.end.y);
        }

        if (debugModeEnabled.value) {
          debugLog?.('[finishDrawing] Canonical object for session.execute:', JSON.stringify(object));
        }

        const result = session.value?.execute({ kind: 'add', object });
        if (result?.ok) {
          refreshMovableElements();

          // Notify helper modules
          if (getActiveFeature()) {
            const module = getActiveModule();
            if (module && module.addStroke) {
              module.addStroke({ ...elementToAdd, id: object.id });
              if (getActiveFeature() === 'styleHandwriting') {
                emit('update:has-char-groups', false);
                emit('update:has-stylized-strokes', false);
              }
            }
          }

          nextTick(() => updateGlobalState());
        } else if (result) {
          debugWarn?.('[finishDrawing] Session rejected element:', result.message);
          showToast?.(result.message, 'error');
        }
      }
    } else {
      if (debugModeEnabled.value) {
        debugLog?.('Drawing finished but element was too small or invalid, not adding.');
      }
    }

    currentElementPreview.value = null;
    pointsBuffer.value = [];
    redrawCanvas();
  };

  // --- Eraser ---

  const eraseElement = (indexOrId) => {
    if (!yDrawings.value || !session.value) return;

    let elementId = null;
    if (typeof indexOrId === 'string') {
      elementId = indexOrId;
    } else if (typeof indexOrId === 'number' && indexOrId >= 0 && indexOrId < yDrawings.value.length) {
      elementId = yDrawings.value.get(indexOrId)?.get('id') ?? null;
    }

    if (elementId) {
      debugLog?.(`[eraseElement] Removing element: ${elementId}`);
      const result = session.value.execute({ kind: 'delete', ids: [elementId] });
      if (result.ok) {
        refreshMovableElements();
        nextTick(() => updateGlobalState());
      } else {
        debugWarn?.(`[eraseElement] Session rejected delete: ${result.message}`);
      }
    } else {
      debugWarn?.(`[eraseElement] Element not found for index/ID: ${indexOrId}`);
    }
  };

  return {
    // State
    currentElementPreview,
    pointsBuffer,
    snapIndicator,
    shiftPressedAtStart,
    startCoordsForShiftLine,
    activePenPresetKey,
    activePenPreset,
    // Constants
    SHAPE_TOOLS,
    LINE_TOOLS,
    // Methods
    addSmoothedPenPoint,
    computePenWidthFromPreset,
    applySoftGridSnap,
    applyGridSnapHard,
    cancelActiveDrawing,
    startDrawing,
    startDrawingAt,
    draw,
    finishDrawing,
    eraseElement,
    setGridAlignOptionsGetter,
  };
}
