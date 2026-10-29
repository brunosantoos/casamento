import { ArrowDownToLine, Ban, Gift, HandCoins, Landmark, Pencil, PiggyBank, Plus, RotateCcw, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, QueryState, StatusBadge } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { date, toDateInput } from "@/lib/format";
import { INCOME_KIND, INCOME_STATUS, PAYMENT_METHOD } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { trpc, type RouterOutputs } from "@/trpc";
import { Cell2, DataTable, emptyIncome, FilterBar, FinanceShell, IncomeDialog, Metric, Money, NativeSelect, opts, ReasonDialog, useCanFinance, type IncomeForm } from "./shared";

type Row = RouterOutputs["finance"]["incomes"][number];
const KIND_ICON: Record<string, typeof Gift> = { GIFT_CASH: Gift, FAMILY: Users, THIRD_PARTY: HandCoins, DEPOSIT_REFUND: Landmark, REFUND: RotateCcw, CHARGEBACK: RotateCcw, OTHER: ArrowDownToLine };

export function IncomesPage() {
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [editing, setEditing] = useState<IncomeForm | null>(null);
  const [cancel, setCancel] = useState<string | null>(null);
  const perm = useCanFinance();
  const utils = trpc.useUtils();
  const q = trpc.finance.incomes.useQuery({ status: (status || undefined) as never, kind: kind || undefined });
  const all = trpc.finance.incomes.useQuery();
  const cancelM = trpc.finance.cancelIncome.useMutation({ onSuccess: async () => { toast.success("Entrada cancelada"); setCancel(null); await utils.finance.invalidate(); }, onError: (e) => toast.error(e.message) });
  const sum = (s: string[]) => (all.data ?? []).filter((i) => s.includes(i.status)).reduce((a, i) => a + i.amountCents, 0);
  const toForm = (i: Row): IncomeForm => ({
    id: i.id, kind: i.kind, status: i.status, description: i.description, source: i.source ?? "", categoryId: i.categoryId ?? "", amountCents: i.amountCents,
    expectedDate: toDateInput(i.expectedDate), receivedAt: toDateInput(i.receivedAt), method: i.method ?? "", depositItemId: i.depositItemId ?? "", notes: i.notes ?? "", walletId: i.wallet?.id ?? "",
  });

  return (
    <FinanceShell title="Entradas" description="Presentes em dinheiro, contribuições, reembolsos e devoluções de caução." actions={perm.create && <Button onClick={() => setEditing(emptyIncome())}><Plus /> Nova entrada</Button>}>
      <div className="stagger mb-5 grid gap-3 sm:grid-cols-3">
        <Metric label="Recebido" value={sum(["RECEIVED"])} tone="success" icon={<ArrowDownToLine />} hint="Conta no saldo real" size="xl" />
        <Metric label="Previsto" value={sum(["EXPECTED"])} tone="info" icon={<PiggyBank />} hint="Só entra na projeção" size="xl" />
        <Metric label="Prometido" value={sum(["PROMISED"])} tone="neutral" icon={<HandCoins />} hint="Não é dinheiro disponível" size="xl" />
      </div>
      <FilterBar>
        <div className="flex flex-wrap rounded-lg border bg-card p-0.5">
          {[{ value: "", label: "Todas" }, ...opts(INCOME_STATUS)].map((o) => (
            <button key={o.value} onClick={() => setStatus(o.value)} className={cn("rounded-md px-3 py-1.5 text-xs font-medium transition", status === o.value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>{o.label}</button>
          ))}
        </div>
        <NativeSelect className="w-auto min-w-44" value={kind} onChange={setKind} placeholder="Todos os tipos" options={opts(INCOME_KIND)} />
      </FilterBar>
      <QueryState query={q} empty={(d) => (d.length ? null : <EmptyState icon={<PiggyBank />} title="Nenhuma entrada" description="Registre contribuições da família, presentes em dinheiro e devoluções." action={perm.create && <Button onClick={() => setEditing(emptyIncome())}><Plus /> Nova entrada</Button>} />)}>
        {(rows) => (
          <>
            <DataTable<Row>
              rows={rows}
              rowKey={(i) => i.id}
              initialSort={{ key: "date", dir: -1 }}
              onRowClick={perm.edit ? (i) => i.status !== "CANCELLED" && setEditing(toForm(i)) : undefined}
              rowClassName={(i) => i.status === "CANCELLED" && "text-muted-foreground"}
              leading={(i) => { const I = KIND_ICON[i.kind] ?? ArrowDownToLine; return <span className={cn("grid size-9 place-items-center rounded-lg transition group-hover:scale-105", i.status === "RECEIVED" ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300" : "bg-muted text-muted-foreground")}><I className="size-4" /></span>; }}
              columns={[
                { key: "desc", header: "Descrição", sort: (i) => i.description.toLowerCase(), cell: (i) => <Cell2 title={<span className={cn(i.status === "CANCELLED" && "line-through")}>{i.description}</span>} sub={[INCOME_KIND[i.kind], i.source, i.category?.name, i.depositItem ? `Caução: ${i.depositItem.description} (${i.depositItem.obligation.title})` : null, i.method ? PAYMENT_METHOD[i.method] : null].filter(Boolean).join(" · ")} />, footer: "Total" },
                { key: "status", header: "Situação", sort: (i) => i.status, cell: (i) => <StatusBadge tone={INCOME_STATUS[i.status]?.tone}>{INCOME_STATUS[i.status]?.label}</StatusBadge> },
                { key: "date", header: "Data", sort: (i) => new Date(i.receivedAt ?? i.expectedDate ?? 0).getTime(), cell: (i) => <span className="text-sm tabular-nums">{i.receivedAt ? date(i.receivedAt) : i.expectedDate ? <span className="text-muted-foreground">prev. {date(i.expectedDate)}</span> : "—"}</span> },
                { key: "wallet", header: "Carteira", sort: (i) => i.wallet?.name ?? "", cell: (i) => (i.wallet ? <span className="text-sm">{i.wallet.name}</span> : <span className="text-xs text-muted-foreground">—</span>) },
                { key: "amount", header: "Valor", align: "right", sort: (i) => i.amountCents, cell: (i) => <Money value={i.amountCents} size="sm" className={cn(i.status === "CANCELLED" && "line-through opacity-60", i.status === "RECEIVED" && "text-emerald-600 dark:text-emerald-400")} />, footer: <Money value={rows.filter((i) => i.status !== "CANCELLED").reduce((a, i) => a + i.amountCents, 0)} size="sm" /> },
              ]}
              actions={perm.edit ? (i) => i.status !== "CANCELLED" && (
                <>
                  <Button size="icon-sm" variant="ghost" aria-label="Editar" onClick={() => setEditing(toForm(i))}><Pencil /></Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Cancelar" onClick={() => setCancel(i.id)}><Ban /></Button>
                </>
              ) : undefined}
              mobile={(i) => (
                <>
                  <div className="flex items-center gap-3">
                    <Cell2 className="flex-1" title={i.description} sub={INCOME_KIND[i.kind]} />
                    <Money value={i.amountCents} size="md" />
                  </div>
                  <div className="mt-2"><StatusBadge tone={INCOME_STATUS[i.status]?.tone}>{INCOME_STATUS[i.status]?.label}</StatusBadge></div>
                </>
              )}
            />
          </>
        )}
      </QueryState>
      {editing && <IncomeDialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)} initial={editing} />}
      <ReasonDialog open={!!cancel} onOpenChange={(v) => !v && setCancel(null)} title="Cancelar entrada" confirmLabel="Cancelar entrada" loading={cancelM.isPending} onConfirm={(reason) => cancel && cancelM.mutate({ id: cancel, reason })} />
    </FinanceShell>
  );
}
