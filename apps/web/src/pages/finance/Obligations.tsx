import { ChevronRight, Eye, Pencil, Plus, Receipt } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { EmptyState, QueryState, StatusBadge } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { date } from "@/lib/format";
import { INSTALLMENT_STATUS, OBLIGATION_STATUS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { trpc, type RouterOutputs } from "@/trpc";
import { Avatar, Bar, Cell2, DataTable, dueLabel, FilterBar, FinanceShell, Money, NativeSelect, opts, SummaryStrip, useCanFinance, useCategoryOptions } from "./shared";

type Row = RouterOutputs["finance"]["obligations"][number];
const value = (o: Row) => (o.status === "ACTIVE" ? o.contracted : o.planned);
const paidPct = (o: Row) => {
  const base = value(o) + o.depositsContracted;
  return base ? Math.round((o.paid / base) * 100) : 0;
};

export function ObligationsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const status = params.get("status") ?? "";
  const categoryId = params.get("categoria") ?? "";
  const vendorId = params.get("fornecedor") ?? "";
  const [search, setSearch] = useState("");
  const perm = useCanFinance();
  const categories = useCategoryOptions();
  const vendors = trpc.vendors.list.useQuery();
  const q = trpc.finance.obligations.useQuery({ status: (status || undefined) as never, categoryId: categoryId || undefined, vendorId: vendorId || undefined });
  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };

  const rows = useMemo(() => {
    const s = search.toLowerCase();
    return (q.data ?? []).filter((o) => !s || o.title.toLowerCase().includes(s) || o.vendor?.name.toLowerCase().includes(s));
  }, [q.data, search]);

  const totals = useMemo(() => ({
    value: rows.reduce((a, o) => a + value(o), 0),
    paid: rows.reduce((a, o) => a + o.paid, 0),
    open: rows.reduce((a, o) => a + o.open, 0),
    overdue: rows.reduce((a, o) => a + o.overdue, 0),
  }), [rows]);
  const filtered = !!(status || categoryId || vendorId);
  const open = (o: Row) => navigate(`/financeiro/lancamentos/${o.id}`);

  return (
    <FinanceShell
      title="Lançamentos"
      description="Contratações e despesas — cada uma com vários itens, parcelas e pagamentos."
      actions={perm.create && <Button asChild><Link to="/financeiro/lancamentos/novo"><Plus /> Novo lançamento</Link></Button>}
    >
      <FilterBar search={search} onSearch={setSearch} placeholder="Buscar por título ou fornecedor">
        <NativeSelect className="w-auto min-w-36" value={status} onChange={(v) => setParam("status", v)} placeholder="Todos os status" options={opts(OBLIGATION_STATUS)} />
        <NativeSelect className="w-auto min-w-44" value={categoryId} onChange={(v) => setParam("categoria", v)} placeholder="Todas as categorias" options={categories} />
        <NativeSelect className="w-auto min-w-44" value={vendorId} onChange={(v) => setParam("fornecedor", v)} placeholder="Todos os fornecedores" options={(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name }))} />
        {filtered && <Button variant="ghost" size="sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Limpar filtros</Button>}
      </FilterBar>
      <QueryState
        query={q}
        empty={(d) =>
          d.length === 0 ? (
            <EmptyState icon={<Receipt />} title={filtered ? "Nada com esses filtros" : "Nenhum lançamento ainda"} description="Ex.: Igreja — reserva R$ 200, celebração R$ 700, caução R$ 200 (reembolsável) e taxa extra R$ 100." action={perm.create && <Button asChild><Link to="/financeiro/lancamentos/novo"><Plus /> Novo lançamento</Link></Button>} />
          ) : null
        }
      >
        {() => (
          <>
            <SummaryStrip items={[{ label: `Valor · ${rows.length} lançamento(s)`, value: totals.value }, { label: "Pago", value: totals.paid, tone: "success" }, { label: "Em aberto", value: totals.open }, { label: "Vencido", value: totals.overdue, tone: "danger" }]} />
            <DataTable<Row>
              rows={rows}
              rowKey={(o) => o.id}
              onRowClick={open}
              initialSort={{ key: "next", dir: 1 }}
              empty="Nenhum resultado para a busca."
              leading={(o) => <Avatar name={o.vendor?.name ?? o.title} />}
              columns={[
                { key: "title", header: "Lançamento", sort: (o) => o.title.toLowerCase(), cell: (o) => <Cell2 title={o.title} sub={[o.vendor?.name, o.category?.name, `${o.itemCount} item(ns)`].filter(Boolean).join(" · ")} />, footer: "Total" },
                { key: "status", header: "Status", sort: (o) => o.status, cell: (o) => <StatusBadge tone={OBLIGATION_STATUS[o.status]?.tone}>{OBLIGATION_STATUS[o.status]?.label}</StatusBadge> },
                { key: "value", header: "Valor", align: "right", sort: value, cell: (o) => <div><Money value={value(o)} size="sm" />{o.depositsContracted > 0 && <div className="text-[11px] text-muted-foreground">+ caução</div>}</div>, footer: <Money value={totals.value} size="sm" /> },
                { key: "paid", header: "Pago", sort: paidPct, className: "w-44", cell: (o) => <div><div className="flex items-center gap-2"><Bar value={paidPct(o)} /><span className="w-9 text-right text-[11px] text-muted-foreground tabular-nums">{paidPct(o)}%</span></div><Money value={o.paid} size="sm" className="text-xs font-medium text-muted-foreground" /></div>, footer: <Money value={totals.paid} size="sm" /> },
                { key: "open", header: "Em aberto", align: "right", sort: (o) => o.open, cell: (o) => <div><Money value={o.open} size="sm" className={cn(o.overdue > 0 && "text-destructive")} />{o.unscheduled > 0 && <div className="text-[11px] text-amber-600">sem parcela</div>}</div>, footer: <Money value={totals.open} size="sm" /> },
                { key: "next", header: "Próximo vencimento", sort: (o) => (o.nextDue ? new Date(o.nextDue.date).getTime() : Number.MAX_SAFE_INTEGER), cell: (o) => o.nextDue ? <div className="flex items-center gap-2"><div><div className="text-sm tabular-nums">{date(o.nextDue.date)}</div><div className={cn("text-[11px]", o.nextDue.status === "OVERDUE" ? "text-destructive" : "text-muted-foreground")}>{dueLabel(o.nextDue.date)}</div></div><StatusBadge tone={INSTALLMENT_STATUS[o.nextDue.status]?.tone}>{INSTALLMENT_STATUS[o.nextDue.status]?.label}</StatusBadge></div> : <span className="text-muted-foreground">—</span> },
              ]}
              actions={(o) => (
                <>
                  <Button size="icon-sm" variant="ghost" aria-label="Abrir" asChild><Link to={`/financeiro/lancamentos/${o.id}`}><Eye /></Link></Button>
                  {perm.edit && o.status !== "CANCELLED" && <Button size="icon-sm" variant="ghost" aria-label="Editar" asChild><Link to={`/financeiro/lancamentos/${o.id}/editar`}><Pencil /></Link></Button>}
                  <ChevronRight className="hidden size-4 text-muted-foreground md:block" />
                </>
              )}
              mobile={(o) => (
                <>
                  <div className="flex items-start gap-3">
                    <Avatar name={o.vendor?.name ?? o.title} />
                    <Cell2 className="flex-1" title={o.title} sub={[o.vendor?.name, o.category?.name].filter(Boolean).join(" · ")} />
                    <StatusBadge tone={OBLIGATION_STATUS[o.status]?.tone}>{OBLIGATION_STATUS[o.status]?.label}</StatusBadge>
                  </div>
                  <div className="mt-3 flex items-end justify-between">
                    <div><div className="text-[11px] text-muted-foreground">Valor</div><Money value={value(o)} size="md" /></div>
                    <div className="text-right"><div className="text-[11px] text-muted-foreground">Em aberto</div><Money value={o.open} size="md" className={cn(o.overdue > 0 && "text-destructive")} /></div>
                  </div>
                  <Bar value={paidPct(o)} className="mt-3" />
                  {o.nextDue && <div className="mt-2 text-xs text-muted-foreground">Próximo: {date(o.nextDue.date)} ({dueLabel(o.nextDue.date)})</div>}
                </>
              )}
            />
          </>
        )}
      </QueryState>
    </FinanceShell>
  );
}
