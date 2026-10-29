import { prisma } from "@casa/db";
import { beforeEach, describe, expect, it } from "vitest";
import { decrypt } from "../src/crypto.js";
import { activeInvitation, guestStats, issueInvitation, portalView, revokeInvitation, submitRsvp } from "../src/guests.js";
import { makeWedding, resetDb } from "./helpers.js";

async function family(weddingId: string, name: string, members: { fullName: string; phone?: string; plusOnesAllowed?: number; isChild?: boolean }[]) {
  const g = await prisma.guestGroup.create({ data: { weddingId, name, contactPhone: "5511999990000" } });
  const guests = [];
  for (const [i, m] of members.entries()) guests.push(await prisma.guest.create({ data: { weddingId, groupId: g.id, isGroupLead: i === 0, ...m } }));
  return { group: g, guests };
}
const tokenOf = (url: string) => url.split("/c/")[1]!;

describe("convidados e portal", () => {
  beforeEach(resetDb);

  it("várias pessoas com o mesmo telefone na mesma família", async () => {
    const { ctx } = await makeWedding();
    const { guests } = await family(ctx.weddingId, "Família Silva", [
      { fullName: "Maria Silva", phone: "5511999990000" },
      { fullName: "João Silva", phone: "5511999990000" },
      { fullName: "Pedrinho Silva", phone: "5511999990000", isChild: true },
    ]);
    expect(guests).toHaveLength(3);
    expect(new Set(guests.map((g) => g.id)).size).toBe(3);
  });

  it("confirmação pelo portal: conta PESSOAS (convidados + acompanhantes) e respeita o limite", async () => {
    const { ctx } = await makeWedding();
    const { group, guests } = await family(ctx.weddingId, "Família Souza", [{ fullName: "Carla Souza", plusOnesAllowed: 1 }, { fullName: "Davi Souza" }]);
    const inv = await issueInvitation(ctx, group.id);
    const token = tokenOf(inv.url);

    await expect(submitRsvp(token, { submissionKey: "k-limit-1", responses: [{ guestId: guests[0]!.id, status: "ACCEPTED", companions: [{ name: "A" }, { name: "B" }] }] }, {})).rejects.toThrow(/no máximo 1/);

    const r = await submitRsvp(token, {
      submissionKey: "k-ok-0001",
      responses: [
        { guestId: guests[0]!.id, status: "ACCEPTED", companions: [{ name: "Namorado", dietary: "vegano" }] },
        { guestId: guests[1]!.id, status: "DECLINED", companions: [] },
      ],
    }, { ip: "1.2.3.4" });
    expect(r.duplicate).toBe(false);
    const stats = await guestStats(ctx.weddingId);
    expect(stats.accepted).toBe(1);
    expect(stats.companions).toBe(1);
    expect(stats.confirmedPeople).toBe(2);
    expect(stats.declined).toBe(1);
  });

  it("submissão repetida (mesma chave) não duplica", async () => {
    const { ctx } = await makeWedding();
    const { group, guests } = await family(ctx.weddingId, "Família Lima", [{ fullName: "Ana Lima" }]);
    const token = tokenOf((await issueInvitation(ctx, group.id)).url);
    const body = { submissionKey: "same-key-01", responses: [{ guestId: guests[0]!.id, status: "ACCEPTED" as const, companions: [] }] };
    await submitRsvp(token, body, {});
    const again = await submitRsvp(token, body, {});
    expect(again.duplicate).toBe(true);
    expect(await prisma.rsvp.count()).toBe(1);
  });

  it("um link não altera nem vê convidados de outra família", async () => {
    const { ctx } = await makeWedding();
    const a = await family(ctx.weddingId, "Família A", [{ fullName: "Alice", phone: "5511911111111" }]);
    const b = await family(ctx.weddingId, "Família B", [{ fullName: "Beto", phone: "5511922222222" }]);
    const token = tokenOf((await issueInvitation(ctx, a.group.id)).url);
    const view = await portalView(token);
    expect(view.guests.map((g) => g.fullName)).toEqual(["Alice"]);
    expect(JSON.stringify(view)).not.toContain("Beto");
    expect(JSON.stringify(view)).not.toContain("5511911111111");
    await expect(submitRsvp(token, { submissionKey: "cross-01", responses: [{ guestId: b.guests[0]!.id, status: "ACCEPTED", companions: [] }] }, {})).rejects.toThrow(/não pertence/);
  });

  it("links: aleatórios, revogáveis, com validade; token não é guardado em claro", async () => {
    const { ctx } = await makeWedding();
    const { group } = await family(ctx.weddingId, "Família X", [{ fullName: "Xavier" }]);
    const inv = await activeInvitation(ctx, group.id);
    const token = tokenOf(inv.url);
    expect(token.length).toBeGreaterThanOrEqual(30);
    const row = await prisma.guestInvitation.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.tokenHash).not.toContain(token);
    expect(decrypt(row.tokenEnc)).toBe(token);
    await revokeInvitation(ctx, group.id);
    await expect(portalView(token)).rejects.toThrow(/não é mais válido/);
    await expect(portalView("x".repeat(32))).rejects.toThrow(/inválido/);
    const fresh = await issueInvitation(ctx, group.id);
    await prisma.guestInvitation.update({ where: { id: fresh.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(portalView(tokenOf(fresh.url))).rejects.toThrow(/expirou/);
  });

  it("prazo de confirmação encerrado bloqueia o envio", async () => {
    const { ctx } = await makeWedding();
    const { group, guests } = await family(ctx.weddingId, "Família P", [{ fullName: "Paula" }]);
    await prisma.wedding.update({ where: { id: ctx.weddingId }, data: { rsvpDeadline: new Date(Date.now() - 86400_000) } });
    const token = tokenOf((await issueInvitation(ctx, group.id)).url);
    await expect(submitRsvp(token, { submissionKey: "late-01", responses: [{ guestId: guests[0]!.id, status: "ACCEPTED", companions: [] }] }, {})).rejects.toThrow(/prazo/);
  });
});
