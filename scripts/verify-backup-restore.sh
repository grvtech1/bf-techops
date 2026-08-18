#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

env_value() {
  local key="$1"
  [[ -f .env ]] || return 0
  sed -n "s/^${key}=//p" .env | tail -1
}

MYSQL_DATABASE="${MYSQL_DATABASE:-$(env_value MYSQL_DATABASE)}"
MYSQL_DATABASE="${MYSQL_DATABASE:-merchant_platform}"
MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-$(env_value MYSQL_ROOT_PASSWORD)}"
MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-local-root-password}"
[[ "$MYSQL_DATABASE" =~ ^[A-Za-z0-9_]{1,64}$ ]]
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RESTORE_DATABASE="merchant_restore_$(date -u +%Y%m%d%H%M%S)"
OUT="$ROOT_DIR/evidence/runs/${STAMP}-restore-drill"
DUMP="$OUT/${MYSQL_DATABASE}.sql"
mkdir -p "$OUT"

[[ "$RESTORE_DATABASE" =~ ^merchant_restore_[0-9]{14}$ ]]

cleanup() {
  docker compose exec -T -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql \
    mysql -uroot -e "DROP DATABASE IF EXISTS \`${RESTORE_DATABASE}\`;" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker compose exec -T -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql \
  mysqladmin -uroot ping --silent

docker compose exec -T -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql \
  mysqldump -uroot --single-transaction --quick --routines --triggers \
  --set-gtid-purged=OFF --no-tablespaces "$MYSQL_DATABASE" > "$DUMP"
test -s "$DUMP"
sha256sum "$DUMP" | tee "$OUT/dump.sha256"

docker compose exec -T -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql \
  mysql -uroot -e "CREATE DATABASE \`${RESTORE_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
docker compose exec -T -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql \
  mysql -uroot "$RESTORE_DATABASE" < "$DUMP"

COUNT_QUERY="SELECT CONCAT_WS(',',
  (SELECT COUNT(*) FROM invoices),
  (SELECT COUNT(*) FROM payments),
  (SELECT COUNT(*) FROM refunds),
  (SELECT COUNT(*) FROM outbox_events),
  (SELECT COUNT(*) FROM audit_events),
  (SELECT COUNT(*) FROM schema_migrations));"

SOURCE_COUNTS=$(docker compose exec -T -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql \
  mysql -N -B -uroot "$MYSQL_DATABASE" -e "$COUNT_QUERY" | tr -d '\r')
RESTORE_COUNTS=$(docker compose exec -T -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql \
  mysql -N -B -uroot "$RESTORE_DATABASE" -e "$COUNT_QUERY" | tr -d '\r')

printf 'source=%s\nrestore=%s\n' "$SOURCE_COUNTS" "$RESTORE_COUNTS" | tee "$OUT/row-counts.txt"
test "$SOURCE_COUNTS" = "$RESTORE_COUNTS"

TRIGGER_COUNT=$(docker compose exec -T -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql \
  mysql -N -B -uroot -e "SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='${RESTORE_DATABASE}' AND EVENT_OBJECT_TABLE='audit_events';" | tr -d '\r')
test "$TRIGGER_COUNT" = "2"
printf 'audit_triggers=%s\n' "$TRIGGER_COUNT" | tee "$OUT/audit-triggers.txt"

echo "Restore drill passed. Evidence: $OUT"
