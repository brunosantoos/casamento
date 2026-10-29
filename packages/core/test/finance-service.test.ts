import { prisma } from "@casa/db";
import { beforeEach, describe, expect, it } from "vitest";
import { DomainError } from "../src/errors.js";
import {
  cancelInstallment, forfeitDeposit, generateInstallments, getObligation, registerPayment, reversePayment, saveIncome, saveObligation, setObligationStatus, weddingFinanceSummary,
} from "../src/finance/service.js";
import { makeWedding, resetDb } from "./helpers.js";

const item = (description: string, unitCents: number, kind: "EXPENSE" | "DEPOSIT" | "FEE" = "EXPENSE") =>
  ({ description, kind, chargeType: "ONE_TIME", unitCents, quantity: "1", discountCents: 0, surchargeCents: 0, status: "PLANNED" }) as const;

async function church(ctx: Awaited<ReturnType<typeof makeWedding>>["ctx"]) {
  const o = await saveObligation(ctx, { title: "Igreja", items: [item("Reserva", 20000), item("Celebração", 70000, "FEE"), item("Caução", 20000, "DEPOSIT"), item("Taxa extra", 10000, "FEE")] });
  await setObligationStatus(ctx, o.id, "ACTIVE");
  const deposit = o.items.find((i) => i.kind === "DEPOSIT")!;
  await generateInstallments(ctx, { obligationId: o.id, count: 1, firstDue: new Date("2026-01-10T12:00:00Z"), itemId: deposit.id });
  await generateInstallments(ctx, { obligationId: o.id, count: 2, firstDue: new Date("2026-02-10T12:00:00Z"), amountCents: 100000 });
  return getObligation(ctx.weddingId, o.id);
}

describe("financeiro (banco real)", () => {
  beforeEach(resetDb);

  it("contratação com múltiplos itens: contratado, caução e parcelas", async () => {
    const { ctx } = await makeWedding();
    const o = await church(ctx);
    expect(o.items.every((i) => i.status === "CONTRACTED")).toBe(true);
    expect(o.installments.map((i) => i.amountCents)).toEqual([20000, 50000, 50000]);
    const s = await weddingFinanceSummary(ctx.weddingId);
    expect(s.contracted).toBe(100000);
    expect(s.unscheduled).toBe(0);
    expect(s.open).toBe(120000);
  });

  it("pagamento parcial, cobrindo várias parcelas, e idempotência", async () => {
    const { ctx } = await makeWedding();
    const o = await church(ctx);
    const [dep, p1, p2] = o.installments;
    const r1 = await registerPayment(ctx, { idempotencyKey: "pay-0001", amountCents: 20000, paidAt: new Date(), method: "PIX", allocations: [{ installmentId: dep!.id, amountCents: 20000 }] });
    // Mesmo envio de novo (duplo clique): não duplica
    const again = await registerPayment(ctx, { idempotencyKey: "pay-0001", amountCents: 20000, paidAt: new Date(), method: "PIX", allocations: [{ installmentId: dep!.id, amountCents: 20000 }] });
    expect(again.duplicate).toBe(true);
    expect(again.payment.id).toBe(r1.payment.id);
    await registerPayment(ctx, { idempotencyKey: "pay-0002", amountCents: 70000, paidAt: new Date(), method: "BANK_TRANSFER", allocations: [{ installmentId: p1!.id, amountCents: 50000 }, { installmentId: p2!.id, amountCents: 20000 }] });
    const s = await weddingFinanceSummary(ctx.weddingId);
    expect(s.paid).toBe(90000);
    expect(s.open).toBe(30000);
    expect(s.depositPending).toBe(20000);
    expect(s.effectiveSpent).toBe(70000);
    expect(await prisma.payment.count()).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: "pay" } })).toBe(2);
  });

  it("bloqueia pagamento acima do saldo e pagamentos concorrentes que excederiam o saldo", async () => {
    const { ctx } = await makeWedding();
    const o = await church(ctx);
    const p1 = o.installments[1]!;
    await expect(registerPayment(ctx, { idempotencyKey: "over-1", amountCents: 60000, paidAt: new Date(), method: "PIX", allocations: [{ installmentId: p1.id, amountCents: 60000 }] })).rejects.toThrow(DomainError);
    const results = await Promise.allSettled(
      [1, 2, 3].map((i) => registerPayment(ctx, { idempotencyKey: `conc-${i}`, amountCents: 30000, paidAt: new Date(), method: "PIX", allocations: [{ installmentId: p1.id, amountCents: 30000 }] })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const paid = await prisma.paymentAllocation.aggregate({ where: { installmentId: p1.id }, _sum: { amountCents: true } });
    expect(paid._sum.amountCents).toBeLessThanOrEqual(50000);
  });

  it("não paga contratação em rascunho nem parcela cancelada; estorno libera o saldo", async () => {
    const { ctx } = await makeWedding();
    const draft = await saveObligation(ctx, { title: "Buffet", items: [item("Menu", 100000)] });
    await generateInstallments(ctx, { obligationId: draft.id, count: 1, firstDue: new Date() });
    const di = (await getObligation(ctx.weddingId, draft.id)).installments[0]!;
    await expect(registerPayment(ctx, { idempotencyKey: "draft-1", amountCents: 100, paidAt: new Date(), method: "PIX", allocations: [{ installmentId: di.id, amountCents: 100 }] })).rejects.toThrow(/Feche a contratação/);

    const o = await church(ctx);
    const p1 = o.installments[1]!;
    const pay = await registerPayment(ctx, { idempotencyKey: "rev-1", amountCents: 50000, paidAt: new Date(), method: "PIX", allocations: [{ installmentId: p1.id, amountCents: 50000 }] });
    await expect(cancelInstallment(ctx, p1.id)).rejects.toThrow(/estorne/);
    await reversePayment(ctx, pay.payment.id, "Pago em duplicidade no banco");
    await expect(reversePayment(ctx, pay.payment.id, "de novo")).rejects.toThrow(/já estornado/);
    await cancelInstallment(ctx, p1.id);
    await expect(registerPayment(ctx, { idempotencyKey: "rev-2", amountCents: 100, paidAt: new Date(), method: "PIX", allocations: [{ installmentId: p1.id, amountCents: 100 }] })).rejects.toThrow(/cancelada/);
    const s = await weddingFinanceSummary(ctx.weddingId);
    expect(s.paid).toBe(0);
  });

  it("devolução de caução não pode exceder o pendente e não vira receita de gasto", async () => {
    const { ctx } = await makeWedding();
    const o = await church(ctx);
    const dep = o.items.find((i) => i.kind === "DEPOSIT")!;
    await registerPayment(ctx, { idempotencyKey: "dep-1", amountCents: 20000, paidAt: new Date(), method: "PIX", allocations: [{ installmentId: o.installments[0]!.id, amountCents: 20000 }] });
    await forfeitDeposit(ctx, dep.id, 5000, "Danos no tapete");
    await expect(saveIncome(ctx, { kind: "DEPOSIT_REFUND", status: "RECEIVED", description: "Devolução", amountCents: 20000, receivedAt: new Date(), depositItemId: dep.id })).rejects.toThrow(/excede/);
    await saveIncome(ctx, { kind: "DEPOSIT_REFUND", status: "RECEIVED", description: "Devolução", amountCents: 15000, receivedAt: new Date(), depositItemId: dep.id });
    const s = await weddingFinanceSummary(ctx.weddingId);
    expect(s.depositPending).toBe(0);
    expect(s.depositForfeited).toBe(5000);
    expect(s.effectiveSpent).toBe(5000);
    expect(s.realBalance).toBe(15000 - 20000);
  });

  it("entradas previstas não contam como saldo real; cancelamento exige motivo", async () => {
    const { ctx } = await makeWedding();
    await saveIncome(ctx, { kind: "FAMILY", status: "PROMISED", description: "Pais da noiva", amountCents: 1000000, expectedDate: new Date() });
    await saveIncome(ctx, { kind: "GIFT_CASH", status: "RECEIVED", description: "Tia", amountCents: 50000, receivedAt: new Date(), idempotencyKey: "inc-1" });
    await saveIncome(ctx, { kind: "GIFT_CASH", status: "RECEIVED", description: "Tia", amountCents: 50000, receivedAt: new Date(), idempotencyKey: "inc-1" });
    const s = await weddingFinanceSummary(ctx.weddingId);
    expect(s.realBalance).toBe(50000);
    expect(s.incomeExpected).toBe(1000000);
    const o = await saveObligation(ctx, { title: "Foto", items: [item("Pacote", 1000)] });
    await expect(setObligationStatus(ctx, o.id, "CANCELLED")).rejects.toThrow(/motivo/);
  });

  it("isolamento: não acessa lançamento de outro casamento", async () => {
    const a = await makeWedding();
    const b = await makeWedding();
    const o = await saveObligation(a.ctx, { title: "Igreja A", items: [item("Reserva", 1000)] });
    await expect(getObligation(b.ctx.weddingId, o.id)).rejects.toThrow(/não encontrado/);
    await expect(saveObligation(b.ctx, { id: o.id, title: "Hack", items: [item("x", 1)] })).rejects.toThrow();
    await generateInstallments(a.ctx, { obligationId: o.id, count: 1, firstDue: new Date() });
    await setObligationStatus(a.ctx, o.id, "ACTIVE");
    const inst = (await getObligation(a.ctx.weddingId, o.id)).installments[0]!;
    await expect(registerPayment(b.ctx, { idempotencyKey: "x-wed", amountCents: 1000, paidAt: new Date(), method: "PIX", allocations: [{ installmentId: inst.id, amountCents: 1000 }] })).rejects.toThrow(/não encontrada/);
  });
});

describe("financeiro: criação já contratada", () => {
  beforeEach(resetDb);
  it("lançamento criado como ACTIVE tem itens contratados", async () => {
    const { ctx } = await makeWedding();
    await saveObligation(ctx, { title: "Foto", status: "ACTIVE", items: [item("Pacote", 500000)] });
    expect((await weddingFinanceSummary(ctx.weddingId)).contracted).toBe(500000);
  });
});
