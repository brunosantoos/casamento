import { portalGiftClick, portalStorePurchase } from "@casa/core";
import { z } from "zod";
import { portalPhotoStatus } from "@casa/core";
import { publicProcedure, router } from "../trpc.js";

import { portalGiftList, portalPixCode, portalPledge } from "@casa/core";

const identity = z.object({ token: z.string().min(20).max(80).optional(), slug: z.string().regex(/^[a-z0-9-]{3,60}$/).optional() }).refine((v) => !!v.token !== !!v.slug, "Informe o link ou a página");

/** Rotas públicas extras do portal (presentes e fotos). Prefixo "portal" → limite por IP no index.ts */
export const portalGiftsRouter = router({
  list: publicProcedure.input(identity).query(({ input }) => portalGiftList(input)),
  pixCode: publicProcedure.input(identity.and(z.object({ itemId: z.string().nullable().optional(), amountCents: z.number().int().min(1).max(10_000_000).nullable().optional(), quotas: z.number().int().min(1).max(1000).nullable().optional() }))).mutation(({ input }) => portalPixCode(input, input)),
  /** Abre o produto na loja (conta o clique; aplica a tag de afiliado) */
  click: publicProcedure.input(identity.and(z.object({ itemId: z.string() }))).mutation(({ input }) => portalGiftClick(input, input.itemId)),
  /** "Já comprei" na loja */
  purchased: publicProcedure.input(identity.and(z.object({
    itemId: z.string(), quantity: z.number().int().min(1).max(20).nullable().optional(), giverName: z.string().trim().min(2).max(120),
    message: z.string().max(1000).nullable().optional(), submissionKey: z.string().min(8).max(64), website: z.string().max(0).optional(),
  }))).mutation(({ ctx, input }) => portalStorePurchase(input, input, { ip: ctx.ip })),
  pledge: publicProcedure.input(identity.and(z.object({
    itemId: z.string().nullable().optional(), amountCents: z.number().int().min(1).max(10_000_000).nullable().optional(), quotas: z.number().int().min(1).max(1000).nullable().optional(),
    giverName: z.string().trim().min(2).max(120), message: z.string().max(1000).nullable().optional(), submissionKey: z.string().min(8).max(64),
    // Campo-isca: robôs preenchem, pessoas não veem
    website: z.string().max(0).optional(),
  }))).mutation(({ ctx, input }) => portalPledge(input, input, { ip: ctx.ip })),
});
/** Fotos dos convidados: situação do envio da família do link e mural de aprovadas (se o casal ativar) */
export const portalPhotosRouter = router({
  status: publicProcedure.input(z.object({ token: z.string().min(20).max(80) })).query(({ input }) => portalPhotoStatus(input.token)),
});
