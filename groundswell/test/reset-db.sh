#!/usr/bin/env bash
# Recreate the local test database from the migrations. Usage: reset-db.sh [port]
set -euo pipefail
PORT=${1:-54329}
HERE=$(cd "$(dirname "$0")" && pwd)
P="psql -h 127.0.0.1 -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "drop database if exists gs_test with (force)" -c "create database gs_test"
$P -d gs_test -f "$HERE/supabase-stubs.sql"
for f in "$HERE"/../supabase/migrations/*.sql; do
  head -1 "$f" | grep -q '^-- supabase-only' && continue   # needs pg_cron/pg_net, not in plain Postgres
  $P -d gs_test -f "$f"
done
