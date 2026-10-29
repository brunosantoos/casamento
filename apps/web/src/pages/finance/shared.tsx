import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { Link, NavLink } from "react-router";
import { Sparkles, ArrowDownToLine, ArrowRight, Banknote, Barcode, CalendarClock, CircleEllipsis, CreditCard, Zap, ChartArea, Check, ChevronDown, ChevronsUpDown, ChevronUp, CircleCheckBig, FlaskConical, FolderTree, Landmark, LayoutDashboard, Pencil, Receipt, Search, Wallet as WalletIcon, X } from "lucide-react";
import { toast } from "sonner";
import { Field, LoadingButton, MoneyInput, StatusBadge, TextField } from "@/components/app/common";
import { UploadButton } from "@/components/app/files";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { date, fromDateInput, money, newKey, toDateInput } from "@/lib/format";
import { INCOME_KIND, ITEM_KIND, PAYMENT_METHOD } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { useMe } from "@/hooks/use-me";
import { trpc } from "@/trpc";

/** Sub-navegação do financeiro */
const LINKS = [
  { to: "/financeiro", label: "Visão geral", icon: LayoutDashboard, end: true },
  { to: "/financeiro/lancamentos", label: "Lançamentos", icon: Receipt },
  { to: "/financeiro/planejar", label: "Planejar (IA)", icon: Sparkles },
  { to: "/financeiro/pagar", label: "A pagar", icon: CalendarClock },
  { to: "/financeiro/pagamentos", label: "Pagamentos", icon: CircleCheckBig },
  { to: "/financeiro/carteiras", label: "Carteiras", icon: WalletIcon },
  { to: "/financeiro/entradas", label: "Entradas", icon: ArrowDownToLine },
  { to: "/financeiro/caucoes", label: "Cauções", icon: Landmark },
  { to: "/financeiro/fluxo", label: "Fluxo de caixa", icon: ChartArea },
  { to: "/financeiro/categorias", label: "Categorias", icon: FolderTree },
  { to: "/financeiro/cenarios", label: "Simulações", icon: FlaskConical },
];

export function FinanceNav() {
  return (
    <div className="sticky top-[57px] z-20 -mx-4 mb-6 border-b bg-background/80 px-4 backdrop-blur-xl md:top-0 md:-mx-8 md:px-8 xl:-mx-10 xl:px-10">
      <nav className="-mb-px flex gap-1 overflow-x-auto scrollbar-none">
        {LINKS.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) =>
              cn(
                "group relative flex items-center gap-1.5 px-3 py-3 text-[13px] font-medium whitespace-nowrap transition-colors",
                isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )
            }
          >
            {({ isActive }) => (
              <>
                <l.icon className={cn("size-4 transition-transform duration-200 group-hover:-translate-y-px group-hover:scale-110", isActive && "text-primary")} />
                {l.label}
                <span className={cn("absolute inset-x-2 -bottom-px h-0.5 origin-center rounded-full bg-primary transition-transform duration-300", isActive ? "scale-x-100" : "scale-x-0 group-hover:scale-x-50 group-hover:bg-primary/40")} />
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

/** Cabeçalho + sub-navegação padrão de todas as telas do financeiro */
export function FinanceShell({ title, description, actions, children, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; back?: ReactNode }) {
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4 animate-in fade-in slide-in-from-bottom-1 duration-300">
        <div className="min-w-0">
          {back}
          <div className="mb-1 text-xs font-medium tracking-wide text-primary uppercase">Financeiro</div>
          <h1 className="text-[26px] leading-tight font-semibold md:text-3xl">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      <FinanceNav />
      {children}
    </>
  );
}

// ───────────── Peças visuais ─────────────

const SIZES = { sm: "text-sm", md: "text-base", lg: "text-xl", xl: "text-[28px] leading-none", "2xl": "text-4xl leading-none" } as const;

/** Valor monetário com centavos discretos. Sempre Geist, tabular. */
export function Money({ value, size = "md", className, signed, muted }: { value: number | null | undefined; size?: keyof typeof SIZES; className?: string; signed?: boolean; muted?: boolean }) {
  if (value == null) return <span className={cn("font-sans text-muted-foreground", SIZES[size], className)}>—</span>;
  const neg = value < 0;
  const abs = Math.abs(value);
  const int = Math.trunc(abs / 100).toLocaleString("pt-BR");
  const cents = String(abs % 100).padStart(2, "0");
  return (
    <span className={cn("font-sans font-semibold tracking-tight whitespace-nowrap tabular-nums", SIZES[size], neg && !muted && "text-destructive", className)}>
      {neg ? "−" : signed && value > 0 ? "+" : ""}
      <span className="mr-0.5 text-[0.62em] font-medium text-muted-foreground">R$</span>
      {int}
      <span className="text-[0.62em] font-medium text-muted-foreground">,{cents}</span>
    </span>
  );
}

/** Anel de progresso (SVG) */
export function Ring({ value, size = 120, stroke = 10, danger, children }: { value: number; size?: number; stroke?: number; danger?: boolean; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={`ring-${size}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--primary)" />
            <stop offset="100%" stopColor="var(--brand-2)" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeLinecap="round" strokeWidth={stroke}
          stroke={danger ? "var(--destructive)" : `url(#ring-${size})`}
          strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c}
          style={{ transition: "stroke-dashoffset 1s cubic-bezier(.2,.8,.2,1)" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

/** Barra segmentada (ex.: pago | em aberto | restante) */
export function SegmentBar({ segments, total, className }: { segments: { value: number; className: string; label: string }[]; total: number; className?: string }) {
  const t = Math.max(total, segments.reduce((a, s) => a + Math.max(0, s.value), 0), 1);
  return (
    <div className={cn("flex h-2.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      {segments.map((s) => (
        <div key={s.label} title={`${s.label}: ${money(s.value)}`} className={cn("h-full transition-all duration-700 first:rounded-l-full last:rounded-r-full", s.className)} style={{ width: `${(Math.max(0, s.value) / t) * 100}%` }} />
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; value: ReactNode; className: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5 text-muted-foreground">
          <span className={cn("size-2 rounded-full", i.className)} />
          {i.label} <span className="font-medium text-foreground tabular-nums">{i.value}</span>
        </span>
      ))}
    </div>
  );
}

/** Barra fina de progresso */
export function Bar({ value, danger, className }: { value: number; danger?: boolean; className?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div className={cn("h-full rounded-full transition-all duration-700", danger ? "bg-destructive" : "bg-brand")} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

const hueOf = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

/** Avatar de iniciais com cor derivada do nome */
export function Avatar({ name, className }: { name?: string | null; className?: string }) {
  const n = name?.trim() || "?";
  const initials = n.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const h = hueOf(n);
  return (
    <span
      className={cn("grid size-9 shrink-0 place-items-center rounded-lg text-xs font-semibold", className)}
      style={{ background: `oklch(0.93 0.05 ${h} / .9)`, color: `oklch(0.42 0.12 ${h})` }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

/** Cartão de métrica (link opcional) */
export function Metric({ label, value, hint, icon, tone = "neutral", href, className, size = "lg" }: { label: string; value: number | null | undefined | ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: "neutral" | "primary" | "success" | "warning" | "danger" | "info"; href?: string; className?: string; size?: keyof typeof SIZES }) {
  const tones = {
    neutral: "bg-muted text-muted-foreground", primary: "bg-primary/12 text-primary", success: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300",
    warning: "bg-amber-500/15 text-amber-600 dark:text-amber-300", danger: "bg-rose-500/12 text-rose-600 dark:text-rose-300", info: "bg-sky-500/12 text-sky-600 dark:text-sky-300",
  };
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-medium text-muted-foreground">{label}</span>
        {icon && <span className={cn("grid size-7 place-items-center rounded-lg transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6 [&_svg]:size-3.5", tones[tone])}>{icon}</span>}
      </div>
      <div className="mt-2">{typeof value === "number" || value == null ? <Money value={value as number | null} size={size} /> : value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </>
  );
  const cls = cn("group relative block rounded-xl border bg-card p-4 text-left shadow-soft", className);
  return href ? <Link to={href} className={cn(cls, "lift")}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** Faixa de totais do filtro atual */
export function SummaryStrip({ items }: { items: { label: string; value: number; tone?: "danger" | "success" | "muted" }[] }) {
  return (
    <div className="mb-4 flex flex-wrap divide-x rounded-xl border bg-card shadow-soft">
      {items.map((i) => (
        <div key={i.label} className="min-w-[140px] flex-1 px-4 py-3">
          <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{i.label}</div>
          <Money value={i.value} size="lg" className={cn("mt-0.5 block", i.tone === "danger" && i.value > 0 && "text-destructive", i.tone === "success" && "text-emerald-600 dark:text-emerald-400")} />
        </div>
      ))}
    </div>
  );
}

/** Barra de filtros com busca */
export function FilterBar({ search, onSearch, children, placeholder = "Buscar…" }: { search?: string; onSearch?: (v: string) => void; children?: ReactNode; placeholder?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {onSearch && (
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-9 pl-8" placeholder={placeholder} value={search ?? ""} onChange={(e) => onSearch(e.target.value)} />
        </div>
      )}
      {children}
    </div>
  );
}

export const daysUntil = (d: Date | string) => {
  const a = new Date(d);
  a.setHours(0, 0, 0, 0);
  const b = new Date();
  b.setHours(0, 0, 0, 0);
  return Math.round((a.getTime() - b.getTime()) / 86400_000);
};
export const dueLabel = (d: Date | string) => {
  const n = daysUntil(d);
  return n < 0 ? `${-n}d atrasada` : n === 0 ? "hoje" : n === 1 ? "amanhã" : `em ${n}d`;
};

export const compactBRL = (c: number) => new Intl.NumberFormat("pt-BR", { notation: "compact", style: "currency", currency: "BRL", maximumFractionDigits: 1 }).format(c / 100);

/** Select nativo (aceita valor vazio e funciona bem no celular) */
export function NativeSelect({ value, onChange, options, placeholder, className, ...props }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string } & Omit<ComponentProps<"select">, "value" | "onChange">) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn("h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30", className)}
      {...props}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export const opts = (m: Record<string, string | { label: string }>) => Object.entries(m).map(([value, v]) => ({ value, label: typeof v === "string" ? v : v.label }));

/** Mesma regra do backend: round(unit × qtd) half-up − desconto + acréscimo, em centavos inteiros */
export function toMilli(qty: string) {
  const [i = "0", f = ""] = (qty || "0").split(".");
  return Math.abs(Number(i)) * 1000 + Number((f + "000").slice(0, 3));
}
export function itemTotalCents(i: { unitCents: number; quantity: string; discountCents: number; surchargeCents: number }) {
  const raw = i.unitCents * toMilli(i.quantity);
  return Math.floor((raw + 500) / 1000) - i.discountCents + i.surchargeCents;
}

export function KindBadge({ kind }: { kind: string }) {
  return <StatusBadge tone={ITEM_KIND[kind]?.tone}>{ITEM_KIND[kind]?.label ?? kind}</StatusBadge>;
}

export function Kpi({ label, value, hint, tone, className }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "danger" | "success" | "info"; className?: string }) {
  return <Metric label={label} value={value} hint={hint} className={className} tone={tone === "danger" ? "danger" : tone === "success" ? "success" : tone === "info" ? "info" : "neutral"} />;
}

export const methodOptions = opts(PAYMENT_METHOD);

// ───────────── Carteiras ─────────────

export const WALLET_KIND: Record<string, string> = { CHECKING: "Conta corrente", SAVINGS: "Poupança", CASH: "Dinheiro", CREDIT_CARD: "Cartão de crédito", INVESTMENT: "Investimento", OTHER: "Outra" };

/** Carteiras ativas + id da padrão */
export function useWallets(enabled = true) {
  const q = trpc.finance.wallets.useQuery(undefined, { enabled });
  const active = (q.data?.wallets ?? []).filter((w) => !w.archivedAt);
  return { ...q, active, defaultId: active.find((w) => w.isDefault)?.id ?? active[0]?.id ?? "" };
}

/** Seletor de carteira com saldo atual e saldo após a operação */
export function WalletPicker({ label, value, onChange, delta, wallets }: { label: string; value: string; onChange: (v: string) => void; delta: number; wallets: ReturnType<typeof useWallets>["active"] }) {
  if (!wallets.length) {
    return <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">Nenhuma carteira cadastrada — este valor não será debitado/creditado de nenhum saldo. <Link to="/financeiro/carteiras" className="text-primary hover:underline">Criar carteira</Link></p>;
  }
  const w = wallets.find((x) => x.id === value);
  const after = w ? w.balanceCents + delta : null;
  return (
    <div className="space-y-1.5">
      <Field label={label}><NativeSelect value={value} onChange={onChange} placeholder="Nenhuma (não afeta saldos)" options={wallets.map((x) => ({ value: x.id, label: `${x.name}${x.isDefault ? " (padrão)" : ""}` }))} /></Field>
      {w && (
        <div className={cn("flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs", after! < 0 ? "bg-amber-500/10 text-amber-800 dark:text-amber-300" : "bg-muted/60")}>
          <span>Saldo atual <Money value={w.balanceCents} size="sm" /></span>
          <span>Após <Money value={after} size="sm" /></span>
          {after! < 0 && w.kind !== "CREDIT_CARD" && <span className="w-full">Atenção: a carteira ficará negativa.</span>}
        </div>
      )}
    </div>
  );
}

// ───────────── Registrar pagamento ─────────────

export type PayableInstallment = { id: string; label: string; dueDate: Date | string; remaining: number; overdue?: boolean };

/** Distribui da mais antiga para a mais nova */
function autoFill(amount: number, list: PayableInstallment[], selected: string[]) {
  let left = amount;
  const out: Record<string, number> = {};
  for (const i of [...list].filter((x) => selected.includes(x.id)).sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())) {
    const take = Math.max(0, Math.min(i.remaining, left));
    out[i.id] = take;
    left -= take;
  }
  return out;
}

const METHOD_UI: { value: string; label: string; icon: typeof WalletIcon }[] = [
  { value: "PIX", label: "Pix", icon: Zap },
  { value: "CREDIT_CARD", label: "Crédito", icon: CreditCard },
  { value: "DEBIT_CARD", label: "Débito", icon: CreditCard },
  { value: "BOLETO", label: "Boleto", icon: Barcode },
  { value: "BANK_TRANSFER", label: "Transferência", icon: Landmark },
  { value: "CASH", label: "Dinheiro", icon: Banknote },
  { value: "CHECK", label: "Cheque", icon: Receipt },
  { value: "OTHER", label: "Outro", icon: CircleEllipsis },
];

/** Seletor de forma de pagamento em botões com ícone */
export function MethodPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Forma de pagamento" className="grid grid-cols-4 gap-1.5">
      {METHOD_UI.map((m) => {
        const on = value === m.value;
        return (
          <button key={m.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(m.value)} className={cn("flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[11px] font-medium transition", on ? "border-primary bg-primary/8 text-foreground ring-2 ring-primary/15" : "text-muted-foreground hover:border-primary/40 hover:text-foreground")}>
            <m.icon className={cn("size-4", on && "text-primary")} />
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

/** Data com atalhos (Hoje / Ontem) */
export function QuickDate({ value, onChange, max, future }: { value: string; onChange: (v: string) => void; max?: string; future?: boolean }) {
  const d = (offset: number) => toDateInput(new Date(Date.now() + offset * 86400_000));
  const chips = future ? [{ l: "Hoje", v: d(0) }, { l: "Em 30 dias", v: d(30) }] : [{ l: "Hoje", v: d(0) }, { l: "Ontem", v: d(-1) }];
  return (
    <div className="flex items-center gap-1.5">
      {chips.map((c) => (
        <button key={c.l} type="button" onClick={() => onChange(c.v)} className={cn("h-9 shrink-0 rounded-md border px-2.5 text-xs font-medium transition", value === c.v ? "border-primary bg-primary/8 text-foreground" : "text-muted-foreground hover:border-primary/40 hover:text-foreground")}>{c.l}</button>
      ))}
      <Input type="date" className="min-w-0 flex-1" value={value} max={max} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** Seção recolhível ("Mais detalhes") */
export function MoreDetails({ children, label = "Mais detalhes", defaultOpen = false, badge }: { children: ReactNode; label?: string; defaultOpen?: boolean; badge?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium text-muted-foreground transition hover:text-foreground" aria-expanded={open}>
        <span className="flex items-center gap-2">{label} {badge}</span>
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="space-y-3 border-t px-3 py-3 animate-in fade-in slide-in-from-top-1">{children}</div>}
    </div>
  );
}

/** Cabeçalho padrão das janelas (ícone + título + linha de apoio) */
export function DialogHero({ icon, title, subtitle, tone = "primary" }: { icon: ReactNode; title: string; subtitle?: ReactNode; tone?: "primary" | "emerald" | "amber" }) {
  const t = { primary: "bg-primary/10 text-primary", emerald: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300", amber: "bg-amber-500/15 text-amber-600 dark:text-amber-300" }[tone];
  return (
    <DialogHeader className="flex-row items-center gap-3 space-y-0 border-b px-5 pt-5 pb-4 text-left">
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl [&_svg]:size-5", t)}>{icon}</span>
      <div className="min-w-0">
        <DialogTitle>{title}</DialogTitle>
        {subtitle ? <DialogDescription className="mt-0.5">{subtitle}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
      </div>
    </DialogHeader>
  );
}

export function PaymentDialog({ open, onOpenChange, installments, preselected, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; installments: PayableInstallment[]; preselected?: string[]; onDone?: () => void }) {
  const [key, setKey] = useState(newKey());
  const [selected, setSelected] = useState<string[]>([]);
  const [amount, setAmount] = useState<number | null>(null);
  const [alloc, setAlloc] = useState<Record<string, number | null>>({});
  const [paidAt, setPaidAt] = useState(toDateInput(new Date()));
  const [method, setMethod] = useState("PIX");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [receipt, setReceipt] = useState<{ id: string; name: string } | null>(null);
  const [walletId, setWalletId] = useState("");
  const [splitEdit, setSplitEdit] = useState(false);
  const wallets = useWallets(open);
  const utils = trpc.useUtils();

  useEffect(() => {
    if (open) setWalletId(wallets.defaultId);
  }, [open, wallets.defaultId]);

  useEffect(() => {
    if (!open) return;
    // Nova chave a cada abertura: duplo clique / reenvio devolvem o mesmo pagamento
    setKey(newKey());
    const sel = preselected?.length ? preselected : installments.slice(0, 1).map((i) => i.id);
    const total = installments.filter((i) => sel.includes(i.id)).reduce((a, i) => a + i.remaining, 0);
    setSelected(sel);
    setAmount(total);
    setAlloc(autoFill(total, installments, sel));
    setPaidAt(toDateInput(new Date()));
    setMethod("PIX");
    setReference("");
    setNotes("");
    setReceipt(null);
    setSplitEdit(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const register = trpc.finance.registerPayment.useMutation({
    onSuccess: async (r) => {
      toast.success(r.duplicate ? "Este pagamento já havia sido registrado" : "Pagamento registrado");
      await utils.finance.invalidate();
      onOpenChange(false);
      onDone?.();
    },
    onError: (e) => toast.error(e.message),
  });

  const allocSum = selected.reduce((a, id) => a + (alloc[id] ?? 0), 0);
  const selectedRemaining = installments.filter((i) => selected.includes(i.id)).reduce((a, i) => a + i.remaining, 0);
  const errors: string[] = [];
  if (!amount || amount <= 0) errors.push("Informe o valor pago");
  if (!selected.length) errors.push("Selecione ao menos uma parcela");
  for (const id of selected) {
    const i = installments.find((x) => x.id === id);
    const v = alloc[id] ?? 0;
    if (i && v > i.remaining) errors.push(`${i.label}: valor acima do saldo (${money(i.remaining)})`);
    if (v <= 0) errors.push(`${i?.label ?? "Parcela"}: sem valor alocado — reduza a seleção ou aumente o valor`);
  }
  if (amount && allocSum !== amount) errors.push(`A soma das parcelas (${money(allocSum)}) precisa ser igual ao valor pago (${money(amount)})`);
  if (paidAt && fromDateInput(paidAt)! > new Date(Date.now() + 86400_000)) errors.push("A data não pode estar no futuro");
  const partial = !!amount && amount < selectedRemaining;

  function toggle(id: string, on: boolean) {
    const next = on ? [...selected, id] : selected.filter((x) => x !== id);
    setSelected(next);
    // Valor acompanha a seleção (o mais comum é pagar o saldo integral)
    const total = installments.filter((i) => next.includes(i.id)).reduce((a, i) => a + i.remaining, 0);
    setAmount(total || null);
    setAlloc(autoFill(total, installments, next));
  }

  const wallet = wallets.active.find((w) => w.id === walletId);
  const after = wallet ? wallet.balanceCents - (amount ?? 0) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHero icon={<CircleCheckBig />} tone="emerald" title="Registrar pagamento" subtitle="Dê baixa em uma ou mais parcelas com um único pagamento." />
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* Valor em destaque */}
          <div className="rounded-xl bg-muted/50 p-4">
            <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
              <span>Valor pago</span>
              {partial && <StatusBadge tone="amber">pagamento parcial</StatusBadge>}
            </div>
            <MoneyInput className="mt-1.5 [&_input]:h-12 [&_input]:text-2xl [&_input]:font-semibold [&_span]:text-base" value={amount} onChange={(v) => { setAmount(v); if (v) setAlloc(autoFill(v, installments, selected)); }} />
            {selectedRemaining > 0 && amount !== selectedRemaining && (
              <button type="button" onClick={() => { setAmount(selectedRemaining); setAlloc(autoFill(selectedRemaining, installments, selected)); }} className="mt-2 text-xs font-medium text-primary hover:underline">Pagar o saldo total ({money(selectedRemaining)})</button>
            )}
          </div>

          {/* Parcelas */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">Parcelas</span>
              {selected.length > 0 && (
                <button type="button" onClick={() => setSplitEdit(!splitEdit)} className="text-xs font-medium text-primary hover:underline">{splitEdit ? "Distribuição automática" : "Ajustar distribuição"}</button>
              )}
            </div>
            <div className="space-y-1.5">
              {installments.map((i) => {
                const on = selected.includes(i.id);
                return (
                  <div key={i.id} className={cn("flex items-center gap-3 rounded-lg border px-3 py-2.5 transition", on ? "border-primary/50 bg-primary/5" : "hover:border-primary/30")}>
                    <Checkbox checked={on} onCheckedChange={(v) => toggle(i.id, !!v)} aria-label={i.label} />
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => toggle(i.id, !on)}>
                      <div className="truncate text-sm font-medium">{i.label}</div>
                      <div className={cn("text-xs text-muted-foreground", i.overdue && "font-medium text-destructive")}>{i.overdue ? "Vencida em" : "Vence"} {date(i.dueDate)}</div>
                    </button>
                    {on && splitEdit ? (
                      <MoneyInput className="w-36 shrink-0" value={alloc[i.id] ?? null} onChange={(v) => setAlloc({ ...alloc, [i.id]: v })} />
                    ) : (
                      <div className="shrink-0 text-right">
                        <Money value={on ? (alloc[i.id] ?? 0) : i.remaining} size="sm" className={cn("font-semibold", !on && "text-muted-foreground")} />
                        {on && (alloc[i.id] ?? 0) < i.remaining && <div className="text-[11px] text-muted-foreground">de {money(i.remaining)}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
              {!installments.length && <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">Nenhuma parcela em aberto.</p>}
            </div>
          </div>

          {/* Como e quando */}
          <div className="space-y-3">
            <Field label="Forma de pagamento"><MethodPicker value={method} onChange={setMethod} /></Field>
            <Field label="Data do pagamento"><QuickDate value={paidAt} onChange={setPaidAt} max={toDateInput(new Date())} /></Field>
          </div>

          {/* Carteira com saldo antes → depois */}
          {wallets.active.length ? (
            <Field label="Pagar com">
              <div className="grid gap-1.5 sm:grid-cols-2">
                {wallets.active.map((w) => {
                  const on = w.id === walletId;
                  return (
                    <button key={w.id} type="button" onClick={() => setWalletId(on ? "" : w.id)} className={cn("flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition", on ? "border-primary bg-primary/5 ring-2 ring-primary/15" : "hover:border-primary/40")}>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{w.name}</span>
                        <span className="block text-[11px] text-muted-foreground">saldo {money(w.balanceCents)}</span>
                      </span>
                      {on && <Check className="size-4 shrink-0 text-primary" />}
                    </button>
                  );
                })}
              </div>
              {wallet && after != null && (
                <div className={cn("mt-2 flex items-center justify-between rounded-lg px-3 py-2 text-sm", after < 0 && wallet.kind !== "CREDIT_CARD" ? "bg-destructive/8 text-destructive" : "bg-muted/60")}>
                  <span className="text-muted-foreground">{wallet.name}</span>
                  <span className="flex items-center gap-2 tabular-nums"><Money value={wallet.balanceCents} size="sm" className="text-muted-foreground" /> <ArrowRight className="size-3.5 text-muted-foreground" /> <Money value={after} size="sm" className="font-semibold" /></span>
                </div>
              )}
            </Field>
          ) : (
            <p className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">Sem carteiras cadastradas — o pagamento não debita nenhum saldo. <Link to="/financeiro/carteiras" className="font-medium text-primary hover:underline">Criar carteira</Link></p>
          )}

          <MoreDetails label="Referência, comprovante e observações" badge={receipt || reference || notes ? <StatusBadge tone="emerald">preenchido</StatusBadge> : null}>
            <TextField label="Referência / identificação" value={reference} onChange={setReference} placeholder="ID do Pix, nº do boleto…" />
            <div className="flex flex-wrap items-center gap-2">
              <UploadButton category="RECEIPT" size="sm" label={receipt ? "Trocar comprovante" : "Anexar comprovante"} accept="application/pdf,image/*" onUploaded={(f) => setReceipt({ id: f[0]!.id, name: f[0]!.originalName })} />
              {receipt && <span className="truncate text-xs text-muted-foreground">{receipt.name}</span>}
            </div>
            <TextField label="Observações" value={notes} onChange={setNotes} multiline />
          </MoreDetails>
        </div>

        <div className="border-t bg-muted/30 px-5 py-3">
          {errors.length > 0 && amount ? <p className="mb-2 text-xs text-destructive">{errors[0]}</p> : null}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-xs text-muted-foreground">
              {selected.length} parcela(s){wallet ? ` · ${wallet.name}` : ""}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <LoadingButton
                loading={register.isPending}
                disabled={errors.length > 0}
                onClick={() =>
                  register.mutate({
                    idempotencyKey: key, amountCents: amount!, paidAt: fromDateInput(paidAt)!, method: method as never, reference: reference || null, notes: notes || null,
                    receiptFileId: receipt?.id ?? null, walletId: walletId || null, allocations: selected.map((id) => ({ installmentId: id, amountCents: alloc[id] ?? 0 })),
                  })
                }
              >
                Pagar {money(amount ?? 0)}
              </LoadingButton>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Entrada (inclui devolução de caução) ─────────────

export type IncomeForm = {
  id?: string; kind: string; status: string; description: string; source: string; categoryId: string; amountCents: number | null;
  expectedDate: string; receivedAt: string; method: string; depositItemId: string; notes: string; walletId?: string;
};

export const emptyIncome = (patch: Partial<IncomeForm> = {}): IncomeForm => ({
  kind: "GIFT_CASH", status: "EXPECTED", description: "", source: "", categoryId: "", amountCents: null, expectedDate: "", receivedAt: "", method: "", depositItemId: "", notes: "", ...patch,
});

export function IncomeDialog({ open, onOpenChange, initial, lockDeposit }: { open: boolean; onOpenChange: (o: boolean) => void; initial: IncomeForm; lockDeposit?: boolean }) {
  const [f, setF] = useState<IncomeForm>(initial);
  const [key, setKey] = useState(newKey());
  const utils = trpc.useUtils();
  const deposits = trpc.finance.deposits.useQuery(undefined, { enabled: open });
  const categories = trpc.finance.categories.useQuery(undefined, { enabled: open });
  const wallets = useWallets(open);
  useEffect(() => {
    if (open) {
      setF({ ...initial, walletId: initial.walletId ?? (initial.id ? "" : wallets.defaultId) });
      setKey(newKey());
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = trpc.finance.saveIncome.useMutation({
    onSuccess: async () => {
      toast.success("Entrada salva");
      await utils.finance.invalidate();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const set = (p: Partial<IncomeForm>) => setF((x) => ({ ...x, ...p }));
  const errors: string[] = [];
  if (f.description.trim().length < 2) errors.push("Descreva a entrada");
  if (!f.amountCents || f.amountCents <= 0) errors.push("Informe o valor");
  if (f.status === "RECEIVED" && !f.receivedAt) errors.push("Informe a data do recebimento");
  if (f.kind === "DEPOSIT_REFUND" && !f.depositItemId) errors.push("Escolha a caução devolvida");
  const dep = deposits.data?.find((d) => d.itemId === f.depositItemId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{f.id ? "Editar entrada" : f.kind === "DEPOSIT_REFUND" ? "Registrar devolução de caução" : "Nova entrada"}</DialogTitle>
          <DialogDescription>Valores prometidos ou previstos entram apenas na projeção — não contam como dinheiro disponível.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo"><NativeSelect value={f.kind} disabled={lockDeposit} onChange={(v) => set({ kind: v, ...(v !== "DEPOSIT_REFUND" ? { depositItemId: "" } : {}) })} options={opts(INCOME_KIND)} /></Field>
          <Field label="Situação"><NativeSelect value={f.status} onChange={(v) => set({ status: v })} options={[{ value: "PROMISED", label: "Prometido" }, { value: "EXPECTED", label: "Previsto" }, { value: "RECEIVED", label: "Recebido" }]} /></Field>
          {f.kind === "DEPOSIT_REFUND" && (
            <Field label="Caução" className="sm:col-span-2" hint={dep ? `Pago ${money(dep.paid)} · devolvido ${money(dep.refunded)} · retido ${money(dep.forfeited)} · pendente ${money(dep.pending)}` : undefined}>
              <NativeSelect value={f.depositItemId} disabled={lockDeposit} placeholder="Selecione…" onChange={(v) => {
                const d = deposits.data?.find((x) => x.itemId === v);
                set({ depositItemId: v, description: f.description || (d ? `Devolução: ${d.description} (${d.obligationTitle})` : ""), amountCents: f.amountCents ?? d?.pending ?? null });
              }} options={(deposits.data ?? []).map((d) => ({ value: d.itemId, label: `${d.obligationTitle} — ${d.description} (pendente ${money(d.pending)})` }))} />
            </Field>
          )}
          <TextField className="sm:col-span-2" label="Descrição" value={f.description} onChange={(v) => set({ description: v })} />
          <Field label="Valor"><MoneyInput value={f.amountCents} onChange={(v) => set({ amountCents: v })} /></Field>
          <TextField label="Origem" value={f.source} onChange={(v) => set({ source: v })} placeholder="Ex.: pais da noiva" />
          <Field label="Data prevista"><Input type="date" value={f.expectedDate} onChange={(e) => set({ expectedDate: e.target.value })} /></Field>
          <Field label="Data do recebimento"><Input type="date" value={f.receivedAt} onChange={(e) => set({ receivedAt: e.target.value })} /></Field>
          <Field label="Forma de recebimento"><NativeSelect value={f.method} onChange={(v) => set({ method: v })} placeholder="—" options={methodOptions} /></Field>
          <Field label="Categoria"><NativeSelect value={f.categoryId} onChange={(v) => set({ categoryId: v })} placeholder="—" options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))} /></Field>
          {f.status === "RECEIVED" && <div className="sm:col-span-2"><WalletPicker label="Receber em" value={f.walletId ?? ""} onChange={(v) => set({ walletId: v })} delta={f.amountCents ?? 0} wallets={wallets.active} /></div>}
          <TextField className="sm:col-span-2" label="Observações" value={f.notes} onChange={(v) => set({ notes: v })} multiline />
        </div>
        {errors.length > 0 && <p className="text-xs text-destructive">{errors[0]}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <LoadingButton
            loading={save.isPending}
            disabled={errors.length > 0}
            onClick={() =>
              save.mutate({
                id: f.id, kind: f.kind as never, status: f.status as never, description: f.description.trim(), source: f.source || null, categoryId: f.categoryId || null,
                amountCents: f.amountCents!, expectedDate: fromDateInput(f.expectedDate), receivedAt: fromDateInput(f.receivedAt), method: (f.method || null) as never,
                depositItemId: f.depositItemId || null, notes: f.notes || null, walletId: f.status === "RECEIVED" ? f.walletId || null : null, idempotencyKey: f.id ? null : key,
              })
            }
          >
            Salvar
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Retenção de caução ─────────────

export function ForfeitDialog({ open, onOpenChange, deposit }: { open: boolean; onOpenChange: (o: boolean) => void; deposit: { itemId: string; description: string; paid: number; forfeited: number } | null }) {
  const [value, setValue] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const utils = trpc.useUtils();
  useEffect(() => {
    if (open && deposit) {
      setValue(deposit.forfeited);
      setReason("");
    }
  }, [open, deposit]);
  const m = trpc.finance.forfeitDeposit.useMutation({
    onSuccess: async () => {
      toast.success("Retenção registrada");
      await utils.finance.invalidate();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const invalid = value == null || value < 0 || (deposit && value > deposit.paid) || reason.trim().length < 3;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Caução retida pelo fornecedor</DialogTitle>
          <DialogDescription>A parte retida deixa de ser "a recuperar" e passa a contar como gasto não reembolsável.</DialogDescription>
        </DialogHeader>
        <p className="text-sm">{deposit?.description} · pago {money(deposit?.paid ?? 0)}</p>
        <Field label="Valor retido (total)"><MoneyInput value={value} onChange={setValue} /></Field>
        <TextField label="Motivo" value={reason} onChange={setReason} multiline />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <LoadingButton loading={m.isPending} disabled={!!invalid} onClick={() => deposit && m.mutate({ itemId: deposit.itemId, forfeitedCents: value!, reason })}>Registrar</LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Motivo obrigatório (estorno / cancelamento) ─────────────

export function ReasonDialog({ open, onOpenChange, title, description, confirmLabel, loading, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: ReactNode; confirmLabel: string; loading?: boolean; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <TextField label="Motivo (obrigatório)" value={reason} onChange={setReason} multiline />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Voltar</Button>
          <LoadingButton variant="destructive" loading={loading} disabled={reason.trim().length < 3} onClick={() => onConfirm(reason.trim())}>{confirmLabel}</LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useCategoryOptions() {
  const q = trpc.finance.categories.useQuery();
  return useMemo(() => {
    const list = q.data ?? [];
    const roots = list.filter((c) => !c.parentId);
    return roots.flatMap((r) => [{ value: r.id, label: r.name }, ...list.filter((c) => c.parentId === r.id).map((c) => ({ value: c.id, label: `  ↳ ${c.name}` }))]);
  }, [q.data]);
}

export function useCanFinance() {
  const { can } = useMe();
  return { create: can("finance:create"), edit: can("finance:edit"), approve: can("finance:approve"), del: can("finance:delete") };
}

// ───────────── Tabela de dados ─────────────

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  /** Valor para ordenação (habilita o clique no cabeçalho) */
  sort?: (row: T) => string | number;
  className?: string;
  /** Rodapé de totais */
  footer?: ReactNode;
};

/**
 * Tabela do financeiro: cabeçalho fixo, ordenação, linha clicável, ações reveladas no hover,
 * zebra sutil, rodapé de totais, estado vazio interno e cartões no celular.
 */
export function DataTable<T>({
  rows, columns, rowKey, onRowClick, leading, actions, mobile, empty, rowClassName, initialSort, selection, caption,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (r: T) => string;
  onRowClick?: (r: T) => void;
  leading?: (r: T) => ReactNode;
  actions?: (r: T) => ReactNode;
  mobile?: (r: T) => ReactNode;
  empty?: ReactNode;
  rowClassName?: (r: T) => string | false | undefined;
  initialSort?: { key: string; dir: 1 | -1 };
  selection?: { selected: string[]; onChange: (ids: string[]) => void };
  caption?: ReactNode;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(initialSort ?? null);
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort?.key);
    if (!col?.sort || !sort) return rows;
    return [...rows].sort((a, b) => {
      const x = col.sort!(a), y = col.sort!(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, columns, sort]);
  const align = (a?: string) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");
  const hasFooter = columns.some((c) => c.footer !== undefined);
  const sel = selection?.selected ?? [];
  const allOn = !!selection && rows.length > 0 && rows.every((r) => sel.includes(rowKey(r)));
  const toggle = (id: string, on: boolean) => selection?.onChange(on ? [...sel, id] : sel.filter((x) => x !== id));
  const span = columns.length + (leading ? 1 : 0) + (actions ? 1 : 0) + (selection ? 1 : 0);

  return (
    <>
      <div className={cn("rounded-xl border bg-card shadow-soft", mobile ? "hidden md:block" : "overflow-x-auto md:overflow-clip")}>
        {caption && <div className="border-b px-4 py-3 text-sm">{caption}</div>}
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-[45px] z-10">
            <tr className="[&>th]:border-b [&>th]:bg-muted/80 [&>th]:backdrop-blur [&>th:first-child]:rounded-tl-xl [&>th:last-child]:rounded-tr-xl">
              {selection && (
                <th className="w-10 px-4 py-2.5">
                  <Checkbox checked={allOn} onCheckedChange={(v) => selection.onChange(v ? rows.map(rowKey) : [])} aria-label="Selecionar todas" />
                </th>
              )}
              {leading && <th className="w-12 py-2.5 pl-4" />}
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th key={c.key} className={cn("px-4 py-2.5 text-[11px] font-semibold tracking-wide whitespace-nowrap text-muted-foreground uppercase", align(c.align), leading && c === columns[0] && "pl-1", c.className)}>
                    {c.sort ? (
                      <button
                        className={cn("inline-flex items-center gap-1 uppercase transition hover:text-foreground", active && "text-foreground", c.align === "right" && "flex-row-reverse")}
                        onClick={() => setSort({ key: c.key, dir: active ? (-sort!.dir as 1 | -1) : 1 })}
                      >
                        {c.header}
                        {active ? (sort!.dir === 1 ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />) : <ChevronsUpDown className="size-3 opacity-40" />}
                      </button>
                    ) : c.header}
                  </th>
                );
              })}
              {actions && <th className="w-24 px-4 py-2.5" />}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, idx) => {
              const id = rowKey(r);
              const on = sel.includes(id);
              return (
                <tr
                  key={id}
                  onClick={onRowClick ? (e) => { if (!(e.target as HTMLElement).closest("button,a,input,[role=checkbox]")) onRowClick(r); } : undefined}
                  className={cn(
                    "group transition-colors [&>td]:border-b [&>td]:border-border/60",
                    idx % 2 === 1 && "[&>td]:bg-muted/20",
                    onRowClick && "cursor-pointer",
                    "hover:[&>td]:bg-accent/45",
                    on && "[&>td]:!bg-accent/60",
                    idx === sorted.length - 1 && !hasFooter && "[&>td]:border-b-0",
                    rowClassName?.(r),
                  )}
                >
                  {selection && <td className="px-4 py-3"><Checkbox checked={on} onCheckedChange={(v) => toggle(id, !!v)} aria-label="Selecionar" /></td>}
                  {leading && <td className="w-12 py-3 pl-4">{leading(r)}</td>}
                  {columns.map((c) => (
                    <td key={c.key} className={cn("px-4 py-3 align-middle", align(c.align), leading && c === columns[0] && "pl-1", c.className)}>{c.cell(r)}</td>
                  ))}
                  {actions && (
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">{actions(r)}</div>
                    </td>
                  )}
                </tr>
              );
            })}
            {!sorted.length && (
              <tr><td colSpan={span} className="px-4 py-12 text-center text-sm text-muted-foreground">{empty ?? "Nenhum registro."}</td></tr>
            )}
          </tbody>
          {hasFooter && sorted.length > 0 && (
            <tfoot>
              <tr className="[&>td]:border-t [&>td]:bg-muted/40 [&>td]:py-3 [&>td:first-child]:rounded-bl-xl [&>td:last-child]:rounded-br-xl">
                {selection && <td />}
                {leading && <td />}
                {columns.map((c) => <td key={c.key} className={cn("px-4 text-sm font-semibold", align(c.align), leading && c === columns[0] && "pl-1")}>{c.footer}</td>)}
                {actions && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {mobile && (
        <ul className="stagger space-y-2 md:hidden">
          {sorted.map((r) => {
            const id = rowKey(r);
            return (
              <li key={id} className={cn("flex items-start gap-3 rounded-xl border bg-card p-3 shadow-soft", onRowClick && "lift cursor-pointer", sel.includes(id) && "border-primary/50 bg-accent/40")} onClick={onRowClick ? (e) => { if (!(e.target as HTMLElement).closest("button,a,input,[role=checkbox]")) onRowClick(r); } : undefined}>
                {selection && <Checkbox className="mt-2" checked={sel.includes(id)} onCheckedChange={(v) => toggle(id, !!v)} />}
                <div className="min-w-0 flex-1">{mobile(r)}{actions && <div className="mt-2 flex flex-wrap gap-1">{actions(r)}</div>}</div>
              </li>
            );
          })}
          {!sorted.length && <li className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{empty ?? "Nenhum registro."}</li>}
        </ul>
      )}
    </>
  );
}

/** Linha principal + linha secundária discreta */
export function Cell2({ title, sub, className }: { title: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="truncate font-medium">{title}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ───────────── Orçamento total (somente leitura) ─────────────

export function BudgetEditor({ value, size = "lg", className }: { value: number; size?: keyof typeof SIZES; className?: string }) {
  return (
    <div className={cn("flex flex-col", className)}>
      <Money value={value} size={size} />
    </div>
  );
}

/** Orçamento por categoria com edição inline (finance.saveCategory) */
export function CategoryBudgetEditor({ compact }: { compact?: boolean }) {
  const cats = trpc.finance.categories.useQuery();
  const summary = trpc.finance.summary.useQuery();
  const perm = useCanFinance();
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState<string | null>(null);
  const [val, setVal] = useState<number | null>(null);
  const save = trpc.finance.saveCategory.useMutation({
    onSuccess: async () => { toast.success("Orçamento da categoria salvo"); setEditing(null); await utils.finance.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const all = cats.data ?? [];
  const s = summary.data;
  const roots = all.filter((c) => !c.parentId);
  const allocated = all.reduce((a, c) => a + c.budgetCents, 0);
  const total = s?.budget ?? 0;
  const unallocated = total - allocated;
  const stat = new Map((s?.categories ?? []).map((c) => [c.categoryId, c]));

  type Row = { id: string; name: string; parentId: string | null; budgetCents: number; child: boolean };
  const rows: Row[] = roots.flatMap((r) => [{ ...r, child: false }, ...all.filter((c) => c.parentId === r.id).map((c) => ({ ...c, child: true }))]);
  const visible = compact ? rows.filter((r) => !r.child) : rows;

  const cell = (r: Row) => {
    if (editing === r.id) {
      return (
        <form className="flex items-center justify-end gap-1" onSubmit={(e) => { e.preventDefault(); if (val != null && val >= 0) save.mutate({ id: r.id, name: r.name, parentId: r.parentId, budgetCents: val }); }}>
          <MoneyInput className="w-44 shrink-0" value={val} onChange={setVal} autoFocus />
          <Button type="submit" size="icon-sm" disabled={save.isPending} aria-label="Salvar"><Check /></Button>
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => setEditing(null)} aria-label="Cancelar"><X /></Button>
        </form>
      );
    }
    return (
      <button type="button" disabled={!perm.edit} onClick={() => { setEditing(r.id); setVal(r.budgetCents); }} className={cn("group/b inline-flex items-center gap-1.5 rounded-md px-1 disabled:cursor-default", perm.edit && "transition hover:bg-muted/70")}>
        {r.budgetCents ? <Money value={r.budgetCents} size="sm" /> : <span className="text-xs text-muted-foreground">definir</span>}
        {perm.edit && <Pencil className="size-3 text-muted-foreground opacity-0 transition group-hover/b:opacity-100" />}
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4 shadow-soft">
          <div className="text-[12.5px] font-medium text-muted-foreground">Orçamento total</div>
          <BudgetEditor value={total} size="xl" className="mt-2" />
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-soft">
          <div className="text-[12.5px] font-medium text-muted-foreground">Distribuído nas categorias</div>
          <Money value={allocated} size="xl" className="mt-2 block" />
          <Bar value={total ? (allocated / total) * 100 : 0} danger={allocated > total && total > 0} className="mt-2" />
        </div>
        <div className={cn("rounded-xl border bg-card p-4 shadow-soft", unallocated < 0 && "border-destructive/40")}>
          <div className="text-[12.5px] font-medium text-muted-foreground">{unallocated < 0 ? "Distribuído acima do total" : "Não distribuído"}</div>
          <Money value={Math.abs(unallocated)} size="xl" className={cn("mt-2 block", unallocated < 0 && "text-destructive")} />
          <div className="mt-1 text-xs text-muted-foreground">{total ? `${Math.round((allocated / total) * 100)}% do total` : "defina o orçamento total"}</div>
        </div>
      </div>
      <DataTable<Row>
        rows={visible}
        rowKey={(r) => r.id}
        empty="Nenhuma categoria."
        leading={(r) => (r.child ? <span className="block pl-3 text-muted-foreground">↳</span> : <Avatar name={r.name} className="size-8" />)}
        columns={[
          { key: "name", header: "Categoria", cell: (r) => <span className={cn(r.child ? "text-muted-foreground" : "font-medium")}>{r.name}</span>, sort: (r) => r.name },
          { key: "budget", header: "Orçamento", align: "right", cell, footer: <Money value={allocated} size="sm" /> },
          { key: "used", header: "Contratado / previsto", align: "right", cell: (r) => { const c = stat.get(r.id); return r.child ? <span className="text-xs text-muted-foreground">na categoria-mãe</span> : <Money value={c ? Math.max(c.contracted, c.planned) : 0} size="sm" />; }, footer: <Money value={Math.max(s?.contracted ?? 0, s?.planned ?? 0)} size="sm" /> },
          {
            key: "pct", header: "Uso", className: "w-48",
            cell: (r) => {
              const c = stat.get(r.id);
              if (r.child || !c) return null;
              const b = c.budget;
              const p = b ? Math.round((Math.max(c.contracted, c.planned) / b) * 100) : null;
              return p == null ? <span className="text-xs text-muted-foreground">sem orçamento</span> : <div className="flex items-center gap-2"><Bar value={p} danger={c.overBudget} /><span className={cn("w-10 text-right text-[11px] tabular-nums", c.overBudget ? "text-destructive" : "text-muted-foreground")}>{p}%</span></div>;
            },
          },
        ]}
        mobile={(r) => {
          const c = stat.get(r.id);
          return (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2"><span className={cn("font-medium", r.child && "pl-3 text-muted-foreground")}>{r.child ? "↳ " : ""}{r.name}</span>{cell(r)}</div>
              {!r.child && c && c.budget > 0 && <Bar value={(Math.max(c.contracted, c.planned) / c.budget) * 100} danger={c.overBudget} />}
            </div>
          );
        }}
      />
    </div>
  );
}

// ───────────── Nova conta a pagar (cadastro rápido) ─────────────

const BILL_MODES = [
  { value: "single", label: "À vista", hint: "Uma parcela só" },
  { value: "split", label: "Parcelado", hint: "Total dividido em parcelas" },
  { value: "monthly", label: "Mensal", hint: "Mesmo valor todo mês" },
] as const;

/** Conta a pagar em poucos campos: vira um lançamento contratado com as parcelas (e opcionalmente já paga) */
export function QuickBillDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone?: (obligationId: string | null) => void }) {
  const [key, setKey] = useState(newKey());
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [mode, setMode] = useState<(typeof BILL_MODES)[number]["value"]>("single");
  const [count, setCount] = useState("3");
  const [due, setDue] = useState(toDateInput(new Date()));
  const [categoryId, setCategoryId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [notes, setNotes] = useState("");
  const [paidNow, setPaidNow] = useState(false);
  const [method, setMethod] = useState("PIX");
  const [walletId, setWalletId] = useState("");
  const wallets = useWallets(open);
  const cats = trpc.finance.categories.useQuery(undefined, { enabled: open });
  const vendors = trpc.vendors.list.useQuery(undefined, { enabled: open });
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!open) return;
    setKey(newKey());
    setTitle("");
    setAmount(null);
    setMode("single");
    setCount("3");
    setDue(toDateInput(new Date()));
    setCategoryId("");
    setVendorId("");
    setNotes("");
    setPaidNow(false);
    setMethod("PIX");
  }, [open]);
  useEffect(() => {
    if (open) setWalletId(wallets.defaultId);
  }, [open, wallets.defaultId]);

  const n = mode === "single" ? 1 : Math.max(1, Math.min(60, Number(count) || 1));
  const total = amount ? (mode === "monthly" ? amount * n : amount) : 0;
  const per = amount ? (mode === "monthly" ? amount : Math.floor(amount / n)) : 0;
  const schedule = useMemo(() => {
    const first = fromDateInput(due);
    if (!first || !amount) return [];
    return Array.from({ length: Math.min(n, 6) }, (_, i) => {
      const d = new Date(first);
      d.setMonth(d.getMonth() + i);
      return d;
    });
  }, [due, n, amount]);
  const firstAmount = mode === "monthly" ? per : amount ? amount - per * (n - 1) : 0;
  const wallet = wallets.active.find((w) => w.id === walletId);

  const save = trpc.finance.quickBill.useMutation({
    onSuccess: async (r) => {
      toast.success(r.duplicate ? "Esta conta já havia sido cadastrada" : paidNow ? "Conta cadastrada e 1ª parcela paga" : "Conta a pagar cadastrada");
      await utils.finance.invalidate();
      onOpenChange(false);
      onDone?.(r.obligationId);
    },
    onError: (e) => toast.error(e.message),
  });
  const valid = title.trim().length >= 2 && !!amount && amount > 0 && !!fromDateInput(due);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHero icon={<Receipt />} title="Nova conta a pagar" subtitle="Cadastre uma conta em segundos — à vista, parcelada ou mensal." />
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <TextField label="O que é?" value={title} onChange={setTitle} placeholder="Ex.: Vestido da noiva, Aulas de dança, Sinal do buffet" autoFocus />

          <div className="rounded-xl bg-muted/50 p-4">
            <div role="radiogroup" aria-label="Forma" className="grid grid-cols-3 gap-1 rounded-lg bg-background/70 p-1">
              {BILL_MODES.map((m) => (
                <button key={m.value} type="button" role="radio" aria-checked={mode === m.value} onClick={() => setMode(m.value)} className={cn("rounded-md px-2 py-1.5 text-sm font-medium transition", mode === m.value ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground")}>{m.label}</button>
              ))}
            </div>
            <div className={cn("mt-3 grid gap-3", mode === "single" ? "grid-cols-1" : "grid-cols-[1fr_120px]")}>
              <Field label={mode === "monthly" ? "Valor de cada mês" : mode === "split" ? "Valor total" : "Valor"}>
                <MoneyInput className="[&_input]:h-11 [&_input]:text-xl [&_input]:font-semibold" value={amount} onChange={setAmount} />
              </Field>
              {mode !== "single" && (
                <Field label={mode === "monthly" ? "Meses" : "Parcelas"}>
                  <Input className="h-11 text-center text-lg font-semibold tabular-nums" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, "").slice(0, 2))} />
                </Field>
              )}
            </div>
            {amount && mode !== "single" ? (
              <p className="mt-2 text-xs text-muted-foreground animate-in fade-in">
                {n}× de <b className="text-foreground">{money(per)}</b>{mode === "split" && firstAmount !== per ? ` (1ª de ${money(firstAmount)})` : ""} · total <b className="text-foreground">{money(total)}</b>
              </p>
            ) : null}
          </div>

          <Field label={n > 1 ? "1º vencimento" : "Vencimento"}><QuickDate value={due} onChange={setDue} future /></Field>
          {schedule.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {schedule.map((d, i) => <span key={i} className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground tabular-nums">{date(d)}</span>)}
              {n > 6 && <span className="px-1 py-1 text-[11px] text-muted-foreground">+{n - 6}</span>}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Categoria"><NativeSelect value={categoryId} onChange={setCategoryId} placeholder="Sem categoria" options={(cats.data ?? []).map((c) => ({ value: c.id, label: c.parentId ? `— ${c.name}` : c.name }))} /></Field>
            <Field label="Fornecedor"><NativeSelect value={vendorId} onChange={setVendorId} placeholder="Nenhum" options={(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name }))} /></Field>
          </div>

          {/* Já paga? */}
          <div className={cn("rounded-xl border p-3 transition", paidNow && "border-emerald-500/40 bg-emerald-500/5")}>
            <label className="flex items-center justify-between gap-3">
              <span>
                <span className="block text-sm font-medium">{n > 1 ? "A 1ª parcela já foi paga" : "Já está paga"}</span>
                <span className="block text-xs text-muted-foreground">Registra o pagamento agora{wallet ? ` e debita de ${wallet.name}` : ""}.</span>
              </span>
              <Checkbox checked={paidNow} onCheckedChange={(v) => setPaidNow(!!v)} aria-label="Já paga" />
            </label>
            {paidNow && (
              <div className="mt-3 space-y-3 border-t pt-3 animate-in fade-in">
                <MethodPicker value={method} onChange={setMethod} />
                {wallets.active.length > 0 && (
                  <Field label="Pagar com">
                    <NativeSelect value={walletId} onChange={setWalletId} placeholder="Nenhuma carteira" options={wallets.active.map((w) => ({ value: w.id, label: `${w.name} · saldo ${money(w.balanceCents)}` }))} />
                  </Field>
                )}
              </div>
            )}
          </div>

          <MoreDetails label="Observações" badge={notes ? <StatusBadge tone="emerald">preenchido</StatusBadge> : null}>
            <TextField label="Observações" value={notes} onChange={setNotes} multiline placeholder="Nº do contrato, condições, contato…" />
          </MoreDetails>
        </div>
        <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-5 py-3">
          <div className="min-w-0 text-xs text-muted-foreground">{amount ? <>Total <b className="text-foreground">{money(total)}</b>{n > 1 ? ` em ${n}×` : ""}</> : "Preencha o valor"}</div>
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <LoadingButton
              loading={save.isPending}
              disabled={!valid}
              onClick={() =>
                save.mutate({
                  idempotencyKey: key, title: title.trim(), amountCents: amount!, amountMode: mode === "monthly" ? "each" : "total", installments: n, firstDue: fromDateInput(due)!,
                  categoryId: categoryId || null, vendorId: vendorId || null, notes: notes.trim() || null,
                  paidNow: paidNow ? { paidAt: new Date(), method: method as never, walletId: walletId || null } : null,
                })
              }
            >
              Cadastrar conta
            </LoadingButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
