import { AlertCircle, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { LoadingButton, Logo, ThemeToggle } from "@/components/app/common";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient, signIn, signUp } from "@/lib/auth-client";
import { trpc } from "@/trpc";

const ERRORS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "E-mail ou senha incorretos.",
  USER_ALREADY_EXISTS: "Já existe uma conta com esse e-mail.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Já existe uma conta com esse e-mail.",
  PASSWORD_TOO_SHORT: "A senha precisa ter pelo menos 10 caracteres.",
  INVALID_TOKEN: "Link inválido ou expirado. Peça um novo.",
};
export const authError = (e: { code?: string; message?: string; status?: number }) =>
  e.status === 429 ? "Muitas tentativas. Aguarde alguns minutos." : (ERRORS[e.code ?? ""] ?? e.message ?? "Algo deu errado");

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="bg-glow absolute inset-0 opacity-60" />
        <Logo className="relative [&_span:last-child]:text-primary-foreground [&_.text-brand]:text-gold" />
        <div className="relative max-w-md">
          <p className="font-heading text-5xl leading-tight font-semibold">Cada detalhe do grande dia, em um só lugar.</p>
          <p className="mt-4 text-primary-foreground/80">Financeiro, convidados, fornecedores, contratos e checklist — com a equipe certa vendo só o que precisa.</p>
        </div>
        <p className="relative text-xs text-primary-foreground/60">Seus dados ficam protegidos e cada ação importante é registrada.</p>
      </div>
      <div className="relative flex flex-col px-6 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Logo className="lg:invisible" />
          <ThemeToggle />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="text-4xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-2 text-muted-foreground">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function PasswordInput({ id, value, onChange, autoComplete }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input id={id} type={show ? "text" : "password"} className="h-11 pr-10" required minLength={10} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} />
      <button type="button" onClick={() => setShow(!show)} className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground" aria-label={show ? "Ocultar senha" : "Mostrar senha"}>
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

function ErrorAlert({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <Alert variant="destructive" className="animate-in fade-in">
      <AlertCircle />
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const utils = trpc.useUtils();
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await signIn.email({ email: form.email, password: form.password });
    setLoading(false);
    if (error) return setError(authError(error));
    await utils.invalidate();
    navigate((location.state as { from?: string } | null)?.from ?? "/");
  }
  return (
    <AuthShell title="Bem-vindos de volta" subtitle="Entre para continuar o planejamento.">
      <form onSubmit={onSubmit} className="space-y-4">
        <ErrorAlert error={error} />
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" type="email" className="h-11" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Senha</Label>
            <Link to="/esqueci-senha" className="text-xs text-primary hover:underline">Esqueci minha senha</Link>
          </div>
          <PasswordInput id="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} autoComplete="current-password" />
        </div>
        <LoadingButton type="submit" className="h-11 w-full" loading={loading}>Entrar</LoadingButton>
        <p className="text-center text-xs text-muted-foreground">
          Novo por aqui? O acesso é feito por convite do administrador. <Link to="/instalacao" className="text-primary hover:underline">Primeira instalação</Link>
        </p>
      </form>
    </AuthShell>
  );
}

/** Primeiro acesso da instalação: o servidor só aceita se ainda não houver nenhum usuário */
export function SetupPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await signUp.email(form);
    setLoading(false);
    if (error) return setError(authError(error));
    navigate("/comecar");
  }
  return (
    <AuthShell title="Primeira instalação" subtitle="Crie a conta do administrador. Depois disso, novos acessos só por convite.">
      <form onSubmit={onSubmit} className="space-y-4">
        <ErrorAlert error={error} />
        <div className="space-y-2"><Label htmlFor="name">Nome</Label><Input id="name" className="h-11" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" /></div>
        <div className="space-y-2"><Label htmlFor="email">E-mail</Label><Input id="email" type="email" className="h-11" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" /></div>
        <div className="space-y-2"><Label htmlFor="password">Senha (mín. 10 caracteres)</Label><PasswordInput id="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} autoComplete="new-password" /></div>
        <LoadingButton type="submit" className="h-11 w-full" loading={loading}>Criar conta de administrador</LoadingButton>
        <p className="text-center text-xs text-muted-foreground"><Link to="/login" className="text-primary hover:underline">Já tenho conta</Link></p>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/redefinir-senha` });
    setLoading(false);
    // Mesma resposta exista ou não a conta (não revela e-mails cadastrados)
    if (error && error.status === 429) return setError(authError(error));
    setSent(true);
  }
  return (
    <AuthShell title="Recuperar senha" subtitle="Enviaremos um link para criar uma nova senha.">
      {sent ? (
        <Alert><CheckCircle2 /><AlertDescription>Se houver uma conta com esse e-mail, o link chega em instantes. Ele vale por 1 hora.</AlertDescription></Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <ErrorAlert error={error} />
          <div className="space-y-2"><Label htmlFor="email">E-mail</Label><Input id="email" type="email" className="h-11" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <LoadingButton type="submit" className="h-11 w-full" loading={loading}>Enviar link</LoadingButton>
        </form>
      )}
      <p className="mt-6 text-center text-sm"><Link to="/login" className="text-primary hover:underline">Voltar ao login</Link></p>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error") ? ERRORS.INVALID_TOKEN! : null);
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    setLoading(false);
    if (error) return setError(authError(error));
    navigate("/login");
  }
  return (
    <AuthShell title="Nova senha" subtitle="Escolha uma senha com pelo menos 10 caracteres. Por segurança, outras sessões serão encerradas.">
      <form onSubmit={onSubmit} className="space-y-4">
        <ErrorAlert error={error} />
        <div className="space-y-2"><Label htmlFor="password">Nova senha</Label><PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" /></div>
        <LoadingButton type="submit" className="h-11 w-full" loading={loading} disabled={!token}>Salvar nova senha</LoadingButton>
      </form>
    </AuthShell>
  );
}
