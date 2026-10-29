import { prisma, type Prisma, type Tx } from "@casa/db";
import { audit } from "../audit.js";
import type { Ctx } from "../context.js";
import { assert, conflict, DomainError, notFound } from "../errors.js";
import { buildSchedule, itemTotal, summarizeObligation, summarizeWedding, validateAllocations, validateItem, type IncomeInput, type ObligationInput } from "./domain.js";
import { formatBRL, sum } from "../money.js";
import { checkWallet, walletBalances } from "./wallets.js";

// ───────────── Carregamento para os cálculos ─────────────

export const obligationInclude = {
  items: { orderBy: { sortOrder: "asc" } },
  installments: {
    orderBy: [{ dueDate: "asc" }, { number: "asc" }],
    include: { allocations: { include: { payment: { select: { id: true, paidAt: true, method: true, reversedAt: true, reference: true } } } } },
  },
  vendor: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  contract: { select: { id: true, title: true, status: true } },
} satisfies Prisma.FinancialObligationInclude;

type LoadedObligation = Prisma.FinancialObligationGetPayload<{ include: typeof obligationInclude }>;

/** Converte do banco para a entrada das funções puras (pago = alocações não estornadas) */
export function toObligationInput(o: LoadedObligation): ObligationInput {
  return {
    id: o.id,
    status: o.status,
    categoryId: o.categoryId,
    items: o.items.map((i) => ({ ...i, quantity: i.quantity.toString() })),
    installments: o.installments.map((i) => ({
      id: i.id,
      itemId: i.itemId,
      amountCents: i.amountCents,
      dueDate: i.dueDate,
      cancelledAt: i.cancelledAt,
      paidCents: sum(i.allocations.filter((a) => !a.payment.reversedAt).map((a) => a.amountCents)),
    })),
  };
}

export async function loadFinance(weddingId: string, db: Tx | typeof prisma = prisma) {
  const [wedding, obligations, incomes, categories] = await Promise.all([
    db.wedding.findUniqueOrThrow({ where: { id: weddingId }, select: { budgetCents: true, estimatedGuests: true } }),
    db.financialObligation.findMany({ where: { weddingId }, include: obligationInclude, orderBy: { createdAt: "desc" } }),
    db.income.findMany({ where: { weddingId }, orderBy: { createdAt: "desc" } }),
    db.financialCategory.findMany({ where: { weddingId, archivedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  return { wedding, obligations, incomes, categories };
}

export async function confirmedPeople(weddingId: string) {
  const [guests, companions] = await Promise.all([
    prisma.guest.count({ where: { weddingId, deletedAt: null, rsvpStatus: "ACCEPTED" } }),
    prisma.guestCompanion.count({ where: { attending: true, guest: { weddingId, deletedAt: null, rsvpStatus: "ACCEPTED" } } }),
  ]);
  return guests + companions;
}

export async function weddingFinanceSummary(weddingId: string, now = new Date()) {
  const data = await loadFinance(weddingId);
  const confirmed = await confirmedPeople(weddingId);
  const summary = summarizeWedding({
    budgetCents: data.wedding.budgetCents,
    obligations: data.obligations.map(toObligationInput),
    incomes: data.incomes as IncomeInput[],
    categories: data.categories,
    guestCount: confirmed || data.wedding.estimatedGuests,
    now,
  });
  const w = await walletBalances(weddingId);
  return {
    ...summary,
    guestBasis: confirmed ? "confirmados" : data.wedding.estimatedGuests ? "estimados" : null,
    /** Soma dos saldos das carteiras ativas (dinheiro que vocês informaram ter) */
    walletsTotal: w.wallets.length ? w.totalCents : null,
    walletsCount: w.wallets.filter((x) => !x.archivedAt).length,
    data,
  };
}

// ───────────── Contratações e itens ─────────────

export type ItemData = {
  id?: string;
  description: string;
  categoryId?: string | null;
  kind: "EXPENSE" | "DEPOSIT" | "ADVANCE" | "FEE" | "OTHER";
  chargeType: "ONE_TIME" | "PER_GUEST" | "PER_HOUR" | "PER_UNIT";
  unitCents: number;
  quantity: string;
  discountCents: number;
  surchargeCents: number;
  status: "PLANNED" | "CONTRACTED" | "CANCELLED";
  dueDate?: Date | null;
  notes?: string | null;
};

async function assertRefs(tx: Tx, weddingId: string, refs: { vendorId?: string | null; categoryId?: string | null; contractId?: string | null; categoryIds?: (string | null | undefined)[] }) {
  if (refs.vendorId) assert(await tx.vendor.count({ where: { id: refs.vendorId, weddingId } }), "Fornecedor inválido", "NOT_FOUND");
  if (refs.contractId) assert(await tx.vendorContract.count({ where: { id: refs.contractId, vendor: { weddingId } } }), "Contrato inválido", "NOT_FOUND");
  const cats = [refs.categoryId, ...(refs.categoryIds ?? [])].filter((c): c is string => !!c);
  if (cats.length) {
    const n = await tx.financialCategory.count({ where: { id: { in: [...new Set(cats)] }, weddingId } });
    assert(n === new Set(cats).size, "Categoria inválida", "NOT_FOUND");
  }
}

export async function getObligation(weddingId: string, id: string, db: Tx | typeof prisma = prisma) {
  const o = await db.financialObligation.findFirst({ where: { id, weddingId }, include: obligationInclude });
  if (!o) throw notFound("Lançamento");
  return o;
}

export async function obligationDetail(weddingId: string, id: string) {
  const o = await getObligation(weddingId, id);
  const refunds = await prisma.income.findMany({ where: { weddingId, depositItemId: { in: o.items.map((i) => i.id) }, status: "RECEIVED" } });
  const byItem = new Map<string, number>();
  for (const r of refunds) byItem.set(r.depositItemId!, (byItem.get(r.depositItemId!) ?? 0) + r.amountCents);
  return { ...o, summary: summarizeObligation(toObligationInput(o), byItem), itemTotals: Object.fromEntries(o.items.map((i) => [i.id, itemTotal({ ...i, quantity: i.quantity.toString() })])) };
}

export async function saveObligation(
  ctx: Ctx,
  input: { id?: string; title: string; categoryId?: string | null; vendorId?: string | null; contractId?: string | null; notes?: string | null; status?: "DRAFT" | "ACTIVE"; items: ItemData[] },
) {
  for (const it of input.items) {
    const errs = validateItem({ ...it, quantity: it.quantity });
    if (errs.length) throw new DomainError(`${it.description}: ${errs[0]}`);
  }
  assert(input.items.length > 0, "Inclua ao menos um item");

  return prisma.$transaction(async (tx) => {
    await assertRefs(tx, ctx.weddingId, { ...input, categoryIds: input.items.map((i) => i.categoryId) });
    const before = input.id ? await getObligation(ctx.weddingId, input.id, tx) : null;
    if (before?.status === "CANCELLED") throw conflict("Lançamento cancelado não pode ser editado");

    const data = { title: input.title, categoryId: input.categoryId ?? null, vendorId: input.vendorId ?? null, contractId: input.contractId ?? null, notes: input.notes ?? null, ...(input.status ? { status: input.status } : {}) };
    const o = before
      ? await tx.financialObligation.update({ where: { id: before.id }, data })
      : await tx.financialObligation.create({ data: { ...data, weddingId: ctx.weddingId, createdById: ctx.actor.userId } });

    // Itens: atualiza os existentes, cria os novos. Itens removidos com pagamento vinculado viram CANCELLED (histórico preservado)
    const keep = new Set(input.items.filter((i) => i.id).map((i) => i.id!));
    for (const old of before?.items ?? []) {
      if (keep.has(old.id)) continue;
      const hasPayment = before!.installments.some((i) => i.itemId === old.id && i.allocations.some((a) => !a.payment.reversedAt));
      const linked = before!.installments.some((i) => i.itemId === old.id);
      if (hasPayment || linked) await tx.obligationItem.update({ where: { id: old.id }, data: { status: "CANCELLED" } });
      else await tx.obligationItem.delete({ where: { id: old.id } });
    }
    for (const [idx, it] of input.items.entries()) {
      const data = {
        description: it.description, categoryId: it.categoryId ?? null, kind: it.kind, chargeType: it.chargeType, unitCents: it.unitCents,
        quantity: it.quantity, discountCents: it.discountCents, surchargeCents: it.surchargeCents, status: it.status, dueDate: it.dueDate ?? null, notes: it.notes ?? null, sortOrder: idx,
      };
      if (it.id) {
        assert(before?.items.some((x) => x.id === it.id), "Item não pertence a este lançamento", "NOT_FOUND");
        await tx.obligationItem.update({ where: { id: it.id }, data });
      } else await tx.obligationItem.create({ data: { ...data, obligationId: o.id } });
    }

    // Criado/fechado já como contratado: mesma regra de setObligationStatus (previstos → contratados)
    if (o.status === "ACTIVE" && before?.status !== "ACTIVE") {
      await tx.obligationItem.updateMany({ where: { obligationId: o.id, status: "PLANNED" }, data: { status: "CONTRACTED" } });
    }
    const after = await getObligation(ctx.weddingId, o.id, tx);
    const totals = summarizeObligation(toObligationInput(after));
    await audit(ctx.actor, {
      weddingId: ctx.weddingId, action: before ? "update" : "create", entityType: "obligation", entityId: o.id,
      summary: `${before ? "Editou" : "Criou"} lançamento "${o.title}" · contratado ${formatBRL(totals.contracted)} · previsto ${formatBRL(totals.planned)}`,
      changes: { before: before ? { title: before.title, status: before.status, items: before.items.map((i) => ({ d: i.description, v: i.unitCents, q: i.quantity.toString(), s: i.status, k: i.kind })) } : null, after: input },
    }, tx);
    return after;
  });
}

export async function setObligationStatus(ctx: Ctx, id: string, status: "DRAFT" | "ACTIVE" | "CANCELLED", reason?: string) {
  return prisma.$transaction(async (tx) => {
    const o = await getObligation(ctx.weddingId, id, tx);
    assert(o.status !== "CANCELLED", "Lançamento já cancelado", "CONFLICT");
    if (status === "DRAFT") {
      const paid = o.installments.some((i) => i.allocations.some((a) => !a.payment.reversedAt));
      assert(!paid, "Há pagamentos registrados: estorne-os antes de voltar para rascunho", "CONFLICT");
    }
    if (status === "CANCELLED") assert(reason?.trim(), "Informe o motivo do cancelamento");
    await tx.financialObligation.update({
      where: { id },
      data: { status, ...(status === "CANCELLED" ? { cancelledAt: new Date(), cancelReason: reason } : {}) },
    });
    // Ao fechar a contratação, itens previstos passam a contratados
    if (status === "ACTIVE") await tx.obligationItem.updateMany({ where: { obligationId: id, status: "PLANNED" }, data: { status: "CONTRACTED" } });
    await audit(ctx.actor, {
      weddingId: ctx.weddingId, action: status === "CANCELLED" ? "cancel" : "update", entityType: "obligation", entityId: id,
      summary: `${status === "CANCELLED" ? "Cancelou" : status === "ACTIVE" ? "Fechou (contratou)" : "Voltou para rascunho"} "${o.title}"${reason ? ` — ${reason}` : ""}`,
      changes: { status: { from: o.status, to: status } },
    }, tx);
  });
}

// ───────────── Parcelas ─────────────

export async function generateInstallments(
  ctx: Ctx,
  input: { obligationId: string; count: number; firstDue: Date; intervalMonths?: number; itemId?: string | null; amountCents?: number },
) {
  return prisma.$transaction(async (tx) => {
    const o = await getObligation(ctx.weddingId, input.obligationId, tx);
    assert(o.status !== "CANCELLED", "Lançamento cancelado", "CONFLICT");
    const s = summarizeObligation(toObligationInput(o));
    let total = input.amountCents ?? 0;
    if (input.itemId) {
      const item = o.items.find((i) => i.id === input.itemId);
      assert(item, "Item inválido", "NOT_FOUND");
      total ||= itemTotal({ ...item, quantity: item.quantity.toString() });
    } else total ||= s.unscheduled || s.planned + s.depositsContracted;
    assert(total > 0, "Não há valor a parcelar");
    assert(input.count >= 1 && input.count <= 60, "Número de parcelas entre 1 e 60");
    const last = o.installments.reduce((m, i) => Math.max(m, i.number), 0);
    const plan = buildSchedule(total, input.count, input.firstDue, input.intervalMonths ?? 1);
    await tx.installment.createMany({
      data: plan.map((p) => ({ obligationId: o.id, itemId: input.itemId ?? null, number: last + p.number, amountCents: p.amountCents, dueDate: p.dueDate })),
    });
    await audit(ctx.actor, {
      weddingId: ctx.weddingId, action: "create", entityType: "installment", entityId: o.id,
      summary: `Gerou ${input.count} parcela(s) de "${o.title}" totalizando ${formatBRL(total)}`,
    }, tx);
  });
}

export async function saveInstallment(ctx: Ctx, input: { id?: string; obligationId: string; itemId?: string | null; amountCents: number; dueDate: Date; notes?: string | null }) {
  assert(input.amountCents > 0, "Valor da parcela precisa ser maior que zero");
  return prisma.$transaction(async (tx) => {
    const o = await getObligation(ctx.weddingId, input.obligationId, tx);
    assert(o.status !== "CANCELLED", "Lançamento cancelado", "CONFLICT");
    if (input.itemId) assert(o.items.some((i) => i.id === input.itemId), "Item inválido", "NOT_FOUND");
    if (input.id) {
      const inst = o.installments.find((i) => i.id === input.id);
      assert(inst, "Parcela não encontrada", "NOT_FOUND");
      const paid = sum(inst.allocations.filter((a) => !a.payment.reversedAt).map((a) => a.amountCents));
      assert(input.amountCents >= paid, `O valor não pode ficar abaixo do já pago (${formatBRL(paid)})`, "CONFLICT");
      await tx.installment.update({ where: { id: inst.id }, data: { amountCents: input.amountCents, dueDate: input.dueDate, notes: input.notes ?? null, itemId: input.itemId ?? null } });
      await audit(ctx.actor, {
        weddingId: ctx.weddingId, action: "update", entityType: "installment", entityId: inst.id,
        summary: `Alterou parcela ${inst.number} de "${o.title}"`, changes: { amountCents: { from: inst.amountCents, to: input.amountCents }, dueDate: { from: inst.dueDate, to: input.dueDate } },
      }, tx);
    } else {
      const last = o.installments.reduce((m, i) => Math.max(m, i.number), 0);
      const created = await tx.installment.create({ data: { obligationId: o.id, itemId: input.itemId ?? null, number: last + 1, amountCents: input.amountCents, dueDate: input.dueDate, notes: input.notes ?? null } });
      await audit(ctx.actor, { weddingId: ctx.weddingId, action: "create", entityType: "installment", entityId: created.id, summary: `Nova parcela de ${formatBRL(input.amountCents)} em "${o.title}"` }, tx);
    }
  });
}

export async function cancelInstallment(ctx: Ctx, id: string) {
  return prisma.$transaction(async (tx) => {
    const inst = await tx.installment.findFirst({ where: { id, obligation: { weddingId: ctx.weddingId } }, include: { allocations: { include: { payment: true } }, obligation: true } });
    if (!inst) throw notFound("Parcela");
    assert(!inst.allocations.some((a) => !a.payment.reversedAt), "Parcela com pagamento: estorne o pagamento antes de cancelar", "CONFLICT");
    await tx.installment.update({ where: { id }, data: { cancelledAt: new Date() } });
    await audit(ctx.actor, { weddingId: ctx.weddingId, action: "cancel", entityType: "installment", entityId: id, summary: `Cancelou parcela ${inst.number} de "${inst.obligation.title}" (${formatBRL(inst.amountCents)})` }, tx);
  });
}

// ───────────── Pagamentos ─────────────

/**
 * Registra uma liquidação. Proteções:
 *  - idempotencyKey única (duplo clique/reenvio devolve o mesmo pagamento)
 *  - SELECT … FOR UPDATE nas parcelas (pagamentos concorrentes não ultrapassam o saldo)
 *  - validação pura das alocações (soma exata, sem parcela cancelada, sem exceder saldo)
 */
export async function registerPayment(
  ctx: Ctx,
  input: { idempotencyKey: string; amountCents: number; paidAt: Date; method: Prisma.PaymentCreateInput["method"]; reference?: string | null; notes?: string | null; receiptFileId?: string | null; walletId?: string | null; allocations: { installmentId: string; amountCents: number }[] },
) {
  const existing = await prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    assert(existing.weddingId === ctx.weddingId, "Chave de idempotência inválida", "CONFLICT");
    return { payment: existing, duplicate: true };
  }
  assert(input.paidAt <= new Date(Date.now() + 60_000), "A data do pagamento não pode estar no futuro");

  try {
    return await prisma.$transaction(async (tx) => {
      const ids = input.allocations.map((a) => a.installmentId);
      // Trava as parcelas envolvidas até o fim da transação
      await tx.$queryRaw`SELECT id FROM "Installment" WHERE id = ANY(${ids}::text[]) FOR UPDATE`;
      const insts = await tx.installment.findMany({
        where: { id: { in: ids }, obligation: { weddingId: ctx.weddingId } },
        include: { obligation: { select: { status: true, title: true } }, allocations: { include: { payment: { select: { reversedAt: true } } } } },
      });
      const errors = validateAllocations(
        input.amountCents,
        input.allocations,
        insts.map((i) => ({
          id: i.id, amountCents: i.amountCents, cancelled: !!i.cancelledAt, obligationStatus: i.obligation.status,
          paidCents: sum(i.allocations.filter((a) => !a.payment.reversedAt).map((a) => a.amountCents)),
        })),
      );
      if (errors.length) throw new DomainError(errors[0]!);
      if (input.receiptFileId) assert(await tx.fileAsset.count({ where: { id: input.receiptFileId, weddingId: ctx.weddingId, deletedAt: null } }), "Comprovante inválido", "NOT_FOUND");
      await checkWallet(tx, ctx.weddingId, input.walletId);

      const payment = await tx.payment.create({
        data: {
          weddingId: ctx.weddingId, amountCents: input.amountCents, paidAt: input.paidAt, method: input.method, reference: input.reference ?? null,
          notes: input.notes ?? null, receiptFileId: input.receiptFileId ?? null, walletId: input.walletId ?? null, idempotencyKey: input.idempotencyKey, createdById: ctx.actor.userId,
          allocations: { create: input.allocations },
        },
      });
      const titles = [...new Set(insts.map((i) => i.obligation.title))].join(", ");
      await audit(ctx.actor, {
        weddingId: ctx.weddingId, action: "pay", entityType: "payment", entityId: payment.id,
        summary: `Registrou pagamento de ${formatBRL(input.amountCents)} (${input.method}) em ${titles}`,
        changes: { allocations: input.allocations, paidAt: input.paidAt, reference: input.reference },
      }, tx);
      return { payment, duplicate: false };
    });
  } catch (e) {
    // Corrida entre duas requisições com a mesma chave: devolve a que venceu
    if ((e as { code?: string }).code === "P2002") {
      const p = await prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (p) return { payment: p, duplicate: true };
    }
    throw e;
  }
}

/** Estorno: o pagamento continua no histórico, mas deixa de contar */
export async function reversePayment(ctx: Ctx, id: string, reason: string) {
  assert(reason.trim(), "Informe o motivo do estorno");
  return prisma.$transaction(async (tx) => {
    const p = await tx.payment.findFirst({ where: { id, weddingId: ctx.weddingId } });
    if (!p) throw notFound("Pagamento");
    assert(!p.reversedAt, "Pagamento já estornado", "CONFLICT");
    const updated = await tx.payment.updateMany({ where: { id, reversedAt: null }, data: { reversedAt: new Date(), reversalReason: reason } });
    assert(updated.count === 1, "Pagamento já estornado", "CONFLICT");
    await audit(ctx.actor, { weddingId: ctx.weddingId, action: "reverse", entityType: "payment", entityId: id, summary: `Estornou pagamento de ${formatBRL(p.amountCents)} — ${reason}` }, tx);
  });
}

// ───────────── Cauções ─────────────

export async function forfeitDeposit(ctx: Ctx, itemId: string, forfeitedCents: number, reason: string) {
  return prisma.$transaction(async (tx) => {
    const item = await tx.obligationItem.findFirst({ where: { id: itemId, obligation: { weddingId: ctx.weddingId } }, include: { obligation: true } });
    if (!item) throw notFound("Item");
    assert(item.kind === "DEPOSIT", "Somente cauções podem ser retidas");
    assert(forfeitedCents >= 0, "Valor inválido");
    await tx.obligationItem.update({ where: { id: itemId }, data: { forfeitedCents } });
    await audit(ctx.actor, { weddingId: ctx.weddingId, action: "update", entityType: "deposit", entityId: itemId, summary: `Registrou retenção de ${formatBRL(forfeitedCents)} da caução "${item.description}" — ${reason}`, changes: { forfeitedCents: { from: item.forfeitedCents, to: forfeitedCents } } }, tx);
  });
}

// ───────────── Entradas ─────────────

export type IncomeData = {
  id?: string;
  kind: Prisma.IncomeCreateInput["kind"];
  status: Prisma.IncomeCreateInput["status"];
  description: string;
  source?: string | null;
  categoryId?: string | null;
  amountCents: number;
  expectedDate?: Date | null;
  receivedAt?: Date | null;
  method?: Prisma.IncomeCreateInput["method"] | null;
  receiptFileId?: string | null;
  walletId?: string | null;
  depositItemId?: string | null;
  notes?: string | null;
  idempotencyKey?: string | null;
};

export async function saveIncome(ctx: Ctx, input: IncomeData) {
  assert(input.amountCents > 0, "O valor precisa ser maior que zero");
  if (input.status === "RECEIVED") assert(input.receivedAt, "Informe a data do recebimento");
  if (input.kind === "DEPOSIT_REFUND") assert(input.depositItemId, "Indique qual caução está sendo devolvida");
  if (!input.id && input.idempotencyKey) {
    const dup = await prisma.income.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (dup) return dup;
  }
  return prisma.$transaction(async (tx) => {
    if (input.depositItemId) {
      const item = await tx.obligationItem.findFirst({ where: { id: input.depositItemId, obligation: { weddingId: ctx.weddingId } }, include: { installments: { include: { allocations: { include: { payment: true } } } } } });
      assert(item?.kind === "DEPOSIT", "Caução inválida", "NOT_FOUND");
      const paid = sum(item.installments.flatMap((i) => i.allocations.filter((a) => !a.payment.reversedAt).map((a) => a.amountCents)));
      const otherRefunds = await tx.income.aggregate({ where: { depositItemId: item.id, status: "RECEIVED", id: input.id ? { not: input.id } : undefined }, _sum: { amountCents: true } });
      if (input.status === "RECEIVED") {
        const room = paid - item.forfeitedCents - (otherRefunds._sum.amountCents ?? 0);
        assert(input.amountCents <= room, `A devolução excede o valor da caução ainda pendente (${formatBRL(Math.max(0, room))})`, "CONFLICT");
      }
    }
    await assertRefs(tx, ctx.weddingId, { categoryId: input.categoryId });
    await checkWallet(tx, ctx.weddingId, input.walletId);
    const { id, ...rest } = input;
    const data = { ...rest, idempotencyKey: id ? undefined : (input.idempotencyKey ?? null) };
    const before = id ? await tx.income.findFirst({ where: { id, weddingId: ctx.weddingId } }) : null;
    if (id && !before) throw notFound("Entrada");
    const saved = before ? await tx.income.update({ where: { id: before.id }, data }) : await tx.income.create({ data: { ...data, weddingId: ctx.weddingId, createdById: ctx.actor.userId } });
    await audit(ctx.actor, {
      weddingId: ctx.weddingId, action: before ? "update" : "create", entityType: "income", entityId: saved.id,
      summary: `${before ? "Editou" : "Registrou"} entrada "${saved.description}" ${formatBRL(saved.amountCents)} (${saved.status})`,
      changes: before ? { status: { from: before.status, to: saved.status }, amountCents: { from: before.amountCents, to: saved.amountCents } } : undefined,
    }, tx);
    return saved;
  });
}

export async function cancelIncome(ctx: Ctx, id: string, reason: string) {
  const inc = await prisma.income.findFirst({ where: { id, weddingId: ctx.weddingId } });
  if (!inc) throw notFound("Entrada");
  await prisma.income.update({ where: { id }, data: { status: "CANCELLED", notes: [inc.notes, `Cancelada: ${reason}`].filter(Boolean).join("\n") } });
  await audit(ctx.actor, { weddingId: ctx.weddingId, action: "cancel", entityType: "income", entityId: id, summary: `Cancelou entrada "${inc.description}" (${formatBRL(inc.amountCents)}) — ${reason}` });
}

// ───────────── Conta a pagar rápida ─────────────

/**
 * Cadastro rápido de uma conta a pagar: cria um lançamento contratado com um item e as parcelas
 * (à vista, parcelado ou mensal). Opcionalmente registra o pagamento da 1ª parcela na carteira.
 * Reaproveita as mesmas regras (saveObligation / generateInstallments / registerPayment): os totais batem.
 */
export async function quickBill(
  ctx: Ctx,
  input: {
    idempotencyKey: string;
    title: string;
    amountCents: number;
    /** "total": o valor é o total dividido nas parcelas; "each": o valor é de cada parcela (ex.: mensalidade) */
    amountMode: "total" | "each";
    installments: number;
    firstDue: Date;
    intervalMonths?: number;
    categoryId?: string | null;
    vendorId?: string | null;
    notes?: string | null;
    paidNow?: { paidAt: Date; method: Prisma.PaymentCreateInput["method"]; walletId?: string | null; reference?: string | null } | null;
  },
) {
  assert(input.title.trim().length >= 2, "Descreva a conta");
  assert(input.amountCents > 0, "Informe o valor");
  assert(input.installments >= 1 && input.installments <= 60, "Parcelas entre 1 e 60");
  // Idempotência: o mesmo envio não cria a conta duas vezes
  const existing = await prisma.auditLog.findFirst({ where: { weddingId: ctx.weddingId, entityType: "quickBill", entityId: input.idempotencyKey } });
  if (existing) return { obligationId: (existing.changes as { obligationId?: string } | null)?.obligationId ?? null, duplicate: true };

  const total = input.amountMode === "each" ? input.amountCents * input.installments : input.amountCents;
  const o = await saveObligation(ctx, {
    title: input.title.trim(), categoryId: input.categoryId ?? null, vendorId: input.vendorId ?? null, notes: input.notes ?? null, status: "ACTIVE",
    items: [{ description: input.title.trim(), categoryId: input.categoryId ?? null, kind: "EXPENSE", chargeType: "ONE_TIME", unitCents: total, quantity: "1", discountCents: 0, surchargeCents: 0, status: "CONTRACTED" }],
  });
  await generateInstallments(ctx, { obligationId: o.id, count: input.installments, firstDue: input.firstDue, intervalMonths: input.intervalMonths ?? 1, amountCents: total });
  let paymentId: string | null = null;
  if (input.paidNow) {
    const first = (await getObligation(ctx.weddingId, o.id)).installments[0]!;
    const r = await registerPayment(ctx, {
      idempotencyKey: `${input.idempotencyKey}:pay`, amountCents: first.amountCents, paidAt: input.paidNow.paidAt, method: input.paidNow.method,
      walletId: input.paidNow.walletId ?? null, reference: input.paidNow.reference ?? null, allocations: [{ installmentId: first.id, amountCents: first.amountCents }],
    });
    paymentId = r.payment.id;
  }
  await audit(ctx.actor, {
    weddingId: ctx.weddingId, action: "create", entityType: "quickBill", entityId: input.idempotencyKey,
    summary: `Cadastrou conta a pagar "${input.title.trim()}" — ${formatBRL(total)} em ${input.installments}x${paymentId ? " (1ª paga)" : ""}`,
    changes: { obligationId: o.id, paymentId },
  });
  return { obligationId: o.id, duplicate: false, paymentId };
}
