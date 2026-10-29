import { ArrowRight, CheckCircle2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Field, LoadingButton, Logo, MoneyInput, PageLoader, TextField, ThemeToggle } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useMe } from "@/hooks/use-me";
import { fromDateTimeInput } from "@/lib/format";
import { trpc } from "@/trpc";

export function OnboardingPage() {
  const { me, isLoading } = useMe();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [step, setStep] = useState<"form" | "checklist">("form");
  const [form, setForm] = useState({ partner1Name: "", partner2Name: "", date: "", city: "", budgetCents: null as number | null, estimatedGuests: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [phases, setPhases] = useState<number[]>([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const create = trpc.wedding.create.useMutation();
  const templates = trpc.planning.templates.useQuery(undefined, { enabled: step === "checklist" });
  const generate = trpc.planning.generateFromTemplate.useMutation();

  if (isLoading) return <PageLoader />;
  if (me?.active && !params.get("novo") && step === "form") return <Navigate to="/" replace />;
  if (me && !me.canCreateWedding && step === "form") {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <div className="max-w-sm">
          <Logo className="mb-6 justify-center" />
          <h1 className="text-3xl font-semibold">Aguardando convite</h1>
          <p className="mt-2 text-muted-foreground">Sua conta ainda não está vinculada a um casamento. Peça ao administrador um convite de acesso.</p>
        </div>
      </div>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (form.partner1Name.trim().length < 1) errs.partner1Name = "Obrigatório";
    if (form.partner2Name.trim().length < 1) errs.partner2Name = "Obrigatório";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      await create.mutateAsync({
        name: `Casamento de ${form.partner1Name.trim()} & ${form.partner2Name.trim()}`,
        partner1Name: form.partner1Name.trim(), partner2Name: form.partner2Name.trim(), date: fromDateTimeInput(form.date), city: form.city || null,
        budgetCents: form.budgetCents ?? 0, estimatedGuests: form.estimatedGuests ? Number(form.estimatedGuests) : null, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      await utils.wedding.me.invalidate();
      setStep("checklist");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function finish(gen: boolean) {
    if (gen && templates.data?.[0]) {
      const r = await generate.mutateAsync({ templateId: templates.data[0].id, phases });
      toast.success(`${r.created} tarefas criadas. Ajuste prazos e responsáveis no checklist.`);
    }
    await utils.invalidate();
    navigate("/");
  }

  const phaseNames = templates.data?.[0] ? [...new Map(templates.data[0].items.map((i) => [i.phase, i.phaseName])).entries()] : [];
  return (
    <div className="min-h-dvh bg-glow">
      <div className="mx-auto flex max-w-xl items-center justify-between px-6 py-5"><Logo /><ThemeToggle /></div>
      <div className="mx-auto max-w-xl px-6 pb-16">
        {step === "form" ? (
          <form onSubmit={onSubmit} className="space-y-5 rounded-xl border bg-card p-6 shadow-soft md:p-8">
            <div>
              <h1 className="text-4xl font-semibold">Vamos começar</h1>
              <p className="mt-1 text-muted-foreground">Os dados básicos do casamento. Tudo pode ser alterado depois.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Noivo(a) 1" value={form.partner1Name} onChange={(v) => setForm({ ...form, partner1Name: v })} error={errors.partner1Name} required />
              <TextField label="Noivo(a) 2" value={form.partner2Name} onChange={(v) => setForm({ ...form, partner2Name: v })} error={errors.partner2Name} required />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Data e horário" htmlFor="date" hint="Pode deixar em branco se ainda não definiram"><Input id="date" type="datetime-local" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
              <TextField label="Cidade" value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Orçamento total planejado"><MoneyInput value={form.budgetCents} onChange={(v) => setForm({ ...form, budgetCents: v })} /></Field>
              <Field label="Convidados estimados"><Input type="number" min={0} value={form.estimatedGuests} onChange={(e) => setForm({ ...form, estimatedGuests: e.target.value })} /></Field>
            </div>
            <LoadingButton type="submit" className="h-11 w-full" loading={create.isPending}>Criar casamento <ArrowRight /></LoadingButton>
            <p className="text-center text-xs text-muted-foreground">Serão criadas as categorias financeiras, álbuns e modelos de mensagem padrão — todos editáveis.</p>
          </form>
        ) : (
          <div className="space-y-5 rounded-xl border bg-card p-6 shadow-soft md:p-8">
            <div className="flex items-center gap-2 text-emerald-600"><CheckCircle2 className="size-5" /> Casamento criado</div>
            <div>
              <h1 className="text-3xl font-semibold">Gerar o checklist?</h1>
              <p className="mt-1 text-sm text-muted-foreground">Criamos as tarefas a partir do modelo de 9 fases. Os prazos são sugestões calculadas pela data do casamento e podem ser alterados — sem data, as tarefas ficam sem prazo.</p>
            </div>
            {templates.isLoading ? <PageLoader /> : (
              <div className="grid gap-2 sm:grid-cols-2">
                {phaseNames.map(([n, name]) => (
                  <label key={n} className="flex items-center gap-2 rounded-xl border p-3 text-sm">
                    <Checkbox checked={phases.includes(n)} onCheckedChange={(v) => setPhases(v ? [...phases, n] : phases.filter((p) => p !== n))} />
                    Fase {n} — {name}
                  </label>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <LoadingButton loading={generate.isPending} onClick={() => finish(true)} disabled={!phases.length}>Gerar tarefas e continuar</LoadingButton>
              <Button variant="ghost" onClick={() => finish(false)}>Pular por enquanto</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
