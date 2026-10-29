import { prisma } from "@casa/db";
import { ALL_PERMISSIONS } from "../src/permissions.js";
import { createWedding } from "../src/wedding.js";
import type { Ctx } from "../src/context.js";

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

let n = 0;
export async function makeUser(name = "Pessoa") {
  n++;
  return prisma.user.create({ data: { name: `${name} ${n}`, email: `user${n}-${Date.now()}@teste.local` } });
}

export async function makeWedding(opts: { date?: Date } = {}) {
  const user = await makeUser("Admin");
  const w = await createWedding({ userId: user.id, userName: user.name }, { name: "Casamento Teste", partner1Name: "Ana", partner2Name: "Bruno", date: opts.date ?? new Date(Date.now() + 200 * 86400_000), budgetCents: 5_000_000, estimatedGuests: 100 });
  const ctx: Ctx = { weddingId: w.id, actor: { userId: user.id, userName: user.name, origin: "test" }, permissions: new Set(ALL_PERMISSIONS) };
  return { user, wedding: w, ctx };
}

export const withPerms = (ctx: Ctx, perms: string[]): Ctx => ({ ...ctx, permissions: new Set(perms) });
