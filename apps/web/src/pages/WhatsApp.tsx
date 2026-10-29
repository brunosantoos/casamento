import { CheckCircle2, Eye, Inbox, Link2, Loader2, MessageCircle, Pencil, Plug, PlugZap, Plus, QrCode, RefreshCw, RotateCcw, Search, Send, Trash2, Unplug, Users, XCircle } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog, EmptyState, Field, LoadingButton, PageHeader, PageLoader, QueryState, Section, StatusBadge, TextField, errorMessage, PhoneField } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useMe } from "@/hooks/use-me";
import { dateTime, formatPhone, newKey, relative } from "@/lib/format";
import { CAMPAIGN_STATUS, INVITE_STATUS, MESSAGE_STATUS, RSVP_STATUS, SIDE } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { trpc, type RouterInputs } from "@/trpc";

const VARS = ["nome", "familia", "link", "data", "noivos", "local"] as const;
const PURPOSE: Record<string, string> = { INVITE: "Convite", REMINDER: "Lembrete", INFO: "Informações", VENDOR: "Fornecedor", TASK: "Tarefa", OTHER: "Outro" };
const STATE: Record<string, { label: string; tone: "emerald" | "amber" | "rose" }> = { OPEN: { label: "Conectado", tone: "emerald" }, CONNECTING: { label: "Aguardando leitura do QR", tone: "amber" }, CLOSED: { label: "Desconectado", tone: "rose" } };
const STATUS_HINT: Record<string, string> = {
  PENDING: "Na fila do sistema; será enviada respeitando o horário permitido e o intervalo mínimo.",
  SENDING: "Sendo enviada agora.",
  ACCEPTED: "A Evolution aceitou a mensagem. Isso NÃO garante que foi entregue no aparelho.",
  DELIVERED: "Entregue no aparelho do destinatário (confirmado pelo WhatsApp).",
  READ: "Lida pelo destinatário.",
  REPLIED: "O destinatário respondeu.",
  FAILED: "Falhou após as tentativas. Veja o erro e reprocesse se fizer sentido.",
  CANCELLED: "Cancelada antes do envio.",
};

type Criteria = RouterInputs["whatsapp"]["preview"]["criteria"];

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={cn("rounded-full border px-3 py-1 text-xs font-medium transition", active ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary/50")}>
      {children}
    </button>
  );
}

function VarChips({ onInsert }: { onInsert: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {VARS.map((v) => (
        <button key={v} type="button" onClick={() => onInsert(`{{${v}}}`)} className="rounded-md border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] hover:border-primary">
          {`{{${v}}}`}
        </button>
      ))}
    </div>
  );
}

// ───────────── Conexão ─────────────

function ConnectionTab() {
  const { can } = useMe();
  const utils = trpc.useUtils();
  const [qr, setQr] = useState<{ qr: string | null; pairingCode: string | null } | null>(null);
  const status = trpc.whatsapp.status.useQuery(undefined, { refetchInterval: (q) => (q.state.data?.instance?.state === "CONNECTING" || qr ? 3000 : 30_000) });
  const connect = trpc.whatsapp.connect.useMutation({ onSuccess: (r) => { setQr(r); utils.whatsapp.status.invalidate(); }, onError: (e) => toast.error(e.message) });
  const [confirmOff, setConfirmOff] = useState(false);
  const disconnect = trpc.whatsapp.disconnect.useMutation({ onSuccess: () => { toast.success("WhatsApp desconectado"); setConfirmOff(false); setQr(null); utils.whatsapp.status.invalidate(); }, onError: (e) => toast.error(e.message) });
  const test = trpc.whatsapp.testConnection.useMutation({
    onSuccess: (r) => (r.ok ? toast.success(`Evolution respondeu${r.version ? ` (versão ${r.version})` : ""}`) : toast.error(`Falha: ${r.error}`)),
    onError: (e) => toast.error(e.message),
  });
  const events = trpc.whatsapp.webhookEvents.useQuery(undefined, { enabled: can("integrations:view"), refetchInterval: 15_000 });

  const state = status.data?.instance?.state;
  useEffect(() => {
    if (state === "OPEN" && qr) {
      setQr(null);
      toast.success("WhatsApp conectado!");
    }
  }, [state, qr]);

  return (
    <div className="space-y-5">
      <QueryState query={status}>
        {(s) =>
          !s.configured ? (
            <EmptyState icon={<Plug />} title="Evolution API não configurada" description="Cadastre a URL da sua Evolution API e a chave de acesso em Configurações → Integrações. A chave fica cifrada no servidor." action={<Button asChild><Link to="/configuracoes?aba=integracoes">Configurar integração</Link></Button>} />
          ) : (
            <Section
              title="Conexão do WhatsApp"
              description="Número usado para enviar convites, lembretes e mensagens."
              actions={
                <>
                  {can("integrations:edit") && <LoadingButton variant="outline" size="sm" loading={test.isPending} onClick={() => test.mutate()}><PlugZap /> Testar conexão</LoadingButton>}
                  <Button variant="ghost" size="sm" onClick={() => status.refetch()}><RefreshCw /> Atualizar</Button>
                </>
              }
            >
              <div className="flex flex-wrap items-center gap-4">
                <div className="grid size-12 place-items-center rounded-xl bg-muted"><MessageCircle className={cn("size-6", state === "OPEN" ? "text-emerald-600" : "text-muted-foreground")} /></div>
                <div className="min-w-0 flex-1">
                  <StatusBadge tone={STATE[state ?? "CLOSED"]!.tone}>{s.instance ? STATE[state!]!.label : "Nenhuma instância criada"}</StatusBadge>
                  {s.instance?.profileName && <div className="mt-1 text-sm font-medium">{s.instance.profileName}</div>}
                  {s.instance?.ownerJid && <div className="text-xs text-muted-foreground">{formatPhone(s.instance.ownerJid.split("@")[0])}</div>}
                  {s.instance?.error && <div className="mt-1 text-xs text-destructive">Não foi possível consultar a Evolution: {s.instance.error}</div>}
                </div>
                {can("integrations:edit") && (
                  <div className="flex gap-2">
                    {state !== "OPEN" && <LoadingButton loading={connect.isPending} onClick={() => connect.mutate()}><QrCode /> {s.instance ? "Gerar novo QR" : "Conectar"}</LoadingButton>}
                    {s.instance && state !== "CLOSED" && <Button variant="destructive" onClick={() => setConfirmOff(true)}><Unplug /> Desconectar</Button>}
                  </div>
                )}
              </div>
              {(qr?.qr || qr?.pairingCode || (state === "CONNECTING" && s.instance?.qr)) && (
                <div className="mt-5 flex flex-col items-center gap-3 rounded-xl border border-dashed p-5 text-center">
                  {(qr?.qr ?? s.instance?.qr) && <img src={(qr?.qr ?? s.instance?.qr)!.startsWith("data:") ? (qr?.qr ?? s.instance?.qr)! : `data:image/png;base64,${qr?.qr ?? s.instance?.qr}`} alt="QR Code do WhatsApp" className="size-64 rounded-xl bg-white p-2" />}
                  {qr?.pairingCode && <div className="font-mono text-2xl tracking-widest">{qr.pairingCode}</div>}
                  <p className="max-w-sm text-sm text-muted-foreground">No celular: WhatsApp → Aparelhos conectados → Conectar aparelho, e leia o código. Esta tela atualiza sozinha.</p>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Aguardando conexão…</span>
                </div>
              )}
            </Section>
          )
        }
      </QueryState>
      {can("integrations:view") && (
        <Section title="Eventos recebidos (webhook)" description="Últimos eventos enviados pela Evolution. Eventos repetidos são ignorados automaticamente.">
          <QueryState query={events} empty={(l) => (l.length ? null : <p className="text-sm text-muted-foreground">Nenhum evento recebido ainda.</p>)}>
            {(list) => (
              <ul className="divide-y rounded-xl border text-sm">
                {list.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-3 py-2">
                    {e.error ? <XCircle className="size-4 text-destructive" /> : e.processedAt ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Loader2 className="size-4 text-muted-foreground" />}
                    <span className="font-mono text-xs">{e.event}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-destructive">{e.error}</span>
                    <span className="text-xs text-muted-foreground">{relative(e.receivedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </Section>
      )}
      <ConfirmDialog open={confirmOff} onOpenChange={setConfirmOff} title="Desconectar o WhatsApp?" description="Mensagens na fila ficarão aguardando até uma nova conexão." destructive confirmLabel="Desconectar" loading={disconnect.isPending} onConfirm={() => disconnect.mutate()} />
    </div>
  );
}

// ───────────── Campanhas ─────────────

function CampaignWizard({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string, total: number) => void }) {
  const templates = trpc.whatsapp.templates.useQuery(undefined, { enabled: open });
  const groups = trpc.guests.groups.useQuery(undefined, { enabled: open });
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [criteria, setCriteria] = useState<Criteria>({ rsvp: ["PENDING"], inviteStatus: [], perFamily: true });
  const [familySearch, setFamilySearch] = useState("");
  const [previewInput, setPreviewInput] = useState<{ body: string; criteria: Criteria } | null>(null);
  const preview = trpc.whatsapp.preview.useQuery(previewInput!, { enabled: !!previewInput });
  const create = trpc.whatsapp.createCampaign.useMutation();

  useEffect(() => {
    if (open) {
      setName(""); setTemplateId(null); setBody(""); setCriteria({ rsvp: ["PENDING"], inviteStatus: [], perFamily: true }); setPreviewInput(null);
    }
  }, [open]);

  const stale = !previewInput || previewInput.body !== body || JSON.stringify(previewInput.criteria) !== JSON.stringify(criteria);
  const toggle = <K extends "rsvp" | "inviteStatus">(k: K, v: NonNullable<Criteria[K]>[number]) => {
    const cur = (criteria[k] ?? []) as string[];
    setCriteria({ ...criteria, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] });
  };
  const families = (groups.data ?? []).filter((g) => !familySearch || g.name.toLowerCase().includes(familySearch.toLowerCase()));
  const selectedGroups = criteria.groupIds ?? [];

  async function save() {
    if (name.trim().length < 2) return toast.error("Dê um nome à campanha");
    if (stale || !preview.data) return toast.error("Gere a prévia antes de salvar");
    try {
      const c = await create.mutateAsync({ name: name.trim(), body, templateId, criteria });
      onCreated(c.id, preview.data.total);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Nova campanha</DialogTitle>
          <DialogDescription>Nada é enviado agora. Você revisa a prévia, salva como rascunho e só então confirma o envio.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-4">
            <TextField label="Nome da campanha" value={name} onChange={setName} placeholder="Ex.: Convites — família da noiva" />
            <Field label="Modelo">
              <Select value={templateId ?? "none"} onValueChange={(v) => { setTemplateId(v === "none" ? null : v); const t = templates.data?.find((x) => x.id === v); if (t) setBody(t.body); }}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Escolha um modelo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem modelo (texto livre)</SelectItem>
                  {templates.data?.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Mensagem" hint="Clique numa variável para inserir. {{link}} gera o link seguro de confirmação de cada família.">
              <Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
              <VarChips onInsert={(v) => setBody((b) => b + v)} />
            </Field>
          </div>
          <div className="space-y-4">
            <Field label="Confirmação de presença">
              <div className="flex flex-wrap gap-1.5">{(["PENDING", "ACCEPTED", "DECLINED"] as const).map((s) => <Toggle key={s} active={!!criteria.rsvp?.includes(s)} onClick={() => toggle("rsvp", s)}>{RSVP_STATUS[s]!.label}</Toggle>)}</div>
            </Field>
            <Field label="Situação do convite">
              <div className="flex flex-wrap gap-1.5">{(["NOT_SENT", "SENT", "DELIVERED", "OPENED"] as const).map((s) => <Toggle key={s} active={!!criteria.inviteStatus?.includes(s)} onClick={() => toggle("inviteStatus", s)}>{INVITE_STATUS[s]!.label}</Toggle>)}</div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Lado">
                <Select value={criteria.side ?? "all"} onValueChange={(v) => setCriteria({ ...criteria, side: v === "all" ? null : v })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="all">Todos</SelectItem>{Object.entries(SIDE).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <TextField label="Categoria" value={criteria.category ?? ""} onChange={(v) => setCriteria({ ...criteria, category: v || null })} placeholder="A, B…" />
            </div>
            <label className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm">
              <span>Uma mensagem por família<span className="block text-xs text-muted-foreground">Telefones compartilhados recebem uma só mensagem.</span></span>
              <Switch checked={criteria.perFamily !== false} onCheckedChange={(v) => setCriteria({ ...criteria, perFamily: v })} />
            </label>
            <Field label={`Famílias específicas (opcional)${selectedGroups.length ? ` · ${selectedGroups.length} selecionada(s)` : ""}`}>
              <Input placeholder="Buscar família" value={familySearch} onChange={(e) => setFamilySearch(e.target.value)} />
              <div className="max-h-36 overflow-y-auto rounded-xl border p-1">
                {families.map((g) => {
                  const on = selectedGroups.includes(g.id);
                  return (
                    <button key={g.id} type="button" onClick={() => setCriteria({ ...criteria, groupIds: on ? selectedGroups.filter((x) => x !== g.id) : [...selectedGroups, g.id] })} className={cn("flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-sm", on ? "bg-accent" : "hover:bg-muted/60")}>
                      <span className="truncate">{g.name}</span><span className="text-xs text-muted-foreground">{g.guests.length}</span>
                    </button>
                  );
                })}
                {!families.length && <p className="p-2 text-xs text-muted-foreground">Nenhuma família.</p>}
              </div>
            </Field>
          </div>
        </div>
        <div className="rounded-xl border bg-muted/30 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-sans text-sm font-semibold">Prévia</h3>
            <LoadingButton size="sm" variant={stale ? "default" : "outline"} loading={preview.isFetching} disabled={!body.trim()} onClick={() => setPreviewInput({ body, criteria })}><Eye /> {stale ? "Gerar prévia" : "Atualizar prévia"}</LoadingButton>
          </div>
          {preview.error && <p className="text-sm text-destructive">{preview.error.message}</p>}
          {preview.data && !stale ? (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-2">
                <StatusBadge tone="wine"><Users className="size-3" /> {preview.data.total} destinatário(s)</StatusBadge>
                {preview.data.skipped.length > 0 && <StatusBadge tone="amber">{preview.data.skipped.length} sem telefone válido</StatusBadge>}
                <StatusBadge tone={preview.data.exceedsLimit ? "rose" : "neutral"}>Hoje: {preview.data.sentToday} / limite {preview.data.dailyLimit}</StatusBadge>
              </div>
              {preview.data.exceedsLimit && <p className="text-xs text-destructive">O envio ultrapassaria o limite diário. Divida a campanha ou ajuste o limite em Configurações.</p>}
              {preview.data.samples.map((s, i) => (
                <div key={i} className="rounded-xl bg-emerald-50 p-3 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-50">
                  <div className="mb-1 text-[11px] opacity-70">Para {s.name} · {formatPhone(s.to)}</div>
                  <div className="text-sm whitespace-pre-wrap">{s.text}</div>
                </div>
              ))}
              {preview.data.skipped.length > 0 && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Ver quem ficou de fora</summary><ul className="mt-1 list-disc pl-5">{preview.data.skipped.slice(0, 50).map((s, i) => <li key={i}>{s.name} — {s.reason}</li>)}</ul></details>}
            </div>
          ) : !preview.isFetching && <p className="text-xs text-muted-foreground">Gere a prévia para ver os destinatários e como a mensagem ficará.</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <LoadingButton loading={create.isPending} disabled={stale || !preview.data?.total} onClick={save}>Salvar rascunho</LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SendConfirm({ target, onClose }: { target: { id: string; total: number } | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const confirm = trpc.whatsapp.confirmCampaign.useMutation({
    onSuccess: (r) => { toast.success(`${r.queued} mensagem(ns) na fila de envio`); utils.whatsapp.invalidate(); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <ConfirmDialog
      open={!!target}
      onOpenChange={(o) => !o && onClose()}
      title={`Enviar para ${target?.total ?? 0} destinatário(s)?`}
      description="As mensagens entram na fila e são enviadas respeitando o horário permitido, o intervalo mínimo e o limite diário definidos em Configurações. Você pode cancelar as pendentes depois."
      confirmLabel="Confirmar envio"
      loading={confirm.isPending}
      onConfirm={() => target && confirm.mutate({ id: target.id })}
    />
  );
}

function CampaignSheet({ id, onClose, onSend }: { id: string | null; onClose: () => void; onSend: (id: string, total: number) => void }) {
  const { can } = useMe();
  const utils = trpc.useUtils();
  const q = trpc.whatsapp.campaign.useQuery({ id: id! }, { enabled: !!id, refetchInterval: (s) => (["QUEUED", "RUNNING"].includes(s.state.data?.status ?? "") ? 5000 : false) });
  const [confirmCancel, setConfirmCancel] = useState(false);
  const cancel = trpc.whatsapp.cancelCampaign.useMutation({
    onSuccess: (r) => { toast.success(`Campanha cancelada (${r.cancelled} pendente(s))`); setConfirmCancel(false); utils.whatsapp.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const preview = trpc.whatsapp.preview.useQuery({ body: q.data?.body ?? "", criteria: (q.data?.criteria ?? {}) as Criteria }, { enabled: q.data?.status === "DRAFT" });
  const c = q.data;
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="xl" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{c?.name ?? "Campanha"}</SheetTitle>
          {c && <SheetDescription>Criada {dateTime(c.createdAt)}{c.confirmedAt ? ` · confirmada ${dateTime(c.confirmedAt)}` : ""}</SheetDescription>}
        </SheetHeader>
        <div className="space-y-4 px-5 py-5">
          {q.isLoading ? <PageLoader /> : c && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={CAMPAIGN_STATUS[c.status]!.tone}>{CAMPAIGN_STATUS[c.status]!.label}</StatusBadge>
                {c.status === "DRAFT" && can("whatsapp:approve") && <Button size="sm" disabled={!preview.data?.total} onClick={() => onSend(c.id, preview.data?.total ?? 0)}><Send /> Enviar ({preview.data?.total ?? "…"})</Button>}
                {["DRAFT", "QUEUED", "RUNNING"].includes(c.status) && can("whatsapp:approve") && <Button size="sm" variant="destructive" onClick={() => setConfirmCancel(true)}><XCircle /> Cancelar campanha</Button>}
              </div>
              <div className="rounded-xl bg-muted/50 p-3 text-sm whitespace-pre-wrap">{c.body}</div>
              {c.messages.length ? (
                <ul className="divide-y rounded-xl border text-sm">
                  {c.messages.map((m) => (
                    <li key={m.id} className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate">{m.guest?.fullName ?? formatPhone(m.toNumber)} <span className="text-xs text-muted-foreground">{formatPhone(m.toNumber)}</span></span>
                        <StatusBadge tone={MESSAGE_STATUS[m.status]!.tone}>{MESSAGE_STATUS[m.status]!.label}</StatusBadge>
                      </div>
                      {m.lastError && <div className="mt-0.5 text-xs text-destructive">{m.lastError}</div>}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted-foreground">As mensagens são criadas quando o envio é confirmado.</p>}
            </>
          )}
        </div>
        <ConfirmDialog open={confirmCancel} onOpenChange={setConfirmCancel} title="Cancelar campanha?" description="Mensagens ainda na fila não serão enviadas. As já enviadas não podem ser desfeitas." destructive confirmLabel="Cancelar campanha" loading={cancel.isPending} onConfirm={() => id && cancel.mutate({ id })} />
      </SheetContent>
    </Sheet>
  );
}

function CampaignsTab() {
  const { can } = useMe();
  const q = trpc.whatsapp.campaigns.useQuery(undefined, { refetchInterval: 15_000 });
  const utils = trpc.useUtils();
  const [wizard, setWizard] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [send, setSend] = useState<{ id: string; total: number } | null>(null);
  return (
    <>
      <div className="mb-4 flex justify-end">{can("whatsapp:create") && <Button onClick={() => setWizard(true)}><Plus /> Nova campanha</Button>}</div>
      <QueryState query={q} empty={(l) => (l.length ? null : <EmptyState icon={<Send />} title="Nenhuma campanha" description="Envie convites ou lembretes em lote, com prévia e confirmação antes do disparo." />)}>
        {(list) => (
          <div className="grid gap-3 md:grid-cols-2">
            {list.map((c) => {
              const total = Object.values(c.counts).reduce((a, b) => a + b, 0);
              return (
                <button key={c.id} onClick={() => setOpen(c.id)} className="rounded-xl border bg-card p-4 text-left shadow-soft transition hover:border-primary/40">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><div className="truncate font-medium">{c.name}</div><div className="text-xs text-muted-foreground">{dateTime(c.createdAt)}</div></div>
                    <StatusBadge tone={CAMPAIGN_STATUS[c.status]!.tone}>{CAMPAIGN_STATUS[c.status]!.label}</StatusBadge>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{c.body}</p>
                  {total > 0 && <div className="mt-3 flex flex-wrap gap-1">{Object.entries(c.counts).map(([s, n]) => <StatusBadge key={s} tone={MESSAGE_STATUS[s]?.tone}>{MESSAGE_STATUS[s]?.label}: {n}</StatusBadge>)}</div>}
                </button>
              );
            })}
          </div>
        )}
      </QueryState>
      <CampaignWizard open={wizard} onOpenChange={setWizard} onCreated={(id, total) => { setWizard(false); utils.whatsapp.campaigns.invalidate(); toast.success("Rascunho salvo"); if (can("whatsapp:approve")) setSend({ id, total }); else setOpen(id); }} />
      <CampaignSheet id={open} onClose={() => setOpen(null)} onSend={(id, total) => setSend({ id, total })} />
      <SendConfirm target={send} onClose={() => setSend(null)} />
    </>
  );
}

// ───────────── Mensagens ─────────────

function ThreadSheet({ number, onClose }: { number: string | null; onClose: () => void }) {
  const q = trpc.whatsapp.thread.useQuery({ number: number! }, { enabled: !!number, refetchInterval: 10_000 });
  return (
    <Sheet open={!!number} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="lg" className="overflow-y-auto">
        <SheetHeader><SheetTitle>Conversa com {formatPhone(number)}</SheetTitle></SheetHeader>
        <div className="space-y-2 px-5 py-5">
          <QueryState query={q} empty={(l) => (l.length ? null : <p className="text-sm text-muted-foreground">Sem mensagens.</p>)}>
            {(list) => (
              <>
                {list.map((m) => (
                  <div key={`${m.dir}${m.id}`} className={cn("flex", m.dir === "out" ? "justify-end" : "justify-start")}>
                    <div className={cn("max-w-[85%] rounded-xl px-3 py-2 text-sm", m.dir === "out" ? "rounded-br-sm bg-emerald-100 text-emerald-950 dark:bg-emerald-900/50 dark:text-emerald-50" : "rounded-bl-sm bg-muted")}>
                      <div className="whitespace-pre-wrap">{m.body}</div>
                      <div className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-70">{dateTime(m.at)}{m.status && ` · ${MESSAGE_STATUS[m.status]?.label}`}</div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </QueryState>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SendSingleDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [to, setTo] = useState("");
  const [body, setBody] = useState("");
  const [key, setKey] = useState(newKey);
  const utils = trpc.useUtils();
  useEffect(() => { if (open) { setTo(""); setBody(""); setKey(newKey()); } }, [open]);
  const send = trpc.whatsapp.sendSingle.useMutation({ onSuccess: () => { toast.success("Mensagem na fila de envio"); utils.whatsapp.messages.invalidate(); onOpenChange(false); }, onError: (e) => toast.error(e.message) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Mensagem individual</DialogTitle><DialogDescription>Enviada respeitando o horário permitido e o intervalo mínimo.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <PhoneField label="Telefone (com DDD)" value={to} onChange={setTo} />
          <Field label="Mensagem"><Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <LoadingButton loading={send.isPending} disabled={to.replace(/\D/g, "").length < 10 || !body.trim()} onClick={() => send.mutate({ to, body, idempotencyKey: key })}><Send /> Enviar</LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MessagesTab() {
  const { can } = useMe();
  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [thread, setThread] = useState<string | null>(null);
  const [single, setSingle] = useState(false);
  const [retryId, setRetryId] = useState<string | null>(null);
  const utils = trpc.useUtils();
  useEffect(() => { const t = setTimeout(() => setTerm(search), 350); return () => clearTimeout(t); }, [search]);
  useEffect(() => setCursors([undefined]), [status, term]);
  const filters = { status: status === "all" ? undefined : (status as never), search: term || undefined };
  const pages = trpc.useQueries((t) => cursors.map((c) => t.whatsapp.messages({ ...filters, cursor: c })));
  const items = pages.flatMap((p) => p.data?.items ?? []);
  const last = pages[pages.length - 1];
  const stats = trpc.whatsapp.stats.useQuery();
  const retry = trpc.whatsapp.retry.useMutation({ onSuccess: () => { toast.success("Mensagem reenfileirada"); setRetryId(null); utils.whatsapp.messages.invalidate(); }, onError: (e) => toast.error(e.message) });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1"><Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-8" placeholder="Buscar por nome ou número" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todos os status</SelectItem>{Object.entries(MESSAGE_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}{stats.data?.[k] ? ` (${stats.data[k]})` : ""}</SelectItem>)}</SelectContent>
        </Select>
        {can("whatsapp:approve") && <Button onClick={() => setSingle(true)}><Send /> Mensagem individual</Button>}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">“Aceita pelo provedor” significa que a Evolution recebeu a mensagem — não que ela chegou ao celular. Entregue e lida só aparecem quando o WhatsApp confirma.</p>
      {pages[0]?.isLoading ? <PageLoader /> : pages[0]?.error ? <p className="text-sm text-destructive">{pages[0].error.message}</p> : !items.length ? (
        <EmptyState icon={<MessageCircle />} title="Nenhuma mensagem" description="Mensagens de campanhas e individuais aparecem aqui com o status real de entrega." />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {items.map((m) => (
            <li key={m.id} className="space-y-1 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <button className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline" onClick={() => setThread(m.toNumber)}>
                  {m.guest?.fullName ?? formatPhone(m.toNumber)} <span className="font-normal text-muted-foreground">{formatPhone(m.toNumber)}</span>
                </button>
                {m.campaign && <StatusBadge tone="neutral">{m.campaign.name}</StatusBadge>}
                <span title={STATUS_HINT[m.status]}><StatusBadge tone={MESSAGE_STATUS[m.status]!.tone}>{MESSAGE_STATUS[m.status]!.label}</StatusBadge></span>
                <span className="text-xs text-muted-foreground">{relative(m.sentAt ?? m.createdAt)}</span>
              </div>
              <p className="line-clamp-2 text-sm text-muted-foreground">{m.body}</p>
              {(m.lastError || m.attemptsLog.some((a) => !a.ok)) && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-destructive">{m.attempts} tentativa(s){m.lastError ? ` · ${m.lastError}` : ""}</summary>
                  <ul className="mt-1 space-y-0.5 pl-4 text-muted-foreground">{m.attemptsLog.map((a) => <li key={a.id}>{dateTime(a.createdAt)} — {a.ok ? "ok" : `falha${a.httpStatus ? ` (${a.httpStatus})` : ""}: ${a.error}`}</li>)}</ul>
                </details>
              )}
              <div className="flex gap-1">
                <Button size="xs" variant="ghost" onClick={() => setThread(m.toNumber)}><Eye /> Conversa</Button>
                {m.status === "FAILED" && can("whatsapp:approve") && <Button size="xs" variant="outline" onClick={() => setRetryId(m.id)}><RotateCcw /> Reprocessar</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {last?.data?.nextCursor && <div className="mt-3 flex justify-center"><LoadingButton variant="outline" loading={last.isFetching} onClick={() => setCursors([...cursors, last.data!.nextCursor!])}>Carregar mais</LoadingButton></div>}
      <ThreadSheet number={thread} onClose={() => setThread(null)} />
      <SendSingleDialog open={single} onOpenChange={setSingle} />
      <ConfirmDialog open={!!retryId} onOpenChange={(o) => !o && setRetryId(null)} title="Reprocessar mensagem?" description="Confira antes no WhatsApp se ela realmente não chegou, para evitar mensagem duplicada." confirmLabel="Reprocessar" loading={retry.isPending} onConfirm={() => retryId && retry.mutate({ id: retryId })} />
    </>
  );
}

function InboundTab() {
  const q = trpc.whatsapp.inbound.useQuery(undefined, { refetchInterval: 15_000 });
  const [thread, setThread] = useState<string | null>(null);
  return (
    <>
      <QueryState query={q} empty={(l) => (l.length ? null : <EmptyState icon={<Inbox />} title="Nenhuma mensagem recebida" description="Respostas de convidados e fornecedores chegam pelo webhook da Evolution." />)}>
        {(list) => (
          <ul className="divide-y rounded-xl border bg-card">
            {list.map((m) => (
              <li key={m.id}>
                <button onClick={() => setThread(m.fromNumber)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/40">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {m.pushName ?? formatPhone(m.fromNumber)} <span className="font-normal text-muted-foreground">{formatPhone(m.fromNumber)}</span>
                      {m.guestIds.length > 0 && <StatusBadge tone="sky"><Link2 className="size-3" /> {m.guestIds.length} convidado(s)</StatusBadge>}
                      {m.vendorId && <StatusBadge tone="violet">Fornecedor</StatusBadge>}
                    </div>
                    <p className="line-clamp-2 text-sm text-muted-foreground">{m.body ?? "[mídia]"}</p>
                  </div>
                  <span className="text-xs whitespace-nowrap text-muted-foreground">{relative(m.receivedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
      <ThreadSheet number={thread} onClose={() => setThread(null)} />
    </>
  );
}

// ───────────── Modelos ─────────────

type Tpl = { id?: string; name: string; body: string; purpose: "INVITE" | "REMINDER" | "INFO" | "VENDOR" | "TASK" | "OTHER" };

function TemplatesTab() {
  const { can } = useMe();
  const q = trpc.whatsapp.templates.useQuery();
  const utils = trpc.useUtils();
  const [edit, setEdit] = useState<Tpl | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const save = trpc.whatsapp.saveTemplate.useMutation({ onSuccess: () => { toast.success("Modelo salvo"); setEdit(null); utils.whatsapp.templates.invalidate(); }, onError: (e) => toast.error(e.message) });
  const remove = trpc.whatsapp.deleteTemplate.useMutation({ onSuccess: () => { toast.success("Modelo excluído"); setDel(null); utils.whatsapp.templates.invalidate(); }, onError: (e) => toast.error(e.message) });
  const sample = useMemo(() => ({ nome: "Ana", familia: "Família Souza", link: "https://…/c/…", data: "12 de setembro de 2027", noivos: "Maria & João", local: "Igreja Matriz" }), []);
  return (
    <>
      <div className="mb-4 flex justify-end">{can("whatsapp:create") && <Button onClick={() => setEdit({ name: "", body: "", purpose: "OTHER" })}><Plus /> Novo modelo</Button>}</div>
      <QueryState query={q} empty={(l) => (l.length ? null : <EmptyState icon={<MessageCircle />} title="Nenhum modelo" />)}>
        {(list) => (
          <div className="grid gap-3 md:grid-cols-2">
            {list.map((t) => (
              <div key={t.id} className="rounded-xl border bg-card p-4 shadow-soft">
                <div className="flex items-start justify-between gap-2">
                  <div><div className="font-medium">{t.name}</div><StatusBadge tone="neutral">{PURPOSE[t.purpose] ?? t.purpose}</StatusBadge></div>
                  {can("whatsapp:create") && (
                    <div className="flex">
                      <Button size="icon-sm" variant="ghost" aria-label="Editar" onClick={() => setEdit({ id: t.id, name: t.name, body: t.body, purpose: t.purpose as Tpl["purpose"] })}><Pencil /></Button>
                      <Button size="icon-sm" variant="ghost" aria-label="Excluir" onClick={() => setDel(t.id)}><Trash2 /></Button>
                    </div>
                  )}
                </div>
                <p className="mt-2 line-clamp-4 text-sm whitespace-pre-wrap text-muted-foreground">{t.body}</p>
              </div>
            ))}
          </div>
        )}
      </QueryState>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{edit?.id ? "Editar modelo" : "Novo modelo"}</DialogTitle></DialogHeader>
          {edit && (
            <div className="space-y-3">
              <TextField label="Nome" value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} />
              <Field label="Finalidade">
                <Select value={edit.purpose} onValueChange={(v) => setEdit({ ...edit, purpose: v as Tpl["purpose"] })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(PURPOSE).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Mensagem"><Textarea rows={7} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /><VarChips onInsert={(v) => setEdit({ ...edit, body: edit.body + v })} /></Field>
              {edit.body && <div className="rounded-xl bg-muted/50 p-3 text-sm whitespace-pre-wrap"><div className="mb-1 text-[11px] text-muted-foreground">Exemplo</div>{edit.body.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (sample as Record<string, string>)[k] ?? m)}</div>}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button>
            <LoadingButton loading={save.isPending} disabled={!edit || edit.name.trim().length < 2 || edit.body.trim().length < 2} onClick={() => edit && save.mutate({ ...edit, name: edit.name.trim() })}>Salvar</LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title="Excluir modelo?" destructive confirmLabel="Excluir" loading={remove.isPending} onConfirm={() => del && remove.mutate({ id: del })} />
    </>
  );
}

export function WhatsAppPage() {
  return (
    <>
      <PageHeader title="WhatsApp" description="Convites, lembretes e conversas pela Evolution API — com fila, prévia e confirmação antes de cada envio." />
      <Tabs defaultValue="conexao">
        <div className="mb-4 overflow-x-auto scrollbar-none">
          <TabsList>
            <TabsTrigger value="conexao">Conexão</TabsTrigger>
            <TabsTrigger value="campanhas">Campanhas</TabsTrigger>
            <TabsTrigger value="mensagens">Mensagens</TabsTrigger>
            <TabsTrigger value="recebidas">Recebidas</TabsTrigger>
            <TabsTrigger value="modelos">Modelos</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="conexao"><ConnectionTab /></TabsContent>
        <TabsContent value="campanhas"><CampaignsTab /></TabsContent>
        <TabsContent value="mensagens"><MessagesTab /></TabsContent>
        <TabsContent value="recebidas"><InboundTab /></TabsContent>
        <TabsContent value="modelos"><TemplatesTab /></TabsContent>
      </Tabs>
    </>
  );
}
