# Financeiro — regras e fórmulas

Implementação: `packages/core/src/finance/domain.ts` (funções puras) e `service.ts` (transações). Testes: `test/finance-*.test.ts`.

## Conceitos

- **Lançamento (contratação)**: agrupa itens independentes. Status: `DRAFT` (cotação), `ACTIVE` (contratado), `CANCELLED`.
  Ao fechar a contratação, itens previstos viram contratados.
- **Item**: `valor unitário × quantidade − desconto + acréscimo`, arredondado ao centavo (half-up, inteiros). Tipos: despesa,
  **caução** (reembolsável), adiantamento, taxa, outro.
- **Parcela**: valor e vencimento; opcionalmente dedicada a um item (cauções sempre em parcela própria).
- **Pagamento**: liquidação real (valor, data, forma, referência, comprovante) distribuída explicitamente entre parcelas
  (`PaymentAllocation`). Não existe "marcar como pago" sem pagamento.
- **Entrada**: prometida, prevista ou recebida. Devolução de caução é uma entrada vinculada ao item da caução.

## Status da parcela (calculado, nunca gravado)

| Status | Regra |
|---|---|
| Cancelado | parcela cancelada ou lançamento cancelado (sem pagamento) |
| Pago | pago ≥ valor |
| Parcialmente pago | 0 < pago < valor (sinaliza vencida se passou do prazo) |
| Previsto | lançamento em rascunho |
| Vencido | sem pagamento e vencimento < hoje |
| A vencer | demais casos |

## Indicadores

| Indicador | Fórmula |
|---|---|
| Previsto | Σ itens não cancelados (sem cauções) de lançamentos não cancelados |
| Contratado | Σ itens contratados de lançamentos ativos (sem cauções) |
| Pago | Σ alocações de pagamentos não estornados |
| Em aberto | Σ (valor − pago) das parcelas não canceladas de lançamentos ativos |
| Vencido | parte do "em aberto" com vencimento < hoje |
| Sem parcela | (contratado + cauções contratadas) − Σ parcelas não canceladas |
| Caução a recuperar | pago na parcela da caução − devolvido (entradas recebidas) − retido |
| Não reembolsável | contratado + cauções retidas |
| Gasto efetivo | pago − (cauções pagas − retidas) |
| Gasto líquido | gasto efetivo − reembolsos/estornos recebidos |
| **Saldo real** | entradas recebidas − pagamentos |
| **Saldo projetado (previsão)** | saldo real + entradas previstas/prometidas − em aberto |
| Custo por convidado | contratado ÷ pessoas confirmadas (ou estimativa, se ainda não houver confirmações) |

Por categoria: usa a categoria do item; se ausente, a do lançamento. Subcategorias somam na categoria-mãe.

## Fluxo de caixa

Mês a mês a partir do saldo real: saídas = saldo em aberto das parcelas pelo vencimento (vencidas entram no mês atual);
entradas = previstas/prometidas pela data esperada. Cenários (simulações) aparecem numa linha separada e nunca afetam os totais reais.

## Consistência e concorrência

- `registerPayment`: chave de idempotência única (duplo clique devolve o mesmo pagamento), `SELECT … FOR UPDATE` nas parcelas
  e validação de saldo dentro da transação — pagamentos concorrentes não ultrapassam o saldo (teste com 3 pagamentos simultâneos).
- Estorno mantém o pagamento no histórico com motivo; parcela com pagamento não pode ser cancelada nem reduzida abaixo do pago.
- Cancelamento de lançamento exige motivo; lançamento com pagamento não volta para rascunho sem estorno.
- Toda alteração relevante gera `AuditLog` com resumo e valores antes/depois.
