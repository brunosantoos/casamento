import {
  ArrowDown, ArrowUp, Check, CheckCircle2, Copy, ExternalLink, FileDown, Gift, HandHeart, Heart, ImagePlus, Loader2, Package, Pencil, Plus, QrCode, RotateCcw, Settings2, Trash2, Undo2, X, BadgeCheck, Link2, MousePointerClick, Store, ShoppingBag, Layers, HandCoins, Minus
} from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog, EmptyState, Field, LoadingButton, MoneyInput, PageHeader, QueryState, StatusBadge, TextField, type Tone } from "@/components/app/common";
import { uploadFile } from "@/components/app/files";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMe } from "@/hooks/use-me";
import { date, dateTime, fromDateInput, money, newKey, toDateInput } from "@/lib/format";
import { PAYMENT_METHOD } from "@/lib/labels";
import { downloadReportPdf } from "@/lib/report-pdf";
import { cn } from "@/lib/utils";
import { trpc, type RouterOutputs } from "@/trpc";
import { Avatar, Bar, Cell2, DataTable, FilterBar, Metric, Money, NativeSelect, ReasonDialog, opts } from "./finance/shared";

type Item = RouterOutputs["gifts"]["items"][number];
type Contribution = RouterOutputs["gifts"]["contributions"][number];

const KIND: Record<string, { label: string; tone: Tone; hint: string }> = {
  ITEM: { label: "Presente", tone: "violet", hint: "Um valor fechado (ex.: jantar na lua de mel)" },
  QUOTA: { label: "Cotas", tone: "sky", hint: "Divida em cotas (ex.: 10 × R$ 100 da passagem)" },
  FREE: { label: "Valor livre", tone: "amber", hint: "O convidado escolhe quanto quer dar" },
  STORE: { label: "Produto na loja", tone: "emerald", hint: "Link da Amazon e outras lojas — o convidado compra lá (com seu link de afiliado)" },
};
const STATUS: Record<string, { label: string; tone: Tone }> = {
  PLEDGED: { label: "Aguardando conferência", tone: "amber" },
  CONFIRMED: { label: "Recebido", tone: "emerald" },
  REJECTED: { label: "Não recebido", tone: "rose" },
};
const THANKS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "A agradecer", tone: "amber" },
  SENT: { label: "Agradecido", tone: "emerald" },
  NOT_NEEDED: { label: "Dispensado", tone: "neutral" },
};
const TABS = ["lista", "recebidos", "agradecimentos", "pix"] as const;

function useThumbs(ids: string[]) {
  const { can } = useMe();
  const q = trpc.files.thumbs.useQuery({ ids }, { enabled: ids.length > 0 && can("gallery:view"), staleTime: 4 * 60_000, refetchInterval: 4 * 60_000 });
  return q.data ?? {};
}

// ───────────── Lista de presentes ─────────────

type ItemForm = { id?: string; title: string; description: string; kind: "ITEM" | "QUOTA" | "FREE" | "STORE"; priceCents: number | null; quotaCount: string; externalUrl: string; imageFileId: string | null; active: boolean };
const emptyItem = (): ItemForm => ({ title: "", description: "", kind: "STORE", priceCents: null, quotaCount: "1", externalUrl: "", imageFileId: null, active: true });

const storeLabel = (url: string) => {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    return /amazon\.|amzn\.to|^a\.co$/.test(h) ? "Amazon" : h;
  } catch {
    return "Loja";
  }
};

/** Link do produto com prévia: loja detectada e se a tag de afiliado está aplicada */
function StoreLinkField({ url, onChange }: { url: string; onChange: (v: string) => void }) {
  const valid = /^https?:\/\/\S+\.\S+/.test(url.trim());
  const preview = trpc.gifts.linkPreview.useQuery({ url: url.trim() }, { enabled: valid, staleTime: 60_000 });
  const p = preview.data;
  return (
    <Field label="Link do produto" hint={!url ? "Amazon (pode ser seu link de afiliado), Magalu, Mercado Livre…" : undefined} error={url && !valid ? "Cole o endereço completo, começando com https://" : null}>
      <div className="relative">
        <Link2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" value={url} onChange={(e) => onChange(e.target.value)} placeholder="Cole aqui o link do produto" inputMode="url" autoFocus />
      </div>
      {p && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs animate-in fade-in">
          <StatusBadge tone="neutral"><Store className="size-3" /> {p.store}</StatusBadge>
          {p.hasAffiliate ? (
            <StatusBadge tone="emerald"><BadgeCheck className="size-3" /> {p.tagApplied ? "Sua tag de afiliado será aplicada" : "Link de afiliado"}</StatusBadge>
          ) : p.store === "Amazon" ? (
            <StatusBadge tone="amber">Sem tag de afiliado — configure sua tag na aba Configurar</StatusBadge>
          ) : null}
          <a href={p.finalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">Testar link <ExternalLink className="size-3" /></a>
        </div>
      )}
    </Field>
  );
}

const KIND_UI = {
  STORE: { icon: ShoppingBag, label: "Loja", line: "O convidado compra na loja pelo seu link (Amazon, Magalu…)." },
  ITEM: { icon: Gift, label: "Valor fixo", line: "Um valor único pago por Pix — ex.: jantar da lua de mel." },
  QUOTA: { icon: Layers, label: "Cotas", line: "Dividido em cotas por Pix — ex.: 10 cotas de R$ 100 da passagem." },
  FREE: { icon: HandCoins, label: "Valor livre", line: "O convidado escolhe quanto quer dar por Pix." },
} as const;

/** Como o convidado verá o item no portal (prévia ao vivo) */
function PortalPreview({ f, image }: { f: ItemForm; image?: string }) {
  const qty = Number(f.quotaCount) || 1;
  const store = f.kind === "STORE" && /^https?:\/\//.test(f.externalUrl.trim()) ? storeLabel(f.externalUrl.trim()) : null;
  return (
    <div className="overflow-hidden rounded-xl border bg-white text-[oklch(0.25_0.02_30)] shadow-soft dark:bg-white">
      <div className="relative aspect-[16/10] overflow-hidden bg-gradient-to-br from-primary/15 via-[oklch(0.96_0.02_80)] to-transparent">
        {image ? <img src={image} alt="" className="size-full object-cover" /> : <Gift className="absolute top-1/2 left-1/2 size-9 -translate-x-1/2 -translate-y-1/2 text-primary/35" />}
      </div>
      <div className="space-y-1 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className={cn("text-sm font-medium", !f.title && "text-[oklch(0.6_0.02_30)]")}>{f.title || "Nome do presente"}</div>
          <div className="shrink-0 text-right text-sm font-semibold tabular-nums">
            {f.kind === "FREE" ? <span className="text-xs font-medium text-primary">valor livre</span> : f.priceCents ? money(f.priceCents) : f.kind === "STORE" ? null : <span className="text-[oklch(0.6_0.02_30)]">R$ —</span>}
            {f.kind === "QUOTA" && <span className="block text-[10px] font-normal opacity-60">por cota</span>}
            {f.kind === "STORE" && store && <span className="block text-[10px] font-normal opacity-60">{store}</span>}
          </div>
        </div>
        {f.description && <p className="line-clamp-2 text-[11px] opacity-70">{f.description}</p>}
        {f.kind === "QUOTA" && <div className="pt-1 text-[11px] opacity-60">{qty} cota(s) disponível(is)</div>}
        {f.kind === "STORE" && qty > 1 && <div className="pt-1 text-[11px] opacity-60">Faltam {qty} de {qty}</div>}
      </div>
    </div>
  );
}

function ItemDialog({ open, onOpenChange, initial, thumb }: { open: boolean; onOpenChange: (o: boolean) => void; initial: ItemForm; thumb?: string }) {
  const [f, setF] = useState(initial);
  const [preview, setPreview] = useState<string | undefined>(thumb);
  const [uploading, setUploading] = useState(false);
  const [showDesc, setShowDesc] = useState(!!initial.description);
  const fileRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  useEffect(() => {
    if (open) {
      setF(initial);
      setPreview(thumb);
      setShowDesc(!!initial.description);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = trpc.gifts.saveItem.useMutation({
    onSuccess: async () => {
      toast.success(f.id ? "Presente atualizado" : "Presente adicionado à lista");
      await utils.gifts.items.invalidate();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const total = f.kind === "QUOTA" && f.priceCents && Number(f.quotaCount) ? f.priceCents * Number(f.quotaCount) : null;
  const linkOk = /^https?:\/\/\S+\.\S+/.test(f.externalUrl.trim());
  const valueOk = f.kind === "FREE" || f.kind === "STORE" || (f.priceCents ?? 0) > 0;
  const canSave = f.title.trim().length >= 2 && !uploading && valueOk && (f.kind !== "STORE" || linkOk) && (f.kind !== "QUOTA" || Number(f.quotaCount) >= 1);
  const setKind = (k: ItemForm["kind"]) =>
    setF({ ...f, kind: k, quotaCount: k === "QUOTA" ? (f.kind === "QUOTA" ? f.quotaCount : "10") : k === "STORE" ? (f.kind === "STORE" ? f.quotaCount : "1") : f.quotaCount });
  const K = KIND_UI[f.kind];

  async function pickImage(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const up = await uploadFile(file, { category: "PHOTO", description: "Lista de presentes" });
      setF((x) => ({ ...x, imageFileId: up.id }));
      setPreview(URL.createObjectURL(file));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  const qtyStepper = (label: string, hint?: ReactNode, max = 100) => (
    <Field label={label} hint={hint}>
      <div className="flex h-9 items-center rounded-md border">
        <button type="button" className="grid h-full w-9 place-items-center text-muted-foreground transition hover:text-foreground disabled:opacity-40" disabled={Number(f.quotaCount) <= 1} onClick={() => setF({ ...f, quotaCount: String(Math.max(1, (Number(f.quotaCount) || 1) - 1)) })} aria-label="Menos"><Minus className="size-4" /></button>
        <input className="h-full min-w-0 flex-1 bg-transparent text-center text-sm font-medium tabular-nums outline-none" inputMode="numeric" value={f.quotaCount} onChange={(e) => setF({ ...f, quotaCount: e.target.value.replace(/\D/g, "").slice(0, 4) })} aria-label={label} />
        <button type="button" className="grid h-full w-9 place-items-center text-muted-foreground transition hover:text-foreground" onClick={() => setF({ ...f, quotaCount: String(Math.min(max, (Number(f.quotaCount) || 0) + 1)) })} aria-label="Mais"><Plus className="size-4" /></button>
      </div>
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <div className="grid max-h-[92dvh] md:grid-cols-[1fr_260px]">
          {/* Formulário */}
          <div className="flex min-h-0 flex-col">
            <DialogHeader className="border-b px-5 pt-5 pb-4">
              <DialogTitle>{f.id ? "Editar presente" : "Novo presente"}</DialogTitle>
              <DialogDescription className="sr-only">Cadastro de item da lista de presentes</DialogDescription>
              {/* Tipo: seletor compacto */}
              <div role="radiogroup" aria-label="Tipo de presente" className="mt-3 grid grid-cols-4 gap-1 rounded-lg bg-muted p-1">
                {(["STORE", "ITEM", "QUOTA", "FREE"] as const).map((k) => {
                  const I = KIND_UI[k].icon;
                  const on = f.kind === k;
                  return (
                    <button key={k} type="button" role="radio" aria-checked={on} onClick={() => setKind(k)} className={cn("flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition sm:text-[13px]", on ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground")}>
                      <I className={cn("size-4 shrink-0", on && "text-primary")} />
                      <span className="truncate">{KIND_UI[k].label}</span>
                    </button>
                  );
                })}
              </div>
              <p key={f.kind} className="mt-2 text-xs text-muted-foreground animate-in fade-in">{K.line}</p>
            </DialogHeader>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {f.kind === "STORE" && <StoreLinkField url={f.externalUrl} onChange={(v) => setF({ ...f, externalUrl: v })} />}

              {/* Foto + nome lado a lado */}
              <div className="flex items-end gap-3">
                <button type="button" onClick={() => fileRef.current?.click()} className="group relative grid size-[68px] shrink-0 place-items-center overflow-hidden rounded-lg border border-dashed bg-muted/40 transition hover:border-primary" aria-label={preview ? "Trocar foto" : "Adicionar foto"}>
                  {preview ? <img src={preview} alt="" className="size-full object-cover" /> : uploading ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : <ImagePlus className="size-5 text-muted-foreground transition group-hover:text-primary" />}
                  {preview && <span className="absolute inset-0 grid place-items-center bg-black/45 text-[11px] font-medium text-white opacity-0 transition group-hover:opacity-100">Trocar</span>}
                </button>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; void pickImage(file); }} />
                <TextField className="min-w-0 flex-1" label="Nome do presente" value={f.title} onChange={(v) => setF({ ...f, title: v })} placeholder={f.kind === "STORE" ? "Ex.: Jogo de taças de cristal" : f.kind === "QUOTA" ? "Ex.: Passagens da lua de mel" : "Ex.: Jantar romântico"} autoFocus={f.kind !== "STORE"} />
              </div>

              {/* Valores conforme o tipo */}
              {f.kind === "STORE" && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Preço (opcional)" hint="Só para referência"><MoneyInput value={f.priceCents} onChange={(v) => setF({ ...f, priceCents: v })} /></Field>
                  {qtyStepper("Quantidade", "Ex.: 2 jogos")}
                </div>
              )}
              {f.kind === "ITEM" && <Field label="Valor" error={f.priceCents === 0 ? "Informe o valor" : null}><MoneyInput value={f.priceCents} onChange={(v) => setF({ ...f, priceCents: v })} /></Field>}
              {f.kind === "QUOTA" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Valor de cada cota"><MoneyInput value={f.priceCents} onChange={(v) => setF({ ...f, priceCents: v })} /></Field>
                    {qtyStepper("Número de cotas", undefined, 1000)}
                  </div>
                  {total != null && (
                    <div className="flex items-center justify-between rounded-lg bg-accent/50 px-3 py-2 text-sm animate-in fade-in">
                      <span className="text-muted-foreground">Total arrecadado se todas forem escolhidas</span>
                      <Money value={total} size="sm" className="font-semibold" />
                    </div>
                  )}
                </>
              )}

              {/* Descrição recolhida */}
              {showDesc ? (
                <TextField label="Descrição" value={f.description} onChange={(v) => setF({ ...f, description: v })} multiline placeholder="Uma frase carinhosa sobre o presente (aparece no portal)" />
              ) : (
                <button type="button" onClick={() => setShowDesc(true)} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"><Plus className="size-4" /> Adicionar descrição</button>
              )}
              {f.kind !== "STORE" && f.externalUrl !== undefined && (showDesc || f.externalUrl) ? (
                <TextField label="Link de referência (opcional)" value={f.externalUrl} onChange={(v) => setF({ ...f, externalUrl: v })} placeholder="https://…" />
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-5 py-3">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Switch checked={f.active} onCheckedChange={(v) => setF({ ...f, active: v })} /> Visível no portal
              </label>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
                <LoadingButton
                  loading={save.isPending}
                  disabled={!canSave}
                  onClick={() =>
                    save.mutate({
                      id: f.id, title: f.title.trim(), description: f.description.trim() || null, kind: f.kind, priceCents: f.kind === "FREE" ? null : f.priceCents,
                      quotaCount: f.kind === "QUOTA" || f.kind === "STORE" ? Number(f.quotaCount) || 1 : null, externalUrl: f.externalUrl.trim() || null, imageFileId: f.imageFileId, active: f.active,
                    })
                  }
                >
                  {f.id ? "Salvar" : "Adicionar à lista"}
                </LoadingButton>
              </div>
            </div>
          </div>

          {/* Prévia (desktop) */}
          <aside className="hidden border-l bg-[oklch(0.975_0.008_80)] p-5 md:flex md:flex-col dark:bg-muted/30">
            <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Prévia no portal</div>
            <div className="mt-3"><PortalPreview f={f} image={preview} /></div>
            <p className="mt-auto pt-4 text-[11px] leading-relaxed text-muted-foreground">
              {f.kind === "STORE" ? "O convidado toca em “Ver na loja”, compra e depois avisa “Já comprei”." : "O convidado escolhe, paga pelo QR Code Pix e avisa “Já fiz o Pix”; vocês confirmam ao ver o dinheiro."}
            </p>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ListTab() {
  const q = trpc.gifts.items.useQuery();
  const utils = trpc.useUtils();
  const { can } = useMe();
  const editable = can("finance:create");
  const [dialog, setDialog] = useState<{ form: ItemForm; thumb?: string } | null>(null);
  const [del, setDel] = useState<Item | null>(null);
  const items = q.data ?? [];
  const thumbs = useThumbs(items.map((i) => i.imageFileId).filter((x): x is string => !!x));
  const save = trpc.gifts.saveItem.useMutation({ onSuccess: () => utils.gifts.items.invalidate(), onError: (e) => toast.error(e.message) });
  const reorder = trpc.gifts.reorderItems.useMutation({ onSuccess: () => utils.gifts.items.invalidate() });
  const remove = trpc.gifts.deleteItem.useMutation({
    onSuccess: (r) => {
      toast.success(r.deleted ? "Presente excluído" : "Presente desativado (já recebeu contribuições)");
      setDel(null);
      utils.gifts.items.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const move = (i: number, d: -1 | 1) => {
    const ids = items.map((x) => x.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    reorder.mutate({ ids });
  };
  const toForm = (i: Item): ItemForm => ({ id: i.id, title: i.title, description: i.description ?? "", kind: i.kind, priceCents: i.priceCents, quotaCount: String(i.quotaCount ?? 10), externalUrl: i.externalUrl ?? "", imageFileId: i.imageFileId, active: i.active });

  return (
    <>
      <QueryState
        query={q}
        empty={(d) =>
          !d.length ? (
            <EmptyState icon={<Gift />} title="Nenhum presente na lista" description="Crie presentes com valor fechado, cotas (ex.: lua de mel) ou valor livre. Os convidados pagam por Pix." action={editable && <Button onClick={() => setDialog({ form: emptyItem() })}><Plus /> Primeiro presente</Button>} />
          ) : null
        }
      >
        {(list) => (
          <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((i, idx) => {
              const p = i.progress;
              const pct = p.goalCents ? Math.min(100, Math.round((p.raisedCents / p.goalCents) * 100)) : null;
              const thumb = i.imageFileId ? thumbs[i.imageFileId] : undefined;
              return (
                <div key={i.id} className={cn("group lift relative flex flex-col overflow-hidden rounded-xl border bg-card shadow-soft", !i.active && "opacity-60")}>
                  <div className="relative aspect-[16/9] bg-gradient-to-br from-primary/15 via-muted to-transparent">
                    {thumb ? <img src={thumb} alt="" className="size-full object-cover transition duration-500 group-hover:scale-105" /> : <Gift className="absolute top-1/2 left-1/2 size-8 -translate-x-1/2 -translate-y-1/2 text-primary/40" />}
                    <div className="absolute top-2 left-2 flex gap-1">
                      <StatusBadge tone={KIND[i.kind]!.tone} className="bg-card/90 backdrop-blur">{KIND[i.kind]!.label}</StatusBadge>
                      {!i.active && <StatusBadge className="bg-card/90 backdrop-blur">Oculto</StatusBadge>}
                      {p.complete && <StatusBadge tone="emerald" className="bg-card/90 backdrop-blur"><Check className="size-3" /> Completo</StatusBadge>}
                    </div>
                    {editable && (
                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                        <Button size="icon-xs" variant="secondary" aria-label="Subir" disabled={idx === 0} onClick={() => move(idx, -1)}><ArrowUp /></Button>
                        <Button size="icon-xs" variant="secondary" aria-label="Descer" disabled={idx === list.length - 1} onClick={() => move(idx, 1)}><ArrowDown /></Button>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{i.title}</div>
                        {i.kind === "STORE" && i.externalUrl && <a href={i.externalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><Store className="size-3" /> {storeLabel(i.externalUrl)} <ExternalLink className="size-3" /></a>}
                        {i.description && <p className="line-clamp-2 text-xs text-muted-foreground">{i.description}</p>}
                      </div>
                      {i.kind !== "FREE" && i.priceCents != null && <Money value={i.priceCents} size="md" className="shrink-0 font-semibold" />}
                    </div>
                    <div className="mt-auto space-y-1.5 pt-1">
                      {pct != null && <Bar value={pct} />}
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          {i.kind === "QUOTA" ? `${p.quotasTaken}/${i.quotaCount} cotas` : i.kind === "STORE" ? `${p.quotasTaken}/${i.quotaCount ?? 1} comprado(s)` : `${p.contributions} contribuição(ões)`}
                        </span>
                        {i.kind === "STORE" ? (
                          <span className="inline-flex items-center gap-1"><MousePointerClick className="size-3.5" /> {i.clickCount} clique(s)</span>
                        ) : (
                          <span>Recebido <Money value={p.confirmedCents} size="sm" className="text-foreground" /></span>
                        )}
                      </div>
                    </div>
                    {editable && (
                      <div className="flex items-center justify-between border-t pt-2">
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Switch checked={i.active} onCheckedChange={(v) => save.mutate({ ...toForm(i), quotaCount: i.quotaCount, externalUrl: i.externalUrl, active: v })} aria-label="Visível no portal" /> No portal
                        </label>
                        <div className="flex gap-1">
                          <Button size="icon-sm" variant="ghost" aria-label="Editar" onClick={() => setDialog({ form: toForm(i), thumb })}><Pencil /></Button>
                          <Button size="icon-sm" variant="ghost" aria-label="Excluir" onClick={() => setDel(i)}><Trash2 /></Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {editable && (
              <button type="button" onClick={() => setDialog({ form: emptyItem() })} className="grid min-h-48 place-items-center rounded-xl border border-dashed text-sm text-muted-foreground transition hover:border-primary hover:text-foreground">
                <span className="flex flex-col items-center gap-2"><Plus className="size-5" /> Novo presente</span>
              </button>
            )}
          </div>
        )}
      </QueryState>
      {dialog && <ItemDialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)} initial={dialog.form} thumb={dialog.thumb} />}
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title={`Excluir "${del?.title}"?`} description="Se já houver contribuições, o presente é apenas ocultado do portal para preservar o histórico." destructive confirmLabel="Excluir" loading={remove.isPending} onConfirm={() => del && remove.mutate({ id: del.id })} />
    </>
  );
}

// ───────────── Recebidos ─────────────

function ConfirmGiftDialog({ c, onOpenChange }: { c: Contribution | null; onOpenChange: (o: boolean) => void }) {
  const settings = trpc.gifts.settings.useQuery(undefined, { enabled: !!c });
  const utils = trpc.useUtils();
  const [walletId, setWalletId] = useState("");
  const [day, setDay] = useState(toDateInput(new Date()));
  useEffect(() => {
    if (c && settings.data) setWalletId(settings.data.giftsWalletId ?? settings.data.wallets.find((w) => w.isDefault)?.id ?? settings.data.wallets[0]?.id ?? "");
  }, [c, settings.data]);
  const confirm = trpc.gifts.confirm.useMutation({
    onSuccess: async () => {
      toast.success("Presente confirmado e lançado como entrada recebida");
      await Promise.all([utils.gifts.invalidate(), utils.finance.invalidate()]);
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const wallets = settings.data?.wallets ?? [];
  const w = wallets.find((x) => x.id === walletId);
  return (
    <Dialog open={!!c} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirmar recebimento</DialogTitle>
          <DialogDescription>Confira no extrato do banco antes. Ao confirmar, o valor vira uma entrada recebida na carteira escolhida (uma única vez).</DialogDescription>
        </DialogHeader>
        {c && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
              <Avatar name={c.giverName} />
              <div className="min-w-0 flex-1"><div className="font-medium">{c.giverName}</div><div className="text-xs text-muted-foreground">{c.giftItem?.title ?? "Valor livre"} · avisou em {dateTime(c.createdAt)}</div></div>
              <Money value={c.amountCents} size="lg" className="font-semibold" />
            </div>
            {wallets.length ? (
              <Field label="Receber em" hint={w ? <>Saldo após: <Money value={w.balanceCents + (c.amountCents ?? 0)} size="sm" /></> : undefined}>
                <NativeSelect value={walletId} onChange={setWalletId} options={wallets.map((x) => ({ value: x.id, label: `${x.name}${x.isDefault ? " (padrão)" : ""}` }))} />
              </Field>
            ) : (
              <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Sem carteiras: a entrada fica sem carteira. <Link className="text-primary hover:underline" to="/financeiro/carteiras">Criar carteira</Link></p>
            )}
            <Field label="Data do recebimento"><Input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <LoadingButton loading={confirm.isPending} onClick={() => c && confirm.mutate({ id: c.id, walletId: walletId || null, receivedAt: fromDateInput(day) })}><CheckCircle2 /> Confirmar recebimento</LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RegisterGiftDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const groups = trpc.guests.groups.useQuery(undefined, { enabled: open });
  const items = trpc.gifts.items.useQuery(undefined, { enabled: open });
  const settings = trpc.gifts.settings.useQuery(undefined, { enabled: open });
  const utils = trpc.useUtils();
  const empty = { type: "physical" as "physical" | "cash", giverName: "", groupId: "", giftItemId: "", physicalDescription: "", amountCents: null as number | null, method: "CASH", message: "", confirmNow: true, walletId: "" };
  const [f, setF] = useState(empty);
  useEffect(() => {
    if (open) setF({ ...empty, walletId: settings.data?.giftsWalletId ?? settings.data?.wallets.find((w) => w.isDefault)?.id ?? "" });
  }, [open, settings.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const reg = trpc.gifts.register.useMutation({
    onSuccess: async () => {
      toast.success("Presente registrado");
      await Promise.all([utils.gifts.invalidate(), utils.finance.invalidate()]);
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const valid = f.giverName.trim().length >= 2 && (f.type === "physical" ? f.physicalDescription.trim().length >= 2 : (f.amountCents ?? 0) > 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar presente</DialogTitle>
          <DialogDescription>Presentes recebidos fora do portal: físicos, dinheiro em mãos ou transferência direta.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="inline-flex rounded-lg bg-muted p-1">
            {(["physical", "cash"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setF({ ...f, type: t })} className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition", f.type === t ? "bg-card shadow-soft" : "text-muted-foreground hover:text-foreground")}>
                {t === "physical" ? <><Package className="size-4" /> Presente físico</> : <><HandHeart className="size-4" /> Dinheiro</>}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Quem deu" value={f.giverName} onChange={(v) => setF({ ...f, giverName: v })} />
            <Field label="Família (opcional)">
              <NativeSelect
                value={f.groupId}
                onChange={(v) => setF({ ...f, groupId: v, giverName: f.giverName || (groups.data?.find((g) => g.id === v)?.name ?? "") })}
                placeholder="—"
                options={(groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))}
              />
            </Field>
          </div>
          {f.type === "physical" ? (
            <TextField label="O que foi dado" value={f.physicalDescription} onChange={(v) => setF({ ...f, physicalDescription: v })} placeholder="Ex.: Jogo de taças de cristal" />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Valor"><MoneyInput value={f.amountCents} onChange={(v) => setF({ ...f, amountCents: v })} /></Field>
                <Field label="Forma"><NativeSelect value={f.method} onChange={(v) => setF({ ...f, method: v })} options={opts(PAYMENT_METHOD)} /></Field>
              </div>
              <Field label="Presente da lista (opcional)"><NativeSelect value={f.giftItemId} onChange={(v) => setF({ ...f, giftItemId: v })} placeholder="—" options={(items.data ?? []).map((i) => ({ value: i.id, label: i.title }))} /></Field>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.confirmNow} onCheckedChange={(v) => setF({ ...f, confirmNow: !!v })} /> Já recebi — lançar como entrada recebida</label>
              {f.confirmNow && !!settings.data?.wallets.length && (
                <Field label="Receber em"><NativeSelect value={f.walletId} onChange={(v) => setF({ ...f, walletId: v })} options={settings.data.wallets.map((w) => ({ value: w.id, label: w.name }))} /></Field>
              )}
            </>
          )}
          <TextField label="Mensagem / observação (opcional)" value={f.message} onChange={(v) => setF({ ...f, message: v })} multiline />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <LoadingButton
            loading={reg.isPending}
            disabled={!valid}
            onClick={() =>
              reg.mutate({
                giverName: f.giverName, groupId: f.groupId || null, giftItemId: f.type === "cash" ? f.giftItemId || null : null, message: f.message || null,
                ...(f.type === "physical"
                  ? { physicalDescription: f.physicalDescription }
                  : { amountCents: f.amountCents, method: f.method as never, confirmNow: f.confirmNow, walletId: f.walletId || null }),
              })
            }
          >
            Registrar
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReceivedTab() {
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const q = trpc.gifts.contributions.useQuery({ status: (status || undefined) as never, search: search || undefined });
  const utils = trpc.useUtils();
  const { can } = useMe();
  const [confirm, setConfirm] = useState<Contribution | null>(null);
  const [reject, setReject] = useState<Contribution | null>(null);
  const [revert, setRevert] = useState<Contribution | null>(null);
  const [register, setRegister] = useState(false);
  const after = async () => Promise.all([utils.gifts.invalidate(), utils.finance.invalidate()]);
  const rej = trpc.gifts.reject.useMutation({ onSuccess: async () => { toast.success("Marcado como não recebido"); setReject(null); await after(); }, onError: (e) => toast.error(e.message) });
  const rev = trpc.gifts.revert.useMutation({ onSuccess: async () => { toast.success("Confirmação desfeita (entrada cancelada)"); setRevert(null); await after(); }, onError: (e) => toast.error(e.message) });
  const rows = q.data ?? [];
  const pledged = rows.filter((r) => r.status === "PLEDGED").reduce((a, r) => a + (r.amountCents ?? 0), 0);
  const confirmed = rows.filter((r) => r.status === "CONFIRMED").reduce((a, r) => a + (r.amountCents ?? 0), 0);

  return (
    <>
      <FilterBar search={search} onSearch={setSearch} placeholder="Buscar por nome ou família…">
        <NativeSelect className="w-52" value={status} onChange={setStatus} placeholder="Todos os status" options={Object.entries(STATUS).map(([value, v]) => ({ value, label: v.label }))} />
        {can("finance:create") && <Button size="sm" onClick={() => setRegister(true)}><Plus /> Registrar presente</Button>}
      </FilterBar>
      <QueryState query={q}>
        {() => (
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            initialSort={{ key: "date", dir: -1 }}
            leading={(r) => <Avatar name={r.giverName} />}
            empty={<EmptyState className="border-0" icon={<Heart />} title="Nenhum presente ainda" description="Quando um convidado avisar que fez o Pix pelo portal, ele aparece aqui para vocês conferirem." />}
            columns={[
              { key: "giver", header: "Quem deu", sort: (r) => r.giverName, cell: (r) => <Cell2 title={r.giverName} sub={[r.group?.name, r.source === "ADMIN" ? "registrado por vocês" : "pelo portal"].filter(Boolean).join(" · ")} /> },
              { key: "item", header: "Presente", cell: (r) => <Cell2 title={r.physicalDescription ?? r.giftItem?.title ?? "Valor livre"} sub={r.quotas ? `${r.quotas} cota(s)` : r.message ? `“${r.message.slice(0, 60)}${r.message.length > 60 ? "…" : ""}”` : undefined} /> },
              { key: "date", header: "Data", sort: (r) => new Date(r.createdAt).getTime(), cell: (r) => <span className="text-sm text-muted-foreground tabular-nums">{date(r.createdAt)}</span> },
              { key: "status", header: "Situação", cell: (r) => <div className="flex flex-col items-start gap-1"><StatusBadge tone={STATUS[r.status]!.tone}>{STATUS[r.status]!.label}</StatusBadge>{r.income?.wallet && <span className="text-[11px] text-muted-foreground">em {r.income.wallet.name}</span>}</div> },
              { key: "amount", header: "Valor", align: "right", sort: (r) => r.amountCents ?? 0, cell: (r) => (r.amountCents ? <Money value={r.amountCents} className={cn("font-medium", r.status === "REJECTED" && "line-through opacity-50")} /> : <span className="text-xs text-muted-foreground">físico</span>), footer: <span className="text-xs text-muted-foreground">Recebido <Money value={confirmed} size="sm" className="text-foreground" /> · aguardando <Money value={pledged} size="sm" className="text-foreground" /></span> },
            ]}
            actions={(r) => (
              <div className="flex gap-1">
                {r.status === "PLEDGED" && can("finance:create") && <Button size="xs" onClick={() => setConfirm(r)}><Check /> Confirmar</Button>}
                {r.status === "PLEDGED" && can("finance:edit") && <Button size="xs" variant="ghost" onClick={() => setReject(r)}><X /> Não recebi</Button>}
                {(r.status === "CONFIRMED" || r.status === "REJECTED") && r.amountCents && can("finance:approve") && <Button size="xs" variant="ghost" onClick={() => setRevert(r)}><Undo2 /> Desfazer</Button>}
              </div>
            )}
          />
        )}
      </QueryState>
      <ConfirmGiftDialog c={confirm} onOpenChange={(o) => !o && setConfirm(null)} />
      <RegisterGiftDialog open={register} onOpenChange={setRegister} />
      <ReasonDialog open={!!reject} onOpenChange={(o) => !o && setReject(null)} title="Marcar como não recebido?" description="Use quando o Pix não caiu na conta. O convidado não é avisado." confirmLabel="Marcar" loading={rej.isPending} onConfirm={(reason) => reject && rej.mutate({ id: reject.id, reason })} />
      <ReasonDialog open={!!revert} onOpenChange={(o) => !o && setRevert(null)} title="Desfazer a confirmação?" description="A entrada financeira é cancelada (fica no histórico) e o presente volta para conferência." confirmLabel="Desfazer" loading={rev.isPending} onConfirm={(reason) => revert && rev.mutate({ id: revert.id, reason })} />
    </>
  );
}

// ───────────── Agradecimentos ─────────────

function ThanksTab() {
  const [filter, setFilter] = useState("PENDING");
  const q = trpc.gifts.contributions.useQuery({ thankYou: (filter || undefined) as never });
  const utils = trpc.useUtils();
  const { wedding, can } = useMe();
  const [selected, setSelected] = useState<string[]>([]);
  const set = trpc.gifts.setThankYou.useMutation({
    onSuccess: async (r) => {
      toast.success(`${r.updated} agradecimento(s) atualizado(s)`);
      setSelected([]);
      await utils.gifts.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const rows = (q.data ?? []).filter((r) => r.status !== "REJECTED");
  async function pdf() {
    await downloadReportPdf({
      title: "Agradecimentos",
      subtitle: "Quem deu o quê e se o agradecimento já foi feito",
      wedding: wedding ? { names: `${wedding.partner1Name} & ${wedding.partner2Name}`, date: wedding.date } : undefined,
      columns: [{ label: "Quem deu", flex: 1.6 }, { label: "Família", flex: 1.2 }, { label: "Presente", flex: 2 }, { label: "Valor", align: "right" }, { label: "Agradecimento", flex: 1 }],
      rows: rows.map((r) => [r.giverName, r.group?.name ?? "—", r.physicalDescription ?? r.giftItem?.title ?? "Valor livre", r.amountCents ? (r.amountCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—", THANKS[r.thankYouStatus]!.label]),
      fileName: `agradecimentos-${new Date().toISOString().slice(0, 10)}`,
    });
  }
  const editable = can("finance:edit");
  return (
    <>
      <FilterBar>
        <div className="inline-flex rounded-lg bg-muted p-1">
          {[["PENDING", "A agradecer"], ["SENT", "Agradecidos"], ["", "Todos"]].map(([v, l]) => (
            <button key={v} type="button" onClick={() => { setFilter(v!); setSelected([]); }} className={cn("rounded-md px-3 py-1 text-sm font-medium transition", filter === v ? "bg-card shadow-soft" : "text-muted-foreground hover:text-foreground")}>{l}</button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {editable && selected.length > 0 && (
            <>
              <Button size="sm" onClick={() => set.mutate({ ids: selected, status: "SENT" })}><Heart /> Marcar {selected.length} como agradecido(s)</Button>
              <Button size="sm" variant="ghost" onClick={() => set.mutate({ ids: selected, status: "NOT_NEEDED" })}>Dispensar</Button>
            </>
          )}
          <Button size="sm" variant="outline" onClick={pdf} disabled={!rows.length}><FileDown /> PDF</Button>
        </div>
      </FilterBar>
      <QueryState query={q}>
        {() => (
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            selection={editable ? { selected, onChange: setSelected } : undefined}
            leading={(r) => <Avatar name={r.giverName} />}
            empty={<EmptyState className="border-0" icon={<Heart />} title={filter === "PENDING" ? "Tudo agradecido 💛" : "Nada por aqui"} description="Os presentes recebidos aparecem aqui para controlar os agradecimentos." />}
            columns={[
              { key: "giver", header: "Quem deu", sort: (r) => r.giverName, cell: (r) => <Cell2 title={r.giverName} sub={r.group?.name} /> },
              { key: "gift", header: "Presente", cell: (r) => <Cell2 title={r.physicalDescription ?? r.giftItem?.title ?? "Valor livre"} sub={r.amountCents ? <Money value={r.amountCents} size="sm" /> : "físico"} /> },
              { key: "thanks", header: "Agradecimento", cell: (r) => <div className="flex flex-col items-start gap-0.5"><StatusBadge tone={THANKS[r.thankYouStatus]!.tone}>{THANKS[r.thankYouStatus]!.label}</StatusBadge>{r.thankYouSentAt && <span className="text-[11px] text-muted-foreground">{date(r.thankYouSentAt)}</span>}</div> },
            ]}
            actions={editable ? (r) => (r.thankYouStatus === "PENDING" ? <Button size="xs" variant="ghost" onClick={() => set.mutate({ ids: [r.id], status: "SENT" })}><Heart /> Agradeci</Button> : <Button size="xs" variant="ghost" onClick={() => set.mutate({ ids: [r.id], status: "PENDING" })}><RotateCcw /> Reabrir</Button>) : undefined}
          />
        )}
      </QueryState>
    </>
  );
}

// ───────────── Pix ─────────────

const KEY_TYPES = [
  { value: "PHONE", label: "Celular" }, { value: "EMAIL", label: "E-mail" }, { value: "CPF", label: "CPF" }, { value: "CNPJ", label: "CNPJ" }, { value: "RANDOM", label: "Chave aleatória" },
];

function validKey(type: string, v: string) {
  const d = v.replace(/\D/g, "");
  if (!v.trim()) return null;
  switch (type) {
    case "CPF": return d.length === 11;
    case "CNPJ": return d.length === 14;
    case "PHONE": return d.length === 10 || d.length === 11 || ((d.length === 12 || d.length === 13) && d.startsWith("55"));
    case "EMAIL": return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
    case "RANDOM": return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim());
    default: return false;
  }
}

export function QrImage({ payload, size = 200, className }: { payload: string; size?: number; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(payload, { width: size * 2, margin: 1, errorCorrectionLevel: "M" }).then((u) => alive && setSrc(u)).catch(() => setSrc(null));
    return () => {
      alive = false;
    };
  }, [payload, size]);
  return src ? <img src={src} alt="QR Code Pix" width={size} height={size} className={cn("rounded-lg bg-white p-2", className)} /> : <div style={{ width: size, height: size }} className="grid place-items-center rounded-lg bg-muted"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
}

function PixTab() {
  const q = trpc.gifts.settings.useQuery();
  const utils = trpc.useUtils();
  const { can } = useMe();
  const editable = can("finance:edit");
  const [f, setF] = useState({ giftsEnabled: false, pixKeyType: "PHONE", pixKey: "", pixReceiverName: "", pixCity: "", giftsWalletId: "", amazonAffiliateTag: "" });
  useEffect(() => {
    if (q.data) setF({ giftsEnabled: q.data.giftsEnabled, pixKeyType: q.data.pixKeyType ?? "PHONE", pixKey: q.data.pixKey ?? "", pixReceiverName: q.data.pixReceiverName ?? "", pixCity: q.data.pixCity ?? q.data.city ?? "", giftsWalletId: q.data.giftsWalletId ?? "", amazonAffiliateTag: q.data.amazonAffiliateTag ?? "" });
  }, [q.data]);
  const save = trpc.gifts.updateSettings.useMutation({
    onSuccess: async () => {
      toast.success("Configuração do Pix salva");
      await utils.gifts.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const keyOk = validKey(f.pixKeyType, f.pixKey);
  return (
    <QueryState query={q}>
      {(s) => (
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4 rounded-xl border bg-card p-5 shadow-soft">
            <label className="flex items-center justify-between gap-3 rounded-xl border bg-muted/30 p-4">
              <div>
                <div className="font-medium">Lista de presentes no portal</div>
                <div className="text-sm text-muted-foreground">Mostra os presentes e o Pix na página dos convidados.</div>
              </div>
              <Switch checked={f.giftsEnabled} disabled={!editable} onCheckedChange={(v) => setF({ ...f, giftsEnabled: v })} />
            </label>
            <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
              <Field label="Tipo de chave"><NativeSelect value={f.pixKeyType} onChange={(v) => setF({ ...f, pixKeyType: v })} options={KEY_TYPES} disabled={!editable} /></Field>
              <Field label="Chave Pix" error={keyOk === false ? "Chave inválida para o tipo escolhido" : null} hint={keyOk ? "Chave válida ✓" : "Ela fica visível para os convidados (como em qualquer cobrança Pix)."}>
                <Input value={f.pixKey} onChange={(e) => setF({ ...f, pixKey: e.target.value })} disabled={!editable} aria-invalid={keyOk === false || undefined} placeholder={f.pixKeyType === "EMAIL" ? "voces@email.com" : f.pixKeyType === "PHONE" ? "(11) 98765-4321" : ""} />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Nome do recebedor" value={f.pixReceiverName} onChange={(v) => setF({ ...f, pixReceiverName: v })} hint="Como aparece no banco (até 25 caracteres)" maxLength={60} disabled={!editable} />
              <TextField label="Cidade" value={f.pixCity} onChange={(v) => setF({ ...f, pixCity: v })} maxLength={40} disabled={!editable} />
              <TextField className="sm:col-span-2" label="Tag de afiliado da Amazon (opcional)" value={f.amazonAffiliateTag} onChange={(v) => setF({ ...f, amazonAffiliateTag: v.trim() })} placeholder="seunome-20" maxLength={40} disabled={!editable} hint="Aplicada automaticamente aos links da Amazon que ainda não têm tag. Links de afiliado já prontos (amzn.to ou com tag=) são mantidos como estão." />
            </div>
            <Field label="Carteira que recebe os presentes" hint="Ao confirmar um presente, a entrada cai nesta carteira.">
              <NativeSelect value={f.giftsWalletId} onChange={(v) => setF({ ...f, giftsWalletId: v })} placeholder="Carteira padrão" options={s.wallets.map((w) => ({ value: w.id, label: w.name }))} disabled={!editable} />
            </Field>
            {editable && (
              <div className="flex justify-end">
                <LoadingButton loading={save.isPending} disabled={keyOk === false} onClick={() => save.mutate({ giftsEnabled: f.giftsEnabled, pixKeyType: (f.pixKey ? f.pixKeyType : null) as never, pixKey: f.pixKey || null, pixReceiverName: f.pixReceiverName || null, pixCity: f.pixCity || null, giftsWalletId: f.giftsWalletId || null, amazonAffiliateTag: f.amazonAffiliateTag.trim() || null })}>
                  Salvar configuração
                </LoadingButton>
              </div>
            )}
          </div>
          <div className="space-y-3 rounded-xl border bg-card p-5 text-center shadow-soft">
            <div className="flex items-center justify-center gap-2 text-sm font-medium"><QrCode className="size-4 text-primary" /> Prévia do Pix</div>
            {s.preview ? (
              <>
                <QrImage payload={s.preview} className="mx-auto border" />
                <p className="text-xs text-muted-foreground">Valor livre · {s.pixReceiverName}</p>
                <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(s.preview!).then(() => toast.success("Código copiado"))}><Copy /> Copiar código</Button>
                <p className="text-[11px] text-muted-foreground">Teste no app do banco (sem pagar) para conferir nome e chave.</p>
              </>
            ) : (
              <p className="py-10 text-sm text-muted-foreground">Salve a chave e o nome do recebedor para ver o QR Code.</p>
            )}
            {s.portalSlug && s.portalEnabled && <Button asChild size="sm" variant="ghost"><a href={`/p/${s.portalSlug}`} target="_blank" rel="noopener noreferrer"><ExternalLink /> Ver no portal</a></Button>}
          </div>
        </div>
      )}
    </QueryState>
  );
}

// ───────────── Página ─────────────

export function GiftsPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.includes(params.get("aba") as never) ? params.get("aba")! : "lista";
  const stats = trpc.gifts.stats.useQuery();
  const settings = trpc.gifts.settings.useQuery();
  const s = stats.data;
  const setTab = (v: string) => setParams({ aba: v }, { replace: true });
  return (
    <>
      <PageHeader eyebrow="Convidados" title="Presentes" description="Lista de presentes com Pix, conferência dos recebimentos e controle de agradecimentos." />
      {settings.data && !settings.data.giftsEnabled && tab !== "pix" && (
        <button type="button" onClick={() => setTab("pix")} className="lift mb-4 flex w-full items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-left">
          <span className="grid size-10 place-items-center rounded-xl bg-primary/12 text-primary"><Settings2 className="size-5" /></span>
          <div className="flex-1"><div className="font-medium">A lista ainda não aparece para os convidados</div><div className="text-sm text-muted-foreground">Configure a chave Pix e ative a lista.</div></div>
          <span className="text-sm font-medium text-primary">Configurar Pix →</span>
        </button>
      )}
      <div className="stagger mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Recebido" icon={<CheckCircle2 />} tone="success" value={s?.confirmedCents ?? 0} hint={`${s?.confirmedCount ?? 0} presente(s) confirmado(s)`} />
        <Metric label="Aguardando conferência" icon={<Loader2 />} tone="warning" value={s?.pledgedCents ?? 0} hint={`${s?.pledgedCount ?? 0} aviso(s) de Pix`} />
        <Metric label="Presentes físicos" icon={<Package />} tone="info" value={<span className="font-sans text-xl font-semibold tabular-nums">{s?.physicalCount ?? 0}</span>} />
        <Metric label="A agradecer" icon={<Heart />} tone="primary" value={<span className="font-sans text-xl font-semibold tabular-nums">{s?.thankYouPending ?? 0}</span>} hint={`${s?.thankYouSent ?? 0} já agradecido(s)`} />
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 max-w-full overflow-x-auto scrollbar-none">
          <TabsTrigger value="lista"><Gift /> Lista</TabsTrigger>
          <TabsTrigger value="recebidos"><HandHeart /> Recebidos {!!s?.pledgedCount && <span className="ml-1 rounded-full bg-amber-500/20 px-1.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">{s.pledgedCount}</span>}</TabsTrigger>
          <TabsTrigger value="agradecimentos"><Heart /> Agradecimentos</TabsTrigger>
          <TabsTrigger value="pix"><QrCode /> Configurar Pix</TabsTrigger>
        </TabsList>
        <TabsContent value="lista"><ListTab /></TabsContent>
        <TabsContent value="recebidos"><ReceivedTab /></TabsContent>
        <TabsContent value="agradecimentos"><ThanksTab /></TabsContent>
        <TabsContent value="pix"><PixTab /></TabsContent>
      </Tabs>
    </>
  );
}

