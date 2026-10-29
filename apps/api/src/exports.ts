import { audit, centsToDecimal, toCSV } from "@casa/core";
import ExcelJS from "exceljs";
import type { Request, Response } from "express";
import { httpCtx, sendError } from "./http.js";
import { REPORTS } from "./reports-data.js";

/** GET /api/export/:report?format=csv|xlsx&from&to&categoryId&vendorId&status — exige reports:export + permissão do relatório */
export async function exportHandler(req: Request<{ report: string }>, res: Response) {
  const r = REPORTS[req.params.report];
  if (!r) return res.status(404).json({ error: "Relatório inexistente" });
  const ctx = await httpCtx(req, res, ["reports:export", r.permission]);
  if (!ctx) return;
  const q = req.query as Record<string, string | undefined>;
  const date = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : undefined);
  try {
    const report = await r.build(ctx, { from: date(q.from), to: date(q.to), categoryId: q.categoryId, vendorId: q.vendorId, status: q.status });
    const format = q.format === "xlsx" ? "xlsx" : "csv";
    const name = `${req.params.report}-${new Date().toISOString().slice(0, 10)}.${format}`;
    const fmt = (v: unknown, t?: string) => (v == null ? "" : t === "money" ? centsToDecimal(Number(v)) : t === "date" && v instanceof Date ? v.toLocaleDateString("pt-BR") : String(v));
    await audit(ctx.actor, { weddingId: ctx.weddingId, action: "export", entityType: "report", entityId: req.params.report, summary: `Exportou "${report.title}" (${format.toUpperCase()}, ${report.rows.length} linhas)` });
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
      return res.send(toCSV(report.columns.map((c) => c.label), report.rows.map((row) => report.columns.map((c) => fmt(row[c.key], c.type)))));
    }
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(report.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
    ws.columns = report.columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, c.label.length + 4), style: c.type === "money" ? { numFmt: '"R$" #,##0.00' } : c.type === "date" ? { numFmt: "dd/mm/yyyy" } : {} }));
    ws.getRow(1).font = { bold: true };
    for (const row of report.rows) ws.addRow(Object.fromEntries(report.columns.map((c) => [c.key, c.type === "money" && row[c.key] != null ? Number(row[c.key]) / 100 : typeof row[c.key] === "string" && /^[=+\-@]/.test(row[c.key] as string) ? `'${row[c.key]}` : row[c.key]])));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    sendError(res, e);
  }
}

/** POST /api/import/guests — lê CSV/XLSX e devolve linhas para revisão (nada é gravado aqui) */
export async function importGuestsPreview(req: Request, res: Response) {
  const ctx = await httpCtx(req, res, ["guests:create"]);
  if (!ctx) return;
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file) return res.status(400).json({ error: "Arquivo ausente" });
  try {
    const wb = new ExcelJS.Workbook();
    const isCsv = /csv|text/.test(file.mimetype) || file.originalname.toLowerCase().endsWith(".csv");
    let rows: string[][] = [];
    if (isCsv) {
      const text = file.buffer.toString("utf8").replace(/^﻿/, "");
      const sep = (text.split("\n")[0] ?? "").includes(";") ? ";" : ",";
      rows = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => parseCsvLine(l, sep));
    } else {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
      const ws = wb.worksheets[0];
      ws?.eachRow((row) => rows.push((row.values as unknown[]).slice(1).map((v) => (v == null ? "" : typeof v === "object" && v && "text" in v ? String((v as { text: unknown }).text) : String(v)))));
    }
    if (rows.length < 2) return res.status(400).json({ error: "Planilha vazia ou sem cabeçalho" });
    const header = rows[0]!.map((h) => h.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim());
    const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
    const idx = { fullName: col("nome", "name", "convidado"), family: col("familia", "grupo", "family"), phone: col("telefone", "celular", "whatsapp", "phone"), email: col("email", "e-mail"), relation: col("relacao", "parentesco"), side: col("lado"), category: col("categoria"), isChild: col("crianca"), plusOnesAllowed: col("acompanhantes", "+1"), dietary: col("restric", "alimenta"), notes: col("observ", "notas") };
    if (idx.fullName < 0) return res.status(400).json({ error: "Coluna 'Nome' não encontrada" });
    const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const parsed = rows.slice(1, 2001).map((r) => ({
      fullName: get(r, idx.fullName), family: get(r, idx.family) || null, phone: get(r, idx.phone) || null, email: get(r, idx.email) || null, relation: get(r, idx.relation) || null,
      side: get(r, idx.side) || null, category: get(r, idx.category) || null, isChild: /^(s|sim|x|1|true)$/i.test(get(r, idx.isChild)), plusOnesAllowed: Math.max(0, Math.min(10, parseInt(get(r, idx.plusOnesAllowed)) || 0)),
      dietary: get(r, idx.dietary) || null, notes: get(r, idx.notes) || null,
    })).filter((r) => r.fullName.length >= 2);
    res.json({ rows: parsed, total: parsed.length });
  } catch (e) {
    sendError(res, e);
  }
}

function parseCsvLine(line: string, sep: string) {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
