---
id: VVE-105
title: Pointer and iPad input
status: open
labels:
  - ready-for-agent
  - "implementation:ticket"
parent: VVE-001
blocked_by: [VVE-104]
architecture_slice: S5
---

# Pointer and iPad input

## Outcome

Mouse, graphics tablet, and Apple Pencil share one continuous Pointer Event pipeline with working `Mysz` and `Pióro` Input Styles and predictable gesture arbitration.

## Context pointer

Implement section `S5 - Pointer and iPad Input` in [VVE Deep Module Design](../../../architecture/VVE-DEEP-MODULE-DESIGN.md). Use `apple-design` for Apple-faithful direct manipulation, `motion` for gesture motion review, and `neumorphic-design` for the Input Style control.

## Resolution evidence

Return the InputPipeline Interface, deterministic pointer traces, pressure and coalesced-event evidence, capture and cancellation tests, pan and pinch results, input-to-paint measurements, desktop and iPad Browser evidence, reduced-motion behavior, removed mouse/touch duplicates, and the focused commit. Mark Kordian's hardware check as the remaining external confirmation.

## Resolution

Delivered one Pointer Event `InputPipeline` on `slice/vve-105` (base `slice/vve-104` @ `147e1869dc292b543dd3f9b08ec14a62934fb409`). Mouse, touch, and pen share that Interface. The Pilot UI exposes **Mysz** / **Pióro** as the only Input Styles, with automatic initial choice from pointer identity and a persistent local override.

### Owned Interfaces

- **InputPipeline** (`frontend/src/board/inputPipeline.ts`): `configure('mouse' | 'pen')`, `ingest(PointerSampleBatch)`, `cancel(blur | lostcapture | gesture | dispose)`. Hides capture bookkeeping, coalesced-sample folding, palm/gesture arbitration, pressure curves, Mysz/Pióro smoothing, resampling, one-viewport coordinate conversion, and hover throttling.
- **Pointer Event Adapter** (`frontend/src/board/pointerEventAdapter.ts`): the only production reader of DOM PointerEvents. Deterministic traces replay the same batch shape.
- **Input Style** (`frontend/src/board/inputStyle.ts` + `InputStyleControl.vue`): Polish **Styl wejścia** control, `vve.inputStyle.v1` persistence, 1/2 shortcuts, TopMenu **Styl** cycle.

### Consumed / extended Interfaces

- **WhiteboardSession** (VVE-104): draw/pan/zoom/erase dispatch from pipeline intents.
- **BoardDocument** (`server/src/pilot/boardScene.ts`): added optional `ScenePoint.p` in `[0,1]` and `queryObjectsNear` / `sceneObjectBounds` so eraser hit testing uses a bounded AABB candidate query instead of converting the whole scene per sample. Justification: Depth (hit-test stays in the document module), Leverage (session and canvas share one query), Locality (no canvas-local bounds helpers).
- **PilotAvailability** `panel.inputStyle` remains `always` for lesson roles; the control is hidden when the feature is unavailable.

### Migrations and removed paths

- No SQL migration. Pressure is an optional point field; existing strokes remain valid.
- Deleted mouse/touch drawing handlers and synthetic-mouse conversion from `WhiteboardCanvas.vue`. Drawing uses `@pointerdown/move/up/cancel/lostpointercapture` with `setPointerCapture`.
- Pilot keyboard 1/2 now select Mysz/Pióro instead of gel/technical/marker/calligraphy. The old `HandwritingStylerPanel` is unmounted; gel/technical/marker/calligraphy rendering helpers remain as unused internals for later cleanup.
- Predicted Pointer Events are not consumed (coalesced samples only).

### Focused commits

- `a44f1d2` feat(input): add Pointer Event InputPipeline with Mysz/Pióro styles
- `948df06` test(input): cover Input Style persistence, cancel, and p95 evidence
- `6ef110d` fix(input): expose pointer auto-select handler from App setup
- `2c9f926` docs(vve-105): record InputPipeline resolution and Browser evidence

### Build and tests

- Server `npm run build` passed; `npm test` **121/121** across 13 files (includes BoardDocument pressure + `queryObjectsNear`).
- Frontend `npm run build` passed; `npm test` **140/140** across 13 files (InputPipeline traces, InputStyleControl, Pointer Event canvas, superseded source-text checks).
- `git diff --check` clean.

### End-to-end

Playwright Pilot fixture, isolated ports `5195/8095`, local PostgreSQL `127.0.0.1:5433/vve_test`, no manual DB cleanup between runs:

- Pass 1: **11/11** (34.0s)
- Pass 2: **11/11** (33.1s)

Covered: Input Style UI, Pióro switch, mouse stroke commit, two-finger pointer events do not scroll, blur cancel does not commit, localStorage override survives reload, first pen pointer auto-selects Pióro, reduced-motion, keyboard 1/2 and radiogroup arrows.

### Browser / visual

Playwright Chromium (channel `chrome`) at **1440×900** and iPad portrait **768×1024**:

- Screenshots: `docs/implementation/evidence/vve-105/desktop-1440x900-input-style.png`, `desktop-1440x900-after-stroke.png`, `ipad-768x1024-input-style.png`
- Control stays in-viewport (safe-area offset, 44px hits); no horizontal overflow; page `scrollX` stays 0
- Keyboard focus ring on the radios; reduced-motion disables the option transition
- Built-in Browser MCP was not available in this Cloud Agent; Playwright plus screenshots are the visual record

### Measurements

Input-to-paint p95 on this VM, Playwright mouse Pointer Events, 226 samples: **26.52 ms** (target ≤ 50 ms). See `docs/implementation/evidence/vve-105/input-paint-p95.json`. No growing lag observed on the automated stroke.

### Bounded deviations

- Kordian's Apple Pencil and graphics-tablet pass remains the external feel confirmation. Missing physical hardware is not a software failure.
- Spatial index is an AABB candidate query, not a full tree.
- Predicted events unused.
- Gel/technical/marker/calligraphy rendering presets still exist in `penStyles.js` / `HandwritingStylerModule.js` but are disconnected from Pilot UI.

Status stays **open** on this slice branch for the integration owner to close after merge.
