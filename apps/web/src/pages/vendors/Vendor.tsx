import { Archive, ArchiveRestore, ArrowLeft, Bot, CheckCircle2, Circle, ExternalLink, MessageCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog, EmptyState, Field, LoadingButton, MoneyInput, PageHeader, QueryState, Section, StatusBadge, TextField, PhoneField } from "@/components/app/common";
import { FileList, UploadButton } from "@/components/app/files";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMe } from "@/hooks/use-me";
import { date, dateTime, formatPhone, fromDateInput, fromDateTimeInput, money, toDateInput, toDateTimeInput } from "@/lib/format";
import { CONTRACT_STATUS, EVENT_TYPE, INTERACTION_TYPE, MESSAGE_STATUS, OBLIGATION_STATUS, opt, QUOTE_STATUS, TASK_STATUS, VENDOR_STATUS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { trpc, type RouterOutputs } from "@/trpc";
import { DuplicatesDialog, SelectField, Stars, useSaveVendor, VendorFields, emptyVendor } from "./Vendors";

type V = RouterOutputs["vendors"]["get"];
type Quote = V["quotes"][number];
type Contract = V["contracts"][number];

function useInvalidate() {
  const utils = trpc.useUtils();
  return () => utils.vendors.invalidate();
}
const onErr = (e: { message: string }) => toast.error(e.message);

// ───────────── Resumo

function Summary({ v }: { v: V }) {
  const { can } = useMe();
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyVendor());
  useEffect(() => {
    setForm({ id: v.id, name: v.name, legalName: v.legalName, contactName: v.contactName, categoryId: v.categoryId, phone: v.phone, whatsapp: v.whatsapp, email: v.email, address: v.address, document: v.document, website: v.website, instagram: v.instagram, notes: v.notes, status: v.status, rating: v.rating });
  }, [v]);
  const s = useSaveVendor(() => undefined);
  const inv = useInvalidate();
  const [arch, setArch] = useState(false);
  const archive = trpc.vendors.archive.useMutation({ onSuccess: () => { toast.success(v.archivedAt ? "Restaurado" : "Arquivado"); setArch(false); inv(); }, onError: onErr });
  const editable = can("vendors:edit");
  return (
    <Section
      title="Dados do fornecedor"
      actions={can("vendors:delete") && <Button variant="outline" size="sm" onClick={() => setArch(true)}>{v.archivedAt ? <><ArchiveRestore /> Restaurar</> : <><Archive /> Arquivar</>}</Button>}
    >
      <fieldset disabled={!editable}>
        <VendorFields form={form} set={(p) => setForm({ ...form, ...p })} />
      </fieldset>
      {editable && <div className="mt-4 flex justify-end"><LoadingButton loading={s.saving} onClick={() => s.submit(form)}>Salvar alterações</LoadingButton></div>}
      <DuplicatesDialog dups={s.dups} currentId={v.id} onClose={() => s.setDups(null)} onForce={() => s.submit(form, true)} onMerged={(keep) => navigate(`/fornecedores/${keep}`)} />
      <ConfirmDialog open={arch} onOpenChange={setArch} title={v.archivedAt ? "Restaurar fornecedor?" : "Arquivar fornecedor?"} description="Fornecedores arquivados saem da lista principal, mas o histórico financeiro e contratual é mantido." confirmLabel={v.archivedAt ? "Restaurar" : "Arquivar"} loading={archive.isPending} onConfirm={() => archive.mutate({ id: v.id, archived: !v.archivedAt })} />
    </Section>
  );
}

// ───────────── Contatos

function Contacts({ v }: { v: V }) {
  const { can } = useMe();
  const inv = useInvalidate();
  const [edit, setEdit] = useState<{ id?: string; name: string; role: string | null; phone: string | null; email: string | null } | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const save = trpc.vendors.saveContact.useMutation({ onSuccess: () => { toast.success("Contato salvo"); setEdit(null); inv(); }, onError: onErr });
  const remove = trpc.vendors.deleteContact.useMutation({ onSuccess: () => { setDel(null); inv(); }, onError: onErr });
  return (
    <Section title="Contatos" actions={can("vendors:edit") && <Button size="sm" onClick={() => setEdit({ name: "", role: null, phone: null, email: null })}><Plus /> Contato</Button>}>
      {v.contacts.length ? (
        <ul className="divide-y rounded-xl border">
          {v.contacts.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1"><div className="font-medium">{c.name}{c.role ? <span className="font-normal text-muted-foreground"> · {c.role}</span> : null}</div><div className="text-xs text-muted-foreground">{[formatPhone(c.phone), c.email].filter(Boolean).join(" · ")}</div></div>
              {can("vendors:edit") && <><Button size="icon-sm" variant="ghost" aria-label="Editar" onClick={() => setEdit({ id: c.id, name: c.name, role: c.role, phone: c.phone, email: c.email })}><Pencil /></Button><Button size="icon-sm" variant="ghost" aria-label="Excluir" onClick={() => setDel(c.id)}><Trash2 /></Button></>}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">Nenhum contato adicional.</p>}
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{edit?.id ? "Editar contato" : "Novo contato"}</DialogTitle></DialogHeader>
          {edit && (
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Nome *" value={edit.name} onChange={(x) => setEdit({ ...edit, name: x })} />
              <TextField label="Função" value={edit.role} onChange={(x) => setEdit({ ...edit, role: x })} />
              <PhoneField label="Telefone" value={edit.phone} onChange={(x) => setEdit({ ...edit, phone: x })} />
              <TextField label="E-mail" value={edit.email} onChange={(x) => setEdit({ ...edit, email: x })} />
            </div>
          )}
          <DialogFooter><LoadingButton loading={save.isPending} disabled={!edit?.name.trim()} onClick={() => edit && save.mutate({ ...edit, vendorId: v.id })}>Salvar</LoadingButton></DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title="Excluir contato?" destructive confirmLabel="Excluir" loading={remove.isPending} onConfirm={() => del && remove.mutate({ id: del })} />
    </Section>
  );
}

// ───────────── Orçamentos

type QuoteForm = {
  id?: string; title: string; status: string; validUntil: string; includedServices: string | null; paymentTerms: string | null; extraFees: string | null; cancellationPenalty: string | null;
  availability: string | null; notes: string | null; items: { description: string; quantity: string; unitCents: number | null }[]; totalCents: number | null;
};

function QuoteDialog({ vendorId, form, setForm }: { vendorId: string; form: QuoteForm | null; setForm: (f: QuoteForm | null) => void }) {
  const inv = useInvalidate();
  const save = trpc.vendors.saveQuote.useMutation({ onSuccess: () => { toast.success("Orçamento salvo"); setForm(null); inv(); }, onError: onErr });
  if (!form) return null;
  const set = (p: Partial<QuoteForm>) => setForm({ ...form, ...p });
  const itemsTotal = form.items.reduce((a, i) => a + Math.round((i.unitCents ?? 0) * (Number(i.quantity) || 0)), 0);
  function submit() {
    if (!form) return;
    if (form.title.trim().length < 2) return toast.error("Informe um título");
    if (form.items.some((i) => !i.description.trim() || i.unitCents == null || !/^\d+(\.\d{1,3})?$/.test(i.quantity))) return toast.error("Preencha descrição, quantidade e valor de cada item");
    save.mutate({
      id: form.id, vendorId, title: form.title, status: form.status as never, validUntil: fromDateInput(form.validUntil), includedServices: form.includedServices, paymentTerms: form.paymentTerms,
      extraFees: form.extraFees, cancellationPenalty: form.cancellationPenalty, availability: form.availability, notes: form.notes,
      items: form.items.map((i) => ({ description: i.description, quantity: i.quantity, unitCents: i.unitCents ?? 0 })), totalCents: form.totalCents ?? 0,
    });
  }
  return (
    <Dialog open onOpenChange={(o) => !o && setForm(null)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>{form.id ? "Editar orçamento" : "Novo orçamento"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="Título *" className="sm:col-span-2" value={form.title} onChange={(x) => set({ title: x })} />
          <SelectField label="Status" value={form.status} onChange={(x) => x && set({ status: x })} options={opt(QUOTE_STATUS)} />
          <Field label="Válido até"><Input type="date" value={form.validUntil} onChange={(e) => set({ validUntil: e.target.value })} /></Field>
          <TextField label="Disponibilidade" className="sm:col-span-2" value={form.availability} onChange={(x) => set({ availability: x })} />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between"><span className="text-sm font-medium">Itens</span><Button size="sm" variant="outline" onClick={() => set({ items: [...form.items, { description: "", quantity: "1", unitCents: null }] })}><Plus /> Item</Button></div>
          {form.items.map((it, i) => (
            <div key={i} className="grid grid-cols-[1fr_80px_130px_auto] items-center gap-2">
              <Input placeholder="Descrição" value={it.description} onChange={(e) => set({ items: form.items.map((x, k) => (k === i ? { ...x, description: e.target.value } : x)) })} />
              <Input placeholder="Qtd" inputMode="decimal" value={it.quantity} onChange={(e) => set({ items: form.items.map((x, k) => (k === i ? { ...x, quantity: e.target.value.replace(",", ".") } : x)) })} />
              <MoneyInput value={it.unitCents} onChange={(c) => set({ items: form.items.map((x, k) => (k === i ? { ...x, unitCents: c } : x)) })} />
              <Button size="icon-sm" variant="ghost" aria-label="Remover" onClick={() => set({ items: form.items.filter((_, k) => k !== i) })}><Trash2 /></Button>
            </div>
          ))}
          {form.items.length ? <p className="text-right text-sm">Total dos itens: <b className="tabular-nums">{money(itemsTotal)}</b></p> : (
            <Field label="Valor total (sem itens detalhados)" className="max-w-xs"><MoneyInput value={form.totalCents} onChange={(c) => set({ totalCents: c })} /></Field>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Serviços incluídos" multiline value={form.includedServices} onChange={(x) => set({ includedServices: x })} />
          <TextField label="Condições / formas de pagamento" multiline value={form.paymentTerms} onChange={(x) => set({ paymentTerms: x })} />
          <TextField label="Taxas extras" multiline value={form.extraFees} onChange={(x) => set({ extraFees: x })} />
          <TextField label="Multa / cancelamento" multiline value={form.cancellationPenalty} onChange={(x) => set({ cancellationPenalty: x })} />
          <TextField label="Observações" multiline className="sm:col-span-2" value={form.notes} onChange={(x) => set({ notes: x })} />
        </div>
        <DialogFooter><Button variant="ghost" onClick={() => setForm(null)}>Cancelar</Button><LoadingButton loading={save.isPending} onClick={submit}>Salvar</LoadingButton></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Quotes({ v }: { v: V }) {
  const { can } = useMe();
  const inv = useInvalidate();
  const [form, setForm] = useState<QuoteForm | null>(null);
  const [del, setDel] = useState<Quote | null>(null);
  const remove = trpc.vendors.deleteQuote.useMutation({ onSuccess: () => { toast.success("Orçamento excluído"); setDel(null); inv(); }, onError: onErr });
  const open = (q?: Quote) =>
    setForm(q ? {
      id: q.id, title: q.title, status: q.status, validUntil: toDateInput(q.validUntil), includedServices: q.includedServices, paymentTerms: q.paymentTerms, extraFees: q.extraFees, cancellationPenalty: q.cancellationPenalty,
      availability: q.availability, notes: q.notes, items: q.items.map((i) => ({ description: i.description, quantity: String(i.quantity), unitCents: i.unitCents })), totalCents: q.totalCents,
    } : { title: "", status: "RECEIVED", validUntil: "", includedServices: null, paymentTerms: null, extraFees: null, cancellationPenalty: null, availability: null, notes: null, items: [], totalCents: null });
  return (
    <Section title="Orçamentos e propostas" actions={can("vendors:edit") && <Button size="sm" onClick={() => open()}><Plus /> Orçamento</Button>}>
      {v.quotes.length ? (
        <div className="space-y-3">
          {v.quotes.map((q) => {
            const files = v.files.filter((f) => f.entityType === "quote" && f.entityId === q.id);
            const expired = q.validUntil && new Date(q.validUntil) < new Date();
            return (
              <div key={q.id} className="rounded-xl border p-3">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{q.title}</div>
                    <div className="text-xs text-muted-foreground">Recebido em {date(q.createdAt)}{q.validUntil ? ` · válido até ${date(q.validUntil)}` : ""}{expired ? " (vencido)" : ""}</div>
                  </div>
                  <StatusBadge tone={QUOTE_STATUS[q.status]?.tone}>{QUOTE_STATUS[q.status]?.label}</StatusBadge>
                  <span className="font-semibold tabular-nums">{money(q.totalCents)}</span>
                  {can("vendors:edit") && <Button size="icon-sm" variant="ghost" aria-label="Editar" onClick={() => open(q)}><Pencil /></Button>}
                  {can("vendors:delete") && <Button size="icon-sm" variant="ghost" aria-label="Excluir" onClick={() => setDel(q)}><Trash2 /></Button>}
                </div>
                {q.items.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-sm">
                    {q.items.map((i) => <li key={i.id} className="flex justify-between gap-2"><span className="truncate">{String(i.quantity)} × {i.description}</span><span className="tabular-nums text-muted-foreground">{money(Math.round(i.unitCents * Number(i.quantity)))}</span></li>)}
                  </ul>
                )}
                <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                  {[["Incluso", q.includedServices], ["Pagamento", q.paymentTerms], ["Taxas extras", q.extraFees], ["Cancelamento", q.cancellationPenalty], ["Disponibilidade", q.availability], ["Obs.", q.notes]].filter(([, x]) => x).map(([k, x]) => (
                    <div key={k}><dt className="inline font-medium">{k}: </dt><dd className="inline whitespace-pre-line text-muted-foreground">{x}</dd></div>
                  ))}
                </dl>
                <div className="mt-3 space-y-2">
                  {files.length > 0 && <FileList files={files} onChanged={inv} />}
                  {can("documents:create") && <UploadButton size="sm" category="QUOTE" entityType="quote" entityId={q.id} label="Anexar proposta" onUploaded={inv} />}
                </div>
              </div>
            );
          })}
        </div>
      ) : <EmptyState icon={<Plus />} title="Nenhum orçamento" description="Registre as propostas recebidas para comparar fornecedores." />}
      <QuoteDialog vendorId={v.id} form={form} setForm={setForm} />
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title="Excluir orçamento?" description={del?.title} destructive confirmLabel="Excluir" loading={remove.isPending} onConfirm={() => del && remove.mutate({ id: del.id })} />
    </Section>
  );
}

// ───────────── Contratos

type ContractForm = { id?: string; title: string; status: string; signedAt: string; serviceDate: string; expiresAt: string; totalCents: number | null; cancellationPolicy: string | null; notes: string | null; fileId: string | null };

function AnalysisStatus({ fileId }: { fileId: string }) {
  const { can } = useMe();
  const utils = trpc.useUtils();
  const list = trpc.files.analyses.useQuery({ fileId }, { refetchInterval: (q) => (q.state.data?.some((a) => a.status === "QUEUED" || a.status === "RUNNING") ? 3000 : false) });
  const analyze = trpc.files.analyze.useMutation({ onSuccess: () => { toast.success("Análise solicitada"); utils.files.analyses.invalidate(); }, onError: onErr });
  const last = list.data?.[0];
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {last && (
        <Link to={`/documentos?analise=${last.id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
          <Bot className="size-3.5" />
          {last.status === "DONE" ? `Análise pronta (${last._count.findings} pontos)` : last.status === "FAILED" ? "Análise falhou" : "Analisando…"}
        </Link>
      )}
      {can("ai:create") && last?.status !== "QUEUED" && last?.status !== "RUNNING" && (
        <LoadingButton size="xs" variant="outline" loading={analyze.isPending} onClick={() => analyze.mutate({ fileId })}><Bot /> {last ? "Analisar de novo" : "Analisar com IA"}</LoadingButton>
      )}
    </div>
  );
}

function Clauses({ c }: { c: Contract }) {
  const { can } = useMe();
  const inv = useInvalidate();
  const [form, setForm] = useState<{ id?: string; description: string; party: "VENDOR" | "COUPLE"; dueDate: string; done: boolean } | null>(null);
  const save = trpc.vendors.saveClause.useMutation({ onSuccess: () => { setForm(null); inv(); }, onError: onErr });
  const del = trpc.vendors.deleteClause.useMutation({ onSuccess: inv, onError: onErr });
  const edit = can("documents:edit");
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between"><span className="text-sm font-medium">Obrigações contratuais</span>{edit && <Button size="xs" variant="ghost" onClick={() => setForm({ description: "", party: "VENDOR", dueDate: "", done: false })}><Plus /> Obrigação</Button>}</div>
      {c.clauses.length ? (
        <ul className="space-y-1">
          {c.clauses.map((k) => (
            <li key={k.id} className="flex items-center gap-2 text-sm">
              <button disabled={!edit} onClick={() => save.mutate({ id: k.id, contractId: c.id, description: k.description, party: k.party, dueDate: k.dueDate, done: !k.doneAt })} aria-label="Marcar cumprida">
                {k.doneAt ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Circle className="size-4 text-muted-foreground" />}
              </button>
              <span className={cn("min-w-0 flex-1", k.doneAt && "text-muted-foreground line-through")}>{k.description}</span>
              <StatusBadge tone={k.party === "VENDOR" ? "sky" : "violet"}>{k.party === "VENDOR" ? "Fornecedor" : "Casal"}</StatusBadge>
              <span className={cn("text-xs tabular-nums", !k.doneAt && k.dueDate && new Date(k.dueDate) < new Date() && "text-destructive")}>{date(k.dueDate)}</span>
              {edit && <><Button size="icon-xs" variant="ghost" aria-label="Editar" onClick={() => setForm({ id: k.id, description: k.description, party: k.party, dueDate: toDateInput(k.dueDate), done: !!k.doneAt })}><Pencil /></Button><Button size="icon-xs" variant="ghost" aria-label="Excluir" onClick={() => del.mutate({ id: k.id })}><Trash2 /></Button></>}
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-muted-foreground">Nenhuma obrigação registrada.</p>}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Obrigação contratual</DialogTitle></DialogHeader>
          {form && (
            <div className="grid gap-3">
              <TextField label="Descrição *" multiline value={form.description} onChange={(x) => setForm({ ...form, description: x })} />
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField label="Responsável" value={form.party} onChange={(x) => x && setForm({ ...form, party: x as "VENDOR" | "COUPLE" })} options={[{ value: "VENDOR", label: "Fornecedor" }, { value: "COUPLE", label: "Casal" }]} />
                <Field label="Prazo"><Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
              </div>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.done} onCheckedChange={(x) => setForm({ ...form, done: !!x })} /> Cumprida</label>
            </div>
          )}
          <DialogFooter><LoadingButton loading={save.isPending} disabled={(form?.description.trim().length ?? 0) < 2} onClick={() => form && save.mutate({ ...form, contractId: c.id, dueDate: fromDateInput(form.dueDate) })}>Salvar</LoadingButton></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Contracts({ v }: { v: V }) {
  const { can } = useMe();
  const inv = useInvalidate();
  const [form, setForm] = useState<ContractForm | null>(null);
  const save = trpc.vendors.saveContract.useMutation({ onSuccess: () => { toast.success("Contrato salvo"); setForm(null); inv(); }, onError: onErr });
  const setFile = trpc.vendors.saveContract.useMutation({ onSuccess: inv, onError: onErr });
  const formOf = (c: Contract): ContractForm => ({ id: c.id, title: c.title, status: c.status, signedAt: toDateInput(c.signedAt), serviceDate: toDateInput(c.serviceDate), expiresAt: toDateInput(c.expiresAt), totalCents: c.totalCents, cancellationPolicy: c.cancellationPolicy, notes: c.notes, fileId: c.fileId });
  const open = (c?: Contract) => setForm(c ? formOf(c) : { title: "", status: "DRAFT", signedAt: "", serviceDate: "", expiresAt: "", totalCents: null, cancellationPolicy: null, notes: null, fileId: null });
  const payload = (f: ContractForm) => ({ id: f.id, vendorId: v.id, title: f.title, status: f.status as never, signedAt: fromDateInput(f.signedAt), serviceDate: fromDateInput(f.serviceDate), expiresAt: fromDateInput(f.expiresAt), totalCents: f.totalCents ?? 0, cancellationPolicy: f.cancellationPolicy, notes: f.notes, fileId: f.fileId });
  return (
    <Section title="Contratos" actions={can("documents:create") && <Button size="sm" onClick={() => open()}><Plus /> Contrato</Button>}>
      {v.contracts.length ? (
        <div className="space-y-3">
          {v.contracts.map((c) => {
            const files = v.files.filter((f) => f.entityType === "contract" && f.entityId === c.id);
            return (
              <div key={c.id} className="rounded-xl border p-3">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{c.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {[c.signedAt && `Assinado ${date(c.signedAt)}`, c.serviceDate && `Serviço ${date(c.serviceDate)}`, c.expiresAt && `Prazo ${date(c.expiresAt)}`].filter(Boolean).join(" · ") || "Sem datas"}
                    </div>
                  </div>
                  <StatusBadge tone={CONTRACT_STATUS[c.status]?.tone}>{CONTRACT_STATUS[c.status]?.label}</StatusBadge>
                  {v.canFinance && <span className="font-semibold tabular-nums">{money(c.totalCents)}</span>}
                  {can("documents:edit") && <Button size="icon-sm" variant="ghost" aria-label="Editar" onClick={() => open(c)}><Pencil /></Button>}
                </div>
                {c.cancellationPolicy && <p className="mt-2 text-xs whitespace-pre-line"><b>Cancelamento:</b> <span className="text-muted-foreground">{c.cancellationPolicy}</span></p>}
                {c.notes && <p className="mt-1 text-xs whitespace-pre-line text-muted-foreground">{c.notes}</p>}
                <div className="mt-3 space-y-2">
                  {files.map((f) => (
                    <div key={f.id} className="space-y-1">
                      <FileList files={[f]} onChanged={inv} />
                      <AnalysisStatus fileId={f.id} />
                    </div>
                  ))}
                  {can("documents:create") && (
                    <UploadButton size="sm" category="CONTRACT" entityType="contract" entityId={c.id} accept="application/pdf,image/*,.docx,.txt" label={files.length ? "Anexar outro arquivo" : "Anexar contrato"}
                      onUploaded={(up) => { if (!c.fileId && up[0] && can("documents:edit")) setFile.mutate(payload({ ...formOf(c), fileId: up[0].id })); else inv(); }} />
                  )}
                </div>
                <Clauses c={c} />
              </div>
            );
          })}
        </div>
      ) : <EmptyState icon={<Plus />} title="Nenhum contrato" description="Cadastre o contrato, anexe o PDF e acompanhe as obrigações de cada parte." />}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{form?.id ? "Editar contrato" : "Novo contrato"}</DialogTitle></DialogHeader>
          {form && (
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Título *" value={form.title} onChange={(x) => setForm({ ...form, title: x })} />
              <SelectField label="Status" value={form.status} onChange={(x) => x && setForm({ ...form, status: x })} options={opt(CONTRACT_STATUS)} />
              <Field label="Assinado em"><Input type="date" value={form.signedAt} onChange={(e) => setForm({ ...form, signedAt: e.target.value })} /></Field>
              <Field label="Data do serviço"><Input type="date" value={form.serviceDate} onChange={(e) => setForm({ ...form, serviceDate: e.target.value })} /></Field>
              <Field label="Prazo / vencimento"><Input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></Field>
              {v.canFinance && <Field label="Valor total" hint="Referência. Cobranças reais ficam no Financeiro."><MoneyInput value={form.totalCents} onChange={(x) => setForm({ ...form, totalCents: x })} /></Field>}
              <TextField label="Política de cancelamento" multiline className="sm:col-span-2" value={form.cancellationPolicy} onChange={(x) => setForm({ ...form, cancellationPolicy: x })} />
              <TextField label="Observações" multiline className="sm:col-span-2" value={form.notes} onChange={(x) => setForm({ ...form, notes: x })} />
            </div>
          )}
          <DialogFooter><Button variant="ghost" onClick={() => setForm(null)}>Cancelar</Button><LoadingButton loading={save.isPending} disabled={(form?.title.trim().length ?? 0) < 2} onClick={() => form && save.mutate(payload(form))}>Salvar</LoadingButton></DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

// ───────────── Financeiro

function Finance({ v }: { v: V }) {
  const { can } = useMe();
  return (
    <Section title="Lançamentos financeiros" description="Cobranças, parcelas e pagamentos ficam no módulo Financeiro." actions={can("finance:create") && <Button size="sm" asChild><Link to={`/financeiro/lancamentos/novo?vendor=${v.id}`}><Plus /> Novo lançamento</Link></Button>}>
      {v.obligations.length ? (
        <ul className="divide-y rounded-xl border">
          {v.obligations.map((o) => (
            <li key={o.id}><Link to={`/financeiro/lancamentos/${o.id}`} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40"><span className="min-w-0 flex-1 truncate">{o.title}</span><StatusBadge tone={OBLIGATION_STATUS[o.status]?.tone}>{OBLIGATION_STATUS[o.status]?.label}</StatusBadge><ExternalLink className="size-3.5 text-muted-foreground" /></Link></li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">Nenhum lançamento vinculado a este fornecedor.</p>}
    </Section>
  );
}

// ───────────── Interações

function Interactions({ v }: { v: V }) {
  const { can } = useMe();
  const inv = useInvalidate();
  const [form, setForm] = useState({ type: "call", occurredAt: toDateTimeInput(new Date()), summary: "" });
  const add = trpc.vendors.addInteraction.useMutation({ onSuccess: () => { toast.success("Interação registrada"); setForm({ ...form, summary: "" }); inv(); }, onError: onErr });
  const del = trpc.vendors.deleteInteraction.useMutation({ onSuccess: inv, onError: onErr });
  return (
    <Section title="Histórico de interações">
      {can("vendors:edit") && (
        <div className="mb-4 grid gap-2 rounded-xl border p-3 sm:grid-cols-[160px_200px_1fr_auto] sm:items-end">
          <SelectField label="Tipo" value={form.type} onChange={(x) => x && setForm({ ...form, type: x })} options={opt(INTERACTION_TYPE)} />
          <Field label="Quando"><Input type="datetime-local" value={form.occurredAt} onChange={(e) => setForm({ ...form, occurredAt: e.target.value })} /></Field>
          <TextField label="Resumo" value={form.summary} onChange={(x) => setForm({ ...form, summary: x })} placeholder="O que foi conversado?" />
          <LoadingButton loading={add.isPending} disabled={form.summary.trim().length < 2 || !form.occurredAt} onClick={() => add.mutate({ vendorId: v.id, type: form.type as never, occurredAt: fromDateTimeInput(form.occurredAt)!, summary: form.summary })}>Registrar</LoadingButton>
        </div>
      )}
      {v.interactions.length ? (
        <ol className="relative space-y-3 border-l pl-4">
          {v.interactions.map((i) => (
            <li key={i.id} className="relative">
              <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full bg-primary" />
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-muted-foreground">{dateTime(i.occurredAt)} · {INTERACTION_TYPE[i.type] ?? i.type}</div>
                  <p className="text-sm whitespace-pre-line">{i.summary}</p>
                </div>
                {can("vendors:edit") && <Button size="icon-xs" variant="ghost" aria-label="Excluir" onClick={() => del.mutate({ id: i.id })}><Trash2 /></Button>}
              </div>
            </li>
          ))}
        </ol>
      ) : <p className="text-sm text-muted-foreground">Nenhuma interação registrada.</p>}
    </Section>
  );
}

// ───────────── Entregas

function Deliveries({ v }: { v: V }) {
  const { can } = useMe();
  const inv = useInvalidate();
  const [form, setForm] = useState<{ id?: string; description: string; dueAt: string; delivered: boolean; notes: string | null } | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const save = trpc.vendors.saveDelivery.useMutation({ onSuccess: () => { setForm(null); inv(); }, onError: onErr });
  const remove = trpc.vendors.deleteDelivery.useMutation({ onSuccess: () => { setDel(null); inv(); }, onError: onErr });
  const edit = can("vendors:edit");
  return (
    <Section title="Entregas e execução" actions={edit && <Button size="sm" onClick={() => setForm({ description: "", dueAt: "", delivered: false, notes: null })}><Plus /> Entrega</Button>}>
      {v.deliveries.length ? (
        <ul className="divide-y rounded-xl border">
          {v.deliveries.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <button disabled={!edit} aria-label="Marcar entregue" onClick={() => save.mutate({ id: d.id, vendorId: v.id, description: d.description, dueAt: d.dueAt, delivered: !d.deliveredAt, notes: d.notes })}>
                {d.deliveredAt ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Circle className="size-4 text-muted-foreground" />}
              </button>
              <div className="min-w-0 flex-1"><div className={cn(d.deliveredAt && "text-muted-foreground line-through")}>{d.description}</div>{d.notes && <div className="text-xs text-muted-foreground">{d.notes}</div>}</div>
              <span className={cn("text-xs tabular-nums", !d.deliveredAt && d.dueAt && new Date(d.dueAt) < new Date() && "font-medium text-destructive")}>{d.deliveredAt ? `Entregue ${date(d.deliveredAt)}` : date(d.dueAt)}</span>
              {edit && <><Button size="icon-sm" variant="ghost" aria-label="Editar" onClick={() => setForm({ id: d.id, description: d.description, dueAt: toDateInput(d.dueAt), delivered: !!d.deliveredAt, notes: d.notes })}><Pencil /></Button><Button size="icon-sm" variant="ghost" aria-label="Excluir" onClick={() => setDel(d.id)}><Trash2 /></Button></>}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">Nenhuma entrega registrada.</p>}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Entrega</DialogTitle></DialogHeader>
          {form && (
            <div className="grid gap-3">
              <TextField label="Descrição *" value={form.description} onChange={(x) => setForm({ ...form, description: x })} />
              <Field label="Prazo"><Input type="date" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} /></Field>
              <TextField label="Observações" multiline value={form.notes} onChange={(x) => setForm({ ...form, notes: x })} />
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.delivered} onCheckedChange={(x) => setForm({ ...form, delivered: !!x })} /> Entregue</label>
            </div>
          )}
          <DialogFooter><LoadingButton loading={save.isPending} disabled={(form?.description.trim().length ?? 0) < 2} onClick={() => form && save.mutate({ ...form, vendorId: v.id, dueAt: fromDateInput(form.dueAt) })}>Salvar</LoadingButton></DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title="Excluir entrega?" destructive confirmLabel="Excluir" loading={remove.isPending} onConfirm={() => del && remove.mutate({ id: del })} />
    </Section>
  );
}

// ───────────── Página

export function VendorPage() {
  const { id = "" } = useParams();
  const { can } = useMe();
  const q = trpc.vendors.get.useQuery({ id });
  const inv = useInvalidate();
  return (
    <QueryState query={q}>
      {(v) => (
        <>
          <Link to="/fornecedores" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Fornecedores</Link>
          <PageHeader
            title={v.name}
            eyebrow={v.category?.name ?? "Fornecedor"}
            description={<span className="flex flex-wrap items-center gap-2"><StatusBadge tone={VENDOR_STATUS[v.status]?.tone}>{VENDOR_STATUS[v.status]?.label}</StatusBadge><Stars value={v.rating} />{v.archivedAt && <StatusBadge>Arquivado</StatusBadge>}{v.contactName && <span>{v.contactName}</span>}{(v.whatsapp || v.phone) && <span>{formatPhone(v.whatsapp ?? v.phone)}</span>}{v.email && <span>{v.email}</span>}</span>}
            actions={can("whatsapp:view") && (v.whatsapp || v.phone) && <Button variant="outline" asChild><Link to={`/whatsapp?numero=${v.whatsapp ?? v.phone}`}><MessageCircle /> WhatsApp</Link></Button>}
          />
          <Tabs defaultValue="resumo">
            <div className="mb-4 overflow-x-auto scrollbar-none">
              <TabsList>
                <TabsTrigger value="resumo">Resumo</TabsTrigger>
                <TabsTrigger value="contatos">Contatos ({v.contacts.length})</TabsTrigger>
                <TabsTrigger value="orcamentos">Orçamentos ({v.quotes.length})</TabsTrigger>
                {can("documents:view") && <TabsTrigger value="contratos">Contratos ({v.contracts.length})</TabsTrigger>}
                {v.canFinance && <TabsTrigger value="financeiro">Financeiro</TabsTrigger>}
                <TabsTrigger value="interacoes">Interações</TabsTrigger>
                <TabsTrigger value="entregas">Entregas</TabsTrigger>
                <TabsTrigger value="tarefas">Tarefas e agenda</TabsTrigger>
                {can("documents:view") && <TabsTrigger value="arquivos">Arquivos</TabsTrigger>}
                {can("whatsapp:view") && <TabsTrigger value="mensagens">Mensagens</TabsTrigger>}
              </TabsList>
            </div>
            <TabsContent value="resumo"><Summary v={v} /></TabsContent>
            <TabsContent value="contatos"><Contacts v={v} /></TabsContent>
            <TabsContent value="orcamentos"><Quotes v={v} /></TabsContent>
            <TabsContent value="contratos"><Contracts v={v} /></TabsContent>
            <TabsContent value="financeiro"><Finance v={v} /></TabsContent>
            <TabsContent value="interacoes"><Interactions v={v} /></TabsContent>
            <TabsContent value="entregas"><Deliveries v={v} /></TabsContent>
            <TabsContent value="tarefas">
              <div className="grid gap-4 lg:grid-cols-2">
                <Section title="Tarefas">
                  {v.tasks.length ? (
                    <ul className="divide-y rounded-xl border">{v.tasks.map((t) => <li key={t.id}><Link to={`/checklist?tarefa=${t.id}`} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/40"><span className="min-w-0 flex-1 truncate">{t.title}</span><span className="text-xs text-muted-foreground">{date(t.dueDate)}</span><StatusBadge tone={TASK_STATUS[t.status]?.tone}>{TASK_STATUS[t.status]?.label}</StatusBadge></Link></li>)}</ul>
                  ) : <p className="text-sm text-muted-foreground">Nenhuma tarefa vinculada.</p>}
                </Section>
                <Section title="Compromissos">
                  {v.events.length ? (
                    <ul className="divide-y rounded-xl border">{v.events.map((e) => <li key={e.id}><Link to={`/calendario?evento=${e.id}`} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/40"><span className="min-w-0 flex-1 truncate">{e.title}</span><span className="text-xs text-muted-foreground">{dateTime(e.startsAt)} · {EVENT_TYPE[e.type]}</span></Link></li>)}</ul>
                  ) : <p className="text-sm text-muted-foreground">Nenhum compromisso vinculado.</p>}
                </Section>
              </div>
            </TabsContent>
            <TabsContent value="arquivos">
              <Section title="Arquivos" actions={can("documents:create") && <UploadButton size="sm" category="DOCUMENT" entityType="vendor" entityId={v.id} multiple onUploaded={inv} />}>
                <FileList files={v.files} onChanged={inv} emptyText="Nenhum arquivo deste fornecedor" />
              </Section>
            </TabsContent>
            <TabsContent value="mensagens">
              <Section title="Mensagens enviadas" actions={<Button size="sm" variant="outline" asChild><Link to={`/whatsapp${v.whatsapp || v.phone ? `?numero=${v.whatsapp ?? v.phone}` : ""}`}><MessageCircle /> Abrir WhatsApp</Link></Button>}>
                {v.messages.length ? (
                  <ul className="space-y-2">{v.messages.map((m) => <li key={m.id} className="rounded-xl border p-3 text-sm"><div className="mb-1 flex items-center justify-between text-xs text-muted-foreground"><span>{dateTime(m.createdAt)}</span><StatusBadge tone={MESSAGE_STATUS[m.status]?.tone}>{MESSAGE_STATUS[m.status]?.label}</StatusBadge></div><p className="whitespace-pre-line">{m.body}</p></li>)}</ul>
                ) : <p className="text-sm text-muted-foreground">Nenhuma mensagem enviada a este fornecedor.</p>}
              </Section>
            </TabsContent>
          </Tabs>
        </>
      )}
    </QueryState>
  );
}
