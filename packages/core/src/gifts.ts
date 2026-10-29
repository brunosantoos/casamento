import { hasAffiliate, isAffiliateTag, storeName, validStoreUrl, withAffiliate } from "./affiliate.js";
import { prisma, type GiftKind, type PaymentMethod, type Prisma, type ThankYouStatus } from "@casa/db";
import { audit, type Actor } from "./audit.js";
import type { Ctx } from "./context.js";
import { tokenHash } from "./crypto.js";
import { assert, DomainError, notFound } from "./errors.js";
import { checkWallet } from "./finance/wallets.js";
import { formatBRL, sum } from "./money.js";
import { notify } from "./notify.js";
import { normalizePixKey, pixPayload, type PixKeyType } from "./pix.js";

/**
 * Lista de presentes com Pix.
 *  - Convidado escolhe um presente no portal, vê o QR/copia-e-cola e avisa "já fiz o Pix" (PLEDGED).
 *  - O casal confere no banco e CONFIRMA: só então vira uma entrada RECEBIDA na carteira escolhida (uma única vez).
 *  - Presentes físicos (ou em dinheiro entregue em mãos) são registrados pelo casal.
 *  - Cada presente tem status de agradecimento.
 * O portal nunca mostra nomes/valores de outros convidados: só o progresso agregado.
 */

const MAX_CENTS = 10_000_000; // R$ 100.000 por presente (proteção contra erro de digitação)

// ───────────── Configuração ─────────────

export async function giftSettings(weddingId: string) {
  const w = await prisma.wedding.findUniqueOrThrow({
    where: { id: weddingId },
    select: { giftsEnabled: true, pixKey: true, pixKeyType: true, pixReceiverName: true, pixCity: true, giftsWalletId: true, amazonAffiliateTag: true, partner1Name: true, partner2Name: true, city: true },
  });
  const preview = w.pixKey && w.pixReceiverName ? pixPayload({ key: w.pixKey, name: w.pixReceiverName, city: w.pixCity ?? w.city ?? "BRASIL" }) : null;
  return { ...w, preview };
}

export async function updateGiftSettings(
  ctx: Ctx,
  input: { giftsEnabled: boolean; pixKeyType: PixKeyType | null; pixKey: string | null; pixReceiverName: string | null; pixCity: string | null; giftsWalletId: string | null; amazonAffiliateTag?: string | null },
) {
  let key: string | null = null;
  if (input.pixKey?.trim()) {
    assert(input.pixKeyType, "Escolha o tipo da chave Pix");
    key = normalizePixKey(input.pixKeyType, input.pixKey);
    assert(key, "Chave Pix inválida para o tipo escolhido");
  }
  // Pix é opcional quando a lista só tem produtos de lojas; sem Pix, os itens em dinheiro ficam ocultos no portal
  if (key) assert(input.pixReceiverName?.trim(), "Informe o nome do recebedor (como aparece no banco)");
  const tag = input.amazonAffiliateTag?.trim() || null;
  if (tag) assert(isAffiliateTag(tag), "Tag de afiliado inválida (ex.: seunome-20)");
  await prisma.$transaction(async (tx) => {
    await checkWallet(tx, ctx.weddingId, input.giftsWalletId);
    await tx.wedding.update({
      where: { id: ctx.weddingId },
      data: {
        giftsEnabled: input.giftsEnabled, pixKeyType: key ? input.pixKeyType : null, pixKey: key,
        pixReceiverName: input.pixReceiverName?.trim() || null, pixCity: input.pixCity?.trim() || null, giftsWalletId: input.giftsWalletId,
        ...(input.amazonAffiliateTag !== undefined ? { amazonAffiliateTag: tag } : {}),
      },
    });
    await audit(ctx.actor, { weddingId: ctx.weddingId, action: "update", entityType: "giftSettings", entityId: ctx.weddingId, summary: `Atualizou a lista de presentes/Pix (${input.giftsEnabled ? "ativa" : "desativada"})` }, tx);
  });
}

// ───────────── Itens ─────────────

type ItemWithContrib = Prisma.GiftItemGetPayload<{ include: { contributions: { select: { status: true; amountCents: true; quotas: true } } } }>;

function progress(i: ItemWithContrib) {
  const live = i.contributions.filter((c) => c.status !== "REJECTED");
  const confirmed = i.contributions.filter((c) => c.status === "CONFIRMED");
  const quotasTaken = sum(live.map((c) => c.quotas ?? 0));
  const raisedCents = sum(live.map((c) => c.amountCents ?? 0));
  const confirmedCents = sum(confirmed.map((c) => c.amountCents ?? 0));
  const goalCents = i.kind === "QUOTA" && i.priceCents && i.quotaCount ? i.priceCents * i.quotaCount : i.kind === "ITEM" ? i.priceCents : null;
  const counted = i.kind === "QUOTA" || i.kind === "STORE";
  const complete = counted ? !!i.quotaCount && quotasTaken >= i.quotaCount : i.kind === "ITEM" ? live.length > 0 : false;
  return { contributions: live.length, quotasTaken, quotasLeft: counted && i.quotaCount ? Math.max(0, i.quotaCount - quotasTaken) : null, raisedCents, confirmedCents, goalCents, complete };
}

export async function listGiftItems(weddingId: string, opts: { includeInactive?: boolean } = {}) {
  const items = await prisma.giftItem.findMany({
    where: { weddingId, ...(opts.includeInactive ? {} : { active: true }) },
    include: { contributions: { select: { status: true, amountCents: true, quotas: true } } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return items.map(({ contributions: _c, ...i }) => ({ ...i, progress: progress({ ...i, contributions: _c }) }));
}

export type GiftItemInput = { id?: string; title: string; description?: string | null; imageFileId?: string | null; kind: GiftKind; priceCents?: number | null; quotaCount?: number | null; externalUrl?: string | null; active?: boolean };

export async function saveGiftItem(ctx: Ctx, input: GiftItemInput) {
  assert(input.title.trim().length >= 2, "Dê um nome ao presente");
  if (input.kind === "QUOTA") {
    assert(input.priceCents && input.priceCents > 0, "Informe o valor de cada cota");
    assert(input.quotaCount && input.quotaCount >= 1 && input.quotaCount <= 1000, "Informe a quantidade de cotas (1 a 1000)");
  }
  if (input.kind === "ITEM") assert(input.priceCents && input.priceCents > 0, "Informe o valor do presente");
  let url = input.externalUrl?.trim() ? validStoreUrl(input.externalUrl) : null;
  if (input.externalUrl?.trim()) assert(url, "Link inválido (use o endereço completo, começando com https://)");
  if (input.kind === "STORE") {
    assert(url, "Cole o link do produto na loja");
    assert(!input.quotaCount || (input.quotaCount >= 1 && input.quotaCount <= 100), "Quantidade entre 1 e 100");
  }
  if (input.priceCents) assert(input.priceCents <= MAX_CENTS, "Valor muito alto");
  if (input.imageFileId) assert(await prisma.fileAsset.count({ where: { id: input.imageFileId, weddingId: ctx.weddingId, deletedAt: null, mimeType: { startsWith: "image/" } } }), "Imagem inválida");
  const data = {
    title: input.title.trim(), description: input.description?.trim() || null, imageFileId: input.imageFileId ?? null, kind: input.kind,
    // STORE: preço é só referência; quotaCount = quantidade desejada (padrão 1)
    priceCents: input.kind === "FREE" ? null : (input.priceCents ?? null),
    quotaCount: input.kind === "QUOTA" ? (input.quotaCount ?? null) : input.kind === "STORE" ? (input.quotaCount ?? 1) : null,
    externalUrl: url, active: input.active ?? true,
  };
  if (input.id) {
    const before = await prisma.giftItem.findFirst({ where: { id: input.id, weddingId: ctx.weddingId }, include: { contributions: { select: { status: true, amountCents: true, quotas: true } } } });
    if (!before) throw notFound("Presente");
    const p = progress(before);
    if ((data.kind === "QUOTA" || data.kind === "STORE") && data.quotaCount != null) assert(data.quotaCount >= p.quotasTaken, `Já há ${p.quotasTaken} ${data.kind === "STORE" ? "compra(s) avisada(s)" : "cota(s) escolhida(s)"}`);
    const it = await prisma.giftItem.update({ where: { id: before.id }, data });
    await audit(ctx.actor, { weddingId: ctx.weddingId, action: "update", entityType: "giftItem", entityId: it.id, summary: `Editou o presente "${it.title}"` });
    return it;
  }
  const count = await prisma.giftItem.count({ where: { weddingId: ctx.weddingId } });
  const it = await prisma.giftItem.create({ data: { ...data, weddingId: ctx.weddingId, sortOrder: count } });
  await audit(ctx.actor, { weddingId: ctx.weddingId, action: "create", entityType: "giftItem", entityId: it.id, summary: `Criou o presente "${it.title}"` });
  return it;
}

/** Com contribuições, apenas desativa (preserva o histórico) */
export async function deleteGiftItem(ctx: Ctx, id: string) {
  const it = await prisma.giftItem.findFirst({ where: { id, weddingId: ctx.weddingId }, include: { _count: { select: { contributions: true } } } });
  if (!it) throw notFound("Presente");
  if (it._count.contributions) {
    await prisma.giftItem.update({ where: { id }, data: { active: false } });
    await audit(ctx.actor, { weddingId: ctx.weddingId, action: "archive", entityType: "giftItem", entityId: id, summary: `Desativou o presente "${it.title}" (tem contribuições)` });
    return { deleted: false };
  }
  await prisma.giftItem.delete({ where: { id } });
  await audit(ctx.actor, { weddingId: ctx.weddingId, action: "delete", entityType: "giftItem", entityId: id, summary: `Excluiu o presente "${it.title}"` });
  return { deleted: true };
}

export async function reorderGiftItems(ctx: Ctx, ids: string[]) {
  await prisma.$transaction(ids.map((id, i) => prisma.giftItem.updateMany({ where: { id, weddingId: ctx.weddingId }, data: { sortOrder: i } })));
}

// ───────────── Portal (público) ─────────────

export type PortalIdentity = { token?: string | null; slug?: string | null };

async function resolvePortal(id: PortalIdentity) {
  if (id.token) {
    if (!/^[\w-]{20,64}$/.test(id.token)) throw new DomainError("Link inválido", "NOT_FOUND");
    const inv = await prisma.guestInvitation.findUnique({ where: { tokenHash: tokenHash(id.token) }, include: { group: { include: { guests: { where: { deletedAt: null, isGroupLead: true }, take: 1 } } } } });
    if (!inv || inv.revokedAt || (inv.expiresAt && inv.expiresAt < new Date())) throw new DomainError("Link inválido ou expirado", "NOT_FOUND");
    const wedding = await prisma.wedding.findUniqueOrThrow({ where: { id: inv.weddingId } });
    return { wedding, group: inv.group, leadGuestId: inv.group.guests[0]?.id ?? null };
  }
  if (id.slug) {
    const wedding = await prisma.wedding.findUnique({ where: { portalSlug: id.slug } });
    if (!wedding || !wedding.portalEnabled || wedding.archivedAt) throw new DomainError("Página não encontrada", "NOT_FOUND");
    return { wedding, group: null, leadGuestId: null };
  }
  throw new DomainError("Link inválido", "NOT_FOUND");
}

/** Itens e progresso agregado — sem nomes nem valores individuais */
export async function portalGiftList(id: PortalIdentity) {
  const { wedding, group } = await resolvePortal(id);
  if (!wedding.giftsEnabled) return { enabled: false as const };
  const all = await listGiftItems(wedding.id);
  // Sem Pix configurado, mostra só os produtos de loja
  const items = wedding.pixKey ? all : all.filter((i) => i.kind === "STORE");
  if (!items.length) return { enabled: false as const };
  const imageIds = items.map((i) => i.imageFileId).filter((x): x is string => !!x);
  const files = imageIds.length ? await prisma.fileAsset.findMany({ where: { id: { in: imageIds }, weddingId: wedding.id, deletedAt: null } }) : [];
  const { storage } = await import("./storage.js");
  const urls = new Map<string, string>();
  for (const f of files) urls.set(f.id, await storage().signedUrl(f.storageKey, { fileName: f.originalName, contentType: f.mimeType, inline: true, ttlSeconds: 3600 }));
  return {
    enabled: true as const,
    receiverName: wedding.pixReceiverName,
    pixEnabled: !!wedding.pixKey,
    familyName: group?.name ?? null,
    items: items.map((i) => ({
      id: i.id, title: i.title, description: i.description, kind: i.kind, priceCents: i.priceCents, quotaCount: i.quotaCount,
      // Itens de loja: o link (com afiliado) é entregue por portalGiftClick, que conta o clique
      externalUrl: i.kind === "STORE" ? null : i.externalUrl, store: i.externalUrl ? storeName(i.externalUrl) : null,
      imageUrl: i.imageFileId ? (urls.get(i.imageFileId) ?? null) : null,
      quotasLeft: i.progress.quotasLeft, complete: i.progress.complete,
      percent: i.progress.goalCents ? Math.min(100, Math.round((i.progress.raisedCents / i.progress.goalCents) * 100)) : null,
    })),
  };
}

/** Valida as regras do item e devolve o valor final */
function amountFor(item: { kind: GiftKind; priceCents: number | null; quotaCount: number | null; active: boolean } | null, input: { amountCents?: number | null; quotas?: number | null }, quotasTaken: number) {
  if (!item) {
    assert(input.amountCents && input.amountCents >= 100, "Informe um valor de pelo menos R$ 1,00");
    assert(input.amountCents <= MAX_CENTS, "Valor muito alto");
    return { amountCents: input.amountCents, quotas: null };
  }
  assert(item.active, "Este presente não está mais disponível", "CONFLICT");
  assert(item.kind !== "STORE", "Este presente é comprado direto na loja");
  if (item.kind === "QUOTA") {
    const q = input.quotas ?? 0;
    assert(Number.isInteger(q) && q >= 1, "Escolha ao menos uma cota");
    assert(!item.quotaCount || quotasTaken + q <= item.quotaCount, `Restam ${Math.max(0, (item.quotaCount ?? 0) - quotasTaken)} cota(s)`, "CONFLICT");
    return { amountCents: q * (item.priceCents ?? 0), quotas: q };
  }
  if (item.kind === "ITEM") return { amountCents: item.priceCents!, quotas: null };
  assert(input.amountCents && input.amountCents >= 100, "Informe um valor de pelo menos R$ 1,00");
  assert(input.amountCents <= MAX_CENTS, "Valor muito alto");
  return { amountCents: input.amountCents, quotas: null };
}

async function quotasTakenFor(itemId: string) {
  const r = await prisma.giftContribution.aggregate({ where: { giftItemId: itemId, status: { not: "REJECTED" } }, _sum: { quotas: true } });
  return r._sum.quotas ?? 0;
}

/** Código Pix (copia e cola) para o valor escolhido — calculado no servidor */
export async function portalPixCode(id: PortalIdentity, input: { itemId?: string | null; amountCents?: number | null; quotas?: number | null }) {
  const { wedding } = await resolvePortal(id);
  assert(wedding.giftsEnabled && wedding.pixKey && wedding.pixReceiverName, "Lista de presentes indisponível", "PRECONDITION_FAILED");
  const item = input.itemId ? await prisma.giftItem.findFirst({ where: { id: input.itemId, weddingId: wedding.id } }) : null;
  if (input.itemId && !item) throw notFound("Presente");
  const { amountCents, quotas } = amountFor(item, input, item ? await quotasTakenFor(item.id) : 0);
  const payload = pixPayload({ key: wedding.pixKey!, name: wedding.pixReceiverName!, city: wedding.pixCity ?? wedding.city ?? "BRASIL", amountCents, description: item?.title ?? "Presente casamento" });
  return { payload, amountCents, quotas, receiverName: wedding.pixReceiverName };
}

export async function portalPledge(
  id: PortalIdentity,
  input: { itemId?: string | null; amountCents?: number | null; quotas?: number | null; giverName: string; message?: string | null; submissionKey: string },
  meta: { ip?: string | null },
) {
  const { wedding, group, leadGuestId } = await resolvePortal(id);
  assert(wedding.giftsEnabled && wedding.pixKey, "Lista de presentes indisponível", "PRECONDITION_FAILED");
  const dup = await prisma.giftContribution.findUnique({ where: { submissionKey: input.submissionKey } });
  if (dup) {
    assert(dup.weddingId === wedding.id, "Envio inválido", "CONFLICT");
    return { ok: true, duplicate: true };
  }
  const name = input.giverName.trim().slice(0, 120);
  assert(name.length >= 2, "Informe seu nome");
  const created = await prisma.$transaction(async (tx) => {
    let item = null;
    if (input.itemId) {
      // Trava o item para não vender mais cotas do que existem
      await tx.$queryRaw`SELECT id FROM "GiftItem" WHERE id = ${input.itemId} FOR UPDATE`;
      item = await tx.giftItem.findFirst({ where: { id: input.itemId, weddingId: wedding.id } });
      if (!item) throw notFound("Presente");
    }
    const taken = item ? ((await tx.giftContribution.aggregate({ where: { giftItemId: item.id, status: { not: "REJECTED" } }, _sum: { quotas: true } }))._sum.quotas ?? 0) : 0;
    const { amountCents, quotas } = amountFor(item, input, taken);
    const c = await tx.giftContribution.create({
      data: {
        weddingId: wedding.id, giftItemId: item?.id ?? null, groupId: group?.id ?? null, guestId: leadGuestId, giverName: name, message: input.message?.trim().slice(0, 1000) || null,
        amountCents, quotas, method: "PIX", status: "PLEDGED", source: "PORTAL", submissionKey: input.submissionKey, ip: meta.ip ?? null,
      },
    });
    const actor: Actor = { userId: null, userName: `Portal: ${name}`, ip: meta.ip, origin: "portal" };
    await audit(actor, { weddingId: wedding.id, action: "pledge", entityType: "gift", entityId: c.id, summary: `${name} avisou um presente via Pix de ${formatBRL(amountCents)}${item ? ` (${item.title})` : ""}` }, tx);
    return { c, item, amountCents };
  });
  await notify(wedding.id, "gift", {
    title: "Novo presente 🎁",
    body: `${name} avisou um Pix de ${formatBRL(created.amountCents)}${created.item ? ` — ${created.item.title}` : ""}. Confira no banco e confirme.`,
    url: "/presentes?aba=recebidos",
    dedupeKey: `gift:${created.c.id}`,
  }).catch(() => undefined);
  return { ok: true, duplicate: false };
}

/** Abre o produto na loja: conta o clique e devolve o link com a tag de afiliado */
export async function portalGiftClick(id: PortalIdentity, itemId: string) {
  const { wedding } = await resolvePortal(id);
  assert(wedding.giftsEnabled, "Lista de presentes indisponível", "PRECONDITION_FAILED");
  const item = await prisma.giftItem.findFirst({ where: { id: itemId, weddingId: wedding.id, active: true } });
  if (!item?.externalUrl) throw notFound("Presente");
  await prisma.giftItem.update({ where: { id: item.id }, data: { clickCount: { increment: 1 } } });
  const w = await prisma.wedding.findUniqueOrThrow({ where: { id: wedding.id }, select: { amazonAffiliateTag: true } });
  return { url: withAffiliate(item.externalUrl, w.amazonAffiliateTag) };
}

/** "Já comprei": registra o presente físico (sem entrada financeira) para o casal conferir e agradecer */
export async function portalStorePurchase(
  id: PortalIdentity,
  input: { itemId: string; quantity?: number | null; giverName: string; message?: string | null; submissionKey: string },
  meta: { ip?: string | null },
) {
  const { wedding, group, leadGuestId } = await resolvePortal(id);
  assert(wedding.giftsEnabled, "Lista de presentes indisponível", "PRECONDITION_FAILED");
  const dup = await prisma.giftContribution.findUnique({ where: { submissionKey: input.submissionKey } });
  if (dup) {
    assert(dup.weddingId === wedding.id, "Envio inválido", "CONFLICT");
    return { ok: true, duplicate: true };
  }
  const name = input.giverName.trim().slice(0, 120);
  assert(name.length >= 2, "Informe seu nome");
  const qty = Math.max(1, Math.min(20, input.quantity ?? 1));
  const created = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "GiftItem" WHERE id = ${input.itemId} FOR UPDATE`;
    const item = await tx.giftItem.findFirst({ where: { id: input.itemId, weddingId: wedding.id } });
    if (!item) throw notFound("Presente");
    assert(item.kind === "STORE" && item.active, "Este presente não está disponível", "CONFLICT");
    const taken = (await tx.giftContribution.aggregate({ where: { giftItemId: item.id, status: { not: "REJECTED" } }, _sum: { quotas: true } }))._sum.quotas ?? 0;
    assert(!item.quotaCount || taken + qty <= item.quotaCount, item.quotaCount && taken >= item.quotaCount ? "Este presente já foi comprado por outro convidado" : `Faltam só ${(item.quotaCount ?? 0) - taken}`, "CONFLICT");
    const store = item.externalUrl ? storeName(item.externalUrl) : null;
    const c = await tx.giftContribution.create({
      data: {
        weddingId: wedding.id, giftItemId: item.id, groupId: group?.id ?? null, guestId: leadGuestId, giverName: name, message: input.message?.trim().slice(0, 1000) || null,
        physicalDescription: `${qty > 1 ? `${qty}× ` : ""}${item.title}${store ? ` (comprado na ${store})` : ""}`.slice(0, 300), quotas: qty, amountCents: null,
        status: "PLEDGED", source: "PORTAL", submissionKey: input.submissionKey, ip: meta.ip ?? null,
      },
    });
    const actor: Actor = { userId: null, userName: `Portal: ${name}`, ip: meta.ip, origin: "portal" };
    await audit(actor, { weddingId: wedding.id, action: "pledge", entityType: "gift", entityId: c.id, summary: `${name} avisou que comprou "${item.title}"${store ? ` na ${store}` : ""}` }, tx);
    return { c, item };
  });
  await notify(wedding.id, "gift", {
    title: "Presente comprado 🎁",
    body: `${name} comprou "${created.item.title}". Confira quando chegar.`,
    url: "/presentes?aba=recebidos",
    dedupeKey: `gift:${created.c.id}`,
  }).catch(() => undefined);
  return { ok: true, duplicate: false };
}

/** Prévia do link final (para a tela do casal) */
export function affiliatePreview(url: string, tag: string | null) {
  const valid = validStoreUrl(url);
  if (!valid) return null;
  const finalUrl = withAffiliate(valid, tag);
  return { store: storeName(valid), finalUrl, hasAffiliate: hasAffiliate(finalUrl), tagApplied: finalUrl !== valid };
}

// ───────────── Gestão pelo casal ─────────────

export async function listContributions(weddingId: string, filters: { status?: "PLEDGED" | "CONFIRMED" | "REJECTED"; thankYou?: ThankYouStatus; itemId?: string; search?: string } = {}) {
  return prisma.giftContribution.findMany({
    where: {
      weddingId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.thankYou ? { thankYouStatus: filters.thankYou } : {}),
      ...(filters.itemId ? { giftItemId: filters.itemId } : {}),
      ...(filters.search ? { OR: [{ giverName: { contains: filters.search, mode: "insensitive" } }, { group: { name: { contains: filters.search, mode: "insensitive" } } }] } : {}),
    },
    include: {
      giftItem: { select: { id: true, title: true, kind: true } },
      group: { select: { id: true, name: true, contactPhone: true } },
      guest: { select: { id: true, fullName: true, phone: true } },
      income: { select: { id: true, status: true, walletId: true, wallet: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function giftStats(weddingId: string) {
  const all = await prisma.giftContribution.findMany({ where: { weddingId }, select: { status: true, amountCents: true, thankYouStatus: true, physicalDescription: true } });
  const live = all.filter((c) => c.status !== "REJECTED");
  return {
    total: live.length,
    pledgedCents: sum(all.filter((c) => c.status === "PLEDGED").map((c) => c.amountCents ?? 0)),
    pledgedCount: all.filter((c) => c.status === "PLEDGED").length,
    confirmedCents: sum(all.filter((c) => c.status === "CONFIRMED").map((c) => c.amountCents ?? 0)),
    confirmedCount: all.filter((c) => c.status === "CONFIRMED").length,
    physicalCount: live.filter((c) => c.physicalDescription).length,
    thankYouPending: live.filter((c) => c.thankYouStatus === "PENDING").length,
    thankYouSent: live.filter((c) => c.thankYouStatus === "SENT").length,
  };
}

async function defaultWallet(weddingId: string, preferred?: string | null) {
  if (preferred) return preferred;
  const w = await prisma.wedding.findUniqueOrThrow({ where: { id: weddingId }, select: { giftsWalletId: true } });
  if (w.giftsWalletId) return w.giftsWalletId;
  const def = await prisma.wallet.findFirst({ where: { weddingId, archivedAt: null }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  return def?.id ?? null;
}

/** Confere o recebimento: cria UMA entrada recebida na carteira (idempotente) */
export async function confirmContribution(ctx: Ctx, id: string, input: { walletId?: string | null; receivedAt?: Date | null; method?: PaymentMethod | null } = {}) {
  const walletId = await defaultWallet(ctx.weddingId, input.walletId);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "GiftContribution" WHERE id = ${id} FOR UPDATE`;
    const c = await tx.giftContribution.findFirst({ where: { id, weddingId: ctx.weddingId }, include: { giftItem: { select: { title: true } } } });
    if (!c) throw notFound("Presente");
    if (c.status === "CONFIRMED") return { alreadyConfirmed: true, incomeId: c.incomeId };
    let incomeId: string | null = null;
    if (c.amountCents && c.amountCents > 0) {
      await checkWallet(tx, ctx.weddingId, walletId);
      const income = await tx.income.create({
        data: {
          weddingId: ctx.weddingId, kind: "GIFT_CASH", status: "RECEIVED", description: `Presente: ${c.giftItem?.title ?? "valor livre"} — ${c.giverName}`.slice(0, 200),
          source: c.giverName, amountCents: c.amountCents, receivedAt: input.receivedAt ?? new Date(), method: input.method ?? c.method ?? "PIX", walletId, createdById: ctx.actor.userId,
          notes: c.message ? `Mensagem: ${c.message}` : null,
        },
      });
      incomeId = income.id;
    }
    await tx.giftContribution.update({ where: { id: c.id }, data: { status: "CONFIRMED", incomeId, reviewedById: ctx.actor.userId, reviewedAt: new Date() } });
    await audit(ctx.actor, { weddingId: ctx.weddingId, action: "confirm", entityType: "gift", entityId: c.id, summary: `Confirmou presente de ${c.giverName}${c.amountCents ? ` (${formatBRL(c.amountCents)})` : ""}${incomeId ? " e registrou a entrada" : ""}` }, tx);
    return { alreadyConfirmed: false, incomeId };
  });
}

export async function rejectContribution(ctx: Ctx, id: string, reason: string) {
  assert(reason.trim().length >= 3, "Informe o motivo");
  const c = await prisma.giftContribution.findFirst({ where: { id, weddingId: ctx.weddingId } });
  if (!c) throw notFound("Presente");
  assert(c.status === "PLEDGED", c.status === "CONFIRMED" ? "Desfaça a confirmação antes de recusar" : "Já recusado", "CONFLICT");
  await prisma.giftContribution.update({ where: { id }, data: { status: "REJECTED", reviewedById: ctx.actor.userId, reviewedAt: new Date(), thankYouNote: [c.thankYouNote, `Recusado: ${reason}`].filter(Boolean).join("\n") } });
  await audit(ctx.actor, { weddingId: ctx.weddingId, action: "reject", entityType: "gift", entityId: id, summary: `Marcou como não recebido o presente de ${c.giverName} — ${reason}` });
}

/** Desfaz a confirmação: cancela a entrada (histórico preservado) e volta para "aguardando" */
export async function revertContribution(ctx: Ctx, id: string, reason: string) {
  assert(reason.trim().length >= 3, "Informe o motivo");
  await prisma.$transaction(async (tx) => {
    const c = await tx.giftContribution.findFirst({ where: { id, weddingId: ctx.weddingId }, include: { income: true } });
    if (!c) throw notFound("Presente");
    assert(c.status === "CONFIRMED" || c.status === "REJECTED", "Este presente não está confirmado", "CONFLICT");
    if (c.income) {
      await tx.income.update({ where: { id: c.income.id }, data: { status: "CANCELLED", notes: [c.income.notes, `Cancelada: ${reason}`].filter(Boolean).join("\n") } });
    }
    await tx.giftContribution.update({ where: { id }, data: { status: c.source === "ADMIN" && !c.amountCents ? "CONFIRMED" : "PLEDGED", incomeId: null, reviewedById: null, reviewedAt: null } });
    await audit(ctx.actor, { weddingId: ctx.weddingId, action: "revert", entityType: "gift", entityId: id, summary: `Desfez a confirmação do presente de ${c.giverName}${c.income ? ` e cancelou a entrada de ${formatBRL(c.income.amountCents)}` : ""} — ${reason}` }, tx);
  });
}

/** Registro feito pelo casal: presente físico ou dinheiro entregue fora do portal */
export async function registerGift(
  ctx: Ctx,
  input: { giverName: string; groupId?: string | null; guestId?: string | null; giftItemId?: string | null; physicalDescription?: string | null; amountCents?: number | null; method?: PaymentMethod | null; message?: string | null; confirmNow?: boolean; walletId?: string | null; receivedAt?: Date | null },
) {
  assert(input.giverName.trim().length >= 2, "Informe quem deu o presente");
  assert(input.physicalDescription?.trim() || (input.amountCents && input.amountCents > 0), "Descreva o presente ou informe o valor");
  if (input.amountCents) assert(input.amountCents <= MAX_CENTS, "Valor muito alto");
  if (input.groupId) assert(await prisma.guestGroup.count({ where: { id: input.groupId, weddingId: ctx.weddingId } }), "Família inválida", "NOT_FOUND");
  if (input.guestId) assert(await prisma.guest.count({ where: { id: input.guestId, weddingId: ctx.weddingId } }), "Convidado inválido", "NOT_FOUND");
  if (input.giftItemId) assert(await prisma.giftItem.count({ where: { id: input.giftItemId, weddingId: ctx.weddingId } }), "Presente inválido", "NOT_FOUND");
  const physicalOnly = !input.amountCents;
  const c = await prisma.giftContribution.create({
    data: {
      weddingId: ctx.weddingId, giverName: input.giverName.trim(), groupId: input.groupId ?? null, guestId: input.guestId ?? null, giftItemId: input.giftItemId ?? null,
      physicalDescription: input.physicalDescription?.trim() || null, amountCents: input.amountCents ?? null, method: input.method ?? null, message: input.message?.trim() || null,
      status: physicalOnly ? "CONFIRMED" : "PLEDGED", source: "ADMIN", reviewedById: physicalOnly ? ctx.actor.userId : null, reviewedAt: physicalOnly ? new Date() : null,
    },
  });
  await audit(ctx.actor, { weddingId: ctx.weddingId, action: "create", entityType: "gift", entityId: c.id, summary: `Registrou presente de ${c.giverName}: ${c.physicalDescription ?? formatBRL(c.amountCents ?? 0)}` });
  if (!physicalOnly && input.confirmNow) await confirmContribution(ctx, c.id, { walletId: input.walletId, receivedAt: input.receivedAt, method: input.method });
  return c;
}

export async function setThankYou(ctx: Ctx, ids: string[], status: ThankYouStatus, note?: string | null) {
  assert(ids.length > 0 && ids.length <= 500, "Selecione os presentes");
  const r = await prisma.giftContribution.updateMany({
    where: { id: { in: ids }, weddingId: ctx.weddingId },
    data: { thankYouStatus: status, thankYouSentAt: status === "SENT" ? new Date() : null, ...(note !== undefined ? { thankYouNote: note } : {}) },
  });
  await audit(ctx.actor, { weddingId: ctx.weddingId, action: "update", entityType: "gift", summary: `Marcou ${r.count} agradecimento(s) como ${status === "SENT" ? "enviado" : status === "NOT_NEEDED" ? "dispensado" : "pendente"}` });
  return { updated: r.count };
}

export async function updateContribution(ctx: Ctx, id: string, input: { giverName?: string; message?: string | null; physicalDescription?: string | null; thankYouNote?: string | null }) {
  const c = await prisma.giftContribution.findFirst({ where: { id, weddingId: ctx.weddingId } });
  if (!c) throw notFound("Presente");
  await prisma.giftContribution.update({ where: { id }, data: Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) });
  await audit(ctx.actor, { weddingId: ctx.weddingId, action: "update", entityType: "gift", entityId: id, summary: `Editou o registro do presente de ${c.giverName}` });
}
