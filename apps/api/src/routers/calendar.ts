import { audit, diff, installmentStatus, toObligationInput, weddingFinanceSummary } from "@casa/core";
import { prisma } from "@casa/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { perm, router } from "../trpc.js";

const eventType = z.enum(["MEETING", "FITTING", "REHEARSAL", "DELIVERY", "VISIT", "TASTING", "IMPORTANT_DATE", "OTHER"]);

export type FeedItem = {
  key: string;
  source: "event" | "task" | "installment" | "delivery" | "clause" | "rsvp" | "wedding" | "contract";
  id: string;
  title: string;
  start: Date;
  end: Date | null;
  allDay: boolean;
  type: string;
  status: string | null;
  link: string;
  meta?: Record<string, unknown>;
};

export const calendarRouter = router({
  /**
   * Agenda consolidada: cada registro aparece UMA vez, a partir da sua própria fonte
   * (evento, tarefa, parcela, entrega…). Mudar a data no registro muda a agenda — sem duplicar.
   */
  feed: perm("calendar:view").input(z.object({ from: z.date(), to: z.date() })).query(async ({ ctx, input }) => {
    const range = { gte: input.from, lte: input.to };
    const W = ctx.weddingId;
    const items: FeedItem[] = [];
    const events = await prisma.calendarEvent.findMany({ where: { weddingId: W, startsAt: range }, include: { vendor: { select: { name: true } } } });
    for (const e of events) items.push({ key: `event:${e.id}`, source: "event", id: e.id, title: e.title, start: e.startsAt, end: e.endsAt, allDay: e.allDay, type: e.type, status: e.status, link: `/calendario?evento=${e.id}`, meta: { location: e.location, vendor: e.vendor?.name } });
    if (ctx.permissions.has("planning:view")) {
      const tasks = await prisma.task.findMany({ where: { weddingId: W, archivedAt: null, dueDate: range, status: { not: "CANCELLED" } } });
      for (const t of tasks) items.push({ key: `task:${t.id}`, source: "task", id: t.id, title: t.title, start: t.dueDate!, end: null, allDay: true, type: "TASK", status: t.status, link: `/checklist?tarefa=${t.id}`, meta: { priority: t.priority } });
    }
    if (ctx.permissions.has("finance:view")) {
      const s = await weddingFinanceSummary(W);
      for (const o of s.data.obligations.filter((x) => x.status === "ACTIVE")) {
        for (const i of toObligationInput(o).installments) {
          if (i.dueDate < input.from || i.dueDate > input.to) continue;
          const st = installmentStatus(i, o.status);
          if (st.status === "CANCELLED") continue;
          items.push({ key: `inst:${i.id}`, source: "installment", id: i.id, title: `Vencimento: ${o.title}`, start: i.dueDate, end: null, allDay: true, type: "PAYMENT", status: st.status, link: `/financeiro/lancamentos/${o.id}`, meta: { amount: i.amountCents, remaining: st.remaining } });
        }
      }
    }
    if (ctx.permissions.has("vendors:view")) {
      const deliveries = await prisma.vendorDelivery.findMany({ where: { vendor: { weddingId: W }, dueAt: range }, include: { vendor: { select: { id: true, name: true } } } });
      for (const d of deliveries) items.push({ key: `delivery:${d.id}`, source: "delivery", id: d.id, title: `Entrega: ${d.description} (${d.vendor.name})`, start: d.dueAt!, end: null, allDay: true, type: "DELIVERY", status: d.deliveredAt ? "DONE" : "OPEN", link: `/fornecedores/${d.vendor.id}` });
    }
    if (ctx.permissions.has("documents:view")) {
      const clauses = await prisma.contractObligation.findMany({ where: { contract: { vendor: { weddingId: W } }, dueDate: range }, include: { contract: { select: { title: true, vendorId: true } } } });
      for (const c of clauses) items.push({ key: `clause:${c.id}`, source: "clause", id: c.id, title: `Contrato: ${c.description}`, start: c.dueDate!, end: null, allDay: true, type: "CONTRACT", status: c.doneAt ? "DONE" : "OPEN", link: `/fornecedores/${c.contract.vendorId}` });
      const contracts = await prisma.vendorContract.findMany({ where: { vendor: { weddingId: W }, expiresAt: range, status: { notIn: ["CANCELLED", "COMPLETED"] } }, include: { vendor: { select: { id: true, name: true } } } });
      for (const c of contracts) items.push({ key: `contract:${c.id}`, source: "contract", id: c.id, title: `Prazo do contrato: ${c.title} (${c.vendor.name})`, start: c.expiresAt!, end: null, allDay: true, type: "CONTRACT", status: c.status, link: `/fornecedores/${c.vendor.id}` });
    }
    const w = ctx.wedding;
    if (w.rsvpDeadline && w.rsvpDeadline >= input.from && w.rsvpDeadline <= input.to) items.push({ key: "rsvp", source: "rsvp", id: w.id, title: "Prazo de confirmação de presença", start: w.rsvpDeadline, end: null, allDay: true, type: "IMPORTANT_DATE", status: null, link: "/convites" });
    if (w.date && w.date >= input.from && w.date <= input.to) items.push({ key: "wedding", source: "wedding", id: w.id, title: "💍 Casamento", start: w.date, end: null, allDay: false, type: "IMPORTANT_DATE", status: null, link: "/" });
    return items.sort((a, b) => a.start.getTime() - b.start.getTime());
  }),

  event: perm("calendar:view").input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const e = await prisma.calendarEvent.findFirst({ where: { id: input.id, weddingId: ctx.weddingId }, include: { vendor: { select: { id: true, name: true } }, task: { select: { id: true, title: true } } } });
    if (!e) throw new TRPCError({ code: "NOT_FOUND" });
    return e;
  }),

  saveEvent: perm("calendar:create").input(z.object({
    id: z.string().optional(), title: z.string().trim().min(2).max(200), type: eventType, startsAt: z.date(), endsAt: z.date().nullable().optional(), allDay: z.boolean().default(false),
    location: z.string().max(300).nullable().optional(), description: z.string().max(5000).nullable().optional(), assigneeIds: z.array(z.string()).max(20).default([]),
    remindMinutesBefore: z.number().int().min(0).max(43200).nullable().optional(), taskId: z.string().nullable().optional(), vendorId: z.string().nullable().optional(), obligationId: z.string().nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    if (input.endsAt && input.endsAt < input.startsAt) throw new TRPCError({ code: "BAD_REQUEST", message: "O término deve ser depois do início" });
    for (const [model, id] of [["task", input.taskId], ["vendor", input.vendorId], ["financialObligation", input.obligationId]] as const) {
      if (id && !(await (prisma[model] as unknown as { count: (a: unknown) => Promise<number> }).count({ where: { id, weddingId: ctx.weddingId } }))) throw new TRPCError({ code: "BAD_REQUEST", message: "Vínculo inválido" });
    }
    const { id, ...data } = input;
    let e;
    if (id) {
      if (!ctx.permissions.has("calendar:edit")) throw new TRPCError({ code: "FORBIDDEN" });
      const before = await prisma.calendarEvent.findFirst({ where: { id, weddingId: ctx.weddingId } });
      if (!before) throw new TRPCError({ code: "NOT_FOUND" });
      e = await prisma.calendarEvent.update({ where: { id }, data });
      // Reprogramado: lembretes antigos não enviados são substituídos
      if (before.startsAt.getTime() !== e.startsAt.getTime()) await prisma.reminder.deleteMany({ where: { entityType: "event", entityId: e.id, sentAt: null } });
      await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "update", entityType: "event", entityId: e.id, summary: `Editou compromisso "${e.title}"`, changes: diff(before as never, data as never) });
    } else {
      e = await prisma.calendarEvent.create({ data: { ...data, weddingId: ctx.weddingId, createdById: ctx.user.id } });
      await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "create", entityType: "event", entityId: e.id, summary: `Criou compromisso "${e.title}"` });
    }
    if (e.remindMinutesBefore != null && e.status === "SCHEDULED") {
      const remindAt = new Date(e.startsAt.getTime() - e.remindMinutesBefore * 60_000);
      for (const userId of e.assigneeIds.length ? e.assigneeIds : [ctx.user.id]) {
        await prisma.reminder.upsert({ where: { entityType_entityId_userId_remindAt: { entityType: "event", entityId: e.id, userId, remindAt } }, create: { weddingId: ctx.weddingId, entityType: "event", entityId: e.id, userId, remindAt }, update: {} });
      }
    }
    return e;
  }),

  setEventStatus: perm("calendar:edit").input(z.object({ id: z.string(), status: z.enum(["SCHEDULED", "CANCELLED", "DONE"]) })).mutation(async ({ ctx, input }) => {
    const e = await prisma.calendarEvent.findFirst({ where: { id: input.id, weddingId: ctx.weddingId } });
    if (!e) throw new TRPCError({ code: "NOT_FOUND" });
    await prisma.calendarEvent.update({ where: { id: e.id }, data: { status: input.status } });
    if (input.status !== "SCHEDULED") await prisma.reminder.deleteMany({ where: { entityType: "event", entityId: e.id, sentAt: null } });
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: input.status === "CANCELLED" ? "cancel" : "update", entityType: "event", entityId: e.id, summary: `"${e.title}" → ${input.status}` });
  }),

  deleteEvent: perm("calendar:delete").input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const e = await prisma.calendarEvent.findFirst({ where: { id: input.id, weddingId: ctx.weddingId } });
    if (!e) throw new TRPCError({ code: "NOT_FOUND" });
    await prisma.$transaction([prisma.reminder.deleteMany({ where: { entityType: "event", entityId: e.id } }), prisma.calendarEvent.delete({ where: { id: e.id } })]);
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "delete", entityType: "event", entityId: e.id, summary: `Excluiu compromisso "${e.title}"` });
  }),
});
