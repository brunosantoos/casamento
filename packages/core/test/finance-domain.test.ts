import { describe, expect, it } from "vitest";
import {
  autoAllocate,
  buildSchedule,
  installmentStatus,
  itemTotal,
  projectCashflow,
  summarizeObligation,
  summarizeWedding,
  validateAllocations,
  validateItem,
  type ObligationInput,
} from "../src/finance/domain.js";
import { multiply, parseBRL, splitEvenly } from "../src/money.js";

const d = (s: string) => new Date(`${s}T12:00:00`);
const NOW = d("2026-06-15");

/** Exemplo do enunciado: igreja com reserva, celebração, caução e taxa extra */
function church(overrides: Partial<ObligationInput> = {}): ObligationInput {
  return {
    id: "church",
    status: "ACTIVE",
    categoryId: "cat-church",
    items: [
      { id: "reserva", kind: "EXPENSE", status: "CONTRACTED", unitCents: 20000, quantity: 1, discountCents: 0, surchargeCents: 0 },
      { id: "celebracao", kind: "FEE", status: "CONTRACTED", unitCents: 70000, quantity: 1, discountCents: 0, surchargeCents: 0 },
      { id: "caucao", kind: "DEPOSIT", status: "CONTRACTED", unitCents: 20000, quantity: 1, discountCents: 0, surchargeCents: 0 },
      { id: "extra", kind: "FEE", status: "CONTRACTED", unitCents: 10000, quantity: 1, discountCents: 0, surchargeCents: 0 },
    ],
    installments: [
      { id: "p1", itemId: "reserva", amountCents: 20000, dueDate: d("2026-05-01"), paidCents: 20000 },
      { id: "p2", itemId: "caucao", amountCents: 20000, dueDate: d("2026-05-01"), paidCents: 20000 },
      { id: "p3", itemId: null, amountCents: 80000, dueDate: d("2026-07-01"), paidCents: 0 },
    ],
    ...overrides,
  };
}

describe("dinheiro", () => {
  it("multiplica sem ponto flutuante e arredonda half-up", () => {
    expect(multiply(1999, "2.5")).toBe(4998); // 49,975 → 49,98
    expect(multiply(333, 3)).toBe(999);
    expect(multiply(10, "0.333")).toBe(3);
    expect(0.1 + 0.2).not.toBe(0.3); // por isso usamos centavos
  });
  it("divide em parcelas sem perder centavos", () => {
    expect(splitEvenly(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitEvenly(10000, 3).reduce((a, b) => a + b)).toBe(10000);
  });
  it("interpreta valores em reais", () => {
    expect(parseBRL("R$ 1.234,56")).toBe(123456);
    expect(parseBRL("1234.5")).toBe(123450);
    expect(parseBRL("700")).toBe(70000);
  });
});

describe("itens", () => {
  it("calcula quantidade, desconto e acréscimo", () => {
    expect(itemTotal({ unitCents: 15000, quantity: 120, discountCents: 50000, surchargeCents: 10000 })).toBe(1760000);
  });
  it("rejeita desconto maior que o valor e quantidade zero", () => {
    expect(validateItem({ unitCents: 1000, quantity: 1, discountCents: 2000, surchargeCents: 0 })).not.toHaveLength(0);
    expect(validateItem({ unitCents: 1000, quantity: 0, discountCents: 0, surchargeCents: 0 })).not.toHaveLength(0);
  });
});

describe("contratação com múltiplos itens (igreja)", () => {
  const s = summarizeObligation(church(), new Map(), NOW);

  it("separa caução de despesa definitiva", () => {
    expect(s.contracted).toBe(100000); // 200 + 700 + 100
    expect(s.depositsContracted).toBe(20000);
    expect(s.nonRefundable).toBe(100000);
  });
  it("calcula pago, em aberto e gasto efetivo", () => {
    expect(s.paid).toBe(40000);
    expect(s.open).toBe(80000);
    expect(s.depositPending).toBe(20000);
    expect(s.effectiveSpent).toBe(20000); // só a reserva; a caução volta
    expect(s.unscheduled).toBe(0);
  });
  it("devolução da caução zera o pendente sem virar receita duplicada no gasto", () => {
    const after = summarizeObligation(church(), new Map([["caucao", 20000]]), NOW);
    expect(after.depositPending).toBe(0);
    expect(after.depositRefunded).toBe(20000);
    expect(after.effectiveSpent).toBe(20000);
  });
  it("caução retida passa a ser gasto não reembolsável", () => {
    const o = church();
    o.items[2]!.forfeitedCents = 5000;
    const r = summarizeObligation(o, new Map([["caucao", 15000]]), NOW);
    expect(r.depositPending).toBe(0);
    expect(r.nonRefundable).toBe(105000);
    expect(r.effectiveSpent).toBe(25000);
  });
  it("cancelamento remove previsto/contratado e o saldo em aberto, mas mantém o que foi pago", () => {
    const r = summarizeObligation(church({ status: "CANCELLED" }), new Map(), NOW);
    expect(r.contracted).toBe(0);
    expect(r.open).toBe(0);
    expect(r.paid).toBe(40000);
  });
  it("aponta valor contratado ainda sem parcela", () => {
    const o = church();
    o.installments = o.installments.slice(0, 2);
    expect(summarizeObligation(o, new Map(), NOW).unscheduled).toBe(80000);
  });
});

describe("parcelas", () => {
  const base = { id: "x", amountCents: 10000, dueDate: d("2026-06-01"), paidCents: 0 };
  it("vencida, a vencer, parcial, paga, prevista e cancelada", () => {
    expect(installmentStatus(base, "ACTIVE", NOW).status).toBe("OVERDUE");
    expect(installmentStatus({ ...base, dueDate: d("2026-07-01") }, "ACTIVE", NOW).status).toBe("UPCOMING");
    const partial = installmentStatus({ ...base, paidCents: 4000 }, "ACTIVE", NOW);
    expect(partial).toMatchObject({ status: "PARTIAL", remaining: 6000, overdue: true });
    expect(installmentStatus({ ...base, paidCents: 10000 }, "ACTIVE", NOW).status).toBe("PAID");
    expect(installmentStatus(base, "DRAFT", NOW)).toMatchObject({ status: "PLANNED", remaining: 0 });
    expect(installmentStatus({ ...base, cancelledAt: NOW }, "ACTIVE", NOW)).toMatchObject({ status: "CANCELLED", remaining: 0 });
  });
  it("vence no próprio dia sem ficar atrasada", () => {
    expect(installmentStatus({ ...base, dueDate: d("2026-06-15") }, "ACTIVE", NOW).status).toBe("UPCOMING");
  });
  it("gera cronograma mensal com soma exata", () => {
    const s = buildSchedule(100000, 3, d("2026-01-10"));
    expect(s.map((x) => x.amountCents)).toEqual([33334, 33333, 33333]);
    expect(s[2]!.dueDate.getMonth()).toBe(2);
  });
});

describe("pagamentos", () => {
  const insts = [
    { id: "a", amountCents: 10000, paidCents: 0, cancelled: false, obligationStatus: "ACTIVE" as const, dueDate: d("2026-01-01") },
    { id: "b", amountCents: 10000, paidCents: 2500, cancelled: false, obligationStatus: "ACTIVE" as const, dueDate: d("2026-02-01") },
    { id: "c", amountCents: 10000, paidCents: 0, cancelled: true, obligationStatus: "ACTIVE" as const, dueDate: d("2026-03-01") },
  ];
  it("aceita pagamento parcial e pagamento que cobre mais de uma parcela", () => {
    expect(validateAllocations(4000, [{ installmentId: "a", amountCents: 4000 }], insts)).toEqual([]);
    expect(validateAllocations(17500, [{ installmentId: "a", amountCents: 10000 }, { installmentId: "b", amountCents: 7500 }], insts)).toEqual([]);
  });
  it("bloqueia pagar além do saldo, parcela cancelada, soma divergente e duplicidade", () => {
    expect(validateAllocations(8000, [{ installmentId: "b", amountCents: 8000 }], insts).length).toBeGreaterThan(0);
    expect(validateAllocations(100, [{ installmentId: "c", amountCents: 100 }], insts).length).toBeGreaterThan(0);
    expect(validateAllocations(100, [{ installmentId: "a", amountCents: 50 }], insts).length).toBeGreaterThan(0);
    expect(validateAllocations(200, [{ installmentId: "a", amountCents: 100 }, { installmentId: "a", amountCents: 100 }], insts).length).toBeGreaterThan(0);
  });
  it("bloqueia pagamento em contratação não fechada", () => {
    const draft = [{ ...insts[0]!, obligationStatus: "DRAFT" as const }];
    expect(validateAllocations(100, [{ installmentId: "a", amountCents: 100 }], draft).length).toBeGreaterThan(0);
  });
  it("distribui automaticamente da mais antiga para a mais nova", () => {
    expect(autoAllocate(12000, insts)).toEqual([
      { installmentId: "a", amountCents: 10000 },
      { installmentId: "b", amountCents: 2000 },
    ]);
    expect(() => autoAllocate(999999, insts)).toThrow();
  });
});

describe("visão do casamento", () => {
  const categories = [
    { id: "cat-church", name: "Igreja", parentId: null, budgetCents: 90000 },
    { id: "cat-buffet", name: "Buffet", parentId: null, budgetCents: 0 },
    { id: "cat-doces", name: "Doces", parentId: "cat-buffet", budgetCents: 500000 },
  ];
  const buffet: ObligationInput = {
    id: "buffet",
    status: "ACTIVE",
    categoryId: "cat-buffet",
    items: [{ id: "menu", kind: "EXPENSE", status: "CONTRACTED", unitCents: 15000, quantity: 100, discountCents: 0, surchargeCents: 0, categoryId: "cat-doces" }],
    installments: [{ id: "b1", amountCents: 1500000, dueDate: d("2026-08-10"), paidCents: 500000 }],
  };
  const summary = summarizeWedding({
    budgetCents: 3000000,
    obligations: [church(), buffet],
    incomes: [
      { kind: "FAMILY", status: "RECEIVED", amountCents: 1000000, receivedAt: d("2026-01-01") },
      { kind: "GIFT_CASH", status: "PROMISED", amountCents: 300000, expectedDate: d("2026-09-01") },
      { kind: "DEPOSIT_REFUND", status: "EXPECTED", amountCents: 20000, depositItemId: "caucao" },
    ],
    categories,
    guestCount: 100,
    now: NOW,
  });

  it("consolida totais e não conta previsto como disponível", () => {
    expect(summary.contracted).toBe(1600000);
    expect(summary.paid).toBe(540000);
    expect(summary.open).toBe(1080000);
    expect(summary.realBalance).toBe(1000000 - 540000);
    expect(summary.incomeExpected).toBe(320000);
    expect(summary.projectedBalance).toBe(460000 + 320000 - 1080000);
    expect(summary.depositPending).toBe(20000); // devolução só prevista: ainda pendente
  });
  it("estoura orçamento por categoria e soma subcategorias na mãe", () => {
    const igreja = summary.categories.find((c) => c.categoryId === "cat-church")!;
    expect(igreja.contracted).toBe(100000);
    expect(igreja.overBudget).toBe(true);
    const buffetRow = summary.categories.find((c) => c.categoryId === "cat-buffet")!;
    expect(buffetRow.contracted).toBe(1500000);
    expect(buffetRow.budget).toBe(500000);
    expect(buffetRow.paid).toBe(500000);
  });
  it("custo por convidado", () => {
    expect(summary.costPerGuest).toBe(16000);
  });
  it("projeta fluxo de caixa mensal a partir do saldo real", () => {
    const rows = projectCashflow({
      obligations: [church(), buffet],
      incomes: [{ kind: "GIFT_CASH", status: "PROMISED", amountCents: 300000, expectedDate: d("2026-09-01") }],
      startBalance: 460000,
      months: 4,
      now: NOW,
      simulated: [{ amountCents: 100000, date: d("2026-08-01") }],
    });
    expect(rows.map((r) => r.month)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(rows[1]!.outflow).toBe(80000);
    expect(rows[2]!.outflow).toBe(1000000);
    expect(rows[3]!.inflow).toBe(300000);
    expect(rows[3]!.projectedBalance).toBe(460000 - 80000 - 1000000 + 300000);
    expect(rows[3]!.projectedWithSimulation).toBe(rows[3]!.projectedBalance - 100000);
  });
});
