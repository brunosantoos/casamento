import { CalendarCheck, Plus, Wallet, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { EmptyState, QueryState, StatusBadge } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { date, money } from "@/lib/format";
import { INSTALLMENT_STATUS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { trpc, type RouterOutputs } from "@/trpc";
import { Avatar, Cell2, DataTable, dueLabel, FilterBar, FinanceShell, Money, NativeSelect, PaymentDialog, QuickBillDialog, SummaryStrip, useCanFinance } from "./shared";

type Row = RouterOutputs["finance"]["openInstallments"][number];

const WINDOWS = [
  { value: "", label: "Tudo" },
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
];

export function PayablesPage() {
  const [newBill, setNewBill] = useState(false);
  const [params, setParams] = useSearchParams();
  const onlyOverdue = params.get("vencidas") === "1";
  const [within, setWithin] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [paying, setPaying] = useState(false);
  const perm = useCanFinance();
  const navigate = useNavigate();
  const vendors = trpc.vendors.list.useQuery();
  const q = trpc.finance.openInstallments.useQuery({ onlyOverdue: onlyOverdue || undefined, withinDays: within ? Number(within) : undefined, vendorId: vendorId || undefined });
  const rows = q.data ?? [];
  const totals = useMemo(() => ({ open: rows.reduce((a, r) => a + r.remaining, 0), overdue: rows.filter((r) => r.overdue).reduce((a, r) => a + r.remaining, 0) }), [rows]);
  const selTotal = rows.filter((r) => selected.includes(r.id)).reduce((a, r) => a + r.remaining, 0);
  const payable = rows.map((r) => ({ id: r.id, label: `${r.title} · parcela ${r.number}`, dueDate: r.dueDate, remaining: r.remaining, overdue: r.overdue }));
  const setOverdue = (v: boolean) => {
    const p = new URLSearchParams(params);
    if (v) p.set("vencidas", "1");
    else p.delete("vencidas");
    setParams(p, { replace: true });
  };

  return (
    <FinanceShell
      title="Contas a pagar"
      description="Tudo o que falta pagar. Selecione várias parcelas para um pagamento único."
      actions={perm.create && <Button onClick={() => setNewBill(true)}><Plus /> Nova conta</Button>}
    >
      <QuickBillDialog open={newBill} onOpenChange={setNewBill} />
      <FilterBar>
        <div className="flex rounded-lg border bg-card p-0.5">
          <button onClick={() => setOverdue(false)} className={cn("rounded-md px-3 py-1.5 text-xs font-medium transition", !onlyOverdue ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>Em aberto</button>
          <button onClick={() => setOverdue(true)} className={cn("rounded-md px-3 py-1.5 text-xs font-medium transition", onlyOverdue ? "bg-destructive text-white shadow-sm" : "text-muted-foreground hover:text-foreground")}>Vencidas</button>
        </div>
        <div className="flex rounded-lg border bg-card p-0.5">
          {WINDOWS.map((w) => (
            <button key={w.value} onClick={() => setWithin(w.value)} className={cn("rounded-md px-3 py-1.5 text-xs font-medium transition", within === w.value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>{w.label}</button>
          ))}
        </div>
        <NativeSelect className="w-auto min-w-44" value={vendorId} onChange={setVendorId} placeholder="Todos os fornecedores" options={(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name }))} />
      </FilterBar>
      <QueryState query={q} empty={(d) => (d.length ? null : <EmptyState icon={<CalendarCheck />} title="Nada a pagar com esses filtros" description="Cadastre uma conta (à vista, parcelada ou mensal) ou feche uma contratação para as parcelas aparecerem aqui." action={perm.create && <Button onClick={() => setNewBill(true)}><Plus /> Nova conta a pagar</Button>} />)}>
        {() => (
          <>
            <SummaryStrip items={[{ label: "Em aberto (filtro)", value: totals.open }, { label: "Vencido", value: totals.overdue, tone: "danger" }, { label: `${rows.length} parcela(s)`, value: rows.length ? Math.round(totals.open / rows.length) : 0, tone: "muted" }]} />
            <DataTable<Row>
              rows={rows}
              rowKey={(r) => r.id}
              onRowClick={(r) => navigate(`/financeiro/lancamentos/${r.obligationId}`)}
              selection={perm.create ? { selected, onChange: setSelected } : undefined}
              initialSort={{ key: "due", dir: 1 }}
              leading={(r) => <Avatar name={r.vendor ?? r.title} className="size-8" />}
              columns={[
                { key: "title", header: "Lançamento", sort: (r) => r.title.toLowerCase(), cell: (r) => <Cell2 title={r.title} sub={`Parcela ${r.number}${r.vendor ? ` · ${r.vendor}` : ""}`} />, footer: "Total" },
                { key: "due", header: "Vencimento", sort: (r) => new Date(r.dueDate).getTime(), cell: (r) => <div><div className={cn("tabular-nums", r.overdue && "font-medium text-destructive")}>{date(r.dueDate)}</div><div className={cn("text-[11px]", r.overdue ? "text-destructive" : "text-muted-foreground")}>{dueLabel(r.dueDate)}</div></div> },
                { key: "amount", header: "Valor", align: "right", sort: (r) => r.amountCents, cell: (r) => <Money value={r.amountCents} size="sm" className="font-medium text-muted-foreground" /> },
                { key: "paid", header: "Pago", align: "right", sort: (r) => r.paidCents, cell: (r) => <Money value={r.paidCents} size="sm" className="font-medium text-muted-foreground" /> },
                { key: "remaining", header: "Saldo", align: "right", sort: (r) => r.remaining, cell: (r) => <Money value={r.remaining} size="sm" />, footer: <Money value={totals.open} size="sm" /> },
                { key: "status", header: "Status", sort: (r) => r.status, cell: (r) => <StatusBadge tone={INSTALLMENT_STATUS[r.status]?.tone}>{INSTALLMENT_STATUS[r.status]?.label}</StatusBadge> },
              ]}
              actions={perm.create ? (r) => <Button size="xs" variant="outline" onClick={() => { setSelected([r.id]); setPaying(true); }}><Wallet /> Pagar</Button> : undefined}
              mobile={(r) => (
                <div className="flex items-start gap-3">
                  <Cell2 className="flex-1" title={`${r.title} · ${r.number}ª`} sub={<span className={cn(r.overdue && "text-destructive")}>{date(r.dueDate)} · {dueLabel(r.dueDate)}</span>} />
                  <Money value={r.remaining} size="md" />
                </div>
              )}
            />
          </>
        )}
      </QueryState>

      {perm.create && selected.length > 0 && (
        <div className="fixed inset-x-0 bottom-20 z-30 flex justify-center px-4 md:bottom-6 md:pl-[272px]">
          <div className="flex items-center gap-3 rounded-xl border bg-popover/95 p-2 pl-4 shadow-brand backdrop-blur animate-in fade-in slide-in-from-bottom-2">
            <span className="text-sm"><b>{selected.length}</b> selecionada(s) · <span className="font-semibold tabular-nums">{money(selTotal)}</span></span>
            <Button size="sm" onClick={() => setPaying(true)}><Wallet /> Pagar</Button>
            <Button size="icon-sm" variant="ghost" aria-label="Limpar seleção" onClick={() => setSelected([])}><X /></Button>
          </div>
        </div>
      )}
      <PaymentDialog open={paying} onOpenChange={setPaying} installments={payable} preselected={selected} onDone={() => setSelected([])} />
    </FinanceShell>
  );
}
