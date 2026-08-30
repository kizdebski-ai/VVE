---
id: VVE-102
title: Managed and Personal Board lifecycle
status: closed
labels:
  - ready-for-agent
  - "implementation:ticket"
parent: VVE-001
blocked_by: [VVE-101]
architecture_slice: S2
---

# Managed and Personal Board lifecycle

## Outcome

A Teacher receives one Personal Board and can create, share, rotate, end, and expire a twelve-month Managed Board under the agreed seven-day deletion policy.

## Context pointer

Implement section `S2 - Managed/Personal Board Lifecycle` in [VVE Deep Module Design](../../../architecture/VVE-DEEP-MODULE-DESIGN.md). BoardLifecycle owns lifecycle states and scheduling; callers consume its Interface.

## Resolution evidence

Return schema and migration results, concurrent-safe Personal Board proof, Board Access Link lifecycle browser and transport tests, due-purge idempotency evidence, proof that data survives credential rotation, proof that access ends immediately, deleted archive semantics, and the focused commit.

## Resolution

Delivered the `BoardLifecycle` Interface in `server/src/pilot/boardLifecycle.ts`. It owns lazy Personal Board creation, Managed Board creation, twelve-month validity, Student Labels, Board Access regeneration, End Board Access, Teacher deactivation, durable seven-day deletion scheduling, and retry-safe purging. HTTP routes, the fixture, the deletion sweep, live-room closure, and Yjs cache eviction now consume that Interface. The previous `boardService` lifecycle path and archive semantics were removed.

The Teacher dashboard now presents one non-expiring Personal Board and the complete Managed Board lifecycle. Link viewing and copying remain side-effect-free. Regeneration and End Board Access require explicit actions. Ended boards show their deletion countdown and expose no recovery control.

Source commits on `slice/vve-102`:

- `ae9344d` `feat(pilot): VVE-102 BoardLifecycle module with board kinds and deletion scheduling`
- `d159419` `feat(pilot): VVE-102 board routes, sweep wiring and fixture through the lifecycle interface`
- `1184354` `feat(pilot): VVE-102 teacher dashboard Soft UI for the board lifecycle`

Gate results on 2026-08-30:

- Server TypeScript build passed.
- Server vitest passed 77 of 77 tests across 10 files. The 13-case `BoardLifecycle` suite covers concurrent-safe Personal Board creation, ownership, regeneration, expiry, immediate revocation, Teacher deactivation, exact deletion scheduling, idempotent retry-safe purge, Yjs state deletion, access-log deletion, and fail-closed storage errors.
- Frontend production build passed.
- Frontend vitest passed 114 of 114 tests across 8 files.
- Playwright passed 7 of 7 tests twice in succession against the same persistent Pilot database. The repeated run proves the updated lifecycle scenario no longer inherits the earlier non-idempotent Teacher fixture.
- Built-in Browser verification passed at 1440 by 900 and 768 by 1024. Teacher dashboard, Personal Board, Managed Board card, create modal, Board Access entry, and Student board rendered without horizontal overflow or console errors.
- A clean Board Access request returns `role=student`, the immutable Public Teacher Identity, and no whole-board clear control. Opening the same board while authenticated as its Owning Teacher correctly retains Teacher authority.

Remaining work belongs to later slices: durable collaboration and restart guarantees are `VVE-103`, input hardware is `VVE-105`, asset limits are `VVE-107`, and the full capacity and destructive release profiles are `VVE-109`.
