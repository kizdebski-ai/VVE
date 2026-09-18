# VVE-109 mature and destructive scenario contract

`server/scripts/pilotGateScenarios.ts` contains the bounded workload layer for
the mature-board and destructive release profiles. It receives a production
client adapter from the release harness; it does not construct a second board
model or bypass `BoardCommand`, `BoardDocument`, or the client-owned history
module.

The mature profile uses the checked-in two-page PDF and image fixtures, verifies
their file signatures, adds the canonical lesson-object families, and performs
repeated moves, resizes, style/text edits, deletes, re-adds, reorder operations,
undo/redo, peer digest convergence, and a durable rejoin. The report labels PDF
import/export as `browser-owned`: fixture bytes prove the inputs are real, while
the built-in Browser workflow remains the authority for the actual frontend
ArtifactPipeline import/export interaction.

The destructive profile uses a deterministic seed to submit malformed types,
non-finite and negative geometry, oversized text, and repeated invalid writes.
It requires each operation to be rejected without changing the acknowledged
digest, then performs one valid write and proves that it survives reload (and a
restart when the injected harness provides one).

The scenario unit tests use a structural client double only to verify orchestration
and report invariants. Release evidence must run the same functions with the
production client adapter and real PostgreSQL process supplied by the main gate.
