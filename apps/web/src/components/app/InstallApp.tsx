import { Download, EllipsisVertical, Laptop, Share, Smartphone, SquarePlus, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { canPromptInstall, isIOS, isStandalone, onInstallChange, promptInstall } from "@/lib/pwa";

type Platform = "ios" | "mac-safari" | "android" | "desktop";

function platform(): Platform {
  if (isIOS()) return "ios";
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg|Firefox|OPR/.test(ua)) return "mac-safari";
  return "desktop";
}

/** Estado da instalação do app: já instalado, prompt nativo disponível e plataforma (para instruções manuais) */
export function useInstall() {
  const [canPrompt, setCanPrompt] = useState(canPromptInstall());
  const [installed, setInstalled] = useState(isStandalone());
  useEffect(
    () =>
      onInstallChange(() => {
        setCanPrompt(canPromptInstall());
        setInstalled(isStandalone());
      }),
    [],
  );
  return { installed, canPrompt, platform: platform() };
}

/** Abre o prompt nativo (Chrome/Edge) ou, sem ele, o diálogo com o passo a passo da plataforma */
export function useInstallAction() {
  const state = useInstall();
  const [help, setHelp] = useState(false);
  async function install() {
    if (state.canPrompt) {
      if (await promptInstall()) toast.success("Nosso Casamento instalado");
      return;
    }
    setHelp(true);
  }
  const dialog = <InstallHelpDialog open={help} onOpenChange={setHelp} platform={state.platform} />;
  return { ...state, install, dialog };
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/12 text-xs font-semibold text-primary">{n}</span>
      <span className="pt-0.5">{children}</span>
    </li>
  );
}

const Kbd = ({ children }: { children: ReactNode }) => (
  <span className="inline-flex items-center gap-1 rounded-md border bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground [&_svg]:size-3.5">{children}</span>
);

const STEPS: Record<Platform, { title: string; icon: ReactNode; steps: ReactNode[] }> = {
  ios: {
    title: "Instalar no iPhone ou iPad",
    icon: <Smartphone />,
    steps: [
      <>Abra este site no <b>Safari</b>.</>,
      <>Toque em <Kbd><Share /> Compartilhar</Kbd> na barra do navegador.</>,
      <>Escolha <Kbd><SquarePlus /> Adicionar à Tela de Início</Kbd> e confirme.</>,
    ],
  },
  "mac-safari": {
    title: "Instalar no Mac",
    icon: <Laptop />,
    steps: [
      <>No Safari, abra o menu <Kbd>Arquivo</Kbd>.</>,
      <>Clique em <Kbd>Adicionar ao Dock…</Kbd> e confirme.</>,
      <>O Nosso Casamento abre como app, direto do Dock ou do Launchpad.</>,
    ],
  },
  android: {
    title: "Instalar no Android",
    icon: <Smartphone />,
    steps: [
      <>Abra este site no <b>Chrome</b>.</>,
      <>Toque no menu <Kbd><EllipsisVertical /></Kbd> no canto superior.</>,
      <>Escolha <Kbd>Instalar app</Kbd> ou <Kbd>Adicionar à tela inicial</Kbd>.</>,
    ],
  },
  desktop: {
    title: "Instalar no computador",
    icon: <Laptop />,
    steps: [
      <>Abra este site no <b>Chrome</b> ou no <b>Edge</b>.</>,
      <>Clique no ícone <Kbd><Download /> Instalar</Kbd> no fim da barra de endereço.</>,
      <>Ou use o menu <Kbd><EllipsisVertical /></Kbd> → <Kbd>Instalar Nosso Casamento…</Kbd></>,
    ],
  },
};

function InstallHelpDialog({ open, onOpenChange, platform }: { open: boolean; onOpenChange: (v: boolean) => void; platform: Platform }) {
  const s = STEPS[platform];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 [&_svg]:size-5 [&_svg]:text-primary">{s.icon} {s.title}</DialogTitle>
          <DialogDescription>Com o app instalado, o Nosso Casamento abre em tela própria, fica no seu início/Dock.</DialogDescription>
        </DialogHeader>
        <ol className="space-y-3 text-sm">
          {s.steps.map((step, i) => <Step key={i} n={i + 1}>{step}</Step>)}
        </ol>
      </DialogContent>
    </Dialog>
  );
}

const DISMISS_KEY = "install-banner-dismissed";

/** Faixa discreta no Início convidando a instalar (some depois de instalado ou dispensado) */
export function InstallBanner() {
  const { installed, canPrompt, platform, install, dialog } = useInstallAction();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  // Só mostra quando dá para instalar de fato: prompt nativo ou celular (iPhone/Android têm passo a passo)
  const show = !installed && !dismissed && (canPrompt || platform === "ios" || platform === "android");
  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* armazenamento indisponível: some só nesta sessão */
    }
  }
  return (
    <>
      {show && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3 text-sm">
          <img src="/icons/icon-192.png" alt="" className="size-9 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">Instale o Nosso Casamento</div>
            <div className="text-xs text-muted-foreground">Abre como app, direto da tela inicial,.</div>
          </div>
          <Button size="sm" onClick={install}><Download /> Instalar</Button>
          <Button size="icon" variant="ghost" className="size-8 shrink-0" onClick={dismiss} aria-label="Dispensar"><X /></Button>
        </div>
      )}
      {dialog}
    </>
  );
}
