import { audit, diff, generateTasksFromTemplate } from "@casa/core";
import { prisma, type Prisma } from "@casa/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { perm, router } from "../trpc.js";

const taskStatus = z.enum(["NOT_STARTED", "IN_PROGRESS", "WAITING_THIRD_PARTY", "WAITING_APPROVAL", "DONE", "CANCELLED"]);
const priority = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
const taskInclude = {
  assignees: { include: { user: { select: { id: true, name: true } } } },
  vendor: { select: { id: true, name: true } },
  dependsOn: { include: { dependsOn: { select: { id: true, title: true, status: true } } } },
  _count: { select: { comments: true } },
} satisfies Prisma.TaskInclude;

/** Detecta ciclo: B depende de A e A (direta ou indiretamente) depende de B */
async function wouldCycle(taskId: string, dependsOnIds: string[]) {
  const seen = new Set<string>();
  const stack = [...dependsOnIds];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const deps = await prisma.taskDependency.findMany({ where: { taskId: id }, select: { dependsOnId: true } });
    stack.push(...deps.map((d) => d.dependsOnId));
  }
  return false;
}

export const planningRouter = router({
  tasks: perm("planning:view").input(z.object({
    status: z.array(taskStatus).optional(), phase: z.number().int().optional(), area: z.string().optional(), assigneeId: z.string().optional(), vendorId: z.string().optional(),
    overdue: z.boolean().optional(), search: z.string().optional(), archived: z.boolean().optional(), mine: z.boolean().optional(),
  }).optional()).query(({ ctx, input }) => {
    const now = new Date();
    // Colaborador sem planning:create só vê o que lhe foi atribuído
    const restricted = !ctx.permissions.has("planning:create");
    return prisma.task.findMany({
      where: {
        weddingId: ctx.weddingId,
        archivedAt: input?.archived ? { not: null } : null,
        ...(input?.status?.length ? { status: { in: input.status } } : {}),
        ...(input?.phase ? { phase: input.phase } : {}),
        ...(input?.area ? { area: input.area } : {}),
        ...(input?.vendorId ? { vendorId: input.vendorId } : {}),
        ...(input?.assigneeId || input?.mine || restricted ? { assignees: { some: { userId: input?.assigneeId ?? ctx.user.id } } } : {}),
        ...(input?.overdue ? { dueDate: { lt: now }, status: { notIn: ["DONE", "CANCELLED"] } } : {}),
        ...(input?.search ? { title: { contains: input.search, mode: "insensitive" } } : {}),
      },
      include: taskInclude,
      orderBy: [{ phase: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    });
  }),

  task: perm("planning:view").input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const t = await prisma.task.findFirst({
      where: { id: input.id, weddingId: ctx.weddingId },
      include: { ...taskInclude, blocks: { include: { task: { select: { id: true, title: true, status: true } } } }, comments: { orderBy: { createdAt: "asc" } }, obligation: { select: { id: true, title: true } }, events: { select: { id: true, title: true, startsAt: true } } },
    });
    if (!t) throw new TRPCError({ code: "NOT_FOUND" });
    const [files, history, users] = await Promise.all([
      prisma.fileAsset.findMany({ where: { weddingId: ctx.weddingId, entityType: "task", entityId: t.id, deletedAt: null }, select: { id: true, originalName: true, mimeType: true, size: true, createdAt: true } }),
      prisma.auditLog.findMany({ where: { weddingId: ctx.weddingId, entityType: "task", entityId: t.id }, orderBy: { createdAt: "desc" }, take: 50 }),
      prisma.user.findMany({ where: { id: { in: t.comments.map((c) => c.userId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
    ]);
    return { ...t, obligation: ctx.permissions.has("finance:view") ? t.obligation : null, files, history, commentAuthors: Object.fromEntries(users.map((u) => [u.id, u.name])) };
  }),

  saveTask: perm("planning:create").input(z.object({
    id: z.string().optional(), title: z.string().trim().min(2).max(200), description: z.string().max(5000).nullable().optional(), category: z.string().max(80).nullable().optional(),
    phase: z.number().int().min(1).max(20).nullable().optional(), area: z.string().max(30).nullable().optional(), priority, status: taskStatus.optional(), dueDate: z.date().nullable().optional(),
    notes: z.string().max(5000).nullable().optional(), vendorId: z.string().nullable().optional(), obligationId: z.string().nullable().optional(), remindAt: z.date().nullable().optional(),
    assigneeIds: z.array(z.string()).max(20).default([]), dependsOnIds: z.array(z.string()).max(30).default([]),
  })).mutation(async ({ ctx, input }) => {
    const { id, assigneeIds, dependsOnIds, ...data } = input;
    if (data.vendorId && !(await prisma.vendor.count({ where: { id: data.vendorId, weddingId: ctx.weddingId } }))) throw new TRPCError({ code: "BAD_REQUEST", message: "Fornecedor inválido" });
    if (data.obligationId && !(await prisma.financialObligation.count({ where: { id: data.obligationId, weddingId: ctx.weddingId } }))) throw new TRPCError({ code: "BAD_REQUEST", message: "Despesa inválida" });
    const members = await prisma.weddingMember.count({ where: { weddingId: ctx.weddingId, userId: { in: assigneeIds }, active: true } });
    if (members !== assigneeIds.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Responsável inválido" });
    const deps = await prisma.task.count({ where: { id: { in: dependsOnIds }, weddingId: ctx.weddingId } });
    if (deps !== dependsOnIds.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Dependência inválida" });
    if (id && (dependsOnIds.includes(id) || (await wouldCycle(id, dependsOnIds)))) throw new TRPCError({ code: "BAD_REQUEST", message: "Dependência circular" });

    const before = id ? await prisma.task.findFirst({ where: { id, weddingId: ctx.weddingId } }) : null;
    if (id && !before) throw new TRPCError({ code: "NOT_FOUND" });
    if (id && !ctx.permissions.has("planning:edit")) throw new TRPCError({ code: "FORBIDDEN" });
    const completedAt = data.status === "DONE" ? (before?.completedAt ?? new Date()) : data.status ? null : undefined;
    const t = await prisma.$transaction(async (tx) => {
      const t = before
        ? await tx.task.update({ where: { id: before.id }, data: { ...data, completedAt } })
        : await tx.task.create({ data: { ...data, completedAt, weddingId: ctx.weddingId, createdById: ctx.user.id } });
      await tx.taskAssignee.deleteMany({ where: { taskId: t.id } });
      if (assigneeIds.length) await tx.taskAssignee.createMany({ data: assigneeIds.map((userId) => ({ taskId: t.id, userId })) });
      await tx.taskDependency.deleteMany({ where: { taskId: t.id } });
      if (dependsOnIds.length) await tx.taskDependency.createMany({ data: dependsOnIds.map((d) => ({ taskId: t.id, dependsOnId: d })) });
      if (t.remindAt) {
        for (const userId of assigneeIds.length ? assigneeIds : [ctx.user.id]) {
          await tx.reminder.upsert({ where: { entityType_entityId_userId_remindAt: { entityType: "task", entityId: t.id, userId, remindAt: t.remindAt } }, create: { weddingId: ctx.weddingId, entityType: "task", entityId: t.id, userId, remindAt: t.remindAt }, update: {} });
        }
      }
      await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: before ? "update" : "create", entityType: "task", entityId: t.id, summary: `${before ? "Editou" : "Criou"} tarefa "${t.title}"`, changes: before ? diff(before as never, data as never) : undefined }, tx);
      return t;
    });
    return t;
  }),

  /** Concluir, reabrir, mudar status. Não conclui com dependência em aberto. */
  setStatus: perm("planning:edit").input(z.object({ id: z.string(), status: taskStatus })).mutation(async ({ ctx, input }) => {
    const t = await prisma.task.findFirst({ where: { id: input.id, weddingId: ctx.weddingId }, include: { dependsOn: { include: { dependsOn: { select: { title: true, status: true } } } }, assignees: true } });
    if (!t) throw new TRPCError({ code: "NOT_FOUND" });
    if (!ctx.permissions.has("planning:create") && !t.assignees.some((a) => a.userId === ctx.user.id)) throw new TRPCError({ code: "FORBIDDEN", message: "Tarefa não atribuída a você" });
    if (input.status === "DONE") {
      const open = t.dependsOn.filter((d) => !["DONE", "CANCELLED"].includes(d.dependsOn.status));
      if (open.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Conclua antes: ${open.map((d) => d.dependsOn.title).join(", ")}` });
    }
    await prisma.task.update({ where: { id: t.id }, data: { status: input.status, completedAt: input.status === "DONE" ? new Date() : null } });
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: input.status === "DONE" ? "complete" : t.status === "DONE" ? "reopen" : "update", entityType: "task", entityId: t.id, summary: `"${t.title}": ${t.status} → ${input.status}` });
  }),

  archive: perm("planning:edit").input(z.object({ id: z.string(), archived: z.boolean() })).mutation(async ({ ctx, input }) => {
    const t = await prisma.task.findFirst({ where: { id: input.id, weddingId: ctx.weddingId } });
    if (!t) throw new TRPCError({ code: "NOT_FOUND" });
    await prisma.task.update({ where: { id: t.id }, data: { archivedAt: input.archived ? new Date() : null } });
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: input.archived ? "archive" : "restore", entityType: "task", entityId: t.id, summary: `${input.archived ? "Arquivou" : "Restaurou"} "${t.title}"` });
  }),

  delete: perm("planning:delete").input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const t = await prisma.task.findFirst({ where: { id: input.id, weddingId: ctx.weddingId } });
    if (!t) throw new TRPCError({ code: "NOT_FOUND" });
    await prisma.task.delete({ where: { id: t.id } });
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "delete", entityType: "task", entityId: t.id, summary: `Excluiu tarefa "${t.title}"` });
  }),

  addComment: perm("planning:view").input(z.object({ taskId: z.string(), body: z.string().trim().min(1).max(3000) })).mutation(async ({ ctx, input }) => {
    if (!(await prisma.task.count({ where: { id: input.taskId, weddingId: ctx.weddingId } }))) throw new TRPCError({ code: "NOT_FOUND" });
    return prisma.taskComment.create({ data: { taskId: input.taskId, body: input.body, userId: ctx.user.id } });
  }),

  stats: perm("planning:view").query(async ({ ctx }) => {
    const now = new Date();
    const [byStatus, overdue] = await Promise.all([
      prisma.task.groupBy({ by: ["status"], where: { weddingId: ctx.weddingId, archivedAt: null }, _count: true }),
      prisma.task.count({ where: { weddingId: ctx.weddingId, archivedAt: null, dueDate: { lt: now }, status: { notIn: ["DONE", "CANCELLED"] } } }),
    ]);
    const n = (s: string) => byStatus.find((b) => b.status === s)?._count ?? 0;
    return { total: byStatus.reduce((a, b) => a + b._count, 0), done: n("DONE"), cancelled: n("CANCELLED"), open: byStatus.filter((b) => !["DONE", "CANCELLED"].includes(b.status)).reduce((a, b) => a + b._count, 0), overdue };
  }),

  // ───── Modelos de checklist
  templates: perm("planning:view").query(({ ctx }) =>
    prisma.checklistTemplate.findMany({ where: { OR: [{ weddingId: null }, { weddingId: ctx.weddingId }] }, include: { items: { orderBy: [{ phase: "asc" }, { sortOrder: "asc" }] } }, orderBy: { createdAt: "asc" } }),
  ),
  /** Copia o modelo padrão para o casamento (para editar sem afetar outros) */
  cloneTemplate: perm("planning:create").input(z.object({ templateId: z.string(), name: z.string().min(2).max(100) })).mutation(async ({ ctx, input }) => {
    const src = await prisma.checklistTemplate.findFirst({ where: { id: input.templateId, OR: [{ weddingId: null }, { weddingId: ctx.weddingId }] }, include: { items: true } });
    if (!src) throw new TRPCError({ code: "NOT_FOUND" });
    return prisma.checklistTemplate.create({ data: { weddingId: ctx.weddingId, name: input.name, items: { create: src.items.map(({ id: _i, templateId: _t, ...i }) => i) } } });
  }),
  saveTemplateItem: perm("planning:edit").input(z.object({ id: z.string().optional(), templateId: z.string(), phase: z.number().int().min(1).max(20), phaseName: z.string().min(1).max(80), title: z.string().min(2).max(200), description: z.string().max(2000).nullable().optional(), area: z.string().max(30).nullable().optional(), priority, offsetDays: z.number().int().min(-1000).max(1000).nullable().optional() })).mutation(async ({ ctx, input }) => {
    const tpl = await prisma.checklistTemplate.findFirst({ where: { id: input.templateId, weddingId: ctx.weddingId } });
    if (!tpl) throw new TRPCError({ code: "FORBIDDEN", message: "Copie o modelo padrão para editá-lo" });
    const { id, ...data } = input;
    if (id) return prisma.checklistTemplateItem.update({ where: { id, templateId: tpl.id }, data });
    return prisma.checklistTemplateItem.create({ data: { ...data, sortOrder: 999 } });
  }),
  deleteTemplateItem: perm("planning:edit").input(z.object({ id: z.string() })).mutation(({ ctx, input }) => prisma.checklistTemplateItem.deleteMany({ where: { id: input.id, template: { weddingId: ctx.weddingId } } })),
  deleteTemplate: perm("planning:delete").input(z.object({ id: z.string() })).mutation(({ ctx, input }) => prisma.checklistTemplate.deleteMany({ where: { id: input.id, weddingId: ctx.weddingId } })),

  /** Gera tarefas; datas propostas a partir da data do casamento podem ser ajustadas antes */
  generateFromTemplate: perm("planning:create").input(z.object({ templateId: z.string(), phases: z.array(z.number().int()).optional(), itemIds: z.array(z.string()).optional(), dateOverrides: z.record(z.string(), z.date().nullable()).optional() })).mutation(({ ctx, input }) =>
    generateTasksFromTemplate(ctx.svc.actor, ctx.weddingId, input),
  ),

  /** Pessoas que podem ser responsáveis */
  assignable: perm("planning:view").query(({ ctx }) =>
    prisma.weddingMember.findMany({ where: { weddingId: ctx.weddingId, active: true }, include: { user: { select: { id: true, name: true, email: true } }, role: { select: { name: true } } } }).then((m) => m.map((x) => ({ id: x.user.id, name: x.user.name, role: x.role.name }))),
  ),
});
