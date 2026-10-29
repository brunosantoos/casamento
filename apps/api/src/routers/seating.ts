import { applyArrangement, assignGuests, deleteTable, generateTables, reorderSeats, saveTable, savePositions, seatingLayout, suggestArrangement } from "@casa/core";
import { z } from "zod";
import { perm, router } from "../trpc.js";

const shape = z.enum(["ROUND", "RECT", "LONG"]);

export const seatingRouter = router({
  layout: perm("guests:view").input(z.object({ includeDeclined: z.boolean().optional() }).optional()).query(({ ctx, input }) => seatingLayout(ctx.weddingId, input ?? {})),
  saveTable: perm("guests:edit").input(z.object({
    id: z.string().optional(), name: z.string().trim().min(1).max(60), shape, capacity: z.number().int().min(1).max(100),
    x: z.number().optional(), y: z.number().optional(), rotation: z.number().optional(), zone: z.string().max(60).nullable().optional(), notes: z.string().max(1000).nullable().optional(),
  })).mutation(({ ctx, input }) => saveTable(ctx.svc, input)),
  deleteTable: perm("guests:edit").input(z.object({ id: z.string() })).mutation(({ ctx, input }) => deleteTable(ctx.svc, input.id)),
  generate: perm("guests:edit").input(z.object({ count: z.number().int().min(1).max(100), capacity: z.number().int().min(1).max(100), shape, prefix: z.string().max(30).optional() })).mutation(({ ctx, input }) => generateTables(ctx.svc, input)),
  savePositions: perm("guests:edit").input(z.object({ positions: z.array(z.object({ id: z.string(), x: z.number(), y: z.number(), rotation: z.number().optional() })).max(200) })).mutation(({ ctx, input }) => savePositions(ctx.svc, input.positions)),
  assign: perm("guests:edit").input(z.object({ guestIds: z.array(z.string()).min(1).max(200), tableId: z.string().nullable(), wholeFamily: z.boolean().optional(), force: z.boolean().optional() })).mutation(({ ctx, input }) => assignGuests(ctx.svc, input)),
  reorder: perm("guests:edit").input(z.object({ tableId: z.string(), guestIds: z.array(z.string()).max(100) })).mutation(({ ctx, input }) => reorderSeats(ctx.svc, input.tableId, input.guestIds)),
  suggest: perm("guests:view").input(z.object({ onlyConfirmed: z.boolean().optional() }).optional()).query(({ ctx, input }) => suggestArrangement(ctx.weddingId, input ?? {})),
  applySuggestion: perm("guests:edit").input(z.object({ proposal: z.array(z.object({ tableId: z.string(), guestIds: z.array(z.string()).min(1) })).max(200) })).mutation(({ ctx, input }) => applyArrangement(ctx.svc, input.proposal)),
});
