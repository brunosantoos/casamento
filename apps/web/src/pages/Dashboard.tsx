import {
  AlertTriangle, ArrowRight, ImagePlus, Banknote, CalendarClock, CalendarDays, CheckCircle2, CircleDollarSign, ClipboardCheck, FileWarning, Info, Mail, PiggyBank, Receipt, ShieldAlert, Store, TrendingUp, UserCheck, UserX, Users, Wallet,
} from "lucide-react";
import { Link } from "react-router";
import { CoupleAvatars } from "@/components/app/CouplePhotos";
import { EmptyState, PageHeader, QueryState, Section, StatCard, StatusBadge } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useMe } from "@/hooks/use-me";
import { date, dateLong, dateTime, money } from "@/lib/format";
import { CONTRACT_STATUS, EVENT_TYPE, PRIORITY, VENDOR_STATUS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { trpc, type RouterOutputs } from "@/trpc";

type Overview = RouterOutputs["dashboard"]["overview"];

function Countdown({ w }: { w: Overview["wedding"] }) {
  const photos = trpc.wedding.photos.useQuery(undefined, { staleTime: 30 * 60_000 });
  const cover = photos.data?.cover;
  const { can } = useMe();
  const when = w.date ? `${dateLong(w.date)} · ${new Date(w.date).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: w.timezone })}` : null;
  return (
    <div className={cn("group relative overflow-hidden rounded-xl border shadow-soft", cover ? "min-h-56 md:min-h-72" : "bg-card")}>
      {cover ? (
        <>
          <img src={cover} alt="" className="absolute inset-0 size-full object-cover transition duration-[1.5s] group-hover:scale-[1.03]" style={{ objectPosition: photos.data?.coverPosition }} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-black/5" />
        </>
      ) : (
        <div className="bg-glow absolute inset-0" />
      )}
      <div className={cn("relative flex h-full flex-wrap items-end justify-between gap-6 p-6 md:p-8", cover && "min-h-56 text-white md:min-h-72")}>
        <div className="flex items-end gap-4">
          <CoupleAvatars size="size-14 md:size-16" className="hidden sm:flex" />
          <div>
            <div className={cn("text-xs font-medium tracking-wide uppercase", cover ? "text-white/80" : "text-primary")}>Nosso casamento</div>
            <h2 className="mt-1 text-3xl font-semibold md:text-4xl">{w.partner1Name} <span className={cover ? "text-white/70" : "text-brand"}>&</span> {w.partner2Name}</h2>
            <p className={cn("mt-1.5 text-sm", cover ? "text-white/80" : "text-muted-foreground")}>{when ?? <Link to="/configuracoes" className="underline">Definir a data do casamento</Link>}</p>
            {!cover && can("settings:edit") && <Link to="/configuracoes?aba=fotos" className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"><ImagePlus className="size-3.5" /> Adicionar fotos do casal</Link>}
          </div>
        </div>
        {w.daysLeft != null && (
          <div className="text-right">
            <div className={cn("font-sans text-6xl leading-none font-semibold tracking-tighter tabular-nums md:text-7xl", cover ? "text-white" : "text-primary")}>{Math.abs(w.daysLeft)}</div>
            <div className={cn("mt-1 text-sm", cover ? "text-white/80" : "text-muted-foreground")}>{w.daysLeft > 0 ? (w.daysLeft === 1 ? "dia para o grande dia" : "dias para o grande dia") : w.daysLeft === 0 ? "É hoje!" : "dias desde o casamento"}</div>
          </div>
        )}
      </div>
    </div>
  );
}

const ALERT_ICON = { danger: ShieldAlert, warning: AlertTriangle, info: Info } as const;
const ALERT_TONE = { danger: "border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-300", warning: "border-amber-500/30 bg-amber-500/5 text-amber-800 dark:text-amber-300", info: "border-sky-500/30 bg-sky-500/5 text-sky-800 dark:text-sky-300" };

function Alerts({ alerts }: { alerts: Overview["alerts"] }) {
  if (!alerts.length) return null;
  return (
    <Section title="Alertas e recomendações" description="Calculados a partir dos dados cadastrados; sugestões da IA aparecem para aprovação.">
      <ul className="grid gap-2 md:grid-cols-2">
        {alerts.slice(0, 10).map((a, i) => {
          const I = ALERT_ICON[a.level];
          return (
            <li key={i}>
              <Link to={a.link} className={cn("flex items-start gap-3 rounded-xl border p-3 transition hover:shadow-soft", ALERT_TONE[a.level])}>
                <I className="mt-0.5 size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{a.title}</div>
                  <div className="text-xs opacity-80">{a.detail}</div>
                </div>
                <ArrowRight className="mt-0.5 size-4 shrink-0 opacity-60" />
              </Link>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function Finance({ f, dueSoon }: { f: NonNullable<Overview["finance"]>; dueSoon: Overview["dueSoon"] }) {
  const empty = f.planned === 0 && f.paid === 0 && f.incomeReceived === 0 && f.incomeExpected === 0;
  const used = f.budget ? Math.min(100, Math.round((Math.max(f.planned, f.contracted) / f.budget) * 100)) : 0;
  return (
    <Section title="Financeiro" actions={<Button asChild variant="outline" size="sm"><Link to="/financeiro">Abrir <ArrowRight /></Link></Button>}>
      {empty ? (
        <EmptyState icon={<Banknote />} title="Nenhum lançamento ainda" description="Cadastre a primeira contratação (ex.: igreja, buffet) com seus itens e parcelas." action={<Button asChild><Link to="/financeiro/lancamentos/novo">Novo lançamento</Link></Button>} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard icon={<PiggyBank />} label="Orçamento" value={money(f.budget)} hint={f.budget ? `${used}% comprometido` : "Defina em Configurações"} href="/financeiro" />
            <StatCard icon={<Receipt />} label="Contratado" value={money(f.contracted)} hint={`Previsto ${money(f.planned)}`} href="/financeiro/lancamentos?status=ACTIVE" />
            <StatCard icon={<CheckCircle2 />} label="Pago" tone="emerald" value={money(f.paid)} hint={`Gasto efetivo ${money(f.effectiveSpent)}`} href="/financeiro/pagamentos" />
            <StatCard icon={<CalendarClock />} label="A pagar" tone="amber" value={money(f.open)} hint={f.overdue ? <span className="text-rose-600">{money(f.overdue)} vencido</span> : "Nada vencido"} href="/financeiro/pagar" />
            <StatCard icon={<Wallet />} label="Entradas recebidas" tone="emerald" value={money(f.incomeReceived)} hint={`Previstas ${money(f.incomeExpected)}`} href="/financeiro/entradas" />
            <StatCard icon={<CircleDollarSign />} label="Saldo real" value={money(f.realBalance)} hint="Recebido − pago" href="/financeiro/fluxo" />
            <StatCard icon={<TrendingUp />} label="Saldo projetado" tone={f.projectedBalance < 0 ? "rose" : "sky"} value={money(f.projectedBalance)} hint="PREVISÃO — não é dinheiro disponível" href="/financeiro/fluxo" />
            <StatCard icon={<Banknote />} label="Cauções a recuperar" tone="gold" value={money(f.depositPending)} hint={f.costPerGuest != null ? `Custo/convidado ${money(f.costPerGuest)}` : undefined} href="/financeiro/caucoes" />
          </div>
          {f.budget > 0 && (
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>Uso do orçamento</span><span>{used}%</span></div>
              <Progress value={used} className={cn(f.overBudget && "[&>div]:bg-destructive")} />
            </div>
          )}
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 font-sans text-sm font-semibold">Despesas por categoria</h3>
              <ul className="space-y-2">
                {f.categories.filter((c) => c.planned || c.budget).sort((a, b) => b.contracted - a.contracted).slice(0, 7).map((c) => {
                  const pct = c.budget ? Math.min(100, Math.round((Math.max(c.planned, c.contracted) / c.budget) * 100)) : null;
                  return (
                    <li key={c.categoryId}>
                      <Link to={`/financeiro/lancamentos?categoria=${c.categoryId}`} className="block rounded-lg p-1.5 hover:bg-muted/50">
                        <div className="flex justify-between gap-2 text-sm"><span className="truncate">{c.name}</span><span className={cn("tabular-nums", c.overBudget && "text-destructive")}>{money(c.contracted || c.planned)}{c.budget ? ` / ${money(c.budget)}` : ""}</span></div>
                        {pct != null && <Progress value={pct} className={cn("mt-1 h-1.5", c.overBudget && "[&>div]:bg-destructive")} />}
                      </Link>
                    </li>
                  );
                })}
                {!f.categories.some((c) => c.planned || c.budget) && <li className="text-sm text-muted-foreground">Sem valores por categoria.</li>}
              </ul>
            </div>
            <div>
              <h3 className="mb-2 font-sans text-sm font-semibold">Próximos vencimentos</h3>
              {dueSoon.length ? (
                <ul className="divide-y rounded-xl border">
                  {dueSoon.map((d) => (
                    <li key={d.id}>
                      <Link to={`/financeiro/lancamentos/${d.obligationId}`} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40">
                        <span className={cn("w-20 shrink-0 tabular-nums", d.overdue && "font-medium text-destructive")}>{date(d.dueDate)}</span>
                        <span className="min-w-0 flex-1 truncate">{d.title}{d.vendor ? <span className="text-muted-foreground"> · {d.vendor}</span> : null}</span>
                        <span className="tabular-nums">{money(d.remaining)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted-foreground">Nenhum vencimento na janela configurada.</p>}
            </div>
          </div>
        </>
      )}
    </Section>
  );
}

function Guests({ g }: { g: NonNullable<Overview["guests"]> }) {
  if (!g.invited) {
    return (
      <Section title="Convidados">
        <EmptyState icon={<Users />} title="Lista de convidados vazia" description="Cadastre famílias e convidados ou importe uma planilha." action={<Button asChild><Link to="/convidados">Cadastrar convidados</Link></Button>} />
      </Section>
    );
  }
  return (
    <Section title="Convidados" actions={<Button asChild variant="outline" size="sm"><Link to="/convidados">Abrir <ArrowRight /></Link></Button>}>
      <div className="grid grid-cols-2 gap-3">
        <StatCard icon={<Users />} label="Cadastrados" value={g.invited} hint={`${g.groups} família(s)`} href="/convidados" />
        <StatCard icon={<Mail />} label="Convites enviados" tone="sky" value={g.invitesSent} href="/convites" />
        <StatCard icon={<UserCheck />} label="Pessoas confirmadas" tone="emerald" value={g.confirmedPeople} hint={`${g.accepted} convidados + ${g.companions} acompanhantes`} href="/convidados?rsvp=ACCEPTED" />
        <StatCard icon={<UserX />} label="Sem resposta" tone="amber" value={g.pending} hint={`${g.declined} recusa(s)`} href="/convidados?rsvp=PENDING" />
      </div>
      <div className="mt-4">
        <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>Respostas</span><span>{Math.round(((g.accepted + g.declined) / g.invited) * 100)}%</span></div>
        <Progress value={((g.accepted + g.declined) / g.invited) * 100} />
      </div>
    </Section>
  );
}

function Tasks({ t, next }: { t: NonNullable<Overview["tasks"]>; next: Overview["nextTasks"] }) {
  if (!t.total) {
    return (
      <Section title="Checklist">
        <EmptyState icon={<ClipboardCheck />} title="Nenhuma tarefa" description="Gere o checklist a partir do modelo de 9 fases ou crie tarefas avulsas." action={<Button asChild><Link to="/checklist">Abrir checklist</Link></Button>} />
      </Section>
    );
  }
  const pct = Math.round((t.done / Math.max(1, t.done + t.open)) * 100);
  return (
    <Section title="Checklist" actions={<Button asChild variant="outline" size="sm"><Link to="/checklist">Abrir <ArrowRight /></Link></Button>}>
      <div className="grid grid-cols-3 gap-3">
        <StatCard icon={<CheckCircle2 />} label="Concluídas" tone="emerald" value={t.done} href="/checklist?status=DONE" />
        <StatCard icon={<ClipboardCheck />} label="Pendentes" value={t.open} href="/checklist" />
        <StatCard icon={<AlertTriangle />} label="Atrasadas" tone={t.overdue ? "rose" : "neutral"} value={t.overdue} href="/checklist?atrasadas=1" />
      </div>
      <div className="mt-4"><div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>Progresso</span><span>{pct}%</span></div><Progress value={pct} /></div>
      {next.length > 0 && (
        <ul className="mt-4 divide-y rounded-xl border">
          {next.map((x) => (
            <li key={x.id}>
              <Link to={`/checklist?tarefa=${x.id}`} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40">
                <span className={cn("w-20 shrink-0 tabular-nums", x.dueDate && new Date(x.dueDate) < new Date() && "font-medium text-destructive")}>{date(x.dueDate)}</span>
                <span className="min-w-0 flex-1 truncate">{x.title}</span>
                <StatusBadge tone={PRIORITY[x.priority]?.tone}>{PRIORITY[x.priority]?.label}</StatusBadge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function DashboardPage() {
  const q = trpc.dashboard.overview.useQuery(undefined, { refetchInterval: 60_000 });
  const { can } = useMe();
  return (
    <>
      <PageHeader title="Visão geral" description="Tudo o que importa agora, com dados reais do planejamento." />
      <QueryState query={q}>
        {(d) => (
          <div className="space-y-5">
            <Countdown w={d.wedding} />
            <Alerts alerts={d.alerts} />
            {d.finance && <Finance f={d.finance} dueSoon={d.dueSoon} />}
            <div className="grid gap-5 xl:grid-cols-2">
              {d.guests && <Guests g={d.guests} />}
              {d.tasks && <Tasks t={d.tasks} next={d.nextTasks} />}
            </div>
            <div className="grid gap-5 xl:grid-cols-3">
              {can("calendar:view") && (
                <Section title="Próximos compromissos" actions={<Button asChild variant="ghost" size="sm"><Link to="/calendario"><CalendarDays /> Agenda</Link></Button>}>
                  {d.events.length ? (
                    <ul className="space-y-2">{d.events.map((e) => <li key={e.id}><Link to={`/calendario?evento=${e.id}`} className="block rounded-lg p-2 text-sm hover:bg-muted/50"><div className="font-medium">{e.title}</div><div className="text-xs text-muted-foreground">{dateTime(e.startsAt)} · {EVENT_TYPE[e.type]}{e.location ? ` · ${e.location}` : ""}</div></Link></li>)}</ul>
                  ) : <p className="text-sm text-muted-foreground">Nenhum compromisso agendado.</p>}
                </Section>
              )}
              {can("documents:view") && (
                <Section title="Contratos aguardando análise">
                  {d.contractsReview.length ? (
                    <ul className="space-y-1">{d.contractsReview.map((c) => <li key={c.id}><Link to={`/fornecedores/${c.vendor.id}`} className="flex items-center gap-2 rounded-lg p-2 text-sm hover:bg-muted/50"><FileWarning className="size-4 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{c.title} · {c.vendor.name}</span><StatusBadge tone={CONTRACT_STATUS[c.status]?.tone}>{CONTRACT_STATUS[c.status]?.label}</StatusBadge></Link></li>)}</ul>
                  ) : <p className="text-sm text-muted-foreground">Nenhum contrato pendente de análise.</p>}
                </Section>
              )}
              {can("vendors:view") && (
                <Section title="Fornecedores com pendências">
                  {d.vendorsPending.length ? (
                    <ul className="space-y-1">{d.vendorsPending.map((v) => <li key={v.id}><Link to={`/fornecedores/${v.id}`} className="flex items-center gap-2 rounded-lg p-2 text-sm hover:bg-muted/50"><Store className="size-4 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{v.name}</span><StatusBadge tone={VENDOR_STATUS[v.status]?.tone}>{VENDOR_STATUS[v.status]?.label}</StatusBadge></Link></li>)}</ul>
                  ) : <p className="text-sm text-muted-foreground">Nenhuma pendência atrasada.</p>}
                </Section>
              )}
            </div>
          </div>
        )}
      </QueryState>
    </>
  );
}
