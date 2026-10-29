import { Clock, ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog, EmptyState, Field, LoadingButton, PageHeader, QueryState, Section, StatusBadge, TextField, PhoneField } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useMe } from "@/hooks/use-me";
import { date, formatPhone, fromDateTimeInput, money, time, toDateTimeInput } from "@/lib/format";
import { AREA, opt, PARTICIPANT_ROLE, PRIORITY, SCHEDULE_AREA, VENDOR_STATUS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { trpc, type RouterOutputs } from "@/trpc";
import { isOverdue, NativeSelect, TaskSheet } from "./Checklist";

type Data = RouterOutputs["ceremony"]["get"];
type Cost = NonNullable<Data["costs"]>[number];
type Task = NonNullable<Data["tasks"]>[number];

const TEXT_FIELDS = [
  "venueName", "address", "responsible", "contacts", "decorationRules", "photoRules", "requiredDocs", "deadlines", "prepCourse", "readings", "music", "entranceOrder", "script", "restrictions", "notes",
] as const;
type FormState = Record<(typeof TEXT_FIELDS)[number], string> & { startsAt: string; rehearsalAt: string; churchVendorId: string; celebrantVendorId: string; plannerVendorId: string };

export function CeremonyPage() {
  const q = trpc.ceremony.get.useQuery();
  return (
    <>
      <PageHeader title="Igreja e cerimônia" description="Local, celebrante, cerimonialista, regras, documentos, roteiro e o cronograma do dia." />
      <QueryState query={q}>{(d) => <CeremonyContent data={d} />}</QueryState>
    </>
  );
}

function CeremonyContent({ data }: { data: Data }) {
  const { can } = useMe();
  const utils = trpc.useUtils();
  const editable = can("ceremony:edit");
  const vendors = trpc.vendors.list.useQuery(undefined, { enabled: can("vendors:view") });
  const c = data.ceremony;
  const init = (): FormState => ({
    ...(Object.fromEntries(TEXT_FIELDS.map((k) => [k, c[k] ?? ""])) as Record<(typeof TEXT_FIELDS)[number], string>),
    startsAt: toDateTimeInput(c.startsAt), rehearsalAt: toDateTimeInput(c.rehearsalAt), churchVendorId: c.churchVendorId ?? "", celebrantVendorId: c.celebrantVendorId ?? "", plannerVendorId: c.plannerVendorId ?? "",
  });
  const [f, setF] = useState<FormState>(init);
  useEffect(() => setF(init()), [c.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(f) !== JSON.stringify(init());
  const save = trpc.ceremony.update.useMutation({ onSuccess: () => { toast.success("Cerimônia salva"); utils.ceremony.invalidate(); utils.calendar.invalidate(); }, onError: (e) => toast.error(e.message) });

  function submit() {
    save.mutate({
      ...(Object.fromEntries(TEXT_FIELDS.map((k) => [k, f[k] || null])) as Record<(typeof TEXT_FIELDS)[number], string | null>),
      startsAt: fromDateTimeInput(f.startsAt), rehearsalAt: fromDateTimeInput(f.rehearsalAt),
      churchVendorId: f.churchVendorId || null, celebrantVendorId: f.celebrantVendorId || null, plannerVendorId: f.plannerVendorId || null,
    });
  }
  const T = (k: (typeof TEXT_FIELDS)[number], label: string, multiline = true) => <TextField label={label} multiline={multiline} value={f[k]} onChange={(v) => setF({ ...f, [k]: v })} />;
  const vendorOpts = (vendors.data ?? []).map((v) => ({ value: v.id, label: v.name }));

  return (
    <div className="space-y-5">
      {editable && dirty && (
        <div className="sticky top-2 z-20 flex items-center justify-between gap-2 rounded-xl border border-primary/30 bg-card/95 px-4 py-2 shadow-soft backdrop-blur">
          <span className="text-sm">Alterações não salvas</span>
          <div className="flex gap-2"><Button variant="ghost" size="sm" onClick={() => setF(init())}>Descartar</Button><LoadingButton size="sm" loading={save.isPending} onClick={submit}>Salvar</LoadingButton></div>
        </div>
      )}
      <fieldset disabled={!editable} className="grid gap-5 xl:grid-cols-2">
        <Section title="Local e horário">
          <div className="space-y-3">
            {T("venueName", "Igreja / local religioso", false)}
            {T("address", "Endereço", false)}
            <Field label="Data e horário da cerimônia"><Input type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></Field>
          </div>
        </Section>
        <Section title="Responsáveis e fornecedores">
          <div className="space-y-3">
            {T("responsible", "Pessoa ou equipe responsável", false)}
            {T("contacts", "Contatos")}
            {can("vendors:view") ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Igreja (fornecedor)"><NativeSelect placeholder="—" value={f.churchVendorId} onChange={(e) => setF({ ...f, churchVendorId: e.target.value })} options={vendorOpts} /></Field>
                <Field label="Celebrante"><NativeSelect placeholder="—" value={f.celebrantVendorId} onChange={(e) => setF({ ...f, celebrantVendorId: e.target.value })} options={vendorOpts} /></Field>
                <Field label="Cerimonialista"><NativeSelect placeholder="—" value={f.plannerVendorId} onChange={(e) => setF({ ...f, plannerVendorId: e.target.value })} options={vendorOpts} /></Field>
              </div>
            ) : null}
            {data.vendors.length > 0 && (
              <ul className="space-y-1 text-sm">
                {data.vendors.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-2">
                    <Link to={`/fornecedores/${v.id}`} className="font-medium text-primary hover:underline">{v.name}</Link>
                    <StatusBadge tone={VENDOR_STATUS[v.status]?.tone}>{VENDOR_STATUS[v.status]?.label}</StatusBadge>
                    <span className="text-xs text-muted-foreground">{[v.contactName, formatPhone(v.whatsapp ?? v.phone), v.email].filter(Boolean).join(" · ")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>
        <Section title="Regras">
          <div className="space-y-3">{T("decorationRules", "Decoração")}{T("photoRules", "Fotografia e filmagem")}{T("restrictions", "Restrições e observações")}</div>
        </Section>
        <Section title="Documentos, prazos e preparação">
          <div className="space-y-3">
            {T("requiredDocs", "Documentos exigidos")}
            {T("deadlines", "Prazos religiosos e administrativos")}
            {T("prepCourse", "Preparação dos noivos (curso de noivos)")}
            <Field label="Ensaio" hint="Aparece automaticamente no calendário"><Input type="datetime-local" value={f.rehearsalAt} onChange={(e) => setF({ ...f, rehearsalAt: e.target.value })} /></Field>
          </div>
        </Section>
        <Section title="Celebração">
          <div className="space-y-3">{T("readings", "Leituras")}{T("music", "Músicas")}{T("entranceOrder", "Ordem das entradas")}</div>
        </Section>
        <Section title="Roteiro">
          <div className="space-y-3">{T("script", "Roteiro da celebração")}{T("notes", "Observações gerais")}</div>
        </Section>
      </fieldset>
      {editable && <div className="flex justify-end"><LoadingButton loading={save.isPending} disabled={!dirty} onClick={submit}>Salvar cerimônia</LoadingButton></div>}

      {data.costs && <CostsSection costs={data.costs} vendors={data.vendors} />}
      <Participants participants={c.participants} />
      {data.tasks && <AreaChecklists tasks={data.tasks} areas={["CHURCH", "CELEBRANT", "PLANNER", "CEREMONY"]} />}
      <DaySchedule />
    </div>
  );
}

/** Cobranças vindas do Financeiro (somente leitura) — reutilizado na Recepção */
export function CostsSection({ costs, vendors, title = "Taxas e cobranças" }: { costs: Cost[]; vendors: { id: string; name: string }[]; title?: string }) {
  const { can } = useMe();
  const total = (k: keyof Cost) => costs.reduce((a, c) => a + (typeof c[k] === "number" ? (c[k] as number) : 0), 0);
  return (
    <Section
      title={title}
      description="Valores do módulo Financeiro (vinculados pelo fornecedor). Para alterar, edite o lançamento — nada é duplicado aqui."
      actions={can("finance:create") && vendors.length > 0 ? (
        <div className="flex flex-wrap gap-2">{vendors.map((v) => <Button key={v.id} asChild size="sm" variant="outline"><Link to={`/financeiro/lancamentos/novo?vendor=${v.id}`}><Plus /> Cobrança · {v.name}</Link></Button>)}</div>
      ) : undefined}
    >
      {costs.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">Lançamento</th><th className="text-right">Contratado</th><th className="text-right">Cauções</th><th className="text-right">Pago</th><th className="text-right">Em aberto</th><th className="text-right">Caução a recuperar</th></tr></thead>
            <tbody className="divide-y">
              {costs.map((c) => (
                <tr key={c.id}>
                  <td className="py-2"><Link className="inline-flex items-center gap-1 text-primary hover:underline" to={`/financeiro/lancamentos/${c.id}`}>{c.title}<ExternalLink className="size-3" /></Link>{c.status !== "ACTIVE" && <span className="ml-2 text-xs text-muted-foreground">({c.status === "DRAFT" ? `rascunho · previsto ${money(c.planned)}` : "cancelado"})</span>}</td>
                  <td className="text-right tabular-nums">{money(c.contracted)}</td><td className="text-right tabular-nums">{money(c.depositsContracted)}</td><td className="text-right tabular-nums">{money(c.paid)}</td><td className="text-right tabular-nums">{money(c.open)}</td><td className="text-right tabular-nums">{money(c.depositPending)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="font-medium"><tr className="border-t"><td className="py-2">Total</td><td className="text-right tabular-nums">{money(total("contracted"))}</td><td className="text-right tabular-nums">{money(total("depositsContracted"))}</td><td className="text-right tabular-nums">{money(total("paid"))}</td><td className="text-right tabular-nums">{money(total("open"))}</td><td className="text-right tabular-nums">{money(total("depositPending"))}</td></tr></tfoot>
          </table>
        </div>
      ) : <p className="text-sm text-muted-foreground">{vendors.length ? "Nenhum lançamento financeiro para os fornecedores vinculados." : "Vincule os fornecedores acima para ver as cobranças."}</p>}
    </Section>
  );
}

type Participant = Data["ceremony"]["participants"][number];

function Participants({ participants }: { participants: Participant[] }) {
  const { can } = useMe();
  const utils = trpc.useUtils();
  const [edit, setEdit] = useState<Partial<Participant> | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const save = trpc.ceremony.saveParticipant.useMutation({ onSuccess: () => { toast.success("Participante salvo"); utils.ceremony.get.invalidate(); setEdit(null); }, onError: (e) => toast.error(e.message) });
  const remove = trpc.ceremony.deleteParticipant.useMutation({ onSuccess: () => { toast.success("Participante removido"); utils.ceremony.get.invalidate(); setDel(null); }, onError: (e) => toast.error(e.message) });
  const byRole = Object.keys(PARTICIPANT_ROLE).map((r) => ({ role: r, items: participants.filter((p) => p.role === r) })).filter((g) => g.items.length);
  return (
    <Section title="Padrinhos, testemunhas e participantes" actions={can("ceremony:edit") && <Button size="sm" onClick={() => setEdit({ role: "GODPARENT", name: "" })}><Plus /> Adicionar</Button>}>
      {participants.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {byRole.map((g) => (
            <div key={g.role}>
              <h3 className="mb-1.5 font-sans text-sm font-semibold">{PARTICIPANT_ROLE[g.role]} ({g.items.length})</h3>
              <ul className="divide-y rounded-xl border">
                {g.items.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1"><div className="truncate">{p.name}</div><div className="truncate text-xs text-muted-foreground">{[p.side, formatPhone(p.phone), p.notes].filter(Boolean).join(" · ")}</div></div>
                    {can("ceremony:edit") && <><Button size="icon-sm" variant="ghost" aria-label="Editar" onClick={() => setEdit(p)}><Pencil /></Button><Button size="icon-sm" variant="ghost" aria-label="Remover" onClick={() => setDel(p.id)}><Trash2 /></Button></>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : <p className="text-sm text-muted-foreground">Nenhum participante cadastrado.</p>}
      {edit && (
        <Dialog open onOpenChange={(o) => !o && setEdit(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader><DialogTitle>{edit.id ? "Editar participante" : "Novo participante"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Field label="Papel"><NativeSelect value={edit.role ?? "GODPARENT"} onChange={(e) => setEdit({ ...edit, role: e.target.value })} options={opt(PARTICIPANT_ROLE)} /></Field>
              <TextField label="Nome" value={edit.name ?? ""} onChange={(v) => setEdit({ ...edit, name: v })} />
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label="Lado (noivo/noiva)" value={edit.side ?? ""} onChange={(v) => setEdit({ ...edit, side: v })} />
                <PhoneField label="Telefone" value={edit.phone ?? ""} onChange={(v) => setEdit({ ...edit, phone: v })} />
              </div>
              <TextField label="Observações" multiline value={edit.notes ?? ""} onChange={(v) => setEdit({ ...edit, notes: v })} />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button>
              <LoadingButton loading={save.isPending} disabled={!edit.name?.trim()} onClick={() => save.mutate({ id: edit.id, role: (edit.role ?? "GODPARENT") as never, name: edit.name!.trim(), side: edit.side || null, phone: edit.phone || null, notes: edit.notes || null, sortOrder: edit.sortOrder ?? 0 })}>Salvar</LoadingButton>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title="Remover participante?" destructive confirmLabel="Remover" loading={remove.isPending} onConfirm={() => del && remove.mutate({ id: del })} />
    </Section>
  );
}

/** Checklists específicos por área (reutilizado na Recepção) */
export function AreaChecklists({ tasks, areas }: { tasks: (Task | { id: string; title: string; status: string; dueDate: Date | null; priority: string; area: string | null })[]; areas: string[] }) {
  const { can } = useMe();
  const utils = trpc.useUtils();
  const [newArea, setNewArea] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const setStatus = trpc.planning.setStatus.useMutation({ onSuccess: () => { utils.ceremony.invalidate(); utils.planning.invalidate(); }, onError: (e) => toast.error(e.message) });
  return (
    <Section title="Checklists" description="Tarefas do checklist geral marcadas com a área correspondente.">
      <div className="grid gap-4 md:grid-cols-2">
        {areas.map((a) => {
          const list = tasks.filter((t) => t.area === a);
          return (
            <div key={a} className="rounded-xl border">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <h3 className="font-sans text-sm font-semibold">{AREA[a]} <span className="font-normal text-muted-foreground">· {list.filter((t) => t.status === "DONE").length}/{list.length}</span></h3>
                {can("planning:create") && <Button size="xs" variant="ghost" onClick={() => setNewArea(a)}><Plus /> Tarefa</Button>}
              </div>
              {list.length ? (
                <ul className="divide-y">
                  {list.map((t) => (
                    <li key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <Checkbox checked={t.status === "DONE"} disabled={!can("planning:edit")} onCheckedChange={(v) => setStatus.mutate({ id: t.id, status: v ? "DONE" : "IN_PROGRESS" })} />
                      <button type="button" className={cn("min-w-0 flex-1 truncate text-left", t.status === "DONE" && "text-muted-foreground line-through")} onClick={() => setOpenId(t.id)}>{t.title}</button>
                      <StatusBadge tone={PRIORITY[t.priority]?.tone}>{PRIORITY[t.priority]?.label}</StatusBadge>
                      <span className={cn("w-20 text-right text-xs tabular-nums", isOverdue(t.dueDate, t.status) ? "font-semibold text-destructive" : "text-muted-foreground")}>{t.dueDate ? date(t.dueDate) : "—"}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="p-3 text-sm text-muted-foreground">Nenhuma tarefa.</p>}
            </div>
          );
        })}
      </div>
      {newArea && <TaskSheet id={null} preset={{ area: newArea }} onClose={() => setNewArea(null)} />}
      {openId && <TaskSheet id={openId} onClose={() => setOpenId(null)} />}
    </Section>
  );
}

type ScheduleItem = RouterOutputs["ceremony"]["schedule"][number];

function DaySchedule() {
  const { can, wedding } = useMe();
  const utils = trpc.useUtils();
  const q = trpc.ceremony.schedule.useQuery();
  const [edit, setEdit] = useState<(Partial<ScheduleItem> & { startsAtInput?: string }) | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const [areaFilter, setAreaFilter] = useState("");
  const save = trpc.ceremony.saveScheduleItem.useMutation({ onSuccess: () => { toast.success("Item salvo"); utils.ceremony.schedule.invalidate(); setEdit(null); }, onError: (e) => toast.error(e.message) });
  const remove = trpc.ceremony.deleteScheduleItem.useMutation({ onSuccess: () => { toast.success("Item removido"); utils.ceremony.schedule.invalidate(); setDel(null); }, onError: (e) => toast.error(e.message) });
  const defaultStart = toDateTimeInput(wedding?.date ?? new Date());
  return (
    <Section
      title="Cronograma do dia"
      description="Preparação, cerimônia e recepção, em ordem de horário."
      actions={
        <div className="flex gap-2">
          <NativeSelect className="w-auto" placeholder="Todas as etapas" value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)} options={opt(SCHEDULE_AREA)} />
          {can("ceremony:edit") && <Button size="sm" onClick={() => setEdit({ area: "CEREMONY", title: "", startsAtInput: defaultStart })}><Plus /> Item</Button>}
        </div>
      }
    >
      <QueryState query={q} empty={(l) => (l.length ? null : <EmptyState icon={<Clock />} title="Cronograma vazio" description="Inclua horários de chegada, maquiagem, cerimônia, fotos, jantar, festa…" />)}>
        {(list) => (
          <ol className="relative ml-3 border-l-2 border-primary/20">
            {list.filter((i) => !areaFilter || i.area === areaFilter).map((i) => (
              <li key={i.id} className="mb-3 ml-5">
                <span className="absolute -left-[7px] mt-1.5 size-3 rounded-full border-2 border-card bg-primary" />
                <div className="flex flex-wrap items-start gap-2">
                  <span className="w-28 shrink-0 font-medium tabular-nums">{time(i.startsAt)} <span className="text-xs font-normal text-muted-foreground">{date(i.startsAt, { day: "2-digit", month: "2-digit" })}</span></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{i.title} <StatusBadge className="ml-1">{SCHEDULE_AREA[i.area]}</StatusBadge></div>
                    <div className="text-xs text-muted-foreground">{[i.responsible && `Responsável: ${i.responsible}`, i.description].filter(Boolean).join(" · ")}</div>
                  </div>
                  {can("ceremony:edit") && <><Button size="icon-sm" variant="ghost" aria-label="Editar" onClick={() => setEdit({ ...i, startsAtInput: toDateTimeInput(i.startsAt) })}><Pencil /></Button><Button size="icon-sm" variant="ghost" aria-label="Remover" onClick={() => setDel(i.id)}><Trash2 /></Button></>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </QueryState>
      {edit && (
        <Dialog open onOpenChange={(o) => !o && setEdit(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader><DialogTitle>{edit.id ? "Editar item" : "Novo item do cronograma"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Etapa"><NativeSelect value={edit.area ?? "CEREMONY"} onChange={(e) => setEdit({ ...edit, area: e.target.value })} options={opt(SCHEDULE_AREA)} /></Field>
                <Field label="Horário"><Input type="datetime-local" value={edit.startsAtInput ?? ""} onChange={(e) => setEdit({ ...edit, startsAtInput: e.target.value })} /></Field>
              </div>
              <TextField label="Título" value={edit.title ?? ""} onChange={(v) => setEdit({ ...edit, title: v })} />
              <TextField label="Responsável" value={edit.responsible ?? ""} onChange={(v) => setEdit({ ...edit, responsible: v })} />
              <TextField label="Descrição" multiline value={edit.description ?? ""} onChange={(v) => setEdit({ ...edit, description: v })} />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button>
              <LoadingButton
                loading={save.isPending}
                disabled={!edit.title?.trim() || !edit.startsAtInput}
                onClick={() => save.mutate({ id: edit.id, area: (edit.area ?? "CEREMONY") as never, startsAt: fromDateTimeInput(edit.startsAtInput!)!, title: edit.title!.trim(), description: edit.description || null, responsible: edit.responsible || null })}
              >
                Salvar
              </LoadingButton>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title="Remover item do cronograma?" destructive confirmLabel="Remover" loading={remove.isPending} onConfirm={() => del && remove.mutate({ id: del })} />
    </Section>
  );
}
