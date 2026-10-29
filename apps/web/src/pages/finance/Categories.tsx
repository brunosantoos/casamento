import { Archive, ArchiveRestore, ArrowDown, ArrowUp, FolderTree, Pencil, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog, EmptyState, Field, LoadingButton, MoneyInput, QueryState, StatusBadge, TextField } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { trpc, type RouterOutputs } from "@/trpc";
import { Avatar, CategoryBudgetEditor, FinanceShell, Money, NativeSelect, useCanFinance } from "./shared";

type Cat = RouterOutputs["finance"]["categories"][number];

function CategoryDialog({ open, onOpenChange, cat, roots }: { open: boolean; onOpenChange: (v: boolean) => void; cat: Partial<Cat> | null; roots: Cat[] }) {
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [budget, setBudget] = useState<number | null>(0);
  const utils = trpc.useUtils();
  useEffect(() => {
    if (!open) return;
    setName(cat?.name ?? "");
    setParentId(cat?.parentId ?? "");
    setBudget(cat?.budgetCents ?? 0);
  }, [open, cat]);
  const m = trpc.finance.saveCategory.useMutation({ onSuccess: async () => { toast.success("Categoria salva"); await utils.finance.invalidate(); onOpenChange(false); }, onError: (e) => toast.error(e.message) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{cat?.id ? "Editar categoria" : "Nova categoria"}</DialogTitle></DialogHeader>
        <TextField label="Nome" value={name} onChange={setName} />
        <Field label="Subcategoria de" hint="Deixe vazio para categoria principal (um nível de subcategoria)"><NativeSelect value={parentId} onChange={setParentId} placeholder="— principal —" options={roots.filter((r) => r.id !== cat?.id).map((r) => ({ value: r.id, label: r.name }))} /></Field>
        <Field label="Orçamento planejado"><MoneyInput value={budget} onChange={setBudget} /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <LoadingButton loading={m.isPending} disabled={!name.trim() || budget == null || budget < 0} onClick={() => m.mutate({ id: cat?.id, name: name.trim(), parentId: parentId || null, budgetCents: budget ?? 0 })}>Salvar</LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CategoriesPage() {
  const [showArchived, setShowArchived] = useState(false);
  const q = trpc.finance.categories.useQuery({ includeArchived: showArchived });
  const perm = useCanFinance();
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState<Partial<Cat> | null>(null);
  const [archive, setArchive] = useState<Cat | null>(null);
  const arch = trpc.finance.archiveCategory.useMutation({ onSuccess: async () => { toast.success("Categoria atualizada"); setArchive(null); await utils.finance.invalidate(); }, onError: (e) => toast.error(e.message) });
  const reorder = trpc.finance.reorderCategories.useMutation({ onSuccess: () => utils.finance.categories.invalidate(), onError: (e) => toast.error(e.message) });

  const all = q.data ?? [];
  const roots = all.filter((c) => !c.parentId);
  function move(list: Cat[], idx: number, dir: -1 | 1) {
    const ids = list.map((c) => c.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j]!, ids[idx]!];
    // Mantém as demais na ordem atual
    const rest = all.filter((c) => !ids.includes(c.id)).map((c) => c.id);
    reorder.mutate({ ids: [...ids, ...rest] });
  }
  const row = (c: Cat, list: Cat[], idx: number, child = false) => (
    <li key={c.id} className={cn("group flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-accent/40", child && "pl-12", c.archivedAt && "opacity-60")}>
      {!child ? <Avatar name={c.name} className="size-8" /> : <span className="text-muted-foreground">↳</span>}
      <span className={cn("min-w-0 flex-1 truncate", !child && "font-medium")}>{c.name} {c.archivedAt && <StatusBadge>arquivada</StatusBadge>}</span>
      {c.budgetCents ? <Money value={c.budgetCents} size="sm" /> : <span className="text-xs text-muted-foreground">sem orçamento</span>}
      {perm.edit && (
        <span className="flex opacity-100 transition md:opacity-0 md:group-hover:opacity-100">
          <Button size="icon-xs" variant="ghost" aria-label="Subir" disabled={idx === 0 || reorder.isPending} onClick={() => move(list, idx, -1)}><ArrowUp /></Button>
          <Button size="icon-xs" variant="ghost" aria-label="Descer" disabled={idx === list.length - 1 || reorder.isPending} onClick={() => move(list, idx, 1)}><ArrowDown /></Button>
          <Button size="icon-xs" variant="ghost" aria-label="Editar" onClick={() => setEditing(c)}><Pencil /></Button>
          <Button size="icon-xs" variant="ghost" aria-label={c.archivedAt ? "Restaurar" : "Arquivar"} onClick={() => (c.archivedAt ? arch.mutate({ id: c.id, archived: false }) : setArchive(c))}>{c.archivedAt ? <ArchiveRestore /> : <Archive />}</Button>
        </span>
      )}
    </li>
  );

  return (
    <FinanceShell title="Orçamento e categorias" description="Defina o orçamento total e distribua entre as categorias. Clique em um valor para editar. Subcategorias somam na categoria-mãe." actions={perm.edit && <Button onClick={() => setEditing({})}><Plus /> Nova categoria</Button>}>
      <section className="mb-8">
        <h2 className="mb-3 text-base font-semibold">Orçamento</h2>
        <CategoryBudgetEditor />
      </section>
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Organizar categorias</h2>
          <label className="flex items-center gap-2 text-sm text-muted-foreground"><Checkbox checked={showArchived} onCheckedChange={(v) => setShowArchived(!!v)} /> Mostrar arquivadas</label>
        </div>
        <QueryState query={q} empty={(d) => (d.length ? null : <EmptyState icon={<FolderTree />} title="Nenhuma categoria" action={perm.edit && <Button onClick={() => setEditing({})}>Criar categoria</Button>} />)}>
          {() => (
            <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-soft">
              {roots.map((r, i) => {
                const kids = all.filter((c) => c.parentId === r.id);
                return [row(r, roots, i), ...kids.map((k, j) => row(k, kids, j, true))];
              })}
            </ul>
          )}
        </QueryState>
      </section>
      <CategoryDialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)} cat={editing} roots={roots} />
      <ConfirmDialog open={!!archive} onOpenChange={(v) => !v && setArchive(null)} title={`Arquivar "${archive?.name}"?`} description="Lançamentos existentes continuam vinculados; a categoria só deixa de aparecer nas listas." confirmLabel="Arquivar" loading={arch.isPending} onConfirm={() => archive && arch.mutate({ id: archive.id, archived: true })} />
    </FinanceShell>
  );
}
