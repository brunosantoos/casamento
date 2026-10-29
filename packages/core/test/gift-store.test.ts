import { prisma } from "@casa/db";
import { beforeEach, describe, expect, it } from "vitest";
import { hasAffiliate, storeName, withAffiliate } from "../src/affiliate.js";
import { confirmContribution, portalGiftClick, portalGiftList, portalPixCode, portalStorePurchase, saveGiftItem, updateGiftSettings } from "../src/gifts.js";
import { issueInvitation } from "../src/guests.js";
import { makeWedding, resetDb } from "./helpers.js";

describe("links de afiliado", () => {
  it("aplica a tag só em links da Amazon sem tag", () => {
    expect(withAffiliate("https://www.amazon.com.br/dp/B0ABC123", "casal-20")).toBe("https://www.amazon.com.br/dp/B0ABC123?tag=casal-20");
    expect(withAffiliate("https://www.amazon.com.br/dp/B0ABC123?tag=outro-20", "casal-20")).toContain("tag=outro-20");
    expect(withAffiliate("https://amzn.to/3xyz", "casal-20")).toBe("https://amzn.to/3xyz");
    expect(withAffiliate("https://www.magazineluiza.com.br/produto", "casal-20")).toBe("https://www.magazineluiza.com.br/produto");
    expect(withAffiliate("https://www.amazon.com.br/dp/B0", null)).toBe("https://www.amazon.com.br/dp/B0");
    expect(storeName("https://amzn.to/3xyz")).toBe("Amazon");
    expect(hasAffiliate("https://amzn.to/3xyz")).toBe(true);
  });
});

describe("presentes em loja", () => {
  beforeEach(resetDb);

  async function setup(withPix: boolean) {
    const w = await makeWedding();
    await updateGiftSettings(w.ctx, { giftsEnabled: true, pixKeyType: withPix ? "EMAIL" : null, pixKey: withPix ? "casal@exemplo.com" : null, pixReceiverName: withPix ? "Ana" : null, pixCity: null, giftsWalletId: null, amazonAffiliateTag: "casal-20" });
    const group = await prisma.guestGroup.create({ data: { weddingId: w.ctx.weddingId, name: "Família Lima" } });
    await prisma.guest.create({ data: { weddingId: w.ctx.weddingId, groupId: group.id, fullName: "Ana Lima", isGroupLead: true } });
    const token = (await issueInvitation(w.ctx, group.id)).url.split("/c/")[1]!;
    return { ...w, token };
  }

  it("sem Pix, o portal mostra só os produtos de loja; o link real só sai pelo clique (com afiliado)", async () => {
    const { ctx, token } = await setup(false);
    const store = await saveGiftItem(ctx, { title: "Jogo de taças", kind: "STORE", externalUrl: "https://www.amazon.com.br/dp/B0TACAS", quotaCount: 2, priceCents: 15990 });
    await expect(saveGiftItem(ctx, { title: "Sem link", kind: "STORE" })).rejects.toThrow(/link/);
    await saveGiftItem(ctx, { title: "Cota da viagem", kind: "QUOTA", priceCents: 10000, quotaCount: 5 });
    const list = await portalGiftList({ token });
    expect(list.enabled && list.items.map((i) => i.title)).toEqual(["Jogo de taças"]);
    expect(list.enabled && list.items[0]!.externalUrl).toBeNull();
    const { url } = await portalGiftClick({ token }, store.id);
    expect(url).toBe("https://www.amazon.com.br/dp/B0TACAS?tag=casal-20");
    expect((await prisma.giftItem.findUniqueOrThrow({ where: { id: store.id } })).clickCount).toBe(1);
    await expect(portalPixCode({ token }, { itemId: store.id })).rejects.toThrow();
  });

  it("'Já comprei' respeita a quantidade, não duplica e não gera entrada financeira", async () => {
    const { ctx, token } = await setup(true);
    const store = await saveGiftItem(ctx, { title: "Jogo de taças", kind: "STORE", externalUrl: "https://amzn.to/3taca", quotaCount: 2 });
    const r = await portalStorePurchase({ token }, { itemId: store.id, giverName: "Ana Lima", submissionKey: "store-001" }, {});
    expect(r.duplicate).toBe(false);
    expect((await portalStorePurchase({ token }, { itemId: store.id, giverName: "Ana Lima", submissionKey: "store-001" }, {})).duplicate).toBe(true);
    await portalStorePurchase({ token }, { itemId: store.id, giverName: "Tio João", submissionKey: "store-002" }, {});
    await expect(portalStorePurchase({ token }, { itemId: store.id, giverName: "Prima", submissionKey: "store-003" }, {})).rejects.toThrow(/já foi comprado/);
    const c = await prisma.giftContribution.findFirstOrThrow({ where: { submissionKey: "store-001" } });
    expect(c.physicalDescription).toContain("Amazon");
    await confirmContribution(ctx, c.id);
    expect(await prisma.income.count({ where: { weddingId: ctx.weddingId } })).toBe(0);
    const list = await portalGiftList({ token });
    expect(list.enabled && list.items[0]!.complete).toBe(true);
  });
});
