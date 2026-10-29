import { prisma } from "@casa/db";
import { randomUUID } from "node:crypto";
import { audit } from "./audit.js";
import type { Ctx } from "./context.js";
import { sha256 } from "./crypto.js";
import { assert, DomainError, notFound } from "./errors.js";
import { getSetting } from "./settings.js";
import { storage } from "./storage.js";

/** Detecta o tipo real pelo conteúdo (assinatura), sem confiar na extensão nem no navegador */
export function sniffMime(buf: Buffer): string | null {
  const hex = buf.subarray(0, 12).toString("hex");
  if (hex.startsWith("25504446")) return "application/pdf";
  if (hex.startsWith("ffd8ff")) return "image/jpeg";
  if (hex.startsWith("89504e47")) return "image/png";
  if (hex.startsWith("52494646") && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (buf.subarray(4, 12).toString().match(/^ftyp(heic|heix|mif1|msf1)/)) return "image/heic";
  if (hex.startsWith("504b0304")) return "application/zip";
  // Texto: sem bytes nulos nos primeiros 4KB
  if (!buf.subarray(0, 4096).includes(0)) return "text/plain";
  return null;
}

const ZIP_OFFICE = ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];

export function resolveMime(buf: Buffer, declared: string, allowed: string[]) {
  const real = sniffMime(buf);
  if (!real) throw new DomainError("Formato de arquivo não reconhecido");
  let mime = real;
  if (real === "application/zip" && ZIP_OFFICE.includes(declared)) mime = declared;
  if (real === "text/plain" && declared === "text/csv") mime = "text/csv";
  // HTML/SVG/scripts nunca: podem executar no navegador
  if (/html|svg|javascript|xml/.test(declared)) throw new DomainError("Tipo de arquivo não permitido");
  if (!allowed.includes(mime)) throw new DomainError(`Tipo de arquivo não permitido (${mime})`);
  return mime;
}

export const FILE_CATEGORIES = ["CONTRACT", "RECEIPT", "QUOTE", "DOCUMENT", "PHOTO", "INSPIRATION", "OTHER"] as const;
export const ENTITY_TYPES = ["vendor", "task", "obligation", "payment", "income", "contract", "quote", "ceremony", "venue", "guest", "event"] as const;

export async function uploadFile(
  ctx: Ctx,
  input: { buffer: Buffer; originalName: string; declaredMime: string; category: string; description?: string | null; entityType?: string | null; entityId?: string | null; replaceFileId?: string | null },
) {
  const maxMb = await getSetting(ctx.weddingId, "files.maxUploadMb");
  assert(input.buffer.length > 0, "Arquivo vazio");
  assert(input.buffer.length <= maxMb * 1024 * 1024, `Arquivo maior que ${maxMb} MB`);
  const mime = resolveMime(input.buffer, input.declaredMime, await getSetting(ctx.weddingId, "files.allowedTypes"));
  assert((FILE_CATEGORIES as readonly string[]).includes(input.category), "Categoria inválida");
  if (input.entityType) assert((ENTITY_TYPES as readonly string[]).includes(input.entityType), "Vínculo inválido");
  const hash = sha256(input.buffer);
  const key = `${ctx.weddingId}/${randomUUID()}`;
  await storage().put(key, input.buffer, mime);

  if (input.replaceFileId) {
    const current = await prisma.fileAsset.findFirst({ where: { id: input.replaceFileId, weddingId: ctx.weddingId, deletedAt: null } });
    if (!current) throw notFound("Arquivo");
    const version = current.version + 1;
    const updated = await prisma.$transaction(async (tx) => {
      await tx.fileVersion.create({ data: { fileId: current.id, version, storageKey: key, originalName: input.originalName, size: input.buffer.length, sha256: hash, mimeType: mime, createdById: ctx.actor.userId } });
      const f = await tx.fileAsset.update({ where: { id: current.id }, data: { version, storageKey: key, originalName: input.originalName, size: input.buffer.length, sha256: hash, mimeType: mime } });
      await audit(ctx.actor, { weddingId: ctx.weddingId, action: "update", entityType: "file", entityId: f.id, summary: `Enviou versão ${version} de "${f.originalName}"` }, tx);
      return f;
    });
    return updated;
  }

  return prisma.$transaction(async (tx) => {
    const f = await tx.fileAsset.create({
      data: {
        weddingId: ctx.weddingId, originalName: input.originalName, mimeType: mime, size: input.buffer.length, sha256: hash, storageKey: key,
        category: input.category, description: input.description ?? null, entityType: input.entityType ?? null, entityId: input.entityId ?? null, uploadedById: ctx.actor.userId,
        versions: { create: { version: 1, storageKey: key, originalName: input.originalName, size: input.buffer.length, sha256: hash, mimeType: mime, createdById: ctx.actor.userId } },
      },
    });
    await audit(ctx.actor, { weddingId: ctx.weddingId, action: "create", entityType: "file", entityId: f.id, summary: `Enviou "${f.originalName}" (${input.category})` }, tx);
    return f;
  });
}

export async function fileUrl(ctx: Ctx, id: string, opts: { inline?: boolean; version?: number } = {}) {
  const f = await prisma.fileAsset.findFirst({ where: { id, weddingId: ctx.weddingId, deletedAt: null } });
  if (!f) throw notFound("Arquivo");
  let key = f.storageKey;
  let name = f.originalName;
  if (opts.version && opts.version !== f.version) {
    const v = await prisma.fileVersion.findUnique({ where: { fileId_version: { fileId: id, version: opts.version } } });
    if (!v) throw notFound("Versão");
    key = v.storageKey;
    name = v.originalName;
  }
  return storage().signedUrl(key, { fileName: name, contentType: f.mimeType, inline: opts.inline, ttlSeconds: 300 });
}

/** Exclusão lógica; o worker remove o binário após o prazo de retenção */
export async function deleteFile(ctx: Ctx, id: string) {
  const f = await prisma.fileAsset.findFirst({ where: { id, weddingId: ctx.weddingId, deletedAt: null } });
  if (!f) throw notFound("Arquivo");
  await prisma.fileAsset.update({ where: { id }, data: { deletedAt: new Date(), deletedById: ctx.actor.userId } });
  await audit(ctx.actor, { weddingId: ctx.weddingId, action: "delete", entityType: "file", entityId: id, summary: `Excluiu "${f.originalName}" (recuperável durante o prazo de retenção)` });
}

export async function restoreFile(ctx: Ctx, id: string) {
  const f = await prisma.fileAsset.findFirst({ where: { id, weddingId: ctx.weddingId, deletedAt: { not: null } } });
  if (!f) throw notFound("Arquivo excluído");
  await prisma.fileAsset.update({ where: { id }, data: { deletedAt: null, deletedById: null } });
  await audit(ctx.actor, { weddingId: ctx.weddingId, action: "restore", entityType: "file", entityId: id, summary: `Restaurou "${f.originalName}"` });
}

/** Expurgo definitivo após a retenção (worker) */
export async function purgeDeletedFiles() {
  const weddings = await prisma.wedding.findMany({ select: { id: true } });
  let n = 0;
  for (const w of weddings) {
    const days = await getSetting(w.id, "files.retentionDays");
    const old = await prisma.fileAsset.findMany({ where: { weddingId: w.id, deletedAt: { lt: new Date(Date.now() - days * 86400_000) } }, include: { versions: true } });
    for (const f of old) {
      for (const v of f.versions) await storage().delete(v.storageKey).catch(() => undefined);
      await storage().delete(f.storageKey).catch(() => undefined);
      await prisma.fileAsset.delete({ where: { id: f.id } });
      n++;
    }
  }
  return n;
}
