import {
  Baby, Download, FileSpreadsheet, ListPlus, Mail, Pencil, Plus, Printer, RotateCcw, Search, ShieldCheck, Trash2, Upload, UserCheck, UserPlus, Users, UserX, FileDown
} from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import {
  ConfirmDialog, EmptyState, Field, LoadingButton, PageHeader, QueryState, Section, StatCard, StatusBadge, TextField, errorMessage, PhoneField } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useMe } from "@/hooks/use-me";
import { downloadReportPdf } from "@/lib/report-pdf";
import { dateTime, formatPhone, plural } from "@/lib/format";
import { INVITE_STATUS, MESSAGE_STATUS, RSVP_STATUS, SIDE, opt } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { trpc, type RouterInputs, type RouterOutputs } from "@/trpc";

type Guest = RouterOutputs["guests"]["list"][number];
type Group = RouterOutputs["guests"]["groups"][number];
type BulkRow = RouterInputs["guests"]["bulkCreate"]["rows"][number];

// ───────────── Helpers locais ─────────────

export function NativeSelect({ value, onChange, options, placeholder, className, id }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string; className?: string; id?: string }) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn("h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30", className)}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function parseDuplicate(e: unknown): { id: string; fullName: string }[] | null {
  const m = (e as { message?: string })?.message ?? "";
  if (!m.startsWith("DUPLICATE:")) return null;
  try {
    return JSON.parse(m.slice("DUPLICATE:".length));
  } catch {
    return [];
  }
}

function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const RsvpBadge = ({ s }: { s: string }) => <StatusBadge tone={RSVP_STATUS[s]?.tone}>{RSVP_STATUS[s]?.label ?? s}</StatusBadge>;
const InviteBadge = ({ s }: { s: string }) => <StatusBadge tone={INVITE_STATUS[s]?.tone}>{INVITE_STATUS[s]?.label ?? s}</StatusBadge>;

// ───────────── Formulário do convidado ─────────────

type GuestForm = {
  id?: string; fullName: string; phone: string; email: string; groupId: string; newGroupName: string; relation: string; side: string; category: string;
  isChild: boolean; age: string; plusOnesAllowed: string; dietary: string; accessibility: string; tableName: string; notes: string;
};
const emptyForm = (groupId = ""): GuestForm => ({ fullName: "", phone: "", email: "", groupId, newGroupName: "", relation: "", side: "", category: "", isChild: false, age: "", plusOnesAllowed: "0", dietary: "", accessibility: "", tableName: "", notes: "" });

function GuestDialog({ open, onOpenChange, initial, groups }: { open: boolean; onOpenChange: (o: boolean) => void; initial: GuestForm; groups: { id: string; name: string }[] }) {
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dups, setDups] = useState<{ id: string; fullName: string }[] | null>(null);
  const utils = trpc.useUtils();
  const save = trpc.guests.save.useMutation();
  const set = <K extends keyof GuestForm>(k: K, v: GuestForm[K]) => setF((x) => ({ ...x, [k]: v }));

  async function submit(ignoreDuplicates = false) {
    const errs: Record<string, string> = {};
    if (f.fullName.trim().length < 2) errs.fullName = "Informe o nome completo";
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) errs.email = "E-mail inválido";
    if (!f.id && !f.groupId && !f.newGroupName.trim()) errs.group = "Escolha uma família ou informe o nome de uma nova (se vazio, usaremos o nome do convidado)";
    setErrors(errs);
    if (errs.fullName || errs.email) return;
    try {
      await save.mutateAsync({
        id: f.id, fullName: f.fullName.trim(), phone: f.phone || null, email: f.email || null, relation: f.relation || null, side: f.side || null, category: f.category || null,
        isChild: f.isChild, age: f.isChild && f.age ? Number(f.age) : null, plusOnesAllowed: Math.max(0, Math.min(10, Number(f.plusOnesAllowed) || 0)),
        dietary: f.dietary || null, accessibility: f.accessibility || null, tableName: f.tableName || null, notes: f.notes || null,
        ...(f.groupId ? { groupId: f.groupId } : f.newGroupName.trim() ? { newGroupName: f.newGroupName.trim() } : f.id ? {} : { groupId: null }),
        ignoreDuplicates,
      });
      toast.success(f.id ? "Convidado atualizado" : "Convidado cadastrado");
      setDups(null);
      await utils.guests.invalidate();
      onOpenChange(false);
    } catch (e) {
      const d = parseDuplicate(e);
      if (d) setDups(d);
      else toast.error(errorMessage(e));
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{f.id ? "Editar convidado" : "Novo convidado"}</DialogTitle>
            <DialogDescription>O telefone não identifica a pessoa: várias pessoas da mesma família podem compartilhar o mesmo número.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Nome completo" value={f.fullName} onChange={(v) => set("fullName", v)} error={errors.fullName} className="sm:col-span-2" autoFocus />
            <Field label="Família / grupo" htmlFor="g-group" hint={!f.groupId ? "Ou digite abaixo o nome de uma nova família" : undefined}>
              <NativeSelect id="g-group" value={f.groupId} onChange={(v) => set("groupId", v)} placeholder={f.id ? "Manter a atual" : "Nova família…"} options={groups.map((g) => ({ value: g.id, label: g.name }))} />
            </Field>
            {!f.groupId ? <TextField label="Nome da nova família" value={f.newGroupName} onChange={(v) => set("newGroupName", v)} placeholder="Ex.: Família Silva" /> : <div className="hidden sm:block" />}
            <PhoneField label="Telefone / WhatsApp" value={f.phone} onChange={(v) => set("phone", v)} />
            <TextField label="E-mail (opcional)" value={f.email} onChange={(v) => set("email", v)} error={errors.email} type="email" />
            <TextField label="Relação com o casal" value={f.relation} onChange={(v) => set("relation", v)} placeholder="Tia, amigo da faculdade…" />
            <Field label="Lado" htmlFor="g-side"><NativeSelect id="g-side" value={f.side} onChange={(v) => set("side", v)} placeholder="—" options={opt(SIDE)} /></Field>
            <TextField label="Categoria do convite" value={f.category} onChange={(v) => set("category", v)} placeholder="A, B, C…" maxLength={10} />
            <Field label="Acompanhantes permitidos" htmlFor="g-plus" hint="Pessoas extras sem cadastro próprio (+1)">
              <Input id="g-plus" type="number" min={0} max={10} value={f.plusOnesAllowed} onChange={(e) => set("plusOnesAllowed", e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.isChild} onCheckedChange={(v) => set("isChild", !!v)} /> É criança</label>
            {f.isChild ? <Field label="Idade" htmlFor="g-age"><Input id="g-age" type="number" min={0} max={17} value={f.age} onChange={(e) => set("age", e.target.value)} /></Field> : <div className="hidden sm:block" />}
            <TextField label="Restrições alimentares" value={f.dietary} onChange={(v) => set("dietary", v)} />
            <TextField label="Acessibilidade" value={f.accessibility} onChange={(v) => set("accessibility", v)} />
            <TextField label="Mesa" value={f.tableName} onChange={(v) => set("tableName", v)} />
            <TextField label="Observações" value={f.notes} onChange={(v) => set("notes", v)} multiline className="sm:col-span-2" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <LoadingButton loading={save.isPending} onClick={() => submit(false)}>Salvar</LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!dups}
        onOpenChange={(o) => !o && setDups(null)}
        title="Possível duplicidade"
        description="Já existe convidado com nome muito parecido. Confira antes de salvar."
        confirmLabel="Salvar mesmo assim"
        loading={save.isPending}
        onConfirm={() => submit(true)}
      >
        <ul className="list-disc pl-5 text-sm">{dups?.map((d) => <li key={d.id}>{d.fullName}</li>)}</ul>
      </ConfirmDialog>
    </>
  );
}

// ───────────── Família ─────────────

function GroupDialog({ open, onOpenChange, group }: { open: boolean; onOpenChange: (o: boolean) => void; group: Group | null }) {
  const [f, setF] = useState({ name: group?.name ?? "", contactPhone: group?.contactPhone ?? "", contactEmail: group?.contactEmail ?? "", side: group?.side ?? "", notes: group?.notes ?? "" });
  const [del, setDel] = useState(false);
  const utils = trpc.useUtils();
  const save = trpc.guests.saveGroup.useMutation({
    onSuccess: async () => { toast.success("Família salva"); await utils.guests.invalidate(); onOpenChange(false); },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.guests.deleteGroup.useMutation({
    onSuccess: async () => { toast.success("Família excluída"); setDel(false); await utils.guests.invalidate(); onOpenChange(false); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{group ? "Editar família" : "Nova família"}</DialogTitle><DialogDescription>A família é a unidade do convite e do link de confirmação.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <TextField label="Nome" value={f.name} onChange={(v) => setF({ ...f, name: v })} placeholder="Família Souza" />
          <div className="grid gap-3 sm:grid-cols-2">
            <PhoneField label="Telefone de contato" value={f.contactPhone} onChange={(v) => setF({ ...f, contactPhone: v })} />
            <TextField label="E-mail de contato" value={f.contactEmail} onChange={(v) => setF({ ...f, contactEmail: v })} />
          </div>
          <Field label="Lado"><NativeSelect value={f.side} onChange={(v) => setF({ ...f, side: v })} placeholder="—" options={opt(SIDE)} /></Field>
          <TextField label="Observações" value={f.notes} onChange={(v) => setF({ ...f, notes: v })} multiline />
        </div>
        <DialogFooter className="sm:justify-between">
          {group && !group.guests.length ? <Button variant="destructive" onClick={() => setDel(true)}><Trash2 /> Excluir</Button> : <span />}
          <LoadingButton loading={save.isPending} disabled={f.name.trim().length < 2} onClick={() => save.mutate({ id: group?.id, name: f.name.trim(), contactPhone: f.contactPhone || null, contactEmail: f.contactEmail || null, side: f.side || null, notes: f.notes || null })}>Salvar</LoadingButton>
        </DialogFooter>
        <ConfirmDialog open={del} onOpenChange={setDel} title="Excluir família?" description="Só é possível excluir famílias sem convidados." destructive confirmLabel="Excluir" loading={remove.isPending} onConfirm={() => group && remove.mutate({ id: group.id })} />
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Detalhe do convidado ─────────────

function GuestSheet({ id, onClose, onEdit }: { id: string | null; onClose: () => void; onEdit: (g: GuestForm) => void }) {
  const { can } = useMe();
  const q = trpc.guests.get.useQuery({ id: id ?? "" }, { enabled: !!id });
  const utils = trpc.useUtils();
  const [rsvp, setRsvp] = useState<{ status: string; companions: { name: string; isChild: boolean; dietary: string }[] } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmDeletion, setConfirmDeletion] = useState(false);
  const refresh = () => utils.guests.invalidate();
  const setRsvpM = trpc.guests.setRsvp.useMutation({ onSuccess: async () => { toast.success("Confirmação registrada"); setRsvp(null); await refresh(); }, onError: (e) => toast.error(e.message) });
  const remove = trpc.guests.remove.useMutation({ onSuccess: async () => { toast.success("Convidado removido da lista"); setConfirmRemove(false); await refresh(); onClose(); }, onError: (e) => toast.error(e.message) });
  const exportData = trpc.privacy.exportGuest.useMutation({ onSuccess: (d) => { downloadJson(`dados-${id}.json`, d); toast.success("Dados exportados"); }, onError: (e) => toast.error(e.message) });
  const requestDeletion = trpc.privacy.requestDeletion.useMutation({ onSuccess: () => { toast.success("Pedido de exclusão registrado"); setConfirmDeletion(false); }, onError: (e) => toast.error(e.message) });

  const g = q.data;
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="xl" className="overflow-y-auto">
        <SheetHeader><SheetTitle>{g?.fullName ?? "Convidado"}</SheetTitle></SheetHeader>
        <div className="px-5 py-5">
          <QueryState query={q}>
            {(g) => (
              <div className="space-y-5 text-sm">
                <div className="flex flex-wrap gap-2"><RsvpBadge s={g.rsvpStatus} /><InviteBadge s={g.inviteStatus} />{g.isChild && <StatusBadge tone="sky"><Baby className="size-3" /> Criança</StatusBadge>}{g.deletedAt && <StatusBadge tone="rose">Removido</StatusBadge>}</div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                  {([
                    ["Família", g.group.name], ["Telefone", formatPhone(g.phone)], ["E-mail", g.email], ["Relação", g.relation], ["Lado", g.side ? SIDE[g.side] ?? g.side : null], ["Categoria", g.category],
                    ["Idade", g.age], ["Acompanhantes permitidos", g.plusOnesAllowed], ["Restrições", g.dietary], ["Acessibilidade", g.accessibility], ["Mesa", g.tableName], ["Observações", g.notes],
                  ] as [string, ReactNode][]).filter(([, v]) => v !== null && v !== "" && v !== undefined).map(([k, v]) => (
                    <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="whitespace-pre-wrap">{v}</dd></div>
                  ))}
                </dl>
                {g.group.guests.length > 1 && <p className="text-xs text-muted-foreground">Mesma família: {g.group.guests.filter((x) => x.id !== g.id).map((x) => x.fullName).join(", ")}</p>}

                <div className="flex flex-wrap gap-2">
                  {can("guests:edit") && !g.deletedAt && (
                    <Button size="sm" variant="outline" onClick={() => onEdit({ id: g.id, fullName: g.fullName, phone: g.phone ?? "", email: g.email ?? "", groupId: g.groupId, newGroupName: "", relation: g.relation ?? "", side: g.side ?? "", category: g.category ?? "", isChild: g.isChild, age: g.age?.toString() ?? "", plusOnesAllowed: String(g.plusOnesAllowed), dietary: g.dietary ?? "", accessibility: g.accessibility ?? "", tableName: g.tableName ?? "", notes: g.notes ?? "" })}>
                      <Pencil /> Editar
                    </Button>
                  )}
                  {can("rsvp:edit") && !g.deletedAt && <Button size="sm" variant="outline" onClick={() => setRsvp({ status: g.rsvpStatus, companions: g.companions.map((c) => ({ name: c.name ?? "", isChild: c.isChild, dietary: c.dietary ?? "" })) })}><UserCheck /> Registrar resposta</Button>}
                  {can("guests:delete") && (g.deletedAt
                    ? <Button size="sm" variant="outline" onClick={() => remove.mutate({ id: g.id, restore: true })}><RotateCcw /> Restaurar</Button>
                    : <Button size="sm" variant="destructive" onClick={() => setConfirmRemove(true)}><Trash2 /> Remover</Button>)}
                </div>

                {rsvp && (
                  <div className="space-y-3 rounded-xl border p-3">
                    <div className="flex gap-2">
                      {(["ACCEPTED", "DECLINED", "PENDING"] as const).map((s) => (
                        <Button key={s} size="sm" variant={rsvp.status === s ? "default" : "outline"} onClick={() => setRsvp({ ...rsvp, status: s })}>{RSVP_STATUS[s]!.label}</Button>
                      ))}
                    </div>
                    {rsvp.status === "ACCEPTED" && g.plusOnesAllowed > 0 && (
                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">Acompanhantes ({rsvp.companions.length}/{g.plusOnesAllowed})</div>
                        {rsvp.companions.map((c, i) => (
                          <div key={i} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                            <Input placeholder="Nome" value={c.name} onChange={(e) => setRsvp({ ...rsvp, companions: rsvp.companions.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)) })} />
                            <label className="flex items-center gap-1 text-xs"><Checkbox checked={c.isChild} onCheckedChange={(v) => setRsvp({ ...rsvp, companions: rsvp.companions.map((x, k) => (k === i ? { ...x, isChild: !!v } : x)) })} /> Criança</label>
                            <Button size="icon-sm" variant="ghost" aria-label="Remover" onClick={() => setRsvp({ ...rsvp, companions: rsvp.companions.filter((_, k) => k !== i) })}><Trash2 /></Button>
                          </div>
                        ))}
                        {rsvp.companions.length < g.plusOnesAllowed && <Button size="sm" variant="ghost" onClick={() => setRsvp({ ...rsvp, companions: [...rsvp.companions, { name: "", isChild: false, dietary: "" }] })}><Plus /> Acompanhante</Button>}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <LoadingButton size="sm" loading={setRsvpM.isPending} onClick={() => setRsvpM.mutate({ guestId: g.id, status: rsvp.status as "ACCEPTED", companions: rsvp.status === "ACCEPTED" ? rsvp.companions.map((c) => ({ name: c.name || null, isChild: c.isChild, dietary: c.dietary || null })) : [] })}>Salvar resposta</LoadingButton>
                      <Button size="sm" variant="ghost" onClick={() => setRsvp(null)}>Cancelar</Button>
                    </div>
                  </div>
                )}

                <Block title="Acompanhantes">
                  {g.companions.length ? <ul className="space-y-1">{g.companions.map((c) => <li key={c.id}>{c.name ?? "Sem nome"}{c.isChild ? " · criança" : ""}{c.dietary ? ` · ${c.dietary}` : ""}</li>)}</ul> : <p className="text-muted-foreground">Nenhum.</p>}
                </Block>
                <Block title="Histórico de respostas">
                  {g.rsvps.length ? <ul className="space-y-1">{g.rsvps.map((r) => <li key={r.id} className="flex flex-wrap items-center gap-2"><RsvpBadge s={r.status} /><span className="text-xs text-muted-foreground">{dateTime(r.createdAt)} · {r.source === "PORTAL" ? "Portal" : r.source === "WHATSAPP" ? "WhatsApp" : "Equipe"}{r.companions ? ` · +${r.companions}` : ""}</span>{r.message && <span className="w-full text-xs italic">“{r.message}”</span>}</li>)}</ul> : <p className="text-muted-foreground">Sem respostas ainda.</p>}
                </Block>
                {can("whatsapp:view") && (
                  <Block title="Mensagens">
                    {g.messages.length + g.inbound.length ? (
                      <ul className="space-y-2">
                        {[...g.messages.map((m) => ({ k: m.id, dir: "out", at: m.createdAt, body: m.body, status: m.status })), ...g.inbound.map((m) => ({ k: m.id, dir: "in", at: m.receivedAt, body: m.body ?? "[mídia]", status: null as string | null }))]
                          .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
                          .map((m) => (
                            <li key={m.k} className={cn("rounded-lg p-2 text-xs", m.dir === "out" ? "bg-accent/60" : "bg-muted")}>
                              <div className="mb-0.5 flex items-center gap-2 text-muted-foreground">{m.dir === "out" ? "Enviada" : "Recebida"} · {dateTime(m.at)}{m.status && <StatusBadge tone={MESSAGE_STATUS[m.status]?.tone}>{MESSAGE_STATUS[m.status]?.label}</StatusBadge>}</div>
                              <div className="line-clamp-4 whitespace-pre-wrap">{m.body}</div>
                            </li>
                          ))}
                      </ul>
                    ) : <p className="text-muted-foreground">Nenhuma mensagem.</p>}
                  </Block>
                )}
                <Block title="Histórico de alterações">
                  {g.history.length ? <ul className="space-y-1">{g.history.map((h) => <li key={h.id} className="text-xs"><span className="text-muted-foreground">{dateTime(h.createdAt)} · {h.userName ?? "Sistema"}:</span> {h.summary}</li>)}</ul> : <p className="text-muted-foreground">Sem registros.</p>}
                </Block>
                <Block title="Privacidade (LGPD)">
                  <div className="flex flex-wrap gap-2">
                    {can("guests:export") && <LoadingButton size="sm" variant="outline" loading={exportData.isPending} onClick={() => exportData.mutate({ guestId: g.id })}><Download /> Exportar dados pessoais</LoadingButton>}
                    {can("guests:delete") && <Button size="sm" variant="outline" onClick={() => setConfirmDeletion(true)}><ShieldCheck /> Pedido de exclusão</Button>}
                  </div>
                </Block>

                <ConfirmDialog open={confirmRemove} onOpenChange={setConfirmRemove} title="Remover da lista?" description="O convidado deixa de contar nas listas e pode ser restaurado depois." destructive confirmLabel="Remover" loading={remove.isPending} onConfirm={() => remove.mutate({ id: g.id })} />
                <ConfirmDialog open={confirmDeletion} onOpenChange={setConfirmDeletion} title="Registrar pedido de exclusão?" description="O pedido fica pendente para análise; a anonimização é executada por quem administra as configurações." confirmLabel="Registrar" loading={requestDeletion.isPending} onConfirm={() => requestDeletion.mutate({ guestId: g.id })} />
              </div>
            )}
          </QueryState>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 font-sans text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </div>
  );
}

// ───────────── Cadastro em lote e importação ─────────────

function RowsPreview({ rows, onRemove }: { rows: BulkRow[]; onRemove: (i: number) => void }) {
  return (
    <div className="max-h-72 overflow-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted text-left text-xs"><tr><th className="p-2">Nome</th><th className="p-2">Família</th><th className="p-2">Telefone</th><th className="p-2" /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t">
              <td className="p-2">{r.fullName}{r.isChild ? " (criança)" : ""}</td>
              <td className="p-2 text-muted-foreground">{r.family || "— (própria)"}</td>
              <td className="p-2 text-muted-foreground">{r.phone}</td>
              <td className="p-1 text-right"><Button size="icon-sm" variant="ghost" aria-label="Remover linha" onClick={() => onRemove(i)}><Trash2 /></Button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BulkDialog({ open, onOpenChange, mode }: { open: boolean; onOpenChange: (o: boolean) => void; mode: "paste" | "import" }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<BulkRow[] | null>(null);
  const [skip, setSkip] = useState(true);
  const [loadingFile, setLoadingFile] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const bulk = trpc.guests.bulkCreate.useMutation({
    onSuccess: async (r) => {
      toast.success(`${plural(r.created, "convidado criado", "convidados criados")}${r.skipped.length ? `, ${r.skipped.length} ignorado(s) por duplicidade` : ""}`);
      await utils.guests.invalidate();
      setRows(null);
      setText("");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  function parsePaste() {
    const parsed = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const [fullName = "", family = "", phone = ""] = l.split(/[;\t]/).map((x) => x.trim());
      return { fullName, family: family || null, phone: phone || null, isChild: false, plusOnesAllowed: 0 } as BulkRow;
    }).filter((r) => r.fullName.length >= 2);
    if (!parsed.length) return toast.error("Nenhuma linha válida. Use: Nome; Família; Telefone");
    setRows(parsed);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setLoadingFile(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/import/guests", { method: "POST", body: fd, credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao ler a planilha");
      setRows(data.rows);
      if (!data.rows.length) toast.error("Nenhuma linha válida encontrada");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingFile(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setRows(null); onOpenChange(o); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === "paste" ? "Cadastro em lote" : "Importar planilha"}</DialogTitle>
          <DialogDescription>
            {mode === "paste"
              ? "Uma pessoa por linha: Nome; Família; Telefone. Linhas com a mesma família ficam no mesmo convite."
              : "CSV ou XLSX com cabeçalho. Colunas reconhecidas: Nome, Família, Telefone, E-mail, Relação, Lado, Categoria, Criança, Acompanhantes, Restrições, Observações."}
          </DialogDescription>
        </DialogHeader>
        {!rows ? (
          mode === "paste" ? (
            <>
              <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Maria Silva; Família Silva; 11999990000\nJoão Silva; Família Silva; 11999990000\nAna Costa"} />
              <DialogFooter><Button onClick={parsePaste} disabled={!text.trim()}>Pré-visualizar</Button></DialogFooter>
            </>
          ) : (
            <div className="grid place-items-center gap-3 rounded-xl border border-dashed py-10">
              <input ref={fileRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
              <FileSpreadsheet className="size-8 text-muted-foreground" />
              <LoadingButton loading={loadingFile} onClick={() => fileRef.current?.click()}><Upload /> Escolher arquivo</LoadingButton>
              <p className="text-xs text-muted-foreground">Nada é gravado antes da sua revisão.</p>
            </div>
          )
        ) : (
          <>
            <p className="text-sm">{plural(rows.length, "linha", "linhas")} para cadastrar. Remova o que não quiser importar.</p>
            <RowsPreview rows={rows} onRemove={(i) => setRows(rows.filter((_, k) => k !== i))} />
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={skip} onCheckedChange={(v) => setSkip(!!v)} /> Ignorar nomes que já estão na lista</label>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRows(null)}>Voltar</Button>
              <LoadingButton loading={bulk.isPending} disabled={!rows.length} onClick={() => bulk.mutate({ rows, skipDuplicates: skip })}>Cadastrar {rows.length}</LoadingButton>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Lista final ─────────────

function FinalListPdf({ data }: { data: RouterOutputs["guests"]["finalList"] | undefined }) {
  const { wedding } = useMe();
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  async function run() {
    setBusy(true);
    try {
      const d = data!;
      await downloadReportPdf({
        title: "Lista final de convidados",
        subtitle: "Para buffet e cerimonialista — conta pessoas confirmadas, incluindo acompanhantes.",
        wedding: wedding ? { names: `${wedding.partner1Name} & ${wedding.partner2Name}`, date: wedding.date } : undefined,
        kpis: [{ label: "Pessoas", value: String(d.total) }, { label: "Adultos", value: String(d.adults) }, { label: "Crianças", value: String(d.children) }, { label: "Com restrição", value: String(d.withDietary) }],
        columns: [{ label: "Pessoa", flex: 2 }, { label: "Família", flex: 1.4 }, { label: "Tipo", flex: 0.8 }, { label: "Restrições / acessibilidade", flex: 2 }, { label: "Mesa", flex: 0.7, align: "center" }],
        rows: d.people.map((p) => [p.companionOf ? `${p.name} (acomp. de ${p.companionOf})` : p.name, p.family, p.child ? "Criança" : "Adulto", [p.dietary, p.accessibility].filter(Boolean).join(" · ") || "—", p.table ?? "—"]),
        fileName: `lista-final-convidados-${new Date().toISOString().slice(0, 10)}`,
      });
    } catch (e) {
      toast.error(`Não foi possível gerar o PDF: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }
  return <LoadingButton variant="outline" loading={busy} onClick={run}>{!busy && <FileDown />} Baixar PDF</LoadingButton>;
}

function FinalListDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const q = trpc.guests.finalList.useQuery(undefined, { enabled: open });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl print:max-h-none print:shadow-none">
        <DialogHeader>
          <DialogTitle>Lista final (buffet e cerimonialista)</DialogTitle>
          <DialogDescription>Conta pessoas confirmadas, incluindo acompanhantes.</DialogDescription>
        </DialogHeader>
        <QueryState query={q}>
          {(d) => (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[["Pessoas", d.total], ["Adultos", d.adults], ["Crianças", d.children], ["Com restrição", d.withDietary]].map(([k, v]) => (
                  <div key={k} className="rounded-xl border p-3"><div className="text-xs text-muted-foreground">{k}</div><div className="text-2xl font-semibold tabular-nums">{v}</div></div>
                ))}
              </div>
              {d.people.length ? (
                <div className="overflow-x-auto rounded-xl border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted text-left text-xs"><tr><th className="p-2">Pessoa</th><th className="p-2">Família</th><th className="p-2">Tipo</th><th className="p-2">Restrições</th><th className="p-2">Mesa</th></tr></thead>
                    <tbody>{d.people.map((p, i) => <tr key={i} className="border-t"><td className="p-2">{p.name}{p.companionOf && <span className="block text-xs text-muted-foreground">acomp. de {p.companionOf}</span>}</td><td className="p-2">{p.family}</td><td className="p-2">{p.child ? "Criança" : "Adulto"}</td><td className="p-2">{[p.dietary, p.accessibility].filter(Boolean).join(" · ")}</td><td className="p-2">{p.table}</td></tr>)}</tbody>
                  </table>
                </div>
              ) : <p className="text-sm text-muted-foreground">Ninguém confirmou ainda.</p>}
            </div>
          )}
        </QueryState>
        <DialogFooter><FinalListPdf data={q.data} /></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Página ─────────────

export function GuestsPage() {
  const { can } = useMe();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<"family" | "list">(params.get("rsvp") ? "list" : "family");
  const [filters, setFilters] = useState({ rsvp: params.get("rsvp") ?? "", inviteStatus: "", side: "", category: "", child: "", search: "", deleted: false });
  const [guestDialog, setGuestDialog] = useState<GuestForm | null>(null);
  const [groupDialog, setGroupDialog] = useState<{ group: Group | null } | null>(null);
  const [bulk, setBulk] = useState<"paste" | "import" | null>(null);
  const [finalOpen, setFinalOpen] = useState(false);
  const [showDups, setShowDups] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);

  const stats = trpc.guests.stats.useQuery();
  const groups = trpc.guests.groups.useQuery();
  const list = trpc.guests.list.useQuery(
    {
      rsvp: (filters.rsvp || undefined) as "PENDING" | undefined, inviteStatus: (filters.inviteStatus || undefined) as "SENT" | undefined, side: filters.side || undefined,
      category: filters.category || undefined, isChild: filters.child === "" ? undefined : filters.child === "1", search: filters.search || undefined, deleted: filters.deleted || undefined,
    },
    { enabled: view === "list" },
  );
  const dups = trpc.guests.duplicates.useQuery(undefined, { enabled: showDups });
  const groupOptions = useMemo(() => (groups.data ?? []).map((g) => ({ id: g.id, name: g.name })), [groups.data]);
  const setF = (patch: Partial<typeof filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    if ("rsvp" in patch) setParams(patch.rsvp ? { rsvp: patch.rsvp } : {}, { replace: true });
  };
  const s = stats.data;

  return (
    <>
      <PageHeader
        title="Convidados"
        description="Famílias, convidados, acompanhantes e confirmações. A contagem de confirmados é de pessoas, não de convites."
        actions={
          <>
            {can("guests:create") && <Button onClick={() => setGuestDialog(emptyForm())}><UserPlus /> Convidado</Button>}
            {can("guests:edit") && <Button variant="outline" onClick={() => setGroupDialog({ group: null })}><Users /> Família</Button>}
            {can("guests:create") && <Button variant="outline" onClick={() => setBulk("paste")}><ListPlus /> Em lote</Button>}
            {can("guests:create") && <Button variant="outline" onClick={() => setBulk("import")}><Upload /> Importar</Button>}
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard icon={<Users />} label="Cadastrados" value={s?.invited ?? "—"} hint={s ? `${s.groups} família(s)` : undefined} onClick={() => { setView("list"); setF({ rsvp: "" }); }} />
        <StatCard icon={<UserCheck />} label="Pessoas confirmadas" tone="emerald" value={s?.confirmedPeople ?? "—"} hint={s ? `${s.accepted} + ${s.companions} acomp.` : undefined} onClick={() => { setView("list"); setF({ rsvp: "ACCEPTED" }); }} />
        <StatCard icon={<Mail />} label="Sem resposta" tone="amber" value={s?.pending ?? "—"} onClick={() => { setView("list"); setF({ rsvp: "PENDING" }); }} />
        <StatCard icon={<UserX />} label="Não vão" tone="rose" value={s?.declined ?? "—"} onClick={() => { setView("list"); setF({ rsvp: "DECLINED" }); }} />
        <StatCard icon={<Baby />} label="Crianças confirmadas" tone="sky" value={s?.confirmedChildren ?? "—"} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border p-0.5">
          {(["family", "list"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} className={cn("rounded-md px-3 py-1 text-sm font-medium transition", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              {v === "family" ? "Por família" : "Lista"}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => setFinalOpen(true)}><Printer /> Lista final</Button>
          <Button size="sm" variant="ghost" onClick={() => setShowDups((x) => !x)}>Possíveis duplicados</Button>
          {can("reports:export") && (
            <>
              <Button size="sm" variant="ghost" asChild><a href="/api/export/convidados?format=csv"><Download /> CSV</a></Button>
              <Button size="sm" variant="ghost" asChild><a href="/api/export/convidados?format=xlsx"><Download /> XLSX</a></Button>
              <Button size="sm" variant="ghost" asChild><a href="/api/export/confirmacoes?format=xlsx"><Download /> Confirmados</a></Button>
            </>
          )}
        </div>
      </div>

      {showDups && (
        <Section title="Possíveis duplicados" description="Nomes iguais após normalização. Telefone repetido não é duplicidade (famílias compartilham números)." className="mb-5">
          <QueryState query={dups} empty={(d) => (!d.length ? <p className="text-sm text-muted-foreground">Nenhum nome duplicado.</p> : null)}>
            {(d) => (
              <ul className="space-y-2">
                {d.map((set, i) => (
                  <li key={i} className="flex flex-wrap gap-2 rounded-xl border p-2 text-sm">
                    {set.map((g) => <button key={g.id} type="button" onClick={() => setDetail(g.id)} className="rounded-lg bg-muted px-2 py-1 hover:bg-accent">{g.fullName} · {g.group.name}{g.phone ? ` · ${formatPhone(g.phone)}` : ""}</button>)}
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </Section>
      )}

      {view === "family" ? (
        <QueryState
          query={groups}
          empty={(d) => (!d.length ? <EmptyState icon={<Users />} title="Nenhuma família cadastrada" description="Cadastre convidados (cada um entra numa família) ou importe uma planilha." action={can("guests:create") ? <Button onClick={() => setGuestDialog(emptyForm())}><UserPlus /> Primeiro convidado</Button> : undefined} /> : null)}
        >
          {(d) => (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {d.map((g) => (
                <div key={g.id} className="rounded-xl border bg-card p-4 shadow-soft">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-heading text-lg font-semibold">{g.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {plural(g.guests.length, "pessoa", "pessoas")} · {g.confirmedPeople} confirmada(s){g.contactPhone ? ` · ${formatPhone(g.contactPhone)}` : ""}
                      </div>
                    </div>
                    {can("guests:edit") && <Button size="icon-sm" variant="ghost" aria-label="Editar família" onClick={() => setGroupDialog({ group: g })}><Pencil /></Button>}
                  </div>
                  <ul className="space-y-1">
                    {g.guests.map((m) => (
                      <li key={m.id}>
                        <button type="button" onClick={() => setDetail(m.id)} className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-sm hover:bg-muted/60">
                          <span className="min-w-0 flex-1 truncate">{m.fullName}{m.isChild ? " 👶" : ""}{m._count.companions ? ` +${m._count.companions}` : ""}</span>
                          <RsvpBadge s={m.rsvpStatus} />
                        </button>
                      </li>
                    ))}
                    {!g.guests.length && <li className="text-xs text-muted-foreground">Família sem convidados.</li>}
                  </ul>
                  <div className="mt-3 flex items-center justify-between gap-2 border-t pt-2 text-xs text-muted-foreground">
                    <span>{g.invitation ? (g.invitation.respondedAt ? `Respondeu ${dateTime(g.invitation.respondedAt)}` : g.invitation.openedAt ? "Link aberto" : g.invitation.sentAt ? "Link enviado" : "Link gerado") : "Sem link"}</span>
                    {can("guests:create") && <Button size="xs" variant="ghost" onClick={() => setGuestDialog(emptyForm(g.id))}><Plus /> Pessoa</Button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </QueryState>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-6">
            <div className="relative col-span-2">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8" placeholder="Nome, família ou telefone" value={filters.search} onChange={(e) => setF({ search: e.target.value })} />
            </div>
            <NativeSelect value={filters.rsvp} onChange={(v) => setF({ rsvp: v })} placeholder="Confirmação: todas" options={opt(RSVP_STATUS)} />
            <NativeSelect value={filters.inviteStatus} onChange={(v) => setF({ inviteStatus: v })} placeholder="Convite: todos" options={opt(INVITE_STATUS)} />
            <NativeSelect value={filters.side} onChange={(v) => setF({ side: v })} placeholder="Lado: todos" options={opt(SIDE)} />
            <NativeSelect value={filters.child} onChange={(v) => setF({ child: v })} placeholder="Adultos e crianças" options={[{ value: "0", label: "Só adultos" }, { value: "1", label: "Só crianças" }]} />
            <Input placeholder="Categoria (A, B…)" value={filters.category} onChange={(e) => setF({ category: e.target.value })} />
            {can("guests:delete") && <label className="flex items-center gap-2 text-sm"><Checkbox checked={filters.deleted} onCheckedChange={(v) => setF({ deleted: !!v })} /> Removidos</label>}
          </div>
          <QueryState query={list} empty={(d) => (!d.length ? <EmptyState icon={<Search />} title="Nenhum convidado encontrado" description="Ajuste os filtros ou cadastre convidados." /> : null)}>
            {(d) => <GuestTable guests={d} onOpen={setDetail} />}
          </QueryState>
        </>
      )}

      {guestDialog && <GuestDialog key={guestDialog.id ?? `new-${guestDialog.groupId}`} open onOpenChange={(o) => !o && setGuestDialog(null)} initial={guestDialog} groups={groupOptions} />}
      {groupDialog && <GroupDialog key={groupDialog.group?.id ?? "new"} open onOpenChange={(o) => !o && setGroupDialog(null)} group={groupDialog.group} />}
      {bulk && <BulkDialog open onOpenChange={(o) => !o && setBulk(null)} mode={bulk} />}
      <FinalListDialog open={finalOpen} onOpenChange={setFinalOpen} />
      <GuestSheet id={detail} onClose={() => setDetail(null)} onEdit={(g) => { setDetail(null); setGuestDialog(g); }} />
    </>
  );
}

function GuestTable({ guests, onOpen }: { guests: Guest[]; onOpen: (id: string) => void }) {
  return (
    <>
      <p className="mb-2 text-xs text-muted-foreground">{plural(guests.length, "convidado", "convidados")} · {guests.filter((g) => g.rsvpStatus === "ACCEPTED").reduce((a, g) => a + 1 + g.companions.filter((c) => c.attending).length, 0)} pessoa(s) confirmada(s) neste filtro</p>
      {/* Celular: cartões */}
      <ul className="space-y-2 md:hidden">
        {guests.map((g) => (
          <li key={g.id}>
            <button type="button" onClick={() => onOpen(g.id)} className="w-full rounded-xl border bg-card p-3 text-left">
              <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{g.fullName}</span><RsvpBadge s={g.rsvpStatus} /></div>
              <div className="mt-0.5 text-xs text-muted-foreground">{g.group.name}{g.phone ? ` · ${formatPhone(g.phone)}` : ""}{g.companions.length ? ` · +${g.companions.length}` : ""}</div>
            </button>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
            <tr><th className="p-3">Nome</th><th className="p-3">Família</th><th className="p-3">Telefone</th><th className="p-3">Lado</th><th className="p-3">Convite</th><th className="p-3">Confirmação</th><th className="p-3 text-right">Acomp.</th></tr>
          </thead>
          <tbody>
            {guests.map((g) => (
              <tr key={g.id} onClick={() => onOpen(g.id)} className="cursor-pointer border-t hover:bg-muted/40">
                <td className="p-3 font-medium">{g.fullName}{g.isChild && <Baby className="ml-1 inline size-3.5 text-muted-foreground" />}{g.dietary && <span className="block text-xs font-normal text-muted-foreground">{g.dietary}</span>}</td>
                <td className="p-3">{g.group.name}</td>
                <td className="p-3 tabular-nums">{formatPhone(g.phone)}</td>
                <td className="p-3">{g.side ? SIDE[g.side] ?? g.side : "—"}</td>
                <td className="p-3"><InviteBadge s={g.inviteStatus} /></td>
                <td className="p-3"><RsvpBadge s={g.rsvpStatus} /></td>
                <td className="p-3 text-right tabular-nums">{g.companions.filter((c) => c.attending).length}/{g.plusOnesAllowed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
