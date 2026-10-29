import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env.js";

const key = () => Buffer.from(env().MASTER_KEY, "hex");

/** AES-256-GCM. Formato: iv.tag.ciphertext (base64url) */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(payload: string): string {
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64url"));
  if (!iv || !tag || !data) throw new Error("Payload criptografado inválido");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export const sha256 = (input: string | Buffer) => createHash("sha256").update(input).digest("hex");

/** Token aleatório não previsível (256 bits), seguro para URL */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** Hash de token para indexação: HMAC com a chave mestra (um vazamento do banco não revela os tokens) */
export const tokenHash = (token: string) => createHmac("sha256", key()).update(token).digest("hex");

export function hmacSign(data: string) {
  return createHmac("sha256", key()).update(data).digest("base64url");
}

export function hmacVerify(data: string, signature: string) {
  const expected = Buffer.from(hmacSign(data));
  const got = Buffer.from(signature);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export const lastChars = (s: string, n = 4) => (s.length <= n ? "•".repeat(s.length) : `•••• ${s.slice(-n)}`);
