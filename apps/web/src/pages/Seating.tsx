import {
  Accessibility, ArrowDown, ArrowUp, Baby, FileDown, GripVertical, LayoutGrid, Maximize, Minus, Plus, Search, Sparkles, Trash2, UserMinus, Users, UtensilsCrossed, Wand2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { ConfirmDialog, EmptyState, ErrorState, Field, LoadingButton, PageHeader, PageLoader, StatusBadge, TextField } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useMe } from "@/hooks/use-me";
import { downloadReportPdf } from "@/lib/report-pdf";
import { cn } from "@/lib/utils";
import { Avatar, NativeSelect } from "@/pages/finance/shared";
import { trpc, type RouterOutputs } from "@/trpc";

type Layout = RouterOutputs["seating"]["layout"];
type Table = Layout["tables"][number];
type Person = Layout["unseated"][number];
type Shape = "ROUND" | "RECT" | "LONG";

const SHAPES: { value: Shape; label: string }[] = [
  { value: "ROUND", label: "Redonda" },
  { value: "RECT", label: "Retangular" },
  { value: "LONG", label: "Comprida (imperial)" },
];
const SIDE_LABEL: Record<string, string> = { P1: "Lado 1", P2: "Lado 2", BOTH: "Ambos" };

/** Tamanho visual (unidades do salão) de cada formato */
function tableSize(t: { shape: Shape; capacity: number }) {
  if (t.shape === "ROUND") {
    const d = Math.min(200, 80 + t.capacity * 5);
    return { w: d, h: d };
  }
  if (t.shape === "RECT") return { w: Math.min(260, 100 + t.capacity * 6), h: 90 };
  return { w: Math.min(420, 120 + t.capacity * 14), h: 64 };
}

const capTone = (t: Table): "rose" | "amber" | "emerald" => (t.over ? "rose" : t.full ? "amber" : "emerald");

/** Assentos ao redor da mesa: preenchidos = ocupados */
function SeatDots({ t, w, h }: { t: Table; w: number; h: number }) {
  const n = Math.min(t.capacity, 40);
  const pts: { x: number; y: number }[] = [];
  if (t.shape === "ROUND") {
    const r = w / 2 + 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      pts.push({ x: w / 2 + Math.cos(a) * r, y: h / 2 + Math.sin(a) * r });
    }
  } else {
    const top = Math.ceil(n / 2);
    const bottom = n - top;
    for (let i = 0; i < top; i++) pts.push({ x: ((i + 0.5) / top) * w, y: -10 });
    for (let i = 0; i < bottom; i++) pts.push({ x: ((i + 0.5) / bottom) * w, y: h + 10 });
  }
  return (
    <>
      {pts.map((p, i) => (
        <span
          key={i}
          className={cn("absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-colors", i < t.used ? (t.over ? "border-rose-500 bg-rose-500" : "border-primary bg-primary") : "border-border bg-card")}
          style={{ left: p.x, top: p.y }}
        />
      ))}
    </>
  );
}

// ───────────── Arrastar convidados ─────────────

type DragPayload = { guestIds: string[]; wholeFamily: boolean; label: string };
const DND_TYPE = "application/x-casamento-guests";
function startDrag(e: DragEvent, p: DragPayload) {
  e.dataTransfer.setData(DND_TYPE, JSON.stringify(p));
  e.dataTransfer.effectAllowed = "move";
}
function readDrag(e: DragEvent): DragPayload | null {
  try {
    const raw = e.dataTransfer.getData(DND_TYPE);
    return raw ? (JSON.parse(raw) as DragPayload) : null;
  } catch {
    return null;
  }
}

function PersonBadges({ p }: { p: Pick<Person, "isChild" | "dietary" | "accessibility" | "companions"> }) {
  const diet = p.dietary || p.companions.some((c) => c.dietary);
  return (
    <span className="flex items-center gap-1 text-muted-foreground [&_svg]:size-3.5">
      {(p.isChild || p.companions.some((c) => c.isChild)) && <Baby aria-label="Criança" />}
      {diet && <UtensilsCrossed aria-label="Restrição alimentar" className="text-amber-600" />}
      {p.accessibility && <Accessibility aria-label="Acessibilidade" className="text-sky-600" />}
    </span>
  );
}

// ───────────── Painel de convidados sem mesa ─────────────

function UnseatedPanel({ people, tables, editable, onSeat, filter, setFilter }: {
  people: Person[]; tables: Table[]; editable: boolean; onSeat: (p: DragPayload, tableId: string) => void;
  filter: { q: string; scope: "confirmed" | "all"; side: string }; setFilter: (f: { q: string; scope: "confirmed" | "all"; side: string }) => void;
}) {
  const [pick, setPick] = useState<DragPayload | null>(null);
  const families = useMemo(() => {
    const q = filter.q.trim().toLowerCase();
    const list = people.filter((p) => (filter.scope === "all" || p.rsvpStatus === "ACCEPTED") && (!filter.side || p.side === filter.side) && (!q || p.fullName.toLowerCase().includes(q) || p.groupName.toLowerCase().includes(q)));
    const map = new Map<string, { groupId: string; name: string; members: Person[]; people: number }>();
    for (const p of list) {
      const f = map.get(p.groupId) ?? { groupId: p.groupId, name: p.groupName, members: [], people: 0 };
      f.members.push(p);
      f.people += p.people;
      map.set(p.groupId, f);
    }
    return [...map.values()];
  }, [people, filter]);
  const total = families.reduce((s, f) => s + f.people, 0);

  return (
    <aside className="flex min-h-0 flex-col rounded-xl border bg-card shadow-soft">
      <div className="space-y-2 border-b p-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Sem mesa</div>
          <StatusBadge tone={total ? "amber" : "emerald"}>{total} pessoa(s)</StatusBadge>
        </div>
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-8 pl-8" placeholder="Buscar convidado ou família" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
        </div>
        <div className="flex gap-2">
          <div className="inline-flex flex-1 rounded-lg bg-muted p-0.5 text-xs">
            {(["confirmed", "all"] as const).map((s) => (
              <button key={s} type="button" onClick={() => setFilter({ ...filter, scope: s })} className={cn("flex-1 rounded-md px-2 py-1 font-medium transition", filter.scope === s ? "bg-card shadow-soft" : "text-muted-foreground hover:text-foreground")}>
                {s === "confirmed" ? "Confirmados" : "Todos"}
              </button>
            ))}
          </div>
          <NativeSelect className="h-7 w-28 text-xs" value={filter.side} onChange={(v) => setFilter({ ...filter, side: v })} options={[{ value: "", label: "Todos os lados" }, ...Object.entries(SIDE_LABEL).map(([value, label]) => ({ value, label }))]} />
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2 scrollbar-hover">
        {!families.length && <p className="px-2 py-8 text-center text-sm text-muted-foreground">{people.length ? "Ninguém com esses filtros." : "Todos os convidados já têm mesa 🎉"}</p>}
        {families.map((f) => {
          const famPayload: DragPayload = { guestIds: f.members.map((m) => m.id), wholeFamily: true, label: f.name };
          return (
            <div key={f.groupId} className="group/fam rounded-lg border bg-background/60 transition hover:border-primary/40 hover:shadow-soft">
              <div
                draggable={editable}
                onDragStart={(e) => startDrag(e, famPayload)}
                className={cn("flex items-center gap-2 px-2.5 py-2", editable && "cursor-grab active:cursor-grabbing")}
              >
                {editable && <GripVertical className="size-3.5 shrink-0 text-muted-foreground/60" />}
                <Avatar name={f.name} className="size-7 text-[10px]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{f.name}</div>
                  <div className="text-xs text-muted-foreground">{f.people} pessoa(s)</div>
                </div>
                {editable && tables.length > 0 && (
                  <Button size="xs" variant="ghost" className="opacity-100 md:opacity-0 md:group-hover/fam:opacity-100" onClick={() => setPick(famPayload)}>Sentar em…</Button>
                )}
              </div>
              <ul className="border-t px-2 py-1">
                {f.members.map((m) => (
                  <li
                    key={m.id}
                    draggable={editable}
                    onDragStart={(e) => {
                      e.stopPropagation();
                      startDrag(e, { guestIds: [m.id], wholeFamily: false, label: m.fullName });
                    }}
                    className={cn("flex items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-muted/60", editable && "cursor-grab")}
                  >
                    <span className="min-w-0 flex-1 truncate">{m.fullName}{m.companions.length > 0 && <span className="text-muted-foreground"> +{m.companions.length}</span>}</span>
                    {m.rsvpStatus === "PENDING" && <StatusBadge tone="amber" className="px-1.5 py-0 text-[10px]">sem resposta</StatusBadge>}
                    <PersonBadges p={m} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {editable && <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">Arraste uma família (ou uma pessoa) até a mesa.</p>}
      <SeatPicker payload={pick} tables={tables} onClose={() => setPick(null)} onPick={(tid) => { if (pick) onSeat(pick, tid); setPick(null); }} />
    </aside>
  );
}

function SeatPicker({ payload, tables, onClose, onPick }: { payload: DragPayload | null; tables: Table[]; onClose: () => void; onPick: (tableId: string) => void }) {
  return (
    <Dialog open={!!payload} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sentar {payload?.label}</DialogTitle>
          <DialogDescription>Escolha a mesa.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[50dvh] gap-1.5 overflow-y-auto">
          {tables.map((t) => (
            <button key={t.id} type="button" onClick={() => onPick(t.id)} className="flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition hover:border-primary/50 hover:bg-accent/40">
              <span className="font-medium">{t.name}{t.zone && <span className="text-muted-foreground"> · {t.zone}</span>}</span>
              <StatusBadge tone={capTone(t)}>{t.used}/{t.capacity}</StatusBadge>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Salão (canvas) ─────────────

const GRID = 10;
const snap = (v: number) => Math.round(v / GRID) * GRID;

function RoomCanvas({ tables, editable, onOpen, onDropGuests, onMoved }: {
  tables: Table[]; editable: boolean; onOpen: (t: Table) => void; onDropGuests: (p: DragPayload, tableId: string) => void; onMoved: (id: string, x: number, y: number) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(1000);
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({});
  const [over, setOver] = useState<string | null>(null);
  const drag = useRef<{ id: string; startX: number; startY: number; ox: number; oy: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Quando o servidor confirma, limpa a posição local
  useEffect(() => setPos({}), [tables]);

  const scale = (width / 1050) * zoom;
  const roomH = Math.max(700, ...tables.map((t) => (pos[t.id]?.y ?? t.y) + tableSize(t).h + 80));

  function down(e: RPointerEvent, t: Table) {
    if (!editable || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: t.id, startX: e.clientX, startY: e.clientY, ox: pos[t.id]?.x ?? t.x, oy: pos[t.id]?.y ?? t.y, moved: false };
  }
  function move(e: RPointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / scale;
    const dy = (e.clientY - d.startY) / scale;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.moved) setPos((p) => ({ ...p, [d.id]: { x: Math.max(0, Math.min(1000, snap(d.ox + dx))), y: Math.max(0, Math.min(1000, snap(d.oy + dy))) } }));
  }
  function up(t: Table) {
    const d = drag.current;
    drag.current = null;
    if (!d) return onOpen(t);
    if (!d.moved) return onOpen(t);
    const p = pos[t.id];
    if (p) onMoved(t.id, p.x, p.y);
  }

  return (
    <div className="relative min-h-0 overflow-hidden rounded-xl border bg-card shadow-soft">
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-lg border bg-background/90 p-1 shadow-soft backdrop-blur">
        <Button size="icon-sm" variant="ghost" aria-label="Diminuir zoom" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))}><Minus /></Button>
        <span className="w-10 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
        <Button size="icon-sm" variant="ghost" aria-label="Aumentar zoom" onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)))}><Plus /></Button>
        <Button size="icon-sm" variant="ghost" aria-label="Ajustar à tela" onClick={() => setZoom(1)}><Maximize /></Button>
      </div>
      <div ref={wrap} className="h-[calc(100dvh-280px)] min-h-[480px] overflow-auto scrollbar-hover">
        <div className="bg-dots relative" style={{ width: 1050 * scale, height: roomH * scale, backgroundSize: `${20 * scale}px ${20 * scale}px` }}>
          <div className="absolute top-2 left-1/2 -translate-x-1/2 rounded-full border bg-background/80 px-3 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Salão</div>
          {tables.map((t) => {
            const { w, h } = tableSize(t);
            const p = pos[t.id] ?? { x: t.x, y: t.y };
            const diet = t.guests.some((g) => g.dietary || g.companions.some((c) => c.dietary));
            const access = t.guests.some((g) => g.accessibility);
            return (
              <div
                key={t.id}
                className="absolute"
                style={{ left: p.x * scale, top: p.y * scale, width: w * scale, height: h * scale, transform: `rotate(${t.rotation}deg)`, transformOrigin: "center" }}
              >
                <div style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: "top left" }} className="relative">
                  <SeatDots t={t} w={w} h={h} />
                  <button
                    type="button"
                    onPointerDown={(e) => down(e, t)}
                    onPointerMove={move}
                    onPointerUp={() => up(t)}
                    onDragOver={(e) => {
                      if (!editable || !e.dataTransfer.types.includes(DND_TYPE)) return;
                      e.preventDefault();
                      setOver(t.id);
                    }}
                    onDragLeave={() => setOver((o) => (o === t.id ? null : o))}
                    onDrop={(e) => {
                      e.preventDefault();
                      setOver(null);
                      const payload = readDrag(e);
                      if (payload) onDropGuests(payload, t.id);
                    }}
                    className={cn(
                      "group/table absolute inset-0 flex touch-none flex-col items-center justify-center border-2 bg-card text-center shadow-soft transition-[box-shadow,border-color,background-color] select-none hover:shadow-brand",
                      t.shape === "ROUND" ? "rounded-full" : "rounded-xl",
                      over === t.id ? "border-primary bg-accent ring-4 ring-primary/20" : t.over ? "border-rose-400" : t.full ? "border-amber-400" : "border-border hover:border-primary/50",
                      editable && "cursor-grab active:cursor-grabbing",
                    )}
                    style={{ transform: `rotate(${-t.rotation}deg)` }}
                  >
                    <span className="max-w-[90%] truncate px-1 text-[13px] leading-tight font-semibold">{t.name}</span>
                    <StatusBadge tone={capTone(t)} className="mt-1 px-1.5 py-0 text-[11px] tabular-nums">{t.used}/{t.capacity}</StatusBadge>
                    {(diet || access) && (
                      <span className="mt-1 flex gap-1 text-muted-foreground [&_svg]:size-3.5">
                        {diet && <UtensilsCrossed className="text-amber-600" />}
                        {access && <Accessibility className="text-sky-600" />}
                      </span>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ───────────── Lista de mesas (mobile) ─────────────

function TablesList({ tables, onOpen, onDropGuests, editable }: { tables: Table[]; onOpen: (t: Table) => void; onDropGuests: (p: DragPayload, tableId: string) => void; editable: boolean }) {
  return (
    <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {tables.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onOpen(t)}
          onDragOver={(e) => editable && e.dataTransfer.types.includes(DND_TYPE) && e.preventDefault()}
          onDrop={(e) => {
            const p = readDrag(e);
            if (p) onDropGuests(p, t.id);
          }}
          className="lift rounded-xl border bg-card p-4 text-left shadow-soft"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold">{t.name}</div>
            <StatusBadge tone={capTone(t)}>{t.used}/{t.capacity}</StatusBadge>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full transition-all", t.over ? "bg-rose-500" : t.full ? "bg-amber-500" : "bg-primary")} style={{ width: `${Math.min(100, (t.used / Math.max(1, t.capacity)) * 100)}%` }} />
          </div>
          <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">{t.guests.length ? t.guests.map((g) => g.fullName + (g.companions.length ? ` +${g.companions.length}` : "")).join(", ") : "Mesa vazia"}</div>
        </button>
      ))}
    </div>
  );
}

// ───────────── Detalhe da mesa ─────────────

function TableSheet({ table, tables, editable, onClose }: { table: Table | null; tables: Table[]; editable: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({ name: "", shape: "ROUND" as Shape, capacity: "8", zone: "", notes: "", rotation: "0" });
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (table) setForm({ name: table.name, shape: table.shape as Shape, capacity: String(table.capacity), zone: table.zone ?? "", notes: table.notes ?? "", rotation: String(table.rotation) });
  }, [table]);
  const refresh = () => utils.seating.invalidate();
  const save = trpc.seating.saveTable.useMutation({ onSuccess: () => { toast.success("Mesa salva"); refresh(); }, onError: (e) => toast.error(e.message) });
  const del = trpc.seating.deleteTable.useMutation({ onSuccess: () => { toast.success("Mesa excluída"); setConfirmDelete(false); onClose(); refresh(); }, onError: (e) => toast.error(e.message) });
  const assign = trpc.seating.assign.useMutation({ onSuccess: refresh, onError: (e) => toast.error(e.message) });
  const reorder = trpc.seating.reorder.useMutation({ onSuccess: refresh, onError: (e) => toast.error(e.message) });
  const live = tables.find((t) => t.id === table?.id) ?? table;

  const move = (i: number, d: -1 | 1) => {
    if (!live) return;
    const ids = live.guests.map((g) => g.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    reorder.mutate({ tableId: live.id, guestIds: ids });
  };

  return (
    <Sheet open={!!table} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="lg" className="overflow-y-auto">
        {live && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">{live.name} <StatusBadge tone={capTone(live)}>{live.used}/{live.capacity}</StatusBadge></SheetTitle>
              <SheetDescription>{live.free >= 0 ? `${live.free} lugar(es) livre(s)` : `${-live.free} pessoa(s) acima da capacidade`}{live.zone ? ` · ${live.zone}` : ""}</SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-5 py-5">
              <section>
                <h3 className="mb-2 font-sans text-sm font-semibold">Quem senta aqui</h3>
                {live.guests.length ? (
                  <ul className="divide-y rounded-xl border">
                    {live.guests.map((g, i) => (
                      <li key={g.id} className="group/row flex items-start gap-2 px-3 py-2 text-sm">
                        <Avatar name={g.fullName} className="mt-0.5 size-7 text-[10px]" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 font-medium">{g.fullName} <PersonBadges p={g} /></div>
                          <div className="text-xs text-muted-foreground">
                            {g.groupName}{g.rsvpStatus === "PENDING" ? " · sem resposta" : ""}
                            {g.companions.length > 0 && <> · +{g.companions.map((c) => c.name ?? "acompanhante").join(", ")}</>}
                          </div>
                          {(g.dietary || g.accessibility) && <div className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">{[g.dietary, g.accessibility].filter(Boolean).join(" · ")}</div>}
                        </div>
                        {editable && (
                          <div className="flex shrink-0 items-center opacity-100 md:opacity-0 md:group-hover/row:opacity-100">
                            <Button size="icon-xs" variant="ghost" aria-label="Subir" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
                            <Button size="icon-xs" variant="ghost" aria-label="Descer" disabled={i === live.guests.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild><Button size="xs" variant="ghost">Mover</Button></DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
                                {tables.filter((t) => t.id !== live.id).map((t) => (
                                  <DropdownMenuItem key={t.id} onClick={() => assign.mutate({ guestIds: [g.id], tableId: t.id, force: true })}>{t.name} <span className="ml-auto text-xs text-muted-foreground">{t.used}/{t.capacity}</span></DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <Button size="icon-xs" variant="ghost" aria-label="Tirar da mesa" onClick={() => assign.mutate({ guestIds: [g.id], tableId: null })}><UserMinus /></Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">Mesa vazia. Arraste convidados até ela.</p>}
              </section>

              {editable && (
                <section className="space-y-3">
                  <h3 className="font-sans text-sm font-semibold">Editar mesa</h3>
                  <TextField label="Nome" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Formato"><NativeSelect value={form.shape} onChange={(v) => setForm({ ...form, shape: v as Shape })} options={SHAPES} /></Field>
                    <Field label="Lugares"><Input type="number" min={1} max={100} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></Field>
                    <TextField label="Área / zona" value={form.zone} onChange={(v) => setForm({ ...form, zone: v })} placeholder="Ex.: perto da pista" />
                    <Field label="Rotação"><NativeSelect value={form.rotation} onChange={(v) => setForm({ ...form, rotation: v })} options={["0", "45", "90", "135"].map((r) => ({ value: r, label: `${r}°` }))} /></Field>
                  </div>
                  <TextField label="Observações" multiline value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} />
                  <div className="flex justify-between gap-2">
                    <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}><Trash2 /> Excluir</Button>
                    <LoadingButton size="sm" loading={save.isPending} onClick={() => save.mutate({ id: live.id, name: form.name, shape: form.shape, capacity: Math.max(1, Number(form.capacity) || 1), zone: form.zone || null, notes: form.notes || null, rotation: Number(form.rotation) })}>Salvar mesa</LoadingButton>
                  </div>
                </section>
              )}
            </div>
            <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={`Excluir ${live.name}?`} description={live.guests.length ? `${live.used} pessoa(s) voltam para a lista "sem mesa".` : "A mesa está vazia."} destructive confirmLabel="Excluir mesa" loading={del.isPending} onConfirm={() => del.mutate({ id: live.id })} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ───────────── Diálogos ─────────────

function NewTableDialog({ open, onOpenChange, nextName }: { open: boolean; onOpenChange: (o: boolean) => void; nextName: string }) {
  const utils = trpc.useUtils();
  const [f, setF] = useState({ name: nextName, shape: "ROUND" as Shape, capacity: "8", zone: "" });
  useEffect(() => { if (open) setF({ name: nextName, shape: "ROUND", capacity: "8", zone: "" }); }, [open, nextName]);
  const save = trpc.seating.saveTable.useMutation({ onSuccess: () => { toast.success("Mesa criada"); utils.seating.invalidate(); onOpenChange(false); }, onError: (e) => toast.error(e.message) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Nova mesa</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <TextField label="Nome" value={f.name} onChange={(v) => setF({ ...f, name: v })} autoFocus />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Formato"><NativeSelect value={f.shape} onChange={(v) => setF({ ...f, shape: v as Shape })} options={SHAPES} /></Field>
            <Field label="Lugares"><Input type="number" min={1} max={100} value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} /></Field>
          </div>
          <TextField label="Área / zona (opcional)" value={f.zone} onChange={(v) => setF({ ...f, zone: v })} />
        </div>
        <DialogFooter>
          <LoadingButton loading={save.isPending} onClick={() => save.mutate({ name: f.name, shape: f.shape, capacity: Math.max(1, Number(f.capacity) || 1), zone: f.zone || null })}>Criar mesa</LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GenerateDialog({ open, onOpenChange, people }: { open: boolean; onOpenChange: (o: boolean) => void; people: number }) {
  const utils = trpc.useUtils();
  const [f, setF] = useState({ count: "", capacity: "8", shape: "ROUND" as Shape, prefix: "Mesa" });
  const cap = Math.max(1, Number(f.capacity) || 8);
  const suggested = Math.max(1, Math.ceil(people / cap));
  const gen = trpc.seating.generate.useMutation({ onSuccess: (r) => { toast.success(`${r.created} mesa(s) criada(s)`); utils.seating.invalidate(); onOpenChange(false); }, onError: (e) => toast.error(e.message) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Gerar mesas</DialogTitle>
          <DialogDescription>Cria várias mesas iguais, organizadas em grade no salão. Você pode mover e ajustar depois.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Lugares por mesa"><Input type="number" min={1} max={100} value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} /></Field>
          <Field label="Quantidade" hint={people ? `Sugestão: ${suggested} para ${people} pessoa(s) sem mesa` : undefined}><Input type="number" min={1} max={100} placeholder={String(suggested)} value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} /></Field>
          <Field label="Formato"><NativeSelect value={f.shape} onChange={(v) => setF({ ...f, shape: v as Shape })} options={SHAPES} /></Field>
          <TextField label="Nome" value={f.prefix} onChange={(v) => setF({ ...f, prefix: v })} />
        </div>
        <DialogFooter>
          <LoadingButton loading={gen.isPending} onClick={() => gen.mutate({ count: Math.min(100, Number(f.count) || suggested), capacity: cap, shape: f.shape, prefix: f.prefix })}>Gerar {Number(f.count) || suggested} mesa(s)</LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SuggestDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const utils = trpc.useUtils();
  const [onlyConfirmed, setOnlyConfirmed] = useState(true);
  const q = trpc.seating.suggest.useQuery({ onlyConfirmed }, { enabled: open });
  const apply = trpc.seating.applySuggestion.useMutation({ onSuccess: (r) => { toast.success(`${r.people} pessoa(s) distribuída(s)`); utils.seating.invalidate(); onOpenChange(false); }, onError: (e) => toast.error(e.message) });
  const byTable = useMemo(() => {
    const m = new Map<string, { name: string; items: { groupName: string; people: number }[] }>();
    for (const p of q.data?.proposal ?? []) {
      const t = m.get(p.tableId) ?? { name: p.tableName, items: [] };
      t.items.push({ groupName: p.groupName, people: p.people });
      m.set(p.tableId, t);
    }
    return [...m.values()];
  }, [q.data]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wand2 className="size-5 text-primary" /> Sugerir distribuição</DialogTitle>
          <DialogDescription>Famílias ficam sempre juntas, agrupadas por lado e categoria, sem passar da capacidade. Nada é gravado até você aplicar.</DialogDescription>
        </DialogHeader>
        <div className="inline-flex w-fit rounded-lg bg-muted p-0.5 text-xs">
          {[true, false].map((v) => (
            <button key={String(v)} type="button" onClick={() => setOnlyConfirmed(v)} className={cn("rounded-md px-3 py-1 font-medium transition", onlyConfirmed === v ? "bg-card shadow-soft" : "text-muted-foreground")}>{v ? "Só confirmados" : "Confirmados e sem resposta"}</button>
          ))}
        </div>
        {q.isLoading ? <PageLoader /> : q.error ? <ErrorState error={q.error} /> : (
          <div className="space-y-3">
            {byTable.length ? (
              <ul className="stagger grid gap-2 sm:grid-cols-2">
                {byTable.map((t) => (
                  <li key={t.name} className="rounded-xl border p-3">
                    <div className="mb-1 text-sm font-semibold">{t.name}</div>
                    {t.items.map((i) => <div key={i.groupName} className="flex justify-between text-xs"><span className="truncate">{i.groupName}</span><span className="text-muted-foreground tabular-nums">+{i.people}</span></div>)}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">Nada a distribuir: todos já têm mesa ou não há lugares livres.</p>}
            {!!q.data?.leftover.length && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                <b>Sem lugar suficiente para:</b> {q.data.leftover.map((l) => `${l.groupName} (${l.people})`).join(", ")}. Crie mais mesas ou aumente a capacidade.
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <LoadingButton loading={apply.isPending} disabled={!q.data?.proposal.length} onClick={() => apply.mutate({ proposal: q.data!.proposal.map((p) => ({ tableId: p.tableId, guestIds: p.guestIds })) })}>Aplicar sugestão</LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── PDFs ─────────────

async function exportPdf(kind: "table" | "alpha", data: Layout, wedding: { partner1Name: string; partner2Name: string; date: Date | string | null } | null) {
  const rows = data.tables.flatMap((t) =>
    t.guests.flatMap((g) => [
      { name: g.fullName, table: t.name, family: g.groupName, child: g.isChild, notes: [g.dietary, g.accessibility].filter(Boolean).join(" · ") },
      ...g.companions.map((c) => ({ name: c.name ?? `Acompanhante de ${g.fullName}`, table: t.name, family: g.groupName, child: c.isChild, notes: c.dietary ?? "" })),
    ]),
  );
  const w = wedding ? { names: `${wedding.partner1Name} & ${wedding.partner2Name}`, date: wedding.date } : undefined;
  const kpis = [
    { label: "Pessoas sentadas", value: String(data.stats.seatedPeople) },
    { label: "Mesas", value: String(data.stats.tables) },
    { label: "Crianças", value: String(rows.filter((r) => r.child).length) },
    { label: "Com restrição", value: String(rows.filter((r) => r.notes).length) },
  ];
  if (kind === "table") {
    await downloadReportPdf({
      title: "Mapa de mesas",
      subtitle: "Por mesa — para o buffet e a cerimonialista.",
      wedding: w, kpis,
      columns: [{ label: "Mesa", flex: 1 }, { label: "Pessoa", flex: 2 }, { label: "Família", flex: 1.4 }, { label: "Tipo", flex: 0.8 }, { label: "Restrições / acessibilidade", flex: 2 }],
      rows: rows.map((r) => [r.table, r.name, r.family, r.child ? "Criança" : "Adulto", r.notes || "—"]),
      note: data.stats.unseatedConfirmedPeople ? `${data.stats.unseatedConfirmedPeople} pessoa(s) confirmada(s) ainda sem mesa.` : undefined,
      fileName: `mapa-de-mesas-${new Date().toISOString().slice(0, 10)}`,
    });
  } else {
    const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    await downloadReportPdf({
      title: "Onde sentar — lista alfabética",
      subtitle: "Para a recepção: procure o nome e indique a mesa.",
      wedding: w, kpis: kpis.slice(0, 2),
      columns: [{ label: "Convidado", flex: 2.2 }, { label: "Mesa", flex: 1, align: "center" }, { label: "Família", flex: 1.6 }],
      rows: sorted.map((r) => [r.name, r.table, r.family]),
      fileName: `onde-sentar-${new Date().toISOString().slice(0, 10)}`,
    });
  }
}

// ───────────── Página ─────────────

function StatPill({ icon, label, value, tone }: { icon: ReactNode; label: string; value: ReactNode; tone?: "danger" | "warn" | "ok" }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border bg-card px-3 py-2 shadow-soft">
      <span className={cn("grid size-8 place-items-center rounded-lg [&_svg]:size-4", tone === "danger" ? "bg-rose-500/12 text-rose-600" : tone === "warn" ? "bg-amber-500/15 text-amber-600" : tone === "ok" ? "bg-emerald-500/12 text-emerald-600" : "bg-primary/10 text-primary")}>{icon}</span>
      <div>
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className="text-base leading-tight font-semibold tabular-nums">{value}</div>
      </div>
    </div>
  );
}

export function SeatingPage() {
  const { can, wedding } = useMe();
  const editable = can("guests:edit");
  const utils = trpc.useUtils();
  const [includeDeclined, setIncludeDeclined] = useState(false);
  const q = trpc.seating.layout.useQuery({ includeDeclined });
  const [filter, setFilter] = useState({ q: "", scope: "confirmed" as "confirmed" | "all", side: "" });
  const [open, setOpen] = useState<Table | null>(null);
  const [dialog, setDialog] = useState<"new" | "gen" | "suggest" | null>(null);
  const [overflow, setOverflow] = useState<{ payload: DragPayload; tableId: string; message: string } | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const pending = useRef(new Map<string, { id: string; x: number; y: number }>());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const assign = trpc.seating.assign.useMutation({ onSuccess: () => utils.seating.invalidate() });
  const positions = trpc.seating.savePositions.useMutation({ onSuccess: () => utils.seating.layout.invalidate(), onError: (e) => toast.error(e.message) });

  function seat(payload: DragPayload, tableId: string, force = false) {
    assign.mutate(
      { guestIds: payload.guestIds, tableId, wholeFamily: payload.wholeFamily, force },
      {
        onSuccess: (r) => toast.success(`${payload.label} → ${q.data?.tables.find((t) => t.id === tableId)?.name ?? "mesa"}${r.over ? " (acima da capacidade)" : ""}`),
        onError: (e) => {
          if (e.data?.code === "CONFLICT" && !force) setOverflow({ payload, tableId, message: e.message });
          else toast.error(e.message);
        },
      },
    );
  }

  function moved(id: string, x: number, y: number) {
    pending.current.set(id, { id, x, y });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const list = [...pending.current.values()];
      pending.current.clear();
      positions.mutate({ positions: list });
    }, 400);
  }

  async function pdf(kind: "table" | "alpha") {
    if (!q.data) return;
    setPdfBusy(true);
    try {
      await exportPdf(kind, q.data, wedding);
    } catch (e) {
      toast.error(`Não foi possível gerar o PDF: ${(e as Error).message}`);
    } finally {
      setPdfBusy(false);
    }
  }

  const data = q.data;
  const nextName = `Mesa ${(data?.tables.length ?? 0) + 1}`;

  return (
    <>
      <PageHeader
        title="Mapa de mesas"
        description="Arraste famílias até as mesas. Os lugares contam pessoas: convidado + acompanhantes."
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <LoadingButton variant="outline" loading={pdfBusy} disabled={!data?.stats.seatedPeople}>{!pdfBusy && <FileDown />} PDF</LoadingButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => pdf("table")}><LayoutGrid /> Por mesa (buffet / cerimonial)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => pdf("alpha")}><Users /> Lista alfabética (recepção)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {editable && (
              <>
                <Button variant="outline" onClick={() => setDialog("suggest")} disabled={!data?.tables.length}><Sparkles /> Sugerir distribuição</Button>
                <Button variant="outline" onClick={() => setDialog("gen")}><LayoutGrid /> Gerar mesas</Button>
                <Button onClick={() => setDialog("new")}><Plus /> Nova mesa</Button>
              </>
            )}
          </>
        }
      />

      {q.isLoading ? <PageLoader /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : data && (
        <div className="space-y-4">
          <div className="stagger grid grid-cols-2 gap-2 lg:grid-cols-4">
            <StatPill icon={<Users />} label="Pessoas sentadas" value={<>{data.stats.seatedPeople}<span className="text-sm font-normal text-muted-foreground"> / {data.stats.capacity} lugares</span></>} />
            <StatPill icon={<UserMinus />} label="Confirmados sem mesa" value={data.stats.unseatedConfirmedPeople} tone={data.stats.unseatedConfirmedPeople ? "warn" : "ok"} />
            <StatPill icon={<LayoutGrid />} label="Mesas cheias" value={`${data.stats.fullTables} de ${data.stats.tables}`} />
            <StatPill icon={<Minus />} label="Acima da capacidade" value={data.stats.overTables} tone={data.stats.overTables ? "danger" : "ok"} />
          </div>

          {!data.tables.length ? (
            <EmptyState
              icon={<LayoutGrid />}
              title="Nenhuma mesa ainda"
              description={`Gere as mesas de uma vez ou crie uma a uma. Há ${data.stats.confirmedPeople} pessoa(s) confirmada(s).`}
              action={editable && <div className="flex gap-2"><Button onClick={() => setDialog("gen")}><LayoutGrid /> Gerar mesas</Button><Button variant="outline" onClick={() => setDialog("new")}><Plus /> Nova mesa</Button></div>}
            />
          ) : (
            <div className="grid gap-4 lg:h-[calc(100dvh-280px)] lg:min-h-[480px] lg:grid-cols-[300px_1fr]">
              <UnseatedPanel people={data.unseated} tables={data.tables} editable={editable} onSeat={seat} filter={filter} setFilter={(f) => { setFilter(f); setIncludeDeclined(false); }} />
              <div className="hidden min-h-0 lg:block">
                <RoomCanvas tables={data.tables} editable={editable} onOpen={setOpen} onDropGuests={seat} onMoved={moved} />
              </div>
              <div className="lg:hidden">
                <TablesList tables={data.tables} editable={editable} onOpen={setOpen} onDropGuests={seat} />
              </div>
            </div>
          )}
          {data.tables.length > 0 && (
            <label className="flex w-fit items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={includeDeclined} onChange={(e) => setIncludeDeclined(e.target.checked)} /> Mostrar quem recusou na lista de "sem mesa"
            </label>
          )}
        </div>
      )}

      <TableSheet table={open} tables={data?.tables ?? []} editable={editable} onClose={() => setOpen(null)} />
      <NewTableDialog open={dialog === "new"} onOpenChange={(o) => setDialog(o ? "new" : null)} nextName={nextName} />
      <GenerateDialog open={dialog === "gen"} onOpenChange={(o) => setDialog(o ? "gen" : null)} people={data?.stats.unseatedConfirmedPeople || data?.stats.confirmedPeople || 0} />
      <SuggestDialog open={dialog === "suggest"} onOpenChange={(o) => setDialog(o ? "suggest" : null)} />
      <ConfirmDialog
        open={!!overflow}
        onOpenChange={(o) => !o && setOverflow(null)}
        title="Mesa sem lugar suficiente"
        description={<>{overflow?.message} <span className="mt-2 block">Sentar mesmo assim? A mesa ficará marcada em vermelho.</span></>}
        confirmLabel="Sentar mesmo assim"
        loading={assign.isPending}
        onConfirm={() => {
          if (overflow) seat(overflow.payload, overflow.tableId, true);
          setOverflow(null);
        }}
      />
    </>
  );
}

