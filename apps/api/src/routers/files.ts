import { audit, deleteFile, fileUrl, requestAnalysis, restoreFile } from "@casa/core";
import { prisma, type Prisma } from "@casa/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { perm, router, weddingProcedure } from "../trpc.js";

const GALLERY = ["PHOTO", "INSPIRATION"];

export const filesRouter = router({
  list: perm("documents:view").input(z.object({ category: z.string().optional(), entityType: z.string().optional(), entityId: z.string().optional(), search: z.string().optional(), deleted: z.boolean().optional() }).optional()).query(({ ctx, input }) => {
    const where: Prisma.FileAssetWhereInput = {
      weddingId: ctx.weddingId, deletedAt: input?.deleted ? { not: null } : null,
      ...(input?.category ? { category: input.category } : {}), ...(input?.entityType ? { entityType: input.entityType } : {}), ...(input?.entityId ? { entityId: input.entityId } : {}),
      ...(input?.search ? { OR: [{ originalName: { contains: input.search, mode: "insensitive" } }, { description: { contains: input.search, mode: "insensitive" } }] } : {}),
    };
    // Comprovantes financeiros só para quem vê o financeiro
    if (!ctx.permissions.has("finance:view")) where.category = input?.category && input.category !== "RECEIPT" ? input.category : { not: "RECEIPT" };
    return prisma.fileAsset.findMany({ where, orderBy: { createdAt: "desc" }, take: 300, select: { id: true, originalName: true, mimeType: true, size: true, category: true, description: true, version: true, entityType: true, entityId: true, uploadedById: true, createdAt: true, deletedAt: true, sha256: true, analyses: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true } } } });
  }),

  get: weddingProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const f = await prisma.fileAsset.findFirst({ where: { id: input.id, weddingId: ctx.weddingId }, include: { versions: { orderBy: { version: "desc" } } } });
    if (!f) throw new TRPCError({ code: "NOT_FOUND" });
    const need = GALLERY.includes(f.category) ? "gallery:view" : f.category === "RECEIPT" ? "finance:view" : "documents:view";
    if (!ctx.permissions.has(need)) throw new TRPCError({ code: "FORBIDDEN" });
    const users = await prisma.user.findMany({ where: { id: { in: [f.uploadedById, ...f.versions.map((v) => v.createdById)].filter((x): x is string => !!x) } }, select: { id: true, name: true } });
    const { storageKey: _k, versions, ...rest } = f;
    return { ...rest, versions: versions.map(({ storageKey: _s, ...v }) => v), users: Object.fromEntries(users.map((u) => [u.id, u.name])) };
  }),

  /** URL temporária (5 min). Confere permissão pela categoria do arquivo. */
  url: weddingProcedure.input(z.object({ id: z.string(), inline: z.boolean().optional(), version: z.number().int().optional() })).mutation(async ({ ctx, input }) => {
    const f = await prisma.fileAsset.findFirst({ where: { id: input.id, weddingId: ctx.weddingId, deletedAt: null }, select: { category: true, originalName: true } });
    if (!f) throw new TRPCError({ code: "NOT_FOUND" });
    const need = GALLERY.includes(f.category) ? "gallery:view" : f.category === "RECEIPT" ? "finance:view" : "documents:view";
    if (!ctx.permissions.has(need)) throw new TRPCError({ code: "FORBIDDEN" });
    if (!input.inline) await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "download", entityType: "file", entityId: input.id, summary: `Baixou "${f.originalName}"` });
    return { url: await fileUrl(ctx.svc, input.id, input) };
  }),

  /** Várias miniaturas de uma vez (galeria) */
  thumbs: perm("gallery:view").input(z.object({ ids: z.array(z.string()).max(200) })).query(async ({ ctx, input }) => {
    const files = await prisma.fileAsset.findMany({ where: { id: { in: input.ids }, weddingId: ctx.weddingId, deletedAt: null, mimeType: { startsWith: "image/" } }, select: { id: true } });
    return Object.fromEntries(await Promise.all(files.map(async (f) => [f.id, await fileUrl(ctx.svc, f.id, { inline: true })] as const)));
  }),

  update: perm("documents:edit").input(z.object({ id: z.string(), category: z.string().optional(), description: z.string().max(1000).nullable().optional(), entityType: z.string().nullable().optional(), entityId: z.string().nullable().optional() })).mutation(async ({ ctx, input }) => {
    const { id, ...data } = input;
    const r = await prisma.fileAsset.updateMany({ where: { id, weddingId: ctx.weddingId }, data });
    if (!r.count) throw new TRPCError({ code: "NOT_FOUND" });
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "update", entityType: "file", entityId: id, summary: "Alterou classificação/vínculo de arquivo", changes: data });
  }),
  delete: perm("documents:delete").input(z.object({ id: z.string() })).mutation(({ ctx, input }) => deleteFile(ctx.svc, input.id)),
  restore: perm("documents:delete").input(z.object({ id: z.string() })).mutation(({ ctx, input }) => restoreFile(ctx.svc, input.id)),

  // ───── Análise por IA
  analyze: perm("ai:create", "documents:view").input(z.object({ fileId: z.string() })).mutation(({ ctx, input }) => requestAnalysis(ctx.svc, input.fileId)),
  analysis: perm("documents:view").input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const a = await prisma.documentAnalysis.findFirst({ where: { id: input.id, weddingId: ctx.weddingId }, include: { findings: { orderBy: { sortOrder: "asc" } }, file: { select: { id: true, originalName: true } } } });
    if (!a) throw new TRPCError({ code: "NOT_FOUND" });
    const { extractedText, ...rest } = a;
    return { ...rest, textPreview: extractedText?.slice(0, 3000) ?? null };
  }),
  analyses: perm("documents:view").input(z.object({ fileId: z.string().optional() }).optional()).query(({ ctx, input }) =>
    prisma.documentAnalysis.findMany({ where: { weddingId: ctx.weddingId, ...(input?.fileId ? { fileId: input.fileId } : {}) }, include: { file: { select: { originalName: true } }, _count: { select: { findings: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
  ),

  // ───── Galeria
  albums: perm("gallery:view").query(({ ctx }) => prisma.photoAlbum.findMany({ where: { weddingId: ctx.weddingId }, include: { _count: { select: { items: true } }, items: { take: 4, orderBy: { createdAt: "desc" }, select: { fileId: true } } }, orderBy: { sortOrder: "asc" } })),
  album: perm("gallery:view").input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const a = await prisma.photoAlbum.findFirst({ where: { id: input.id, weddingId: ctx.weddingId }, include: { items: { orderBy: { createdAt: "desc" }, include: { file: { select: { id: true, originalName: true, mimeType: true, deletedAt: true } }, vendor: { select: { id: true, name: true } } } } } });
    if (!a) throw new TRPCError({ code: "NOT_FOUND" });
    return { ...a, items: a.items.filter((i) => !i.file.deletedAt) };
  }),
  saveAlbum: perm("gallery:create").input(z.object({ id: z.string().optional(), name: z.string().min(2).max(80), description: z.string().max(500).nullable().optional() })).mutation(async ({ ctx, input }) => {
    const { id, ...data } = input;
    if (id) return prisma.photoAlbum.updateMany({ where: { id, weddingId: ctx.weddingId }, data });
    return prisma.photoAlbum.create({ data: { ...data, weddingId: ctx.weddingId, sortOrder: 99 } });
  }),
  deleteAlbum: perm("gallery:delete").input(z.object({ id: z.string() })).mutation(({ ctx, input }) => prisma.photoAlbum.deleteMany({ where: { id: input.id, weddingId: ctx.weddingId } })),
  addToAlbum: perm("gallery:create").input(z.object({ albumId: z.string(), fileId: z.string(), caption: z.string().max(300).nullable().optional(), tags: z.array(z.string().max(40)).max(20).default([]), notes: z.string().max(1000).nullable().optional(), vendorId: z.string().nullable().optional() })).mutation(async ({ ctx, input }) => {
    const [a, f] = await Promise.all([prisma.photoAlbum.findFirst({ where: { id: input.albumId, weddingId: ctx.weddingId } }), prisma.fileAsset.findFirst({ where: { id: input.fileId, weddingId: ctx.weddingId } })]);
    if (!a || !f) throw new TRPCError({ code: "NOT_FOUND" });
    if (input.vendorId && !(await prisma.vendor.count({ where: { id: input.vendorId, weddingId: ctx.weddingId } }))) throw new TRPCError({ code: "BAD_REQUEST" });
    return prisma.photoAlbumItem.upsert({ where: { albumId_fileId: { albumId: a.id, fileId: f.id } }, create: input, update: input });
  }),
  updateAlbumItem: perm("gallery:edit").input(z.object({ id: z.string(), caption: z.string().max(300).nullable().optional(), tags: z.array(z.string().max(40)).max(20).optional(), notes: z.string().max(1000).nullable().optional(), vendorId: z.string().nullable().optional() })).mutation(async ({ ctx, input }) => {
    const { id, ...data } = input;
    const r = await prisma.photoAlbumItem.updateMany({ where: { id, album: { weddingId: ctx.weddingId } }, data });
    if (!r.count) throw new TRPCError({ code: "NOT_FOUND" });
  }),
  removeFromAlbum: perm("gallery:delete").input(z.object({ id: z.string() })).mutation(({ ctx, input }) => prisma.photoAlbumItem.deleteMany({ where: { id: input.id, album: { weddingId: ctx.weddingId } } })),
});
