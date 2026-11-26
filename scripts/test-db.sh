#!/usr/bin/env bash
# Applies the migrations to a throwaway local Postgres database and runs the schema tests.
# Needs psql and a Postgres server you can create databases on (PGHOST/PGUSER etc. as usual).
set -euo pipefail
cd "$(dirname "$0")/.."
DB="expresscash_test_$$"
createdb "$DB"
trap 'dropdb --if-exists "$DB"' EXIT
psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "create extension if not exists pgcrypto" -f supabase/tests/supabase_stub.sql
for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"; done
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/schema_test.sql
