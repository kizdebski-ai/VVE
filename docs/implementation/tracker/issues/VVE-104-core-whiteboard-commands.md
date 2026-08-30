---
id: VVE-104
title: Core whiteboard commands
status: closed
labels:
  - ready-for-agent
  - "implementation:ticket"
parent: VVE-001
blocked_by: [VVE-103]
architecture_slice: S4
---

# Core whiteboard commands

## Outcome

Pen, eraser, text, selection, transforms, participant-scoped undo and redo, pan, zoom, shapes, lines, styles, clear, and image paste operate through BoardDocument and WhiteboardSession.

## Context pointer

Implement section `S4 - Core Whiteboard Commands` in [VVE Deep Module Design](../../../architecture/VVE-DEEP-MODULE-DESIGN.md). Use `codebase-design` for the canonical command Interface. User-facing work also follows `neumorphic-design` without reducing canvas area.

## Resolution evidence

Implemented on `slice/vve-104` over integration snapshot `f2e61fa`.

- **Canonical BoardDocument contract:** `server/src/pilot/boardScene.ts` owns the bounded schemas, legacy intake normalization, typed commands, line-binding behavior, and explicit clear epoch. `server/src/pilot/boardDocument.ts` validates remote updates against a shadow document and enforces object/update limits plus Teacher-only clear.
- **WhiteboardSession contract:** `frontend/src/board/whiteboardSession.ts` is the product write path for document commands, participant-scoped undo/redo, ephemeral selection, and local viewport state. Pan/zoom, pen, eraser, text, transforms, shapes, lines, cloning, helpers, clear, and image paste cross that Interface; Vue components no longer mutate `Y.Map` values.
- **Canonical rendering and export:** core pen/text/shape/line/image objects use one emitted geometry. PDF export consumes `WhiteboardSession.snapshot()` and only normalizes aliases at the pre-session legacy intake edge. Direct `useUndoRedo.js` and its source-text assertions were removed.
- **Role behavior:** Teacher and Student edit shared objects. Student clear is denied locally and by the server; the Teacher entry receives the authenticated Teacher role and the only clear control.
- **Focused behavior gates:** server build passed; server `118/118`; frontend build passed; frontend `124/124`, including six WhiteboardSession Interface tests and canonical PDF export coverage.
- **Browser gate:** `9/9` Pilot workflows passed against local PostgreSQL on isolated ports. The added S4 scenario creates a fresh Managed Board, connects two Students, proves each participant's undo/redo leaves the other's stroke intact, then proves Teacher clear converges both sessions to empty. Existing gates also cover acknowledgement, disconnect read-only, reconnect, persistence, and reload.
- **Visual/manual gate:** built-in Browser at 1280×720, 1024×768, and 768×1024 reported no viewport overflow or console warnings/errors. Manual pen input, undo, and redo were visibly correct; controls remained reachable and did not cover the working area.
- **Focused commit:** the completed slice is recorded at the `slice/vve-104` branch tip. It remains local and has not been pushed.

Final integrated verification after the viewport Interface change:

- `server`: `npm run build`; `npm test` — passed, `118/118`.
- `frontend`: `npm run build`; `npm test` — passed, `124/124`.
- `frontend`: isolated-port Playwright suite — passed, `9/9`.
