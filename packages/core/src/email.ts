import { prisma } from "@casa/db";
import nodemailer from "nodemailer";
import { decrypt } from "./crypto.js";
import { env } from "./env.js";

let transport: nodemailer.Transporter | null | undefined;

function getTransport() {
  if (transport !== undefined) return transport;
  const e = env();
  transport = e.SMTP_HOST
    ? nodemailer.createTransport({ host: e.SMTP_HOST, port: e.SMTP_PORT, secure: e.SMTP_PORT === 465, auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASS } : undefined })
    : null;
  return transport;
}

export type EmailConfig = { from: string; replyTo: string | null; apiKey: string };

/**
 * Configuração de e-mail (Resend) cadastrada no painel. Com weddingId, usa a daquele casamento;
 * sem ele (ex.: redefinição de senha), usa a primeira integração ativa da instalação.
 */
export async function emailConfig(weddingId?: string): Promise<EmailConfig | null> {
  const i = await prisma.integration.findFirst({
    where: { type: "EMAIL", enabled: true, ...(weddingId ? { weddingId } : {}) },
    include: { secrets: true },
    orderBy: { createdAt: "asc" },
  });
  const key = i?.secrets.find((s) => s.key === "apiKey");
  const cfg = (i?.config ?? {}) as { from?: string; replyTo?: string | null };
  if (!i || !key || !cfg.from) return weddingId ? emailConfig() : null;
  return { from: cfg.from, replyTo: cfg.replyTo || null, apiKey: decrypt(key.valueEnc) };
}

/** Envio pela API HTTP do Resend (https://resend.com/docs/api-reference/emails/send-email) */
export async function sendViaResend(cfg: EmailConfig, msg: { to: string; subject: string; html: string; text?: string }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: cfg.from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text, ...(cfg.replyTo ? { reply_to: cfg.replyTo } : {}) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(`Resend ${res.status}: ${body?.message ?? res.statusText}`);
  }
}

/** Ordem: Resend do painel → SMTP do ambiente → log (só em desenvolvimento; em produção falha) */
export async function sendEmail(to: string, subject: string, html: string, text?: string, weddingId?: string) {
  const cfg = await emailConfig(weddingId);
  if (cfg) return sendViaResend(cfg, { to, subject, html, text });
  const t = getTransport();
  if (!t) {
    if (process.env.NODE_ENV === "production") throw new Error("E-mail não configurado (Configurações → Integrações)");
    console.log(`[email:dev] para=${to} assunto="${subject}"\n${text ?? html.replace(/<[^>]+>/g, " ")}`);
    return;
  }
  await t.sendMail({ from: env().SMTP_FROM, to, subject, html, text });
}

export function emailLayout(title: string, body: string, cta?: { label: string; url: string }) {
  return `<div style="font-family:Georgia,serif;max-width:540px;margin:auto;line-height:1.55;color:#2b1d1f;padding:24px">
    <h2 style="margin:0 0 12px;color:#6b1d2f;font-weight:600">${title}</h2>
    <div style="font-family:system-ui,sans-serif;font-size:15px">${body}</div>
    ${cta ? `<p style="margin-top:20px"><a href="${cta.url}" style="display:inline-block;background:#6b1d2f;color:#fff;padding:11px 20px;border-radius:10px;text-decoration:none;font-family:system-ui,sans-serif;font-weight:600">${cta.label}</a></p>` : ""}
  </div>`;
}
