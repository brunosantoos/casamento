import { FlaskConical, LineChart, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog, EmptyState, Field, LoadingButton, MoneyInput, QueryState, TextField } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { trpc, type RouterOutputs } from "@/trpc";
import { FinanceShell, Money, NativeSelect, SegmentBar, useCanFinance, useCategoryOptions } from "./shared";

type Scenario = RouterOutputs["finance"]["scenarios"][number];
type SItem = { key: string; description: string; categoryId: string; amountCents: number | null; date: string };
const itemsOf = (s: Scenario) => (s.items as { description: string; categoryId?: string | null; amountCents: number; date?: string }[]) ?? [];

function ScenarioDialog({ open, onOpenChange, scenario }: { open: boolean; onOpenChange: (v: boolean) => void; scenario: Scenario | null }) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [guestCount, setGuestCount] = useState("");
  const [items, setItems] = useState<SItem[]>([]);
  const categories = useCategoryOptions();
  const utils = trpc.useUtils();
  useEffect(() => {
    if (!open) return;
    setName(scenario?.name ?? "");
    setNotes(scenario?.notes ?? "");
    setGuestCount(scenario?.guestCount != null ? String(scenario.guestCount) : "");
    setItems(scenario ? itemsOf(scenario).map((i) => ({ key: crypto.randomUUID(), description: i.description, categoryId: i.categoryId ?? "", amountCents: i.amountCents, date: i.date ?? "" })) : [{ key: crypto.randomUUID(), description: "", categoryId: "", amountCents: null, date: "" }]);
  }, [open, scenario]);
  const m = trpc.finance.saveScenario.useMutation({ onSuccess: async () => { toast.success("Simulação salva"); await utils.finance.invalidate(); onOpenChange(false); }, onError: (e) => toast.error(e.message) });
  const upd = (k: string, p: Partial<SItem>) => setItems((l) => l.map((i) => (i.key === k ? { ...i, ...p } : i)));
  const valid = name.trim().length >= 2 && items.every((i) => i.description.trim() && i.amountCents != null && i.amountCents >= 0);
  const total = items.reduce((a, i) => a + (i.amountCents ?? 0), 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{scenario ? "Editar simulação" : "Nova simulação"}</DialogTitle>
          <DialogDescription>Gastos hipotéticos. Nunca entram nos totais reais — só no comparativo e no fluxo de caixa quando selecionados.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Nome" value={name} onChange={setName} placeholder="Ex.: Banda ao vivo em vez de DJ" />
          <Field label="Nº de convidados (opcional)"><Input type="number" min={0} value={guestCount} onChange={(e) => setGuestCount(e.target.value)} /></Field>
        </div>
        <div className="space-y-2">
          {items.map((i) => (
            <div key={i.key} className="grid gap-2 rounded-xl border p-2 sm:grid-cols-[1fr_150px_140px_140px_auto]">
              <Input placeholder="Descrição" value={i.description} onChange={(e) => upd(i.key, { description: e.target.value })} />
              <NativeSelect value={i.categoryId} onChange={(v) => upd(i.key, { categoryId: v })} placeholder="Categoria" options={categories} />
              <MoneyInput value={i.amountCents} onChange={(v) => upd(i.key, { amountCents: v })} />
              <Input type="date" value={i.date} onChange={(e) => upd(i.key, { date: e.target.value })} aria-label="Data prevista" />
              <Button size="icon-sm" variant="ghost" aria-label="Remover" disabled={items.length === 1} onClick={() => setItems(items.filter((x) => x.key !== i.key))}><Trash2 /></Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => setItems([...items, { key: crypto.randomUUID(), description: "", categoryId: "", amountCents: null, date: "" }])}><Plus /> Gasto simulado</Button>
        </div>
        <TextField label="Observações" value={notes} onChange={setNotes} multiline />
        <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-sm"><span className="text-muted-foreground">Total simulado</span><Money value={total} size="lg" /></div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <LoadingButton loading={m.isPending} disabled={!valid} onClick={() => m.mutate({ id: scenario?.id, name: name.trim(), notes: notes || null, guestCount: guestCount ? Number(guestCount) : null, items: items.map((i) => ({ description: i.description.trim(), categoryId: i.categoryId || null, amountCents: i.amountCents ?? 0, date: i.date || undefined })) })}>Salvar</LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ScenariosPage() {
  const q = trpc.finance.scenarios.useQuery();
  const summary = trpc.finance.summary.useQuery();
  const perm = useCanFinance();
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState<Scenario | null | "new">(null);
  const [del, setDel] = useState<Scenario | null>(null);
  const remove = trpc.finance.deleteScenario.useMutation({ onSuccess: async () => { toast.success("Simulação excluída"); setDel(null); await utils.finance.scenarios.invalidate(); }, onError: (e) => toast.error(e.message) });
  const s = summary.data;
  return (
    <FinanceShell title="Simulações" description="Teste novos gastos sem registrá-los como despesas reais. Compare com o contratado e com o orçamento." actions={perm.create && <Button onClick={() => setEditing("new")}><Plus /> Nova simulação</Button>}>
      <QueryState query={q} empty={(d) => (d.length ? null : <EmptyState icon={<FlaskConical />} title="Nenhuma simulação" description="Ex.: “E se trocarmos o DJ por uma banda?” ou “E se convidarmos mais 30 pessoas?”" action={perm.create && <Button onClick={() => setEditing("new")}><Plus /> Nova simulação</Button>} />)}>
        {(list) => (
          <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {list.map((sc) => {
              const total = itemsOf(sc).reduce((a, i) => a + i.amountCents, 0);
              const now = s?.contracted ?? 0;
              const after = now + total;
              const over = !!s?.budget && after > s.budget;
              const pctNow = s?.budget ? (now / s.budget) * 100 : 0;
              const pctSim = s?.budget ? (total / s.budget) * 100 : 0;
              return (
                <div key={sc.id} className="group flex flex-col rounded-xl border bg-card shadow-soft transition hover:shadow-brand">
                  <div className="flex items-start gap-3 p-4 pb-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-violet-500/12 text-violet-600 transition group-hover:scale-110 group-hover:-rotate-6 dark:text-violet-300"><FlaskConical className="size-4" /></span>
                    <div className="min-w-0 flex-1"><div className="truncate font-semibold">{sc.name}</div>{sc.notes && <p className="line-clamp-2 text-xs text-muted-foreground">{sc.notes}</p>}</div>
                    <div className="flex opacity-100 transition md:opacity-0 md:group-hover:opacity-100">
                      {perm.create && <Button size="icon-sm" variant="ghost" aria-label="Editar" onClick={() => setEditing(sc)}><Pencil /></Button>}
                      {perm.del && <Button size="icon-sm" variant="ghost" aria-label="Excluir" onClick={() => setDel(sc)}><Trash2 /></Button>}
                    </div>
                  </div>
                  <div className="px-4">
                    <div className="text-xs text-muted-foreground">Total simulado</div>
                    <Money value={total} size="xl" className="mt-1 block text-violet-600 dark:text-violet-400" signed />
                  </div>
                  <ul className="mt-3 space-y-1 px-4 text-sm">{itemsOf(sc).slice(0, 5).map((i, k) => <li key={k} className="flex justify-between gap-2"><span className="truncate text-muted-foreground">{i.description}</span><Money value={i.amountCents} size="sm" /></li>)}{itemsOf(sc).length > 5 && <li className="text-xs text-muted-foreground">+{itemsOf(sc).length - 5} item(ns)</li>}</ul>
                  <div className="mt-4 space-y-2 border-t px-4 pt-3">
                    {!!s?.budget && (
                      <SegmentBar total={Math.max(s.budget, after)} segments={[{ label: "Contratado", value: now, className: "bg-primary" }, { label: "Simulado", value: total, className: over ? "bg-destructive" : "bg-violet-500" }]} />
                    )}
                    <dl className="space-y-1 text-sm">
                      <div className="flex justify-between"><dt className="text-muted-foreground">Contratado atual</dt><dd><Money value={now} size="sm" /></dd></div>
                      <div className="flex justify-between"><dt className="text-muted-foreground">Com a simulação</dt><dd><Money value={after} size="sm" className={cn(over && "text-destructive")} /></dd></div>
                      {!!s?.budget && <div className="flex justify-between"><dt className="text-muted-foreground">Orçamento</dt><dd className="flex items-center gap-2"><span className={cn("text-[11px] tabular-nums", over ? "text-destructive" : "text-muted-foreground")}>{Math.round(pctNow + pctSim)}%</span><Money value={s.budget} size="sm" /></dd></div>}
                      {sc.guestCount ? <div className="flex justify-between"><dt className="text-muted-foreground">Por convidado ({sc.guestCount})</dt><dd><Money value={Math.round(after / sc.guestCount)} size="sm" /></dd></div> : null}
                    </dl>
                  </div>
                  <div className="mt-auto p-4 pt-3"><Button asChild size="sm" variant="outline" className="w-full"><Link to={`/financeiro/fluxo?cenario=${sc.id}`}><LineChart /> Ver no fluxo de caixa</Link></Button></div>
                </div>
              );
            })}
          </div>
        )}
      </QueryState>
      <ScenarioDialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)} scenario={editing === "new" ? null : editing} />
      <ConfirmDialog open={!!del} onOpenChange={(v) => !v && setDel(null)} title={`Excluir "${del?.name}"?`} destructive confirmLabel="Excluir" loading={remove.isPending} onConfirm={() => del && remove.mutate({ id: del.id })} />
    </FinanceShell>
  );
}
