import { prisma } from "@casa/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { REPORT_LIST, REPORTS } from "../reports-data.js";
import { perm, router } from "../trpc.js";

const filters = z.object({ from: z.date().optional(), to: z.date().optional(), categoryId: z.string().optional(), vendorId: z.string().optional(), status: z.string().optional() });

export const reportsRouter = router({
  list: perm("reports:view").query(({ ctx }) => REPORT_LIST.filter((r) => ctx.permissions.has(r.permission))),
  get: perm("reports:view").input(z.object({ key: z.string(), filters: filters.optional() })).query(async ({ ctx, input }) => {
    const r = REPORTS[input.key];
    if (!r) throw new TRPCError({ code: "NOT_FOUND" });
    if (!ctx.permissions.has(r.permission)) throw new TRPCError({ code: "FORBIDDEN", message: `Sem permissão (${r.permission})` });
    return r.build(ctx.svc, input.filters ?? {});
  }),
  filterOptions: perm("reports:view").query(async ({ ctx }) => ({
    categories: ctx.permissions.has("finance:view") ? await prisma.financialCategory.findMany({ where: { weddingId: ctx.weddingId, parentId: null, archivedAt: null }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }) : [],
    vendors: ctx.permissions.has("vendors:view") ? await prisma.vendor.findMany({ where: { weddingId: ctx.weddingId, mergedIntoId: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
  })),
});
