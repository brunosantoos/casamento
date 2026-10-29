import { Archive, ArchiveRestore, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Banknote, Building2, CreditCard, Info, LineChart, Pencil, PiggyBank, Plus, RotateCcw, SlidersHorizontal, Star, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { EmptyState, ErrorState, Field, LoadingButton, MoneyInput, PageLoader, StatusBadge, TextField } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { date, fromDateInput, money, newKey, toDateInput } from "@/lib/format";
import { PAYMENT_METHOD } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { trpc, type RouterOutputs } from "@/trpc";
import { Cell2, DataTable, FinanceShell, Money, NativeSelect, opts, ReasonDialog, useCanFinance, WALLET_KIND } from "./shared";

type W = RouterOutputs["finance"]["wallets"]["wallets"][number];
type Mv = RouterOutputs["finance"]["walletStatement"]["movements"][number];

const KIND_ICON: Record<string, typeof Wallet> = { CHECKING: Building2, SAVINGS: PiggyBank, CASH: Banknote, CREDIT_CARD: CreditCard, INVESTMENT: LineChart, OTHER: Wallet };
const COLORS = ["#7c2d3e", "#b45309", "#0f766e", "#1d4ed8", "#6d28d9", "#be185d", "#334155", "#15803d"];
const MV_LABEL: Record<string, string> = { opening: "Saldo inicial", payment: "Pagamento", income: "Entrada", adjustment: "Ajuste", transfer: "Transferência" };

// ───────────── Diálogos ─────────────

function WalletDialog({ open, onOpenChange, wallet }: { open: boolean; onOpenChange: (o: boolean) => void; wallet: W | null }) {
  const [f, setF] = useState({ name: "", kind: "CHECKING", color: COLORS[0]!, opening: 0 as number | null, openingDate: toDateInput(new Date()), isDefault: false });
  const utils = trpc.useUtils();
  useEffect(() => {
    if (!open) return;
    setF(wallet
      ? { name: wallet.name, kind: wallet.kind, color: wallet.color ?? COLORS[0]!, opening: wallet.openingBalanceCents, openingDate: toDateInput(wallet.openingDate), isDefault: wallet.isDefault }
      : { name: "", kind: "CHECKING", color: COLORS[0]!, opening: 0, openingDate: toDateInput(new Date()), isDefault: false });
  }, [open, wallet]);
  const m = trpc.finance.saveWallet.useMutation({ onSuccess: async () => { toast.success("Carteira salva"); await utils.finance.invalidate(); onOpenChange(false); }, onError: (e) => toast.error(e.message) });
  const invalid = f.name.trim().length < 2 || f.opening == null || !f.openingDate;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{wallet ? "Editar carteira" : "Nova carteira"}</DialogTitle>
          <DialogDescription>Informe quanto há nesta conta/carteira. Pagamentos debitam e entradas creditam o saldo automaticamente.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField className="sm:col-span-2" label="Nome" value={f.name} onChange={(v) => setF({ ...f, name: v })} placeholder="Ex.: Conta conjunta Nubank" />
          <Field label="Tipo"><NativeSelect value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={opts(WALLET_KIND)} /></Field>
          <Field label="Cor">
            <div className="flex flex-wrap gap-1.5 pt-1">
              {COLORS.map((c) => <button key={c} type="button" aria-label={c} onClick={() => setF({ ...f, color: c })} className={cn("size-7 rounded-full ring-offset-2 ring-offset-background transition hover:scale-110", f.color === c && "ring-2 ring-foreground/60")} style={{ background: c }} />)}
            </div>
          </Field>
          <Field label="Saldo inicial" hint={f.kind === "CREDIT_CARD" ? "No cartão, use o limite disponível ou 0" : undefined}><MoneyInput value={f.opening} onChange={(v) => setF({ ...f, opening: v })} /></Field>
          <Field label="Data do saldo"><Input type="date" value={f.openingDate} onChange={(e) => setF({ ...f, openingDate: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><Checkbox checked={f.isDefault} onCheckedChange={(v) => setF({ ...f, isDefault: !!v })} /> Usar como padrão nos pagamentos e entradas</label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <LoadingButton loading={m.isPending} disabled={invalid} onClick={() => m.mutate({ id: wallet?.id, name: f.name.trim(), kind: f.kind as never, color: f.color, openingBalanceCents: f.opening ?? 0, openingDate: fromDateInput(f.openingDate)!, isDefault: f.isDefault })}>Salvar</LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({ open, onOpenChange, wallets, fromId }: { open: boolean; onOpenChange: (o: boolean) => void; wallets: W[]; fromId: string }) {
  const [from, setFrom] = useState(fromId);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [desc, setDesc] = useState("");
  const [when, setWhen] = useState(toDateInput(new Date()));
  const [key, setKey] = useState(newKey());
  const utils = trpc.useUtils();
  useEffect(() => {
    if (!open) return;
    setFrom(fromId);
    setTo(wallets.find((w) => w.id !== fromId)?.id ?? "");
    setAmount(null);
    setDesc("");
    setWhen(toDateInput(new Date()));
    setKey(newKey());
  }, [open, fromId, wallets]);
  const m = trpc.finance.walletTransfer.useMutation({ onSuccess: async () => { toast.success("Transferência registrada"); await utils.finance.invalidate(); onOpenChange(false); }, onError: (e) => toast.error(e.message) });
  const src = wallets.find((w) => w.id === from);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Transferir entre carteiras</DialogTitle><DialogDescription>Move saldo de uma carteira para outra. Não conta como gasto nem como entrada.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="De"><NativeSelect value={from} onChange={setFrom} options={wallets.map((w) => ({ value: w.id, label: w.name }))} /></Field>
          <Field label="Para"><NativeSelect value={to} onChange={setTo} placeholder="Selecione…" options={wallets.filter((w) => w.id !== from).map((w) => ({ value: w.id, label: w.name }))} /></Field>
          <Field label="Valor" hint={src ? `Saldo em ${src.name}: ${money(src.balanceCents)}` : undefined}><MoneyInput value={amount} onChange={setAmount} /></Field>
          <Field label="Data"><Input type="date" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
          <TextField className="sm:col-span-2" label="Descrição (opcional)" value={desc} onChange={setDesc} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <LoadingButton loading={m.isPending} disabled={!to || !amount || amount <= 0 || from === to} onClick={() => m.mutate({ fromWalletId: from, toWalletId: to, amountCents: amount!, description: desc || null, occurredAt: fromDateInput(when)!, idempotencyKey: key })}>Transferir {money(amount ?? 0)}</LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustDialog({ open, onOpenChange, wallet }: { open: boolean; onOpenChange: (o: boolean) => void; wallet: W | null }) {
  const [sign, setSign] = useState<1 | -1>(1);
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [when, setWhen] = useState(toDateInput(new Date()));
  const [key, setKey] = useState(newKey());
  const utils = trpc.useUtils();
  useEffect(() => {
    if (!open) return;
    setSign(1);
    setAmount(null);
    setReason("");
    setWhen(toDateInput(new Date()));
    setKey(newKey());
  }, [open]);
  const m = trpc.finance.walletAdjust.useMutation({ onSuccess: async () => { toast.success("Ajuste registrado"); await utils.finance.invalidate(); onOpenChange(false); }, onError: (e) => toast.error(e.message) });
  const after = wallet ? wallet.balanceCents + sign * (amount ?? 0) : 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Ajuste de saldo · {wallet?.name}</DialogTitle><DialogDescription>Use para corrigir diferenças com o extrato do banco (tarifas, rendimentos, depósitos não ligados ao casamento).</DialogDescription></DialogHeader>
        <div className="flex rounded-lg border p-0.5">
          <button type="button" onClick={() => setSign(1)} className={cn("flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition", sign === 1 ? "bg-emerald-600 text-white shadow-sm" : "text-muted-foreground")}>+ Acrescentar</button>
          <button type="button" onClick={() => setSign(-1)} className={cn("flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition", sign === -1 ? "bg-destructive text-white shadow-sm" : "text-muted-foreground")}>− Retirar</button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Valor"><MoneyInput value={amount} onChange={setAmount} /></Field>
          <Field label="Data"><Input type="date" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
          <TextField className="sm:col-span-2" label="Motivo (obrigatório)" value={reason} onChange={setReason} />
        </div>
        {wallet && <div className="flex justify-between rounded-lg bg-muted/60 px-3 py-2 text-sm"><span className="text-muted-foreground">Saldo após o ajuste</span><Money value={after} size="sm" /></div>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <LoadingButton loading={m.isPending} disabled={!wallet || !amount || amount <= 0 || reason.trim().length < 3} onClick={() => wallet && m.mutate({ walletId: wallet.id, amountCents: sign * amount!, description: reason.trim(), occurredAt: fromDateInput(when)!, idempotencyKey: key })}>Registrar ajuste</LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Cartão ─────────────

function WalletCard({ w, active, onClick }: { w: W; active: boolean; onClick: () => void }) {
  const I = KIND_ICON[w.kind] ?? Wallet;
  const color = w.color ?? COLORS[0]!;
  return (
    <button type="button" onClick={onClick} className={cn("lift group relative overflow-hidden rounded-xl border bg-card p-4 text-left shadow-soft", active && "border-primary ring-2 ring-primary/20", w.archivedAt && "opacity-60")}>
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: color }} />
      <div className="absolute -top-10 -right-10 size-28 rounded-full opacity-10 transition group-hover:scale-125" style={{ background: color }} />
      <div className="relative flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-lg text-white transition group-hover:scale-110 group-hover:-rotate-6" style={{ background: color }}><I className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 truncate font-semibold">{w.name}{w.isDefault && <Star className="size-3.5 fill-amber-400 text-amber-400" aria-label="Padrão" />}</div>
          <div className="text-xs text-muted-foreground">{WALLET_KIND[w.kind]}{w.archivedAt ? " · arquivada" : ""}</div>
        </div>
      </div>
      <Money value={w.balanceCents} size="xl" className="relative mt-4 block" />
      <div className="relative mt-3 flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><ArrowDownLeft className="size-3 text-emerald-600" />{money(w.receivedCents + Math.max(0, w.manualCents))}</span>
        <span className="flex items-center gap-1"><ArrowUpRight className="size-3 text-rose-600" />{money(w.paidCents + Math.max(0, -w.manualCents))}</span>
      </div>
    </button>
  );
}

// ───────────── Não atribuídos ─────────────

function Unassigned({ wallets }: { wallets: W[] }) {
  const payments = trpc.finance.payments.useQuery({ includeReversed: false });
  const incomes = trpc.finance.incomes.useQuery({ status: "RECEIVED" });
  const utils = trpc.useUtils();
  const assign = trpc.finance.assignWallet.useMutation({ onSuccess: async () => { toast.success("Carteira atribuída"); await utils.finance.invalidate(); }, onError: (e) => toast.error(e.message) });
  const rows = [
    ...(payments.data ?? []).filter((p) => !p.wallet).map((p) => ({ id: p.id, kind: "payment" as const, date: p.paidAt, label: [...new Set(p.allocations.map((a) => a.installment.obligation.title))].join(", ") || "Pagamento", sub: PAYMENT_METHOD[p.method], amount: -p.amountCents })),
    ...(incomes.data ?? []).filter((i) => !i.wallet).map((i) => ({ id: i.id, kind: "income" as const, date: i.receivedAt ?? i.createdAt, label: i.description, sub: "Entrada", amount: i.amountCents })),
  ];
  if (!rows.length) return null;
  return (
    <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-5">
      <div className="mb-3 flex items-start gap-3">
        <Info className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <div>
          <h2 className="text-sm font-semibold">{rows.length} movimento(s) sem carteira</h2>
          <p className="text-xs text-muted-foreground">Pagamentos e entradas sem carteira não afetam nenhum saldo. Escolha de onde saiu / para onde foi cada um.</p>
        </div>
      </div>
      <ul className="divide-y rounded-lg border bg-card">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
            <Cell2 className="min-w-40 flex-1" title={r.label} sub={`${r.sub} · ${date(r.date)}`} />
            <Money value={r.amount} size="sm" signed />
            <NativeSelect className="w-48" value="" placeholder="Atribuir a…" disabled={assign.isPending} onChange={(v) => v && assign.mutate(r.kind === "payment" ? { paymentId: r.id, walletId: v } : { incomeId: r.id, walletId: v })} options={wallets.map((w) => ({ value: w.id, label: w.name }))} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// ───────────── Extrato ─────────────

function Statement({ wallet, wallets, onTransfer, onAdjust, onEdit }: { wallet: W; wallets: W[]; onTransfer: () => void; onAdjust: () => void; onEdit: () => void }) {
  const perm = useCanFinance();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reverse, setReverse] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const q = trpc.finance.walletStatement.useQuery({ walletId: wallet.id, from: fromDateInput(from) ?? undefined, to: to ? new Date(`${to}T23:59:59`) : undefined });
  const rev = trpc.finance.reverseWalletEntry.useMutation({ onSuccess: async () => { toast.success("Movimento estornado"); setReverse(null); await utils.finance.invalidate(); }, onError: (e) => toast.error(e.message) });
  const arch = trpc.finance.archiveWallet.useMutation({ onSuccess: async () => { toast.success("Carteira atualizada"); await utils.finance.invalidate(); }, onError: (e) => toast.error(e.message) });
  const totals = useMemo(() => {
    const m = (q.data?.movements ?? []).filter((x) => !x.reversed && !x.beforeOpening && x.type !== "opening");
    return { in: m.filter((x) => x.amountCents > 0).reduce((a, x) => a + x.amountCents, 0), out: m.filter((x) => x.amountCents < 0).reduce((a, x) => a + x.amountCents, 0) };
  }, [q.data]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">Extrato</div>
          <h2 className="text-lg font-semibold">{wallet.name}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {perm.create && wallets.length > 1 && !wallet.archivedAt && <Button variant="outline" size="sm" onClick={onTransfer}><ArrowLeftRight /> Transferir</Button>}
          {perm.edit && !wallet.archivedAt && <Button variant="outline" size="sm" onClick={onAdjust}><SlidersHorizontal /> Ajuste de saldo</Button>}
          {perm.edit && <Button variant="ghost" size="sm" onClick={onEdit}><Pencil /> Editar</Button>}
          {perm.edit && <Button variant="ghost" size="sm" onClick={() => arch.mutate({ id: wallet.id, archived: !wallet.archivedAt })}>{wallet.archivedAt ? <><ArchiveRestore /> Restaurar</> : <><Archive /> Arquivar</>}</Button>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-lg border bg-card px-2 py-0.5 text-xs text-muted-foreground">
          De <Input type="date" className="h-8 w-36 border-0 bg-transparent px-1 shadow-none" value={from} onChange={(e) => setFrom(e.target.value)} />
          até <Input type="date" className="h-8 w-36 border-0 bg-transparent px-1 shadow-none" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        {(from || to) && <Button variant="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); }}>Limpar período</Button>}
        <span className="ml-auto flex gap-4 text-xs text-muted-foreground"><span>Entradas <Money value={totals.in} size="sm" className="text-emerald-600" /></span><span>Saídas <Money value={totals.out} size="sm" muted /></span></span>
      </div>
      {q.isLoading ? <PageLoader /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <DataTable<Mv>
          rows={q.data!.movements}
          rowKey={(m) => `${m.type}:${m.id}`}
          empty="Nenhum movimento no período."
          rowClassName={(m) => (m.reversed || m.beforeOpening) && "text-muted-foreground"}
          leading={(m) => (
            <span className={cn("grid size-8 place-items-center rounded-full", m.type === "opening" ? "bg-muted text-muted-foreground" : m.amountCents >= 0 ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300" : "bg-rose-500/12 text-rose-600 dark:text-rose-300")}>
              {m.type === "transfer" ? <ArrowLeftRight className="size-3.5" /> : m.type === "adjustment" ? <SlidersHorizontal className="size-3.5" /> : m.amountCents >= 0 ? <ArrowDownLeft className="size-3.5" /> : <ArrowUpRight className="size-3.5" />}
            </span>
          )}
          columns={[
            {
              key: "desc", header: "Descrição",
              cell: (m) => <Cell2 title={<span className={cn(m.reversed && "line-through")}>{m.link?.obligationId ? <Link to={`/financeiro/lancamentos/${m.link?.obligationId}`} className="hover:underline">{m.description}</Link> : m.description}</span>} sub={<span>{MV_LABEL[m.type]}{m.reversed && <StatusBadge tone="rose" className="ml-2">estornado</StatusBadge>}{m.beforeOpening && <StatusBadge tone="neutral" className="ml-2">antes do saldo inicial</StatusBadge>}</span>} />,
            },
            { key: "date", header: "Data", cell: (m) => <span className="text-sm tabular-nums">{date(m.date)}</span> },
            { key: "amount", header: "Valor", align: "right", cell: (m) => <Money value={m.amountCents} size="sm" signed muted={m.amountCents < 0} className={cn(m.amountCents > 0 && "text-emerald-600 dark:text-emerald-400", m.amountCents < 0 && "text-rose-600 dark:text-rose-400", m.reversed && "line-through opacity-60", m.beforeOpening && "opacity-50")} /> },
            { key: "bal", header: "Saldo", align: "right", cell: (m) => <Money value={m.balanceAfter} size="sm" /> },
          ]}
          actions={perm.approve ? (m) => (m.link?.entryId && !m.reversed ? <Button size="xs" variant="ghost" onClick={() => setReverse(m.link?.entryId!)}><RotateCcw /> Estornar</Button> : null) : undefined}
          mobile={(m) => (
            <div className="flex items-center gap-3">
              <Cell2 className="flex-1" title={<span className={cn(m.reversed && "line-through")}>{m.description}</span>} sub={`${MV_LABEL[m.type]} · ${date(m.date)}`} />
              <div className="text-right"><Money value={m.amountCents} size="sm" signed className={cn(m.amountCents > 0 ? "text-emerald-600" : "text-rose-600")} /><div className="text-[11px] text-muted-foreground">saldo {money(m.balanceAfter)}</div></div>
            </div>
          )}
        />
      )}
      <ReasonDialog open={!!reverse} onOpenChange={(v) => !v && setReverse(null)} title="Estornar movimento" description="O movimento deixa de contar no saldo (transferências são estornadas nas duas carteiras). O registro permanece no extrato." confirmLabel="Estornar" loading={rev.isPending} onConfirm={(reason) => reverse && rev.mutate({ entryId: reverse, reason })} />
    </section>
  );
}

// ───────────── Página ─────────────

export function WalletsPage() {
  const q = trpc.finance.wallets.useQuery();
  const perm = useCanFinance();
  const [params, setParams] = useSearchParams();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<W | null | "new">(null);
  const [transfer, setTransfer] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const all = q.data?.wallets ?? [];
  const list = all.filter((w) => showArchived || !w.archivedAt);
  const activeWallets = all.filter((w) => !w.archivedAt);
  const selectedId = params.get("carteira") ?? activeWallets.find((w) => w.isDefault)?.id ?? activeWallets[0]?.id ?? "";
  const selected = all.find((w) => w.id === selectedId) ?? null;
  const select = (id: string) => {
    const p = new URLSearchParams(params);
    p.set("carteira", id);
    setParams(p, { replace: true });
  };

  return (
    <FinanceShell title="Carteiras" description="Quanto vocês têm em cada conta. Cada pagamento debita e cada entrada recebida credita a carteira escolhida." actions={perm.edit && <Button onClick={() => setEditing("new")}><Plus /> Nova carteira</Button>}>
      {q.isLoading ? <PageLoader /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !all.length ? (
        <EmptyState icon={<Wallet />} title="Informe quanto vocês têm" description="Cadastre a conta do casal, a poupança ou o dinheiro guardado com o saldo de hoje. A partir daí, cada pagamento é debitado automaticamente." action={perm.edit && <Button onClick={() => setEditing("new")}><Plus /> Criar primeira carteira</Button>} />
      ) : (
        <div className="space-y-6">
          <section className="relative overflow-hidden rounded-xl border bg-card p-6 shadow-soft">
            <div className="bg-glow absolute inset-0" />
            <div className="relative flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Total disponível</div>
                <Money value={q.data!.totalCents} size="2xl" className="mt-2 block text-5xl" />
                <p className="mt-2 text-xs text-muted-foreground">Soma das {activeWallets.length} carteira(s) ativa(s)</p>
              </div>
              {(q.data!.unassignedPayments > 0 || q.data!.unassignedIncomes > 0) && (
                <span className="rounded-full bg-amber-500/12 px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">{q.data!.unassignedPayments + q.data!.unassignedIncomes} movimento(s) sem carteira</span>
              )}
            </div>
          </section>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">Suas carteiras</h2>
              {all.some((w) => w.archivedAt) && <label className="flex items-center gap-2 text-sm text-muted-foreground"><Checkbox checked={showArchived} onCheckedChange={(v) => setShowArchived(!!v)} /> Mostrar arquivadas</label>}
            </div>
            <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {list.map((w) => <WalletCard key={w.id} w={w} active={w.id === selectedId} onClick={() => select(w.id)} />)}
              {perm.edit && (
                <button type="button" onClick={() => setEditing("new")} className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground transition hover:border-primary/50 hover:bg-accent/30 hover:text-foreground">
                  <Plus className="size-5" /> Nova carteira
                </button>
              )}
            </div>
          </div>

          <Unassigned wallets={activeWallets} />

          {selected && <Statement key={selected.id} wallet={selected} wallets={activeWallets} onTransfer={() => setTransfer(true)} onAdjust={() => setAdjust(true)} onEdit={() => setEditing(selected)} />}
        </div>
      )}
      <WalletDialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)} wallet={editing === "new" ? null : editing} />
      <TransferDialog open={transfer} onOpenChange={setTransfer} wallets={activeWallets} fromId={selectedId} />
      <AdjustDialog open={adjust} onOpenChange={setAdjust} wallet={selected} />
    </FinanceShell>
  );
}
