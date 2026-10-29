/**
 * Regras financeiras puras (sem banco). Toda tela e relatório usa estas funções,
 * para que os indicadores sejam idênticos em qualquer lugar. Fórmulas documentadas
 * em docs/financeiro.md.
 */
import { multiply, sum, type Cents } from "../money.js";

export type ItemKind = "EXPENSE" | "DEPOSIT" | "ADVANCE" | "FEE" | "OTHER";
export type ItemStatus = "PLANNED" | "CONTRACTED" | "CANCELLED";
export type ObligationStatus = "DRAFT" | "ACTIVE" | "CANCELLED";
export type IncomeKind = "GIFT_CASH" | "FAMILY" | "THIRD_PARTY" | "DEPOSIT_REFUND" | "REFUND" | "CHARGEBACK" | "OTHER";
export type IncomeStatus = "PROMISED" | "EXPECTED" | "RECEIVED" | "CANCELLED";

export type ItemInput = {
  id: string;
  kind: ItemKind;
  status: ItemStatus;
  unitCents: Cents;
  quantity: number | string | { toString(): string };
  discountCents: Cents;
  surchargeCents: Cents;
  forfeitedCents?: Cents;
  categoryId?: string | null;
};

export type InstallmentInput = {
  id: string;
  itemId?: string | null;
  amountCents: Cents;
  dueDate: Date;
  cancelledAt?: Date | null;
  /** Soma das alocações de pagamentos não estornados */
  paidCents: Cents;
};

export type ObligationInput = {
  id: string;
  status: ObligationStatus;
  categoryId?: string | null;
  items: ItemInput[];
  installments: InstallmentInput[];
};

export type IncomeInput = {
  kind: IncomeKind;
  status: IncomeStatus;
  amountCents: Cents;
  expectedDate?: Date | null;
  receivedAt?: Date | null;
  depositItemId?: string | null;
};

// ───────────── Itens ─────────────

/** valor unitário × quantidade − desconto + acréscimo */
export function itemTotal(i: Pick<ItemInput, "unitCents" | "quantity" | "discountCents" | "surchargeCents">): Cents {
  const gross = multiply(i.unitCents, i.quantity);
  return gross - i.discountCents + i.surchargeCents;
}

export function validateItem(i: Pick<ItemInput, "unitCents" | "quantity" | "discountCents" | "surchargeCents">) {
  const errors: string[] = [];
  if (i.unitCents < 0) errors.push("O valor unitário não pode ser negativo");
  if (Number(i.quantity.toString()) <= 0) errors.push("A quantidade precisa ser maior que zero");
  if (i.discountCents < 0 || i.surchargeCents < 0) errors.push("Desconto e acréscimo não podem ser negativos");
  if (i.discountCents > multiply(i.unitCents, i.quantity) + i.surchargeCents) errors.push("O desconto não pode ser maior que o valor do item");
  return errors;
}

// ───────────── Parcelas ─────────────

export type InstallmentStatus = "PLANNED" | "UPCOMING" | "OVERDUE" | "PARTIAL" | "PAID" | "CANCELLED";

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/**
 * Status calculado. Nunca é gravado: depende dos pagamentos e da data de hoje.
 *  - CANCELLED: parcela cancelada
 *  - PAID: pago ≥ valor
 *  - PARTIAL: 0 < pago < valor (overdue indica se já venceu)
 *  - PLANNED: contratação ainda não fechada (rascunho)
 *  - OVERDUE: venceu sem pagamento
 *  - UPCOMING: a vencer
 */
export function installmentStatus(inst: InstallmentInput, obligationStatus: ObligationStatus, now = new Date()) {
  const remaining = Math.max(0, inst.amountCents - inst.paidCents);
  const overdue = remaining > 0 && inst.dueDate < startOfDay(now);
  let status: InstallmentStatus;
  if (inst.cancelledAt || obligationStatus === "CANCELLED") status = inst.paidCents >= inst.amountCents && inst.amountCents > 0 ? "PAID" : "CANCELLED";
  else if (inst.paidCents >= inst.amountCents) status = "PAID";
  else if (inst.paidCents > 0) status = "PARTIAL";
  else if (obligationStatus === "DRAFT") status = "PLANNED";
  else status = overdue ? "OVERDUE" : "UPCOMING";
  const open = status === "CANCELLED" || obligationStatus !== "ACTIVE" ? 0 : remaining;
  return { status, remaining: open, overdue: overdue && open > 0 };
}

/** Distribui um total em n parcelas mensais a partir de uma data */
export function buildSchedule(total: Cents, count: number, firstDue: Date, intervalMonths = 1) {
  const base = Math.trunc(total / count);
  const rest = total - base * count;
  return Array.from({ length: count }, (_, i) => {
    const due = new Date(firstDue);
    due.setMonth(due.getMonth() + i * intervalMonths);
    return { number: i + 1, amountCents: base + (i < rest ? 1 : 0), dueDate: due };
  });
}

// ───────────── Pagamentos ─────────────

export type AllocationRequest = { installmentId: string; amountCents: Cents };
export type AllocatableInstallment = { id: string; amountCents: Cents; paidCents: Cents; cancelled: boolean; obligationStatus: ObligationStatus };

/**
 * Valida a distribuição de um pagamento entre parcelas:
 * soma exata, valores positivos, sem parcela cancelada, sem pagar além do saldo.
 */
export function validateAllocations(paymentCents: Cents, allocations: AllocationRequest[], installments: AllocatableInstallment[]) {
  const errors: string[] = [];
  if (paymentCents <= 0) errors.push("O valor do pagamento precisa ser maior que zero");
  if (!allocations.length) errors.push("Informe ao menos uma parcela");
  const ids = new Set<string>();
  for (const a of allocations) {
    if (ids.has(a.installmentId)) errors.push("A mesma parcela foi informada duas vezes");
    ids.add(a.installmentId);
    const inst = installments.find((i) => i.id === a.installmentId);
    if (!inst) {
      errors.push("Parcela não encontrada");
      continue;
    }
    if (a.amountCents <= 0) errors.push("Cada alocação precisa ser maior que zero");
    if (inst.cancelled || inst.obligationStatus === "CANCELLED") errors.push("Não é possível pagar parcela cancelada");
    if (inst.obligationStatus === "DRAFT") errors.push("Feche a contratação antes de registrar pagamentos");
    const remaining = inst.amountCents - inst.paidCents;
    if (a.amountCents > remaining) errors.push(`Valor maior que o saldo da parcela (saldo: ${remaining} centavos)`);
  }
  if (sum(allocations.map((a) => a.amountCents)) !== paymentCents) errors.push("A soma das alocações precisa ser igual ao valor pago");
  return errors;
}

/** Distribui automaticamente um valor entre parcelas, da mais antiga para a mais nova */
export function autoAllocate(amountCents: Cents, installments: (AllocatableInstallment & { dueDate: Date })[]): AllocationRequest[] {
  let left = amountCents;
  const out: AllocationRequest[] = [];
  for (const i of [...installments].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())) {
    if (left <= 0) break;
    if (i.cancelled || i.obligationStatus !== "ACTIVE") continue;
    const rem = i.amountCents - i.paidCents;
    if (rem <= 0) continue;
    const take = Math.min(rem, left);
    out.push({ installmentId: i.id, amountCents: take });
    left -= take;
  }
  if (left > 0) throw new Error("O valor excede o saldo em aberto das parcelas selecionadas");
  return out;
}

// ───────────── Resumo por contratação ─────────────

export type ObligationSummary = ReturnType<typeof summarizeObligation>;

export function summarizeObligation(o: ObligationInput, refundsByItem: Map<string, Cents> = new Map(), now = new Date()) {
  const liveItems = o.status === "CANCELLED" ? [] : o.items.filter((i) => i.status !== "CANCELLED");
  const isDeposit = (i: ItemInput) => i.kind === "DEPOSIT";
  const total = (items: ItemInput[]) => sum(items.map(itemTotal));

  const planned = total(liveItems.filter((i) => !isDeposit(i)));
  const contractedItems = o.status === "ACTIVE" ? liveItems.filter((i) => i.status === "CONTRACTED") : [];
  const contracted = total(contractedItems.filter((i) => !isDeposit(i)));
  const depositsContracted = total(contractedItems.filter(isDeposit));

  const inst = o.installments.map((i) => ({ ...i, ...installmentStatus(i, o.status, now) }));
  const paid = sum(o.installments.map((i) => i.paidCents));
  const open = sum(inst.map((i) => i.remaining));
  const overdue = sum(inst.filter((i) => i.overdue).map((i) => i.remaining));
  const scheduled = sum(o.installments.filter((i) => !i.cancelledAt).map((i) => i.amountCents));

  // Cauções: pago nas parcelas dedicadas ao item − devolvido − retido
  const deposits = o.items.filter(isDeposit).map((item) => {
    const paidOnItem = sum(o.installments.filter((i) => i.itemId === item.id).map((i) => i.paidCents));
    const refunded = refundsByItem.get(item.id) ?? 0;
    const forfeited = Math.min(item.forfeitedCents ?? 0, paidOnItem);
    const pending = Math.max(0, paidOnItem - refunded - forfeited);
    return { itemId: item.id, paid: paidOnItem, refunded, forfeited, pending };
  });
  const depositPaid = sum(deposits.map((d) => d.paid));
  const depositForfeited = sum(deposits.map((d) => d.forfeited));
  const depositPending = sum(deposits.map((d) => d.pending));
  const depositRefunded = sum(deposits.map((d) => d.refunded));

  return {
    /** Previsto: itens não cancelados (sem cauções) */
    planned,
    /** Contratado: itens contratados de contratação ativa (sem cauções) */
    contracted,
    depositsContracted,
    paid,
    /** Saldo em aberto das parcelas */
    open,
    overdue,
    /** Contratado (incl. cauções) ainda sem parcela gerada */
    unscheduled: Math.max(0, contracted + depositsContracted - scheduled),
    /** Não reembolsável: contratado + cauções retidas */
    nonRefundable: contracted + depositForfeited,
    depositPaid,
    depositRefunded,
    depositForfeited,
    depositPending,
    /** Gasto efetivo: pago − cauções que ainda vão voltar ou já voltaram */
    effectiveSpent: paid - (depositPaid - depositForfeited),
    deposits,
    installments: inst,
  };
}

// ───────────── Resumo do casamento ─────────────

export type CategoryRef = { id: string; name: string; parentId: string | null; budgetCents: Cents };

export function summarizeWedding(input: {
  budgetCents: Cents;
  obligations: ObligationInput[];
  incomes: IncomeInput[];
  categories: CategoryRef[];
  guestCount?: number | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const refunds = new Map<string, Cents>();
  for (const inc of input.incomes) {
    if (inc.kind === "DEPOSIT_REFUND" && inc.status === "RECEIVED" && inc.depositItemId) {
      refunds.set(inc.depositItemId, (refunds.get(inc.depositItemId) ?? 0) + inc.amountCents);
    }
  }
  const per = input.obligations.map((o) => ({ o, s: summarizeObligation(o, refunds, now) }));
  const total = (k: keyof Omit<ObligationSummary, "deposits" | "installments">) => sum(per.map((p) => p.s[k] as number));

  const received = input.incomes.filter((i) => i.status === "RECEIVED");
  const expected = input.incomes.filter((i) => i.status === "EXPECTED" || i.status === "PROMISED");
  const incomeReceived = sum(received.map((i) => i.amountCents));
  const refundsReceived = sum(received.filter((i) => i.kind === "REFUND" || i.kind === "CHARGEBACK").map((i) => i.amountCents));
  const paid = total("paid");
  const open = total("open");
  const incomeExpected = sum(expected.map((i) => i.amountCents));

  // Por categoria: categoria do item, senão a da contratação
  const byCat = new Map<string, { planned: Cents; contracted: Cents; paid: Cents }>();
  const bump = (cat: string, k: "planned" | "contracted" | "paid", v: Cents) => {
    const row = byCat.get(cat) ?? { planned: 0, contracted: 0, paid: 0 };
    row[k] += v;
    byCat.set(cat, row);
  };
  for (const { o } of per) {
    for (const item of o.items) {
      if (item.kind === "DEPOSIT" || item.status === "CANCELLED" || o.status === "CANCELLED") continue;
      const cat = item.categoryId ?? o.categoryId ?? "none";
      const t = itemTotal(item);
      bump(cat, "planned", t);
      if (o.status === "ACTIVE" && item.status === "CONTRACTED") bump(cat, "contracted", t);
    }
    // Pagamento por categoria: parcela do item → categoria do item; parcela geral → categoria da contratação
    for (const inst of o.installments) {
      const item = o.items.find((i) => i.id === inst.itemId);
      if (item?.kind === "DEPOSIT") continue;
      bump(item?.categoryId ?? o.categoryId ?? "none", "paid", inst.paidCents);
    }
  }
  // Subcategorias somam na categoria-mãe
  const rootOf = (id: string) => {
    const c = input.categories.find((x) => x.id === id);
    return c?.parentId ?? id;
  };
  const roots = new Map<string, { planned: Cents; contracted: Cents; paid: Cents }>();
  for (const [cat, v] of byCat) {
    const r = cat === "none" ? "none" : rootOf(cat);
    const row = roots.get(r) ?? { planned: 0, contracted: 0, paid: 0 };
    row.planned += v.planned;
    row.contracted += v.contracted;
    row.paid += v.paid;
    roots.set(r, row);
  }
  const categories = input.categories
    .filter((c) => !c.parentId)
    .map((c) => {
      const v = roots.get(c.id) ?? { planned: 0, contracted: 0, paid: 0 };
      const budget = c.budgetCents + sum(input.categories.filter((s) => s.parentId === c.id).map((s) => s.budgetCents));
      return { categoryId: c.id, name: c.name, budget, ...v, overBudget: budget > 0 && Math.max(v.planned, v.contracted) > budget };
    });
  const uncategorized = roots.get("none");
  if (uncategorized && (uncategorized.planned || uncategorized.paid)) {
    categories.push({ categoryId: "none", name: "Sem categoria", budget: 0, ...uncategorized, overBudget: false });
  }

  const contracted = total("contracted");
  const effectiveSpent = total("effectiveSpent");
  const realBalance = incomeReceived - paid;
  const guests = input.guestCount && input.guestCount > 0 ? input.guestCount : null;

  return {
    budget: input.budgetCents,
    planned: total("planned"),
    contracted,
    paid,
    open,
    overdue: total("overdue"),
    unscheduled: total("unscheduled"),
    nonRefundable: total("nonRefundable"),
    depositPaid: total("depositPaid"),
    depositPending: total("depositPending"),
    depositRefunded: total("depositRefunded"),
    depositForfeited: total("depositForfeited"),
    effectiveSpent,
    /** Gasto efetivo − reembolsos/estornos recebidos */
    netSpent: effectiveSpent - refundsReceived,
    incomeReceived,
    incomeExpected,
    /** Saldo REAL: entradas recebidas − pagamentos feitos */
    realBalance,
    /** PREVISÃO: saldo real + entradas previstas − contas em aberto */
    projectedBalance: realBalance + incomeExpected - open,
    budgetRemaining: input.budgetCents - Math.max(total("planned"), contracted),
    overBudget: input.budgetCents > 0 && Math.max(total("planned"), contracted) > input.budgetCents,
    costPerGuest: guests ? Math.round(contracted / guests) : null,
    categories,
    obligations: per.map((p) => ({ id: p.o.id, ...p.s })),
  };
}

// ───────────── Fluxo de caixa projetado ─────────────

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/**
 * Projeção mensal. Saídas = saldo em aberto das parcelas pelo vencimento (vencidas entram no mês atual).
 * Entradas = previstas/prometidas pela data esperada (sem data → mês atual). Começa no saldo real.
 * Simulações (cenários) entram apenas quando passadas explicitamente.
 */
export function projectCashflow(input: {
  obligations: ObligationInput[];
  incomes: IncomeInput[];
  startBalance: Cents;
  months: number;
  now?: Date;
  simulated?: { amountCents: Cents; date: Date }[];
}) {
  const now = input.now ?? new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const keys = Array.from({ length: input.months }, (_, i) => monthKey(new Date(first.getFullYear(), first.getMonth() + i, 1)));
  const rows = new Map(keys.map((k) => [k, { month: k, outflow: 0, inflow: 0, simulated: 0 }]));
  const clamp = (d: Date) => (d < first ? keys[0]! : monthKey(d));

  for (const o of input.obligations) {
    for (const inst of o.installments) {
      const { remaining } = installmentStatus(inst, o.status, now);
      if (!remaining) continue;
      const row = rows.get(clamp(inst.dueDate));
      if (row) row.outflow += remaining;
    }
  }
  for (const inc of input.incomes) {
    if (inc.status !== "EXPECTED" && inc.status !== "PROMISED") continue;
    const row = rows.get(clamp(inc.expectedDate ?? now));
    if (row) row.inflow += inc.amountCents;
  }
  for (const s of input.simulated ?? []) {
    const row = rows.get(clamp(s.date));
    if (row) row.simulated += s.amountCents;
  }
  let balance = input.startBalance;
  let balanceWithSim = input.startBalance;
  return [...rows.values()].map((r) => {
    balance += r.inflow - r.outflow;
    balanceWithSim += r.inflow - r.outflow - r.simulated;
    return { ...r, projectedBalance: balance, projectedWithSimulation: balanceWithSim };
  });
}
