import { ChevronDown, ChevronRight, DatabaseBackup, ScrollText, ShieldAlert } from "lucide-react";
import { Fragment, useState } from "react";
import { EmptyState, Field, LoadingButton, PageHeader, QueryState, Section, StatusBadge, type Tone } from "@/components/app/common";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMe } from "@/hooks/use-me";
import { dateTime, fileSize, fromDateInput } from "@/lib/format";
import { trpc } from "@/trpc";

const ALL = "__all__";
const ORIGINS = [
  { value: "web", label: "Painel" },
  { value: "portal", label: "Portal dos convidados" },
  { value: "ai", label: "IA (aprovada)" },
  { value: "webhook", label: "Webhook" },
  { value: "worker", label: "Rotina automática" },
  { value: "system", label: "Sistema" },
];
const RESULT_TONE: Record<string, Tone> = { success: "emerald", failure: "rose", denied: "amber" };
const SECURITY_LABEL: Record<string, string> = {
  login_failed: "Login falhou", login_blocked_inactive: "Login de conta desativada", forbidden: "Acesso negado", forbidden_wedding: "Acesso a outro casamento",
  rate_limited: "Limite de requisições", invalid_webhook: "Webhook inválido", invalid_invite_token: "Convite inválido", password_reset_requested: "Redefinição de senha solicitada",
};

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <Field label={label}>
      <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos</SelectItem>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
}

function LogTab() {
  const facets = trpc.audit.facets.useQuery();
  const [f, setF] = useState({ entityType: "", action: "", userId: "", origin: "", from: "", to: "", search: "" });
  const [open, setOpen] = useState<string | null>(null);
  const input = {
    entityType: f.entityType || undefined, action: f.action || undefined, userId: f.userId || undefined, origin: f.origin || undefined,
    from: fromDateInput(f.from) ?? undefined, to: f.to ? new Date(`${f.to}T23:59:59`) : undefined, search: f.search || undefined,
  };
  const q = trpc.audit.list.useInfiniteQuery(input, { getNextPageParam: (p) => p.nextCursor ?? undefined, initialCursor: undefined });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <Field label="Buscar" className="lg:col-span-2 xl:col-span-1"><Input value={f.search} onChange={(e) => set("search")(e.target.value)} placeholder="Resumo…" /></Field>
        <Filter label="Entidade" value={f.entityType} onChange={set("entityType")} options={(facets.data?.types ?? []).map((t) => ({ value: t, label: t }))} />
        <Filter label="Ação" value={f.action} onChange={set("action")} options={(facets.data?.actions ?? []).map((t) => ({ value: t, label: t }))} />
        <Filter label="Usuário" value={f.userId} onChange={set("userId")} options={(facets.data?.users ?? []).map((u) => ({ value: u.id, label: u.name ?? u.id }))} />
        <Filter label="Origem" value={f.origin} onChange={set("origin")} options={ORIGINS} />
        <Field label="De"><Input type="date" value={f.from} onChange={(e) => set("from")(e.target.value)} /></Field>
        <Field label="Até"><Input type="date" value={f.to} onChange={(e) => set("to")(e.target.value)} /></Field>
      </div>
      <QueryState query={{ ...q, data: q.data }} empty={() => (!items.length ? <EmptyState icon={<ScrollText />} title="Nenhum registro" description="Nada encontrado com esses filtros." /> : null)}>
        {() => (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Data</TableHead>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Ação</TableHead>
                  <TableHead>Entidade</TableHead>
                  <TableHead>Resumo</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Resultado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((a) => {
                  const expandable = a.changes != null;
                  const isOpen = open === a.id;
                  return (
                    <Fragment key={a.id}>
                      <TableRow className={expandable ? "cursor-pointer" : undefined} onClick={() => expandable && setOpen(isOpen ? null : a.id)}>
                        <TableCell>{expandable && (isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />)}</TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">{dateTime(a.createdAt)}</TableCell>
                        <TableCell className="whitespace-nowrap">{a.userName ?? "—"}</TableCell>
                        <TableCell><code className="text-xs">{a.action}</code></TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{a.entityType}</TableCell>
                        <TableCell className="min-w-64">{a.summary}</TableCell>
                        <TableCell className="text-xs">{ORIGINS.find((o) => o.value === a.origin)?.label ?? a.origin}</TableCell>
                        <TableCell><StatusBadge tone={RESULT_TONE[a.result] ?? "neutral"}>{a.result}</StatusBadge></TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow>
                          <TableCell colSpan={8} className="bg-muted/40">
                            <pre className="max-h-80 overflow-auto rounded-lg bg-background p-3 text-xs whitespace-pre-wrap">{JSON.stringify(a.changes, null, 2)}</pre>
                            <div className="mt-1 text-xs text-muted-foreground">ID {a.entityId ?? "—"} · correlação {a.correlationId ?? "—"} · IP {a.ip ?? "—"}</div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </QueryState>
      {q.hasNextPage && (
        <div className="flex justify-center"><LoadingButton variant="outline" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Carregar mais</LoadingButton></div>
      )}
    </div>
  );
}

function SecurityTab() {
  const q = trpc.audit.security.useQuery();
  return (
    <QueryState query={q} empty={(l) => (!l.length ? <EmptyState icon={<ShieldAlert />} title="Nenhum evento de segurança" description="Tentativas de login falhas, acessos negados e webhooks inválidos aparecem aqui." /> : null)}>
      {(list) => (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Evento</TableHead><TableHead>IP</TableHead><TableHead>Detalhes</TableHead></TableRow></TableHeader>
            <TableBody>
              {list.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap tabular-nums">{dateTime(e.createdAt)}</TableCell>
                  <TableCell><StatusBadge tone={e.type.includes("failed") || e.type.includes("forbidden") || e.type.includes("invalid") ? "rose" : "amber"}>{SECURITY_LABEL[e.type] ?? e.type}</StatusBadge></TableCell>
                  <TableCell className="text-xs">{e.ip ?? "—"}</TableCell>
                  <TableCell><code className="text-xs break-all">{e.details ? JSON.stringify(e.details) : "—"}</code></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </QueryState>
  );
}

function BackupsTab() {
  const q = trpc.audit.backups.useQuery();
  return (
    <div className="space-y-4">
      <Section title="Procedimento" description="Os backups rodam fora da aplicação, pelos scripts em deploy/.">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li><code>deploy/backup.sh</code> gera o dump do PostgreSQL (pg_dump, formato custom), calcula o SHA-256 e registra a execução aqui.</li>
          <li>Cada backup é verificado restaurando em um banco temporário; só então recebe a data de verificação.</li>
          <li><code>deploy/restore.sh</code> restaura um dump escolhido. Os arquivos (fotos, contratos) ficam no armazenamento de objetos, com backup próprio.</li>
          <li>Um backup sem verificação de restauração não deve ser considerado válido.</li>
        </ul>
      </Section>
      <QueryState query={q} empty={(l) => (!l.length ? <EmptyState icon={<DatabaseBackup />} title="Nenhum backup registrado" description="Execute deploy/backup.sh (ou agende-o no servidor)." /> : null)}>
        {(list) => (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader><TableRow><TableHead>Início</TableHead><TableHead>Fim</TableHead><TableHead>Status</TableHead><TableHead>Tamanho</TableHead><TableHead>Verificado</TableHead><TableHead>Local</TableHead></TableRow></TableHeader>
              <TableBody>
                {list.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="whitespace-nowrap">{dateTime(b.startedAt)}</TableCell>
                    <TableCell className="whitespace-nowrap">{dateTime(b.finishedAt)}</TableCell>
                    <TableCell><StatusBadge tone={b.status === "DONE" ? "emerald" : b.status === "FAILED" ? "rose" : "amber"}>{b.status}</StatusBadge>{b.error && <div className="mt-1 text-xs text-destructive">{b.error}</div>}</TableCell>
                    <TableCell>{b.sizeBytes ? fileSize(b.sizeBytes) : "—"}</TableCell>
                    <TableCell>{b.verifiedAt ? dateTime(b.verifiedAt) : <span className="text-amber-600">não verificado</span>}</TableCell>
                    <TableCell className="max-w-64 truncate text-xs">{b.location ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </QueryState>
    </div>
  );
}

export function AuditPage() {
  const { me } = useMe();
  return (
    <>
      <PageHeader title="Auditoria e histórico" description="Registro somente de inclusão: ninguém pode editar ou apagar estes registros pelo sistema." />
      <Alert className="mb-5"><AlertDescription>Senhas, tokens e chaves nunca são gravados aqui — campos sensíveis aparecem como “[omitido]”.</AlertDescription></Alert>
      <Tabs defaultValue="log">
        <TabsList className="mb-4">
          <TabsTrigger value="log">Ações</TabsTrigger>
          <TabsTrigger value="security">Segurança</TabsTrigger>
          {me?.user.isSuperAdmin && <TabsTrigger value="backups">Backups</TabsTrigger>}
        </TabsList>
        <TabsContent value="log"><LogTab /></TabsContent>
        <TabsContent value="security"><SecurityTab /></TabsContent>
        {me?.user.isSuperAdmin && <TabsContent value="backups"><BackupsTab /></TabsContent>}
      </Tabs>
    </>
  );
}
