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
  mutation, participant-local undo and post-hydration migration.
  `migrateLegacyObjects()` is the added hydration Interface consumed by
  `CollaborationRuntime`.
- `BoardScene` owns the bounded schemas for `coordinateSystem2D`,
  `coordinateSystem3D`, `mathFunctionPlot` and `physicsDataPlot`. Callers use
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

### Migration and cleanup

- No SQL schema change is required. Hydration now transactionally rewrites
  legacy lesson objects (`position`, `strokeColor`, `xData`/`yData`, `size`
  and non-canonical defaults) into the canonical object schema before use or
  compaction.
- Migration discovery now consistently uses the compiled
  `server/migrations-js/*.js` set. Two consecutive `migrate:latest` runs
  reported `Already up to date`; all 6 migrations remain applied.
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

### Verification

- Server production build: passed.
- Server Vitest: 13 files, 125/125 tests passed, including PostgreSQL-backed
  capability, lifecycle and document-store suites.
- Frontend production build: passed (3,178 modules transformed).
- Frontend Vitest: 13 files, 137/137 tests passed.
- Full Pilot Playwright: 11/11 tests passed in 39.6 s.
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
- Visual evidence:
  [desktop 1440x900](../../VVE-106-desktop.png) and
  [iPad portrait 768x1024](../../VVE-106-ipad-portrait.png).

### Bounded deviations

None within S6. Physical Apple Pencil/graphics-tablet confirmation remains the
S5 hardware gate; advanced PDF resource-safety and long-running capacity gates
remain S7/S9 and were not expanded or run by this slice.
