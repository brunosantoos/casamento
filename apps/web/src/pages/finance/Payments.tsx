import { Banknote, CreditCard, Download, FileText, Landmark, QrCode, Receipt, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { EmptyState, QueryState } from "@/components/app/common";
import { useOpenFile } from "@/components/app/files";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { date, fromDateInput } from "@/lib/format";
import { PAYMENT_METHOD } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { trpc, type RouterOutputs } from "@/trpc";
import { Cell2, DataTable, FilterBar, FinanceShell, Money, ReasonDialog, SummaryStrip, useCanFinance } from "./shared";

type Row = RouterOutputs["finance"]["payments"][number];

export const METHOD_ICON: Record<string, typeof Banknote> = { PIX: QrCode, CASH: Banknote, CREDIT_CARD: CreditCard, DEBIT_CARD: CreditCard, BANK_TRANSFER: Landmark, BOLETO: FileText, CHECK: FileText, OTHER: Receipt };

export function PaymentsPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [show, setShow] = useState("all");
  const [reverse, setReverse] = useState<string | null>(null);
  const perm = useCanFinance();
  const open = useOpenFile();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const toDate = to ? new Date(`${to}T23:59:59`) : undefined;
  const q = trpc.finance.payments.useQuery({ from: fromDateInput(from) ?? undefined, to: toDate, includeReversed: show !== "valid" ? undefined : false });
  const rev = trpc.finance.reversePayment.useMutation({ onSuccess: async () => { toast.success("Pagamento estornado"); setReverse(null); await utils.finance.invalidate(); }, onError: (e) => toast.error(e.message) });
  const rows = (q.data ?? []).filter((p) => show !== "reversed" || p.reversedAt);
  const valid = rows.filter((p) => !p.reversedAt);
  const reversed = rows.filter((p) => p.reversedAt).reduce((a, p) => a + p.amountCents, 0);
  const titles = (p: (typeof rows)[number]) => [...new Map(p.allocations.map((a) => [a.installment.obligation.id, a.installment.obligation])).values()];

  return (
    <FinanceShell title="Pagamentos realizados" description="Liquidações registradas. Estornos permanecem no histórico, riscados.">
      <FilterBar>
        <div className="flex items-center gap-1.5 rounded-lg border bg-card px-2 py-0.5 text-xs text-muted-foreground">
          De <Input type="date" className="h-8 w-36 border-0 bg-transparent px-1 shadow-none" value={from} onChange={(e) => setFrom(e.target.value)} />
          até <Input type="date" className="h-8 w-36 border-0 bg-transparent px-1 shadow-none" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="flex rounded-lg border bg-card p-0.5">
          {[["all", "Todos"], ["valid", "Válidos"], ["reversed", "Estornados"]].map(([v, l]) => (
            <button key={v} onClick={() => setShow(v!)} className={cn("rounded-md px-3 py-1.5 text-xs font-medium transition", show === v ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>{l}</button>
          ))}
        </div>
        {(from || to) && <Button variant="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); }}>Limpar período</Button>}
      </FilterBar>
      <QueryState query={q} empty={() => (rows.length ? null : <EmptyState icon={<Receipt />} title="Nenhum pagamento no período" description="Registre pagamentos em Contas a pagar ou no detalhe do lançamento." />)}>
        {() => (
          <>
            <SummaryStrip items={[{ label: `Pago · ${valid.length} pagamento(s)`, value: valid.reduce((a, p) => a + p.amountCents, 0), tone: "success" }, { label: "Estornado", value: reversed, tone: "muted" }]} />
            <DataTable<Row>
              rows={rows}
              rowKey={(p) => p.id}
              initialSort={{ key: "date", dir: -1 }}
              onRowClick={(p) => { const o = titles(p)[0]; if (o) navigate(`/financeiro/lancamentos/${o.id}`); }}
              rowClassName={(p) => !!p.reversedAt && "text-muted-foreground"}
              leading={(p) => { const I = METHOD_ICON[p.method] ?? Receipt; return <span className={cn("grid size-9 place-items-center rounded-full", p.reversedAt ? "bg-muted text-muted-foreground" : "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300")}><I className="size-4" /></span>; }}
              columns={[
                { key: "title", header: "Lançamentos", sort: (p) => titles(p)[0]?.title.toLowerCase() ?? "", cell: (p) => <Cell2 title={<span className={cn(p.reversedAt && "line-through")}>{titles(p).map((o) => o.title).join(", ")}</span>} sub={p.reversedAt ? <span className="text-rose-600">Estornado: {p.reversalReason}</span> : [...new Set(titles(p).map((o) => o.vendor?.name).filter(Boolean))].join(", ") || "—"} />, footer: "Total válido" },
                { key: "date", header: "Data", sort: (p) => new Date(p.paidAt).getTime(), cell: (p) => <span className={cn("tabular-nums", p.reversedAt && "line-through")}>{date(p.paidAt)}</span> },
                { key: "method", header: "Forma", sort: (p) => p.method, cell: (p) => <span className="text-sm">{PAYMENT_METHOD[p.method]}</span> },
                { key: "wallet", header: "Carteira", sort: (p) => p.wallet?.name ?? "", cell: (p) => (p.wallet ? <span className="text-sm">{p.wallet.name}</span> : <span className="text-xs text-muted-foreground">—</span>) },
                { key: "ref", header: "Referência", cell: (p) => <span className="text-sm text-muted-foreground">{p.reference ?? "—"}</span> },
                { key: "amount", header: "Valor", align: "right", sort: (p) => p.amountCents, cell: (p) => <Money value={p.amountCents} size="sm" className={cn(p.reversedAt && "line-through opacity-60")} />, footer: <Money value={valid.reduce((a, p) => a + p.amountCents, 0)} size="sm" /> },
              ]}
              actions={(p) => (
                <>
                  {p.receiptFileId && <Button size="icon-sm" variant="ghost" aria-label="Comprovante" onClick={() => open(p.receiptFileId!)}><Download /></Button>}
                  {!p.reversedAt && perm.approve && <Button size="sm" variant="ghost" onClick={() => setReverse(p.id)}><RotateCcw /> Estornar</Button>}
                </>
              )}
              mobile={(p) => (
                <div className={cn("flex items-center gap-3", p.reversedAt && "opacity-60")}>
                  <Cell2 className="flex-1" title={titles(p).map((o) => o.title).join(", ")} sub={<span className={cn(p.reversedAt && "line-through")}>{date(p.paidAt)} · {PAYMENT_METHOD[p.method]}</span>} />
                  <Money value={p.amountCents} size="md" className={cn(p.reversedAt && "line-through")} />
                </div>
              )}
            />
          </>
        )}
      </QueryState>
      <ReasonDialog open={!!reverse} onOpenChange={(v) => !v && setReverse(null)} title="Estornar pagamento" description="O pagamento deixa de contar em todas as parcelas que cobre. O registro permanece no histórico." confirmLabel="Estornar" loading={rev.isPending} onConfirm={(reason) => reverse && rev.mutate({ id: reverse, reason })} />
    </FinanceShell>
  );
}
