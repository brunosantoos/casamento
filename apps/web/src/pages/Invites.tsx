import { Link } from "react-router";
import { Ban, Copy, ExternalLink, Info, MailCheck, MessageCircle, RefreshCw, Search, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog, EmptyState, Field, LoadingButton, PageHeader, QueryState, Section, StatusBadge, TextField } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useMe } from "@/hooks/use-me";
import { dateTime, fromDateInput, relative, toDateInput } from "@/lib/format";
import { RSVP_STATUS } from "@/lib/labels";
import { trpc, type RouterOutputs } from "@/trpc";

type Group = RouterOutputs["guests"]["groups"][number];

function inviteState(g: Group) {
  const inv = g.invitation;
  if (!inv) return { label: "Sem link", tone: "neutral" as const };
  if (inv.respondedAt) return { label: "Respondeu", tone: "emerald" as const };
  if (inv.openedAt) return { label: "Link aberto", tone: "violet" as const };
  if (inv.sentAt) return { label: "Enviado", tone: "sky" as const };
  return { label: "Link gerado", tone: "amber" as const };
}

function FamilyRow({ g }: { g: Group }) {
  const { can } = useMe();
  const utils = trpc.useUtils();
  const [confirm, setConfirm] = useState<"regen" | "revoke" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const invalidate = () => utils.guests.invalidate();
  const regen = trpc.guests.regenerateLink.useMutation({
    onSuccess: async (r) => { await navigator.clipboard.writeText(r.url).catch(() => undefined); toast.success("Novo link gerado e copiado. O anterior deixou de funcionar."); setConfirm(null); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const revoke = trpc.guests.revokeLink.useMutation({ onSuccess: () => { toast.success("Link revogado"); setConfirm(null); invalidate(); }, onError: (e) => toast.error(e.message) });
  const markSent = trpc.guests.markInviteSent.useMutation({ onSuccess: () => { toast.success("Marcado como enviado"); invalidate(); }, onError: (e) => toast.error(e.message) });

  async function getLink() {
    const r = await utils.guests.invitationLink.fetch({ groupId: g.id });
    void utils.guests.groups.invalidate();
    return r.url;
  }
  async function copy() {
    setBusy("copy");
    try {
      const url = await getLink();
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function share() {
    setBusy("wa");
    // Abre a janela já (bloqueadores de pop-up) e preenche depois
    const win = window.open("about:blank", "_blank");
    try {
      const url = await getLink();
      const text = `Olá! Confirme a presença de ${g.name} no nosso casamento por este link: ${url}`;
      const phone = g.contactPhone?.replace(/\D/g, "") ?? "";
      const href = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
      if (win) win.location.href = href;
      else window.open(href, "_blank");
    } catch (e) {
      win?.close();
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const st = inviteState(g);
  const accepted = g.guests.filter((x) => x.rsvpStatus === "ACCEPTED").length;
  const pending = g.guests.filter((x) => x.rsvpStatus === "PENDING").length;
  const notSent = g.guests.some((x) => x.inviteStatus === "NOT_SENT");
  return (
    <li className="flex flex-col gap-3 p-3 md:flex-row md:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{g.name}</span>
          <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
        </div>
        <div className="text-xs text-muted-foreground">
          {g.guests.length} pessoa(s) · {accepted} confirmada(s) · {pending} sem resposta · {g.confirmedPeople} pessoa(s) no total
          {g.invitation?.expiresAt && ` · expira ${relative(g.invitation.expiresAt)}`}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <LoadingButton size="sm" variant="outline" loading={busy === "copy"} onClick={copy}><Copy /> Copiar link</LoadingButton>
        <LoadingButton size="sm" variant="outline" loading={busy === "wa"} onClick={share}><MessageCircle /> WhatsApp</LoadingButton>
        {can("rsvp:edit") && notSent && <LoadingButton size="sm" variant="ghost" loading={markSent.isPending} onClick={() => markSent.mutate({ groupId: g.id, channel: "manual" })}><MailCheck /> Marcar enviado</LoadingButton>}
        {can("rsvp:edit") && <Button size="sm" variant="ghost" onClick={() => setConfirm("regen")}><RefreshCw /> Novo link</Button>}
        {can("rsvp:edit") && g.invitation && <Button size="sm" variant="ghost" onClick={() => setConfirm("revoke")}><Ban /> Revogar</Button>}
      </div>
      <ConfirmDialog open={confirm === "regen"} onOpenChange={(o) => !o && setConfirm(null)} title="Gerar novo link?" description="O link atual deixará de funcionar imediatamente. Envie o novo link à família." confirmLabel="Gerar novo link" loading={regen.isPending} onConfirm={() => regen.mutate({ groupId: g.id })} />
      <ConfirmDialog open={confirm === "revoke"} onOpenChange={(o) => !o && setConfirm(null)} title="Revogar link?" description="A família não conseguirá mais responder por este link até que um novo seja gerado." destructive confirmLabel="Revogar" loading={revoke.isPending} onConfirm={() => revoke.mutate({ groupId: g.id })} />
    </li>
  );
}

type PortalForm = {
  portalEnabled: boolean; portalSlug: string; rsvpDeadline: string;
  title: string; welcome: string; arrivalInfo: string; dressCode: string; mapUrl: string; giftInfo: string; giftUrl: string; closingMessage: string; accentColor: string; extraInfo: string; showCeremony: boolean; showReception: boolean;
};

function PortalSettings() {
  const w = trpc.wedding.get.useQuery();
  const [open, setOpen] = useState(false);
  return (
    <Section
      title="Portal dos convidados"
      description="Página pública com as informações do evento. A confirmação é feita pelo link pessoal de cada família."
      actions={<Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={!w.data}>Configurar</Button>}
    >
      <QueryState query={w}>
        {(d) => {
          const cfg = (d.portalConfig ?? {}) as Record<string, unknown>;
          return (
            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={d.portalEnabled ? "emerald" : "neutral"}>{d.portalEnabled ? "Página pública ativa" : "Página pública desativada"}</StatusBadge>
                {d.portalEnabled && d.portalSlug && <a className="inline-flex items-center gap-1 text-primary hover:underline" href={`/p/${d.portalSlug}`} target="_blank" rel="noreferrer">/p/{d.portalSlug} <ExternalLink className="size-3" /></a>}
              </div>
              <div className="text-muted-foreground">Prazo de confirmação: {d.rsvpDeadline ? dateTime(d.rsvpDeadline) : "não definido"}</div>
              {typeof cfg.title === "string" && cfg.title && <div>Título: {cfg.title}</div>}
              {open && <PortalDialog key="portal" w={d} onClose={() => setOpen(false)} />}
            </div>
          );
        }}
      </QueryState>
    </Section>
  );
}

function PortalDialog({ w, onClose }: { w: RouterOutputs["wedding"]["get"]; onClose: () => void }) {
  const { can } = useMe();
  const cfg = (w.portalConfig ?? {}) as Partial<Record<keyof PortalForm, string | boolean>>;
  const s = (k: keyof PortalForm) => (typeof cfg[k] === "string" ? (cfg[k] as string) : "");
  const [f, setF] = useState<PortalForm>({
    portalEnabled: w.portalEnabled, portalSlug: w.portalSlug ?? "", rsvpDeadline: toDateInput(w.rsvpDeadline),
    title: s("title"), welcome: s("welcome"), arrivalInfo: s("arrivalInfo"), dressCode: s("dressCode"), mapUrl: s("mapUrl"), giftInfo: s("giftInfo"), giftUrl: s("giftUrl"),
    closingMessage: s("closingMessage"), accentColor: s("accentColor") || "#6b1d2f", extraInfo: s("extraInfo"), showCeremony: cfg.showCeremony !== false, showReception: cfg.showReception !== false,
  });
  const [err, setErr] = useState<Record<string, string>>({});
  const utils = trpc.useUtils();
  const save = trpc.wedding.updatePortal.useMutation({
    onSuccess: async () => { toast.success("Portal atualizado"); await utils.wedding.invalidate(); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  const set = <K extends keyof PortalForm>(k: K, v: PortalForm[K]) => setF((x) => ({ ...x, [k]: v }));

  function submit() {
    const e: Record<string, string> = {};
    if (f.portalSlug && !/^[a-z0-9-]{3,60}$/.test(f.portalSlug)) e.portalSlug = "Use 3 a 60 letras minúsculas, números e hífens";
    if (f.portalEnabled && !f.portalSlug) e.portalSlug = "Defina o endereço para ativar a página";
    for (const k of ["mapUrl", "giftUrl"] as const) if (f[k] && !/^https?:\/\/\S+$/.test(f[k])) e[k] = "URL inválida (comece com https://)";
    setErr(e);
    if (Object.keys(e).length) return;
    const deadline = fromDateInput(f.rsvpDeadline);
    if (deadline) deadline.setHours(23, 59, 0, 0);
    save.mutate({
      portalEnabled: f.portalEnabled, portalSlug: f.portalSlug || null, rsvpDeadline: deadline,
      portalConfig: {
        title: f.title, welcome: f.welcome, arrivalInfo: f.arrivalInfo, dressCode: f.dressCode, mapUrl: f.mapUrl, giftInfo: f.giftInfo, giftUrl: f.giftUrl,
        closingMessage: f.closingMessage, accentColor: f.accentColor, extraInfo: f.extraInfo, showCeremony: f.showCeremony, showReception: f.showReception,
      },
    });
  }

  const readOnly = !can("rsvp:edit");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Portal dos convidados</DialogTitle>
          <DialogDescription>Nunca são exibidos lista de convidados, telefones, valores ou documentos.</DialogDescription>
        </DialogHeader>
        <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><Switch checked={f.portalEnabled} onCheckedChange={(v) => set("portalEnabled", v)} /> Página pública informativa ativa</label>
          <Field label="Endereço da página" error={err.portalSlug} hint={f.portalSlug ? `${window.location.origin}/p/${f.portalSlug}` : undefined}>
            <Input value={f.portalSlug} onChange={(e) => set("portalSlug", e.target.value.toLowerCase())} placeholder="ana-e-joao" />
          </Field>
          <Field label="Prazo para confirmar" hint="Depois disso o formulário fica somente leitura"><Input type="date" value={f.rsvpDeadline} onChange={(e) => set("rsvpDeadline", e.target.value)} /></Field>
          <TextField label="Título" value={f.title} onChange={(v) => set("title", v)} className="sm:col-span-2" placeholder="Vamos casar!" />
          <TextField label="Mensagem de boas-vindas" value={f.welcome} onChange={(v) => set("welcome", v)} multiline className="sm:col-span-2" />
          <TextField label="Orientações de chegada" value={f.arrivalInfo} onChange={(v) => set("arrivalInfo", v)} multiline />
          <TextField label="Traje" value={f.dressCode} onChange={(v) => set("dressCode", v)} />
          <TextField label="Link do mapa" value={f.mapUrl} onChange={(v) => set("mapUrl", v)} error={err.mapUrl} placeholder="https://maps.google.com/…" />
          <Field label="Cor de destaque"><Input type="color" className="h-9 w-24 p-1" value={f.accentColor} onChange={(e) => set("accentColor", e.target.value)} /></Field>
          <TextField label="Lista de presentes / informações" value={f.giftInfo} onChange={(v) => set("giftInfo", v)} multiline />
          <TextField label="Link da lista de presentes" value={f.giftUrl} onChange={(v) => set("giftUrl", v)} error={err.giftUrl} />
          <TextField label="Informações adicionais" value={f.extraInfo} onChange={(v) => set("extraInfo", v)} multiline />
          <TextField label="Mensagem após confirmar" value={f.closingMessage} onChange={(v) => set("closingMessage", v)} multiline />
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.showCeremony} onCheckedChange={(v) => set("showCeremony", !!v)} /> Mostrar endereço da cerimônia</label>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.showReception} onCheckedChange={(v) => set("showReception", !!v)} /> Mostrar endereço da recepção</label>
        </fieldset>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
          {!readOnly && <LoadingButton loading={save.isPending} onClick={submit}>Salvar</LoadingButton>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function InvitesPage() {
  const groups = trpc.guests.groups.useQuery();
  const recent = trpc.guests.recentRsvps.useQuery({ limit: 30 });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "nolink" | "notresponded" | "responded">("all");
  const list = (groups.data ?? []).filter((g) => {
    if (search && !g.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === "nolink") return !g.invitation;
    if (filter === "notresponded") return !g.invitation?.respondedAt && g.guests.some((x) => x.rsvpStatus === "PENDING");
    if (filter === "responded") return !!g.invitation?.respondedAt;
    return true;
  });

  return (
    <>
      <PageHeader title="Convites e confirmações" description="Links de confirmação por família, envio manual e acompanhamento das respostas." actions={<Button asChild variant="outline"><Link to="/whatsapp"><Send /> Enviar pelo WhatsApp</Link></Button>} />
      <div className="mb-5 flex items-start gap-3 rounded-xl border border-sky-500/25 bg-sky-500/5 p-4 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-sky-600" />
        <p>Cada família recebe um link com identificador aleatório e imprevisível, válido pelo prazo configurado. Gerar um novo link revoga o anterior; o convidado só vê e altera as pessoas da própria família.</p>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Section title="Famílias">
            <div className="mb-3 flex flex-wrap gap-2">
              <div className="relative min-w-48 flex-1">
                <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-8" placeholder="Buscar família" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="inline-flex flex-wrap rounded-lg border p-0.5 text-sm">
                {([["all", "Todas"], ["nolink", "Sem link"], ["notresponded", "Sem resposta"], ["responded", "Responderam"]] as const).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setFilter(k)} className={`rounded-md px-2.5 py-1 font-medium ${filter === k ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{l}</button>
                ))}
              </div>
            </div>
            <QueryState query={groups} empty={(d) => (!d.length ? <EmptyState icon={<Send />} title="Nenhuma família" description="Cadastre convidados para gerar os convites." action={<Button asChild><Link to="/convidados">Ir para convidados</Link></Button>} /> : null)}>
              {() => (list.length ? <ul className="divide-y rounded-xl border">{list.map((g) => <FamilyRow key={g.id} g={g} />)}</ul> : <p className="text-sm text-muted-foreground">Nenhuma família neste filtro.</p>)}
            </QueryState>
          </Section>
        </div>
        <div className="space-y-5">
          <PortalSettings />
          <Section title="Respostas recentes">
            <QueryState query={recent} empty={(d) => (!d.length ? <p className="text-sm text-muted-foreground">Nenhuma resposta ainda.</p> : null)}>
              {(d) => (
                <ul className="space-y-2">
                  {d.map((r) => (
                    <li key={r.id} className="text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">{r.guest.fullName}</span>
                        <StatusBadge tone={RSVP_STATUS[r.status]?.tone}>{RSVP_STATUS[r.status]?.label}</StatusBadge>
                      </div>
                      <div className="text-xs text-muted-foreground">{r.guest.group.name} · {relative(r.createdAt)} · {r.source === "PORTAL" ? "portal" : r.source === "WHATSAPP" ? "WhatsApp" : "equipe"}{r.companions ? ` · +${r.companions}` : ""}</div>
                      {r.message && <div className="mt-0.5 text-xs italic">“{r.message}”</div>}
                    </li>
                  ))}
                </ul>
              )}
            </QueryState>
          </Section>
        </div>
      </div>
    </>
  );
}
