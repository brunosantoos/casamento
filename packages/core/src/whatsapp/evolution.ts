import { DomainError } from "../errors.js";
import { getIntegration, readSecret } from "../integrations.js";

/**
 * Cliente da Evolution API v2 (testado contra v2.3.x). Endpoints usados:
 *   POST /instance/create · GET /instance/connect/:name · GET /instance/connectionState/:name
 *   DELETE /instance/logout/:name · POST /webhook/set/:name · POST /message/sendText/:name
 * Cada casamento usa sua própria instância e chave (cadastradas em Configurações → Integrações).
 */
export const WEBHOOK_EVENTS = ["QRCODE_UPDATED", "CONNECTION_UPDATE", "MESSAGES_UPSERT", "MESSAGES_UPDATE", "SEND_MESSAGE"] as const;

export class EvolutionError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown) {
    super(message);
  }
  /** 4xx (exceto 408/429) não adianta repetir */
  get permanent() {
    return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429;
  }
}

export type EvolutionConfig = { baseUrl: string; apiKey: string };

export async function evolutionConfig(weddingId: string): Promise<EvolutionConfig> {
  const i = await getIntegration(weddingId, "EVOLUTION");
  const baseUrl = (i?.config as { baseUrl?: string } | null)?.baseUrl;
  const apiKey = await readSecret(weddingId, "EVOLUTION", "apiKey");
  if (!i?.enabled || !baseUrl || !apiKey) throw new DomainError("Evolution API não configurada. Vá em Configurações → Integrações.", "PRECONDITION_FAILED");
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

async function call<T>(cfg: EvolutionConfig, method: string, path: string, body?: unknown, timeoutMs = 20_000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", apikey: cfg.apiKey },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new EvolutionError(`Evolution indisponível: ${(e as Error).message}`, 0, null);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = (data as { response?: { message?: unknown } })?.response?.message;
    throw new EvolutionError(`Evolution ${method} ${path} → ${res.status}${msg ? `: ${JSON.stringify(msg)}` : ""}`, res.status, data);
  }
  return data as T;
}

export type QrResponse = { base64?: string; code?: string; pairingCode?: string | null };

export const evolution = {
  createInstance: (cfg: EvolutionConfig, instanceName: string, webhookUrl: string) =>
    call<{ instance: { instanceName: string; status: string }; qrcode?: QrResponse }>(cfg, "POST", "/instance/create", {
      instanceName, integration: "WHATSAPP-BAILEYS", qrcode: true, groupsIgnore: true, syncFullHistory: false,
      webhook: { enabled: true, url: webhookUrl, byEvents: false, base64: false, events: WEBHOOK_EVENTS },
    }),
  setWebhook: (cfg: EvolutionConfig, instanceName: string, webhookUrl: string) =>
    call(cfg, "POST", `/webhook/set/${instanceName}`, { webhook: { enabled: true, url: webhookUrl, byEvents: false, base64: false, events: WEBHOOK_EVENTS } }),
  connect: (cfg: EvolutionConfig, instanceName: string) => call<QrResponse>(cfg, "GET", `/instance/connect/${instanceName}`),
  connectionState: (cfg: EvolutionConfig, instanceName: string) =>
    call<{ instance: { instanceName: string; state: "open" | "close" | "connecting" } }>(cfg, "GET", `/instance/connectionState/${instanceName}`, undefined, 10_000),
  logout: (cfg: EvolutionConfig, instanceName: string) => call(cfg, "DELETE", `/instance/logout/${instanceName}`),
  deleteInstance: (cfg: EvolutionConfig, instanceName: string) => call(cfg, "DELETE", `/instance/delete/${instanceName}`),
  /** Retorna key.id (id da mensagem no WhatsApp) quando aceita */
  sendText: (cfg: EvolutionConfig, instanceName: string, number: string, text: string) =>
    call<{ key?: { id?: string; remoteJid?: string }; status?: string }>(cfg, "POST", `/message/sendText/${instanceName}`, { number, text, linkPreview: true }, 30_000),
  /** GET / devolve versão — usado no "Testar conexão" */
  info: (cfg: EvolutionConfig) => call<{ status?: number; message?: string; version?: string }>(cfg, "GET", "/", undefined, 8_000),
};
