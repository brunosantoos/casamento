import { AI_PROVIDERS, askAssistant, decideProposal } from "@casa/core";
import { prisma } from "@casa/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { perm, router } from "../trpc.js";

export const aiRouter = router({
  conversations: perm("ai:view").query(({ ctx }) => prisma.aIConversation.findMany({ where: { weddingId: ctx.weddingId, userId: ctx.user.id }, orderBy: { updatedAt: "desc" }, take: 50 })),
  conversation: perm("ai:view").input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const c = await prisma.aIConversation.findFirst({ where: { id: input.id, weddingId: ctx.weddingId, userId: ctx.user.id }, include: { messages: { orderBy: { createdAt: "asc" } }, proposals: { orderBy: { createdAt: "asc" } } } });
    if (!c) throw new TRPCError({ code: "NOT_FOUND" });
    return c;
  }),
  deleteConversation: perm("ai:view").input(z.object({ id: z.string() })).mutation(({ ctx, input }) => prisma.aIConversation.deleteMany({ where: { id: input.id, weddingId: ctx.weddingId, userId: ctx.user.id } })),
  ask: perm("ai:view").input(z.object({ conversationId: z.string().nullable().optional(), message: z.string().trim().min(1).max(4000), mode: z.enum(["general", "finance"]).optional() })).mutation(({ ctx, input }) => askAssistant(ctx.svc, input)),

  proposals: perm("ai:view").input(z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED", "EXECUTED", "FAILED"]).optional() }).optional()).query(({ ctx, input }) =>
    prisma.aIActionProposal.findMany({ where: { weddingId: ctx.weddingId, ...(input?.status ? { status: input.status } : {}) }, orderBy: { createdAt: "desc" }, take: 100 }),
  ),
  decide: perm("ai:approve").input(z.object({ id: z.string(), decision: z.enum(["approve", "reject"]) })).mutation(({ ctx, input }) => decideProposal(ctx.svc, input.id, input.decision)),

  usage: perm("ai:view").query(async ({ ctx }) => {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const u = await prisma.aIUsage.groupBy({ by: ["feature"], where: { weddingId: ctx.weddingId, createdAt: { gte: start } }, _sum: { inputTokens: true, outputTokens: true }, _count: true });
    return u.map((x) => ({ feature: x.feature, calls: x._count, inputTokens: x._sum.inputTokens ?? 0, outputTokens: x._sum.outputTokens ?? 0 }));
  }),
  providers: perm("ai:view").query(() => AI_PROVIDERS),
});
