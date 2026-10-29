import { AlertTriangle, Check, Loader2, Monitor, Moon, Palette, Phone, RefreshCw, Sun } from "lucide-react";
import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { centsFromTyping, formatCentsMask, maskPhone, phoneState, phoneValue } from "@/lib/masks";
import { useTheme, type ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className="relative grid size-9 place-items-center rounded-xl bg-brand text-white shadow-brand">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden>
          <circle cx="9.5" cy="13.5" r="5" stroke="currentColor" strokeOpacity=".75" strokeWidth="2" />
          <circle cx="14.5" cy="13.5" r="5" stroke="currentColor" strokeWidth="2" />
          <path d="M12 3.2l1.3 1.7L12 6.6l-1.3-1.7z" fill="currentColor" />
        </svg>
      </span>
      {withText && (
        <span className="font-heading text-[17px] leading-none font-semibold tracking-tight">
          Nosso <span className="text-brand">Casamento</span>
        </span>
      )}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 md:mb-8 animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-xs font-medium tracking-wide text-primary uppercase">{eyebrow}</div>}
        <h1 className="text-[28px] leading-tight font-semibold md:text-3xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-[15px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("relative flex flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed px-6 py-14 text-center", className)}>
      <div className="bg-dots absolute inset-0 [mask-image:radial-gradient(circle_at_center,black,transparent_70%)]" />
      <div className="relative mb-4 grid size-14 place-items-center rounded-xl bg-accent text-accent-foreground ring-8 ring-accent/40 [&_svg]:size-6">{icon}</div>
      <p className="relative font-heading text-lg font-semibold">{title}</p>
      {description && <p className="relative mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="relative mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: { message: string } | null | undefined; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
      <AlertTriangle className="size-6 text-destructive" />
      <p className="text-sm">{error?.message ?? "Não foi possível carregar"}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw /> Tentar de novo
        </Button>
      )}
    </div>
  );
}

/** Carregando / erro / conteúdo — use em toda tela com consulta */
export function QueryState<T>({ query, children, empty }: { query: { isLoading: boolean; error: { message: string } | null; data: T | undefined; refetch: () => unknown }; children: (data: T) => ReactNode; empty?: (data: T) => ReactNode | null }) {
  if (query.isLoading) return <PageLoader />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (query.data === undefined) return null;
  const e = empty?.(query.data);
  if (e) return <>{e}</>;
  return <>{children(query.data)}</>;
}

export function LoadingButton({ loading, children, disabled, ...props }: ComponentProps<typeof Button> & { loading?: boolean }) {
  return (
    <Button disabled={disabled || loading} {...props}>
      {loading && <Loader2 className="animate-spin" />}
      {children}
    </Button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-5 animate-spin text-muted-foreground", className)} />;
}

export function PageLoader() {
  return (
    <div className="grid place-items-center py-24">
      <Spinner />
    </div>
  );
}

export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return <p className="text-xs font-medium text-destructive">{message}</p>;
}

/** Campo com rótulo, dica e erro */
export function Field({ label, htmlFor, hint, error, children, className }: { label: ReactNode; htmlFor?: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      <FieldError message={error} />
    </div>
  );
}

export function TextField({ label, value, onChange, error, hint, multiline, className, ...props }: { label: ReactNode; value: string | null | undefined; onChange: (v: string) => void; error?: string | null; hint?: ReactNode; multiline?: boolean; className?: string } & Omit<ComponentProps<"input">, "value" | "onChange">) {
  const id = props.id ?? props.name ?? (typeof label === "string" ? label : undefined);
  return (
    <Field label={label} htmlFor={id} error={error} hint={hint} className={className}>
      {multiline ? (
        <Textarea id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={props.placeholder} rows={3} aria-invalid={!!error} />
      ) : (
        <Input id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} {...props} />
      )}
    </Field>
  );
}

/**
 * Entrada monetária com máscara de caixa registradora: digitar "123456" mostra "1.234,56".
 * Devolve centavos inteiros (null quando vazio). Colar "1.234,50" ou "R$ 99" também funciona.
 */
export function MoneyInput({ value, onChange, className, invalid, ...props }: { value: number | null | undefined; onChange: (cents: number | null) => void; invalid?: boolean } & Omit<ComponentProps<"input">, "value" | "onChange">) {
  const ref = useRef<HTMLInputElement>(null);
  const pasted = useRef(false);
  const shown = value == null ? "" : formatCentsMask(value);
  // Cursor sempre no fim (a máscara cresce da direita)
  const toEnd = () => requestAnimationFrame(() => ref.current?.setSelectionRange(ref.current.value.length, ref.current.value.length));
  return (
    <div className={cn("group/money relative", className)}>
      <span className={cn("pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm font-medium transition-colors", value ? "text-foreground/70" : "text-muted-foreground", "group-focus-within/money:text-primary")}>R$</span>
      <Input
        ref={ref}
        inputMode="numeric"
        autoComplete="off"
        placeholder="0,00"
        aria-invalid={invalid || undefined}
        className="pl-9 text-right font-medium tracking-tight tabular-nums"
        value={shown}
        onFocus={toEnd}
        onClick={toEnd}
        onPaste={() => {
          pasted.current = true;
        }}
        onKeyDown={(e) => {
          // Backspace remove o último dígito mesmo com o cursor em outro lugar
          if (e.key === "Backspace" && value != null && ref.current?.selectionStart === ref.current?.selectionEnd) {
            e.preventDefault();
            const next = Math.trunc(Math.abs(value) / 10);
            onChange(next ? next : null);
          }
        }}
        onChange={(e) => {
          const next = centsFromTyping(e.target.value, value ?? null, { pasted: pasted.current });
          pasted.current = false;
          onChange(next);
          toEnd();
        }}
        {...props}
      />
    </div>
  );
}

/** Telefone com máscara (fixo/celular BR; internacional começando com +). Devolve só os dígitos. */
export function PhoneInput({ value, onChange, className, ...props }: { value: string | null | undefined; onChange: (v: string) => void } & Omit<ComponentProps<"input">, "value" | "onChange">) {
  const state = phoneState(value);
  return (
    <div className={cn("group/phone relative", className)}>
      <Phone className={cn("pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 transition-colors", state === "valid" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground", "group-focus-within/phone:text-primary")} />
      <Input
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="(11) 98765-4321"
        aria-invalid={state === "invalid" || undefined}
        className="pr-8 pl-9 tabular-nums"
        value={maskPhone(value)}
        onChange={(e) => onChange(phoneValue(maskPhone(e.target.value)))}
        {...props}
      />
      {state === "valid" && <Check className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-emerald-600 animate-in zoom-in-50 dark:text-emerald-400" />}
    </div>
  );
}

/** Campo de telefone completo (rótulo, dica e erro) */
export function PhoneField({ label, value, onChange, error, hint, className, ...props }: { label: ReactNode; value: string | null | undefined; onChange: (v: string) => void; error?: string | null; hint?: ReactNode; className?: string } & Omit<ComponentProps<"input">, "value" | "onChange">) {
  const id = props.id ?? (typeof label === "string" ? label : undefined);
  const state = phoneState(value);
  const msg = error ?? (state === "invalid" ? "Número inválido — confira o DDD e o 9 do celular" : null);
  return (
    <Field label={label} htmlFor={id} hint={hint ?? (state === "partial" ? "Inclua o DDD" : undefined)} error={msg} className={className}>
      <PhoneInput id={id} value={value} onChange={onChange} {...props} />
    </Field>
  );
}

const TONES = {
  wine: "bg-primary/12 text-primary",
  gold: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  emerald: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300",
  teal: "bg-cyan-500/12 text-cyan-600 dark:text-cyan-300",
  violet: "bg-violet-500/12 text-violet-600 dark:text-violet-300",
  amber: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  rose: "bg-rose-500/12 text-rose-600 dark:text-rose-300",
  sky: "bg-sky-500/12 text-sky-600 dark:text-sky-300",
  neutral: "bg-muted text-muted-foreground",
} as const
export type Tone = keyof typeof TONES;

export function IconTile({ icon, tone = "wine", className }: { icon: ReactNode; tone?: Tone; className?: string }) {
  return <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl [&_svg]:size-5", TONES[tone], className)}>{icon}</span>;
}

export function StatCard({ icon, label, value, hint, tone, href, onClick }: { icon: ReactNode; label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; href?: string; onClick?: () => void }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        <IconTile icon={icon} tone={tone} className="size-8 rounded-lg transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6 [&_svg]:size-4" />
      </div>
      <div className="mt-2 font-sans text-[26px] leading-none font-semibold tracking-tight tabular-nums tracking-tight">{value}</div>
      {hint && <div className="mt-1.5 text-xs text-muted-foreground">{hint}</div>}
    </>
  );
  const cls = "group relative block overflow-hidden rounded-xl border bg-card p-4 text-left shadow-soft";
  if (href) return <Link to={href} className={cn(cls, "lift")}>{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={cn(cls, "lift")}>{body}</button>;
  return <div className={cls}>{body}</div>;
}

export function Section({ title, description, actions, children, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border bg-card p-4 shadow-soft animate-in fade-in duration-300 md:p-5", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Confirmação para ações destrutivas / irreversíveis */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = "Confirmar", destructive, loading, onConfirm, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: ReactNode; confirmLabel?: string; destructive?: boolean; loading?: boolean; onConfirm: () => void; children?: ReactNode;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={loading}
            variant={destructive ? "destructive" : "default"}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {loading && <Loader2 className="animate-spin" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const THEME_ICON = { light: Sun, dark: Moon, system: Monitor } as const;
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, resolved, setPreference } = useTheme();
  const Icon = resolved === "dark" ? Moon : Sun;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={className} aria-label="Tema">
          <Icon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuRadioGroup value={preference} onValueChange={(v) => setPreference(v as ThemePreference)}>
          {(["light", "dark", "system"] as const).map((t) => {
            const I = THEME_ICON[t];
            return (
              <DropdownMenuRadioItem key={t} value={t}>
                <I /> {{ light: "Claro", dark: "Escuro", system: "Sistema" }[t]}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link to="/configuracoes?aba=aparencia"><Palette /> Personalizar tema</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Selo de status com tom */
export function StatusBadge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONES[tone], className)}>{children}</span>;
}

/** Tradução de erros do tRPC para mensagem amigável (DUPLICATE:… é tratado pela tela) */
export function errorMessage(e: unknown) {
  const msg = (e as { message?: string })?.message ?? "Algo deu errado";
  return msg.startsWith("DUPLICATE:") ? "Possível duplicidade encontrada" : msg;
}
