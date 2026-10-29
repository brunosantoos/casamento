import { Loader2, Mail } from "lucide-react";
import { useParams } from "react-router";
import { trpc } from "@/trpc";
import { GiftsSection } from "./GiftsSection";
import { PortalMessage, PortalShell, portalError, WeddingInfo } from "./Rsvp";

/** Página pública informativa: sem lista de convidados; a confirmação é pelo link pessoal */
export function PublicPage() {
  const { slug = "" } = useParams();
  const valid = /^[a-z0-9-]{3,60}$/.test(slug);
  const q = trpc.portal.page.useQuery({ slug }, { enabled: valid, retry: false, refetchOnWindowFocus: false });

  if (!valid) return <PortalMessage title="Página não encontrada" text="Confira o endereço recebido." />;
  if (q.isLoading) return <PortalShell><div className="grid place-items-center py-32"><Loader2 className="size-6 animate-spin text-primary" /></div></PortalShell>;
  if (q.error || !q.data) return <PortalMessage title="Página não encontrada" text={q.error ? portalError(q.error) : "Confira o endereço recebido."} />;
  const w = q.data;
  const accent = typeof w.config.accentColor === "string" ? w.config.accentColor : null;
  return (
    <PortalShell accent={accent}>
      <WeddingInfo w={w} photos={w.photos} />
      <GiftsSection slug={slug} />
      <div className="mt-10 flex items-start gap-3 rounded-xl border border-[oklch(0.9_0.014_70)] bg-white/80 p-4 text-sm shadow-soft">
        <Mail className="mt-0.5 size-5 shrink-0 text-primary" />
        <p>
          A confirmação de presença é feita pelo <b>link pessoal</b> enviado a cada família.
          {w.rsvpDeadline && <> Responda até <b>{new Date(w.rsvpDeadline).toLocaleDateString("pt-BR", { timeZone: w.timezone })}</b>.</>} Não recebeu? Fale com os noivos.
        </p>
      </div>
    </PortalShell>
  );
}
