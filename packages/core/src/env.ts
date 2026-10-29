import { z } from "zod";

/** Somente variáveis de bootstrap. Configuração operacional fica no banco (settings.ts). */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  MASTER_KEY: z.string().regex(/^[0-9a-f]{64}$/i, "MASTER_KEY deve ter 32 bytes em hex (openssl rand -hex 32)"),
  WEB_ORIGIN: z.string().default("http://localhost:5190"),
  API_URL: z.string().default("http://localhost:4100"),
  API_PORT: z.coerce.number().default(4100),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default(".storage"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("casamento"),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("Casamento <nao-responda@localhost>"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  cached ??= schema.parse(process.env);
  return cached;
}
