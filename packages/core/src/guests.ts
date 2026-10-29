import { prisma, type RsvpStatus } from "@casa/db";
import { audit, type Actor } from "./audit.js";
import type { Ctx } from "./context.js";
import { decrypt, encrypt, randomToken, tokenHash } from "./crypto.js";
import { env } from "./env.js";
import { assert, DomainError, notFound } from "./errors.js";
import { getSetting } from "./settings.js";
import { weddingPhotoUrls } from "./photos.js";
import { notify } from "./notify.js";

/** Pessoas confirmadas = convidados que aceitaram + acompanhantes que vão */
export async function guestStats(weddingId: string) {
  const [byStatus, companions, children, groups, invitesSent] = await Promise.all([
    prisma.guest.groupBy({ by: ["rsvpStatus"], where: { weddingId, deletedAt: null }, _count: true }),
    prisma.guestCompanion.count({ where: { attending: true, guest: { weddingId, deletedAt: null, rsvpStatus: "ACCEPTED" } } }),
    prisma.guest.count({ where: { weddingId, deletedAt: null, rsvpStatus: "ACCEPTED", isChild: true } }),
    prisma.guestGroup.count({ where: { weddingId } }),
    prisma.guest.count({ where: { weddingId, deletedAt: null, inviteStatus: { not: "NOT_SENT" } } }),
  ]);
  const n = (s: RsvpStatus) => byStatus.find((b) => b.rsvpStatus === s)?._count ?? 0;
  const childCompanions = await prisma.guestCompanion.count({ where: { attending: true, isChild: true, guest: { weddingId, deletedAt: null, rsvpStatus: "ACCEPTED" } } });
  return {
    invited: n("PENDING") + n("ACCEPTED") + n("DECLINED"),
    accepted: n("ACCEPTED"),
    declined: n("DECLINED"),
    pending: n("PENDING"),
    companions,
    confirmedPeople: n("ACCEPTED") + companions,
    confirmedChildren: children + childCompanions,
    groups,
    invitesSent,
  };
}

// ───────────── Links de confirmação ─────────────

export const rsvpUrl = (token: string) => `${env().WEB_ORIGIN}/c/${token}`;

/** Cria um novo link para a família e revoga os anteriores */
export async function issueInvitation(ctx: Ctx, groupId: string) {
  const group = await prisma.guestGroup.findFirst({ where: { id: groupId, weddingId: ctx.weddingId } });
  if (!group) throw notFound("Família/grupo");
  const days = await getSetting(ctx.weddingId, "rsvp.linkValidityDays");
  const token = randomToken(24);
  const inv = await prisma.$transaction(async (tx) => {
    await tx.guestInvitation.updateMany({ where: { groupId, revokedAt: null }, data: { revokedAt: new Date() } });
    return tx.guestInvitation.create({ data: { weddingId: ctx.weddingId, groupId, tokenHash: tokenHash(token), tokenEnc: encrypt(token), expiresAt: new Date(Date.now() + days * 86400_000) } });
  });
  await audit(ctx.actor, { weddingId: ctx.weddingId, action: "create", entityType: "invitation", entityId: inv.id, summary: `Gerou link de confirmação para "${group.name}"` });
  return { ...inv, url: rsvpUrl(token) };
}

/** Link ativo (gera se não houver) */
export async function activeInvitation(ctx: Ctx, groupId: string) {
  const inv = await prisma.guestInvitation.findFirst({ where: { groupId, weddingId: ctx.weddingId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, orderBy: { createdAt: "desc" } });
  if (inv) return { ...inv, url: rsvpUrl(decrypt(inv.tokenEnc)) };
  return issueInvitation(ctx, groupId);
}

export async function revokeInvitation(ctx: Ctx, groupId: string) {
  const r = await prisma.guestInvitation.updateMany({ where: { groupId, weddingId: ctx.weddingId, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit(ctx.actor, { weddingId: ctx.weddingId, action: "revoke", entityType: "invitation", entityId: groupId, summary: `Revogou ${r.count} link(s) de confirmação` });
}

// ───────────── Portal público ─────────────

export class InvalidInvitation extends DomainError {
  constructor(reason: "invalid" | "expired" | "revoked") {
    super(reason === "expired" ? "Este link expirou. Peça um novo aos noivos." : reason === "revoked" ? "Este link não é mais válido. Peça um novo aos noivos." : "Link inválido", "NOT_FOUND");
  }
}

async function findByToken(token: string) {
  if (!/^[\w-]{20,64}$/.test(token)) throw new InvalidInvitation("invalid");
  const inv = await prisma.guestInvitation.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: {
      wedding: true,
      group: { include: { guests: { where: { deletedAt: null }, include: { companions: true }, orderBy: [{ isGroupLead: "desc" }, { createdAt: "asc" }] } } },
    },
  });
  if (!inv) throw new InvalidInvitation("invalid");
  if (inv.revokedAt) throw new InvalidInvitation("revoked");
  if (inv.expiresAt && inv.expiresAt < new Date()) throw new InvalidInvitation("expired");
  return inv;
}

export type PortalConfig = {
  title?: string; welcome?: string; arrivalInfo?: string; dressCode?: string; mapUrl?: string; giftInfo?: string; giftUrl?: string;
  closingMessage?: string; accentColor?: string; extraInfo?: string; showCeremony?: boolean; showReception?: boolean; heroImageFileId?: string | null;
};

/** Somente o necessário: dados públicos do evento e os membros DESTA família */
export async function portalView(token: string) {
  const inv = await findByToken(token);
  if (!inv.openedAt) await prisma.guestInvitation.update({ where: { id: inv.id }, data: { openedAt: new Date() } });
  await prisma.guest.updateMany({ where: { groupId: inv.groupId, inviteStatus: { in: ["NOT_SENT", "SENT", "DELIVERED"] } }, data: { inviteStatus: "OPENED" } });
  const w = inv.wedding;
  const cfg = (w.portalConfig ?? {}) as PortalConfig;
  const deadlinePassed = !!w.rsvpDeadline && w.rsvpDeadline < new Date();
  return {
    wedding: {
      partner1Name: w.partner1Name, partner2Name: w.partner2Name, date: w.date, timezone: w.timezone, city: w.city,
      ceremonyAddress: cfg.showCeremony === false ? null : w.ceremonyAddress, receptionAddress: cfg.showReception === false ? null : w.receptionAddress,
      rsvpDeadline: w.rsvpDeadline, config: cfg,
    },
    photos: await weddingPhotoUrls(w),
    group: { name: inv.group.name },
    guests: inv.group.guests.map((g) => ({
      id: g.id, fullName: g.fullName, isChild: g.isChild, rsvpStatus: g.rsvpStatus, plusOnesAllowed: g.plusOnesAllowed, dietary: g.dietary,
      companions: g.companions.map((c) => ({ name: c.name, isChild: c.isChild, dietary: c.dietary, attending: c.attending })),
    })),
    respondedAt: inv.respondedAt,
    deadlinePassed,
  };
}

export type RsvpSubmission = {
  submissionKey: string;
  message?: string | null;
  responses: { guestId: string; status: "ACCEPTED" | "DECLINED"; dietary?: string | null; companions: { name?: string | null; isChild?: boolean; dietary?: string | null }[] }[];
};

export async function submitRsvp(token: string, input: RsvpSubmission, meta: { ip?: string | null; userAgent?: string | null }) {
  const inv = await findByToken(token);
  if (inv.wedding.rsvpDeadline && inv.wedding.rsvpDeadline < new Date()) throw new DomainError("O prazo de confirmação terminou. Fale diretamente com os noivos.", "PRECONDITION_FAILED");
  assert(input.responses.length > 0, "Responda para ao menos uma pessoa");
  const members = new Map(inv.group.guests.map((g) => [g.id, g]));
  for (const r of input.responses) {
    const g = members.get(r.guestId);
    // Só pessoas desta família: impede alterar convidados de outro convite
    if (!g) throw new DomainError("Convidado não pertence a este convite", "FORBIDDEN");
    if (r.status === "ACCEPTED") assert(r.companions.length <= g.plusOnesAllowed, `${g.fullName} pode levar no máximo ${g.plusOnesAllowed} acompanhante(s)`);
  }
  // Envio repetido (duplo clique, reenvio do formulário): já registrado
  const dup = await prisma.rsvp.findFirst({ where: { submissionKey: input.submissionKey, guestId: { in: input.responses.map((r) => r.guestId) } } });
  if (dup) return { ok: true, duplicate: true };

  const actor: Actor = { userId: null, userName: `Portal: ${inv.group.name}`, ip: meta.ip, origin: "portal" };
  await prisma.$transaction(async (tx) => {
    for (const r of input.responses) {
      const companions = r.status === "ACCEPTED" ? r.companions : [];
      await tx.guest.update({ where: { id: r.guestId }, data: { rsvpStatus: r.status, rsvpAt: new Date(), dietary: r.dietary?.slice(0, 500) ?? null } });
      await tx.guestCompanion.deleteMany({ where: { guestId: r.guestId } });
      if (companions.length) {
        await tx.guestCompanion.createMany({ data: companions.map((c) => ({ guestId: r.guestId, name: c.name?.slice(0, 120) || null, isChild: !!c.isChild, dietary: c.dietary?.slice(0, 300) || null, attending: true })) });
      }
      await tx.rsvp.create({
        data: { invitationId: inv.id, guestId: r.guestId, status: r.status, companions: companions.length, source: "PORTAL", message: input.message?.slice(0, 1000) ?? null, ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null, submissionKey: input.submissionKey },
      });
    }
    await tx.guestInvitation.update({ where: { id: inv.id }, data: { respondedAt: new Date() } });
    const accepted = input.responses.filter((r) => r.status === "ACCEPTED");
    await audit(actor, {
      weddingId: inv.weddingId, action: "rsvp", entityType: "guestGroup", entityId: inv.groupId,
      summary: `${inv.group.name} respondeu: ${accepted.length} confirmado(s), ${input.responses.length - accepted.length} recusa(s), ${accepted.reduce((a, r) => a + r.companions.length, 0)} acompanhante(s)`,
    }, tx);
  });
  const acc = input.responses.filter((r) => r.status === "ACCEPTED");
  void notify(inv.weddingId, "rsvp", { title: `${inv.group.name} respondeu`, body: `${acc.length} confirmado(s)${acc.reduce((a, r) => a + r.companions.length, 0) ? ` + ${acc.reduce((a, r) => a + r.companions.length, 0)} acompanhante(s)` : ""}, ${input.responses.length - acc.length} recusa(s)`, url: "/convidados", dedupeKey: `rsvp:${inv.id}:${input.submissionKey}` });
  return { ok: true, duplicate: false };
}

/** Confirmação registrada pela equipe (telefone, pessoalmente, WhatsApp) */
export async function adminSetRsvp(ctx: Ctx, guestId: string, status: RsvpStatus, source: "ADMIN" | "WHATSAPP" = "ADMIN", companions?: { name?: string | null; isChild?: boolean; dietary?: string | null }[]) {
  const g = await prisma.guest.findFirst({ where: { id: guestId, weddingId: ctx.weddingId, deletedAt: null } });
  if (!g) throw notFound("Convidado");
  if (companions && status === "ACCEPTED") assert(companions.length <= g.plusOnesAllowed, `Máximo de ${g.plusOnesAllowed} acompanhante(s)`);
  await prisma.$transaction(async (tx) => {
    await tx.guest.update({ where: { id: guestId }, data: { rsvpStatus: status, rsvpAt: status === "PENDING" ? null : new Date() } });
    if (companions !== undefined || status !== "ACCEPTED") {
      await tx.guestCompanion.deleteMany({ where: { guestId } });
      if (status === "ACCEPTED" && companions?.length) await tx.guestCompanion.createMany({ data: companions.map((c) => ({ guestId, name: c.name ?? null, isChild: !!c.isChild, dietary: c.dietary ?? null })) });
    }
    await tx.rsvp.create({ data: { guestId, status, source, companions: companions?.length ?? 0 } });
    await audit(ctx.actor, { weddingId: ctx.weddingId, action: "rsvp", entityType: "guest", entityId: guestId, summary: `Marcou ${g.fullName} como ${status} (${source})`, changes: { rsvpStatus: { from: g.rsvpStatus, to: status } } }, tx);
  });
}

/** Normaliza nome para detecção de duplicidade */
export const nameKey = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
