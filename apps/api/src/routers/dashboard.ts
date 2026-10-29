import { getSetting, guestStats, installmentStatus, toObligationInput, weddingFinanceSummary } from "@casa/core";
import { prisma } from "@casa/db";
import { perm, router } from "../trpc.js";

type Alert = { level: "info" | "warning" | "danger"; title: string; detail: string; link: string };

export const dashboardRouter = router({
  overview: perm("dashboard:view").query(async ({ ctx }) => {
    const W = ctx.weddingId;
    const now = new Date();
    const can = (p: string) => ctx.permissions.has(p);
    const alerts: Alert[] = [];
    const w = ctx.wedding;
    const daysLeft = w.date ? Math.ceil((w.date.getTime() - now.getTime()) / 86400_000) : null;

    let finance = null;
    let dueSoon: { id: string; obligationId: string; title: string; vendor: string | null; dueDate: Date; remaining: number; overdue: boolean }[] = [];
    if (can("finance:view")) {
      const s = await weddingFinanceSummary(W, now);
      const window = await getSetting(W, "finance.dueSoonDays");
      const alertPct = await getSetting(W, "finance.budgetAlertPercent");
      const limit = new Date(now.getTime() + window * 86400_000);
      dueSoon = s.data.obligations
        .filter((o) => o.status === "ACTIVE")
        .flatMap((o) => toObligationInput(o).installments.map((i) => ({ o, i, st: installmentStatus(i, o.status, now) })))
        .filter((r) => r.st.remaining > 0 && r.i.dueDate <= limit)
        .sort((a, b) => a.i.dueDate.getTime() - b.i.dueDate.getTime())
        .slice(0, 8)
        .map((r) => ({ id: r.i.id, obligationId: r.o.id, title: r.o.title, vendor: r.o.vendor?.name ?? null, dueDate: r.i.dueDate, remaining: r.st.remaining, overdue: r.st.overdue }));
      const { data: _d, obligations: _o, ...rest } = s;
      finance = rest;
      if (s.overdue > 0) alerts.push({ level: "danger", title: "Parcelas vencidas", detail: `Há valores vencidos em aberto.`, link: "/financeiro/pagar?vencidas=1" });
      const used = Math.max(s.planned, s.contracted);
      if (s.budget > 0 && used >= (s.budget * alertPct) / 100) alerts.push({ level: s.overBudget ? "danger" : "warning", title: s.overBudget ? "Orçamento estourado" : "Orçamento quase no limite", detail: `${Math.round((used / s.budget) * 100)}% do orçamento comprometido.`, link: "/financeiro" });
      for (const c of s.categories.filter((c) => c.overBudget)) alerts.push({ level: "warning", title: `Categoria acima do orçamento: ${c.name}`, detail: "O previsto/contratado passou do valor planejado.", link: `/financeiro/lancamentos?categoria=${c.categoryId}` });
      if (s.unscheduled > 0) alerts.push({ level: "info", title: "Valores contratados sem parcelas", detail: "Gere as parcelas para que entrem no fluxo de caixa.", link: "/financeiro/lancamentos" });
      if (s.projectedBalance < 0) alerts.push({ level: "warning", title: "Saldo projetado negativo", detail: "A previsão indica falta de recursos para cobrir as contas em aberto.", link: "/financeiro/fluxo" });
      if (daysLeft != null && daysLeft < 0 && s.depositPending > 0) alerts.push({ level: "warning", title: "Cauções a recuperar", detail: "O casamento já passou e há cauções não devolvidas.", link: "/financeiro/caucoes" });
    }

    let guests = null;
    if (can("guests:view")) {
      guests = await guestStats(W);
      if (w.rsvpDeadline && guests.pending > 0) {
        const d = Math.ceil((w.rsvpDeadline.getTime() - now.getTime()) / 86400_000);
        if (d <= 14) alerts.push({ level: d < 0 ? "danger" : "warning", title: d < 0 ? "Prazo de confirmação encerrado" : `Prazo de confirmação em ${d} dia(s)`, detail: "Há convidados sem resposta.", link: "/convidados?rsvp=PENDING" });
      }
      if (w.maxGuests && guests.confirmedPeople > w.maxGuests) alerts.push({ level: "danger", title: "Confirmados acima da capacidade", detail: `Limite configurado: ${w.maxGuests} pessoas.`, link: "/convidados" });
    }

    let tasks = null;
    let nextTasks: { id: string; title: string; dueDate: Date | null; priority: string; status: string }[] = [];
    if (can("planning:view")) {
      const [byStatus, overdue] = await Promise.all([
        prisma.task.groupBy({ by: ["status"], where: { weddingId: W, archivedAt: null }, _count: true }),
        prisma.task.count({ where: { weddingId: W, archivedAt: null, dueDate: { lt: now }, status: { notIn: ["DONE", "CANCELLED"] } } }),
      ]);
      const n = (s: string) => byStatus.find((b) => b.status === s)?._count ?? 0;
      tasks = { done: n("DONE"), open: byStatus.filter((b) => !["DONE", "CANCELLED"].includes(b.status)).reduce((a, b) => a + b._count, 0), overdue, total: byStatus.reduce((a, b) => a + b._count, 0) };
      nextTasks = await prisma.task.findMany({ where: { weddingId: W, archivedAt: null, status: { notIn: ["DONE", "CANCELLED"] }, dueDate: { not: null } }, orderBy: { dueDate: "asc" }, take: 6, select: { id: true, title: true, dueDate: true, priority: true, status: true } });
      if (overdue) alerts.push({ level: "warning", title: `${overdue} tarefa(s) atrasada(s)`, detail: "Revise prazos ou responsáveis.", link: "/checklist?atrasadas=1" });
    }

    const events = can("calendar:view") ? await prisma.calendarEvent.findMany({ where: { weddingId: W, status: "SCHEDULED", startsAt: { gte: now } }, orderBy: { startsAt: "asc" }, take: 6, select: { id: true, title: true, startsAt: true, type: true, location: true } }) : [];
    const contractsReview = can("documents:view") ? await prisma.vendorContract.findMany({ where: { vendor: { weddingId: W }, status: { in: ["DRAFT", "UNDER_REVIEW"] } }, select: { id: true, title: true, status: true, vendor: { select: { id: true, name: true } } }, take: 8 }) : [];
    const vendorsPending = can("vendors:view")
      ? await prisma.vendor.findMany({
          where: { weddingId: W, archivedAt: null, mergedIntoId: null, OR: [{ tasks: { some: { status: { notIn: ["DONE", "CANCELLED"] }, dueDate: { lt: now } } } }, { deliveries: { some: { deliveredAt: null, dueAt: { lt: now } } } }, { contracts: { some: { clauses: { some: { doneAt: null, dueDate: { lt: now } } } } } }] },
          select: { id: true, name: true, status: true }, take: 8,
        })
      : [];
    for (const v of vendorsPending) alerts.push({ level: "warning", title: `Pendência com ${v.name}`, detail: "Tarefa, entrega ou obrigação contratual atrasada.", link: `/fornecedores/${v.id}` });
    const proposals = can("ai:view") ? await prisma.aIActionProposal.findMany({ where: { weddingId: W, status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, summary: true, createdAt: true } }) : [];
    for (const p of proposals) alerts.push({ level: "info", title: "Sugestão da IA aguardando aprovação", detail: p.summary, link: "/assistente?propostas=1" });

    return {
      wedding: { name: w.name, partner1Name: w.partner1Name, partner2Name: w.partner2Name, date: w.date, timezone: w.timezone, daysLeft, rsvpDeadline: w.rsvpDeadline },
      finance, guests, tasks, nextTasks, dueSoon, events, contractsReview, vendorsPending, alerts,
    };
  }),
});
