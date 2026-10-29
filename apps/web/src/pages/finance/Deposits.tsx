import { Landmark, ShieldCheck, Undo2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { EmptyState, QueryState, StatusBadge } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { toDateInput } from "@/lib/format";
import { cn } from "@/lib/utils";
import { trpc, type RouterOutputs } from "@/trpc";
import { Avatar, Bar, Cell2, DataTable, emptyIncome, FinanceShell, ForfeitDialog, IncomeDialog, Metric, Money, useCanFinance } from "./shared";

type Row = RouterOutputs["finance"]["deposits"][number];

export function DepositsPage() {
  const q = trpc.finance.deposits.useQuery();
  const perm = useCanFinance();
  const navigate = useNavigate();
  const [refund, setRefund] = useState<{ itemId: string; pending: number; label: string } | null>(null);
  const [forfeit, setForfeit] = useState<{ itemId: string; description: string; paid: number; forfeited: number } | null>(null);
  const rows = q.data ?? [];
  const t = (k: "paid" | "refunded" | "forfeited" | "pending") => rows.reduce((a, r) => a + r[k], 0);
  const recovered = (r: Row) => (r.paid ? ((r.refunded + r.forfeited) / r.paid) * 100 : 0);

  return (
    <FinanceShell title="Cauções" description="Valores reembolsáveis — não são despesa definitiva. Acompanhe o que foi pago, devolvido, retido e o que falta recuperar.">
      <QueryState query={q} empty={(d) => (d.length ? null : <EmptyState icon={<Landmark />} title="Nenhuma caução" description="Ao cadastrar um lançamento, use o tipo de item “Caução” para valores reembolsáveis." />)}>
        {() => (
          <>
            <div className="stagger mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Metric label="Pago em cauções" value={t("paid")} icon={<Landmark />} />
              <Metric label="Devolvido" value={t("refunded")} tone="success" icon={<Undo2 />} />
              <Metric label="Retido" value={t("forfeited")} tone={t("forfeited") ? "danger" : "neutral"} hint="vira gasto não reembolsável" />
              <Metric label="A recuperar" value={t("pending")} tone="warning" icon={<ShieldCheck />} />
            </div>
            <DataTable<Row>
              rows={rows}
              rowKey={(d) => d.itemId}
              onRowClick={(d) => navigate(`/financeiro/lancamentos/${d.obligationId}`)}
              initialSort={{ key: "pending", dir: -1 }}
              leading={(d) => <Avatar name={d.vendor ?? d.obligationTitle} />}
              columns={[
                { key: "desc", header: "Caução", sort: (d) => d.description.toLowerCase(), cell: (d) => <Cell2 title={d.description} sub={`${d.obligationTitle}${d.vendor ? ` · ${d.vendor}` : ""}${d.itemStatus === "CANCELLED" ? " · item cancelado" : ""}`} />, footer: "Total" },
                { key: "contracted", header: "Contratado", align: "right", sort: (d) => d.contracted, cell: (d) => <Money value={d.contracted} size="sm" className="font-medium text-muted-foreground" /> },
                { key: "paid", header: "Pago", align: "right", sort: (d) => d.paid, cell: (d) => <Money value={d.paid} size="sm" />, footer: <Money value={t("paid")} size="sm" /> },
                { key: "back", header: "Recuperação", className: "w-48", cell: (d) => <div><div className="flex items-center gap-2"><Bar value={recovered(d)} /><span className="w-9 text-right text-[11px] text-muted-foreground tabular-nums">{Math.round(recovered(d))}%</span></div><div className="mt-0.5 text-[11px] text-muted-foreground">devolvido {d.refunded ? <Money value={d.refunded} size="sm" className="text-[11px]" /> : "—"}{d.forfeited ? <> · retido <Money value={d.forfeited} size="sm" className="text-[11px] text-destructive" /></> : null}</div></div> },
                { key: "pending", header: "A recuperar", align: "right", sort: (d) => d.pending, cell: (d) => (d.pending === 0 && d.paid > 0 ? <StatusBadge tone="emerald">quitada</StatusBadge> : <Money value={d.pending} size="sm" className={cn(d.pending > 0 && "text-amber-600 dark:text-amber-400")} />), footer: <Money value={t("pending")} size="sm" /> },
              ]}
              actions={(d) => (
                <>
                  {perm.create && d.pending > 0 && <Button size="xs" variant="outline" onClick={() => setRefund({ itemId: d.itemId, pending: d.pending, label: `${d.description} — ${d.obligationTitle}` })}>Devolução</Button>}
                  {perm.approve && d.paid > 0 && <Button size="xs" variant="ghost" onClick={() => setForfeit({ itemId: d.itemId, description: d.description, paid: d.paid, forfeited: d.forfeited })}>Retenção</Button>}
                </>
              )}
              mobile={(d) => (
                <>
                  <div className="flex items-start gap-3"><Cell2 className="flex-1" title={d.description} sub={d.obligationTitle} /><Money value={d.pending} size="md" className={cn(d.pending > 0 && "text-amber-600")} /></div>
                  <Bar value={recovered(d)} className="mt-2" />
                </>
              )}
            />
          </>
        )}
      </QueryState>
      <IncomeDialog open={!!refund} onOpenChange={(v) => !v && setRefund(null)} lockDeposit initial={emptyIncome({ kind: "DEPOSIT_REFUND", status: "RECEIVED", depositItemId: refund?.itemId ?? "", amountCents: refund?.pending ?? null, receivedAt: toDateInput(new Date()), description: `Devolução de caução — ${refund?.label ?? ""}` })} />
      <ForfeitDialog open={!!forfeit} onOpenChange={(v) => !v && setForfeit(null)} deposit={forfeit} />
    </FinanceShell>
  );
}
