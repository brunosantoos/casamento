import type { Actor } from "./audit.js";
import type { Permission } from "./permissions.js";

/** Contexto de execução dos serviços: casamento ativo, quem age e o que pode fazer */
export type Ctx = {
  weddingId: string;
  actor: Actor;
  permissions: Set<string>;
};

export const can = (ctx: Pick<Ctx, "permissions">, p: Permission) => ctx.permissions.has(p);
