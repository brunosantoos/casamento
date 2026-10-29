import { prisma, type MessageStatus, type Prisma } from "@casa/db";
import { audit, securityEvent, type Actor } from "../audit.js";
import type { Ctx } from "../context.js";
import { decrypt, randomToken, sha256, tokenHash } from "../crypto.js";
import { env } from "../env.js";
import { assert, notFound } from "../errors.js";
import { activeInvitation, adminSetRsvp } from "../guests.js";
import { getIntegration } from "../integrations.js";
import { normalizePhone } from "../phone.js";
import { cancelJobs, enqueue } from "../queue.js";
import { getSetting } from "../settings.js";
import { notify } from "../notify.js";
import { evolution, EvolutionError, evolutionConfig } from "./evolution.js";

// ───────────── Modelos ─────────────

export const TEMPLATE_VARS = ["nome", "familia", "link", "data", "noivos", "local"] as const;

export function renderTemplate(body: string, vars: Partial<Record<(typeof TEMPLATE_VARS)[number], string>>) {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (k in vars ? (vars as Record<string, string>)[k] ?? "" : m));
}

async function weddingVars(weddingId: string) {
  const w = await prisma.wedding.findUniqueOrThrow({ where: { id: weddingId } });
  const data = w.date ? new Intl.DateTimeFormat("pt-BR", { timeZone: w.timezone, dateStyle: "long", timeStyle: "short" }).format(w.date) : "data a definir";
  return { noivos: `${w.partner1Name} & ${w.partner2Name}`, data, local: w.ceremonyAddress ?? w.receptionAddress ?? w.city ?? "" };
}

// ───────────── Destinatários ─────────────

export type Criteria = {
  rsvp?: ("PENDING" | "ACCEPTED" | "DECLINED")[];
  inviteStatus?: ("NOT_SENT" | "SENT" | "DELIVERED" | "OPENED")[];
  groupIds?: string[];
  side?: string | null;
  category?: string | null;
  /** true: uma mensagem por família (para o responsável/primeiro telefone) */
  perFamily?: boolean;
};

/**
 * Seleciona destinatários. Telefone compartilhado por várias pessoas da mesma família
 * recebe UMA mensagem (dedupe por família+telefone).
 */
export async function resolveRecipients(ctx: Ctx, criteria: Criteria) {
  const guests = await prisma.guest.findMany({
    where: {
      weddingId: ctx.weddingId, deletedAt: null,
      ...(criteria.rsvp?.length ? { rsvpStatus: { in: criteria.rsvp } } : {}),
      ...(criteria.inviteStatus?.length ? { inviteStatus: { in: criteria.inviteStatus } } : {}),
      ...(criteria.groupIds?.length ? { groupId: { in: criteria.groupIds } } : {}),
      ...(criteria.side ? { side: criteria.side } : {}),
      ...(criteria.category ? { category: criteria.category } : {}),
    },
    include: { group: true },
    orderBy: [{ group: { name: "asc" } }, { isGroupLead: "desc" }, { createdAt: "asc" }],
  });
  const seen = new Set<string>();
  const recipients: { guestId: string; groupId: string; name: string; family: string; phone: string }[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const g of guests) {
    const phone = normalizePhone(g.phone ?? g.group.contactPhone);
    if (!phone) {
      skipped.push({ name: g.fullName, reason: "sem telefone válido" });
      continue;
    }
    const key = criteria.perFamily !== false ? g.groupId : `${g.groupId}:${phone}`;
    if (seen.has(key) || seen.has(`${g.groupId}:${phone}`)) continue;
    seen.add(key);
    seen.add(`${g.groupId}:${phone}`);
    recipients.push({ guestId: g.id, groupId: g.groupId, name: g.fullName.split(" ")[0]!, family: g.group.name, phone });
  }
  return { recipients, skipped };
}

export async function previewCampaign(ctx: Ctx, input: { body: string; criteria: Criteria }) {
  const { recipients, skipped } = await resolveRecipients(ctx, input.criteria);
  const base = await weddingVars(ctx.weddingId);
  const needsLink = input.body.includes("{{link}}");
  const samples = [];
  for (const r of recipients.slice(0, 3)) {
    // Prévia não cria nada: usa o link existente ou um marcador (o link é gerado só na confirmação)
    const link = needsLink ? ((await invitationLinkFor(ctx.weddingId, r.groupId)) ?? "[link gerado no envio]") : "";
    samples.push({ to: r.phone, name: r.name, text: renderTemplate(input.body, { ...base, nome: r.name, familia: r.family, link }) });
  }
  const limit = await getSetting(ctx.weddingId, "whatsapp.dailyLimit");
  const sentToday = await prisma.outboundMessage.count({ where: { weddingId: ctx.weddingId, createdAt: { gte: startOfToday() }, status: { not: "CANCELLED" } } });
  return { total: recipients.length, recipients: recipients.slice(0, 500), skipped, samples, dailyLimit: limit, sentToday, exceedsLimit: sentToday + recipients.length > limit };
}

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export async function createCampaign(ctx: Ctx, input: { name: string; body: string; templateId?: string | null; criteria: Criteria }) {
  assert(input.body.trim(), "Mensagem vazia");
  const c = await prisma.messageCampaign.create({
    data: { weddingId: ctx.weddingId, name: input.name, body: input.body, templateId: input.templateId ?? null, criteria: input.criteria as Prisma.InputJsonValue, createdById: ctx.actor.userId },
  });
  await audit(ctx.actor, { weddingId: ctx.weddingId, action: "create", entityType: "campaign", entityId: c.id, summary: `Criou campanha "${c.name}" (rascunho)` });
  return c;
}

/** Disparo só após confirmação explícita de quem tem whatsapp:approve */
export async function confirmCampaign(ctx: Ctx, campaignId: string) {
  const c = await prisma.messageCampaign.findFirst({ where: { id: campaignId, weddingId: ctx.weddingId } });
  if (!c) throw notFound("Campanha");
  assert(c.status === "DRAFT", "Esta campanha já foi disparada ou cancelada", "CONFLICT");
  const { recipients } = await resolveRecipients(ctx, c.criteria as Criteria);
  assert(recipients.length > 0, "Nenhum destinatário com telefone válido");
  const limit = await getSetting(ctx.weddingId, "whatsapp.dailyLimit");
  const sentToday = await prisma.outboundMessage.count({ where: { weddingId: ctx.weddingId, createdAt: { gte: startOfToday() }, status: { not: "CANCELLED" } } });
  assert(sentToday + recipients.length <= limit, `Limite diário de ${limit} mensagens seria ultrapassado (${sentToday} já hoje). Ajuste em Configurações ou divida a campanha.`, "PRECONDITION_FAILED");

  const base = await weddingVars(ctx.weddingId);
  const needsLink = c.body.includes("{{link}}");
  const maxAttempts = await getSetting(ctx.weddingId, "whatsapp.maxAttempts");
  const created: string[] = [];
  for (const r of recipients) {
    const link = needsLink ? (await activeInvitation(ctx, r.groupId)).url : "";
    const msg = await prisma.outboundMessage.upsert({
      where: { idempotencyKey: `${c.id}:${r.groupId}:${r.phone}` },
      create: {
        weddingId: ctx.weddingId, campaignId: c.id, guestId: r.guestId, groupId: r.groupId, toNumber: r.phone,
        body: renderTemplate(c.body, { ...base, nome: r.name, familia: r.family, link }), idempotencyKey: `${c.id}:${r.groupId}:${r.phone}`, createdById: ctx.actor.userId,
      },
      update: {},
    });
    await enqueue("whatsapp.send", { messageId: msg.id }, { uniqueKey: `wa:${msg.id}:1`, maxAttempts });
    created.push(msg.id);
  }
  // Atualização condicional: duas confirmações simultâneas não disparam duas vezes
  const upd = await prisma.messageCampaign.updateMany({ where: { id: c.id, status: "DRAFT" }, data: { status: "QUEUED", confirmedById: ctx.actor.userId, confirmedAt: new Date() } });
  assert(upd.count === 1, "Campanha já confirmada", "CONFLICT");
  await audit(ctx.actor, { weddingId: ctx.weddingId, action: "send", entityType: "campaign", entityId: c.id, summary: `Confirmou envio da campanha "${c.name}" para ${created.length} destinatário(s)` });
  return { queued: created.length };
}

export async function cancelCampaign(ctx: Ctx, campaignId: string) {
  const c = await prisma.messageCampaign.findFirst({ where: { id: campaignId, weddingId: ctx.weddingId } });
  if (!c) throw notFound("Campanha");
  assert(c.status !== "COMPLETED" && c.status !== "CANCELLED", "Campanha já finalizada", "CONFLICT");
  const pending = await prisma.outboundMessage.findMany({ where: { campaignId, status: "PENDING" }, select: { id: true } });
  await prisma.$transaction([
    prisma.messageCampaign.update({ where: { id: campaignId }, data: { status: "CANCELLED", cancelledAt: new Date() } }),
    prisma.outboundMessage.updateMany({ where: { campaignId, status: "PENDING" }, data: { status: "CANCELLED" } }),
  ]);
  await cancelJobs({ type: "whatsapp.send", uniqueKey: { in: pending.map((p) => `wa:${p.id}:1`) } });
  await audit(ctx.actor, { weddingId: ctx.weddingId, action: "cancel", entityType: "campaign", entityId: campaignId, summary: `Cancelou campanha "${c.name}" (${pending.length} mensagem(ns) pendentes canceladas)` });
  return { cancelled: pending.length };
}

/** Mensagem individual (convidado ou fornecedor) */
export async function sendSingle(ctx: Ctx, input: { to: string; body: string; guestId?: string | null; vendorId?: string | null; idempotencyKey: string }) {
  const phone = normalizePhone(input.to);
  assert(phone, "Telefone inválido");
  assert(input.body.trim(), "Mensagem vazia");
  if (input.guestId) assert(await prisma.guest.count({ where: { id: input.guestId, weddingId: ctx.weddingId } }), "Convidado inválido", "NOT_FOUND");
  if (input.vendorId) assert(await prisma.vendor.count({ where: { id: input.vendorId, weddingId: ctx.weddingId } }), "Fornecedor inválido", "NOT_FOUND");
  const key = `single:${ctx.weddingId}:${input.idempotencyKey}`;
  const existing = await prisma.outboundMessage.findUnique({ where: { idempotencyKey: key } });
  if (existing) return existing;
  const msg = await prisma.outboundMessage.create({
    data: { weddingId: ctx.weddingId, toNumber: phone, body: input.body, guestId: input.guestId ?? null, vendorId: input.vendorId ?? null, idempotencyKey: key, createdById: ctx.actor.userId },
  });
  await enqueue("whatsapp.send", { messageId: msg.id }, { uniqueKey: `wa:${msg.id}:1`, maxAttempts: await getSetting(ctx.weddingId, "whatsapp.maxAttempts") });
  await audit(ctx.actor, { weddingId: ctx.weddingId, action: "send", entityType: "message", entityId: msg.id, summary: `Enfileirou mensagem individual para ${phone}` });
  return msg;
}

/** Reprocessar falha: nova tentativa explícita (nova chave de job, mesma mensagem) */
export async function retryMessage(ctx: Ctx, id: string) {
  const m = await prisma.outboundMessage.findFirst({ where: { id, weddingId: ctx.weddingId } });
  if (!m) throw notFound("Mensagem");
  assert(m.status === "FAILED", "Só mensagens com falha podem ser reprocessadas", "CONFLICT");
  assert(!m.providerMessageId, "A Evolution já aceitou esta mensagem; reenviar duplicaria", "CONFLICT");
  await prisma.outboundMessage.update({ where: { id }, data: { status: "PENDING", nextAttemptAt: new Date(), lastError: null } });
  await enqueue("whatsapp.send", { messageId: id }, { uniqueKey: `wa:${id}:retry:${Date.now()}`, maxAttempts: await getSetting(ctx.weddingId, "whatsapp.maxAttempts") });
  await audit(ctx.actor, { weddingId: ctx.weddingId, action: "retry", entityType: "message", entityId: id, summary: `Reprocessou mensagem para ${m.toNumber}` });
}

// ───────────── Processamento (worker) ─────────────

function minutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

/** Próximo instante permitido dentro da janela de envio, no fuso do casamento */
export function nextAllowedTime(now: Date, tz: string, window: { start: string; end: string }) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  const cur = minutes(parts);
  const start = minutes(window.start);
  const end = minutes(window.end);
  if (cur >= start && cur < end) return null;
  const wait = cur < start ? start - cur : 24 * 60 - cur + start;
  return new Date(now.getTime() + wait * 60_000);
}

export type SendOutcome = { kind: "sent" } | { kind: "skip"; reason: string } | { kind: "reschedule"; at: Date; reason: string } | { kind: "retry"; error: string } | { kind: "failed"; error: string };

export async function processSendJob(messageId: string, attempt: number, maxAttempts: number): Promise<SendOutcome> {
  const m = await prisma.outboundMessage.findUnique({ where: { id: messageId }, include: { wedding: true, campaign: true } });
  if (!m) return { kind: "skip", reason: "mensagem removida" };
  if (m.status === "CANCELLED" || m.campaign?.status === "CANCELLED") return { kind: "skip", reason: "cancelada" };
  if (m.providerMessageId || !["PENDING", "SENDING"].includes(m.status)) return { kind: "skip", reason: `já processada (${m.status})` };
  if (m.status === "SENDING") {
    // Um worker caiu no meio do envio: não sabemos se a Evolution aceitou. Não reenviar automaticamente.
    await prisma.outboundMessage.update({ where: { id: m.id }, data: { status: "FAILED", lastError: "Estado incerto após interrupção — confira no WhatsApp antes de reprocessar" } });
    return { kind: "failed", error: "estado incerto" };
  }

  const window = await getSetting(m.weddingId, "whatsapp.allowedHours");
  const next = nextAllowedTime(new Date(), m.wedding.timezone, window);
  if (next) return { kind: "reschedule", at: next, reason: "fora do horário permitido" };

  const minInterval = await getSetting(m.weddingId, "whatsapp.minIntervalSeconds");
  const last = await prisma.outboundMessage.findFirst({ where: { weddingId: m.weddingId, sentAt: { not: null } }, orderBy: { sentAt: "desc" }, select: { sentAt: true } });
  if (last?.sentAt && Date.now() - last.sentAt.getTime() < minInterval * 1000) {
    return { kind: "reschedule", at: new Date(last.sentAt.getTime() + minInterval * 1000 + Math.random() * 2000), reason: "intervalo mínimo" };
  }

  const instance = await prisma.whatsAppInstance.findFirst({ where: { weddingId: m.weddingId }, orderBy: { createdAt: "desc" } });
  const fail = async (error: string, permanent: boolean, httpStatus?: number) => {
    await prisma.messageAttempt.create({ data: { messageId: m.id, ok: false, error, httpStatus } });
    const final = permanent || attempt >= maxAttempts;
    await prisma.outboundMessage.update({ where: { id: m.id }, data: { status: final ? "FAILED" : "PENDING", attempts: { increment: 1 }, lastError: error } });
    if (final && m.campaignId) await finishCampaignIfDone(m.campaignId);
    return final ? ({ kind: "failed", error } as const) : ({ kind: "retry", error } as const);
  };
  if (!instance) return fail("WhatsApp não conectado (nenhuma instância)", false);
  if (instance.state !== "OPEN") return fail("WhatsApp desconectado", false);

  let cfg;
  try {
    cfg = await evolutionConfig(m.weddingId);
  } catch (e) {
    return fail((e as Error).message, false);
  }

  // Marca SENDING de forma condicional: só um worker envia
  const claimed = await prisma.outboundMessage.updateMany({ where: { id: m.id, status: "PENDING" }, data: { status: "SENDING" } });
  if (claimed.count === 0) return { kind: "skip", reason: "outro worker está enviando" };
  try {
    const res = await evolution.sendText(cfg, instance.name, m.toNumber, m.body);
    const providerId = res.key?.id ?? null;
    await prisma.$transaction([
      prisma.messageAttempt.create({ data: { messageId: m.id, ok: true, httpStatus: 201 } }),
      // "Aceita" = a Evolution recebeu. Entregue/lida só chegam por webhook.
      prisma.outboundMessage.update({ where: { id: m.id }, data: { status: "ACCEPTED", providerMessageId: providerId, sentAt: new Date(), attempts: { increment: 1 }, lastError: null } }),
    ]);
    if (m.guestId) await prisma.guest.updateMany({ where: { id: m.guestId, inviteStatus: "NOT_SENT" }, data: { inviteStatus: "SENT" } });
    if (m.groupId) {
      await prisma.guest.updateMany({ where: { groupId: m.groupId, inviteStatus: "NOT_SENT" }, data: { inviteStatus: "SENT" } });
      await prisma.guestInvitation.updateMany({ where: { groupId: m.groupId, revokedAt: null, sentAt: null }, data: { sentAt: new Date() } });
    }
    if (m.campaignId) {
      await prisma.messageCampaign.updateMany({ where: { id: m.campaignId, status: "QUEUED" }, data: { status: "RUNNING" } });
      await finishCampaignIfDone(m.campaignId);
    }
    return { kind: "sent" };
  } catch (e) {
    await prisma.outboundMessage.update({ where: { id: m.id }, data: { status: "PENDING" } });
    const err = e as Error;
    const permanent = e instanceof EvolutionError && e.permanent;
    return fail(err.message.slice(0, 500), permanent, e instanceof EvolutionError ? e.status : undefined);
  }
}

async function finishCampaignIfDone(campaignId: string) {
  const open = await prisma.outboundMessage.count({ where: { campaignId, status: { in: ["PENDING", "SENDING"] } } });
  if (!open) await prisma.messageCampaign.updateMany({ where: { id: campaignId, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "COMPLETED" } });
}

// ───────────── Instância ─────────────

export async function webhookUrlFor(weddingId: string, token: string) {
  const i = await getIntegration(weddingId, "EVOLUTION");
  const base = ((i?.config as { webhookBaseUrl?: string } | null)?.webhookBaseUrl || env().API_URL).replace(/\/+$/, "");
  return `${base}/webhooks/evolution/${token}`;
}

export async function connectInstance(ctx: Ctx) {
  const cfg = await evolutionConfig(ctx.weddingId);
  let inst = await prisma.whatsAppInstance.findFirst({ where: { weddingId: ctx.weddingId }, orderBy: { createdAt: "desc" } });
  // O token do webhook só existe em claro neste momento; guardamos o hash
  const token = randomToken(24);
  const url = await webhookUrlFor(ctx.weddingId, token);
  if (!inst) {
    const name = `casamento-${ctx.weddingId.slice(-10)}`;
    const res = await evolution.createInstance(cfg, name, url);
    inst = await prisma.whatsAppInstance.create({ data: { weddingId: ctx.weddingId, name, webhookTokenHash: tokenHash(token), state: "CONNECTING", lastQr: res.qrcode?.base64 ?? null } });
    await audit(ctx.actor, { weddingId: ctx.weddingId, action: "create", entityType: "whatsapp", entityId: inst.id, summary: `Criou instância ${name} na Evolution` });
    return { qr: res.qrcode?.base64 ?? null, pairingCode: res.qrcode?.pairingCode ?? null };
  }
  await evolution.setWebhook(cfg, inst.name, url);
  const qr = await evolution.connect(cfg, inst.name);
  await prisma.whatsAppInstance.update({ where: { id: inst.id }, data: { webhookTokenHash: tokenHash(token), state: qr.base64 ? "CONNECTING" : inst.state, lastQr: qr.base64 ?? null } });
  return { qr: qr.base64 ?? null, pairingCode: qr.pairingCode ?? null };
}

export async function refreshInstanceState(weddingId: string) {
  const inst = await prisma.whatsAppInstance.findFirst({ where: { weddingId }, orderBy: { createdAt: "desc" } });
  if (!inst) return null;
  try {
    const cfg = await evolutionConfig(weddingId);
    const s = await evolution.connectionState(cfg, inst.name);
    const state = s.instance.state === "open" ? "OPEN" : s.instance.state === "connecting" ? "CONNECTING" : "CLOSED";
    return prisma.whatsAppInstance.update({ where: { id: inst.id }, data: { state, lastCheckedAt: new Date(), ...(state === "OPEN" ? { lastQr: null } : {}) } });
  } catch (e) {
    return { ...inst, error: (e as Error).message };
  }
}

export async function disconnectInstance(ctx: Ctx) {
  const inst = await prisma.whatsAppInstance.findFirst({ where: { weddingId: ctx.weddingId }, orderBy: { createdAt: "desc" } });
  if (!inst) return;
  const cfg = await evolutionConfig(ctx.weddingId);
  await evolution.logout(cfg, inst.name).catch(() => undefined);
  await prisma.whatsAppInstance.update({ where: { id: inst.id }, data: { state: "CLOSED", lastQr: null } });
  await audit(ctx.actor, { weddingId: ctx.weddingId, action: "update", entityType: "whatsapp", entityId: inst.id, summary: "Desconectou o WhatsApp" });
}

// ───────────── Webhook ─────────────

const STATUS_RANK: Record<MessageStatus, number> = { PENDING: 0, SENDING: 1, FAILED: 1, CANCELLED: 1, ACCEPTED: 2, DELIVERED: 3, READ: 4, REPLIED: 5 };
const ACK_MAP: Record<string, MessageStatus> = { SERVER_ACK: "ACCEPTED", DELIVERY_ACK: "DELIVERED", READ: "READ", PLAYED: "READ" };

type WebhookBody = { event?: string; instance?: string; data?: any };

const YES = /^\s*(sim|confirmo|confirmado|confirmada|vou|vamos|estarei|estaremos|presente|s)\b/i;
const NO = /^\s*(n[aã]o|nao vou|n[aã]o poderei|infelizmente)\b/i;

/**
 * Valida o token da URL (hash), registra o evento bruto com chave de idempotência
 * e aplica os efeitos. Eventos repetidos são ignorados.
 */
export async function handleEvolutionWebhook(token: string, body: WebhookBody, meta: { ip?: string | null }) {
  if (!/^[\w-]{20,64}$/.test(token)) return { status: 404 as const };
  const instance = await prisma.whatsAppInstance.findUnique({ where: { webhookTokenHash: tokenHash(token) } });
  if (!instance) {
    await securityEvent("invalid_webhook", { ip: meta.ip, details: { reason: "token desconhecido" } });
    return { status: 404 as const };
  }
  const event = String(body?.event ?? "").toLowerCase().replace(/_/g, ".");
  if (!event || body.data === undefined) return { status: 400 as const };
  if (body.instance && body.instance !== instance.name) {
    await securityEvent("invalid_webhook", { weddingId: instance.weddingId, ip: meta.ip, details: { reason: "instância divergente", got: body.instance } });
    return { status: 403 as const };
  }
  const data = body.data;
  const eventKey = sha256(`${instance.id}:${event}:${JSON.stringify(data?.key ?? data?.keyId ?? data?.messageId ?? "")}:${data?.status ?? ""}:${data?.state ?? ""}:${event.startsWith("qrcode") ? Date.now() : ""}`);
  try {
    await prisma.webhookEvent.create({ data: { instanceId: instance.id, eventKey, event, payload: (redactPayload(data) ?? {}) as Prisma.InputJsonValue } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return { status: 200 as const, duplicate: true };
    throw e;
  }
  try {
    await applyEvent(instance, event, data);
    await prisma.webhookEvent.update({ where: { eventKey }, data: { processedAt: new Date() } });
  } catch (e) {
    await prisma.webhookEvent.update({ where: { eventKey }, data: { error: (e as Error).message.slice(0, 500) } });
    console.error("[webhook]", event, e);
  }
  return { status: 200 as const };
}

/** Mantém só o necessário do payload (sem mídia/base64) */
function redactPayload(data: any) {
  if (!data || typeof data !== "object") return data;
  const { message, ...rest } = data;
  return { ...rest, text: message?.conversation ?? message?.extendedTextMessage?.text ?? undefined };
}

async function applyEvent(instance: { id: string; weddingId: string; state: string }, event: string, data: any) {
  switch (event) {
    case "qrcode.updated":
      await prisma.whatsAppInstance.update({ where: { id: instance.id }, data: { lastQr: data?.qrcode?.base64 ?? null, state: "CONNECTING" } });
      return;
    case "connection.update": {
      const state = data?.state === "open" ? "OPEN" : data?.state === "connecting" ? "CONNECTING" : data?.state === "close" ? "CLOSED" : null;
      if (state) await prisma.whatsAppInstance.update({ where: { id: instance.id }, data: { state, ...(data?.wuid ? { ownerJid: data.wuid } : {}), ...(data?.profileName ? { profileName: data.profileName } : {}), ...(state === "OPEN" ? { lastQr: null } : {}) } });
      return;
    }
    case "messages.update": {
      const items = Array.isArray(data) ? data : [data];
      for (const u of items) {
        const id = u?.keyId ?? u?.key?.id ?? u?.messageId;
        const status = ACK_MAP[String(u?.status ?? u?.update?.status ?? "")];
        if (!id || !status) continue;
        const msg = await prisma.outboundMessage.findUnique({ where: { providerMessageId: id } });
        if (!msg || msg.weddingId !== instance.weddingId) continue;
        // Status só avança (eventos fora de ordem não regridem)
        if (STATUS_RANK[status] <= STATUS_RANK[msg.status]) continue;
        await prisma.outboundMessage.update({ where: { id: msg.id }, data: { status, ...(status === "DELIVERED" ? { deliveredAt: new Date() } : {}), ...(status === "READ" ? { readAt: new Date() } : {}) } });
        if (msg.groupId && (status === "DELIVERED" || status === "READ")) {
          await prisma.guest.updateMany({ where: { groupId: msg.groupId, inviteStatus: { in: ["NOT_SENT", "SENT"] } }, data: { inviteStatus: "DELIVERED" } });
        }
      }
      return;
    }
    case "messages.upsert": {
      const raw = data;
      if (!raw?.key?.id || raw.key.fromMe || String(raw.key.remoteJid ?? "").endsWith("@g.us")) return;
      const from = String(raw.key.remoteJidAlt ?? raw.key.remoteJid).split("@")[0]!.replace(/\D/g, "");
      const text: string | null = raw.message?.conversation ?? raw.message?.extendedTextMessage?.text ?? null;
      const guests = await prisma.guest.findMany({ where: { weddingId: instance.weddingId, deletedAt: null, OR: [{ phone: from }, { group: { contactPhone: from } }] }, select: { id: true, groupId: true, rsvpStatus: true } });
      const vendor = await prisma.vendor.findFirst({ where: { weddingId: instance.weddingId, OR: [{ whatsapp: from }, { phone: from }] }, select: { id: true } });
      const inbound = await prisma.inboundMessage.upsert({
        where: { providerMessageId: raw.key.id },
        create: { weddingId: instance.weddingId, providerMessageId: raw.key.id, fromNumber: from, pushName: raw.pushName ?? null, body: text, receivedAt: new Date(Number(raw.messageTimestamp ?? Date.now() / 1000) * 1000), guestIds: guests.map((g) => g.id), vendorId: vendor?.id ?? null },
        update: {},
      });
      // A última mensagem enviada para este número foi respondida
      const lastOut = await prisma.outboundMessage.findFirst({ where: { weddingId: instance.weddingId, toNumber: from, status: { in: ["ACCEPTED", "DELIVERED", "READ"] } }, orderBy: { sentAt: "desc" } });
      if (lastOut) await prisma.outboundMessage.update({ where: { id: lastOut.id }, data: { status: "REPLIED", repliedAt: inbound.receivedAt } });
      void notify(instance.weddingId, "whatsapp_reply", { title: `WhatsApp: ${raw.pushName ?? from}`, body: (text ?? "[mídia]").slice(0, 140), url: "/whatsapp", dedupeKey: `wa-in:${raw.key.id}` });
      if (vendor) await prisma.vendorInteraction.create({ data: { vendorId: vendor.id, type: "whatsapp", occurredAt: inbound.receivedAt, summary: (text ?? "[mídia]").slice(0, 500) } });

      // Opcional (desligado por padrão): "sim"/"não" de uma única família vira confirmação
      if (text && (await getSetting(instance.weddingId, "whatsapp.autoRsvpFromReplies"))) {
        const groups = [...new Set(guests.map((g) => g.groupId))];
        const status = YES.test(text) ? "ACCEPTED" : NO.test(text) ? "DECLINED" : null;
        if (status && groups.length === 1) {
          const actor: Actor = { userId: null, userName: "WhatsApp", origin: "webhook" };
          const ctx: Ctx = { weddingId: instance.weddingId, actor, permissions: new Set() };
          for (const g of guests.filter((x) => x.rsvpStatus === "PENDING")) await adminSetRsvp(ctx, g.id, status, "WHATSAPP");
        }
      }
      return;
    }
    case "send.message":
      return;
  }
}

/** Link atual de confirmação (para mostrar no painel) */
export async function invitationLinkFor(weddingId: string, groupId: string) {
  const inv = await prisma.guestInvitation.findFirst({ where: { weddingId, groupId, revokedAt: null }, orderBy: { createdAt: "desc" } });
  return inv ? `${env().WEB_ORIGIN}/c/${decrypt(inv.tokenEnc)}` : null;
}

