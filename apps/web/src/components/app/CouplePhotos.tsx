import { ArrowLeft, ArrowRight, Camera, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useMe } from "@/hooks/use-me";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc";
import { Section, Spinner } from "./common";
import { uploadFile } from "./files";

type Slot = "coverFileId" | "partner1PhotoFileId" | "partner2PhotoFileId";

/** Botão invisível de upload: devolve os ids das imagens enviadas */
function usePicker(onFiles: (ids: string[]) => Promise<void> | void, multiple = false) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const input = (
    <input
      ref={ref}
      type="file"
      accept="image/jpeg,image/png,image/webp,image/heic"
      multiple={multiple}
      className="hidden"
      onChange={async (e) => {
        const list = Array.from(e.target.files ?? []);
        e.target.value = "";
        if (!list.length) return;
        setBusy(true);
        const ids: string[] = [];
        for (const f of list) {
          try {
            ids.push((await uploadFile(f, { category: "PHOTO", description: "Personalização do casamento" })).id);
          } catch (err) {
            toast.error(`${f.name}: ${(err as Error).message}`);
          }
        }
        try {
          if (ids.length) await onFiles(ids);
        } finally {
          setBusy(false);
        }
      }}
    />
  );
  return { input, busy, open: () => ref.current?.click() };
}

function Avatar({ url, name, size = "size-10", className }: { url: string | null; name: string; size?: string; className?: string }) {
  return url ? (
    <img src={url} alt={name} className={cn(size, "rounded-full object-cover ring-2 ring-card", className)} />
  ) : (
    <span className={cn(size, "grid place-items-center rounded-full bg-brand text-sm font-semibold text-white ring-2 ring-card", className)}>{name.slice(0, 1).toUpperCase()}</span>
  );
}

/** Dois avatares sobrepostos (usado no dashboard e na sidebar) */
export function CoupleAvatars({ size = "size-10", className }: { size?: string; className?: string }) {
  const { wedding } = useMe();
  const photos = trpc.wedding.photos.useQuery(undefined, { staleTime: 30 * 60_000, enabled: !!wedding });
  if (!wedding) return null;
  return (
    <span className={cn("flex shrink-0 -space-x-2.5", className)}>
      <Avatar url={photos.data?.partner1 ?? null} name={wedding.partner1Name} size={size} />
      <Avatar url={photos.data?.partner2 ?? null} name={wedding.partner2Name} size={size} />
    </span>
  );
}

function PartnerPhoto({ label, name, url, onPick, onRemove, busy, disabled }: { label: string; name: string; url: string | null; onPick: () => void; onRemove: () => void; busy: boolean; disabled: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <button type="button" onClick={onPick} disabled={disabled} className="group relative size-28 overflow-hidden rounded-full border-2 border-dashed border-border transition hover:border-primary disabled:cursor-not-allowed" aria-label={`Enviar foto de ${name}`}>
        {url ? <img src={url} alt={name} className="size-full object-cover transition duration-300 group-hover:scale-105" /> : <span className="grid size-full place-items-center bg-muted/50 text-muted-foreground"><Camera className="size-6" /></span>}
        {!disabled && <span className="absolute inset-0 grid place-items-center bg-black/45 text-xs font-medium text-white opacity-0 transition group-hover:opacity-100">{busy ? <Loader2 className="size-5 animate-spin" /> : url ? "Trocar" : "Enviar"}</span>}
      </button>
      <div>
        <div className="text-sm font-medium">{name}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
      {url && !disabled && <Button size="xs" variant="ghost" onClick={onRemove}><Trash2 /> Remover</Button>}
    </div>
  );
}

const POSITIONS: { value: string; label: string }[] = [{ value: "top", label: "Topo" }, { value: "center", label: "Centro" }, { value: "bottom", label: "Base" }];

export function CouplePhotosPanel() {
  const { wedding, can } = useMe();
  const editable = can("settings:edit") && can("gallery:create");
  const utils = trpc.useUtils();
  const raw = trpc.wedding.get.useQuery();
  const photos = trpc.wedding.photos.useQuery();
  const save = trpc.wedding.updatePhotos.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.wedding.photos.invalidate(), utils.wedding.get.invalidate()]);
      toast.success("Fotos atualizadas");
    },
    onError: (e) => toast.error(e.message),
  });
  const gallery = raw.data?.portalGalleryFileIds ?? [];
  const set = (patch: Parameters<typeof save.mutateAsync>[0]) => save.mutateAsync(patch);

  const cover = usePicker((ids) => set({ coverFileId: ids[0] }));
  const p1 = usePicker((ids) => set({ partner1PhotoFileId: ids[0] }));
  const p2 = usePicker((ids) => set({ partner2PhotoFileId: ids[0] }));
  const more = usePicker((ids) => set({ portalGalleryFileIds: [...gallery, ...ids].slice(0, 24) }), true);

  if (raw.isLoading || photos.isLoading) return <div className="grid place-items-center py-16"><Spinner /></div>;
  const p = photos.data!;
  const move = (i: number, d: -1 | 1) => {
    const next = [...gallery];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    void set({ portalGalleryFileIds: next });
  };
  const hint: ReactNode = editable ? null : <p className="text-sm text-muted-foreground">Somente quem pode editar as configurações altera as fotos.</p>;

  return (
    <div className="space-y-5">
      {cover.input}{p1.input}{p2.input}{more.input}
      <Section title="Foto de capa" description="Aparece no topo do dashboard e no portal dos convidados." actions={editable && <Button size="sm" variant="outline" onClick={cover.open} disabled={cover.busy}>{cover.busy ? <Loader2 className="animate-spin" /> : <ImagePlus />} {p.cover ? "Trocar capa" : "Enviar capa"}</Button>}>
        {hint}
        <div className="relative aspect-[21/8] overflow-hidden rounded-xl border bg-muted/40">
          {p.cover ? (
            <>
              <img src={p.cover} alt="Capa" className="size-full object-cover transition-[object-position] duration-500" style={{ objectPosition: p.coverPosition }} />
              <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
              <div className="absolute bottom-4 left-4 flex items-center gap-3 text-white">
                <CoupleAvatars size="size-11" />
                <div className="font-heading text-2xl font-semibold drop-shadow">{wedding?.partner1Name} & {wedding?.partner2Name}</div>
              </div>
            </>
          ) : (
            <button type="button" onClick={cover.open} disabled={!editable} className="grid size-full place-items-center text-muted-foreground transition hover:text-foreground disabled:cursor-default">
              <span className="flex flex-col items-center gap-2"><ImagePlus className="size-7" /><span className="text-sm">Escolha uma foto horizontal do casal</span></span>
            </button>
          )}
        </div>
        {p.cover && editable && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Enquadramento</span>
            <div className="inline-flex rounded-lg bg-muted p-1">
              {POSITIONS.map((o) => (
                <button key={o.value} type="button" onClick={() => set({ coverPosition: o.value })} className={cn("rounded-md px-3 py-1 text-sm font-medium transition", p.coverPosition === o.value ? "bg-card shadow-soft" : "text-muted-foreground hover:text-foreground")}>{o.label}</button>
              ))}
            </div>
            <Button size="sm" variant="ghost" onClick={() => set({ coverFileId: null })}><Trash2 /> Remover capa</Button>
          </div>
        )}
      </Section>

      <Section title="Fotos dos noivos" description="Usadas nos avatares do painel e no portal.">
        <div className="flex flex-wrap justify-center gap-10 py-2 sm:justify-start sm:pl-4">
          <PartnerPhoto label="Noivo(a) 1" name={wedding?.partner1Name ?? ""} url={p.partner1} onPick={p1.open} busy={p1.busy} disabled={!editable} onRemove={() => set({ partner1PhotoFileId: null })} />
          <PartnerPhoto label="Noivo(a) 2" name={wedding?.partner2Name ?? ""} url={p.partner2} onPick={p2.open} busy={p2.busy} disabled={!editable} onRemove={() => set({ partner2PhotoFileId: null })} />
        </div>
      </Section>

      <Section title="Galeria do portal" description={`Fotos exibidas para os convidados no portal de confirmação (${gallery.length}/24).`} actions={editable && <Button size="sm" variant="outline" onClick={more.open} disabled={more.busy || gallery.length >= 24}>{more.busy ? <Loader2 className="animate-spin" /> : <ImagePlus />} Adicionar fotos</Button>}>
        {p.gallery.length ? (
          <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {p.gallery.map((g, i) => (
              <figure key={g.id} className="group relative aspect-square overflow-hidden rounded-xl border bg-muted">
                <img src={g.url} alt="" className="size-full object-cover transition duration-500 group-hover:scale-105" loading="lazy" />
                {editable && (
                  <div className="absolute inset-x-0 bottom-0 flex justify-between gap-1 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                    <div className="flex gap-1">
                      <Button size="icon-sm" variant="secondary" aria-label="Mover para a esquerda" disabled={i === 0} onClick={() => move(i, -1)}><ArrowLeft /></Button>
                      <Button size="icon-sm" variant="secondary" aria-label="Mover para a direita" disabled={i === p.gallery.length - 1} onClick={() => move(i, 1)}><ArrowRight /></Button>
                    </div>
                    <Button size="icon-sm" variant="secondary" aria-label="Remover da galeria" onClick={() => set({ portalGalleryFileIds: gallery.filter((x) => x !== g.id) })}><Trash2 /></Button>
                  </div>
                )}
              </figure>
            ))}
          </div>
        ) : (
          <button type="button" onClick={more.open} disabled={!editable} className="grid w-full place-items-center rounded-xl border border-dashed py-12 text-sm text-muted-foreground transition hover:border-primary hover:text-foreground disabled:cursor-default">
            <span className="flex flex-col items-center gap-2"><ImagePlus className="size-6" /> Adicione fotos do ensaio, do pedido, da história de vocês…</span>
          </button>
        )}
        <p className="mt-3 text-xs text-muted-foreground">As fotos ficam em armazenamento privado e são exibidas por links temporários. Elas também aparecem na Galeria do painel.</p>
      </Section>
    </div>
  );
}
