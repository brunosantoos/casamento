import { prisma, type Prisma } from "@casa/db";
import { hostname } from "node:os";

/**
 * Fila persistente no próprio Postgres: sobrevive a reinícios, sem infraestrutura extra.
 * Retirada com FOR UPDATE SKIP LOCKED (vários workers sem pegar o mesmo job).
 */
export type JobType = "whatsapp.send" | "document.analyze" | "email.send" | "webhook.process" | "push.send";

export async function enqueue(type: JobType, payload: Prisma.InputJsonValue, opts: { uniqueKey?: string; runAt?: Date; maxAttempts?: number } = {}) {
  if (opts.uniqueKey) {
    const existing = await prisma.job.findUnique({ where: { uniqueKey: opts.uniqueKey } });
    if (existing) return existing;
  }
  return prisma.job.create({ data: { type, payload, uniqueKey: opts.uniqueKey, runAt: opts.runAt ?? new Date(), maxAttempts: opts.maxAttempts ?? 5 } }).catch(async (e) => {
    if (e.code === "P2002" && opts.uniqueKey) return prisma.job.findUniqueOrThrow({ where: { uniqueKey: opts.uniqueKey } });
    throw e;
  });
}

const WORKER_ID = `${hostname()}:${process.pid}`;
const LOCK_TIMEOUT_MS = 5 * 60_000;

export async function claimJobs(types: JobType[], limit = 5) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Job"
      WHERE type = ANY(${types}::text[])
        AND ((status = 'QUEUED' AND "runAt" <= now())
          OR (status = 'RUNNING' AND "lockedAt" < now() - (${LOCK_TIMEOUT_MS} || ' milliseconds')::interval))
      ORDER BY "runAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED`;
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    await tx.job.updateMany({ where: { id: { in: ids } }, data: { status: "RUNNING", lockedAt: new Date(), lockedBy: WORKER_ID, attempts: { increment: 1 } } });
    return tx.job.findMany({ where: { id: { in: ids } } });
  });
}

/** Backoff exponencial: 30s, 2min, 8min, 32min… (máx. 6h) */
export const backoffMs = (attempt: number) => Math.min(30_000 * 4 ** Math.max(0, attempt - 1), 6 * 3600_000);

export async function completeJob(id: string) {
  await prisma.job.update({ where: { id }, data: { status: "DONE", finishedAt: new Date(), lockedAt: null, lastError: null } });
}

export async function failJob(id: string, error: string, opts: { retry?: boolean } = {}) {
  const job = await prisma.job.findUniqueOrThrow({ where: { id } });
  const retry = opts.retry !== false && job.attempts < job.maxAttempts;
  await prisma.job.update({
    where: { id },
    data: retry
      ? { status: "QUEUED", runAt: new Date(Date.now() + backoffMs(job.attempts)), lockedAt: null, lastError: error }
      : { status: "FAILED", finishedAt: new Date(), lockedAt: null, lastError: error },
  });
  return retry;
}

export async function cancelJobs(where: Prisma.JobWhereInput) {
  return prisma.job.updateMany({ where: { ...where, status: "QUEUED" }, data: { status: "CANCELLED", finishedAt: new Date() } });
}
