import { beforeEach, describe, expect, it } from "vitest";
import { quickBill, weddingFinanceSummary } from "../src/finance/service.js";
import { saveWallet, walletBalances } from "../src/finance/wallets.js";
import { makeWedding, resetDb } from "./helpers.js";

describe("conta a pagar rápida", () => {
  beforeEach(resetDb);
  it("parcelada pelo total, mensal pelo valor de cada parcela, e já paga debitando a carteira", async () => {
    const { ctx } = await makeWedding();
    const w = await saveWallet(ctx, { name: "Conta", kind: "CHECKING", openingBalanceCents: 1_000_000, openingDate: new Date("2026-01-01T12:00:00Z") });
    await quickBill(ctx, { idempotencyKey: "qb-1", title: "Vestido", amountCents: 600_000, amountMode: "total", installments: 3, firstDue: new Date("2026-11-10T12:00:00Z") });
    const r = await quickBill(ctx, { idempotencyKey: "qb-2", title: "Aulas de dança", amountCents: 25_000, amountMode: "each", installments: 4, firstDue: new Date(), paidNow: { paidAt: new Date(), method: "PIX", walletId: w.id } });
    // Mesmo envio de novo: não duplica
    expect((await quickBill(ctx, { idempotencyKey: "qb-2", title: "Aulas de dança", amountCents: 25_000, amountMode: "each", installments: 4, firstDue: new Date() })).duplicate).toBe(true);
    expect(r.paymentId).toBeTruthy();
    const s = await weddingFinanceSummary(ctx.weddingId);
    expect(s.contracted).toBe(600_000 + 100_000);
    expect(s.paid).toBe(25_000);
    expect(s.open).toBe(600_000 + 75_000);
    expect((await walletBalances(ctx.weddingId)).wallets[0]!.balanceCents).toBe(975_000);
  });
});
