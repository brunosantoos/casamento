import { Check, CheckCircle2, Copy, ExternalLink, Gift, Heart, Loader2, Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { MoneyInput } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { QrImage } from "@/pages/Gifts";
import { trpc, type RouterOutputs } from "@/trpc";

type List = Extract<RouterOutputs["portalGifts"]["list"], { enabled: true }>;
type Item = List["items"][number];

/**
 * Lista de presentes no portal. Mostra só o progresso agregado — nunca nomes ou valores de outros convidados.
 * Fluxo: escolher → valor/cotas → QR + copia e cola → "Já fiz o Pix" (o casal confere e confirma).
 */
export function GiftsSection({ token, slug }: { token?: string; slug?: string }) {
  const ident = token ? { token } : { slug: slug! };
  const q = trpc.portalGifts.list.useQuery(ident, { enabled: !!(token || slug), retry: false, staleTime: 60_000 });
  const [open, setOpen] = useState<Item | "free" | null>(null);
  const [store, setStore] = useState<Item | null>(null);
  if (!q.data || !q.data.enabled || !q.data.items.length) return null;
  const data = q.data;
  const hasFree = data.items.some((i) => i.kind === "FREE");
  const onlyStore = data.items.every((i) => i.kind === "STORE");
  return (
    <section id="presentes" className="mt-14 scroll-mt-20">
      <div className="text-center">
        <Gift className="mx-auto size-7 text-primary" />
        <h2 className="mt-2 font-heading text-3xl font-semibold">Lista de presentes</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-[oklch(0.45_0.03_30)]">Sua presença é o nosso maior presente. Se quiser nos presentear, escolha uma opção abaixo{onlyStore ? " — a compra é feita direto na loja." : data.pixEnabled ? " — por Pix ou direto na loja." : "."}</p>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {data.items.map((i) => (
          <button
            key={i.id}
            type="button"
            disabled={i.complete && i.kind !== "FREE"}
            onClick={() => (i.kind === "STORE" ? setStore(i) : setOpen(i))}
            className="group overflow-hidden rounded-2xl border border-[oklch(0.9_0.014_70)] bg-white/90 text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
          >
            <div className="relative aspect-[16/10] overflow-hidden bg-gradient-to-br from-primary/15 via-[oklch(0.96_0.02_80)] to-transparent">
              {i.imageUrl ? <img src={i.imageUrl} alt="" loading="lazy" className="size-full object-cover transition duration-500 group-hover:scale-105" /> : <Gift className="absolute top-1/2 left-1/2 size-9 -translate-x-1/2 -translate-y-1/2 text-primary/40" />}
              {i.complete && i.kind !== "FREE" && <span className="absolute inset-0 grid place-items-center bg-white/70 font-medium text-[oklch(0.35_0.03_30)]"><span className="flex items-center gap-1.5"><Check className="size-4" /> Presenteado</span></span>}
            </div>
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium">{i.title}</div>
                <div className="shrink-0 text-right text-sm font-semibold tabular-nums">
                  {i.kind === "STORE" ? (
                    <>{i.priceCents ? money(i.priceCents) : null}<span className="block text-[11px] font-normal text-[oklch(0.5_0.03_30)]">{i.store ?? "loja"}</span></>
                  ) : i.kind === "FREE" ? <span className="text-xs font-medium text-primary">valor livre</span> : i.kind === "QUOTA" ? <>{money(i.priceCents)}<span className="block text-[11px] font-normal text-[oklch(0.5_0.03_30)]">por cota</span></> : money(i.priceCents)}
                </div>
              </div>
              {i.description && <p className="mt-1 line-clamp-2 text-xs text-[oklch(0.45_0.03_30)]">{i.description}</p>}
              {i.kind === "STORE" && (i.quotaCount ?? 1) > 1 && !i.complete && <div className="mt-2 text-[11px] text-[oklch(0.5_0.03_30)]">Faltam {i.quotasLeft} de {i.quotaCount}</div>}
              {i.percent != null && i.kind === "QUOTA" && (
                <div className="mt-3">
                  <div className="h-1.5 overflow-hidden rounded-full bg-[oklch(0.93_0.01_80)]"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${i.percent}%` }} /></div>
                  <div className="mt-1 text-[11px] text-[oklch(0.5_0.03_30)]">{i.quotasLeft} cota(s) disponível(is)</div>
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
      {!hasFree && data.pixEnabled && (
        <p className="mt-4 text-center text-sm">
          <button type="button" onClick={() => setOpen("free")} className="font-medium text-primary underline-offset-4 hover:underline">Prefere escolher o valor?</button>
        </p>
      )}
      <StoreDialog ident={ident} item={store} familyName={data.familyName} onOpenChange={(o) => !o && setStore(null)} />
      <GiftDialog ident={ident} item={open} familyName={data.familyName} receiverName={data.receiverName} onOpenChange={(o) => !o && setOpen(null)} />
    </section>
  );
}

/** Produto em loja: abre o link (com afiliado, contando o clique) e depois "Já comprei" */
function StoreDialog({ ident, item, familyName, onOpenChange }: { ident: { token?: string; slug?: string }; item: Item | null; familyName: string | null; onOpenChange: (o: boolean) => void }) {
  const [step, setStep] = useState<"go" | "done">("go");
  const [name, setName] = useState(familyName ?? "");
  const [message, setMessage] = useState("");
  const [qty, setQty] = useState(1);
  const [website, setWebsite] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const click = trpc.portalGifts.click.useMutation();
  const bought = trpc.portalGifts.purchased.useMutation({ onSuccess: () => setStep("done"), onError: (e) => setError(e.message) });
  const utils = trpc.useUtils();
  useEffect(() => {
    if (item) {
      setStep("go");
      setError(null);
      setQty(1);
      setKey(crypto.randomUUID());
      setName(familyName ?? "");
    }
  }, [item, familyName]);
  if (!item) return null;
  const max = Math.max(1, item.quotasLeft ?? 1);
  async function openStore() {
    // Abre a aba antes do await (bloqueadores de pop-up), depois aponta para o link com afiliado
    const win = window.open("about:blank", "_blank");
    try {
      const r = await click.mutateAsync({ ...ident, itemId: item!.id });
      if (win) {
        win.opener = null;
        win.location.href = r.url;
      } else window.location.href = r.url;
    } catch (e) {
      win?.close();
      setError((e as Error).message);
    }
  }
  return (
    <Dialog open={!!item} onOpenChange={(o) => { if (!o && step === "done") void utils.portalGifts.list.invalidate(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        {step === "done" ? (
          <div className="py-6 text-center">
            <CheckCircle2 className="mx-auto size-10 text-emerald-600" />
            <DialogTitle className="mt-3 font-heading text-2xl">Obrigado! 💛</DialogTitle>
            <DialogDescription className="mt-2">Avisamos os noivos que você comprou “{item.title}”.</DialogDescription>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-heading text-2xl">{item.title}</DialogTitle>
              <DialogDescription>Compre direto na {item.store ?? "loja"} e depois nos avise aqui, para não recebermos o mesmo presente duas vezes.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-xl border p-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">Abra o produto na {item.store ?? "loja"}</div>
                  <Button className="mt-2 w-full" onClick={openStore} disabled={click.isPending}>
                    {click.isPending ? <Loader2 className="animate-spin" /> : <ExternalLink />} Ver na {item.store ?? "loja"}
                  </Button>
                </div>
              </div>
              <form
                className="flex items-start gap-3 rounded-xl border p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  setError(null);
                  bought.mutate({ ...ident, itemId: item.id, quantity: qty, giverName: name, message: message || null, submissionKey: key, website: website || undefined });
                }}
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="text-sm font-medium">Já comprou? Avise os noivos</div>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" required minLength={2} maxLength={120} />
                  {max > 1 && (
                    <div className="flex items-center gap-2 text-sm">
                      Quantidade
                      <Button type="button" size="icon-sm" variant="outline" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Menos"><Minus /></Button>
                      <span className="w-6 text-center tabular-nums">{qty}</span>
                      <Button type="button" size="icon-sm" variant="outline" onClick={() => setQty(Math.min(max, qty + 1))} aria-label="Mais"><Plus /></Button>
                    </div>
                  )}
                  <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Deixe um recado (opcional)" rows={2} maxLength={1000} />
                  <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} className="absolute -left-[9999px] h-0 w-0 opacity-0" aria-hidden />
                  {error && <p className="text-xs text-destructive">{error}</p>}
                  <Button type="submit" variant="outline" className="w-full" disabled={bought.isPending || name.trim().length < 2}>
                    {bought.isPending ? <Loader2 className="animate-spin" /> : <Heart />} Já comprei
                  </Button>
                </div>
              </form>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function GiftDialog({ ident, item, familyName, receiverName, onOpenChange }: { ident: { token?: string; slug?: string }; item: Item | "free" | null; familyName: string | null; receiverName: string | null; onOpenChange: (o: boolean) => void }) {
  const real = item && item !== "free" ? item : null;
  const kind = real?.kind ?? "FREE";
  const [step, setStep] = useState<"choose" | "pay" | "done">("choose");
  const [amount, setAmount] = useState<number | null>(null);
  const [quotas, setQuotas] = useState(1);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [key, setKey] = useState("");
  const [copied, setCopied] = useState(false);
  const pix = trpc.portalGifts.pixCode.useMutation();
  const pledge = trpc.portalGifts.pledge.useMutation();

  useEffect(() => {
    if (!item) return;
    setStep(kind === "ITEM" ? "pay" : "choose");
    setAmount(null);
    setQuotas(1);
    setName(familyName ?? "");
    setMessage("");
    setHoneypot("");
    setKey(crypto.randomUUID());
    setCopied(false);
    pix.reset();
    pledge.reset();
    if (kind === "ITEM" && real) pix.mutate({ ...ident, itemId: real.id });
  }, [item]); // eslint-disable-line react-hooks/exhaustive-deps

  const maxQuotas = real?.quotasLeft ?? 1;
  const total = kind === "QUOTA" ? quotas * (real?.priceCents ?? 0) : kind === "ITEM" ? (real?.priceCents ?? 0) : (amount ?? 0);
  const goPay = () => pix.mutate({ ...ident, itemId: real?.id ?? null, amountCents: kind === "FREE" ? amount : null, quotas: kind === "QUOTA" ? quotas : null }, { onSuccess: () => setStep("pay") });
  const copy = async () => {
    if (!pix.data) return;
    await navigator.clipboard.writeText(pix.data.payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };
  const submit = () =>
    pledge.mutate(
      { ...ident, itemId: real?.id ?? null, amountCents: kind === "FREE" ? amount : null, quotas: kind === "QUOTA" ? quotas : null, giverName: name.trim(), message: message.trim() || null, submissionKey: key, website: honeypot || undefined },
      { onSuccess: () => setStep("done") },
    );

  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl">{real?.title ?? "Presente com valor livre"}</DialogTitle>
          {step !== "done" && <DialogDescription>{receiverName ? `Pix para ${receiverName}` : "Pagamento por Pix"}</DialogDescription>}
        </DialogHeader>

        {step === "choose" && (
          <div className="space-y-5">
            {kind === "QUOTA" ? (
              <div className="text-center">
                <div className="text-sm text-muted-foreground">Quantas cotas?</div>
                <div className="mt-3 flex items-center justify-center gap-4">
                  <Button size="icon" variant="outline" className="rounded-full" aria-label="Menos" disabled={quotas <= 1} onClick={() => setQuotas((q) => q - 1)}><Minus /></Button>
                  <span className="w-10 text-3xl font-semibold tabular-nums">{quotas}</span>
                  <Button size="icon" variant="outline" className="rounded-full" aria-label="Mais" disabled={quotas >= maxQuotas} onClick={() => setQuotas((q) => q + 1)}><Plus /></Button>
                </div>
                <div className="mt-3 text-sm">Total <b className="tabular-nums">{money(total)}</b> <span className="text-muted-foreground">· {maxQuotas} disponível(is)</span></div>
              </div>
            ) : (
              <div>
                <div className="mb-2 text-sm text-muted-foreground">Quanto você quer dar?</div>
                <div className="mb-3 flex flex-wrap gap-2">
                  {[5000, 10000, 20000, 50000].map((v) => (
                    <button key={v} type="button" onClick={() => setAmount(v)} className={cn("rounded-full border px-3 py-1.5 text-sm font-medium tabular-nums transition", amount === v ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary/50")}>{money(v)}</button>
                  ))}
                </div>
                <MoneyInput value={amount} onChange={setAmount} />
              </div>
            )}
            {pix.error && <p className="text-sm text-destructive">{pix.error.message}</p>}
            <Button className="h-11 w-full" disabled={pix.isPending || total < 100} onClick={goPay}>{pix.isPending && <Loader2 className="animate-spin" />} Gerar Pix de {money(total)}</Button>
          </div>
        )}

        {step === "pay" && (
          <div className="space-y-4">
            {!pix.data ? (
              <div className="grid place-items-center py-10">{pix.error ? <p className="text-sm text-destructive">{pix.error.message}</p> : <Loader2 className="size-5 animate-spin text-muted-foreground" />}</div>
            ) : (
              <>
                <div className="flex flex-col items-center gap-2">
                  <QrImage payload={pix.data.payload} size={210} className="border shadow-soft" />
                  <div className="text-2xl font-semibold tabular-nums">{money(pix.data.amountCents)}</div>
                  <p className="text-xs text-muted-foreground">Abra o app do seu banco, escolha Pix → QR Code ou Copia e Cola.</p>
                </div>
                <div className="flex gap-2">
                  <Input readOnly value={pix.data.payload} className="font-mono text-xs" onFocus={(e) => e.target.select()} aria-label="Código Pix copia e cola" />
                  <Button variant={copied ? "secondary" : "outline"} onClick={copy}>{copied ? <><Check /> Copiado</> : <><Copy /> Copiar</>}</Button>
                </div>
                {real?.externalUrl && <a href={real.externalUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1 text-xs text-primary hover:underline"><ExternalLink className="size-3" /> Ver referência do presente</a>}
                <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
                  <div className="text-sm font-medium">Depois de pagar, avise os noivos 💛</div>
                  <Input placeholder="Seu nome" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
                  <Textarea placeholder="Deixe um recado carinhoso (opcional)" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} rows={3} />
                  {/* Campo-isca para robôs: invisível para pessoas */}
                  <input type="text" name="website" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] h-0 w-0 opacity-0" />
                  {pledge.error && <p className="text-sm text-destructive">{pledge.error.data?.httpStatus === 429 ? "Muitas tentativas. Aguarde um pouco." : pledge.error.message}</p>}
                  <Button className="h-11 w-full" disabled={pledge.isPending || name.trim().length < 2} onClick={submit}>{pledge.isPending ? <Loader2 className="animate-spin" /> : <Heart />} Já fiz o Pix</Button>
                  <p className="text-center text-[11px] text-muted-foreground">Os noivos conferem o recebimento. Seu nome e valor não aparecem para outros convidados.</p>
                </div>
              </>
            )}
          </div>
        )}

        {step === "done" && (
          <div className="py-6 text-center">
            <CheckCircle2 className="mx-auto size-12 text-emerald-600 animate-in zoom-in-50" />
            <div className="mt-3 font-heading text-2xl font-semibold">Muito obrigado!</div>
            <p className="mt-2 text-sm text-muted-foreground">Os noivos foram avisados do seu presente. Que alegria ter você com a gente!</p>
            <Button variant="outline" className="mt-5" onClick={() => onOpenChange(false)}>Fechar</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
