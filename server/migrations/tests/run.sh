#!/usr/bin/env bash
# 로컬 임시 Postgres에서 마이그레이션과 테스트를 실행한다(운영 DB 연결 없음).
# 사용: bash server/migrations/tests/run.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; PGBIN=/usr/lib/postgresql/16/bin
DIR="${TMPDIR:-/tmp}/axis_pgtest_$$"; mkdir -p "$DIR"; chown postgres "$DIR"
cleanup(){ su postgres -c "$PGBIN/pg_ctl -D $DIR/data stop -m immediate" >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
su postgres -c "$PGBIN/initdb -D $DIR/data -A trust" >/dev/null
su postgres -c "$PGBIN/pg_ctl -D $DIR/data -o '-c listen_addresses= -c unix_socket_directories=$DIR -p 54329' -l $DIR/log -w start" >/dev/null
P="psql -h $DIR -p 54329 -U postgres -v ON_ERROR_STOP=1 -q -d postgres"
chmod -R a+rX "$HERE/.."
su postgres -c "$P -f $HERE/00_harness.sql"
su postgres -c "$P -f $HERE/../20261026_analytics.sql"
su postgres -c "$P -f $HERE/10_bind_verify.sql"
su postgres -c "$P -f $HERE/20_tests.sql" 2>&1
