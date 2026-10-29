import { AlertTriangle, ArrowDownToLine, ArrowRight, Banknote, CalendarClock, CircleCheckBig, Clock, Landmark, Plus, Receipt, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Area, AreaChart, Cell, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { EmptyState, ErrorState, PageLoader } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { date, money, relative } from "@/lib/format";
import { PAYMENT_METHOD } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { trpc, type RouterOutputs } from "@/trpc";
import { Avatar, Bar, BudgetEditor, compactBRL, daysUntil, dueLabel, emptyIncome, FinanceShell, IncomeDialog, Legend, Money, PaymentDialog, QuickBillDialog, Ring, SegmentBar, useCanFinance } from "./shared";

type Summary = RouterOutputs["finance"]["summary"];
type Open = RouterOutputs["finance"]["openInstallments"][number];

const CHART = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "color-mix(in oklch, var(--muted-foreground) 45%, transparent)"];
const monthShort = (k: string) => {
  const [y, m] = k.split("-").map(Number);
  return new Date(y!, m! - 1, 1).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
};

function Hero({ s }: { s: Summary }) {
  const used = Math.max(s.planned, s.contracted);
  const pct = s.budget ? Math.round((used / s.budget) * 100) : 0;
  const remaining = Math.max(0, s.budget - s.paid - s.open);
  return (
    <section className="relative overflow-hidden rounded-xl border bg-card shadow-soft">
      <div className="bg-glow absolute inset-0" />
      <div className="relative grid gap-6 p-5 md:grid-cols-[auto_1fr] md:p-7">
        <div className="flex items-center gap-5 md:flex-col md:items-center">
          <Ring value={pct} size={148} stroke={12} danger={s.overBudget}>
            <div>
              <div className={cn("font-sans text-3xl font-semibold tracking-tight tabular-nums", s.overBudget && "text-destructive")}>{s.budget ? `${pct}%` : "—"}</div>
              <div className="text-[11px] text-muted-foreground">do orçamento</div>
            </div>
          </Ring>
          <div className="md:text-center">
            <div className="text-xs text-muted-foreground">Orçamento</div>
            <BudgetEditor value={s.budget} size="lg" />
            <Link to="/financeiro/categorias" className="mt-1 block text-xs text-primary hover:underline">Distribuir por categoria</Link>
            <div className={cn("text-xs", s.budgetRemaining < 0 ? "text-destructive" : "text-muted-foreground")}>{s.budget ? (s.budgetRemaining < 0 ? `${money(-s.budgetRemaining)} acima` : `${money(s.budgetRemaining)} livre`) : <span>orçamento não definido</span>}</div>
          </div>
        </div>
        <div className="flex min-w-0 flex-col justify-center gap-5">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-xs text-muted-foreground">Contratado</div>
              <Money value={s.contracted} size="xl" className="mt-1 block" />
              <div className="mt-1 text-xs text-muted-foreground">previsto {money(s.planned)}</div>
            </div>
            <div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground"><span className="size-2 rounded-full bg-emerald-500" />Pago</div>
              <Money value={s.paid} size="xl" className="mt-1 block text-emerald-600 dark:text-emerald-400" />
              <div className="mt-1 text-xs text-muted-foreground">gasto efetivo {money(s.effectiveSpent)}</div>
            </div>
            <div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground"><span className="size-2 rounded-full bg-primary" />A pagar</div>
              <Money value={s.open} size="xl" className="mt-1 block" />
              <div className={cn("mt-1 text-xs", s.overdue ? "font-medium text-destructive" : "text-muted-foreground")}>{s.overdue ? `${money(s.overdue)} vencido` : "nada vencido"}</div>
            </div>
          </div>
          <div className="space-y-2">
            <SegmentBar
              total={Math.max(s.budget, s.paid + s.open)}
              segments={[
                { label: "Pago", value: s.paid, className: "bg-emerald-500" },
                { label: "A pagar", value: s.open - s.overdue, className: "bg-primary" },
                { label: "Vencido", value: s.overdue, className: "bg-destructive" },
                { label: "Livre no orçamento", value: remaining, className: "bg-transparent" },
              ]}
            />
            <Legend items={[
              { label: "Pago", value: money(s.paid), className: "bg-emerald-500" },
              { label: "A pagar", value: money(s.open - s.overdue), className: "bg-primary" },
              ...(s.overdue ? [{ label: "Vencido", value: money(s.overdue), className: "bg-destructive" }] : []),
              ...(s.budget ? [{ label: "Livre", value: money(remaining), className: "bg-muted-foreground/30" }] : []),
            ]} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Balances({ s }: { s: Summary }) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {s.walletsTotal != null ? (
        <Link to="/financeiro/carteiras" className="lift group relative overflow-hidden rounded-xl border bg-card p-5 shadow-soft">
          <div className="absolute inset-x-0 top-0 h-1 bg-brand" />
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-muted-foreground">Saldo disponível nas carteiras</span>
            <span className="grid size-8 place-items-center rounded-lg bg-primary/12 text-primary transition group-hover:scale-110"><Wallet className="size-4" /></span>
          </div>
          <Money value={s.walletsTotal} size="2xl" className="mt-3 block" />
          <p className="mt-2 text-xs text-muted-foreground">{s.walletsCount} carteira(s) · debitado a cada pagamento</p>
        </Link>
      ) : (
        <Link to="/financeiro/carteiras" className="lift group flex flex-col justify-center rounded-xl border border-dashed border-primary/40 bg-primary/5 p-5">
          <span className="grid size-9 place-items-center rounded-lg bg-primary/12 text-primary transition group-hover:scale-110"><Wallet className="size-4" /></span>
          <div className="mt-3 font-semibold">Informe quanto vocês têm</div>
          <p className="mt-1 text-xs text-muted-foreground">Cadastre contas e dinheiro guardado — o saldo é debitado a cada pagamento.</p>
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary">Criar carteira <ArrowRight className="size-3 transition group-hover:translate-x-0.5" /></span>
        </Link>
      )}
      <Link to="/financeiro/entradas" className="lift group rounded-xl border bg-card p-5 shadow-soft">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium text-muted-foreground">Saldo real</span>
          <span className="grid size-8 place-items-center rounded-lg bg-emerald-500/12 text-emerald-600 transition group-hover:scale-110 dark:text-emerald-300"><ArrowDownToLine className="size-4" /></span>
        </div>
        <Money value={s.realBalance} size="2xl" className="mt-3 block" />
        <p className="mt-2 text-xs text-muted-foreground">Recebido {money(s.incomeReceived)} − pago {money(s.paid)}</p>
      </Link>
      <Link to="/financeiro/fluxo" className="lift group relative overflow-hidden rounded-xl border border-dashed bg-card p-5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">Saldo projetado <span className="rounded-full bg-sky-500/12 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-sky-600 uppercase dark:text-sky-300">previsão</span></span>
          <span className={cn("grid size-8 place-items-center rounded-lg transition group-hover:scale-110", s.projectedBalance < 0 ? "bg-rose-500/12 text-rose-600" : "bg-sky-500/12 text-sky-600 dark:text-sky-300")}>{s.projectedBalance < 0 ? <TrendingDown className="size-4" /> : <TrendingUp className="size-4" />}</span>
        </div>
        <Money value={s.projectedBalance} size="2xl" className="mt-3 block" />
        <p className="mt-2 text-xs text-muted-foreground">+ {money(s.incomeExpected)} previstos − {money(s.open)} a pagar. Não é dinheiro disponível.</p>
      </Link>
    </div>
  );
}

function AlertsStrip({ s }: { s: Summary }) {
  const over = s.categories.filter((c) => c.overBudget);
  const chips = [
    s.overdue > 0 && { to: "/financeiro/pagar?vencidas=1", tone: "danger", icon: AlertTriangle, text: `${money(s.overdue)} vencido` },
    ...over.slice(0, 3).map((c) => ({ to: `/financeiro/lancamentos?categoria=${c.categoryId}`, tone: "warning", icon: TrendingUp, text: `${c.name} acima do orçamento` })),
    s.unscheduled > 0 && { to: "/financeiro/lancamentos?status=ACTIVE", tone: "warning", icon: Clock, text: `${money(s.unscheduled)} contratado sem parcelas` },
    s.depositPending > 0 && { to: "/financeiro/caucoes", tone: "info", icon: Landmark, text: `${money(s.depositPending)} em cauções a recuperar` },
  ].filter(Boolean) as { to: string; tone: "danger" | "warning" | "info"; icon: typeof AlertTriangle; text: string }[];
  if (!chips.length) return null;
  const tone = { danger: "border-rose-500/30 bg-rose-500/8 text-rose-700 dark:text-rose-300", warning: "border-amber-500/30 bg-amber-500/8 text-amber-800 dark:text-amber-300", info: "border-sky-500/30 bg-sky-500/8 text-sky-800 dark:text-sky-300" };
  return (
    <div className="stagger flex flex-wrap gap-2">
      {chips.map((c) => (
        <Link key={c.text} to={c.to} className={cn("group flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition hover:shadow-soft", tone[c.tone])}>
          <c.icon className="size-3.5" /> {c.text} <ArrowRight className="size-3 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
        </Link>
      ))}
    </div>
  );
}

function Upcoming({ rows, onPay, canPay }: { rows: Open[]; onPay: (ids: string[]) => void; canPay: boolean }) {
  const groups = useMemo(() => {
    const g = new Map<string, Open[]>();
    for (const r of rows) {
      const d = daysUntil(r.dueDate);
      const k = d < 0 ? "Vencidas" : d <= 7 ? "Próximos 7 dias" : d <= 14 ? "Semana seguinte" : "Até 30 dias";
      g.set(k, [...(g.get(k) ?? []), r]);
    }
    return ["Vencidas", "Próximos 7 dias", "Semana seguinte", "Até 30 dias"].filter((k) => g.has(k)).map((k) => ({ k, rows: g.get(k)! }));
  }, [rows]);
  return (
    <section className="rounded-xl border bg-card p-5 shadow-soft">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Próximos vencimentos</h2>
          <p className="text-xs text-muted-foreground">30 dias à frente, incluindo vencidas</p>
        </div>
        <Button asChild variant="ghost" size="sm"><Link to="/financeiro/pagar">Ver tudo <ArrowRight /></Link></Button>
      </div>
      {!rows.length ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground"><CircleCheckBig className="size-6 text-emerald-500" />Nada vencendo nos próximos 30 dias.</div>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.k}>
              <div className={cn("mb-2 text-[11px] font-semibold tracking-wide uppercase", g.k === "Vencidas" ? "text-destructive" : "text-muted-foreground")}>{g.k}</div>
              <ol className="relative space-y-1 border-l pl-4">
                {g.rows.map((r) => (
                  <li key={r.id} className="group relative -ml-px flex items-center gap-3 rounded-lg py-1.5 pr-1 pl-1 transition hover:bg-muted/50">
                    <span className={cn("absolute top-1/2 -left-[21px] size-2.5 -translate-y-1/2 rounded-full ring-4 ring-card", r.overdue ? "bg-destructive" : daysUntil(r.dueDate) <= 7 ? "bg-amber-500" : "bg-primary/60")} />
                    <Avatar name={r.vendor ?? r.title} className="size-8" />
                    <Link to={`/financeiro/lancamentos/${r.obligationId}`} className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{r.title} <span className="font-normal text-muted-foreground">· {r.number}ª</span></div>
                      <div className="text-xs text-muted-foreground">{date(r.dueDate)} · <span className={cn(r.overdue && "font-medium text-destructive")}>{dueLabel(r.dueDate)}</span>{r.vendor ? ` · ${r.vendor}` : ""}</div>
                    </Link>
                    <Money value={r.remaining} size="sm" />
                    {canPay && <Button size="xs" variant="outline" className="opacity-100 transition md:opacity-0 md:group-hover:opacity-100" onClick={() => onPay([r.id])}>Pagar</Button>}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Categories({ s }: { s: Summary }) {
  const cats = s.categories.filter((c) => c.planned || c.budget || c.paid).sort((a, b) => Math.max(b.contracted, b.planned) - Math.max(a.contracted, a.planned));
  const pie = cats.filter((c) => c.contracted > 0);
  const top = pie.slice(0, 5);
  const rest = pie.slice(5).reduce((a, c) => a + c.contracted, 0);
  const data = [...top.map((c) => ({ name: c.name, value: c.contracted })), ...(rest ? [{ name: "Outras", value: rest }] : [])];
  return (
    <section className="rounded-xl border bg-card p-5 shadow-soft">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Por categoria</h2>
          <p className="text-xs text-muted-foreground">Contratado vs. orçamento · subcategorias somadas na mãe</p>
        </div>
        <Button asChild variant="ghost" size="sm"><Link to="/financeiro/categorias">Orçamentos <ArrowRight /></Link></Button>
      </div>
      {!cats.length ? (
        <EmptyState icon={<Banknote />} title="Sem valores por categoria" description="Defina orçamentos e cadastre lançamentos." action={<Button asChild variant="outline"><Link to="/financeiro/categorias">Definir orçamentos</Link></Button>} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
          {data.length > 0 && (
            <div className="relative mx-auto h-[200px] w-[200px]">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={data} dataKey="value" nameKey="name" innerRadius={64} outerRadius={92} paddingAngle={2} stroke="var(--card)" strokeWidth={2}>
                    {data.map((_, i) => <Cell key={i} fill={CHART[i % CHART.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => money(Number(v))} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                <div><div className="text-[11px] text-muted-foreground">contratado</div><Money value={s.contracted} size="md" /></div>
              </div>
            </div>
          )}
          <ul className="stagger space-y-1">
            {cats.slice(0, 9).map((c) => {
              const idx = data.findIndex((d) => d.name === c.name);
              const base = Math.max(c.contracted, c.planned);
              const pct = c.budget ? Math.round((base / c.budget) * 100) : null;
              return (
                <li key={c.categoryId}>
                  <Link to={`/financeiro/lancamentos?categoria=${c.categoryId}`} className="group block rounded-lg px-2 py-2 transition hover:bg-muted/50">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: idx >= 0 ? CHART[idx] : "var(--muted)" }} />
                      <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                      {c.overBudget && <span className="rounded-full bg-rose-500/12 px-1.5 text-[10px] font-semibold text-rose-600">acima</span>}
                      <Money value={base} size="sm" />
                      <span className="w-20 text-right text-xs text-muted-foreground tabular-nums">{c.budget ? `/ ${compactBRL(c.budget)}` : "sem orç."}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 pl-4">
                      <Bar value={pct ?? 0} danger={c.overBudget} className={cn(!c.budget && "opacity-30")} />
                      <span className={cn("w-10 text-right text-[11px] tabular-nums", c.overBudget ? "text-destructive" : "text-muted-foreground")}>{pct != null ? `${pct}%` : ""}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function MiniCashflow() {
  const q = trpc.finance.cashflow.useQuery({ months: 12 });
  const data = (q.data?.rows ?? []).map((r) => ({ ...r, label: monthShort(r.month) }));
  const end = q.data?.rows.at(-1);
  return (
    <Link to="/financeiro/fluxo" className="lift group block rounded-xl border bg-card p-5 shadow-soft">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Fluxo de caixa <span className="ml-1 rounded-full bg-sky-500/12 px-1.5 py-0.5 align-middle text-[10px] font-semibold tracking-wide text-sky-600 uppercase dark:text-sky-300">previsão</span></h2>
          <p className="text-xs text-muted-foreground">Saldo projetado nos próximos 12 meses</p>
        </div>
        <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5" />
      </div>
      <div className="mt-3 h-32">
        {data.length > 0 && (
          <ResponsiveContainer>
            <AreaChart data={data} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="mini-cf" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <ReferenceLine y={0} stroke="var(--destructive)" strokeDasharray="3 3" strokeOpacity={0.5} />
              <Tooltip formatter={(v) => money(Number(v))} labelStyle={{ textTransform: "capitalize" }} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }} />
              <Area type="monotone" dataKey="projectedBalance" name="Saldo projetado" stroke="var(--primary)" strokeWidth={2} fill="url(#mini-cf)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      {end && <div className="mt-2 flex items-baseline justify-between text-xs text-muted-foreground"><span>Em 12 meses</span><Money value={end.projectedBalance} size="md" /></div>}
    </Link>
  );
}

function RecentPayments() {
  const q = trpc.finance.payments.useQuery({ includeReversed: false });
  const rows = (q.data ?? []).slice(0, 6);
  return (
    <section className="rounded-xl border bg-card p-5 shadow-soft">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">Pagamentos recentes</h2>
        <Button asChild variant="ghost" size="sm"><Link to="/financeiro/pagamentos">Todos <ArrowRight /></Link></Button>
      </div>
      {!rows.length ? <p className="py-6 text-center text-sm text-muted-foreground">Nenhum pagamento registrado.</p> : (
        <ul className="stagger divide-y">
          {rows.map((p) => {
            const o = p.allocations[0]?.installment.obligation;
            return (
              <li key={p.id}>
                <Link to={o ? `/financeiro/lancamentos/${o.id}` : "/financeiro/pagamentos"} className="flex items-center gap-3 py-2.5 transition hover:opacity-80">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-500/12 text-emerald-600 dark:text-emerald-300"><CircleCheckBig className="size-4" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{o?.title ?? "Pagamento"}</div>
                    <div className="text-xs text-muted-foreground">{PAYMENT_METHOD[p.method]} · {relative(p.paidAt)}</div>
                  </div>
                  <Money value={p.amountCents} size="sm" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function SmallStats({ s }: { s: Summary }) {
  const rows = [
    { icon: Landmark, label: "Cauções a recuperar", value: s.depositPending, hint: `devolvido ${money(s.depositRefunded)} · retido ${money(s.depositForfeited)}`, to: "/financeiro/caucoes" },
    { icon: ArrowDownToLine, label: "Entradas recebidas", value: s.incomeReceived, hint: `+ ${money(s.incomeExpected)} previstas (não disponíveis)`, to: "/financeiro/entradas" },
    { icon: Receipt, label: "Não reembolsável", value: s.nonRefundable, hint: "contratado + cauções retidas", to: "/financeiro/lancamentos" },
    { icon: Wallet, label: "Custo por convidado", value: s.costPerGuest, hint: s.guestBasis ? `base: ${s.guestBasis}` : "sem convidados", to: "/convidados" },
  ];
  return (
    <section className="rounded-xl border bg-card shadow-soft">
      <ul className="divide-y">
        {rows.map((r) => (
          <li key={r.label}>
            <Link to={r.to} className="group flex items-center gap-3 px-5 py-3.5 transition hover:bg-muted/40">
              <span className="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground transition group-hover:scale-110 group-hover:bg-primary/12 group-hover:text-primary"><r.icon className="size-4" /></span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">{r.label}</div>
                <div className="truncate text-xs text-muted-foreground">{r.hint}</div>
              </div>
              <Money value={r.value} size="md" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FinanceOverviewPage() {
  const q = trpc.finance.summary.useQuery();
  const upcoming = trpc.finance.openInstallments.useQuery({ withinDays: 30 });
  const perm = useCanFinance();
  const [payIds, setPayIds] = useState<string[] | null>(null);
  const [income, setIncome] = useState(false);
  const [bill, setBill] = useState(false);
  const payable = (upcoming.data ?? []).map((r) => ({ id: r.id, label: `${r.title} · parcela ${r.number}`, dueDate: r.dueDate, remaining: r.remaining, overdue: r.overdue }));

  const actions = (
    <>
      {perm.create && <Button variant="outline" onClick={() => setIncome(true)}><ArrowDownToLine /> Registrar entrada</Button>}
      {perm.create && <Button variant="outline" onClick={() => setBill(true)}><Receipt /> Nova conta a pagar</Button>}
      <Button variant="outline" asChild><Link to="/financeiro/pagar"><CalendarClock /> Contas a pagar</Link></Button>
      {perm.create && <Button asChild><Link to="/financeiro/lancamentos/novo"><Plus /> Novo lançamento</Link></Button>}
    </>
  );

  return (
    <FinanceShell title="Visão geral" description="Orçamento, compromissos, pagamentos e previsões — calculados no servidor, centavo a centavo." actions={actions}>
      {q.isLoading ? <PageLoader /> : q.error || !q.data ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (() => {
        const s = q.data;
        const empty = !s.planned && !s.paid && !s.incomeReceived && !s.incomeExpected;
        return (
          <div className="space-y-5">
            <Hero s={s} />
            <AlertsStrip s={s} />
            {empty && (
              <EmptyState icon={<Banknote />} title="Comece pelo primeiro lançamento" description="Ex.: Igreja — reserva R$ 200, celebração R$ 700, caução R$ 200 (reembolsável) e taxa extra R$ 100." action={perm.create && <Button asChild><Link to="/financeiro/lancamentos/novo"><Plus /> Novo lançamento</Link></Button>} />
            )}
            <Balances s={s} />
            <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
              <Upcoming rows={upcoming.data ?? []} canPay={perm.create} onPay={setPayIds} />
              <div className="space-y-5">
                <MiniCashflow />
                <SmallStats s={s} />
              </div>
            </div>
            <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
              <Categories s={s} />
              <RecentPayments />
            </div>
          </div>
        );
      })()}
      <PaymentDialog open={!!payIds} onOpenChange={(o) => !o && setPayIds(null)} installments={payable} preselected={payIds ?? []} />
      <IncomeDialog open={income} onOpenChange={setIncome} initial={emptyIncome()} />
      <QuickBillDialog open={bill} onOpenChange={setBill} />
    </FinanceShell>
  );
}
