import { DomainError, effectivePermissions, type Ctx, type Permission } from "@casa/core";
import { prisma } from "@casa/db";
import { fromNodeHeaders } from "better-auth/node";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { auth } from "./auth.js";

/** Contexto de serviço para rotas Express (upload/exportação): mesma regra do tRPC */
export async function httpCtx(req: Request, res: Response, required: Permission[]): Promise<Ctx | null> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) {
    res.status(401).json({ error: "Faça login para continuar" });
    return null;
  }
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  const weddingId = (req.headers["x-wedding-id"] as string | undefined) ?? (req.query.wedding as string | undefined) ?? user?.activeWeddingId;
  if (!user?.active || !weddingId) {
    res.status(403).json({ error: "Sem acesso" });
    return null;
  }
  const member = await prisma.weddingMember.findUnique({ where: { weddingId_userId: { weddingId, userId: user.id } }, include: { role: true } });
  if (!member?.active) {
    res.status(403).json({ error: "Sem acesso a este casamento" });
    return null;
  }
  const permissions = effectivePermissions(member.role, member);
  const missing = required.filter((p) => !permissions.has(p));
  if (missing.length) {
    res.status(403).json({ error: `Sem permissão (${missing.join(", ")})` });
    return null;
  }
  return { weddingId, permissions, actor: { userId: user.id, userName: user.name, ip: req.ip ?? null, correlationId: randomUUID(), origin: "web" } };
}

export function sendError(res: Response, e: unknown) {
  if (e instanceof DomainError) {
    const status = { BAD_REQUEST: 400, NOT_FOUND: 404, FORBIDDEN: 403, CONFLICT: 409, PRECONDITION_FAILED: 412 }[e.code];
    return res.status(status).json({ error: e.message });
  }
  console.error("[http]", e);
  return res.status(500).json({ error: "Erro interno" });
}
