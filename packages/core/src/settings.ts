import { prisma, type Prisma } from "@casa/db";
import { z } from "zod";
import { audit, type Actor } from "./audit.js";

/**
 * Parâmetros operacionais (não secretos), validados por schema e gravados no banco
 * com histórico (SettingChange). Substituem o uso de .env para configuração do sistema.
 */
export const WEDDING_SETTINGS = {
  "reminders.installmentDaysBefore": { label: "Lembrete de parcela (dias antes)", schema: z.number().int().min(0).max(60), default: 3 },
  "reminders.taskDaysBefore": { label: "Lembrete de tarefa (dias antes)", schema: z.number().int().min(0).max(60), default: 2 },
  "reminders.channel": { label: "Canal dos lembretes internos", schema: z.enum(["EMAIL", "NONE"]), default: "EMAIL" },
  "finance.dueSoonDays": { label: "Janela de 'próximos vencimentos' (dias)", schema: z.number().int().min(1).max(120), default: 30 },
  "finance.budgetAlertPercent": { label: "Alerta de orçamento ao atingir (%)", schema: z.number().int().min(50).max(150), default: 90 },
  "whatsapp.dailyLimit": { label: "Limite diário de mensagens", schema: z.number().int().min(1).max(2000), default: 200 },
  "whatsapp.minIntervalSeconds": { label: "Intervalo mínimo entre envios (s)", schema: z.number().int().min(1).max(600), default: 8 },
  "whatsapp.allowedHours": { label: "Horário permitido para envios", schema: z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) }), default: { start: "09:00", end: "20:00" } },
  "whatsapp.maxAttempts": { label: "Tentativas por mensagem", schema: z.number().int().min(1).max(10), default: 4 },
  "whatsapp.autoRsvpFromReplies": { label: "Interpretar respostas 'sim/não' como confirmação", schema: z.boolean(), default: false },
  "rsvp.linkValidityDays": { label: "Validade do link de confirmação (dias)", schema: z.number().int().min(1).max(730), default: 180 },
  "files.maxUploadMb": { label: "Tamanho máximo de upload (MB)", schema: z.number().int().min(1).max(100), default: 25 },
  "files.allowedTypes": { label: "Tipos de arquivo aceitos", schema: z.array(z.string()), default: ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv"] },
  "files.retentionDays": { label: "Retenção de arquivos excluídos (dias)", schema: z.number().int().min(0).max(3650), default: 30 },
  "ai.monthlyTokenLimit": { label: "Limite mensal de tokens da IA", schema: z.number().int().min(0), default: 2_000_000 },
  "ai.maxDocumentPages": { label: "Páginas máximas por análise", schema: z.number().int().min(1).max(500), default: 60 },
  "ai.shareGuestData": { label: "Permitir enviar nomes de convidados à IA", schema: z.boolean(), default: true },
} as const;

export type WeddingSettingKey = keyof typeof WEDDING_SETTINGS;
export type WeddingSettingValue<K extends WeddingSettingKey> = z.infer<(typeof WEDDING_SETTINGS)[K]["schema"]>;

export async function getSetting<K extends WeddingSettingKey>(weddingId: string, key: K): Promise<WeddingSettingValue<K>> {
  const row = await prisma.weddingSetting.findUnique({ where: { weddingId_key: { weddingId, key } } });
  const def = WEDDING_SETTINGS[key];
  if (!row) return def.default as WeddingSettingValue<K>;
  const parsed = def.schema.safeParse(row.value);
  return (parsed.success ? parsed.data : def.default) as WeddingSettingValue<K>;
}

export async function allSettings(weddingId: string) {
  const rows = await prisma.weddingSetting.findMany({ where: { weddingId } });
  return (Object.keys(WEDDING_SETTINGS) as WeddingSettingKey[]).map((key) => {
    const row = rows.find((r) => r.key === key);
    const def = WEDDING_SETTINGS[key];
    const parsed = row ? def.schema.safeParse(row.value) : null;
    return { key, label: def.label, value: parsed?.success ? parsed.data : def.default, default: def.default, custom: !!row, updatedAt: row?.updatedAt ?? null };
  });
}

export async function setSetting(weddingId: string, key: string, value: unknown, actor: Actor) {
  if (!(key in WEDDING_SETTINGS)) throw new Error("Configuração desconhecida");
  const def = WEDDING_SETTINGS[key as WeddingSettingKey];
  const parsed = def.schema.parse(value) as Prisma.InputJsonValue;
  const old = await prisma.weddingSetting.findUnique({ where: { weddingId_key: { weddingId, key } } });
  await prisma.$transaction([
    prisma.weddingSetting.upsert({ where: { weddingId_key: { weddingId, key } }, create: { weddingId, key, value: parsed, updatedById: actor.userId }, update: { value: parsed, updatedById: actor.userId } }),
    prisma.settingChange.create({ data: { scope: weddingId, key, oldValue: old?.value ?? undefined, newValue: parsed, userId: actor.userId } }),
  ]);
  await audit(actor, { weddingId, action: "update", entityType: "setting", entityId: key, summary: `Alterou configuração "${def.label}"`, changes: { from: old?.value ?? def.default, to: parsed } });
}

export async function resetSetting(weddingId: string, key: string, actor: Actor) {
  const old = await prisma.weddingSetting.findUnique({ where: { weddingId_key: { weddingId, key } } });
  if (!old) return;
  await prisma.$transaction([
    prisma.weddingSetting.delete({ where: { id: old.id } }),
    prisma.settingChange.create({ data: { scope: weddingId, key, oldValue: old.value ?? undefined, newValue: undefined, userId: actor.userId } }),
  ]);
  await audit(actor, { weddingId, action: "update", entityType: "setting", entityId: key, summary: `Restaurou padrão de "${key}"` });
}
