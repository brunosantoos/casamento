import { Archive, ArchiveRestore, BellRing, Calendar, Check, ChevronDown, ClipboardCheck, Copy, Flag, Layers, Link2, ListPlus, Loader2, MapPin, MessageSquare, MoreHorizontal, Pencil, Plus, Receipt, RotateCcw, Search, Send, Store, Trash2, Users, Wand2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog, EmptyState, Field, LoadingButton, PageHeader, PageLoader, QueryState, StatCard, StatusBadge, TextField } from "@/components/app/common";
import { FileList, UploadButton } from "@/components/app/files";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useMe } from "@/hooks/use-me";
import { date, dateTime, fromDateInput, fromDateTimeInput, relative, toDateInput, toDateTimeInput } from "@/lib/format";
import { AREA, opt, PRIORITY, TASK_STATUS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { trpc, type RouterOutputs } from "@/trpc";

type Task = RouterOutputs["planning"]["tasks"][number];

// ───────────── Helpers compartilhados entre as páginas de planejamento ─────────────

/** Select nativo estilizado (aceita valor vazio) */
export function NativeSelect({ className, options, placeholder, ...props }: ComponentProps<"select"> & { options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <select
      className={cn("h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30", className)}
      {...props}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function Initials({ name, className }: { name: string; className?: string }) {
  const ini = name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return <span title={name} className={cn("grid size-6 place-items-center rounded-full bg-accent text-[10px] font-semibold text-accent-foreground ring-2 ring-card", className)}>{ini}</span>;
}

/** Multi-seleção simples por checkboxes com busca */
export function MultiPick({ options, value, onChange, empty = "Nenhuma opção" }: { options: { value: string; label: string; hint?: string }[]; value: string[]; onChange: (v: string[]) => void; empty?: string }) {
  const [q, setQ] = useState("");
  const list = options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="rounded-lg border">
      {options.length > 8 && <Input placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} className="rounded-b-none border-0 border-b" />}
      <div className="max-h-44 overflow-y-auto p-1">
        {list.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
            <Checkbox checked={value.includes(o.value)} onCheckedChange={(c) => onChange(c ? [...value, o.value] : value.filter((x) => x !== o.value))} />
            <span className="min-w-0 flex-1 truncate">{o.label}</span>
            {o.hint && <span className="text-xs text-muted-foreground">{o.hint}</span>}
          </label>
        ))}
        {!list.length && <p className="p-2 text-sm text-muted-foreground">{empty}</p>}
      </div>
    </div>
  );
}

export const isOverdue = (d: Date | string | null | undefined, status: string) => !!d && new Date(d) < new Date(new Date().setHours(0, 0, 0, 0)) && !["DONE", "CANCELLED"].includes(status);

// ───────────── Página ─────────────

export function ChecklistPage() {
  const { can } = useMe();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string[]>(params.get("status") ? [params.get("status")!] : []);
  const [phase, setPhase] = useState("");
  const [area, setArea] = useState("");
  const [assignee, setAssignee] = useState("");
  const [vendor, setVendor] = useState("");
  const [archived, setArchived] = useState(false);
  const [mine, setMine] = useState(false);
  const overdue = params.get("atrasadas") === "1";
  const [genOpen, setGenOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);

  const filters = {
    status: status.length ? (status as never) : undefined, phase: phase ? Number(phase) : undefined, area: area || undefined, assigneeId: assignee || undefined, vendorId: vendor || undefined,
    overdue: overdue || undefined, search: search || undefined, archived: archived || undefined, mine: mine || undefined,
  };
  const tasks = trpc.planning.tasks.useQuery(filters);
  const stats = trpc.planning.stats.useQuery();
  const assignable = trpc.planning.assignable.useQuery();
  const vendors = trpc.vendors.list.useQuery(undefined, { enabled: can("vendors:view") });

  const openId = params.get("tarefa");
  const setOpen = (id: string | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set("tarefa", id);
    else p.delete("tarefa");
    setParams(p, { replace: true });
  };

  const groups = useMemo(() => {
    const m = new Map<string, { key: string; label: string; items: Task[] }>();
    for (const t of tasks.data ?? []) {
      const key = t.phase ? `p${t.phase}` : "none";
      const label = t.phase ? `Fase ${t.phase}${t.category ? ` — ${t.category}` : ""}` : (t.category ?? "Sem fase");
      if (!m.has(key)) m.set(key, { key, label, items: [] });
      m.get(key)!.items.push(t);
    }
    return [...m.values()];
  }, [tasks.data]);

  const phases = useMemo(() => {
    const m = new Map<number, string>();
    for (const t of tasks.data ?? []) if (t.phase) m.set(t.phase, t.category ?? `Fase ${t.phase}`);
    for (let i = 1; i <= 9; i++) if (!m.has(i)) m.set(i, `Fase ${i}`);
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [tasks.data]);

  return (
    <>
      <PageHeader
        title="Planejamento e checklist"
        description="Tarefas por fase, com responsáveis, prazos, dependências e lembretes."
        actions={
          <>
            {can("planning:create") && <Button variant="outline" onClick={() => setTplOpen(true)}><ListPlus /> Modelos</Button>}
            {can("planning:create") && <Button variant="outline" onClick={() => setGenOpen(true)}><Wand2 /> Gerar do modelo</Button>}
            {can("planning:create") && <Button onClick={() => setOpen("new")}><Plus /> Nova tarefa</Button>}
          </>
        }
      />
      {stats.data && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard icon={<ClipboardCheck />} label="Total" value={stats.data.total} />
          <StatCard icon={<ClipboardCheck />} label="Concluídas" tone="emerald" value={stats.data.done} hint={stats.data.total ? `${Math.round((stats.data.done / Math.max(1, stats.data.total - stats.data.cancelled)) * 100)}%` : undefined} />
          <StatCard icon={<ClipboardCheck />} label="Pendentes" tone="sky" value={stats.data.open} />
          <StatCard icon={<ClipboardCheck />} label="Atrasadas" tone={stats.data.overdue ? "rose" : "neutral"} value={stats.data.overdue} onClick={() => { const p = new URLSearchParams(params); p.set("atrasadas", "1"); setParams(p); }} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar tarefa" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <NativeSelect className="w-auto" placeholder="Todas as fases" value={phase} onChange={(e) => setPhase(e.target.value)} options={phases.map(([n, l]) => ({ value: String(n), label: l.startsWith("Fase") ? l : `${n}. ${l}` }))} />
        <NativeSelect className="w-auto" placeholder="Todas as áreas" value={area} onChange={(e) => setArea(e.target.value)} options={opt(AREA)} />
        <NativeSelect className="w-auto" placeholder="Todos os status" value={status[0] ?? ""} onChange={(e) => setStatus(e.target.value ? [e.target.value] : [])} options={opt(TASK_STATUS)} />
        <NativeSelect className="w-auto" placeholder="Qualquer responsável" value={assignee} onChange={(e) => setAssignee(e.target.value)} options={(assignable.data ?? []).map((u) => ({ value: u.id, label: u.name }))} />
        {can("vendors:view") && <NativeSelect className="w-auto" placeholder="Qualquer fornecedor" value={vendor} onChange={(e) => setVendor(e.target.value)} options={(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name }))} />}
        <label className="flex items-center gap-1.5 text-sm"><Checkbox checked={mine} onCheckedChange={(v) => setMine(!!v)} /> Minhas</label>
        <label className="flex items-center gap-1.5 text-sm"><Checkbox checked={overdue} onCheckedChange={(v) => { const p = new URLSearchParams(params); if (v) p.set("atrasadas", "1"); else p.delete("atrasadas"); setParams(p); }} /> Atrasadas</label>
        <label className="flex items-center gap-1.5 text-sm"><Checkbox checked={archived} onCheckedChange={(v) => setArchived(!!v)} /> Arquivadas</label>
      </div>

      <QueryState
        query={tasks}
        empty={(list) =>
          list.length ? null : (
            <EmptyState
              icon={<ClipboardCheck />}
              title={archived ? "Nenhuma tarefa arquivada" : "Nenhuma tarefa encontrada"}
              description="Gere o checklist a partir do modelo de 9 fases ou crie tarefas avulsas."
              action={can("planning:create") ? <Button onClick={() => setGenOpen(true)}><Wand2 /> Gerar do modelo</Button> : undefined}
            />
          )
        }
      >
        {() => (
          <div className="space-y-5">
            {groups.map((g) => (
              <section key={g.key} className="rounded-xl border bg-card shadow-soft">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <h2 className="text-xl font-semibold">{g.label}</h2>
                  <span className="text-xs text-muted-foreground">{g.items.filter((t) => t.status === "DONE").length}/{g.items.length} concluídas</span>
                </div>
                <ul className="divide-y">{g.items.map((t) => <TaskRow key={t.id} task={t} onOpen={() => setOpen(t.id)} />)}</ul>
              </section>
            ))}
          </div>
        )}
      </QueryState>

      {openId && <TaskSheet key={openId} id={openId === "new" ? null : openId} onClose={() => setOpen(null)} onOpenTask={(tid) => setOpen(tid)} />}
      {genOpen && <GenerateDialog onClose={() => setGenOpen(false)} />}
      {tplOpen && <TemplatesDialog onClose={() => setTplOpen(false)} />}
    </>
  );
}

function useStatusMutation() {
  const utils = trpc.useUtils();
  return trpc.planning.setStatus.useMutation({
    onSuccess: () => { utils.planning.invalidate(); utils.ceremony.invalidate(); utils.dashboard.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
}

function TaskRow({ task: t, onOpen }: { task: Task; onOpen: () => void }) {
  const { can } = useMe();
  const setStatus = useStatusMutation();
  const done = t.status === "DONE";
  const late = isOverdue(t.dueDate, t.status);
  const openDeps = t.dependsOn.filter((d) => !["DONE", "CANCELLED"].includes(d.dependsOn.status));
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2.5">
      <Checkbox
        checked={done}
        disabled={!can("planning:edit") || setStatus.isPending}
        aria-label={done ? "Reabrir" : "Concluir"}
        onCheckedChange={(v) => setStatus.mutate({ id: t.id, status: v ? "DONE" : "IN_PROGRESS" }, { onSuccess: () => toast.success(v ? "Tarefa concluída" : "Tarefa reaberta") })}
      />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className={cn("truncate text-sm font-medium", done && "text-muted-foreground line-through")}>{t.title}</div>
        <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          {t.area && <span>{AREA[t.area] ?? t.area}</span>}
          {t.vendor && <span>{t.vendor.name}</span>}
          {openDeps.length > 0 && <span className="text-amber-600">Depende de {openDeps.length} tarefa(s)</span>}
          {t._count.comments > 0 && <span className="inline-flex items-center gap-0.5"><MessageSquare className="size-3" />{t._count.comments}</span>}
        </div>
      </button>
      <StatusBadge tone={PRIORITY[t.priority]?.tone}>{PRIORITY[t.priority]?.label}</StatusBadge>
      <span className={cn("w-24 text-right text-xs tabular-nums", late ? "font-semibold text-destructive" : "text-muted-foreground")}>{t.dueDate ? date(t.dueDate) : "Sem prazo"}</span>
      <div className="flex -space-x-1.5">{t.assignees.slice(0, 3).map((a) => <Initials key={a.userId} name={a.user.name} />)}</div>
      {can("planning:edit") ? (
        <NativeSelect className="w-44" value={t.status} onChange={(e) => setStatus.mutate({ id: t.id, status: e.target.value as never })} options={opt(TASK_STATUS)} aria-label="Status" />
      ) : (
        <StatusBadge tone={TASK_STATUS[t.status]?.tone}>{TASK_STATUS[t.status]?.label}</StatusBadge>
      )}
    </li>
  );
}

// ───────────── Detalhe / formulário da tarefa ─────────────

type Form = {
  title: string; description: string; phase: string; category: string; area: string; priority: string; status: string; dueDate: string; remindAt: string; notes: string;
  vendorId: string; obligationId: string; assigneeIds: string[]; dependsOnIds: string[];
};
const EMPTY: Form = { title: "", description: "", phase: "", category: "", area: "", priority: "MEDIUM", status: "NOT_STARTED", dueDate: "", remindAt: "", notes: "", vendorId: "", obligationId: "", assigneeIds: [], dependsOnIds: [] };

const DOT: Record<string, string> = {
  neutral: "bg-muted-foreground/50", sky: "bg-sky-500", amber: "bg-amber-500", violet: "bg-violet-500", emerald: "bg-emerald-500", rose: "bg-rose-500", gold: "bg-amber-400", wine: "bg-primary",
};
const dotFor = (status: string) => DOT[TASK_STATUS[status]?.tone ?? "neutral"] ?? DOT.neutral;
const MAIN_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "WAITING_THIRD_PARTY", "WAITING_APPROVAL", "DONE"] as const;
const SHORT_STATUS: Record<string, string> = { NOT_STARTED: "A fazer", IN_PROGRESS: "Fazendo", WAITING_THIRD_PARTY: "Aguardando terceiros", WAITING_APPROVAL: "Aguardando aprovação", DONE: "Concluída", CANCELLED: "Cancelada" };
const PRIORITY_STYLE: Record<string, string> = {
  LOW: "data-[on=true]:bg-muted data-[on=true]:text-foreground",
  MEDIUM: "data-[on=true]:bg-sky-500/15 data-[on=true]:text-sky-700 dark:data-[on=true]:text-sky-300",
  HIGH: "data-[on=true]:bg-amber-500/15 data-[on=true]:text-amber-700 dark:data-[on=true]:text-amber-300",
  URGENT: "data-[on=true]:bg-rose-500/15 data-[on=true]:text-rose-700 dark:data-[on=true]:text-rose-300",
};

const plusDays = (n: number, base = new Date()) => toDateInput(new Date(base.getFullYear(), base.getMonth(), base.getDate() + n, 12));
const daysLate = (d: string) => Math.floor((new Date(new Date().setHours(0, 0, 0, 0)).getTime() - new Date(`${d}T00:00:00`).getTime()) / 86400_000);

/** Popover simples (sem dependência extra): fecha ao clicar fora ou com Esc */
function Pop({ open, onOpenChange, trigger, children, className }: { open: boolean; onOpenChange: (o: boolean) => void; trigger: ReactNode; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onOpenChange(false); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey, true); };
  }, [open, onOpenChange]);
  return (
    <div ref={ref} className="relative min-w-0">
      {trigger}
      {open && (
        <div className={cn("absolute top-full left-0 z-50 mt-1 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg animate-in fade-in zoom-in-95", className)}>
          {children}
        </div>
      )}
    </div>
  );
}

/** Lista com busca dentro de um Pop */
function PickList({ items, selected, onToggle, multi, placeholder = "Buscar…", empty = "Nada encontrado" }: {
  items: { value: string; label: string; hint?: ReactNode; dot?: string }[]; selected: string[]; onToggle: (v: string) => void; multi?: boolean; placeholder?: string; empty?: string;
}) {
  const [q, setQ] = useState("");
  const list = items.filter((i) => !q || i.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <div className="relative border-b">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="h-9 w-full bg-transparent pr-2 pl-8 text-sm outline-none" />
      </div>
      <div className="max-h-60 overflow-y-auto p-1">
        {list.map((i) => {
          const on = selected.includes(i.value);
          return (
            <button key={i.value} type="button" onClick={() => onToggle(i.value)} className={cn("flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-muted", on && !multi && "bg-accent/60")}>
              {multi ? <Checkbox checked={on} tabIndex={-1} className="pointer-events-none" /> : i.dot ? <span className={cn("size-2 shrink-0 rounded-full", i.dot)} /> : null}
              <span className="min-w-0 flex-1 truncate">{i.label}</span>
              {i.hint && <span className="shrink-0 text-[11px] text-muted-foreground">{i.hint}</span>}
              {on && !multi && <Check className="size-3.5 shrink-0 text-primary" />}
            </button>
          );
        })}
        {!list.length && <p className="px-2 py-3 text-center text-xs text-muted-foreground">{empty}</p>}
      </div>
    </div>
  );
}

/** Linha de propriedade (ícone + rótulo | valor) */
function Prop({ icon: Icon, label, children, top }: { icon: typeof Calendar; label: string; children: ReactNode; top?: boolean }) {
  return (
    <div className={cn("grid min-w-0 grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] gap-x-3 py-1.5", top ? "items-start" : "items-center")}>
      <div className={cn("flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground", top && "pt-1.5")}>
        <Icon className="size-4 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const chip = "inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md border bg-background px-2 text-xs font-medium transition hover:border-primary/40 hover:text-foreground";
const ghostValue = "flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm transition hover:bg-muted/70";

function AutoTextarea({ value, onChange, placeholder, className, minRows = 2 }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; minRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn("w-full min-w-0 resize-none rounded-lg bg-transparent px-2 py-1.5 text-sm leading-relaxed outline-none transition placeholder:text-muted-foreground hover:bg-muted/50 focus:bg-muted/40", className)}
    />
  );
}

/** Formulário reutilizável (também usado pelas páginas de cerimônia/recepção com área pré-definida) */
export function TaskSheet({ id, onClose, preset, onOpenTask }: { id: string | null; onClose: () => void; preset?: Partial<Form>; onOpenTask?: (id: string) => void }) {
  const { can, me } = useMe();
  const utils = trpc.useUtils();
  const detail = trpc.planning.task.useQuery({ id: id! }, { enabled: !!id });
  const allTasks = trpc.planning.tasks.useQuery(undefined);
  const assignable = trpc.planning.assignable.useQuery();
  const templates = trpc.planning.templates.useQuery();
  const vendors = trpc.vendors.list.useQuery(undefined, { enabled: can("vendors:view") });
  const obligations = trpc.finance.obligations.useQuery(undefined, { enabled: can("finance:view") });
  const initial = useMemo<Form>(() => ({ ...EMPTY, ...preset }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [base, setBase] = useState<Form>(initial);
  const [f, setF] = useState<Form>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState<null | (() => void)>(null);
  const [pop, setPop] = useState<null | "assignees" | "deps" | "vendor" | "obligation" | "status">(null);
  const [activity, setActivity] = useState<"comments" | "files" | "history">("comments");
  const [showNotes, setShowNotes] = useState(false);

  useEffect(() => {
    const t = detail.data;
    if (!t) return;
    const loaded: Form = {
      title: t.title, description: t.description ?? "", phase: t.phase ? String(t.phase) : "", category: t.category ?? "", area: t.area ?? "", priority: t.priority, status: t.status,
      dueDate: toDateInput(t.dueDate), remindAt: toDateTimeInput(t.remindAt), notes: t.notes ?? "", vendorId: t.vendorId ?? "", obligationId: t.obligationId ?? "",
      assigneeIds: t.assignees.map((a) => a.userId), dependsOnIds: t.dependsOn.map((d) => d.dependsOnId),
    };
    setBase(loaded);
    setF(loaded);
    setShowNotes(!!loaded.notes);
  }, [detail.data]);

  const invalidate = () => { utils.planning.invalidate(); utils.ceremony.invalidate(); utils.dashboard.invalidate(); utils.calendar.invalidate(); };
  const save = trpc.planning.saveTask.useMutation({ onSuccess: () => { toast.success(id ? "Tarefa salva" : "Tarefa criada"); invalidate(); onClose(); }, onError: (e) => toast.error(e.message) });
  const setStatus = trpc.planning.setStatus.useMutation({ onError: (e) => toast.error(e.message) });
  const archive = trpc.planning.archive.useMutation({ onSuccess: (_d, v) => { toast.success(v.archived ? "Tarefa arquivada" : "Tarefa restaurada"); invalidate(); onClose(); }, onError: (e) => toast.error(e.message) });
  const del = trpc.planning.delete.useMutation({ onSuccess: () => { toast.success("Tarefa excluída"); invalidate(); onClose(); }, onError: (e) => toast.error(e.message) });
  const addComment = trpc.planning.addComment.useMutation({ onSuccess: () => { setComment(""); utils.planning.task.invalidate({ id: id! }); }, onError: (e) => toast.error(e.message) });

  const editable = id ? can("planning:edit") : can("planning:create");
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(f) !== JSON.stringify(base);
  const guard = (action: () => void) => (dirty && editable ? setConfirmDiscard(() => action) : action());
  const requestClose = () => guard(onClose);

  const phaseNames = useMemo(() => {
    const m = new Map<number, string>();
    for (const tpl of templates.data ?? []) for (const it of tpl.items) if (!m.has(it.phase)) m.set(it.phase, it.phaseName);
    return m;
  }, [templates.data]);
  const taskById = useMemo(() => new Map((allTasks.data ?? []).map((x) => [x.id, x])), [allTasks.data]);
  const people = assignable.data ?? [];
  const vendor = (vendors.data ?? []).find((v) => v.id === f.vendorId);
  const obligation = (obligations.data ?? []).find((o) => o.id === f.obligationId);

  function submit() {
    if (f.title.trim().length < 2) return setErr("Dê um título à tarefa");
    setErr(null);
    save.mutate({
      id: id ?? undefined, title: f.title.trim(), description: f.description || null, category: f.category || null, phase: f.phase ? Number(f.phase) : null, area: f.area || null,
      priority: f.priority as never, status: f.status as never, dueDate: fromDateInput(f.dueDate), remindAt: fromDateTimeInput(f.remindAt), notes: f.notes || null,
      vendorId: f.vendorId || null, obligationId: f.obligationId || null, assigneeIds: f.assigneeIds, dependsOnIds: f.dependsOnIds,
    });
  }

  /** Concluir/reabrir na hora (o servidor valida dependências em aberto) */
  function toggleDone() {
    if (!id) return set("status", f.status === "DONE" ? "NOT_STARTED" : "DONE");
    const next = f.status === "DONE" ? "IN_PROGRESS" : "DONE";
    setStatus.mutate({ id, status: next as never }, {
      onSuccess: () => {
        toast.success(next === "DONE" ? "Tarefa concluída 🎉" : "Tarefa reaberta");
        setF((x) => ({ ...x, status: next }));
        setBase((x) => ({ ...x, status: next }));
        invalidate();
      },
    });
  }

  function remindPreset(kind: "dayBefore" | "morning") {
    if (!f.dueDate) return toast.error("Defina o prazo primeiro");
    const d = new Date(`${f.dueDate}T00:00:00`);
    if (kind === "dayBefore") d.setDate(d.getDate() - 1);
    d.setHours(kind === "dayBefore" ? 9 : 8, 0, 0, 0);
    set("remindAt", toDateTimeInput(d));
  }

  const t = detail.data;
  const done = f.status === "DONE";
  const late = f.dueDate && !["DONE", "CANCELLED"].includes(f.status) ? daysLate(f.dueDate) : 0;
  const myId = me?.user.id;

  return (
    <Sheet open onOpenChange={(o) => !o && requestClose()}>
      <SheetContent side="right" size="xl" showCloseButton={false} className="p-0">
        <SheetTitle className="sr-only">{id ? "Tarefa" : "Nova tarefa"}</SheetTitle>
        {id && detail.isLoading ? <div className="flex-1"><PageLoader /></div> : id && detail.error ? <p className="p-5 text-sm text-destructive">{detail.error.message}</p> : (
          <>
            {/* Cabeçalho */}
            <div className="shrink-0 border-b px-5 pt-4 pb-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  <ClipboardCheck className="size-3.5 shrink-0" />
                  <span className="truncate">{id ? (f.category || (f.phase ? phaseNames.get(Number(f.phase)) : null) || "Tarefa") : "Nova tarefa"}</span>
                  {t?.archivedAt && <StatusBadge tone="neutral">arquivada</StatusBadge>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {id && can("planning:edit") && (
                    <Button size="sm" variant={done ? "outline" : "default"} className={cn(!done && "bg-emerald-600 text-white hover:bg-emerald-600/90")} disabled={setStatus.isPending} onClick={toggleDone}>
                      {setStatus.isPending ? <Loader2 className="animate-spin" /> : done ? <RotateCcw /> : <Check />} {done ? "Reabrir" : "Concluir"}
                    </Button>
                  )}
                  <Button size="icon-sm" variant="ghost" aria-label="Fechar" onClick={requestClose}><X /></Button>
                </div>
              </div>
              <div className="mt-2 flex min-w-0 items-start gap-2">
                {!id && (
                  <button type="button" onClick={toggleDone} aria-label="Marcar como concluída" className={cn("mt-1.5 grid size-5 shrink-0 place-items-center rounded-full border-2 transition", done ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/40 hover:border-emerald-500")}>
                    {done && <Check className="size-3" />}
                  </button>
                )}
                <AutoTextarea
                  value={f.title}
                  onChange={(v) => { set("title", v.replace(/\n/g, " ")); if (err) setErr(null); }}
                  placeholder="Nome da tarefa"
                  minRows={1}
                  className={cn("px-0 text-xl leading-snug font-semibold hover:bg-transparent focus:bg-transparent", done && "text-muted-foreground line-through")}
                />
              </div>
              {err && <p className="text-xs font-medium text-destructive">{err}</p>}

              {/* Status */}
              <fieldset disabled={!editable} className="mt-2 flex min-w-0 flex-wrap items-center gap-1">
                {MAIN_STATUSES.map((st) => (
                  <button key={st} type="button" data-on={f.status === st} onClick={() => set("status", st)} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-transparent px-2.5 text-xs font-medium text-muted-foreground transition hover:bg-muted data-[on=true]:border-border data-[on=true]:bg-card data-[on=true]:text-foreground data-[on=true]:shadow-soft">
                    <span className={cn("size-2 rounded-full", dotFor(st))} />
                    {SHORT_STATUS[st]}
                  </button>
                ))}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" data-on={f.status === "CANCELLED"} className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs font-medium text-muted-foreground transition hover:bg-muted data-[on=true]:bg-rose-500/12 data-[on=true]:text-rose-700 dark:data-[on=true]:text-rose-300" aria-label="Mais status">
                      {f.status === "CANCELLED" ? <><span className="size-2 rounded-full bg-rose-500" /> Cancelada</> : <MoreHorizontal className="size-4" />}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => set("status", "CANCELLED")}><span className="size-2 rounded-full bg-rose-500" /> Cancelada</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </fieldset>
            </div>

            {/* Corpo */}
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-3">
              <fieldset disabled={!editable} className="min-w-0 space-y-0.5">
                <Prop icon={Flag} label="Prioridade">
                  <div className="flex min-w-0 flex-wrap gap-1">
                    {(["LOW", "MEDIUM", "HIGH", "URGENT"] as const).map((p) => (
                      <button key={p} type="button" data-on={f.priority === p} onClick={() => set("priority", p)} className={cn("h-7 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition hover:bg-muted", PRIORITY_STYLE[p])}>{PRIORITY[p]?.label}</button>
                    ))}
                  </div>
                </Prop>

                <Prop icon={Calendar} label="Prazo" top>
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                      {[{ l: "Hoje", v: plusDays(0) }, { l: "Amanhã", v: plusDays(1) }, { l: "+1 semana", v: plusDays(7) }].map((c) => (
                        <button key={c.l} type="button" onClick={() => set("dueDate", c.v)} className={cn(chip, f.dueDate === c.v && "border-primary bg-primary/8 text-foreground")}>{c.l}</button>
                      ))}
                      <Input type="date" value={f.dueDate} onChange={(e) => set("dueDate", e.target.value)} className="h-7 w-36 min-w-0 px-2 text-xs" aria-label="Data do prazo" />
                      {f.dueDate && <button type="button" onClick={() => set("dueDate", "")} className="text-xs text-muted-foreground hover:text-foreground">limpar</button>}
                    </div>
                    {f.dueDate && (
                      <p className={cn("text-xs", late > 0 ? "font-medium text-destructive" : "text-muted-foreground")}>
                        {late > 0 ? `Atrasada há ${late} dia${late > 1 ? "s" : ""}` : late === 0 && !["DONE", "CANCELLED"].includes(f.status) ? "Vence hoje" : date(fromDateInput(f.dueDate), { weekday: "long", day: "numeric", month: "long" })}
                      </p>
                    )}
                  </div>
                </Prop>

                <Prop icon={Users} label="Responsáveis" top>
                  <div className="flex min-w-0 flex-wrap items-center gap-1">
                    {f.assigneeIds.map((uid) => {
                      const u = people.find((p) => p.id === uid);
                      return (
                        <span key={uid} className="inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full border bg-background py-0 pr-1 pl-0.5 text-xs">
                          <Initials name={u?.name ?? "?"} className="size-6 ring-0" />
                          <span className="min-w-0 truncate">{u?.name ?? "—"}</span>
                          {editable && <button type="button" aria-label={`Remover ${u?.name}`} onClick={() => set("assigneeIds", f.assigneeIds.filter((x) => x !== uid))} className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-3" /></button>}
                        </span>
                      );
                    })}
                    {editable && (
                      <Pop open={pop === "assignees"} onOpenChange={(o) => setPop(o ? "assignees" : null)} trigger={<button type="button" onClick={() => setPop(pop === "assignees" ? null : "assignees")} className={cn(chip, "border-dashed text-muted-foreground")}><Plus className="size-3.5" /> {f.assigneeIds.length ? "Adicionar" : "Atribuir"}</button>}>
                        <PickList multi items={people.map((u) => ({ value: u.id, label: u.name, hint: u.role }))} selected={f.assigneeIds} placeholder="Buscar pessoa…" empty="Ninguém encontrado" onToggle={(v) => set("assigneeIds", f.assigneeIds.includes(v) ? f.assigneeIds.filter((x) => x !== v) : [...f.assigneeIds, v])} />
                      </Pop>
                    )}
                  </div>
                </Prop>

                <Prop icon={BellRing} label="Lembrete" top>
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                      <button type="button" onClick={() => remindPreset("dayBefore")} className={chip}>1 dia antes do prazo</button>
                      <button type="button" onClick={() => remindPreset("morning")} className={chip}>Na manhã do prazo</button>
                    </div>
                    <div className="flex min-w-0 items-center gap-1">
                      <Input type="datetime-local" value={f.remindAt} onChange={(e) => set("remindAt", e.target.value)} className="h-7 w-52 min-w-0 px-2 text-xs" aria-label="Data do lembrete" />
                      {f.remindAt && <button type="button" onClick={() => set("remindAt", "")} className="text-xs text-muted-foreground hover:text-foreground">limpar</button>}
                    </div>
                    <p className="text-[11px] text-muted-foreground">Enviado por e-mail aos responsáveis.</p>
                  </div>
                </Prop>

                <Prop icon={Layers} label="Fase">
                  <NativeSelect
                    className="h-8 border-transparent hover:border-input"
                    placeholder="Sem fase"
                    value={f.phase}
                    onChange={(e) => {
                      const v = e.target.value;
                      const prevName = f.phase ? phaseNames.get(Number(f.phase)) : undefined;
                      const name = v ? phaseNames.get(Number(v)) : undefined;
                      setF((x) => ({ ...x, phase: v, category: !x.category || x.category === prevName ? (name ?? x.category) : x.category }));
                    }}
                    options={Array.from({ length: 9 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} · ${phaseNames.get(i + 1) ?? `Fase ${i + 1}`}` }))}
                  />
                </Prop>

                <Prop icon={MapPin} label="Área">
                  <NativeSelect className="h-8 border-transparent hover:border-input" placeholder="Geral" value={f.area} onChange={(e) => set("area", e.target.value)} options={opt(AREA)} />
                </Prop>

                {can("vendors:view") && (
                  <Prop icon={Store} label="Fornecedor">
                    <Pop open={pop === "vendor"} onOpenChange={(o) => setPop(o ? "vendor" : null)} trigger={
                      <button type="button" onClick={() => setPop(pop === "vendor" ? null : "vendor")} className={cn(ghostValue, !vendor && "text-muted-foreground")}>
                        <span className="min-w-0 flex-1 truncate">{vendor?.name ?? "Nenhum"}</span>
                        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    }>
                      <PickList items={[{ value: "", label: "Nenhum" }, ...(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name }))]} selected={[f.vendorId]} placeholder="Buscar fornecedor…" onToggle={(v) => { set("vendorId", v); setPop(null); }} />
                    </Pop>
                  </Prop>
                )}

                {can("finance:view") && (
                  <Prop icon={Receipt} label="Despesa vinculada">
                    <Pop open={pop === "obligation"} onOpenChange={(o) => setPop(o ? "obligation" : null)} trigger={
                      <button type="button" onClick={() => setPop(pop === "obligation" ? null : "obligation")} className={cn(ghostValue, !obligation && "text-muted-foreground")}>
                        <span className="min-w-0 flex-1 truncate">{obligation?.title ?? "Nenhuma"}</span>
                        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    }>
                      <PickList items={[{ value: "", label: "Nenhuma" }, ...(obligations.data ?? []).map((o) => ({ value: o.id, label: o.title, hint: o.vendor?.name }))]} selected={[f.obligationId]} placeholder="Buscar lançamento…" onToggle={(v) => { set("obligationId", v); setPop(null); }} />
                    </Pop>
                  </Prop>
                )}
              </fieldset>

              {/* Descrição */}
              <div className="mt-3 border-t pt-3">
                <AutoTextarea value={f.description} onChange={(v) => set("description", v)} placeholder={editable ? "Adicione detalhes…" : "Sem descrição"} minRows={2} />
                {(showNotes || f.notes) ? (
                  <div className="mt-2">
                    <div className="px-2 text-xs font-medium text-muted-foreground">Observações</div>
                    <AutoTextarea value={f.notes} onChange={(v) => set("notes", v)} placeholder="Anotações internas…" minRows={1} />
                  </div>
                ) : editable ? (
                  <button type="button" onClick={() => setShowNotes(true)} className="mt-1 px-2 text-xs font-medium text-muted-foreground hover:text-foreground">+ Observações</button>
                ) : null}
              </div>

              {/* Dependências */}
              <div className="mt-3 space-y-2 border-t pt-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-[13px] font-medium"><Link2 className="size-4 text-muted-foreground" /> Depende de</span>
                  {editable && (
                    <Pop className="right-0 left-auto" open={pop === "deps"} onOpenChange={(o) => setPop(o ? "deps" : null)} trigger={<button type="button" onClick={() => setPop(pop === "deps" ? null : "deps")} className={cn(chip, "border-dashed text-muted-foreground")}><Plus className="size-3.5" /> Adicionar dependência</button>}>
                      <PickList
                        multi
                        items={(allTasks.data ?? []).filter((x) => x.id !== id).map((x) => ({ value: x.id, label: x.title, hint: SHORT_STATUS[x.status] }))}
                        selected={f.dependsOnIds}
                        placeholder="Buscar tarefa…"
                        empty="Nenhuma outra tarefa"
                        onToggle={(v) => set("dependsOnIds", f.dependsOnIds.includes(v) ? f.dependsOnIds.filter((x) => x !== v) : [...f.dependsOnIds, v])}
                      />
                    </Pop>
                  )}
                </div>
                {f.dependsOnIds.length ? (
                  <div className="flex min-w-0 flex-wrap gap-1.5">
                    {f.dependsOnIds.map((did) => {
                      const d = taskById.get(did);
                      return (
                        <span key={did} className="inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md border bg-background pr-1 pl-2 text-xs">
                          <span className={cn("size-2 shrink-0 rounded-full", dotFor(d?.status ?? "NOT_STARTED"))} />
                          <button type="button" disabled={!onOpenTask} onClick={() => onOpenTask && guard(() => onOpenTask(did))} className={cn("min-w-0 truncate", d?.status === "DONE" && "text-muted-foreground line-through", onOpenTask && "hover:underline")}>{d?.title ?? "Tarefa"}</button>
                          {editable && <button type="button" aria-label="Remover dependência" onClick={() => set("dependsOnIds", f.dependsOnIds.filter((x) => x !== did))} className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-3" /></button>}
                        </span>
                      );
                    })}
                  </div>
                ) : <p className="text-xs text-muted-foreground">Nenhuma. A tarefa pode ser concluída a qualquer momento.</p>}
                {t && t.blocks.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <div className="text-xs text-muted-foreground">Bloqueia</div>
                    <div className="flex min-w-0 flex-wrap gap-1.5">
                      {t.blocks.map((b) => (
                        <button key={b.task.id} type="button" disabled={!onOpenTask} onClick={() => onOpenTask && guard(() => onOpenTask(b.task.id))} className="inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md bg-muted/60 px-2 text-xs text-muted-foreground enabled:hover:text-foreground">
                          <span className={cn("size-2 shrink-0 rounded-full", dotFor(b.task.status))} />
                          <span className="min-w-0 truncate">{b.task.title}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {t && t.events.length > 0 && (
                  <p className="text-xs text-muted-foreground">Compromissos: {t.events.map((e) => `${e.title} (${dateTime(e.startsAt)})`).join(", ")}</p>
                )}
              </div>

              {/* Atividade */}
              {id && t && (
                <div className="mt-4 border-t pt-3">
                  <div role="tablist" className="inline-flex rounded-lg bg-muted p-0.5">
                    {([["comments", `Comentários${t.comments.length ? ` · ${t.comments.length}` : ""}`], ["files", `Arquivos${t.files.length ? ` · ${t.files.length}` : ""}`], ["history", "Histórico"]] as const).map(([k, l]) => (
                      <button key={k} type="button" role="tab" aria-selected={activity === k} onClick={() => setActivity(k)} className={cn("rounded-md px-3 py-1 text-xs font-medium transition", activity === k ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground")}>{l}</button>
                    ))}
                  </div>

                  {activity === "comments" && (
                    <div className="mt-3 space-y-3">
                      {t.comments.length ? (
                        <ul className="space-y-2.5">
                          {t.comments.map((c) => {
                            const name = (c.userId && t.commentAuthors[c.userId]) || "—";
                            const mine = c.userId === myId;
                            return (
                              <li key={c.id} className={cn("flex min-w-0 items-end gap-2", mine && "flex-row-reverse")}>
                                <Initials name={name} className="size-7 shrink-0 ring-0" />
                                <div className={cn("max-w-[80%] min-w-0 rounded-2xl px-3 py-2 text-sm", mine ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-muted")}>
                                  <div className={cn("mb-0.5 text-[11px]", mine ? "text-primary-foreground/75" : "text-muted-foreground")}>{mine ? "Você" : name} · {relative(c.createdAt)}</div>
                                  <p className="break-words whitespace-pre-wrap">{c.body}</p>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      ) : <p className="py-2 text-center text-xs text-muted-foreground">Nenhum comentário ainda. Use para combinar detalhes com a equipe.</p>}
                      <div className="flex min-w-0 items-end gap-2 rounded-xl border bg-background p-1.5 focus-within:border-ring">
                        <textarea
                          rows={1}
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (comment.trim() && !addComment.isPending) addComment.mutate({ taskId: id, body: comment.trim() }); } }}
                          placeholder="Escreva um comentário… (Enter envia)"
                          className="max-h-32 min-h-8 min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
                        />
                        <Button size="icon-sm" disabled={!comment.trim() || addComment.isPending} aria-label="Enviar" onClick={() => addComment.mutate({ taskId: id, body: comment.trim() })}>
                          {addComment.isPending ? <Loader2 className="animate-spin" /> : <Send />}
                        </Button>
                      </div>
                    </div>
                  )}

                  {activity === "files" && (
                    <div className="mt-3 space-y-3">
                      {can("documents:create") && <UploadButton category="DOCUMENT" entityType="task" entityId={id} multiple size="sm" onUploaded={() => utils.planning.task.invalidate({ id })} />}
                      <FileList files={t.files} onChanged={() => utils.planning.task.invalidate({ id })} emptyText="Nenhum arquivo anexado." />
                    </div>
                  )}

                  {activity === "history" && (
                    <div className="mt-3">
                      {t.history.length ? (
                        <ol className="relative space-y-3 border-l pl-4">
                          {t.history.map((h) => (
                            <li key={h.id} className="relative min-w-0 text-sm">
                              <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-background bg-primary/60" />
                              <div className="break-words">{h.summary}</div>
                              <div className="text-[11px] text-muted-foreground">{h.userName ?? "Sistema"} · {dateTime(h.createdAt)}</div>
                            </li>
                          ))}
                        </ol>
                      ) : <p className="py-2 text-center text-xs text-muted-foreground">Sem histórico.</p>}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Rodapé */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-t bg-muted/30 px-5 py-3">
              <div className="flex min-w-0 items-center gap-2">
                {id && (can("planning:edit") || can("planning:delete")) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="Mais ações"><MoreHorizontal /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {can("planning:edit") && (
                        <DropdownMenuItem onClick={() => archive.mutate({ id, archived: !t?.archivedAt })}>
                          {t?.archivedAt ? <><ArchiveRestore /> Restaurar</> : <><Archive /> Arquivar</>}
                        </DropdownMenuItem>
                      )}
                      {can("planning:delete") && <DropdownMenuItem variant="destructive" onClick={() => setConfirmDel(true)}><Trash2 /> Excluir</DropdownMenuItem>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                  {t?.completedAt && done ? `Concluída em ${dateTime(t.completedAt)}` : dirty ? "Alterações não salvas" : t ? `Atualizada ${relative(t.updatedAt)}` : ""}
                </span>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="ghost" onClick={requestClose}>{editable ? "Cancelar" : "Fechar"}</Button>
                {editable && <LoadingButton loading={save.isPending} disabled={(!!id && !dirty) || f.title.trim().length < 2} onClick={submit}>{id ? "Salvar" : "Criar tarefa"}</LoadingButton>}
              </div>
            </div>
          </>
        )}
        <ConfirmDialog open={confirmDel} onOpenChange={setConfirmDel} title="Excluir tarefa?" description="A exclusão é definitiva. Para apenas tirar da lista, prefira arquivar." destructive confirmLabel="Excluir" loading={del.isPending} onConfirm={() => id && del.mutate({ id })} />
        <ConfirmDialog
          open={!!confirmDiscard}
          onOpenChange={(o) => !o && setConfirmDiscard(null)}
          title="Descartar alterações?"
          description="Você fez mudanças nesta tarefa que ainda não foram salvas."
          destructive
          confirmLabel="Descartar"
          onConfirm={() => { const a = confirmDiscard; setConfirmDiscard(null); a?.(); }}
        />
      </SheetContent>
    </Sheet>
  );
}

// ───────────── Gerar do modelo ─────────────

function GenerateDialog({ onClose }: { onClose: () => void }) {
  const { wedding } = useMe();
  const utils = trpc.useUtils();
  const templates = trpc.planning.templates.useQuery();
  const existing = trpc.planning.tasks.useQuery({ archived: undefined });
  const [tplId, setTplId] = useState("");
  const [phases, setPhases] = useState<number[]>([]);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [skip, setSkip] = useState<string[]>([]);
  const tpl = templates.data?.find((t) => t.id === (tplId || templates.data?.[0]?.id));
  const already = new Set((existing.data ?? []).map((t) => t.templateItemId).filter(Boolean));

  useEffect(() => {
    if (!tpl) return;
    setPhases([...new Set(tpl.items.map((i) => i.phase))]);
    const base = wedding?.date ? new Date(wedding.date) : null;
    setDates(Object.fromEntries(tpl.items.map((i) => [i.id, base && i.offsetDays != null ? toDateInput(new Date(base.getTime() + i.offsetDays * 86400_000)) : ""])));
    setSkip([]);
  }, [tpl?.id, wedding?.date]); // eslint-disable-line react-hooks/exhaustive-deps

  const gen = trpc.planning.generateFromTemplate.useMutation({
    onSuccess: (r) => { toast.success(`${r.created} tarefa(s) criada(s)${r.skipped ? `, ${r.skipped} já existiam` : ""}`); utils.planning.invalidate(); utils.dashboard.invalidate(); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  const items = (tpl?.items ?? []).filter((i) => phases.includes(i.phase) && !skip.includes(i.id));
  const phaseList = tpl ? [...new Map(tpl.items.map((i) => [i.phase, i.phaseName])).entries()] : [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>Gerar tarefas a partir de um modelo</DialogTitle></DialogHeader>
        {templates.isLoading ? <PageLoader /> : (
          <div className="space-y-4">
            <Field label="Modelo"><NativeSelect value={tpl?.id ?? ""} onChange={(e) => setTplId(e.target.value)} options={(templates.data ?? []).map((t) => ({ value: t.id, label: `${t.name}${t.weddingId ? "" : " (padrão)"}` }))} /></Field>
            <p className="text-xs text-muted-foreground">
              {wedding?.date ? `Prazos sugeridos a partir da data do casamento (${date(wedding.date)}). Ajuste qualquer data abaixo.` : "O casamento ainda não tem data: as tarefas serão criadas sem prazo, a menos que você informe."} Tarefas já geradas deste modelo são ignoradas.
            </p>
            <div className="flex flex-wrap gap-2">
              {phaseList.map(([n, name]) => (
                <label key={n} className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs">
                  <Checkbox checked={phases.includes(n)} onCheckedChange={(v) => setPhases(v ? [...phases, n] : phases.filter((p) => p !== n))} /> {n}. {name}
                </label>
              ))}
            </div>
            <ul className="divide-y rounded-xl border">
              {(tpl?.items ?? []).filter((i) => phases.includes(i.phase)).map((i) => (
                <li key={i.id} className={cn("flex flex-wrap items-center gap-2 px-3 py-2 text-sm", skip.includes(i.id) && "opacity-50")}>
                  <Checkbox checked={!skip.includes(i.id)} onCheckedChange={(v) => setSkip(v ? skip.filter((x) => x !== i.id) : [...skip, i.id])} />
                  <span className="w-6 text-xs text-muted-foreground">{i.phase}</span>
                  <span className="min-w-0 flex-1 truncate">{i.title}</span>
                  {already.has(i.id) && <StatusBadge>já existe</StatusBadge>}
                  <Input type="date" className="w-40" value={dates[i.id] ?? ""} onChange={(e) => setDates({ ...dates, [i.id]: e.target.value })} />
                </li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <LoadingButton
            loading={gen.isPending}
            disabled={!tpl || !items.length}
            onClick={() => tpl && gen.mutate({ templateId: tpl.id, itemIds: items.map((i) => i.id), dateOverrides: Object.fromEntries(items.map((i) => [i.id, fromDateInput(dates[i.id] ?? "")])) })}
          >
            Gerar {items.length} tarefa(s)
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Gestão de modelos ─────────────

type TplItem = RouterOutputs["planning"]["templates"][number]["items"][number];

function TemplatesDialog({ onClose }: { onClose: () => void }) {
  const { can } = useMe();
  const utils = trpc.useUtils();
  const templates = trpc.planning.templates.useQuery();
  const [sel, setSel] = useState("");
  const [editing, setEditing] = useState<Partial<TplItem> | null>(null);
  const [delTpl, setDelTpl] = useState(false);
  const tpl = templates.data?.find((t) => t.id === (sel || templates.data?.[0]?.id));
  const inv = () => utils.planning.templates.invalidate();
  const clone = trpc.planning.cloneTemplate.useMutation({ onSuccess: (t) => { toast.success("Modelo copiado — agora você pode editá-lo"); inv(); setSel(t.id); }, onError: (e) => toast.error(e.message) });
  const saveItem = trpc.planning.saveTemplateItem.useMutation({ onSuccess: () => { toast.success("Item salvo"); inv(); setEditing(null); }, onError: (e) => toast.error(e.message) });
  const delItem = trpc.planning.deleteTemplateItem.useMutation({ onSuccess: () => { toast.success("Item removido"); inv(); }, onError: (e) => toast.error(e.message) });
  const deleteTpl = trpc.planning.deleteTemplate.useMutation({ onSuccess: () => { toast.success("Modelo excluído"); setSel(""); setDelTpl(false); inv(); }, onError: (e) => toast.error(e.message) });
  const own = !!tpl?.weddingId;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>Modelos de checklist</DialogTitle></DialogHeader>
        <QueryState query={templates}>
          {(list) => (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <NativeSelect className="w-auto flex-1" value={tpl?.id ?? ""} onChange={(e) => setSel(e.target.value)} options={list.map((t) => ({ value: t.id, label: `${t.name}${t.weddingId ? "" : " (padrão, somente leitura)"}` }))} />
                {tpl && <Button variant="outline" size="sm" onClick={() => clone.mutate({ templateId: tpl.id, name: `${tpl.name} (cópia)` })}><Copy /> Copiar para editar</Button>}
                {own && can("planning:edit") && <Button size="sm" onClick={() => setEditing({ phase: 1, phaseName: "", title: "", priority: "MEDIUM", offsetDays: null, area: null })}><Plus /> Item</Button>}
                {own && can("planning:delete") && <Button size="sm" variant="destructive" onClick={() => setDelTpl(true)}><Trash2 /></Button>}
              </div>
              {!own && <p className="text-xs text-muted-foreground">O modelo padrão é compartilhado. Faça uma cópia para personalizar fases, títulos e prazos.</p>}
              <ul className="divide-y rounded-xl border">
                {tpl?.items.map((i) => (
                  <li key={i.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{i.phase}. {i.phaseName}</span>
                    <span className="min-w-0 flex-1 truncate">{i.title}</span>
                    {i.area && <StatusBadge>{AREA[i.area] ?? i.area}</StatusBadge>}
                    <span className="w-24 text-right text-xs text-muted-foreground">{i.offsetDays == null ? "sem prazo" : `${i.offsetDays > 0 ? "+" : ""}${i.offsetDays} dias`}</span>
                    {own && can("planning:edit") && (
                      <>
                        <Button size="icon-sm" variant="ghost" aria-label="Editar" onClick={() => setEditing(i)}><Pencil /></Button>
                        <Button size="icon-sm" variant="ghost" aria-label="Remover" onClick={() => delItem.mutate({ id: i.id })}><Trash2 /></Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </QueryState>
        {editing && tpl && (
          <div className="space-y-3 rounded-xl border bg-muted/30 p-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Fase (nº)"><Input type="number" min={1} max={20} value={editing.phase ?? 1} onChange={(e) => setEditing({ ...editing, phase: Number(e.target.value) })} /></Field>
              <TextField className="sm:col-span-2" label="Nome da fase" value={editing.phaseName ?? ""} onChange={(v) => setEditing({ ...editing, phaseName: v })} />
            </div>
            <TextField label="Título" value={editing.title ?? ""} onChange={(v) => setEditing({ ...editing, title: v })} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Área"><NativeSelect placeholder="Geral" value={editing.area ?? ""} onChange={(e) => setEditing({ ...editing, area: e.target.value || null })} options={opt(AREA)} /></Field>
              <Field label="Prioridade"><NativeSelect value={editing.priority ?? "MEDIUM"} onChange={(e) => setEditing({ ...editing, priority: e.target.value as never })} options={opt(PRIORITY)} /></Field>
              <Field label="Dias relativos ao casamento" hint="Negativo = antes"><Input type="number" value={editing.offsetDays ?? ""} onChange={(e) => setEditing({ ...editing, offsetDays: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
            </div>
            <div className="flex gap-2">
              <LoadingButton
                size="sm"
                loading={saveItem.isPending}
                onClick={() => saveItem.mutate({ id: editing.id, templateId: tpl.id, phase: editing.phase ?? 1, phaseName: editing.phaseName || `Fase ${editing.phase ?? 1}`, title: editing.title ?? "", area: editing.area ?? null, priority: (editing.priority ?? "MEDIUM") as never, offsetDays: editing.offsetDays ?? null })}
              >
                Salvar item
              </LoadingButton>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
            </div>
          </div>
        )}
        <ConfirmDialog open={delTpl} onOpenChange={setDelTpl} title="Excluir modelo?" description="As tarefas já geradas não são afetadas." destructive confirmLabel="Excluir" loading={deleteTpl.isPending} onConfirm={() => tpl && deleteTpl.mutate({ id: tpl.id })} />
      </DialogContent>
    </Dialog>
  );
}
