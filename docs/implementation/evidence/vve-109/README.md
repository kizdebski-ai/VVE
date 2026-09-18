# VVE-109 release-gate harness

`server/scripts/pilotReleaseGate.ts` is the executable S9 harness. It starts a
dedicated PostgreSQL 15 container on port `5497`, lets the production process
adapter run migrations and readiness probes, creates real capability links
through the HTTP API, and connects Node WebSocket clients to the managed-board
endpoint. Clients maintain a Yjs document behind the canonical server
`BoardDocument` interface and compare acknowledgement, peer, reload, and
post-restart digests. Change, soak, and stress use the shipped frontend
`connectToYjs` module through a Vite SSR loader with injected browser globals;
destructive keeps a raw protocol client for malformed-frame testing. The
harness never uses the in-memory store or a
`getMap('lesson')` test document.

## Commands

Run from `server/`:

```sh
npm run gate:smoke
npm run gate:change
npm run gate:mature
npm run gate:destructive
npm run gate:soak
npm run gate:stress
```

The smoke command is bounded and is the fast wiring check. `gate:soak` is the
release gate: it runs 22 Managed Boards with 22 Teachers and 35 Students for
three hours, sends seeded operations through the production client adapter,
samples `/ready`, performs a controlled backend restart while keeping clients
alive for the adapter's draining/reconnect path, and fails on digest
divergence, cross-board content, readiness errors, or an unready backend. The
backend's production heartbeat path remains active during the run. It does not
silently shorten the three-hour duration. Use `--smoke` explicitly for a short
capacity smoke run.

`gate:change` is also a non-smoke gate: it runs for at least five minutes and
performs at least 1,000 canonical operations. The mature and destructive
profiles currently provide bounded smoke coverage only; their non-smoke
reports are labelled `smoke-only` and fail the release assertion until their
full artifact import and destructive matrix is implemented.

The mature smoke profile reads the checked-in PDF and PNG fixtures and adds
canonical lesson objects, images, graph objects, and history. The destructive
smoke profile exercises malformed input while asserting that readiness and
existing state remain available. The optional stress profile connects 88 clients (one Teacher
and three Students on each board) and records safe-overload behavior.

Every profile fails loudly when Docker/PostgreSQL, migrations, the production
backend, capability flow, or fixture files are unavailable. Reports are JSON
artifacts under `server/tmp/` when invoked through the package scripts. The
three-hour soak, built-in Browser matrix, and hardware checks remain separate
observations and must not be marked complete from a smoke result.
