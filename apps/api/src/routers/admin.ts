import { AI_PROVIDERS, allSettings, audit, integrationView, resetSetting, saveIntegration, setSetting, testAi, readSecret, type AiProvider } from "@casa/core";
import { prisma, type Prisma } from "@casa/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { perm, router, superAdminProcedure } from "../trpc.js";

export const settingsRouter = router({
  list: perm("settings:view").query(({ ctx }) => allSettings(ctx.weddingId)),
  set: perm("settings:edit").input(z.object({ key: z.string(), value: z.unknown() })).mutation(async ({ ctx, input }) => {
    try {
      await setSetting(ctx.weddingId, input.key, input.value, ctx.svc.actor);
    } catch (e) {
      throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof z.ZodError ? "Valor inválido" : (e as Error).message });
    }
  }),
  reset: perm("settings:edit").input(z.object({ key: z.string() })).mutation(({ ctx, input }) => resetSetting(ctx.weddingId, input.key, ctx.svc.actor)),
  history: perm("settings:view").input(z.object({ key: z.string().optional() }).optional()).query(async ({ ctx, input }) => {
    const rows = await prisma.settingChange.findMany({ where: { scope: ctx.weddingId, ...(input?.key ? { key: input.key } : {}) }, orderBy: { createdAt: "desc" }, take: 100 });
    const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
    return rows.map((r) => ({ ...r, userName: users.find((u) => u.id === r.userId)?.name ?? null }));
  }),

  // ───── Integrações: só o servidor vê os segredos; o front recebe apenas "definido" + 4 últimos caracteres
  integrations: perm("integrations:view").query(async ({ ctx }) => ({
    evolution: await integrationView(ctx.weddingId, "EVOLUTION"),
    ai: await integrationView(ctx.weddingId, "AI"),
    aiProviders: AI_PROVIDERS,
  })),
  saveEvolution: perm("integrations:edit").input(z.object({ enabled: z.boolean(), baseUrl: z.string().url(), webhookBaseUrl: z.string().url().or(z.literal("")).optional(), apiKey: z.string().min(8).max(500).nullable().optional() })).mutation(({ ctx, input }) =>
    saveIntegration(ctx.svc.actor, ctx.weddingId, "EVOLUTION", { enabled: input.enabled, config: { baseUrl: input.baseUrl, webhookBaseUrl: input.webhookBaseUrl || null }, secrets: input.apiKey === undefined ? {} : { apiKey: input.apiKey } }).then(() => undefined),
  ),
  saveAi: perm("integrations:edit").input(z.object({ enabled: z.boolean(), provider: z.enum(Object.keys(AI_PROVIDERS) as [AiProvider, ...AiProvider[]]), model: z.string().min(2).max(100), baseUrl: z.string().url().or(z.literal("")).optional(), apiKey: z.string().min(8).max(500).nullable().optional() })).mutation(({ ctx, input }) =>
    saveIntegration(ctx.svc.actor, ctx.weddingId, "AI", { enabled: input.enabled, config: { provider: input.provider, model: input.model, baseUrl: input.baseUrl || null }, secrets: input.apiKey === undefined ? {} : { apiKey: input.apiKey } }).then(() => undefined),
  ),
  testAi: perm("integrations:edit").mutation(async ({ ctx }) => {
    const v = await integrationView(ctx.weddingId, "AI");
    const apiKey = await readSecret(ctx.weddingId, "AI", "apiKey");
    if (!apiKey) return { ok: false, error: "Chave não cadastrada" };
    try {
      const text = await testAi({ provider: v.config.provider as AiProvider, model: String(v.config.model), baseUrl: (v.config.baseUrl as string) || null, apiKey });
      return { ok: true, text };
    } catch (e) {
      return { ok: false, error: (e as Error).message.slice(0, 300) };
    }
  }),
});

export const auditRouter = router({
  list: perm("audit:view").input(z.object({ entityType: z.string().optional(), action: z.string().optional(), userId: z.string().optional(), origin: z.string().optional(), from: z.date().optional(), to: z.date().optional(), search: z.string().optional(), cursor: z.string().optional() }).optional()).query(async ({ ctx, input }) => {
    const where: Prisma.AuditLogWhereInput = {
      weddingId: ctx.weddingId,
      ...(input?.entityType ? { entityType: input.entityType } : {}), ...(input?.action ? { action: input.action } : {}), ...(input?.userId ? { userId: input.userId } : {}), ...(input?.origin ? { origin: input.origin } : {}),
      createdAt: { gte: input?.from, lte: input?.to },
      ...(input?.search ? { summary: { contains: input.search, mode: "insensitive" } } : {}),
    };
    const items = await prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 101, ...(input?.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}) });
    return { items: items.slice(0, 100), nextCursor: items.length > 100 ? items[99]!.id : null };
  }),
  facets: perm("audit:view").query(async ({ ctx }) => {
    const [types, actions, users] = await Promise.all([
      prisma.auditLog.groupBy({ by: ["entityType"], where: { weddingId: ctx.weddingId }, _count: true }),
      prisma.auditLog.groupBy({ by: ["action"], where: { weddingId: ctx.weddingId }, _count: true }),
      prisma.auditLog.groupBy({ by: ["userId", "userName"], where: { weddingId: ctx.weddingId, userId: { not: null } }, _count: true }),
    ]);
    return { types: types.map((t) => t.entityType), actions: actions.map((a) => a.action), users: users.map((u) => ({ id: u.userId!, name: u.userName })) };
  }),
  security: perm("audit:view").query(({ ctx }) => prisma.securityEvent.findMany({ where: { OR: [{ weddingId: ctx.weddingId }, { userId: ctx.user.id }] }, orderBy: { createdAt: "desc" }, take: 100 })),
  backups: superAdminProcedure.query(() => prisma.backupExecution.findMany({ orderBy: { startedAt: "desc" }, take: 30 }).then((r) => r.map((b) => ({ ...b, sizeBytes: b.sizeBytes ? Number(b.sizeBytes) : null })))),
});

/** LGPD: consulta/exportação, correção (pelas telas normais) e exclusão/anonimização de dados pessoais */
export const privacyRouter = router({
  requests: perm("guests:view").query(({ ctx }) => prisma.dataDeletionRequest.findMany({ where: { weddingId: ctx.weddingId }, orderBy: { createdAt: "desc" } })),
  exportGuest: perm("guests:export").input(z.object({ guestId: z.string() })).mutation(async ({ ctx, input }) => {
    const g = await prisma.guest.findFirst({ where: { id: input.guestId, weddingId: ctx.weddingId }, include: { companions: true, rsvps: true, group: { select: { name: true } } } });
    if (!g) throw new TRPCError({ code: "NOT_FOUND" });
    const messages = await prisma.outboundMessage.findMany({ where: { weddingId: ctx.weddingId, guestId: g.id }, select: { body: true, status: true, createdAt: true, toNumber: true } });
    const inbound = await prisma.inboundMessage.findMany({ where: { weddingId: ctx.weddingId, guestIds: { has: g.id } }, select: { body: true, receivedAt: true, fromNumber: true } });
    await prisma.dataExportRequest.create({ data: { weddingId: ctx.weddingId, requestedById: ctx.user.id, subjectType: "guest", subjectId: g.id } });
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "export", entityType: "guest", entityId: g.id, summary: `Exportou dados pessoais de ${g.fullName} (LGPD)` });
    return { geradoEm: new Date(), titular: g, mensagensEnviadas: messages, mensagensRecebidas: inbound };
  }),
  requestDeletion: perm("guests:delete").input(z.object({ guestId: z.string(), reason: z.string().max(500).optional() })).mutation(async ({ ctx, input }) => {
    const g = await prisma.guest.findFirst({ where: { id: input.guestId, weddingId: ctx.weddingId } });
    if (!g) throw new TRPCError({ code: "NOT_FOUND" });
    const r = await prisma.dataDeletionRequest.create({ data: { weddingId: ctx.weddingId, requestedById: ctx.user.id, subjectType: "guest", subjectId: g.id, reason: input.reason } });
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "create", entityType: "deletionRequest", entityId: r.id, summary: `Registrou pedido de exclusão de dados de ${g.fullName}` });
    return r;
  }),
  /** Anonimiza: remove dados pessoais mantendo contagens/histórico estatístico */
  executeDeletion: perm("guests:delete", "settings:edit").input(z.object({ requestId: z.string() })).mutation(async ({ ctx, input }) => {
    const r = await prisma.dataDeletionRequest.findFirst({ where: { id: input.requestId, weddingId: ctx.weddingId, status: "PENDING" } });
    if (!r) throw new TRPCError({ code: "NOT_FOUND" });
    await prisma.$transaction(async (tx) => {
      const g = await tx.guest.findFirst({ where: { id: r.subjectId, weddingId: ctx.weddingId } });
      if (g) {
        await tx.guest.update({ where: { id: g.id }, data: { fullName: "Convidado removido (LGPD)", phone: null, email: null, dietary: null, accessibility: null, notes: null, relation: null, deletedAt: new Date() } });
        await tx.guestCompanion.updateMany({ where: { guestId: g.id }, data: { name: null, dietary: null } });
        await tx.rsvp.updateMany({ where: { guestId: g.id }, data: { ip: null, userAgent: null, message: null } });
        await tx.outboundMessage.updateMany({ where: { guestId: g.id }, data: { body: "[removido]", toNumber: "0" } });
        await tx.inboundMessage.updateMany({ where: { weddingId: ctx.weddingId, guestIds: { has: g.id } }, data: { body: "[removido]", pushName: null } });
      }
      await tx.dataDeletionRequest.update({ where: { id: r.id }, data: { status: "DONE", resolvedAt: new Date(), resolution: "Dados pessoais anonimizados" } });
      await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "anonymize", entityType: "guest", entityId: r.subjectId, summary: "Executou exclusão de dados pessoais (anonimização)" }, tx);
    });
  }),
  rejectDeletion: perm("guests:delete").input(z.object({ requestId: z.string(), resolution: z.string().min(3).max(500) })).mutation(async ({ ctx, input }) => {
    await prisma.dataDeletionRequest.updateMany({ where: { id: input.requestId, weddingId: ctx.weddingId, status: "PENDING" }, data: { status: "REJECTED", resolvedAt: new Date(), resolution: input.resolution } });
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "reject", entityType: "deletionRequest", entityId: input.requestId, summary: `Recusou pedido de exclusão: ${input.resolution}` });
  }),
});
