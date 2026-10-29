import { guestStats, installmentStatus, projectCashflow, toObligationInput, weddingFinanceSummary, type Ctx, type Permission } from "@casa/core";
import { prisma } from "@casa/db";

export type Column = { key: string; label: string; type?: "money" | "date" | "number" | "text" };
export type Report = { title: string; columns: Column[]; rows: Record<string, unknown>[]; totals?: Record<string, number> };
export type Filters = { from?: Date; to?: Date; categoryId?: string; vendorId?: string; status?: string };

const inRange = (d: Date | null | undefined, f: Filters) => !d || ((!f.from || d >= f.from) && (!f.to || d <= f.to));
const sumBy = (rows: Record<string, unknown>[], k: string) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);

export const REPORTS: Record<string, { title: string; permission: Permission; build: (ctx: Ctx, f: Filters) => Promise<Report> }> = {
  "orcamento-categorias": {
    title: "Orçamento por categoria", permission: "finance:view",
    build: async (ctx) => {
      const s = await weddingFinanceSummary(ctx.weddingId);
      const rows = s.categories.map((c) => ({ categoria: c.name, orcamento: c.budget, previsto: c.planned, contratado: c.contracted, pago: c.paid, diferenca: c.budget - Math.max(c.planned, c.contracted), situacao: c.overBudget ? "Acima" : "OK" }));
      return { title: "Orçamento por categoria", columns: [{ key: "categoria", label: "Categoria" }, { key: "orcamento", label: "Orçamento", type: "money" }, { key: "previsto", label: "Previsto", type: "money" }, { key: "contratado", label: "Contratado", type: "money" }, { key: "pago", label: "Pago", type: "money" }, { key: "diferenca", label: "Disponível", type: "money" }, { key: "situacao", label: "Situação" }], rows, totals: { orcamento: sumBy(rows, "orcamento"), previsto: sumBy(rows, "previsto"), contratado: sumBy(rows, "contratado"), pago: sumBy(rows, "pago") } };
    },
  },
  "despesas-fornecedor": {
    title: "Despesas por fornecedor", permission: "finance:view",
    build: async (ctx, f) => {
      const s = await weddingFinanceSummary(ctx.weddingId);
      const by = new Map<string, { fornecedor: string; contratado: number; pago: number; em_aberto: number; vencido: number; caucoes_pendentes: number }>();
      for (const o of s.obligations) {
        const raw = s.data.obligations.find((x) => x.id === o.id)!;
        if (f.vendorId && raw.vendorId !== f.vendorId) continue;
        const k = raw.vendor?.name ?? "Sem fornecedor";
        const r = by.get(k) ?? { fornecedor: k, contratado: 0, pago: 0, em_aberto: 0, vencido: 0, caucoes_pendentes: 0 };
        r.contratado += o.contracted; r.pago += o.paid; r.em_aberto += o.open; r.vencido += o.overdue; r.caucoes_pendentes += o.depositPending;
        by.set(k, r);
      }
      const rows = [...by.values()].sort((a, b) => b.contratado - a.contratado);
      return { title: "Despesas por fornecedor", columns: [{ key: "fornecedor", label: "Fornecedor" }, { key: "contratado", label: "Contratado", type: "money" }, { key: "pago", label: "Pago", type: "money" }, { key: "em_aberto", label: "Em aberto", type: "money" }, { key: "vencido", label: "Vencido", type: "money" }, { key: "caucoes_pendentes", label: "Cauções a recuperar", type: "money" }], rows, totals: { contratado: sumBy(rows, "contratado"), pago: sumBy(rows, "pago"), em_aberto: sumBy(rows, "em_aberto") } };
    },
  },
  pagamentos: {
    title: "Pagamentos realizados", permission: "finance:view",
    build: async (ctx, f) => {
      const p = await prisma.payment.findMany({ where: { weddingId: ctx.weddingId, paidAt: { gte: f.from, lte: f.to } }, include: { allocations: { include: { installment: { include: { obligation: { select: { title: true, vendorId: true, vendor: { select: { name: true } } } } } } } } }, orderBy: { paidAt: "desc" } });
      const rows = p.filter((x) => !f.vendorId || x.allocations.some((a) => a.installment.obligation.vendorId === f.vendorId)).map((x) => ({ data: x.paidAt, valor: x.reversedAt ? 0 : x.amountCents, forma: x.method, referencia: x.reference, lancamentos: [...new Set(x.allocations.map((a) => a.installment.obligation.title))].join(", "), fornecedor: [...new Set(x.allocations.map((a) => a.installment.obligation.vendor?.name).filter(Boolean))].join(", "), situacao: x.reversedAt ? `Estornado: ${x.reversalReason}` : "Válido" }));
      return { title: "Pagamentos realizados", columns: [{ key: "data", label: "Data", type: "date" }, { key: "valor", label: "Valor", type: "money" }, { key: "forma", label: "Forma" }, { key: "referencia", label: "Referência" }, { key: "lancamentos", label: "Lançamentos" }, { key: "fornecedor", label: "Fornecedor" }, { key: "situacao", label: "Situação" }], rows, totals: { valor: sumBy(rows, "valor") } };
    },
  },
  "contas-a-pagar": {
    title: "Contas a pagar", permission: "finance:view",
    build: async (ctx, f) => installmentsReport(ctx, f, false),
  },
  "parcelas-vencidas": {
    title: "Parcelas vencidas", permission: "finance:view",
    build: async (ctx, f) => installmentsReport(ctx, f, true),
  },
  "fluxo-caixa": {
    title: "Fluxo de caixa projetado (PREVISÃO)", permission: "finance:view",
    build: async (ctx) => {
      const s = await weddingFinanceSummary(ctx.weddingId);
      const rows = projectCashflow({ obligations: s.data.obligations.map(toObligationInput), incomes: s.data.incomes, startBalance: s.realBalance, months: 12 }).map((r) => ({ mes: r.month, entradas_previstas: r.inflow, saidas_previstas: r.outflow, saldo_projetado: r.projectedBalance }));
      return { title: `Fluxo de caixa projetado (PREVISÃO) — saldo real inicial ${(s.realBalance / 100).toFixed(2)}`, columns: [{ key: "mes", label: "Mês" }, { key: "entradas_previstas", label: "Entradas previstas", type: "money" }, { key: "saidas_previstas", label: "Saídas previstas", type: "money" }, { key: "saldo_projetado", label: "Saldo projetado", type: "money" }], rows };
    },
  },
  "entradas-saidas": {
    title: "Entradas e saídas (realizadas)", permission: "finance:view",
    build: async (ctx, f) => {
      const [incomes, payments] = await Promise.all([
        prisma.income.findMany({ where: { weddingId: ctx.weddingId, status: "RECEIVED", receivedAt: { gte: f.from, lte: f.to } } }),
        prisma.payment.findMany({ where: { weddingId: ctx.weddingId, reversedAt: null, paidAt: { gte: f.from, lte: f.to } }, include: { allocations: { include: { installment: { include: { obligation: { select: { title: true } } } } } } } }),
      ]);
      const rows = [
        ...incomes.map((i) => ({ data: i.receivedAt, tipo: "Entrada", descricao: i.description, origem: i.source ?? i.kind, valor: i.amountCents })),
        ...payments.map((p) => ({ data: p.paidAt, tipo: "Saída", descricao: [...new Set(p.allocations.map((a) => a.installment.obligation.title))].join(", "), origem: p.method, valor: -p.amountCents })),
      ].sort((a, b) => (a.data?.getTime() ?? 0) - (b.data?.getTime() ?? 0));
      return { title: "Entradas e saídas (realizadas)", columns: [{ key: "data", label: "Data", type: "date" }, { key: "tipo", label: "Tipo" }, { key: "descricao", label: "Descrição" }, { key: "origem", label: "Origem/forma" }, { key: "valor", label: "Valor", type: "money" }], rows, totals: { valor: sumBy(rows, "valor") } };
    },
  },
  caucoes: {
    title: "Cauções pendentes", permission: "finance:view",
    build: async (ctx) => {
      const s = await weddingFinanceSummary(ctx.weddingId);
      const rows = s.obligations.flatMap((o) => {
        const raw = s.data.obligations.find((x) => x.id === o.id)!;
        return o.deposits.map((d) => ({ lancamento: raw.title, fornecedor: raw.vendor?.name ?? "", caucao: raw.items.find((i) => i.id === d.itemId)?.description ?? "", pago: d.paid, devolvido: d.refunded, retido: d.forfeited, a_recuperar: d.pending }));
      });
      return { title: "Cauções", columns: [{ key: "lancamento", label: "Lançamento" }, { key: "fornecedor", label: "Fornecedor" }, { key: "caucao", label: "Caução" }, { key: "pago", label: "Pago", type: "money" }, { key: "devolvido", label: "Devolvido", type: "money" }, { key: "retido", label: "Retido", type: "money" }, { key: "a_recuperar", label: "A recuperar", type: "money" }], rows, totals: { a_recuperar: sumBy(rows, "a_recuperar") } };
    },
  },
  "custo-convidado": {
    title: "Gastos por convidado", permission: "finance:view",
    build: async (ctx) => {
      const [s, g, w] = await Promise.all([weddingFinanceSummary(ctx.weddingId), guestStats(ctx.weddingId), prisma.wedding.findUniqueOrThrow({ where: { id: ctx.weddingId } })]);
      const rows = [
        { base: "Pessoas confirmadas", pessoas: g.confirmedPeople, contratado: s.contracted, por_pessoa: g.confirmedPeople ? Math.round(s.contracted / g.confirmedPeople) : null },
        { base: "Estimativa do casamento", pessoas: w.estimatedGuests ?? 0, contratado: s.contracted, por_pessoa: w.estimatedGuests ? Math.round(s.contracted / w.estimatedGuests) : null },
        { base: "Convidados cadastrados + acompanhantes permitidos", pessoas: g.invited, contratado: s.contracted, por_pessoa: g.invited ? Math.round(s.contracted / g.invited) : null },
      ];
      return { title: "Gastos por convidado", columns: [{ key: "base", label: "Base de cálculo" }, { key: "pessoas", label: "Pessoas", type: "number" }, { key: "contratado", label: "Contratado", type: "money" }, { key: "por_pessoa", label: "Por pessoa", type: "money" }], rows };
    },
  },
  convidados: {
    title: "Lista de convidados", permission: "guests:view",
    build: async (ctx, f) => {
      const guests = await prisma.guest.findMany({ where: { weddingId: ctx.weddingId, deletedAt: null, ...(f.status ? { rsvpStatus: f.status as never } : {}) }, include: { group: { select: { name: true } }, companions: { where: { attending: true } } }, orderBy: [{ group: { name: "asc" } }, { fullName: "asc" }] });
      const rows = guests.map((g) => ({ nome: g.fullName, familia: g.group.name, telefone: g.phone, relacao: g.relation, lado: g.side, categoria: g.category, crianca: g.isChild ? "Sim" : "Não", acompanhantes_permitidos: g.plusOnesAllowed, convite: g.inviteStatus, confirmacao: g.rsvpStatus, acompanhantes_confirmados: g.companions.length, restricoes: g.dietary, acessibilidade: g.accessibility, mesa: g.tableName }));
      return { title: "Lista de convidados", columns: [{ key: "nome", label: "Nome" }, { key: "familia", label: "Família" }, { key: "telefone", label: "Telefone" }, { key: "relacao", label: "Relação" }, { key: "lado", label: "Lado" }, { key: "categoria", label: "Categoria" }, { key: "crianca", label: "Criança" }, { key: "acompanhantes_permitidos", label: "Acomp. permitidos", type: "number" }, { key: "convite", label: "Convite" }, { key: "confirmacao", label: "Confirmação" }, { key: "acompanhantes_confirmados", label: "Acomp. confirmados", type: "number" }, { key: "restricoes", label: "Restrições alimentares" }, { key: "acessibilidade", label: "Acessibilidade" }, { key: "mesa", label: "Mesa" }], rows };
    },
  },
  confirmacoes: {
    title: "Confirmações de presença (lista final)", permission: "guests:view",
    build: async (ctx) => {
      const guests = await prisma.guest.findMany({ where: { weddingId: ctx.weddingId, deletedAt: null, rsvpStatus: "ACCEPTED" }, include: { group: { select: { name: true } }, companions: { where: { attending: true } } }, orderBy: [{ tableName: "asc" }, { group: { name: "asc" } }] });
      const rows = guests.flatMap((g) => [
        { pessoa: g.fullName, familia: g.group.name, tipo: g.isChild ? "Criança" : "Adulto", restricoes: g.dietary, acessibilidade: g.accessibility, mesa: g.tableName, confirmado_em: g.rsvpAt },
        ...g.companions.map((c) => ({ pessoa: c.name ?? `Acompanhante de ${g.fullName}`, familia: g.group.name, tipo: c.isChild ? "Criança" : "Adulto", restricoes: c.dietary, acessibilidade: null, mesa: g.tableName, confirmado_em: g.rsvpAt })),
      ]);
      return { title: `Confirmados: ${rows.length} pessoa(s)`, columns: [{ key: "pessoa", label: "Pessoa" }, { key: "familia", label: "Família" }, { key: "tipo", label: "Tipo" }, { key: "restricoes", label: "Restrições" }, { key: "acessibilidade", label: "Acessibilidade" }, { key: "mesa", label: "Mesa" }, { key: "confirmado_em", label: "Confirmado em", type: "date" }], rows };
    },
  },
  "tarefas-atrasadas": {
    title: "Tarefas atrasadas", permission: "planning:view",
    build: async (ctx) => {
      const t = await prisma.task.findMany({ where: { weddingId: ctx.weddingId, archivedAt: null, dueDate: { lt: new Date() }, status: { notIn: ["DONE", "CANCELLED"] } }, include: { assignees: { include: { user: { select: { name: true } } } }, vendor: { select: { name: true } } }, orderBy: { dueDate: "asc" } });
      const rows = t.map((x) => ({ tarefa: x.title, fase: x.category, prazo: x.dueDate, dias_atraso: Math.floor((Date.now() - x.dueDate!.getTime()) / 86400_000), prioridade: x.priority, status: x.status, responsaveis: x.assignees.map((a) => a.user.name).join(", "), fornecedor: x.vendor?.name }));
      return { title: "Tarefas atrasadas", columns: [{ key: "tarefa", label: "Tarefa" }, { key: "fase", label: "Fase" }, { key: "prazo", label: "Prazo", type: "date" }, { key: "dias_atraso", label: "Dias de atraso", type: "number" }, { key: "prioridade", label: "Prioridade" }, { key: "status", label: "Status" }, { key: "responsaveis", label: "Responsáveis" }, { key: "fornecedor", label: "Fornecedor" }], rows };
    },
  },
  contratos: {
    title: "Contratos e prazos", permission: "documents:view",
    build: async (ctx, f) => {
      const c = await prisma.vendorContract.findMany({ where: { vendor: { weddingId: ctx.weddingId, ...(f.vendorId ? { id: f.vendorId } : {}) }, ...(f.status ? { status: f.status as never } : {}) }, include: { vendor: { select: { name: true } }, clauses: true }, orderBy: { serviceDate: "asc" } });
      const showValue = ctx.permissions.has("finance:view");
      const rows = c.map((x) => ({ contrato: x.title, fornecedor: x.vendor.name, status: x.status, assinado_em: x.signedAt, data_servico: x.serviceDate, prazo: x.expiresAt, valor: showValue ? x.totalCents : null, obrigacoes_pendentes: x.clauses.filter((k) => !k.doneAt).length, cancelamento: x.cancellationPolicy }));
      return { title: "Contratos e prazos", columns: [{ key: "contrato", label: "Contrato" }, { key: "fornecedor", label: "Fornecedor" }, { key: "status", label: "Status" }, { key: "assinado_em", label: "Assinado em", type: "date" }, { key: "data_servico", label: "Data do serviço", type: "date" }, { key: "prazo", label: "Prazo", type: "date" }, ...(showValue ? [{ key: "valor", label: "Valor", type: "money" as const }] : []), { key: "obrigacoes_pendentes", label: "Obrigações pendentes", type: "number" }, { key: "cancelamento", label: "Política de cancelamento" }], rows };
    },
  },
  "situacao-geral": {
    title: "Situação geral do casamento", permission: "reports:view",
    build: async (ctx) => {
      const rows: Record<string, unknown>[] = [];
      const add = (area: string, indicador: string, valor: unknown, tipo = "text") => rows.push({ area, indicador, valor, tipo });
      if (ctx.permissions.has("finance:view")) {
        const s = await weddingFinanceSummary(ctx.weddingId);
        add("Financeiro", "Orçamento", s.budget, "money"); add("Financeiro", "Contratado", s.contracted, "money"); add("Financeiro", "Pago", s.paid, "money");
        add("Financeiro", "Em aberto", s.open, "money"); add("Financeiro", "Vencido", s.overdue, "money"); add("Financeiro", "Saldo real", s.realBalance, "money"); add("Financeiro", "Saldo projetado (previsão)", s.projectedBalance, "money"); add("Financeiro", "Cauções a recuperar", s.depositPending, "money");
      }
      if (ctx.permissions.has("guests:view")) {
        const g = await guestStats(ctx.weddingId);
        add("Convidados", "Pessoas confirmadas", g.confirmedPeople); add("Convidados", "Sem resposta", g.pending); add("Convidados", "Recusas", g.declined);
      }
      if (ctx.permissions.has("planning:view")) {
        const now = new Date();
        add("Planejamento", "Tarefas concluídas", await prisma.task.count({ where: { weddingId: ctx.weddingId, status: "DONE", archivedAt: null } }));
        add("Planejamento", "Tarefas em aberto", await prisma.task.count({ where: { weddingId: ctx.weddingId, status: { notIn: ["DONE", "CANCELLED"] }, archivedAt: null } }));
        add("Planejamento", "Tarefas atrasadas", await prisma.task.count({ where: { weddingId: ctx.weddingId, status: { notIn: ["DONE", "CANCELLED"] }, archivedAt: null, dueDate: { lt: now } } }));
      }
      if (ctx.permissions.has("vendors:view")) add("Fornecedores", "Contratados", await prisma.vendor.count({ where: { weddingId: ctx.weddingId, status: { in: ["HIRED", "COMPLETED"] }, mergedIntoId: null } }));
      return { title: "Situação geral do casamento", columns: [{ key: "area", label: "Área" }, { key: "indicador", label: "Indicador" }, { key: "valor", label: "Valor" }], rows };
    },
  },
};

async function installmentsReport(ctx: Ctx, f: Filters, onlyOverdue: boolean): Promise<Report> {
  const s = await weddingFinanceSummary(ctx.weddingId);
  const rows = s.data.obligations
    .filter((o) => o.status === "ACTIVE" && (!f.vendorId || o.vendorId === f.vendorId) && (!f.categoryId || o.categoryId === f.categoryId))
    .flatMap((o) => toObligationInput(o).installments.map((i) => ({ o, i, st: installmentStatus(i, o.status) })))
    .filter((r) => r.st.remaining > 0 && (!onlyOverdue || r.st.overdue) && inRange(r.i.dueDate, f))
    .sort((a, b) => a.i.dueDate.getTime() - b.i.dueDate.getTime())
    .map((r) => ({ vencimento: r.i.dueDate, lancamento: r.o.title, fornecedor: r.o.vendor?.name, categoria: r.o.category?.name, valor: r.i.amountCents, pago: r.i.paidCents, saldo: r.st.remaining, status: r.st.status }));
  return { title: onlyOverdue ? "Parcelas vencidas" : "Contas a pagar", columns: [{ key: "vencimento", label: "Vencimento", type: "date" }, { key: "lancamento", label: "Lançamento" }, { key: "fornecedor", label: "Fornecedor" }, { key: "categoria", label: "Categoria" }, { key: "valor", label: "Valor", type: "money" }, { key: "pago", label: "Pago", type: "money" }, { key: "saldo", label: "Saldo", type: "money" }, { key: "status", label: "Status" }], rows, totals: { saldo: sumBy(rows, "saldo") } };
}

export const REPORT_LIST = Object.entries(REPORTS).map(([key, r]) => ({ key, title: r.title, permission: r.permission }));
