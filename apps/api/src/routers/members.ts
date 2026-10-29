import { ALL_PERMISSIONS, audit, emailLayout, env, isPermission, randomToken, securityEvent, sendEmail, tokenHash } from "@casa/core";
import { prisma } from "@casa/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auth } from "../auth.js";
import { authedProcedure, perm, publicProcedure, router, superAdminProcedure } from "../trpc.js";
import { fromNodeHeaders } from "better-auth/node";

const permList = z.array(z.string()).transform((l) => l.filter(isPermission));

export const membersRouter = router({
  list: perm("users:view").query(async ({ ctx }) => {
    const [members, invitations, roles] = await Promise.all([
      prisma.weddingMember.findMany({ where: { weddingId: ctx.weddingId }, include: { user: { select: { id: true, name: true, email: true, active: true, lastLoginAt: true } }, role: true }, orderBy: { createdAt: "asc" } }),
      prisma.invitation.findMany({ where: { weddingId: ctx.weddingId, acceptedAt: null, revokedAt: null }, include: { role: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
      prisma.role.findMany({ where: { weddingId: ctx.weddingId }, orderBy: [{ system: "desc" }, { name: "asc" }], include: { _count: { select: { members: true } } } }),
    ]);
    return { members, invitations: invitations.map(({ tokenHash: _t, ...i }) => ({ ...i, expired: i.expiresAt < new Date() })), roles };
  }),

  invite: perm("users:create").input(z.object({ email: z.string().email().toLowerCase(), name: z.string().max(120).optional(), roleId: z.string() })).mutation(async ({ ctx, input }) => {
    const role = await prisma.role.findFirst({ where: { id: input.roleId, weddingId: ctx.weddingId } });
    if (!role) throw new TRPCError({ code: "NOT_FOUND", message: "Perfil inválido" });
    // Não permite convidar com mais poder do que se tem (elevação de privilégio)
    const excess = role.permissions.filter((p) => !ctx.permissions.has(p));
    if (excess.length) throw new TRPCError({ code: "FORBIDDEN", message: "Você não pode conceder permissões que não possui" });
    const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
    if (existingUser && (await prisma.weddingMember.findUnique({ where: { weddingId_userId: { weddingId: ctx.weddingId, userId: existingUser.id } } }))) {
      throw new TRPCError({ code: "CONFLICT", message: "Essa pessoa já faz parte do casamento" });
    }
    const token = randomToken();
    await prisma.invitation.updateMany({ where: { weddingId: ctx.weddingId, email: input.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const inv = await prisma.invitation.create({ data: { weddingId: ctx.weddingId, email: input.email, name: input.name, roleId: role.id, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 7 * 86400_000), invitedById: ctx.user.id } });
    const url = `${env().WEB_ORIGIN}/convite/${token}`;
    await sendEmail(input.email, `Convite para o planejamento de ${ctx.wedding.name}`, emailLayout(`Você foi convidado(a)`, `<p>${ctx.user.name} convidou você para ajudar no planejamento de <b>${ctx.wedding.name}</b> como <b>${role.name}</b>.</p><p style="color:#666;font-size:13px">O convite vale por 7 dias.</p>`, { label: "Aceitar convite", url }), `Aceite o convite: ${url}`);
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "create", entityType: "invitation", entityId: inv.id, summary: `Convidou ${input.email} como ${role.name}` });
    return { id: inv.id, url };
  }),

  revokeInvite: perm("users:delete").input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const r = await prisma.invitation.updateMany({ where: { id: input.id, weddingId: ctx.weddingId, acceptedAt: null }, data: { revokedAt: new Date() } });
    if (!r.count) throw new TRPCError({ code: "NOT_FOUND" });
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "revoke", entityType: "invitation", entityId: input.id, summary: "Revogou convite de acesso" });
  }),

  /** Público: dados mínimos do convite para a tela de aceite */
  invitationInfo: publicProcedure.input(z.object({ token: z.string().min(20).max(80) })).query(async ({ ctx, input }) => {
    const inv = await prisma.invitation.findUnique({ where: { tokenHash: tokenHash(input.token) }, include: { wedding: { select: { name: true } }, role: { select: { name: true } } } });
    if (!inv || inv.revokedAt || inv.acceptedAt || inv.expiresAt < new Date()) {
      await securityEvent("invalid_invite_token", { ip: ctx.ip });
      throw new TRPCError({ code: "NOT_FOUND", message: "Convite inválido, expirado ou já utilizado" });
    }
    const hasAccount = !!(await prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } }));
    return { email: inv.email, name: inv.name, wedding: inv.wedding.name, role: inv.role.name, hasAccount };
  }),

  acceptInvitation: authedProcedure.input(z.object({ token: z.string() })).mutation(async ({ ctx, input }) => {
    const inv = await prisma.invitation.findUnique({ where: { tokenHash: tokenHash(input.token) } });
    if (!inv || inv.revokedAt || inv.acceptedAt || inv.expiresAt < new Date()) throw new TRPCError({ code: "NOT_FOUND", message: "Convite inválido ou expirado" });
    if (inv.email.toLowerCase() !== ctx.user.email.toLowerCase()) throw new TRPCError({ code: "FORBIDDEN", message: `Este convite é para ${inv.email}` });
    await prisma.$transaction(async (tx) => {
      const ok = await tx.invitation.updateMany({ where: { id: inv.id, acceptedAt: null }, data: { acceptedAt: new Date() } });
      if (!ok.count) throw new TRPCError({ code: "CONFLICT", message: "Convite já utilizado" });
      await tx.weddingMember.upsert({ where: { weddingId_userId: { weddingId: inv.weddingId, userId: ctx.user.id } }, create: { weddingId: inv.weddingId, userId: ctx.user.id, roleId: inv.roleId, grants: [], revokes: [] }, update: { roleId: inv.roleId, active: true } });
      await tx.user.update({ where: { id: ctx.user.id }, data: { activeWeddingId: inv.weddingId } });
    });
    await audit({ userId: ctx.user.id, userName: ctx.user.name, ip: ctx.ip }, { weddingId: inv.weddingId, action: "accept", entityType: "invitation", entityId: inv.id, summary: `${ctx.user.name} aceitou o convite de acesso` });
  }),

  updateMember: perm("users:edit").input(z.object({ memberId: z.string(), roleId: z.string().optional(), grants: permList.optional(), revokes: permList.optional(), active: z.boolean().optional() })).mutation(async ({ ctx, input }) => {
    const m = await prisma.weddingMember.findFirst({ where: { id: input.memberId, weddingId: ctx.weddingId }, include: { role: true } });
    if (!m) throw new TRPCError({ code: "NOT_FOUND" });
    if (m.userId === ctx.user.id && (input.active === false || input.roleId || input.revokes?.length)) throw new TRPCError({ code: "FORBIDDEN", message: "Você não pode alterar o próprio acesso" });
    const role = input.roleId ? await prisma.role.findFirst({ where: { id: input.roleId, weddingId: ctx.weddingId } }) : m.role;
    if (!role) throw new TRPCError({ code: "NOT_FOUND", message: "Perfil inválido" });
    const granted = [...role.permissions, ...(input.grants ?? m.grants)];
    if (granted.some((p) => !ctx.permissions.has(p))) throw new TRPCError({ code: "FORBIDDEN", message: "Você não pode conceder permissões que não possui" });
    // Sempre deve sobrar ao menos um membro ativo com users:edit
    const updated = await prisma.weddingMember.update({ where: { id: m.id }, data: { roleId: role.id, grants: input.grants ?? m.grants, revokes: input.revokes ?? m.revokes, active: input.active ?? m.active } });
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "update", entityType: "member", entityId: m.id, summary: `Alterou acesso de membro (perfil ${role.name}${input.active === false ? ", desativado" : ""})`, changes: { roleId: { from: m.roleId, to: role.id }, grants: input.grants, revokes: input.revokes, active: input.active } });
    return updated;
  }),

  saveRole: perm("users:edit").input(z.object({ id: z.string().optional(), name: z.string().min(2).max(60), description: z.string().max(300).optional(), permissions: permList })).mutation(async ({ ctx, input }) => {
    if (input.permissions.some((p) => !ctx.permissions.has(p))) throw new TRPCError({ code: "FORBIDDEN", message: "Você não pode conceder permissões que não possui" });
    if (input.id) {
      const r = await prisma.role.findFirst({ where: { id: input.id, weddingId: ctx.weddingId } });
      if (!r) throw new TRPCError({ code: "NOT_FOUND" });
      if (r.key === "ADMIN") throw new TRPCError({ code: "FORBIDDEN", message: "O perfil Administrador não pode ser alterado" });
      await prisma.role.update({ where: { id: r.id }, data: { name: input.name, description: input.description, permissions: input.permissions } });
      await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "update", entityType: "role", entityId: r.id, summary: `Alterou o perfil ${input.name}`, changes: { added: input.permissions.filter((p) => !r.permissions.includes(p)), removed: r.permissions.filter((p) => !(input.permissions as string[]).includes(p)) } });
      return;
    }
    const r = await prisma.role.create({ data: { weddingId: ctx.weddingId, key: `CUSTOM_${Date.now()}`, name: input.name, description: input.description, permissions: input.permissions } });
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "create", entityType: "role", entityId: r.id, summary: `Criou o perfil ${input.name}` });
  }),

  deleteRole: perm("users:delete").input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const r = await prisma.role.findFirst({ where: { id: input.id, weddingId: ctx.weddingId }, include: { _count: { select: { members: true } } } });
    if (!r) throw new TRPCError({ code: "NOT_FOUND" });
    if (r.system) throw new TRPCError({ code: "FORBIDDEN", message: "Perfis padrão não podem ser excluídos" });
    if (r._count.members) throw new TRPCError({ code: "CONFLICT", message: "Há membros usando este perfil" });
    await prisma.role.delete({ where: { id: r.id } });
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "delete", entityType: "role", entityId: r.id, summary: `Excluiu o perfil ${r.name}` });
  }),

  allPermissions: perm("users:view").query(() => ALL_PERMISSIONS),

  /** Sessões do próprio usuário */
  mySessions: authedProcedure.query(async ({ ctx }) => {
    const sessions = await prisma.session.findMany({ where: { userId: ctx.user.id, expiresAt: { gt: new Date() } }, orderBy: { updatedAt: "desc" }, select: { id: true, createdAt: true, updatedAt: true, ipAddress: true, userAgent: true, expiresAt: true, token: true } });
    const current = ctx.session!.session.token;
    return sessions.map(({ token, ...s }) => ({ ...s, current: token === current }));
  }),
  revokeSession: authedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await prisma.session.deleteMany({ where: { id: input.id, userId: ctx.user.id } });
    await audit({ userId: ctx.user.id, userName: ctx.user.name, ip: ctx.ip }, { weddingId: ctx.user.activeWeddingId, action: "revoke", entityType: "session", entityId: input.id, summary: "Encerrou uma sessão" });
  }),
  revokeOtherSessions: authedProcedure.mutation(async ({ ctx }) => {
    await auth.api.revokeOtherSessions({ headers: fromNodeHeaders(ctx.req.headers) });
  }),

  /** Administração da plataforma: ativar/desativar contas */
  setUserActive: superAdminProcedure.input(z.object({ userId: z.string(), active: z.boolean() })).mutation(async ({ ctx, input }) => {
    if (input.userId === ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "Você não pode desativar a si mesmo" });
    const u = await prisma.user.update({ where: { id: input.userId }, data: { active: input.active } });
    if (!input.active) await prisma.session.deleteMany({ where: { userId: u.id } });
    await audit({ userId: ctx.user.id, userName: ctx.user.name, ip: ctx.ip }, { weddingId: null, action: "update", entityType: "user", entityId: u.id, summary: `${input.active ? "Reativou" : "Desativou"} a conta de ${u.email}` });
  }),
});
