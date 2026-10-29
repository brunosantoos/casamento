import { prisma } from "@casa/db";
import webpush from "web-push";
import { decrypt, encrypt } from "./crypto.js";
import { env } from "./env.js";

/**
 * Web Push: chaves VAPID geradas no primeiro uso e guardadas cifradas (SystemSecret).
 * A pública vai ao navegador; a privada nunca sai do servidor.
 */
const KEY = "vapid";
let cached: { publicKey: string; privateKey: string } | null = null;

/** Testes: esquece as chaves em memória */
export function resetVapidCache() {
  cached = null;
}

export async function vapidKeys() {
  if (cached) return cached;
  const row = await prisma.systemSecret.findUnique({ where: { key: KEY } });
  if (row) {
    cached = JSON.parse(decrypt(row.valueEnc)) as { publicKey: string; privateKey: string };
    return cached;
  }
  const keys = webpush.generateVAPIDKeys();
  // Corrida entre processos: quem gravar primeiro vence; os outros relêem
  await prisma.systemSecret.upsert({ where: { key: KEY }, create: { key: KEY, valueEnc: encrypt(JSON.stringify(keys)) }, update: {} });
  const saved = await prisma.systemSecret.findUniqueOrThrow({ where: { key: KEY } });
  cached = JSON.parse(decrypt(saved.valueEnc)) as { publicKey: string; privateKey: string };
  return cached;
}

function subject() {
  const m = env().SMTP_FROM.match(/<([^>]+@[^>]+)>/)?.[1] ?? (env().SMTP_FROM.includes("@") ? env().SMTP_FROM.trim() : null);
  return `mailto:${m ?? "admin@localhost"}`;
}

/** Permite substituir o envio nos testes */
type Sender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string, opts: webpush.RequestOptions) => Promise<unknown>;
let sender: Sender = (sub, payload, opts) => webpush.sendNotification(sub, payload, opts);
export function setPushSender(fn: Sender | null) {
  sender = fn ?? ((sub, payload, opts) => webpush.sendNotification(sub, payload, opts));
}

export type PushPayload = { title: string; body?: string | null; url?: string | null; tag?: string | null };

/**
 * Envia para todos os aparelhos do usuário. Assinaturas expiradas (404/410) são removidas.
 * Lança erro só se TODAS falharem por motivo temporário (para a fila tentar de novo).
 */
export async function sendPushToUser(userId: string, payload: PushPayload) {
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (!subs.length) return { sent: 0, removed: 0, failed: 0 };
  const { publicKey, privateKey } = await vapidKeys();
  const body = JSON.stringify(payload);
  let sent = 0;
  let removed = 0;
  const errors: string[] = [];
  for (const s of subs) {
    try {
      await sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 24 * 3600, vapidDetails: { subject: subject(), publicKey, privateKey }, urgency: "normal" });
      sent++;
      await prisma.pushSubscription.update({ where: { id: s.id }, data: { lastUsedAt: new Date() } });
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
        removed++;
      } else errors.push(`${status ?? "rede"}: ${(e as Error).message}`.slice(0, 200));
    }
  }
  if (!sent && errors.length) throw new Error(`Push falhou: ${errors[0]}`);
  return { sent, removed, failed: errors.length };
}
