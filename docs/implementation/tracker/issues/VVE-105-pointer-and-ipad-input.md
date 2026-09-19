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

Input-to-paint p95 on this VM, Playwright mouse Pointer Events: **26.52 ms / 226 samples** (target ≤ 50 ms), recorded before the measurement-boundary fix (it ended at the intent handler, before the rendering frame). Regenerated on 2026-09-18 with the presentation-correlated boundary (sample finalized in the rAF frame that renders the intent output): **28.57 ms / 225 samples**. The pinned `docs/implementation/evidence/vve-105/input-paint-p95.json` and the three screenshots now hold the regenerated, truthful measurement; regular e2e runs do not rewrite them (capture flags required). The earlier 27.9 ms figure quoted in the first review matched neither pinned file and is obsolete. No growing lag observed on the automated stroke.

### Bounded deviations

- Kordian's Apple Pencil and graphics-tablet pass remains the external feel confirmation. Missing physical hardware is not a software failure.
- Spatial index is an AABB candidate query, not a full tree.
- Predicted events unused.
- Gel/technical/marker/calligraphy rendering presets still exist in `penStyles.js` / `HandwritingStylerModule.js` but are disconnected from Pilot UI.

Status stays **open** on this slice branch for the integration owner to close after merge.

## Remediation follow-up (VVE-105 worktree, 2026-09-06, uncommitted diff on `codex/antigravity-vve-105-remediation`)

Review findings addressed (Fable review 5121473786, independent follow-up 5122516886, inline threads) on top of the preserved uncommitted remediation work:

| Finding | Fix | Test / evidence |
| --- | --- | --- |
| P1: `input-paint-p95` measured dispatch, not paint (`WhiteboardCanvas.vue` recordInputPaint before draw/rAF) | Paint sample now queued at intent time and finalized in the rAF `renderLoop` after the frame that renders the intent output; dispatch latency is a separately named `data-input-dispatch-p95`; measurement boundary documented in code | `pilot-fixture.spec.js` asserts paint p95 ≤ 50 with samples > 0, dispatch p95 ≤ 50, and an injected 80 ms presentation delay must push paint p95 > 50 while dispatch stays ≤ 50 (e2e pass) |
| P2: hit testing rebuilt and scanned the whole scene per sample (`lightweightScene` + linear `queryObjectsNear`) | `BoardSpatialIndex` (spatial hash grid, bounded candidate query, `lastQueryCandidateCount`) in `boardScene.ts`; `WhiteboardSession.queryObjectsNear`; canvas uses the session query; index maintained incrementally (per-map observers + array delta replay with ordered id tracking), no full-scene rebuild per document change or pointer sample | `boardScene.test.ts`: empty-area query on 10,000 objects reads 0 candidates; move/resize/delete keep hits correct. `whiteboardSession.spec.ts`: bounded query correctness after move/delete |
| P2: replace-don't-layer unfinished (`startDrawing`, HandwritingStyler preset cards, preview RAF loops, watchers in App.vue) | `startDrawing` removed from `useDrawingEngine`; App.vue preset cards, `queuePreviewRender`, preview canvases, watchers and pen-preview refs deleted; stale `queuePreviewRender()` call in the mounted hook (crash: `ReferenceError` blocked mount and sync) removed | Frontend vitest suite 143/143; e2e 11/11; no `queuePreviewRender`/`startDrawing` references remain |
| P2: pressure stored but not rendered; double smoothing | `drawStyledPen` modulates ink width from per-point pressure across gel/technical/marker/calligraphy/fallback paths and disables preset+global smoothing when pressure detail is present; single-point dots scale with pressure; committed canvas + PDF export share `drawElement` → `drawStyledPen` | New `penStyles.spec.js`: pressure modulates width; constant width without pressure; no bezier/smoothing displacement under pressure with `globalSmoothing: 0.9` |
| P2: source-text tests redirected instead of deleted (`audit2.test.js`, `sections3-10.test.js` 5.8) | Redirected destructuring/dispatch source-text assertions deleted; replaced by behavior tests through the seams (useDrawingEngine `startDrawingAt`/`cancelActiveDrawing`, InputPipeline cancel intents) | `audit2.test.js` behavior tests; `inputPipeline.spec.ts` |
| P2: e2e wrote tracked evidence files on every run; evidence JSON not reproducible | All evidence writes gated behind `VVE_CAPTURE_VISUALS`/`CAPTURE_EVIDENCE`; gated JSON payload matches the pinned 7-field `input-paint-p95.json` | Post-e2e `git status` clean on tracked evidence files |
| P3: residual mouse handlers, no capture/cancel/blur, HTML `touch-action` attribute | Textarea `@mousedown.stop` → `@pointerdown.stop`; MovableObject drag/rotate/resize/line-endpoint use pointer capture, `pointercancel`, `lostpointercapture`, window `blur`; cancel restores state via `syncDataFromYMap` without committing partial transforms; `touch-action: none` as CSS | Pointer pipeline e2e incl. blur-cancel-does-not-commit; `MovableObject.spec.js` gesture-cancellation tests: touch-type drag commits one move intent, pointercancel ends without committing and detaches listeners, window blur cancels without committing, pointercancel during resize emits no commit |
| P3: unused fields/emits | `GestureState.lastRaw` removed; `tiltX`/`tiltY` connected end-to-end (sample → intent → stroke points); `reducedMotion` consumed by the pipeline smoothing decision; dead `update:input-profile` emit removed (`select-pen-preset` is live via keyboard shortcuts) | Frontend vitest suite |
| 106 canonical bounds consumption | `sceneObjectBounds` uses the display rectangle for objects with geometry; plotted data points never expand bounds | New `boardScene.test.ts` fixture: physics plot with 1,000,000 data values keeps bounds [100,100,400,300]; index query at data magnitude does not match |

### Verification (this worktree, 2026-09-06)

- Server vitest **124/124**, `tsc` build clean.
- Frontend vitest **147/147**, Vite production build clean.
- Playwright e2e **11/11** (Chromium channel chrome, PostgreSQL 5433/vve_test); tracked evidence files untouched after the run.
- ZCode built-in browser (in-app): 1440×900 and 768×1024 — Styl wejścia control rendered, unobscured (no overlap with toolbar/top menu, no page overflow), Pióro selectable by click and persisted in `localStorage['vve.inputStyle.v1']` across reload, Pióro stroke committed and visible, radios keyboard-focusable with roving tabindex, no console errors.
- In-app browser environment limits (recorded honestly): the guest webview does not run requestAnimationFrame or reconnect WebSockets while occluded, so frame-correlated paint metrics, post-reload re-render and reconnect completion could not be observed live there; these behaviors are covered by the Playwright Chromium e2e (paint p95 sampling, injected-delay gate, reload persistence, read-only/reconnect transitions). Keyboard 1/2 shortcuts likewise verified by e2e `page.keyboard`, not the in-app keyboard path.

Status stays **open** on this slice branch for the integration owner to close after merge.
