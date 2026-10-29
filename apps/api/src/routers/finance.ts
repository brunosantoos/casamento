import {
  archiveWallet, assignWallet, reverseWalletEntry, saveWallet, walletAdjust, walletBalances, walletStatement, walletTransfer,
  audit, cancelIncome, quickBill, applyCategoryBudgets, applyReschedule, paymentCapacity, simulateCashflow, suggestBudgetSplit, suggestPaymentPlan, cancelInstallment, forfeitDeposit, generateInstallments, installmentStatus, itemTotal, obligationDetail, projectCashflow,
  registerPayment, reversePayment, saveIncome, saveInstallment, saveObligation, setObligationStatus, toObligationInput, weddingFinanceSummary,
} from "@casa/core";
import { prisma, type Prisma } from "@casa/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { perm, router } from "../trpc.js";

const cents = z.number().int();
const method = z.enum(["PIX", "CASH", "CREDIT_CARD", "DEBIT_CARD", "BANK_TRANSFER", "BOLETO", "CHECK", "OTHER"]);
const itemSchema = z.object({
  id: z.string().optional(),
  description: z.string().trim().min(1).max(200),
  categoryId: z.string().nullable().optional(),
  kind: z.enum(["EXPENSE", "DEPOSIT", "ADVANCE", "FEE", "OTHER"]),
  chargeType: z.enum(["ONE_TIME", "PER_GUEST", "PER_HOUR", "PER_UNIT"]).default("ONE_TIME"),
  unitCents: cents.min(0),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/, "Quantidade inválida"),
  discountCents: cents.min(0).default(0),
  surchargeCents: cents.min(0).default(0),
  status: z.enum(["PLANNED", "CONTRACTED", "CANCELLED"]),
  dueDate: z.date().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const financeRouter = router({
  summary: perm("finance:view").query(async ({ ctx }) => {
    const { data: _d, obligations: _o, ...s } = await weddingFinanceSummary(ctx.weddingId);
    return s;
  }),

  // ───── Categorias
  categories: perm("finance:view").input(z.object({ includeArchived: z.boolean().optional() }).optional()).query(({ ctx, input }) =>
    prisma.financialCategory.findMany({ where: { weddingId: ctx.weddingId, ...(input?.includeArchived ? {} : { archivedAt: null }) }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ),
  saveCategory: perm("finance:edit").input(z.object({ id: z.string().optional(), name: z.string().trim().min(1).max(80), parentId: z.string().nullable().optional(), color: z.string().max(20).nullable().optional(), budgetCents: cents.min(0).default(0) })).mutation(async ({ ctx, input }) => {
    if (input.parentId) {
      const parent = await prisma.financialCategory.findFirst({ where: { id: input.parentId, weddingId: ctx.weddingId } });
      if (!parent || parent.parentId) throw new TRPCError({ code: "BAD_REQUEST", message: "Categoria-mãe inválida (apenas um nível de subcategoria)" });
      if (input.id === input.parentId) throw new TRPCError({ code: "BAD_REQUEST", message: "Categoria não pode ser mãe de si mesma" });
    }
    const before = input.id ? await prisma.financialCategory.findFirst({ where: { id: input.id, weddingId: ctx.weddingId } }) : null;
    if (input.id && !before) throw new TRPCError({ code: "NOT_FOUND" });
    const { id, ...data } = input;
    const c = before
      ? await prisma.financialCategory.update({ where: { id: before.id }, data })
      : await prisma.financialCategory.create({ data: { ...data, weddingId: ctx.weddingId, sortOrder: await prisma.financialCategory.count({ where: { weddingId: ctx.weddingId } }) } });
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: before ? "update" : "create", entityType: "category", entityId: c.id, summary: `${before ? "Editou" : "Criou"} categoria "${c.name}"`, changes: before ? { budgetCents: { from: before.budgetCents, to: c.budgetCents }, name: { from: before.name, to: c.name } } : undefined });
    return c;
  }),
  archiveCategory: perm("finance:edit").input(z.object({ id: z.string(), archived: z.boolean() })).mutation(async ({ ctx, input }) => {
    const c = await prisma.financialCategory.findFirst({ where: { id: input.id, weddingId: ctx.weddingId } });
    if (!c) throw new TRPCError({ code: "NOT_FOUND" });
    await prisma.financialCategory.update({ where: { id: c.id }, data: { archivedAt: input.archived ? new Date() : null } });
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: input.archived ? "archive" : "restore", entityType: "category", entityId: c.id, summary: `${input.archived ? "Arquivou" : "Restaurou"} categoria "${c.name}"` });
  }),
  reorderCategories: perm("finance:edit").input(z.object({ ids: z.array(z.string()).max(200) })).mutation(async ({ ctx, input }) => {
    await prisma.$transaction(input.ids.map((id, i) => prisma.financialCategory.updateMany({ where: { id, weddingId: ctx.weddingId }, data: { sortOrder: i } })));
  }),

  // ───── Lançamentos (contratações)
  obligations: perm("finance:view").input(z.object({
    status: z.enum(["DRAFT", "ACTIVE", "CANCELLED"]).optional(), categoryId: z.string().optional(), vendorId: z.string().optional(), search: z.string().optional(),
  }).optional()).query(async ({ ctx, input }) => {
    const where: Prisma.FinancialObligationWhereInput = {
      weddingId: ctx.weddingId,
      ...(input?.status ? { status: input.status } : {}),
      ...(input?.categoryId ? { OR: [{ categoryId: input.categoryId }, { items: { some: { categoryId: input.categoryId } } }, { category: { parentId: input.categoryId } }] } : {}),
      ...(input?.vendorId ? { vendorId: input.vendorId } : {}),
      ...(input?.search ? { title: { contains: input.search, mode: "insensitive" } } : {}),
    };
    const summary = await weddingFinanceSummary(ctx.weddingId);
    const data = summary.data;
    const sums = new Map(summary.obligations.map((o) => [o.id, o]));
    const ids = new Set((await prisma.financialObligation.findMany({ where, select: { id: true } })).map((o) => o.id));
    return data.obligations.filter((o) => ids.has(o.id)).map((o) => {
      const s = sums.get(o.id)!;
      const next = s.installments.filter((i) => i.remaining > 0).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
      return {
        id: o.id, title: o.title, status: o.status, vendor: o.vendor, category: o.category, createdAt: o.createdAt, itemCount: o.items.length,
        planned: s.planned, contracted: s.contracted, depositsContracted: s.depositsContracted, paid: s.paid, open: s.open, overdue: s.overdue, unscheduled: s.unscheduled, depositPending: s.depositPending,
        nextDue: next ? { date: next.dueDate, amount: next.remaining, status: next.status } : null,
      };
    });
  }),
  obligation: perm("finance:view").input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const o = await obligationDetail(ctx.weddingId, input.id);
    const [files, refunds] = await Promise.all([
      prisma.fileAsset.findMany({ where: { weddingId: ctx.weddingId, entityType: "obligation", entityId: o.id, deletedAt: null }, select: { id: true, originalName: true, mimeType: true, size: true, createdAt: true, category: true } }),
      prisma.income.findMany({ where: { weddingId: ctx.weddingId, depositItemId: { in: o.items.map((i) => i.id) } } }),
    ]);
    const history = await prisma.auditLog.findMany({ where: { weddingId: ctx.weddingId, OR: [{ entityId: o.id }, { entityId: { in: o.installments.map((i) => i.id) } }, { entityId: { in: o.installments.flatMap((i) => i.allocations.map((a) => a.paymentId)) } }] }, orderBy: { createdAt: "desc" }, take: 50 });
    return { ...o, files, refunds, history };
  }),
  saveObligation: perm("finance:create").input(z.object({
    id: z.string().optional(), title: z.string().trim().min(2).max(200), categoryId: z.string().nullable().optional(), vendorId: z.string().nullable().optional(),
    contractId: z.string().nullable().optional(), notes: z.string().max(5000).nullable().optional(), status: z.enum(["DRAFT", "ACTIVE"]).optional(), items: z.array(itemSchema).min(1).max(100),
  })).mutation(async ({ ctx, input }) => {
    if (input.id && !ctx.permissions.has("finance:edit")) throw new TRPCError({ code: "FORBIDDEN", message: "Editar lançamentos exige finance:edit" });
    const o = await saveObligation(ctx.svc, input);
    return { id: o.id };
  }),
  /** Prévia dos cálculos antes de salvar (mesma função do backend) */
  previewItems: perm("finance:view").input(z.object({ items: z.array(itemSchema.pick({ unitCents: true, quantity: true, discountCents: true, surchargeCents: true, kind: true, status: true })) })).query(({ input }) => {
    const totals = input.items.map((i) => itemTotal(i));
    const live = input.items.map((i, k) => ({ ...i, total: totals[k]! })).filter((i) => i.status !== "CANCELLED");
    return {
      totals,
      expense: live.filter((i) => i.kind !== "DEPOSIT").reduce((a, i) => a + i.total, 0),
      deposits: live.filter((i) => i.kind === "DEPOSIT").reduce((a, i) => a + i.total, 0),
    };
  }),
  setObligationStatus: perm("finance:approve").input(z.object({ id: z.string(), status: z.enum(["DRAFT", "ACTIVE", "CANCELLED"]), reason: z.string().max(500).optional() })).mutation(({ ctx, input }) => setObligationStatus(ctx.svc, input.id, input.status, input.reason)),

  // ───── Parcelas
  generateInstallments: perm("finance:edit").input(z.object({ obligationId: z.string(), count: z.number().int().min(1).max(60), firstDue: z.date(), intervalMonths: z.number().int().min(1).max(12).optional(), itemId: z.string().nullable().optional(), amountCents: cents.min(1).optional() })).mutation(({ ctx, input }) => generateInstallments(ctx.svc, input)),
  saveInstallment: perm("finance:edit").input(z.object({ id: z.string().optional(), obligationId: z.string(), itemId: z.string().nullable().optional(), amountCents: cents.min(1), dueDate: z.date(), notes: z.string().max(1000).nullable().optional() })).mutation(({ ctx, input }) => saveInstallment(ctx.svc, input)),
  cancelInstallment: perm("finance:edit").input(z.object({ id: z.string() })).mutation(({ ctx, input }) => cancelInstallment(ctx.svc, input.id)),

  /** Parcelas em aberto (para pagar / dashboard) */
  openInstallments: perm("finance:view").input(z.object({ withinDays: z.number().int().min(1).max(3650).optional(), onlyOverdue: z.boolean().optional(), vendorId: z.string().optional() }).optional()).query(async ({ ctx, input }) => {
    const { data } = await weddingFinanceSummary(ctx.weddingId);
    const now = new Date();
    const limit = input?.withinDays ? new Date(now.getTime() + input.withinDays * 86400_000) : null;
    return data.obligations
      .filter((o) => o.status === "ACTIVE" && (!input?.vendorId || o.vendorId === input.vendorId))
      .flatMap((o) => toObligationInput(o).installments.map((i) => ({ i, o, st: installmentStatus(i, o.status, now), raw: o.installments.find((x) => x.id === i.id)! })))
      .filter((r) => r.st.remaining > 0 && (!limit || r.i.dueDate <= limit) && (!input?.onlyOverdue || r.st.overdue))
      .sort((a, b) => a.i.dueDate.getTime() - b.i.dueDate.getTime())
      .map((r) => ({ id: r.i.id, number: r.raw.number, obligationId: r.o.id, title: r.o.title, vendor: r.o.vendor?.name ?? null, itemId: r.i.itemId, dueDate: r.i.dueDate, amountCents: r.i.amountCents, paidCents: r.i.paidCents, remaining: r.st.remaining, status: r.st.status, overdue: r.st.overdue }));
  }),

  /** Conta a pagar rápida (lançamento contratado + parcelas; opcionalmente já paga) */
  quickBill: perm("finance:create").input(z.object({
    idempotencyKey: z.string().min(8).max(100), title: z.string().trim().min(2).max(200), amountCents: cents.min(1), amountMode: z.enum(["total", "each"]),
    installments: z.number().int().min(1).max(60), firstDue: z.date(), intervalMonths: z.number().int().min(1).max(12).optional(),
    categoryId: z.string().nullable().optional(), vendorId: z.string().nullable().optional(), notes: z.string().max(2000).nullable().optional(),
    paidNow: z.object({ paidAt: z.date(), method, walletId: z.string().nullable().optional(), reference: z.string().max(200).nullable().optional() }).nullable().optional(),
  })).mutation(({ ctx, input }) => quickBill(ctx.svc, input)),

  // ───── Planejamento (cálculos do sistema; a IA usa os mesmos)
  planCapacity: perm("finance:view").query(({ ctx }) => paymentCapacity(ctx.weddingId)),
  planSplit: perm("finance:view").input(z.object({ totalCents: cents.min(0).optional(), includeHoneymoon: z.boolean().optional() }).optional()).query(({ ctx, input }) => suggestBudgetSplit(ctx.weddingId, input ?? {})),
  planPayments: perm("finance:view").input(z.object({ reserveCents: cents.min(0).optional() }).optional()).query(({ ctx, input }) => suggestPaymentPlan(ctx.weddingId, input ?? {})),
  planSimulate: perm("finance:view").input(z.object({ reserveCents: cents.min(0).optional() }).optional()).query(({ ctx, input }) => simulateCashflow(ctx.weddingId, input ?? {})),
  applyBudgets: perm("finance:edit").input(z.object({ items: z.array(z.object({ categoryId: z.string(), budgetCents: cents.min(0) })).min(1).max(100) })).mutation(({ ctx, input }) => applyCategoryBudgets(ctx.svc, input.items)),
  applyReschedule: perm("finance:edit").input(z.object({ changes: z.array(z.object({ installmentId: z.string(), dueDate: z.date() })).min(1).max(60) })).mutation(({ ctx, input }) => applyReschedule(ctx.svc, input.changes)),

  // ───── Pagamentos
  payments: perm("finance:view").input(z.object({ from: z.date().optional(), to: z.date().optional(), includeReversed: z.boolean().optional() }).optional()).query(({ ctx, input }) =>
    prisma.payment.findMany({
      where: { weddingId: ctx.weddingId, ...(input?.includeReversed === false ? { reversedAt: null } : {}), paidAt: { gte: input?.from, lte: input?.to } },
      include: { wallet: { select: { id: true, name: true } }, allocations: { include: { installment: { select: { number: true, obligation: { select: { id: true, title: true, vendor: { select: { name: true } } } } } } } } },
      orderBy: { paidAt: "desc" },
      take: 500,
    }),
  ),
  registerPayment: perm("finance:create").input(z.object({
    idempotencyKey: z.string().min(8).max(100), amountCents: cents.min(1), paidAt: z.date(), method, reference: z.string().max(200).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(), receiptFileId: z.string().nullable().optional(), walletId: z.string().nullable().optional(), allocations: z.array(z.object({ installmentId: z.string(), amountCents: cents.min(1) })).min(1).max(60),
  })).mutation(async ({ ctx, input }) => {
    const r = await registerPayment(ctx.svc, input);
    return { id: r.payment.id, duplicate: r.duplicate };
  }),
  reversePayment: perm("finance:approve").input(z.object({ id: z.string(), reason: z.string().trim().min(3).max(500) })).mutation(({ ctx, input }) => reversePayment(ctx.svc, input.id, input.reason)),

  // ───── Entradas
  incomes: perm("finance:view").input(z.object({ status: z.enum(["PROMISED", "EXPECTED", "RECEIVED", "CANCELLED"]).optional(), kind: z.string().optional() }).optional()).query(({ ctx, input }) =>
    prisma.income.findMany({ where: { weddingId: ctx.weddingId, ...(input?.status ? { status: input.status } : {}), ...(input?.kind ? { kind: input.kind as never } : {}) }, include: { wallet: { select: { id: true, name: true } }, category: { select: { name: true } }, depositItem: { select: { description: true, obligation: { select: { id: true, title: true } } } } }, orderBy: [{ receivedAt: "desc" }, { expectedDate: "asc" }] }),
  ),
  saveIncome: perm("finance:create").input(z.object({
    id: z.string().optional(), kind: z.enum(["GIFT_CASH", "FAMILY", "THIRD_PARTY", "DEPOSIT_REFUND", "REFUND", "CHARGEBACK", "OTHER"]), status: z.enum(["PROMISED", "EXPECTED", "RECEIVED"]),
    description: z.string().trim().min(2).max(200), source: z.string().max(200).nullable().optional(), categoryId: z.string().nullable().optional(), amountCents: cents.min(1),
    expectedDate: z.date().nullable().optional(), receivedAt: z.date().nullable().optional(), method: method.nullable().optional(), receiptFileId: z.string().nullable().optional(), walletId: z.string().nullable().optional(),
    depositItemId: z.string().nullable().optional(), notes: z.string().max(2000).nullable().optional(), idempotencyKey: z.string().max(100).nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    if (input.id && !ctx.permissions.has("finance:edit")) throw new TRPCError({ code: "FORBIDDEN" });
    return saveIncome(ctx.svc, input);
  }),
  cancelIncome: perm("finance:edit").input(z.object({ id: z.string(), reason: z.string().min(3).max(500) })).mutation(({ ctx, input }) => cancelIncome(ctx.svc, input.id, input.reason)),

  // ───── Cauções
  deposits: perm("finance:view").query(async ({ ctx }) => {
    const s = await weddingFinanceSummary(ctx.weddingId);
    return s.obligations.flatMap((o) => {
      const raw = s.data.obligations.find((x) => x.id === o.id)!;
      return o.deposits.map((d) => {
        const item = raw.items.find((i) => i.id === d.itemId)!;
        return { ...d, description: item.description, obligationId: o.id, obligationTitle: raw.title, vendor: raw.vendor?.name ?? null, contracted: itemTotal({ ...item, quantity: item.quantity.toString() }), itemStatus: item.status };
      });
    });
  }),
  forfeitDeposit: perm("finance:approve").input(z.object({ itemId: z.string(), forfeitedCents: cents.min(0), reason: z.string().min(3).max(500) })).mutation(({ ctx, input }) => forfeitDeposit(ctx.svc, input.itemId, input.forfeitedCents, input.reason)),

  // ───── Carteiras (saldo calculado: inicial + entradas − pagamentos ± movimentos)
  wallets: perm("finance:view").query(({ ctx }) => walletBalances(ctx.weddingId)),
  walletStatement: perm("finance:view").input(z.object({ walletId: z.string(), from: z.date().optional(), to: z.date().optional() })).query(({ ctx, input }) => walletStatement(ctx.weddingId, input.walletId, input)),
  saveWallet: perm("finance:edit").input(z.object({
    id: z.string().optional(), name: z.string().trim().min(2).max(60), kind: z.enum(["CHECKING", "SAVINGS", "CASH", "CREDIT_CARD", "INVESTMENT", "OTHER"]),
    color: z.string().max(20).nullable().optional(), openingBalanceCents: cents, openingDate: z.date(), isDefault: z.boolean().optional(),
  })).mutation(({ ctx, input }) => saveWallet(ctx.svc, input)),
  archiveWallet: perm("finance:edit").input(z.object({ id: z.string(), archived: z.boolean() })).mutation(({ ctx, input }) => archiveWallet(ctx.svc, input.id, input.archived)),
  walletTransfer: perm("finance:create").input(z.object({ fromWalletId: z.string(), toWalletId: z.string(), amountCents: cents.min(1), description: z.string().max(200).nullable().optional(), occurredAt: z.date(), idempotencyKey: z.string().min(8).max(100) })).mutation(({ ctx, input }) => walletTransfer(ctx.svc, input)),
  walletAdjust: perm("finance:edit").input(z.object({ walletId: z.string(), amountCents: cents, description: z.string().trim().min(3).max(200), occurredAt: z.date(), idempotencyKey: z.string().min(8).max(100) })).mutation(({ ctx, input }) => walletAdjust(ctx.svc, input).then(() => undefined)),
  reverseWalletEntry: perm("finance:approve").input(z.object({ entryId: z.string(), reason: z.string().trim().min(3).max(300) })).mutation(({ ctx, input }) => reverseWalletEntry(ctx.svc, input.entryId, input.reason)),
  assignWallet: perm("finance:edit").input(z.object({ paymentId: z.string().optional(), incomeId: z.string().optional(), walletId: z.string().nullable() })).mutation(({ ctx, input }) => assignWallet(ctx.svc, input)),

  // ───── Fluxo de caixa e cenários
  cashflow: perm("finance:view").input(z.object({ months: z.number().int().min(1).max(36).default(12), scenarioId: z.string().nullable().optional() })).query(async ({ ctx, input }) => {
    const s = await weddingFinanceSummary(ctx.weddingId);
    const scenario = input.scenarioId ? await prisma.budgetScenario.findFirst({ where: { id: input.scenarioId, weddingId: ctx.weddingId } }) : null;
    const simulated = ((scenario?.items ?? []) as { amountCents: number; date?: string }[]).map((i) => ({ amountCents: i.amountCents, date: i.date ? new Date(i.date) : new Date() }));
    return {
      startBalance: s.realBalance,
      rows: projectCashflow({ obligations: s.data.obligations.map(toObligationInput), incomes: s.data.incomes, startBalance: s.realBalance, months: input.months, simulated }),
      scenario: scenario ? { id: scenario.id, name: scenario.name, total: simulated.reduce((a, b) => a + b.amountCents, 0) } : null,
    };
  }),
  scenarios: perm("finance:view").query(({ ctx }) => prisma.budgetScenario.findMany({ where: { weddingId: ctx.weddingId }, orderBy: { updatedAt: "desc" } })),
  saveScenario: perm("finance:create").input(z.object({
    id: z.string().optional(), name: z.string().min(2).max(100), notes: z.string().max(2000).nullable().optional(), guestCount: z.number().int().min(0).nullable().optional(),
    items: z.array(z.object({ description: z.string().min(1).max(200), categoryId: z.string().nullable().optional(), amountCents: cents.min(0), date: z.string().optional() })).max(100),
  })).mutation(async ({ ctx, input }) => {
    const { id, ...data } = input;
    if (id) {
      const r = await prisma.budgetScenario.updateMany({ where: { id, weddingId: ctx.weddingId }, data: { ...data, items: data.items as Prisma.InputJsonValue } });
      if (!r.count) throw new TRPCError({ code: "NOT_FOUND" });
      return { id };
    }
    return prisma.budgetScenario.create({ data: { ...data, items: data.items as Prisma.InputJsonValue, weddingId: ctx.weddingId } });
  }),
  deleteScenario: perm("finance:delete").input(z.object({ id: z.string() })).mutation(({ ctx, input }) => prisma.budgetScenario.deleteMany({ where: { id: input.id, weddingId: ctx.weddingId } })),
});
