# Backup e restauração

**Backup** (`pnpm --filter @casa/db backup`, agende diariamente via cron/systemd):
`pg_dump` em formato custom → `deploy/backups/` + SHA-256 → **restauração de verificação** num banco temporário com comparação
de contagens (Wedding, lançamentos, parcelas, pagamentos, convidados, auditoria, arquivos) → registro em `BackupExecution`
(visível em Auditoria → Backups). Validado neste ambiente: backup gerado e restauração verificada (status DONE).

Copie `deploy/backups/` e o volume de arquivos (`docker run --rm -v casamento_files:/d -v $PWD:/b alpine tar czf /b/files.tgz -C /d .`) para um local externo. Guarde a MASTER_KEY separadamente.

**Restaurar**: pare API e worker, rode `deploy/restore.sh <arquivo.dump> <DATABASE_URL>` (pede confirmação digitada),
depois `pnpm db:deploy` e reinicie os serviços. Confira o SHA-256 exibido com o registrado.
