import { prisma } from "@casa/db";
import { audit } from "./audit.js";
import type { Ctx } from "./context.js";
import { DomainError } from "./errors.js";
import { storage } from "./storage.js";

/**
 * Fotos de personalização do casamento (capa, noivos, galeria do portal).
 * Só imagens do próprio casamento; o acesso é sempre por URL assinada temporária.
 */
export type WeddingPhotos = { cover: string | null; coverPosition: string; partner1: string | null; partner2: string | null; gallery: { id: string; url: string }[] };

type PhotoFields = { id: string; coverFileId: string | null; coverPosition: string; partner1PhotoFileId: string | null; partner2PhotoFileId: string | null; portalGalleryFileIds: string[] };

export async function weddingPhotoUrls(w: PhotoFields, ttlSeconds = 3600): Promise<WeddingPhotos> {
  const ids = [w.coverFileId, w.partner1PhotoFileId, w.partner2PhotoFileId, ...w.portalGalleryFileIds].filter((x): x is string => !!x);
  const files = ids.length ? await prisma.fileAsset.findMany({ where: { id: { in: ids }, weddingId: w.id, deletedAt: null, mimeType: { startsWith: "image/" } } }) : [];
  const urls = new Map<string, string>();
  for (const f of files) urls.set(f.id, await storage().signedUrl(f.storageKey, { fileName: f.originalName, contentType: f.mimeType, inline: true, ttlSeconds }));
  const get = (id: string | null) => (id ? (urls.get(id) ?? null) : null);
  return {
    cover: get(w.coverFileId),
    coverPosition: w.coverPosition,
    partner1: get(w.partner1PhotoFileId),
    partner2: get(w.partner2PhotoFileId),
    gallery: w.portalGalleryFileIds.filter((id) => urls.has(id)).map((id) => ({ id, url: urls.get(id)! })),
  };
}

export async function updateWeddingPhotos(
  ctx: Ctx,
  input: { coverFileId?: string | null; coverPosition?: string; partner1PhotoFileId?: string | null; partner2PhotoFileId?: string | null; portalGalleryFileIds?: string[] },
) {
  const ids = [input.coverFileId, input.partner1PhotoFileId, input.partner2PhotoFileId, ...(input.portalGalleryFileIds ?? [])].filter((x): x is string => !!x);
  const unique = [...new Set(ids)];
  if (unique.length) {
    const n = await prisma.fileAsset.count({ where: { id: { in: unique }, weddingId: ctx.weddingId, deletedAt: null, mimeType: { startsWith: "image/" } } });
    if (n !== unique.length) throw new DomainError("Use apenas imagens enviadas para este casamento");
  }
  if (input.portalGalleryFileIds && input.portalGalleryFileIds.length > 24) throw new DomainError("Máximo de 24 fotos na galeria do portal");
  if (input.coverPosition && !/^(top|center|bottom|\d{1,3}% \d{1,3}%)$/.test(input.coverPosition)) throw new DomainError("Enquadramento inválido");
  const w = await prisma.wedding.update({ where: { id: ctx.weddingId }, data: input });
  await audit(ctx.actor, { weddingId: ctx.weddingId, action: "update", entityType: "wedding", entityId: w.id, summary: "Atualizou as fotos de personalização do casamento" });
  return w;
}
