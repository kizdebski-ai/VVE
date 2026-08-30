---
id: VVE-103
title: Acknowledged durable lesson
status: closed
labels:
  - ready-for-agent
  - "implementation:ticket"
parent: VVE-001
blocked_by: [VVE-102]
architecture_slice: S3
---

# Acknowledged durable lesson

## Outcome

One Teacher and up to three Students collaborate on one Managed Board with durable acknowledgements, read-only disconnect behavior, replay, reconnect, idle unload, and safe restart.

## Context pointer

Implement section `S3 - Acknowledged Durable Lesson` in [VVE Deep Module Design](../../../architecture/VVE-DEEP-MODULE-DESIGN.md). Use the CapabilityAccess, BoardLifecycle, BoardDocument, and CollaborationRuntime Interfaces defined there.

## Resolution evidence

Return the acknowledgement oracle in executable form, crash-injection matrix, state-vector or digest equality results, wrong-board and revoked-link denials, independent Student flow, multi-device link flow, read-only timing evidence, deleted legacy persistence path, and the focused commit.

## Resolution

Delivered the `BoardDocument` and `CollaborationRuntime` Interfaces under `server/src/pilot`. Managed Boards now use an explicit protocol whose mutation acknowledgement is emitted only after the operation is durably appended. Operation receipts retain stable operation IDs and digests independently of compacted update rows, so retries remain idempotent after reconnect, restart, and snapshot compaction. PostgreSQL stores snapshot cutoffs, the durable update log, and receipts transactionally.

The client now has distinct sync, awareness, mutation, acknowledgement, synchronization-complete, denial, draining, and update frames. A Managed Board remains read-only until synchronization completes, becomes read-only immediately when the browser or socket disconnects, retries pending operations with their original IDs, and removes them only after acknowledgement. The Yjs transaction guard also rejects local document changes while read-only, preventing hidden offline divergence. Presence is hydrated for later joins and removed on disconnect.

The previous `BoardYjsPersistence` implementation and its tests were deleted. `RoomManager` remains only behind the separate internal development surface; it is no longer the Managed Board persistence path.

Gate results on 2026-08-30:

- Server TypeScript production build passed.
- Server vitest passed 92 of 92 tests across 12 files.
- The executable acknowledgement oracle covers the three crash points: before durable append, after durable append but before live apply, and after live apply but before acknowledgement. Digest equality proves the reloaded snapshot plus log matches the acknowledged document.
- PostgreSQL integration tests prove append/replay, snapshot compaction, restart hydration, and operation-ID deduplication after compaction. Access tests cover cross-board and revoked-link denial.
- Frontend production build passed; frontend vitest passed 117 of 117 tests across 9 files.
- Playwright passed 8 of 8 tests in two clean complete runs. Independent Student contexts using the same Board Access Link converge, both report two online participants, acknowledged drawing survives reconnect and reload, offline drawing is blocked, and the read-only indicator appears within the two-second gate.
- Built-in Browser verification passed at 1280 by 720 and 768 by 1024. The canvas, toolbar, participant card, presence count, and zoom controls rendered without horizontal or vertical overflow or obstructed controls.
- No commit was created because repository policy requires explicit approval. The focused VVE-103 change remains unstaged on top of the separately staged VVE-102 slice, ready for the user to commit and push.
