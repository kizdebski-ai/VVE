import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const readSrc = (relativePath) =>
  readFileSync(resolve(__dirname, '../../src', relativePath), 'utf-8');

const readServer = (relativePath) =>
  readFileSync(resolve(__dirname, '../../../server/src', relativePath), 'utf-8');

// ─── C1: Composable wiring — useDrawingEngine & useHelperModules ─────────────

describe('C1: Composable wiring in WhiteboardCanvas', () => {
  const src = readSrc('components/WhiteboardCanvas.vue');

  it('calls useHelperModules() (not just import)', () => {
    expect(src).toContain('} = useHelperModules({');
  });

  it('calls useDrawingEngine() (not just import)', () => {
    expect(src).toContain('} = useDrawingEngine({');
  });

  it('destructures critical functions from useDrawingEngine', () => {
    expect(src).toMatch(/const\s*\{[^}]*startDrawing[^}]*\}\s*=\s*useDrawingEngine/s);
    expect(src).toMatch(/const\s*\{[^}]*finishDrawing[^}]*\}\s*=\s*useDrawingEngine/s);
    expect(src).toMatch(/const\s*\{[^}]*draw[,\s][^}]*\}\s*=\s*useDrawingEngine/s);
    expect(src).toMatch(/const\s*\{[^}]*eraseElement[^}]*\}\s*=\s*useDrawingEngine/s);
  });

  it('destructures critical functions from useHelperModules', () => {
    expect(src).toMatch(/const\s*\{[^}]*getActiveModule[^}]*\}\s*=\s*useHelperModules/s);
    expect(src).toMatch(/const\s*\{[^}]*syncModulesWithYjs[^}]*\}\s*=\s*useHelperModules/s);
    expect(src).toMatch(/const\s*\{[^}]*renderLatex[^}]*\}\s*=\s*useHelperModules/s);
    expect(src).toMatch(/const\s*\{[^}]*applyMathAnswer[^}]*\}\s*=\s*useHelperModules/s);
  });

  it('passes getCoordinates and transformCoordinates to startDrawing', () => {
    expect(src).toContain('startDrawing(event, getCoordinates, transformCoordinates)');
  });

  it('useKeyboardShortcuts uses real cancelActiveDrawing (not inline stub)', () => {
    // Should NOT have the old inline stub
    expect(src).not.toMatch(/cancelActiveDrawing:\s*\(\)\s*=>\s*\{/);
  });

  it('useKeyboardShortcuts uses real applyMathAnswer (not empty function)', () => {
    // Should NOT have the old empty stub
    expect(src).not.toMatch(/applyMathAnswer:\s*\(\)\s*=>\s*\{\s*\}/);
  });
});

// ─── C2: Path traversal fix ─────────────────────────────────────────────────

describe('C2: Path traversal prevention in analyze-pdf', () => {
  it('httpApp.ts validates resolved path stays within uploads dir', () => {
    const src = readServer('httpApp.ts');
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

// ─── H6: Timing-safe admin secret comparison ────────────────────────────────

describe('H6: Timing-safe admin secret comparison', () => {
  it('httpApp.ts uses timingSafeEqual for admin secret', () => {
    const src = readServer('httpApp.ts');
    expect(src).toContain('timingSafeEqual');
    expect(src).toContain('timingSafeCompare');
    // Should NOT use direct !== for admin secret
    expect(src).not.toMatch(/provided\s*!==\s*expectedSecret/);
  });
});

// ─── H9: redo must call updateGlobalState ────────────────────────────────────

describe('H9: redo calls updateGlobalState', () => {
  it('useUndoRedo redo function calls updateGlobalState', () => {
    const src = readSrc('composables/useUndoRedo.js');
    // Both undo and redo should call updateGlobalState
    const undoMatch = src.match(/const undo[\s\S]*?updateGlobalState/);
    const redoMatch = src.match(/const redo[\s\S]*?updateGlobalState/);
    expect(undoMatch).not.toBeNull();
    expect(redoMatch).not.toBeNull();
  });
});
