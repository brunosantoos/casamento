import { ArrowRight, Bot, CalendarRange, CheckCircle2, Loader2, PieChart, PiggyBank, Send, ShieldAlert, Sparkles, TriangleAlert, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Link } from "react-router";
import remarkGfm from "remark-gfm";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { ConfirmDialog, ErrorState, MoneyInput, PageLoader, StatusBadge } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { date, money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ProposalCard } from "@/pages/Assistant";
import { trpc, type RouterOutputs } from "@/trpc";
import { Bar, FinanceShell, Metric, Money, useCanFinance } from "./shared";

type Split = RouterOutputs["finance"]["planSplit"];
type Plan = RouterOutputs["finance"]["planPayments"];

const monthLabel = (k: string) => {
  const [y, m] = k.split("-").map(Number);
  return new Date(y!, m! - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", "");
};

function Card({ icon, title, subtitle, actions, children, className }: { icon: React.ReactNode; title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border bg-card p-4 shadow-soft animate-in fade-in md:p-5", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary [&_svg]:size-[18px]">{icon}</span>
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

// ───────────── Capacidade ─────────────

function Capacity() {
  const q = trpc.finance.planCapacity.useQuery();
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data!;
  return (
    <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Metric label="Disponível hoje" value={c.available} icon={<Wallet />} tone="primary" hint={c.basis === "carteiras" ? "Soma das carteiras" : <Link to="/financeiro/carteiras" className="text-primary hover:underline">Informe suas carteiras</Link>} />
      <Metric label="Falta pagar" value={c.openInstallments + c.contractedWithoutInstallments} icon={<CalendarRange />} tone="warning" hint={c.contractedWithoutInstallments ? `${money(c.contractedWithoutInstallments)} sem parcelas` : "Parcelas em aberto"} />
      <Metric label="Entradas previstas" value={c.expectedIncome} icon={<PiggyBank />} tone="info" hint="Promessas e previsões" />
      <Metric
        label={c.gap ? "Guardar por mês" : "Situação"}
        value={c.gap ? c.monthlyNeeded : <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="size-6" /> Tudo coberto</span>}
        icon={<ShieldAlert />}
        tone={c.gap ? "danger" : "success"}
        hint={c.gap ? `Faltam ${money(c.gap)} em ${c.monthsLeft ?? "?"} mês(es)` : c.plannedNotContracted ? `+ ${money(c.plannedNotContracted)} ainda previstos` : "Com o que há e o que vai entrar"}
      />
    </div>
  );
}

// ───────────── Dividir orçamento ─────────────

function BudgetSplit() {
  const perm = useCanFinance();
  const [honeymoon, setHoneymoon] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const q = trpc.finance.planSplit.useQuery({ includeHoneymoon: honeymoon, ...(total ? { totalCents: total } : {}) });
  const utils = trpc.useUtils();
  const apply = trpc.finance.applyBudgets.useMutation({
    onSuccess: async () => {
      toast.success("Orçamento por categoria aplicado");
      setConfirm(false);
      await utils.finance.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const d = q.data as Split | undefined;
  const changed = d?.rows.filter((r) => r.change !== 0) ?? [];
  return (
    <Card
      icon={<PieChart />}
      title="Dividir o orçamento"
      subtitle="Sugestão por categoria a partir de referências de casamentos, sem nunca ficar abaixo do que vocês já contrataram."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground"><Checkbox checked={honeymoon} onCheckedChange={(v) => setHoneymoon(!!v)} /> Incluir lua de mel</label>
          <MoneyInput className="w-40" value={total} onChange={setTotal} placeholder="Simular outro total" />
        </div>
      }
    >
      {q.isLoading ? <PageLoader /> : !d || !d.total ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Defina o orçamento total em <Link to="/configuracoes?aba=casamento" className="text-primary hover:underline">Configurações</Link> para receber a sugestão.</p>
      ) : (
        <>
          {!d.feasible && (
            <div className="mb-3 flex items-center gap-2 rounded-lg bg-destructive/8 px-3 py-2 text-sm text-destructive"><TriangleAlert className="size-4" /> O que já está comprometido passa do orçamento em {money(d.overBy ?? 0)}.</div>
          )}
          {total ? (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
              <span>Simulando um orçamento de <b>{money(total)}</b> — o real continua o mesmo.</span>
              <Button size="xs" variant="outline" onClick={() => setTotal(null)}>Voltar ao orçamento real</Button>
            </div>
          ) : null}
          <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span className="text-muted-foreground">{total ? "Total simulado" : "Orçamento total"} <Money value={d.total} size="sm" className="font-semibold text-foreground" /></span>
            <span className="text-muted-foreground">Já comprometido <Money value={d.committedTotal} size="sm" className="font-semibold text-foreground" /></span>
          </div>
          <div className="space-y-1">
            {d.rows.filter((r) => r.suggested > 0 || r.currentBudget > 0).map((r) => {
              const pctCommitted = r.suggested ? Math.min(100, (r.committed / r.suggested) * 100) : 0;
              return (
                <div key={r.categoryId} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 rounded-lg px-2 py-2 transition hover:bg-muted/50 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto_auto]">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{r.name}</div>
                    <div className="text-[11px] text-muted-foreground">{r.pct}% {r.committed ? `· ${money(r.committed)} comprometido` : ""}</div>
                  </div>
                  <div className="hidden sm:block"><Bar value={pctCommitted} /></div>
                  <div className="hidden text-right text-xs text-muted-foreground tabular-nums sm:block">{r.currentBudget ? money(r.currentBudget) : "—"}</div>
                  <div className="flex items-center gap-1.5 text-right">
                    {r.change !== 0 && r.currentBudget > 0 && <ArrowRight className="hidden size-3 text-muted-foreground sm:block" />}
                    <Money value={r.suggested} size="sm" className={cn("font-semibold", r.change > 0 && r.currentBudget > 0 && "text-emerald-600 dark:text-emerald-400", r.change < 0 && "text-amber-600 dark:text-amber-400")} />
                  </div>
                </div>
              );
            })}
          </div>
          {perm.edit && changed.length > 0 && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2.5">
              <span className="text-xs text-muted-foreground">{changed.length} categoria(s) mudam.{total ? " Atenção: a divisão é do total simulado." : " O orçamento total não muda."}</span>
              <Button size="sm" onClick={() => setConfirm(true)}><CheckCircle2 /> Aplicar sugestão</Button>
            </div>
          )}
          <ConfirmDialog
            open={confirm}
            onOpenChange={setConfirm}
            title="Aplicar a divisão sugerida?"
            description={`O orçamento de ${changed.length} categoria(s) será atualizado. Lançamentos e pagamentos não são alterados. Você pode ajustar cada categoria depois.`}
            confirmLabel="Aplicar"
            loading={apply.isPending}
            onConfirm={() => apply.mutate({ items: changed.map((r) => ({ categoryId: r.categoryId, budgetCents: r.suggested })) })}
          />
        </>
      )}
    </Card>
  );
}

// ───────────── Fluxo de pagamentos ─────────────

function PaymentPlan() {
  const perm = useCanFinance();
  const [reserve, setReserve] = useState<number | null>(null);
  const [skip, setSkip] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const before = trpc.finance.planSimulate.useQuery({ reserveCents: reserve ?? 0 });
  const plan = trpc.finance.planPayments.useQuery({ reserveCents: reserve ?? 0 });
  const utils = trpc.useUtils();
  const apply = trpc.finance.applyReschedule.useMutation({
    onSuccess: async () => {
      toast.success("Novos vencimentos aplicados");
      setConfirm(false);
      await utils.finance.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const p = plan.data as Plan | undefined;
  const chart = useMemo(() => {
    if (!before.data || !p) return [];
    return before.data.rows.map((r, i) => ({ month: monthLabel(r.month), atual: r.projectedBalance / 100, plano: (p.result.rows[i]?.projectedBalance ?? r.projectedBalance) / 100 }));
  }, [before.data, p]);
  const moves = (p?.moves ?? []).filter((m) => !skip.includes(m.installmentId));
  const fmtAxis = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v));

  return (
    <Card
      icon={<CalendarRange />}
      title="Fluxo de pagamentos até o casamento"
      subtitle="Saldo mês a mês a partir das carteiras. Se algum mês ficar negativo, sugerimos novos vencimentos para negociar."
      actions={<div className="flex items-center gap-2 text-xs text-muted-foreground">Reserva mínima <MoneyInput className="w-36" value={reserve} onChange={setReserve} placeholder="0,00" /></div>}
    >
      {before.isLoading || plan.isLoading ? <PageLoader /> : before.error ? <ErrorState error={before.error} onRetry={() => before.refetch()} /> : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            {before.data!.ok ? (
              <StatusBadge tone="emerald"><CheckCircle2 className="size-3" /> O saldo não fica abaixo da reserva</StatusBadge>
            ) : (
              <StatusBadge tone="rose"><TriangleAlert className="size-3" /> Falta dinheiro em {monthLabel(before.data!.firstShortMonth!)}</StatusBadge>
            )}
            <span className="text-xs text-muted-foreground">Menor saldo previsto: <Money value={before.data!.minBalance} size="sm" className={cn("font-semibold", before.data!.minBalance < 0 && "text-destructive")} /></span>
          </div>
          <div className="h-56 w-full">
            <ResponsiveContainer>
              <AreaChart data={chart} margin={{ left: 0, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="gAtual" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--color-chart-3)" stopOpacity={0.25} /><stop offset="100%" stopColor="var(--color-chart-3)" stopOpacity={0} /></linearGradient>
                  <linearGradient id="gPlano" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--primary)" stopOpacity={0.3} /><stop offset="100%" stopColor="var(--primary)" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={40} />
                <Tooltip formatter={(v, n) => [money(Math.round(Number(v) * 100)), n === "atual" ? "Hoje" : "Com o plano"]} contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", background: "var(--popover)", fontSize: 12 }} />
                <ReferenceLine y={(reserve ?? 0) / 100} stroke="var(--destructive)" strokeDasharray="4 4" />
                <Area type="monotone" dataKey="atual" stroke="var(--color-chart-3)" fill="url(#gAtual)" strokeWidth={2} />
                {p && p.moves.length > 0 && <Area type="monotone" dataKey="plano" stroke="var(--primary)" fill="url(#gPlano)" strokeWidth={2.5} />}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {p && p.moves.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Vencimentos sugeridos</span>
                <span className={cn("text-xs", p.solved ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600")}>{p.note}</span>
              </div>
              <div className="space-y-1.5">
                {p.moves.map((m) => {
                  const on = !skip.includes(m.installmentId);
                  return (
                    <label key={m.installmentId} className={cn("flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition", on ? "border-primary/40 bg-primary/5" : "opacity-60")}>
                      <Checkbox checked={on} onCheckedChange={(v) => setSkip(v ? skip.filter((x) => x !== m.installmentId) : [...skip, m.installmentId])} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{m.title}{m.vendor ? <span className="text-muted-foreground"> · {m.vendor}</span> : null}</div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{date(m.from)} <ArrowRight className="size-3" /> <b className="text-foreground">{date(m.to)}</b></div>
                      </div>
                      <Money value={m.amount ?? 0} size="sm" className="font-semibold" />
                    </label>
                  );
                })}
              </div>
              {perm.edit && (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2.5">
                  <span className="text-xs text-muted-foreground">Combine com cada fornecedor antes — vencimento é condição do contrato.</span>
                  <Button size="sm" disabled={!moves.length} onClick={() => setConfirm(true)}><CheckCircle2 /> Aplicar {moves.length} vencimento(s)</Button>
                </div>
              )}
              <ConfirmDialog
                open={confirm}
                onOpenChange={setConfirm}
                title="Aplicar os novos vencimentos?"
                description="Só as datas mudam; os valores das parcelas continuam os mesmos. Fica registrado na auditoria."
                confirmLabel="Aplicar"
                loading={apply.isPending}
                onConfirm={() => apply.mutate({ changes: moves.map((m) => ({ installmentId: m.installmentId, dueDate: new Date(m.to) })) })}
              />
            </div>
          )}
          {p && !p.moves.length && !p.solved && <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">{p.note}</p>}
        </>
      )}
    </Card>
  );
}

// ───────────── Chat com a IA ─────────────

const PROMPTS = [
  "Como devemos dividir nosso orçamento entre as categorias?",
  "Monte um plano de pagamentos até o casamento sem ficar no negativo",
  "Quanto precisamos guardar por mês?",
  "Onde estamos gastando acima do planejado?",
  "Se o orçamento fosse R$ 10 mil menor, onde cortar?",
];

function PlannerChat() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [log, setLog] = useState<{ role: "user" | "assistant"; content: string; proposals?: RouterOutputs["ai"]["ask"]["proposals"] }[]>([]);
  const ask = trpc.ai.ask.useMutation({
    onSuccess: (r) => {
      setConversationId(r.conversationId);
      setLog((l) => [...l, { role: "assistant", content: r.message.content, proposals: r.proposals }]);
    },
    onError: (e) => {
      setLog((l) => l.slice(0, -1));
      toast.error(e.data?.code === "PRECONDITION_FAILED" ? "Configure o provedor de IA em Configurações → Integrações" : e.message);
    },
  });
  const send = (m: string) => {
    if (!m.trim() || ask.isPending) return;
    setLog((l) => [...l, { role: "user", content: m.trim() }]);
    setText("");
    ask.mutate({ conversationId, message: m.trim(), mode: "finance" });
  };
  return (
    <Card icon={<Bot />} title="Planejador com IA" subtitle="Pergunte em linguagem natural. Os números vêm dos cálculos do sistema; mudanças viram propostas para vocês aprovarem." className="flex flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {!log.length && (
          <div className="flex flex-wrap gap-1.5">
            {PROMPTS.map((p) => (
              <button key={p} type="button" onClick={() => send(p)} className="rounded-full border px-3 py-1.5 text-left text-xs text-muted-foreground transition hover:border-primary/50 hover:text-foreground"><Sparkles className="mr-1 inline size-3 text-primary" />{p}</button>
            ))}
          </div>
        )}
        {log.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm", m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted/60")}>
              {m.role === "assistant" ? (
                <div className="space-y-2 [&_li]:ml-4 [&_ol]:list-decimal [&_table]:w-full [&_table]:text-xs [&_td]:border-t [&_td]:py-1 [&_th]:text-left [&_ul]:list-disc"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown></div>
              ) : m.content}
              {m.proposals?.map((p) => <div key={p.id} className="mt-2"><ProposalCard p={p as never} /></div>)}
            </div>
          </div>
        ))}
        {ask.isPending && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Calculando com os dados de vocês…</div>}
      </div>
      <form className="mt-3 flex gap-2 border-t pt-3" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex.: dá para antecipar o pagamento do buffet?" className="h-9 min-w-0 flex-1 rounded-md border bg-transparent px-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20" />
        <Button type="submit" size="icon" disabled={!text.trim() || ask.isPending} aria-label="Enviar"><Send /></Button>
      </form>
      <p className="mt-2 text-[11px] text-muted-foreground">A IA não paga, não exclui e não altera nada sozinha. <Link to="/assistente" className="hover:underline">Ver todas as conversas</Link></p>
    </Card>
  );
}

export function PlannerPage() {
  return (
    <FinanceShell title="Planejar" description="Divisão do orçamento, fluxo de pagamentos e quanto guardar — com a ajuda da IA.">
      <div className="space-y-5">
        <Capacity />
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-5">
            <PaymentPlan />
            <BudgetSplit />
          </div>
          <div className="min-w-0 xl:sticky xl:top-20 xl:h-[calc(100dvh-7rem)]">
            <PlannerChat />
          </div>
        </div>
      </div>
    </FinanceShell>
  );
}
