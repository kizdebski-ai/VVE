import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ref } from 'vue';
import * as Y from 'yjs';
import { useDrawingEngine } from '../../src/composables/useDrawingEngine.js';
import { createInputPipeline } from '../../src/board/inputPipeline';
import { mapGovernorDenialToSocketClose } from '@pilot/resourceGovernor';

const readSrc = (relativePath) =>
  readFileSync(resolve(__dirname, '../../src', relativePath), 'utf-8');

const readServer = (relativePath) =>
  readFileSync(resolve(__dirname, '../../../server/src', relativePath), 'utf-8');

// ─── C1: Composable behavior at executable seams ────────────────────────────

describe('C1: Composable behavior', () => {
  it('useDrawingEngine creates and cancels in-progress stroke preview via startDrawingAt and cancelActiveDrawing', () => {
    const ydoc = new Y.Doc();
    const isDrawing = ref(false);
    const engine = useDrawingEngine({
      isDrawing,
      currentTool: ref('pen'),
      currentColor: ref('#000000'),
      currentLineWidth: ref(2),
      zoomLevel: ref(1),
      panOffset: ref({ x: 0, y: 0 }),
      ydoc: ref(ydoc),
      yDrawings: ref(ydoc.getArray('drawings')),
      yjsConnection: ref(null),
    });

    engine.startDrawingAt({ x: 10, y: 20 }, 100, { pressure: 0.75, tiltX: 12, tiltY: -8 });
    expect(isDrawing.value).toBe(true);
    expect(engine.currentElementPreview.value).toBeTruthy();
    expect(engine.currentElementPreview.value.type).toBe('pen');
    expect(engine.currentElementPreview.value.points[0]).toMatchObject({
      x: 10,
      y: 20,
      p: 0.75,
      tiltX: 12,
      tiltY: -8
    });

    engine.cancelActiveDrawing();
    expect(isDrawing.value).toBe(false);
    expect(engine.currentElementPreview.value).toBeNull();
  });

  it('InputPipeline cancel emits drawCancel intent on gesture and blur', () => {
    const pipeline = createInputPipeline({
      profile: 'pen',
      onProfileChange: () => {},
      onPointerTypeObserved: () => {}
    });

    pipeline.ingest({
      samples: [{
        pointerId: 1,
        pointerType: 'pen',
        isPrimary: true,
        buttons: 1,
        pressure: 0.5,
        clientX: 100,
        clientY: 100,
        timeStamp: 10
      }],
      phase: 'down',
      viewport: { zoom: 1, panX: 0, panY: 0, canvasLeft: 0, canvasTop: 0 }
    });

    const cancelGestureResult = pipeline.cancel('gesture');
    expect(cancelGestureResult.intents).toContainEqual(expect.objectContaining({
      kind: 'drawCancel',
      reason: 'gesture'
    }));

    pipeline.ingest({
      samples: [{
        pointerId: 2,
        pointerType: 'pen',
        isPrimary: true,
        buttons: 1,
        pressure: 0.5,
        clientX: 100,
        clientY: 100,
        timeStamp: 20
      }],
      phase: 'down',
      viewport: { zoom: 1, panX: 0, panY: 0, canvasLeft: 0, canvasTop: 0 }
    });

    const cancelBlurResult = pipeline.cancel('blur');
    expect(cancelBlurResult.intents).toContainEqual(expect.objectContaining({
      kind: 'drawCancel',
      reason: 'blur'
    }));
  });

});

// ─── C2: Path traversal fix ─────────────────────────────────────────────────

describe('C2: Path traversal prevention in analyze-pdf', () => {
  it('aiRoutes.ts validates resolved path stays within uploads dir', () => {
    // The analyze-pdf handler moved out of httpApp.ts into the AI router.
    const src = readServer('routes/aiRoutes.ts');
    expect(src).toContain('path.resolve(filePath)');
    expect(src).toContain('path.resolve(uploadsDir)');
    expect(src).toContain('resolvedPath.startsWith(');
  });
});

// ─── C4: roundRect fallback ─────────────────────────────────────────────────

describe('C4: roundRect browser compatibility', () => {
  it('MathRecognizerModule uses roundRect with fallback', () => {
    const src = readSrc('modules/MathRecognizerModule.js');
    expect(src).toContain("typeof ctx.roundRect === 'function'");
    expect(src).toContain('ctx.arcTo(');
  });
});

// ─── H6: Timing-safe credential comparison (VVE-101) ────────────────────────

describe('H6: Timing-safe credential comparison', () => {
  it('CapabilityAccess compares credentials in constant time', () => {
    // VVE-101 moved every credential comparison behind CapabilityAccess;
    // the constant-time compare lives there now, not in route files.
    const src = readServer('pilot/capabilityAccess.ts');
    expect(src).toContain('timingSafeEqual');
    expect(src).toContain('const safeEqual');
    expect(src).toContain('safeEqual(passphrase, config.adminPassphrase)');
  });

  it('httpApp.ts no longer reads a raw admin secret from headers or query', () => {
    const src = readServer('httpApp.ts');
    expect(src).not.toContain('x-admin-secret');
    expect(src).not.toContain('adminSecret');
    expect(src).not.toContain('readAdminSecret');
  });
});

// H9 moved with VVE-104 into the participant-scoped WhiteboardSession.
// Executable undo/redo and history-notification behavior is covered in
// whiteboardSession.spec.ts; retaining a source-text assertion here would pin
// the deleted, unsafe composable back into the architecture.

// ─── C3: XSS prevention in MovableObject.vue ─────────────────────────────────

describe('C3: XSS prevention in MovableObject LaTeX rendering', () => {
  const src = readSrc('components/MovableObject.vue');

  it('imports DOMPurify', () => {
    expect(src).toContain("import DOMPurify from 'dompurify'");
  });

  it('sanitizes katex renderToString output', () => {
    expect(src).toContain('DOMPurify.sanitize(katex.renderToString(');
  });

  it('sanitizes error message latexCode to prevent XSS', () => {
    expect(src).toContain('DOMPurify.sanitize(latexCode)');
  });

  it('does not use unsanitized latexCode in error HTML', () => {
    // Ensure we don't have raw latexCode interpolated in template literal after "LaTeX Error:"
    expect(src).not.toMatch(/LaTeX Error: \$\{latexCode\}/);
  });
});

// ─── H3: withAiMutex unhandled rejection prevention ──────────────────────────

describe('H3: withAiMutex handles rejected promises', () => {
  const src = readSrc('composables/useHelperModules.js');

  it('withAiMutex has .catch() handler', () => {
    expect(src).toContain('.catch((err)');
  });

  it('withAiMutex logs warning on failure', () => {
    expect(src).toContain('[useHelperModules] AI operation failed:');
  });
});

// ─── H8: Per-IP WebSocket connection limiting ────────────────────────────────

describe('H8: ResourceGovernor owns WebSocket occupancy', () => {
  const src = readServer('server.ts');

  it('constructs ResourceGovernor and passes it to collaboration', () => {
    expect(src).toContain('createResourceGovernor');
    expect(src).toContain('resourceGovernor');
  });

  it('maps connection overload to a bounded Polish connection close', () => {
    const mapping = mapGovernorDenialToSocketClose({
      decision: 'reject',
      reason: 'ipConnectionLimit',
      messageKey: 'resource.connectionLimit'
    });
    expect(mapping.code).toBe(1013);
    expect(mapping.reason).toContain('Zbyt wiele połączeń');
  });
});

describe('H8b: realtime listener composition reads the shared governor', () => {
  const src = readServer('pilot/realtimeListener.ts');

  // 108-I1: the per-IP cap is owned by ResourceGovernor (VVE-107 policy,
  // composed by RuntimeControl). The listener reads the limit through
  // governor.limits() instead of declaring a hardcoded product constant.
  it('derives the per-IP cap from the shared ResourceGovernor, not a hardcoded constant', () => {
    expect(src).toContain('governor.limits().maxConnectionsPerIp');
    expect(src).not.toMatch(/MAX_CONNECTIONS_PER_IP\s*=\s*\d+/);
  });

  it('implements trackIpConnect and trackIpDisconnect', () => {
    expect(src).toContain('trackIpConnect');
    expect(src).toContain('trackIpDisconnect');
  });

  it('denies over-limit connections with the typed Polish resource message', () => {
    expect(src).toContain("polishResourceMessage('resource.connectionLimit')");
  });
});

// ─── Canvas memory cleanup in PDF export ─────────────────────────────────────

describe('Canvas memory cleanup in ArtifactPipeline export', () => {
  const src = readSrc('board/artifactPipeline.ts');

  it('resets offscreen canvas dimensions to release memory', () => {
    expect(src).toContain('canvas.width = 0');
    expect(src).toContain('canvas.height = 0');
  });
});

// ─── C5: Default secrets warning ─────────────────────────────────────────────

describe('C5: Default secrets development warning', () => {
  const src = readServer('config.ts');

  it('warns about default teacherSessionSecret in dev mode', () => {
    expect(src).toContain("'change-me-in-prod'");
    expect(src).toContain('WARNING: Using default teacherSessionSecret');
  });

  it('fails fast in production when defaults are used', () => {
    expect(src).toContain("config.nodeEnv === 'production'");
    expect(src).toContain('still using default fallback');
  });
});
