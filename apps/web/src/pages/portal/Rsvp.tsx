import { TRPCClientError } from "@trpc/client";
import { Countdown } from "./Countdown";
import { GiftsSection } from "./GiftsSection";
import { PhotosSection } from "./PhotosSection";
import { CalendarHeart, CheckCircle2, Gift, Loader2, MapPin, Plus, Shirt, Trash2 } from "lucide-react";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { trpc, type RouterOutputs } from "@/trpc";

// ───────────── Visual compartilhado do portal (também usado em /p/:slug) ─────────────

type PortalWedding = {
  partner1Name: string; partner2Name: string; date: Date | null; timezone: string; city: string | null; ceremonyAddress: string | null; receptionAddress: string | null;
  rsvpDeadline: Date | null; config: Record<string, unknown>;
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

export function portalError(e: unknown) {
  if (e instanceof TRPCClientError) {
    const status = (e.meta as { response?: Response } | undefined)?.response?.status ?? e.data?.httpStatus;
    if (status === 429) return "Muitas tentativas em pouco tempo. Aguarde um minuto e tente novamente.";
    return e.message;
  }
  return "Não foi possível carregar. Verifique sua conexão.";
}

export function PortalShell({ accent, children }: { accent?: string | null; children: ReactNode }) {
  const style = accent ? ({ "--primary": accent, "--ring": accent } as CSSProperties) : undefined;
  return (
    <div style={style} className="min-h-dvh bg-[oklch(0.985_0.012_85)] text-[oklch(0.24_0.03_15)]">
      <div className="bg-glow min-h-dvh">
        <div className="mx-auto max-w-2xl px-5 py-10 md:py-16">{children}</div>
      </div>
    </div>
  );
}

export function PortalMessage({ title, text }: { title: string; text: string }) {
  return (
    <PortalShell>
      <div className="py-24 text-center">
        <CalendarHeart className="mx-auto mb-4 size-10 text-primary" />
        <h1 className="font-heading text-4xl font-semibold">{title}</h1>
        <p className="mx-auto mt-3 max-w-sm text-[oklch(0.45_0.03_30)]">{text}</p>
      </div>
    </PortalShell>
  );
}

function fmtWhen(date: Date | null, tz: string) {
  if (!date) return null;
  const d = new Date(date);
  return {
    day: new Intl.DateTimeFormat("pt-BR", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d),
    time: new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(d),
  };
}

const mapLink = (addr: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;

export type PortalPhotos = { cover: string | null; coverPosition: string; partner1: string | null; partner2: string | null; gallery: { id: string; url: string }[] };

function CouplePortrait({ url, name }: { url: string | null; name: string }) {
  if (!url) return null;
  return <img src={url} alt={name} className="size-20 rounded-full border-4 border-white object-cover shadow-lg md:size-24" />;
}

/** Galeria com rolagem horizontal e visualização ampliada */
function PortalGallery({ items }: { items: PortalPhotos["gallery"] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!items.length) return null;
  return (
    <section className="mt-10">
      <div className="-mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-2 scrollbar-none">
        {items.map((g, i) => (
          <button key={g.id} type="button" onClick={() => setOpen(i)} className="group relative aspect-[3/4] w-40 shrink-0 snap-start overflow-hidden rounded-xl shadow-soft md:w-48">
            <img src={g.url} alt="" loading="lazy" className="size-full object-cover transition duration-500 group-hover:scale-105" />
          </button>
        ))}
      </div>
      {open != null && (
        <div role="dialog" aria-modal className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-4 animate-in fade-in" onClick={() => setOpen(null)}>
          <img src={items[open]!.url} alt="" className="max-h-[85dvh] max-w-full rounded-lg object-contain shadow-2xl" />
          <div className="absolute inset-x-0 bottom-6 flex justify-center gap-2" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="rounded-full bg-white/15 px-4 py-2 text-sm text-white backdrop-blur hover:bg-white/25" onClick={() => setOpen((open - 1 + items.length) % items.length)}>Anterior</button>
            <button type="button" className="rounded-full bg-white/15 px-4 py-2 text-sm text-white backdrop-blur hover:bg-white/25" onClick={() => setOpen(null)}>Fechar</button>
            <button type="button" className="rounded-full bg-white/15 px-4 py-2 text-sm text-white backdrop-blur hover:bg-white/25" onClick={() => setOpen((open + 1) % items.length)}>Próxima</button>
          </div>
        </div>
      )}
    </section>
  );
}

export function WeddingInfo({ w, photos }: { w: PortalWedding; photos?: PortalPhotos | null }) {
  const cfg = w.config;
  const when = fmtWhen(w.date, w.timezone);
  const mapUrl = str(cfg.mapUrl);
  const portraits = !!(photos?.partner1 || photos?.partner2);
  return (
    <>
      {photos?.cover && (
        <div className="relative -mx-5 -mt-10 mb-14 md:mx-0 md:mt-0">
          <div className="aspect-[4/3] overflow-hidden md:aspect-[16/9] md:rounded-2xl">
            <img src={photos.cover} alt={`${w.partner1Name} e ${w.partner2Name}`} className="size-full object-cover animate-in fade-in zoom-in-105 duration-1000" style={{ objectPosition: photos.coverPosition }} />
          </div>
          {portraits && (
            <div className="absolute inset-x-0 -bottom-10 flex justify-center -space-x-4">
              <CouplePortrait url={photos.partner1} name={w.partner1Name} />
              <CouplePortrait url={photos.partner2} name={w.partner2Name} />
            </div>
          )}
        </div>
      )}
      {!photos?.cover && portraits && (
        <div className="mb-6 flex justify-center -space-x-4">
          <CouplePortrait url={photos!.partner1} name={w.partner1Name} />
          <CouplePortrait url={photos!.partner2} name={w.partner2Name} />
        </div>
      )}
      <header className="text-center">
        <div className="text-xs font-medium tracking-[0.25em] text-primary uppercase">{str(cfg.title) ?? "Vamos nos casar"}</div>
        <h1 className="mt-3 font-heading text-5xl leading-tight font-semibold md:text-6xl">
          {w.partner1Name} <span className="text-[oklch(0.7_0.11_80)]">&</span> {w.partner2Name}
        </h1>
        {when && <p className="mt-3 text-lg capitalize">{when.day} · {when.time}</p>}
        {w.city && <p className="text-sm text-[oklch(0.45_0.03_30)]">{w.city}</p>}
        <div className="mx-auto mt-6 h-px w-24 bg-[oklch(0.74_0.11_80)]" />
      </header>
      {w.date && <Countdown date={w.date} timezone={w.timezone} />}
      <PortalGallery items={photos?.gallery ?? []} />
      {str(cfg.welcome) && <p className="mt-8 text-center text-[17px] leading-relaxed whitespace-pre-wrap">{str(cfg.welcome)}</p>}
      <div className="mt-8 grid gap-3">
        {w.ceremonyAddress && <InfoCard icon={<MapPin />} title="Cerimônia" body={w.ceremonyAddress} link={{ href: mapUrl ?? mapLink(w.ceremonyAddress), label: "Ver no mapa" }} />}
        {w.receptionAddress && <InfoCard icon={<MapPin />} title="Recepção" body={w.receptionAddress} link={{ href: mapLink(w.receptionAddress), label: "Ver no mapa" }} />}
        {!w.ceremonyAddress && !w.receptionAddress && mapUrl && <InfoCard icon={<MapPin />} title="Local" body="" link={{ href: mapUrl, label: "Ver no mapa" }} />}
        {str(cfg.arrivalInfo) && <InfoCard icon={<CalendarHeart />} title="Como chegar" body={str(cfg.arrivalInfo)!} />}
        {str(cfg.dressCode) && <InfoCard icon={<Shirt />} title="Traje" body={str(cfg.dressCode)!} />}
        {(str(cfg.giftInfo) || str(cfg.giftUrl)) && <InfoCard icon={<Gift />} title="Presentes" body={str(cfg.giftInfo) ?? ""} link={str(cfg.giftUrl) ? { href: str(cfg.giftUrl)!, label: "Abrir lista de presentes" } : undefined} />}
        {str(cfg.extraInfo) && <InfoCard icon={<CalendarHeart />} title="Informações" body={str(cfg.extraInfo)!} />}
      </div>
    </>
  );
}

function InfoCard({ icon, title, body, link }: { icon: ReactNode; title: string; body: string; link?: { href: string; label: string } }) {
  return (
    <div className="flex gap-3 rounded-xl border border-[oklch(0.9_0.014_70)] bg-white/80 p-4 shadow-soft">
      <span className="mt-0.5 text-primary [&_svg]:size-5">{icon}</span>
      <div className="min-w-0">
        <div className="font-heading text-xl font-semibold">{title}</div>
        {body && <p className="text-sm whitespace-pre-wrap text-[oklch(0.4_0.03_30)]">{body}</p>}
        {link && <a href={link.href} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">{link.label}</a>}
      </div>
    </div>
  );
}

// ───────────── Formulário de confirmação ─────────────

type View = RouterOutputs["portal"]["view"];
type Answer = { status: "ACCEPTED" | "DECLINED" | null; dietary: string; companions: { name: string; isChild: boolean; dietary: string }[] };

function initialAnswers(v: View): Record<string, Answer> {
  return Object.fromEntries(
    v.guests.map((g) => [g.id, {
      status: g.rsvpStatus === "PENDING" ? null : (g.rsvpStatus as "ACCEPTED" | "DECLINED"),
      dietary: g.dietary ?? "",
      companions: g.companions.filter((c) => c.attending).map((c) => ({ name: c.name ?? "", isChild: c.isChild, dietary: c.dietary ?? "" })),
    }]),
  );
}

function RsvpForm({ token, view, onDone }: { token: string; view: View; onDone: (summary: { accepted: number; declined: number; companions: number }) => void }) {
  const [answers, setAnswers] = useState(() => initialAnswers(view));
  const [message, setMessage] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Uma chave por montagem do formulário: reenvio acidental não grava duas vezes
  const submissionKey = useMemo(() => crypto.randomUUID(), []);
  const submit = trpc.portal.submit.useMutation();
  const readOnly = view.deadlinePassed;

  const setA = (id: string, patch: Partial<Answer>) => setAnswers((a) => ({ ...a, [id]: { ...a[id]!, ...patch } }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const responses = view.guests.filter((g) => answers[g.id]?.status).map((g) => {
      const a = answers[g.id]!;
      return {
        guestId: g.id, status: a.status!, dietary: a.dietary.trim() || null,
        companions: a.status === "ACCEPTED" ? a.companions.slice(0, g.plusOnesAllowed).map((c) => ({ name: c.name.trim() || null, isChild: c.isChild, dietary: c.dietary.trim() || null })) : [],
      };
    });
    if (!responses.length) return setError("Indique se cada pessoa vai ou não.");
    try {
      await submit.mutateAsync({ token, submissionKey, message: message.trim() || null, responses, ...(honeypot ? { website: honeypot } : {}) });
      onDone({
        accepted: responses.filter((r) => r.status === "ACCEPTED").length,
        declined: responses.filter((r) => r.status === "DECLINED").length,
        companions: responses.reduce((n, r) => n + r.companions.length, 0),
      });
    } catch (err) {
      setError(portalError(err));
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-10 rounded-xl border border-[oklch(0.9_0.014_70)] bg-white/90 p-5 shadow-soft md:p-7">
      <h2 className="font-heading text-3xl font-semibold">Confirmação de presença</h2>
      <p className="mt-1 text-sm text-[oklch(0.45_0.03_30)]">
        Convite para <b>{view.group.name}</b>
        {view.wedding.rsvpDeadline && <> · responda até {new Date(view.wedding.rsvpDeadline).toLocaleDateString("pt-BR", { timeZone: view.wedding.timezone })}</>}
      </p>
      {readOnly && <p className="mt-4 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-800">O prazo de confirmação terminou. Para alterar sua resposta, fale diretamente com os noivos.</p>}
      {view.respondedAt && !readOnly && <p className="mt-4 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-800">Já recebemos sua resposta. Você pode alterá-la abaixo até o prazo.</p>}

      {/* Campo-isca: invisível para pessoas */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Site<input name="website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} /></label>
      </div>

      <fieldset disabled={readOnly || submit.isPending} className="mt-6 space-y-5">
        {view.guests.map((g) => {
          const a = answers[g.id]!;
          return (
            <div key={g.id} className="rounded-xl border border-[oklch(0.9_0.014_70)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="font-medium">{g.fullName}{g.isChild && <span className="ml-1 text-xs text-[oklch(0.5_0.03_30)]">(criança)</span>}</div>
                <div className="flex gap-2" role="radiogroup" aria-label={`Resposta de ${g.fullName}`}>
                  {(["ACCEPTED", "DECLINED"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={a.status === s}
                      onClick={() => setA(g.id, { status: s })}
                      className={cn(
                        "rounded-full border px-4 py-1.5 text-sm font-medium transition",
                        a.status === s ? (s === "ACCEPTED" ? "border-primary bg-primary text-white" : "border-[oklch(0.5_0.03_30)] bg-[oklch(0.5_0.03_30)] text-white") : "border-[oklch(0.88_0.016_70)] bg-white hover:border-primary/50",
                      )}
                    >
                      {s === "ACCEPTED" ? "Vou" : "Não vou"}
                    </button>
                  ))}
                </div>
              </div>
              {a.status === "ACCEPTED" && (
                <div className="mt-3 space-y-3">
                  <Input className="bg-white" placeholder="Restrição alimentar (opcional)" value={a.dietary} onChange={(e) => setA(g.id, { dietary: e.target.value })} maxLength={500} />
                  {g.plusOnesAllowed > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs text-[oklch(0.45_0.03_30)]">Acompanhantes ({a.companions.length} de até {g.plusOnesAllowed})</div>
                      {a.companions.map((c, i) => (
                        <div key={i} className="grid gap-2 rounded-xl bg-[oklch(0.97_0.01_80)] p-2 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-center">
                          <Input className="bg-white" placeholder="Nome do acompanhante" value={c.name} maxLength={120} onChange={(e) => setA(g.id, { companions: a.companions.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)) })} />
                          <Input className="bg-white" placeholder="Restrição alimentar" value={c.dietary} maxLength={300} onChange={(e) => setA(g.id, { companions: a.companions.map((x, k) => (k === i ? { ...x, dietary: e.target.value } : x)) })} />
                          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={c.isChild} onChange={(e) => setA(g.id, { companions: a.companions.map((x, k) => (k === i ? { ...x, isChild: e.target.checked } : x)) })} /> Criança</label>
                          <Button type="button" size="icon-sm" variant="ghost" aria-label="Remover acompanhante" onClick={() => setA(g.id, { companions: a.companions.filter((_, k) => k !== i) })}><Trash2 /></Button>
                        </div>
                      ))}
                      {a.companions.length < g.plusOnesAllowed && (
                        <Button type="button" size="sm" variant="outline" className="bg-white" onClick={() => setA(g.id, { companions: [...a.companions, { name: "", isChild: false, dietary: "" }] })}><Plus /> Adicionar acompanhante</Button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <Textarea className="bg-white" rows={3} maxLength={1000} placeholder="Deixe um recado para os noivos (opcional)" value={message} onChange={(e) => setMessage(e.target.value)} />
      </fieldset>
      {error && <p role="alert" className="mt-4 rounded-xl bg-rose-500/10 p-3 text-sm text-rose-700">{error}</p>}
      {!readOnly && (
        <Button type="submit" className="mt-5 h-12 w-full text-base" disabled={submit.isPending}>
          {submit.isPending && <Loader2 className="animate-spin" />} Enviar resposta
        </Button>
      )}
    </form>
  );
}

export function RsvpPage() {
  const { token = "" } = useParams();
  const view = trpc.portal.view.useQuery({ token }, { retry: false, refetchOnWindowFocus: false });
  const utils = trpc.useUtils();
  const [done, setDone] = useState<{ accepted: number; declined: number; companions: number } | null>(null);
  const [formKey, setFormKey] = useState(0);
  // Mesma consulta usada pela seção de presentes (fica em cache): decide se mostra os atalhos
  const gifts = trpc.portalGifts.list.useQuery({ token }, { enabled: !!token, retry: false, staleTime: 60_000 });
  const hasGifts = !!(gifts.data && gifts.data.enabled && gifts.data.items.length);

  if (view.isLoading) return <PortalShell><div className="grid place-items-center py-32"><Loader2 className="size-6 animate-spin text-primary" /></div></PortalShell>;
  if (view.error || !view.data) return <PortalMessage title="Convite indisponível" text={view.error ? portalError(view.error) : "Link inválido."} />;
  const v = view.data;
  const accent = str(v.wedding.config.accentColor);

  const goTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <PortalShell accent={accent}>
      <WeddingInfo w={v.wedding} photos={v.photos} />
      {/* Atalhos: confirmar e presentear */}
      <nav className="sticky top-3 z-20 mx-auto mt-8 flex w-fit gap-1 rounded-full border border-[oklch(0.9_0.014_70)] bg-white/85 p-1 shadow-soft backdrop-blur">
        <button type="button" onClick={() => goTo("confirmar")} className="flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition hover:bg-primary/10"><CalendarHeart className="size-4 text-primary" /> Confirmar presença</button>
        {hasGifts && <button type="button" onClick={() => goTo("presentes")} className="flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition hover:bg-primary/10"><Gift className="size-4 text-primary" /> Presentes</button>}
      </nav>
      <section id="confirmar" className="scroll-mt-20">
        {done ? (
          <div className="mt-10 rounded-xl border border-[oklch(0.9_0.014_70)] bg-white/90 p-6 text-center shadow-soft animate-in fade-in zoom-in-95">
            <CheckCircle2 className="mx-auto size-10 text-emerald-600" />
            <h2 className="mt-3 font-heading text-3xl font-semibold">Resposta registrada!</h2>
            <p className="mt-2 text-sm">
              {done.accepted} confirmado(s){done.companions ? ` + ${done.companions} acompanhante(s)` : ""}{done.declined ? ` · ${done.declined} não poderá(ão) ir` : ""}.
            </p>
            <p className="mx-auto mt-4 max-w-md whitespace-pre-wrap">{str(v.wedding.config.closingMessage) ?? "Obrigado por responder! Mal podemos esperar para celebrar com você."}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {hasGifts && <Button onClick={() => goTo("presentes")}><Gift /> Ver lista de presentes</Button>}
              {!v.deadlinePassed && (
                <Button variant="outline" className="bg-white" onClick={async () => { await utils.portal.view.invalidate(); setDone(null); setFormKey((k) => k + 1); }}>Alterar resposta</Button>
              )}
            </div>
          </div>
        ) : (
          <RsvpForm key={formKey} token={token} view={v} onDone={(d) => { setDone(d); setTimeout(() => goTo("confirmar"), 50); }} />
        )}
      </section>
      <GiftsSection token={token} />
      <PhotosSection token={token} />
      <p className="mt-10 text-center text-xs text-[oklch(0.55_0.02_30)]">Este link é pessoal. Seus dados são usados apenas para a organização do casamento.</p>
    </PortalShell>
  );
}
