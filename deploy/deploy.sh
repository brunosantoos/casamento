#!/bin/sh
# Deploy disparado pelo GitHub Actions. Instalado na VPS como /usr/local/bin/casamento-deploy e amarrado
# à chave de deploy em authorized_keys (command="..."), então essa chave não roda mais nada além disto.
# Recebe o SHA esperado em SSH_ORIGINAL_COMMAND e só publica exatamente esse commit da main.
set -eu
exec 9>/var/lock/casamento-deploy.lock
flock 9

SHA="${SSH_ORIGINAL_COMMAND:-}"
case "$SHA" in
  *[!0-9a-f]* | "") echo "SHA inválido" >&2; exit 2 ;;
esac
[ ${#SHA} -eq 40 ] || { echo "SHA inválido" >&2; exit 2; }

cd /opt/casamento
git fetch --quiet origin main
git merge-base --is-ancestor "$SHA" origin/main || { echo "$SHA não está na main" >&2; exit 3; }
git checkout --quiet --detach "$SHA"

echo "==> Publicando $(git log -1 --format='%h %s')"
docker compose -f deploy/docker-compose.prod.yml up -d --build --remove-orphans
docker image prune -f >/dev/null

for i in $(seq 1 30); do
  curl -fsS http://127.0.0.1:8090/health >/dev/null 2>&1 && { echo "==> No ar"; exit 0; }
  sleep 2
done
docker compose -f deploy/docker-compose.prod.yml ps -a
docker compose -f deploy/docker-compose.prod.yml logs --tail 50 api migrate
exit 1
