---
id: VVE-108
title: Runtime recovery and observability
status: open
labels:
  - ready-for-agent
  - "implementation:ticket"
parent: VVE-001
blocked_by: [VVE-103]
architecture_slice: S8
---

# Runtime recovery and observability

## Outcome

The single Railway process starts honestly, drains safely, restores acknowledged work, and emits enough content-free evidence to diagnose the Pilot.

## Context pointer

Implement section `S8 - Runtime Recovery and Observability` in [VVE Deep Module Design](../../../architecture/VVE-DEEP-MODULE-DESIGN.md). RuntimeControl and OperationalSignals own startup, readiness, drain, shutdown, and telemetry.

## Resolution evidence

Return liveness and readiness contracts, startup failure tests, drain and flush results, controlled restart timing, structured redacted event examples, soak metric availability, timer and resource ownership proof, rollback notes, and the focused commit.

## Resolution

Delivered `OperationalSignals` and `RuntimeControl` (Modules 10 and 11) so the Pilot process starts only after configuration, database, migrations, Module construction, and a persistence probe succeed; answers separate `/live` and `/ready`; drains collaboration, flushes snapshots, stops owned timers, and closes listeners/pools without `process.exit`; and emits bounded, redacted JSON evidence. Acknowledged Managed Board work survives two controlled restarts on the same PostgreSQL database with digest equality. Clients treat `serverDraining` as read-only and show Polish recovery copy.

### Owned Interfaces

- `OperationalSignals` (`server/src/pilot/operationalSignals.ts`): `record`, `measure`, `snapshot`. JSON stdout Adapter plus in-memory recording Adapter. Redacts tokens, passphrases, URLs, Student Labels, and binary payloads by construction.
- `RuntimeControl` (`server/src/pilot/runtimeControl.ts`): `start`, `status`, `stop`. Typed failures: `invalid-configuration`, `dependency-unavailable`, `migration-failed`, `listener-failed`, `drain-timeout`/`flush` remaining in the shutdown report. Liveness ≠ readiness.

### Consumed Interfaces

- `PilotAvailability`, `CapabilityAccess`, `BoardLifecycle`, `BoardDocumentStore` / `CollaborationRuntime`, HTTP/WS transport (`realtimeListener`).
- `CollaborationRuntime.stats()` was added so soak snapshots do not scrape logs. `drain` now flushes, emits `serverDraining`, and closes transports (1012). Optional `signals` on CapabilityAccess, BoardLifecycle, and CollaborationRuntime.

### HTTP contracts

- `GET /live` — 200 `{ live: true }` while the process is serving HTTP (including drain).
- `GET /ready` — 200 only when database + collaboration persistence probes pass; body includes content-free `soak`. 503 during drain and before ready.
- `GET /health` — Railway/Playwright wait target; 200 iff ready (`status: "ok"`). The previous `rooms` count is gone.

Example `/ready` (trimmed): `{ "live": true, "ready": true, "status": "ready", "checks": { "database": true, "persistence": true }, "soak": { "eventLoopDelayMs": { "p95": 20.2 }, "memory": { "rssBytes": 150462464 }, "connections": 0, "boards": 0, "errors": { "persistence": 0, "unhandled": 0 } } }`.

Redacted event example: `{ "name": "access.decision", "dimensions": { "action": "board.edit", "granted": false, "reason": "revoked", "credentialKind": "boardWs", "passphrase": "[redacted]" } }`.

### Migrations and removed legacy paths

- No new PostgreSQL schema. RuntimeControl runs `migrate.latest()` against `migrations-js`. `server/knexfile.ts` now uses the same `.js` directory so CLI and process lifecycle do not disagree on filenames.
- Removed: import-time `server.listen` / `process.exit(0)` in `server.ts`; FilePersistence constructor I/O; RoomManager constructor disk load; `/health` room-count “ok”. Process Adapter only starts when `argv[1]` is `server.js|ts` and sets `process.exitCode` after `stop()` if the shutdown was unclean.
- Legacy peer rooms remain ADR-0010 / dev-only; RuntimeControl hydrates and flushes `RoomManager` on start/stop.

### Timer and resource ownership

Ping, soak sampling, and `monitorEventLoopDelay` are registered by name on RuntimeControl. BoardLifecycle deletion sweep is started after construction and stopped on drain. After `stop()`, `status().resources.timers` is empty; double `stop()` returns the first report.

### Focused commits

- `e111aa6158f1b76b2bf43fae3cf1b3c8f3288fb5` — RuntimeControl, OperationalSignals, drain/restart tests, client draining copy.
- Follow-up on this branch — knexfile alignment, source-text test retargeting, visual evidence, this resolution.

### Build and tests (2026-08-30)

- Server `npm run build` (tsc) passed.
- Server `npm test`: **132 passed / 132** across **15** files (was 118). New: `operationalSignals.test.ts` (3), `runtimeControl.test.ts` (9), drain oracle, `/live`/`/ready`.
- Frontend `npm run build` passed.
- Frontend `npm test`: **126 passed / 126** across **11** files (was 124). Added draining protocol + Polish banner tests.
- Playwright Pilot flow: **9/9** then **9/9** again against the same persistent `vve_test` database with no manual cleanup (`CI=1`, `VVE_E2E_BACKEND_PORT=8001`).
- `git diff --check` clean.
- Controlled restart: two sequential start→acknowledge→stop→start→digest-equality cycles; both `< 30s` (test body 268ms for both cycles on this host). `remaining`/`clean:false` when the deadline has already passed.

### Browser and visual evidence

Built-in computerUse was not in this agent’s tool catalog. Verification used Playwright Chromium (`channel: chrome`) against the real Vite+RuntimeControl stack:

- Desktop 1440×900 and iPad 768×1024 student canvas: `docs/implementation/evidence/vve-108/student-desktop-1440x900.png`, `student-ipad-768x1024.png`.
- Student entry (iPad): `student-entry-ipad-768x1024.png`.
- Teacher dashboard: `teacher-desktop-1440x900.png`.
- Overflow: `overflow.json` — no horizontal overflow at 1440×900 or 768×1024.
- Console: `*-console.json` — no page errors.
- Health JSON: `live.json`, `ready.json`, `health.json`.
- Draining/cancelled overlay copy is covered by unit tests (`Serwer jest restartowany. Twoja praca zostanie przywrócona.`); reduced-motion disables the connecting spinner animation.

### Rollback

Revert the slice commits. No schema migration to undo. A previous known-good Railway revision remains the operational rollback path (Pilot release gate).

### Bounded deviations (later slices)

- Three-hour 57-client soak and 88-client stress remain **VVE-109**.
- Snapshot `eventLoopDelayMs.p50` is the last sample; p95 uses `monitorEventLoopDelay` percentile at sample time (and max of recorded samples in the aggregate).
- Apple Pencil / graphics-tablet confirmation remains Kordian’s hardware gate.
- `FilePersistence` still exists for the internal legacy peer-room surface; it is not the Managed Board path.
