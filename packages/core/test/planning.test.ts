import { prisma } from "@casa/db";
import { beforeEach, describe, expect, it } from "vitest";
import { decideProposal } from "../src/ai/actions.js";
import { paymentCapacity, simulateCashflow, splitByWeights, suggestBudgetSplit, suggestPaymentPlan } from "../src/finance/planning.js";
import { getObligation, quickBill } from "../src/finance/service.js";
import { saveWallet } from "../src/finance/wallets.js";
import { makeWedding, resetDb } from "./helpers.js";

const inMonths = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() + n, 10); d.setHours(12, 0, 0, 0); return d; };

describe("planejamento financeiro", () => {
  beforeEach(resetDb);

  it("divide o orçamento somando exatamente o total e nunca abaixo do comprometido", async () => {
    expect(splitByWeights(1000, [1, 1, 1]).reduce((a, b) => a + b)).toBe(1000);
    const { ctx } = await makeWedding();
    await quickBill(ctx, { idempotencyKey: "b1", title: "Buffet", amountCents: 2_000_000, amountMode: "total", installments: 1, firstDue: inMonths(1), categoryId: (await prisma.financialCategory.findFirstOrThrow({ where: { weddingId: ctx.weddingId, name: "Buffet" } })).id });
    const r = await suggestBudgetSplit(ctx.weddingId);
    expect(r.total).toBe(5_000_000);
    expect(r.rows.reduce((a, x) => a + x.suggested, 0)).toBe(5_000_000);
    expect(r.rows.find((x) => x.name === "Buffet")!.suggested).toBeGreaterThanOrEqual(2_000_000);
    expect(r.feasible).toBe(true);
  });

  it("simula o fluxo a partir das carteiras e sugere vencimentos que evitam saldo negativo", async () => {
    const { ctx } = await makeWedding({ date: inMonths(8) });
    await saveWallet(ctx, { name: "Conta", kind: "CHECKING", openingBalanceCents: 300_000, openingDate: new Date(Date.now() - 86400_000) });
    // Duas contas de R$ 3.000 no mesmo mês: o mês 1 fica negativo
    await quickBill(ctx, { idempotencyKey: "f1", title: "Fotógrafo", amountCents: 300_000, amountMode: "total", installments: 1, firstDue: inMonths(1) });
    await quickBill(ctx, { idempotencyKey: "f2", title: "Decoração", amountCents: 300_000, amountMode: "total", installments: 1, firstDue: inMonths(1) });
    await prisma.income.create({ data: { weddingId: ctx.weddingId, kind: "FAMILY", status: "EXPECTED", description: "Pais", amountCents: 400_000, expectedDate: inMonths(3) } });
    const before = await simulateCashflow(ctx.weddingId);
    expect(before.startBalance).toBe(300_000);
    expect(before.ok).toBe(false);
    const plan = await suggestPaymentPlan(ctx.weddingId);
    expect(plan.solved).toBe(true);
    expect(plan.moves).toHaveLength(1);
    expect(plan.result.minBalance).toBeGreaterThanOrEqual(0);
    const cap = await paymentCapacity(ctx.weddingId);
    expect(cap.gap).toBe(0);
    expect(cap.available).toBe(300_000);
  });

  it("proposta de novos vencimentos só executa com aprovação e não mexe em parcela paga", async () => {
    const { ctx } = await makeWedding();
    const r = await quickBill(ctx, { idempotencyKey: "p1", title: "Vestido", amountCents: 200_000, amountMode: "total", installments: 2, firstDue: inMonths(1), paidNow: { paidAt: new Date(), method: "PIX" } });
    const inst = (await getObligation(ctx.weddingId, r.obligationId!)).installments;
    const ok = await prisma.aIActionProposal.create({ data: { weddingId: ctx.weddingId, action: "rescheduleInstallments", summary: "Adiar 2ª parcela", payload: { changes: [{ installmentId: inst[1]!.id, dueDate: "2027-03-10" }] }, requiredPermission: "finance:edit" } });
    expect((await decideProposal(ctx, ok.id, "approve")).status).toBe("EXECUTED");
    expect((await prisma.installment.findUniqueOrThrow({ where: { id: inst[1]!.id } })).dueDate.toISOString().slice(0, 10)).toBe("2027-03-10");
    const bad = await prisma.aIActionProposal.create({ data: { weddingId: ctx.weddingId, action: "rescheduleInstallments", summary: "Mexer na paga", payload: { changes: [{ installmentId: inst[0]!.id, dueDate: "2027-03-10" }] }, requiredPermission: "finance:edit" } });
    await expect(decideProposal(ctx, bad.id, "approve")).rejects.toThrow(/já paga/);
  });
});
