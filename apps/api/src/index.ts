import { env, handleEvolutionWebhook, rateLimit, securityEvent, storage, uploadFile, verifyLocalBlobToken, type Permission } from "@casa/core";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { toNodeHandler } from "better-auth/node";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import multer from "multer";
import { auth } from "./auth.js";
import { exportHandler, importGuestsPreview } from "./exports.js";
import { httpCtx, sendError } from "./http.js";
import { portalPhotoUpload } from "./portal-photos.js";
import { appRouter } from "./router.js";
import { createContext } from "./trpc.js";

const { API_PORT, WEB_ORIGIN } = env();
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }, crossOriginResourcePolicy: { policy: "same-site" } }));
app.use(cors({ origin: WEB_ORIGIN, credentials: true }));

// Limite por IP para tudo que é público
async function ipLimit(req: express.Request, res: express.Response, next: express.NextFunction, bucket: string, limit: number, windowS: number) {
  const r = await rateLimit(`${bucket}:${req.ip}`, limit, windowS);
  if (!r.allowed) {
    await securityEvent("rate_limited", { ip: req.ip, details: { bucket, path: req.path } });
    return res.status(429).json({ error: "Muitas requisições. Aguarde um pouco." });
  }
  next();
}

// better-auth antes do express.json()
app.all("/api/auth/*splat", toNodeHandler(auth));

// Webhook da Evolution: token secreto na URL (só o hash é guardado), idempotente
app.post(
  "/webhooks/evolution/:token",
  (req, res, next) => ipLimit(req, res, next, "webhook", 600, 60),
  express.json({ limit: "2mb" }),
  async (req, res) => {
    try {
      const r = await handleEvolutionWebhook(req.params.token, req.body, { ip: req.ip });
      res.sendStatus(r.status);
    } catch (e) {
      console.error("[webhook]", e);
      res.sendStatus(500);
    }
  },
);

// Upload de arquivos (multipart). Permissão depende da categoria.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 1 } });
const UPLOAD_PERM: Record<string, Permission> = { PHOTO: "gallery:create", INSPIRATION: "gallery:create", RECEIPT: "finance:create" };
app.post("/api/files", upload.single("file"), async (req, res) => {
  const category = String(req.body?.category ?? "OTHER");
  const ctx = await httpCtx(req, res, [UPLOAD_PERM[category] ?? "documents:create"]);
  if (!ctx) return;
  if (!req.file) return res.status(400).json({ error: "Arquivo ausente" });
  try {
    const f = await uploadFile(ctx, {
      buffer: req.file.buffer, originalName: Buffer.from(req.file.originalname, "latin1").toString("utf8"), declaredMime: req.file.mimetype, category,
      description: req.body.description || null, entityType: req.body.entityType || null, entityId: req.body.entityId || null, replaceFileId: req.body.replaceFileId || null,
    });
    res.json({ id: f.id, originalName: f.originalName, mimeType: f.mimeType, size: f.size, version: f.version });
  } catch (e) {
    sendError(res, e);
  }
});

// Download assinado (armazenamento local). Expira em minutos; nunca expõe o caminho interno.
app.get("/api/blob/:token", async (req, res) => {
  const data = verifyLocalBlobToken(req.params.token);
  if (!data) return res.status(403).send("Link expirado ou inválido");
  try {
    const buf = await storage().get(data.k);
    res.setHeader("Content-Type", data.t);
    res.setHeader("Content-Disposition", `${data.i ? "inline" : "attachment"}; filename="${data.n}"`);
    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
    res.send(buf);
  } catch {
    res.status(404).send("Arquivo não encontrado");
  }
});

app.get("/api/export/:report", exportHandler);
// Fotos enviadas pelos convidados (token do convite; limite por IP mais estrito)
app.post("/api/portal/:token/photos", (req, res, next) => ipLimit(req, res, next, "portal-photos", 30, 600), multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } }).single("file"), portalPhotoUpload);
app.post("/api/import/guests", multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }).single("file"), importGuestsPreview);

// Portal público: limite mais estrito por IP (antienumeração)
app.use("/trpc", (req, res, next) => (req.path.startsWith("/portal") ? ipLimit(req, res, next, "portal", 60, 60) : next()));
app.use("/trpc", express.json({ limit: "1mb" }), createExpressMiddleware({ router: appRouter, createContext }));
app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(API_PORT, () => console.log(`API em http://localhost:${API_PORT}`));
