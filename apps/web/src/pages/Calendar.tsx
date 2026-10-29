import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, MapPin, Plus, Trash2, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog, ErrorState, Field, LoadingButton, PageHeader, PageLoader, StatusBadge, TextField } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useMe } from "@/hooks/use-me";
import { fromDateTimeInput, money, time, toDateTimeInput } from "@/lib/format";
import { EVENT_TYPE } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { trpc, type RouterOutputs } from "@/trpc";
import { MultiPick, NativeSelect } from "./Checklist";

type Item = RouterOutputs["calendar"]["feed"][number];
type View = "month" | "week" | "day" | "list";

const SOURCE: Record<string, { label: string; cls: string; dot: string }> = {
  event: { label: "Compromisso", cls: "bg-primary/12 text-primary border-primary/30", dot: "bg-primary" },
  task: { label: "Tarefa", cls: "bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/30", dot: "bg-sky-500" },
  installment: { label: "Vencimento", cls: "bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30", dot: "bg-amber-500" },
  delivery: { label: "Entrega", cls: "bg-violet-500/12 text-violet-700 dark:text-violet-300 border-violet-500/30", dot: "bg-violet-500" },
  clause: { label: "Obrigação contratual", cls: "bg-rose-500/12 text-rose-700 dark:text-rose-300 border-rose-500/30", dot: "bg-rose-500" },
  contract: { label: "Prazo de contrato", cls: "bg-rose-500/12 text-rose-700 dark:text-rose-300 border-rose-500/30", dot: "bg-rose-400" },
  rsvp: { label: "Prazo de confirmação", cls: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/30", dot: "bg-emerald-500" },
  wedding: { label: "Casamento", cls: "bg-gold/25 text-gold-foreground border-gold/50", dot: "bg-gold" },
};
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

function range(view: View, cursor: Date) {
  if (view === "day") return { from: startOfDay(cursor), to: addDays(startOfDay(cursor), 1), days: [startOfDay(cursor)] };
  if (view === "week") {
    const s = addDays(startOfDay(cursor), -cursor.getDay());
    return { from: s, to: addDays(s, 7), days: Array.from({ length: 7 }, (_, i) => addDays(s, i)) };
  }
  if (view === "list") {
    const s = startOfDay(cursor);
    return { from: s, to: addDays(s, 60), days: [] };
  }
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const s = addDays(first, -first.getDay());
  return { from: s, to: addDays(s, 42), days: Array.from({ length: 42 }, (_, i) => addDays(s, i)) };
}

function title(view: View, cursor: Date, days: Date[]) {
  if (view === "month") return cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  if (view === "day") return cursor.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  if (view === "list") return `A partir de ${cursor.toLocaleDateString("pt-BR", { day: "numeric", month: "long" })}`;
  return `${days[0]!.toLocaleDateString("pt-BR", { day: "numeric", month: "short" })} – ${days[6]!.toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" })}`;
}

export function CalendarPage() {
  const { can } = useMe();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>(() => (window.matchMedia("(max-width: 767px)").matches ? "list" : "month"));
  const [cursor, setCursor] = useState(() => new Date());
  const [newAt, setNewAt] = useState<Date | null>(null);
  const r = useMemo(() => range(view, cursor), [view, cursor]);
  const feed = trpc.calendar.feed.useQuery({ from: r.from, to: r.to });
  const eventId = params.get("evento");

  const byDay = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of feed.data ?? []) {
      const k = dayKey(new Date(it.start));
      m.set(k, [...(m.get(k) ?? []), it]);
    }
    return m;
  }, [feed.data]);

  const openItem = (it: Item) => {
    if (it.source === "event") setParams((p) => { const n = new URLSearchParams(p); n.set("evento", it.id); return n; });
    else navigate(it.link);
  };
  const move = (dir: number) => {
    const d = new Date(cursor);
    if (view === "month") d.setMonth(d.getMonth() + dir);
    else if (view === "week") d.setDate(d.getDate() + 7 * dir);
    else if (view === "list") d.setDate(d.getDate() + 60 * dir);
    else d.setDate(d.getDate() + dir);
    setCursor(d);
  };

  const Chip = ({ it, compact }: { it: Item; compact?: boolean }) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); openItem(it); }}
      className={cn("block w-full truncate rounded-md border px-1.5 py-0.5 text-left text-[11px] leading-tight", SOURCE[it.source]?.cls, (it.status === "CANCELLED" || it.status === "DONE" || it.status === "PAID") && "line-through opacity-60")}
      title={it.title}
    >
      {!it.allDay && <span className="mr-1 tabular-nums">{time(it.start)}</span>}
      {compact ? it.title.replace(/^Vencimento: /, "💰 ") : it.title}
    </button>
  );

  return (
    <>
      <PageHeader
        title="Calendário"
        description="Compromissos, tarefas, vencimentos, entregas e prazos — cada um vem do seu próprio registro."
        actions={can("calendar:create") && <Button onClick={() => setNewAt(new Date())}><Plus /> Novo compromisso</Button>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label="Anterior" onClick={() => move(-1)}><ChevronLeft /></Button>
          <Button variant="outline" onClick={() => setCursor(new Date())}>Hoje</Button>
          <Button variant="outline" size="icon" aria-label="Próximo" onClick={() => move(1)}><ChevronRight /></Button>
        </div>
        <h2 className="flex-1 text-2xl font-semibold capitalize">{title(view, cursor, r.days)}</h2>
        <div className="flex rounded-lg border p-0.5">
          {(["month", "week", "day", "list"] as View[]).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} className={cn("rounded-md px-3 py-1 text-sm", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              {{ month: "Mês", week: "Semana", day: "Dia", list: "Agenda" }[v]}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
        {Object.entries(SOURCE).map(([k, s]) => <span key={k} className="flex items-center gap-1.5"><span className={cn("size-2 rounded-full", s.dot)} />{s.label}</span>)}
      </div>

      {feed.isLoading ? <PageLoader /> : feed.error ? <ErrorState error={feed.error} onRetry={() => feed.refetch()} /> : view === "month" ? (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-soft">
          <div className="grid min-w-[700px] grid-cols-7 border-b text-center text-xs font-medium text-muted-foreground">{WEEKDAYS.map((d) => <div key={d} className="py-2">{d}</div>)}</div>
          <div className="grid min-w-[700px] grid-cols-7">
            {r.days.map((d) => {
              const items = byDay.get(dayKey(d)) ?? [];
              const out = d.getMonth() !== cursor.getMonth();
              return (
                <div
                  key={d.toISOString()}
                  onClick={() => can("calendar:create") && setNewAt(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10))}
                  className={cn("min-h-28 cursor-pointer space-y-1 border-r border-b p-1.5 last:border-r-0 hover:bg-muted/30 [&:nth-child(7n)]:border-r-0", out && "bg-muted/20 text-muted-foreground")}
                >
                  <div className={cn("mb-1 grid size-6 place-items-center rounded-full text-xs", sameDay(d, new Date()) && "bg-primary font-semibold text-primary-foreground")}>{d.getDate()}</div>
                  {items.slice(0, 4).map((it) => <Chip key={it.key} it={it} compact />)}
                  {items.length > 4 && <button type="button" className="text-[11px] text-primary" onClick={(e) => { e.stopPropagation(); setCursor(d); setView("day"); }}>+{items.length - 4} mais</button>}
                </div>
              );
            })}
          </div>
        </div>
      ) : view === "week" ? (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-soft">
          <div className="grid min-w-[760px] grid-cols-7">
            {r.days.map((d) => (
              <div key={d.toISOString()} className="min-h-80 border-r p-2 last:border-r-0">
                <button type="button" onClick={() => { setCursor(d); setView("day"); }} className={cn("mb-2 w-full rounded-lg py-1 text-center text-xs", sameDay(d, new Date()) ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
                  {WEEKDAYS[d.getDay()]} {d.getDate()}
                </button>
                <div className="space-y-1">{(byDay.get(dayKey(d)) ?? []).map((it) => <Chip key={it.key} it={it} />)}</div>
              </div>
            ))}
          </div>
        </div>
      ) : view === "day" ? (
        <DayView items={byDay.get(dayKey(cursor)) ?? []} onOpen={openItem} onNew={(h) => can("calendar:create") && setNewAt(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), h))} />
      ) : (
        <AgendaList items={feed.data ?? []} onOpen={openItem} />
      )}

      {(eventId || newAt) && (
        <EventDialog
          id={eventId}
          initialStart={newAt}
          onClose={() => {
            setNewAt(null);
            if (eventId) setParams((p) => { const n = new URLSearchParams(p); n.delete("evento"); return n; }, { replace: true });
          }}
        />
      )}
    </>
  );
}

function DayView({ items, onOpen, onNew }: { items: Item[]; onOpen: (i: Item) => void; onNew: (hour: number) => void }) {
  const allDay = items.filter((i) => i.allDay);
  const timed = items.filter((i) => !i.allDay);
  return (
    <div className="rounded-xl border bg-card shadow-soft">
      {allDay.length > 0 && (
        <div className="space-y-1 border-b p-3">
          <div className="text-xs text-muted-foreground">Dia inteiro</div>
          {allDay.map((it) => <button key={it.key} type="button" onClick={() => onOpen(it)} className={cn("block w-full truncate rounded-md border px-2 py-1 text-left text-sm", SOURCE[it.source]?.cls)}>{it.title}</button>)}
        </div>
      )}
      <div>
        {Array.from({ length: 17 }, (_, i) => i + 6).map((h) => {
          const here = timed.filter((t) => new Date(t.start).getHours() === h);
          return (
            <div key={h} className="flex min-h-12 border-b last:border-b-0" onClick={() => onNew(h)}>
              <div className="w-14 shrink-0 border-r py-1 pr-2 text-right text-xs text-muted-foreground tabular-nums">{String(h).padStart(2, "0")}:00</div>
              <div className="flex-1 space-y-1 p-1">
                {here.map((it) => (
                  <button key={it.key} type="button" onClick={(e) => { e.stopPropagation(); onOpen(it); }} className={cn("block w-full truncate rounded-md border px-2 py-1 text-left text-sm", SOURCE[it.source]?.cls)}>
                    {time(it.start)}{it.end ? `–${time(it.end)}` : ""} · {it.title}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AgendaList({ items, onOpen }: { items: Item[]; onOpen: (i: Item) => void }) {
  const groups = new Map<string, { d: Date; items: Item[] }>();
  for (const it of items) {
    const d = startOfDay(new Date(it.start));
    const k = dayKey(d);
    if (!groups.has(k)) groups.set(k, { d, items: [] });
    groups.get(k)!.items.push(it);
  }
  if (!groups.size) return <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground"><CalendarDays className="mx-auto mb-2 size-6" />Nada agendado nos próximos 60 dias.</div>;
  return (
    <div className="space-y-4">
      {[...groups.values()].map((g) => (
        <div key={g.d.toISOString()}>
          <div className={cn("mb-1.5 text-sm font-semibold capitalize", sameDay(g.d, new Date()) && "text-primary")}>{g.d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}</div>
          <ul className="divide-y rounded-xl border bg-card">
            {g.items.map((it) => (
              <li key={it.key}>
                <button type="button" onClick={() => onOpen(it)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted/40">
                  <span className={cn("size-2.5 shrink-0 rounded-full", SOURCE[it.source]?.dot)} />
                  <span className="w-12 shrink-0 text-xs text-muted-foreground tabular-nums">{it.allDay ? "—" : time(it.start)}</span>
                  <span className={cn("min-w-0 flex-1 truncate", it.status === "CANCELLED" && "line-through opacity-60")}>{it.title}</span>
                  {typeof it.meta?.remaining === "number" && <span className="text-xs tabular-nums">{money(it.meta.remaining as number)}</span>}
                  <span className="hidden text-xs text-muted-foreground sm:inline">{SOURCE[it.source]?.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

const EVENT_TYPES = Object.entries(EVENT_TYPE).filter(([k]) => !["TASK", "PAYMENT", "CONTRACT"].includes(k)).map(([value, label]) => ({ value, label }));
const REMINDERS = [{ value: "", label: "Sem lembrete" }, { value: "30", label: "30 minutos antes" }, { value: "60", label: "1 hora antes" }, { value: "180", label: "3 horas antes" }, { value: "1440", label: "1 dia antes" }, { value: "2880", label: "2 dias antes" }, { value: "10080", label: "1 semana antes" }];

function EventDialog({ id, initialStart, onClose }: { id: string | null; initialStart: Date | null; onClose: () => void }) {
  const { can } = useMe();
  const utils = trpc.useUtils();
  const ev = trpc.calendar.event.useQuery({ id: id! }, { enabled: !!id });
  const assignable = trpc.planning.assignable.useQuery(undefined, { enabled: can("planning:view") });
  const tasks = trpc.planning.tasks.useQuery(undefined, { enabled: can("planning:view") });
  const vendors = trpc.vendors.list.useQuery(undefined, { enabled: can("vendors:view") });
  const obligations = trpc.finance.obligations.useQuery(undefined, { enabled: can("finance:view") });
  const start0 = initialStart ?? new Date();
  const [f, setF] = useState({ title: "", type: "MEETING", startsAt: toDateTimeInput(start0), endsAt: toDateTimeInput(new Date(start0.getTime() + 3600_000)), allDay: false, location: "", description: "", assigneeIds: [] as string[], remind: "", taskId: "", vendorId: "", obligationId: "" });
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"delete" | "cancel" | null>(null);

  useEffect(() => {
    const e = ev.data;
    if (!e) return;
    setF({ title: e.title, type: e.type, startsAt: toDateTimeInput(e.startsAt), endsAt: toDateTimeInput(e.endsAt), allDay: e.allDay, location: e.location ?? "", description: e.description ?? "", assigneeIds: e.assigneeIds, remind: e.remindMinutesBefore != null ? String(e.remindMinutesBefore) : "", taskId: e.taskId ?? "", vendorId: e.vendorId ?? "", obligationId: e.obligationId ?? "" });
  }, [ev.data]);

  const inv = () => { utils.calendar.invalidate(); utils.dashboard.invalidate(); };
  const save = trpc.calendar.saveEvent.useMutation({ onSuccess: () => { toast.success("Compromisso salvo"); inv(); onClose(); }, onError: (e) => toast.error(e.message) });
  const setStatus = trpc.calendar.setEventStatus.useMutation({ onSuccess: () => { toast.success("Compromisso atualizado"); inv(); setConfirm(null); onClose(); }, onError: (e) => toast.error(e.message) });
  const del = trpc.calendar.deleteEvent.useMutation({ onSuccess: () => { toast.success("Compromisso excluído"); inv(); onClose(); }, onError: (e) => toast.error(e.message) });
  const editable = id ? can("calendar:edit") : can("calendar:create");

  function submit() {
    const startsAt = fromDateTimeInput(f.startsAt);
    if (f.title.trim().length < 2) return setErr("Informe um título");
    if (!startsAt) return setErr("Informe o início");
    const endsAt = f.endsAt ? fromDateTimeInput(f.endsAt) : null;
    if (endsAt && endsAt < startsAt) return setErr("O término deve ser depois do início");
    setErr(null);
    save.mutate({
      id: id ?? undefined, title: f.title.trim(), type: f.type as never, startsAt, endsAt, allDay: f.allDay, location: f.location || null, description: f.description || null, assigneeIds: f.assigneeIds,
      remindMinutesBefore: f.remind ? Number(f.remind) : null, taskId: f.taskId || null, vendorId: f.vendorId || null, obligationId: f.obligationId || null,
    });
  }

  const e = ev.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {id ? "Compromisso" : "Novo compromisso"}
            {e && e.status !== "SCHEDULED" && <StatusBadge tone={e.status === "DONE" ? "emerald" : "rose"}>{e.status === "DONE" ? "Realizado" : "Cancelado"}</StatusBadge>}
          </DialogTitle>
        </DialogHeader>
        {id && ev.isLoading ? <PageLoader /> : id && ev.error ? <ErrorState error={ev.error} /> : (
          <fieldset disabled={!editable} className="space-y-3">
            <TextField label="Título" value={f.title} onChange={(v) => setF({ ...f, title: v })} error={err} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tipo"><NativeSelect value={f.type} onChange={(x) => setF({ ...f, type: x.target.value })} options={EVENT_TYPES} /></Field>
              <Field label="Lembrete (e-mail)"><NativeSelect value={f.remind} onChange={(x) => setF({ ...f, remind: x.target.value })} options={REMINDERS} /></Field>
              <Field label="Início"><Input type="datetime-local" value={f.startsAt} onChange={(x) => setF({ ...f, startsAt: x.target.value })} /></Field>
              <Field label="Término"><Input type="datetime-local" value={f.endsAt} onChange={(x) => setF({ ...f, endsAt: x.target.value })} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.allDay} onCheckedChange={(v) => setF({ ...f, allDay: !!v })} /> Dia inteiro</label>
            <TextField label="Local" value={f.location} onChange={(v) => setF({ ...f, location: v })} />
            <TextField label="Descrição" multiline value={f.description} onChange={(v) => setF({ ...f, description: v })} />
            {can("planning:view") && <Field label="Responsáveis"><MultiPick options={(assignable.data ?? []).map((u) => ({ value: u.id, label: u.name, hint: u.role }))} value={f.assigneeIds} onChange={(v) => setF({ ...f, assigneeIds: v })} /></Field>}
            <div className="grid gap-3 sm:grid-cols-3">
              {can("planning:view") && <Field label="Tarefa"><NativeSelect placeholder="Nenhuma" value={f.taskId} onChange={(x) => setF({ ...f, taskId: x.target.value })} options={(tasks.data ?? []).map((t) => ({ value: t.id, label: t.title }))} /></Field>}
              {can("vendors:view") && <Field label="Fornecedor"><NativeSelect placeholder="Nenhum" value={f.vendorId} onChange={(x) => setF({ ...f, vendorId: x.target.value })} options={(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name }))} /></Field>}
              {can("finance:view") && <Field label="Despesa"><NativeSelect placeholder="Nenhuma" value={f.obligationId} onChange={(x) => setF({ ...f, obligationId: x.target.value })} options={(obligations.data ?? []).map((o) => ({ value: o.id, label: o.title }))} /></Field>}
            </div>
            {e?.location && <a className="inline-flex items-center gap-1 text-xs text-primary hover:underline" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.location)}`}><MapPin className="size-3" /> Abrir no mapa</a>}
          </fieldset>
        )}
        <DialogFooter className="flex-wrap gap-2">
          {id && can("calendar:delete") && <Button variant="destructive" onClick={() => setConfirm("delete")}><Trash2 /> Excluir</Button>}
          {id && e?.status === "SCHEDULED" && can("calendar:edit") && (
            <>
              <Button variant="outline" onClick={() => setConfirm("cancel")}><XCircle /> Cancelar compromisso</Button>
              <Button variant="outline" onClick={() => setStatus.mutate({ id, status: "DONE" })}><CheckCircle2 /> Realizado</Button>
            </>
          )}
          {id && e && e.status !== "SCHEDULED" && can("calendar:edit") && <Button variant="outline" onClick={() => setStatus.mutate({ id, status: "SCHEDULED" })}>Reativar</Button>}
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
          {editable && <LoadingButton loading={save.isPending} onClick={submit}>Salvar</LoadingButton>}
        </DialogFooter>
        <ConfirmDialog
          open={!!confirm}
          onOpenChange={(o) => !o && setConfirm(null)}
          title={confirm === "delete" ? "Excluir compromisso?" : "Cancelar compromisso?"}
          description={confirm === "delete" ? "A exclusão é definitiva e remove os lembretes." : "O compromisso continua no histórico como cancelado e os lembretes são removidos."}
          destructive
          confirmLabel={confirm === "delete" ? "Excluir" : "Cancelar compromisso"}
          loading={del.isPending || setStatus.isPending}
          onConfirm={() => id && (confirm === "delete" ? del.mutate({ id }) : setStatus.mutate({ id, status: "CANCELLED" }))}
        />
      </DialogContent>
    </Dialog>
  );
}
