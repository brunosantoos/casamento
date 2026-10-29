import { Loader2 } from "lucide-react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { AppLayout, RequirePerm } from "@/components/app/AppLayout";
import { useMe } from "@/hooks/use-me";
import { useSession } from "@/lib/auth-client";
import { AccountPage } from "@/pages/Account";
import { AssistantPage } from "@/pages/Assistant";
import { AuditPage } from "@/pages/Audit";
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SetupPage } from "@/pages/Auth";
import { CalendarPage } from "@/pages/Calendar";
import { CeremonyPage } from "@/pages/Ceremony";
import { ChecklistPage } from "@/pages/Checklist";
import { DashboardPage } from "@/pages/Dashboard";
import { DocumentsPage } from "@/pages/Documents";
import { CategoriesPage } from "@/pages/finance/Categories";
import { CashflowPage } from "@/pages/finance/Cashflow";
import { DepositsPage } from "@/pages/finance/Deposits";
import { FinanceOverviewPage } from "@/pages/finance/Overview";
import { IncomesPage } from "@/pages/finance/Incomes";
import { ObligationFormPage } from "@/pages/finance/ObligationForm";
import { ObligationPage } from "@/pages/finance/Obligation";
import { ObligationsPage } from "@/pages/finance/Obligations";
import { PayablesPage } from "@/pages/finance/Payables";
import { PaymentsPage } from "@/pages/finance/Payments";
import { ScenariosPage } from "@/pages/finance/Scenarios";
import { WalletsPage } from "@/pages/finance/Wallets";
import { PlannerPage } from "@/pages/finance/Planner";
import { AlbumPage, GalleryPage } from "@/pages/Gallery";
import { GuestsPage } from "@/pages/Guests";
import { InviteAcceptPage } from "@/pages/InviteAccept";
import { InvitesPage } from "@/pages/Invites";
import { OnboardingPage } from "@/pages/Onboarding";
import { PublicPage } from "@/pages/portal/PublicPage";
import { RsvpPage } from "@/pages/portal/Rsvp";
import { ReportsPage } from "@/pages/Reports";
import { SettingsPage } from "@/pages/Settings";
import { UsersPage } from "@/pages/Users";
import { VenuePage } from "@/pages/Venue";
import { VendorComparePage } from "@/pages/vendors/Compare";
import { VendorPage } from "@/pages/vendors/Vendor";
import { VendorsPage } from "@/pages/vendors/Vendors";
import { WhatsAppPage } from "@/pages/WhatsApp";
import { SeatingPage } from "@/pages/Seating";
import { GiftsPage } from "@/pages/Gifts";
import { GuestPhotosPage } from "@/pages/GuestPhotos";
import { CloseoutPage } from "@/pages/Closeout";

function FullScreenLoader() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { data, isPending } = useSession();
  const location = useLocation();
  if (isPending) return <FullScreenLoader />;
  if (!data) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}

/** Sem casamento ainda → onboarding */
function RequireWedding({ children }: { children: React.ReactNode }) {
  const { me, isLoading } = useMe();
  if (isLoading) return <FullScreenLoader />;
  if (!me?.active) return <Navigate to="/comecar" replace />;
  return children;
}

function GuestOnly({ children }: { children: React.ReactNode }) {
  const { data, isPending } = useSession();
  if (isPending) return <FullScreenLoader />;
  if (data) return <Navigate to="/" replace />;
  return children;
}

const P = (perm: string, el: React.ReactNode) => <RequirePerm perm={perm}>{el}</RequirePerm>;

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
      <Route path="/instalacao" element={<GuestOnly><SetupPage /></GuestOnly>} />
      <Route path="/esqueci-senha" element={<GuestOnly><ForgotPasswordPage /></GuestOnly>} />
      <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
      <Route path="/convite/:token" element={<InviteAcceptPage />} />
      {/* Portal público dos convidados: separado do painel */}
      <Route path="/c/:token" element={<RsvpPage />} />
      <Route path="/p/:slug" element={<PublicPage />} />
      <Route path="/comecar" element={<RequireAuth><OnboardingPage /></RequireAuth>} />
      <Route element={<RequireAuth><RequireWedding><AppLayout /></RequireWedding></RequireAuth>}>
        <Route index element={P("dashboard:view", <DashboardPage />)} />
        <Route path="financeiro" element={P("finance:view", <FinanceOverviewPage />)} />
        <Route path="financeiro/lancamentos" element={P("finance:view", <ObligationsPage />)} />
        <Route path="financeiro/lancamentos/novo" element={P("finance:create", <ObligationFormPage />)} />
        <Route path="financeiro/lancamentos/:id" element={P("finance:view", <ObligationPage />)} />
        <Route path="financeiro/lancamentos/:id/editar" element={P("finance:edit", <ObligationFormPage />)} />
        <Route path="financeiro/pagar" element={P("finance:view", <PayablesPage />)} />
        <Route path="financeiro/pagamentos" element={P("finance:view", <PaymentsPage />)} />
        <Route path="financeiro/entradas" element={P("finance:view", <IncomesPage />)} />
        <Route path="financeiro/caucoes" element={P("finance:view", <DepositsPage />)} />
        <Route path="financeiro/planejar" element={P("finance:view", <PlannerPage />)} />
        <Route path="financeiro/carteiras" element={P("finance:view", <WalletsPage />)} />
        <Route path="financeiro/fluxo" element={P("finance:view", <CashflowPage />)} />
        <Route path="financeiro/categorias" element={P("finance:view", <CategoriesPage />)} />
        <Route path="financeiro/cenarios" element={P("finance:view", <ScenariosPage />)} />
        <Route path="checklist" element={P("planning:view", <ChecklistPage />)} />
        <Route path="calendario" element={P("calendar:view", <CalendarPage />)} />
        <Route path="cerimonia" element={P("ceremony:view", <CeremonyPage />)} />
        <Route path="recepcao" element={P("venue:view", <VenuePage />)} />
        <Route path="fornecedores" element={P("vendors:view", <VendorsPage />)} />
        <Route path="fornecedores/comparar" element={P("vendors:view", <VendorComparePage />)} />
        <Route path="fornecedores/:id" element={P("vendors:view", <VendorPage />)} />
        <Route path="documentos" element={P("documents:view", <DocumentsPage />)} />
        <Route path="convidados" element={P("guests:view", <GuestsPage />)} />
        <Route path="convites" element={P("rsvp:view", <InvitesPage />)} />
        <Route path="mesas" element={P("guests:view", <SeatingPage />)} />
        <Route path="presentes" element={P("finance:view", <GiftsPage />)} />
        <Route path="fotos-convidados" element={P("gallery:view", <GuestPhotosPage />)} />
        <Route path="encerramento" element={P("planning:view", <CloseoutPage />)} />
        <Route path="whatsapp" element={P("whatsapp:view", <WhatsAppPage />)} />
        <Route path="galeria" element={P("gallery:view", <GalleryPage />)} />
        <Route path="galeria/:id" element={P("gallery:view", <AlbumPage />)} />
        <Route path="assistente" element={P("ai:view", <AssistantPage />)} />
        <Route path="relatorios" element={P("reports:view", <ReportsPage />)} />
        <Route path="auditoria" element={P("audit:view", <AuditPage />)} />
        <Route path="usuarios" element={P("users:view", <UsersPage />)} />
        <Route path="configuracoes" element={P("settings:view", <SettingsPage />)} />
        <Route path="conta" element={<AccountPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
