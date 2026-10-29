import { prisma, type Tx, type WalletKind } from "@casa/db";
import { randomUUID } from "node:crypto";
import { audit } from "../audit.js";
import type { Ctx } from "../context.js";
import { assert, notFound } from "../errors.js";
import { formatBRL, sum } from "../money.js";

/**
 * Carteiras: o saldo NUNCA é digitado — é calculado:
 *   saldo = saldo inicial + entradas recebidas na carteira − pagamentos (não estornados) feitos por ela ± movimentos manuais (não estornados)
 * O saldo inicial é uma fotografia na data informada: movimentos ANTERIORES a essa data já estão
 * contidos nele e não alteram o saldo de novo (aparecem no extrato como "já incluído").
 * Assim todo pagamento debita e toda entrada credita automaticamente, com extrato auditável.
 */
export type WalletMovement = {
  id: string;
  type: "opening" | "payment" | "income" | "adjustment" | "transfer";
  date: Date;
  description: string;
  amountCents: number; // + entra, − sai
  balanceAfter: number;
  reversed: boolean;
  /** Anterior à data do saldo inicial: já está contido nele, não altera o saldo */
  beforeOpening?: boolean;
  link?: { obligationId?: string; paymentId?: string; incomeId?: string; transferGroupId?: string | null; entryId?: string };
};

/** Mesmo dia do saldo inicial conta (o saldo é do início do dia) */
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const countsForWallet = (date: Date, openingDate: Date) => date >= startOfDay(openingDate);

async function load(weddingId: string, walletIds?: string[], db: Tx | typeof prisma = prisma) {
  const wallets = await db.wallet.findMany({ where: { weddingId, ...(walletIds ? { id: { in: walletIds } } : {}) }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  const ids = wallets.map((w) => w.id);
  const [payments, incomes, entries] = await Promise.all([
    db.payment.findMany({ where: { weddingId, walletId: { in: ids } }, include: { allocations: { include: { installment: { select: { obligation: { select: { id: true, title: true } } } } } } } }),
    db.income.findMany({ where: { weddingId, walletId: { in: ids }, status: "RECEIVED" } }),
    db.walletEntry.findMany({ where: { walletId: { in: ids } } }),
  ]);
  return { wallets, payments, incomes, entries };
}

export async function walletBalances(weddingId: string, db: Tx | typeof prisma = prisma) {
  const { wallets, payments, incomes, entries } = await load(weddingId, undefined, db);
  const list = wallets.map((w) => {
    const after = (d: Date) => countsForWallet(d, w.openingDate);
    const paid = sum(payments.filter((p) => p.walletId === w.id && !p.reversedAt && after(p.paidAt)).map((p) => p.amountCents));
    const received = sum(incomes.filter((i) => i.walletId === w.id && after(i.receivedAt ?? i.createdAt)).map((i) => i.amountCents));
    const manual = sum(entries.filter((e) => e.walletId === w.id && !e.reversedAt && after(e.occurredAt)).map((e) => e.amountCents));
    return { ...w, paidCents: paid, receivedCents: received, manualCents: manual, balanceCents: w.openingBalanceCents + received - paid + manual };
  });
  const active = list.filter((w) => !w.archivedAt);
  // Pagamentos/entradas sem carteira: aparecem para o usuário classificar
  const [unassignedPayments, unassignedIncomes] = await Promise.all([
    db.payment.count({ where: { weddingId, walletId: null, reversedAt: null } }),
    db.income.count({ where: { weddingId, walletId: null, status: "RECEIVED" } }),
  ]);
  return { wallets: list, totalCents: sum(active.map((w) => w.balanceCents)), unassignedPayments, unassignedIncomes };
}

export async function walletStatement(weddingId: string, walletId: string, opts: { from?: Date; to?: Date } = {}) {
  const { wallets, payments, incomes, entries } = await load(weddingId, [walletId]);
  const w = wallets[0];
  if (!w) throw notFound("Carteira");
  const moves: Omit<WalletMovement, "balanceAfter">[] = [
    { id: `opening:${w.id}`, type: "opening" as const, date: w.openingDate, description: "Saldo inicial", amountCents: w.openingBalanceCents, reversed: false },
    ...payments.map((p) => ({
      id: p.id, type: "payment" as const, date: p.paidAt, amountCents: -p.amountCents, reversed: !!p.reversedAt,
      description: `Pagamento · ${[...new Set(p.allocations.map((a) => a.installment.obligation.title))].join(", ")}${p.reversedAt ? " (estornado)" : ""}`,
      link: { paymentId: p.id, obligationId: p.allocations[0]?.installment.obligation.id },
    })),
    ...incomes.map((i) => ({ id: i.id, type: "income" as const, date: i.receivedAt ?? i.createdAt, amountCents: i.amountCents, reversed: false, description: `Entrada · ${i.description}`, link: { incomeId: i.id } })),
    ...entries.map((e) => ({
      id: e.id, type: e.kind === "TRANSFER" ? ("transfer" as const) : ("adjustment" as const), date: e.occurredAt, amountCents: e.amountCents, reversed: !!e.reversedAt,
      description: `${e.description}${e.reversedAt ? " (estornado)" : ""}`, link: { entryId: e.id, transferGroupId: e.transferGroupId },
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || (a.type === "opening" ? -1 : b.type === "opening" ? 1 : 0));
  let balance = 0;
  const all: WalletMovement[] = moves.map((m) => {
    const beforeOpening = m.type !== "opening" && !countsForWallet(m.date, w.openingDate);
    if (!m.reversed && !beforeOpening) balance += m.amountCents;
    return { ...m, description: beforeOpening ? `${m.description} · já incluído no saldo inicial` : m.description, beforeOpening, balanceAfter: balance };
  });
  const filtered = all.filter((m) => (!opts.from || m.date >= opts.from) && (!opts.to || m.date <= opts.to));
  return { wallet: w, balanceCents: balance, movements: filtered.reverse() };
}

export async function saveWallet(ctx: Ctx, input: { id?: string; name: string; kind: WalletKind; color?: string | null; openingBalanceCents: number; openingDate: Date; isDefault?: boolean }) {
  assert(input.name.trim().length >= 2, "Dê um nome à carteira");
  return prisma.$transaction(async (tx) => {
    const before = input.id ? await tx.wallet.findFirst({ where: { id: input.id, weddingId: ctx.weddingId } }) : null;
    if (input.id && !before) throw notFound("Carteira");
    if (input.isDefault) await tx.wallet.updateMany({ where: { weddingId: ctx.weddingId }, data: { isDefault: false } });
    const first = !before && !(await tx.wallet.count({ where: { weddingId: ctx.weddingId } }));
    const { id: _id, ...data } = input;
    const w = before
      ? await tx.wallet.update({ where: { id: before.id }, data })
      : await tx.wallet.create({ data: { ...data, isDefault: input.isDefault ?? first, weddingId: ctx.weddingId, createdById: ctx.actor.userId } });
    await audit(ctx.actor, {
      weddingId: ctx.weddingId, action: before ? "update" : "create", entityType: "wallet", entityId: w.id,
      summary: before ? `Editou a carteira "${w.name}"${before.openingBalanceCents !== w.openingBalanceCents ? ` (saldo inicial ${formatBRL(before.openingBalanceCents)} → ${formatBRL(w.openingBalanceCents)})` : ""}` : `Criou a carteira "${w.name}" com saldo inicial ${formatBRL(w.openingBalanceCents)}`,
    }, tx);
    return w;
  });
}

export async function archiveWallet(ctx: Ctx, id: string, archived: boolean) {
  const w = await prisma.wallet.findFirst({ where: { id, weddingId: ctx.weddingId } });
  if (!w) throw notFound("Carteira");
  await prisma.wallet.update({ where: { id }, data: { archivedAt: archived ? new Date() : null, ...(archived ? { isDefault: false } : {}) } });
  await audit(ctx.actor, { weddingId: ctx.weddingId, action: archived ? "archive" : "restore", entityType: "wallet", entityId: id, summary: `${archived ? "Arquivou" : "Reativou"} a carteira "${w.name}"` });
}

async function ownWallet(tx: Tx, weddingId: string, id: string) {
  const w = await tx.wallet.findFirst({ where: { id, weddingId } });
  if (!w) throw notFound("Carteira");
  assert(!w.archivedAt, `A carteira "${w.name}" está arquivada`, "CONFLICT");
  return w;
}

export async function walletAdjust(ctx: Ctx, input: { walletId: string; amountCents: number; description: string; occurredAt: Date; idempotencyKey: string }) {
  assert(input.amountCents !== 0, "Informe um valor diferente de zero");
  assert(input.description.trim().length >= 3, "Informe o motivo do ajuste");
  const dup = await prisma.walletEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (dup) return dup;
  return prisma.$transaction(async (tx) => {
    const w = await ownWallet(tx, ctx.weddingId, input.walletId);
    const e = await tx.walletEntry.create({ data: { walletId: w.id, kind: "ADJUSTMENT", amountCents: input.amountCents, description: input.description.trim(), occurredAt: input.occurredAt, idempotencyKey: input.idempotencyKey, createdById: ctx.actor.userId } });
    await audit(ctx.actor, { weddingId: ctx.weddingId, action: "adjust", entityType: "wallet", entityId: w.id, summary: `Ajuste de ${formatBRL(input.amountCents)} na carteira "${w.name}" — ${input.description}` }, tx);
    return e;
  });
}

export async function walletTransfer(ctx: Ctx, input: { fromWalletId: string; toWalletId: string; amountCents: number; description?: string | null; occurredAt: Date; idempotencyKey: string }) {
  assert(input.amountCents > 0, "O valor precisa ser maior que zero");
  assert(input.fromWalletId !== input.toWalletId, "Escolha carteiras diferentes");
  const dup = await prisma.walletEntry.findUnique({ where: { idempotencyKey: `${input.idempotencyKey}:out` } });
  if (dup) return { transferGroupId: dup.transferGroupId };
  return prisma.$transaction(async (tx) => {
    const [from, to] = [await ownWallet(tx, ctx.weddingId, input.fromWalletId), await ownWallet(tx, ctx.weddingId, input.toWalletId)];
    const group = randomUUID();
    const desc = input.description?.trim();
    await tx.walletEntry.create({ data: { walletId: from.id, kind: "TRANSFER", amountCents: -input.amountCents, description: `Transferência para ${to.name}${desc ? ` · ${desc}` : ""}`, occurredAt: input.occurredAt, transferGroupId: group, idempotencyKey: `${input.idempotencyKey}:out`, createdById: ctx.actor.userId } });
    await tx.walletEntry.create({ data: { walletId: to.id, kind: "TRANSFER", amountCents: input.amountCents, description: `Transferência de ${from.name}${desc ? ` · ${desc}` : ""}`, occurredAt: input.occurredAt, transferGroupId: group, idempotencyKey: `${input.idempotencyKey}:in`, createdById: ctx.actor.userId } });
    await audit(ctx.actor, { weddingId: ctx.weddingId, action: "transfer", entityType: "wallet", entityId: from.id, summary: `Transferiu ${formatBRL(input.amountCents)} de "${from.name}" para "${to.name}"` }, tx);
    return { transferGroupId: group };
  });
}

/** Estorna um ajuste ou as duas pernas de uma transferência (histórico preservado) */
export async function reverseWalletEntry(ctx: Ctx, entryId: string, reason: string) {
  assert(reason.trim().length >= 3, "Informe o motivo do estorno");
  return prisma.$transaction(async (tx) => {
    const e = await tx.walletEntry.findFirst({ where: { id: entryId, wallet: { weddingId: ctx.weddingId } } });
    if (!e) throw notFound("Movimento");
    assert(!e.reversedAt, "Movimento já estornado", "CONFLICT");
    const where = e.transferGroupId ? { transferGroupId: e.transferGroupId, reversedAt: null } : { id: e.id, reversedAt: null };
    await tx.walletEntry.updateMany({ where, data: { reversedAt: new Date() } });
    await audit(ctx.actor, { weddingId: ctx.weddingId, action: "reverse", entityType: "wallet", entityId: e.walletId, summary: `Estornou ${e.kind === "TRANSFER" ? "transferência" : "ajuste"} de ${formatBRL(Math.abs(e.amountCents))} — ${reason}` }, tx);
  });
}

/** Atribui (ou troca) a carteira de um pagamento ou entrada já registrado */
export async function assignWallet(ctx: Ctx, input: { paymentId?: string; incomeId?: string; walletId: string | null }) {
  return prisma.$transaction(async (tx) => {
    if (input.walletId) await ownWallet(tx, ctx.weddingId, input.walletId);
    if (input.paymentId) {
      const r = await tx.payment.updateMany({ where: { id: input.paymentId, weddingId: ctx.weddingId }, data: { walletId: input.walletId } });
      assert(r.count === 1, "Pagamento não encontrado", "NOT_FOUND");
    }
    if (input.incomeId) {
      const r = await tx.income.updateMany({ where: { id: input.incomeId, weddingId: ctx.weddingId }, data: { walletId: input.walletId } });
      assert(r.count === 1, "Entrada não encontrada", "NOT_FOUND");
    }
    await audit(ctx.actor, { weddingId: ctx.weddingId, action: "update", entityType: "wallet", entityId: input.walletId, summary: `Vinculou ${input.paymentId ? "pagamento" : "entrada"} a uma carteira` }, tx);
  });
}

/** Valida a carteira usada num pagamento/entrada (mesmo casamento, ativa) */
export async function checkWallet(tx: Tx, weddingId: string, walletId: string | null | undefined) {
  if (walletId) await ownWallet(tx, weddingId, walletId);
}
