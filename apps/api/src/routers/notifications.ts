import { NOTIFY_EVENTS, prefEnabled, sendPushToUser, vapidKeys, type NotifyEvent } from "@casa/core";
import { prisma, type Prisma } from "@casa/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { authedProcedure, router, weddingProcedure } from "../trpc.js";

const EVENTS = Object.keys(NOTIFY_EVENTS) as [NotifyEvent, ...NotifyEvent[]];

export const notificationsRouter = router({
  vapidPublicKey: authedProcedure.query(async () => (await vapidKeys()).publicKey),

  subscribe: authedProcedure.input(z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().min(10).max(300), auth: z.string().min(8).max(100) }) })).mutation(async ({ ctx, input }) => {
    // Endpoint de outro usuário (aparelho compartilhado) passa a ser deste
    await prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: { userId: ctx.user.id, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: ctx.userAgent?.slice(0, 300) ?? null },
      update: { userId: ctx.user.id, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: ctx.userAgent?.slice(0, 300) ?? null },
    });
  }),
  unsubscribe: authedProcedure.input(z.object({ endpoint: z.string().optional(), id: z.string().optional() })).mutation(async ({ ctx, input }) => {
    if (!input.endpoint && !input.id) throw new TRPCError({ code: "BAD_REQUEST" });
    await prisma.pushSubscription.deleteMany({ where: { userId: ctx.user.id, ...(input.endpoint ? { endpoint: input.endpoint } : { id: input.id }) } });
  }),
  mySubscriptions: authedProcedure.query(({ ctx }) =>
    prisma.pushSubscription.findMany({ where: { userId: ctx.user.id }, orderBy: { createdAt: "desc" }, select: { id: true, endpoint: true, userAgent: true, createdAt: true, lastUsedAt: true } }),
  ),

  /** Preferências da pessoa no casamento ativo (com o que ela pode receber pelas permissões) */
  prefs: weddingProcedure.query(({ ctx }) =>
    EVENTS.map((e) => ({ event: e, ...NOTIFY_EVENTS[e], enabled: prefEnabled(ctx.member.notificationPrefs, e), allowed: NOTIFY_EVENTS[e].permissions.some((p) => ctx.permissions.has(p)) })),
  ),
  setPref: weddingProcedure.input(z.object({ event: z.enum(EVENTS), enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
    const prefs = { ...((ctx.member.notificationPrefs ?? {}) as Record<string, boolean>), [input.event]: input.enabled };
    await prisma.weddingMember.update({ where: { id: ctx.member.id }, data: { notificationPrefs: prefs as Prisma.InputJsonValue } });
  }),

  test: authedProcedure.mutation(async ({ ctx }) => {
    try {
      const r = await sendPushToUser(ctx.user.id, { title: "Notificações ativadas 💍", body: "Tudo certo! Você vai receber os avisos do casamento aqui.", url: "/conta", tag: "test" });
      if (!r.sent) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Nenhum aparelho com notificações ativas" });
      return r;
    } catch (e) {
      if (e instanceof TRPCError) throw e;
      throw new TRPCError({ code: "BAD_GATEWAY", message: (e as Error).message });
    }
  }),

  inbox: weddingProcedure.query(({ ctx }) => prisma.notificationLog.findMany({ where: { userId: ctx.user.id, weddingId: ctx.weddingId }, orderBy: { createdAt: "desc" }, take: 50 })),
  unreadCount: weddingProcedure.query(({ ctx }) => prisma.notificationLog.count({ where: { userId: ctx.user.id, weddingId: ctx.weddingId, readAt: null } })),
  markRead: weddingProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => prisma.notificationLog.updateMany({ where: { id: input.id, userId: ctx.user.id, readAt: null }, data: { readAt: new Date() } }).then(() => undefined)),
  markAllRead: weddingProcedure.mutation(({ ctx }) => prisma.notificationLog.updateMany({ where: { userId: ctx.user.id, weddingId: ctx.weddingId, readAt: null }, data: { readAt: new Date() } }).then(() => undefined)),
});
