import { audit, createWedding, diff, effectivePermissions, MODULES, MODULE_ACTIONS, updateWeddingPhotos, weddingPhotoUrls } from "@casa/core";
import { prisma } from "@casa/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { authedProcedure, perm, router, weddingProcedure } from "../trpc.js";

const weddingInput = z.object({
  name: z.string().trim().min(2).max(120),
  partner1Name: z.string().trim().min(1).max(80),
  partner2Name: z.string().trim().min(1).max(80),
  date: z.date().nullable().optional(),
  timezone: z.string().default("America/Sao_Paulo"),
  city: z.string().max(120).nullable().optional(),
  budgetCents: z.number().int().min(0).default(0),
  estimatedGuests: z.number().int().min(0).max(5000).nullable().optional(),
});

export const weddingRouter = router({
  /** Sessão + casamentos do usuário + permissões efetivas no casamento ativo */
  me: authedProcedure.query(async ({ ctx }) => {
    const memberships = await prisma.weddingMember.findMany({ where: { userId: ctx.user.id, active: true, wedding: { archivedAt: null } }, include: { wedding: true, role: true }, orderBy: { createdAt: "asc" } });
    const active = memberships.find((m) => m.weddingId === (ctx.requestedWeddingId ?? ctx.user.activeWeddingId)) ?? memberships[0] ?? null;
    if (active && active.weddingId !== ctx.user.activeWeddingId) await prisma.user.update({ where: { id: ctx.user.id }, data: { activeWeddingId: active.weddingId } });
    return {
      user: { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email, isSuperAdmin: ctx.user.isSuperAdmin },
      weddings: memberships.map((m) => ({ id: m.weddingId, name: m.wedding.name, date: m.wedding.date, role: m.role.name })),
      active: active
        ? {
            id: active.weddingId, name: active.wedding.name, partner1Name: active.wedding.partner1Name, partner2Name: active.wedding.partner2Name,
            date: active.wedding.date, timezone: active.wedding.timezone, role: active.role.name, roleKey: active.role.key,
            permissions: [...effectivePermissions(active.role, active)],
          }
        : null,
      canCreateWedding: ctx.user.isSuperAdmin || memberships.length === 0,
    };
  }),

  create: authedProcedure.input(weddingInput).mutation(async ({ ctx, input }) => {
    const count = await prisma.weddingMember.count({ where: { userId: ctx.user.id } });
    if (count > 0 && !ctx.user.isSuperAdmin) throw new TRPCError({ code: "FORBIDDEN", message: "Somente o administrador da plataforma pode criar outro casamento" });
    return createWedding({ userId: ctx.user.id, userName: ctx.user.name, ip: ctx.ip, correlationId: ctx.correlationId }, input);
  }),

  switch: authedProcedure.input(z.object({ weddingId: z.string() })).mutation(async ({ ctx, input }) => {
    const m = await prisma.weddingMember.findUnique({ where: { weddingId_userId: { weddingId: input.weddingId, userId: ctx.user.id } } });
    if (!m?.active) throw new TRPCError({ code: "FORBIDDEN" });
    await prisma.user.update({ where: { id: ctx.user.id }, data: { activeWeddingId: input.weddingId } });
  }),

  get: weddingProcedure.query(({ ctx }) => {
    const w = ctx.wedding;
    const finance = ctx.permissions.has("finance:view");
    return { ...w, budgetCents: finance ? w.budgetCents : null };
  }),

  // Sem .default(): no zod 4, partial() ainda aplicaria os padrões e apagaria campos não enviados
  update: perm("settings:edit").input(z.object({
    name: z.string().trim().min(2).max(120).optional(),
    partner1Name: z.string().trim().min(1).max(80).optional(),
    partner2Name: z.string().trim().min(1).max(80).optional(),
    date: z.date().nullable().optional(),
    timezone: z.string().optional(),
    city: z.string().max(120).nullable().optional(),
    budgetCents: z.number().int().min(0).optional(),
    estimatedGuests: z.number().int().min(0).max(5000).nullable().optional(),
  }).extend({
    ceremonyAddress: z.string().max(300).nullable().optional(),
    receptionAddress: z.string().max(300).nullable().optional(),
    maxGuests: z.number().int().min(0).max(5000).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    rsvpDeadline: z.date().nullable().optional(),
    visualPrefs: z.record(z.string(), z.unknown()).optional(),
  })).mutation(async ({ ctx, input }) => {
    if (input.budgetCents !== undefined && !ctx.permissions.has("finance:edit")) throw new TRPCError({ code: "FORBIDDEN", message: "Alterar o orçamento exige finance:edit" });
    const before = ctx.wedding;
    const data = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    const w = await prisma.wedding.update({ where: { id: ctx.weddingId }, data: data as never });
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "update", entityType: "wedding", entityId: w.id, summary: "Atualizou os dados do casamento", changes: diff(before as never, data as never) });
    return w;
  }),

  updatePortal: perm("rsvp:edit").input(z.object({
    portalEnabled: z.boolean(),
    portalSlug: z.string().regex(/^[a-z0-9-]{3,60}$/, "Use letras minúsculas, números e hífens").nullable(),
    rsvpDeadline: z.date().nullable(),
    portalConfig: z.object({
      title: z.string().max(120).optional(), welcome: z.string().max(3000).optional(), arrivalInfo: z.string().max(3000).optional(), dressCode: z.string().max(300).optional(),
      mapUrl: z.string().url().max(500).optional().or(z.literal("")), giftInfo: z.string().max(3000).optional(), giftUrl: z.string().url().max(500).optional().or(z.literal("")),
      closingMessage: z.string().max(1000).optional(), accentColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), extraInfo: z.string().max(3000).optional(),
      showCeremony: z.boolean().optional(), showReception: z.boolean().optional(),
    }),
  })).mutation(async ({ ctx, input }) => {
    if (input.portalSlug) {
      const taken = await prisma.wedding.findFirst({ where: { portalSlug: input.portalSlug, id: { not: ctx.weddingId } } });
      if (taken) throw new TRPCError({ code: "CONFLICT", message: "Endereço já em uso" });
    }
    await prisma.wedding.update({ where: { id: ctx.weddingId }, data: input });
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "update", entityType: "portal", entityId: ctx.weddingId, summary: `Atualizou o portal dos convidados (${input.portalEnabled ? "ativo" : "desativado"})` });
  }),

  /** Fotos do casal (URLs temporárias). Qualquer membro vê; editar exige settings:edit */
  photos: weddingProcedure.query(({ ctx }) => weddingPhotoUrls(ctx.wedding)),
  updatePhotos: perm("settings:edit").input(z.object({
    coverFileId: z.string().nullable().optional(),
    coverPosition: z.string().max(20).optional(),
    partner1PhotoFileId: z.string().nullable().optional(),
    partner2PhotoFileId: z.string().nullable().optional(),
    portalGalleryFileIds: z.array(z.string()).max(24).optional(),
  })).mutation(({ ctx, input }) => updateWeddingPhotos(ctx.svc, input).then(() => undefined)),

  permissionCatalog: weddingProcedure.query(() => ({ modules: MODULES, moduleActions: MODULE_ACTIONS })),
});
