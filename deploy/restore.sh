#!/bin/sh
# Restaura um backup (formato custom do pg_dump) no banco indicado.
#   deploy/restore.sh deploy/backups/casamento-XXXX.dump "postgresql://user:pass@host:5432/casamento"
# ATENÇÃO: apaga e recria os objetos do banco de destino. Pare API e worker antes.
set -eu
DUMP="$1"; TARGET="$2"
[ -f "$DUMP" ] || { echo "Arquivo não encontrado: $DUMP"; exit 1; }
echo "SHA-256: $(shasum -a 256 "$DUMP" | cut -d' ' -f1)  (compare com o registrado em Auditoria → Backups)"
printf "Restaurar em %s? Digite RESTAURAR para continuar: " "$TARGET"; read ok
[ "$ok" = "RESTAURAR" ] || { echo "Cancelado"; exit 1; }
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$TARGET" "$DUMP"
echo "Restaurado. Rode as migrações pendentes (pnpm db:deploy) e reinicie API e worker."
