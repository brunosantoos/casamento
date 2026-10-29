import {
  claimJobs, cleanupRateLimits, processPushJob, tickDueNotifications, completeJob, emailLayout, env, failJob, formatBRL, getSetting, installmentStatus, processSendJob, purgeDeletedFiles, runAnalysis, sendEmail, toObligationInput,
} from "@casa/core";
import { prisma } from "@casa/db";

/**
 * Worker: processa a fila persistente (Postgres) e as rotinas periódicas.
 *  - whatsapp.send: envio com janela de horário, intervalo mínimo, tentativas e backoff
 *  - document.analyze: análise de documentos por IA
 *  - lembretes de tarefas/compromissos e de parcelas a vencer (e-mail)
 *  - limpeza: arquivos excluídos após a retenção, contadores de rate limit
 */
const TICK_MS = 5_000;
let stopping = false;

async function processQueue() {
  const jobs = await claimJobs(["whatsapp.send", "document.analyze", "push.send"], 5);
  for (const job of jobs) {
    const payload = job.payload as Record<string, string>;
    try {
      if (job.type === "whatsapp.send") {
        const r = await processSendJob(payload.messageId!, job.attempts, job.maxAttempts);
        if (r.kind === "reschedule") {
          // Não conta como tentativa
          await prisma.job.update({ where: { id: job.id }, data: { status: "QUEUED", runAt: r.at, lockedAt: null, attempts: { decrement: 1 }, lastError: r.reason } });
        } else if (r.kind === "retry") await failJob(job.id, r.error);
        else if (r.kind === "failed") await failJob(job.id, r.error, { retry: false });
        else await completeJob(job.id);
        console.log(`[whatsapp] ${payload.messageId}: ${r.kind}${"reason" in r ? ` (${r.reason})` : ""}${"error" in r ? ` (${r.error})` : ""}`);
      } else if (job.type === "push.send") {
        // Falha temporária (5xx/rede) lança erro → nova tentativa com backoff; 404/410 removem a assinatura
        await processPushJob(payload.logId!);
        await completeJob(job.id);
      } else if (job.type === "document.analyze") {
        await runAnalysis(payload.analysisId!);
        await completeJob(job.id);
        console.log(`[analysis] ${payload.analysisId}: ok`);
      }
    } catch (e) {
      const retried = await failJob(job.id, (e as Error).message.slice(0, 500));
      console.error(`[job] ${job.type} ${job.id} falhou${retried ? " (nova tentativa agendada)" : ""}:`, (e as Error).message);
    }
  }
}

/** Lembretes agendados (tarefas e compromissos) por e-mail */
async function sendReminders() {
  const due = await prisma.reminder.findMany({ where: { sentAt: null, remindAt: { lte: new Date() } }, take: 50 });
  for (const r of due) {
    // Marca antes de enviar: na dúvida, prefere não duplicar
    const claimed = await prisma.reminder.updateMany({ where: { id: r.id, sentAt: null }, data: { sentAt: new Date() } });
    if (!claimed.count || !r.userId) continue;
    if ((await getSetting(r.weddingId, "reminders.channel")) === "NONE") continue;
    const user = await prisma.user.findUnique({ where: { id: r.userId } });
    if (!user?.active) continue;
    let title = "";
    let link = env().WEB_ORIGIN;
    if (r.entityType === "task") {
      const t = await prisma.task.findUnique({ where: { id: r.entityId } });
      if (!t || ["DONE", "CANCELLED"].includes(t.status)) continue;
      title = `Tarefa: ${t.title}`;
      link += `/checklist?tarefa=${t.id}`;
    } else if (r.entityType === "event") {
      const e = await prisma.calendarEvent.findUnique({ where: { id: r.entityId } });
      if (!e || e.status !== "SCHEDULED") continue;
      title = `Compromisso: ${e.title} — ${e.startsAt.toLocaleString("pt-BR")}`;
      link += `/calendario?evento=${e.id}`;
    }
    await sendEmail(user.email, `Lembrete · ${title}`, emailLayout("Lembrete", `<p>${title}</p>`, { label: "Abrir", url: link })).catch((e) => console.warn("[lembrete]", e.message));
  }
}

/** Uma vez por dia: parcelas que vencem em N dias → e-mail para quem tem finance:view */
let lastDaily = "";
async function dailyInstallmentReminders() {
  const today = new Date().toISOString().slice(0, 10);
  if (today === lastDaily || new Date().getHours() < 8) return;
  lastDaily = today;
  const weddings = await prisma.wedding.findMany({ where: { archivedAt: null } });
  for (const w of weddings) {
    if ((await getSetting(w.id, "reminders.channel")) === "NONE") continue;
    const days = await getSetting(w.id, "reminders.installmentDaysBefore");
    const target = new Date();
    target.setDate(target.getDate() + days);
    const obligations = await prisma.financialObligation.findMany({ where: { weddingId: w.id, status: "ACTIVE" }, include: { items: true, installments: { include: { allocations: { include: { payment: { select: { id: true, paidAt: true, method: true, reversedAt: true, reference: true } } } } } }, vendor: { select: { id: true, name: true } }, category: { select: { id: true, name: true } }, contract: { select: { id: true, title: true, status: true } } } });
    const due = obligations.flatMap((o) => toObligationInput(o).installments.map((i) => ({ o, i, st: installmentStatus(i, o.status) }))).filter((r) => r.st.remaining > 0 && r.i.dueDate.toISOString().slice(0, 10) === target.toISOString().slice(0, 10));
    if (!due.length) continue;
    const members = await prisma.weddingMember.findMany({ where: { weddingId: w.id, active: true }, include: { role: true, user: true } });
    const recipients = members.filter((m) => (m.role.permissions.includes("finance:view") || m.grants.includes("finance:view")) && !m.revokes.includes("finance:view") && m.user.active);
    const list = due.map((d) => `<li>${d.o.title}: <b>${formatBRL(d.st.remaining)}</b></li>`).join("");
    for (const m of recipients) {
      const key = `inst:${w.id}:${today}`;
      const sent = await prisma.reminder.findFirst({ where: { entityType: "installment-digest", entityId: key, userId: m.userId } });
      if (sent) continue;
      await prisma.reminder.create({ data: { weddingId: w.id, entityType: "installment-digest", entityId: key, userId: m.userId, remindAt: new Date(), sentAt: new Date() } });
      await sendEmail(m.user.email, `Parcelas vencendo em ${days} dia(s)`, emailLayout("Parcelas a vencer", `<ul>${list}</ul>`, { label: "Ver contas a pagar", url: `${env().WEB_ORIGIN}/financeiro/pagar` })).catch((e) => console.warn("[parcelas]", e.message));
    }
  }
}

/** Avisos de parcelas e tarefas (a cada 10 min; deduplicados por item/dia) */
let lastDue = 0;
async function dueNotifications() {
  if (Date.now() - lastDue < 10 * 60_000) return;
  lastDue = Date.now();
  const n = await tickDueNotifications();
  if (n) console.log(`[push] ${n} aviso(s) avaliados`);
}

let hourly = 0;
async function maintenance() {
  if (Date.now() - hourly < 3600_000) return;
  hourly = Date.now();
  const n = await purgeDeletedFiles();
  if (n) console.log(`[retenção] ${n} arquivo(s) removido(s) definitivamente`);
  await cleanupRateLimits();
}

async function loop() {
  while (!stopping) {
    try {
      await processQueue();
      await sendReminders();
      await dailyInstallmentReminders();
      await dueNotifications();
      await maintenance();
    } catch (e) {
      console.error("[worker]", e);
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}

console.log("Worker rodando");
void loop();

async function shutdown() {
  stopping = true;
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
