#!/usr/bin/env bash
# Local PostgreSQL 16 for development and integration tests.
#
# Everything lives in .pgdata/ inside the repo (gitignored) and listens on a unix
# socket in the same directory, so this never collides with a system Postgres and
# needs no root. `down` stops it; `nuke` deletes the cluster entirely.
#
# Docker alternative, if you would rather not run a local cluster:
#   docker run --rm -d --name awc-pg -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:16
#   DATABASE_URL="postgresql://postgres:postgres@localhost:5433/awc?schema=public"
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGDATA="$ROOT/.pgdata/cluster"
SOCKET="$ROOT/.pgdata/socket"
LOGFILE="$ROOT/.pgdata/postgres.log"
PORT="${PGPORT:-5433}"
DB_NAME="${PGDATABASE:-awc_dev}"

# Debian/Ubuntu keep the server binaries off PATH; find the newest version present.
find_bindir() {
  if command -v pg_ctl >/dev/null 2>&1; then dirname "$(command -v pg_ctl)"; return; fi
  local dir
  dir="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  if [ -n "$dir" ]; then echo "$dir"; return; fi
  echo "PostgreSQL server binaries not found (looked for pg_ctl and /usr/lib/postgresql/*/bin)." >&2
  exit 1
}
BIN="$(find_bindir)"

# initdb refuses to run as root, so when this is invoked as root we do the work as an
# unprivileged user. Containers and CI images commonly run as root; laptops do not.
AS_USER=""
if [ "$(id -u)" = "0" ]; then
  RUNAS="${PG_RUNAS_USER:-postgres}"
  id "$RUNAS" >/dev/null 2>&1 || useradd -m "$RUNAS"
  mkdir -p "$ROOT/.pgdata"
  chown -R "$RUNAS" "$ROOT/.pgdata"
  AS_USER="$RUNAS"
fi

run() {
  if [ -n "$AS_USER" ]; then su "$AS_USER" -s /bin/bash -c "$1"; else bash -c "$1"; fi
}

case "${1:-up}" in
  up)
    mkdir -p "$SOCKET"
    [ -n "$AS_USER" ] && chown -R "$AS_USER" "$ROOT/.pgdata"
    if [ ! -d "$PGDATA" ]; then
      echo "Creating cluster in .pgdata/cluster ..."
      run "'$BIN/initdb' -D '$PGDATA' -U postgres --auth=trust --encoding=UTF8 >/dev/null"
    fi
    if run "'$BIN/pg_ctl' -D '$PGDATA' status" >/dev/null 2>&1; then
      echo "Already running."
    else
      run "'$BIN/pg_ctl' -D '$PGDATA' -l '$LOGFILE' -o \"-p $PORT -k '$SOCKET' -c listen_addresses='127.0.0.1'\" -w start" >/dev/null
      echo "Started on port $PORT."
    fi
    run "'$BIN/createdb' -h 127.0.0.1 -p $PORT -U postgres '$DB_NAME'" 2>/dev/null \
      && echo "Created database $DB_NAME." || true
    run "'$BIN/createdb' -h 127.0.0.1 -p $PORT -U postgres '${DB_NAME}_test'" 2>/dev/null \
      && echo "Created database ${DB_NAME}_test." || true
    echo
    echo "DATABASE_URL=\"postgresql://postgres@127.0.0.1:$PORT/$DB_NAME?schema=public\""
    ;;
  down)
    run "'$BIN/pg_ctl' -D '$PGDATA' -m fast -w stop" >/dev/null 2>&1 && echo "Stopped." || echo "Not running."
    ;;
  status)
    run "'$BIN/pg_ctl' -D '$PGDATA' status" || true
    ;;
  nuke)
    run "'$BIN/pg_ctl' -D '$PGDATA' -m immediate -w stop" >/dev/null 2>&1 || true
    rm -rf "$ROOT/.pgdata"
    echo "Cluster deleted."
    ;;
  *)
    echo "usage: dev-db.sh [up|down|status|nuke]" >&2
    exit 1
    ;;
esac
