import { ArrowLeft, Download, ImageIcon, Images, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog, EmptyState, LoadingButton, PageHeader, QueryState, TextField } from "@/components/app/common";
import { UploadButton, useOpenFile } from "@/components/app/files";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMe } from "@/hooks/use-me";
import { cn } from "@/lib/utils";
import { trpc, type RouterOutputs } from "@/trpc";
import { SelectField } from "./vendors/Vendors";

const onErr = (e: { message: string }) => toast.error(e.message);

/** URLs assinadas expiram em 5 min: renova a cada 4 */
function useThumbs(ids: string[]) {
  const q = trpc.files.thumbs.useQuery({ ids }, { enabled: ids.length > 0, staleTime: 240_000, refetchInterval: 240_000 });
  return q.data ?? {};
}

function Thumb({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  return src ? <img src={src} alt={alt} loading="lazy" className={cn("size-full object-cover", className)} /> : <div className={cn("grid size-full place-items-center bg-muted", className)}><ImageIcon className="size-5 text-muted-foreground" /></div>;
}

function AlbumDialog({ album, onClose }: { album: { id?: string; name: string; description: string | null } | null; onClose: () => void }) {
  const [form, setForm] = useState(album);
  useEffect(() => setForm(album), [album]);
  const utils = trpc.useUtils();
  const save = trpc.files.saveAlbum.useMutation({ onSuccess: () => { toast.success("Álbum salvo"); utils.files.albums.invalidate(); utils.files.album.invalidate(); onClose(); }, onError: onErr });
  return (
    <Dialog open={!!album} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{album?.id ? "Editar álbum" : "Novo álbum"}</DialogTitle></DialogHeader>
        {form && (
          <div className="grid gap-3">
            <TextField label="Nome *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <TextField label="Descrição" multiline value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
          </div>
        )}
        <DialogFooter><LoadingButton loading={save.isPending} disabled={(form?.name.trim().length ?? 0) < 2} onClick={() => form && save.mutate(form)}>Salvar</LoadingButton></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GalleryPage() {
  const { can } = useMe();
  const q = trpc.files.albums.useQuery();
  const thumbs = useThumbs([...new Set((q.data ?? []).flatMap((a) => a.items.map((i) => i.fileId)))]);
  const [edit, setEdit] = useState<{ id?: string; name: string; description: string | null } | null>(null);
  return (
    <>
      <PageHeader title="Galeria e referências" description="Inspirações, decoração, trajes e fotos organizadas em álbuns." actions={can("gallery:create") && <Button onClick={() => setEdit({ name: "", description: null })}><Plus /> Novo álbum</Button>} />
      <QueryState query={q} empty={(d) => (d.length ? null : <EmptyState icon={<Images />} title="Nenhum álbum" description="Crie álbuns para organizar referências." />)}>
        {(albums) => (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {albums.map((a) => (
              <Link key={a.id} to={`/galeria/${a.id}`} className="group overflow-hidden rounded-xl border bg-card shadow-soft transition hover:border-primary/40">
                <div className="grid aspect-square grid-cols-2 grid-rows-2 gap-0.5 bg-muted">
                  {[0, 1, 2, 3].map((i) => <div key={i} className="overflow-hidden">{a.items[i] ? <Thumb src={thumbs[a.items[i]!.fileId]} alt="" className="transition group-hover:scale-105" /> : <div className="size-full bg-muted" />}</div>)}
                </div>
                <div className="p-3">
                  <div className="truncate font-medium">{a.name}</div>
                  <div className="text-xs text-muted-foreground">{a._count.items} {a._count.items === 1 ? "imagem" : "imagens"}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </QueryState>
      <AlbumDialog album={edit} onClose={() => setEdit(null)} />
    </>
  );
}

type Item = RouterOutputs["files"]["album"]["items"][number];

function ItemDialog({ item, src, onClose }: { item: Item | null; src?: string; onClose: () => void }) {
  const { can } = useMe();
  const utils = trpc.useUtils();
  const openFile = useOpenFile();
  const vendors = trpc.vendors.list.useQuery(undefined, { enabled: !!item && can("vendors:view") });
  const [form, setForm] = useState({ caption: "", tags: "", notes: "", vendorId: null as string | null });
  const [del, setDel] = useState(false);
  useEffect(() => {
    if (item) setForm({ caption: item.caption ?? "", tags: item.tags.join(", "), notes: item.notes ?? "", vendorId: item.vendorId });
  }, [item]);
  const update = trpc.files.updateAlbumItem.useMutation({ onSuccess: () => { toast.success("Salvo"); utils.files.album.invalidate(); onClose(); }, onError: onErr });
  const remove = trpc.files.removeFromAlbum.useMutation({ onSuccess: () => { toast.success("Removida do álbum"); setDel(false); utils.files.invalidate(); onClose(); }, onError: onErr });
  const editable = can("gallery:edit");
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[95dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader><DialogTitle className="truncate">{item?.caption || item?.file.originalName}</DialogTitle></DialogHeader>
        {item && (
          <div className="grid gap-4 md:grid-cols-[1fr_280px]">
            <div className="grid min-h-60 place-items-center overflow-hidden rounded-xl bg-muted">{src ? <img src={src} alt={item.caption ?? item.file.originalName} className="max-h-[70dvh] w-auto object-contain" /> : <ImageIcon className="size-8 text-muted-foreground" />}</div>
            <fieldset disabled={!editable} className="space-y-3">
              <TextField label="Legenda" value={form.caption} onChange={(v) => setForm({ ...form, caption: v })} />
              <TextField label="Etiquetas" hint="Separadas por vírgula" value={form.tags} onChange={(v) => setForm({ ...form, tags: v })} />
              <TextField label="Observações" multiline value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} />
              {can("vendors:view") && <SelectField label="Fornecedor relacionado" allowNone value={form.vendorId} onChange={(v) => setForm({ ...form, vendorId: v })} options={(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name }))} />}
              {item.vendor && <Link to={`/fornecedores/${item.vendor.id}`} className="block text-xs text-primary hover:underline">Ver {item.vendor.name}</Link>}
            </fieldset>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => item && openFile(item.file.id, false)}><Download /> Baixar</Button>
          {can("gallery:delete") && <Button variant="destructive" onClick={() => setDel(true)}><Trash2 /> Remover do álbum</Button>}
          {editable && (
            <LoadingButton loading={update.isPending} onClick={() => item && update.mutate({ id: item.id, caption: form.caption || null, notes: form.notes || null, vendorId: form.vendorId, tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20) })}>Salvar</LoadingButton>
          )}
        </DialogFooter>
        <ConfirmDialog open={del} onOpenChange={setDel} title="Remover do álbum?" description="A imagem continua disponível em Documentos." destructive confirmLabel="Remover" loading={remove.isPending} onConfirm={() => item && remove.mutate({ id: item.id })} />
      </DialogContent>
    </Dialog>
  );
}

export function AlbumPage() {
  const { id = "" } = useParams();
  const { can } = useMe();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const q = trpc.files.album.useQuery({ id });
  const thumbs = useThumbs((q.data?.items ?? []).map((i) => i.file.id));
  const [selected, setSelected] = useState<Item | null>(null);
  const [edit, setEdit] = useState<{ id?: string; name: string; description: string | null } | null>(null);
  const [del, setDel] = useState(false);
  const add = trpc.files.addToAlbum.useMutation();
  const remove = trpc.files.deleteAlbum.useMutation({ onSuccess: () => { toast.success("Álbum excluído"); utils.files.albums.invalidate(); navigate("/galeria"); }, onError: onErr });
  const kind = q.data && /inspira|decora|flor|vestido|traje|convite|casa|lua/i.test(q.data.name) ? "INSPIRATION" : "PHOTO";
  async function onUploaded(files: { id: string }[]) {
    for (const f of files) {
      try {
        await add.mutateAsync({ albumId: id, fileId: f.id, tags: [] });
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
    await utils.files.invalidate();
  }
  return (
    <>
      <Link to="/galeria" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Galeria</Link>
      <QueryState query={q}>
        {(a) => (
          <>
            <PageHeader
              title={a.name}
              description={a.description ?? `${a.items.length} ${a.items.length === 1 ? "imagem" : "imagens"}`}
              actions={
                <>
                  {can("gallery:create") && <UploadButton category={kind} accept="image/*" multiple variant="default" label="Adicionar imagens" onUploaded={onUploaded} />}
                  {can("gallery:create") && <Button variant="outline" size="icon" aria-label="Editar álbum" onClick={() => setEdit({ id: a.id, name: a.name, description: a.description })}><Pencil /></Button>}
                  {can("gallery:delete") && <Button variant="outline" size="icon" aria-label="Excluir álbum" onClick={() => setDel(true)}><Trash2 /></Button>}
                </>
              }
            />
            {a.items.length ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {a.items.map((i) => (
                  <button key={i.id} onClick={() => setSelected(i)} className="group relative aspect-square overflow-hidden rounded-xl border bg-muted text-left">
                    <Thumb src={thumbs[i.file.id]} alt={i.caption ?? i.file.originalName} className="transition group-hover:scale-105" />
                    {(i.caption || i.tags.length > 0) && (
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 text-xs text-white">
                        {i.caption && <div className="truncate font-medium">{i.caption}</div>}
                        {i.tags.length > 0 && <div className="truncate opacity-80">{i.tags.map((t) => `#${t}`).join(" ")}</div>}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            ) : <EmptyState icon={<ImageIcon />} title="Álbum vazio" description="Adicione imagens de referência ou fotos." />}
            <ItemDialog item={selected} src={selected ? thumbs[selected.file.id] : undefined} onClose={() => setSelected(null)} />
            <AlbumDialog album={edit} onClose={() => setEdit(null)} />
            <ConfirmDialog open={del} onOpenChange={setDel} title="Excluir álbum?" description="As imagens não são apagadas; continuam em Documentos." destructive confirmLabel="Excluir" loading={remove.isPending} onConfirm={() => remove.mutate({ id: a.id })} />
          </>
        )}
      </QueryState>
    </>
  );
}
