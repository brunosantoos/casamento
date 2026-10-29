import { trpc } from "@/trpc";

/** Usuário, casamento ativo e permissões efetivas (vindas do servidor — a interface só esconde; o backend é quem bloqueia) */
export function useMe() {
  const q = trpc.wedding.me.useQuery(undefined, { staleTime: 30_000 });
  const perms = new Set(q.data?.active?.permissions ?? []);
  return { ...q, me: q.data, wedding: q.data?.active ?? null, can: (p: string) => perms.has(p) };
}
