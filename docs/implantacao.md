# Implantação e configuração segura

1. Crie os segredos fora do repositório (Docker secrets):
   ```bash
   mkdir -p deploy/secrets
   for s in master_key better_auth_secret db_password; do openssl rand -hex 32 | tr -d '\n' > deploy/secrets/$s; done
   chmod 644 deploy/secrets/*   # o container roda como usuário node
   ```
   `deploy/with-secrets.sh` lê `/run/secrets/*` para variáveis do processo. Nenhum segredo vai para o front, banco em claro ou logs.
2. Ajuste `WEB_ORIGIN`, `API_URL`, `SMTP_*` em `deploy/docker-compose.prod.yml` (não secretos).
3. `docker compose -f deploy/docker-compose.prod.yml up -d --build` (`migrate` aplica as migrações antes da API/worker). Arquivos ficam no volume `files`; o `web` escuta só em `127.0.0.1:8090`.
4. TLS: adicione o bloco de `deploy/Caddyfile` ao Caddy do host (`/etc/caddy/Caddyfile`) e rode `systemctl reload caddy`.
   O nginx do `web` já envia HSTS/CSP e confia no `X-Forwarded-For` do Caddy para o IP real.
5. Acesse `/instalacao` para criar o administrador e, em seguida, configure Evolution e IA no painel.

**MASTER_KEY**: cifra os segredos de integração e os tokens de convite. Guarde-a junto com os backups; sem ela, as chaves
de integração precisam ser recadastradas e os links de convite reemitidos.

Parâmetros operacionais (prazos, limites, horário de envio, tipos de arquivo, retenção, limite de IA) ficam em
Configurações → Operacional, com histórico.
