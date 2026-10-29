import { prisma, type Prisma } from "@casa/db";
import { effectivePermissions } from "./permissions.js";
import { enqueue } from "./queue.js";

/**
 * Notificações para a equipe do casamento (push no navegador/app instalado).
 * Contrato usado por todo o sistema: chame notify() quando algo relevante acontecer.
 * Regras: só quem tem permissão para o assunto, respeitando as preferências de cada pessoa
 * (tudo ligado por padrão); a mesma dedupeKey nunca notifica a mesma pessoa duas vezes.
 */
export type NotifyEvent = "installment_due" | "rsvp" | "task_due" | "whatsapp_reply" | "gift" | "guest_photo";

export type NotifyMessage = {
  title: string;
  body?: string;
  /** Rota do painel a abrir ao tocar (ex.: "/convidados") */
  url?: string;
  /** Mesma chave = não notifica de novo a mesma pessoa */
  dedupeKey: string;
  /** Restringe a estas pessoas (ex.: responsáveis por uma tarefa) */
  userIds?: string[];
};

export const NOTIFY_EVENTS: Record<NotifyEvent, { label: string; description: string; permissions: string[] }> = {
  installment_due: { label: "Parcelas vencendo", description: "Vencimentos próximos e parcelas em atraso", permissions: ["finance:view"] },
  rsvp: { label: "Confirmações de presença", description: "Quando uma família responde pelo portal", permissions: ["guests:view", "rsvp:view"] },
  task_due: { label: "Tarefas", description: "Tarefas suas que vencem amanhã ou estão atrasadas", permissions: ["planning:view"] },
  whatsapp_reply: { label: "Respostas no WhatsApp", description: "Mensagens recebidas de convidados e fornecedores", permissions: ["whatsapp:view"] },
  gift: { label: "Presentes", description: "Quando um convidado avisa que enviou um presente", permissions: ["finance:view"] },
  guest_photo: { label: "Fotos dos convidados", description: "Novas fotos aguardando aprovação", permissions: ["gallery:view"] },
};

export type NotificationPrefs = Partial<Record<NotifyEvent, boolean>>;
export const prefEnabled = (prefs: unknown, event: NotifyEvent) => ((prefs ?? {}) as NotificationPrefs)[event] !== false;

/** Destinatários: membros ativos com permissão e preferência ligada */
export async function notifyRecipients(weddingId: string, event: NotifyEvent, userIds?: string[]) {
  const members = await prisma.weddingMember.findMany({
    where: { weddingId, active: true, user: { active: true }, ...(userIds ? { userId: { in: userIds } } : {}) },
    include: { role: true },
  });
  const needed = NOTIFY_EVENTS[event].permissions;
  return members.filter((m) => {
    const perms = effectivePermissions(m.role, m);
    return needed.some((p) => perms.has(p)) && prefEnabled(m.notificationPrefs, event);
  });
}

export async function notify(weddingId: string, event: NotifyEvent, msg: NotifyMessage): Promise<void> {
  try {
    if (msg.userIds && !msg.userIds.length) return;
    const recipients = await notifyRecipients(weddingId, event, msg.userIds);
    for (const m of recipients) {
      let log;
      try {
        log = await prisma.notificationLog.create({
          data: { weddingId, userId: m.userId, dedupeKey: msg.dedupeKey, event, title: msg.title.slice(0, 200), body: msg.body?.slice(0, 500) ?? null, url: msg.url ?? null },
        });
      } catch (e) {
        if ((e as Prisma.PrismaClientKnownRequestError).code === "P2002") continue; // já notificado
        throw e;
      }
      await enqueue("push.send", { logId: log.id }, { uniqueKey: `push:${log.id}`, maxAttempts: 4 });
    }
  } catch (e) {
    console.warn("[notify]", event, (e as Error).message);
  }
}

/** Job "push.send": entrega a notificação registrada (worker) */
export async function processPushJob(logId: string) {
  const { sendPushToUser } = await import("./push.js");
  const log = await prisma.notificationLog.findUnique({ where: { id: logId } });
  if (!log) return { sent: 0 };
  return sendPushToUser(log.userId, { title: log.title, body: log.body, url: log.url, tag: log.event });
}

/**
 * Avisos periódicos (worker): parcelas a vencer em N dias e vencidas; tarefas que vencem amanhã ou atrasadas.
 * Uma notificação por item por dia (dedupeKey com a data).
 */
export async function tickDueNotifications(now = new Date()) {
  const { getSetting } = await import("./settings.js");
  const { installmentStatus, toObligationInput, obligationInclude } = await Promise.all([import("./finance/domain.js"), import("./finance/service.js")]).then(([d, s]) => ({ ...d, ...s }));
  const { formatBRL } = await import("./money.js");
  const day = now.toISOString().slice(0, 10);
  const dayMs = 86400_000;
  let count = 0;
  const weddings = await prisma.wedding.findMany({ where: { archivedAt: null }, select: { id: true } });
  for (const w of weddings) {
    const daysBefore = await getSetting(w.id, "reminders.installmentDaysBefore");
    const horizon = new Date(now.getTime() + daysBefore * dayMs);
    const obligations = await prisma.financialObligation.findMany({ where: { weddingId: w.id, status: "ACTIVE" }, include: obligationInclude });
    for (const o of obligations) {
      for (const i of toObligationInput(o).installments) {
        const st = installmentStatus(i, o.status, now);
        if (!st.remaining) continue;
        if (st.overdue) {
          await notify(w.id, "installment_due", { title: `Parcela vencida: ${o.title}`, body: `${formatBRL(st.remaining)} venceu em ${i.dueDate.toLocaleDateString("pt-BR")}`, url: `/financeiro/lancamentos/${o.id}`, dedupeKey: `inst-overdue:${i.id}:${day}` });
          count++;
        } else if (i.dueDate <= horizon) {
          await notify(w.id, "installment_due", { title: `Parcela vence em breve: ${o.title}`, body: `${formatBRL(st.remaining)} em ${i.dueDate.toLocaleDateString("pt-BR")}`, url: `/financeiro/lancamentos/${o.id}`, dedupeKey: `inst-due:${i.id}:${day}` });
          count++;
        }
      }
    }
    const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
    const tasks = await prisma.task.findMany({
      where: { weddingId: w.id, archivedAt: null, status: { notIn: ["DONE", "CANCELLED"] }, dueDate: { lt: tomorrowEnd }, assignees: { some: {} } },
      include: { assignees: { select: { userId: true } } },
    });
    for (const t of tasks) {
      const overdue = t.dueDate! < new Date(now.getFullYear(), now.getMonth(), now.getDate());
      await notify(w.id, "task_due", {
        title: overdue ? `Tarefa atrasada: ${t.title}` : `Tarefa para amanhã: ${t.title}`,
        body: `Prazo: ${t.dueDate!.toLocaleDateString("pt-BR")}`, url: `/checklist?tarefa=${t.id}`,
        dedupeKey: `task:${t.id}:${day}`, userIds: t.assignees.map((a) => a.userId),
      });
      count++;
    }
  }
  return count;
}
