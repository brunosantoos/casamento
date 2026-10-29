import { AlertTriangle, Bot, Download, Eye, FileText, Info, Loader2, Pencil, RotateCcw, Search, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog, EmptyState, LoadingButton, PageHeader, QueryState, StatusBadge, TextField, type Tone } from "@/components/app/common";
import { uploadFile, UploadButton, useOpenFile } from "@/components/app/files";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMe } from "@/hooks/use-me";
import { date, dateTime, fileSize, money } from "@/lib/format";
import { CONTRACT_STATUS, FILE_CATEGORY, opt, RISK } from "@/lib/labels";
import { trpc } from "@/trpc";
import { SelectField } from "./vendors/Vendors";

const ANALYSIS_STATUS: Record<string, { label: string; tone: Tone }> = { QUEUED: { label: "Na fila", tone: "neutral" }, RUNNING: { label: "Analisando", tone: "sky" }, DONE: { label: "Concluída", tone: "emerald" }, FAILED: { label: "Falhou", tone: "rose" } };
const TOPIC: Record<string, string> = {
  partes: "Partes", objeto: "Objeto", valores: "Valores", parcelas: "Parcelas", datas: "Datas e vencimentos", reajuste: "Reajuste", multa: "Multas", cancelamento: "Cancelamento",
  reembolso: "Reembolso", obrigacoes: "Obrigações", prazo_entrega: "Prazos de entrega", condicoes_pagamento: "Condições de pagamento", taxas_extras: "Taxas extras", caucao: "Caução", atencao: "Pontos de atenção", outro: "Outros",
};
const ENTITY: Record<string, string> = { vendor: "Fornecedor", task: "Tarefa", obligation: "Lançamento", payment: "Pagamento", income: "Entrada", contract: "Contrato", quote: "Orçamento", ceremony: "Cerimônia", venue: "Local", guest: "Convidado", event: "Compromisso" };
const onErr = (e: { message: string }) => toast.error(e.message);

// ───────────── Contratos

function ContractsTab() {
  const [status, setStatus] = useState<string | null>(null);
  const { can } = useMe();
  const q = trpc.vendors.contracts.useQuery(status ? { status: status as never } : undefined);
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2"><SelectField className="w-52" allowNone noneLabel="Todos os status" value={status} onChange={setStatus} options={opt(CONTRACT_STATUS)} /></div>
      <QueryState query={q} empty={(d) => (d.length ? null : <EmptyState icon={<FileText />} title="Nenhum contrato" description="Contratos são cadastrados na página de cada fornecedor." action={<Button asChild><Link to="/fornecedores">Ir para fornecedores</Link></Button>} />)}>
        {(list) => (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b text-left text-muted-foreground"><th className="p-3 font-medium">Contrato</th><th className="p-3 font-medium">Fornecedor</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium">Serviço</th><th className="p-3 font-medium">Prazo</th>{can("finance:view") && <th className="p-3 text-right font-medium">Valor</th>}<th className="p-3 font-medium">Obrigações</th></tr></thead>
              <tbody>
                {list.map((c) => {
                  const pending = c.clauses.filter((k) => !k.doneAt);
                  const late = pending.filter((k) => k.dueDate && new Date(k.dueDate) < new Date());
                  return (
                    <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="p-3"><Link to={`/fornecedores/${c.vendor.id}`} className="font-medium hover:text-primary">{c.title}</Link></td>
                      <td className="p-3">{c.vendor.name}</td>
                      <td className="p-3"><StatusBadge tone={CONTRACT_STATUS[c.status]?.tone}>{CONTRACT_STATUS[c.status]?.label}</StatusBadge></td>
                      <td className="p-3 tabular-nums">{date(c.serviceDate)}</td>
                      <td className="p-3 tabular-nums">{date(c.expiresAt)}</td>
                      {can("finance:view") && <td className="p-3 text-right tabular-nums">{money(c.totalCents)}</td>}
                      <td className="p-3 text-xs">{pending.length ? <span className={late.length ? "text-destructive" : ""}>{pending.length} pendente(s){late.length ? `, ${late.length} atrasada(s)` : ""}</span> : <span className="text-muted-foreground">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
    </>
  );
}

// ───────────── Arquivos

function FileDetails({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { can } = useMe();
  const q = trpc.files.get.useQuery({ id: id ?? "" }, { enabled: !!id });
  const utils = trpc.useUtils();
  const open = useOpenFile();
  const url = trpc.files.url.useMutation();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{ category: string; description: string | null } | null>(null);
  const update = trpc.files.update.useMutation({ onSuccess: () => { toast.success("Arquivo atualizado"); setEdit(null); utils.files.invalidate(); }, onError: onErr });
  async function newVersion(f: File | undefined) {
    if (!f || !q.data) return;
    setBusy(true);
    try {
      await uploadFile(f, { category: q.data.category, replaceFileId: q.data.id });
      toast.success("Nova versão enviada");
      await utils.files.invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  }
  async function openVersion(version: number) {
    try {
      const r = await url.mutateAsync({ id: id!, inline: false, version });
      window.open(r.url, "_blank", "noopener");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="lg" className="overflow-y-auto">
        <SheetHeader><SheetTitle>Detalhes do arquivo</SheetTitle></SheetHeader>
        <div className="px-5 py-5">
          <QueryState query={q}>
            {(f) => (
              <div className="space-y-4 text-sm">
                <div>
                  <div className="font-medium break-all">{f.originalName}</div>
                  <div className="text-xs text-muted-foreground">{FILE_CATEGORY[f.category] ?? f.category} · versão {f.version}</div>
                </div>
                {f.description && <p className="text-muted-foreground">{f.description}</p>}
                <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-xs">
                  <dt className="text-muted-foreground">Tipo</dt><dd>{f.mimeType}</dd>
                  <dt className="text-muted-foreground">Tamanho</dt><dd>{fileSize(f.size)}</dd>
                  <dt className="text-muted-foreground">Enviado por</dt><dd>{(f.uploadedById && f.users[f.uploadedById]) ?? "—"}</dd>
                  <dt className="text-muted-foreground">Enviado em</dt><dd>{dateTime(f.createdAt)}</dd>
                  <dt className="text-muted-foreground">Vínculo</dt><dd>{f.entityType ? ENTITY[f.entityType] ?? f.entityType : "—"}</dd>
                  <dt className="text-muted-foreground">SHA-256</dt><dd className="font-mono break-all">{f.sha256}</dd>
                </dl>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => open(f.id, true)}><Eye /> Visualizar</Button>
                  <Button size="sm" variant="outline" onClick={() => open(f.id, false)}><Download /> Baixar</Button>
                  {can("documents:edit") && <Button size="sm" variant="outline" onClick={() => setEdit({ category: f.category, description: f.description })}><Pencil /> Classificar</Button>}
                  {can("documents:create") && !f.deletedAt && (
                    <>
                      <input ref={ref} type="file" className="hidden" onChange={(e) => newVersion(e.target.files?.[0])} />
                      <LoadingButton size="sm" variant="outline" loading={busy} onClick={() => ref.current?.click()}>{!busy && <Upload />} Nova versão</LoadingButton>
                    </>
                  )}
                </div>
                <div>
                  <div className="mb-1 font-medium">Histórico de versões</div>
                  <ul className="divide-y rounded-xl border">
                    {f.versions.map((v) => (
                      <li key={v.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                        <span className="font-medium">v{v.version}</span>
                        <span className="min-w-0 flex-1 truncate">{v.originalName} · {fileSize(v.size)}</span>
                        <span className="text-muted-foreground">{date(v.createdAt)}{v.createdById && f.users[v.createdById] ? ` · ${f.users[v.createdById]}` : ""}</span>
                        <Button size="icon-xs" variant="ghost" aria-label="Baixar versão" onClick={() => openVersion(v.version)}><Download /></Button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </QueryState>
        </div>
        <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Classificar arquivo</DialogTitle></DialogHeader>
            {edit && (
              <div className="grid gap-3">
                <SelectField label="Categoria" value={edit.category} onChange={(c) => c && setEdit({ ...edit, category: c })} options={opt(FILE_CATEGORY)} />
                <TextField label="Descrição" multiline value={edit.description} onChange={(d) => setEdit({ ...edit, description: d })} />
              </div>
            )}
            <DialogFooter><LoadingButton loading={update.isPending} onClick={() => edit && id && update.mutate({ id, ...edit })}>Salvar</LoadingButton></DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}

function FilesTab({ onOpenAnalysis }: { onOpenAnalysis: (id: string) => void }) {
  const { can } = useMe();
  const [category, setCategory] = useState<string | null>(null);
  const [uploadCategory, setUploadCategory] = useState("DOCUMENT");
  const [search, setSearch] = useState("");
  const [deleted, setDeleted] = useState(false);
  const [details, setDetails] = useState<string | null>(null);
  const [del, setDel] = useState<{ id: string; name: string } | null>(null);
  const utils = trpc.useUtils();
  const open = useOpenFile();
  const q = trpc.files.list.useQuery({ category: category ?? undefined, search: search || undefined, deleted });
  const remove = trpc.files.delete.useMutation({ onSuccess: () => { toast.success("Arquivo excluído (recuperável durante a retenção)"); setDel(null); utils.files.invalidate(); }, onError: onErr });
  const restore = trpc.files.restore.useMutation({ onSuccess: () => { toast.success("Arquivo restaurado"); utils.files.invalidate(); }, onError: onErr });
  const analyze = trpc.files.analyze.useMutation({ onSuccess: (a) => { toast.success("Análise solicitada"); utils.files.invalidate(); onOpenAnalysis(a.id); }, onError: onErr });
  const uploadCats = opt(FILE_CATEGORY).filter((c) => !["PHOTO", "INSPIRATION"].includes(c.value) && (c.value !== "RECEIPT" || can("finance:create")));
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar por nome ou descrição" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <SelectField className="w-44" allowNone noneLabel="Todas as categorias" value={category} onChange={setCategory} options={opt(FILE_CATEGORY)} />
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={deleted} onCheckedChange={(v) => setDeleted(!!v)} /> Excluídos</label>
        {can("documents:create") && (
          <div className="flex items-center gap-2">
            <SelectField className="w-40" value={uploadCategory} onChange={(c) => c && setUploadCategory(c)} options={uploadCats} />
            <UploadButton category={uploadCategory} multiple variant="default" />
          </div>
        )}
      </div>
      <QueryState query={q} empty={(d) => (d.length ? null : <EmptyState icon={<FileText />} title={deleted ? "Nenhum arquivo excluído" : "Nenhum arquivo"} description="Envie contratos, comprovantes e documentos. Eles ficam em armazenamento privado." />)}>
        {(list) => (
          <ul className="divide-y rounded-xl border bg-card">
            {list.map((f) => {
              const a = f.analyses[0];
              return (
                <li key={f.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <button className="min-w-0 flex-1 text-left" onClick={() => setDetails(f.id)}>
                    <div className="truncate font-medium hover:text-primary">{f.originalName}</div>
                    <div className="truncate text-xs text-muted-foreground">{FILE_CATEGORY[f.category] ?? f.category}{f.version > 1 ? ` · v${f.version}` : ""} · {fileSize(f.size)} · {date(f.createdAt)}{f.entityType ? ` · ${ENTITY[f.entityType] ?? f.entityType}` : ""}{f.description ? ` · ${f.description}` : ""}</div>
                  </button>
                  {a && <button onClick={() => onOpenAnalysis(a.id)}><StatusBadge tone={ANALYSIS_STATUS[a.status]?.tone}><Bot className="size-3" /> {ANALYSIS_STATUS[a.status]?.label}</StatusBadge></button>}
                  {f.deletedAt ? (
                    can("documents:delete") && <Button size="sm" variant="outline" onClick={() => restore.mutate({ id: f.id })}><RotateCcw /> Restaurar</Button>
                  ) : (
                    <div className="flex items-center">
                      {can("ai:create") && /pdf|image|text/.test(f.mimeType) && (!a || a.status === "DONE" || a.status === "FAILED") && (
                        <Button size="icon-sm" variant="ghost" aria-label="Analisar com IA" title="Analisar com IA" disabled={analyze.isPending} onClick={() => analyze.mutate({ fileId: f.id })}><Bot /></Button>
                      )}
                      <Button size="icon-sm" variant="ghost" aria-label="Visualizar" onClick={() => open(f.id, true)}><Eye /></Button>
                      <Button size="icon-sm" variant="ghost" aria-label="Baixar" onClick={() => open(f.id, false)}><Download /></Button>
                      {can("documents:delete") && <Button size="icon-sm" variant="ghost" aria-label="Excluir" onClick={() => setDel({ id: f.id, name: f.originalName })}><Trash2 /></Button>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
      <FileDetails id={details} onClose={() => setDetails(null)} />
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title="Excluir arquivo?" description={`"${del?.name}" ficará recuperável durante o prazo de retenção e depois será removido definitivamente.`} destructive confirmLabel="Excluir" loading={remove.isPending} onConfirm={() => del && remove.mutate({ id: del.id })} />
    </>
  );
}

// ───────────── Análises

type Summary = { resumo?: string; tipo?: string; partes?: string[]; objeto?: string | null; valor_total?: string | null; ausentes?: string[]; truncado?: boolean };

function AnalysisDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = trpc.files.analysis.useQuery({ id: id ?? "" }, { enabled: !!id, refetchInterval: (s) => (s.state.data && ["QUEUED", "RUNNING"].includes(s.state.data.status) ? 3000 : false) });
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>Análise do documento</DialogTitle></DialogHeader>
        <QueryState query={q}>
          {(a) => {
            const s = (a.summary ?? {}) as Summary;
            const groups = new Map<string, typeof a.findings>();
            for (const f of a.findings) groups.set(f.topic, [...(groups.get(f.topic) ?? []), f]);
            return (
              <div className="space-y-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{a.file.originalName}</span>
                  <StatusBadge tone={ANALYSIS_STATUS[a.status]?.tone}>{ANALYSIS_STATUS[a.status]?.label}</StatusBadge>
                  {a.model && <span className="text-xs text-muted-foreground">{a.model} · {a.pages ?? "?"} pág. · {(a.inputTokens + a.outputTokens).toLocaleString("pt-BR")} tokens</span>}
                </div>
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>Análise automática gerada por IA. Não é parecer jurídico e pode conter erros — confira sempre o texto original e, em caso de risco relevante, procure revisão profissional.</span>
                </div>
                {(a.status === "QUEUED" || a.status === "RUNNING") && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Extraindo texto e analisando… isso pode levar alguns minutos.</div>}
                {a.status === "FAILED" && <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-destructive">{a.error ?? "Falha na análise"}</div>}
                {a.status === "DONE" && (
                  <>
                    <div className="rounded-xl border p-3">
                      {s.resumo && <p>{s.resumo}</p>}
                      <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                        {s.tipo && <div><dt className="inline font-medium">Tipo: </dt><dd className="inline">{s.tipo}</dd></div>}
                        {s.valor_total && <div><dt className="inline font-medium">Valor total: </dt><dd className="inline">{s.valor_total}</dd></div>}
                        {s.partes?.length ? <div className="sm:col-span-2"><dt className="inline font-medium">Partes: </dt><dd className="inline">{s.partes.join("; ")}</dd></div> : null}
                        {s.objeto && <div className="sm:col-span-2"><dt className="inline font-medium">Objeto: </dt><dd className="inline">{s.objeto}</dd></div>}
                      </dl>
                      {s.truncado && <p className="mt-2 text-xs text-amber-700">Documento longo: apenas a parte inicial foi analisada.</p>}
                    </div>
                    {[...groups.entries()].map(([topic, items]) => (
                      <div key={topic}>
                        <h3 className="mb-2 font-sans text-sm font-semibold">{TOPIC[topic] ?? topic}</h3>
                        <div className="space-y-2">
                          {items.map((f) => (
                            <div key={f.id} className="rounded-xl border p-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="min-w-0 flex-1 font-medium">{f.title}</span>
                                <StatusBadge tone={RISK[f.risk]?.tone}>{RISK[f.risk]?.label ?? f.risk}</StatusBadge>
                              </div>
                              {f.quote && (
                                <blockquote className="mt-2 border-l-2 border-gold pl-3 text-xs">
                                  <div className="mb-0.5 font-medium text-muted-foreground uppercase">Texto do documento{f.location ? ` · ${f.location}` : ""}</div>
                                  <p className="italic whitespace-pre-line">“{f.quote}”</p>
                                </blockquote>
                              )}
                              {!f.quote && f.location && <div className="mt-1 text-xs text-muted-foreground">{f.location}</div>}
                              {f.interpretation && (
                                <div className="mt-2 text-xs">
                                  <div className="mb-0.5 flex items-center gap-1 font-medium text-muted-foreground uppercase"><Info className="size-3" /> Interpretação da IA</div>
                                  <p>{f.interpretation}</p>
                                </div>
                              )}
                              {f.riskReason && <p className="mt-1 text-xs text-muted-foreground"><b>Motivo do risco:</b> {f.riskReason}</p>}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    {s.ausentes?.length ? (
                      <div>
                        <h3 className="mb-2 font-sans text-sm font-semibold">Informações ausentes ou ambíguas</h3>
                        <ul className="list-disc space-y-1 pl-5 text-xs">{s.ausentes.map((x, i) => <li key={i}>{x}</li>)}</ul>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            );
          }}
        </QueryState>
      </DialogContent>
    </Dialog>
  );
}

function AnalysesTab({ onOpen }: { onOpen: (id: string) => void }) {
  const q = trpc.files.analyses.useQuery(undefined, { refetchInterval: (s) => (s.state.data?.some((a) => ["QUEUED", "RUNNING"].includes(a.status)) ? 3000 : false) });
  return (
    <QueryState query={q} empty={(d) => (d.length ? null : <EmptyState icon={<Bot />} title="Nenhuma análise" description="Na aba Arquivos ou no contrato do fornecedor, use “Analisar com IA” em um PDF, imagem ou texto." />)}>
      {(list) => (
        <ul className="divide-y rounded-xl border bg-card">
          {list.map((a) => (
            <li key={a.id}>
              <button className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted/30" onClick={() => onOpen(a.id)}>
                <Bot className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{a.file.originalName}</span>
                <span className="text-xs text-muted-foreground">{dateTime(a.createdAt)}{a.status === "DONE" ? ` · ${a._count.findings} pontos` : ""}</span>
                <StatusBadge tone={ANALYSIS_STATUS[a.status]?.tone}>{ANALYSIS_STATUS[a.status]?.label}</StatusBadge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </QueryState>
  );
}

export function DocumentsPage() {
  const [params, setParams] = useSearchParams();
  const analysis = params.get("analise");
  const openAnalysis = (id: string | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set("analise", id);
    else p.delete("analise");
    setParams(p, { replace: true });
  };
  return (
    <>
      <PageHeader title="Contratos e documentos" description="Arquivos privados com versões, vínculos e análise por IA. Downloads usam links temporários." />
      <Tabs defaultValue={analysis ? "analises" : "arquivos"}>
        <TabsList className="mb-4">
          <TabsTrigger value="arquivos">Arquivos</TabsTrigger>
          <TabsTrigger value="contratos">Contratos</TabsTrigger>
          <TabsTrigger value="analises">Análises por IA</TabsTrigger>
        </TabsList>
        <TabsContent value="arquivos"><FilesTab onOpenAnalysis={openAnalysis} /></TabsContent>
        <TabsContent value="contratos"><ContractsTab /></TabsContent>
        <TabsContent value="analises"><AnalysesTab onOpen={openAnalysis} /></TabsContent>
      </Tabs>
      <AnalysisDialog id={analysis} onClose={() => openAnalysis(null)} />
    </>
  );
}

