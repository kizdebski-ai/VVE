# Railway deployment configuration

The Pilot deployment has one backend service and one static frontend service. The
backend Dockerfile runs the RuntimeControl process directly; it applies the
PostgreSQL migrations before it reports readiness. The frontend Dockerfile runs
nginx and proxies `/api/`, `/ws/`, and `/teacher/login` to the backend.

## Backend service

Create the service from `server/` with `server/Dockerfile`. Railway supplies
`PORT`; the image listens on `HOST=0.0.0.0` and runs `node dist/src/server.js`.
The process owns startup, migrations, liveness, readiness, and bounded shutdown.
Leave the Railway start command empty: an override such as `npm run start:prod`
adds a second, CLI-driven migration run before the process that already
migrates. Attach a volume at `/data` for the file-backed rooms.

Set these production variables in the backend service:

| Variable | Required | Purpose |
| --- | --- | --- |
| `NODE_ENV=production` | yes | Selects the fail-closed Pilot surface and production secret checks. |
| `DATABASE_URL` | yes | Railway PostgreSQL connection string. |
| `ADMIN_PASSPHRASE` | yes | Shared administrator passphrase exchanged for a signed HttpOnly session. It is accepted only in `POST /api/admin/session`. |
| `TEACHER_SESSION_SECRET` | yes | Signs Teacher sessions and is also the fallback for board credentials. Use a high-entropy value. |
| `ADMIN_SESSION_SECRET` | recommended | Signs administrator sessions with a separate key. If omitted, the configured Teacher session secret is used. |
| `BOARD_WS_SECRET` | recommended | Signs scoped board WebSocket credentials. If omitted, the Teacher session secret is used. |
| `TEACHER_APP_BASE_URL` | yes for public links | Public frontend origin used when generating Teacher and Board links. |
| `CORS_ORIGIN` | when frontend is a different origin | Exact frontend origin allowed by the backend. Leave unset when nginx proxies same-origin requests. |

Railway also supplies `PORT`. `HOST` defaults to `0.0.0.0` and `DATA_DIR`
defaults to the process data directory; the managed-board path persists in
PostgreSQL. `VVE_PILOT_SURFACE` is only a local-pilot override and should not
be set in production.

`OPENROUTER_API_KEY` is optional. Without it, AI routes remain unavailable;
the Pilot surface does not require an AI credential. Optional `AI_BOARD_ASSISTANT_ENABLED`
and `VVE_*` resource-limit variables are accepted only when an operator has
measured a reason to override the code defaults. Never put secrets in frontend
build arguments, `VITE_*` variables, URLs, or query strings.

The local `server/.env.example` and `docker-compose.yml` are for development
only: compose refuses to start until `ADMIN_PASSPHRASE` and
`TEACHER_SESSION_SECRET` are exported, and its database password is a
loopback-only placeholder. Replace every secret
before a production start; RuntimeControl fails closed when required values are
missing or still use a production fallback.

## Frontend service

Build the service with `frontend/Dockerfile` from the **repository root**
(Railway root directory `/`, Dockerfile path `frontend/Dockerfile`): the
frontend imports the shared `server/src/pilot` modules through the `@pilot`
alias, so a `frontend/`-only build context cannot compile. Set the runtime
`BACKEND_URL` to the backend URL (its private `http://<service>.railway.internal:<port>`
address, or its public HTTPS domain). The image listens on the Railway-provided `PORT` and nginx
uses `BACKEND_URL` for API, WebSocket, and Teacher-login proxying.

`VITE_BACKEND_URL` is an optional build argument for local/static builds. It is
not a credential and must not contain an administrator or session secret. No
administrator secret is built into the frontend.

## Health and administration endpoints

Configure the Railway health check against `GET /health`. It returns 200 only
after the database and collaboration persistence probes pass, and 503 during
startup, failed probes, or drain. `GET /live` is the liveness check and remains
available while the process drains. `GET /ready` is public and returns only
`live`, `ready`, `status`, and boolean `checks`; it never exposes runtime
metrics.

Runtime metrics are available only at `GET /api/admin/runtime` after the
administrator has exchanged the passphrase for the HttpOnly session cookie. The
response is `no-store` and contains the content-free `soak` snapshot. Teacher
management endpoints under `/api/admin/teachers` use the same server-side
administrator session guard.

## Operational checklist

- [ ] Backend service uses `server/Dockerfile`, has no start-command override, and mounts a volume at `/data`.
- [ ] Frontend service builds `frontend/Dockerfile` from the repository root.
- [ ] `DATABASE_URL`, `ADMIN_PASSPHRASE`, and `TEACHER_SESSION_SECRET` are set to high-entropy production values.
- [ ] `ADMIN_SESSION_SECRET` and `BOARD_WS_SECRET` are set separately where operationally possible.
- [ ] `TEACHER_APP_BASE_URL` matches the public frontend origin.
- [ ] Frontend `BACKEND_URL` points to the backend service; no secret is passed as a `VITE_*` value.
- [ ] Railway health check uses `/health`, not the protected admin metrics route.
- [ ] A controlled restart is performed outside an active lesson and the acknowledged-change recovery gate is recorded.
