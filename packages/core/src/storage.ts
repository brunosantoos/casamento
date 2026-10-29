import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { hmacSign, hmacVerify } from "./crypto.js";
import { env } from "./env.js";

/**
 * Armazenamento de objetos privado. Duas implementações:
 *  - s3: MinIO/S3 (produção), URLs pré-assinadas de curta duração
 *  - local: pasta fora do diretório público (desenvolvimento), URLs assinadas por HMAC servidas pela API
 * As chaves internas nunca são enviadas ao navegador.
 */
export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  signedUrl(key: string, opts: { fileName: string; contentType: string; inline?: boolean; ttlSeconds?: number }): Promise<string>;
}

const safeName = (n: string) => n.replace(/[^\w.\- ]+/g, "_").slice(0, 120);

class LocalStorage implements Storage {
  private root = path.resolve(process.env.INIT_CWD ?? process.cwd(), env().STORAGE_LOCAL_DIR);
  private file(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error("Chave de armazenamento inválida");
    return p;
  }
  async put(key: string, body: Buffer) {
    const p = this.file(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, body, { mode: 0o600 });
  }
  get(key: string) {
    return readFile(this.file(key));
  }
  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
  async signedUrl(key: string, opts: { fileName: string; contentType: string; inline?: boolean; ttlSeconds?: number }) {
    const exp = Math.floor(Date.now() / 1000) + (opts.ttlSeconds ?? 300);
    const token = Buffer.from(JSON.stringify({ k: key, n: safeName(opts.fileName), t: opts.contentType, i: !!opts.inline, e: exp })).toString("base64url");
    return `/api/blob/${token}.${hmacSign(token)}`;
  }
}

/** Valida o token emitido por LocalStorage.signedUrl */
export function verifyLocalBlobToken(raw: string) {
  const [token, sig] = raw.split(".");
  if (!token || !sig || !hmacVerify(token, sig)) return null;
  const data = JSON.parse(Buffer.from(token, "base64url").toString()) as { k: string; n: string; t: string; i: boolean; e: number };
  if (data.e < Date.now() / 1000) return null;
  return data;
}

class S3Storage implements Storage {
  private client = new S3Client({
    region: env().S3_REGION,
    endpoint: env().S3_ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: env().S3_ACCESS_KEY ?? "", secretAccessKey: env().S3_SECRET_KEY ?? "" },
  });
  private bucket = env().S3_BUCKET;
  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: env().S3_ENDPOINT ? undefined : "AES256" }));
  }
  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  signedUrl(key: string, opts: { fileName: string; contentType: string; inline?: boolean; ttlSeconds?: number }) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket, Key: key, ResponseContentType: opts.contentType,
        ResponseContentDisposition: `${opts.inline ? "inline" : "attachment"}; filename="${safeName(opts.fileName)}"`,
      }),
      { expiresIn: opts.ttlSeconds ?? 300 },
    );
  }
}

let instance: Storage | undefined;
export function storage(): Storage {
  instance ??= env().STORAGE_DRIVER === "s3" ? new S3Storage() : new LocalStorage();
  return instance;
}
