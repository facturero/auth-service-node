#!/usr/bin/env bash
# Prueba la migración 20261006000000-split-user-identification-type contra un MySQL 9 REAL (Docker):
# migra hasta justo antes, inserta usuarios con los formatos mezclados de `identification`, migra y comprueba el resultado,
# y verifica que deshacer y rehacer funciona. Si la migración falla en producción, el despliegue se queda en
# Init:CrashLoopBackOff, por eso se prueba con datos de verdad y no solo con la lógica.
#
#   bash scripts/test-migration-identification.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if command -v cygpath >/dev/null 2>&1; then host="$(cygpath -m "$here")"; else host="$here"; fi
NET="mig-test-net-$$"; DB="mig-test-mysql-$$"
cleanup() { docker rm -f "$DB" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker network create "$NET" >/dev/null
docker run -d --name "$DB" --network "$NET" -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=auth_db mysql:9.0 >/dev/null
echo "esperando MySQL…"
for i in $(seq 1 60); do
  docker exec "$DB" mysqladmin ping -uroot -proot --silent >/dev/null 2>&1 && break
  sleep 2
done
sql() { docker exec -i "$DB" mysql -uroot -proot auth_db -N -e "$1" 2>/dev/null; }

cli() {
  MSYS_NO_PATHCONV=1 docker run --rm --network "$NET" -v "${host}:/src:ro" \
    -e DB_HOST="$DB" -e DB_USER=root -e DB_PASSWORD=root -e DB_NAME=auth_db node:22-bookworm-slim \
    bash -c "mkdir /work && cd /src && tar cf - --exclude=node_modules --exclude=dist . | tar xf - -C /work && cd /work && ln -s /src/node_modules node_modules && node node_modules/sequelize-cli/lib/sequelize $*"
}

echo "== migrando hasta antes de la prueba =="
cli db:migrate --to 20261005200000-add-pos-access-permission.js 2>&1 | tail -3

echo "== insertando usuarios con formatos mezclados =="
ins() { sql "INSERT INTO users (id, email, username, identification, status, is_platform_admin, permissions_version, created_at, updated_at) VALUES ('$1', '$2', '$3', $4, 'active', 0, 0, NOW(), NOW());"; }
ins u1 a@t.ec USR0001 "'cedula:1710034065'"
ins u2 b@t.ec USR0002 "'ruc:1790011674001'"
ins u3 c@t.ec USR0003 "'0912345678'"
ins u4 d@t.ec USR0004 "'cedula:0999999999'"
ins u5 e@t.ec USR0005 "'0999999999'"
ins u6 f@t.ec USR0006 "'passport:AB1234567'"
ins u7 g@t.ec USR0007 "NULL"

echo "== migración nueva =="
cli db:migrate 2>&1 | grep -E "identification|migrated|ERROR" | head -12

echo "== resultado (id | identification | identification_type) =="
sql "SELECT id, IFNULL(identification,'NULL'), IFNULL(identification_type,'NULL') FROM users ORDER BY id;"

fail=0
check() { # id esperado_ident esperado_tipo
  got="$(sql "SELECT CONCAT(IFNULL(identification,'NULL'),'|',IFNULL(identification_type,'NULL')) FROM users WHERE id='$1';")"
  if [ "$got" = "$2|$3" ]; then echo "OK   $1 -> $got"; else echo "FALLA $1: esperaba $2|$3 y hay $got"; fail=1; fi
}
check u1 1710034065 cedula
check u2 1790011674001 ruc
check u3 0912345678 NULL
check u4 cedula:0999999999 NULL      # choca con u5: se deja con prefijo
check u5 0999999999 NULL
check u6 AB1234567 passport
check u7 NULL NULL

echo "== deshacer y rehacer =="
cli db:migrate:undo 2>&1 | tail -1
sql "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='auth_db' AND table_name='users' AND column_name='identification_type';" | sed 's/^/columna identification_type tras deshacer: /'
cli db:migrate 2>&1 | grep -E "identification|migrated|ERROR" | head -4
check u1 1710034065 cedula

[ "$fail" = 0 ] && echo "TODO BIEN" || { echo "HAY FALLOS"; exit 1; }
