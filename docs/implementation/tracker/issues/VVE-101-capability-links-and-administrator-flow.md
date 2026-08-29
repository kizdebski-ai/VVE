---
id: VVE-101
title: Capability links and Administrator flow
status: open
labels:
  - ready-for-agent
  - "implementation:ticket"
parent: VVE-001
blocked_by: [VVE-100]
architecture_slice: S1
---

# Capability links and Administrator flow

## Outcome

An Administrator signs in, creates, retrieves, regenerates, and deactivates a Teacher Access Link, and the Teacher opens the dashboard without incidental credential changes.

## Context pointer

Implement section `S1 - Capability Links and Administrator Flow` in [VVE Deep Module Design](../../../architecture/VVE-DEEP-MODULE-DESIGN.md). Use `codebase-design` for any change to the CapabilityAccess Interface or Seam.

## Resolution evidence

Return the shared HTTP and WebSocket access-decision matrix, migration evidence, Administrator and Teacher browser flows, regeneration and revocation tests, Polish error states, proof that list/view is side-effect-free, deleted legacy secret paths, and the focused commit.
