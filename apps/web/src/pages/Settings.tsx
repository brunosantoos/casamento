import { CouplePhotosPanel } from "@/components/app/CouplePhotos";
import { AppearancePanel } from "@/components/app/AppearancePanel";
import { Bot, KeyRound, Lock, MessageCircle, RotateCcw, ShieldCheck, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog, EmptyState, Field, LoadingButton, MoneyInput, PageHeader, QueryState, Section, StatusBadge, TextField } from "@/components/app/common";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useMe } from "@/hooks/use-me";
import { dateTime, fromDateTimeInput, toDateInput, toDateTimeInput } from "@/lib/format";
import { trpc, type RouterOutputs } from "@/trpc";

const BR_TIMEZONES = ["America/Sao_Paulo", "America/Manaus", "America/Cuiaba", "America/Campo_Grande", "America/Belem", "America/Fortaleza", "America/Recife", "America/Bahia", "America/Porto_Velho", "America/Boa_Vista", "America/Rio_Branco", "America/Noronha"];
function timezones() {
  const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  return [...BR_TIMEZONES, ...all.filter((t) => !BR_TIMEZONES.includes(t))];
}

// ───────────── Casamento ─────────────

type Wedding = RouterOutputs["wedding"]["get"];
type VisualPrefs = { palette?: string; colors?: string; style?: string; notes?: string };

function WeddingTab({ w }: { w: Wedding }) {
  const { can } = useMe();
  const utils = trpc.useUtils();
  const editable = can("settings:edit");
  const prefs = (w.visualPrefs ?? {}) as VisualPrefs;
  const [f, setF] = useState({
    name: w.name, partner1Name: w.partner1Name, partner2Name: w.partner2Name, date: toDateTimeInput(w.date), timezone: w.timezone, city: w.city ?? "",
    ceremonyAddress: w.ceremonyAddress ?? "", receptionAddress: w.receptionAddress ?? "", budgetCents: w.budgetCents, estimatedGuests: w.estimatedGuests?.toString() ?? "",
    maxGuests: w.maxGuests?.toString() ?? "", rsvpDeadline: toDateInput(w.rsvpDeadline), notes: w.notes ?? "", prefs,
  });
  const update = trpc.wedding.update.useMutation({
    onSuccess: () => {
      toast.success("Dados do casamento salvos");
      utils.wedding.invalidate();
      utils.dashboard.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF({ ...f, [k]: v });
  const zones = timezones();

  function save() {
    if (f.partner1Name.trim().length < 1 || f.partner2Name.trim().length < 1 || f.name.trim().length < 2) return toast.error("Preencha o nome do evento e dos noivos");
    update.mutate({
      name: f.name.trim(), partner1Name: f.partner1Name.trim(), partner2Name: f.partner2Name.trim(), date: fromDateTimeInput(f.date), timezone: f.timezone, city: f.city || null,
      ceremonyAddress: f.ceremonyAddress || null, receptionAddress: f.receptionAddress || null,
      estimatedGuests: f.estimatedGuests ? Number(f.estimatedGuests) : null, maxGuests: f.maxGuests ? Number(f.maxGuests) : null,
      rsvpDeadline: f.rsvpDeadline ? new Date(`${f.rsvpDeadline}T23:59:00`) : null, notes: f.notes || null, visualPrefs: f.prefs,
      ...(can("finance:edit") && f.budgetCents != null ? { budgetCents: f.budgetCents } : {}),
    });
  }

  return (
    <div className="space-y-5">
      <Section title="Evento">
        <fieldset disabled={!editable} className="grid gap-4 md:grid-cols-2">
          <TextField label="Nome do evento" value={f.name} onChange={set("name")} className="md:col-span-2" />
          <TextField label="Noivo(a) 1" value={f.partner1Name} onChange={set("partner1Name")} />
          <TextField label="Noivo(a) 2" value={f.partner2Name} onChange={set("partner2Name")} />
          <Field label="Data e horário"><Input type="datetime-local" value={f.date} onChange={(e) => set("date")(e.target.value)} /></Field>
          <Field label="Fuso horário" hint="Datas são guardadas em UTC e exibidas neste fuso.">
            <Select value={f.timezone} onValueChange={set("timezone")}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">{zones.map((z) => <SelectItem key={z} value={z}>{z.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <TextField label="Cidade" value={f.city} onChange={set("city")} />
          <Field label="Prazo de confirmação (RSVP)"><Input type="date" value={f.rsvpDeadline} onChange={(e) => set("rsvpDeadline")(e.target.value)} /></Field>
          <TextField label="Endereço da cerimônia" value={f.ceremonyAddress} onChange={set("ceremonyAddress")} />
          <TextField label="Endereço da recepção" value={f.receptionAddress} onChange={set("receptionAddress")} />
        </fieldset>
      </Section>
      <Section title="Números">
        <fieldset disabled={!editable} className="grid gap-4 md:grid-cols-3">
          {w.budgetCents != null && (
            <Field label="Orçamento total planejado" hint={can("finance:edit") ? undefined : "Alterar exige permissão de edição no financeiro"}>
              <MoneyInput value={f.budgetCents} onChange={set("budgetCents")} disabled={!can("finance:edit")} />
            </Field>
          )}
          <Field label="Convidados estimados"><Input type="number" min={0} value={f.estimatedGuests} onChange={(e) => set("estimatedGuests")(e.target.value)} /></Field>
          <Field label="Máximo de convidados" hint="Capacidade; gera alerta se ultrapassada"><Input type="number" min={0} value={f.maxGuests} onChange={(e) => set("maxGuests")(e.target.value)} /></Field>
        </fieldset>
      </Section>
      <Section title="Preferências visuais e observações">
        <fieldset disabled={!editable} className="grid gap-4 md:grid-cols-3">
          <TextField label="Paleta" placeholder="Ex.: vinho, dourado e marfim" value={f.prefs.palette ?? ""} onChange={(v) => set("prefs")({ ...f.prefs, palette: v })} />
          <TextField label="Cores principais" placeholder="Ex.: #6b1d2f, #e9c77b" value={f.prefs.colors ?? ""} onChange={(v) => set("prefs")({ ...f.prefs, colors: v })} />
          <TextField label="Estilo" placeholder="Ex.: clássico, rústico, praia" value={f.prefs.style ?? ""} onChange={(v) => set("prefs")({ ...f.prefs, style: v })} />
          <TextField label="Notas de estilo" multiline value={f.prefs.notes ?? ""} onChange={(v) => set("prefs")({ ...f.prefs, notes: v })} className="md:col-span-3" />
          <TextField label="Observações gerais" multiline value={f.notes} onChange={set("notes")} className="md:col-span-3" />
        </fieldset>
      </Section>
      {editable && <div className="flex justify-end"><LoadingButton loading={update.isPending} onClick={save}>Salvar alterações</LoadingButton></div>}
    </div>
  );
}

// ───────────── Operacional ─────────────

type Setting = RouterOutputs["settings"]["list"][number];

function SettingEditor({ s }: { s: Setting }) {
  const { can } = useMe();
  const utils = trpc.useUtils();
  const [value, setValue] = useState<unknown>(s.value);
  const [tag, setTag] = useState("");
  useEffect(() => setValue(s.value), [s.value]);
  const done = () => {
    utils.settings.list.invalidate();
    utils.settings.history.invalidate();
  };
  const save = trpc.settings.set.useMutation({ onSuccess: () => { toast.success("Configuração salva"); done(); }, onError: (e) => toast.error(e.message) });
  const reset = trpc.settings.reset.useMutation({ onSuccess: () => { toast.success("Padrão restaurado"); done(); }, onError: (e) => toast.error(e.message) });
  const editable = can("settings:edit");
  const dirty = JSON.stringify(value) !== JSON.stringify(s.value);
  const fmtDefault = (v: unknown) => (typeof v === "boolean" ? (v ? "ligado" : "desligado") : Array.isArray(v) ? `${v.length} itens` : typeof v === "object" && v ? Object.values(v).join("–") : String(v));

  let input: React.ReactNode;
  if (typeof s.default === "boolean") {
    input = <Switch checked={!!value} disabled={!editable} onCheckedChange={(v) => { setValue(v); save.mutate({ key: s.key, value: v }); }} />;
  } else if (typeof s.default === "number") {
    input = <Input type="number" className="w-36" disabled={!editable} value={String(value ?? "")} onChange={(e) => setValue(e.target.value === "" ? "" : Number(e.target.value))} />;
  } else if (s.key === "reminders.channel") {
    input = (
      <Select value={String(value)} disabled={!editable} onValueChange={setValue}>
        <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="EMAIL">E-mail</SelectItem><SelectItem value="NONE">Desligado</SelectItem></SelectContent>
      </Select>
    );
  } else if (Array.isArray(s.default)) {
    const list = (value as string[]) ?? [];
    input = (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {list.map((t) => (
            <span key={t} className="flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pr-1 pl-2 text-xs">
              {t}
              {editable && <button type="button" aria-label={`Remover ${t}`} onClick={() => setValue(list.filter((x) => x !== t))} className="rounded-full p-0.5 hover:bg-muted"><X className="size-3" /></button>}
            </span>
          ))}
        </div>
        {editable && (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (tag.trim() && !list.includes(tag.trim())) setValue([...list, tag.trim()]); setTag(""); }}>
            <Input className="max-w-xs" placeholder="tipo/subtipo (ex.: image/gif)" value={tag} onChange={(e) => setTag(e.target.value)} />
            <Button type="submit" variant="outline" size="sm">Adicionar</Button>
          </form>
        )}
      </div>
    );
  } else if (typeof s.default === "object" && s.default) {
    const v = (value ?? {}) as { start: string; end: string };
    input = (
      <div className="flex items-center gap-2">
        <Input type="time" className="w-32" disabled={!editable} value={v.start} onChange={(e) => setValue({ ...v, start: e.target.value })} />
        <span className="text-sm text-muted-foreground">até</span>
        <Input type="time" className="w-32" disabled={!editable} value={v.end} onChange={(e) => setValue({ ...v, end: e.target.value })} />
      </div>
    );
  } else {
    input = <Input disabled={!editable} value={String(value ?? "")} onChange={(e) => setValue(e.target.value)} />;
  }

  return (
    <li className="flex flex-col gap-3 py-4 md:flex-row md:items-center">
      <div className="min-w-0 md:w-80">
        <div className="text-sm font-medium">{s.label}</div>
        <div className="text-xs text-muted-foreground">Padrão: {fmtDefault(s.default)}{s.custom && s.updatedAt ? ` · alterado ${dateTime(s.updatedAt)}` : ""}</div>
      </div>
      <div className="min-w-0 flex-1">{input}</div>
      {editable && (
        <div className="flex gap-2">
          {typeof s.default !== "boolean" && <LoadingButton size="sm" loading={save.isPending} disabled={!dirty || value === ""} onClick={() => save.mutate({ key: s.key, value })}>Salvar</LoadingButton>}
          {s.custom && <Button size="sm" variant="ghost" onClick={() => reset.mutate({ key: s.key })}><RotateCcw /> Padrão</Button>}
        </div>
      )}
    </li>
  );
}

function OperationalTab() {
  const list = trpc.settings.list.useQuery();
  const history = trpc.settings.history.useQuery();
  const labels = new Map<string, string>((list.data ?? []).map((s) => [s.key, s.label]));
  const groups: [string, string][] = [["reminders", "Lembretes"], ["finance", "Financeiro"], ["whatsapp", "WhatsApp"], ["rsvp", "Confirmações"], ["files", "Arquivos"], ["ai", "Inteligência artificial"]];
  return (
    <div className="space-y-5">
      <Alert><AlertDescription>Parâmetros operacionais ficam no banco, com histórico de alterações — não em arquivos de ambiente. Segredos ficam em Integrações.</AlertDescription></Alert>
      <QueryState query={list}>
        {(settings) => (
          <>
            {groups.map(([prefix, title]) => {
              const items = settings.filter((s) => s.key.startsWith(`${prefix}.`));
              if (!items.length) return null;
              return (
                <Section key={prefix} title={title}>
                  <ul className="divide-y">{items.map((s) => <SettingEditor key={s.key} s={s} />)}</ul>
                </Section>
              );
            })}
          </>
        )}
      </QueryState>
      <Section title="Histórico de alterações">
        <QueryState query={history} empty={(h) => (!h.length ? <p className="text-sm text-muted-foreground">Nenhuma alteração registrada.</p> : null)}>
          {(h) => (
            <ul className="divide-y text-sm">
              {h.map((c) => (
                <li key={c.id} className="flex flex-wrap gap-x-3 py-2">
                  <span className="text-xs text-muted-foreground tabular-nums">{dateTime(c.createdAt)}</span>
                  <span className="font-medium">{labels.get(c.key) ?? c.key}</span>
                  <span className="text-muted-foreground">{JSON.stringify(c.oldValue) ?? "padrão"} → {c.newValue === null || c.newValue === undefined ? "padrão" : JSON.stringify(c.newValue)}</span>
                  <span className="text-xs text-muted-foreground">por {c.userName ?? "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </Section>
    </div>
  );
}

// ───────────── Integrações ─────────────

type Integrations = RouterOutputs["settings"]["integrations"];
type SecretInfo = { set: boolean; hint: string | null } | undefined;

/** Segredo: o valor nunca volta do servidor; mostramos só a dica. undefined = manter, null = remover. */
function SecretField({ label, info, value, onChange, disabled }: { label: string; info: SecretInfo; value: string | null | undefined; onChange: (v: string | null | undefined) => void; disabled?: boolean }) {
  return (
    <Field label={label} hint={value === null ? "Será removida ao salvar" : info?.set ? `Definida: ${info.hint ?? "••••"} — digite para substituir` : "Não definida"}>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <KeyRound className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="password" autoComplete="off" className="pl-8" disabled={disabled} placeholder={info?.set ? (info.hint ?? "••••") : "Cole a chave aqui"} value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} />
        </div>
        {info?.set && !disabled && <Button type="button" variant="outline" size="icon" aria-label="Remover chave" onClick={() => onChange(value === null ? undefined : null)}><Trash2 /></Button>}
      </div>
    </Field>
  );
}

function EvolutionCard({ data }: { data: Integrations["evolution"] }) {
  const { can } = useMe();
  const utils = trpc.useUtils();
  const editable = can("integrations:edit");
  const cfg = data.config as { baseUrl?: string; webhookBaseUrl?: string | null };
  const [f, setF] = useState({ enabled: data.enabled, baseUrl: cfg.baseUrl ?? "", webhookBaseUrl: cfg.webhookBaseUrl ?? "", apiKey: undefined as string | null | undefined });
  const save = trpc.settings.saveEvolution.useMutation({
    onSuccess: () => { toast.success("Evolution API salva"); setF((x) => ({ ...x, apiKey: undefined })); utils.settings.integrations.invalidate(); utils.whatsapp.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Section title={<span className="flex items-center gap-2"><MessageCircle className="size-5 text-primary" /> Evolution API (WhatsApp)</span>} description="Instalação própria da Evolution API v2. A conexão por QR code e os testes ficam na tela do WhatsApp." actions={<Button asChild variant="outline" size="sm"><Link to="/whatsapp">Conectar / testar</Link></Button>}>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!f.baseUrl) return toast.error("Informe a URL da Evolution"); save.mutate({ enabled: f.enabled, baseUrl: f.baseUrl, webhookBaseUrl: f.webhookBaseUrl, apiKey: f.apiKey }); }}>
        <Field label="Ativada"><div className="flex h-9 items-center"><Switch checked={f.enabled} disabled={!editable} onCheckedChange={(v) => setF({ ...f, enabled: v })} /></div></Field>
        <TextField label="URL da Evolution API" placeholder="https://evolution.seudominio.com" type="url" value={f.baseUrl} onChange={(v) => setF({ ...f, baseUrl: v })} disabled={!editable} />
        <TextField label="URL pública desta API (webhook)" hint="Endereço pelo qual a Evolution alcança este sistema. Vazio = padrão do servidor." type="url" value={f.webhookBaseUrl} onChange={(v) => setF({ ...f, webhookBaseUrl: v })} disabled={!editable} />
        <SecretField label="Chave da API (apikey)" info={data.secrets.apiKey as SecretInfo} value={f.apiKey} onChange={(v) => setF({ ...f, apiKey: v })} disabled={!editable} />
        {editable && <div className="md:col-span-2 flex justify-end"><LoadingButton type="submit" loading={save.isPending}>Salvar</LoadingButton></div>}
      </form>
    </Section>
  );
}

function AiCard({ data, providers }: { data: Integrations["ai"]; providers: Integrations["aiProviders"] }) {
  const { can } = useMe();
  const utils = trpc.useUtils();
  const editable = can("integrations:edit");
  const cfg = data.config as { provider?: keyof typeof providers; model?: string; baseUrl?: string | null };
  const [f, setF] = useState({ enabled: data.enabled, provider: (cfg.provider ?? "ANTHROPIC") as keyof typeof providers, model: cfg.model ?? "", baseUrl: cfg.baseUrl ?? "", apiKey: undefined as string | null | undefined });
  const save = trpc.settings.saveAi.useMutation({
    onSuccess: () => { toast.success("Provedor de IA salvo"); setF((x) => ({ ...x, apiKey: undefined })); utils.settings.integrations.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const test = trpc.settings.testAi.useMutation({
    onSuccess: (r) => (r.ok ? toast.success(`Resposta do modelo: "${r.text}"`) : toast.error(r.error ?? "Falhou")),
    onError: (e) => toast.error(e.message),
  });
  const p = providers[f.provider];
  return (
    <Section title={<span className="flex items-center gap-2"><Bot className="size-5 text-primary" /> Inteligência artificial</span>} description="Usada no assistente e na análise de documentos. Independente de fornecedor.">
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(e) => {
        e.preventDefault();
        if (f.model.trim().length < 2) return toast.error("Informe o modelo");
        if (p.needsBaseUrl && !f.baseUrl) return toast.error("Este provedor exige URL base");
        save.mutate({ enabled: f.enabled, provider: f.provider, model: f.model.trim(), baseUrl: f.baseUrl, apiKey: f.apiKey });
      }}>
        <Field label="Ativada"><div className="flex h-9 items-center"><Switch checked={f.enabled} disabled={!editable} onCheckedChange={(v) => setF({ ...f, enabled: v })} /></div></Field>
        <Field label="Provedor">
          <Select value={f.provider} disabled={!editable} onValueChange={(v) => setF({ ...f, provider: v as typeof f.provider, model: providers[v as typeof f.provider].models[0] ?? f.model })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(providers) as (keyof typeof providers)[]).map((k) => <SelectItem key={k} value={k}>{providers[k].label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Modelo" hint={p.models.length ? `Sugestões: ${p.models.join(", ")}` : "Nome do modelo no provedor"}>
          <Input list="ai-models" value={f.model} disabled={!editable} onChange={(e) => setF({ ...f, model: e.target.value })} />
          <datalist id="ai-models">{p.models.map((m) => <option key={m} value={m} />)}</datalist>
        </Field>
        <TextField label={p.needsBaseUrl ? "URL base (obrigatória)" : "URL base (opcional)"} type="url" value={f.baseUrl} onChange={(v) => setF({ ...f, baseUrl: v })} disabled={!editable} />
        <SecretField label="Chave da API" info={data.secrets.apiKey as SecretInfo} value={f.apiKey} onChange={(v) => setF({ ...f, apiKey: v })} disabled={!editable} />
        {editable && (
          <div className="flex items-end justify-end gap-2 md:col-span-2">
            <LoadingButton type="button" variant="outline" loading={test.isPending} disabled={!data.secrets.apiKey} onClick={() => test.mutate()}>Testar</LoadingButton>
            <LoadingButton type="submit" loading={save.isPending}>Salvar</LoadingButton>
          </div>
        )}
      </form>
    </Section>
  );
}

function IntegrationsTab() {
  const q = trpc.settings.integrations.useQuery();
  return (
    <div className="space-y-5">
      <Alert className="border-primary/30 bg-primary/5">
        <Lock />
        <AlertDescription><b>Segredos são cifrados no servidor (AES-256-GCM) e nunca voltam ao navegador.</b> Aqui você vê apenas se a chave está definida e seus últimos caracteres. Toda alteração é registrada na auditoria.</AlertDescription>
      </Alert>
      <QueryState query={q}>
        {(d) => (
          <>
            <EvolutionCard data={d.evolution} />
            <AiCard data={d.ai} providers={d.aiProviders} />
          </>
        )}
      </QueryState>
    </div>
  );
}

// ───────────── Privacidade ─────────────

const REQ_TONE = { PENDING: "amber", DONE: "emerald", REJECTED: "neutral" } as const;
const REQ_LABEL: Record<string, string> = { PENDING: "Pendente", DONE: "Executado", REJECTED: "Recusado" };

function PrivacyTab() {
  const { can } = useMe();
  const utils = trpc.useUtils();
  const requests = trpc.privacy.requests.useQuery(undefined, { enabled: can("guests:view") });
  const settings = trpc.settings.list.useQuery();
  const share = settings.data?.find((s) => s.key === "ai.shareGuestData");
  const setShare = trpc.settings.set.useMutation({ onSuccess: () => { toast.success("Preferência salva"); utils.settings.invalidate(); }, onError: (e) => toast.error(e.message) });
  const [exec, setExec] = useState<string | null>(null);
  const [reject, setReject] = useState<string | null>(null);
  const [resolution, setResolution] = useState("");
  const done = () => utils.privacy.requests.invalidate();
  const execute = trpc.privacy.executeDeletion.useMutation({ onSuccess: () => { toast.success("Dados anonimizados"); setExec(null); done(); }, onError: (e) => toast.error(e.message) });
  const rej = trpc.privacy.rejectDeletion.useMutation({ onSuccess: () => { toast.success("Pedido recusado"); setReject(null); setResolution(""); done(); }, onError: (e) => toast.error(e.message) });

  return (
    <div className="space-y-5">
      <Section title={<span className="flex items-center gap-2"><ShieldCheck className="size-5 text-primary" /> Como tratamos dados pessoais (LGPD)</span>}>
        <div className="grid gap-4 text-sm md:grid-cols-2">
          <div><b>Finalidade.</b> <span className="text-muted-foreground">Dados de convidados, fornecedores e equipe são usados apenas para organizar o casamento: convites, confirmações, pagamentos e comunicação.</span></div>
          <div><b>Necessidade.</b> <span className="text-muted-foreground">Coletamos o mínimo (nome, contato, restrições informadas). E-mail é opcional; telefone não identifica a pessoa.</span></div>
          <div><b>Retenção.</b> <span className="text-muted-foreground">Arquivos excluídos são removidos após o prazo configurado. Registros financeiros e de auditoria são mantidos por obrigação de prestação de contas.</span></div>
          <div><b>Direitos do titular.</b> <span className="text-muted-foreground">Consulta e exportação (no cadastro do convidado), correção pelas telas normais e exclusão por pedido registrado aqui, executada por anonimização.</span></div>
          <div className="md:col-span-2"><b>Provedores externos.</b> <span className="text-muted-foreground">A Evolution API recebe o telefone e o texto de cada mensagem enviada. O provedor de IA recebe somente o necessário para responder (totais, nomes de registros e, se permitido abaixo, nomes de convidados) e o texto dos documentos enviados para análise.</span></div>
        </div>
        {share && (
          <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border p-3">
            <div className="text-sm"><div className="font-medium">Permitir enviar nomes de convidados à IA</div><div className="text-xs text-muted-foreground">Desligado: o assistente responde só com números, sem listar pessoas.</div></div>
            <Switch checked={!!share.value} disabled={!can("settings:edit")} onCheckedChange={(v) => setShare.mutate({ key: "ai.shareGuestData", value: v })} />
          </div>
        )}
      </Section>
      {can("guests:view") && (
        <Section title="Pedidos de exclusão de dados" description="Registrados a partir do cadastro do convidado.">
          <QueryState query={requests} empty={(l) => (!l.length ? <EmptyState icon={<ShieldCheck />} title="Nenhum pedido" description="Quando um convidado pedir a exclusão dos dados, registre o pedido na ficha dele." /> : null)}>
            {(list) => (
              <ul className="divide-y">
                {list.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                    <StatusBadge tone={REQ_TONE[r.status as keyof typeof REQ_TONE] ?? "neutral"}>{REQ_LABEL[r.status] ?? r.status}</StatusBadge>
                    <div className="min-w-0 flex-1">
                      <div>Titular: {r.subjectType} <code className="text-xs">{r.subjectId}</code></div>
                      <div className="text-xs text-muted-foreground">Pedido {dateTime(r.createdAt)}{r.reason ? ` · ${r.reason}` : ""}{r.resolution ? ` · ${r.resolution}` : ""}{r.resolvedAt ? ` (${dateTime(r.resolvedAt)})` : ""}</div>
                    </div>
                    {r.status === "PENDING" && (
                      <div className="flex gap-2">
                        {can("guests:delete") && <Button size="sm" variant="ghost" onClick={() => setReject(r.id)}>Recusar</Button>}
                        {can("guests:delete") && can("settings:edit") && <Button size="sm" variant="destructive" onClick={() => setExec(r.id)}>Executar exclusão</Button>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </Section>
      )}
      <ConfirmDialog
        open={!!exec}
        onOpenChange={(o) => !o && setExec(null)}
        title="Anonimizar dados pessoais?"
        description="Nome, telefone, e-mail, restrições, observações, IP das respostas e o conteúdo das mensagens desta pessoa serão apagados de forma IRREVERSÍVEL. As contagens e o histórico estatístico são mantidos."
        destructive
        confirmLabel="Anonimizar definitivamente"
        loading={execute.isPending}
        onConfirm={() => exec && execute.mutate({ requestId: exec })}
      />
      <ConfirmDialog open={!!reject} onOpenChange={(o) => !o && setReject(null)} title="Recusar pedido" description="Explique o motivo (por exemplo, obrigação legal de retenção)." confirmLabel="Recusar" loading={rej.isPending} onConfirm={() => { if (resolution.trim().length < 3) return toast.error("Informe o motivo"); if (reject) rej.mutate({ requestId: reject, resolution: resolution.trim() }); }}>
        <Textarea value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Motivo" />
      </ConfirmDialog>
    </div>
  );
}

// ───────────── Página ─────────────

const TABS = ["casamento", "fotos", "aparencia", "operacional", "integracoes", "privacidade"] as const;

export function SettingsPage() {
  const { can } = useMe();
  const [params, setParams] = useSearchParams();
  const wedding = trpc.wedding.get.useQuery();
  const tab = TABS.includes(params.get("aba") as (typeof TABS)[number]) ? params.get("aba")! : "casamento";
  return (
    <>
      <PageHeader title="Configurações" description="Dados do casamento, parâmetros operacionais, integrações e privacidade." />
      <Tabs value={tab} onValueChange={(v) => setParams({ aba: v }, { replace: true })}>
        <TabsList className="mb-4 max-w-full overflow-x-auto scrollbar-none">
          <TabsTrigger value="casamento">Casamento</TabsTrigger>
          <TabsTrigger value="fotos">Fotos do casal</TabsTrigger>
          <TabsTrigger value="aparencia">Aparência</TabsTrigger>
          <TabsTrigger value="operacional">Operacional</TabsTrigger>
          {can("integrations:view") && <TabsTrigger value="integracoes">Integrações</TabsTrigger>}
          <TabsTrigger value="privacidade">Privacidade</TabsTrigger>
        </TabsList>
        <TabsContent value="casamento"><QueryState query={wedding}>{(w) => <WeddingTab key={w.updatedAt.toString()} w={w} />}</QueryState></TabsContent>
        <TabsContent value="fotos"><CouplePhotosPanel /></TabsContent>
        <TabsContent value="aparencia"><AppearancePanel /></TabsContent>
        <TabsContent value="operacional"><OperationalTab /></TabsContent>
        {can("integrations:view") && <TabsContent value="integracoes"><IntegrationsTab /></TabsContent>}
        <TabsContent value="privacidade"><PrivacyTab /></TabsContent>
      </Tabs>
    </>
  );
}

