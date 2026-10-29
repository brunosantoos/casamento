import { AtSign, Columns3, Globe, Mail, MapPin, Plus, Search, Star, Store } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { EmptyState, Field, LoadingButton, PageHeader, QueryState, StatusBadge, TextField, PhoneField } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMe } from "@/hooks/use-me";
import { formatPhone, relative } from "@/lib/format";
import { opt, VENDOR_STATUS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { maskDocument } from "@/lib/masks";
import { DialogHero, MoreDetails } from "@/pages/finance/shared";
import { trpc, type RouterOutputs } from "@/trpc";

const NONE = "__none";

/** Select simples com opção "nenhum" (o Radix não aceita value vazio) */
export function SelectField({ label, value, onChange, options, placeholder = "Selecione", allowNone, noneLabel = "Nenhum", className }: {
  label?: ReactNode; value: string | null | undefined; onChange: (v: string | null) => void; options: { value: string; label: string }[]; placeholder?: string; allowNone?: boolean; noneLabel?: string; className?: string;
}) {
  const sel = (
    <Select value={value ?? (allowNone ? NONE : undefined)} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger className="w-full"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
  return label ? <Field label={label} className={className}>{sel}</Field> : <div className={className}>{sel}</div>;
}

export function Stars({ value, onChange }: { value: number | null | undefined; onChange?: (v: number | null) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" disabled={!onChange} onClick={() => onChange?.(value === n ? null : n)} aria-label={`${n} estrela(s)`} className="disabled:cursor-default">
          <Star className={cn("size-4", (value ?? 0) >= n ? "fill-gold text-gold" : "text-muted-foreground/40")} />
        </button>
      ))}
    </div>
  );
}

type VendorStatus = "RESEARCHED" | "CONTACTED" | "QUOTE_RECEIVED" | "NEGOTIATING" | "HIRED" | "COMPLETED" | "DISCARDED";
type VendorForm = {
  id?: string; name: string; legalName: string | null; contactName: string | null; categoryId: string | null; phone: string | null; whatsapp: string | null; email: string | null;
  address: string | null; document: string | null; website: string | null; instagram: string | null; notes: string | null; status: VendorStatus; rating: number | null;
};
export const emptyVendor = (): VendorForm => ({ name: "", legalName: null, contactName: null, categoryId: null, phone: null, whatsapp: null, email: null, address: null, document: null, website: null, instagram: null, notes: null, status: "RESEARCHED", rating: null });

type Dup = { id: string; name: string };
export function parseDuplicates(msg: string): Dup[] | null {
  if (!msg.startsWith("DUPLICATE:")) return null;
  try {
    return JSON.parse(msg.slice(10)) as Dup[];
  } catch {
    return [];
  }
}

const PIPELINE: VendorStatus[] = ["RESEARCHED", "CONTACTED", "QUOTE_RECEIVED", "NEGOTIATING", "HIRED", "COMPLETED"];

/** Etapa do relacionamento como linha do tempo clicável */
function StatusPipeline({ value, onChange }: { value: VendorStatus; onChange: (v: VendorStatus) => void }) {
  const idx = PIPELINE.indexOf(value);
  const discarded = value === "DISCARDED";
  return (
    <div>
      <div className="flex gap-1">
        {PIPELINE.map((st, i) => {
          const reached = !discarded && i <= idx;
          return (
            <button key={st} type="button" onClick={() => onChange(st)} title={VENDOR_STATUS[st]?.label} aria-pressed={st === value} className="group flex-1">
              <span className={cn("block h-1.5 rounded-full transition-colors", reached ? "bg-primary" : "bg-muted group-hover:bg-primary/30")} />
              <span className={cn("mt-1.5 block truncate text-[10.5px] font-medium transition-colors", st === value ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")}>{VENDOR_STATUS[st]?.label}</span>
            </button>
          );
        })}
      </div>
      <button type="button" onClick={() => onChange(discarded ? "RESEARCHED" : "DISCARDED")} className={cn("mt-2 text-xs font-medium transition", discarded ? "text-destructive" : "text-muted-foreground hover:text-destructive")}>
        {discarded ? "Descartado — reativar" : "Marcar como descartado"}
      </button>
    </div>
  );
}

function IconInput({ icon, prefix, ...props }: { icon: ReactNode; prefix?: string } & ComponentProps<typeof Input>) {
  return (
    <div className="group/ii relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within/ii:text-primary [&_svg]:size-4">{icon}</span>
      {prefix && <span className="pointer-events-none absolute top-1/2 left-9 -translate-y-1/2 text-sm text-muted-foreground">{prefix}</span>}
      <Input className={cn(prefix ? "pl-12" : "pl-9")} {...props} />
    </div>
  );
}

/** Formulário do fornecedor: essencial primeiro, detalhes recolhidos */
export function VendorFields({ form, set }: { form: VendorForm; set: (p: Partial<VendorForm>) => void }) {
  const { can } = useMe();
  const cats = trpc.finance.categories.useQuery(undefined, { enabled: can("finance:view") });
  const [samePhone, setSamePhone] = useState(!!form.whatsapp && form.whatsapp === form.phone);
  const extras = [form.legalName, form.document, form.address, form.notes].filter(Boolean).length;
  return (
    <div className="space-y-5">
      {/* Quem é */}
      <div className="space-y-3">
        <TextField label="Nome do fornecedor" value={form.name} onChange={(v) => set({ name: v })} placeholder="Ex.: Buffet Sabor & Arte" autoFocus />
        <div className="grid gap-3 sm:grid-cols-2">
          {can("finance:view") && <SelectField label="Categoria" allowNone noneLabel="Sem categoria" value={form.categoryId} onChange={(v) => set({ categoryId: v })} options={(cats.data ?? []).filter((c) => !c.parentId).map((c) => ({ value: c.id, label: c.name }))} />}
          <Field label="Avaliação"><div className="flex h-9 items-center"><Stars value={form.rating} onChange={(v) => set({ rating: v })} /></div></Field>
        </div>
        <Field label="Etapa"><StatusPipeline value={form.status} onChange={(v) => set({ status: v })} /></Field>
      </div>

      {/* Contato */}
      <div className="space-y-3 rounded-xl bg-muted/40 p-4">
        <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Contato</div>
        <TextField label="Pessoa de contato" value={form.contactName} onChange={(v) => set({ contactName: v })} placeholder="Com quem vocês falam" />
        <div className="grid gap-3 sm:grid-cols-2">
          <PhoneField label="WhatsApp" value={form.whatsapp} onChange={(v) => set({ whatsapp: v, ...(samePhone ? { phone: v } : {}) })} />
          {samePhone ? (
            <Field label="Telefone"><div className="flex h-9 items-center text-sm text-muted-foreground">Mesmo do WhatsApp</div></Field>
          ) : (
            <PhoneField label="Telefone" value={form.phone} onChange={(v) => set({ phone: v })} />
          )}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox checked={samePhone} onCheckedChange={(v) => { setSamePhone(!!v); if (v) set({ phone: form.whatsapp }); }} /> Telefone é o mesmo do WhatsApp
        </label>
        <Field label="E-mail"><IconInput icon={<Mail />} type="email" value={form.email ?? ""} onChange={(e) => set({ email: e.target.value })} placeholder="contato@fornecedor.com.br" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Instagram"><IconInput icon={<AtSign />} value={(form.instagram ?? "").replace(/^@/, "")} onChange={(e) => set({ instagram: e.target.value.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/$/, "") })} placeholder="perfil" /></Field>
          <Field label="Site"><IconInput icon={<Globe />} value={form.website ?? ""} onChange={(e) => set({ website: e.target.value })} placeholder="www.fornecedor.com.br" /></Field>
        </div>
      </div>

      <MoreDetails label="Dados da empresa, endereço e observações" defaultOpen={extras > 0} badge={extras ? <StatusBadge tone="emerald">{extras}</StatusBadge> : null}>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Razão social" value={form.legalName} onChange={(v) => set({ legalName: v })} />
          <Field label="CPF/CNPJ" hint="Somente se precisar para contrato ou nota"><Input inputMode="numeric" value={maskDocument(form.document)} onChange={(e) => set({ document: maskDocument(e.target.value) })} placeholder="00.000.000/0000-00" /></Field>
        </div>
        <Field label="Endereço"><IconInput icon={<MapPin />} value={form.address ?? ""} onChange={(e) => set({ address: e.target.value })} placeholder="Rua, número, bairro, cidade" /></Field>
        <TextField label="Observações" multiline value={form.notes} onChange={(v) => set({ notes: v })} placeholder="Impressões da visita, pontos de atenção…" />
      </MoreDetails>
    </div>
  );
}

export function useSaveVendor(onSaved: (v: { id: string }) => void) {
  const utils = trpc.useUtils();
  const [dups, setDups] = useState<Dup[] | null>(null);
  const save = trpc.vendors.save.useMutation();
  const merge = trpc.vendors.merge.useMutation();
  async function submit(form: VendorForm, ignoreDuplicates = false) {
    if (form.name.trim().length < 2) return toast.error("Informe o nome do fornecedor");
    try {
      const v = await save.mutateAsync({ ...form, email: form.email || null, ignoreDuplicates });
      setDups(null);
      toast.success("Fornecedor salvo");
      await utils.vendors.invalidate();
      onSaved(v);
    } catch (e) {
      const d = parseDuplicates((e as Error).message);
      if (d) setDups(d);
      else toast.error((e as Error).message);
    }
  }
  return { submit, dups, setDups, saving: save.isPending, merge, utils };
}

export function DuplicatesDialog({ dups, onClose, onForce, currentId, onMerged }: { dups: Dup[] | null; onClose: () => void; onForce: () => void; currentId?: string; onMerged?: (keepId: string) => void }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const merge = trpc.vendors.merge.useMutation({
    onSuccess: async (_d, v) => {
      toast.success("Cadastros mesclados");
      await utils.vendors.invalidate();
      onClose();
      onMerged?.(v.keepId);
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open={!!dups} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Possível fornecedor duplicado</DialogTitle>
          <DialogDescription>Encontramos cadastros com nome, telefone, e-mail ou documento parecidos.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {dups?.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-xl border p-3 text-sm">
              <span className="min-w-0 flex-1 font-medium">{d.name}</span>
              <Button size="sm" variant="outline" onClick={() => { onClose(); navigate(`/fornecedores/${d.id}`); }}>Abrir existente</Button>
              {currentId && <LoadingButton size="sm" variant="secondary" loading={merge.isPending} onClick={() => merge.mutate({ keepId: d.id, mergeId: currentId })}>Mesclar neste</LoadingButton>}
            </li>
          ))}
        </ul>
        {!currentId && <p className="text-xs text-muted-foreground">Para mesclar, salve primeiro e use "Mesclar" na página do fornecedor; ou abra o existente.</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Voltar</Button>
          <Button onClick={onForce}>Salvar mesmo assim</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewVendorDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const [form, setForm] = useState<VendorForm>(emptyVendor);
  const s = useSaveVendor((v) => { onOpenChange(false); setForm(emptyVendor()); navigate(`/fornecedores/${v.id}`); });
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
          <DialogHero icon={<Store />} title="Novo fornecedor" subtitle="O essencial agora; o resto você completa quando quiser." />
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <VendorFields form={form} set={(p) => setForm({ ...form, ...p })} />
          </div>
          <div className="flex items-center justify-end gap-2 border-t bg-muted/30 px-5 py-3">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <LoadingButton loading={s.saving} disabled={form.name.trim().length < 2} onClick={() => s.submit(form)}>Cadastrar fornecedor</LoadingButton>
          </div>
        </DialogContent>
      </Dialog>
      <DuplicatesDialog dups={s.dups} onClose={() => s.setDups(null)} onForce={() => s.submit(form, true)} />
    </>
  );
}

type VendorRow = RouterOutputs["vendors"]["list"][number];

export function VendorsPage() {
  const { can } = useMe();
  const [status, setStatus] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const utils = trpc.useUtils();
  const cats = trpc.finance.categories.useQuery(undefined, { enabled: can("finance:view") });
  const q = trpc.vendors.list.useQuery({ status: (status ?? undefined) as never, categoryId: categoryId ?? undefined, search: search || undefined, includeArchived: archived });
  const setSt = trpc.vendors.setStatus.useMutation({ onSuccess: () => { toast.success("Status atualizado"); utils.vendors.invalidate(); }, onError: (e) => toast.error(e.message) });
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <>
      <PageHeader
        title="Fornecedores"
        description="Pesquisa, orçamentos, contratos e histórico de cada fornecedor."
        actions={
          <>
            {selected.length >= 2 && <Button asChild variant="outline"><Link to={`/fornecedores/comparar?ids=${selected.slice(0, 6).join(",")}`}><Columns3 /> Comparar ({selected.length})</Link></Button>}
            {can("vendors:create") && <Button onClick={() => setCreating(true)}><Plus /> Novo fornecedor</Button>}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar por nome ou contato" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <SelectField className="w-48" allowNone noneLabel="Todos os status" value={status} onChange={setStatus} options={opt(VENDOR_STATUS)} placeholder="Status" />
        {can("finance:view") && <SelectField className="w-52" allowNone noneLabel="Todas as categorias" value={categoryId} onChange={setCategoryId} options={(cats.data ?? []).map((c) => ({ value: c.id, label: c.name }))} placeholder="Categoria" />}
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={archived} onCheckedChange={(v) => setArchived(!!v)} /> Arquivados</label>
      </div>
      <QueryState
        query={q}
        empty={(d) => (d.length ? null : <EmptyState icon={<Store />} title={search || status || categoryId ? "Nenhum fornecedor encontrado" : "Nenhum fornecedor cadastrado"} description="Cadastre fornecedores pesquisados, contatados e contratados." action={can("vendors:create") && <Button onClick={() => setCreating(true)}><Plus /> Novo fornecedor</Button>} />)}
      >
        {(list) => (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((v: VendorRow) => (
              <div key={v.id} className={cn("relative rounded-xl border bg-card p-4 shadow-soft transition hover:border-primary/40", selected.includes(v.id) && "border-primary ring-2 ring-primary/20", v.archivedAt && "opacity-60")}>
                <div className="flex items-start gap-3">
                  <Checkbox className="mt-1" checked={selected.includes(v.id)} onCheckedChange={() => toggle(v.id)} aria-label="Selecionar para comparar" />
                  <Link to={`/fornecedores/${v.id}`} className="min-w-0 flex-1">
                    <div className="truncate font-medium">{v.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{[v.category?.name, v.contactName].filter(Boolean).join(" · ") || "Sem categoria"}</div>
                  </Link>
                  {can("vendors:edit") ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><button><StatusBadge tone={VENDOR_STATUS[v.status]?.tone}>{VENDOR_STATUS[v.status]?.label}</StatusBadge></button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {opt(VENDOR_STATUS).map((o) => <DropdownMenuItem key={o.value} onClick={() => setSt.mutate({ id: v.id, status: o.value as never })}>{o.label}</DropdownMenuItem>)}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : <StatusBadge tone={VENDOR_STATUS[v.status]?.tone}>{VENDOR_STATUS[v.status]?.label}</StatusBadge>}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {(v.whatsapp || v.phone) && <span>{formatPhone(v.whatsapp ?? v.phone)}</span>}
                  <span>{v._count.quotes} orçamento(s)</span>
                  <span>{v._count.contracts} contrato(s)</span>
                  {v._count.tasks > 0 && <span className="text-amber-700 dark:text-amber-300">{v._count.tasks} tarefa(s) aberta(s)</span>}
                  {v._count.deliveries > 0 && <span>{v._count.deliveries} entrega(s) pendente(s)</span>}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <Stars value={v.rating} />
                  <span className="text-xs text-muted-foreground">{v.lastContactAt ? `Contato ${relative(v.lastContactAt)}` : ""}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </QueryState>
      <NewVendorDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
