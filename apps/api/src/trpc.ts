import { DomainError, effectivePermissions, securityEvent, type Ctx, type Permission } from "@casa/core";
import { prisma } from "@casa/db";
import { initTRPC, TRPCError } from "@trpc/server";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { fromNodeHeaders } from "better-auth/node";
import { randomUUID } from "node:crypto";
import superjson from "superjson";
import { auth } from "./auth.js";

export async function createContext({ req, res }: CreateExpressContextOptions) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  const correlationId = (req.headers["x-request-id"] as string | undefined)?.slice(0, 64) ?? randomUUID();
  res.setHeader("x-request-id", correlationId);
  return {
    req,
    res,
    session,
    ip: req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
    correlationId,
    requestedWeddingId: (req.headers["x-wedding-id"] as string | undefined) ?? null,
  };
}
type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter: ({ shape, error }) => ({
    ...shape,
    // Erros internos não vazam detalhes
    message: error.code === "INTERNAL_SERVER_ERROR" ? "Erro interno. Tente novamente." : shape.message,
    data: { ...shape.data, stack: undefined },
  }),
});

export const router = t.router;

/** DomainError do core → código tRPC correspondente */
const domainErrors = t.middleware(async ({ next, path }) => {
  const res = await next();
  if (!res.ok) {
    const cause = res.error.cause;
    if (cause instanceof DomainError) throw new TRPCError({ code: cause.code, message: cause.message, cause });
    if ((cause as { code?: string } | undefined)?.code === "P2002") throw new TRPCError({ code: "CONFLICT", message: "Registro duplicado" });
    if ((cause as { code?: string } | undefined)?.code === "P2025") throw new TRPCError({ code: "NOT_FOUND", message: "Registro não encontrado" });
    if (res.error.code === "INTERNAL_SERVER_ERROR") console.error(`[trpc] ${path}:`, cause ?? res.error);
  }
  return res;
});

export const publicProcedure = t.procedure.use(domainErrors);

export const authedProcedure = publicProcedure.use(async ({ ctx, next }) => {
  if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED", message: "Faça login para continuar" });
  const user = await prisma.user.findUnique({ where: { id: ctx.session.user.id } });
  if (!user || !user.active) throw new TRPCError({ code: "UNAUTHORIZED", message: "Conta desativada" });
  return next({ ctx: { ...ctx, user } });
});

/** Casamento ativo + permissões efetivas do membro. Nenhum dado de outro casamento é acessível. */
export const weddingProcedure = authedProcedure.use(async ({ ctx, next }) => {
  const weddingId = ctx.requestedWeddingId ?? ctx.user.activeWeddingId;
  if (!weddingId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "NO_WEDDING" });
  const member = await prisma.weddingMember.findUnique({ where: { weddingId_userId: { weddingId, userId: ctx.user.id } }, include: { role: true, wedding: true } });
  if (!member || !member.active || member.wedding.archivedAt) {
    await securityEvent("forbidden_wedding", { userId: ctx.user.id, weddingId, ip: ctx.ip });
    throw new TRPCError({ code: "FORBIDDEN", message: "Sem acesso a este casamento" });
  }
  const permissions = effectivePermissions(member.role, member);
  const svc: Ctx = { weddingId, permissions, actor: { userId: ctx.user.id, userName: ctx.user.name, ip: ctx.ip, correlationId: ctx.correlationId, origin: "web" } };
  return next({ ctx: { ...ctx, weddingId, member, wedding: member.wedding, permissions, svc } });
});

/** Exige uma ou mais permissões (todas) */
export const perm = (...required: Permission[]) =>
  weddingProcedure.use(async ({ ctx, next, path }) => {
    const missing = required.filter((p) => !ctx.permissions.has(p));
    if (missing.length) {
      await securityEvent("forbidden", { userId: ctx.user.id, weddingId: ctx.weddingId, ip: ctx.ip, details: { path, missing } });
      throw new TRPCError({ code: "FORBIDDEN", message: `Você não tem permissão para esta ação (${missing.join(", ")})` });
    }
    return next();
  });

export const superAdminProcedure = authedProcedure.use(({ ctx, next }) => {
  if (!ctx.user.isSuperAdmin) throw new TRPCError({ code: "FORBIDDEN", message: "Acesso restrito ao administrador da plataforma" });
  return next();
});
