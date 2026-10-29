import { Camera, Check, CheckCheck, ChevronLeft, ChevronRight, Loader2, Settings2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog, EmptyState, ErrorState, PageHeader, PageLoader, Section, StatusBadge } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useMe } from "@/hooks/use-me";
import { dateTime, relative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { trpc, type RouterOutputs } from "@/trpc";

type Status = "PENDING" | "APPROVED" | "REJECTED";
type Photo = RouterOutputs["guestPhotos"]["list"][number];

const TABS: { value: Status; label: string }[] = [
  { value: "PENDING", label: "Pendentes" },
  { value: "APPROVED", label: "Aprovadas" },
  { value: "REJECTED", label: "Recusadas" },
];

function SettingsCard() {
  const { can } = useMe();
  const q = trpc.guestPhotos.settings.useQuery();
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState<{ enabled: boolean; maxPerFamily: number; showWall: boolean } | null>(null);
  const save = trpc.guestPhotos.saveSettings.useMutation({
    onSuccess: async () => {
      toast.success("Configuração salva");
      setDraft(null);
      await utils.guestPhotos.settings.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  if (!q.data) return null;
  const v = draft ?? q.data;
  const editable = can("settings:edit");
  const set = (patch: Partial<typeof v>) => setDraft({ ...v, ...patch });
  return (
    <Section title="Envio pelo portal" description="Os convidados enviam fotos pelo link de confirmação. Nada aparece para ninguém antes da aprovação de vocês." actions={<Settings2 className="size-4 text-muted-foreground" />}>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <span className="text-sm"><b className="block font-medium">Receber fotos</b><span className="text-xs text-muted-foreground">Mostra o envio no portal</span></span>
          <Switch checked={v.enabled} disabled={!editable} onCheckedChange={(x) => set({ enabled: x })} />
        </label>
        <div className="space-y-1.5 rounded-lg border p-3">
          <Label htmlFor="max" className="text-sm font-medium">Fotos por família</Label>
          <Input id="max" type="number" min={1} max={200} value={v.maxPerFamily} disabled={!editable} onChange={(e) => set({ maxPerFamily: Math.max(1, Math.min(200, Number(e.target.value) || 1)) })} />
        </div>
        <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <span className="text-sm"><b className="block font-medium">Mural no portal</b><span className="text-xs text-muted-foreground">Aprovadas visíveis aos convidados</span></span>
          <Switch checked={v.showWall} disabled={!editable} onCheckedChange={(x) => set({ showWall: x })} />
        </label>
      </div>
      {draft && editable && (
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>Descartar</Button>
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate(draft)}>{save.isPending && <Loader2 className="animate-spin" />} Salvar</Button>
        </div>
      )}
    </Section>
  );
}

function Lightbox({ photos, index, onIndex, onClose, onDecide, canModerate, busy }: {
  photos: Photo[]; index: number; onIndex: (i: number) => void; onClose: () => void; onDecide: (p: Photo, d: "approve" | "reject") => void; canModerate: boolean; busy: boolean;
}) {
  const p = photos[index];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onIndex(Math.min(photos.length - 1, index + 1));
      if (e.key === "ArrowLeft") onIndex(Math.max(0, index - 1));
      if (!canModerate || !p || busy) return;
      if (e.key.toLowerCase() === "a" && p.status !== "APPROVED") onDecide(p, "approve");
      if (e.key.toLowerCase() === "r" && p.status !== "REJECTED") onDecide(p, "reject");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, photos.length, p, canModerate, busy, onClose, onIndex, onDecide]);
  if (!p) return null;
  return (
    <div role="dialog" aria-modal aria-label="Foto ampliada" className="fixed inset-0 z-50 flex flex-col bg-black/90 animate-in fade-in" onClick={onClose}>
      <div className="flex items-center justify-between gap-3 p-3 text-white" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0 text-sm">
          <div className="truncate font-medium">{p.uploaderName}{p.family ? <span className="text-white/60"> · {p.family}</span> : null}</div>
          <div className="text-xs text-white/60">{dateTime(p.createdAt)} · {index + 1} de {photos.length}</div>
        </div>
        <Button size="icon" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={onClose} aria-label="Fechar"><X /></Button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-12" onClick={(e) => e.stopPropagation()}>
        <button type="button" disabled={index === 0} onClick={() => onIndex(index - 1)} className="absolute left-2 grid size-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-30" aria-label="Anterior"><ChevronLeft /></button>
        <img key={p.id} src={p.url} alt={p.caption ?? ""} className="max-h-full max-w-full rounded-lg object-contain animate-in fade-in zoom-in-95" />
        <button type="button" disabled={index === photos.length - 1} onClick={() => onIndex(index + 1)} className="absolute right-2 grid size-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-30" aria-label="Próxima"><ChevronRight /></button>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3 p-4 text-white" onClick={(e) => e.stopPropagation()}>
        {p.caption && <p className="w-full text-center text-sm text-white/80">“{p.caption}”</p>}
        {canModerate && (
          <>
            <Button variant="secondary" disabled={busy || p.status === "REJECTED"} onClick={() => onDecide(p, "reject")}><X /> Recusar <kbd className="ml-1 rounded bg-black/10 px-1 text-[10px]">R</kbd></Button>
            <Button disabled={busy || p.status === "APPROVED"} onClick={() => onDecide(p, "approve")}><Check /> Aprovar <kbd className="ml-1 rounded bg-white/20 px-1 text-[10px]">A</kbd></Button>
          </>
        )}
      </div>
    </div>
  );
}

export function GuestPhotosPage() {
  const { can } = useMe();
  const canModerate = can("gallery:edit");
  const [tab, setTab] = useState<Status>("PENDING");
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [rejectAsk, setRejectAsk] = useState<string[] | null>(null);
  const utils = trpc.useUtils();
  const counts = trpc.guestPhotos.counts.useQuery();
  const list = trpc.guestPhotos.list.useQuery({ status: tab }, { refetchInterval: tab === "PENDING" ? 30_000 : false });
  const moderate = trpc.guestPhotos.moderate.useMutation({
    onSuccess: async (r, v) => {
      toast.success(`${r.count} foto(s) ${v.decision === "approve" ? "aprovada(s)" : "recusada(s)"}`);
      setSelected((s) => s.filter((id) => !v.ids.includes(id)));
      await Promise.all([utils.guestPhotos.list.invalidate(), utils.guestPhotos.counts.invalidate(), utils.files.invalidate()]);
    },
    onError: (e) => toast.error(e.message),
  });
  const photos = useMemo(() => list.data ?? [], [list.data]);

  // No lightbox, após decidir, avança sozinho (a foto sai da aba atual)
  const decide = useCallback((p: Photo, d: "approve" | "reject") => {
    moderate.mutate({ ids: [p.id], decision: d });
    setOpen((i) => (i == null ? null : photos.length <= 1 ? null : Math.min(i, photos.length - 2)));
  }, [moderate, photos.length]);

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const allOn = photos.length > 0 && photos.every((p) => selected.includes(p.id));

  return (
    <>
      <PageHeader title="Fotos dos convidados" description="Fotos enviadas pelos convidados pelo portal. Aprovadas vão para o álbum “Fotos dos convidados” da galeria." />
      <div className="space-y-5">
        <SettingsCard />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg bg-muted p-1" role="tablist">
            {TABS.map((t) => (
              <button key={t.value} type="button" role="tab" aria-selected={tab === t.value} onClick={() => { setTab(t.value); setSelected([]); }} className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition", tab === t.value ? "bg-card shadow-soft" : "text-muted-foreground hover:text-foreground")}>
                {t.label}
                {!!counts.data?.[t.value] && <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", t.value === "PENDING" ? "bg-primary text-primary-foreground" : "bg-muted-foreground/15")}>{counts.data[t.value]}</span>}
              </button>
            ))}
          </div>
          {canModerate && photos.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-muted-foreground"><Checkbox checked={allOn} onCheckedChange={(v) => setSelected(v ? photos.map((p) => p.id) : [])} /> Selecionar todas</label>
              {selected.length > 0 && (
                <>
                  {tab !== "REJECTED" && <Button size="sm" variant="outline" disabled={moderate.isPending} onClick={() => setRejectAsk(selected)}><X /> Recusar {selected.length}</Button>}
                  {tab !== "APPROVED" && <Button size="sm" disabled={moderate.isPending} onClick={() => moderate.mutate({ ids: selected, decision: "approve" })}><CheckCheck /> Aprovar {selected.length}</Button>}
                </>
              )}
            </div>
          )}
        </div>

        {list.isLoading ? <PageLoader /> : list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : !photos.length ? (
          <EmptyState icon={<Camera />} title={tab === "PENDING" ? "Nada para aprovar" : tab === "APPROVED" ? "Nenhuma foto aprovada ainda" : "Nenhuma foto recusada"} description={tab === "PENDING" ? "Quando os convidados enviarem fotos pelo portal, elas aparecem aqui." : undefined} />
        ) : (
          <>
            {canModerate && tab === "PENDING" && <p className="text-xs text-muted-foreground">Dica: abra uma foto e use <kbd className="rounded border px-1">A</kbd> para aprovar, <kbd className="rounded border px-1">R</kbd> para recusar e as setas para navegar.</p>}
            <div className="stagger columns-2 gap-3 sm:columns-3 lg:columns-4 xl:columns-5 [&>*]:mb-3">
              {photos.map((p, i) => {
                const on = selected.includes(p.id);
                return (
                  <figure key={p.id} className={cn("group relative break-inside-avoid overflow-hidden rounded-xl border bg-muted shadow-soft transition", on && "ring-2 ring-primary ring-offset-2 ring-offset-background")}>
                    <button type="button" className="block w-full" onClick={() => setOpen(i)} aria-label={`Ampliar foto de ${p.uploaderName}`}>
                      <img src={p.url} alt={p.caption ?? ""} loading="lazy" className="w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                    </button>
                    {canModerate && (
                      <span className={cn("absolute top-2 left-2 rounded-md bg-background/90 p-1 shadow transition", !on && "opacity-0 group-hover:opacity-100 focus-within:opacity-100")}>
                        <Checkbox checked={on} onCheckedChange={() => toggle(p.id)} aria-label="Selecionar" />
                      </span>
                    )}
                    <figcaption className="flex items-center gap-2 p-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{p.uploaderName}</div>
                        <div className="truncate text-xs text-muted-foreground">{p.family ?? "—"} · {relative(p.createdAt)}</div>
                      </div>
                      {canModerate && tab === "PENDING" ? (
                        <div className="flex gap-1">
                          <Button size="icon-sm" variant="ghost" aria-label="Recusar" onClick={() => moderate.mutate({ ids: [p.id], decision: "reject" })}><X /></Button>
                          <Button size="icon-sm" aria-label="Aprovar" onClick={() => moderate.mutate({ ids: [p.id], decision: "approve" })}><Check /></Button>
                        </div>
                      ) : (
                        <StatusBadge tone={p.status === "APPROVED" ? "emerald" : "rose"}>{p.status === "APPROVED" ? "Aprovada" : "Recusada"}</StatusBadge>
                      )}
                    </figcaption>
                    {p.caption && <p className="-mt-1 px-2.5 pb-2.5 text-xs text-muted-foreground">“{p.caption}”</p>}
                  </figure>
                );
              })}
            </div>
          </>
        )}
      </div>

      {open != null && <Lightbox photos={photos} index={open} onIndex={setOpen} onClose={() => setOpen(null)} onDecide={decide} canModerate={canModerate} busy={moderate.isPending} />}
      <ConfirmDialog
        open={!!rejectAsk}
        onOpenChange={(o) => !o && setRejectAsk(null)}
        title={`Recusar ${rejectAsk?.length ?? 0} foto(s)?`}
        description="As fotos recusadas não aparecem no portal nem na galeria. Você pode aprová-las depois na aba Recusadas."
        confirmLabel="Recusar"
        destructive
        loading={moderate.isPending}
        onConfirm={() => rejectAsk && moderate.mutate({ ids: rejectAsk, decision: "reject" }, { onSettled: () => setRejectAsk(null) })}
      />
    </>
  );
}
