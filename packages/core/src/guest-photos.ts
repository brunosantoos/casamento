import { prisma, type ModerationStatus } from "@casa/db";
import { randomUUID } from "node:crypto";
import { audit, type Actor } from "./audit.js";
import type { Ctx } from "./context.js";
import { sha256, tokenHash } from "./crypto.js";
import { assert, DomainError, notFound } from "./errors.js";
import { deleteFile, resolveMime } from "./files.js";
import { notify } from "./notify.js";
import { storage } from "./storage.js";

/**
 * Fotos enviadas pelos convidados pelo portal (link da família).
 * Ficam PENDENTES até o casal aprovar; aprovadas entram no álbum "Fotos dos convidados".
 */
export const GUEST_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];
export const GUEST_PHOTO_MAX_BYTES = 15 * 1024 * 1024;
export const GUEST_ALBUM_NAME = "Fotos dos convidados";

/** Convite válido (não revogado nem expirado) a partir do token do link */
export async function invitationByToken(token: string) {
  if (!/^[\w-]{20,64}$/.test(token)) throw new DomainError("Link inválido", "NOT_FOUND");
  const inv = await prisma.guestInvitation.findUnique({ where: { tokenHash: tokenHash(token) }, include: { wedding: true, group: true } });
  if (!inv) throw new DomainError("Link inválido", "NOT_FOUND");
  if (inv.revokedAt) throw new DomainError("Este link não é mais válido. Peça um novo aos noivos.", "NOT_FOUND");
  if (inv.expiresAt && inv.expiresAt < new Date()) throw new DomainError("Este link expirou. Peça um novo aos noivos.", "NOT_FOUND");
  return inv;
}

/** GuestPhoto não tem relação com FileAsset no schema: junta manualmente (sempre filtrando pelo casamento) */
async function withFiles<T extends { fileId: string }>(weddingId: string, rows: T[]) {
  const files = rows.length ? await prisma.fileAsset.findMany({ where: { id: { in: rows.map((r) => r.fileId) }, weddingId, deletedAt: null } }) : [];
  const byId = new Map(files.map((f) => [f.id, f]));
  return rows.flatMap((r) => {
    const file = byId.get(r.fileId);
    return file ? [{ ...r, file }] : [];
  });
}

const signed = (key: string, name: string, mime: string, ttl = 3600) => storage().signedUrl(key, { fileName: name, contentType: mime, inline: true, ttlSeconds: ttl });

export async function uploadGuestPhoto(
  token: string,
  input: { buffer: Buffer; originalName: string; declaredMime: string; uploaderName: string; caption?: string | null },
  meta: { ip?: string | null } = {},
) {
  const inv = await invitationByToken(token);
  const w = inv.wedding;
  if (!w.guestPhotosEnabled) throw new DomainError("O envio de fotos não está aberto", "PRECONDITION_FAILED");
  const name = input.uploaderName.trim();
  assert(name.length >= 2 && name.length <= 80, "Informe seu nome (até 80 caracteres)");
  const caption = input.caption?.trim() || null;
  assert(!caption || caption.length <= 300, "Legenda com até 300 caracteres");
  assert(input.buffer.length > 0, "Arquivo vazio");
  assert(input.buffer.length <= GUEST_PHOTO_MAX_BYTES, "Foto maior que 15 MB");
  const mime = resolveMime(input.buffer, input.declaredMime, GUEST_PHOTO_TYPES);

  const used = await prisma.guestPhoto.count({ where: { weddingId: w.id, groupId: inv.groupId, status: { not: "REJECTED" } } });
  if (used >= w.guestPhotosMaxPerFamily) throw new DomainError(`Limite de ${w.guestPhotosMaxPerFamily} fotos por família atingido`, "PRECONDITION_FAILED");

  const key = `${w.id}/guest-photos/${randomUUID()}`;
  await storage().put(key, input.buffer, mime);
  const hash = sha256(input.buffer);
  const originalName = input.originalName.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "foto";
  const actor: Actor = { userId: null, userName: `Portal: ${name} (${inv.group.name})`, ip: meta.ip ?? null, origin: "portal" };

  const photo = await prisma.$transaction(async (tx) => {
    const file = await tx.fileAsset.create({
      data: {
        weddingId: w.id, originalName, mimeType: mime, size: input.buffer.length, sha256: hash, storageKey: key, category: "PHOTO",
        description: "Foto enviada por convidado", uploadedById: null,
        versions: { create: { version: 1, storageKey: key, originalName, size: input.buffer.length, sha256: hash, mimeType: mime } },
      },
    });
    const p = await tx.guestPhoto.create({ data: { weddingId: w.id, fileId: file.id, groupId: inv.groupId, uploaderName: name, caption, ip: meta.ip ?? null } });
    await audit(actor, { weddingId: w.id, action: "create", entityType: "guestPhoto", entityId: p.id, summary: `${name} (${inv.group.name}) enviou uma foto para aprovação` }, tx);
    return p;
  });

  const hour = new Date().toISOString().slice(0, 13);
  await notify(w.id, "guest_photo", { title: "Nova foto de convidado", body: `${name} enviou uma foto para aprovação`, url: "/fotos-convidados", dedupeKey: `guest_photo:${inv.groupId}:${hour}` }).catch(() => undefined);
  return { id: photo.id, status: photo.status, remaining: Math.max(0, w.guestPhotosMaxPerFamily - used - 1) };
}

/** Situação do envio para a família do link (só os dados dela) */
export async function portalPhotoStatus(token: string) {
  const inv = await invitationByToken(token);
  const w = inv.wedding;
  const cfg = (w.portalConfig ?? {}) as { showGuestPhotos?: boolean };
  const own = await withFiles(w.id, await prisma.guestPhoto.findMany({ where: { weddingId: w.id, groupId: inv.groupId }, orderBy: { createdAt: "desc" } }));
  const used = own.filter((p) => p.status !== "REJECTED").length;
  const wall = w.guestPhotosEnabled && cfg.showGuestPhotos
    ? await withFiles(w.id, await prisma.guestPhoto.findMany({ where: { weddingId: w.id, status: "APPROVED" }, orderBy: { reviewedAt: "desc" }, take: 60 }))
    : [];
  return {
    enabled: w.guestPhotosEnabled,
    familyName: inv.group.name,
    max: w.guestPhotosMaxPerFamily,
    remaining: Math.max(0, w.guestPhotosMaxPerFamily - used),
    own: await Promise.all(
      own.map(async (p) => ({ id: p.id, status: p.status, caption: p.caption, uploaderName: p.uploaderName, createdAt: p.createdAt, url: await signed(p.file.storageKey, p.file.originalName, p.file.mimeType) })),
    ),
    wall: await Promise.all(wall.map(async (p) => ({ id: p.id, caption: p.caption, uploaderName: p.uploaderName, url: await signed(p.file.storageKey, p.file.originalName, p.file.mimeType) }))),
  };
}

// ───────────── Painel ─────────────

export async function listGuestPhotos(weddingId: string, status: ModerationStatus) {
  const rows = await withFiles(weddingId, await prisma.guestPhoto.findMany({
    where: { weddingId, status },
    include: { group: { select: { id: true, name: true } } },
    orderBy: { createdAt: status === "PENDING" ? "asc" : "desc" },
    take: 500,
  }));
  return Promise.all(
    rows.map(async (p) => ({
      id: p.id, status: p.status, uploaderName: p.uploaderName, caption: p.caption, createdAt: p.createdAt, reviewedAt: p.reviewedAt,
      family: p.group?.name ?? null, fileId: p.fileId, size: p.file.size, url: await signed(p.file.storageKey, p.file.originalName, p.file.mimeType, 1800),
    })),
  );
}

async function guestAlbum(weddingId: string) {
  const existing = await prisma.photoAlbum.findFirst({ where: { weddingId, name: GUEST_ALBUM_NAME } });
  return existing ?? prisma.photoAlbum.create({ data: { weddingId, name: GUEST_ALBUM_NAME, description: "Fotos enviadas pelos convidados e aprovadas pelo casal", sortOrder: 50 } });
}

export async function moderateGuestPhotos(ctx: Ctx, ids: string[], decision: "approve" | "reject", opts: { deleteFile?: boolean } = {}) {
  assert(ids.length > 0 && ids.length <= 200, "Selecione de 1 a 200 fotos");
  const photos = await prisma.guestPhoto.findMany({ where: { id: { in: ids }, weddingId: ctx.weddingId } });
  if (photos.length !== new Set(ids).size) throw notFound("Foto");
  const album = decision === "approve" ? await guestAlbum(ctx.weddingId) : null;
  for (const p of photos) {
    await prisma.$transaction(async (tx) => {
      await tx.guestPhoto.update({ where: { id: p.id }, data: { status: decision === "approve" ? "APPROVED" : "REJECTED", reviewedById: ctx.actor.userId, reviewedAt: new Date() } });
      if (album) {
        await tx.photoAlbumItem.upsert({
          where: { albumId_fileId: { albumId: album.id, fileId: p.fileId } },
          create: { albumId: album.id, fileId: p.fileId, caption: p.caption ?? `Enviada por ${p.uploaderName}`, tags: ["convidados"] },
          update: {},
        });
      } else {
        // Recusada: sai do álbum (caso tivesse sido aprovada antes)
        await tx.photoAlbumItem.deleteMany({ where: { fileId: p.fileId, album: { weddingId: ctx.weddingId, name: GUEST_ALBUM_NAME } } });
      }
    });
    if (decision === "reject" && opts.deleteFile) await deleteFile(ctx, p.fileId).catch(() => undefined);
  }
  await audit(ctx.actor, {
    weddingId: ctx.weddingId, action: decision, entityType: "guestPhoto", entityId: ids.length === 1 ? ids[0] : null,
    summary: `${decision === "approve" ? "Aprovou" : "Recusou"} ${photos.length} foto(s) de convidados${opts.deleteFile ? " (arquivos excluídos)" : ""}`,
  });
  return { count: photos.length };
}

export async function guestPhotoCounts(weddingId: string) {
  const deleted = (await prisma.fileAsset.findMany({ where: { weddingId, deletedAt: { not: null } }, select: { id: true } })).map((f) => f.id);
  const g = await prisma.guestPhoto.groupBy({ by: ["status"], where: { weddingId, fileId: { notIn: deleted } }, _count: true });
  const n = (s: ModerationStatus) => g.find((x) => x.status === s)?._count ?? 0;
  return { PENDING: n("PENDING"), APPROVED: n("APPROVED"), REJECTED: n("REJECTED") };
}
