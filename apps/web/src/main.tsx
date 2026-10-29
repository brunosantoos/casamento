import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import superjson from "superjson";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initTheme, ThemeProvider } from "@/lib/theme";
import { registerServiceWorker } from "@/lib/pwa";
import { trpc } from "@/trpc";
import { App } from "./App";
import "./index.css";

// Aplica o tema antes do React montar (sem piscar)
initTheme();
// PWA: instalação e funcionamento como app
registerServiceWorker();

function Root() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            // Não insiste em erros de permissão/validação
            retry: (n, e) => n < 1 && !(e instanceof TRPCClientError && ["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND", "BAD_REQUEST", "PRECONDITION_FAILED"].includes(e.data?.code)),
          },
        },
      }),
  );
  const [trpcClient] = useState(() => trpc.createClient({ links: [httpBatchLink({ url: "/trpc", transformer: superjson })] }));
  return (
    <ThemeProvider>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
            <Toaster richColors position="top-right" />
          </TooltipProvider>
        </QueryClientProvider>
      </trpc.Provider>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
