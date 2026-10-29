import { audit, diff, nameKey, normalizePhone } from "@casa/core";
import { prisma, type Prisma } from "@casa/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { perm, router } from "../trpc.js";

const status = z.enum(["RESEARCHED", "CONTACTED", "QUOTE_RECEIVED", "NEGOTIATING", "HIRED", "COMPLETED", "DISCARDED"]);
const opt = (max = 300) => z.string().trim().max(max).nullable().optional();
const vendorInput = z.object({
  name: z.string().trim().min(2).max(200), legalName: opt(200), contactName: opt(120), categoryId: z.string().nullable().optional(), phone: opt(40), whatsapp: opt(40),
  email: z.string().email().nullable().optional().or(z.literal("")), address: opt(), document: opt(30), website: opt(), instagram: opt(120), notes: opt(5000), status: status.optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(), lastContactAt: z.date().nullable().optional(),
});

async function own(weddingId: string, vendorId: string) {
  const v = await prisma.vendor.findFirst({ where: { id: vendorId, weddingId } });
  if (!v) throw new TRPCError({ code: "NOT_FOUND", message: "Fornecedor não encontrado" });
  return v;
}

/** Possíveis duplicados: mesmo nome normalizado, telefone, e-mail ou documento */
async function findDuplicates(weddingId: string, v: { name: string; phone?: string | null; whatsapp?: string | null; email?: string | null; document?: string | null }, excludeId?: string) {
  const all = await prisma.vendor.findMany({ where: { weddingId, mergedIntoId: null, id: excludeId ? { not: excludeId } : undefined }, select: { id: true, name: true, phone: true, whatsapp: true, email: true, document: true } });
  const phones = [normalizePhone(v.phone), normalizePhone(v.whatsapp)].filter(Boolean);
  return all.filter((o) =>
    nameKey(o.name) === nameKey(v.name) ||
    (phones.length && [normalizePhone(o.phone), normalizePhone(o.whatsapp)].some((p) => p && phones.includes(p))) ||
    (v.email && o.email && o.email.toLowerCase() === v.email.toLowerCase()) ||
    (v.document && o.document && o.document.replace(/\D/g, "") === v.document.replace(/\D/g, "")),
  );
}

export const vendorsRouter = router({
  list: perm("vendors:view").input(z.object({ status: status.optional(), categoryId: z.string().optional(), search: z.string().optional(), includeArchived: z.boolean().optional() }).optional()).query(async ({ ctx, input }) => {
    const vendors = await prisma.vendor.findMany({
      where: {
        weddingId: ctx.weddingId, mergedIntoId: null, ...(input?.includeArchived ? {} : { archivedAt: null }), ...(input?.status ? { status: input.status } : {}), ...(input?.categoryId ? { categoryId: input.categoryId } : {}),
        ...(input?.search ? { OR: [{ name: { contains: input.search, mode: "insensitive" } }, { contactName: { contains: input.search, mode: "insensitive" } }] } : {}),
      },
      include: { category: { select: { id: true, name: true } }, _count: { select: { quotes: true, contracts: true, tasks: { where: { status: { notIn: ["DONE", "CANCELLED"] } } }, deliveries: { where: { deliveredAt: null } } } } },
      orderBy: { name: "asc" },
    });
    return vendors;
  }),

  get: perm("vendors:view").input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const v = await prisma.vendor.findFirst({
      where: { id: input.id, weddingId: ctx.weddingId },
      include: {
        category: true, contacts: true, quotes: { include: { items: true }, orderBy: { createdAt: "desc" } }, contracts: { include: { clauses: { orderBy: { dueDate: "asc" } } }, orderBy: { createdAt: "desc" } },
        interactions: { orderBy: { occurredAt: "desc" }, take: 100 }, deliveries: { orderBy: { dueAt: "asc" } },
        tasks: { where: { archivedAt: null }, orderBy: { dueDate: "asc" }, select: { id: true, title: true, status: true, dueDate: true, priority: true } },
        events: { orderBy: { startsAt: "desc" }, take: 30, select: { id: true, title: true, startsAt: true, type: true, status: true } },
      },
    });
    if (!v) throw new TRPCError({ code: "NOT_FOUND" });
    const canFinance = ctx.permissions.has("finance:view");
    const [obligations, files, messages] = await Promise.all([
      canFinance ? prisma.financialObligation.findMany({ where: { weddingId: ctx.weddingId, vendorId: v.id }, select: { id: true, title: true, status: true } }) : [],
      ctx.permissions.has("documents:view") ? prisma.fileAsset.findMany({ where: { weddingId: ctx.weddingId, entityType: { in: ["vendor", "contract", "quote"] }, entityId: { in: [v.id, ...v.contracts.map((c) => c.id), ...v.quotes.map((q) => q.id)] }, deletedAt: null }, select: { id: true, originalName: true, mimeType: true, entityType: true, entityId: true, createdAt: true, category: true } }) : [],
      ctx.permissions.has("whatsapp:view") ? prisma.outboundMessage.findMany({ where: { weddingId: ctx.weddingId, vendorId: v.id }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, body: true, status: true, createdAt: true } }) : [],
    ]);
    return { ...v, obligations, files, messages, canFinance };
  }),

  checkDuplicates: perm("vendors:view").input(vendorInput.pick({ name: true, phone: true, whatsapp: true, email: true, document: true }).extend({ excludeId: z.string().optional() })).query(({ ctx, input }) => findDuplicates(ctx.weddingId, { ...input, email: input.email || null }, input.excludeId)),

  save: perm("vendors:create").input(vendorInput.extend({ id: z.string().optional(), ignoreDuplicates: z.boolean().optional() })).mutation(async ({ ctx, input }) => {
    const { id, ignoreDuplicates, ...raw } = input;
    const data = { ...raw, email: raw.email || null, phone: normalizePhone(raw.phone) ?? raw.phone ?? null, whatsapp: normalizePhone(raw.whatsapp) ?? raw.whatsapp ?? null };
    if (data.categoryId && !(await prisma.financialCategory.count({ where: { id: data.categoryId, weddingId: ctx.weddingId } }))) throw new TRPCError({ code: "BAD_REQUEST", message: "Categoria inválida" });
    if (!ignoreDuplicates) {
      const dups = await findDuplicates(ctx.weddingId, data, id);
      if (dups.length) throw new TRPCError({ code: "CONFLICT", message: `DUPLICATE:${JSON.stringify(dups.map((d) => ({ id: d.id, name: d.name })))}` });
    }
    if (id) {
      if (!ctx.permissions.has("vendors:edit")) throw new TRPCError({ code: "FORBIDDEN" });
      const before = await own(ctx.weddingId, id);
      const v = await prisma.vendor.update({ where: { id }, data });
      await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "update", entityType: "vendor", entityId: id, summary: `Editou fornecedor "${v.name}"`, changes: diff(before as never, data as never) });
      return v;
    }
    const v = await prisma.vendor.create({ data: { ...data, weddingId: ctx.weddingId } });
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "create", entityType: "vendor", entityId: v.id, summary: `Cadastrou fornecedor "${v.name}"` });
    return v;
  }),

  setStatus: perm("vendors:edit").input(z.object({ id: z.string(), status })).mutation(async ({ ctx, input }) => {
    const v = await own(ctx.weddingId, input.id);
    await prisma.vendor.update({ where: { id: v.id }, data: { status: input.status } });
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "update", entityType: "vendor", entityId: v.id, summary: `"${v.name}": ${v.status} → ${input.status}` });
  }),

  archive: perm("vendors:delete").input(z.object({ id: z.string(), archived: z.boolean() })).mutation(async ({ ctx, input }) => {
    const v = await own(ctx.weddingId, input.id);
    await prisma.vendor.update({ where: { id: v.id }, data: { archivedAt: input.archived ? new Date() : null } });
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: input.archived ? "archive" : "restore", entityType: "vendor", entityId: v.id, summary: `${input.archived ? "Arquivou" : "Restaurou"} fornecedor "${v.name}"` });
  }),

  /** Mescla controlada: move tudo do duplicado para o principal e marca o duplicado */
  merge: perm("vendors:edit").input(z.object({ keepId: z.string(), mergeId: z.string() })).mutation(async ({ ctx, input }) => {
    if (input.keepId === input.mergeId) throw new TRPCError({ code: "BAD_REQUEST" });
    const [keep, dup] = await Promise.all([own(ctx.weddingId, input.keepId), own(ctx.weddingId, input.mergeId)]);
    await prisma.$transaction(async (tx) => {
      const move = { where: { vendorId: dup.id }, data: { vendorId: keep.id } };
      await tx.vendorContact.updateMany(move);
      await tx.vendorQuote.updateMany(move);
      await tx.vendorContract.updateMany(move);
      await tx.vendorInteraction.updateMany(move);
      await tx.vendorDelivery.updateMany(move);
      await tx.financialObligation.updateMany(move);
      await tx.task.updateMany(move);
      await tx.calendarEvent.updateMany(move);
      await tx.receptionVenue.updateMany(move);
      await tx.fileAsset.updateMany({ where: { weddingId: ctx.weddingId, entityType: "vendor", entityId: dup.id }, data: { entityId: keep.id } });
      const fill: Prisma.VendorUpdateInput = {};
      for (const k of ["legalName", "contactName", "phone", "whatsapp", "email", "address", "document", "website", "instagram"] as const) if (!keep[k] && dup[k]) fill[k] = dup[k];
      if (dup.notes) fill.notes = [keep.notes, `[Mesclado de "${dup.name}"] ${dup.notes}`].filter(Boolean).join("\n\n");
      await tx.vendor.update({ where: { id: keep.id }, data: fill });
      await tx.vendor.update({ where: { id: dup.id }, data: { mergedIntoId: keep.id, archivedAt: new Date() } });
      await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "merge", entityType: "vendor", entityId: keep.id, summary: `Mesclou "${dup.name}" em "${keep.name}"` }, tx);
    });
  }),

  /** Comparação lado a lado (orçamentos) */
  compare: perm("vendors:view").input(z.object({ ids: z.array(z.string()).min(2).max(6) })).query(async ({ ctx, input }) => {
    return prisma.vendor.findMany({ where: { id: { in: input.ids }, weddingId: ctx.weddingId }, include: { category: { select: { name: true } }, quotes: { include: { items: true }, orderBy: { createdAt: "desc" } }, contracts: { select: { title: true, status: true, totalCents: true, cancellationPolicy: true } } } });
  }),

  // ───── Contatos
  saveContact: perm("vendors:edit").input(z.object({ id: z.string().optional(), vendorId: z.string(), name: z.string().min(1).max(120), role: opt(80), phone: opt(40), email: opt(200) })).mutation(async ({ ctx, input }) => {
    await own(ctx.weddingId, input.vendorId);
    const { id, ...data } = input;
    if (id) {
      const c = await prisma.vendorContact.findFirst({ where: { id, vendorId: input.vendorId } });
      if (!c) throw new TRPCError({ code: "NOT_FOUND" });
      return prisma.vendorContact.update({ where: { id }, data });
    }
    return prisma.vendorContact.create({ data });
  }),
  deleteContact: perm("vendors:edit").input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await prisma.vendorContact.deleteMany({ where: { id: input.id, vendor: { weddingId: ctx.weddingId } } });
  }),

  // ───── Orçamentos
  saveQuote: perm("vendors:edit").input(z.object({
    id: z.string().optional(), vendorId: z.string(), title: z.string().min(2).max(200), status: z.enum(["REQUESTED", "RECEIVED", "ACCEPTED", "REJECTED", "EXPIRED"]),
    validUntil: z.date().nullable().optional(), includedServices: opt(5000), paymentTerms: opt(2000), extraFees: opt(2000), cancellationPenalty: opt(2000), availability: opt(500), notes: opt(5000), fileId: z.string().nullable().optional(),
    items: z.array(z.object({ description: z.string().min(1).max(200), quantity: z.string().regex(/^\d+(\.\d{1,3})?$/), unitCents: z.number().int().min(0) })).max(100),
    totalCents: z.number().int().min(0).optional(),
  })).mutation(async ({ ctx, input }) => {
    const v = await own(ctx.weddingId, input.vendorId);
    const { id, items, ...data } = input;
    const computed = items.reduce((a, i) => a + Math.round(i.unitCents * Number(i.quantity)), 0);
    const totalCents = items.length ? computed : (input.totalCents ?? 0);
    const q = await prisma.$transaction(async (tx) => {
      if (id) {
        const q = await tx.vendorQuote.findFirst({ where: { id, vendorId: v.id } });
        if (!q) throw new TRPCError({ code: "NOT_FOUND" });
        await tx.vendorQuoteItem.deleteMany({ where: { quoteId: id } });
        return tx.vendorQuote.update({ where: { id }, data: { ...data, totalCents, items: { create: items } } });
      }
      return tx.vendorQuote.create({ data: { ...data, totalCents, items: { create: items } } });
    });
    if (!id && ["RESEARCHED", "CONTACTED"].includes(v.status)) await prisma.vendor.update({ where: { id: v.id }, data: { status: "QUOTE_RECEIVED" } });
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: id ? "update" : "create", entityType: "quote", entityId: q.id, summary: `${id ? "Editou" : "Registrou"} orçamento "${q.title}" de ${v.name}` });
    return q;
  }),
  deleteQuote: perm("vendors:delete").input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const q = await prisma.vendorQuote.findFirst({ where: { id: input.id, vendor: { weddingId: ctx.weddingId } } });
    if (!q) throw new TRPCError({ code: "NOT_FOUND" });
    await prisma.vendorQuote.delete({ where: { id: q.id } });
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "delete", entityType: "quote", entityId: q.id, summary: `Excluiu orçamento "${q.title}"` });
  }),

  // ───── Contratos
  contracts: perm("documents:view").input(z.object({ status: z.enum(["DRAFT", "UNDER_REVIEW", "SIGNED", "COMPLETED", "CANCELLED"]).optional() }).optional()).query(({ ctx, input }) =>
    prisma.vendorContract.findMany({ where: { vendor: { weddingId: ctx.weddingId }, ...(input?.status ? { status: input.status } : {}) }, include: { vendor: { select: { id: true, name: true } }, clauses: true }, orderBy: { updatedAt: "desc" } }),
  ),
  saveContract: perm("documents:create").input(z.object({
    id: z.string().optional(), vendorId: z.string(), title: z.string().min(2).max(200), status: z.enum(["DRAFT", "UNDER_REVIEW", "SIGNED", "COMPLETED", "CANCELLED"]),
    signedAt: z.date().nullable().optional(), serviceDate: z.date().nullable().optional(), expiresAt: z.date().nullable().optional(), totalCents: z.number().int().min(0).default(0),
    cancellationPolicy: opt(5000), notes: opt(5000), fileId: z.string().nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    const v = await own(ctx.weddingId, input.vendorId);
    if (input.fileId && !(await prisma.fileAsset.count({ where: { id: input.fileId, weddingId: ctx.weddingId } }))) throw new TRPCError({ code: "BAD_REQUEST", message: "Arquivo inválido" });
    const { id, ...data } = input;
    let c;
    if (id) {
      if (!ctx.permissions.has("documents:edit")) throw new TRPCError({ code: "FORBIDDEN" });
      const before = await prisma.vendorContract.findFirst({ where: { id, vendor: { weddingId: ctx.weddingId } } });
      if (!before) throw new TRPCError({ code: "NOT_FOUND" });
      c = await prisma.vendorContract.update({ where: { id }, data });
      await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "update", entityType: "contract", entityId: c.id, summary: `Editou contrato "${c.title}" (${v.name})`, changes: diff(before as never, data as never) });
    } else {
      c = await prisma.vendorContract.create({ data });
      await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "create", entityType: "contract", entityId: c.id, summary: `Cadastrou contrato "${c.title}" (${v.name})` });
    }
    if (c.fileId) await prisma.fileAsset.updateMany({ where: { id: c.fileId, weddingId: ctx.weddingId, entityId: null }, data: { entityType: "contract", entityId: c.id, category: "CONTRACT" } });
    if (input.status === "SIGNED" && !["HIRED", "COMPLETED"].includes(v.status)) await prisma.vendor.update({ where: { id: v.id }, data: { status: "HIRED" } });
    return c;
  }),
  saveClause: perm("documents:edit").input(z.object({ id: z.string().optional(), contractId: z.string(), description: z.string().min(2).max(1000), party: z.enum(["VENDOR", "COUPLE"]), dueDate: z.date().nullable().optional(), done: z.boolean().optional() })).mutation(async ({ ctx, input }) => {
    const c = await prisma.vendorContract.findFirst({ where: { id: input.contractId, vendor: { weddingId: ctx.weddingId } } });
    if (!c) throw new TRPCError({ code: "NOT_FOUND" });
    const data = { description: input.description, party: input.party, dueDate: input.dueDate ?? null, doneAt: input.done ? new Date() : null };
    if (input.id) return prisma.contractObligation.update({ where: { id: input.id, contractId: c.id }, data });
    return prisma.contractObligation.create({ data: { ...data, contractId: c.id } });
  }),
  deleteClause: perm("documents:edit").input(z.object({ id: z.string() })).mutation(({ ctx, input }) => prisma.contractObligation.deleteMany({ where: { id: input.id, contract: { vendor: { weddingId: ctx.weddingId } } } })),

  // ───── Interações e entregas
  addInteraction: perm("vendors:edit").input(z.object({ vendorId: z.string(), type: z.enum(["call", "meeting", "whatsapp", "email", "visit", "note"]), occurredAt: z.date(), summary: z.string().min(2).max(2000) })).mutation(async ({ ctx, input }) => {
    const v = await own(ctx.weddingId, input.vendorId);
    const i = await prisma.vendorInteraction.create({ data: { ...input, userId: ctx.user.id } });
    if (!v.lastContactAt || v.lastContactAt < input.occurredAt) await prisma.vendor.update({ where: { id: v.id }, data: { lastContactAt: input.occurredAt, ...(v.status === "RESEARCHED" ? { status: "CONTACTED" } : {}) } });
    return i;
  }),
  deleteInteraction: perm("vendors:edit").input(z.object({ id: z.string() })).mutation(({ ctx, input }) => prisma.vendorInteraction.deleteMany({ where: { id: input.id, vendor: { weddingId: ctx.weddingId } } })),
  saveDelivery: perm("vendors:edit").input(z.object({ id: z.string().optional(), vendorId: z.string(), description: z.string().min(2).max(500), dueAt: z.date().nullable().optional(), delivered: z.boolean().optional(), notes: opt(1000) })).mutation(async ({ ctx, input }) => {
    await own(ctx.weddingId, input.vendorId);
    const data = { description: input.description, dueAt: input.dueAt ?? null, deliveredAt: input.delivered ? new Date() : null, notes: input.notes ?? null };
    if (input.id) return prisma.vendorDelivery.update({ where: { id: input.id, vendorId: input.vendorId }, data });
    return prisma.vendorDelivery.create({ data: { ...data, vendorId: input.vendorId } });
  }),
  deleteDelivery: perm("vendors:edit").input(z.object({ id: z.string() })).mutation(({ ctx, input }) => prisma.vendorDelivery.deleteMany({ where: { id: input.id, vendor: { weddingId: ctx.weddingId } } })),
});
