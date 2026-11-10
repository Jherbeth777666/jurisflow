#!/usr/bin/env bash
# Cria um banco temporário, aplica stub do Supabase + migrations + testes RLS.
# Uso: DATABASE_URL=postgres://... ./supabase/tests/run_local.sh   (ou PG* padrão)
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB="${TEST_DB:-jurisflow_test}"
PSQL="psql -v ON_ERROR_STOP=1 -q -X"
$PSQL -d postgres -c "drop database if exists $DB" -c "create database $DB"
$PSQL -d "$DB" -f "$DIR/tests/local_supabase_stub.sql"
for f in "$DIR"/migrations/*.sql; do
  echo "→ migration $(basename "$f")"
  $PSQL -d "$DB" -f "$f"
done
for f in "$DIR"/tests/*_test.sql; do
  [ -e "$f" ] || continue
  echo "→ teste $(basename "$f")"
  $PSQL -d "$DB" -f "$f"
done
echo "✔ Todas as migrations e testes passaram."
