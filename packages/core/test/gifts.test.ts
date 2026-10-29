import { prisma } from "@casa/db";
import { beforeEach, describe, expect, it } from "vitest";
import { saveWallet, walletBalances } from "../src/finance/wallets.js";
import { confirmContribution, giftStats, portalGiftList, portalPixCode, portalPledge, registerGift, revertContribution, saveGiftItem, setThankYou, updateGiftSettings } from "../src/gifts.js";
import { issueInvitation } from "../src/guests.js";
import { crc16, normalizePixKey, pixPayload } from "../src/pix.js";
import { makeWedding, resetDb } from "./helpers.js";

describe("Pix copia e cola", () => {
  it("CRC16 confere com o exemplo oficial do Banco Central", () => {
    const body = "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304";
    expect(crc16(body)).toBe("1D3D");
  });
  it("gera payload válido (CRC no fim confere) com valor e sem acentos", () => {
    const p = pixPayload({ key: "ana@exemplo.com", name: "Ana & Bruno Silvá", city: "São Paulo", amountCents: 15000, description: "Jantar" });
    expect(p).toContain("5406150.00"); // campo 54: valor
    expect(p).toContain("5915Ana Bruno Silva"); // campo 59: nome sem acentos/símbolos
    expect(p).toContain("6009Sao Paulo"); // campo 60: cidade
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)));
    expect(p).not.toMatch(/[áã]/);
  });
  it("normaliza chaves por tipo", () => {
    expect(normalizePixKey("PHONE", "(11) 98765-4321")).toBe("+5511987654321");
    expect(normalizePixKey("CPF", "123.456.789-09")).toBe("12345678909");
    expect(normalizePixKey("EMAIL", "Ana@Exemplo.COM")).toBe("ana@exemplo.com");
    expect(normalizePixKey("CPF", "123")).toBeNull();
    expect(normalizePixKey("RANDOM", "123e4567-e12b-12d1-a456-426655440000")).toBe("123e4567-e12b-12d1-a456-426655440000");
  });
});

async function setup() {
  const w = await makeWedding();
  const wallet = await saveWallet(w.ctx, { name: "Conta", kind: "CHECKING", openingBalanceCents: 0, openingDate: new Date(Date.now() - 86400_000) });
  await updateGiftSettings(w.ctx, { giftsEnabled: true, pixKeyType: "EMAIL", pixKey: "casal@exemplo.com", pixReceiverName: "Ana Silva", pixCity: "Sao Paulo", giftsWalletId: wallet.id });
  const group = await prisma.guestGroup.create({ data: { weddingId: w.ctx.weddingId, name: "Família Lima" } });
  await prisma.guest.create({ data: { weddingId: w.ctx.weddingId, groupId: group.id, fullName: "Rita Lima", isGroupLead: true } });
  const token = (await issueInvitation(w.ctx, group.id)).url.split("/c/")[1]!;
  return { ...w, wallet, group, token };
}

describe("lista de presentes", () => {
  beforeEach(resetDb);

  it("cotas: limite respeitado, envio idempotente e progresso agregado sem nomes", async () => {
    const { ctx, token } = await setup();
    const item = await saveGiftItem(ctx, { title: "Lua de mel", kind: "QUOTA", priceCents: 10000, quotaCount: 3 });
    const code = await portalPixCode({ token }, { itemId: item.id, quotas: 2 });
    expect(code.amountCents).toBe(20000);
    expect(code.payload.slice(-4)).toBe(crc16(code.payload.slice(0, -4)));
    await portalPledge({ token }, { itemId: item.id, quotas: 2, giverName: "Rita", submissionKey: "sk-000001" }, {});
    const again = await portalPledge({ token }, { itemId: item.id, quotas: 2, giverName: "Rita", submissionKey: "sk-000001" }, {});
    expect(again.duplicate).toBe(true);
    await expect(portalPledge({ token }, { itemId: item.id, quotas: 2, giverName: "Rita", submissionKey: "sk-000002" }, {})).rejects.toThrow(/Restam 1/);
    const list = await portalGiftList({ token });
    expect(list.enabled && list.items[0]!.quotasLeft).toBe(1);
    expect(JSON.stringify(list)).not.toContain("Rita");
  });

  it("confirmar cria UMA entrada recebida na carteira; desfazer cancela", async () => {
    const { ctx, token, wallet } = await setup();
    const item = await saveGiftItem(ctx, { title: "Jantar", kind: "ITEM", priceCents: 30000 });
    await portalPledge({ token }, { itemId: item.id, giverName: "Rita", submissionKey: "sk-100001" }, {});
    const c = (await prisma.giftContribution.findFirstOrThrow())!;
    expect((await walletBalances(ctx.weddingId)).wallets[0]!.balanceCents).toBe(0); // aviso não credita
    await confirmContribution(ctx, c.id);
    const dup = await confirmContribution(ctx, c.id);
    expect(dup.alreadyConfirmed).toBe(true);
    expect(await prisma.income.count({ where: { status: "RECEIVED" } })).toBe(1);
    expect((await walletBalances(ctx.weddingId)).wallets.find((w) => w.id === wallet.id)!.balanceCents).toBe(30000);
    await revertContribution(ctx, c.id, "Pix não caiu");
    expect(await prisma.income.count({ where: { status: "RECEIVED" } })).toBe(0);
    expect((await walletBalances(ctx.weddingId)).wallets[0]!.balanceCents).toBe(0);
    expect((await prisma.giftContribution.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("PLEDGED");
  });

  it("presente físico não gera entrada; agradecimentos", async () => {
    const { ctx } = await setup();
    const g = await registerGift(ctx, { giverName: "Tio João", physicalDescription: "Jogo de panelas" });
    expect(g.status).toBe("CONFIRMED");
    expect(await prisma.income.count()).toBe(0);
    await setThankYou(ctx, [g.id], "SENT");
    const s = await giftStats(ctx.weddingId);
    expect(s.physicalCount).toBe(1);
    expect(s.thankYouSent).toBe(1);
  });

  it("isolamento: confirmar presente de outro casamento falha; desativado some do portal", async () => {
    const a = await setup();
    const b = await makeWedding();
    const c = await registerGift(a.ctx, { giverName: "Xavier", amountCents: 5000 });
    await expect(confirmContribution(b.ctx, c.id)).rejects.toThrow(/não encontrad/);
    await prisma.wedding.update({ where: { id: a.ctx.weddingId }, data: { giftsEnabled: false } });
    expect((await portalGiftList({ token: a.token })).enabled).toBe(false);
  });
});
