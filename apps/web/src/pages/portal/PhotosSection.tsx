import { Camera, CheckCircle2, Clock, ImagePlus, Loader2, X, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc";

type Pending = { key: string; file: File; preview: string; progress: number; state: "queued" | "uploading" | "done" | "error"; error?: string };

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic";
const MAX_BYTES = 15 * 1024 * 1024;

/** Envia uma foto com progresso real (XHR) */
function send(token: string, file: File, uploaderName: string, caption: string, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const fd = new FormData();
    fd.append("uploaderName", uploaderName);
    if (caption) fd.append("caption", caption);
    fd.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/portal/${encodeURIComponent(token)}/photos`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = "Não foi possível enviar";
      try {
        msg = JSON.parse(xhr.responseText).error ?? msg;
      } catch {
        if (xhr.status === 429) msg = "Muitos envios seguidos. Aguarde alguns minutos.";
      }
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error("Sem conexão"));
    xhr.send(fd);
  });
}

/** Envio de fotos pelos convidados (precisa do token do convite) */
export function PhotosSection({ token }: { token: string }) {
  const status = trpc.portalPhotos.status.useQuery({ token }, { retry: false, refetchOnWindowFocus: false });
  const utils = trpc.useUtils();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [caption, setCaption] = useState("");
  const [queue, setQueue] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => queue.forEach((q) => URL.revokeObjectURL(q.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const s = status.data;
  if (!s || (!s.enabled && !s.wall.length)) return null;

  const room = s.remaining - queue.filter((q) => q.state !== "done" && q.state !== "error").length;
  const add = (files: FileList | null) => {
    setError(null);
    const list = Array.from(files ?? []);
    const accepted: Pending[] = [];
    for (const f of list) {
      if (accepted.length >= room) {
        setError(`Vocês podem enviar mais ${Math.max(0, room)} foto(s).`);
        break;
      }
      if (!f.type.startsWith("image/")) continue;
      if (f.size > MAX_BYTES) {
        setError(`${f.name}: maior que 15 MB`);
        continue;
      }
      accepted.push({ key: crypto.randomUUID(), file: f, preview: URL.createObjectURL(f), progress: 0, state: "queued" });
    }
    setQueue((q) => [...q, ...accepted]);
    if (input.current) input.current.value = "";
  };
  const patch = (key: string, p: Partial<Pending>) => setQueue((q) => q.map((x) => (x.key === key ? { ...x, ...p } : x)));

  async function upload() {
    const uploader = (name || s!.familyName).trim();
    if (uploader.length < 2) return setError("Informe seu nome");
    setBusy(true);
    setError(null);
    for (const item of queue.filter((q) => q.state === "queued" || q.state === "error")) {
      patch(item.key, { state: "uploading", progress: 0, error: undefined });
      try {
        await send(token, item.file, uploader, caption.trim(), (p) => patch(item.key, { progress: p }));
        patch(item.key, { state: "done", progress: 100 });
      } catch (e) {
        patch(item.key, { state: "error", error: (e as Error).message });
      }
    }
    setBusy(false);
    setCaption("");
    await utils.portalPhotos.status.invalidate({ token });
    setQueue((q) => {
      q.filter((x) => x.state === "done").forEach((x) => URL.revokeObjectURL(x.preview));
      return q.filter((x) => x.state !== "done");
    });
  }

  const waiting = queue.filter((q) => q.state === "queued" || q.state === "error").length;

  return (
    <section className="mt-10 space-y-6">
      {s.enabled && (
        <div className="overflow-hidden rounded-xl border border-[oklch(0.9_0.014_70)] bg-white/85 shadow-soft">
          <div className="flex items-start gap-3 border-b border-[oklch(0.92_0.01_70)] p-5">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><Camera className="size-5" /></span>
            <div>
              <h2 className="font-heading text-2xl font-semibold">Compartilhe suas fotos</h2>
              <p className="text-sm text-[oklch(0.45_0.03_30)]">Mande os seus registros para os noivos. Eles aprovam antes de qualquer foto aparecer.</p>
            </div>
          </div>
          <div className="space-y-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="font-medium">Seu nome</span>
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={s.familyName} className="h-10 w-full rounded-lg border border-[oklch(0.88_0.016_70)] bg-white px-3 outline-none focus:border-primary focus:ring-3 focus:ring-primary/20" />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Legenda <span className="font-normal text-[oklch(0.55_0.02_30)]">(opcional)</span></span>
                <input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={300} placeholder="Ex.: Na pista de dança!" className="h-10 w-full rounded-lg border border-[oklch(0.88_0.016_70)] bg-white px-3 outline-none focus:border-primary focus:ring-3 focus:ring-primary/20" />
              </label>
            </div>

            <input ref={input} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => add(e.target.files)} />
            {queue.length > 0 ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {queue.map((q) => (
                  <div key={q.key} className="relative aspect-square overflow-hidden rounded-lg bg-[oklch(0.95_0.01_80)]">
                    <img src={q.preview} alt="" className={cn("size-full object-cover", q.state === "uploading" && "opacity-70")} />
                    {q.state === "uploading" && (
                      <div className="absolute inset-x-2 bottom-2 h-1.5 overflow-hidden rounded-full bg-white/70"><div className="h-full bg-primary transition-[width]" style={{ width: `${q.progress}%` }} /></div>
                    )}
                    {q.state === "error" && <div className="absolute inset-x-0 bottom-0 bg-rose-600/90 px-1.5 py-1 text-[10px] leading-tight text-white">{q.error}</div>}
                    {!busy && (
                      <button type="button" onClick={() => { URL.revokeObjectURL(q.preview); setQueue((x) => x.filter((y) => y.key !== q.key)); }} className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-black/55 text-white" aria-label="Remover">
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                {room > 0 && !busy && (
                  <button type="button" onClick={() => input.current?.click()} className="grid aspect-square place-items-center rounded-lg border-2 border-dashed border-[oklch(0.86_0.02_70)] text-[oklch(0.5_0.03_30)] transition hover:border-primary hover:text-primary" aria-label="Adicionar mais fotos">
                    <ImagePlus className="size-6" />
                  </button>
                )}
              </div>
            ) : (
              <button type="button" disabled={s.remaining <= 0} onClick={() => input.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-[oklch(0.86_0.02_70)] px-4 py-10 text-[oklch(0.45_0.03_30)] transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60">
                <ImagePlus className="size-8" />
                <span className="font-medium">{s.remaining > 0 ? "Escolher fotos" : "Limite de fotos atingido"}</span>
                <span className="text-xs">JPG, PNG, WEBP ou HEIC · até 15 MB cada</span>
              </button>
            )}

            {error && <p className="text-sm font-medium text-rose-600">{error}</p>}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-[oklch(0.5_0.03_30)]">Sua família ainda pode enviar <b>{Math.max(0, s.remaining)}</b> de {s.max} foto(s).</span>
              {waiting > 0 && (
                <button type="button" disabled={busy} onClick={upload} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-brand transition hover:opacity-90 disabled:opacity-60">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />} Enviar {waiting} foto(s)
                </button>
              )}
            </div>
            <p className="text-[11px] leading-relaxed text-[oklch(0.55_0.02_30)]">
              Ao enviar, você autoriza que os noivos usem estas fotos apenas na galeria do casamento. Elas ficam privadas e só aparecem para outros convidados se os noivos aprovarem e publicarem o mural. Envie apenas fotos que você tirou e nas quais as pessoas concordem em aparecer.
            </p>
          </div>

          {s.own.length > 0 && (
            <div className="border-t border-[oklch(0.92_0.01_70)] p-5">
              <h3 className="mb-3 text-sm font-semibold">Fotos que vocês enviaram</h3>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {s.own.map((p) => (
                  <figure key={p.id} className="relative aspect-square overflow-hidden rounded-lg">
                    <img src={p.url} alt={p.caption ?? ""} loading="lazy" className={cn("size-full object-cover", p.status === "REJECTED" && "opacity-40 grayscale")} />
                    <span className={cn("absolute inset-x-1 bottom-1 flex items-center justify-center gap-1 rounded-md px-1 py-0.5 text-[10px] font-medium text-white backdrop-blur", p.status === "APPROVED" ? "bg-emerald-600/85" : p.status === "REJECTED" ? "bg-black/60" : "bg-black/55")}>
                      {p.status === "APPROVED" ? <CheckCircle2 className="size-3" /> : p.status === "REJECTED" ? <XCircle className="size-3" /> : <Clock className="size-3" />}
                      {p.status === "APPROVED" ? "aprovada" : p.status === "REJECTED" ? "não publicada" : "aguardando aprovação"}
                    </span>
                  </figure>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {s.wall.length > 0 && (
        <div>
          <h2 className="mb-3 text-center font-heading text-2xl font-semibold">Mural dos convidados</h2>
          <div className="columns-2 gap-2 sm:columns-3 [&>*]:mb-2">
            {s.wall.map((p) => (
              <figure key={p.id} className="break-inside-avoid overflow-hidden rounded-lg bg-white shadow-soft">
                <img src={p.url} alt={p.caption ?? ""} loading="lazy" className="w-full object-cover" />
                {(p.caption || p.uploaderName) && <figcaption className="px-2 py-1.5 text-[11px] text-[oklch(0.45_0.03_30)]">{p.caption ? `“${p.caption}” · ` : ""}{p.uploaderName}</figcaption>}
              </figure>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
