import { prisma } from "@casa/db";
import { beforeEach, describe, expect, it } from "vitest";
import { issueInvitation, revokeInvitation } from "../src/guests.js";
import { GUEST_ALBUM_NAME, listGuestPhotos, moderateGuestPhotos, portalPhotoStatus, uploadGuestPhoto } from "../src/guest-photos.js";
import { makeWedding, resetDb } from "./helpers.js";

// JPEG mínimo (assinatura FFD8FF) e um "arquivo" que não é imagem
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const PDF = Buffer.from("%PDF-1.4 nada de foto");
const tokenOf = (url: string) => url.split("/c/")[1]!;

async function setup(opts: { enabled?: boolean; max?: number } = {}) {
  const w = await makeWedding();
  await prisma.wedding.update({ where: { id: w.wedding.id }, data: { guestPhotosEnabled: opts.enabled ?? true, guestPhotosMaxPerFamily: opts.max ?? 3 } });
  const group = await prisma.guestGroup.create({ data: { weddingId: w.wedding.id, name: "Família Lima" } });
  await prisma.guest.create({ data: { weddingId: w.wedding.id, groupId: group.id, fullName: "Ana Lima" } });
  const token = tokenOf((await issueInvitation(w.ctx, group.id)).url);
  return { ...w, group, token };
}
const up = (token: string, extra: Partial<Parameters<typeof uploadGuestPhoto>[1]> = {}) =>
  uploadGuestPhoto(token, { buffer: JPEG, originalName: "foto.jpg", declaredMime: "image/jpeg", uploaderName: "Ana Lima", ...extra }, { ip: "1.1.1.1" });

describe("fotos dos convidados", () => {
  beforeEach(resetDb);

  it("valida: envio fechado, nome, tipo de arquivo", async () => {
    const closed = await setup({ enabled: false });
    await expect(up(closed.token)).rejects.toThrow(/não está aberto/);
    const { token } = await setup();
    await expect(up(token, { uploaderName: " " })).rejects.toThrow(/nome/);
    await expect(up(token, { buffer: PDF, declaredMime: "image/jpeg" })).rejects.toThrow(/não permitido/);
    await expect(up(token, { caption: "x".repeat(301) })).rejects.toThrow(/Legenda/);
    const ok = await up(token, { caption: "Que festa!" });
    expect(ok.status).toBe("PENDING");
    expect(await prisma.fileAsset.count({ where: { category: "PHOTO", uploadedById: null } })).toBe(1);
  });

  it("respeita a cota por família (recusadas não contam)", async () => {
    const { token, ctx } = await setup({ max: 2 });
    const a = await up(token);
    await up(token);
    await expect(up(token)).rejects.toThrow(/Limite de 2/);
    await moderateGuestPhotos(ctx, [a.id], "reject");
    expect((await up(token)).remaining).toBe(0);
  });

  it("aprovar coloca no álbum dos convidados; status do portal mostra só a família", async () => {
    const { token, ctx, wedding } = await setup();
    const p = await up(token, { caption: "Brinde" });
    await moderateGuestPhotos(ctx, [p.id], "approve");
    const album = await prisma.photoAlbum.findFirstOrThrow({ where: { weddingId: wedding.id, name: GUEST_ALBUM_NAME }, include: { items: true } });
    expect(album.items).toHaveLength(1);
    expect(album.items[0]!.caption).toBe("Brinde");
    // Aprovar de novo não duplica
    await moderateGuestPhotos(ctx, [p.id], "approve");
    expect(await prisma.photoAlbumItem.count()).toBe(1);
    const st = await portalPhotoStatus(token);
    expect(st.own).toHaveLength(1);
    expect(st.own[0]!.status).toBe("APPROVED");
    expect(st.own[0]!.url).toMatch(/^\/api\/blob\//);
    expect(st.wall).toHaveLength(0); // mural desligado por padrão
    expect((await listGuestPhotos(wedding.id, "APPROVED"))).toHaveLength(1);
  });

  it("token inválido ou revogado é recusado", async () => {
    const { token, ctx, group } = await setup();
    await expect(up("x".repeat(32))).rejects.toThrow(/inválido/);
    await revokeInvitation(ctx, group.id);
    await expect(up(token)).rejects.toThrow(/não é mais válido/);
    await expect(portalPhotoStatus(token)).rejects.toThrow(/não é mais válido/);
  });

  it("isolamento: não modera foto de outro casamento", async () => {
    const a = await setup();
    const b = await setup();
    const p = await up(a.token);
    await expect(moderateGuestPhotos(b.ctx, [p.id], "approve")).rejects.toThrow(/não encontrad/);
    expect(await listGuestPhotos(b.wedding.id, "PENDING")).toHaveLength(0);
  });
});
