import { ALL_PERMISSIONS, uploadFile } from "@casa/core";
import { prisma } from "@casa/db";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it } from "vitest";
import { makeUser, makeWedding, resetDb } from "../../../packages/core/test/helpers.js";
import { auth } from "../src/auth.js";
import { appRouter } from "../src/router.js";

function caller(userId: string | null, opts: { weddingId?: string; token?: string } = {}) {
  return appRouter.createCaller({
    req: { headers: {} } as never,
    res: { setHeader() {} } as never,
    session: userId ? ({ user: { id: userId }, session: { token: opts.token ?? "t" } } as never) : null,
    ip: "127.0.0.1",
    userAgent: "vitest",
    correlationId: "test",
    requestedWeddingId: opts.weddingId ?? null,
  });
}

async function memberWithRole(weddingId: string, roleKey: string) {
  const u = await makeUser(roleKey);
  const role = await prisma.role.findUniqueOrThrow({ where: { weddingId_key: { weddingId, key: roleKey } } });
  await prisma.weddingMember.create({ data: { weddingId, userId: u.id, roleId: role.id, grants: [], revokes: [] } });
  await prisma.user.update({ where: { id: u.id }, data: { activeWeddingId: weddingId } });
  return u;
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (e) {
    return e instanceof TRPCError ? e.code : (e as Error).message;
  }
};

describe("segurança e permissões (API)", () => {
  beforeEach(resetDb);

  it("sem login → UNAUTHORIZED; conta desativada → UNAUTHORIZED", async () => {
    expect(await code(caller(null).dashboard.overview())).toBe("UNAUTHORIZED");
    const { user } = await makeWedding();
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    expect(await code(caller(user.id).dashboard.overview())).toBe("UNAUTHORIZED");
  });

  it("usuário sem permissão é bloqueado no servidor e o evento é registrado", async () => {
    const { wedding } = await makeWedding();
    const collab = await memberWithRole(wedding.id, "COLLABORATOR");
    expect(await code(caller(collab.id).finance.summary())).toBe("FORBIDDEN");
    expect(await code(caller(collab.id).guests.list())).toBe("FORBIDDEN");
    expect(await code(caller(collab.id).settings.integrations())).toBe("FORBIDDEN");
    expect(await code(caller(collab.id).planning.stats())).toBe("OK");
    expect(await prisma.securityEvent.count({ where: { type: "forbidden", userId: collab.id } })).toBe(3);
    // Cerimonialista não vê financeiro nem segredos
    const planner = await memberWithRole(wedding.id, "PLANNER");
    expect(await code(caller(planner.id).finance.summary())).toBe("FORBIDDEN");
    expect(await code(caller(planner.id).settings.integrations())).toBe("FORBIDDEN");
    expect(await code(caller(planner.id).vendors.list())).toBe("OK");
  });

  it("acesso a outro casamento é negado; IDs de outro casamento não são encontrados (IDOR)", async () => {
    const a = await makeWedding();
    const b = await makeWedding();
    expect(await code(caller(a.user.id, { weddingId: b.wedding.id }).finance.summary())).toBe("FORBIDDEN");
    const obl = await caller(b.user.id).finance.saveObligation({ title: "Do B", items: [{ description: "x", kind: "EXPENSE", chargeType: "ONE_TIME", unitCents: 100, quantity: "1", discountCents: 0, surchargeCents: 0, status: "PLANNED" }] });
    expect(await code(caller(a.user.id).finance.obligation({ id: obl.id }))).toBe("NOT_FOUND");
    const vendor = await caller(b.user.id).vendors.save({ name: "Fornecedor B" });
    expect(await code(caller(a.user.id).vendors.get({ id: vendor.id }))).toBe("NOT_FOUND");
    expect(await code(caller(a.user.id).vendors.archive({ id: vendor.id, archived: true }))).toBe("NOT_FOUND");
  });

  it("documentos privados: outro casamento não acessa; categoria exige a permissão certa", async () => {
    const a = await makeWedding();
    const b = await makeWedding();
    const f = await uploadFile(b.ctx, { buffer: Buffer.from("%PDF-1.4 contrato"), originalName: "contrato.pdf", declaredMime: "application/pdf", category: "CONTRACT" });
    expect(await code(caller(a.user.id).files.url({ id: f.id }))).toBe("NOT_FOUND");
    const collab = await memberWithRole(b.wedding.id, "COLLABORATOR");
    expect(await code(caller(collab.id).files.url({ id: f.id }))).toBe("FORBIDDEN");
    const r = await caller(b.user.id).files.url({ id: f.id });
    expect(r.url).toMatch(/^\/api\/blob\//);
    expect(r.url).not.toContain(f.storageKey);
    // Arquivo executável/HTML é recusado
    await expect(uploadFile(b.ctx, { buffer: Buffer.from("<html><script>alert(1)</script></html>"), originalName: "x.html", declaredMime: "text/html", category: "DOCUMENT" })).rejects.toThrow(/não permitido/);
    await expect(uploadFile(b.ctx, { buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00]), originalName: "x.pdf", declaredMime: "application/pdf", category: "DOCUMENT" })).rejects.toThrow();
  });

  it("elevação de privilégio: não concede o que não tem nem altera o próprio acesso", async () => {
    const { wedding, user } = await makeWedding();
    const planner = await memberWithRole(wedding.id, "PLANNER");
    const plannerMember = await prisma.weddingMember.findFirstOrThrow({ where: { userId: planner.id } });
    await prisma.weddingMember.update({ where: { id: plannerMember.id }, data: { grants: ["users:create", "users:edit", "users:view"] } });
    const admin = await prisma.role.findUniqueOrThrow({ where: { weddingId_key: { weddingId: wedding.id, key: "ADMIN" } } });
    expect(await code(caller(planner.id).members.invite({ email: "novo@x.com", roleId: admin.id }))).toBe("FORBIDDEN");
    expect(await code(caller(planner.id).members.saveRole({ name: "Super", permissions: ["finance:view"] }))).toBe("FORBIDDEN");
    expect(await code(caller(planner.id).members.updateMember({ memberId: plannerMember.id, grants: ["finance:view"] }))).toBe("FORBIDDEN");
    const adminMember = await prisma.weddingMember.findFirstOrThrow({ where: { userId: user.id } });
    expect(await code(caller(user.id).members.updateMember({ memberId: adminMember.id, active: false }))).toBe("FORBIDDEN");
    expect(await code(caller(user.id).members.saveRole({ id: admin.id, name: "Admin", permissions: [] }))).toBe("FORBIDDEN");
  });

  it("exportações e relatórios respeitam a permissão do relatório", async () => {
    const { wedding } = await makeWedding();
    const planner = await memberWithRole(wedding.id, "PLANNER");
    const list = await caller(planner.id).reports.list();
    expect(list.some((r) => r.permission.startsWith("finance"))).toBe(false);
    expect(await code(caller(planner.id).reports.get({ key: "pagamentos" }))).toBe("FORBIDDEN");
    expect(await code(caller(planner.id).reports.get({ key: "tarefas-atrasadas" }))).toBe("OK");
  });

  it("segredos nunca voltam ao front (somente dica mascarada)", async () => {
    const { user } = await makeWedding();
    await caller(user.id).settings.saveAi({ enabled: true, provider: "ANTHROPIC", model: "claude-sonnet-5", apiKey: "sk-ant-super-secreta-123456" });
    const view = JSON.stringify(await caller(user.id).settings.integrations());
    expect(view).not.toContain("super-secreta");
    expect(view).toContain("3456");
    const row = await prisma.integrationSecret.findFirstOrThrow();
    expect(row.valueEnc).not.toContain("super-secreta");
    const logs = JSON.stringify(await prisma.auditLog.findMany());
    expect(logs).not.toContain("super-secreta");
  });

  it("auditoria é somente leitura (não há rota de alteração) e registra ações críticas", async () => {
    const keys = Object.keys(appRouter._def.procedures).filter((k) => k.startsWith("audit."));
    expect(keys.sort()).toEqual(["audit.backups", "audit.facets", "audit.list", "audit.security"]);
    expect(ALL_PERMISSIONS.filter((p) => p.startsWith("audit:"))).toEqual(["audit:view"]);
  });
});

describe("autenticação (better-auth)", () => {
  beforeEach(resetDb);
  const H = () => new Headers({ origin: "http://localhost:5190" });

  it("primeiro usuário cria conta; depois só com convite", async () => {
    const first = await auth.api.signUpEmail({ body: { email: "admin@teste.local", password: "senha-muito-segura", name: "Admin" }, headers: H() });
    expect(first.user.email).toBe("admin@teste.local");
    expect((await prisma.user.findUniqueOrThrow({ where: { email: "admin@teste.local" } })).isSuperAdmin).toBe(true);
    await expect(auth.api.signUpEmail({ body: { email: "intruso@teste.local", password: "senha-muito-segura", name: "X" }, headers: H() })).rejects.toThrow(/convite/);

    const w = await caller(first.user.id).wedding.create({ name: "Casório", partner1Name: "A", partner2Name: "B", timezone: "America/Sao_Paulo", budgetCents: 0 });
    const role = await prisma.role.findUniqueOrThrow({ where: { weddingId_key: { weddingId: w.id, key: "PLANNER" } } });
    const inv = await caller(first.user.id).members.invite({ email: "cerimonial@teste.local", roleId: role.id });
    const token = inv.url.split("/convite/")[1]!;
    const h = H();
    h.set("x-invite-token", token);
    // Convite é para outro e-mail: recusado
    await expect(auth.api.signUpEmail({ body: { email: "outro@teste.local", password: "senha-muito-segura", name: "Y" }, headers: h })).rejects.toThrow(/convite/);
    const u = await auth.api.signUpEmail({ body: { email: "cerimonial@teste.local", password: "senha-muito-segura", name: "Cerimonial" }, headers: h });
    await caller(u.user.id).members.acceptInvitation({ token });
    const me = await caller(u.user.id).wedding.me();
    expect(me.active?.roleKey).toBe("PLANNER");
    expect(me.active?.permissions).not.toContain("finance:view");
    expect(await code(caller(u.user.id).members.acceptInvitation({ token }))).toBe("NOT_FOUND");
  });

  it("recuperação de senha: token de uso único, sessões antigas revogadas", async () => {
    const s = await auth.api.signUpEmail({ body: { email: "casal@teste.local", password: "senha-antiga-123", name: "Casal" }, headers: H() });
    await auth.api.requestPasswordReset({ body: { email: "casal@teste.local", redirectTo: "http://localhost:5190/redefinir-senha" }, headers: H() });
    const v = await prisma.verification.findFirstOrThrow({ where: { identifier: { startsWith: "reset-password:" } } });
    const token = v.identifier.replace("reset-password:", "");
    await auth.api.resetPassword({ body: { token, newPassword: "senha-nova-456789" }, headers: H() });
    await expect(auth.api.resetPassword({ body: { token, newPassword: "outra-senha-000" }, headers: H() })).rejects.toThrow();
    await expect(auth.api.signInEmail({ body: { email: "casal@teste.local", password: "senha-antiga-123" }, headers: H() })).rejects.toThrow();
    const ok = await auth.api.signInEmail({ body: { email: "casal@teste.local", password: "senha-nova-456789" }, headers: H() });
    expect(ok.user.id).toBe(s.user.id);
    expect(await prisma.session.count({ where: { token: s.token! } })).toBe(0);
  });

  it("sessão expirada não autentica; usuário desativado não loga", async () => {
    const s = await auth.api.signUpEmail({ body: { email: "exp@teste.local", password: "senha-muito-segura", name: "Exp" }, headers: H() });
    const h = new Headers({ cookie: `better-auth.session_token=${s.token}` });
    await prisma.session.updateMany({ where: { userId: s.user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await auth.api.getSession({ headers: h })).toBeNull();
    await prisma.user.update({ where: { id: s.user.id }, data: { active: false } });
    await expect(auth.api.signInEmail({ body: { email: "exp@teste.local", password: "senha-muito-segura" }, headers: H() })).rejects.toThrow();
  });
});

describe("dados do casamento", () => {
  beforeEach(resetDb);
  it("atualização parcial não apaga orçamento nem fuso", async () => {
    const { user, wedding } = await makeWedding();
    await prisma.wedding.update({ where: { id: wedding.id }, data: { timezone: "America/Manaus" } });
    await caller(user.id).wedding.update({ city: "Recife" });
    const w = await prisma.wedding.findUniqueOrThrow({ where: { id: wedding.id } });
    expect(w.budgetCents).toBe(5_000_000);
    expect(w.timezone).toBe("America/Manaus");
    expect(w.city).toBe("Recife");
  });
});
