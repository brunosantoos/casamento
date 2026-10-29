import { prisma, type IntegrationType, type Prisma } from "@casa/db";
import { audit, type Actor } from "./audit.js";
import { decrypt, encrypt, lastChars } from "./crypto.js";

/**
 * Integrações: configuração NÃO secreta em Integration.config; segredos cifrados (AES-256-GCM)
 * em IntegrationSecret. O valor decifrado só existe em memória no backend — nunca volta ao front.
 */
export async function getIntegration(weddingId: string, type: IntegrationType) {
  return prisma.integration.findUnique({ where: { weddingId_type: { weddingId, type } }, include: { secrets: true } });
}

export async function integrationView(weddingId: string, type: IntegrationType) {
  const i = await getIntegration(weddingId, type);
  return {
    enabled: i?.enabled ?? false,
    config: (i?.config ?? {}) as Record<string, unknown>,
    secrets: Object.fromEntries((i?.secrets ?? []).map((s) => [s.key, { set: true, hint: s.hint, updatedAt: s.updatedAt }])),
  };
}

export async function saveIntegration(
  actor: Actor,
  weddingId: string,
  type: IntegrationType,
  input: { enabled?: boolean; config?: Record<string, unknown>; secrets?: Record<string, string | null> },
) {
  const i = await prisma.integration.upsert({
    where: { weddingId_type: { weddingId, type } },
    create: { weddingId, type, enabled: input.enabled ?? true, config: (input.config ?? {}) as Prisma.InputJsonValue },
    update: { ...(input.enabled !== undefined ? { enabled: input.enabled } : {}), ...(input.config ? { config: input.config as Prisma.InputJsonValue } : {}) },
  });
  const changedSecrets: string[] = [];
  for (const [key, value] of Object.entries(input.secrets ?? {})) {
    if (value === null) {
      await prisma.integrationSecret.deleteMany({ where: { integrationId: i.id, key } });
      changedSecrets.push(`${key} (removido)`);
    } else if (value) {
      await prisma.integrationSecret.upsert({
        where: { integrationId_key: { integrationId: i.id, key } },
        create: { integrationId: i.id, key, valueEnc: encrypt(value), hint: lastChars(value), updatedById: actor.userId },
        update: { valueEnc: encrypt(value), hint: lastChars(value), updatedById: actor.userId },
      });
      changedSecrets.push(key);
    }
  }
  await audit(actor, {
    weddingId, action: "update", entityType: "integration", entityId: i.id,
    summary: `Alterou integração ${type}${changedSecrets.length ? ` (segredos: ${changedSecrets.join(", ")})` : ""}`,
    changes: { config: input.config, enabled: input.enabled },
  });
  return i;
}

/** Uso interno do backend apenas */
export async function readSecret(weddingId: string, type: IntegrationType, key: string): Promise<string | null> {
  const i = await getIntegration(weddingId, type);
  const s = i?.secrets.find((x) => x.key === key);
  return s ? decrypt(s.valueEnc) : null;
}
