import { Download, Eye, FileText, Image as ImageIcon, Paperclip, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useMe } from "@/hooks/use-me";
import { date, fileSize } from "@/lib/format";
import { trpc } from "@/trpc";
import { ConfirmDialog, LoadingButton } from "./common";

export type UploadedFile = { id: string; originalName: string; mimeType: string; size: number; version: number };

/** Envia um arquivo para POST /api/files (multipart). O servidor valida tipo real, tamanho e permissão. */
export async function uploadFile(file: File, opts: { category: string; entityType?: string; entityId?: string; description?: string; replaceFileId?: string }): Promise<UploadedFile> {
  const fd = new FormData();
  fd.append("category", opts.category);
  if (opts.entityType) fd.append("entityType", opts.entityType);
  if (opts.entityId) fd.append("entityId", opts.entityId);
  if (opts.description) fd.append("description", opts.description);
  if (opts.replaceFileId) fd.append("replaceFileId", opts.replaceFileId);
  fd.append("file", file);
  const res = await fetch("/api/files", { method: "POST", body: fd, credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Falha no envio");
  return data;
}

export function UploadButton({ category, entityType, entityId, accept, label = "Enviar arquivo", onUploaded, multiple, variant = "outline", size }: {
  category: string; entityType?: string; entityId?: string; accept?: string; label?: string; onUploaded?: (f: UploadedFile[]) => void; multiple?: boolean; variant?: "outline" | "default" | "secondary" | "ghost"; size?: "sm" | "default";
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const utils = trpc.useUtils();
  async function onChange(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    const done: UploadedFile[] = [];
    for (const f of Array.from(list)) {
      try {
        done.push(await uploadFile(f, { category, entityType, entityId }));
      } catch (e) {
        toast.error(`${f.name}: ${(e as Error).message}`);
      }
    }
    setBusy(false);
    if (ref.current) ref.current.value = "";
    if (done.length) {
      toast.success(done.length === 1 ? "Arquivo enviado" : `${done.length} arquivos enviados`);
      await utils.files.invalidate();
      onUploaded?.(done);
    }
  }
  return (
    <>
      <input ref={ref} type="file" className="hidden" accept={accept} multiple={multiple} onChange={(e) => onChange(e.target.files)} />
      <LoadingButton type="button" variant={variant} size={size} loading={busy} onClick={() => ref.current?.click()}>
        {!busy && <Upload />} {label}
      </LoadingButton>
    </>
  );
}

/** Abre/baixa por URL temporária assinada (nunca há link permanente) */
export function useOpenFile() {
  const url = trpc.files.url.useMutation();
  return async (id: string, inline = true) => {
    try {
      const r = await url.mutateAsync({ id, inline });
      window.open(r.url, "_blank", "noopener");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
}

export function FileList({ files, onChanged, emptyText = "Nenhum arquivo" }: { files: { id: string; originalName: string; mimeType: string; size?: number; createdAt?: Date | string }[]; onChanged?: () => void; emptyText?: string }) {
  const open = useOpenFile();
  const { can } = useMe();
  const [del, setDel] = useState<string | null>(null);
  const remove = trpc.files.delete.useMutation({
    onSuccess: () => {
      toast.success("Arquivo excluído (recuperável durante o prazo de retenção)");
      setDel(null);
      onChanged?.();
    },
    onError: (e) => toast.error(e.message),
  });
  if (!files.length) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ul className="divide-y rounded-xl border">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-3 px-3 py-2 text-sm">
          {f.mimeType.startsWith("image/") ? <ImageIcon className="size-4 text-muted-foreground" /> : f.mimeType === "application/pdf" ? <FileText className="size-4 text-muted-foreground" /> : <Paperclip className="size-4 text-muted-foreground" />}
          <span className="min-w-0 flex-1 truncate">{f.originalName}</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">{f.size ? fileSize(f.size) : ""} {f.createdAt ? `· ${date(f.createdAt)}` : ""}</span>
          <Button size="icon-sm" variant="ghost" aria-label="Visualizar" onClick={() => open(f.id, true)}><Eye /></Button>
          <Button size="icon-sm" variant="ghost" aria-label="Baixar" onClick={() => open(f.id, false)}><Download /></Button>
          {can("documents:delete") && <Button size="icon-sm" variant="ghost" aria-label="Excluir" onClick={() => setDel(f.id)}><Trash2 /></Button>}
        </li>
      ))}
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title="Excluir arquivo?" description="O arquivo fica recuperável durante o prazo de retenção configurado." destructive confirmLabel="Excluir" loading={remove.isPending} onConfirm={() => del && remove.mutate({ id: del })} />
    </ul>
  );
}
