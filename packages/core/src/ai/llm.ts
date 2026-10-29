import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { prisma } from "@casa/db";
import { generateText, type LanguageModel } from "ai";
import { DomainError } from "../errors.js";
import { getIntegration, readSecret } from "../integrations.js";
import { getSetting } from "../settings.js";

/** Camada independente de fornecedor: o restante do sistema só conhece `LanguageModel` */
export const AI_PROVIDERS = {
  ANTHROPIC: { label: "Anthropic (Claude)", models: ["claude-sonnet-5", "claude-haiku-4-5-20251001", "claude-opus-5-5"], needsBaseUrl: false },
  OPENAI: { label: "OpenAI", models: ["gpt-5", "gpt-5-mini"], needsBaseUrl: false },
  GOOGLE: { label: "Google (Gemini)", models: ["gemini-2.5-pro", "gemini-2.5-flash"], needsBaseUrl: false },
  OPENAI_COMPATIBLE: { label: "Compatível com OpenAI (Ollama, OpenRouter…)", models: [], needsBaseUrl: true },
} as const;
export type AiProvider = keyof typeof AI_PROVIDERS;

export type AiConfig = { provider: AiProvider; model: string; baseUrl?: string | null; apiKey: string };

export function buildModel(c: AiConfig): LanguageModel {
  const base = c.baseUrl ? { baseURL: c.baseUrl } : {};
  switch (c.provider) {
    case "ANTHROPIC":
      return createAnthropic({ apiKey: c.apiKey, ...base })(c.model);
    case "OPENAI":
      return createOpenAI({ apiKey: c.apiKey, ...base })(c.model);
    case "GOOGLE":
      return createGoogleGenerativeAI({ apiKey: c.apiKey, ...base })(c.model);
    case "OPENAI_COMPATIBLE":
      if (!c.baseUrl) throw new DomainError("Informe a URL base do provedor");
      return createOpenAICompatible({ name: "custom", baseURL: c.baseUrl, apiKey: c.apiKey }).chatModel(c.model);
  }
}

/** Permite injetar um modelo nos testes (sem rede) */
let override: ((weddingId: string) => LanguageModel) | null = null;
export function setModelOverride(fn: typeof override) {
  override = fn;
}

export async function weddingModel(weddingId: string): Promise<{ model: LanguageModel; modelName: string }> {
  if (override) return { model: override(weddingId), modelName: "test" };
  const i = await getIntegration(weddingId, "AI");
  const cfg = (i?.config ?? {}) as { provider?: AiProvider; model?: string; baseUrl?: string };
  const apiKey = await readSecret(weddingId, "AI", "apiKey");
  if (!i?.enabled || !cfg.provider || !cfg.model || !apiKey) throw new DomainError("Provedor de IA não configurado. Vá em Configurações → Integrações.", "PRECONDITION_FAILED");
  return { model: buildModel({ provider: cfg.provider, model: cfg.model, baseUrl: cfg.baseUrl, apiKey }), modelName: `${cfg.provider}/${cfg.model}` };
}

export async function testAi(c: AiConfig) {
  const r = await generateText({ model: buildModel(c), prompt: "Responda apenas: ok", maxOutputTokens: 16, maxRetries: 0 });
  return r.text.trim();
}

/** Controle de custo: bloqueia acima do limite mensal configurado */
export async function assertWithinBudget(weddingId: string) {
  const limit = await getSetting(weddingId, "ai.monthlyTokenLimit");
  if (!limit) return;
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const used = await prisma.aIUsage.aggregate({ where: { weddingId, createdAt: { gte: start } }, _sum: { inputTokens: true, outputTokens: true } });
  const total = (used._sum.inputTokens ?? 0) + (used._sum.outputTokens ?? 0);
  if (total >= limit) throw new DomainError(`Limite mensal de uso da IA atingido (${total.toLocaleString("pt-BR")} tokens). Ajuste em Configurações.`, "PRECONDITION_FAILED");
}

export async function recordUsage(weddingId: string, userId: string | null, feature: string, model: string, usage: { inputTokens?: number; outputTokens?: number } | undefined) {
  await prisma.aIUsage.create({ data: { weddingId, userId, feature, model, inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0 } });
}
