import { prisma } from "@casa/db";
import { beforeEach, describe, expect, it } from "vitest";
import { assignGuests, deleteTable, proposeArrangement, saveTable, seatingLayout, suggestArrangement, applyArrangement } from "../src/seating.js";
import { makeWedding, resetDb } from "./helpers.js";

async function family(weddingId: string, name: string, people: { fullName: string; companions?: number; rsvp?: "ACCEPTED" | "PENDING" | "DECLINED"; side?: string }[]) {
  const g = await prisma.guestGroup.create({ data: { weddingId, name } });
  const out = [];
  for (const p of people) {
    const guest = await prisma.guest.create({ data: { weddingId, groupId: g.id, fullName: p.fullName, rsvpStatus: p.rsvp ?? "ACCEPTED", side: p.side ?? null, plusOnesAllowed: p.companions ?? 0 } });
    for (let i = 0; i < (p.companions ?? 0); i++) await prisma.guestCompanion.create({ data: { guestId: guest.id, name: `Acomp ${i + 1}`, attending: true } });
    out.push(guest);
  }
  return { group: g, guests: out };
}

describe("mapa de mesas", () => {
  beforeEach(resetDb);

  it("conta pessoas (convidado + acompanhantes) e bloqueia acima da capacidade sem force", async () => {
    const { ctx } = await makeWedding();
    const t = await saveTable(ctx, { name: "Mesa 1", shape: "ROUND", capacity: 4 });
    const a = await family(ctx.weddingId, "Silva", [{ fullName: "Ana", companions: 1 }, { fullName: "Beto" }]);
    const b = await family(ctx.weddingId, "Souza", [{ fullName: "Caio", companions: 1 }]);
    const r = await assignGuests(ctx, { guestIds: [a.guests[0]!.id], tableId: t.id, wholeFamily: true });
    expect(r.people).toBe(3);
    await expect(assignGuests(ctx, { guestIds: [b.guests[0]!.id], tableId: t.id })).rejects.toThrow(/4 lugares/);
    await assignGuests(ctx, { guestIds: [b.guests[0]!.id], tableId: t.id, force: true });
    const l = await seatingLayout(ctx.weddingId);
    expect(l.tables[0]!.used).toBe(5);
    expect(l.tables[0]!.over).toBe(true);
    expect(l.stats.overTables).toBe(1);
    expect((await prisma.guest.findUniqueOrThrow({ where: { id: a.guests[1]!.id } })).tableName).toBe("Mesa 1");
  });

  it("família inteira entra junta (sem recusados) e excluir a mesa libera todos", async () => {
    const { ctx } = await makeWedding();
    const t = await saveTable(ctx, { name: "Família", shape: "RECT", capacity: 10 });
    const f = await family(ctx.weddingId, "Lima", [{ fullName: "Lia" }, { fullName: "Léo" }, { fullName: "Luz", rsvp: "DECLINED" }]);
    await assignGuests(ctx, { guestIds: [f.guests[0]!.id], tableId: t.id, wholeFamily: true });
    const l = await seatingLayout(ctx.weddingId);
    expect(l.tables[0]!.guests.map((g) => g.fullName).sort()).toEqual(["Lia", "Léo"]);
    expect(l.unseated.some((g) => g.fullName === "Luz")).toBe(false);
    expect((await seatingLayout(ctx.weddingId, { includeDeclined: true })).unseated.some((g) => g.fullName === "Luz")).toBe(true);
    await deleteTable(ctx, t.id);
    expect((await seatingLayout(ctx.weddingId)).unseated).toHaveLength(2);
    expect(await prisma.guest.count({ where: { tableName: { not: null } } })).toBe(0);
  });

  it("isolamento: não usa mesa nem convidado de outro casamento", async () => {
    const a = await makeWedding();
    const b = await makeWedding();
    const tb = await saveTable(b.ctx, { name: "Do B", shape: "ROUND", capacity: 8 });
    const fa = await family(a.ctx.weddingId, "A", [{ fullName: "Alice" }]);
    await expect(assignGuests(a.ctx, { guestIds: [fa.guests[0]!.id], tableId: tb.id })).rejects.toThrow(/Mesa/);
    await expect(assignGuests(b.ctx, { guestIds: [fa.guests[0]!.id], tableId: tb.id })).rejects.toThrow(/Convidado/);
    await expect(deleteTable(a.ctx, tb.id)).rejects.toThrow(/Mesa/);
  });

  it("sugestão mantém famílias juntas e respeita a capacidade", async () => {
    const { ctx } = await makeWedding();
    await saveTable(ctx, { name: "M1", shape: "ROUND", capacity: 6 });
    await saveTable(ctx, { name: "M2", shape: "ROUND", capacity: 6 });
    await family(ctx.weddingId, "Grande", [{ fullName: "G1", companions: 2 }, { fullName: "G2" }, { fullName: "G3" }], );
    await family(ctx.weddingId, "Média", [{ fullName: "M1p", companions: 1 }, { fullName: "M2p" }]);
    await family(ctx.weddingId, "Pequena", [{ fullName: "P1" }]);
    await family(ctx.weddingId, "Pendente", [{ fullName: "X", rsvp: "PENDING" }]);
    const s = await suggestArrangement(ctx.weddingId);
    expect(s.proposal.find((p) => p.groupName === "Pendente")).toBeUndefined();
    for (const p of s.proposal) expect(new Set(s.proposal.filter((q) => q.groupId === p.groupId).map((q) => q.tableId)).size).toBe(1);
    await applyArrangement(ctx, s.proposal);
    const l = await seatingLayout(ctx.weddingId);
    expect(l.tables.every((t) => t.used <= t.capacity)).toBe(true);
    expect(l.stats.seatedPeople).toBe(5 + 3 + 1);
    const pure = proposeArrangement([{ id: "t", name: "T", capacity: 2, used: 0 }], [{ groupId: "g", groupName: "G", side: null, category: null, guestIds: ["a", "b", "c"], people: 3 }]);
    expect(pure.proposal).toHaveLength(0);
    expect(pure.leftover[0]!.people).toBe(3);
  });
});
