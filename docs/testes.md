# Testes

Banco dedicado `casamento_test` (`TEST_DATABASE_URL` para outro). As migrações são aplicadas automaticamente.

```bash
pnpm test                          # packages/core: 51 testes (domínio financeiro, serviços com banco, convidados, WhatsApp, IA)
pnpm --filter @casa/api test       # 11 testes de segurança/autenticação via tRPC caller e better-auth
```

Cobertura: múltiplos itens, parcelas, parciais, vencimentos, cancelamentos, descontos/acréscimos, cauções e devoluções,
estornos, fluxo de caixa, idempotência e concorrência de pagamentos; telefone compartilhado, famílias, limite de acompanhantes,
confirmação/recusa, submissão duplicada, isolamento entre famílias, tokens revogados/expirados, contagem de pessoas;
Evolution indisponível, falhas e reprocessamento, eventos duplicados, webhook inválido, cancelamento, sem reenvio;
IA com dados, sem dados, fontes, propostas com aprovação, recusa de ações proibidas, prompt injection em documento, permissões;
sem login, sem permissão, outro casamento, documentos privados, elevação de privilégio, convite, reset de senha, sessão expirada.

Conta de desenvolvimento local criada no teste manual: `admin@casamento.local` (senha definida no teste; redefina pela tela de recuperação).
