import { ArrowDownToLine, ArrowUpFromLine, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { useSearchParams } from "react-router";
import { Area, Bar as RBar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { QueryState } from "@/components/app/common";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { trpc, type RouterOutputs } from "@/trpc";
import { compactBRL, DataTable, FinanceShell, Metric, Money, NativeSelect } from "./shared";

type Row = RouterOutputs["finance"]["cashflow"]["rows"][number];

const monthLabel = (k: string, long = false) => {
  const [y, m] = k.split("-").map(Number);
  return new Date(y!, m! - 1, 1).toLocaleDateString("pt-BR", long ? { month: "long", year: "numeric" } : { month: "short", year: "2-digit" }).replace(".", "");
};

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string; dataKey: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-48 rounded-lg border bg-popover/95 p-3 text-xs shadow-soft backdrop-blur">
      <div className="mb-2 font-semibold capitalize">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-muted-foreground"><span className="size-2 rounded-full" style={{ background: p.color }} />{p.name}</span>
          <span className="font-medium tabular-nums">{money(Math.abs(p.value))}</span>
        </div>
      ))}
    </div>
  );
}

export function CashflowPage() {
  const [params, setParams] = useSearchParams();
  const months = Number(params.get("meses") ?? 12);
  const scenarioId = params.get("cenario") ?? "";
  const scenarios = trpc.finance.scenarios.useQuery();
  const q = trpc.finance.cashflow.useQuery({ months, scenarioId: scenarioId || null });
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };
  return (
    <FinanceShell title="Fluxo de caixa" description="Saídas = saldo das parcelas por vencimento (vencidas entram no mês atual). Entradas = previstas/prometidas pela data esperada. Tudo aqui é PREVISÃO a partir do saldo real.">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border bg-card p-0.5">
          {[6, 12, 18, 24, 36].map((m) => (
            <button key={m} onClick={() => set("meses", String(m))} className={cn("rounded-md px-3 py-1.5 text-xs font-medium transition", months === m ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{m} meses</button>
          ))}
        </div>
        <NativeSelect className="w-auto min-w-56" value={scenarioId} onChange={(v) => set("cenario", v)} placeholder="Sem simulação" options={(scenarios.data ?? []).map((s) => ({ value: s.id, label: `Simular: ${s.name}` }))} />
      </div>
      <QueryState query={q}>
        {(d) => {
          const data = d.rows.map((r) => ({ ...r, label: monthLabel(r.month), outflowNeg: -r.outflow }));
          const end = d.rows.at(-1);
          const lowest = d.rows.reduce((m, r) => (r.projectedBalance < m.projectedBalance ? r : m), d.rows[0] ?? ({ projectedBalance: d.startBalance, month: "" } as Row));
          const inflow = d.rows.reduce((a, r) => a + r.inflow, 0);
          const outflow = d.rows.reduce((a, r) => a + r.outflow, 0);
          const negative = d.rows.some((r) => r.projectedBalance < 0);
          return (
            <div className="space-y-5">
              <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Metric label="Saldo real hoje" value={d.startBalance} icon={<Wallet />} tone="success" hint="ponto de partida · não é previsão" />
                <Metric label={`Projetado em ${end ? monthLabel(end.month) : "—"}`} value={end?.projectedBalance ?? d.startBalance} icon={(end?.projectedBalance ?? 0) < 0 ? <TrendingDown /> : <TrendingUp />} tone={(end?.projectedBalance ?? 0) < 0 ? "danger" : "info"} hint="previsão" />
                <Metric label="Entradas previstas" value={inflow} icon={<ArrowDownToLine />} hint={`no período de ${months} meses`} />
                <Metric label="Saídas previstas" value={outflow} icon={<ArrowUpFromLine />} hint={lowest.month ? `menor saldo: ${money(lowest.projectedBalance)} em ${monthLabel(lowest.month)}` : undefined} tone={negative ? "danger" : "neutral"} />
              </div>
              {d.scenario && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-violet-500/40 bg-violet-500/5 px-4 py-3 text-sm">
                  <span className="size-2 rounded-full bg-[var(--chart-3)]" />
                  Simulação <b>“{d.scenario.name}”</b>: {money(d.scenario.total)} em gastos hipotéticos — saldo final <Money value={end?.projectedWithSimulation ?? 0} size="sm" />. Não afeta os totais reais.
                </div>
              )}

              <section className="rounded-xl border bg-card p-5 shadow-soft">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-base font-semibold">Saldo projetado <span className="rounded-full bg-sky-500/12 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-sky-600 uppercase dark:text-sky-300">previsão</span></h2>
                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-[var(--primary)]" />Saldo</span>
                    <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-emerald-500/70" />Entradas</span>
                    <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-[var(--chart-5)]" />Saídas</span>
                    {d.scenario && <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 border-t-2 border-dashed border-[var(--chart-3)]" />Com simulação</span>}
                  </div>
                </div>
                <div className="h-[340px] w-full">
                  <ResponsiveContainer>
                    <ComposedChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                      <defs>
                        <linearGradient id="cf-balance" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={compactBRL} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} width={72} axisLine={false} tickLine={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: "color-mix(in oklch, var(--muted) 60%, transparent)" }} />
                      <ReferenceLine y={0} stroke="var(--destructive)" strokeOpacity={0.6} strokeDasharray="4 4" />
                      <RBar dataKey="inflow" name="Entradas previstas" fill="oklch(0.7 0.15 155 / .7)" radius={[4, 4, 0, 0]} maxBarSize={22} />
                      <RBar dataKey="outflowNeg" name="Saídas previstas" fill="var(--chart-5)" fillOpacity={0.75} radius={[0, 0, 4, 4]} maxBarSize={22} />
                      <Area type="monotone" dataKey="projectedBalance" name="Saldo projetado" stroke="var(--primary)" strokeWidth={2.5} fill="url(#cf-balance)" dot={{ r: 2.5, fill: "var(--primary)" }} activeDot={{ r: 5 }} />
                      {d.scenario && <Line type="monotone" dataKey="projectedWithSimulation" name="Com simulação" stroke="var(--chart-3)" strokeDasharray="6 4" strokeWidth={2} dot={false} />}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <DataTable<Row>
                rows={d.rows}
                rowKey={(r) => r.month}
                columns={[
                  { key: "month", header: "Mês", cell: (r) => <span className="font-medium capitalize">{monthLabel(r.month, true)}</span>, footer: "Período" },
                  { key: "in", header: "Entradas", align: "right", cell: (r) => (r.inflow ? <Money value={r.inflow} size="sm" className="text-emerald-600 dark:text-emerald-400" signed /> : <span className="text-muted-foreground">—</span>), footer: <Money value={inflow} size="sm" /> },
                  { key: "out", header: "Saídas", align: "right", cell: (r) => (r.outflow ? <Money value={-r.outflow} size="sm" muted /> : <span className="text-muted-foreground">—</span>), footer: <Money value={-outflow} size="sm" muted /> },
                  ...(d.scenario ? [{ key: "sim", header: "Simulado", align: "right" as const, cell: (r: Row) => (r.simulated ? <Money value={-r.simulated} size="sm" muted className="text-violet-600" /> : <span className="text-muted-foreground">—</span>) }] : []),
                  { key: "bal", header: "Saldo projetado", align: "right", cell: (r) => <Money value={r.projectedBalance} size="sm" className={cn(r.projectedBalance >= 0 && "text-foreground")} />, footer: <Money value={end?.projectedBalance ?? 0} size="sm" /> },
                  ...(d.scenario ? [{ key: "bsim", header: "Com simulação", align: "right" as const, cell: (r: Row) => <Money value={r.projectedWithSimulation} size="sm" /> }] : []),
                ]}
                rowClassName={(r) => r.projectedBalance < 0 && "[&>td]:!bg-destructive/5"}
                mobile={(r) => (
                  <div className="flex items-center justify-between gap-2">
                    <div><div className="font-medium capitalize">{monthLabel(r.month, true)}</div><div className="text-xs text-muted-foreground">+{money(r.inflow)} · −{money(r.outflow)}</div></div>
                    <Money value={r.projectedBalance} size="md" />
                  </div>
                )}
              />
            </div>
          );
        }}
      </QueryState>
    </FinanceShell>
  );
}
