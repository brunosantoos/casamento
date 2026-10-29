# Nosso Casamento — gestão completa do planejamento

Sistema web (painel + portal público de convidados) para planejar um casamento de ponta a ponta:
financeiro com múltiplos itens, parcelas, pagamentos, cauções e fluxo de caixa; checklist em 9 fases;
calendário consolidado; igreja/cerimônia e recepção; fornecedores, orçamentos e contratos; convidados por
família com confirmação segura; WhatsApp (Evolution API) com fila persistente; galeria; assistente de IA com
aprovação humana; relatórios, auditoria, permissões granulares e LGPD.

## Stack (monorepo pnpm, sem Next)

| Pasta | O que é |
|---|---|
| `apps/web` | Vite + React 19 + Tailwind 4 + shadcn/ui (layout baseado no `whatsapp-ai`), tRPC client, better-auth client |
| `apps/api` | Express 5 + tRPC 11 + better-auth (e-mail/senha), uploads, downloads assinados, exportações, webhook |
| `apps/worker` | Fila persistente no Postgres (`SKIP LOCKED`): envios de WhatsApp, análise de documentos, lembretes, retenção |
| `packages/core` | Regras de negócio (financeiro em centavos, permissões, auditoria, convidados, WhatsApp, IA, arquivos) |
| `packages/db` | Prisma + PostgreSQL (schema, migrações, backup) |

## Rodando em desenvolvimento

```bash
pnpm install
cp .env.example .env          # preencha DATABASE_URL, BETTER_AUTH_SECRET e MASTER_KEY (openssl rand -hex 32)
pnpm db:deploy                # aplica as migrações
pnpm dev                      # API :4100, web :5190, worker
```

Opcional: `pnpm infra:up` sobe Postgres, MinIO, Evolution API e Mailpit via Docker.
Abra http://localhost:5190/instalacao para criar o administrador (só funciona com o banco vazio; depois, acesso só por convite).

Testes: `pnpm test` (core) e `pnpm --filter @casa/api test` — usam o banco `casamento_test` (ver `docs/testes.md`).

## Documentação

- [Arquitetura](docs/arquitetura.md)
- [Financeiro: regras e fórmulas](docs/financeiro.md)
- [Integrações: Evolution API e IA](docs/integracoes.md)
- [Implantação e configuração segura](docs/implantacao.md)
- [Backup e restauração](docs/backup-e-restauracao.md)
- [Segurança e LGPD](docs/seguranca-lgpd.md)
- [Testes](docs/testes.md)
- [Funcionalidades e limitações](docs/status.md)
