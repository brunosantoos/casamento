import nodemailer from "nodemailer";
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

/** Sem SMTP configurado, registra no log (desenvolvimento) — nunca falha silenciosamente em produção */
export async function sendEmail(to: string, subject: string, html: string, text?: string) {
  const t = getTransport();
  if (!t) {
    if (process.env.NODE_ENV === "production") throw new Error("SMTP não configurado");
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
