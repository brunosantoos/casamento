import {
  Banknote, BarChart3, Camera, Download, Gift, HeartHandshake, LayoutGrid, Bot, CalendarDays, Check, ChevronsUpDown, Church, ClipboardCheck, FileText, Images, LayoutDashboard, LogOut, Mail, Menu, MessageCircle, PartyPopper, Plus,
  ScrollText, Settings, ShieldCheck, Store, Users, UsersRound,
} from "lucide-react";
import { useRef, useState } from "react";
import { AnimatedIcon, type AnimatedIconHandle } from "./AnimatedIcon";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useMe } from "@/hooks/use-me";
import { signOut } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc";
import { Logo, ThemeToggle } from "./common";
import { CoupleAvatars } from "./CouplePhotos";
import { InstallBanner, useInstallAction } from "./InstallApp";
import { NotificationBell } from "./NotificationsPanel";

type NavItem = { to: string; label: string; short: string; icon: typeof LayoutDashboard; anim: string; perm: string; end?: boolean; group: "main" | "event" | "people" | "tools" | "admin"; mobile?: boolean };

export const NAV: NavItem[] = [
  { to: "/", anim: "home", label: "Dashboard", short: "Início", icon: LayoutDashboard, perm: "dashboard:view", end: true, group: "main", mobile: true },
  { to: "/financeiro", anim: "finance", label: "Financeiro", short: "Financeiro", icon: Banknote, perm: "finance:view", group: "main", mobile: true },
  { to: "/checklist", anim: "tasks", label: "Planejamento e checklist", short: "Checklist", icon: ClipboardCheck, perm: "planning:view", group: "main", mobile: true },
  { to: "/calendario", anim: "calendar", label: "Calendário", short: "Agenda", icon: CalendarDays, perm: "calendar:view", group: "main" },
  { to: "/cerimonia", anim: "ceremony", label: "Igreja e cerimônia", short: "Cerimônia", icon: Church, perm: "ceremony:view", group: "event" },
  { to: "/recepcao", anim: "venue", label: "Recepção e festa", short: "Recepção", icon: PartyPopper, perm: "venue:view", group: "event" },
  { to: "/fornecedores", anim: "vendors", label: "Fornecedores", short: "Fornecedores", icon: Store, perm: "vendors:view", group: "event" },
  { to: "/documentos", anim: "documents", label: "Contratos e documentos", short: "Documentos", icon: FileText, perm: "documents:view", group: "event" },
  { to: "/convidados", anim: "guests", label: "Convidados", short: "Convidados", icon: UsersRound, perm: "guests:view", group: "people", mobile: true },
  { to: "/convites", anim: "invites", label: "Convites e confirmações", short: "Convites", icon: Mail, perm: "rsvp:view", group: "people" },
  { to: "/mesas", anim: "seating", label: "Mapa de mesas", short: "Mesas", icon: LayoutGrid, perm: "guests:view", group: "people" },
  { to: "/presentes", anim: "gifts", label: "Presentes (Pix)", short: "Presentes", icon: Gift, perm: "finance:view", group: "people" },
  { to: "/whatsapp", anim: "whatsapp", label: "WhatsApp", short: "WhatsApp", icon: MessageCircle, perm: "whatsapp:view", group: "people" },
  { to: "/galeria", anim: "gallery", label: "Galeria e referências", short: "Galeria", icon: Images, perm: "gallery:view", group: "tools" },
  { to: "/fotos-convidados", anim: "guestphotos", label: "Fotos dos convidados", short: "Fotos", icon: Camera, perm: "gallery:view", group: "tools" },
  { to: "/encerramento", anim: "closeout", label: "Encerramento", short: "Encerrar", icon: HeartHandshake, perm: "planning:view", group: "tools" },
  { to: "/assistente", anim: "ask", label: "Assistente (IA)", short: "IA", icon: Bot, perm: "ai:view", group: "tools" },
  { to: "/relatorios", anim: "reports", label: "Relatórios", short: "Relatórios", icon: BarChart3, perm: "reports:view", group: "tools" },
  { to: "/auditoria", anim: "audit", label: "Auditoria e histórico", short: "Auditoria", icon: ScrollText, perm: "audit:view", group: "admin" },
  { to: "/usuarios", anim: "users", label: "Usuários e permissões", short: "Usuários", icon: ShieldCheck, perm: "users:view", group: "admin" },
  { to: "/configuracoes", anim: "settings", label: "Configurações", short: "Ajustes", icon: Settings, perm: "settings:view", group: "admin" },
];

const GROUPS: { key: NavItem["group"]; label: string | null }[] = [
  { key: "main", label: null },
  { key: "event", label: "Evento" },
  { key: "people", label: "Convidados" },
  { key: "tools", label: "Ferramentas" },
  { key: "admin", label: "Administração" },
];

function useNav() {
  const { can } = useMe();
  return NAV.filter((n) => can(n.perm));
}

function NavLinkItem({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const icon = useRef<AnimatedIconHandle>(null);
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      onMouseEnter={() => icon.current?.play()}
      onFocus={() => icon.current?.play()}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center gap-3 rounded-lg px-3 py-[7px] text-sm font-medium transition-colors",
          isActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute top-1/2 -left-3 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary" />}
          <AnimatedIcon ref={icon} name={item.anim} fallback={item.icon} className={isActive ? "opacity-100" : undefined} />
          {item.label}
        </>
      )}
    </NavLink>
  );
}

function MobileTab({ item, className }: { item: NavItem; className: (active: boolean) => string }) {
  const icon = useRef<AnimatedIconHandle>(null);
  return (
    <NavLink to={item.to} end={item.end} className={({ isActive }) => className(isActive)} onPointerDown={() => icon.current?.play()}>
      {({ isActive }) => (
        <>
          <span className={cn("grid h-7 w-11 place-items-center rounded-full transition", isActive && "bg-accent")}>
            <AnimatedIcon ref={icon} name={item.anim} fallback={item.icon} className={isActive ? "opacity-100" : undefined} />
          </span>
          {item.short}
        </>
      )}
    </NavLink>
  );
}

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const nav = useNav();
  return (
    <nav className="flex flex-col gap-0.5">
      {GROUPS.map((g) => {
        const items = nav.filter((n) => n.group === g.key);
        if (!items.length) return null;
        return (
          <div key={g.key} className="flex flex-col gap-0.5">
            {g.label && <div className="mt-4 mb-1 px-3 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{g.label}</div>}
            {items.map((n) => <NavLinkItem key={n.to} item={n} onNavigate={onNavigate} />)}
          </div>
        );
      })}
    </nav>
  );
}

function daysLeft(date: Date | string | null | undefined) {
  if (!date) return null;
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86400_000);
}

/** Troca de casamento (o modelo suporta vários; o usual é um só) */
function WeddingCard() {
  const { me, wedding } = useMe();
  const utils = trpc.useUtils();
  const navigate = useNavigate();
  const sw = trpc.wedding.switch.useMutation({ onSuccess: async () => { await utils.invalidate(); navigate("/"); } });
  const d = daysLeft(wedding?.date);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="group flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left shadow-soft transition hover:border-primary/40">
          <CoupleAvatars size="size-8" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-heading text-[15px] leading-tight font-semibold">{wedding ? `${wedding.partner1Name} & ${wedding.partner2Name}` : "—"}</div>
            <div className="truncate text-xs text-muted-foreground">
              {d == null ? "Data a definir" : d > 0 ? `Faltam ${d} dia${d === 1 ? "" : "s"}` : d === 0 ? "É hoje! 💍" : `Casaram há ${-d} dia${d === -1 ? "" : "s"}`} · {wedding?.role}
            </div>
          </div>
          <ChevronsUpDown className="size-4 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Casamentos</DropdownMenuLabel>
        {me?.weddings.map((w) => (
          <DropdownMenuItem key={w.id} onClick={() => w.id !== wedding?.id && sw.mutate({ weddingId: w.id })}>
            <span className="truncate">{w.name}</span>
            {w.id === wedding?.id && <Check className="ml-auto size-4 text-primary" />}
          </DropdownMenuItem>
        ))}
        {me?.canCreateWedding && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/comecar?novo=1")}><Plus /> Novo casamento</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({ compact }: { compact?: boolean }) {
  const { me } = useMe();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const user = me?.user;
  const install = useInstallAction();
  const initials = (user?.name ?? "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  async function logout() {
    await signOut();
    await utils.invalidate();
    navigate("/login");
  }
  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={cn("flex items-center gap-2.5 rounded-lg text-left transition hover:bg-sidebar-accent/60", compact ? "p-1" : "min-w-0 flex-1 p-2")}>
          <Avatar className="size-8"><AvatarFallback className="bg-brand text-xs font-semibold text-white">{initials}</AvatarFallback></Avatar>
          {!compact && (
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{user?.name}</div>
              <div className="truncate text-xs text-muted-foreground">{user?.email}</div>
            </div>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={compact ? "end" : "start"} className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="text-sm font-medium">{user?.name}</div>
          <div className="text-xs text-muted-foreground">{user?.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/conta")}><Users /> Minha conta e sessões</DropdownMenuItem>
        {!install.installed && <DropdownMenuItem onClick={install.install}><Download /> Instalar app</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={logout}><LogOut /> Sair</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    {install.dialog}
    </>
  );
}

function MobileTabs() {
  const [more, setMore] = useState(false);
  const location = useLocation();
  const nav = useNav();
  const mobile = nav.filter((n) => n.mobile).slice(0, 4);
  const inMore = !mobile.some((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)));
  const tabClass = (active: boolean) => cn("relative flex flex-col items-center gap-1 py-2.5 text-[10.5px] font-medium", active ? "text-primary" : "text-muted-foreground");
  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        <div className="grid grid-cols-5">
          {mobile.map((n) => <MobileTab key={n.to} item={n} className={tabClass} />)}
          <button type="button" onClick={() => setMore(true)} className={tabClass(inMore)}>
            <span className={cn("grid h-7 w-11 place-items-center rounded-full transition", inMore && "bg-accent")}><Menu className="size-[18px]" /></span>
            Mais
          </button>
        </div>
      </nav>
      <Sheet open={more} onOpenChange={setMore}>
        <SheetContent side="bottom" className="overflow-y-auto p-4 pb-8">
          <SheetHeader className="px-2"><SheetTitle>Menu</SheetTitle></SheetHeader>
          <SideNav onNavigate={() => setMore(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}

function MobileTopBar() {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b bg-background/90 px-4 pt-[calc(0.625rem+env(safe-area-inset-top))] pb-2.5 backdrop-blur-xl md:hidden">
      <Link to="/"><Logo /></Link>
      <div className="flex items-center gap-1">
        <NotificationBell />
        <ThemeToggle />
        <UserMenu compact />
      </div>
    </header>
  );
}

/** Telas que ocupam toda a área (chat do assistente) */
const FULL_BLEED = ["/assistente"];

export function AppLayout() {
  const location = useLocation();
  const fullBleed = FULL_BLEED.some((p) => location.pathname.startsWith(p));
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[272px_1fr]">
      <aside className="hidden border-r bg-sidebar md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:gap-3 md:py-4">
        <div className="shrink-0 space-y-3 px-4">
          <Link to="/" className="block px-1 pt-1"><Logo /></Link>
          <WeddingCard />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 scrollbar-hover">
          <div className="px-1 pb-2"><SideNav /></div>
        </div>
        <div className="mx-4 flex shrink-0 items-center gap-1 border-t pt-3">
          <UserMenu />
          <NotificationBell />
          <ThemeToggle />
        </div>
      </aside>

      <MobileTopBar />

      <main
        key={location.pathname.split("/")[1] ?? ""}
        className={cn(
          "w-full min-w-0 animate-in duration-300 fade-in",
          fullBleed
            ? "h-[calc(100dvh-57px-64px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] md:h-dvh"
            : "mx-auto max-w-[1600px] px-4 pt-5 pb-28 slide-in-from-bottom-1 md:px-8 md:py-8 xl:px-10",
        )}
      >
        {location.pathname === "/" && <InstallBanner />}
        <Outlet />
      </main>

      <MobileTabs />
    </div>
  );
}

/** Bloqueia a rota se o usuário não tiver a permissão (o servidor também bloqueia) */
export function RequirePerm({ perm, children }: { perm: string; children: React.ReactNode }) {
  const { can, isLoading } = useMe();
  if (isLoading) return null;
  if (!can(perm)) {
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <ShieldCheck className="mx-auto mb-3 size-8 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Acesso restrito</h1>
        <p className="mt-1 text-sm text-muted-foreground">Seu perfil não tem permissão para esta área. Fale com o administrador do casamento.</p>
      </div>
    );
  }
  return <>{children}</>;
}
