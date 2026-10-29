import { prisma, type Prisma } from "@casa/db";
import { z } from "zod";
import { audit } from "../audit.js";
import { can, type Ctx } from "../context.js";
import { assert, DomainError, forbidden, notFound } from "../errors.js";
import { saveObligation } from "../finance/service.js";
import type { Permission } from "../permissions.js";

/**
 * Executores das propostas da IA. Cada ação tem schema próprio, valida vínculos no casamento
 * e exige ai:approve + a permissão do módulo. Não existem executores para pagamentos,
 * mensagens ou exclusões — essas ações são impossíveis por construção.
 */
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}/).transform((s) => new Date(s.length === 10 ? `${s}T12:00:00Z` : s));

const EXECUTORS = {
  createTask: {
    schema: z.object({ title: z.string().min(2).max(200), description: z.string().max(2000).optional(), dueDate: date.optional(), priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(), vendorId: z.string().optional() }),
    run: async (ctx: Ctx, d: { title: string; description?: string; dueDate?: Date; priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT"; vendorId?: string }) => {
      if (d.vendorId) assert(await prisma.vendor.count({ where: { id: d.vendorId, weddingId: ctx.weddingId } }), "Fornecedor inválido");
      const t = await prisma.task.create({ data: { weddingId: ctx.weddingId, title: d.title, description: d.description, dueDate: d.dueDate, priority: d.priority ?? "MEDIUM", vendorId: d.vendorId, createdById: ctx.actor.userId } });
      return { type: "task", id: t.id };
    },
  },
  updateTaskStatus: {
    schema: z.object({ taskId: z.string(), status: z.enum(["NOT_STARTED", "IN_PROGRESS", "WAITING_THIRD_PARTY", "WAITING_APPROVAL", "DONE"]) }),
    run: async (ctx: Ctx, d: { taskId: string; status: "NOT_STARTED" | "IN_PROGRESS" | "WAITING_THIRD_PARTY" | "WAITING_APPROVAL" | "DONE" }) => {
      const t = await prisma.task.findFirst({ where: { id: d.taskId, weddingId: ctx.weddingId } });
      if (!t) throw notFound("Tarefa");
      await prisma.task.update({ where: { id: t.id }, data: { status: d.status, completedAt: d.status === "DONE" ? new Date() : null } });
      return { type: "task", id: t.id };
    },
  },
  createCalendarEvent: {
    schema: z.object({ title: z.string().min(2).max(200), startsAt: date, endsAt: date.optional(), type: z.enum(["MEETING", "FITTING", "REHEARSAL", "DELIVERY", "VISIT", "TASTING", "IMPORTANT_DATE", "OTHER"]).optional(), location: z.string().max(300).optional() }),
    run: async (ctx: Ctx, d: { title: string; startsAt: Date; endsAt?: Date; type?: "MEETING"; location?: string }) => {
      const e = await prisma.calendarEvent.create({ data: { weddingId: ctx.weddingId, title: d.title, startsAt: d.startsAt, endsAt: d.endsAt, type: d.type ?? "OTHER", location: d.location, createdById: ctx.actor.userId } });
      return { type: "event", id: e.id };
    },
  },
  createVendor: {
    schema: z.object({ name: z.string().min(2).max(200), phone: z.string().max(40).optional(), email: z.string().email().optional(), categoryName: z.string().optional() }),
    run: async (ctx: Ctx, d: { name: string; phone?: string; email?: string; categoryName?: string }) => {
      const cat = d.categoryName ? await prisma.financialCategory.findFirst({ where: { weddingId: ctx.weddingId, name: { equals: d.categoryName, mode: "insensitive" } } }) : null;
      const dup = await prisma.vendor.findFirst({ where: { weddingId: ctx.weddingId, name: { equals: d.name, mode: "insensitive" } } });
      if (dup) throw new DomainError(`Já existe um fornecedor chamado "${dup.name}"`, "CONFLICT");
      const v = await prisma.vendor.create({ data: { weddingId: ctx.weddingId, name: d.name, phone: d.phone, email: d.email, categoryId: cat?.id } });
      return { type: "vendor", id: v.id };
    },
  },
  createObligationDraft: {
    schema: z.object({ title: z.string().min(2).max(200), vendorId: z.string().optional(), items: z.array(z.object({ description: z.string().min(1), amountCents: z.number().int().min(0), kind: z.enum(["EXPENSE", "DEPOSIT", "FEE"]).optional() })).min(1).max(30) }),
    run: async (ctx: Ctx, d: { title: string; vendorId?: string; items: { description: string; amountCents: number; kind?: "EXPENSE" | "DEPOSIT" | "FEE" }[] }) => {
      // Sempre rascunho: não altera contratado, pago nem saldo
      const o = await saveObligation(ctx, {
        title: d.title, vendorId: d.vendorId, status: "DRAFT",
        items: d.items.map((i) => ({ description: i.description, kind: i.kind ?? "EXPENSE", chargeType: "ONE_TIME", unitCents: i.amountCents, quantity: "1", discountCents: 0, surchargeCents: 0, status: "PLANNED" })),
      });
      return { type: "obligation", id: o.id };
    },
  },
  /** Orçamento por categoria (nunca mexe em pagamentos) */
  setCategoryBudgets: {
    schema: z.object({ items: z.array(z.object({ categoryId: z.string(), budgetCents: z.number().int().min(0).max(1_000_000_000) })).min(1).max(100) }),
    run: async (ctx: Ctx, d: { items: { categoryId: string; budgetCents: number }[] }) => {
      const ids = d.items.map((i) => i.categoryId);
      assert((await prisma.financialCategory.count({ where: { id: { in: ids }, weddingId: ctx.weddingId } })) === new Set(ids).size, "Categoria inválida");
      await prisma.$transaction(d.items.map((i) => prisma.financialCategory.update({ where: { id: i.categoryId }, data: { budgetCents: i.budgetCents } })));
      return { type: "categories", id: "budget" };
    },
  },
  /** Novos vencimentos (somente parcelas não pagas e não canceladas; o valor não muda) */
  rescheduleInstallments: {
    schema: z.object({ changes: z.array(z.object({ installmentId: z.string(), dueDate: date })).min(1).max(60) }),
    run: async (ctx: Ctx, d: { changes: { installmentId: string; dueDate: Date }[] }) => {
      await prisma.$transaction(async (tx) => {
        for (const c of d.changes) {
          const inst = await tx.installment.findFirst({ where: { id: c.installmentId, obligation: { weddingId: ctx.weddingId } }, include: { allocations: { include: { payment: { select: { reversedAt: true } } } } } });
          if (!inst) throw notFound("Parcela");
          assert(!inst.cancelledAt, "Parcela cancelada não pode ser reprogramada");
          const paid = inst.allocations.filter((a) => !a.payment.reversedAt).reduce((a, x) => a + x.amountCents, 0);
          assert(paid < inst.amountCents, "Parcela já paga não pode ser reprogramada");
          await tx.installment.update({ where: { id: inst.id }, data: { dueDate: c.dueDate } });
          await audit(ctx.actor, { weddingId: ctx.weddingId, action: "update", entityType: "installment", entityId: inst.id, summary: `Vencimento reprogramado (sugestão da IA): ${inst.dueDate.toLocaleDateString("pt-BR")} → ${c.dueDate.toLocaleDateString("pt-BR")}` }, tx);
        }
      });
      return { type: "installments", id: d.changes.map((c) => c.installmentId).join(",") };
    },
  },
  /** Cenário de simulação (não afeta totais reais) */
  createBudgetScenario: {
    schema: z.object({ name: z.string().min(2).max(100), notes: z.string().max(2000).optional(), items: z.array(z.object({ description: z.string().min(1).max(200), amountCents: z.number().int().min(0), date: z.string().optional(), categoryId: z.string().optional() })).max(100) }),
    run: async (ctx: Ctx, d: { name: string; notes?: string; items: { description: string; amountCents: number; date?: string; categoryId?: string }[] }) => {
      const sc = await prisma.budgetScenario.create({ data: { weddingId: ctx.weddingId, name: d.name, notes: d.notes, items: d.items as Prisma.InputJsonValue } });
      return { type: "scenario", id: sc.id };
    },
  },
} as const;

export type ProposalAction = keyof typeof EXECUTORS;

export async function decideProposal(ctx: Ctx, id: string, decision: "approve" | "reject") {
  const p = await prisma.aIActionProposal.findFirst({ where: { id, weddingId: ctx.weddingId } });
  if (!p) throw notFound("Proposta");
  if (!can(ctx, "ai:approve") || !can(ctx, p.requiredPermission as Permission)) throw forbidden(`Aprovar exige as permissões ai:approve e ${p.requiredPermission}`);
  assert(p.status === "PENDING", "Esta proposta já foi decidida", "CONFLICT");
  const claimed = await prisma.aIActionProposal.updateMany({ where: { id, status: "PENDING" }, data: { status: decision === "approve" ? "APPROVED" : "REJECTED", decidedById: ctx.actor.userId, decidedAt: new Date() } });
  assert(claimed.count === 1, "Esta proposta já foi decidida", "CONFLICT");
  const actor = { ...ctx.actor, origin: "ai" };
  if (decision === "reject") {
    await audit(actor, { weddingId: ctx.weddingId, action: "reject", entityType: "aiProposal", entityId: id, summary: `Recusou sugestão da IA: ${p.summary}` });
    return { status: "REJECTED" as const };
  }
  const exec = EXECUTORS[p.action as ProposalAction];
  if (!exec) {
    await prisma.aIActionProposal.update({ where: { id }, data: { status: "FAILED", error: "Ação não permitida" } });
    throw new DomainError("Ação não permitida para a IA", "FORBIDDEN");
  }
  try {
    const data = exec.schema.parse(p.payload);
    const result = await (exec.run as (c: Ctx, d: unknown) => Promise<{ type: string; id: string }>)({ ...ctx, actor }, data);
    await prisma.aIActionProposal.update({ where: { id }, data: { status: "EXECUTED", executedAt: new Date(), result: result as Prisma.InputJsonValue } });
    await audit(actor, { weddingId: ctx.weddingId, action: "approve", entityType: "aiProposal", entityId: id, summary: `Aprovou e executou sugestão da IA: ${p.summary}`, changes: { action: p.action, payload: p.payload, result } });
    return { status: "EXECUTED" as const, result };
  } catch (e) {
    const msg = e instanceof z.ZodError ? "Dados da proposta inválidos" : (e as Error).message;
    await prisma.aIActionProposal.update({ where: { id }, data: { status: "FAILED", error: msg } });
    await audit(actor, { weddingId: ctx.weddingId, action: "approve", entityType: "aiProposal", entityId: id, summary: `Falha ao executar sugestão da IA: ${p.summary}`, result: "failure", changes: { error: msg } });
    throw new DomainError(msg);
  }
}
