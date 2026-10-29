import { audit, diff, summarizeObligation, toObligationInput, obligationInclude } from "@casa/core";
import { prisma } from "@casa/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { perm, router } from "../trpc.js";

const text = (max = 5000) => z.string().max(max).nullable().optional();

/** Cobranças da cerimônia/recepção vêm do financeiro (vínculo pelo fornecedor). Nada é duplicado aqui. */
async function vendorCosts(weddingId: string, vendorIds: string[]) {
  if (!vendorIds.length) return [];
  const obligations = await prisma.financialObligation.findMany({ where: { weddingId, vendorId: { in: vendorIds } }, include: obligationInclude });
  return obligations.map((o) => {
    const s = summarizeObligation(toObligationInput(o));
    return { id: o.id, title: o.title, vendorId: o.vendorId, status: o.status, contracted: s.contracted, planned: s.planned, paid: s.paid, open: s.open, depositPending: s.depositPending, depositsContracted: s.depositsContracted };
  });
}

export const ceremonyRouter = router({
  get: perm("ceremony:view").query(async ({ ctx }) => {
    const c = (await prisma.ceremony.findUnique({ where: { weddingId: ctx.weddingId }, include: { participants: { orderBy: [{ role: "asc" }, { sortOrder: "asc" }] } } })) ?? (await prisma.ceremony.create({ data: { weddingId: ctx.weddingId }, include: { participants: true } }));
    const vendorIds = [c.churchVendorId, c.celebrantVendorId, c.plannerVendorId].filter((x): x is string => !!x);
    const [vendors, costs, tasks] = await Promise.all([
      prisma.vendor.findMany({ where: { id: { in: vendorIds }, weddingId: ctx.weddingId }, select: { id: true, name: true, phone: true, whatsapp: true, email: true, contactName: true, status: true } }),
      ctx.permissions.has("finance:view") ? vendorCosts(ctx.weddingId, vendorIds) : null,
      ctx.permissions.has("planning:view") ? prisma.task.findMany({ where: { weddingId: ctx.weddingId, archivedAt: null, area: { in: ["CHURCH", "CELEBRANT", "PLANNER", "CEREMONY"] } }, orderBy: { dueDate: "asc" }, include: { assignees: { include: { user: { select: { name: true } } } } } }) : null,
    ]);
    return { ceremony: c, vendors, costs, tasks };
  }),

  update: perm("ceremony:edit").input(z.object({
    venueName: text(200), address: text(300), startsAt: z.date().nullable().optional(), responsible: text(200), contacts: text(2000),
    churchVendorId: z.string().nullable().optional(), celebrantVendorId: z.string().nullable().optional(), plannerVendorId: z.string().nullable().optional(),
    decorationRules: text(), photoRules: text(), requiredDocs: text(), deadlines: text(), prepCourse: text(), rehearsalAt: z.date().nullable().optional(),
    readings: text(), music: text(), entranceOrder: text(), script: text(10000), restrictions: text(), notes: text(),
  })).mutation(async ({ ctx, input }) => {
    const ids = [input.churchVendorId, input.celebrantVendorId, input.plannerVendorId].filter((x): x is string => !!x);
    if (ids.length && (await prisma.vendor.count({ where: { id: { in: ids }, weddingId: ctx.weddingId } })) !== new Set(ids).size) throw new TRPCError({ code: "BAD_REQUEST", message: "Fornecedor inválido" });
    const before = await prisma.ceremony.findUnique({ where: { weddingId: ctx.weddingId } });
    const c = await prisma.ceremony.upsert({ where: { weddingId: ctx.weddingId }, create: { ...input, weddingId: ctx.weddingId }, update: input });
    // Ensaio aparece no calendário como compromisso (um só, atualizado)
    if (input.rehearsalAt !== undefined) {
      const existing = await prisma.calendarEvent.findFirst({ where: { weddingId: ctx.weddingId, type: "REHEARSAL", description: "auto:ceremony-rehearsal" } });
      if (input.rehearsalAt) {
        if (existing) await prisma.calendarEvent.update({ where: { id: existing.id }, data: { startsAt: input.rehearsalAt, location: c.venueName ?? c.address, status: "SCHEDULED" } });
        else await prisma.calendarEvent.create({ data: { weddingId: ctx.weddingId, title: "Ensaio da cerimônia", type: "REHEARSAL", startsAt: input.rehearsalAt, location: c.venueName ?? c.address, description: "auto:ceremony-rehearsal", createdById: ctx.user.id } });
      } else if (existing) await prisma.calendarEvent.update({ where: { id: existing.id }, data: { status: "CANCELLED" } });
    }
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "update", entityType: "ceremony", entityId: c.id, summary: "Atualizou dados da cerimônia", changes: diff(before as never, input as never) });
    return c;
  }),

  saveParticipant: perm("ceremony:edit").input(z.object({ id: z.string().optional(), role: z.enum(["GODPARENT", "WITNESS", "READER", "MUSICIAN", "RING_BEARER", "BRIDESMAID", "GROOMSMAN", "OTHER"]), name: z.string().min(1).max(120), side: text(20), phone: text(40), notes: text(1000), guestId: z.string().nullable().optional(), sortOrder: z.number().int().default(0) })).mutation(async ({ ctx, input }) => {
    const c = await prisma.ceremony.findUniqueOrThrow({ where: { weddingId: ctx.weddingId } });
    if (input.guestId && !(await prisma.guest.count({ where: { id: input.guestId, weddingId: ctx.weddingId } }))) throw new TRPCError({ code: "BAD_REQUEST" });
    const { id, ...data } = input;
    if (id) return prisma.ceremonyParticipant.update({ where: { id, ceremonyId: c.id }, data });
    return prisma.ceremonyParticipant.create({ data: { ...data, ceremonyId: c.id } });
  }),
  deleteParticipant: perm("ceremony:edit").input(z.object({ id: z.string() })).mutation(({ ctx, input }) => prisma.ceremonyParticipant.deleteMany({ where: { id: input.id, ceremony: { weddingId: ctx.weddingId } } })),

  // ───── Cronograma do dia
  schedule: perm("ceremony:view").query(({ ctx }) => prisma.eventScheduleItem.findMany({ where: { weddingId: ctx.weddingId }, orderBy: [{ startsAt: "asc" }, { sortOrder: "asc" }] })),
  saveScheduleItem: perm("ceremony:edit").input(z.object({ id: z.string().optional(), area: z.enum(["PREP", "CEREMONY", "RECEPTION", "OTHER"]), startsAt: z.date(), title: z.string().min(1).max(200), description: text(2000), responsible: text(200) })).mutation(async ({ ctx, input }) => {
    const { id, ...data } = input;
    if (id) {
      const r = await prisma.eventScheduleItem.updateMany({ where: { id, weddingId: ctx.weddingId }, data });
      if (!r.count) throw new TRPCError({ code: "NOT_FOUND" });
      return;
    }
    await prisma.eventScheduleItem.create({ data: { ...data, weddingId: ctx.weddingId } });
  }),
  deleteScheduleItem: perm("ceremony:edit").input(z.object({ id: z.string() })).mutation(({ ctx, input }) => prisma.eventScheduleItem.deleteMany({ where: { id: input.id, weddingId: ctx.weddingId } })),

  // ───── Locais da recepção
  venues: perm("venue:view").query(async ({ ctx }) => {
    const venues = await prisma.receptionVenue.findMany({ where: { weddingId: ctx.weddingId }, include: { vendor: { select: { id: true, name: true, status: true } } }, orderBy: [{ chosen: "desc" }, { createdAt: "asc" }] });
    const costs = ctx.permissions.has("finance:view") ? await vendorCosts(ctx.weddingId, venues.map((v) => v.vendorId).filter((x): x is string => !!x)) : null;
    const tasks = ctx.permissions.has("planning:view") ? await prisma.task.findMany({ where: { weddingId: ctx.weddingId, archivedAt: null, area: "RECEPTION" }, orderBy: { dueDate: "asc" } }) : null;
    return { venues, costs, tasks };
  }),
  saveVenue: perm("venue:create").input(z.object({
    id: z.string().optional(), name: z.string().min(2).max(200), vendorId: z.string().nullable().optional(), capacity: z.number().int().min(0).max(100000).nullable().optional(),
    address: text(300), usageHours: text(500), setupRules: text(), soundRestrictions: text(), accessibility: text(), parking: text(), cancellationPolicy: text(), contingencyPlan: text(),
    includedServices: text(), extraFees: text(), responsible: text(200), notes: text(),
  })).mutation(async ({ ctx, input }) => {
    if (input.vendorId && !(await prisma.vendor.count({ where: { id: input.vendorId, weddingId: ctx.weddingId } }))) throw new TRPCError({ code: "BAD_REQUEST", message: "Fornecedor inválido" });
    const { id, ...data } = input;
    if (id) {
      if (!ctx.permissions.has("venue:edit")) throw new TRPCError({ code: "FORBIDDEN" });
      const r = await prisma.receptionVenue.updateMany({ where: { id, weddingId: ctx.weddingId }, data });
      if (!r.count) throw new TRPCError({ code: "NOT_FOUND" });
      await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "update", entityType: "venue", entityId: id, summary: `Editou local "${input.name}"` });
      return;
    }
    const v = await prisma.receptionVenue.create({ data: { ...data, weddingId: ctx.weddingId } });
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "create", entityType: "venue", entityId: v.id, summary: `Cadastrou local "${v.name}"` });
  }),
  chooseVenue: perm("venue:edit").input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const v = await prisma.receptionVenue.findFirst({ where: { id: input.id, weddingId: ctx.weddingId } });
    if (!v) throw new TRPCError({ code: "NOT_FOUND" });
    await prisma.$transaction([
      prisma.receptionVenue.updateMany({ where: { weddingId: ctx.weddingId }, data: { chosen: false } }),
      prisma.receptionVenue.update({ where: { id: v.id }, data: { chosen: true } }),
      ...(v.address && !ctx.wedding.receptionAddress ? [prisma.wedding.update({ where: { id: ctx.weddingId }, data: { receptionAddress: v.address } })] : []),
    ]);
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "update", entityType: "venue", entityId: v.id, summary: `Escolheu "${v.name}" como local da recepção` });
  }),
  deleteVenue: perm("venue:delete").input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const v = await prisma.receptionVenue.findFirst({ where: { id: input.id, weddingId: ctx.weddingId } });
    if (!v) throw new TRPCError({ code: "NOT_FOUND" });
    await prisma.receptionVenue.delete({ where: { id: v.id } });
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "delete", entityType: "venue", entityId: v.id, summary: `Excluiu local "${v.name}"` });
  }),
});
