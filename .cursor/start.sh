#!/usr/bin/env bash
# Per-boot runtime initialization for the WhiteVue Cloud Agent environment.
# Starts PostgreSQL, ensures the dev database exists, and applies migrations.
# Idempotent: safe to run on every boot.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PG_USER=postgres
PG_PASSWORD=postgres_password
PG_DB=whitevue
DATABASE_URL="postgresql://${PG_USER}:${PG_PASSWORD}@localhost:5432/${PG_DB}"

echo "==> Starting PostgreSQL cluster"
if sudo pg_lsclusters -h 2>/dev/null | grep -q "online"; then
  echo "    Cluster already online."
else
  sudo pg_ctlcluster 16 main start
  # Wait until the server accepts connections.
  for _ in $(seq 1 30); do
    if sudo -u postgres pg_isready -q; then break; fi
    sleep 1
  done
fi

echo "==> Ensuring role password and database exist"
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER USER ${PG_USER} WITH PASSWORD '${PG_PASSWORD}';" >/dev/null
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${PG_DB}'" | grep -q 1; then
  sudo -u postgres createdb "${PG_DB}"
  echo "    Created database ${PG_DB}."
else
  echo "    Database ${PG_DB} already exists."
fi

echo "==> Applying database migrations"
( cd server && DATABASE_URL="${DATABASE_URL}" npx knex migrate:latest \
    --client pg \
    --connection "${DATABASE_URL}" \
    --migrations-directory ./migrations-js )

echo "==> start.sh complete: Postgres ready on localhost:5432, database '${PG_DB}' migrated."
