import { Bot, Check, ListChecks, Loader2, MessageSquarePlus, PanelLeft, Send, Settings2, ShieldCheck, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import { Link, useSearchParams } from "react-router";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { ConfirmDialog, EmptyState, LoadingButton, PageLoader, StatusBadge } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useMe } from "@/hooks/use-me";
import { dateTime, relative } from "@/lib/format";
import { PROPOSAL_STATUS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { trpc, type RouterOutputs } from "@/trpc";

type Proposal = RouterOutputs["ai"]["proposals"][number];
type Source = { type: string; id: string; label: string };

const EXAMPLES = [
  "Quanto já gastamos?",
  "Quais parcelas vencem nos próximos 30 dias?",
  "Quais tarefas estão atrasadas?",
  "Quem ainda não respondeu?",
  "Quais contratos têm multa de cancelamento?",
  "O que precisamos resolver nesta semana?",
  "Quanto custa cada convidado?",
];

const ACTION_LABEL: Record<string, string> = {
  createTask: "Criar tarefa",
  updateTaskStatus: "Alterar status de tarefa",
  createCalendarEvent: "Criar compromisso",
  createVendor: "Cadastrar fornecedor",
  createObligationDraft: "Criar lançamento (rascunho)",
};

function sourceLink(s: Source) {
  switch (s.type) {
    case "vendor": return `/fornecedores/${s.id}`;
    case "obligation": return `/financeiro/lancamentos/${s.id}`;
    case "task": return `/checklist?tarefa=${s.id}`;
    case "event": return `/calendario?evento=${s.id}`;
    case "file":
    case "contract": return "/documentos";
    case "finance": return "/financeiro";
    case "guests": return "/convidados";
    default: return "/";
  }
}

function Json({ value }: { value: unknown }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  if (typeof value !== "object") return <span>{String(value)}</span>;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
      {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{typeof v === "object" && v !== null ? <pre className="text-[11px] whitespace-pre-wrap">{JSON.stringify(v, null, 2)}</pre> : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ProposalCard({ p }: { p: Proposal }) {
  const { can } = useMe();
  const utils = trpc.useUtils();
  const [confirm, setConfirm] = useState(false);
  const decide = trpc.ai.decide.useMutation({
    onSuccess: (r) => {
      toast.success(r.status === "EXECUTED" ? "Sugestão aprovada e executada" : "Sugestão recusada");
      setConfirm(false);
      utils.ai.invalidate();
      utils.dashboard.invalidate();
    },
    onError: (e) => {
      toast.error(e.message);
      setConfirm(false);
      utils.ai.invalidate();
    },
  });
  const canDecide = can("ai:approve") && can(p.requiredPermission);
  return (
    <div className="rounded-xl border border-gold/50 bg-gold/5 p-4 text-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-gold-foreground" />
        <span className="font-medium">{ACTION_LABEL[p.action] ?? p.action}</span>
        <StatusBadge tone={PROPOSAL_STATUS[p.status]!.tone}>{PROPOSAL_STATUS[p.status]!.label}</StatusBadge>
        <span className="ml-auto text-xs text-muted-foreground">{relative(p.createdAt)}</span>
      </div>
      <p className="mb-3">{p.summary}</p>
      <div className="grid gap-3 text-xs md:grid-cols-2">
        {p.currentData != null && (
          <div className="rounded-xl border bg-card p-2.5"><div className="mb-1 font-medium">Dados atuais</div><Json value={p.currentData} /></div>
        )}
        <div className="rounded-xl border bg-card p-2.5"><div className="mb-1 font-medium">Dados propostos</div><Json value={p.payload} /></div>
      </div>
      <div className="mt-3 space-y-0.5 text-xs text-muted-foreground">
        {p.origin && <div><b>Origem:</b> {p.origin}</div>}
        {p.impact && <div><b>Impacto:</b> {p.impact}</div>}
        <div><b>Permissão exigida:</b> ai:approve + {p.requiredPermission}</div>
      </div>
      {p.error && <p className="mt-2 text-xs text-destructive">Erro: {p.error}</p>}
      {p.status === "EXECUTED" && p.decidedAt && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">Executada em {dateTime(p.executedAt ?? p.decidedAt)}</p>}
      {p.status === "PENDING" && (
        canDecide ? (
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => setConfirm(true)}><Check /> Aprovar</Button>
            <LoadingButton size="sm" variant="outline" loading={decide.isPending && decide.variables?.decision === "reject"} onClick={() => decide.mutate({ id: p.id, decision: "reject" })}><X /> Recusar</LoadingButton>
          </div>
        ) : <p className="mt-3 text-xs text-muted-foreground">Você não tem permissão para aprovar esta sugestão.</p>
      )}
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Aprovar e executar?" description={`${ACTION_LABEL[p.action] ?? p.action}: ${p.summary}. A alteração será registrada na auditoria.`} confirmLabel="Aprovar" loading={decide.isPending} onConfirm={() => decide.mutate({ id: p.id, decision: "approve" })} />
    </div>
  );
}

function Notice() {
  return (
    <div className="flex items-start gap-2 rounded-xl border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
      A IA não executa nada sem sua aprovação; pagamentos, mensagens e exclusões não podem ser feitos pela IA. Respostas usam apenas os dados que você tem permissão de ver.
    </div>
  );
}

function Conversations({ active, onSelect, onNew }: { active: string | null; onSelect: (id: string) => void; onNew: () => void }) {
  const q = trpc.ai.conversations.useQuery();
  const usage = trpc.ai.usage.useQuery();
  const utils = trpc.useUtils();
  const [del, setDel] = useState<string | null>(null);
  const remove = trpc.ai.deleteConversation.useMutation({
    onSuccess: () => {
      if (del === active) onNew();
      setDel(null);
      utils.ai.conversations.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const tokens = (usage.data ?? []).reduce((a, u) => a + u.inputTokens + u.outputTokens, 0);
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <Button onClick={onNew} className="w-full"><MessageSquarePlus /> Nova conversa</Button>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {q.isLoading ? <PageLoader /> : !q.data?.length ? <p className="p-2 text-xs text-muted-foreground">Nenhuma conversa ainda.</p> : (
          <ul className="space-y-0.5">
            {q.data.map((c) => (
              <li key={c.id} className={cn("group flex items-center gap-1 rounded-lg", c.id === active ? "bg-accent" : "hover:bg-muted/60")}>
                <button onClick={() => onSelect(c.id)} className="min-w-0 flex-1 px-2.5 py-2 text-left">
                  <div className="truncate text-sm">{c.title ?? "Conversa"}</div>
                  <div className="text-[11px] text-muted-foreground">{relative(c.updatedAt)}</div>
                </button>
                <Button size="icon-xs" variant="ghost" className="mr-1 opacity-60 group-hover:opacity-100" aria-label="Excluir conversa" onClick={() => setDel(c.id)}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-xl border p-2.5 text-[11px] text-muted-foreground">
        Uso no mês: <b>{tokens.toLocaleString("pt-BR")}</b> tokens
        {usage.data?.map((u) => <div key={u.feature}>{u.feature}: {u.calls} chamada(s)</div>)}
      </div>
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title="Excluir conversa?" destructive confirmLabel="Excluir" loading={remove.isPending} onConfirm={() => del && remove.mutate({ id: del })} />
    </div>
  );
}

type Msg = { id: string; role: string; content: string; sources: Source[]; createdAt: Date | string };

function MessageBubble({ m }: { m: Msg }) {
  if (m.role === "user") {
    return <div className="flex justify-end"><div className="max-w-[85%] rounded-xl rounded-br-sm bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground">{m.content}</div></div>;
  }
  return (
    <div className="flex gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand text-white"><Bot className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="max-w-none text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_h1]:text-lg [&_h2]:text-base [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_strong]:font-semibold [&_table]:my-2 [&_table]:w-full [&_table]:text-xs [&_td]:border-t [&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_th]:text-left [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
        </div>
        {m.sources.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <span className="text-[11px] text-muted-foreground">Fontes:</span>
            {m.sources.slice(0, 12).map((s) => (
              <Link key={`${s.type}:${s.id}`} to={sourceLink(s)} className="rounded-full border bg-card px-2 py-0.5 text-[11px] hover:border-primary">{s.label}</Link>
            ))}
            {m.sources.length > 12 && <span className="text-[11px] text-muted-foreground">+{m.sources.length - 12}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

export function AssistantPage() {
  const [params, setParams] = useSearchParams();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [mobileList, setMobileList] = useState(false);
  const showProposals = params.get("propostas") === "1";
  const utils = trpc.useUtils();
  const conv = trpc.ai.conversation.useQuery({ id: conversationId! }, { enabled: !!conversationId });
  const pendingProposals = trpc.ai.proposals.useQuery({ status: "PENDING" });
  const scrollRef = useRef<HTMLDivElement>(null);

  const ask = trpc.ai.ask.useMutation({
    onSuccess: async (r) => {
      setPending(null);
      setConversationId(r.conversationId);
      await Promise.all([utils.ai.conversation.invalidate({ id: r.conversationId }), utils.ai.conversations.invalidate(), utils.ai.proposals.invalidate(), utils.ai.usage.invalidate()]);
    },
    onError: (e) => {
      setPending(null);
      if (e.data?.code === "PRECONDITION_FAILED") {
        toast.error(e.message, { action: { label: "Configurar", onClick: () => (window.location.href = "/configuracoes?aba=integracoes") } });
      } else toast.error(e.message);
      if (conversationId) utils.ai.conversation.invalidate({ id: conversationId });
    },
  });

  const messages: Msg[] = (conv.data?.messages ?? []).map((m) => ({ ...m, sources: (m.sources ?? []) as Source[] }));
  const proposals = conv.data?.proposals ?? [];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, pending, proposals.length]);

  function send(text = input) {
    const t = text.trim();
    if (!t || ask.isPending) return;
    setPending(t);
    setInput("");
    ask.mutate({ conversationId, message: t });
  }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }
  const newConversation = () => { setConversationId(null); setMobileList(false); };
  const pendingCount = pendingProposals.data?.length ?? 0;
  const configError = ask.error?.data?.code === "PRECONDITION_FAILED" ? ask.error.message : null;

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-72 shrink-0 border-r bg-sidebar/50 lg:block">
        <Conversations active={conversationId} onSelect={setConversationId} onNew={newConversation} />
      </aside>
      <Sheet open={mobileList} onOpenChange={setMobileList}>
        <SheetContent side="left" size="sm" className="p-0">
          <SheetHeader><SheetTitle>Conversas</SheetTitle></SheetHeader>
          <Conversations active={conversationId} onSelect={(id) => { setConversationId(id); setMobileList(false); }} onNew={newConversation} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b px-4 py-2.5">
          <Button size="icon-sm" variant="ghost" className="lg:hidden" aria-label="Conversas" onClick={() => setMobileList(true)}><PanelLeft /></Button>
          <Bot className="size-5 text-primary" />
          <h1 className="min-w-0 flex-1 truncate font-heading text-xl font-semibold">{conv.data?.title ?? "Assistente do casamento"}</h1>
          <Button size="sm" variant={showProposals ? "secondary" : "ghost"} onClick={() => setParams(showProposals ? {} : { propostas: "1" })}>
            <ListChecks /> Propostas{pendingCount ? <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{pendingCount}</span> : null}
          </Button>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
            {showProposals && (
              <section className="space-y-3">
                <h2 className="text-xl font-semibold">Propostas pendentes</h2>
                {pendingProposals.isLoading ? <PageLoader /> : pendingCount ? pendingProposals.data!.map((p) => <ProposalCard key={p.id} p={p} />) : <p className="text-sm text-muted-foreground">Nenhuma sugestão aguardando aprovação.</p>}
                <hr />
              </section>
            )}
            {configError && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                <Settings2 className="size-4" /> <span className="flex-1">{configError}</span>
                <Button asChild size="sm" variant="outline"><Link to="/configuracoes?aba=integracoes">Configurar IA</Link></Button>
              </div>
            )}
            {conversationId && conv.isLoading ? <PageLoader /> : !messages.length && !pending ? (
              <EmptyState
                icon={<Sparkles />}
                title="Pergunte sobre o planejamento"
                description="Respostas baseadas nos dados reais do casamento, com as fontes usadas. Peça também para criar tarefas, compromissos ou fornecedores — você aprova antes."
                action={
                  <div className="flex max-w-xl flex-wrap justify-center gap-2">
                    {EXAMPLES.map((e) => <button key={e} onClick={() => send(e)} disabled={ask.isPending} className="rounded-full border bg-card px-3 py-1.5 text-sm transition hover:border-primary">{e}</button>)}
                  </div>
                }
              />
            ) : (
              <>
                {messages.map((m) => <MessageBubble key={m.id} m={m} />)}
                {pending && (
                  <>
                    {(!messages.length || messages[messages.length - 1]?.content !== pending) && <MessageBubble m={{ id: "pending", role: "user", content: pending, sources: [], createdAt: new Date() }} />}
                    <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Pensando e consultando os dados…</div>
                  </>
                )}
                {proposals.length > 0 && <div className="space-y-3">{proposals.map((p) => <ProposalCard key={p.id} p={p} />)}</div>}
              </>
            )}
          </div>
        </div>

        <div className="border-t bg-background px-4 py-3">
          <div className="mx-auto max-w-3xl space-y-2">
            <div className="flex items-end gap-2">
              <Textarea rows={1} className="max-h-40 min-h-11 resize-none" placeholder="Pergunte algo… (Enter envia, Shift+Enter quebra linha)" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} disabled={ask.isPending} maxLength={4000} />
              <LoadingButton size="icon-lg" className="size-11" loading={ask.isPending} disabled={!input.trim()} onClick={() => send()} aria-label="Enviar">{!ask.isPending && <Send />}</LoadingButton>
            </div>
            <Notice />
          </div>
        </div>
      </div>
    </div>
  );
}
