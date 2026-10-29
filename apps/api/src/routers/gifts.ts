import { prisma } from "@casa/db";
import {
  confirmContribution, deleteGiftItem, giftSettings, giftStats, listContributions, listGiftItems, registerGift, rejectContribution, reorderGiftItems, revertContribution,
  saveGiftItem, setThankYou, updateContribution, updateGiftSettings, walletBalances,
} from "@casa/core";
import { affiliatePreview } from "@casa/core";
import { z } from "zod";
import { perm, router } from "../trpc.js";

const cents = z.number().int();
const method = z.enum(["PIX", "CASH", "CREDIT_CARD", "DEBIT_CARD", "BANK_TRANSFER", "BOLETO", "CHECK", "OTHER"]);
const thank = z.enum(["PENDING", "SENT", "NOT_NEEDED"]);

export const giftsRouter = router({
  settings: perm("finance:view").query(async ({ ctx }) => {
    const [s, wallets] = await Promise.all([giftSettings(ctx.weddingId), walletBalances(ctx.weddingId)]);
    return { ...s, wallets: wallets.wallets.filter((w) => !w.archivedAt).map((w) => ({ id: w.id, name: w.name, isDefault: w.isDefault, balanceCents: w.balanceCents })), portalSlug: ctx.wedding.portalSlug, portalEnabled: ctx.wedding.portalEnabled };
  }),
  updateSettings: perm("finance:edit").input(z.object({
    giftsEnabled: z.boolean(), pixKeyType: z.enum(["CPF", "CNPJ", "EMAIL", "PHONE", "RANDOM"]).nullable(), pixKey: z.string().max(100).nullable(),
    pixReceiverName: z.string().max(60).nullable(), pixCity: z.string().max(40).nullable(), giftsWalletId: z.string().nullable(), amazonAffiliateTag: z.string().max(40).nullable().optional(),
  })).mutation(({ ctx, input }) => updateGiftSettings(ctx.svc, input)),

  /** Prévia do link do produto com a tag de afiliado aplicada */
  linkPreview: perm("finance:view").input(z.object({ url: z.string().max(2000) })).query(async ({ ctx, input }) => {
    const w = await prisma.wedding.findUniqueOrThrow({ where: { id: ctx.weddingId }, select: { amazonAffiliateTag: true } });
    return affiliatePreview(input.url, w.amazonAffiliateTag);
  }),
  items: perm("finance:view").query(({ ctx }) => listGiftItems(ctx.weddingId, { includeInactive: true })),
  saveItem: perm("finance:create").input(z.object({
    id: z.string().optional(), title: z.string().trim().min(2).max(120), description: z.string().max(1000).nullable().optional(), imageFileId: z.string().nullable().optional(),
    kind: z.enum(["ITEM", "QUOTA", "FREE", "STORE"]), priceCents: cents.min(0).nullable().optional(), quotaCount: z.number().int().min(1).max(1000).nullable().optional(),
    externalUrl: z.string().url().max(500).nullable().optional().or(z.literal("")), active: z.boolean().optional(),
  })).mutation(({ ctx, input }) => saveGiftItem(ctx.svc, { ...input, externalUrl: input.externalUrl || null })),
  deleteItem: perm("finance:delete").input(z.object({ id: z.string() })).mutation(({ ctx, input }) => deleteGiftItem(ctx.svc, input.id)),
  reorderItems: perm("finance:edit").input(z.object({ ids: z.array(z.string()).max(300) })).mutation(({ ctx, input }) => reorderGiftItems(ctx.svc, input.ids)),

  contributions: perm("finance:view").input(z.object({ status: z.enum(["PLEDGED", "CONFIRMED", "REJECTED"]).optional(), thankYou: thank.optional(), itemId: z.string().optional(), search: z.string().optional() }).optional()).query(({ ctx, input }) => listContributions(ctx.weddingId, input ?? {})),
  stats: perm("finance:view").query(({ ctx }) => giftStats(ctx.weddingId)),
  confirm: perm("finance:create").input(z.object({ id: z.string(), walletId: z.string().nullable().optional(), receivedAt: z.date().nullable().optional(), method: method.nullable().optional() })).mutation(({ ctx, input }) => confirmContribution(ctx.svc, input.id, input)),
  reject: perm("finance:edit").input(z.object({ id: z.string(), reason: z.string().trim().min(3).max(300) })).mutation(({ ctx, input }) => rejectContribution(ctx.svc, input.id, input.reason)),
  revert: perm("finance:approve").input(z.object({ id: z.string(), reason: z.string().trim().min(3).max(300) })).mutation(({ ctx, input }) => revertContribution(ctx.svc, input.id, input.reason)),
  register: perm("finance:create").input(z.object({
    giverName: z.string().trim().min(2).max(120), groupId: z.string().nullable().optional(), guestId: z.string().nullable().optional(), giftItemId: z.string().nullable().optional(),
    physicalDescription: z.string().max(300).nullable().optional(), amountCents: cents.min(1).nullable().optional(), method: method.nullable().optional(), message: z.string().max(1000).nullable().optional(),
    confirmNow: z.boolean().optional(), walletId: z.string().nullable().optional(), receivedAt: z.date().nullable().optional(),
  })).mutation(({ ctx, input }) => registerGift(ctx.svc, input).then((c) => ({ id: c.id }))),
  update: perm("finance:edit").input(z.object({ id: z.string(), giverName: z.string().trim().min(2).max(120).optional(), message: z.string().max(1000).nullable().optional(), physicalDescription: z.string().max(300).nullable().optional(), thankYouNote: z.string().max(1000).nullable().optional() })).mutation(({ ctx, input }) => {
    const { id, ...data } = input;
    return updateContribution(ctx.svc, id, data);
  }),
  setThankYou: perm("finance:edit").input(z.object({ ids: z.array(z.string()).min(1).max(500), status: thank, note: z.string().max(1000).nullable().optional() })).mutation(({ ctx, input }) => setThankYou(ctx.svc, input.ids, input.status, input.note)),
});
