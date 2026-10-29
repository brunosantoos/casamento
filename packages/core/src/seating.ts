import { prisma, type Prisma, type TableShape, type Tx } from "@casa/db";
import { audit } from "./audit.js";
import type { Ctx } from "./context.js";
import { assert, DomainError, notFound } from "./errors.js";

/**
 * Mapa de mesas. Lugares contam PESSOAS: convidado + acompanhantes que vão.
 * O convidado senta com os acompanhantes; Guest.tableName é mantido em sincronia
 * para listas, relatórios e PDFs que já usam o texto da mesa.
 */

const guestSelect = {
  id: true, fullName: true, isChild: true, rsvpStatus: true, dietary: true, accessibility: true, side: true, category: true, groupId: true, tableId: true, seatOrder: true,
  group: { select: { id: true, name: true } },
  companions: { where: { attending: true }, select: { id: true, name: true, isChild: true, dietary: true } },
} satisfies Prisma.GuestSelect;

type SeatGuest = Prisma.GuestGetPayload<{ select: typeof guestSelect }>;

/** Pessoas que ocupam lugar por este convidado (ele + acompanhantes que vão) */
export const peopleOf = (g: { companions: unknown[] }) => 1 + g.companions.length;

const toSeat = (g: SeatGuest) => ({
  id: g.id, fullName: g.fullName, isChild: g.isChild, rsvpStatus: g.rsvpStatus, dietary: g.dietary, accessibility: g.accessibility, side: g.side, category: g.category,
  groupId: g.groupId, groupName: g.group.name, seatOrder: g.seatOrder, people: peopleOf(g),
  companions: g.companions.map((c) => ({ id: c.id, name: c.name, isChild: c.isChild, dietary: c.dietary })),
});
export type SeatPerson = ReturnType<typeof toSeat>;

export async function seatingLayout(weddingId: string, opts: { includeDeclined?: boolean } = {}) {
  const [tables, guests] = await Promise.all([
    prisma.seatingTable.findMany({ where: { weddingId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.guest.findMany({ where: { weddingId, deletedAt: null }, select: guestSelect, orderBy: [{ group: { name: "asc" } }, { isGroupLead: "desc" }, { fullName: "asc" }] }),
  ]);
  const seated = guests.filter((g) => g.tableId && g.rsvpStatus !== "DECLINED");
  const rows = tables.map((t) => {
    const people = seated.filter((g) => g.tableId === t.id).sort((a, b) => (a.seatOrder ?? 999) - (b.seatOrder ?? 999)).map(toSeat);
    const used = people.reduce((s, p) => s + p.people, 0);
    return { ...t, guests: people, used, free: t.capacity - used, over: used > t.capacity, full: used === t.capacity };
  });
  const rank = { ACCEPTED: 0, PENDING: 1, DECLINED: 2 } as const;
  const unseated = guests
    .filter((g) => (!g.tableId || !tables.some((t) => t.id === g.tableId)) && (opts.includeDeclined || g.rsvpStatus !== "DECLINED"))
    .sort((a, b) => rank[a.rsvpStatus] - rank[b.rsvpStatus])
    .map(toSeat);
  const confirmedPeople = guests.filter((g) => g.rsvpStatus === "ACCEPTED").reduce((s, g) => s + peopleOf(g), 0);
  const seatedPeople = rows.reduce((s, t) => s + t.used, 0);
  const capacity = tables.reduce((s, t) => s + t.capacity, 0);
  return {
    tables: rows,
    unseated,
    stats: {
      tables: tables.length,
      capacity,
      seatedPeople,
      confirmedPeople,
      unseatedConfirmedPeople: unseated.filter((g) => g.rsvpStatus === "ACCEPTED").reduce((s, g) => s + g.people, 0),
      unseatedPeople: unseated.reduce((s, g) => s + g.people, 0),
      fullTables: rows.filter((t) => t.full).length,
      overTables: rows.filter((t) => t.over).length,
      freeSeats: capacity - seatedPeople,
    },
  };
}

async function ownTable(tx: Tx | typeof prisma, weddingId: string, id: string) {
  const t = await tx.seatingTable.findFirst({ where: { id, weddingId } });
  if (!t) throw notFound("Mesa");
  return t;
}

const clamp = (v: number, min = 0, max = 1000) => Math.max(min, Math.min(max, Math.round(v)));

export type TableInput = { id?: string; name: string; shape: TableShape; capacity: number; x?: number; y?: number; rotation?: number; zone?: string | null; notes?: string | null };

export async function saveTable(ctx: Ctx, input: TableInput) {
  assert(input.name.trim().length >= 1, "Dê um nome à mesa");
  assert(input.capacity >= 1 && input.capacity <= 100, "Capacidade entre 1 e 100");
  return prisma.$transaction(async (tx) => {
    const data = {
      name: input.name.trim(), shape: input.shape, capacity: input.capacity, zone: input.zone ?? null, notes: input.notes ?? null,
      ...(input.x !== undefined ? { x: clamp(input.x) } : {}), ...(input.y !== undefined ? { y: clamp(input.y) } : {}),
      ...(input.rotation !== undefined ? { rotation: ((Math.round(input.rotation) % 360) + 360) % 360 } : {}),
    };
    if (input.id) {
      const before = await ownTable(tx, ctx.weddingId, input.id);
      const t = await tx.seatingTable.update({ where: { id: before.id }, data });
      if (before.name !== t.name) await tx.guest.updateMany({ where: { tableId: t.id }, data: { tableName: t.name } });
      await audit(ctx.actor, { weddingId: ctx.weddingId, action: "update", entityType: "seatingTable", entityId: t.id, summary: `Editou a mesa "${t.name}"` }, tx);
      return t;
    }
    const count = await tx.seatingTable.count({ where: { weddingId: ctx.weddingId } });
    const t = await tx.seatingTable.create({ data: { ...data, weddingId: ctx.weddingId, sortOrder: count, x: data.x ?? clamp(100 + (count % 6) * 150), y: data.y ?? clamp(120 + Math.floor(count / 6) * 170) } });
    await audit(ctx.actor, { weddingId: ctx.weddingId, action: "create", entityType: "seatingTable", entityId: t.id, summary: `Criou a mesa "${t.name}" (${t.capacity} lugares)` }, tx);
    return t;
  });
}

export async function deleteTable(ctx: Ctx, id: string) {
  return prisma.$transaction(async (tx) => {
    const t = await ownTable(tx, ctx.weddingId, id);
    const n = await tx.guest.updateMany({ where: { tableId: t.id }, data: { tableId: null, tableName: null, seatOrder: null } });
    await tx.seatingTable.delete({ where: { id: t.id } });
    await audit(ctx.actor, { weddingId: ctx.weddingId, action: "delete", entityType: "seatingTable", entityId: t.id, summary: `Excluiu a mesa "${t.name}" (${n.count} convidado(s) sem lugar)` }, tx);
  });
}

/** Gera N mesas em grade, numeradas a partir da próxima disponível */
export async function generateTables(ctx: Ctx, input: { count: number; capacity: number; shape: TableShape; prefix?: string }) {
  assert(input.count >= 1 && input.count <= 100, "Entre 1 e 100 mesas");
  assert(input.capacity >= 1 && input.capacity <= 100, "Capacidade entre 1 e 100");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.seatingTable.count({ where: { weddingId: ctx.weddingId } });
    const prefix = input.prefix?.trim() || "Mesa";
    const cols = Math.min(6, Math.max(1, Math.ceil(Math.sqrt(input.count + existing))));
    const stepX = Math.floor(900 / cols);
    const data = Array.from({ length: input.count }, (_, i) => {
      const idx = existing + i;
      return {
        weddingId: ctx.weddingId, name: `${prefix} ${idx + 1}`, shape: input.shape, capacity: input.capacity, sortOrder: idx,
        x: clamp(60 + (idx % cols) * stepX + stepX / 2 - 60), y: clamp(80 + Math.floor(idx / cols) * 170, 0, 1000),
      };
    });
    await tx.seatingTable.createMany({ data });
    await audit(ctx.actor, { weddingId: ctx.weddingId, action: "create", entityType: "seatingTable", summary: `Gerou ${input.count} mesa(s) de ${input.capacity} lugares` }, tx);
    return { created: input.count };
  });
}

export async function savePositions(ctx: Ctx, positions: { id: string; x: number; y: number; rotation?: number }[]) {
  const ids = positions.map((p) => p.id);
  const owned = await prisma.seatingTable.count({ where: { id: { in: ids }, weddingId: ctx.weddingId } });
  assert(owned === new Set(ids).size, "Mesa inválida", "NOT_FOUND");
  await prisma.$transaction(
    positions.map((p) => prisma.seatingTable.update({ where: { id: p.id }, data: { x: clamp(p.x), y: clamp(p.y), ...(p.rotation !== undefined ? { rotation: ((Math.round(p.rotation) % 360) + 360) % 360 } : {}) } })),
  );
}

/**
 * Senta convidados numa mesa (ou tira, com tableId null). wholeFamily: leva todos da família (não recusados).
 * Bloqueia se passar da capacidade, a menos que force=true.
 */
export async function assignGuests(ctx: Ctx, input: { guestIds: string[]; tableId: string | null; wholeFamily?: boolean; force?: boolean }) {
  assert(input.guestIds.length > 0, "Selecione ao menos um convidado");
  return prisma.$transaction(async (tx) => {
    const base = await tx.guest.findMany({ where: { id: { in: input.guestIds }, weddingId: ctx.weddingId, deletedAt: null }, select: { id: true, groupId: true } });
    assert(base.length === new Set(input.guestIds).size, "Convidado inválido", "NOT_FOUND");
    let ids = base.map((g) => g.id);
    if (input.wholeFamily) {
      const fam = await tx.guest.findMany({ where: { weddingId: ctx.weddingId, deletedAt: null, groupId: { in: base.map((g) => g.groupId) }, rsvpStatus: { not: "DECLINED" } }, select: { id: true } });
      ids = [...new Set([...ids, ...fam.map((g) => g.id)])];
    }
    if (!input.tableId) {
      await tx.guest.updateMany({ where: { id: { in: ids } }, data: { tableId: null, tableName: null, seatOrder: null } });
      await audit(ctx.actor, { weddingId: ctx.weddingId, action: "update", entityType: "seating", summary: `Tirou ${ids.length} convidado(s) da mesa` }, tx);
      return { moved: ids.length };
    }
    const table = await ownTable(tx, ctx.weddingId, input.tableId);
    // Trava a mesa para atribuições concorrentes não estourarem a capacidade
    await tx.$queryRaw`SELECT id FROM "SeatingTable" WHERE id = ${table.id} FOR UPDATE`;
    const moving = await tx.guest.findMany({ where: { id: { in: ids } }, select: { id: true, tableId: true, companions: { where: { attending: true }, select: { id: true } } } });
    const already = await tx.guest.findMany({ where: { tableId: table.id, deletedAt: null, rsvpStatus: { not: "DECLINED" }, id: { notIn: ids } }, select: { companions: { where: { attending: true }, select: { id: true } } } });
    const used = already.reduce((s, g) => s + peopleOf(g), 0);
    const adding = moving.reduce((s, g) => s + peopleOf(g), 0);
    if (used + adding > table.capacity && !input.force) {
      throw new DomainError(`A mesa "${table.name}" tem ${table.capacity} lugares: já há ${used} e entrariam mais ${adding} pessoa(s).`, "CONFLICT");
    }
    let order = (await tx.guest.aggregate({ where: { tableId: table.id }, _max: { seatOrder: true } }))._max.seatOrder ?? 0;
    for (const g of moving) {
      if (g.tableId === table.id) continue;
      order += 1;
      await tx.guest.update({ where: { id: g.id }, data: { tableId: table.id, tableName: table.name, seatOrder: order } });
    }
    await audit(ctx.actor, { weddingId: ctx.weddingId, action: "update", entityType: "seating", entityId: table.id, summary: `Sentou ${adding} pessoa(s) na mesa "${table.name}"${used + adding > table.capacity ? " (acima da capacidade)" : ""}` }, tx);
    return { moved: moving.length, people: adding, over: used + adding > table.capacity };
  });
}

export async function reorderSeats(ctx: Ctx, tableId: string, guestIds: string[]) {
  await prisma.$transaction(async (tx) => {
    const t = await ownTable(tx, ctx.weddingId, tableId);
    const n = await tx.guest.count({ where: { id: { in: guestIds }, tableId: t.id } });
    assert(n === guestIds.length, "Convidado não está nesta mesa");
    for (const [i, id] of guestIds.entries()) await tx.guest.update({ where: { id }, data: { seatOrder: i + 1 } });
  });
}

// ───────────── Sugestão automática ─────────────

export type ArrangeProposal = { tableId: string; tableName: string; groupId: string; groupName: string; guestIds: string[]; people: number }[];

/**
 * Sugere distribuição dos convidados sem mesa: famílias inteiras juntas, agrupadas por lado/categoria,
 * maiores famílias primeiro (first-fit decreasing) respeitando a capacidade. Não grava nada.
 */
export function proposeArrangement(
  tables: { id: string; name: string; capacity: number; used: number; zone?: string | null }[],
  families: { groupId: string; groupName: string; side: string | null; category: string | null; guestIds: string[]; people: number }[],
) {
  const free = new Map(tables.map((t) => [t.id, t.capacity - t.used]));
  const sideOf = new Map<string, string | null>();
  const proposal: ArrangeProposal = [];
  const leftover: typeof families = [];
  const sorted = [...families].sort((a, b) => (a.side ?? "").localeCompare(b.side ?? "") || (a.category ?? "").localeCompare(b.category ?? "") || b.people - a.people);
  for (const f of sorted) {
    // Prefere mesa do mesmo lado que já tem gente; depois a mais vazia que comporta
    const candidates = tables.filter((t) => (free.get(t.id) ?? 0) >= f.people);
    const sameSide = candidates.filter((t) => sideOf.get(t.id) !== undefined && sideOf.get(t.id) === f.side).sort((a, b) => (free.get(a.id) ?? 0) - (free.get(b.id) ?? 0));
    const empty = candidates.filter((t) => sideOf.get(t.id) === undefined).sort((a, b) => (free.get(b.id) ?? 0) - (free.get(a.id) ?? 0));
    const pick = sameSide[0] ?? empty[0] ?? candidates.sort((a, b) => (free.get(a.id) ?? 0) - (free.get(b.id) ?? 0))[0];
    if (!pick) {
      leftover.push(f);
      continue;
    }
    free.set(pick.id, (free.get(pick.id) ?? 0) - f.people);
    if (!sideOf.has(pick.id)) sideOf.set(pick.id, f.side);
    proposal.push({ tableId: pick.id, tableName: pick.name, groupId: f.groupId, groupName: f.groupName, guestIds: f.guestIds, people: f.people });
  }
  return { proposal, leftover: leftover.map((f) => ({ groupId: f.groupId, groupName: f.groupName, people: f.people })) };
}

export async function suggestArrangement(weddingId: string, opts: { onlyConfirmed?: boolean } = {}) {
  const layout = await seatingLayout(weddingId);
  const pool = layout.unseated.filter((g) => (opts.onlyConfirmed === false ? g.rsvpStatus !== "DECLINED" : g.rsvpStatus === "ACCEPTED"));
  const byGroup = new Map<string, { groupId: string; groupName: string; side: string | null; category: string | null; guestIds: string[]; people: number }>();
  for (const g of pool) {
    const f = byGroup.get(g.groupId) ?? { groupId: g.groupId, groupName: g.groupName, side: g.side, category: g.category, guestIds: [], people: 0 };
    f.guestIds.push(g.id);
    f.people += g.people;
    f.side ??= g.side;
    f.category ??= g.category;
    byGroup.set(g.groupId, f);
  }
  return proposeArrangement(layout.tables, [...byGroup.values()]);
}

export async function applyArrangement(ctx: Ctx, proposal: { tableId: string; guestIds: string[] }[]) {
  let people = 0;
  for (const p of proposal) {
    const r = await assignGuests(ctx, { guestIds: p.guestIds, tableId: p.tableId });
    people += r.people ?? 0;
  }
  await audit(ctx.actor, { weddingId: ctx.weddingId, action: "update", entityType: "seating", summary: `Aplicou distribuição automática: ${people} pessoa(s) em ${new Set(proposal.map((p) => p.tableId)).size} mesa(s)` });
  return { people };
}
