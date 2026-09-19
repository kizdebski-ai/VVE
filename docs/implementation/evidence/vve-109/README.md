# VVE-109 production release-gate evidence

These artifacts are the reports from the completed non-smoke gates. They were
run from source commit `6ecef10` (including the production collection-schema
fixes `9db962d` and `5c24c9f`) in the isolated release-gate checkout. The gate
starts a real PostgreSQL 15 process, applies the production migrations, starts
the production backend, obtains access through the production HTTP routes, and
uses the production `connectToYjs` and `whiteboardSession` adapter.

No credentials, session cookies, access URLs, or local absolute paths are
stored in these reports.

## Completed gates

| Profile | Command | Run interval (UTC) | Result |
| --- | --- | --- | --- |
| Mature | `npm run gate:mature -- --pg-port 5517 --backend-port 8517 --report tmp/vve-109-mature-full.json` | `2026-09-18T23:55:42.964Z` – `23:56:03.153Z` | PASS |
| Destructive | `npm run gate:destructive -- --pg-port 5518 --backend-port 8518 --report tmp/vve-109-destructive-full.json` | `2026-09-18T23:56:20.778Z` – `23:56:26.879Z` | PASS |
| Change | `npm run gate:change -- --pg-port 5496 --backend-port 8496 --report tmp/vve-109-change-final.json` | `2026-09-18T23:56:48.311Z` – `2026-09-19T00:05:25.560Z` | PASS |

Mature exercised 120 canonical objects, 96 history iterations, four live
clients, PDF and image fixtures, reload, and backend restart. It acknowledged
472 operations and preserved the digest through reload and restart.

Destructive exercised 24 invalid canonical operations through the production
WebSocket boundary. All 24 were rejected; a non-`Y.Map` drawings entry was
rejected as `malformed`; malformed and oversized raw frames closed with `1008`
and `1009`; the valid write survived reload and restart.

Change acknowledged 2,000 seeded operations with four clients, three
deterministic mid-run disconnect/reconnect cycles, one backend restart, and
four equal final client digests. Blocker events, digest mismatches, and
cross-board leaks were zero. The report recorded 173,785,088 bytes maximum RSS.

The mature scenario's reorder step is a low-level valid-Yjs protocol exercise:
the current product UI exposes no reorder command. The harness clones canonical
Y.Map entries before the reorder transaction and verifies ACK/digest/reload;
this evidence must not be read as UI reorder coverage.

The three-hour 57-client soak is still running separately and is deliberately
not represented as passed evidence here.

## Artifact checksums

```text
823a605a924076b66f6f145a7e7a246eb9a9682a4de8230af1e1e604f84ae1e6  mature-full.json
df26fbc95e7c3f7f1114c56c25da436ff0a15992ba93478a3d30793dc5dd3a76  destructive-full.json
7e59baded23375f4f7a6c463da2e2ecc55e8c99329dfd3440309272762e10b6d  change-full.json
```
