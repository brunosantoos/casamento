import { prisma } from "@casa/db";

/** Janela fixa persistida no banco (vale para várias instâncias da API) */
export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowSeconds * 1000);
  const rows = await prisma.$queryRaw<{ count: number; resetAt: Date }[]>`
    INSERT INTO "RateLimitBucket" (key, count, "resetAt") VALUES (${key}, 1, ${resetAt})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN "RateLimitBucket"."resetAt" < ${now} THEN 1 ELSE "RateLimitBucket".count + 1 END,
      "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" < ${now} THEN ${resetAt} ELSE "RateLimitBucket"."resetAt" END
    RETURNING count, "resetAt"`;
  const row = rows[0]!;
  return { allowed: row.count <= limit, remaining: Math.max(0, limit - row.count), resetAt: row.resetAt };
}

export async function cleanupRateLimits() {
  await prisma.rateLimitBucket.deleteMany({ where: { resetAt: { lt: new Date(Date.now() - 3600_000) } } });
}
