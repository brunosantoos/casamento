import { Bell, BellOff, BellRing, CheckCheck, Laptop, Send, Smartphone, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { relative } from "@/lib/format";
import { currentPushSubscription, notificationPermission, pushSupport, subscribeThisDevice, unsubscribeThisDevice } from "@/lib/pwa";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc";
import { LoadingButton, Section, Spinner } from "./common";

const deviceLabel = (ua: string | null) => {
  if (!ua) return "Navegador";
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Mac OS/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  return [br, os].filter(Boolean).join(" · ");
};
const isMobileUa = (ua: string | null) => !!ua && /iPhone|iPad|Android/.test(ua);

/** Preferências e aparelhos de notificação da pessoa logada (página /conta) */
export function NotificationsPanel() {
  const utils = trpc.useUtils();
  const support = pushSupport();
  const [perm, setPerm] = useState(notificationPermission());
  const [thisEndpoint, setThisEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const vapid = trpc.notifications.vapidPublicKey.useQuery(undefined, { enabled: support === "ok", staleTime: Infinity });
  const subs = trpc.notifications.mySubscriptions.useQuery();
  const prefs = trpc.notifications.prefs.useQuery();
  const subscribe = trpc.notifications.subscribe.useMutation();
  const unsubscribe = trpc.notifications.unsubscribe.useMutation({ onSuccess: () => utils.notifications.mySubscriptions.invalidate() });
  const setPref = trpc.notifications.setPref.useMutation({ onSuccess: () => utils.notifications.prefs.invalidate(), onError: (e) => toast.error(e.message) });
  const test = trpc.notifications.test.useMutation({ onSuccess: () => toast.success("Notificação de teste enviada"), onError: (e) => toast.error(e.message) });

  useEffect(() => {
    void currentPushSubscription().then((s) => setThisEndpoint(s?.endpoint ?? null));
  }, []);

  const thisActive = !!thisEndpoint && !!subs.data?.some((s) => s.endpoint === thisEndpoint);

  async function enable() {
    if (!vapid.data) return;
    setBusy(true);
    try {
      const sub = await subscribeThisDevice(vapid.data);
      await subscribe.mutateAsync(sub);
      setThisEndpoint(sub.endpoint);
      setPerm(notificationPermission());
      await utils.notifications.mySubscriptions.invalidate();
      toast.success("Notificações ativadas neste aparelho");
    } catch (e) {
      setPerm(notificationPermission());
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const endpoint = await unsubscribeThisDevice();
      if (endpoint) await unsubscribe.mutateAsync({ endpoint });
      setThisEndpoint(null);
      toast.success("Notificações desativadas neste aparelho");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      className="mb-5"
      title="Notificações"
      description="Avisos no celular ou no computador, mesmo com o app fechado. Cada pessoa escolhe o que recebe."
      actions={subs.data?.length ? <LoadingButton size="sm" variant="outline" loading={test.isPending} onClick={() => test.mutate()}>{!test.isPending && <Send />} Enviar teste</LoadingButton> : null}
    >
      <div className="space-y-5">
        {/* Este aparelho */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/30 p-4">
          <span className={cn("grid size-10 place-items-center rounded-xl", thisActive ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground")}>
            {thisActive ? <BellRing className="size-5" /> : <BellOff className="size-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{thisActive ? "Ativas neste aparelho" : "Desativadas neste aparelho"}</div>
            <div className="text-xs text-muted-foreground">
              {support === "ios-needs-install" && "No iPhone/iPad, instale o app na Tela de Início (Compartilhar → Adicionar à Tela de Início) e abra por ele para ativar."}
              {support === "unsupported" && "Este navegador não suporta notificações push."}
              {support === "insecure" && "Notificações exigem conexão segura (HTTPS)."}
              {support === "ok" && perm === "denied" && "O navegador bloqueou as notificações. Libere nas configurações do site (ícone do cadeado ao lado do endereço) e recarregue."}
              {support === "ok" && perm !== "denied" && (thisActive ? "Você recebe os avisos marcados abaixo." : "Ative para receber os avisos marcados abaixo.")}
            </div>
          </div>
          {support === "ok" && perm !== "denied" && (
            thisActive
              ? <LoadingButton variant="outline" size="sm" loading={busy} onClick={disable}>Desativar</LoadingButton>
              : <LoadingButton size="sm" loading={busy} disabled={!vapid.data} onClick={enable}>{!busy && <Bell />} Ativar notificações</LoadingButton>
          )}
        </div>

        {/* Preferências */}
        <div>
          <h3 className="mb-2 text-sm font-semibold">O que você quer receber</h3>
          {prefs.isLoading ? <Spinner /> : (
            <ul className="divide-y rounded-xl border">
              {prefs.data?.map((p) => (
                <li key={p.event} className={cn("flex items-center gap-3 px-4 py-3", !p.allowed && "opacity-55")}>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{p.label}</div>
                    <div className="text-xs text-muted-foreground">{p.allowed ? p.description : "Seu perfil não tem acesso a este assunto"}</div>
                  </div>
                  <Switch checked={p.allowed && p.enabled} disabled={!p.allowed || setPref.isPending} onCheckedChange={(v) => setPref.mutate({ event: p.event, enabled: v })} aria-label={p.label} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Aparelhos */}
        {!!subs.data?.length && (
          <div>
            <h3 className="mb-2 text-sm font-semibold">Aparelhos com notificações</h3>
            <ul className="divide-y rounded-xl border">
              {subs.data.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  {isMobileUa(s.userAgent) ? <Smartphone className="size-4 text-muted-foreground" /> : <Laptop className="size-4 text-muted-foreground" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{deviceLabel(s.userAgent)}{s.endpoint === thisEndpoint && <span className="ml-2 text-xs font-medium text-primary">este aparelho</span>}</div>
                    <div className="text-xs text-muted-foreground">Ativado {relative(s.createdAt)}{s.lastUsedAt ? ` · último aviso ${relative(s.lastUsedAt)}` : ""}</div>
                  </div>
                  <Button size="icon-sm" variant="ghost" aria-label="Remover aparelho" onClick={() => unsubscribe.mutate({ id: s.id })}><Trash2 /></Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {support === "ok" && perm === "denied" && (
          <Alert><AlertDescription>Depois de liberar no navegador, volte aqui e toque em "Ativar notificações".</AlertDescription></Alert>
        )}
      </div>
    </Section>
  );
}

/** Sino com contador de não lidas e caixa de entrada. Sem props; use no cabeçalho/sidebar. */
export function NotificationBell({ className }: { className?: string }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const count = trpc.notifications.unreadCount.useQuery(undefined, { refetchInterval: 60_000 });
  const inbox = trpc.notifications.inbox.useQuery(undefined, { enabled: open });
  const refresh = () => Promise.all([utils.notifications.unreadCount.invalidate(), utils.notifications.inbox.invalidate()]);
  const markRead = trpc.notifications.markRead.useMutation({ onSuccess: refresh });
  const markAll = trpc.notifications.markAllRead.useMutation({ onSuccess: refresh });
  const unread = count.data ?? 0;
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={cn("relative", className)} aria-label={unread ? `${unread} notificações não lidas` : "Notificações"}>
          <Bell />
          {unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-primary px-1 text-[10px] leading-4 font-bold text-primary-foreground tabular-nums">{unread > 9 ? "9+" : unread}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notificações</span>
          <Button size="xs" variant="ghost" disabled={!unread || markAll.isPending} onClick={() => markAll.mutate()}><CheckCheck /> Marcar todas</Button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {inbox.isLoading ? <div className="grid place-items-center py-8"><Spinner /></div> : !inbox.data?.length ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhuma notificação ainda</div>
          ) : (
            <ul>
              {inbox.data.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={cn("flex w-full gap-2.5 px-3 py-2.5 text-left transition hover:bg-muted/60", !n.readAt && "bg-primary/5")}
                    onClick={() => {
                      if (!n.readAt) markRead.mutate({ id: n.id });
                      setOpen(false);
                      if (n.url) navigate(n.url);
                    }}
                  >
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{n.title}</span>
                      {n.body && <span className="line-clamp-2 block text-xs text-muted-foreground">{n.body}</span>}
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">{relative(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t px-3 py-2 text-right">
          <Button size="xs" variant="ghost" onClick={() => { setOpen(false); navigate("/conta"); }}>Preferências</Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
