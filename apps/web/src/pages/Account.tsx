import { Laptop, LogOut } from "lucide-react";
import { toast } from "sonner";
import { NotificationsPanel } from "@/components/app/NotificationsPanel";
import { PageHeader, QueryState, Section } from "@/components/app/common";
import { Button } from "@/components/ui/button";
import { useMe } from "@/hooks/use-me";
import { dateTime, relative } from "@/lib/format";
import { trpc } from "@/trpc";

export function AccountPage() {
  const { me } = useMe();
  const sessions = trpc.members.mySessions.useQuery();
  const utils = trpc.useUtils();
  const revoke = trpc.members.revokeSession.useMutation({ onSuccess: () => { toast.success("Sessão encerrada"); utils.members.mySessions.invalidate(); } });
  const revokeOthers = trpc.members.revokeOtherSessions.useMutation({ onSuccess: () => { toast.success("Outras sessões encerradas"); utils.members.mySessions.invalidate(); } });
  return (
    <>
      <PageHeader title="Minha conta" description={`${me?.user.name} · ${me?.user.email}`} />
      <NotificationsPanel />
      <Section title="Sessões ativas" description="Dispositivos conectados à sua conta. As sessões expiram após 7 dias sem uso." actions={<Button variant="outline" size="sm" onClick={() => revokeOthers.mutate()}><LogOut /> Encerrar as outras</Button>}>
        <QueryState query={sessions}>
          {(list) => (
            <ul className="divide-y">
              {list.map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-3 text-sm">
                  <Laptop className="size-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{s.userAgent ?? "Navegador desconhecido"}</div>
                    <div className="text-xs text-muted-foreground">IP {s.ipAddress ?? "—"} · início {dateTime(s.createdAt)} · ativo {relative(s.updatedAt)}</div>
                  </div>
                  {s.current ? <span className="text-xs font-medium text-primary">Esta sessão</span> : <Button size="sm" variant="ghost" onClick={() => revoke.mutate({ id: s.id })}>Encerrar</Button>}
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </Section>
    </>
  );
}
