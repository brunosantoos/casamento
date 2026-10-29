import {
  audit, cancelCampaign, confirmCampaign, connectInstance, createCampaign, disconnectInstance, evolution, evolutionConfig, previewCampaign, refreshInstanceState, retryMessage, sendSingle, TEMPLATE_VARS,
} from "@casa/core";
import { prisma } from "@casa/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { perm, router } from "../trpc.js";

const criteria = z.object({
  rsvp: z.array(z.enum(["PENDING", "ACCEPTED", "DECLINED"])).optional(),
  inviteStatus: z.array(z.enum(["NOT_SENT", "SENT", "DELIVERED", "OPENED"])).optional(),
  groupIds: z.array(z.string()).max(2000).optional(),
  side: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  perFamily: z.boolean().optional(),
});

export const whatsappRouter = router({
  status: perm("whatsapp:view").query(async ({ ctx }) => {
    const inst = await refreshInstanceState(ctx.weddingId);
    let configured = true;
    try {
      await evolutionConfig(ctx.weddingId);
    } catch {
      configured = false;
    }
    return { configured, instance: inst ? { state: inst.state, profileName: inst.profileName, ownerJid: inst.ownerJid, qr: inst.lastQr, error: (inst as { error?: string }).error ?? null } : null };
  }),
  testConnection: perm("integrations:edit").mutation(async ({ ctx }) => {
    const cfg = await evolutionConfig(ctx.weddingId);
    try {
      const info = await evolution.info(cfg);
      return { ok: true, version: info.version ?? null, message: info.message ?? null };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }),
  connect: perm("integrations:edit").mutation(({ ctx }) => connectInstance(ctx.svc)),
  disconnect: perm("integrations:edit").mutation(({ ctx }) => disconnectInstance(ctx.svc)),

  // ───── Modelos
  templates: perm("whatsapp:view").query(({ ctx }) => prisma.messageTemplate.findMany({ where: { weddingId: ctx.weddingId }, orderBy: { name: "asc" } })),
  templateVars: perm("whatsapp:view").query(() => TEMPLATE_VARS),
  saveTemplate: perm("whatsapp:create").input(z.object({ id: z.string().optional(), name: z.string().min(2).max(100), body: z.string().min(2).max(4000), purpose: z.enum(["INVITE", "REMINDER", "INFO", "VENDOR", "TASK", "OTHER"]) })).mutation(async ({ ctx, input }) => {
    const { id, ...data } = input;
    if (id) {
      const r = await prisma.messageTemplate.updateMany({ where: { id, weddingId: ctx.weddingId }, data });
      if (!r.count) throw new TRPCError({ code: "NOT_FOUND" });
      await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "update", entityType: "template", entityId: id, summary: `Editou modelo "${data.name}"` });
      return;
    }
    const t = await prisma.messageTemplate.create({ data: { ...data, weddingId: ctx.weddingId, key: `custom-${Date.now()}` } });
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "create", entityType: "template", entityId: t.id, summary: `Criou modelo "${t.name}"` });
  }),
  deleteTemplate: perm("whatsapp:create").input(z.object({ id: z.string() })).mutation(({ ctx, input }) => prisma.messageTemplate.deleteMany({ where: { id: input.id, weddingId: ctx.weddingId } })),

  // ───── Campanhas: rascunho → prévia → confirmação explícita
  preview: perm("whatsapp:view").input(z.object({ body: z.string().min(1).max(4000), criteria })).query(({ ctx, input }) => previewCampaign(ctx.svc, input)),
  createCampaign: perm("whatsapp:create").input(z.object({ name: z.string().min(2).max(120), body: z.string().min(2).max(4000), templateId: z.string().nullable().optional(), criteria })).mutation(({ ctx, input }) => createCampaign(ctx.svc, input)),
  confirmCampaign: perm("whatsapp:approve").input(z.object({ id: z.string() })).mutation(({ ctx, input }) => confirmCampaign(ctx.svc, input.id)),
  cancelCampaign: perm("whatsapp:approve").input(z.object({ id: z.string() })).mutation(({ ctx, input }) => cancelCampaign(ctx.svc, input.id)),
  campaigns: perm("whatsapp:view").query(async ({ ctx }) => {
    const list = await prisma.messageCampaign.findMany({ where: { weddingId: ctx.weddingId }, orderBy: { createdAt: "desc" }, take: 100 });
    const counts = await prisma.outboundMessage.groupBy({ by: ["campaignId", "status"], where: { weddingId: ctx.weddingId, campaignId: { in: list.map((c) => c.id) } }, _count: true });
    return list.map((c) => ({ ...c, counts: Object.fromEntries(counts.filter((x) => x.campaignId === c.id).map((x) => [x.status, x._count])) as Record<string, number> }));
  }),
  campaign: perm("whatsapp:view").input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const c = await prisma.messageCampaign.findFirst({ where: { id: input.id, weddingId: ctx.weddingId }, include: { messages: { orderBy: { createdAt: "asc" }, include: { guest: { select: { fullName: true } } } } } });
    if (!c) throw new TRPCError({ code: "NOT_FOUND" });
    return c;
  }),

  // ───── Mensagens
  messages: perm("whatsapp:view").input(z.object({ status: z.enum(["PENDING", "SENDING", "ACCEPTED", "DELIVERED", "READ", "REPLIED", "FAILED", "CANCELLED"]).optional(), search: z.string().optional(), cursor: z.string().optional() }).optional()).query(async ({ ctx, input }) => {
    const items = await prisma.outboundMessage.findMany({
      where: { weddingId: ctx.weddingId, ...(input?.status ? { status: input.status } : {}), ...(input?.search ? { OR: [{ toNumber: { contains: input.search.replace(/\D/g, "") || "§" } }, { guest: { fullName: { contains: input.search, mode: "insensitive" } } }] } : {}) },
      include: { guest: { select: { id: true, fullName: true } }, campaign: { select: { id: true, name: true } }, attemptsLog: { orderBy: { createdAt: "desc" }, take: 5 } },
      orderBy: { createdAt: "desc" }, take: 51, ...(input?.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    return { items: items.slice(0, 50), nextCursor: items.length > 50 ? items[49]!.id : null };
  }),
  inbound: perm("whatsapp:view").input(z.object({ number: z.string().optional() }).optional()).query(({ ctx, input }) =>
    prisma.inboundMessage.findMany({ where: { weddingId: ctx.weddingId, ...(input?.number ? { fromNumber: input.number } : {}) }, orderBy: { receivedAt: "desc" }, take: 100 }),
  ),
  /** Conversa com um número (enviadas + recebidas) */
  thread: perm("whatsapp:view").input(z.object({ number: z.string() })).query(async ({ ctx, input }) => {
    const [out, inc] = await Promise.all([
      prisma.outboundMessage.findMany({ where: { weddingId: ctx.weddingId, toNumber: input.number }, orderBy: { createdAt: "asc" }, take: 200 }),
      prisma.inboundMessage.findMany({ where: { weddingId: ctx.weddingId, fromNumber: input.number }, orderBy: { receivedAt: "asc" }, take: 200 }),
    ]);
    return [...out.map((m) => ({ dir: "out" as const, id: m.id, body: m.body, at: m.sentAt ?? m.createdAt, status: m.status })), ...inc.map((m) => ({ dir: "in" as const, id: m.id, body: m.body ?? "[mídia]", at: m.receivedAt, status: null }))].sort((a, b) => a.at.getTime() - b.at.getTime());
  }),
  sendSingle: perm("whatsapp:approve").input(z.object({ to: z.string().min(8).max(30), body: z.string().min(1).max(4000), guestId: z.string().nullable().optional(), vendorId: z.string().nullable().optional(), idempotencyKey: z.string().min(8).max(80) })).mutation(({ ctx, input }) => sendSingle(ctx.svc, input)),
  retry: perm("whatsapp:approve").input(z.object({ id: z.string() })).mutation(({ ctx, input }) => retryMessage(ctx.svc, input.id)),
  stats: perm("whatsapp:view").query(async ({ ctx }) => {
    const g = await prisma.outboundMessage.groupBy({ by: ["status"], where: { weddingId: ctx.weddingId }, _count: true });
    return Object.fromEntries(g.map((x) => [x.status, x._count])) as Record<string, number>;
  }),
  webhookEvents: perm("integrations:view").query(({ ctx }) => prisma.webhookEvent.findMany({ where: { instance: { weddingId: ctx.weddingId } }, orderBy: { receivedAt: "desc" }, take: 50, select: { id: true, event: true, receivedAt: true, processedAt: true, error: true } })),
});
