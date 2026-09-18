---
id: VVE-106
title: Math, physics, and object tool completion
status: open
labels:
  - ready-for-agent
  - "implementation:ticket"
parent: VVE-001
blocked_by: [VVE-104]
architecture_slice: S6
---

# Math, physics, and object tool completion

## Outcome

Every remaining visible lesson tool completes its Polish collaborative workflow through canonical board commands.

## Context pointer

Implement section `S6 - Math/Physics and Object Tool Completion` in [VVE Deep Module Design](../../../architecture/VVE-DEEP-MODULE-DESIGN.md). Use `neumorphic-design` for panels and controls. Use `motion` when changed state transitions or direct manipulation include motion.

## Resolution evidence

Return a visible-tool inventory with pass evidence for create, transform, synchronize, persist, reload, export, undo, focus, shortcuts, panel exclusivity, and viewport clamping. Include proof that hidden experiments stay absent and the focused commit.

## Resolution

### Delivered outcome

Every Pilot-visible lesson tool now completes its Polish workflow through the
canonical `BoardDocument` command path:

| Visible tool | Delivered evidence |
| --- | --- |
| Calculator | Polish scientific calculation and error feedback; `Shift+K`, focus, Escape close, exclusive/clamped panel |
| Mathematical graph | canonical `mathFunctionPlot`; validated expression/range; create, move, participant-local undo/redo, synchronization, reload and PDF export |
| Physical graph | canonical `physicsDataPlot.points`; validated rows/axis labels; synchronization, transform-safe data, reload and PDF export |
| Coordinate systems | canonical 2D/3D objects with bounded geometry, labels and grid defaults; collaboration, transforms, reload and export |
| Shapes | every visible 2D/3D shape uses canonical `x/y/width/height`; solid/dashed/dotted, roughness, stroke and fill styles pass the command Seam |
| Lines | canonical endpoints and bindings; solid/dashed/dotted and none/start/end/both arrow styles pass create, transform, undo and export |

The calculator, graph panels and coordinate popover are mutually reachable;
the three lesson panels are exclusive. Panels clamp to the visual viewport,
focus their first control, close with Escape, remain topmost above touch
controls, and are reachable at desktop and iPad portrait sizes. AI, Chemistry
and Grid Align remain absent from the Pilot manifest and DOM.

### Owned and consumed Interfaces

- `BoardDocument` owns canonical lesson-object normalization, validation,
  mutation and participant-local undo (the hydration migration Interface was
  removed with the dual-read cleanup; see Migration and cleanup).
- `BoardScene` owns the bounded schemas for `coordinateSystem2D`,
  `coordinateSystem3D`, `mathFunctionPlot` and `physicsDataPlot`, the shared
  `LESSON_OBJECT_DEFAULTS` and the type-aware `canonicalObjectBounds` export
  consumed by VVE-105 hit-testing and VVE-107 export bounds. Callers use
  `normalizeBoardObject`, `validateBoardObject` and typed `BoardCommand`
  execution; plot data points are not mistaken for pen geometry during move or
  resize.
- `WhiteboardSession` owns exclusive lesson-panel state through
  `setActivePanel`, `togglePanel` and `activePanel`, consumed by
  `WhiteboardCanvas` and the `App` Vue adapter.
- `InputPipeline`/`WhiteboardCanvas` creates shapes and lines through session
  commands. `MovableObject`, `PlotRenderer`, canvas drawing and PDF export are
  read-only rendering adapters over the same canonical fields.

These Interface changes centralize invariants that were previously duplicated
between panels, canvas helpers and persistence hydration. All direct consumers
have focused unit or browser coverage.

### Migration and cleanup (review remediation update, 2026-09-06)

- No SQL schema change and no old-data migration promise (DMD:255). The
  hydration-time `migrateLegacyObjects()` rewrite and the `equivalentJson`
  dual-read migration were REMOVED, together with the general-path reads of
  the `strokeColor`, `xData`/`yData` and `size` aliases (DMD:230/745: dual
  reads removed before slice completion). Only `position`/`dataUrl` remain as
  intake normalization on the single `normalizeBoardObject` edge.
- Migration discovery uses the compiled `server/migrations-js/*.js` set with
  the deployment layout agreed with VVE-108
  (`isProduction ? '/app/migrations-js' : <server>/migrations-js`).
  Re-verified 2026-09-06 on the real path: `knex migrate:status` shows all 6
  compiled migrations applied with none pending, `knex migrate:latest`
  reports `Already up to date`, and a server boot from `dist/` runs the same
  migrations successfully.
- `INTERNAL_EXTENSION_TYPES` and their extension validation path were removed
  as dead surface (no Pilot manifest entry, no fixtures).
- Removed newly-written legacy aliases from frontend creation/rendering,
  removed CalculatorModal's duplicate drag implementation, and kept hidden
  experimental providers and controls unmounted.

### Focused commits

- `9369e3f` — canonical lesson tool objects
- `49ce5f4` — Polish lesson tool workflows
- `52de2cb` — collaboration and renderer coverage
- `33c50ec` — lesson tool verification fixes
- `4df9dac` — Pilot database and direct-manipulation stability
- `97d79e6`, `859d16f`, `4ee1ee3` — deterministic real-input E2E gestures
- `f9639fd` — responsive panel browser coverage
- `8d7431a` — iPad panel stacking and topmost interaction
- `e460fc5`, `d306584` — visual resolution evidence and browser-console gate

### Review remediation (post-5360cb1, uncommitted working tree)

- **106-S1 (asymptote bridges)** — one shared domain-aware sampler
  `frontend/src/utils/mathPlotSampling.js` (`sampleMathFunction`) now owns
  segmentation for SVG (`PlotRenderer.vue`), Canvas and PDF export
  (`canvasDrawing.js`). Poles emit disjoint branches with bisection-based
  edge clipping; continuous zero crossings stay unbroken. Acceptance reruns:
  reviewer SSR reproduction (evidence `plot-segmentation-ssr.json`), unit
  suite `mathPlotSampling.spec.js` (incl. a canvas-vs-SVG branch-parity test),
  and the live board screenshot `browser-03-math-1-over-x-disjoint-branches.png`.
- **106-S2 (visible-tool matrix evidence)** — full matrix captured with
  ZCode's built-in browser via real GUI interactions at 1440×900 and
  768×1024: calculator (7×6=42), math plot `1/x`, physics plot, 2D/3D axes,
  shapes with dashed/sketchy styles and `Brak wypełnienia`, line, move,
  resize, rotate, undo, reload persistence (incl. backend restart),
  two-participant collaboration, physicsDataPlot moved by a real GUI drag
  with document data and 400×300 layout rectangle preserved
  (`browser-15-physics-plot-moved-data-preserved.png`), and portrait panel
  placement/clamping/Escape. Index: `docs/implementation/evidence/vve-106/README.md`. PDF export
  and dotted/arrow visual variants are covered by the repo Playwright e2e
  (real-Chrome input, real download) and unit/command tests; the in-app
  browser guest cannot expose download events (documented boundary).
- **Legacy alias dual reads** — removed as above; behavior covered by
  `boardScene.test.ts` canonical defaults/bounds tests.
- **Duplicated policy centralized** — canonical lesson-object defaults live in
  `LESSON_OBJECT_DEFAULTS` (server mirror in `boardScene.ts`), panel
  activation shortcuts in `PANEL_SHORTCUTS` (behavior in `App`, ToolBar
  tooltips/aria and TopMenu hints render from it), and lesson-panel
  Escape-to-close is owned by `App.handleGlobalKeyDown` (`DraggablePanel` no
  longer binds its own Escape; Calculator keeps local clear semantics).
- **`physicsDataPlot` data-vs-geometry** — `canonicalObjectBounds` in
  `server/src/pilot/boardScene.ts` is the single type-aware bounds owner:
  layout rectangle `[x, y, x+width, y+height]` for lesson objects, plotted
  data values never treated as world coordinates (canonical 400×300 fixture
  at (100,100) with 1e6 data values stays within `[98,98,502,402]` padded
  bounds). Contract published to VVE-105/VVE-107 via the coordination file;
  VVE-107 consumes it for PDF export bounds.
- **Polish copy** — `Brak wypełnienia` (title + aria) replaces `No fill`;
  eraser `Rozmiar` label localized.
- **Line rendering defect found during browser verification** — committed
  canonical lines painted nothing: `MovableObject.renderLocalCanvas` fed the
  painter the point-form element with `start`/`end` cleared, while
  `canvasDrawing`'s line painter consumes `start`/`end` only (document data
  was always correct). Fixed for lines (relative start/end; pen keeps the
  points form), locked by
  `frontend/tests/unit/components/MovableObject.line.spec.js`; visible proof
  in `evidence/vve-106/browser-14-dotted-line-end-arrowhead.png` (dotted
  pattern + end arrowhead from document style fields).
- **iPad portrait P3** — graph panels open at y=290 below the pen options bar
  at viewport width ≤1024 and clamp inside the visual viewport
  (`browser-13-ipad-portrait-768x1024-math-panel.png`).

### Verification

- Server production build: passed.
- Server Vitest: 13 files, 125/125 tests passed, including PostgreSQL-backed
  capability, lifecycle and document-store suites.
- Frontend production build: passed (3,178 modules transformed).
- Frontend Vitest: 13 files, 137/137 tests passed.
- Full Pilot Playwright: 11/11 tests passed in 35.9 s.
- Stateful lesson-tool Playwright scenario: passed twice consecutively against
  the same PostgreSQL database without cleanup (1/1 each, 11.9 s and 11.7 s).
- Focused desktop/iPad panel run: passed for 1440x900 and 768x1024 with
  reduced motion. It asserted focus, Polish validation errors, exclusivity,
  Escape cancellation, horizontal overflow, viewport bounds, topmost hit
  testing and zero browser console warnings/errors or page errors.
- Runtime collaboration evidence covers two participants, acknowledged create
  and transform, participant-local undo/redo, reload hydration, PDF download,
  reconnect read-only transition within the 2 s gate, and hidden-experiment
  absence.
- Visual evidence (single layout under `evidence/vve-106/`):
  pre-review [desktop 1440x900](../../evidence/vve-106/pre-review-desktop-1440x900.png)
  and [iPad portrait 768x1024](../../evidence/vve-106/pre-review-ipad-portrait-768x1024.png),
  plus the post-review browser matrix in
  [evidence/vve-106/README.md](../../evidence/vve-106/README.md) (ZCode
  built-in browser, real GUI interactions).
- Post-review rerun on the remediation tree: server Vitest 125/125, frontend
  Vitest 142/142, both production builds clean, repo Playwright 11/11
  (isolated ports), reviewer SSR asymptote reproduction passing.

### Bounded deviations

None within S6. Physical Apple Pencil/graphics-tablet confirmation remains the
S5 hardware gate; advanced PDF resource-safety and long-running capacity gates
remain S7/S9 and were not expanded or run by this slice.
