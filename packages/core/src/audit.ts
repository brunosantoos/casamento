import { prisma, type Prisma, type Tx } from "@casa/db";

export type Actor = { userId: string | null; userName?: string | null; ip?: string | null; correlationId?: string | null; origin?: string };

const SENSITIVE = /pass|senha|token|secret|apikey|api_key|key$|authorization|cookie/i;

/** Remove segredos e encurta textos longos antes de gravar */
export function redact(value: unknown, depth = 0): unknown {
  if (value == null || depth > 4) return value;
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE.test(k) ? "[omitido]" : redact(v, depth + 1);
  return out;
}

/** Diferença campo a campo (apenas os campos alterados) */
export function diff(before: Record<string, unknown> | null | undefined, after: Record<string, unknown>) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(after)) {
    if (k === "updatedAt" || k === "createdAt") continue;
    const old = before?.[k];
    const norm = (x: unknown) => (x instanceof Date ? x.toISOString() : typeof x === "object" && x !== null ? JSON.stringify(x) : x);
    if (norm(old) !== norm(v)) changes[k] = { from: old, to: v };
  }
  return changes;
}

export type AuditInput = {
  weddingId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  changes?: unknown;
  result?: "success" | "failure" | "denied";
};

export async function audit(actor: Actor, input: AuditInput, tx: Tx | typeof prisma = prisma) {
  await tx.auditLog.create({
    data: {
      weddingId: input.weddingId,
      userId: actor.userId,
      userName: actor.userName ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary,
      changes: input.changes === undefined ? undefined : (redact(input.changes) as Prisma.InputJsonValue),
      origin: actor.origin ?? "web",
      result: input.result ?? "success",
      correlationId: actor.correlationId ?? null,
      ip: actor.ip ?? null,
    },
  });
}

export async function securityEvent(type: string, data: { userId?: string | null; weddingId?: string | null; ip?: string | null; details?: unknown }) {
  await prisma.securityEvent
    .create({
      data: { type, userId: data.userId ?? null, weddingId: data.weddingId ?? null, ip: data.ip ?? null, details: (redact(data.details) as Prisma.InputJsonValue) ?? undefined },
    })
    .catch((e) => console.warn("[security-event]", e.message));
}
