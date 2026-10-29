import { CheckCircle2, MapPin, Pencil, PartyPopper, Plus, Star, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog, EmptyState, Field, LoadingButton, PageHeader, QueryState, Section, StatusBadge, TextField } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useMe } from "@/hooks/use-me";
import { VENDOR_STATUS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { trpc, type RouterOutputs } from "@/trpc";
import { AreaChecklists, CostsSection } from "./Ceremony";
import { NativeSelect } from "./Checklist";

type Data = RouterOutputs["ceremony"]["venues"];
type Venue = Data["venues"][number];

const FIELDS: { key: keyof Venue; label: string; multiline?: boolean }[] = [
  { key: "address", label: "Endereço" },
  { key: "usageHours", label: "Horários de utilização" },
  { key: "responsible", label: "Responsável no local" },
  { key: "setupRules", label: "Regras de montagem e desmontagem", multiline: true },
  { key: "soundRestrictions", label: "Restrições de som", multiline: true },
  { key: "accessibility", label: "Acessibilidade", multiline: true },
  { key: "parking", label: "Estacionamento", multiline: true },
  { key: "includedServices", label: "Serviços incluídos", multiline: true },
  { key: "extraFees", label: "Taxas extras (descrição)", multiline: true },
  { key: "cancellationPolicy", label: "Política de cancelamento", multiline: true },
  { key: "contingencyPlan", label: "Plano de contingência (chuva, energia…)", multiline: true },
  { key: "notes", label: "Observações", multiline: true },
];
const COMPARE: (keyof Venue)[] = ["capacity", "usageHours", "includedServices", "extraFees", "parking", "accessibility", "soundRestrictions", "cancellationPolicy"];
const label = (k: keyof Venue) => (k === "capacity" ? "Capacidade" : (FIELDS.find((f) => f.key === k)?.label ?? String(k)));

export function VenuePage() {
  const { can } = useMe();
  const q = trpc.ceremony.venues.useQuery();
  const [edit, setEdit] = useState<Partial<Venue> | null>(null);
  return (
    <>
      <PageHeader
        title="Recepção e festa"
        description="Locais avaliados, o escolhido, regras, custos e tarefas da recepção."
        actions={can("venue:create") && <Button onClick={() => setEdit({ name: "" })}><Plus /> Novo local</Button>}
      />
      <QueryState query={q}>
        {(d) => (d.venues.length ? <VenueContent data={d} onEdit={setEdit} /> : (
          <EmptyState icon={<PartyPopper />} title="Nenhum local cadastrado" description="Cadastre os espaços que vocês estão avaliando para comparar e escolher." action={can("venue:create") ? <Button onClick={() => setEdit({ name: "" })}><Plus /> Cadastrar local</Button> : undefined} />
        ))}
      </QueryState>
      {edit && <VenueDialog venue={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function VenueContent({ data, onEdit }: { data: Data; onEdit: (v: Venue) => void }) {
  const { can } = useMe();
  const utils = trpc.useUtils();
  const [choose, setChoose] = useState<Venue | null>(null);
  const [del, setDel] = useState<Venue | null>(null);
  const inv = () => { utils.ceremony.venues.invalidate(); utils.wedding.invalidate(); };
  const chooseM = trpc.ceremony.chooseVenue.useMutation({ onSuccess: () => { toast.success("Local escolhido"); inv(); setChoose(null); }, onError: (e) => toast.error(e.message) });
  const delM = trpc.ceremony.deleteVenue.useMutation({ onSuccess: () => { toast.success("Local excluído"); inv(); setDel(null); }, onError: (e) => toast.error(e.message) });
  const linkedVendors = data.venues.filter((v) => v.vendor).map((v) => v.vendor!);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.venues.map((v) => (
          <div key={v.id} className={cn("flex flex-col rounded-xl border bg-card p-4 shadow-soft", v.chosen && "border-primary ring-2 ring-primary/25")}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-2xl font-semibold">{v.name}</h3>
                {v.chosen && <StatusBadge tone="wine" className="mt-1"><Star className="size-3" /> Local escolhido</StatusBadge>}
              </div>
              {can("venue:edit") && <Button size="icon-sm" variant="ghost" aria-label="Editar" onClick={() => onEdit(v)}><Pencil /></Button>}
              {can("venue:delete") && <Button size="icon-sm" variant="ghost" aria-label="Excluir" onClick={() => setDel(v)}><Trash2 /></Button>}
            </div>
            <dl className="mt-3 flex-1 space-y-1.5 text-sm">
              {v.capacity != null && <div className="flex items-center gap-2"><Users className="size-4 text-muted-foreground" /> Até {v.capacity} pessoas</div>}
              {v.address && <div className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><a className="hover:underline" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.address)}`}>{v.address}</a></div>}
              {v.vendor && <div className="flex items-center gap-2 text-xs">Fornecedor: <Link className="text-primary hover:underline" to={`/fornecedores/${v.vendor.id}`}>{v.vendor.name}</Link><StatusBadge tone={VENDOR_STATUS[v.vendor.status]?.tone}>{VENDOR_STATUS[v.vendor.status]?.label}</StatusBadge></div>}
              {FIELDS.filter((f) => f.key !== "address" && v[f.key]).slice(0, 4).map((f) => (
                <div key={String(f.key)}><dt className="text-xs text-muted-foreground">{f.label}</dt><dd className="line-clamp-2 whitespace-pre-wrap">{String(v[f.key])}</dd></div>
              ))}
            </dl>
            {!v.chosen && can("venue:edit") && <Button className="mt-3" variant="outline" onClick={() => setChoose(v)}><CheckCircle2 /> Escolher este</Button>}
          </div>
        ))}
      </div>

      {data.venues.length > 1 && (
        <Section title="Comparação">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="text-left"><th className="w-44 py-2 text-xs text-muted-foreground" />{data.venues.map((v) => <th key={v.id} className={cn("px-2 py-2 font-semibold", v.chosen && "text-primary")}>{v.name}</th>)}</tr></thead>
              <tbody className="divide-y">
                {COMPARE.map((k) => (
                  <tr key={String(k)} className="align-top">
                    <td className="py-2 text-xs text-muted-foreground">{label(k)}</td>
                    {data.venues.map((v) => <td key={v.id} className="px-2 py-2 whitespace-pre-wrap">{v[k] == null || v[k] === "" ? <span className="text-muted-foreground">—</span> : String(v[k])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {data.costs && <CostsSection title="Custos dos locais" costs={data.costs} vendors={linkedVendors} />}
      {data.tasks && <AreaChecklists tasks={data.tasks} areas={["RECEPTION"]} />}

      <ConfirmDialog open={!!choose} onOpenChange={(o) => !o && setChoose(null)} title={`Escolher "${choose?.name}"?`} description="Ele passa a ser o local da recepção. Se o casamento ainda não tem endereço de recepção, o endereço deste local é usado." confirmLabel="Escolher" loading={chooseM.isPending} onConfirm={() => choose && chooseM.mutate({ id: choose.id })} />
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title={`Excluir "${del?.name}"?`} description="Os lançamentos financeiros do fornecedor vinculado não são afetados." destructive confirmLabel="Excluir" loading={delM.isPending} onConfirm={() => del && delM.mutate({ id: del.id })} />
    </div>
  );
}

function VenueDialog({ venue, onClose }: { venue: Partial<Venue>; onClose: () => void }) {
  const { can } = useMe();
  const utils = trpc.useUtils();
  const vendors = trpc.vendors.list.useQuery(undefined, { enabled: can("vendors:view") });
  const [f, setF] = useState<Partial<Venue>>(venue);
  const [err, setErr] = useState<string | null>(null);
  const save = trpc.ceremony.saveVenue.useMutation({ onSuccess: () => { toast.success("Local salvo"); utils.ceremony.venues.invalidate(); onClose(); }, onError: (e) => toast.error(e.message) });
  function submit() {
    if (!f.name || f.name.trim().length < 2) return setErr("Informe o nome");
    setErr(null);
    const text = (k: keyof Venue) => ((f[k] as string | null | undefined) || null);
    save.mutate({
      id: venue.id, name: f.name.trim(), vendorId: f.vendorId || null, capacity: f.capacity ?? null,
      address: text("address"), usageHours: text("usageHours"), setupRules: text("setupRules"), soundRestrictions: text("soundRestrictions"), accessibility: text("accessibility"), parking: text("parking"),
      cancellationPolicy: text("cancellationPolicy"), contingencyPlan: text("contingencyPlan"), includedServices: text("includedServices"), extraFees: text("extraFees"), responsible: text("responsible"), notes: text("notes"),
    });
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{venue.id ? "Editar local" : "Novo local"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField className="sm:col-span-2" label="Nome do local" value={f.name ?? ""} onChange={(v) => setF({ ...f, name: v })} error={err} />
            <Field label="Capacidade (pessoas)"><Input type="number" min={0} value={f.capacity ?? ""} onChange={(e) => setF({ ...f, capacity: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
          </div>
          {can("vendors:view") && <Field label="Fornecedor vinculado" hint="Os custos do local vêm dos lançamentos financeiros deste fornecedor"><NativeSelect placeholder="Nenhum" value={f.vendorId ?? ""} onChange={(e) => setF({ ...f, vendorId: e.target.value || null })} options={(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name }))} /></Field>}
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map((fd) => (
              <TextField key={String(fd.key)} className={fd.multiline ? "sm:col-span-2" : undefined} label={fd.label} multiline={fd.multiline} value={(f[fd.key] as string | null | undefined) ?? ""} onChange={(v) => setF({ ...f, [fd.key]: v })} />
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <LoadingButton loading={save.isPending} onClick={submit}>Salvar</LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
