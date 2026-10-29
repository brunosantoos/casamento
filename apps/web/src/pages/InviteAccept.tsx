import { AlertCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { LoadingButton, PageLoader } from "@/components/app/common";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, signUp, useSession } from "@/lib/auth-client";
import { trpc } from "@/trpc";
import { AuthShell, authError, PasswordInput } from "./Auth";

export function InviteAcceptPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const session = useSession();
  const info = trpc.members.invitationInfo.useQuery({ token }, { retry: false });
  const accept = trpc.members.acceptInvitation.useMutation();
  const utils = trpc.useUtils();
  const [form, setForm] = useState({ name: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (info.isLoading || session.isPending) return <PageLoader />;
  if (info.error) return <AuthShell title="Convite indisponível"><Alert variant="destructive"><AlertCircle /><AlertDescription>{info.error.message}</AlertDescription></Alert></AuthShell>;
  const inv = info.data!;

  async function finish() {
    await accept.mutateAsync({ token });
    await utils.invalidate();
    navigate("/");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (!session.data) {
        const r = inv.hasAccount
          ? await signIn.email({ email: inv.email, password: form.password })
          : await signUp.email({ email: inv.email, password: form.password, name: form.name || inv.name || inv.email }, { headers: { "x-invite-token": token } });
        if (r.error) throw new Error(authError(r.error));
      }
      await finish();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const loggedAsOther = session.data && session.data.user.email.toLowerCase() !== inv.email.toLowerCase();
  return (
    <AuthShell title="Você foi convidado(a)" subtitle={<>Para o planejamento de <b>{inv.wedding}</b> como <b>{inv.role}</b>.</>}>
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert variant="destructive"><AlertCircle /><AlertDescription>{error}</AlertDescription></Alert>}
        {loggedAsOther ? (
          <Alert><AlertDescription>Você está conectado como {session.data!.user.email}. Este convite é para {inv.email}. Saia e entre com o e-mail convidado.</AlertDescription></Alert>
        ) : session.data ? (
          <p className="text-sm">Conectado como <b>{inv.email}</b>.</p>
        ) : (
          <>
            <div className="space-y-2"><Label>E-mail</Label><Input className="h-11" value={inv.email} disabled /></div>
            {!inv.hasAccount && <div className="space-y-2"><Label htmlFor="name">Seu nome</Label><Input id="name" className="h-11" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>}
            <div className="space-y-2"><Label htmlFor="pw">{inv.hasAccount ? "Sua senha" : "Crie uma senha (mín. 10 caracteres)"}</Label><PasswordInput id="pw" value={form.password} onChange={(v) => setForm({ ...form, password: v })} autoComplete={inv.hasAccount ? "current-password" : "new-password"} /></div>
          </>
        )}
        <LoadingButton type="submit" className="h-11 w-full" loading={loading} disabled={!!loggedAsOther}>Aceitar convite</LoadingButton>
      </form>
    </AuthShell>
  );
}
