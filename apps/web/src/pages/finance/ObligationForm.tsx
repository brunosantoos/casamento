import { ArrowLeft, Copy, FileText, Landmark, Layers, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { ErrorState, Field, LoadingButton, MoneyInput, PageLoader, TextField } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fromDateInput, money, toDateInput } from "@/lib/format";
import { CHARGE_TYPE, ITEM_KIND, ITEM_STATUS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc";
import { FinanceShell, itemTotalCents, KindBadge, Money, NativeSelect, opts, useCategoryOptions } from "./shared";

type Item = {
  key: string; id?: string; description: string; categoryId: string; kind: string; chargeType: string; unitCents: number | null; quantity: string;
  discountCents: number | null; surchargeCents: number | null; status: string; dueDate: string; notes: string;
};

const blank = (status = "PLANNED"): Item => ({ key: crypto.randomUUID(), description: "", categoryId: "", kind: "EXPENSE", chargeType: "ONE_TIME", unitCents: null, quantity: "1", discountCents: 0, surchargeCents: 0, status, dueDate: "", notes: "" });
const totalOf = (i: Item) => itemTotalCents({ unitCents: i.unitCents ?? 0, quantity: /^\d+(\.\d{1,3})?$/.test(i.quantity) ? i.quantity : "0", discountCents: i.discountCents ?? 0, surchargeCents: i.surchargeCents ?? 0 });

function itemErrors(i: Item) {
  const e: string[] = [];
  if (!i.description.trim()) e.push("descrição");
  if (i.unitCents == null || i.unitCents < 0) e.push("valor");
  if (!/^\d+(\.\d{1,3})?$/.test(i.quantity) || Number(i.quantity) <= 0) e.push("quantidade (use ponto: 2.5)");
  if ((i.discountCents ?? 0) < 0 || (i.surchargeCents ?? 0) < 0) e.push("desconto/acréscimo");
  if (i.unitCents != null && totalOf(i) < 0) e.push("desconto maior que o valor");
  return e;
}

export function ObligationFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const existing = trpc.finance.obligation.useQuery({ id: id! }, { enabled: !!id });
  const categories = useCategoryOptions();
  const vendors = trpc.vendors.list.useQuery();
  const [form, setForm] = useState({ title: "", categoryId: "", vendorId: params.get("vendor") ?? params.get("fornecedor") ?? "", contractId: "", notes: "", status: "DRAFT" });
  const [items, setItems] = useState<Item[]>([blank()]);
  const [review, setReview] = useState(false);
  const [touched, setTouched] = useState(false);
  const contracts = trpc.vendors.contracts.useQuery(undefined, { enabled: !!form.vendorId });

  useEffect(() => {
    const o = existing.data;
    if (!o) return;
    setForm({ title: o.title, categoryId: o.categoryId ?? "", vendorId: o.vendorId ?? "", contractId: o.contractId ?? "", notes: o.notes ?? "", status: o.status });
    setItems(o.items.map((i) => ({
      key: i.id, id: i.id, description: i.description, categoryId: i.categoryId ?? "", kind: i.kind, chargeType: i.chargeType, unitCents: i.unitCents, quantity: String(i.quantity),
      discountCents: i.discountCents, surchargeCents: i.surchargeCents, status: i.status, dueDate: toDateInput(i.dueDate), notes: i.notes ?? "",
    })));
  }, [existing.data]);

  const save = trpc.finance.saveObligation.useMutation({
    onSuccess: async (r) => {
      toast.success(id ? "Lançamento atualizado" : "Lançamento criado");
      await utils.finance.invalidate();
      navigate(`/financeiro/lancamentos/${r.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  if (id && existing.isLoading) return <PageLoader />;
  if (id && existing.error) return <ErrorState error={existing.error} onRetry={() => existing.refetch()} />;
  if (existing.data?.status === "CANCELLED") return <ErrorState error={{ message: "Lançamento cancelado não pode ser editado." }} />;

  const live = items.filter((i) => i.status !== "CANCELLED");
  const expense = live.filter((i) => i.kind !== "DEPOSIT").reduce((a, i) => a + totalOf(i), 0);
  const deposits = live.filter((i) => i.kind === "DEPOSIT").reduce((a, i) => a + totalOf(i), 0);
  const contracted = live.filter((i) => i.kind !== "DEPOSIT" && (i.status === "CONTRACTED" || form.status === "ACTIVE")).reduce((a, i) => a + totalOf(i), 0);
  const formErrors = [form.title.trim().length < 2 ? "Informe o título" : null, ...items.map((i, n) => (itemErrors(i).length ? `Item ${n + 1}: ${itemErrors(i).join(", ")}` : null))].filter(Boolean) as string[];
  const upd = (key: string, p: Partial<Item>) => setItems((l) => l.map((i) => (i.key === key ? { ...i, ...p } : i)));
  const vendorContracts = (contracts.data ?? []).filter((c) => c.vendor.id === form.vendorId);

  function submit() {
    save.mutate({
      id, title: form.title.trim(), categoryId: form.categoryId || null, vendorId: form.vendorId || null, contractId: form.contractId || null, notes: form.notes || null,
      status: id ? undefined : (form.status as "DRAFT" | "ACTIVE"),
      items: items.map((i) => ({
        id: i.id, description: i.description.trim(), categoryId: i.categoryId || null, kind: i.kind as never, chargeType: i.chargeType as never, unitCents: i.unitCents ?? 0, quantity: i.quantity,
        discountCents: i.discountCents ?? 0, surchargeCents: i.surchargeCents ?? 0, status: (form.status === "ACTIVE" && !id && i.status === "PLANNED" ? "CONTRACTED" : i.status) as never,
        dueDate: fromDateInput(i.dueDate), notes: i.notes || null,
      })),
    });
  }

  return (
    <FinanceShell
      back={<Button asChild variant="ghost" size="sm" className="mb-2 -ml-2"><Link to={id ? `/financeiro/lancamentos/${id}` : "/financeiro/lancamentos"}><ArrowLeft /> Voltar</Link></Button>}
      title={id ? "Editar lançamento" : "Novo lançamento"}
      description="Uma contratação pode ter várias cobranças independentes. Cauções reembolsáveis ficam separadas das despesas definitivas."
    >
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <section className="rounded-xl border bg-card p-5 shadow-soft">
            <div className="mb-4 flex items-start gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-white shadow-brand">1</span><div><h2 className="text-base font-semibold">Dados gerais</h2><p className="text-xs text-muted-foreground">Quem, o quê e em que categoria</p></div></div>
            <div className="grid gap-4 md:grid-cols-2">
              <TextField className="md:col-span-2" label="Título" value={form.title} onChange={(v) => setForm({ ...form, title: v })} placeholder="Ex.: Igreja Matriz — cerimônia" error={touched && form.title.trim().length < 2 ? "Obrigatório" : null} />
              <Field label="Categoria"><NativeSelect value={form.categoryId} onChange={(v) => setForm({ ...form, categoryId: v })} placeholder="—" options={categories} /></Field>
              <Field label="Fornecedor"><NativeSelect value={form.vendorId} onChange={(v) => setForm({ ...form, vendorId: v, contractId: "" })} placeholder="—" options={(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name }))} /></Field>
              <Field label="Contrato relacionado" hint={form.vendorId ? undefined : "Escolha o fornecedor primeiro"}><NativeSelect value={form.contractId} disabled={!form.vendorId} onChange={(v) => setForm({ ...form, contractId: v })} placeholder="—" options={vendorContracts.map((c) => ({ value: c.id, label: c.title }))} /></Field>
              {!id && (
                <Field label="Situação" hint="Rascunho = em cotação. Contratado = itens passam a contratados.">
                  <div className="flex rounded-lg border p-0.5">
                    {[["DRAFT", "Rascunho / previsto"], ["ACTIVE", "Contratado"]].map(([v, l]) => (
                      <button key={v} type="button" onClick={() => setForm({ ...form, status: v! })} className={cn("flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition", form.status === v ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{l}</button>
                    ))}
                  </div>
                </Field>
              )}
              <TextField className="md:col-span-2" label="Observações" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} multiline />
            </div>
          </section>

          <section className="rounded-xl border bg-card p-5 shadow-soft">
            <div className="mb-4 flex items-start gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-white shadow-brand">2</span><div><h2 className="text-base font-semibold">Itens e cobranças</h2><p className="text-xs text-muted-foreground">Valor × quantidade − desconto + acréscimo. Use o tipo Caução para valores reembolsáveis.</p></div></div>
            <div className="stagger space-y-3">
              {items.map((i, n) => {
                const errs = touched ? itemErrors(i) : [];
                return (
                  <div key={i.key} className={cn("group rounded-xl border bg-background/50 p-4 transition hover:border-primary/30", errs.length && "border-destructive/50", i.status === "CANCELLED" && "opacity-60")}>
                    <div className="mb-3 flex items-center gap-2">
                      <span className="grid size-6 place-items-center rounded-md bg-muted text-[11px] font-semibold text-muted-foreground">{n + 1}</span>
                      <KindBadge kind={i.kind} />
                      <Money value={totalOf(i)} size="lg" className="ml-auto" />
                      <Button size="icon-sm" variant="ghost" aria-label="Duplicar" onClick={() => setItems([...items.slice(0, n + 1), { ...i, key: crypto.randomUUID(), id: undefined }, ...items.slice(n + 1)])}><Copy /></Button>
                      <Button size="icon-sm" variant="ghost" aria-label="Remover" disabled={items.length === 1} onClick={() => setItems(items.filter((x) => x.key !== i.key))}><Trash2 /></Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <TextField className="sm:col-span-2" label="Descrição" value={i.description} onChange={(v) => upd(i.key, { description: v })} placeholder="Ex.: Taxa de celebração" />
                      <Field label="Tipo"><NativeSelect value={i.kind} onChange={(v) => upd(i.key, { kind: v })} options={opts(ITEM_KIND)} /></Field>
                      <Field label="Status"><NativeSelect value={i.status} onChange={(v) => upd(i.key, { status: v })} options={opts(ITEM_STATUS)} /></Field>
                      <Field label="Valor unitário"><MoneyInput value={i.unitCents} onChange={(v) => upd(i.key, { unitCents: v })} /></Field>
                      <Field label="Quantidade"><Input inputMode="decimal" value={i.quantity} onChange={(e) => upd(i.key, { quantity: e.target.value.replace(",", ".") })} /></Field>
                      <Field label="Desconto"><MoneyInput value={i.discountCents} onChange={(v) => upd(i.key, { discountCents: v })} /></Field>
                      <Field label="Acréscimo"><MoneyInput value={i.surchargeCents} onChange={(v) => upd(i.key, { surchargeCents: v })} /></Field>
                    </div>
                    <details className="mt-3 group/d">
                      <summary className="text-xs text-muted-foreground transition hover:text-foreground">Mais detalhes (cobrança, categoria, data, observações)</summary>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <Field label="Cobrança"><NativeSelect value={i.chargeType} onChange={(v) => upd(i.key, { chargeType: v })} options={opts(CHARGE_TYPE)} /></Field>
                        <Field label="Categoria do item"><NativeSelect value={i.categoryId} onChange={(v) => upd(i.key, { categoryId: v })} placeholder="(a do lançamento)" options={categories} /></Field>
                        <Field label="Data prevista"><Input type="date" value={i.dueDate} onChange={(e) => upd(i.key, { dueDate: e.target.value })} /></Field>
                        <TextField label="Observações" value={i.notes} onChange={(v) => upd(i.key, { notes: v })} />
                      </div>
                    </details>
                    {errs.length > 0 && <p className="mt-2 text-xs text-destructive">Corrija: {errs.join(", ")}</p>}
                  </div>
                );
              })}
              <button type="button" onClick={() => setItems([...items, blank(form.status === "ACTIVE" ? "CONTRACTED" : "PLANNED")])} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed py-4 text-sm font-medium text-muted-foreground transition hover:border-primary/50 hover:bg-accent/30 hover:text-foreground">
                <Plus className="size-4" /> Adicionar item
              </button>
            </div>
          </section>
        </div>

        <aside className="xl:sticky xl:top-20 xl:self-start">
          <section className="relative overflow-hidden rounded-xl border bg-card shadow-soft">
            <div className="bg-glow absolute inset-0 opacity-70" />
            <div className="relative p-5">
              <div className="mb-4 flex items-start gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-white shadow-brand">3</span><div><h2 className="text-base font-semibold">Resumo e revisão</h2><p className="text-xs text-muted-foreground">Atualiza enquanto você digita</p></div></div>
              <div className="text-xs text-muted-foreground">Desembolso total previsto</div>
              <Money value={expense + deposits} size="2xl" className="mt-1 block" />
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-muted-foreground"><FileText className="size-3.5" />Despesas</span><Money value={expense} size="sm" /></div>
                <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-muted-foreground"><Layers className="size-3.5" />Contratado</span><Money value={contracted} size="sm" /></div>
                <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-muted-foreground"><Landmark className="size-3.5" />Cauções (reembolsáveis)</span><Money value={deposits} size="sm" /></div>
              </div>
              {live.length > 0 && (
                <ul className="mt-4 space-y-1 border-t pt-3 text-xs">
                  {live.map((i, n) => <li key={i.key} className="flex justify-between gap-2"><span className="truncate text-muted-foreground">{n + 1}. {i.description || "sem descrição"}</span><Money value={totalOf(i)} size="sm" className="text-xs" /></li>)}
                </ul>
              )}
              <p className="mt-4 text-xs text-muted-foreground">Cauções não entram como despesa: desembolso, direito de devolução e devolução são registrados separadamente.</p>
              <Button className="mt-4 w-full" size="lg" onClick={() => { setTouched(true); if (formErrors.length) toast.error(formErrors[0]!); else setReview(true); }}>Revisar e salvar</Button>
            </div>
          </section>
        </aside>
      </div>

      <Dialog open={review} onOpenChange={setReview}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Confira antes de salvar</DialogTitle>
            <DialogDescription>{form.title} · {id ? "edição" : form.status === "ACTIVE" ? "será registrado como contratado" : "será registrado como rascunho (previsto)"}</DialogDescription>
          </DialogHeader>
          <Table>
            <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Cálculo</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
            <TableBody>
              {items.map((i) => (
                <TableRow key={i.key} className={cn(i.status === "CANCELLED" && "line-through opacity-60")}>
                  <TableCell>{i.description}</TableCell>
                  <TableCell><KindBadge kind={i.kind} /></TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground tabular-nums">{money(i.unitCents ?? 0)} × {i.quantity}{i.discountCents ? ` − ${money(i.discountCents)}` : ""}{i.surchargeCents ? ` + ${money(i.surchargeCents)}` : ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(totalOf(i))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div className="rounded-lg bg-muted p-2"><div className="text-xs text-muted-foreground">Despesas</div><Money value={expense} size="md" /></div>
            <div className="rounded-lg bg-muted p-2"><div className="text-xs text-muted-foreground">Cauções</div><Money value={deposits} size="md" /></div>
            <div className="rounded-lg bg-muted p-2"><div className="text-xs text-muted-foreground">Desembolso</div><Money value={expense + deposits} size="md" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReview(false)}>Voltar e ajustar</Button>
            <LoadingButton loading={save.isPending} onClick={submit}>Confirmar e salvar</LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FinanceShell>
  );
}
