import { prisma, type Tx } from "@casa/db";
import { audit, type Actor } from "./audit.js";
import { CHECKLIST_PHASES, DEFAULT_ALBUMS, DEFAULT_CATEGORIES, DEFAULT_MESSAGE_TEMPLATES } from "./defaults.js";
import { assert, notFound } from "./errors.js";
import { DEFAULT_ROLES } from "./permissions.js";

export async function ensureDefaultChecklistTemplate(tx: Tx | typeof prisma = prisma) {
  const existing = await tx.checklistTemplate.findFirst({ where: { weddingId: null } });
  if (existing) return existing;
  return tx.checklistTemplate.create({
    data: {
      name: "Checklist completo (9 fases)",
      items: {
        create: CHECKLIST_PHASES.flatMap((p) =>
          p.items.map((it, i) => ({ phase: p.phase, phaseName: p.name, title: it.title, area: it.area ?? null, priority: it.priority ?? "MEDIUM", offsetDays: it.offsetDays ?? null, sortOrder: i })),
        ),
      },
    },
  });
}

export async function createWedding(
  actor: Actor,
  input: { name: string; partner1Name: string; partner2Name: string; date?: Date | null; timezone?: string; city?: string | null; budgetCents?: number; estimatedGuests?: number | null },
) {
  assert(actor.userId, "Usuário obrigatório");
  return prisma.$transaction(async (tx) => {
    const w = await tx.wedding.create({
      data: {
        name: input.name, partner1Name: input.partner1Name, partner2Name: input.partner2Name, date: input.date ?? null,
        timezone: input.timezone ?? "America/Sao_Paulo", city: input.city ?? null, budgetCents: input.budgetCents ?? 0,
        estimatedGuests: input.estimatedGuests ?? null, createdById: actor.userId,
      },
    });
    for (const r of DEFAULT_ROLES) await tx.role.create({ data: { weddingId: w.id, key: r.key, name: r.name, description: r.description, permissions: r.permissions, system: true } });
    const admin = await tx.role.findUniqueOrThrow({ where: { weddingId_key: { weddingId: w.id, key: "ADMIN" } } });
    await tx.weddingMember.create({ data: { weddingId: w.id, userId: actor.userId!, roleId: admin.id, grants: [], revokes: [] } });
    await tx.financialCategory.createMany({ data: DEFAULT_CATEGORIES.map((name, i) => ({ weddingId: w.id, name, sortOrder: i })) });
    await tx.photoAlbum.createMany({ data: DEFAULT_ALBUMS.map((name, i) => ({ weddingId: w.id, name, sortOrder: i })) });
    await tx.messageTemplate.createMany({ data: DEFAULT_MESSAGE_TEMPLATES.map((t) => ({ ...t, weddingId: w.id })) });
    await tx.ceremony.create({ data: { weddingId: w.id } });
    await tx.user.update({ where: { id: actor.userId! }, data: { activeWeddingId: w.id } });
    await ensureDefaultChecklistTemplate(tx);
    await audit(actor, { weddingId: w.id, action: "create", entityType: "wedding", entityId: w.id, summary: `Criou o casamento "${w.name}"` }, tx);
    return w;
  });
}

/** Gera tarefas a partir de um modelo, com datas calculadas pela data do casamento (ajustáveis) */
export async function generateTasksFromTemplate(
  actor: Actor,
  weddingId: string,
  input: { templateId: string; phases?: number[]; itemIds?: string[]; dateOverrides?: Record<string, Date | null>; skipExisting?: boolean },
) {
  const [wedding, template] = await Promise.all([
    prisma.wedding.findUniqueOrThrow({ where: { id: weddingId } }),
    prisma.checklistTemplate.findFirst({ where: { id: input.templateId, OR: [{ weddingId: null }, { weddingId }] }, include: { items: true } }),
  ]);
  if (!template) throw notFound("Modelo");
  let items = template.items;
  if (input.phases?.length) items = items.filter((i) => input.phases!.includes(i.phase));
  if (input.itemIds?.length) items = items.filter((i) => input.itemIds!.includes(i.id));
  const existing = input.skipExisting !== false ? new Set((await prisma.task.findMany({ where: { weddingId, templateItemId: { in: items.map((i) => i.id) } }, select: { templateItemId: true } })).map((t) => t.templateItemId)) : new Set();
  const toCreate = items.filter((i) => !existing.has(i.id));
  const due = (i: (typeof items)[number]) => {
    if (input.dateOverrides && i.id in input.dateOverrides) return input.dateOverrides[i.id] ?? null;
    if (!wedding.date || i.offsetDays == null) return null;
    return new Date(wedding.date.getTime() + i.offsetDays * 86400_000);
  };
  await prisma.task.createMany({
    data: toCreate.map((i) => ({
      weddingId, title: i.title, description: i.description, phase: i.phase, category: i.phaseName, area: i.area, priority: i.priority,
      dueDate: due(i), templateItemId: i.id, createdById: actor.userId,
    })),
  });
  await audit(actor, { weddingId, action: "create", entityType: "task", summary: `Gerou ${toCreate.length} tarefa(s) a partir do modelo "${template.name}"` });
  return { created: toCreate.length, skipped: items.length - toCreate.length };
}
