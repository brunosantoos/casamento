import { prisma } from "@casa/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { notify, notifyRecipients, processPushJob } from "../src/notify.js";
import { resetVapidCache, sendPushToUser, setPushSender, vapidKeys } from "../src/push.js";
import { makeUser, makeWedding, resetDb } from "./helpers.js";

async function member(weddingId: string, roleKey: string, prefs: Record<string, boolean> = {}) {
  const u = await makeUser(roleKey);
  const role = await prisma.role.findUniqueOrThrow({ where: { weddingId_key: { weddingId, key: roleKey } } });
  await prisma.weddingMember.create({ data: { weddingId, userId: u.id, roleId: role.id, grants: [], revokes: [], notificationPrefs: prefs } });
  return u;
}

describe("notificações push", () => {
  beforeEach(async () => {
    await resetDb();
    resetVapidCache();
  });
  afterEach(() => setPushSender(null));

  it("só notifica quem tem permissão e não desligou a preferência", async () => {
    const { wedding, user: admin } = await makeWedding();
    const planner = await member(wedding.id, "PLANNER");
    const couple = await member(wedding.id, "COUPLE", { installment_due: false });
    const fin = (await notifyRecipients(wedding.id, "installment_due")).map((m) => m.userId);
    expect(fin).toContain(admin.id);
    expect(fin).not.toContain(planner.id); // sem finance:view
    expect(fin).not.toContain(couple.id); // preferência desligada
    const rsvp = (await notifyRecipients(wedding.id, "rsvp")).map((m) => m.userId);
    expect(rsvp).toEqual(expect.arrayContaining([admin.id, planner.id, couple.id]));
    const task = (await notifyRecipients(wedding.id, "task_due", [planner.id])).map((m) => m.userId);
    expect(task).toEqual([planner.id]);
  });

  it("deduplica pela chave e enfileira um envio por pessoa", async () => {
    const { wedding } = await makeWedding();
    await notify(wedding.id, "rsvp", { title: "Família Silva respondeu", url: "/convidados", dedupeKey: "rsvp:1" });
    await notify(wedding.id, "rsvp", { title: "Família Silva respondeu", url: "/convidados", dedupeKey: "rsvp:1" });
    expect(await prisma.notificationLog.count()).toBe(1);
    expect(await prisma.job.count({ where: { type: "push.send" } })).toBe(1);
    // userIds vazio não notifica ninguém
    await notify(wedding.id, "task_due", { title: "x", dedupeKey: "t:1", userIds: [] });
    expect(await prisma.notificationLog.count()).toBe(1);
  });

  it("envia a todos os aparelhos e remove assinaturas expiradas (404/410)", async () => {
    const { user, wedding } = await makeWedding();
    await prisma.pushSubscription.createMany({ data: [
      { userId: user.id, endpoint: "https://push.test/ok", p256dh: "p".repeat(20), auth: "a".repeat(10) },
      { userId: user.id, endpoint: "https://push.test/gone", p256dh: "p".repeat(20), auth: "a".repeat(10) },
    ] });
    const calls: string[] = [];
    setPushSender(async (sub) => {
      calls.push(sub.endpoint);
      if (sub.endpoint.endsWith("gone")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      return {};
    });
    await notify(wedding.id, "gift", { title: "Novo presente", dedupeKey: "gift:1" });
    const log = await prisma.notificationLog.findFirstOrThrow();
    const r = await processPushJob(log.id);
    expect(r).toMatchObject({ sent: 1, removed: 1 });
    expect(calls).toHaveLength(2);
    expect(await prisma.pushSubscription.count()).toBe(1);
    expect((await prisma.pushSubscription.findFirstOrThrow()).lastUsedAt).not.toBeNull();
  });

  it("falha temporária em todos os aparelhos lança erro (fila tenta de novo)", async () => {
    const { user } = await makeWedding();
    await prisma.pushSubscription.create({ data: { userId: user.id, endpoint: "https://push.test/down", p256dh: "p".repeat(20), auth: "a".repeat(10) } });
    setPushSender(async () => {
      throw Object.assign(new Error("Server error"), { statusCode: 503 });
    });
    await expect(sendPushToUser(user.id, { title: "x" })).rejects.toThrow(/Push falhou/);
    expect(await prisma.pushSubscription.count()).toBe(1);
  });

  it("chaves VAPID geradas uma vez e guardadas cifradas", async () => {
    const a = await vapidKeys();
    const row = await prisma.systemSecret.findUniqueOrThrow({ where: { key: "vapid" } });
    expect(row.valueEnc).not.toContain(a.privateKey);
    expect((await vapidKeys()).publicKey).toBe(a.publicKey);
  });
});
