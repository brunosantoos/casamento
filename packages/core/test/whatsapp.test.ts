import { prisma } from "@casa/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tokenHash } from "../src/crypto.js";
import { saveIntegration } from "../src/integrations.js";
import { setSetting } from "../src/settings.js";
import { cancelCampaign, confirmCampaign, createCampaign, handleEvolutionWebhook, nextAllowedTime, previewCampaign, processSendJob, resolveRecipients } from "../src/whatsapp/service.js";
import { makeWedding, resetDb } from "./helpers.js";

const TOKEN = "webhook-token-abcdefghijklmnopqrstuvwxyz";

async function setup(state: "OPEN" | "CLOSED" = "OPEN") {
  const w = await makeWedding();
  await saveIntegration(w.ctx.actor, w.ctx.weddingId, "EVOLUTION", { enabled: true, config: { baseUrl: "http://evolution.test" }, secrets: { apiKey: "evo-secret-key-123" } });
  // Janela 24h e sem intervalo: testes independem do relógio
  await setSetting(w.ctx.weddingId, "whatsapp.allowedHours", { start: "00:00", end: "23:59" }, w.ctx.actor);
  await setSetting(w.ctx.weddingId, "whatsapp.minIntervalSeconds", 1, w.ctx.actor);
  const instance = await prisma.whatsAppInstance.create({ data: { weddingId: w.ctx.weddingId, name: "casamento-teste", state, webhookTokenHash: tokenHash(TOKEN) } });
  const g1 = await prisma.guestGroup.create({ data: { weddingId: w.ctx.weddingId, name: "Família Um" } });
  const g2 = await prisma.guestGroup.create({ data: { weddingId: w.ctx.weddingId, name: "Família Dois" } });
  // Duas pessoas da família 1 compartilham o número → uma mensagem só
  await prisma.guest.createMany({ data: [
    { weddingId: w.ctx.weddingId, groupId: g1.id, fullName: "Ana Um", phone: "5511900000001" },
    { weddingId: w.ctx.weddingId, groupId: g1.id, fullName: "Beto Um", phone: "5511900000001" },
    { weddingId: w.ctx.weddingId, groupId: g2.id, fullName: "Caio Dois", phone: "5511900000002" },
    { weddingId: w.ctx.weddingId, groupId: g2.id, fullName: "Sem Telefone" },
  ] });
  return { ...w, instance };
}

function mockFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
    const r = handler(url, init);
    return new Response(JSON.stringify(r.body), { status: r.status });
  }));
  return calls;
}

async function campaign(ctx: Awaited<ReturnType<typeof setup>>["ctx"]) {
  const c = await createCampaign(ctx, { name: "Convites", body: "Olá {{nome}} ({{familia}})! {{link}}", criteria: { rsvp: ["PENDING"] } });
  await confirmCampaign(ctx, c.id);
  return c;
}

describe("WhatsApp / Evolution", () => {
  beforeEach(resetDb);
  afterEach(() => vi.unstubAllGlobals());

  it("dedupe por família e prévia sem envio", async () => {
    const { ctx } = await setup();
    const { recipients, skipped } = await resolveRecipients(ctx, { rsvp: ["PENDING"] });
    expect(recipients).toHaveLength(2);
    expect(skipped).toEqual([{ name: "Sem Telefone", reason: "sem telefone válido" }]);
    const calls = mockFetch(() => ({ status: 500, body: {} }));
    const p = await previewCampaign(ctx, { body: "Oi {{nome}} {{link}}", criteria: { rsvp: ["PENDING"] } });
    expect(p.total).toBe(2);
    expect(p.samples[0]!.text).toContain("[link gerado no envio]");
    expect(calls).toHaveLength(0);
    expect(await prisma.guestInvitation.count()).toBe(0); // prévia não cria links
    expect(await prisma.outboundMessage.count()).toBe(0);
  });

  it("envio aceito vira ACCEPTED (não 'entregue'); confirmação dupla é recusada", async () => {
    const { ctx } = await setup();
    const c = await campaign(ctx);
    await expect(confirmCampaign(ctx, c.id)).rejects.toThrow(/já foi disparada/);
    const calls = mockFetch(() => ({ status: 201, body: { key: { id: `WAID-${Math.random()}` }, status: "PENDING" } }));
    const msgs = await prisma.outboundMessage.findMany();
    expect(msgs).toHaveLength(2);
    expect((await processSendJob(msgs[0]!.id, 1, 4)).kind).toBe("sent");
    // Intervalo mínimo entre envios: a segunda é reagendada, sem chamar a API
    expect((await processSendJob(msgs[1]!.id, 1, 4)).kind).toBe("reschedule");
    expect(calls).toHaveLength(1);
    await prisma.outboundMessage.updateMany({ where: { sentAt: { not: null } }, data: { sentAt: new Date(Date.now() - 5000) } });
    expect((await processSendJob(msgs[1]!.id, 1, 4)).kind).toBe("sent");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe("http://evolution.test/message/sendText/casamento-teste");
    const after = await prisma.outboundMessage.findMany();
    expect(after.every((m) => m.status === "ACCEPTED" && m.providerMessageId)).toBe(true);
    // Reprocessar o mesmo job não reenvia
    expect((await processSendJob(msgs[0]!.id, 2, 4)).kind).toBe("skip");
    expect(calls).toHaveLength(2);
  });

  it("conexão indisponível e falhas: tenta de novo e marca falha no limite; 4xx é permanente", async () => {
    const { ctx, instance } = await setup("CLOSED");
    await campaign(ctx);
    const [m1, m2] = await prisma.outboundMessage.findMany();
    const calls = mockFetch(() => ({ status: 500, body: { response: { message: "erro" } } }));
    expect((await processSendJob(m1!.id, 1, 3)).kind).toBe("retry");
    expect(calls).toHaveLength(0); // desconectado: nem chama a API
    await prisma.whatsAppInstance.update({ where: { id: instance.id }, data: { state: "OPEN" } });
    expect((await processSendJob(m1!.id, 2, 3)).kind).toBe("retry");
    expect((await processSendJob(m1!.id, 3, 3)).kind).toBe("failed");
    expect((await prisma.outboundMessage.findUniqueOrThrow({ where: { id: m1!.id } })).status).toBe("FAILED");
    mockFetch(() => ({ status: 400, body: { response: { message: ["número inválido"] } } }));
    expect((await processSendJob(m2!.id, 1, 3)).kind).toBe("failed");
    expect(await prisma.messageAttempt.count()).toBe(4);
  });

  it("estado incerto (worker caiu durante envio) não reenvia automaticamente", async () => {
    const { ctx } = await setup();
    await campaign(ctx);
    const m = (await prisma.outboundMessage.findFirst())!;
    await prisma.outboundMessage.update({ where: { id: m.id }, data: { status: "SENDING" } });
    const calls = mockFetch(() => ({ status: 201, body: { key: { id: "X" } } }));
    expect((await processSendJob(m.id, 2, 4)).kind).toBe("failed");
    expect(calls).toHaveLength(0);
  });

  it("cancelar campanha cancela pendentes e impede envio", async () => {
    const { ctx } = await setup();
    const c = await campaign(ctx);
    const r = await cancelCampaign(ctx, c.id);
    expect(r.cancelled).toBe(2);
    const calls = mockFetch(() => ({ status: 201, body: { key: { id: "X" } } }));
    for (const m of await prisma.outboundMessage.findMany()) expect((await processSendJob(m.id, 1, 4)).kind).toBe("skip");
    expect(calls).toHaveLength(0);
    expect(await prisma.job.count({ where: { status: "CANCELLED" } })).toBe(2);
  });

  it("webhook: token inválido, instância divergente, eventos duplicados e status que só avança", async () => {
    const { ctx } = await setup();
    await campaign(ctx);
    mockFetch(() => ({ status: 201, body: { key: { id: "WA-1" } } }));
    const m = (await prisma.outboundMessage.findFirst({ orderBy: { createdAt: "asc" } }))!;
    await processSendJob(m.id, 1, 4);

    expect((await handleEvolutionWebhook("token-invalido-xxxxxxxxxxxxxxxx", { event: "messages.update", data: {} }, {})).status).toBe(404);
    expect((await handleEvolutionWebhook(TOKEN, { event: "messages.update", instance: "outra", data: { keyId: "WA-1", status: "READ" } }, {})).status).toBe(403);
    expect((await handleEvolutionWebhook(TOKEN, { event: "messages.update" } as never, {})).status).toBe(400);

    const read = { event: "messages.update", instance: "casamento-teste", data: { keyId: "WA-1", status: "READ" } };
    expect((await handleEvolutionWebhook(TOKEN, read, {})).status).toBe(200);
    const dup = await handleEvolutionWebhook(TOKEN, read, {});
    expect(dup).toMatchObject({ status: 200, duplicate: true });
    // DELIVERY_ACK atrasado não regride READ
    await handleEvolutionWebhook(TOKEN, { event: "MESSAGES_UPDATE", instance: "casamento-teste", data: { keyId: "WA-1", status: "DELIVERY_ACK" } }, {});
    expect((await prisma.outboundMessage.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("READ");
    expect(await prisma.webhookEvent.count()).toBe(2);
    expect(await prisma.securityEvent.count({ where: { type: "invalid_webhook" } })).toBe(2);
  });

  it("resposta recebida é registrada uma vez e marca a mensagem como respondida", async () => {
    const { ctx } = await setup();
    await campaign(ctx);
    mockFetch(() => ({ status: 201, body: { key: { id: "WA-2" } } }));
    const m = (await prisma.outboundMessage.findFirst({ where: { toNumber: "5511900000001" } }))!;
    await processSendJob(m.id, 1, 4);
    const ev = { event: "messages.upsert", instance: "casamento-teste", data: { key: { id: "IN-1", remoteJid: "5511900000001@s.whatsapp.net", fromMe: false }, pushName: "Ana", message: { conversation: "Sim, vamos!" }, messageTimestamp: Math.floor(Date.now() / 1000) } };
    await handleEvolutionWebhook(TOKEN, ev, {});
    await handleEvolutionWebhook(TOKEN, ev, {});
    expect(await prisma.inboundMessage.count()).toBe(1);
    const inbound = await prisma.inboundMessage.findFirstOrThrow();
    expect(inbound.guestIds).toHaveLength(2); // número compartilhado: as duas pessoas
    expect((await prisma.outboundMessage.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("REPLIED");
    // Auto-RSVP desligado por padrão: ninguém foi confirmado
    expect(await prisma.guest.count({ where: { rsvpStatus: "ACCEPTED" } })).toBe(0);
  });

  it("janela de horário permitida", () => {
    const at = (h: number) => new Date(Date.UTC(2026, 5, 10, h + 3, 0)); // 3h a mais = America/Sao_Paulo
    expect(nextAllowedTime(at(10), "America/Sao_Paulo", { start: "09:00", end: "20:00" })).toBeNull();
    const next = nextAllowedTime(at(22), "America/Sao_Paulo", { start: "09:00", end: "20:00" })!;
    expect((next.getTime() - at(22).getTime()) / 3600_000).toBe(11);
  });
});
