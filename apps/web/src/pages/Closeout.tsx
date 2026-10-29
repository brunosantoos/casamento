import { ArrowRight, CheckCircle2, ClipboardCheck, FileDown, Gift, HandCoins, HeartHandshake, MessageCircle, PackageCheck, Store, Undo2, Wallet } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { EmptyState, LoadingButton, PageHeader, PageLoader, StatusBadge } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useMe } from "@/hooks/use-me";
import { date, money, newKey } from "@/lib/format";
import { downloadReportPdf } from "@/lib/report-pdf";
import { cn } from "@/lib/utils";
import { Cell2, DataTable, Money, Ring } from "@/pages/finance/shared";
import { trpc, type RouterOutputs } from "@/trpc";

type Gift = RouterOutputs["guestPhotos"]["closeoutThankYou"][number];

const RENTED = /devolv|alugad|aluguel/i;

/** Bloco do cockpit: título, progresso e conteúdo recolhível */
function Block({ icon, title, done, total, hint, action, children }: { icon: ReactNode; title: string; done: number; total: number; hint?: ReactNode; action?: ReactNode; children: ReactNode }) {
  const complete = total === 0 || done >= total;
  return (
    <section className={cn("rounded-xl border bg-card shadow-soft transition", complete && "border-emerald-500/30")}>
      <header className="flex flex-wrap items-center gap-3 border-b p-4">
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl [&_svg]:size-5", complete ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300" : "bg-primary/10 text-primary")}>{complete ? <CheckCircle2 /> : icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{total === 0 ? "Nada pendente" : `${done} de ${total} resolvido(s)`}{hint ? <> · {hint}</> : null}</p>
        </div>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function ThankYouDialog({ gift, onClose }: { gift: Gift | null; onClose: () => void }) {
  const { wedding } = useMe();
  const [text, setText] = useState("");
  const [key] = useState(newKey);
  const utils = trpc.useUtils();
  const mark = trpc.guestPhotos.setThankYou.useMutation();
  const send = trpc.whatsapp.sendSingle.useMutation({
    onSuccess: async () => {
      if (gift) await mark.mutateAsync({ ids: [gift.id], status: "SENT", note: "Agradecimento enviado pelo WhatsApp" }).catch(() => undefined);
      toast.success("Mensagem na fila de envio do WhatsApp");
      await utils.guestPhotos.closeoutThankYou.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const initial = gift
    ? `Oi, ${gift.giverName.split(" ")[0]}! 💛\n\nMuito obrigado pelo carinho e pelo presente${gift.what && gift.what !== "Presente em dinheiro" ? ` (${gift.what})` : ""}. Ter vocês com a gente fez toda a diferença no nosso casamento.\n\nCom amor,\n${wedding ? `${wedding.partner1Name} & ${wedding.partner2Name}` : ""}`
    : "";
  return (
    <Dialog open={!!gift} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Agradecer {gift?.giverName}</DialogTitle>
          <DialogDescription>Enviado pelo WhatsApp conectado, respeitando o horário e o intervalo configurados. Edite à vontade.</DialogDescription>
        </DialogHeader>
        <Textarea rows={8} defaultValue={initial} onChange={(e) => setText(e.target.value)} />
        <p className="text-xs text-muted-foreground">Para: {gift?.phone ? gift.phone : "sem telefone cadastrado"}</p>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <LoadingButton loading={send.isPending} disabled={!gift?.phone} onClick={() => gift?.phone && send.mutate({ to: gift.phone, body: (text || initial).trim(), idempotencyKey: `thanks-${gift.id}-${key}` })}>
            <MessageCircle /> Enviar
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ThankYous({ gifts, canEdit, canWhats }: { gifts: Gift[]; canEdit: boolean; canWhats: boolean }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [thank, setThank] = useState<Gift | null>(null);
  const utils = trpc.useUtils();
  const set = trpc.guestPhotos.setThankYou.useMutation({
    onSuccess: async (r) => {
      toast.success(`${r.count} agradecimento(s) atualizado(s)`);
      setSelected([]);
      await utils.guestPhotos.closeoutThankYou.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  if (!gifts.length) return <EmptyState icon={<Gift />} title="Nenhum presente registrado" description="Os presentes recebidos pela lista (ou registrados por vocês) aparecem aqui para controlar os agradecimentos." />;
  const label = { PENDING: { t: "Pendente", tone: "amber" as const }, SENT: { t: "Enviado", tone: "emerald" as const }, NOT_NEEDED: { t: "Dispensado", tone: "neutral" as const } };
  return (
    <>
      {canEdit && selected.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-muted/60 p-2 text-sm">
          <span className="px-1 text-muted-foreground">{selected.length} selecionado(s)</span>
          <Button size="sm" disabled={set.isPending} onClick={() => set.mutate({ ids: selected, status: "SENT" })}><CheckCircle2 /> Marcar como enviado</Button>
          <Button size="sm" variant="outline" disabled={set.isPending} onClick={() => set.mutate({ ids: selected, status: "NOT_NEEDED" })}>Dispensar</Button>
        </div>
      )}
      <DataTable
        rows={gifts}
        rowKey={(g) => g.id}
        selection={canEdit ? { selected, onChange: setSelected } : undefined}
        initialSort={{ key: "status", dir: 1 }}
        columns={[
          { key: "giver", header: "Quem deu", sort: (g) => g.giverName, cell: (g) => <Cell2 title={g.giverName} sub={g.family ?? undefined} /> },
          { key: "what", header: "Presente", cell: (g) => <Cell2 title={g.what} sub={g.message ? `“${g.message.slice(0, 60)}${g.message.length > 60 ? "…" : ""}”` : g.status === "PLEDGED" ? "aguardando conferência" : undefined} /> },
          { key: "amount", header: "Valor", align: "right", sort: (g) => g.amountCents ?? 0, cell: (g) => (g.amountCents ? <Money value={g.amountCents} size="sm" /> : <span className="text-xs text-muted-foreground">físico</span>), footer: <Money value={gifts.reduce((a, g) => a + (g.status === "CONFIRMED" ? (g.amountCents ?? 0) : 0), 0)} size="sm" /> },
          { key: "status", header: "Agradecimento", sort: (g) => ({ PENDING: 0, SENT: 1, NOT_NEEDED: 2 })[g.thankYouStatus], cell: (g) => <span className="flex flex-col items-start gap-0.5"><StatusBadge tone={label[g.thankYouStatus].tone}>{label[g.thankYouStatus].t}</StatusBadge>{g.thankYouSentAt && <span className="text-[11px] text-muted-foreground">{date(g.thankYouSentAt)}</span>}</span> },
        ]}
        actions={(g) => (
          <div className="flex gap-1">
            {canWhats && g.thankYouStatus === "PENDING" && g.phone && <Button size="icon-sm" variant="ghost" aria-label="Agradecer pelo WhatsApp" onClick={() => setThank(g)}><MessageCircle /></Button>}
            {canEdit && g.thankYouStatus !== "SENT" && <Button size="icon-sm" variant="ghost" aria-label="Marcar como enviado" onClick={() => set.mutate({ ids: [g.id], status: "SENT" })}><CheckCircle2 /></Button>}
            {canEdit && g.thankYouStatus !== "PENDING" && <Button size="icon-sm" variant="ghost" aria-label="Voltar para pendente" onClick={() => set.mutate({ ids: [g.id], status: "PENDING" })}><Undo2 /></Button>}
          </div>
        )}
        mobile={(g) => (
          <div className="flex items-center gap-3">
            <Cell2 className="flex-1" title={g.giverName} sub={`${g.what}${g.amountCents ? ` · ${money(g.amountCents)}` : ""}`} />
            <StatusBadge tone={label[g.thankYouStatus].tone}>{label[g.thankYouStatus].t}</StatusBadge>
          </div>
        )}
      />
      <ThankYouDialog gift={thank} onClose={() => setThank(null)} />
    </>
  );
}

export function CloseoutPage() {
  const { can, wedding } = useMe();
  const canFinance = can("finance:view");
  const canVendors = can("vendors:view");
  const utils = trpc.useUtils();
  const summary = trpc.finance.summary.useQuery(undefined, { enabled: canFinance });
  const deposits = trpc.finance.deposits.useQuery(undefined, { enabled: canFinance });
  const open = trpc.finance.openInstallments.useQuery({}, { enabled: canFinance });
  const gifts = trpc.guestPhotos.closeoutThankYou.useQuery(undefined, { enabled: canFinance });
  const vendors = trpc.guestPhotos.closeoutVendors.useQuery(undefined, { enabled: canVendors });
  const tasks = trpc.planning.tasks.useQuery({ phase: 9 });
  const setTask = trpc.planning.setStatus.useMutation({
    onSuccess: () => utils.planning.tasks.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const [pdf, setPdf] = useState(false);

  const depositRows = useMemo(() => (deposits.data ?? []).filter((d) => d.paid > 0), [deposits.data]);
  const pendingDeposits = depositRows.filter((d) => d.pending > 0);
  const openRows = open.data ?? [];
  const giftRows = gifts.data ?? [];
  const thanksDone = giftRows.filter((g) => g.thankYouStatus !== "PENDING").length;
  const phase9 = (tasks.data ?? []).filter((t) => t.status !== "CANCELLED");
  const rented = phase9.filter((t) => RENTED.test(t.title));
  const otherTasks = phase9.filter((t) => !RENTED.test(t.title));
  const vendorRows = vendors.data ?? [];
  const vendorPending = vendorRows.reduce((a, v) => a + v.deliveries.length + v.clauses.filter((c) => c.party === "VENDOR").length, 0);

  // Progresso geral: cada pendência resolvida conta igual
  const parts = [
    ...(canFinance ? [{ done: depositRows.length - pendingDeposits.length, total: depositRows.length }, { done: 0, total: openRows.length }, { done: thanksDone, total: giftRows.length }] : []),
    ...(canVendors ? [{ done: 0, total: vendorPending }] : []),
    { done: phase9.filter((t) => t.status === "DONE").length, total: phase9.length },
  ];
  const total = parts.reduce((a, p) => a + p.total, 0);
  const done = parts.reduce((a, p) => a + Math.min(p.done, p.total), 0);
  const pct = total ? Math.round((done / total) * 100) : 100;

  const loading = tasks.isLoading || (canFinance && (summary.isLoading || deposits.isLoading || open.isLoading || gifts.isLoading)) || (canVendors && vendors.isLoading);
  const giftsReceived = giftRows.filter((g) => g.status === "CONFIRMED").reduce((a, g) => a + (g.amountCents ?? 0), 0);
  const s = summary.data;

  async function finalReport() {
    setPdf(true);
    try {
      await downloadReportPdf({
        title: "Relatório final do casamento",
        subtitle: "Encerramento do planejamento: finanças, presentes e pendências.",
        wedding: wedding ? { names: `${wedding.partner1Name} & ${wedding.partner2Name}`, date: wedding.date } : undefined,
        kpis: [
          ...(s ? [{ label: "Gasto efetivo", value: money(s.effectiveSpent) }, { label: "Contratado", value: money(s.contracted) }, { label: "Cauções recuperadas", value: money(s.depositRefunded) }] : []),
          { label: "Presentes recebidos", value: money(giftsReceived) },
        ],
        columns: [{ label: "Área", flex: 1 }, { label: "Item", flex: 2.4 }, { label: "Situação", flex: 1.2 }, { label: "Valor", align: "right", flex: 1 }],
        rows: [
          ...pendingDeposits.map((d) => ["Caução", `${d.description} · ${d.obligationTitle}`, "a recuperar", money(d.pending)]),
          ...openRows.map((o) => ["Pagamento", `${o.title}${o.vendor ? ` · ${o.vendor}` : ""}`, o.overdue ? "vencido" : `vence ${date(o.dueDate)}`, money(o.remaining)]),
          ...giftRows.map((g) => ["Presente", `${g.giverName} · ${g.what}`, { PENDING: "agradecer", SENT: "agradecido", NOT_NEEDED: "dispensado" }[g.thankYouStatus], g.amountCents ? money(g.amountCents) : "—"]),
          ...vendorRows.flatMap((v) => [...v.deliveries.map((d) => ["Fornecedor", `${v.name} · ${d.description}`, "entrega pendente", "—"]), ...v.clauses.map((c) => ["Fornecedor", `${v.name} · ${c.description}`, c.party === "VENDOR" ? "obrigação do fornecedor" : "obrigação do casal", "—"])]),
          ...phase9.map((t) => ["Tarefa", t.title, t.status === "DONE" ? "concluída" : "pendente", "—"]),
        ],
        note: `Progresso do encerramento: ${pct}%.`,
        fileName: `relatorio-final-${new Date().toISOString().slice(0, 10)}`,
      });
    } catch (e) {
      toast.error(`Não foi possível gerar o PDF: ${(e as Error).message}`);
    } finally {
      setPdf(false);
    }
  }

  return (
    <>
      <PageHeader title="Encerramento" description="Tudo o que falta depois da festa: cauções, últimos pagamentos, agradecimentos, fornecedores e devoluções." />
      {loading ? <PageLoader /> : (
        <div className="space-y-5">
          <div className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-soft md:p-6">
            <div className="bg-glow absolute inset-0" />
            <div className="relative flex flex-wrap items-center gap-6">
              <Ring value={pct} size={132} stroke={11}>
                <div className="text-center">
                  <div className="font-sans text-3xl font-semibold tracking-tight tabular-nums">{pct}%</div>
                  <div className="text-[11px] text-muted-foreground">concluído</div>
                </div>
              </Ring>
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-semibold">{pct === 100 ? "Tudo resolvido 🎉" : "Encerrar o planejamento"}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{total - done} pendência(s) de {total}. Quando chegar a 100%, baixe o relatório final para guardar.</p>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {s && <Kpi label="Gasto efetivo" value={<Money value={s.effectiveSpent} size="md" />} />}
                  {canFinance && <Kpi label="Presentes recebidos" value={<Money value={giftsReceived} size="md" />} />}
                  {s && <Kpi label="Cauções recuperadas" value={<Money value={s.depositRefunded} size="md" />} />}
                  {s && <Kpi label="Ainda a recuperar" value={<Money value={s.depositPending} size="md" />} />}
                </div>
              </div>
              <LoadingButton variant="outline" loading={pdf} onClick={finalReport}>{!pdf && <FileDown />} Baixar relatório final (PDF)</LoadingButton>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            {canFinance && (
              <Block icon={<HandCoins />} title="Cauções a recuperar" done={depositRows.length - pendingDeposits.length} total={depositRows.length} hint={pendingDeposits.length ? `${money(pendingDeposits.reduce((a, d) => a + d.pending, 0))} pendentes` : undefined} action={<Button asChild size="sm" variant="ghost"><Link to="/financeiro/caucoes">Gerenciar <ArrowRight /></Link></Button>}>
                {depositRows.length ? (
                  <ul className="divide-y">
                    {depositRows.map((d) => (
                      <li key={d.itemId} className="flex items-center gap-3 py-2.5 text-sm">
                        <div className="min-w-0 flex-1">
                          <Link to={`/financeiro/lancamentos/${d.obligationId}`} className="font-medium hover:underline">{d.description}</Link>
                          <div className="text-xs text-muted-foreground">{d.obligationTitle}{d.vendor ? ` · ${d.vendor}` : ""}</div>
                        </div>
                        {d.pending > 0 ? <Money value={d.pending} size="sm" /> : <StatusBadge tone="emerald">recuperada</StatusBadge>}
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-muted-foreground">Nenhuma caução paga.</p>}
              </Block>
            )}

            {canFinance && (
              <Block icon={<Wallet />} title="Pagamentos finais" done={0} total={openRows.length} hint={openRows.length ? `${money(openRows.reduce((a, o) => a + o.remaining, 0))} em aberto` : undefined} action={openRows.length > 0 && <Button asChild size="sm"><Link to="/financeiro/pagar">Pagar <ArrowRight /></Link></Button>}>
                {openRows.length ? (
                  <ul className="divide-y">
                    {openRows.slice(0, 8).map((o) => (
                      <li key={o.id} className="flex items-center gap-3 py-2.5 text-sm">
                        <div className="min-w-0 flex-1">
                          <Link to={`/financeiro/lancamentos/${o.obligationId}`} className="font-medium hover:underline">{o.title}</Link>
                          <div className={cn("text-xs", o.overdue ? "font-medium text-destructive" : "text-muted-foreground")}>{o.vendor ? `${o.vendor} · ` : ""}{o.overdue ? "vencida em " : "vence "}{date(o.dueDate)}</div>
                        </div>
                        <Money value={o.remaining} size="sm" />
                      </li>
                    ))}
                    {openRows.length > 8 && <li className="pt-2 text-xs text-muted-foreground">e mais {openRows.length - 8}…</li>}
                  </ul>
                ) : <p className="text-sm text-muted-foreground">Nenhum pagamento em aberto. 🙌</p>}
              </Block>
            )}
          </div>

          {canFinance && (
            <Block icon={<HeartHandshake />} title="Agradecimentos" done={thanksDone} total={giftRows.length} hint="quem deu o quê e se já agradecemos">
              <ThankYous gifts={giftRows} canEdit={can("finance:edit")} canWhats={can("whatsapp:approve")} />
            </Block>
          )}

          <div className="grid gap-5 xl:grid-cols-2">
            {canVendors && (
              <Block icon={<Store />} title="Pendências com fornecedores" done={0} total={vendorPending} hint={vendorRows.length ? `${vendorRows.length} fornecedor(es)` : undefined}>
                {vendorRows.length ? (
                  <ul className="space-y-3">
                    {vendorRows.map((v) => (
                      <li key={v.id} className="rounded-lg border p-3">
                        <Link to={`/fornecedores/${v.id}`} className="text-sm font-medium hover:underline">{v.name}</Link>
                        <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                          {v.deliveries.map((d) => <li key={d.id} className="flex gap-2"><PackageCheck className="size-3.5 shrink-0" /> Entrega: {d.description}{d.dueAt ? ` · até ${date(d.dueAt)}` : ""}</li>)}
                          {v.clauses.map((c) => <li key={c.id} className="flex gap-2"><ClipboardCheck className="size-3.5 shrink-0" /> {c.party === "VENDOR" ? "Fornecedor deve" : "Vocês devem"}: {c.description}{c.dueDate ? ` · ${date(c.dueDate)}` : ""}</li>)}
                        </ul>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-muted-foreground">Nenhuma entrega ou obrigação contratual em aberto.</p>}
              </Block>
            )}

            <Block icon={<Undo2 />} title="Itens alugados a devolver" done={rented.filter((t) => t.status === "DONE").length} total={rented.length} hint="tarefas do pós-casamento sobre devoluções">
              <TaskList tasks={rented} onToggle={(id, on) => setTask.mutate({ id, status: on ? "DONE" : "NOT_STARTED" })} canEdit={can("planning:edit")} empty="Nenhuma tarefa de devolução. Crie no checklist (fase 9) — ex.: “Devolver trajes alugados”." />
            </Block>
          </div>

          <Block icon={<ClipboardCheck />} title="Tarefas do pós-casamento" done={otherTasks.filter((t) => t.status === "DONE").length} total={otherTasks.length} action={<Button asChild size="sm" variant="ghost"><Link to="/checklist?fase=9">Checklist <ArrowRight /></Link></Button>}>
            <TaskList tasks={otherTasks} onToggle={(id, on) => setTask.mutate({ id, status: on ? "DONE" : "NOT_STARTED" })} canEdit={can("planning:edit")} empty="Sem tarefas na fase 9. Gere pelo modelo de checklist." />
          </Block>
        </div>
      )}
    </>
  );
}

function Kpi({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border bg-card/70 p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1">{value}</div>
    </div>
  );
}

function TaskList({ tasks, onToggle, canEdit, empty }: { tasks: RouterOutputs["planning"]["tasks"]; onToggle: (id: string, on: boolean) => void; canEdit: boolean; empty: string }) {
  if (!tasks.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y">
      {tasks.map((t) => {
        const on = t.status === "DONE";
        const late = !on && t.dueDate && new Date(t.dueDate) < new Date();
        return (
          <li key={t.id} className="flex items-center gap-3 py-2.5">
            <Checkbox checked={on} disabled={!canEdit} onCheckedChange={(v) => onToggle(t.id, !!v)} aria-label={`Concluir ${t.title}`} />
            <Link to={`/checklist?tarefa=${t.id}`} className={cn("min-w-0 flex-1 truncate text-sm hover:underline", on && "text-muted-foreground line-through")}>{t.title}</Link>
            {t.dueDate && <span className={cn("text-xs tabular-nums", late ? "font-medium text-destructive" : "text-muted-foreground")}>{date(t.dueDate)}</span>}
          </li>
        );
      })}
    </ul>
  );
}
