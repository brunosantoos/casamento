/**
 * Planejamento financeiro determinístico (usado pela IA e pela tela).
 * A IA NUNCA faz contas: chama estas funções, que usam os dados reais em centavos,
 * e só interpreta/explica os resultados. Mudanças viram propostas para aprovação.
 */
import { prisma } from "@casa/db";
import { installmentStatus, projectCashflow } from "./domain.js";
import { toObligationInput, weddingFinanceSummary } from "./service.js";
import { sum } from "../money.js";

/** Referência de mercado (% do orçamento) por categoria padrão — usada só como ponto de partida */
const REFERENCE_PCT: Record<string, number> = {
  "Local da recepção": 12, Buffet: 25, Bebidas: 7, Decoração: 10, Fotografia: 7, Filmagem: 4, "Música e DJ": 4, Trajes: 6,
  "Beleza dos noivos": 2, Alianças: 3, Convites: 1.5, "Bolo e doces": 3, Lembranças: 1, "Igreja e cerimônia": 2, Celebrante: 0.5,
  Cerimonialista: 3, Transporte: 1, Hospedagem: 1, "Lua de mel": 0, "Cartório e documentação": 0.5, "Casa e mobiliário": 0,
  "Taxas administrativas": 0.5, Imprevistos: 5, "Outras despesas": 1,
};

/** Divide `total` em partes inteiras proporcionais aos pesos (maior resto), somando exatamente `total` */
export function splitByWeights(total: number, weights: number[]) {
  const w = sum(weights);
  if (!w || total <= 0) return weights.map(() => 0);
  const raw = weights.map((x) => (total * x) / w);
  const base = raw.map(Math.floor);
  let rest = total - sum(base);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (const o of order) {
    if (rest <= 0) break;
    base[o.i]! += 1;
    rest--;
  }
  return base;
}

/**
 * Sugere o orçamento por categoria: parte da referência de mercado, nunca fica abaixo do que já foi
 * contratado/previsto e redistribui o restante entre as categorias ainda em aberto.
 */
export async function suggestBudgetSplit(weddingId: string, opts: { totalCents?: number; includeHoneymoon?: boolean } = {}) {
  const s = await weddingFinanceSummary(weddingId);
  const total = opts.totalCents ?? s.budget;
  const cats = s.data.categories.filter((c) => !c.parentId);
  const rows = cats.map((c) => {
    const row = s.categories.find((x) => x.categoryId === c.id);
    const committed = Math.max(row?.contracted ?? 0, row?.planned ?? 0);
    let ref = REFERENCE_PCT[c.name] ?? 1;
    if (c.name === "Lua de mel" && opts.includeHoneymoon) ref = 8;
    return { categoryId: c.id, name: c.name, currentBudget: c.budgetCents, committed, refPct: ref };
  });
  const committedTotal = sum(rows.map((r) => r.committed));
  if (!total) return { total: 0, committedTotal, feasible: false, rows: [], note: "Defina o orçamento total do casamento em Configurações." };
  // 1) cada categoria recebe no mínimo o que já está comprometido; 2) o que sobra é distribuído pela referência
  const free = Math.max(0, total - committedTotal);
  const extra = splitByWeights(free, rows.map((r) => (r.committed > 0 ? r.refPct * 0.5 : r.refPct)));
  const result = rows.map((r, i) => {
    const suggested = r.committed + extra[i]!;
    return { ...r, suggested, pct: Math.round((suggested / total) * 1000) / 10, change: suggested - r.currentBudget };
  });
  return {
    total,
    committedTotal,
    feasible: committedTotal <= total,
    overBy: Math.max(0, committedTotal - total),
    unallocatedBefore: total - sum(rows.map((r) => r.currentBudget)),
    rows: result.sort((a, b) => b.suggested - a.suggested),
  };
}

type Move = { installmentId: string; dueDate: Date };

/** Saldo de partida: soma das carteiras (o que vocês têm de fato) ou, sem carteiras, o saldo real calculado */
async function startBalance(weddingId: string) {
  const s = await weddingFinanceSummary(weddingId);
  return { s, start: s.walletsTotal ?? s.realBalance, basis: s.walletsTotal != null ? "carteiras" : "saldo real (entradas − pagamentos)" };
}

/** Simulação mês a mês com mudanças hipotéticas de vencimento (nada é gravado) */
export async function simulateCashflow(weddingId: string, opts: { moves?: Move[]; months?: number; reserveCents?: number } = {}) {
  const { s, start, basis } = await startBalance(weddingId);
  const moves = new Map((opts.moves ?? []).map((m) => [m.installmentId, m.dueDate]));
  const obligations = s.data.obligations.map(toObligationInput).map((o) => ({
    ...o,
    installments: o.installments.map((i) => (moves.has(i.id) ? { ...i, dueDate: moves.get(i.id)! } : i)),
  }));
  const wedding = await prisma.wedding.findUniqueOrThrow({ where: { id: weddingId }, select: { date: true } });
  const now = new Date();
  const untilWedding = wedding.date ? (wedding.date.getFullYear() - now.getFullYear()) * 12 + wedding.date.getMonth() - now.getMonth() + 2 : 12;
  const months = Math.max(1, Math.min(36, opts.months ?? untilWedding));
  const rows = projectCashflow({ obligations, incomes: s.data.incomes, startBalance: start, months, now });
  const reserve = opts.reserveCents ?? 0;
  const firstShort = rows.find((r) => r.projectedBalance < reserve) ?? null;
  return {
    startBalance: start,
    basis,
    reserveCents: reserve,
    rows,
    minBalance: Math.min(...rows.map((r) => r.projectedBalance)),
    firstShortMonth: firstShort?.month ?? null,
    ok: !firstShort,
  };
}

/** Quanto falta e quanto guardar por mês até o casamento */
export async function paymentCapacity(weddingId: string) {
  const { s, start, basis } = await startBalance(weddingId);
  const wedding = await prisma.wedding.findUniqueOrThrow({ where: { id: weddingId }, select: { date: true } });
  const now = new Date();
  const monthsLeft = wedding.date ? Math.max(1, (wedding.date.getFullYear() - now.getFullYear()) * 12 + wedding.date.getMonth() - now.getMonth() + 1) : null;
  const toPay = s.open + s.unscheduled;
  const gap = Math.max(0, toPay - start - s.incomeExpected);
  const planned = Math.max(0, s.planned - s.contracted);
  return {
    available: start,
    basis,
    openInstallments: s.open,
    contractedWithoutInstallments: s.unscheduled,
    plannedNotContracted: planned,
    expectedIncome: s.incomeExpected,
    gap,
    gapIncludingPlanned: Math.max(0, toPay + planned - start - s.incomeExpected),
    monthsLeft,
    monthlyNeeded: monthsLeft ? Math.ceil(gap / monthsLeft) : null,
    monthlyNeededIncludingPlanned: monthsLeft ? Math.ceil(Math.max(0, toPay + planned - start - s.incomeExpected) / monthsLeft) : null,
    budget: s.budget,
    overBudget: s.overBudget,
  };
}

const monthStart = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y!, m! - 1, 10, 12);
};

/**
 * Sugere novos vencimentos para que o saldo projetado não fique abaixo da reserva:
 * percorre os meses; onde faltar dinheiro, empurra parcelas (não vencidas) daquele mês para o
 * primeiro mês seguinte, até o mês do casamento, em que caibam. Vencimentos são contratuais:
 * a sugestão serve para NEGOCIAR com o fornecedor — por isso só vira alteração com aprovação.
 */
export async function suggestPaymentPlan(weddingId: string, opts: { reserveCents?: number } = {}) {
  const reserve = opts.reserveCents ?? 0;
  const { s } = await startBalance(weddingId);
  const now = new Date();
  const flexible = s.data.obligations
    .filter((o) => o.status === "ACTIVE")
    .flatMap((o) => toObligationInput(o).installments.map((i) => ({ i, o, st: installmentStatus(i, o.status, now) })))
    .filter((r) => r.st.remaining > 0 && !r.st.overdue)
    .map((r) => ({ id: r.i.id, title: r.o.title, vendor: r.o.vendor?.name ?? null, dueDate: r.i.dueDate, remaining: r.st.remaining, deposit: r.o.items.some((it) => it.id === r.i.itemId && it.kind === "DEPOSIT") }));

  const moves = new Map<string, Date>();
  const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const effective = (f: (typeof flexible)[number]) => moves.get(f.id) ?? f.dueDate;
  const asList = () => [...moves].map(([installmentId, dueDate]) => ({ installmentId, dueDate }));
  let sim = await simulateCashflow(weddingId, { reserveCents: reserve });
  const lastMonth = sim.rows.at(-1)?.month;
  for (let guard = 0; guard < 60 && !sim.ok; guard++) {
    const short = sim.firstShortMonth!;
    // Parcelas que vencem até o mês em falta (as maiores primeiro), exceto cauções (prazo costuma ser rígido)
    const candidates = flexible
      .filter((f) => !f.deposit && keyOf(effective(f)) <= short)
      .sort((x, y) => y.remaining - x.remaining);
    let placed = false;
    for (const c of candidates) {
      for (const r of sim.rows.filter((x) => x.month > short && (!lastMonth || x.month <= lastMonth))) {
        const trial = new Map(moves).set(c.id, monthStart(r.month));
        const t = await simulateCashflow(weddingId, { moves: [...trial].map(([installmentId, dueDate]) => ({ installmentId, dueDate })), reserveCents: reserve });
        // Aceita só se nenhum mês até o novo vencimento ficar abaixo da reserva
        if (!t.firstShortMonth || t.firstShortMonth > r.month) {
          moves.set(c.id, monthStart(r.month));
          sim = t;
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
    if (!placed) break;
  }
  const byId = new Map(flexible.map((f) => [f.id, f]));
  return {
    reserveCents: reserve,
    moves: asList().map((m) => ({ installmentId: m.installmentId, title: byId.get(m.installmentId)?.title, vendor: byId.get(m.installmentId)?.vendor, amount: byId.get(m.installmentId)?.remaining, from: byId.get(m.installmentId)?.dueDate, to: m.dueDate })),
    solved: sim.ok,
    result: sim,
    note: sim.ok
      ? moves.size ? "Com essas mudanças de vencimento o saldo projetado não fica abaixo da reserva. Confirme com cada fornecedor antes de aprovar." : "O fluxo já fecha sem mudanças."
      : "Mesmo reorganizando os vencimentos ainda falta dinheiro: será preciso aumentar entradas, reduzir gastos ou rever o orçamento.",
  };
}

// ───────────── Aplicar (ação do usuário na tela, com auditoria) ─────────────

import { audit } from "../audit.js";
import type { Ctx } from "../context.js";
import { assert, notFound } from "../errors.js";
import { formatBRL } from "../money.js";

export async function applyCategoryBudgets(ctx: Ctx, items: { categoryId: string; budgetCents: number }[]) {
  assert(items.length > 0, "Nada para aplicar");
  const ids = items.map((i) => i.categoryId);
  const cats = await prisma.financialCategory.findMany({ where: { id: { in: ids }, weddingId: ctx.weddingId } });
  assert(cats.length === new Set(ids).size, "Categoria inválida");
  await prisma.$transaction(async (tx) => {
    for (const i of items) {
      assert(Number.isInteger(i.budgetCents) && i.budgetCents >= 0, "Valor inválido");
      await tx.financialCategory.update({ where: { id: i.categoryId }, data: { budgetCents: i.budgetCents } });
    }
    await audit(ctx.actor, {
      weddingId: ctx.weddingId, action: "update", entityType: "category", entityId: "budget-split",
      summary: `Aplicou divisão do orçamento em ${items.length} categoria(s) (total ${formatBRL(sum(items.map((i) => i.budgetCents)))})`,
      changes: items.map((i) => ({ categoria: cats.find((c) => c.id === i.categoryId)?.name, de: cats.find((c) => c.id === i.categoryId)?.budgetCents, para: i.budgetCents })),
    }, tx);
  });
}

export async function applyReschedule(ctx: Ctx, changes: { installmentId: string; dueDate: Date }[]) {
  assert(changes.length > 0, "Nada para aplicar");
  await prisma.$transaction(async (tx) => {
    for (const c of changes) {
      const inst = await tx.installment.findFirst({ where: { id: c.installmentId, obligation: { weddingId: ctx.weddingId } }, include: { obligation: { select: { title: true } }, allocations: { include: { payment: { select: { reversedAt: true } } } } } });
      if (!inst) throw notFound("Parcela");
      assert(!inst.cancelledAt, "Parcela cancelada não pode ser reprogramada");
      const paid = sum(inst.allocations.filter((a) => !a.payment.reversedAt).map((a) => a.amountCents));
      assert(paid < inst.amountCents, `"${inst.obligation.title}" já está paga`);
      await tx.installment.update({ where: { id: inst.id }, data: { dueDate: c.dueDate } });
      await audit(ctx.actor, { weddingId: ctx.weddingId, action: "update", entityType: "installment", entityId: inst.id, summary: `Vencimento de "${inst.obligation.title}" (parcela ${inst.number}): ${inst.dueDate.toLocaleDateString("pt-BR")} → ${c.dueDate.toLocaleDateString("pt-BR")} (plano de pagamentos)` }, tx);
    }
  });
}
