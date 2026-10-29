import { uploadGuestPhoto } from "@casa/core";
import type { Request, Response } from "express";
import { sendError } from "./http.js";

/** POST /api/portal/:token/photos — foto enviada por convidado (fica pendente de aprovação do casal) */
export async function portalPhotoUpload(req: Request<{ token: string }>, res: Response) {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file) return res.status(400).json({ error: "Escolha uma foto" });
  try {
    const r = await uploadGuestPhoto(
      req.params.token,
      {
        buffer: file.buffer,
        originalName: Buffer.from(file.originalname, "latin1").toString("utf8"),
        declaredMime: file.mimetype,
        uploaderName: String(req.body?.uploaderName ?? ""),
        caption: req.body?.caption ? String(req.body.caption) : null,
      },
      { ip: req.ip ?? null },
    );
    res.json(r);
  } catch (e) {
    sendError(res, e);
  }
}
