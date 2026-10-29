# Arquitetura

```
navegador ──► nginx (web) ──► /trpc, /api, /webhooks ──► API (Express + tRPC + better-auth)
                                                           │
                         Evolution API ◄──── worker ◄──── Postgres (dados, fila "Job", rate limit)
                         Provedor de IA ◄────┘            MinIO/S3 (arquivos privados)
```

## Princípios

- **Regras no backend.** Cada procedure tRPC passa por `perm("modulo:acao")` (apps/api/src/trpc.ts), que carrega o
  membro do casamento ativo e suas permissões efetivas (perfil + concessões − revogações). O front só esconde botões.
- **Isolamento por casamento.** Toda consulta filtra por `weddingId` do contexto; IDs de outro casamento retornam
  NOT_FOUND (anti-IDOR). Testado em `apps/api/test/security.test.ts`.
- **Serviços de domínio no `packages/core`**, independentes de HTTP: a API, o worker e os testes usam as mesmas funções.
- **Dinheiro em centavos inteiros** e cálculos puros em `core/src/finance/domain.ts` (ver docs/financeiro.md).
- **Auditoria append-only** (`AuditLog`) com usuário, origem (web/portal/ai/webhook/worker), correlação e resumo das mudanças,
  com redação de campos sensíveis (`core/src/audit.ts`).
- **Fila persistente no Postgres** (`Job`), sem Redis: `FOR UPDATE SKIP LOCKED`, tentativas com backoff exponencial,
  chaves únicas para idempotência.

## Modelo de dados (resumo)

`packages/db/prisma/schema.prisma` — principais grupos:

- Identidade: `User`, `Session`, `Account`, `Verification` (better-auth), `Role`, `WeddingMember` (grants/revokes), `Invitation`.
- Casamento: `Wedding`, `WeddingSetting` + `SettingChange` (histórico), `SystemSetting`.
- Financeiro: `FinancialCategory` (com orçamento e subcategorias), `FinancialObligation` (contratação) → `ObligationItem`
  (despesa/caução/adiantamento/taxa) → `Installment` ← `PaymentAllocation` → `Payment`; `Income` (entradas, devoluções),
  `BudgetScenario` (simulações).
- Fornecedores: `Vendor`, `VendorContact`, `VendorQuote(+Item)`, `VendorContract`, `ContractObligation`, `VendorInteraction`, `VendorDelivery`.
- Planejamento: `Task` (+ assignees, dependências, comentários), `ChecklistTemplate(+Item)`, `CalendarEvent`, `Reminder`.
- Evento: `Ceremony`, `CeremonyParticipant`, `ReceptionVenue`, `EventScheduleItem`.
- Convidados: `GuestGroup` (família = unidade do convite), `Guest`, `GuestCompanion`, `GuestInvitation` (token aleatório), `Rsvp` (histórico).
- Mensagens: `Integration` + `IntegrationSecret` (cifrado), `WhatsAppInstance`, `MessageTemplate`, `MessageCampaign`,
  `OutboundMessage`, `MessageAttempt`, `InboundMessage`, `WebhookEvent`, `Job`.
- Arquivos e IA: `FileAsset`, `FileVersion`, `PhotoAlbum(+Item)`, `DocumentAnalysis(+Finding)`, `AIConversation`, `AIMessage`,
  `AIActionProposal`, `AIUsage`.
- Governança: `AuditLog`, `SecurityEvent`, `DataExportRequest`, `DataDeletionRequest`, `BackupExecution`, `RateLimitBucket`.

Decisões: cobranças da igreja/recepção NÃO são campos próprios — vêm do financeiro pelo fornecedor vinculado (sem duplicar valores).
A agenda é montada a partir das fontes (eventos, prazos de tarefas, vencimentos, entregas, cláusulas) — cada item aparece uma vez.
Registros financeiros não são apagados: cancelamento e estorno preservam o histórico (`onDelete: Restrict`).
