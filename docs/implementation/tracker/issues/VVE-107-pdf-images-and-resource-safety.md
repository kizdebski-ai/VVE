---
id: VVE-107
title: PDF, images, and resource safety
status: open
labels:
  - ready-for-agent
  - "implementation:ticket"
parent: VVE-001
blocked_by: [VVE-104]
architecture_slice: S7
---

# PDF, images, and resource safety

## Outcome

Teacher and Student import representative lesson materials and export the synchronized board without freezing, corrupting collaboration, or bypassing resource limits.

## Context pointer

Implement section `S7 - PDF, Images, and Resource Safety` in [VVE Deep Module Design](../../../architecture/VVE-DEEP-MODULE-DESIGN.md). ArtifactPipeline and ResourceGovernor own the behavior. UI progress and cancellation follow `neumorphic-design`; iPad-specific behavior follows `apple-design`.

## Resolution evidence

Return representative PDF and image fixtures, import and export behavior results, collaboration and reload proof, configurable limit measurements, malformed and oversized input results, bounded memory and queue evidence, iPad and desktop Browser evidence, proof that 57-client normal traffic remains admitted, and the focused commit.

## Resolution

Status remains `open` on `slice/vve-107` pending integration review.

### Delivered outcome

Teacher and Student import PDF/PNG/JPEG/WebP (SVG/HEIC best-effort) through ArtifactPipeline as movable/resizable canonical image objects, export the synchronized board as a tiled A4 PDF (iPad share/open-tab vs desktop download), and see Polish progress/cancellation. ResourceGovernor admits 57-client normal traffic with measured defaults and fails closed on oversized, malformed, encrypted, unknown, and slow-consumer attempts.

### Owned Interfaces

- **ArtifactPipeline** (`server/src/pilot/artifactContract.ts` + `frontend/src/board/artifactPipeline.ts`): `planImport` / `import` / `export`. Codecs, tiling, iOS delivery, and canvas cleanup stay inside the Implementation (`artifactCodecs.ts`, `deliverPdfArtifact`).
- **ResourceGovernor** (`server/src/pilot/resourceGovernor.ts`): `admit` / `observe`, plus `limits()` so callers read one measured configuration instead of duplicating constants. `limits()` is an evidence-backed Interface extension: it improves Locality without leaking token-bucket internals.

### Consumed Interfaces

BoardDocument / `boardScene` image `add` commands, WhiteboardSession.execute, CollaborationRuntime admission and `resource` denials with `messageKey`, PilotAvailability `panel.pdfImport` / `panel.pdfExport` / `panel.imagePaste`, CapabilityAccess Administrator login window.

### Migrations and removed paths

- No database migration. Assets remain inline in the Yjs document under measured caps.
- Deleted `frontend/src/composables/usePdfImport.js`. Product PDF export left `usePdfExport.js`; that file is now snapshot-only for the excluded raw-board transfer.
- Paste and file import no longer use `createImageElement` (500 px cap). Display fitting is owned by ArtifactPipeline (1600 px edge) after ResourceGovernor pixel/byte admission.
- Scattered WS per-IP tracking (`MAX_CONNECTIONS_PER_IP = 20`) and magic HTTP `20mb` / 5 MB payload caps are replaced by ResourceGovernor configuration.

### Measured defaults (synthetic calibration 2026-08-30)

Documented in `resourceLimits.ts` and overridable via `VVE_MAX_*` / `ADMIN_LOGIN_*`. Process 96 connections, per-IP 96, per-board 8, 10 MB document/WS payload, 8 MB encoded image, 16 MP decoded, 25 MB / 40 pages PDF, 8 concurrent artifact jobs, 8 MB slow-client buffer. 57 sockets from one CI host are admitted; 88 from one host are observed in-process without Redis.

### Focused commits

- `1be7c02` — ArtifactPipeline + ResourceGovernor implementation
- `cf222e3` — e2e file-input placement, Polish pluralization, Browser screenshots, ticket resolution

### Tests and builds

- `server npm run build` (`tsc`) clean
- `server npm test` **128/128** twice against the same PostgreSQL (`postgres://vve:vve-test@127.0.0.1:5433/vve_test`) with no manual cleanup
- `frontend npm run build` (Vite production) succeeded; PDF.js worker emitted as `pdf.worker.min-*.mjs`
- `frontend npm test` **134/134**
- `git diff --check` clean
- Playwright Pilot suite **10/10** twice on that database, including import → collaborate → reload → export

### Browser / visual evidence

- Desktop 1440×900: `docs/implementation/evidence/vve-107/desktop-1440x900.png` — two stacked pages (`Strona 1` / `Strona 2`), toast `Zaimportowano 2 strony z PDF.`, toolbar and zoom reachable, horizontal overflow ≤ 1 px
- iPad portrait 768×1024: `docs/implementation/evidence/vve-107/ipad-768x1024.png` — same lesson objects, controls remain in viewport, overflow ≤ 1 px
- Fixtures: `frontend/tests/fixtures/artifacts/lesson-2page.pdf`, `pixel.png`
- ArtifactProgress overlay: hidden until work starts; Anuluj + reduced-motion fill in component tests
- Apple Pencil / graphics-tablet hardware confirmation remains Kordian's external action

### Bounded deviations

- HEIC/SVG decode is best-effort through the browser `Image` path; there is no extra HEIC codec
- ResourceGovernor `readOnly` is in the Interface; current policy rejects new connections rather than flipping admitted lessons to read-only
- Playwright did not separately screenshot cancelled/expired/revoked artifact overlays (those states are unit-tested; access expiry/revocation remain VVE-101/102 flows)
- Three-hour 57-client soak is VVE-109, not this slice

### Integration notes

Base is `slice/vve-104` @ `147e1869dc292b543dd3f9b08ec14a62934fb409`. Parallel slices VVE-105 and VVE-106 start from the same tip. Likely conflict files: `frontend/src/components/WhiteboardCanvas.vue`, `frontend/src/components/TopMenu.vue`, `frontend/src/App.vue`, `server/src/server.ts`, `server/src/pilot/collaborationRuntime.ts`, `frontend/tests/e2e/pilot-fixture.spec.js`.

