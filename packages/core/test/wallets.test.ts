import { beforeEach, describe, expect, it } from "vitest";
import { generateInstallments, getObligation, registerPayment, reversePayment, saveIncome, saveObligation, weddingFinanceSummary } from "../src/finance/service.js";
import { assignWallet, reverseWalletEntry, saveWallet, walletAdjust, walletBalances, walletStatement, walletTransfer } from "../src/finance/wallets.js";
import { makeWedding, resetDb } from "./helpers.js";

async function obligationWithInstallment(ctx: Awaited<ReturnType<typeof makeWedding>>["ctx"], cents: number) {
  const o = await saveObligation(ctx, { title: "Buffet", status: "ACTIVE", items: [{ description: "Menu", kind: "EXPENSE", chargeType: "ONE_TIME", unitCents: cents, quantity: "1", discountCents: 0, surchargeCents: 0, status: "PLANNED" }] });
  await generateInstallments(ctx, { obligationId: o.id, count: 1, firstDue: new Date() });
  return (await getObligation(ctx.weddingId, o.id)).installments[0]!;
}

describe("carteiras", () => {
  beforeEach(resetDb);

  it("saldo inicial, pagamento debita, entrada credita, estorno devolve", async () => {
    const { ctx } = await makeWedding();
    const conta = await saveWallet(ctx, { name: "Conta conjunta", kind: "CHECKING", openingBalanceCents: 5_000_000, openingDate: new Date("2026-01-01T12:00:00Z") });
    expect(conta.isDefault).toBe(true);
    const inst = await obligationWithInstallment(ctx, 1_200_000);
    const p = await registerPayment(ctx, { idempotencyKey: "w-pay-1", amountCents: 1_200_000, paidAt: new Date(), method: "PIX", walletId: conta.id, allocations: [{ installmentId: inst.id, amountCents: 1_200_000 }] });
    await saveIncome(ctx, { kind: "GIFT_CASH", status: "RECEIVED", description: "Presente da tia", amountCents: 50_000, receivedAt: new Date(), walletId: conta.id });
    // Prevista não credita
    await saveIncome(ctx, { kind: "FAMILY", status: "PROMISED", description: "Promessa", amountCents: 999_999, expectedDate: new Date(), walletId: conta.id });
    let b = await walletBalances(ctx.weddingId);
    expect(b.wallets[0]!.balanceCents).toBe(5_000_000 - 1_200_000 + 50_000);
    await reversePayment(ctx, p.payment.id, "Banco devolveu");
    b = await walletBalances(ctx.weddingId);
    expect(b.wallets[0]!.balanceCents).toBe(5_050_000);
    const st = await walletStatement(ctx.weddingId, conta.id);
    expect(st.movements.map((m) => m.type)).toContain("payment");
    expect(st.movements.at(-1)!.type).toBe("opening");
    expect((await weddingFinanceSummary(ctx.weddingId)).walletsTotal).toBe(5_050_000);
  });

  it("transferência entre carteiras e ajuste, com estorno e sem duplicar", async () => {
    const { ctx } = await makeWedding();
    const a = await saveWallet(ctx, { name: "Conta", kind: "CHECKING", openingBalanceCents: 100_000, openingDate: new Date() });
    const c = await saveWallet(ctx, { name: "Dinheiro", kind: "CASH", openingBalanceCents: 0, openingDate: new Date() });
    await walletTransfer(ctx, { fromWalletId: a.id, toWalletId: c.id, amountCents: 30_000, occurredAt: new Date(), idempotencyKey: "t1" });
    await walletTransfer(ctx, { fromWalletId: a.id, toWalletId: c.id, amountCents: 30_000, occurredAt: new Date(), idempotencyKey: "t1" });
    const adj = await walletAdjust(ctx, { walletId: c.id, amountCents: -500, description: "Tarifa", occurredAt: new Date(), idempotencyKey: "adj1" });
    let b = await walletBalances(ctx.weddingId);
    expect(b.wallets.find((w) => w.id === a.id)!.balanceCents).toBe(70_000);
    expect(b.wallets.find((w) => w.id === c.id)!.balanceCents).toBe(29_500);
    expect(b.totalCents).toBe(99_500);
    const out = (await walletStatement(ctx.weddingId, a.id)).movements.find((m) => m.type === "transfer")!;
    await reverseWalletEntry(ctx, out.id, "Lançado errado");
    await reverseWalletEntry(ctx, adj.id, "Tarifa estornada");
    b = await walletBalances(ctx.weddingId);
    expect(b.wallets.find((w) => w.id === a.id)!.balanceCents).toBe(100_000);
    expect(b.wallets.find((w) => w.id === c.id)!.balanceCents).toBe(0);
  });

  it("isolamento e vínculo posterior de pagamento", async () => {
    const a = await makeWedding();
    const b = await makeWedding();
    const wb = await saveWallet(b.ctx, { name: "Do B", kind: "CHECKING", openingBalanceCents: 0, openingDate: new Date() });
    const inst = await obligationWithInstallment(a.ctx, 10_000);
    await expect(registerPayment(a.ctx, { idempotencyKey: "x1", amountCents: 10_000, paidAt: new Date(), method: "PIX", walletId: wb.id, allocations: [{ installmentId: inst.id, amountCents: 10_000 }] })).rejects.toThrow(/Carteira/);
    const p = await registerPayment(a.ctx, { idempotencyKey: "x2", amountCents: 10_000, paidAt: new Date(), method: "PIX", allocations: [{ installmentId: inst.id, amountCents: 10_000 }] });
    expect((await walletBalances(a.ctx.weddingId)).unassignedPayments).toBe(1);
    const wa = await saveWallet(a.ctx, { name: "Do A", kind: "CHECKING", openingBalanceCents: 20_000, openingDate: new Date() });
    await assignWallet(a.ctx, { paymentId: p.payment.id, walletId: wa.id });
    const bal = await walletBalances(a.ctx.weddingId);
    expect(bal.wallets[0]!.balanceCents).toBe(10_000);
    expect(bal.unassignedPayments).toBe(0);
    await expect(walletStatement(a.ctx.weddingId, wb.id)).rejects.toThrow(/não encontrad/);
  });
});

describe("carteiras: saldo inicial é fotografia", () => {
  beforeEach(resetDb);
  it("movimento anterior à data do saldo inicial não debita de novo", async () => {
    const { ctx } = await makeWedding();
    const inst = await obligationWithInstallment(ctx, 20_000);
    const w = await saveWallet(ctx, { name: "Nubank", kind: "CHECKING", openingBalanceCents: 8_700, openingDate: new Date("2026-10-28T15:00:00Z") });
    await registerPayment(ctx, { idempotencyKey: "old-pay", amountCents: 20_000, paidAt: new Date("2026-10-01T12:00:00Z"), method: "PIX", walletId: w.id, allocations: [{ installmentId: inst.id, amountCents: 20_000 }] });
    expect((await walletBalances(ctx.weddingId)).wallets[0]!.balanceCents).toBe(8_700);
    const st = await walletStatement(ctx.weddingId, w.id);
    const old = st.movements.find((m) => m.type === "payment")!;
    expect(old.beforeOpening).toBe(true);
    expect(old.description).toContain("já incluído");
    expect(st.balanceCents).toBe(8_700);
  });
});
