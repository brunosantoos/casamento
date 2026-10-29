import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emailConfig, sendEmail } from "../src/email.js";
import { saveIntegration } from "../src/integrations.js";
import { makeWedding, resetDb } from "./helpers.js";

function mockFetch(status = 200, body: unknown = { id: "email_123" }) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(body), { status });
  }));
  return calls;
}

async function withResend(enabled = true, from = "Casamento <oi@casal.com.br>") {
  const w = await makeWedding();
  await saveIntegration(w.ctx.actor, w.ctx.weddingId, "EMAIL", { enabled, config: { provider: "RESEND", from, replyTo: "casal@email.com" }, secrets: { apiKey: "re_test_key_123456" } });
  return w;
}

describe("e-mail via Resend", () => {
  beforeEach(resetDb);
  afterEach(() => vi.unstubAllGlobals());

  it("envia pela API do Resend com a chave decifrada, remetente e reply_to", async () => {
    const w = await withResend();
    const calls = mockFetch();
    await sendEmail("ana@email.com", "Assunto", "<p>Oi</p>", "Oi", w.ctx.weddingId);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect(calls[0]!.headers.Authorization).toBe("Bearer re_test_key_123456");
    expect(calls[0]!.body).toMatchObject({ from: "Casamento <oi@casal.com.br>", to: ["ana@email.com"], subject: "Assunto", html: "<p>Oi</p>", text: "Oi", reply_to: "casal@email.com" });
  });

  it("sem casamento (redefinição de senha) usa a integração ativa da instalação", async () => {
    await withResend();
    const calls = mockFetch();
    await sendEmail("ana@email.com", "Redefinir", "<p>link</p>");
    expect(calls).toHaveLength(1);
  });

  it("integração desativada não envia (cai no log em ambiente de teste)", async () => {
    const w = await withResend(false);
    const calls = mockFetch();
    expect(await emailConfig(w.ctx.weddingId)).toBeNull();
    await sendEmail("ana@email.com", "Assunto", "<p>Oi</p>", undefined, w.ctx.weddingId);
    expect(calls).toHaveLength(0);
  });

  it("erro do Resend vira exceção com a mensagem do provedor", async () => {
    const w = await withResend();
    mockFetch(403, { message: "The domain is not verified" });
    await expect(sendEmail("ana@email.com", "Assunto", "<p>Oi</p>", undefined, w.ctx.weddingId)).rejects.toThrow("Resend 403: The domain is not verified");
  });

  it("produção sem nenhuma configuração falha em vez de engolir o e-mail", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      await expect(sendEmail("ana@email.com", "Assunto", "<p>Oi</p>")).rejects.toThrow("E-mail não configurado");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
