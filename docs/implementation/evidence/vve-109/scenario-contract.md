# VVE-109 mature and destructive scenario contract

`server/scripts/pilotGateScenarios.ts` contains the bounded workload layer for
the mature-board and destructive release profiles. It receives a production
client adapter from the release harness; it does not construct a second board
model or bypass `BoardCommand`, `BoardDocument`, or the client-owned history
module.

The mature pre-telemetry preset is bounded at 120 canonical objects and 96
history iterations. It uses the checked-in two-page PDF and image fixtures,
verifies their file signatures, records raw and encoded image bytes plus
canonical object and snapshot byte counts, and performs repeated moves, resizes, style/text edits, deletes,
re-adds, reorder operations, undo/redo, peer digest convergence, a durable
rejoin, and a controlled backend restart. The rejoin and post-restart clients
must reach an editable synchronized state within the 5 s mature-board target.
These are workload bounds, not a
claim about a measured year of production history or a p95 distribution.
The report labels PDF import/export as `browser-owned`: fixture bytes prove the
inputs are real, while the built-in Browser workflow remains the authority for
the actual frontend ArtifactPipeline import/export interaction. Every gate
report carries `notCovered.artifactImportExport: "browser-owned"` instead of
claiming complete coverage.

The destructive profile derives its invalid objects from `SCENE_LIMITS`: an
unknown type, out-of-range or non-finite coordinates, oversized text, and
negative, non-finite, or oversized dimensions. Each block of six operations is
a seeded permutation of all six cases with seeded values. Every invalid object
goes to the server through `submitInvalidObject`, bypassing local validation,
so each counted rejection is a server denial. A typed `ScenarioCommandDenied`
is accepted when an adapter throws; unexpected adapter errors propagate and
fail the gate. A fresh client then reloads server state and must match the
digest from before the invalid writes. The profile performs valid writes and
proves them against a fresh reload and again after a controlled backend
restart.

The scenario unit tests use a structural client double only to verify orchestration
and report invariants. Release evidence must run the same functions with the
production client adapter and real PostgreSQL process supplied by the main gate.
