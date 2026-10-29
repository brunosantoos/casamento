import { ArrowLeft, Ban, CheckCircle2, Coins, History, Landmark, Paperclip, Pencil, Plus, RotateCcw, Undo2, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog, ErrorState, Field, LoadingButton, MoneyInput, PageLoader, StatusBadge, TextField } from "@/components/app/common";
import { FileList, UploadButton } from "@/components/app/files";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { date, dateTime, fromDateInput, money, toDateInput } from "@/lib/format";
import { CHARGE_TYPE, INCOME_STATUS, INSTALLMENT_STATUS, ITEM_STATUS, OBLIGATION_STATUS, PAYMENT_METHOD } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { trpc, type RouterOutputs } from "@/trpc";
import { Avatar, Bar, dueLabel, emptyIncome, FinanceNav, ForfeitDialog, IncomeDialog, KindBadge, Money, NativeSelect, PaymentDialog, ReasonDialog, Ring, useCanFinance } from "./shared";
import { METHOD_ICON } from "./Payments";

type O = RouterOutputs["finance"]["obligation"];

function GenerateDialog({ o, open, onOpenChange }: { o: O; open: boolean; onOpenChange: (v: boolean) => void }) {
  const utils = trpc.useUtils();
  const [count, setCount] = useState("1");
  const [first, setFirst] = useState(toDateInput(new Date()));
  const [interval, setInterval] = useState("1");
  const [itemId, setItemId] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const deposits = o.items.filter((i) => i.kind === "DEPOSIT" && i.status !== "CANCELLED");
  const item = o.items.find((i) => i.id === itemId);
  const suggested = item ? o.itemTotals[item.id] ?? 0 : o.summary.unscheduled;
  useEffect(() => {
    if (open) {
      setCount("1");
      setItemId("");
      setAmount(null);
    }
  }, [open]);
  const m = trpc.finance.generateInstallments.useMutation({
    onSuccess: async () => {
      toast.success("Parcelas geradas");
      await utils.finance.invalidate();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const n = Number(count);
  const total = amount ?? suggested;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Gerar parcelas</DialogTitle>
          <DialogDescription>Divide o valor em parcelas mensais; a diferença de centavos fica nas primeiras. Cauções precisam de parcela dedicada ao item, para controlar a devolução.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Referente a" className="sm:col-span-2">
            <NativeSelect value={itemId} onChange={(v) => { setItemId(v); setAmount(null); }} placeholder={`Saldo sem parcela (${money(o.summary.unscheduled)})`} options={o.items.filter((i) => i.status !== "CANCELLED").map((i) => ({ value: i.id, label: `${i.kind === "DEPOSIT" ? "[Caução] " : ""}${i.description} — ${money(o.itemTotals[i.id] ?? 0)}` }))} />
          </Field>
          <Field label="Valor total a parcelar"><MoneyInput value={total} onChange={setAmount} /></Field>
          <Field label="Número de parcelas"><Input type="number" min={1} max={60} value={count} onChange={(e) => setCount(e.target.value)} /></Field>
          <Field label="1º vencimento"><Input type="date" value={first} onChange={(e) => setFirst(e.target.value)} /></Field>
          <Field label="Intervalo (meses)"><Input type="number" min={1} max={12} value={interval} onChange={(e) => setInterval(e.target.value)} /></Field>
        </div>
        {deposits.length > 0 && !itemId && <p className="text-xs text-amber-700 dark:text-amber-300">Há caução neste lançamento: gere a parcela dela selecionando o item da caução.</p>}
        {n >= 1 && total > 0 && <p className="text-sm text-muted-foreground">{n}× de aprox. {money(Math.trunc(total / n))}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <LoadingButton loading={m.isPending} disabled={!(n >= 1 && n <= 60) || !first || total <= 0} onClick={() => m.mutate({ obligationId: o.id, count: n, firstDue: fromDateInput(first)!, intervalMonths: Number(interval) || 1, itemId: itemId || null, amountCents: total })}>Gerar</LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InstallmentDialog({ o, inst, open, onOpenChange }: { o: O; inst: O["installments"][number] | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const utils = trpc.useUtils();
  const [amount, setAmount] = useState<number | null>(null);
  const [due, setDue] = useState("");
  const [itemId, setItemId] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (!open) return;
    setAmount(inst?.amountCents ?? null);
    setDue(toDateInput(inst?.dueDate ?? new Date()));
    setItemId(inst?.itemId ?? "");
    setNotes(inst?.notes ?? "");
  }, [open, inst]);
  const m = trpc.finance.saveInstallment.useMutation({
    onSuccess: async () => {
      toast.success("Parcela salva");
      await utils.finance.invalidate();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{inst ? `Editar parcela ${inst.number}` : "Nova parcela"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Valor previsto"><MoneyInput value={amount} onChange={setAmount} /></Field>
          <Field label="Vencimento"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          <Field label="Item (opcional)" className="sm:col-span-2"><NativeSelect value={itemId} onChange={setItemId} placeholder="Geral" options={o.items.map((i) => ({ value: i.id, label: i.description }))} /></Field>
          <TextField className="sm:col-span-2" label="Observações" value={notes} onChange={setNotes} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <LoadingButton loading={m.isPending} disabled={!amount || amount <= 0 || !due} onClick={() => m.mutate({ id: inst?.id, obligationId: o.id, itemId: itemId || null, amountCents: amount!, dueDate: fromDateInput(due)!, notes: notes || null })}>Salvar</LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ObligationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const perm = useCanFinance();
  const q = trpc.finance.obligation.useQuery({ id: id! });
  const [dialog, setDialog] = useState<null | "generate" | "pay" | "cancel" | "draft" | "activate" | "installment">(null);
  const [editInst, setEditInst] = useState<O["installments"][number] | null>(null);
  const [cancelInst, setCancelInst] = useState<string | null>(null);
  const [reverse, setReverse] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<string[]>([]);
  const [refund, setRefund] = useState<string | null>(null);
  const [forfeit, setForfeit] = useState<{ itemId: string; description: string; paid: number; forfeited: number } | null>(null);

  const onErr = (e: { message: string }) => toast.error(e.message);
  const invalidate = () => utils.finance.invalidate();
  const setStatus = trpc.finance.setObligationStatus.useMutation({ onSuccess: async () => { toast.success("Situação atualizada"); setDialog(null); await invalidate(); }, onError: onErr });
  const cancelI = trpc.finance.cancelInstallment.useMutation({ onSuccess: async () => { toast.success("Parcela cancelada"); setCancelInst(null); await invalidate(); }, onError: onErr });
  const rev = trpc.finance.reversePayment.useMutation({ onSuccess: async () => { toast.success("Pagamento estornado"); setReverse(null); await invalidate(); }, onError: onErr });

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const o = q.data;
  const s = o.summary;
  const instStatus = new Map(s.installments.map((i) => [i.id, i]));
  const openInst = o.installments
    .map((i) => ({ i, st: instStatus.get(i.id)! }))
    .filter((x) => x.st && x.st.remaining > 0)
    .map((x) => ({ id: x.i.id, label: `Parcela ${x.i.number}${x.i.itemId ? ` · ${o.items.find((it) => it.id === x.i.itemId)?.description}` : ""}`, dueDate: x.i.dueDate, remaining: x.st.remaining, overdue: x.st.overdue }));
  const paymentsCount = new Set(o.installments.flatMap((i) => i.allocations.map((a) => a.payment.id))).size;
  const cancelled = o.status === "CANCELLED";
  const base = (o.status === "ACTIVE" ? s.contracted : s.planned) + s.depositsContracted;
  const pct = base ? Math.round((s.paid / base) * 100) : 0;
  const DOT: Record<string, string> = { PAID: "bg-emerald-500", PARTIAL: "bg-amber-500", OVERDUE: "bg-destructive", UPCOMING: "bg-primary", PLANNED: "bg-muted-foreground/40", CANCELLED: "bg-muted-foreground/30" };

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2"><Link to="/financeiro/lancamentos"><ArrowLeft /> Lançamentos</Link></Button>
      <section className="relative mb-4 overflow-hidden rounded-xl border bg-card shadow-soft animate-in fade-in slide-in-from-bottom-1 duration-300">
        <div className="bg-glow absolute inset-0" />
        <div className="relative grid gap-6 p-5 md:grid-cols-[1fr_auto] md:p-6">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <Avatar name={o.vendor?.name ?? o.title} className="size-11 text-sm" />
              <div className="min-w-0">
                <div className="truncate text-xs font-medium tracking-wide text-primary uppercase">{[o.category?.name, o.vendor?.name].filter(Boolean).join(" · ") || "Lançamento"}</div>
                <h1 className="flex flex-wrap items-center gap-2 text-2xl leading-tight font-semibold md:text-[28px]">{o.title}<StatusBadge tone={OBLIGATION_STATUS[o.status]?.tone}>{OBLIGATION_STATUS[o.status]?.label}</StatusBadge></h1>
              </div>
            </div>
            {(o.cancelReason || o.notes) && <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{o.cancelReason ? `Cancelado: ${o.cancelReason}` : o.notes}</p>}
            <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              <div><div className="text-xs text-muted-foreground">{o.status === "ACTIVE" ? "Contratado" : "Previsto"}</div><Money value={o.status === "ACTIVE" ? s.contracted : s.planned} size="xl" className="mt-1 block" />{s.depositsContracted > 0 && <div className="mt-1 text-xs text-muted-foreground">+ {money(s.depositsContracted)} caução</div>}</div>
              <div><div className="text-xs text-muted-foreground">Pago</div><Money value={s.paid} size="xl" className="mt-1 block text-emerald-600 dark:text-emerald-400" /><div className="mt-1 text-xs text-muted-foreground">gasto efetivo {money(s.effectiveSpent)}</div></div>
              <div><div className="text-xs text-muted-foreground">Em aberto</div><Money value={s.open} size="xl" className="mt-1 block" />{s.overdue > 0 && <div className="mt-1 text-xs font-medium text-destructive">{money(s.overdue)} vencido</div>}</div>
              <div><div className="text-xs text-muted-foreground">Cauções a recuperar</div><Money value={s.depositPending} size="xl" className="mt-1 block" /><div className="mt-1 text-xs text-muted-foreground">não reembolsável {money(s.nonRefundable)}</div></div>
            </div>
          </div>
          <div className="flex items-center justify-center md:flex-col md:justify-start">
            <Ring value={pct} size={128} stroke={11}>
              <div><div className="font-sans text-2xl font-semibold tabular-nums">{pct}%</div><div className="text-[11px] text-muted-foreground">quitado</div></div>
            </Ring>
          </div>
        </div>
        {!cancelled && (
          <div className="relative flex flex-wrap gap-2 border-t bg-card/60 px-5 py-3 md:px-6">
            {perm.create && o.status === "ACTIVE" && openInst.length > 0 && <Button onClick={() => { setPayFor([]); setDialog("pay"); }}><Wallet /> Registrar pagamento</Button>}
            {perm.approve && o.status === "DRAFT" && <Button onClick={() => setDialog("activate")}><CheckCircle2 /> Fechar contratação</Button>}
            {perm.edit && <Button variant="outline" onClick={() => navigate(`/financeiro/lancamentos/${o.id}/editar`)}><Pencil /> Editar</Button>}
            {perm.approve && o.status === "ACTIVE" && <Button variant="outline" onClick={() => setDialog("draft")}><Undo2 /> Voltar p/ rascunho</Button>}
            {perm.approve && <Button variant="ghost" className="text-destructive hover:text-destructive md:ml-auto" onClick={() => setDialog("cancel")}><Ban /> Cancelar lançamento</Button>}
          </div>
        )}
      </section>
      <FinanceNav />

      {s.unscheduled > 0 && !cancelled && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/8 px-4 py-3 text-sm animate-in fade-in">
          <Coins className="size-4 text-amber-600" />
          <span className="flex-1"><b>{money(s.unscheduled)}</b> contratado ainda sem parcelas — não aparece no fluxo de caixa nem em contas a pagar.</span>
          {perm.edit && <Button size="sm" onClick={() => setDialog("generate")}>Gerar parcelas</Button>}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <div className="space-y-5">
          <section className="rounded-xl border bg-card shadow-soft">
            <div className="flex items-center justify-between px-5 pt-5 pb-3"><h2 className="text-base font-semibold">Itens</h2><span className="text-xs text-muted-foreground">{o.items.length} item(ns)</span></div>
            <ul className="divide-y">
              {o.items.map((i) => (
                <li key={i.id} className={cn("flex flex-wrap items-center gap-3 px-5 py-3", i.status === "CANCELLED" && "opacity-50")}>
                  <div className="min-w-0 flex-1">
                    <div className={cn("flex items-center gap-2 font-medium", i.status === "CANCELLED" && "line-through")}>{i.description} <KindBadge kind={i.kind} /></div>
                    <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">{money(i.unitCents)} × {String(i.quantity)}{i.discountCents ? ` − ${money(i.discountCents)}` : ""}{i.surchargeCents ? ` + ${money(i.surchargeCents)}` : ""} · {CHARGE_TYPE[i.chargeType]}{i.dueDate ? ` · prev. ${date(i.dueDate)}` : ""}{i.notes ? ` · ${i.notes}` : ""}</div>
                  </div>
                  <StatusBadge tone={ITEM_STATUS[i.status]?.tone}>{ITEM_STATUS[i.status]?.label}</StatusBadge>
                  <Money value={o.itemTotals[i.id] ?? 0} size="md" className="w-28 text-right" />
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-6 border-t px-5 py-3 text-sm">
              <span className="text-muted-foreground">Despesas <Money value={o.status === "ACTIVE" ? s.contracted : s.planned} size="sm" className="ml-1 text-foreground" /></span>
              {s.depositsContracted > 0 && <span className="text-muted-foreground">Cauções <Money value={s.depositsContracted} size="sm" className="ml-1 text-foreground" /></span>}
            </div>
          </section>

          <section className="rounded-xl border bg-card p-5 shadow-soft">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div><h2 className="text-base font-semibold">Parcelas e pagamentos</h2><p className="text-xs text-muted-foreground">{o.status === "DRAFT" ? "Rascunho: parcelas ficam como previstas até a contratação ser fechada." : `${paymentsCount} pagamento(s) · estornos preservam o histórico`}</p></div>
              {!cancelled && perm.edit && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setDialog("generate")}><Coins /> Gerar parcelas</Button>
                  <Button size="sm" variant="outline" onClick={() => { setEditInst(null); setDialog("installment"); }}><Plus /> Parcela</Button>
                </div>
              )}
            </div>
            {o.installments.length ? (
              <ol className="relative ml-1 space-y-4 border-l pl-6">
                {o.installments.map((i) => {
                  const st = instStatus.get(i.id);
                  const paid = i.allocations.filter((a) => !a.payment.reversedAt).reduce((a, x) => a + x.amountCents, 0);
                  const p = i.amountCents ? (paid / i.amountCents) * 100 : 0;
                  return (
                    <li key={i.id} className={cn("group relative", i.cancelledAt && "opacity-50")}>
                      <span className={cn("absolute top-1.5 -left-[31px] size-3 rounded-full ring-4 ring-card transition group-hover:scale-125", DOT[st?.status ?? "PLANNED"])} />
                      <div className="flex flex-wrap items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold">Parcela {i.number}</span>
                            {st && <StatusBadge tone={INSTALLMENT_STATUS[st.status]?.tone}>{INSTALLMENT_STATUS[st.status]?.label}{st.status === "PARTIAL" && st.overdue ? " · vencida" : ""}</StatusBadge>}
                            {i.itemId && <span className="text-xs text-muted-foreground">· {o.items.find((x) => x.id === i.itemId)?.description}</span>}
                          </div>
                          <div className={cn("mt-0.5 text-xs text-muted-foreground", st?.overdue && "font-medium text-destructive")}>Vence {date(i.dueDate)}{(st?.remaining ?? 0) > 0 ? ` · ${dueLabel(i.dueDate)}` : ""}{i.notes ? ` · ${i.notes}` : ""}</div>
                          <Bar value={p} className="mt-2 max-w-64" />
                        </div>
                        <div className="text-right">
                          <Money value={i.amountCents} size="md" />
                          {(st?.remaining ?? 0) > 0 && paid > 0 && <div className="text-xs text-muted-foreground">saldo {money(st!.remaining)}</div>}
                        </div>
                        {!i.cancelledAt && !cancelled && (
                          <div className="flex items-center gap-1">
                            {perm.create && o.status === "ACTIVE" && (st?.remaining ?? 0) > 0 && <Button size="xs" onClick={() => { setPayFor([i.id]); setDialog("pay"); }}>Pagar</Button>}
                            {perm.edit && <Button size="icon-xs" variant="ghost" aria-label="Editar parcela" onClick={() => { setEditInst(i); setDialog("installment"); }}><Pencil /></Button>}
                            {perm.edit && paid === 0 && <Button size="icon-xs" variant="ghost" aria-label="Cancelar parcela" onClick={() => setCancelInst(i.id)}><Ban /></Button>}
                          </div>
                        )}
                      </div>
                      {i.allocations.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {i.allocations.map((a) => {
                            const I = METHOD_ICON[a.payment.method] ?? Wallet;
                            return (
                              <li key={a.id} className={cn("flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-1.5 text-xs", a.payment.reversedAt && "opacity-60")}>
                                <I className="size-3.5 text-emerald-600" />
                                <span className={cn("flex-1", a.payment.reversedAt && "line-through")}>Pago em {date(a.payment.paidAt)} · {PAYMENT_METHOD[a.payment.method]}{a.payment.reference ? ` · ${a.payment.reference}` : ""}</span>
                                {a.payment.reversedAt && <StatusBadge tone="rose">Estornado</StatusBadge>}
                                <Money value={a.amountCents} size="sm" className={cn("text-xs", a.payment.reversedAt && "line-through")} />
                                {!a.payment.reversedAt && perm.approve && <Button size="xs" variant="ghost" onClick={() => setReverse(a.payment.id)}><RotateCcw /> Estornar</Button>}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">Nenhuma parcela. Use “Gerar parcelas” para dividir o valor contratado.</div>
            )}
          </section>
        </div>

        <div className="space-y-5">
          {s.deposits.length > 0 && (
            <section className="rounded-xl border bg-card p-5 shadow-soft">
              <div className="mb-3 flex items-center gap-2"><Landmark className="size-4 text-amber-600" /><h2 className="text-base font-semibold">Cauções</h2></div>
              <p className="mb-3 text-xs text-muted-foreground">Desembolso, direito de devolução e devolução registrados separadamente.</p>
              <ul className="space-y-3">
                {s.deposits.map((d) => {
                  const item = o.items.find((i) => i.id === d.itemId)!;
                  const refunds = o.refunds.filter((r) => r.depositItemId === d.itemId);
                  return (
                    <li key={d.itemId} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-2"><span className="font-medium">{item.description}</span><Money value={d.pending} size="md" className={cn(d.pending > 0 && "text-amber-600 dark:text-amber-400")} /></div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                        <div><div className="text-muted-foreground">Pago</div><Money value={d.paid} size="sm" /></div>
                        <div><div className="text-muted-foreground">Devolvido</div><Money value={d.refunded} size="sm" /></div>
                        <div><div className="text-muted-foreground">Retido</div><Money value={d.forfeited} size="sm" /></div>
                      </div>
                      {refunds.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">{refunds.map((r) => <li key={r.id} className="flex items-center gap-1.5">{money(r.amountCents)} <StatusBadge tone={INCOME_STATUS[r.status]?.tone}>{INCOME_STATUS[r.status]?.label}</StatusBadge> {r.receivedAt ? `em ${date(r.receivedAt)}` : r.expectedDate ? `previsto ${date(r.expectedDate)}` : ""}</li>)}</ul>}
                      <div className="mt-3 flex gap-1">
                        {perm.create && d.pending > 0 && <Button size="xs" variant="outline" onClick={() => setRefund(d.itemId)}>Registrar devolução</Button>}
                        {perm.approve && d.paid > 0 && <Button size="xs" variant="ghost" onClick={() => setForfeit({ itemId: d.itemId, description: item.description, paid: d.paid, forfeited: d.forfeited })}>Retenção</Button>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section className="rounded-xl border bg-card p-5 shadow-soft">
            <div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 text-base font-semibold"><Paperclip className="size-4 text-muted-foreground" />Comprovantes e arquivos</h2>{perm.create && <UploadButton size="sm" category="RECEIPT" entityType="obligation" entityId={o.id} onUploaded={() => q.refetch()} accept="application/pdf,image/*" label="Enviar" />}</div>
            <FileList files={o.files} onChanged={() => q.refetch()} emptyText="Nenhum comprovante anexado." />
          </section>

          <section className="rounded-xl border bg-card p-5 shadow-soft">
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold"><History className="size-4 text-muted-foreground" />Atividade</h2>
            {o.history.length ? (
              <ol className="relative space-y-3 border-l pl-4">
                {o.history.map((h) => (
                  <li key={h.id} className="relative text-sm">
                    <span className="absolute top-1.5 -left-[20.5px] size-2 rounded-full bg-primary/60 ring-4 ring-card" />
                    <div className="leading-snug">{h.summary}</div>
                    <div className="text-xs text-muted-foreground">{dateTime(h.createdAt)} · {h.userName ?? "sistema"}</div>
                  </li>
                ))}
              </ol>
            ) : <p className="text-sm text-muted-foreground">Sem registros.</p>}
          </section>
        </div>
      </div>

      <GenerateDialog o={o} open={dialog === "generate"} onOpenChange={(v) => setDialog(v ? "generate" : null)} />
      <InstallmentDialog o={o} inst={editInst} open={dialog === "installment"} onOpenChange={(v) => setDialog(v ? "installment" : null)} />
      <PaymentDialog open={dialog === "pay"} onOpenChange={(v) => setDialog(v ? "pay" : null)} installments={openInst} preselected={payFor.length ? payFor : openInst.slice(0, 1).map((i) => i.id)} />
      <ConfirmDialog open={dialog === "activate"} onOpenChange={(v) => setDialog(v ? "activate" : null)} title="Fechar contratação?" description="Itens previstos passam a contratados e as parcelas entram em contas a pagar." confirmLabel="Fechar contratação" loading={setStatus.isPending} onConfirm={() => setStatus.mutate({ id: o.id, status: "ACTIVE" })} />
      <ConfirmDialog open={dialog === "draft"} onOpenChange={(v) => setDialog(v ? "draft" : null)} title="Voltar para rascunho?" description="Só é possível se não houver pagamentos válidos. As parcelas voltam a ser apenas previstas." confirmLabel="Voltar para rascunho" loading={setStatus.isPending} onConfirm={() => setStatus.mutate({ id: o.id, status: "DRAFT" })} />
      <ReasonDialog open={dialog === "cancel"} onOpenChange={(v) => setDialog(v ? "cancel" : null)} title="Cancelar lançamento" description="Os valores deixam de contar como previstos/contratados e o saldo em aberto é zerado. O que já foi pago continua registrado." confirmLabel="Cancelar lançamento" loading={setStatus.isPending} onConfirm={(reason) => setStatus.mutate({ id: o.id, status: "CANCELLED", reason })} />
      <ConfirmDialog open={!!cancelInst} onOpenChange={(v) => !v && setCancelInst(null)} title="Cancelar parcela?" description="A parcela deixa de compor o saldo em aberto." destructive confirmLabel="Cancelar parcela" loading={cancelI.isPending} onConfirm={() => cancelInst && cancelI.mutate({ id: cancelInst })} />
      <ReasonDialog open={!!reverse} onOpenChange={(v) => !v && setReverse(null)} title="Estornar pagamento" description="O pagamento inteiro (todas as parcelas que ele cobre) deixa de contar. O registro permanece no histórico." confirmLabel="Estornar" loading={rev.isPending} onConfirm={(reason) => reverse && rev.mutate({ id: reverse, reason })} />
      <IncomeDialog open={!!refund} onOpenChange={(v) => !v && setRefund(null)} lockDeposit initial={emptyIncome({ kind: "DEPOSIT_REFUND", status: "RECEIVED", depositItemId: refund ?? "", receivedAt: toDateInput(new Date()), amountCents: s.deposits.find((d) => d.itemId === refund)?.pending ?? null, description: `Devolução de caução — ${o.title}` })} />
      <ForfeitDialog open={!!forfeit} onOpenChange={(v) => !v && setForfeit(null)} deposit={forfeit} />
    </>
  );
}
