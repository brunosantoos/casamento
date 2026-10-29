import { ArrowLeft, Trophy } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { EmptyState, PageHeader, QueryState, StatusBadge } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { date, money } from "@/lib/format";
import { CONTRACT_STATUS, QUOTE_STATUS, VENDOR_STATUS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc";

export function VendorComparePage() {
  const [params] = useSearchParams();
  const ids = (params.get("ids") ?? "").split(",").filter(Boolean).slice(0, 6);
  const q = trpc.vendors.compare.useQuery({ ids }, { enabled: ids.length >= 2 });
  const back = <Link to="/fornecedores" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Fornecedores</Link>;
  if (ids.length < 2) {
    return <>{back}<EmptyState icon={<Trophy />} title="Selecione ao menos 2 fornecedores" description="Marque os fornecedores na lista e clique em Comparar." action={<Button asChild><Link to="/fornecedores">Ir para a lista</Link></Button>} /></>;
  }
  return (
    <>
      {back}
      <PageHeader title="Comparar fornecedores" description="Última proposta de cada fornecedor, lado a lado. O menor valor fica destacado." />
      <QueryState query={q}>
        {(vendors) => {
          const latest = vendors.map((v) => v.quotes[0] ?? null);
          const prices = latest.map((l) => (l && l.totalCents > 0 ? l.totalCents : null));
          const min = Math.min(...prices.filter((p): p is number => p != null));
          const rows: { label: string; cell: (i: number) => ReactNode }[] = [
            { label: "Categoria", cell: (i) => vendors[i]!.category?.name ?? "—" },
            { label: "Status", cell: (i) => <StatusBadge tone={VENDOR_STATUS[vendors[i]!.status]?.tone}>{VENDOR_STATUS[vendors[i]!.status]?.label}</StatusBadge> },
            { label: "Avaliação", cell: (i) => (vendors[i]!.rating ? `${vendors[i]!.rating}/5` : "—") },
            {
              label: "Última proposta",
              cell: (i) => {
                const l = latest[i];
                if (!l) return <span className="text-muted-foreground">Sem orçamento</span>;
                return (
                  <div>
                    <div className={cn("text-lg font-semibold tabular-nums", prices[i] === min && "text-emerald-600 dark:text-emerald-400")}>{money(l.totalCents)} {prices[i] === min && <Trophy className="inline size-4" />}</div>
                    <div className="text-xs text-muted-foreground">{l.title} · <StatusBadge tone={QUOTE_STATUS[l.status]?.tone}>{QUOTE_STATUS[l.status]?.label}</StatusBadge></div>
                    {l.validUntil && <div className="text-xs text-muted-foreground">Válida até {date(l.validUntil)}</div>}
                  </div>
                );
              },
            },
            { label: "Itens", cell: (i) => latest[i]?.items.length ? <ul className="space-y-0.5 text-xs">{latest[i]!.items.map((it) => <li key={it.id}>{String(it.quantity)} × {it.description} — {money(Math.round(it.unitCents * Number(it.quantity)))}</li>)}</ul> : "—" },
            { label: "Serviços incluídos", cell: (i) => latest[i]?.includedServices ?? "—" },
            { label: "Condições de pagamento", cell: (i) => latest[i]?.paymentTerms ?? "—" },
            { label: "Taxas extras", cell: (i) => latest[i]?.extraFees ?? "—" },
            { label: "Multa / cancelamento", cell: (i) => latest[i]?.cancellationPenalty ?? vendors[i]!.contracts.find((c) => c.cancellationPolicy)?.cancellationPolicy ?? "—" },
            { label: "Disponibilidade", cell: (i) => latest[i]?.availability ?? "—" },
            { label: "Outras propostas", cell: (i) => (vendors[i]!.quotes.length > 1 ? vendors[i]!.quotes.slice(1).map((q) => `${q.title}: ${money(q.totalCents)}`).join(" · ") : "—") },
            { label: "Contratos", cell: (i) => vendors[i]!.contracts.length ? vendors[i]!.contracts.map((c) => <div key={c.title} className="text-xs">{c.title} <StatusBadge tone={CONTRACT_STATUS[c.status]?.tone}>{CONTRACT_STATUS[c.status]?.label}</StatusBadge></div>) : "—" },
          ];
          return (
            <div className="overflow-x-auto rounded-xl border bg-card shadow-soft">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="sticky left-0 w-44 bg-card p-3 text-left font-medium text-muted-foreground" />
                    {vendors.map((v) => <th key={v.id} className="p-3 text-left align-bottom"><Link to={`/fornecedores/${v.id}`} className="font-heading text-lg font-semibold hover:text-primary">{v.name}</Link></th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.label} className="border-b last:border-0">
                      <th className="sticky left-0 bg-card p-3 text-left align-top font-medium text-muted-foreground">{r.label}</th>
                      {vendors.map((v, i) => <td key={v.id} className="p-3 align-top whitespace-pre-line">{r.cell(i)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }}
      </QueryState>
    </>
  );
}
