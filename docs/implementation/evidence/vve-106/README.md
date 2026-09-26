# VVE-106 browser verification evidence (2026-09-06)

Captured with ZCode's built-in browser (control-browser) using real GUI
interactions (pointer clicks, drags, keyboard) against the uncommitted
remediation tree, backend on 127.0.0.1:8106, Vite app on localhost:5106,
dedicated non-fixture board (own teacher/organization, so sibling fixture
re-seeds could not invalidate the session). Viewports: 1440x900 and 768x1024.
All access tokens/URLs are redacted by construction — no token or access URL
appears in any file in this directory.

| File | Evidence |
| --- | --- |
| browser-01-board-1440x900.png | Student board joined, editable, toolbar visible (desktop) |
| browser-02-calculator-7x6.png | Kalkulator naukowy: GUI clicks 7×6=42, Polish UI, panel clamped, no toolbar overlap |
| plot-segmentation-ssr.json | Reviewer 106-S1 reproduction rerun: `1/x` → 2 SVG `M` branches (was 1 with a 600 px bridge), `tan(x)` → 7, `sin(x)` → 1 continuous; max intra-branch jump 33–40 px |
| browser-03-math-1-over-x-disjoint-branches.png | Live board: `1/x` rendered as two disjoint hyperbola branches, no vertical bridge at x=0 |
| browser-04-physics-data-plot.png | `physicsDataPlot` added from the panel with default data (t/v labels, points as data) |
| browser-05-coordinate-systems-2d-3d.png | 2D (x/y) and 3D (x/y/z + dotted grid) coordinate systems at canonical 400×300 defaults |
| browser-06-shapes-rect-sketchy-dashed-triangle.png | Rectangle (clean) + triangle drawn with Kreskowana/Odręczna (dashed sketchy) style from the Kształty popover |
| browser-07-fill-popover-brak-wypełnienia.png | Kształty popover open: fill section contains `Brak wypełnienia` (title + aria-label, Polish); button clicked to select no-fill |
| browser-08-reload-persistence.png | After page reload AND a backend restart: all objects hydrated from PostgreSQL (persistence + reload) |
| browser-09-move-resize-rotate.png | Selection handles: object moved, resized (corner handle) and rotated (~45°) via the rotation handle |
| browser-11-undo.png | Cofnij clicked; participant-local undo reverts own operations (rotation reverted; confirmed after resync) |
| browser-12-collaboration-second-participant.png | Second participant tab: `2 online` in both, remote cursor label visible, participant 2 sees the full canonical document and adds its own pen stroke |
| browser-14-dotted-line-end-arrowhead.png | Zoom on a committed canonical line: Kropkowana (dotted) pattern with the end arrowhead rendered from `lineStyle: dotted` + `arrowStyle: end` (post-fix) |
| browser-15-physics-plot-moved-data-preserved.png | physicsDataPlot moved by a real GUI drag on a clean board: wrapper (513,293)→(213,583); Yjs doc after the move shows `width: 400, height: 300` unchanged and `points` data untouched ([0,0],[1,9.8],[2,19.6],[3,29.4]) — plotted data values never became world coordinates |
| browser-13-ipad-portrait-768x1024-math-panel.png | iPad portrait 768×1024: math panel opens at y=290 BELOW the pen options bar (no overlap with the thickness control — P3 fixed), clamped inside the viewport; Escape closes it |

## Post-review fix discovered during this verification

While capturing the line evidence, the built-in browser exposed a real
rendering defect that the reviewed tip inherited from the base: committed
canonical lines rendered NOTHING (empty local canvas). Root cause:
`MovableObject.renderLocalCanvas` fed the painter the point-form element with
`start`/`end` cleared, while `canvasDrawing`'s line painter consumes
`start`/`end` only. The Yjs document data was always correct
(`lineStyle: dotted`, `arrowStyle: end`). Fixed in `MovableObject.vue`
(lines render from relative start/end; pen keeps the points form), locked by
the new regression test
`frontend/tests/unit/components/MovableObject.line.spec.js` and visible in
browser-14/browser-15. The earlier `browser-10-line-drawn.png` capture was a
stale draw-layer preview, not a committed line — it was removed and replaced
by browser-14.

## Honest boundaries

- PDF export visual correctness is covered by the repo Playwright e2e
  (real-Chrome download of `whiteboard.pdf` after the full lesson-tool
  workflow) and `pdfExportCanonical` unit tests. The in-app browser guest
  does not expose download events, so the download itself was not re-captured
  here.
- Physical Apple Pencil / tablet hardware remains the S5 hardware gate; not
  claimed here.
