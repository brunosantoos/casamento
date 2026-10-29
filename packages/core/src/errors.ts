/** Erros de domínio: a API converte em códigos tRPC adequados (ver apps/api/src/trpc.ts) */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: "BAD_REQUEST" | "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "PRECONDITION_FAILED" = "BAD_REQUEST",
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new DomainError(`${what} não encontrado(a)`, "NOT_FOUND");
export const forbidden = (msg = "Você não tem permissão para esta ação") => new DomainError(msg, "FORBIDDEN");
export const conflict = (msg: string) => new DomainError(msg, "CONFLICT");

export function assert(cond: unknown, message: string, code: DomainError["code"] = "BAD_REQUEST"): asserts cond {
  if (!cond) throw new DomainError(message, code);
}
