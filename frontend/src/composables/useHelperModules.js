/**
 * useHelperModules - AI / helper module integration extracted from WhiteboardCanvas.
 *
 * Contains: getActiveModule, syncModulesWithYjs, alignToGrid, groupStrokes,
 * applyStyleTransformation, confirmStyleChanges, cancelStyleChanges,
 * recognizeEquation, applyMathAnswer, renderLatex.
 */
import katex from 'katex';
import { computeGridSteps } from '../utils/canvasGrid.js';

export function useHelperModules({
  gridAlignModule,
  handwritingStylerModule,
  mathRecognizerModule,
  ydoc,
  yDrawings,
  yjsConnection,
  zoomLevel,
  session,
  updateGlobalState,
  redrawCanvas,
  refreshMovableElements,
  getActiveFeature,
  getGridAlignOptions,
  emit,
  debugLog,
  debugWarn,
  showToast,
}) {

  // 6.5: Simple mutex/queue to serialize AI transactions
  let aiOperationQueue = Promise.resolve();
  const withAiMutex = (fn) => {
    const op = aiOperationQueue.then(fn, fn).catch((err) => {
      console.warn('[useHelperModules] AI operation failed:', err);
    });
    aiOperationQueue = op;
    return op;
  };

  // --- Module Access ---

  const getActiveModule = (featureOverride) => {
    const feature = featureOverride ?? getActiveFeature();
    switch (feature) {
      case 'gridAlign': return gridAlignModule.value;
      case 'styleHandwriting': return handwritingStylerModule.value;
      case 'mathRecognizer': return mathRecognizerModule.value;
      default: return null;
    }
  };

  const syncModulesWithYjs = () => {
    if (!yDrawings.value) return;
    const currentStrokes = yDrawings.value.toArray().map(m => ({ id: m.get('id'), ...m.toJSON() }));
    if (gridAlignModule.value?.enabled) gridAlignModule.value.setStrokes(currentStrokes);
    if (handwritingStylerModule.value?.enabled) handwritingStylerModule.value.setStrokes(currentStrokes);
    if (mathRecognizerModule.value?.enabled) mathRecognizerModule.value.setStrokes(currentStrokes);
  };

  // --- LaTeX Rendering ---

  const renderLatex = (latexString) => {
    const targetElement = document.getElementById('latex-render-output');
    if (targetElement) {
      try {
        katex.render(latexString || '', targetElement, {
          throwOnError: false,
          displayMode: false,
        });
      } catch (error) {
        console.error('Error rendering LaTeX:', error);
        targetElement.textContent = `Error: ${error.message}`;
      }
    } else {
      debugWarn?.('LaTeX render target element #latex-render-output not found.');
    }
  };

  // --- Math Answer ---

  const applyMathAnswer = (newStrokeData) => {
    if (!newStrokeData || !session.value) return;
    return withAiMutex(() => {
      const object = { ...newStrokeData };
      if (!object.id) object.id = session.value.newObjectId();
      const result = session.value.execute({ kind: 'add', object });
      if (!result.ok) {
        debugWarn?.('[applyMathAnswer] Session rejected stroke:', result.message);
        showToast?.(result.message, 'error');
        return;
      }
      import('vue').then(({ nextTick }) => {
        nextTick(() => {
          updateGlobalState();
          emit('update:recognition-status', '');
          emit('update:latex-equation', '');
          emit('update:solution', '');
          redrawCanvas(true);
        });
      });
    }); // end withAiMutex
  };

  // --- Align To Grid ---

  const alignToGrid = () => {
    if (!ydoc.value || !yDrawings.value) {
      debugWarn?.('[alignToGrid] Yjs not ready.');
      return;
    }
    return withAiMutex(() => {
    const { worldGridStep } = computeGridSteps(zoomLevel.value);
    if (!worldGridStep || Number.isNaN(worldGridStep)) {
      debugWarn?.('[alignToGrid] Invalid grid size');
      return;
    }
    const gridAlignOptions = getGridAlignOptions();
    const axisMode = gridAlignOptions.showBaselines ? 'y' : 'both';

    const wrapMod = (v, size) => {
      const r = v % size;
      return Number.isFinite(r) ? (r + size) % size : 0;
    };
    const nearestGridShift = (meanR, size) => {
      const option1 = -meanR;
      const option2 = size - meanR;
      return Math.abs(option1) <= Math.abs(option2) ? option1 : option2;
    };

    let sumRx = 0;
    let sumRy = 0;
    let count = 0;

    const accumulatePoint = (x, y) => {
      if (Number.isFinite(x) && axisMode !== 'y') {
        sumRx += wrapMod(x, worldGridStep);
      }
      if (Number.isFinite(y)) {
        sumRy += wrapMod(y, worldGridStep);
      }
      count++;
    };

    // Pass 1: measure mean residuals
    yDrawings.value.forEach((yMap) => {
      const type = yMap.get('type');
      if (type === 'pen') {
        const pts = yMap.get('points');
        if (Array.isArray(pts)) {
          pts.forEach((p) => {
            const px = typeof p.x === 'number' ? p.x : Array.isArray(p) ? p[0] : null;
            const py = typeof p.y === 'number' ? p.y : Array.isArray(p) ? p[1] : null;
            accumulatePoint(px, py);
          });
        }
      } else if (type === 'line' || (yMap.get('start') && yMap.get('end'))) {
        const readPoint = (value) =>
          value?.get ? { x: value.get('x'), y: value.get('y') } : value;
        const start = readPoint(yMap.get('start'));
        const end = readPoint(yMap.get('end'));
        if (start && end) {
          accumulatePoint(start.x, start.y);
          accumulatePoint(end.x, end.y);
        }
      } else {
        const px = yMap.get('x');
        const py = yMap.get('y');
        if (Number.isFinite(px) || Number.isFinite(py)) {
          accumulatePoint(px, py);
        }
      }
    });

    if (!count) {
      debugLog?.('[alignToGrid] No points to align.');
      return;
    }

    const meanRx = axisMode === 'y' ? 0 : sumRx / count;
    const meanRy = sumRy / count;
    const shiftX = axisMode === 'y' ? 0 : nearestGridShift(meanRx, worldGridStep);
    const shiftY = nearestGridShift(meanRy, worldGridStep);

    // Pass 2: apply the uniform shift through the session command layer —
    // one translateObjects command, one undo entry, bindings kept attached.
    const changedIds = yDrawings.value
      .toArray()
      .map((yMap) => yMap.get('id'))
      .filter((id) => typeof id === 'string' && id.length > 0);

    if (changedIds.length && session.value && (shiftX !== 0 || shiftY !== 0)) {
      const result = session.value.execute({
        kind: 'translateObjects',
        ids: changedIds,
        dx: shiftX,
        dy: shiftY,
      });
      if (!result.ok) {
        debugWarn?.('[alignToGrid] Session rejected translation:', result.message);
        showToast?.(result.message, 'error');
        return;
      }
    }

    if (changedIds.length) {
      import('vue').then(({ nextTick }) => {
        nextTick(() => {
          debugLog?.(`[alignToGrid] Shifted ${changedIds.length} elements by (${shiftX.toFixed(2)}, ${shiftY.toFixed(2)}).`);
          updateGlobalState();
          syncModulesWithYjs();
          redrawCanvas();
        });
      });
    } else {
      debugLog?.('[alignToGrid] No elements needed snapping.');
      redrawCanvas();
    }
    }); // end withAiMutex
  };

  // --- Handwriting Styler Actions ---

  const groupStrokes = () => {
    if (!handwritingStylerModule.value) return;
    handwritingStylerModule.value.groupStrokes();
    emit('update:has-char-groups', handwritingStylerModule.value.hasCharGroups());
    emit('update:has-stylized-strokes', false);
    redrawCanvas();
  };

  const applyStyleTransformation = () => {
    if (!handwritingStylerModule.value) return;
    handwritingStylerModule.value.applyStyleTransformation();
    emit('update:has-stylized-strokes', handwritingStylerModule.value.hasStylizedStrokes());
    redrawCanvas();
  };

  const confirmStyleChanges = () => {
    if (!handwritingStylerModule.value || !ydoc.value || !yDrawings.value) {
      debugWarn?.('[confirmStyleChanges] Module or Yjs not ready.');
      return;
    }
    return withAiMutex(() => {
    debugLog?.('[confirmStyleChanges] Calling module.confirmStyleChanges()');
    const updatedStrokes = handwritingStylerModule.value.confirmStyleChanges();

    if (updatedStrokes && updatedStrokes.length > 0) {
      debugLog?.(`[confirmStyleChanges] Module returned ${updatedStrokes.length} updated strokes. Applying through session...`);
      const existingIds = new Set(yDrawings.value.toArray().map((yMap) => yMap.get('id')));
      for (const updatedStroke of updatedStrokes) {
        if (!existingIds.has(updatedStroke.id)) continue;
        const result = session.value?.execute({
          kind: 'setPenPoints',
          id: updatedStroke.id,
          points: updatedStroke.points,
        });
        if (result && !result.ok) {
          debugWarn?.(`[confirmStyleChanges] Session rejected stroke ${updatedStroke.id}: ${result.message}`);
        }
      }

      import('vue').then(({ nextTick }) => {
        nextTick(() => {
          debugLog?.('[confirmStyleChanges] Yjs transaction complete. Updating global state and redrawing.');
          updateGlobalState();
          emit('update:has-stylized-strokes', false);
          emit('update:has-char-groups', false);
          redrawCanvas();
        });
      });
    } else {
      debugLog?.('[confirmStyleChanges] Module returned no updated strokes. Resetting state.');
      emit('update:has-stylized-strokes', false);
      emit('update:has-char-groups', false);
      redrawCanvas();
    }
    }); // end withAiMutex
  };

  const cancelStyleChanges = () => {
    if (!handwritingStylerModule.value) return;
    handwritingStylerModule.value.cancelStyleChanges();
    emit('update:has-stylized-strokes', false);
    redrawCanvas();
  };

  // --- Math Recognizer ---

  const recognizeEquation = async () => {
    if (!mathRecognizerModule.value) return;
    emit('update:recognition-status', 'Recognizing...');
    emit('update:latex-equation', '');
    emit('update:solution', '');
    try {
      const result = await mathRecognizerModule.value.recognizeEquation();
      emit('update:recognition-status', mathRecognizerModule.value.getRecognitionStatus());
      if (result) {
        emit('update:solution', result.solution || '');
      }
    } catch (error) {
      emit('update:recognition-status', `Error: ${error.message}`);
    } finally {
      redrawCanvas();
    }
  };

  return {
    getActiveModule,
    syncModulesWithYjs,
    renderLatex,
    applyMathAnswer,
    alignToGrid,
    groupStrokes,
    applyStyleTransformation,
    confirmStyleChanges,
    cancelStyleChanges,
    recognizeEquation,
  };
}
