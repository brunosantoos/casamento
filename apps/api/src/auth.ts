import { audit, emailLayout, env, securityEvent, sendEmail, tokenHash } from "@casa/core";
import { prisma } from "@casa/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";

/**
 * Cadastro aberto apenas para o PRIMEIRO usuário (instalação). Depois, só por convite:
 * o token do convite precisa acompanhar o cadastro (cabeçalho x-invite-token).
 */
export const auth = betterAuth({
  baseURL: env().API_URL,
  secret: env().BETTER_AUTH_SECRET,
  trustedOrigins: [env().WEB_ORIGIN],
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    autoSignIn: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, token }) => {
      const url = `${env().WEB_ORIGIN}/redefinir-senha?token=${encodeURIComponent(token)}`;
      await sendEmail(user.email, "Redefinir sua senha", emailLayout("Redefinir sua senha", `<p>Olá, ${user.name.split(" ")[0]}! Recebemos um pedido para redefinir sua senha.</p><p style="color:#666;font-size:13px">O link vale por 1 hora. Se não foi você, ignore este e-mail.</p>`, { label: "Criar nova senha", url }), `Redefina sua senha: ${url}`);
      await securityEvent("password_reset_requested", { userId: user.id });
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    freshAge: 60 * 15,
  },
  rateLimit: {
    enabled: true,
    storage: "memory",
    window: 60,
    max: 60,
    customRules: { "/sign-in/email": { window: 300, max: 10 }, "/request-password-reset": { window: 900, max: 5 }, "/sign-up/email": { window: 3600, max: 10 } },
  },
  advanced: {
    database: { generateId: false },
    ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] },
    useSecureCookies: env().WEB_ORIGIN.startsWith("https"),
    defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-up/email") return;
      const users = await prisma.user.count();
      if (users === 0) return;
      const token = ctx.headers?.get("x-invite-token");
      const email = String((ctx.body as { email?: string } | undefined)?.email ?? "").toLowerCase();
      const inv = token ? await prisma.invitation.findUnique({ where: { tokenHash: tokenHash(token) } }) : null;
      if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date() || inv.email.toLowerCase() !== email) {
        throw new APIError("FORBIDDEN", { message: "Cadastro apenas por convite. Peça um convite ao administrador do casamento." });
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-in/email") {
        const ret = ctx.context.returned;
        const ip = ctx.request?.headers.get("x-forwarded-for") ?? null;
        if (ret instanceof APIError) await securityEvent("login_failed", { ip, details: { email: (ctx.body as { email?: string })?.email } });
      }
    }),
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // Primeiro usuário da instalação vira administrador da plataforma
          if ((await prisma.user.count()) === 1) await prisma.user.update({ where: { id: user.id }, data: { isSuperAdmin: true } });
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          const u = await prisma.user.findUnique({ where: { id: session.userId } });
          if (u && !u.active) {
            await securityEvent("login_blocked_inactive", { userId: u.id });
            return false;
          }
        },
        after: async (session) => {
          const u = await prisma.user.update({ where: { id: session.userId }, data: { lastLoginAt: new Date() } });
          await audit({ userId: u.id, userName: u.name, ip: session.ipAddress ?? null, origin: "web" }, { weddingId: u.activeWeddingId, action: "login", entityType: "session", entityId: session.id, summary: `${u.name} entrou no sistema` });
        },
      },
    },
  },
});
