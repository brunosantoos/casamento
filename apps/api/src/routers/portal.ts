import { portalView, submitRsvp, weddingPhotoUrls } from "@casa/core";
import { prisma } from "@casa/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../trpc.js";

/** Portal público: sem sessão, por token aleatório (limite por IP aplicado no index.ts) */
export const portalRouter = router({
  view: publicProcedure.input(z.object({ token: z.string().min(20).max(80) })).query(({ input }) => portalView(input.token)),

  submit: publicProcedure.input(z.object({
    token: z.string().min(20).max(80),
    submissionKey: z.string().min(8).max(64),
    message: z.string().max(1000).nullable().optional(),
    // Campo-isca: robôs preenchem, pessoas não veem
    website: z.string().max(0).optional(),
    responses: z.array(z.object({
      guestId: z.string(), status: z.enum(["ACCEPTED", "DECLINED"]), dietary: z.string().max(500).nullable().optional(),
      companions: z.array(z.object({ name: z.string().max(120).nullable().optional(), isChild: z.boolean().optional(), dietary: z.string().max(300).nullable().optional() })).max(10),
    })).min(1).max(30),
  })).mutation(({ ctx, input }) => submitRsvp(input.token, input, { ip: ctx.ip, userAgent: ctx.userAgent })),

  /** Página informativa pública (sem lista de convidados) */
  page: publicProcedure.input(z.object({ slug: z.string().regex(/^[a-z0-9-]{3,60}$/) })).query(async ({ input }) => {
    const w = await prisma.wedding.findUnique({ where: { portalSlug: input.slug } });
    if (!w || !w.portalEnabled || w.archivedAt) throw new TRPCError({ code: "NOT_FOUND", message: "Página não encontrada" });
    const cfg = (w.portalConfig ?? {}) as Record<string, unknown>;
    return {
      partner1Name: w.partner1Name, partner2Name: w.partner2Name, date: w.date, timezone: w.timezone, city: w.city,
      ceremonyAddress: cfg.showCeremony === false ? null : w.ceremonyAddress, receptionAddress: cfg.showReception === false ? null : w.receptionAddress, rsvpDeadline: w.rsvpDeadline, config: cfg,
      photos: await weddingPhotoUrls(w),
    };
  }),
});
