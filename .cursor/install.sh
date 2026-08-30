#!/usr/bin/env bash
# Idempotent repository bootstrap for the WhiteVue Cloud Agent environment.
# Installs system + project dependencies and prepares local dev configuration.
# Per-boot runtime work (starting Postgres, running migrations, launching dev
# servers) lives in start.sh / terminals, NOT here.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Installing PostgreSQL (system package)"
if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-contrib
else
  echo "    PostgreSQL already installed, skipping."
fi

echo "==> Installing server dependencies"
( cd server && npm install )

echo "==> Installing frontend dependencies"
( cd frontend && npm install )

echo "==> Ensuring server/.env exists"
if [ ! -f server/.env ]; then
  cp server/.env.example server/.env
  # Point the app at the local dev Postgres and provide dev-only secrets.
  {
    echo ""
    echo "# --- Local dev overrides (added by .cursor/install.sh) ---"
    echo "NODE_ENV=development"
    echo "DATABASE_URL=postgresql://postgres:postgres_password@localhost:5432/whitevue"
    echo "TEACHER_APP_BASE_URL=http://localhost:5173"
    echo "TEACHER_SESSION_SECRET=dev-teacher-session-secret"
    echo "BOARD_WS_SECRET=dev-ws-secret"
    echo "STUDENT_TOKEN_SECRET=dev-student-secret"
    echo "ADMIN_SECRET=dev-admin-secret"
  } >> server/.env
  echo "    Created server/.env (set OPENROUTER_API_KEY via Secrets to enable AI features)."
else
  echo "    server/.env already exists, leaving it untouched."
fi

echo "==> install.sh complete"
