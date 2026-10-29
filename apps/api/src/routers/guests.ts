import { activeInvitation, adminSetRsvp, audit, diff, guestStats, issueInvitation, nameKey, normalizePhone, revokeInvitation } from "@casa/core";
import { prisma, type Prisma } from "@casa/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { perm, router } from "../trpc.js";

const rsvp = z.enum(["PENDING", "ACCEPTED", "DECLINED"]);
const inviteStatus = z.enum(["NOT_SENT", "SENT", "DELIVERED", "OPENED"]);
const opt = (max = 300) => z.string().trim().max(max).nullable().optional();
const guestInput = z.object({
  fullName: z.string().trim().min(2).max(160), phone: opt(40), email: z.string().email().nullable().optional().or(z.literal("")), relation: opt(80), side: opt(10), category: opt(10),
  isChild: z.boolean().default(false), age: z.number().int().min(0).max(120).nullable().optional(), plusOnesAllowed: z.number().int().min(0).max(10).default(0),
  dietary: opt(500), accessibility: opt(500), tableName: opt(60), notes: opt(2000), isGroupLead: z.boolean().optional(),
});

async function ensureGroup(weddingId: string, groupId: string | null | undefined, newGroupName: string | null | undefined, fallbackName: string, phone: string | null, tx: Prisma.TransactionClient) {
  if (groupId) {
    const g = await tx.guestGroup.findFirst({ where: { id: groupId, weddingId } });
    if (!g) throw new TRPCError({ code: "BAD_REQUEST", message: "Família inválida" });
    return g;
  }
  return tx.guestGroup.create({ data: { weddingId, name: newGroupName?.trim() || fallbackName, contactPhone: phone } });
}

export const guestsRouter = router({
  stats: perm("guests:view").query(({ ctx }) => guestStats(ctx.weddingId)),

  list: perm("guests:view").input(z.object({
    rsvp: rsvp.optional(), inviteStatus: inviteStatus.optional(), groupId: z.string().optional(), side: z.string().optional(), category: z.string().optional(), search: z.string().optional(),
    isChild: z.boolean().optional(), deleted: z.boolean().optional(),
  }).optional()).query(({ ctx, input }) =>
    prisma.guest.findMany({
      where: {
        weddingId: ctx.weddingId, deletedAt: input?.deleted ? { not: null } : null,
        ...(input?.rsvp ? { rsvpStatus: input.rsvp } : {}), ...(input?.inviteStatus ? { inviteStatus: input.inviteStatus } : {}), ...(input?.groupId ? { groupId: input.groupId } : {}),
        ...(input?.side ? { side: input.side } : {}), ...(input?.category ? { category: input.category } : {}), ...(input?.isChild !== undefined ? { isChild: input.isChild } : {}),
        ...(input?.search ? { OR: [{ fullName: { contains: input.search, mode: "insensitive" } }, { group: { name: { contains: input.search, mode: "insensitive" } } }, { phone: { contains: input.search.replace(/\D/g, "") || "§" } }] } : {}),
      },
      include: { group: { select: { id: true, name: true } }, companions: true },
      orderBy: [{ group: { name: "asc" } }, { isGroupLead: "desc" }, { fullName: "asc" }],
    }),
  ),

  groups: perm("guests:view").query(async ({ ctx }) => {
    const groups = await prisma.guestGroup.findMany({
      where: { weddingId: ctx.weddingId },
      include: { guests: { where: { deletedAt: null }, select: { id: true, fullName: true, rsvpStatus: true, inviteStatus: true, isChild: true, plusOnesAllowed: true, _count: { select: { companions: { where: { attending: true } } } } } }, invitations: { where: { revokedAt: null }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, sentAt: true, openedAt: true, respondedAt: true, expiresAt: true } } },
      orderBy: { name: "asc" },
    });
    return groups.map((g) => ({
      ...g,
      confirmedPeople: g.guests.filter((x) => x.rsvpStatus === "ACCEPTED").reduce((a, x) => a + 1 + x._count.companions, 0),
      invitation: g.invitations[0] ?? null,
    }));
  }),

  get: perm("guests:view").input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const g = await prisma.guest.findFirst({ where: { id: input.id, weddingId: ctx.weddingId }, include: { group: { include: { guests: { where: { deletedAt: null }, select: { id: true, fullName: true } } } }, companions: true, rsvps: { orderBy: { createdAt: "desc" }, take: 30 } } });
    if (!g) throw new TRPCError({ code: "NOT_FOUND" });
    const [messages, inbound, history] = await Promise.all([
      ctx.permissions.has("whatsapp:view") ? prisma.outboundMessage.findMany({ where: { weddingId: ctx.weddingId, OR: [{ guestId: g.id }, { groupId: g.groupId }] }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, body: true, status: true, createdAt: true, toNumber: true } }) : [],
      ctx.permissions.has("whatsapp:view") ? prisma.inboundMessage.findMany({ where: { weddingId: ctx.weddingId, guestIds: { has: g.id } }, orderBy: { receivedAt: "desc" }, take: 30 }) : [],
      prisma.auditLog.findMany({ where: { weddingId: ctx.weddingId, OR: [{ entityType: "guest", entityId: g.id }, { entityType: "guestGroup", entityId: g.groupId }] }, orderBy: { createdAt: "desc" }, take: 30 }),
    ]);
    return { ...g, messages, inbound, history };
  }),

  /** Possíveis duplicados por nome normalizado (telefone NÃO indica duplicidade: famílias compartilham) */
  duplicates: perm("guests:view").query(async ({ ctx }) => {
    const guests = await prisma.guest.findMany({ where: { weddingId: ctx.weddingId, deletedAt: null }, select: { id: true, fullName: true, phone: true, group: { select: { name: true } } } });
    const byName = new Map<string, typeof guests>();
    for (const g of guests) byName.set(nameKey(g.fullName), [...(byName.get(nameKey(g.fullName)) ?? []), g]);
    return [...byName.values()].filter((l) => l.length > 1);
  }),

  save: perm("guests:create").input(guestInput.extend({ id: z.string().optional(), groupId: z.string().nullable().optional(), newGroupName: opt(160), ignoreDuplicates: z.boolean().optional() })).mutation(async ({ ctx, input }) => {
    const { id, groupId, newGroupName, ignoreDuplicates, ...raw } = input;
    const data = { ...raw, email: raw.email || null, phone: normalizePhone(raw.phone) ?? (raw.phone || null) };
    if (!ignoreDuplicates) {
      const same = await prisma.guest.findMany({ where: { weddingId: ctx.weddingId, deletedAt: null, id: id ? { not: id } : undefined }, select: { id: true, fullName: true } });
      const dups = same.filter((g) => nameKey(g.fullName) === nameKey(data.fullName));
      if (dups.length) throw new TRPCError({ code: "CONFLICT", message: `DUPLICATE:${JSON.stringify(dups)}` });
    }
    return prisma.$transaction(async (tx) => {
      if (id) {
        if (!ctx.permissions.has("guests:edit")) throw new TRPCError({ code: "FORBIDDEN" });
        const before = await tx.guest.findFirst({ where: { id, weddingId: ctx.weddingId } });
        if (!before) throw new TRPCError({ code: "NOT_FOUND" });
        const group = groupId !== undefined || newGroupName ? await ensureGroup(ctx.weddingId, groupId, newGroupName, data.fullName, data.phone, tx) : null;
        const companions = await tx.guestCompanion.count({ where: { guestId: id, attending: true } });
        if (data.plusOnesAllowed < companions) throw new TRPCError({ code: "BAD_REQUEST", message: `Já há ${companions} acompanhante(s) confirmados` });
        const g = await tx.guest.update({ where: { id }, data: { ...data, ...(group ? { groupId: group.id } : {}) } });
        await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "update", entityType: "guest", entityId: id, summary: `Editou convidado ${g.fullName}`, changes: diff(before as never, data as never) }, tx);
        return g;
      }
      const group = await ensureGroup(ctx.weddingId, groupId, newGroupName, data.fullName, data.phone, tx);
      const first = !(await tx.guest.count({ where: { groupId: group.id, deletedAt: null } }));
      const g = await tx.guest.create({ data: { ...data, weddingId: ctx.weddingId, groupId: group.id, isGroupLead: data.isGroupLead ?? first } });
      await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "create", entityType: "guest", entityId: g.id, summary: `Cadastrou convidado ${g.fullName} (${group.name})` }, tx);
      return g;
    });
  }),

  /** Cadastro em lote / importação. Linhas com mesmo "familia" vão para o mesmo grupo. */
  bulkCreate: perm("guests:create").input(z.object({
    rows: z.array(guestInput.extend({ family: z.string().trim().max(160).nullable().optional() })).min(1).max(2000),
    skipDuplicates: z.boolean().default(true),
  })).mutation(async ({ ctx, input }) => {
    const existing = new Set((await prisma.guest.findMany({ where: { weddingId: ctx.weddingId, deletedAt: null }, select: { fullName: true } })).map((g) => nameKey(g.fullName)));
    const groups = new Map((await prisma.guestGroup.findMany({ where: { weddingId: ctx.weddingId } })).map((g) => [nameKey(g.name), g.id]));
    let created = 0;
    const skipped: string[] = [];
    await prisma.$transaction(async (tx) => {
      for (const r of input.rows) {
        if (input.skipDuplicates && existing.has(nameKey(r.fullName))) {
          skipped.push(r.fullName);
          continue;
        }
        const phone = normalizePhone(r.phone) ?? (r.phone || null);
        const familyName = r.family?.trim() || r.fullName;
        let gid = groups.get(nameKey(familyName));
        if (!gid) {
          gid = (await tx.guestGroup.create({ data: { weddingId: ctx.weddingId, name: familyName, contactPhone: phone } })).id;
          groups.set(nameKey(familyName), gid);
        }
        const first = !(await tx.guest.count({ where: { groupId: gid } }));
        const { family: _f, ...data } = r;
        await tx.guest.create({ data: { ...data, email: data.email || null, phone, weddingId: ctx.weddingId, groupId: gid, isGroupLead: first } });
        existing.add(nameKey(r.fullName));
        created++;
      }
      await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "import", entityType: "guest", summary: `Importou ${created} convidado(s)${skipped.length ? `, ${skipped.length} ignorado(s) por duplicidade` : ""}` }, tx);
    }, { timeout: 60_000 });
    return { created, skipped };
  }),

  remove: perm("guests:delete").input(z.object({ id: z.string(), restore: z.boolean().optional() })).mutation(async ({ ctx, input }) => {
    const g = await prisma.guest.findFirst({ where: { id: input.id, weddingId: ctx.weddingId } });
    if (!g) throw new TRPCError({ code: "NOT_FOUND" });
    await prisma.guest.update({ where: { id: g.id }, data: { deletedAt: input.restore ? null : new Date() } });
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: input.restore ? "restore" : "delete", entityType: "guest", entityId: g.id, summary: `${input.restore ? "Restaurou" : "Removeu"} ${g.fullName} da lista` });
  }),

  setRsvp: perm("rsvp:edit").input(z.object({ guestId: z.string(), status: rsvp, companions: z.array(z.object({ name: z.string().max(120).nullable().optional(), isChild: z.boolean().optional(), dietary: z.string().max(300).nullable().optional() })).max(10).optional() })).mutation(({ ctx, input }) =>
    adminSetRsvp(ctx.svc, input.guestId, input.status, "ADMIN", input.companions),
  ),

  // ───── Famílias
  saveGroup: perm("guests:edit").input(z.object({ id: z.string().optional(), name: z.string().trim().min(2).max(160), contactPhone: opt(40), contactEmail: opt(200), side: opt(10), notes: opt(2000) })).mutation(async ({ ctx, input }) => {
    const { id, ...raw } = input;
    const data = { ...raw, contactPhone: normalizePhone(raw.contactPhone) ?? (raw.contactPhone || null) };
    if (id) {
      const r = await prisma.guestGroup.updateMany({ where: { id, weddingId: ctx.weddingId }, data });
      if (!r.count) throw new TRPCError({ code: "NOT_FOUND" });
      await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "update", entityType: "guestGroup", entityId: id, summary: `Editou família "${data.name}"` });
      return { id };
    }
    return prisma.guestGroup.create({ data: { ...data, weddingId: ctx.weddingId } });
  }),
  deleteGroup: perm("guests:delete").input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const g = await prisma.guestGroup.findFirst({ where: { id: input.id, weddingId: ctx.weddingId }, include: { _count: { select: { guests: true } } } });
    if (!g) throw new TRPCError({ code: "NOT_FOUND" });
    if (g._count.guests) throw new TRPCError({ code: "CONFLICT", message: "Remova ou mova os convidados antes" });
    await prisma.guestGroup.delete({ where: { id: g.id } });
  }),
  markInviteSent: perm("rsvp:edit").input(z.object({ groupId: z.string(), channel: z.string().max(40) })).mutation(async ({ ctx, input }) => {
    const r = await prisma.guest.updateMany({ where: { groupId: input.groupId, weddingId: ctx.weddingId, inviteStatus: "NOT_SENT" }, data: { inviteStatus: "SENT" } });
    await audit(ctx.svc.actor, { weddingId: ctx.weddingId, action: "update", entityType: "guestGroup", entityId: input.groupId, summary: `Marcou convite como enviado (${input.channel}) para ${r.count} pessoa(s)` });
  }),

  // ───── Links de confirmação
  invitationLink: perm("rsvp:view").input(z.object({ groupId: z.string() })).query(async ({ ctx, input }) => {
    const inv = await activeInvitation(ctx.svc, input.groupId);
    return { url: inv.url, expiresAt: inv.expiresAt, openedAt: inv.openedAt, respondedAt: inv.respondedAt };
  }),
  regenerateLink: perm("rsvp:edit").input(z.object({ groupId: z.string() })).mutation(async ({ ctx, input }) => {
    const inv = await issueInvitation(ctx.svc, input.groupId);
    return { url: inv.url, expiresAt: inv.expiresAt };
  }),
  revokeLink: perm("rsvp:edit").input(z.object({ groupId: z.string() })).mutation(({ ctx, input }) => revokeInvitation(ctx.svc, input.groupId)),

  /** Respostas recentes (para acompanhar confirmações) */
  recentRsvps: perm("rsvp:view").input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional()).query(({ ctx, input }) =>
    prisma.rsvp.findMany({ where: { guest: { weddingId: ctx.weddingId } }, include: { guest: { select: { fullName: true, group: { select: { name: true } } } } }, orderBy: { createdAt: "desc" }, take: input?.limit ?? 50 }),
  ),

  /** Lista final para buffet e cerimonialista: conta PESSOAS */
  finalList: perm("guests:view").query(async ({ ctx }) => {
    const guests = await prisma.guest.findMany({ where: { weddingId: ctx.weddingId, deletedAt: null, rsvpStatus: "ACCEPTED" }, include: { group: { select: { name: true } }, companions: { where: { attending: true } } }, orderBy: [{ tableName: "asc" }, { group: { name: "asc" } }, { fullName: "asc" }] });
    const people = guests.flatMap((g) => [
      { name: g.fullName, family: g.group.name, child: g.isChild, dietary: g.dietary, accessibility: g.accessibility, table: g.tableName, companionOf: null as string | null },
      ...g.companions.map((c) => ({ name: c.name ?? `Acompanhante de ${g.fullName}`, family: g.group.name, child: c.isChild, dietary: c.dietary, accessibility: null, table: g.tableName, companionOf: g.fullName })),
    ]);
    return { total: people.length, adults: people.filter((p) => !p.child).length, children: people.filter((p) => p.child).length, withDietary: people.filter((p) => p.dietary).length, people };
  }),
});
