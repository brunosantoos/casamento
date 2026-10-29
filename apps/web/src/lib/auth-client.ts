import { createAuthClient } from "better-auth/react";

// Mesma origem (proxy do Vite / reverse proxy em produção) → /api/auth
export const authClient = createAuthClient({ baseURL: window.location.origin });

export const { useSession, signIn, signUp, signOut } = authClient;
