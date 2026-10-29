import { audit, guestPhotoCounts, listGuestPhotos, moderateGuestPhotos } from "@casa/core";
import { prisma, type Prisma } from "@casa/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { perm, router } from "../trpc.js";

const status = z.enum(["PENDING", "APPROVED", "REJECTED"]);

export const guestPhotosRouter = router({
  counts: perm("gallery:view").query(({ ctx }) => guestPhotoCounts(ctx.weddingId)),
  list: perm("gallery:view").input(z.object({ status })).query(({ ctx, input }) => listGuestPhotos(ctx.weddingId, input.status)),
  moderate: perm("gallery:edit").input(z.object({ ids: z.array(z.string()).min(1).max(200), decision: z.enum(["approve", "reject"]), deleteFile: z.boolean().optional() })).mutation(({ ctx, input }) => {
    if (input.deleteFile && !ctx.permissions.has("gallery:delete")) throw new TRPCError({ code: "FORBIDDEN", message: "Excluir arquivos exige gallery:delete" });
    return moderateGuestPhotos(ctx.svc, input.ids, input.decision, { deleteFile: input.deleteFile });
  }),

  settings: perm("gallery:view").query(({ ctx }) => {
    const cfg = (ctx.wedding.portalConfig ?? {}) as { showGuestPhotos?: boolean };
    return { enabled: ctx.wedding.guestPhotosEnabled, maxPerFamily: ctx.wedding.guestPhotosMaxPerFamily, showWall: !!cfg.showGuestPhotos };
  }),
  saveSettings: perm("settings:edit").input(z.object({ enabled: z.boolean(), maxPerFamily: z.number().int().min(1).max(200), showWall: z.boolean() })).mutation(async ({ ctx, input }) => {
    const cfg = { ...((ctx.wedding.portalConfig ?? {}) as Record<string, unknown>), showGuestPhotos: input.showWall };
    await prisma.wedding.update({ where: { id: ctx.weddingId }, data: { guestPhotosEnabled: input.enabled, guestPhotosMaxPerFamily: input.maxPerFamily, portalConfig: cfg as Prisma.InputJsonValue } });
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "update", entityType: "guestPhoto", summary: `Fotos dos convidados: ${input.enabled ? "abertas" : "fechadas"}, até ${input.maxPerFamily} por família, mural ${input.showWall ? "visível" : "oculto"}` });
  }),

  // ───── Encerramento: agradecimentos (lê GiftContribution diretamente)
  closeoutThankYou: perm("finance:view").query(async ({ ctx }) => {
    const gifts = await prisma.giftContribution.findMany({
      where: { weddingId: ctx.weddingId, status: { not: "REJECTED" } },
      include: { group: { select: { id: true, name: true, contactPhone: true } }, giftItem: { select: { title: true } }, guest: { select: { phone: true } } },
      orderBy: { createdAt: "asc" },
    });
    return gifts.map((g) => ({
      id: g.id, giverName: g.giverName, family: g.group?.name ?? null, groupId: g.groupId, phone: g.group?.contactPhone ?? g.guest?.phone ?? null,
      what: g.physicalDescription ?? g.giftItem?.title ?? "Presente em dinheiro", amountCents: g.amountCents, status: g.status, message: g.message,
      thankYouStatus: g.thankYouStatus, thankYouSentAt: g.thankYouSentAt, thankYouNote: g.thankYouNote, createdAt: g.createdAt,
    }));
  }),
  setThankYou: perm("finance:edit").input(z.object({ ids: z.array(z.string()).min(1).max(500), status: z.enum(["PENDING", "SENT", "NOT_NEEDED"]), note: z.string().max(500).nullable().optional() })).mutation(async ({ ctx, input }) => {
    const r = await prisma.giftContribution.updateMany({
      where: { id: { in: input.ids }, weddingId: ctx.weddingId },
      data: { thankYouStatus: input.status, thankYouSentAt: input.status === "SENT" ? new Date() : null, ...(input.note !== undefined ? { thankYouNote: input.note } : {}) },
    });
    if (r.count !== new Set(input.ids).size) throw new TRPCError({ code: "NOT_FOUND", message: "Presente não encontrado" });
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "update", entityType: "thankYou", summary: `Marcou ${r.count} agradecimento(s) como ${{ PENDING: "pendente", SENT: "enviado", NOT_NEEDED: "dispensado" }[input.status]}` });
    return { count: r.count };
  }),

  /** Pendências com fornecedores para o encerramento */
  closeoutVendors: perm("vendors:view").query(async ({ ctx }) => {
    const vendors = await prisma.vendor.findMany({
      where: { weddingId: ctx.weddingId, mergedIntoId: null, archivedAt: null, OR: [{ deliveries: { some: { deliveredAt: null } } }, { contracts: { some: { status: { notIn: ["CANCELLED"] }, clauses: { some: { doneAt: null } } } } }] },
      include: { deliveries: { where: { deliveredAt: null } }, contracts: { where: { status: { notIn: ["CANCELLED"] } }, include: { clauses: { where: { doneAt: null } } } } },
      orderBy: { name: "asc" },
    });
    return vendors.map((v) => ({
      id: v.id, name: v.name, status: v.status,
      deliveries: v.deliveries.map((d) => ({ id: d.id, description: d.description, dueAt: d.dueAt })),
      clauses: v.contracts.flatMap((c) => c.clauses.map((k) => ({ id: k.id, description: k.description, party: k.party, dueDate: k.dueDate, contract: c.title }))),
    }));
  }),
});
