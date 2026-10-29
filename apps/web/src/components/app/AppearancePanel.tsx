import { Check, Monitor, Moon, Palette, Sparkles, Sun } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DEFAULT_APPEARANCE, PRESETS, useTheme, type ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { IconTile } from "./common";

function Panel({ title, description, children, action }: { title: string; description?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-3xl border bg-card p-5 shadow-soft md:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const MODES: { value: ThemePreference; label: string; icon: ReactNode }[] = [
  { value: "light", label: "Claro", icon: <Sun /> },
  { value: "dark", label: "Escuro", icon: <Moon /> },
  { value: "system", label: "Sistema", icon: <Monitor /> },
];

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition [&_svg]:size-4",
            value === o.value ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Slider de matiz com o arco-íris como trilho */
function HueSlider({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="size-5 rounded-full ring-2 ring-card shadow-soft" style={{ background: `oklch(0.65 0.16 ${value})` }} />
      </div>
      <input
        type="range"
        min={0}
        max={360}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-3 w-full cursor-pointer appearance-none rounded-full [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-transparent [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-transparent"
        style={{
          background: `linear-gradient(to right, ${Array.from({ length: 13 }, (_, i) => `oklch(0.7 0.16 ${i * 30})`).join(", ")})`,
        }}
      />
    </div>
  );
}

export function AppearancePanel() {
  const { appearance: a, setAppearance: set, replaceAppearance } = useTheme();
  const isCustom = !PRESETS.some((p) => p.id === a.preset);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <Panel title="Modo">
          <div className="grid gap-3 sm:grid-cols-3">
            {MODES.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => set({ mode: o.value })}
                className={cn("overflow-hidden rounded-2xl border text-left transition", a.mode === o.value ? "border-primary ring-2 ring-primary/25" : "hover:border-primary/40")}
              >
                <div
                  className={cn(
                    "relative h-20 border-b",
                    o.value === "light" && "bg-zinc-50",
                    o.value === "dark" && "bg-zinc-900",
                    o.value === "system" && "bg-[linear-gradient(135deg,#fafafa_50%,#18181b_50%)]",
                  )}
                >
                  <div className="absolute top-3 left-3 h-2 w-14 rounded-full bg-brand" />
                  <div className="absolute top-7 left-3 h-2 w-20 rounded-full bg-zinc-400/40" />
                  <div className="absolute top-11 left-3 h-2 w-16 rounded-full bg-zinc-400/40" />
                </div>
                <div className="flex items-center justify-between p-3">
                  <span className="flex items-center gap-2 text-sm font-medium [&_svg]:size-4">{o.icon} {o.label}</span>
                  {a.mode === o.value && <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground"><Check className="size-3" /></span>}
                </div>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Temas prontos" description="Um clique e o app inteiro muda de cara.">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {PRESETS.map((p) => {
              const active = a.preset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => set({ preset: p.id, hue: p.hue, hue2: p.hue2, intensity: p.intensity ?? (a.intensity === "mono" ? "normal" : a.intensity) })}
                  className={cn("group flex flex-col items-center gap-2 rounded-2xl border p-3 transition", active ? "border-primary bg-accent/40 ring-2 ring-primary/25" : "hover:border-primary/40")}
                >
                  <span
                    className="relative grid size-11 place-items-center rounded-full shadow-soft transition group-hover:scale-105"
                    style={{
                      background:
                        p.intensity === "mono"
                          ? `linear-gradient(135deg, oklch(0.55 0.02 ${p.hue}), oklch(0.35 0.02 ${p.hue2}))`
                          : `linear-gradient(135deg, oklch(0.65 0.16 ${p.hue}), oklch(0.68 0.13 ${p.hue2}))`,
                    }}
                  >
                    {active && <Check className="size-4 text-white" />}
                  </span>
                  <span className="text-xs font-medium">{p.name}</span>
                </button>
              );
            })}
            <div className={cn("flex flex-col items-center gap-2 rounded-2xl border border-dashed p-3", isCustom && "border-primary bg-accent/40")}>
              <span className="grid size-11 place-items-center rounded-full bg-[conic-gradient(from_0deg,oklch(0.7_0.16_0),oklch(0.7_0.16_90),oklch(0.7_0.16_180),oklch(0.7_0.16_270),oklch(0.7_0.16_360))] shadow-soft">
                {isCustom && <Check className="size-4 text-white" />}
              </span>
              <span className="text-xs font-medium">Personalizado</span>
            </div>
          </div>
        </Panel>

        <Panel title="Cores" description="Arraste para escolher qualquer cor. O degradê aparece nos botões e destaques.">
          <div className="space-y-5">
            <HueSlider label="Cor principal" value={a.hue} onChange={(hue) => set({ hue, preset: null })} />
            <HueSlider label="Cor do degradê" value={a.hue2} onChange={(hue2) => set({ hue2, preset: null })} />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Combinações rápidas:</span>
              {[
                { label: "Análoga", d: 40 },
                { label: "Complementar", d: 180 },
                { label: "Tríade", d: 120 },
                { label: "Mesma cor", d: 0 },
              ].map((x) => (
                <button
                  key={x.label}
                  type="button"
                  onClick={() => set({ hue2: (a.hue + x.d) % 360, preset: null })}
                  className="rounded-full border px-2.5 py-1 text-xs transition hover:border-primary hover:text-primary"
                >
                  {x.label}
                </button>
              ))}
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Intensidade</Label>
                <div>
                  <Segmented
                    value={a.intensity}
                    onChange={(intensity) => set({ intensity, preset: intensity === "mono" ? a.preset : a.preset })}
                    options={[
                      { value: "soft", label: "Suave" },
                      { value: "normal", label: "Normal" },
                      { value: "vivid", label: "Vibrante" },
                      { value: "mono", label: "Mono" },
                    ]}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Fundo</Label>
                <div>
                  <Segmented
                    value={a.tint ? "tint" : "neutral"}
                    onChange={(v) => set({ tint: v === "tint" })}
                    options={[
                      { value: "neutral", label: "Neutro" },
                      { value: "tint", label: "Tingido" },
                    ]}
                  />
                </div>
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Forma e texto">
          <div className="space-y-5">
            <div className="space-y-2">
              <Label>Cantos</Label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { value: "sharp", label: "Retos", r: "6px" },
                  { value: "normal", label: "Médios", r: "12px" },
                  { value: "round", label: "Redondos", r: "20px" },
                ] as const).map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => set({ radius: o.value })}
                    className={cn("flex flex-col items-center gap-2 rounded-2xl border p-3 transition", a.radius === o.value ? "border-primary bg-accent/40 ring-2 ring-primary/25" : "hover:border-primary/40")}
                  >
                    <span className="h-9 w-14 border-2 border-primary bg-primary/10" style={{ borderRadius: o.r }} />
                    <span className="text-xs font-medium">{o.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Fonte dos títulos</Label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { value: "expressive", label: "Expressiva", family: '"Bricolage Grotesque Variable", sans-serif' },
                  { value: "modern", label: "Moderna", family: '"Geist Variable", sans-serif' },
                  { value: "classic", label: "Clássica", family: 'ui-serif, Georgia, serif' },
                ] as const).map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => set({ headingFont: o.value })}
                    className={cn("flex flex-col items-center gap-1 rounded-2xl border p-3 transition", a.headingFont === o.value ? "border-primary bg-accent/40 ring-2 ring-primary/25" : "hover:border-primary/40")}
                  >
                    <span className="text-3xl font-semibold" style={{ fontFamily: o.family }}>Aa</span>
                    <span className="text-xs font-medium">{o.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Tamanho do texto</Label>
              <div>
                <Segmented
                  value={a.fontSize}
                  onChange={(fontSize) => set({ fontSize })}
                  options={[
                    { value: "sm", label: <span className="text-xs">A</span> },
                    { value: "md", label: <span className="text-sm">A</span> },
                    { value: "lg", label: <span className="text-base">A</span> },
                  ]}
                />
              </div>
            </div>
          </div>
        </Panel>
      </div>

      {/* Prévia ao vivo (usa as mesmas variáveis do app) */}
      <aside className="xl:sticky xl:top-8 xl:self-start">
        <div className="overflow-hidden rounded-3xl border bg-card shadow-soft">
          <div className="border-b px-5 py-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Prévia</div>
          <div className="bg-glow space-y-4 bg-background p-5">
            <div className="rounded-2xl border bg-card p-4 shadow-soft">
              <div className="text-xs text-muted-foreground">Boa tarde,</div>
              <h3 className="text-2xl font-semibold">Faltam <span className="text-brand">199</span> dias</h3>
              <div className="mt-3 flex gap-2">
                <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-sm font-medium text-white shadow-brand"><Sparkles className="size-3.5" /> Novo lançamento</span>
                <span className="inline-flex h-8 items-center rounded-lg border bg-card px-3 text-sm">Convidados</span>
              </div>
            </div>
            <div className="divide-y overflow-hidden rounded-2xl border bg-card shadow-soft">
              {[
                { n: "Buffet Delícia", t: "Parcela vence em 3 dias", c: 12, on: true },
                { n: "Família Silva", t: "Confirmou presença", c: 3, on: false },
              ].map((r) => (
                <div key={r.n} className={cn("flex items-center gap-3 p-3", r.on && "bg-accent/60")}>
                  <span className={cn("grid size-4 place-items-center rounded-[4px] border", r.on && "border-primary bg-primary text-primary-foreground")}>
                    {r.on && <Check className="size-3" />}
                  </span>
                  <span className="grid size-9 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{r.n[0]}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{r.n}</div>
                    <div className="truncate text-xs text-muted-foreground">{r.t}</div>
                  </div>
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">{r.c}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">Confirmado</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Pausada</span>
              <Switch checked aria-label="Exemplo" />
            </div>
          </div>
          <div className="flex items-center justify-between border-t p-4">
            <span className="text-xs text-muted-foreground">Salvo neste navegador</span>
            <Button variant="ghost" size="sm" onClick={() => replaceAppearance({ ...DEFAULT_APPEARANCE, mode: a.mode })}>
              Restaurar padrão
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
}
